// E-Mail-Bestätigung (#135) gegen die Testdatenbank, mit einem kleinen SMTP-Empfänger auf 127.0.0.1:2525.
// Eigene Datei (eigener Prozess), weil der Standard-Mailserver hier für alle Registrierungen gilt: In api.test.js
// gibt es keinen Mailserver, dort sind neue Konten sofort bestätigt.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
process.env.ALLOW_PRIVATE_SMTP = 'true';
delete process.env.PLAN_LIMITS_ENABLED;
delete process.env.EMAIL_VERIFICATION;

if (!process.env.DATABASE_URL) {
  test('E-Mail-Bestätigung übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}

const SMTP_PORT = 2525;
const { app, pool } = require('../src/server');
const emailVerification = require('../src/services/emailVerification');
let server;
let smtp;
let base;
const postfach = [];

// Minimaler SMTP-Empfänger: nimmt jede Mail an und legt sie in `postfach` ab
function smtpEmpfaenger() {
  return net.createServer((sock) => {
    let daten = null;
    let puffer = '';
    sock.write('220 test ESMTP\r\n');
    sock.on('data', (chunk) => {
      puffer += chunk.toString('utf8');
      while (true) {
        if (daten !== null) {
          const ende = puffer.indexOf('\r\n.\r\n');
          if (ende < 0) return;
          daten += puffer.slice(0, ende);
          puffer = puffer.slice(ende + 5);
          postfach.push(daten);
          daten = null;
          sock.write('250 OK\r\n');
          continue;
        }
        const zeile = puffer.indexOf('\r\n');
        if (zeile < 0) return;
        const befehl = puffer.slice(0, zeile).toUpperCase();
        puffer = puffer.slice(zeile + 2);
        if (befehl.startsWith('EHLO') || befehl.startsWith('HELO')) sock.write('250 test\r\n');
        else if (befehl === 'DATA') { daten = ''; sock.write('354 weiter\r\n'); }
        else if (befehl === 'QUIT') { sock.end('221 tschuess\r\n'); return; }
        else sock.write('250 OK\r\n');
      }
    });
  });
}

// Token aus der zuletzt an `adresse` geschickten Mail (Quoted-Printable-Umbrüche entfernt)
function tokenAus(adresse) {
  const mail = [...postfach].reverse().find((m) => m.includes(adresse));
  assert.ok(mail, `keine Mail an ${adresse}`);
  const text = mail.replace(/=\r\n/g, '').replace(/=3D/g, '=');
  const m = text.match(/token=([A-Za-z0-9_-]{20,})/) || text.match(/\n([A-Za-z0-9_-]{40,})\r?\n/);
  assert.ok(m, 'kein Token in der Mail');
  return m[1];
}

async function api(method, path, { token, body, client } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(client ? { 'x-fuelstat-client': client } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const unique = () => crypto.randomBytes(6).toString('hex');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
async function warteAufMail(adresse) {
  for (let i = 0; i < 50 && !postfach.some((m) => m.includes(adresse)); i++) await warte(50);
}

test.before(async () => {
  smtp = smtpEmpfaenger();
  await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  // Betreiber mit Mailserver als Standard-Mailserver (MAIL_DEFAULT_USER_ID)
  const betreiber = await pool.query(
    `INSERT INTO users (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id`,
    [`betreiber-${unique()}@example.test`]
  );
  await pool.query(
    `INSERT INTO user_mail_settings (user_id, smtp_host, smtp_port, smtp_security, from_address)
     VALUES ($1, '127.0.0.1', $2, 'none', 'fuelstat@example.test')`,
    [betreiber.rows[0].id, SMTP_PORT]
  );
  process.env.MAIL_DEFAULT_USER_ID = betreiber.rows[0].id;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => smtp.close(r));
  await pool.end();
});

// Konto sofort anlegen: wie eine App vor 0.2.3 (lib/appVersions.js, alter Weg mit Token und unbestätigtem Konto)
const ALTE_APP = 'ios/0.2.2 (7)';
async function registrieren() {
  const email = `neu-${unique()}@example.test`;
  const r = await api('POST', '/auth/register', { body: { email, password: 'Passwort123' }, client: ALTE_APP });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await warteAufMail(email);
  return { email, token: r.body.token, id: r.body.user.id, user: r.body.user };
}

test('Registrierung: unbestätigt, Mail mit Link, Bestätigen schaltet frei', async () => {
  const u = await registrieren();
  assert.equal(u.user.email_verified, false);
  const me = await api('GET', '/whoami', { token: u.token });
  assert.equal(me.body.email_verified, false);
  assert.deepEqual(me.body.unverified_limits, { maxVehicles: 1, maxEntries: 1 });

  const token = tokenAus(u.email);
  // In der Datenbank steht nur der Hash
  const gespeichert = await pool.query('SELECT token_hash FROM email_verifications WHERE user_id = $1', [u.id]);
  assert.equal(gespeichert.rows[0].token_hash, emailVerification.hashToken(token));
  assert.notEqual(gespeichert.rows[0].token_hash, token);

  assert.equal((await api('POST', '/auth/verify-email', { body: { token: 'falsch' } })).body.error, 'invalid_token');
  const ok = await api('POST', '/auth/verify-email', { body: { token } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.email, u.email);
  assert.equal((await api('GET', '/whoami', { token: u.token })).body.email_verified, true);
  // Jedes Token gilt nur einmal
  assert.equal((await api('POST', '/auth/verify-email', { body: { token } })).body.error, 'invalid_token');
});

test('Unbestätigt: ein Fahrzeug, ein Eintrag, Rest gesperrt; Lesen und Profil gehen', async () => {
  const u = await registrieren();
  const v = await api('POST', '/vehicles', { token: u.token, body: { name: 'Erstes', fuelType: 'e10' } });
  assert.equal(v.status, 201);
  const zweites = await api('POST', '/vehicles', { token: u.token, body: { name: 'Zweites', fuelType: 'e10' } });
  assert.equal(zweites.status, 403);
  assert.deepEqual(zweites.body, { error: 'email_not_verified', feature: 'maxVehicles', limit: 1 });

  const f = await api('POST', '/fillups', { token: u.token, body: { vehicleId: v.body.id, odometerKm: 100, amount: 40, unit: 'l', totalCostEur: 70 } });
  assert.equal(f.status, 201);
  const e = await api('POST', '/entries', { token: u.token, body: { vehicleId: v.body.id, category: 'Werkstatt', amountEur: 10 } });
  assert.equal(e.status, 403);
  assert.equal(e.body.feature, 'maxEntries');

  for (const [method, path, body] of [
    ['POST', '/feedback', { category: 'idee', message: 'Hallo Welt' }],
    ['PUT', '/auth/mail-settings', { remindersEnabled: true }],
    ['POST', '/auth/mail-settings/test', {}],
    ['GET', '/stations?lat=52&lng=13'],
    ['GET', '/charging-stations?lat=52&lng=13'],
    ['POST', '/categories', { name: 'Fähre' }],
    ['POST', `/vehicles/${v.body.id}/import`, { fillups: [] }]
  ]) {
    const r = await api(method, path, { token: u.token, body });
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.error, 'email_not_verified', `${method} ${path}`);
  }

  // Erlaubt: eigene Daten lesen, Fahrzeug bearbeiten, Profil
  assert.equal((await api('GET', '/vehicles', { token: u.token })).status, 200);
  assert.equal((await api('GET', `/vehicles/${v.body.id}/stats`, { token: u.token })).status, 200);
  assert.equal((await api('PATCH', `/vehicles/${v.body.id}`, { token: u.token, body: { name: 'Umbenannt' } })).status, 200);
  assert.equal((await api('PATCH', `/auth/users/${u.id}`, { token: u.token, body: { username: `n${unique()}` } })).status, 200);

  // Nach der Bestätigung ist alles frei
  await api('POST', '/auth/verify-email', { body: { token: tokenAus(u.email) } });
  assert.equal((await api('POST', '/vehicles', { token: u.token, body: { name: 'Zweites', fuelType: 'e10' } })).status, 201);
  assert.equal((await api('POST', '/entries', { token: u.token, body: { vehicleId: v.body.id, category: 'Werkstatt', amountEur: 10 } })).status, 201);
});

test('Erneut senden: begrenzt, altes Token verfällt', async () => {
  const u = await registrieren();
  const erstes = tokenAus(u.email);
  // Gleich nach der Registrierung: zu früh
  const zuFrueh = await api('POST', '/auth/resend-verification', { token: u.token });
  assert.equal(zuFrueh.status, 429);
  assert.equal(zuFrueh.body.error, 'resend_too_soon');

  // Letzte Mail künstlich älter machen, dann geht es
  await pool.query(`UPDATE email_verifications SET created_at = now() - interval '2 minutes' WHERE user_id = $1`, [u.id]);
  const anzahl = postfach.length;
  const ok = await api('POST', '/auth/resend-verification', { token: u.token });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  for (let i = 0; i < 50 && postfach.length === anzahl; i++) await warte(50);
  const zweites = tokenAus(u.email);
  assert.notEqual(zweites, erstes);
  assert.equal((await api('POST', '/auth/verify-email', { body: { token: erstes } })).body.error, 'invalid_token');
  assert.equal((await api('POST', '/auth/verify-email', { body: { token: zweites } })).status, 200);
  assert.equal((await api('POST', '/auth/resend-verification', { token: u.token })).body.error, 'already_verified');
});

test('Abgelaufenes Token wird abgelehnt', async () => {
  const u = await registrieren();
  const token = tokenAus(u.email);
  await pool.query(`UPDATE email_verifications SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [u.id]);
  assert.equal((await api('POST', '/auth/verify-email', { body: { token } })).body.error, 'token_expired');
  assert.equal((await api('GET', '/whoami', { token: u.token })).body.email_verified, false);
});

test('Neue E-Mail-Adresse gilt erst nach Bestätigung', async () => {
  const u = await registrieren();
  await api('POST', '/auth/verify-email', { body: { token: tokenAus(u.email) } });
  const neu = `geaendert-${unique()}@example.test`;
  const r = await api('PATCH', `/auth/users/${u.id}`, { token: u.token, body: { email: neu } });
  assert.equal(r.status, 200);
  assert.equal(r.body.email, u.email, 'alte Adresse gilt weiter');
  assert.equal(r.body.pending_email, neu);
  assert.equal(r.body.email_verified, true, 'Konto bleibt bestätigt');
  await warteAufMail(neu);
  const ok = await api('POST', '/auth/verify-email', { body: { token: tokenAus(neu) } });
  assert.equal(ok.status, 200);
  const me = await api('GET', '/whoami', { token: u.token });
  assert.equal(me.body.email, neu);
  assert.equal(me.body.pending_email, null);
  // Anmelden geht jetzt mit der neuen Adresse
  assert.equal((await api('POST', '/auth/login', { body: { email: neu, password: 'Passwort123' } })).status, 200);

  // Eine Adresse, die schon ein anderes Konto hat, geht nicht
  const andere = await registrieren();
  assert.equal((await api('PATCH', `/auth/users/${andere.id}`, { token: andere.token, body: { email: neu } })).status, 409);
});

test('Ohne Mailserver bzw. mit EMAIL_VERIFICATION=false gelten neue Konten als bestätigt', async () => {
  process.env.EMAIL_VERIFICATION = 'false';
  try {
    const u = await registrieren();
    assert.equal(u.user.email_verified, true);
  } finally {
    delete process.env.EMAIL_VERIFICATION;
  }
});

// Passwort vergessen (#141): Link aus der Mail (pages/passwort_zuruecksetzen.php?token=…)
function resetTokenAus(adresse) {
  const mail = [...postfach].reverse().find((m) => m.includes(adresse) && m.includes('Passwort'));
  assert.ok(mail, `keine Passwort-Mail an ${adresse}`);
  const text = mail.replace(/=\r\n/g, '').replace(/=3D/g, '=');
  const m = text.match(/passwort_zuruecksetzen\.php\?token=([A-Za-z0-9_-]{20,})/) || text.match(/\n([A-Za-z0-9_-]{40,})\r?\n/);
  assert.ok(m, 'kein Token in der Mail');
  return m[1];
}

test('Passwort vergessen: gleiche Antwort für alle, Link setzt Passwort und meldet ab', async () => {
  process.env.APP_URL = 'https://fuelstat.example.test';
  try {
    const u = await registrieren();
    // Unbekannte Adresse: dieselbe Antwort, keine Mail
    const anzahl = postfach.length;
    const fremd = await api('POST', '/auth/forgot-password', { body: { email: `gibtsnicht-${unique()}@example.test` } });
    assert.equal(fremd.status, 202);
    assert.deepEqual(fremd.body, { accepted: true });
    const echt = await api('POST', '/auth/forgot-password', { body: { email: u.email.toUpperCase() } });
    assert.equal(echt.status, 202);
    assert.deepEqual(echt.body, fremd.body, 'gleiche Antwort');
    for (let i = 0; i < 50 && !postfach.slice(anzahl).some((m) => m.includes(u.email) && m.includes('Passwort')); i++) await warte(50);
    assert.ok(!postfach.slice(anzahl).some((m) => m.includes('gibtsnicht-')), 'keine Mail an unbekannte Adressen');

    const token = resetTokenAus(u.email);
    const gespeichert = await pool.query('SELECT token_hash FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [u.id]);
    assert.equal(gespeichert.rows[0].token_hash, require('../src/services/passwordReset').hashToken(token), 'nur der Hash');

    assert.equal((await api('POST', '/auth/reset-password', { body: { token, password: 'kurz' } })).body.error, 'password_too_short');
    assert.equal((await api('POST', '/auth/reset-password', { body: { token: 'falsch', password: 'NeuesPasswort1' } })).body.error, 'invalid_token');
    await new Promise((r) => setTimeout(r, 1100)); // revoked_after liegt sekundengenau hinter dem alten Token
    const ok = await api('POST', '/auth/reset-password', { body: { token, password: 'NeuesPasswort1' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body, { reset: true, email: u.email }, 'Antwort nennt das Konto (#175)');
    // Nur einmal, alte Tokens abgemeldet, neues Passwort gilt, Adresse bestätigt
    assert.equal((await api('POST', '/auth/reset-password', { body: { token, password: 'NochEinsNeu1' } })).body.error, 'invalid_token');
    assert.equal((await api('GET', '/whoami', { token: u.token })).status, 401, 'alte Anmeldung widerrufen');
    assert.equal((await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort123' } })).status, 401);
    const login = await api('POST', '/auth/login', { body: { email: u.email, password: 'NeuesPasswort1' } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email_verified, true, 'Link beweist das Postfach');
  } finally {
    delete process.env.APP_URL;
  }
});

test('Passwort vergessen: abgelaufen, höchstens 3 Mails je Stunde, neuer Link entwertet den alten', async () => {
  const u = await registrieren();
  await api('POST', '/auth/forgot-password', { body: { email: u.email } });
  for (let i = 0; i < 50 && !postfach.some((m) => m.includes(u.email) && m.includes('Passwort')); i++) await warte(50);
  const erstes = resetTokenAus(u.email);
  const vorher = postfach.length;
  await api('POST', '/auth/forgot-password', { body: { email: u.email } });
  for (let i = 0; i < 50 && postfach.length === vorher; i++) await warte(50);
  const zweites = resetTokenAus(u.email);
  assert.notEqual(erstes, zweites);
  assert.equal((await api('POST', '/auth/reset-password', { body: { token: erstes, password: 'NeuesPasswort1' } })).body.error, 'invalid_token');
  await pool.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND used_at IS NULL`, [u.id]);
  assert.equal((await api('POST', '/auth/reset-password', { body: { token: zweites, password: 'NeuesPasswort1' } })).body.error, 'token_expired');
  // Drittes Mal geht noch, das vierte nicht mehr (Antwort bleibt trotzdem gleich)
  await api('POST', '/auth/forgot-password', { body: { email: u.email } });
  await warte(300);
  const n = postfach.length;
  const viertes = await api('POST', '/auth/forgot-password', { body: { email: u.email } });
  assert.equal(viertes.status, 202);
  await warte(500);
  assert.equal(postfach.length, n, 'keine weitere Mail');
});

test('Mail-Links (#175): mit quelle=app nur, wenn die Anfrage aus der App kommt', async () => {
  const { resetMail } = require('../src/services/passwordReset');
  const url = 'https://fuelstat.example.test/';
  assert.match(resetMail('abc123', url).text, /passwort_zuruecksetzen\.php\?token=abc123\n/);
  assert.match(resetMail('abc123', url, { app: true }).text, /passwort_zuruecksetzen\.php\?token=abc123&quelle=app/);
  assert.match(resetMail('abc123', url, { app: true }).html, /token=abc123&amp;quelle=app/);
  assert.match(emailVerification.verificationMail('a@b.de', 'xyz', { appUrl: url }).text, /email_bestaetigen\.php\?token=xyz\n/);
  assert.match(emailVerification.verificationMail('a@b.de', 'xyz', { appUrl: url, app: true }).text, /email_bestaetigen\.php\?token=xyz&quelle=app/);

  // Ende zu Ende: Passwort vergessen aus der App bzw. aus dem Web
  process.env.APP_URL = 'https://fuelstat.example.test';
  try {
    const u = await registrieren();
    const neueMail = async (client) => {
      const vorher = postfach.length;
      await api('POST', '/auth/forgot-password', { body: { email: u.email }, client });
      for (let i = 0; i < 50 && !postfach.slice(vorher).some((m) => m.includes(u.email) && m.includes('Passwort')); i++) await warte(50);
      return postfach.slice(vorher).find((m) => m.includes(u.email)).replace(/=\r\n/g, '').replace(/=3D/g, '=');
    };
    assert.match(await neueMail('ios/0.2.2 (7)'), /quelle=app/);
    assert.doesNotMatch(await neueMail(undefined), /quelle=app/);
  } finally {
    delete process.env.APP_URL;
  }
});

// --- Registrierung mit Mailserver (#141, #198): Konto erst mit dem Link, gleiche Antwort für jede Adresse ---
const registration = require('../src/services/registration');
const mailsAn = (adresse) => postfach.filter((m) => m.includes(adresse));
async function warteAufMails(adresse, n) {
  for (let i = 0; i < 60 && mailsAn(adresse).length < n; i++) await warte(50);
}

test('Registrierung (#141): 202 ohne Token, Konto erst mit dem Link aus der Mail', async () => {
  const email = `offen-${unique()}@example.test`;
  const r = await api('POST', '/auth/register', { body: { email: email.toUpperCase(), password: 'Passwort123' } });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.deepEqual(r.body, { verificationRequired: true, email });
  await warteAufMail(email);
  // Noch kein Konto: Anmelden scheitert wie bei einer unbekannten Adresse
  assert.equal((await pool.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount, 0);
  assert.equal((await api('POST', '/auth/login', { body: { email, password: 'Passwort123' } })).status, 401);
  // In der Datenbank nur Hashes
  const token = tokenAus(email);
  const offen = await pool.query('SELECT password_hash, token_hash FROM pending_registrations WHERE email = $1', [email]);
  assert.notEqual(offen.rows[0].token_hash, token);
  assert.match(offen.rows[0].password_hash, /^\$2[aby]\$/);

  const ok = await api('POST', '/auth/verify-email', { body: { token } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { verified: true, email, accountCreated: true });
  assert.equal((await pool.query('SELECT 1 FROM pending_registrations WHERE email = $1', [email])).rowCount, 0);
  const login = await api('POST', '/auth/login', { body: { email, password: 'Passwort123' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email_verified, true);
  assert.equal((await api('POST', '/auth/verify-email', { body: { token } })).body.error, 'invalid_token', 'nur einmal');
});

test('Registrierung (#141): vorhandene Adresse bekommt dieselbe Antwort, der Inhaber einen Hinweis', async () => {
  const u = await registrieren();
  const neu = `frisch-${unique()}@example.test`;
  const a = await api('POST', '/auth/register', { body: { email: neu, password: 'Passwort123' } });
  const b = await api('POST', '/auth/register', { body: { email: u.email, password: 'AnderesPasswort1' } });
  assert.equal(b.status, a.status);
  assert.deepEqual(Object.keys(b.body), Object.keys(a.body));
  assert.equal(b.body.token, undefined);
  await warteAufMails(u.email, 2);
  const hinweis = mailsAn(u.email).at(-1);
  assert.match(hinweis, /schon ein Konto/);
  assert.doesNotMatch(hinweis, /token=/, 'kein Link, der etwas ändert');
  // Das bestehende Konto bleibt unverändert
  assert.equal((await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort123' } })).status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { email: u.email, password: 'AnderesPasswort1' } })).status, 401);
});

test('Registrierung (#198): höchstens 3 Mails je Adresse und Tag, erneute Registrierung ersetzt die Anfrage', async () => {
  const email = `oft-${unique()}@example.test`;
  for (let i = 0; i < 5; i++) {
    const r = await api('POST', '/auth/register', { body: { email, password: `Passwort${i}xx` } });
    assert.equal(r.status, 202);
    await warte(150);
  }
  await warte(300);
  assert.equal(mailsAn(email).length, 3);
  assert.equal((await pool.query('SELECT 1 FROM pending_registrations WHERE email = $1', [email])).rowCount, 1);
  // Der letzte verschickte Link gilt, das Passwort ist das der dritten Anfrage
  assert.equal((await api('POST', '/auth/verify-email', { body: { token: tokenAus(email) } })).status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { email, password: 'Passwort2xx' } })).status, 200);
});

test('Registrierung (#198): Notbremse je Stunde hält Mails zurück, Admin sieht den Hinweis', async () => {
  const admin = await registrieren();
  process.env.ADMIN_USER_IDS = admin.id;
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM registration_mails WHERE kind <> 'blocked' AND created_at > now() - interval '1 hour'`);
  process.env.REGISTER_MAILS_PER_HOUR = String(r.rows[0].n);
  try {
    const email = `gebremst-${unique()}@example.test`;
    assert.equal((await api('POST', '/auth/register', { body: { email, password: 'Passwort123' } })).status, 202);
    await warte(500);
    assert.equal(mailsAn(email).length, 0, 'keine Mail');
    const status = await api('GET', '/auth/registrations', { token: admin.token });
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.ok(status.body.blockedLast24h >= 1);
    assert.equal(status.body.mailsPerHourLimit, r.rows[0].n);
    assert.equal((await api('GET', '/auth/registrations', { token: (await registrieren()).token })).status, 403, 'nur Admins');
  } finally {
    delete process.env.REGISTER_MAILS_PER_HOUR;
    delete process.env.ADMIN_USER_IDS;
  }
});

test('Aufräumen (#141): Erinnerung nach 5 Tagen mit zweitem Link, nach 7 Tagen verfallen', async () => {
  const email = `erinnern-${unique()}@example.test`;
  await api('POST', '/auth/register', { body: { email, password: 'Passwort123' } });
  await warteAufMail(email);
  const erster = tokenAus(email);
  const weg = `verfallen-${unique()}@example.test`;
  await api('POST', '/auth/register', { body: { email: weg, password: 'Passwort123' } });
  await warteAufMail(weg);
  await pool.query(`UPDATE pending_registrations SET created_at = now() - interval '5 days 1 hour' WHERE email = $1`, [email]);
  await pool.query(`UPDATE pending_registrations SET expires_at = now() - interval '1 minute' WHERE email = $1`, [weg]);

  const e = await registration.runCleanup(pool);
  assert.ok(e.reminded >= 1 && e.expired >= 1, JSON.stringify(e));
  assert.equal((await pool.query('SELECT 1 FROM pending_registrations WHERE email = $1', [weg])).rowCount, 0);
  await warteAufMails(email, 2);
  assert.match(mailsAn(email).at(-1), /verf=C3=A4llt|verfällt/);
  // Ein zweiter Lauf erinnert nicht noch einmal; der erste Link gilt weiter
  const n = mailsAn(email).length;
  await registration.runCleanup(pool);
  await warte(300);
  assert.equal(mailsAn(email).length, n);
  assert.equal((await api('POST', '/auth/verify-email', { body: { token: erster } })).status, 200);
});

test('Aufräumen (#141): unbestätigte Konten erst erinnern, frühestens 2 Tage danach löschen', async () => {
  const alt = await registrieren();
  const bestaetigt = await registrieren();
  await api('POST', '/auth/verify-email', { body: { token: tokenAus(bestaetigt.email) } });
  await pool.query(`UPDATE users SET created_at = now() - interval '30 days' WHERE id = ANY($1)`, [[alt.id, bestaetigt.id]]);

  const vorher = mailsAn(alt.email).length;
  await registration.runCleanup(pool);
  await warteAufMails(alt.email, vorher + 1);
  assert.match(mailsAn(alt.email).at(-1), /gel=C3=B6scht|gelöscht/, 'Erinnerung nennt das Löschen');
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [alt.id])).rowCount, 1, 'nie ohne Vorwarnung');

  await pool.query(`UPDATE users SET unverified_reminder_sent_at = now() - interval '2 days 1 hour' WHERE id = $1`, [alt.id]);
  await registration.runCleanup(pool);
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [alt.id])).rowCount, 0, 'gelöscht');
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [bestaetigt.id])).rowCount, 1, 'bestätigte bleiben');
});
