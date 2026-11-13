// Routen: /auth/session/refresh, /auth/sessions, /auth/sessions/:sessionId
// Gerätesitzungen der Apps (#117): Refresh-Token tauschen, eigene Geräte auflisten und einzeln abmelden.
const express = require('express');
const { pool } = require('../db');
const { UUID_RE, serverError } = require('../lib/http');
const { pageOrReply, pageOfArray } = require('../lib/pagination');
const { auth } = require('../middleware/auth');
const { limiter } = require('../middleware/rateLimits');
const deviceSessions = require('../services/deviceSessions');

const router = express.Router();

// Ohne Anmeldung, zählt je IP: eine App tauscht höchstens alle 30 Minuten
const refreshLimiter = limiter(15 * 60 * 1000, 60, 60);

// Refresh-Token gegen neues Zugriffs- und Refresh-Token tauschen (Rotation)
router.post('/auth/session/refresh', refreshLimiter, async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ error: 'missing_refresh_token' });
  try {
    const r = await deviceSessions.refresh(pool, refreshToken, { appVersion: req.body?.appVersion });
    if (r.error) return res.status(401).json({ error: r.error });
    res.json(r);
  } catch (e) {
    serverError(res, e);
  }
});

// Eigene, aktive Gerätesitzungen (seitenweise wie alle Listen, #160); current = diese Sitzung
router.get('/auth/sessions', auth, async (req, res) => {
  const p = pageOrReply(req, res);
  if (!p) return;
  try {
    const liste = (await deviceSessions.listSessions(pool, req.user.sub))
      .map((s) => ({ ...s, current: s.id === req.user.sid }));
    res.json(pageOfArray(liste, p));
  } catch (e) {
    serverError(res, e);
  }
});

// Ein Gerät abmelden; "current" = die Sitzung dieses Tokens (Abmelden in der App)
router.delete('/auth/sessions/:sessionId', auth, async (req, res) => {
  const id = req.params.sessionId === 'current' ? req.user.sid : String(req.params.sessionId);
  if (!id) return res.status(400).json({ error: 'no_device_session' });
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'session_not_found' });
  try {
    if (!(await deviceSessions.revokeSession(pool, req.user.sub, id))) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
