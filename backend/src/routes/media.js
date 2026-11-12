// Routen: /media, /media/:mediaId, /media/upload, /vehicles/:vehicleId/media, /vehicles/:vehicleId/media/:mediaId, /vehicles/:vehicleId/media/upload
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const { pageOrReply, queryPage, pageOfArray } = require('../lib/pagination');
const fs = require('fs');
const { MEDIA_BASE_URL } = require('../config');
const { pool } = require('../db');
const { serverError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimits');
const { removeUpload, storedMediaPath, upload, verifyUploadedImage } = require('../middleware/upload');
const { requireVerified } = require('../middleware/verified');
const { vehicleRole } = require('../services/vehicleAccess');

const router = express.Router();

// Upload user media
router.post('/media/upload', auth, requireVerified('upload'), uploadLimiter, (req, res, next) => { req.mediaArt = 'user'; next(); }, upload.single('file'), verifyUploadedImage, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'missing_file' });
  }

  const mediaType = String(req.body?.mediaType || 'image').trim();
  const url = `${MEDIA_BASE_URL}/${req.file.filename}`;
  const mimeType = req.file.mimetype;
  const bytes = req.file.size;

  try {
    const r = await pool.query(
      `INSERT INTO user_media (user_id, media_type, url, mime_type, bytes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, media_type, url, mime_type, bytes, created_at`,
      [req.user.sub, mediaType, url, mimeType, bytes]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    // Datei löschen falls DB-Insert fehlschlägt
    removeUpload(req.file);
    serverError(res, e);
  }
});

// List user media
router.get('/media', auth, async (req, res) => {
  // Seitenweise (#160)
  const p = pageOrReply(req, res);
  if (!p) return;
  try {
    const page = await queryPage(pool, {
      sql: `SELECT id, user_id, media_type, url, mime_type, bytes, created_at
       FROM user_media
       WHERE user_id = $1
       ORDER BY created_at DESC, id`,
      countSql: 'SELECT COUNT(*)::int AS total FROM user_media WHERE user_id = $1',
      params: [req.user.sub]
    }, p);
    res.json(page);
  } catch (e) {
    serverError(res, e);
  }
});

// Get single media
router.get('/media/:mediaId', auth, async (req, res) => {
  const mediaId = String(req.params.mediaId || '').trim();
  if (!mediaId) return res.status(400).json({ error: 'missing_mediaId' });

  try {
    const r = await pool.query(
      `SELECT id, user_id, media_type, url, mime_type, bytes, created_at
       FROM user_media
       WHERE id = $1 AND user_id = $2`,
      [mediaId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'media_not_found' });
    }

    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Delete media
router.delete('/media/:mediaId', auth, async (req, res) => {
  const mediaId = String(req.params.mediaId || '').trim();
  if (!mediaId) return res.status(400).json({ error: 'missing_mediaId' });

  try {
    const r = await pool.query(
      `SELECT url FROM user_media WHERE id = $1 AND user_id = $2`,
      [mediaId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'media_not_found' });
    }

    const url = r.rows[0].url;

    // Aus DB löschen
    await pool.query(
      'DELETE FROM user_media WHERE id = $1 AND user_id = $2',
      [mediaId, req.user.sub]
    );

    // Datei löschen (fehlt sie schon, ist das kein Fehler)
    const filePath = storedMediaPath(url);
    if (filePath) fs.promises.unlink(filePath).catch(() => {});

    return res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

// ============================================
// Media Upload Endpoints (Vehicle Media)
// ============================================

// Upload vehicle media
router.post('/vehicles/:vehicleId/media/upload', auth, requireVerified('upload'), uploadLimiter, (req, res, next) => { req.mediaArt = 'vehicle'; next(); }, upload.single('file'), verifyUploadedImage, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  if (!req.file) {
    return res.status(400).json({ error: 'missing_file' });
  }

  try {
    // Bilder des Fahrzeugs ändert nur der Besitzer (#53)
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (role !== 'owner') {
      removeUpload(req.file);
      return role ? res.status(403).json({ error: 'owner_only' }) : res.status(404).json({ error: 'vehicle_not_found' });
    }

    const mediaType = String(req.body?.mediaType || 'image').trim();
    const url = `${MEDIA_BASE_URL}/${req.file.filename}`;
    const mimeType = req.file.mimetype;
    const bytes = req.file.size;

    const r = await pool.query(
      `INSERT INTO vehicle_media (vehicle_id, user_id, media_type, url, mime_type, bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, vehicle_id, user_id, media_type, url, mime_type, bytes, created_at`,
      [vehicleId, req.user.sub, mediaType, url, mimeType, bytes]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    // Datei löschen falls DB-Insert fehlschlägt
    removeUpload(req.file);
    serverError(res, e);
  }
});

// List vehicle media
router.get('/vehicles/:vehicleId/media', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });
  // Seitenweise (#160)
  const p = pageOrReply(req, res);
  if (!p) return;

  try {
    // Sichtbar für Besitzer und Mitglieder (#53)
    if (!(await vehicleRole(pool, req.user.sub, vehicleId))) {
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    const page = await queryPage(pool, {
      sql: `SELECT id, vehicle_id, user_id, media_type, url, mime_type, bytes, created_at
       FROM vehicle_media
       WHERE vehicle_id = $1
       ORDER BY created_at DESC, id`,
      countSql: 'SELECT COUNT(*)::int AS total FROM vehicle_media WHERE vehicle_id = $1',
      params: [vehicleId]
    }, p);
    res.json(page);
  } catch (e) {
    serverError(res, e);
  }
});

// Delete vehicle media
router.delete('/vehicles/:vehicleId/media/:mediaId', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  const mediaId = String(req.params.mediaId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });
  if (!mediaId) return res.status(400).json({ error: 'missing_mediaId' });

  try {
    const r = await pool.query(
      `SELECT url FROM vehicle_media
       WHERE id = $1 AND vehicle_id = $2 AND user_id = $3`,
      [mediaId, vehicleId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'media_not_found' });
    }

    const url = r.rows[0].url;

    // Aus DB löschen
    await pool.query(
      'DELETE FROM vehicle_media WHERE id = $1 AND vehicle_id = $2 AND user_id = $3',
      [mediaId, vehicleId, req.user.sub]
    );

    // Datei löschen (fehlt sie schon, ist das kein Fehler)
    const filePath = storedMediaPath(url);
    if (filePath) fs.promises.unlink(filePath).catch(() => {});

    return res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
