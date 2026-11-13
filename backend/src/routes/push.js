// Routen: /push/config, /push/devices, /push/devices/:deviceId, /push/test, /notifications/preferences
// Push-Benachrichtigungen (#136): Geräte (Web-Push-Abos) anmelden, auflisten, abmelden, Testnachricht, und je Anlass
// die Kanäle E-Mail und Push wählen.
const express = require('express');
const { pool } = require('../db');
const { UUID_RE, serverError } = require('../lib/http');
const { pageOrReply, queryPage } = require('../lib/pagination');
const { isLockedOut, recordFailure, tooManyAttempts } = require('../lib/attempts');
const { auth } = require('../middleware/auth');
const { requireVerified } = require('../middleware/verified');
const push = require('../services/push');
const { loadDefaultSmtp } = require('../services/mail');
const { OCCASIONS, MAIL_FLAG, PUSH_FLAG } = require('../services/notifier');

const router = express.Router();

// Ist Push auf diesem Server eingerichtet? Öffentlicher VAPID-Schlüssel für pushManager.subscribe()
router.get('/push/config', auth, (req, res) => {
  const cfg = push.config();
  res.json({ enabled: Boolean(cfg), vapidPublicKey: cfg ? cfg.publicKey : null });
});

const DEVICE_COLUMNS = 'id, kind, name, created_at, last_used_at, last_error';

// Eigene Geräte (ohne Adresse und Schlüssel), seitenweise
router.get('/push/devices', auth, async (req, res) => {
  const p = pageOrReply(req, res);
  if (!p) return;
  try {
    res.json(await queryPage(pool, {
      sql: `SELECT ${DEVICE_COLUMNS} FROM push_devices WHERE user_id = $1 ORDER BY last_used_at DESC, id`,
      countSql: 'SELECT COUNT(*)::int AS total FROM push_devices WHERE user_id = $1',
      params: [req.user.sub]
    }, p));
  } catch (e) {
    serverError(res, e);
  }
});

// Gerät anmelden bzw. aktualisieren (dieselbe Adresse = dasselbe Gerät, auch nach einem Kontowechsel im Browser)
router.post('/push/devices', auth, requireVerified('push'), async (req, res) => {
  if (!push.config()) return res.status(400).json({ error: 'push_not_configured' });
  const d = push.parseDevice(req.body || {});
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const n = await pool.query('SELECT COUNT(*)::int AS n FROM push_devices WHERE user_id = $1 AND endpoint <> $2', [req.user.sub, d.device.endpoint]);
    if (n.rows[0].n >= push.MAX_DEVICES) return res.status(409).json({ error: 'too_many_devices', limit: push.MAX_DEVICES });
    const r = await pool.query(
      `INSERT INTO push_devices (user_id, kind, endpoint, p256dh, auth, name) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         name = COALESCE(EXCLUDED.name, push_devices.name), last_used_at = now(), last_error = NULL
       RETURNING ${DEVICE_COLUMNS}`,
      [req.user.sub, d.device.kind, d.device.endpoint, d.device.p256dh, d.device.auth, d.device.name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Gerät abmelden: per id oder (aus dem Browser, der seine id nicht kennt) per Adresse im Body von DELETE /push/devices
router.delete('/push/devices/:deviceId', auth, async (req, res) => {
  const id = String(req.params.deviceId);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'device_not_found' });
  try {
    const r = await pool.query('DELETE FROM push_devices WHERE id = $1 AND user_id = $2', [id, req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'device_not_found' });
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
});

router.delete('/push/devices', auth, async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ error: 'missing_endpoint' });
  try {
    const r = await pool.query('DELETE FROM push_devices WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'device_not_found' });
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
});

// Testnachricht an alle eigenen Geräte (höchstens 5 in 15 Minuten)
router.post('/push/test', auth, requireVerified('push'), async (req, res) => {
  if (!push.config()) return res.status(400).json({ error: 'push_not_configured' });
  const key = `push-test:${req.user.sub}`;
  if (isLockedOut(key, 5)) return tooManyAttempts(res);
  recordFailure(key);
  try {
    if (!(await push.hasDevices(pool, req.user.sub))) return res.status(409).json({ error: 'no_push_devices' });
    const r = await push.sendToUser(pool, req.user.sub, {
      title: 'Fuelstat', body: 'Push-Benachrichtigungen funktionieren auf diesem Gerät.', url: 'pages/benachrichtigungen.php', tag: 'test',
      ttl: 60 * 60, urgency: 'high'
    });
    res.json(r);
  } catch (e) {
    serverError(res, e);
  }
});

// --- Kanäle je Anlass ---
async function preferences(userId) {
  const r = await pool.query('SELECT * FROM user_mail_settings WHERE user_id = $1', [userId]);
  const row = r.rows[0] || {};
  const devices = await pool.query(`SELECT COUNT(*)::int AS n FROM push_devices WHERE user_id = $1 AND kind = 'webpush'`, [userId]);
  return {
    occasions: Object.fromEntries(OCCASIONS.map((o) => [o, { email: Boolean(row[MAIL_FLAG[o]]), push: Boolean(row[PUSH_FLAG[o]]) }])),
    reminder_days: row.reminder_days ?? 30,
    email_available: Boolean(row.smtp_host) || Boolean(await loadDefaultSmtp(pool)),
    push_available: Boolean(push.config()),
    push_devices: devices.rows[0].n
  };
}

router.get('/notifications/preferences', auth, async (req, res) => {
  try {
    res.json(await preferences(req.user.sub));
  } catch (e) {
    serverError(res, e);
  }
});

// Teilweise ändern: { occasions: { reminders: { email: true, push: false }, … }, reminder_days }; fehlende Werte bleiben
router.put('/notifications/preferences', auth, requireVerified('mail'), async (req, res) => {
  const occ = req.body?.occasions ?? {};
  if (typeof occ !== 'object' || Array.isArray(occ)) return res.status(400).json({ error: 'invalid_occasions' });
  const set = {};
  // Vorlauf für Termine (gilt für E-Mail und Push)
  if (req.body?.reminder_days !== undefined) {
    const t = Number(req.body.reminder_days);
    if (!Number.isInteger(t) || t < 1 || t > 180) return res.status(400).json({ error: 'invalid_reminderDays' });
    set.reminder_days = t;
  }
  for (const [o, v] of Object.entries(occ)) {
    if (!OCCASIONS.includes(o) || !v || typeof v !== 'object') return res.status(400).json({ error: 'invalid_occasions', allowed: OCCASIONS });
    for (const [kanal, spalte] of [['email', MAIL_FLAG[o]], ['push', PUSH_FLAG[o]]]) {
      if (v[kanal] === undefined) continue;
      if (typeof v[kanal] !== 'boolean') return res.status(400).json({ error: 'invalid_occasions' });
      set[spalte] = v[kanal];
    }
  }
  try {
    const vorher = await preferences(req.user.sub);
    if (Object.entries(set).some(([s, v]) => v && Object.values(MAIL_FLAG).includes(s)) && !vorher.email_available) {
      return res.status(400).json({ error: 'mail_not_configured' });
    }
    if (Object.entries(set).some(([s, v]) => v && Object.values(PUSH_FLAG).includes(s)) && !vorher.push_available) {
      return res.status(400).json({ error: 'push_not_configured' });
    }
    const spalten = Object.keys(set);
    if (spalten.length) {
      // Spaltennamen stammen aus MAIL_FLAG/PUSH_FLAG, nicht aus der Anfrage
      await pool.query(
        `INSERT INTO user_mail_settings (user_id, ${spalten.join(', ')}) VALUES ($1, ${spalten.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (user_id) DO UPDATE SET ${spalten.map((s) => `${s} = EXCLUDED.${s}`).join(', ')}, updated_at = now()`,
        [req.user.sub, ...spalten.map((s) => set[s])]
      );
    }
    res.json(await preferences(req.user.sub));
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
