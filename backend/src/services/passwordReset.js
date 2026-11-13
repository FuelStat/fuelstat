// Passwort vergessen (#141).
// Ablauf: POST /auth/forgot-password { email } antwortet immer gleich (verrät nicht, ob es das Konto gibt). Gibt es
// das Konto, geht ein Link an die Konto-Adresse (Standard-Mailserver), 1 Stunde gültig und nur einmal verwendbar;
// in der Datenbank liegt nur der SHA-256-Hash. POST /auth/reset-password { token, password } setzt das Passwort,
// widerruft alle Tokens (auf allen Geräten abgemeldet) und bestätigt die Adresse (der Link beweist das Postfach).
// Eine aktive 2FA bleibt aktiv: Anmelden geht danach nur mit Passwort und Code.
const { revokeAllForUser } = require('./deviceSessions');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { sendUserMail, loadDefaultSmtp, withDefaultSmtp } = require('./mail');

const TOKEN_MINUTES = 60;
const MAX_MAILS_PER_HOUR = 3;
const MIN_PASSWORD = 8;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// app: Anfrage kam aus einer App (Header X-Fuelstat-Client, #175). Der Link bleibt https, bekommt aber quelle=app,
// damit die Seite auf iPhone/iPad „In der Fuelstat-App fortsetzen“ anbieten kann.
function resetMail(token, appUrl = process.env.APP_URL, { app = false } = {}) {
  const base = appUrl ? String(appUrl).replace(/\/+$/, '') : null;
  const link = base ? `${base}/pages/passwort_zuruecksetzen.php?token=${encodeURIComponent(token)}${app ? '&quelle=app' : ''}` : null;
  const subject = 'Fuelstat: Passwort zurücksetzen';
  const weg = link
    ? `Neues Passwort festlegen (gültig ${TOKEN_MINUTES} Minuten):\n${link}`
    : `In Fuelstat unter „Passwort vergessen?“ → „Code eingeben“ diesen Code verwenden (gültig ${TOKEN_MINUTES} Minuten):\n${token}`;
  const text = `Hallo,\n\nfür dein Fuelstat-Konto wurde ein neues Passwort angefordert.\n\n${weg}\n\n`
    + 'Wenn du das nicht warst, kannst du diese Mail ignorieren – dein Passwort bleibt unverändert.\n\nDeine Fuelstat-App';
  const html = '<p>Hallo,</p><p>für dein Fuelstat-Konto wurde ein neues Passwort angefordert.</p>'
    + (link
      ? `<p><a href="${esc(link)}">Neues Passwort festlegen</a> (gültig ${TOKEN_MINUTES} Minuten)</p>`
      : `<p>In Fuelstat unter „Passwort vergessen?“ → „Code eingeben“ diesen Code verwenden (gültig ${TOKEN_MINUTES} Minuten):</p><p><code>${esc(token)}</code></p>`)
    + '<p>Wenn du das nicht warst, kannst du diese Mail ignorieren – dein Passwort bleibt unverändert.</p><p>Deine Fuelstat-App</p>';
  return { subject, text, html };
}

/**
 * Link anfordern. Liefert immer dasselbe Ergebnis nach außen; intern 'sent', 'unknown', 'limited' (für Tests/Logs).
 * @throws Error mit code 'mail_not_configured', wenn kein Standard-Mailserver eingerichtet ist
 */
async function requestReset(db, email, { sender = sendUserMail, app = false } = {}) {
  const defaults = await loadDefaultSmtp(db);
  if (!defaults) {
    const e = new Error('mail_not_configured');
    e.code = 'mail_not_configured';
    throw e;
  }
  const adresse = String(email || '').trim().toLowerCase();
  const u = await db.query('SELECT id, email FROM users WHERE email = $1', [adresse]);
  if (u.rowCount === 0) return 'unknown';
  const userId = u.rows[0].id;
  const n = await db.query(
    `SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
    [userId]
  );
  if (n.rows[0].n >= MAX_MAILS_PER_HOUR) return 'limited';
  const token = crypto.randomBytes(32).toString('base64url');
  // Ältere, noch offene Links verfallen
  await db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await db.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [userId, hashToken(token), TOKEN_MINUTES]
  );
  await sender(withDefaultSmtp({ user_id: userId, account_email: u.rows[0].email }, defaults), resetMail(token, undefined, { app }));
  return 'sent';
}

/**
 * Neues Passwort setzen.
 * @returns {{ userId, email } | { error: 'invalid_token' | 'token_expired' | 'password_too_short' }}
 */
async function resetPassword(pool, token, password) {
  const t = String(token || '').trim();
  const pw = String(password || '');
  if (pw.length < MIN_PASSWORD) return { error: 'password_too_short' };
  if (!t || t.length > 200) return { error: 'invalid_token' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1 FOR UPDATE',
      [hashToken(t)]
    );
    const row = r.rows[0];
    if (!row || row.used_at) {
      await client.query('ROLLBACK');
      return { error: 'invalid_token' };
    }
    if (new Date(row.expires_at) <= new Date()) {
      await client.query('ROLLBACK');
      return { error: 'token_expired' };
    }
    const hash = await bcrypt.hash(pw, 12);
    await client.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
    const u = await client.query(
      `UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
        WHERE id = $1 RETURNING email`,
      [row.user_id, hash]
    );
    // Auf allen Geräten abmelden: wer das alte Passwort kannte, soll mit alten Tokens nichts mehr anfangen können
    await revokeAllForUser(client, row.user_id, 'password_reset');
    await client.query('COMMIT');
    return { userId: row.user_id, email: u.rows[0].email };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { TOKEN_MINUTES, MAX_MAILS_PER_HOUR, hashToken, resetMail, requestReset, resetPassword };
