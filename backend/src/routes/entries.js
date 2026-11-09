// Routen: /entries, /entries/:entryId, /vehicles/:vehicleId/entries
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const categories = require('../services/categories');
const { pool } = require('../db');
const { optionalNumber, serverError } = require('../lib/http');
const { loadPlanUser } = require('../lib/planUser');
const { auth } = require('../middleware/auth');
const { checkOdometer } = require('../services/odometer');
const { checkUnverifiedLimit } = require('../middleware/verified');

const router = express.Router();

// Create non-fuel expense entry
router.post('/entries', auth, async (req, res) => {
  // Ohne bestätigte E-Mail-Adresse nur ein Eintrag (#135)
  try {
    if (await checkUnverifiedLimit(res, req.user.sub, 'entry')) return;
  } catch (e) {
    return serverError(res, e);
  }
  const vehicleId = String(req.body?.vehicleId || '').trim();
  const category = String(req.body?.category || '').trim();

  const amountEur = Number(req.body?.amountEur);
  // null bzw. leer = kein Tachostand (nicht 0 km)
  const odometerKm = optionalNumber(req.body?.odometerKm) ?? null;
  const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;

  const vendor = req.body?.vendor ? String(req.body.vendor).trim() : null;
  const description = req.body?.description ? String(req.body.description).trim() : null;

  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });
  if (!category) return res.status(400).json({ error: 'missing_category' });
  if (!Number.isFinite(amountEur) || amountEur < 0) {
    return res.status(400).json({ error: 'invalid_amountEur' });
  }
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
    return res.status(400).json({ error: 'invalid_odometerKm' });
  }
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    return res.status(400).json({ error: 'invalid_occurredAt' });
  }

  try {
    // Prüfen, ob das Fahrzeug zum User gehört
    const v = await pool.query(
      'SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });

    // Kategorie bekannt und im Tarif enthalten? (#95)
    const fehler = await categories.checkUsable(pool, await loadPlanUser(pool, req.user.sub), category);
    if (fehler) return res.status(fehler.status).json(fehler.body);

    const r = await pool.query(
      `INSERT INTO expenses (
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::numeric,
         $5,
         COALESCE($6, now()),
         $7,
         $8
       )
       RETURNING
         id,
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description,
         created_at`,
      [req.user.sub, vehicleId, category, amountEur, odometerKm, occurredAt, vendor, description]
    );

    res.status(201).json({ ...r.rows[0], warnings: await checkOdometer(pool, req.user.sub, vehicleId, r.rows[0]) });
  } catch (e) {
    serverError(res, e);
  }
});

// List expense entries by vehicle
const ENTRY_COLUMNS = `
  id,
  user_id,
  vehicle_id,
  category,
  amount_eur,
  odometer_km,
  occurred_at,
  vendor,
  description,
  created_at`;

// Get single entry (expense)
router.get('/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  try {
    const r = await pool.query(
      `SELECT ${ENTRY_COLUMNS} FROM expenses WHERE id = $1 AND user_id = $2`,
      [entryId, req.user.sub]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'entry_not_found' });
    res.json({ ...r.rows[0], warnings: await checkOdometer(pool, req.user.sub, r.rows[0].vehicle_id, r.rows[0]) });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

// Patch single entry (expense)
router.patch('/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  const body = req.body || {};
  const fields = [];
  const values = [];
  let idx = 1;

  if (body.category !== undefined) {
    const category = String(body.category).trim();
    if (!category) return res.status(400).json({ error: 'missing_category' });
    fields.push(`category = $${idx++}`);
    values.push(category);
  }
  if (body.amountEur !== undefined) {
    const amountEur = Number(body.amountEur);
    if (!Number.isFinite(amountEur) || amountEur < 0) return res.status(400).json({ error: 'invalid_amountEur' });
    fields.push(`amount_eur = $${idx++}`);
    values.push(amountEur);
  }
  if (body.odometerKm !== undefined) {
    const odometerKm = body.odometerKm === null || body.odometerKm === '' ? null : Number(body.odometerKm);
    if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
      return res.status(400).json({ error: 'invalid_odometerKm' });
    }
    fields.push(`odometer_km = $${idx++}`);
    values.push(odometerKm);
  }
  if (body.occurredAt !== undefined) {
    const occurredAt = new Date(body.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return res.status(400).json({ error: 'invalid_occurredAt' });
    fields.push(`occurred_at = $${idx++}`);
    values.push(occurredAt);
  }
  if (body.vendor !== undefined) {
    fields.push(`vendor = $${idx++}`);
    values.push(body.vendor === null ? null : String(body.vendor).trim() || null);
  }
  if (body.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(body.description === null ? null : String(body.description).trim() || null);
  }

  if (fields.length === 0) return res.status(400).json({ error: 'nothing_to_update' });

  try {
    // Neue Kategorie prüfen; die bisherige bleibt immer erlaubt (auch nach dem Herabstufen oder aus alten Importen)
    if (body.category !== undefined) {
      const alt = await pool.query('SELECT category FROM expenses WHERE id = $1 AND user_id = $2', [entryId, req.user.sub]);
      if (alt.rowCount === 0) return res.status(404).json({ error: 'entry_not_found' });
      const neu = String(body.category).trim();
      if (alt.rows[0].category !== neu) {
        const fehler = await categories.checkUsable(pool, await loadPlanUser(pool, req.user.sub), neu);
        if (fehler) return res.status(fehler.status).json(fehler.body);
      }
    }
    values.push(entryId, req.user.sub);
    const r = await pool.query(
      `UPDATE expenses SET ${fields.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING ${ENTRY_COLUMNS}`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'entry_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

// Delete single entry (expense)
router.delete('/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  try {
    const r = await pool.query(
      'DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id',
      [entryId, req.user.sub]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'entry_not_found' });
    res.status(204).send();
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

router.get('/vehicles/:vehicleId/entries', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const offset = Math.max(0, Math.floor(Number(req.query.offset || 0)) || 0);

  try {
    // Fahrzeug-Besitz prüfen
    const v = await pool.query(
      'SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });

    const r = await pool.query(
      `SELECT
         id,
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description,
         created_at
       FROM expenses
       WHERE user_id = $1 AND vehicle_id = $2
       ORDER BY occurred_at DESC, created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.user.sub, vehicleId, limit, offset]
    );

    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
