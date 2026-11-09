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

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
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

async function registrieren() {
  const email = `neu-${unique()}@example.test`;
  const r = await api('POST', '/auth/register', { body: { email, password: 'Passwort123' } });
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
