// Routen: /auth/login, /auth/login/mfa, /auth/mfa/disable, /auth/mfa/enable, /auth/mfa/setup, /auth/password, /auth/refresh, /auth/register, /auth/tokens, /auth/tokens/revoke
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { isBetaPhase } = require('../config');
const { pool } = require('../db');
const { LOGIN_IP_MAX_FAILURES, LOGIN_MAX_FAILURES, MFA_MAX_FAILURES, clearFailures, isLockedOut, recordFailure, tooManyAttempts } = require('../lib/attempts');
const { serverError } = require('../lib/http');
const { MAX_SESSION_DAYS, auth, isAdmin, recordLogin, signToken } = require('../middleware/auth');
const { MFA_TOKEN_SECRET, base32Encode, consumeTotp, readMfaSecret, storeMfaSecret } = require('../services/mfa');
const emailVerification = require('../services/emailVerification');

const router = express.Router();

// Anmeldung verlängern (#56): gültiges Token gegen ein neues mit wieder 7 Tagen Laufzeit tauschen.
// Das Frontend ruft das bei aktiver Nutzung höchstens einmal am Tag auf. Widerrufene Tokens kommen hier gar
// nicht an (auth), und spätestens MAX_SESSION_DAYS nach dem letzten Login ist eine neue Anmeldung nötig.
router.post('/auth/refresh', auth, async (req, res) => {
  const authTime = Number(req.user.auth_time || req.user.iat || 0);
  if (!authTime || Date.now() / 1000 - authTime > MAX_SESSION_DAYS * 86400) {
    return res.status(401).json({ error: 'reauth_required' });
  }
  try {
    const r = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(401).json({ error: 'invalid_token' });
    res.json({ token: signToken(r.rows[0], authTime) });
  } catch (e) {
    serverError(res, e);
  }
});

// Register
router.post('/auth/register', async (req, res) => {
  // Öffentliche Registrierung abschaltbar (z. B. für eine private Installation)
  if (process.env.REGISTRATION_ENABLED === 'false') return res.status(403).json({ error: 'registration_disabled' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !email.includes('@')) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    // E-Mail-Bestätigung (#135): ohne Mailserver bzw. mit EMAIL_VERIFICATION=false gilt das Konto sofort als bestätigt
    const bestaetigen = await emailVerification.required(pool);
    const r = await pool.query(
      `INSERT INTO users (email, password_hash, beta_tester, email_verified_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN NULL ELSE now() END)
       RETURNING id, email, username, mfa_enabled, profile_image_url, beta_tester, created_at, updated_at,
                 (email_verified_at IS NOT NULL) AS email_verified, pending_email`,
      [email, passwordHash, isBetaPhase(), bestaetigen]
    );
    const user = r.rows[0];
    await recordLogin(user.id);
    if (bestaetigen) {
      // Ein Fehler beim Versand verhindert die Registrierung nicht; die Mail lässt sich erneut anfordern
      try {
        await emailVerification.sendVerification(pool, user.id, user.email);
      } catch (e) {
        console.error('[register] Bestätigungsmail fehlgeschlagen:', e.code || e.message);
      }
    }
    res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'email_already_exists' });
    serverError(res, e);
  }
});

// E-Mail-Adresse bestätigen (#135): Token aus der Mail. Ohne Anmeldung, das Token selbst ist der Nachweis.
router.post('/auth/verify-email', async (req, res) => {
  try {
    const r = await emailVerification.verify(pool, req.body?.token);
    if (r.error === 'email_already_exists') return res.status(409).json({ error: r.error });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ verified: true, email: r.email });
  } catch (e) {
    serverError(res, e);
  }
});

// Bestätigungsmail erneut senden (an die ausstehende neue Adresse, sonst an die Konto-Adresse)
router.post('/auth/resend-verification', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT email, pending_email, email_verified_at FROM users WHERE id = $1', [req.user.sub]);
    const u = r.rows[0];
    if (!u) return res.status(401).json({ error: 'account_not_found' });
    if (u.email_verified_at && !u.pending_email) return res.status(409).json({ error: 'already_verified' });
    const gesperrt = await emailVerification.resendBlocked(pool, req.user.sub);
    if (gesperrt) {
      return res.status(429).json({
        error: gesperrt === 'too_soon' ? 'resend_too_soon' : 'too_many_attempts',
        retry_after_seconds: gesperrt === 'too_soon' ? emailVerification.RESEND_SECONDS : 24 * 3600
      });
    }
    const an = u.pending_email || u.email;
    await emailVerification.sendVerification(pool, req.user.sub, an, { change: Boolean(u.pending_email) });
    res.json({ sent: true, email: an });
  } catch (e) {
    if (e.code === 'mail_not_configured') return res.status(503).json({ error: 'mail_not_configured' });
    if (e.code === 'EAUTH' || e.responseCode || e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT') {
      return res.status(502).json({ error: 'smtp_failed' });
    }
    serverError(res, e);
  }
});

// Login
router.post('/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

  try {
    const r = await pool.query(
      `SELECT id, email, password_hash, username, mfa_enabled, mfa_secret, profile_image_url, created_at, updated_at,
              (email_verified_at IS NOT NULL) AS email_verified, pending_email
       FROM users WHERE email = $1`,
      [email]
    );
    // Fehlversuche je IP + E-Mail und je IP (siehe lib/attempts.js). Die IP kommt bei der Web-App über
    // X-Forwarded-For vom PHP-Frontend, bei den Apps von nginx; die API vertraut dem nur von lokalen Adressen.
    const ip = String(req.ip || '');
    const loginKey = `login:${ip}:${email}`;
    const ipKey = `login-ip:${ip}`;
    if (isLockedOut(loginKey, LOGIN_MAX_FAILURES) || isLockedOut(ipKey, LOGIN_IP_MAX_FAILURES)) return tooManyAttempts(res);
    const fehlversuch = () => {
      recordFailure(loginKey);
      recordFailure(ipKey);
      return res.status(401).json({ error: 'invalid_credentials' });
    };

    if (r.rowCount === 0) return fehlversuch();

    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return fehlversuch();
    // Erfolg hebt nur die Sperre dieser IP für dieses Konto auf, nicht den Zähler der IP über alle Konten
    clearFailures(loginKey);

    // 2FA: erst nach korrektem Passwort nach dem Code fragen
    if (user.mfa_enabled) {
      // Ohne Code: 401 mfa_required mit mfaToken. Das Token erlaubt nur den zweiten Schritt (POST /auth/login/mfa)
      // mit gültigem TOTP-Code und hängt nicht von der Eingabe ab – es wird deshalb immer erzeugt.
      const mfaToken = jwt.sign({ sub: user.id }, MFA_TOKEN_SECRET, { expiresIn: '5m' });
      const code = typeof req.body?.code === 'string' || typeof req.body?.code === 'number' ? String(req.body.code).trim() : '';
      if (!code) return res.status(401).json({ error: 'mfa_required', mfaToken });
      const mfaKey = `mfa:${user.id}`;
      if (isLockedOut(mfaKey, MFA_MAX_FAILURES)) return tooManyAttempts(res);
      if (!(await consumeTotp(pool, user.id, readMfaSecret(user.mfa_secret), code))) {
        recordFailure(mfaKey);
        return res.status(401).json({ error: 'invalid_mfa_code' });
      }
      clearFailures(mfaKey);
    }

    delete user.password_hash;
    delete user.mfa_secret;
    await recordLogin(user.id);
    res.json({ token: signToken(user), user });
  } catch (e) {
    serverError(res, e);
  }
});

// 2FA-Login, Schritt 2: mfaToken aus der mfa_required-Antwort + Code aus der Authenticator-App
router.post('/auth/login/mfa', async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(String(req.body?.mfaToken || ''), MFA_TOKEN_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'invalid_mfa_token' });
  }
  const mfaKey = `mfa:${payload.sub}`;
  if (isLockedOut(mfaKey, MFA_MAX_FAILURES)) return tooManyAttempts(res);
  try {
    const r = await pool.query(
      `SELECT id, email, username, mfa_enabled, mfa_secret, profile_image_url, created_at, updated_at,
              (email_verified_at IS NOT NULL) AS email_verified, pending_email
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (r.rowCount === 0 || !r.rows[0].mfa_enabled) return res.status(401).json({ error: 'invalid_mfa_token' });
    const user = r.rows[0];
    if (!(await consumeTotp(pool, user.id, readMfaSecret(user.mfa_secret), req.body?.code))) {
      recordFailure(mfaKey);
      return res.status(401).json({ error: 'invalid_mfa_code' });
    }
    clearFailures(mfaKey);
    delete user.mfa_secret;
    await recordLogin(user.id);
    res.json({ token: signToken(user), user });
  } catch (e) {
    serverError(res, e);
  }
});

// Change own password (current password required). Revokes all existing tokens and returns a new one.
router.post('/auth/password', auth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing_password' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'password_too_short' });

  try {
    const r = await pool.query('SELECT id, email, password_hash FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    const pwKey = `password:${req.user.sub}`;
    if (isLockedOut(pwKey, LOGIN_MAX_FAILURES)) return tooManyAttempts(res);
    const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
    if (!ok) {
      recordFailure(pwKey);
      return res.status(401).json({ error: 'invalid_current_password' });
    }
    clearFailures(pwKey);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, req.user.sub]);
    await pool.query(
      `INSERT INTO user_token_revocations (user_id, revoked_after, reason)
       VALUES ($1, now(), 'password_changed')
       ON CONFLICT (user_id) DO UPDATE SET revoked_after = now(), reason = 'password_changed'`,
      [req.user.sub]
    );
    // JWT-iat hat Sekundengenauigkeit: kurz warten, damit das neue Token nach revoked_after liegt
    await new Promise((resolve) => setTimeout(resolve, 1000));
    res.json({ token: signToken(r.rows[0]) });
  } catch (e) {
    serverError(res, e);
  }
});

// 2FA einrichten: neues Secret erzeugen (noch nicht aktiv, erst nach /mfa/enable)
router.post('/auth/mfa/setup', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT email, mfa_enabled FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    if (r.rows[0].mfa_enabled) return res.status(409).json({ error: 'mfa_already_enabled' });

    const secret = base32Encode(randomBytes(20));
    await pool.query('UPDATE users SET mfa_secret = $1, updated_at = now() WHERE id = $2', [storeMfaSecret(secret), req.user.sub]);
    const label = encodeURIComponent(`Fuelstat:${r.rows[0].email}`);
    res.json({
      secret,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Fuelstat&algorithm=SHA1&digits=6&period=30`
    });
  } catch (e) {
    serverError(res, e);
  }
});

// 2FA aktivieren: Code aus der Authenticator-App bestätigen
router.post('/auth/mfa/enable', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    if (r.rows[0].mfa_enabled) return res.status(409).json({ error: 'mfa_already_enabled' });
    if (!r.rows[0].mfa_secret) return res.status(400).json({ error: 'mfa_not_set_up' });
    const mfaKey = `mfa:${req.user.sub}`;
    if (isLockedOut(mfaKey, MFA_MAX_FAILURES)) return tooManyAttempts(res);
    if (!(await consumeTotp(pool, req.user.sub, readMfaSecret(r.rows[0].mfa_secret), req.body?.code))) {
      recordFailure(mfaKey);
      return res.status(400).json({ error: 'invalid_mfa_code' });
    }
    clearFailures(mfaKey);

    await pool.query('UPDATE users SET mfa_enabled = true, updated_at = now() WHERE id = $1', [req.user.sub]);
    res.json({ mfa_enabled: true });
  } catch (e) {
    serverError(res, e);
  }
});

// 2FA deaktivieren: Passwort und aktueller Code erforderlich
router.post('/auth/mfa/disable', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT password_hash, mfa_secret, mfa_enabled FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    if (!r.rows[0].mfa_enabled) return res.status(400).json({ error: 'mfa_not_enabled' });
    const mfaKey = `mfa:${req.user.sub}`;
    if (isLockedOut(mfaKey, MFA_MAX_FAILURES)) return tooManyAttempts(res);
    const ok = await bcrypt.compare(String(req.body?.password || ''), r.rows[0].password_hash);
    if (!ok || !(await consumeTotp(pool, req.user.sub, readMfaSecret(r.rows[0].mfa_secret), req.body?.code))) {
      recordFailure(mfaKey);
      return res.status(ok ? 400 : 401).json({ error: ok ? 'invalid_mfa_code' : 'invalid_current_password' });
    }
    clearFailures(mfaKey);

    await pool.query('UPDATE users SET mfa_enabled = false, mfa_secret = NULL, updated_at = now() WHERE id = $1', [req.user.sub]);
    res.json({ mfa_enabled: false });
  } catch (e) {
    serverError(res, e);
  }
});

// List revoked tokens (Admins: alle bzw. ?userId=, sonst nur die eigenen)
router.get('/auth/tokens', auth, async (req, res) => {
  const userId = !isAdmin(req)
    ? String(req.user.sub)
    : req.query.userId !== undefined
      ? String(req.query.userId).trim()
      : null;

  try {
    let r;
    if (userId) {
      r = await pool.query(
        `SELECT jti, user_id, revoked_at, reason
         FROM revoked_tokens
         WHERE user_id = $1
         ORDER BY revoked_at DESC`,
        [userId]
      );
    } else {
      r = await pool.query(
        `SELECT jti, user_id, revoked_at, reason
         FROM revoked_tokens
         ORDER BY revoked_at DESC`
      );
    }

    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

// Revoke a token (eigene Tokens oder Admin)
router.post('/auth/tokens/revoke', auth, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const reason =
    req.body?.reason !== undefined
      ? String(req.body.reason).trim()
      : null;

  if (!token) {
    return res.status(400).json({ error: 'missing_token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload.jti) {
      return res.status(400).json({
        error: 'cannot_revoke_legacy_token',
        message:
          'Dieses Token besitzt keine jti und kann daher serverseitig nicht widerrufen werden. Bitte den Benutzer neu einloggen lassen.'
      });
    }

    const jti = String(payload.jti);
    const userId = String(payload.sub);

    if (userId !== String(req.user.sub) && !isAdmin(req)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const r = await pool.query(
      `INSERT INTO revoked_tokens (jti, user_id, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (jti) DO UPDATE
         SET reason = COALESCE(EXCLUDED.reason, revoked_tokens.reason)`,
      [jti, userId, reason]
    );

    res.status(201).json({
      jti,
      userId,
      reason,
      message: 'Token wurde widerrufen und wird ab sofort abgelehnt.'
    });
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'invalid_token', detail: e.message });
    }
    serverError(res, e);
  }
});

module.exports = router;
