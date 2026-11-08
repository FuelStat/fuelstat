// Routen: /db-ping, /health, /whoami
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const plans = require('../services/plans');
const { API_VERSION, isBetaPhase } = require('../config');
const { pool } = require('../db');
const { serverError } = require('../lib/http');
const { auth, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Healthcheck
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'fuelstat-api-v2',
    version: API_VERSION,
    registration_enabled: process.env.REGISTRATION_ENABLED !== 'false',
    beta_phase: isBetaPhase()
  });
});

// Whoami - zeigt aktuell angemeldeten User
router.get('/whoami', auth, async (req, res) => {
  try {
    // Zusätzlich User-Daten aus DB holen für vollständige Info
    const r = await pool.query(
      `SELECT id, email, username, mfa_enabled, profile_image_url, beta_tester, plan, plan_until, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    res.json({
      id: r.rows[0].id,
      email: r.rows[0].email,
      username: r.rows[0].username,
      mfa_enabled: r.rows[0].mfa_enabled,
      profile_image_url: r.rows[0].profile_image_url,
      beta_tester: r.rows[0].beta_tester,
      created_at: r.rows[0].created_at,
      updated_at: r.rows[0].updated_at,
      is_admin: isAdmin(req),
      // Tarif und Rechte (plan, planUntil, effectivePlan, limitsEnabled, features)
      ...plans.planInfo(r.rows[0]),
      token: {
        jti: req.user.jti || null,
        iat: req.user.iat ? new Date(req.user.iat * 1000).toISOString() : null,
        exp: req.user.exp ? new Date(req.user.exp * 1000).toISOString() : null
      }
    });
  } catch (e) {
    serverError(res, e);
  }
});

// DB Ping
router.get('/db-ping', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, result: r.rows[0] });
  } catch (e) {
    console.error('[db-ping]', e);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
