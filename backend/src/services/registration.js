// Registrierung mit Mailserver (#141, #198).
//
// Ablauf: POST /auth/register antwortet immer gleich (202, ohne Token), ob es die Adresse schon gibt oder nicht. Das
// Konto entsteht erst, wenn der Link aus der Mail geöffnet wird (POST /auth/verify-email). Bis dahin liegt die Anfrage
// in pending_registrations (Passwort als bcrypt-Hash, Tokens als SHA-256-Hash). Gibt es die Adresse schon, bekommt ihr
// Inhaber stattdessen eine Mail mit dem Weg zur Anmeldung und zu „Passwort vergessen?“.
//
// Fristen (#141, Entscheidung des Maintainers): Eine offene Registrierung gilt 7 Tage, nach 5 Tagen kommt eine
// Erinnerung mit einem zweiten Link. Konten, die vor dieser Umstellung unbestätigt angelegt wurden, bekommen nach
// 5 Tagen eine Erinnerung und werden frühestens 2 Tage danach gelöscht (nie ohne Vorwarnung).
//
// Grenzen für Mails (#198, Notbremse für den Mailserver): je Zieladresse und Tag und gesamt je Stunde. Wird eine Grenze
// erreicht, geht keine Mail raus; die Antwort bleibt trotzdem gleich. Das Protokoll (registration_mails) enthält nur den
// Hash der Adresse und wird nach 2 Tagen gelöscht.
//
// Ohne Mailserver bzw. mit EMAIL_VERIFICATION=false gibt es keine Mail und damit keinen Nachweis: Dann entsteht das
// Konto wie bisher sofort (routes/auth.js).
const crypto = require('crypto');
const { sendUserMail, loadDefaultSmtp, withDefaultSmtp } = require('./mail');
const emailVerification = require('./emailVerification');
const { deleteAccount } = require('./accounts');

const PENDING_DAYS = 7;
const REMINDER_AFTER_DAYS = 5;
const DELETE_AFTER_REMINDER_DAYS = 2;
const LOG_DAYS = 2;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const zahl = (wert, standard) => {
  const n = Number.parseInt(String(wert ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : standard;
};

/** Grenzen aus der .env (#198), bei jedem Aufruf gelesen */
function mailLimits() {
  return {
    perAddressPerDay: zahl(process.env.REGISTER_MAILS_PER_ADDRESS_PER_DAY, 3),
    perHour: zahl(process.env.REGISTER_MAILS_PER_HOUR, 100)
  };
}

const datumText = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
const basis = (appUrl = process.env.APP_URL) => (appUrl ? String(appUrl).replace(/\/+$/, '') : null);

/** Mail mit dem Link, der das Konto anlegt; mit `reminder` als Erinnerung mit dem Tag, an dem die Anfrage verfällt */
function confirmMail(email, token, { app = false, expiresAt = null, reminder = false, appUrl } = {}) {
  const base = basis(appUrl);
  const link = base ? `${base}/pages/email_bestaetigen.php?token=${encodeURIComponent(token)}${app ? '&quelle=app' : ''}` : null;
  const bis = expiresAt ? datumText(expiresAt) : null;
  const subject = reminder ? 'Fuelstat: Registrierung noch nicht abgeschlossen' : 'Fuelstat: Registrierung abschließen';
  const anlass = reminder
    ? `du hast dich bei Fuelstat mit ${email} registriert, die Adresse aber noch nicht bestätigt. Ohne Bestätigung verfällt die Registrierung am ${bis}.`
    : `willkommen bei Fuelstat! Bitte bestätige noch deine E-Mail-Adresse ${email}. Erst dann legen wir dein Konto an.`;
  const gueltig = bis ? `gültig bis ${bis}` : `gültig ${PENDING_DAYS} Tage`;
  const weg = link
    ? `Zum Bestätigen diesen Link öffnen (${gueltig}):\n${link}`
    : `Zum Bestätigen in Fuelstat unter „E-Mail bestätigen“ diesen Code eingeben (${gueltig}):\n${token}`;
  const text = `Hallo,\n\n${anlass}\n\n${weg}\n\nWenn du das nicht warst, kannst du diese Mail ignorieren. Ohne Bestätigung entsteht kein Konto.\n\nDeine Fuelstat-App`;
  const html = `<p>Hallo,</p><p>${esc(anlass)}</p>${link
    ? `<p><a href="${esc(link)}">E-Mail-Adresse bestätigen</a> (${esc(gueltig)})</p>`
    : `<p>Zum Bestätigen in Fuelstat unter „E-Mail bestätigen“ diesen Code eingeben (${esc(gueltig)}):</p><p><code>${esc(token)}</code></p>`
  }<p>Wenn du das nicht warst, kannst du diese Mail ignorieren. Ohne Bestätigung entsteht kein Konto.</p><p>Deine Fuelstat-App</p>`;
  return { subject, text, html };
}

/** Mail an den Inhaber einer Adresse, mit der sich jemand erneut registrieren wollte */
function existsMail(email, { app = false, appUrl } = {}) {
  const base = basis(appUrl);
  const quelle = app ? '?quelle=app' : '';
  const anmelden = base ? `${base}/pages/login.php${quelle}` : null;
  const vergessen = base ? `${base}/pages/passwort_vergessen.php${quelle}` : null;
  const subject = 'Fuelstat: Du hast schon ein Konto';
  const anlass = `jemand wollte mit ${email} ein neues Fuelstat-Konto anlegen. Für diese Adresse gibt es schon ein Konto, deshalb haben wir kein zweites angelegt.`;
  const text = `Hallo,\n\n${anlass}\n\n`
    + (anmelden ? `Anmelden: ${anmelden}\nPasswort vergessen? ${vergessen}\n\n` : 'Melde dich in Fuelstat mit dieser Adresse an. Unter „Passwort vergessen?“ kannst du ein neues Passwort festlegen.\n\n')
    + 'Wenn du das nicht warst, kannst du diese Mail ignorieren. An deinem Konto hat sich nichts geändert.\n\nDeine Fuelstat-App';
  const html = `<p>Hallo,</p><p>${esc(anlass)}</p>`
    + (anmelden
      ? `<p><a href="${esc(anmelden)}">Anmelden</a> · <a href="${esc(vergessen)}">Passwort vergessen?</a></p>`
      : '<p>Melde dich in Fuelstat mit dieser Adresse an. Unter „Passwort vergessen?“ kannst du ein neues Passwort festlegen.</p>')
    + '<p>Wenn du das nicht warst, kannst du diese Mail ignorieren. An deinem Konto hat sich nichts geändert.</p><p>Deine Fuelstat-App</p>';
  return { subject, text, html };
}

async function logMail(db, email, kind) {
  await db.query('INSERT INTO registration_mails (address_hash, kind) VALUES ($1, $2)', [hash(email), kind]);
}

/** Darf eine Mail an `email` raus? null = ja, sonst 'address' bzw. 'hour' (Grenze erreicht) */
async function mailBlocked(db, email, limits = mailLimits()) {
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE address_hash = $1 AND kind IN ('verify', 'exists') AND created_at > now() - interval '24 hours')::int AS adresse,
            COUNT(*) FILTER (WHERE kind <> 'blocked' AND created_at > now() - interval '1 hour')::int AS stunde
     FROM registration_mails WHERE created_at > now() - interval '24 hours'`,
    [hash(email)]
  );
  if (r.rows[0].adresse >= limits.perAddressPerDay) return 'address';
  if (r.rows[0].stunde >= limits.perHour) return 'hour';
  return null;
}

async function send(db, defaults, email, mail, sender) {
  await sender(withDefaultSmtp({ user_id: null, account_email: email }, defaults), mail);
}

/**
 * Registrierung annehmen (läuft nach der Antwort im Hintergrund).
 * @returns 'pending' (Mail mit Link), 'exists' (Hinweis an den Inhaber), 'limited' (Grenze je Adresse),
 *          'blocked' (Grenze je Stunde erreicht; Betreiber-Hinweis) – nach außen immer dieselbe Antwort
 */
async function register(db, { email, passwordHash, termsVersion = null, app = false }, { sender = sendUserMail } = {}) {
  const defaults = await loadDefaultSmtp(db);
  if (!defaults) {
    const e = new Error('mail_not_configured');
    e.code = 'mail_not_configured';
    throw e;
  }
  const gesperrt = await mailBlocked(db, email);
  if (gesperrt === 'hour') {
    await logMail(db, email, 'blocked');
    console.warn('[register] Grenze für Registrierungsmails je Stunde erreicht (REGISTER_MAILS_PER_HOUR), Mail nicht verschickt');
    return 'blocked';
  }
  if (gesperrt === 'address') return 'limited';

  const vorhanden = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (vorhanden.rowCount > 0) {
    await logMail(db, email, 'exists');
    await send(db, defaults, email, existsMail(email, { app }), sender);
    return 'exists';
  }

  // Erneute Registrierung derselben Adresse ersetzt die offene Anfrage (neues Passwort, neuer Link, neue Frist)
  const token = newToken();
  const r = await db.query(
    `INSERT INTO pending_registrations (email, password_hash, terms_version, terms_accepted_at, token_hash, from_app, expires_at)
     VALUES ($1, $2, $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, $4, $5, now() + make_interval(days => $6))
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, terms_version = EXCLUDED.terms_version,
       terms_accepted_at = EXCLUDED.terms_accepted_at, token_hash = EXCLUDED.token_hash, reminder_token_hash = NULL,
       from_app = EXCLUDED.from_app, created_at = now(), expires_at = EXCLUDED.expires_at, reminder_sent_at = NULL
     RETURNING expires_at`,
    [email, passwordHash, termsVersion, hash(token), app, PENDING_DAYS]
  );
  await logMail(db, email, 'verify');
  await send(db, defaults, email, confirmMail(email, token, { app, expiresAt: r.rows[0].expires_at }), sender);
  return 'pending';
}

/**
 * Link aus der Mail einlösen: legt das Konto an (Adresse bestätigt).
 * @returns null (kein offenes Token, weiter mit emailVerification.verify), { userId, email } oder
 *          { error: 'token_expired' | 'email_already_exists' }
 */
async function confirm(pool, token, { betaTester = false } = {}) {
  const t = String(token || '').trim();
  if (!t || t.length > 200) return null;
  const h = hash(t);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT * FROM pending_registrations WHERE token_hash = $1 OR reminder_token_hash = $1 FOR UPDATE`,
      [h]
    );
    const p = r.rows[0];
    if (!p) {
      await client.query('ROLLBACK');
      return null;
    }
    if (new Date(p.expires_at) <= new Date()) {
      await client.query('DELETE FROM pending_registrations WHERE id = $1', [p.id]);
      await client.query('COMMIT');
      return { error: 'token_expired' };
    }
    await client.query('DELETE FROM pending_registrations WHERE id = $1', [p.id]);
    // Gleichzeitig angelegt (z. B. Adresse inzwischen per Änderung übernommen): kein zweites Konto
    const u = await client.query(
      `INSERT INTO users (email, password_hash, beta_tester, email_verified_at, terms_version, terms_accepted_at)
       VALUES ($1, $2, $3, now(), $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email`,
      [p.email, p.password_hash, betaTester, p.terms_version, p.terms_accepted_at]
    );
    await client.query('COMMIT');
    if (u.rowCount === 0) return { error: 'email_already_exists' };
    return { userId: u.rows[0].id, email: u.rows[0].email, created: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return { error: 'email_already_exists' };
    throw e;
  } finally {
    client.release();
  }
}

const adminIds = () => String(process.env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Stündlicher Lauf (#141): abgelaufene Anfragen löschen, an offene Anfragen und unbestätigte Konten erinnern,
 * unbestätigte Konten nach der Frist löschen, das Mail-Protokoll kürzen. Ohne Mailserver nur Aufräumen der Tabellen,
 * kein Konto wird gelöscht (ohne Mail keine Erinnerung).
 */
async function runCleanup(pool, { sender = sendUserMail } = {}) {
  const ergebnis = { expired: 0, reminded: 0, accountsReminded: 0, accountsDeleted: 0 };
  ergebnis.expired = (await pool.query('DELETE FROM pending_registrations WHERE expires_at <= now()')).rowCount;
  await pool.query(`DELETE FROM registration_mails WHERE created_at < now() - make_interval(days => $1)`, [LOG_DAYS]);

  if (!(await emailVerification.required(pool))) return ergebnis;
  const defaults = await loadDefaultSmtp(pool);

  // Erinnerung an offene Registrierungen: zweiter Link, der erste bleibt gültig
  const offen = await pool.query(
    `SELECT id, email, from_app, expires_at FROM pending_registrations
     WHERE reminder_sent_at IS NULL AND created_at <= now() - make_interval(days => $1) AND expires_at > now()`,
    [REMINDER_AFTER_DAYS]
  );
  for (const p of offen.rows) {
    const token = newToken();
    try {
      await pool.query('UPDATE pending_registrations SET reminder_token_hash = $2, reminder_sent_at = now() WHERE id = $1', [p.id, hash(token)]);
      await logMail(pool, p.email, 'reminder');
      await send(pool, defaults, p.email, confirmMail(p.email, token, { app: p.from_app, expiresAt: p.expires_at, reminder: true }), sender);
      ergebnis.reminded++;
    } catch (e) {
      console.error('[registrierung] Erinnerung fehlgeschlagen:', e.code || e.message);
    }
  }

  // Unbestätigte Konten von früher: erinnern, gelöscht wird frühestens DELETE_AFTER_REMINDER_DAYS danach
  const admins = adminIds();
  const erinnern = await pool.query(
    `SELECT id, email, created_at FROM users
     WHERE email_verified_at IS NULL AND unverified_reminder_sent_at IS NULL
       AND created_at <= now() - make_interval(days => $1) AND NOT (id::text = ANY($2))`,
    [REMINDER_AFTER_DAYS, admins]
  );
  for (const u of erinnern.rows) {
    const loeschen = new Date(Math.max(
      new Date(u.created_at).getTime() + PENDING_DAYS * 86400000,
      Date.now() + DELETE_AFTER_REMINDER_DAYS * 86400000
    ));
    try {
      await emailVerification.sendVerification(pool, u.id, u.email, { sender, hours: DELETE_AFTER_REMINDER_DAYS * 24, deleteOn: loeschen });
      await pool.query('UPDATE users SET unverified_reminder_sent_at = now() WHERE id = $1', [u.id]);
      ergebnis.accountsReminded++;
    } catch (e) {
      console.error('[registrierung] Erinnerung an Konto fehlgeschlagen:', e.code || e.message);
    }
  }
  const alt = await pool.query(
    `SELECT id FROM users
     WHERE email_verified_at IS NULL AND created_at <= now() - make_interval(days => $1)
       AND unverified_reminder_sent_at <= now() - make_interval(days => $2) AND NOT (id::text = ANY($3))`,
    [PENDING_DAYS, DELETE_AFTER_REMINDER_DAYS, admins]
  );
  for (const u of alt.rows) {
    try {
      if (await deleteAccount(pool, u.id)) ergebnis.accountsDeleted++;
    } catch (e) {
      console.error('[registrierung] Löschen fehlgeschlagen:', e.message);
    }
  }
  if (ergebnis.expired || ergebnis.reminded || ergebnis.accountsReminded || ergebnis.accountsDeleted) {
    console.log('[registrierung] Aufgeräumt:', JSON.stringify(ergebnis));
  }
  return ergebnis;
}

/** Stündlich (erstmals 2 Minuten nach dem Start). Abschaltbar mit ACCOUNT_CLEANUP_ENABLED=false. */
function startCleanup(pool) {
  if (process.env.ACCOUNT_CLEANUP_ENABLED === 'false') return;
  let laeuft = false;
  const tick = async () => {
    if (laeuft) return;
    laeuft = true;
    try {
      await runCleanup(pool);
    } catch (e) {
      console.error('[registrierung]', e.message);
    } finally {
      laeuft = false;
    }
  };
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

/** Für die Admin-Seite (#198): Registrierungen und Mails, Hinweis bei erreichter Grenze */
async function status(pool) {
  const limits = mailLimits();
  const r = await pool.query(
    `SELECT (SELECT COUNT(*) FROM registration_mails WHERE kind <> 'blocked' AND created_at > now() - interval '1 hour')::int AS stunde,
            (SELECT COUNT(*) FROM registration_mails WHERE kind = 'blocked' AND created_at > now() - interval '24 hours')::int AS blockiert,
            (SELECT MAX(created_at) FROM registration_mails WHERE kind = 'blocked') AS zuletzt,
            (SELECT COUNT(*) FROM pending_registrations WHERE expires_at > now())::int AS offen,
            (SELECT COUNT(*) FROM users WHERE email_verified_at IS NULL)::int AS unbestaetigt`
  );
  const z = r.rows[0];
  return {
    mailsLastHour: z.stunde,
    mailsPerHourLimit: limits.perHour,
    mailsPerAddressPerDayLimit: limits.perAddressPerDay,
    blockedLast24h: z.blockiert,
    lastBlockedAt: z.zuletzt,
    pendingRegistrations: z.offen,
    unverifiedAccounts: z.unbestaetigt
  };
}

module.exports = {
  PENDING_DAYS, REMINDER_AFTER_DAYS, DELETE_AFTER_REMINDER_DAYS,
  confirm, confirmMail, existsMail, mailBlocked, mailLimits, register, runCleanup, startCleanup, status
};
