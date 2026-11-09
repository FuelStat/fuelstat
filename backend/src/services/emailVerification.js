// E-Mail-Adresse bestätigen (#135).
// Neue Konten bekommen eine Mail mit einem Link, der 24 Stunden und nur einmal gilt. In der Datenbank liegt nur der
// SHA-256-Hash des Tokens. Bis zur Bestätigung sind die Funktionen begrenzt (middleware/verified.js).
// Eine neue Adresse (PATCH /auth/users/:id mit email) gilt erst nach Bestätigung; bis dahin bleibt die alte.
//
// Abschaltbar mit EMAIL_VERIFICATION=false. Ohne Standard-Mailserver (services/mail.js) lässt sich keine Mail
// verschicken: Dann gelten neue Konten sofort als bestätigt, damit niemand ausgesperrt wird.
const crypto = require('crypto');
const { sendUserMail, loadDefaultSmtp, withDefaultSmtp } = require('./mail');

const TOKEN_HOURS = 24;
const RESEND_SECONDS = 60;
const MAX_MAILS_PER_DAY = 5;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function enabled() {
  return String(process.env.EMAIL_VERIFICATION || '').toLowerCase() !== 'false';
}

/** Muss ein neues Konto seine Adresse bestätigen? Nur wenn eingeschaltet und ein Mailserver da ist. */
async function required(pool) {
  return enabled() && Boolean(await loadDefaultSmtp(pool));
}

function verificationMail(email, token, { change = false, appUrl = process.env.APP_URL } = {}) {
  const base = appUrl ? String(appUrl).replace(/\/+$/, '') : null;
  const link = base ? `${base}/pages/email_bestaetigen.php?token=${encodeURIComponent(token)}` : null;
  const subject = change ? 'Fuelstat: neue E-Mail-Adresse bestätigen' : 'Fuelstat: E-Mail-Adresse bestätigen';
  const anlass = change
    ? `du möchtest die E-Mail-Adresse deines Fuelstat-Kontos auf ${email} ändern.`
    : `willkommen bei Fuelstat! Bitte bestätige noch deine E-Mail-Adresse ${email}.`;
  const weg = link
    ? `Zum Bestätigen diesen Link öffnen (gültig ${TOKEN_HOURS} Stunden):\n${link}`
    : `Zum Bestätigen in Fuelstat unter Profil → „E-Mail bestätigen“ diesen Code eingeben (gültig ${TOKEN_HOURS} Stunden):\n${token}`;
  const text = `Hallo,\n\n${anlass}\n\n${weg}\n\nWenn du das nicht warst, kannst du diese Mail ignorieren.\n\nDeine Fuelstat-App`;
  const html = `<p>Hallo,</p><p>${esc(anlass)}</p>${link
    ? `<p><a href="${esc(link)}">E-Mail-Adresse bestätigen</a> (gültig ${TOKEN_HOURS} Stunden)</p>`
    : `<p>Zum Bestätigen in Fuelstat unter Profil → „E-Mail bestätigen“ diesen Code eingeben (gültig ${TOKEN_HOURS} Stunden):</p><p><code>${esc(token)}</code></p>`
  }<p>Wenn du das nicht warst, kannst du diese Mail ignorieren.</p><p>Deine Fuelstat-App</p>`;
  return { subject, text, html };
}

/**
 * Darf jetzt eine weitere Mail raus? null = ja, sonst Fehlerschlüssel:
 * 'too_soon' (letzte vor weniger als RESEND_SECONDS), 'too_many' (MAX_MAILS_PER_DAY in 24 Stunden erreicht).
 */
async function resendBlocked(pool, userId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS anzahl, MAX(created_at) AS zuletzt
     FROM email_verifications WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
    [userId]
  );
  const { anzahl, zuletzt } = r.rows[0];
  if (zuletzt && Date.now() - new Date(zuletzt).getTime() < RESEND_SECONDS * 1000) return 'too_soon';
  if (anzahl >= MAX_MAILS_PER_DAY) return 'too_many';
  return null;
}

/**
 * Token anlegen und die Bestätigungsmail an `email` schicken (Standard-Mailserver).
 * Ältere, noch nicht benutzte Tokens des Kontos verfallen dabei.
 * @throws Error mit code 'mail_not_configured', wenn kein Standard-Mailserver eingerichtet ist
 */
async function sendVerification(pool, userId, email, { change = false, sender = sendUserMail } = {}) {
  const defaults = await loadDefaultSmtp(pool);
  if (!defaults) {
    const e = new Error('mail_not_configured');
    e.code = 'mail_not_configured';
    throw e;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await pool.query(
    `INSERT INTO email_verifications (user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [userId, email, hashToken(token), TOKEN_HOURS]
  );
  // Empfänger ist immer die zu bestätigende Adresse (withDefaultSmtp setzt to_address = account_email)
  const settings = withDefaultSmtp({ user_id: userId, account_email: email }, defaults);
  await sender(settings, verificationMail(email, token, { change }));
  return token;
}

/**
 * Token einlösen. Bestätigt die Konto-Adresse bzw. übernimmt die neue Adresse.
 * @returns {{ userId, email }} oder { error: 'invalid_token' | 'token_expired' | 'email_already_exists' }
 */
async function verify(pool, token) {
  const t = String(token || '').trim();
  if (!t || t.length > 200) return { error: 'invalid_token' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT v.id, v.user_id, v.email, v.expires_at, v.used_at, u.email AS account_email, u.pending_email
       FROM email_verifications v JOIN users u ON u.id = v.user_id
       WHERE v.token_hash = $1 FOR UPDATE OF v`,
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
    await client.query('UPDATE email_verifications SET used_at = now() WHERE id = $1', [row.id]);
    if (row.pending_email && row.email === row.pending_email) {
      await client.query(
        `UPDATE users SET email = pending_email, pending_email = NULL, email_verified_at = now(), updated_at = now()
         WHERE id = $1`,
        [row.user_id]
      );
    } else if (row.email === row.account_email) {
      await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [row.user_id]);
    } else {
      // Adresse wurde inzwischen erneut geändert: dieses Token passt zu keiner Adresse mehr
      await client.query('ROLLBACK');
      return { error: 'invalid_token' };
    }
    await client.query('COMMIT');
    return { userId: row.user_id, email: row.email };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return { error: 'email_already_exists' };
    throw e;
  } finally {
    client.release();
  }
}

async function isVerified(pool, userId) {
  const r = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [userId]);
  return Boolean(r.rows[0]?.email_verified_at);
}

module.exports = {
  TOKEN_HOURS, RESEND_SECONDS, MAX_MAILS_PER_DAY,
  enabled, required, verificationMail, resendBlocked, sendVerification, verify, isVerified, hashToken
};
