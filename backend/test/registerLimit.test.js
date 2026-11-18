// Grenze für Registrierungen je IP (#198). Eigene Datei (eigener Prozess), weil die Zähler im Speicher liegen.
// Ohne Mailserver: Konten entstehen sofort (201).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
process.env.REGISTER_LIMIT_PER_HOUR = '3';
process.env.REGISTER_LIMIT_PER_DAY = '5';

if (!process.env.DATABASE_URL) {
  test('Registrierungsgrenze übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}

const { app, pool } = require('../src/server');
let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

// X-Forwarded-For wie vom PHP-Frontend: die API übernimmt es nur von lokalen Adressen (app.js „trust proxy“)
async function registrieren(ip, email = `grenze-${crypto.randomBytes(6).toString('hex')}@example.test`) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password: 'Passwort123' })
  });
  return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json(), email };
}

test('Registrierung: höchstens 3 je Stunde und IP, 429 mit Retry-After, andere IPs und Login unberührt', async () => {
  const konten = [];
  for (let i = 0; i < 3; i++) {
    const r = await registrieren('203.0.113.7');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    konten.push(r);
  }
  const zuViel = await registrieren('203.0.113.7');
  assert.equal(zuViel.status, 429);
  assert.deepEqual(zuViel.body, { error: 'too_many_requests' });
  assert.ok(Number(zuViel.retryAfter) > 0, 'Retry-After gesetzt');

  assert.equal((await registrieren('203.0.113.8')).status, 201, 'andere IP');
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ email: konten[0].email, password: 'Passwort123' })
  });
  assert.equal(login.status, 200, 'Login zählt nicht mit');
  const vergessen = await fetch(`${base}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ email: konten[0].email })
  });
  assert.notEqual(vergessen.status, 429, 'Passwort vergessen zählt nicht mit');
});

test('Registrierung: Tagesgrenze greift auch bei höherer Stundengrenze', async () => {
  process.env.REGISTER_LIMIT_PER_HOUR = '100';
  try {
    for (let i = 0; i < 5; i++) assert.equal((await registrieren('198.51.100.9')).status, 201);
    assert.equal((await registrieren('198.51.100.9')).status, 429);
  } finally {
    process.env.REGISTER_LIMIT_PER_HOUR = '3';
  }
});
