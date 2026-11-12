// Gerätesitzungen der Apps (#117): Login mit Gerät, Refresh-Rotation, Wiederverwendung, Geräteliste, Abmelden.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseDevice } = require('../src/services/deviceSessions');

test('parseDevice: ohne Gerät, gültig, ungültig', () => {
  assert.deepEqual(parseDevice(undefined), { device: null });
  assert.deepEqual(parseDevice({ name: ' iPhone von Mario ', platform: 'iOS', appVersion: '0.2.0' }),
    { device: { name: 'iPhone von Mario', platform: 'ios', appVersion: '0.2.0' } });
  assert.equal(parseDevice({ platform: 'ios' }).error, 'invalid_device_name');
  assert.equal(parseDevice({ name: 'x', platform: 'windows' }).error, 'invalid_device_platform');
  assert.equal(parseDevice('iphone').error, 'invalid_device');
  assert.equal(parseDevice({ name: 'a'.repeat(300), platform: 'android' }).device.name.length, 100);
});

if (!process.env.DATABASE_URL) {
  test('API-Tests für Gerätesitzungen übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('node:os').tmpdir();
delete process.env.PLAN_LIMITS_ENABLED;

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

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const unique = () => crypto.randomBytes(6).toString('hex');
const DEVICE = { name: 'iPhone Test', platform: 'ios', appVersion: '0.2.0' };

async function newUser() {
  const email = `geraet-${unique()}@example.test`;
  const r = await api('POST', '/auth/register', { body: { email, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { email, id: r.body.user.id, webToken: r.body.token };
}
const appLogin = (email, device = DEVICE, password = 'Passwort123') =>
  api('POST', '/auth/login', { body: { email, password, device } });

function totp(secretBase32, delta = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + delta));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

test('Login mit Gerät: Zugriffs- und Refresh-Token, Web-Login unverändert', async () => {
  const u = await newUser();
  const web = await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort123' } });
  assert.equal(web.status, 200);
  assert.ok(web.body.token);
  assert.equal(web.body.refreshToken, undefined, 'Web-App bekommt kein Refresh-Token');

  const app = await appLogin(u.email);
  assert.equal(app.status, 200, JSON.stringify(app.body));
  assert.ok(app.body.token && app.body.refreshToken);
  assert.equal(app.body.expiresIn, 1800);
  assert.equal(app.body.session.name, 'iPhone Test');
  assert.equal(app.body.session.platform, 'ios');
  assert.equal(app.body.user.email, u.email);
  const payload = JSON.parse(Buffer.from(app.body.token.split('.')[1], 'base64url').toString());
  assert.equal(payload.sid, app.body.session.id);
  assert.ok(payload.exp - payload.iat <= 1800);
  // Nur der Hash steht in der Datenbank
  const db = await pool.query('SELECT token_hash FROM device_refresh_tokens WHERE session_id = $1', [app.body.session.id]);
  assert.equal(db.rowCount, 1);
  assert.notEqual(db.rows[0].token_hash, app.body.refreshToken);

  assert.equal((await api('GET', '/whoami', { token: app.body.token })).status, 200);
  // Verlängern über /auth/refresh ist der Web-App vorbehalten
  assert.equal((await api('POST', '/auth/refresh', { token: app.body.token })).body.error, 'use_session_refresh');

  assert.equal((await appLogin(u.email, { name: 'x', platform: 'windows' })).body.error, 'invalid_device_platform');
});

test('Registrierung aus der App legt gleich eine Gerätesitzung an', async () => {
  const r = await api('POST', '/auth/register', { body: { email: `geraet-${unique()}@example.test`, password: 'Passwort123', device: DEVICE } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.refreshToken);
  assert.equal(r.body.session.platform, 'ios');
  assert.equal((await api('GET', '/whoami', { token: r.body.token })).status, 200);
});

test('Refresh: Rotation, gleichzeitige Anfrage, Wiederverwendung beendet die Sitzung', async () => {
  const u = await newUser();
  const a = (await appLogin(u.email)).body;
  const r1 = await api('POST', '/auth/session/refresh', { body: { refreshToken: a.refreshToken, appVersion: '0.2.1' } });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.notEqual(r1.body.refreshToken, a.refreshToken);
  assert.equal((await api('GET', '/whoami', { token: r1.body.token })).status, 200);
  const liste = (await api('GET', '/auth/sessions', { token: r1.body.token })).body;
  assert.equal(liste.data[0].app_version, '0.2.1');

  // Gleich danach noch einmal mit dem alten Token (zweite Anfrage derselben App): Fehler, Sitzung bleibt
  const doppelt = await api('POST', '/auth/session/refresh', { body: { refreshToken: a.refreshToken } });
  assert.deepEqual([doppelt.status, doppelt.body.error], [401, 'refresh_token_already_used']);
  assert.equal((await api('GET', '/whoami', { token: r1.body.token })).status, 200);

  // Später noch einmal: vermutlich gestohlen, die ganze Sitzung endet
  await pool.query("UPDATE device_refresh_tokens SET used_at = now() - interval '5 minutes' WHERE session_id = $1 AND used_at IS NOT NULL", [a.session.id]);
  const dieb = await api('POST', '/auth/session/refresh', { body: { refreshToken: a.refreshToken } });
  assert.deepEqual([dieb.status, dieb.body.error], [401, 'refresh_token_reused']);
  assert.equal((await api('GET', '/whoami', { token: r1.body.token })).body.error, 'session_revoked');
  assert.equal((await api('POST', '/auth/session/refresh', { body: { refreshToken: r1.body.refreshToken } })).body.error, 'session_revoked');

  assert.equal((await api('POST', '/auth/session/refresh', { body: { refreshToken: 'x'.repeat(43) } })).body.error, 'invalid_refresh_token');
  assert.equal((await api('POST', '/auth/session/refresh', { body: {} })).status, 400);
});

test('Lange nicht genutzte Sitzung läuft ab', async () => {
  const u = await newUser();
  const a = (await appLogin(u.email)).body;
  await pool.query("UPDATE device_sessions SET last_used_at = now() - interval '200 days' WHERE id = $1", [a.session.id]);
  assert.equal((await api('POST', '/auth/session/refresh', { body: { refreshToken: a.refreshToken } })).body.error, 'session_expired');
});

test('Geräteliste und einzelnes Gerät abmelden', async () => {
  const u = await newUser();
  const iphone = (await appLogin(u.email)).body;
  const ipad = (await appLogin(u.email, { name: 'iPad', platform: 'ios' })).body;
  const fremd = (await appLogin((await newUser()).email)).body;

  const liste = await api('GET', '/auth/sessions', { token: iphone.token });
  assert.equal(liste.status, 200);
  assert.equal(liste.body.pagination.total, 2);
  assert.deepEqual(liste.body.data.map((s) => [s.name, s.current]).sort(), [['iPad', false], ['iPhone Test', true]]);
  // Die Web-App sieht die Geräte auch (ohne eigene Sitzung)
  assert.equal((await api('GET', '/auth/sessions', { token: u.webToken })).body.data.every((s) => !s.current), true);

  // Fremde Sitzung: nicht gefunden; Web-App ohne Sitzung kann "current" nicht abmelden
  assert.equal((await api('DELETE', `/auth/sessions/${fremd.session.id}`, { token: iphone.token })).status, 404);
  assert.equal((await api('DELETE', '/auth/sessions/current', { token: u.webToken })).body.error, 'no_device_session');

  assert.equal((await api('DELETE', `/auth/sessions/${ipad.session.id}`, { token: iphone.token })).status, 204);
  assert.equal((await api('GET', '/whoami', { token: ipad.token })).body.error, 'session_revoked');
  assert.equal((await api('POST', '/auth/session/refresh', { body: { refreshToken: ipad.refreshToken } })).body.error, 'session_revoked');
  assert.equal((await api('GET', '/auth/sessions', { token: iphone.token })).body.pagination.total, 1);

  // Abmelden in der App
  assert.equal((await api('DELETE', '/auth/sessions/current', { token: iphone.token })).status, 204);
  assert.equal((await api('GET', '/whoami', { token: iphone.token })).status, 401);
  assert.equal((await api('GET', '/whoami', { token: fremd.token })).status, 200);
});

test('Auf allen Geräten abmelden und Passwortänderung beenden alle Gerätesitzungen', async () => {
  const u = await newUser();
  const a = (await appLogin(u.email)).body;
  const b = (await appLogin(u.email, { name: 'Pixel', platform: 'android' })).body;
  await new Promise((r) => setTimeout(r, 1100));

  // Passwort in der App ändern: alle anderen Geräte raus, die App bekommt eine neue Sitzung
  const pw = await api('POST', '/auth/password', { token: a.token, body: { currentPassword: 'Passwort123', newPassword: 'Passwort456' } });
  assert.equal(pw.status, 200, JSON.stringify(pw.body));
  assert.ok(pw.body.refreshToken);
  assert.equal(pw.body.session.name, 'iPhone Test');
  assert.equal((await api('GET', '/whoami', { token: b.token })).status, 401);
  assert.equal((await api('POST', '/auth/session/refresh', { body: { refreshToken: b.refreshToken } })).body.error, 'session_revoked');
  assert.equal((await api('GET', '/whoami', { token: pw.body.token })).status, 200);
  assert.equal((await api('POST', '/auth/session/refresh', { body: { refreshToken: pw.body.refreshToken } })).status, 200);

  // revoke-all (Web-App „Auf allen Geräten abmelden“)
  const c = (await appLogin(u.email, DEVICE, 'Passwort456')).body;
  const web = (await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort456' } })).body.token;
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await api('POST', `/auth/users/${u.id}/revoke-all`, { token: web, body: { reason: 'test' } })).status, 201);
  assert.equal((await api('POST', '/auth/session/refresh', { body: { refreshToken: c.refreshToken } })).body.error, 'session_revoked');
  assert.equal((await api('GET', '/whoami', { token: web })).status, 401);
});

test('2FA: Gerät aus dem ersten Schritt gilt auch für den zweiten', async () => {
  const u = await newUser();
  const setup = await api('POST', '/auth/mfa/setup', { token: u.webToken });
  const secret = setup.body.secret;
  assert.equal((await api('POST', '/auth/mfa/enable', { token: u.webToken, body: { code: totp(secret, -1) } })).status, 200);

  const schritt1 = await appLogin(u.email);
  assert.equal(schritt1.body.error, 'mfa_required');
  const schritt2 = await api('POST', '/auth/login/mfa', { body: { mfaToken: schritt1.body.mfaToken, code: totp(secret, 0) } });
  assert.equal(schritt2.status, 200, JSON.stringify(schritt2.body));
  assert.ok(schritt2.body.refreshToken);
  assert.equal(schritt2.body.session.name, 'iPhone Test');

  // Web-App: unverändert ohne Gerät
  const w1 = await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort123' } });
  const w2 = await api('POST', '/auth/login/mfa', { body: { mfaToken: w1.body.mfaToken, code: totp(secret, 1) } });
  assert.equal(w2.status, 200, JSON.stringify(w2.body));
  assert.equal(w2.body.refreshToken, undefined);
});
