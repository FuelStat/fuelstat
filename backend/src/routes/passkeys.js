// Routen: /auth/passkeys, /auth/passkeys/:passkeyId, /auth/passkeys/register/options, /auth/passkeys/register,
// /auth/passkeys/login/options, /auth/passkeys/login
// Passkeys (WebAuthn, #2): anlegen (angemeldet, mit Passwort), auflisten, umbenennen, löschen; anmelden ohne Passwort.
const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { UUID_RE, serverError } = require('../lib/http');
const { pageOrReply, queryPage } = require('../lib/pagination');
const { LOGIN_IP_MAX_FAILURES, LOGIN_MAX_FAILURES, clearFailures, isLockedOut, recordFailure, tooManyAttempts } = require('../lib/attempts');
const { auth, recordLogin, signToken } = require('../middleware/auth');
const deviceSessions = require('../services/deviceSessions');
const passkeys = require('../services/passkeys');

const router = express.Router();

// Ist WebAuthn auf diesem Server eingerichtet (HTTPS-Adresse bekannt)?
function cfgOrReply(res) {
  const cfg = passkeys.config();
  if (!cfg) res.status(400).json({ error: 'passkeys_not_configured' });
  return cfg;
}

// Eigene Passkeys (ohne Schlüssel), seitenweise
router.get('/auth/passkeys', auth, async (req, res) => {
  const p = pageOrReply(req, res);
  if (!p) return;
  try {
    res.json(await queryPage(pool, {
      sql: `SELECT ${passkeys.COLUMNS} FROM user_passkeys WHERE user_id = $1 ORDER BY created_at, id`,
      countSql: 'SELECT COUNT(*)::int AS total FROM user_passkeys WHERE user_id = $1',
      params: [req.user.sub]
    }, p));
  } catch (e) {
    serverError(res, e);
  }
});

// Schritt 1 beim Anlegen: aktuelles Passwort bestätigen, Optionen für navigator.credentials.create().
// Das Passwort ist nötig, weil ein Passkey Passwort und 2FA ersetzt: Ein entwendetes Token allein reicht nicht.
router.post('/auth/passkeys/register/options', auth, async (req, res) => {
  const cfg = cfgOrReply(res);
  if (!cfg) return;
  const pwKey = `password:${req.user.sub}`;
  if (isLockedOut(pwKey, LOGIN_MAX_FAILURES)) return tooManyAttempts(res);
  try {
    const r = await pool.query('SELECT id, email, username, password_hash FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    if (!(await bcrypt.compare(String(req.body?.currentPassword || ''), r.rows[0].password_hash))) {
      recordFailure(pwKey);
      return res.status(401).json({ error: 'invalid_current_password' });
    }
    clearFailures(pwKey);
    const o = await passkeys.registrationOptions(pool, r.rows[0], cfg);
    if (o.error) return res.status(409).json({ error: o.error, limit: passkeys.MAX_PASSKEYS });
    res.json(o);
  } catch (e) {
    serverError(res, e);
  }
});

// Schritt 2 beim Anlegen: Antwort des Browsers prüfen und speichern
router.post('/auth/passkeys/register', auth, async (req, res) => {
  const cfg = cfgOrReply(res);
  if (!cfg) return;
  if (!req.body?.response || typeof req.body.response !== 'object') return res.status(400).json({ error: 'invalid_passkey_response' });
  try {
    const r = await passkeys.register(pool, req.user.sub, req.body, cfg);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.status(201).json(r.passkey);
  } catch (e) {
    serverError(res, e);
  }
});

// Umbenennen
router.patch('/auth/passkeys/:passkeyId', auth, async (req, res) => {
  const id = String(req.params.passkeyId);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'passkey_not_found' });
  const name = passkeys.cleanName(req.body?.name, '');
  if (!name) return res.status(400).json({ error: 'invalid_name' });
  try {
    const r = await pool.query(`UPDATE user_passkeys SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING ${passkeys.COLUMNS}`, [id, req.user.sub, name]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'passkey_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Löschen (der Passkey bleibt im Gerät, funktioniert aber nicht mehr; das Gerät sollte ihn auch entfernen)
router.delete('/auth/passkeys/:passkeyId', auth, async (req, res) => {
  const id = String(req.params.passkeyId);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'passkey_not_found' });
  try {
    const r = await pool.query('DELETE FROM user_passkeys WHERE id = $1 AND user_id = $2', [id, req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'passkey_not_found' });
    res.status(204).end();
  } catch (e) {
    serverError(res, e);
  }
});

// Anmelden, Schritt 1 (öffentlich): Optionen für navigator.credentials.get()
router.post('/auth/passkeys/login/options', async (req, res) => {
  const cfg = cfgOrReply(res);
  if (!cfg) return;
  if (isLockedOut(`login-ip:${String(req.ip || '')}`, LOGIN_IP_MAX_FAILURES)) return tooManyAttempts(res);
  try {
    res.json(await passkeys.authenticationOptions(cfg));
  } catch (e) {
    serverError(res, e);
  }
});

// Anmelden, Schritt 2 (öffentlich): Antwort prüfen, Token wie bei POST /auth/login. Ersetzt Passwort und 2FA.
router.post('/auth/passkeys/login', async (req, res) => {
  const cfg = cfgOrReply(res);
  if (!cfg) return;
  const ipKey = `login-ip:${String(req.ip || '')}`;
  if (isLockedOut(ipKey, LOGIN_IP_MAX_FAILURES)) return tooManyAttempts(res);
  if (!req.body?.response || typeof req.body.response !== 'object') return res.status(400).json({ error: 'invalid_passkey_response' });
  // Apps melden ihr Gerät mit an und bekommen eine Gerätesitzung (#117)
  const geraet = deviceSessions.parseDevice(req.body?.device);
  if (geraet.error) return res.status(400).json({ error: geraet.error });
  try {
    const a = await passkeys.authenticate(pool, req.body, cfg);
    if (a.error) {
      if (a.status === 401) recordFailure(ipKey);
      return res.status(a.status).json({ error: a.error });
    }
    const r = await pool.query(
      `SELECT id, email, username, mfa_enabled, profile_image_url, created_at, updated_at,
              (email_verified_at IS NOT NULL) AS email_verified, pending_email
       FROM users WHERE id = $1`,
      [a.userId]
    );
    if (r.rowCount === 0) return res.status(401).json({ error: 'unknown_passkey' });
    const user = r.rows[0];
    await recordLogin(user.id);
    if (!geraet.device) return res.json({ token: signToken(user), user });
    const s = await deviceSessions.createSession(pool, user, geraet.device);
    res.json({ token: s.token, refreshToken: s.refreshToken, expiresIn: s.expiresIn, session: s.session, user });
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
