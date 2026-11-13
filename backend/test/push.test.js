// Push-Benachrichtigungen (#136): Geräte, Kanäle je Anlass, Versand über ein Test-Double des Push-Dienstes.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const push = require('../src/services/push');

const fcm = () => `https://fcm.googleapis.com/fcm/send/${crypto.randomBytes(12).toString('hex')}`;
const keys = () => ({ p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });

test('Push-Adressen: nur https und bekannte Push-Dienste', () => {
  assert.equal(push.validEndpoint(fcm()), true);
  assert.equal(push.validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
  assert.equal(push.validEndpoint('https://web.push.apple.com/QGx'), true);
  assert.equal(push.validEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'), true);
  assert.equal(push.validEndpoint('http://fcm.googleapis.com/fcm/send/x'), false);
  assert.equal(push.validEndpoint('https://127.0.0.1/x'), false);
  assert.equal(push.validEndpoint('https://evil.example/fcm.googleapis.com'), false);
  assert.equal(push.validEndpoint('https://fcm.googleapis.com.evil.example/x'), false);
  assert.equal(push.validEndpoint('https://fcm.googleapis.com:8443/x'), false);
  assert.equal(push.parseDevice({ endpoint: fcm(), keys: { p256dh: 'kurz', auth: 'x' } }).error, 'invalid_keys');
  assert.equal(push.parseDevice({ kind: 'apns', endpoint: fcm(), keys: keys() }).error, 'unsupported_kind');
});

test('Push-Texte für Termine: einer, mehrere', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x@localhost/x';
  const { reminderPush } = require('../src/services/notifier');
  const t = (status, days, vehicle = 'Golf', id = 'v1', title = 'HU') => ({ status, days, vehicle, vehicle_id: id, title });
  assert.deepEqual(reminderPush([t('bald', 12)]), { title: 'Termin bald fällig', body: 'Golf: HU – fällig in 12 Tagen', url: 'pages/fahrzeug_detail.php?id=v1', tag: 'termine', badge: 1, ttl: 259200, urgency: 'normal' });
  assert.equal(reminderPush([t('ueberfaellig', -3)]).title, 'Termin überfällig');
  const viele = reminderPush([t('bald', 1), t('ueberfaellig', -1, 'Polo', 'v2', 'Ölwechsel'), t('bald', 5), t('bald', 9)]);
  assert.equal(viele.title, '4 Termine, davon überfällige');
  assert.equal(viele.body, 'Golf: HU · Polo: Ölwechsel · Golf: HU …');
  assert.equal(viele.url, '', 'mehrere Fahrzeuge: Startseite');
  assert.equal(viele.badge, 4);
  assert.equal(viele.urgency, 'high', 'überfällig: hohe Dringlichkeit');
});

test('VAPID-JWT je Push-Dienst zwischengespeichert, Fehlergrund lesbar', () => {
  const k = require('web-push').generateVAPIDKeys();
  const cfg = { publicKey: k.publicKey, privateKey: k.privateKey, subject: 'mailto:test@example.test' };
  const t0 = Date.now();
  const a = push.vapidAuthorization('https://web.push.apple.com/abc', cfg, t0);
  assert.equal(push.vapidAuthorization('https://web.push.apple.com/xyz', cfg, t0 + 60 * 60 * 1000), a, 'eine Stunde später derselbe JWT');
  assert.notEqual(push.vapidAuthorization('https://fcm.googleapis.com/fcm/send/x', cfg, t0), a, 'anderer Push-Dienst, eigener JWT');
  assert.notEqual(push.vapidAuthorization('https://web.push.apple.com/abc', cfg, t0 + 7 * 60 * 60 * 1000), a, 'nach 6 Stunden neu');
  const jwt = JSON.parse(Buffer.from(a.split(' ')[1].slice(2).split('.')[1], 'base64url').toString());
  assert.equal(jwt.aud, 'https://web.push.apple.com');
  assert.equal(push.fehlerText({ statusCode: 403, body: '{"reason":"BadJwtToken"}' }), 'HTTP 403 BadJwtToken');
  assert.equal(push.fehlerText({ statusCode: 503, body: '' }), 'HTTP 503');
});

if (!process.env.DATABASE_URL) {
  test('API-Tests für Push übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('node:os').tmpdir();
delete process.env.PLAN_LIMITS_ENABLED;
process.env.MAIL_DEFAULT_ENABLED = 'false';
const vapid = require('web-push').generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@example.test';

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
const notifier = require('../src/services/notifier');

// Test-Double: merkt sich jede Nachricht; status setzt einen Fehler des Push-Dienstes
const gesendet = [];
let fehlerStatus = null;
push.setSender(async (subscription, payload, options) => {
  if (fehlerStatus) { const e = new Error('push failed'); e.statusCode = fehlerStatus; throw e; }
  assert.match(options.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  gesendet.push({ endpoint: subscription.endpoint, ...JSON.parse(payload), optionen: { TTL: options.TTL, urgency: options.urgency, topic: options.topic } });
});
test.after(() => push.setSender(null));

async function newUser() {
  const r = await api('POST', '/auth/register', { body: { email: `push-${unique()}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
  return { token: r.body.token, id: r.body.user.id };
}
const lauf = async (userId, now = new Date()) => notifier.notifyUser(pool, await notifier.loadUserSettings(pool, userId, null), now);

test('Geräte anmelden, auflisten, abmelden', async () => {
  const u = await newUser();
  const cfg = await api('GET', '/push/config', { token: u.token });
  assert.deepEqual(cfg.body, { enabled: true, vapidPublicKey: process.env.VAPID_PUBLIC_KEY });

  const endpoint = fcm();
  const d = await api('POST', '/push/devices', { token: u.token, body: { kind: 'webpush', endpoint, keys: keys(), name: 'Pixel (Chrome)' } });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.name, 'Pixel (Chrome)');
  assert.equal(d.body.endpoint, undefined, 'Adresse geht nicht zurück');
  // Gleiche Adresse noch einmal: kein zweites Gerät
  assert.equal((await api('POST', '/push/devices', { token: u.token, body: { endpoint, keys: keys() } })).status, 201);
  const liste = await api('GET', '/push/devices', { token: u.token });
  assert.equal(liste.body.pagination.total, 1);
  assert.equal(liste.body.data[0].name, 'Pixel (Chrome)');

  assert.equal((await api('POST', '/push/devices', { token: u.token, body: { endpoint: 'https://127.0.0.1/x', keys: keys() } })).body.error, 'invalid_endpoint');
  // Fremdes Gerät lässt sich nicht löschen
  const fremd = await newUser();
  assert.equal((await api('DELETE', `/push/devices/${d.body.id}`, { token: fremd.token })).status, 404);
  assert.equal((await api('DELETE', '/push/devices', { token: u.token, body: { endpoint } })).status, 204);
  assert.equal((await api('GET', '/push/devices', { token: u.token })).body.pagination.total, 0);
});

test('Kanäle je Anlass: lesen, teilweise ändern, ohne Mailserver keine E-Mail', async () => {
  const u = await newUser();
  let p = await api('GET', '/notifications/preferences', { token: u.token });
  assert.equal(p.status, 200);
  assert.deepEqual(Object.keys(p.body.occasions), ['reminders', 'odometer', 'report', 'inactive']);
  assert.equal(p.body.push_available, true);
  assert.equal(p.body.email_available, false);
  p = await api('PUT', '/notifications/preferences', { token: u.token, body: { occasions: { reminders: { push: true }, inactive: { push: true } } } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(p.body.occasions.reminders, { email: false, push: true });
  assert.deepEqual(p.body.occasions.inactive, { email: false, push: true });
  assert.deepEqual(p.body.occasions.report, { email: false, push: false });
  assert.equal((await api('PUT', '/notifications/preferences', { token: u.token, body: { occasions: { report: { email: true } } } })).body.error, 'mail_not_configured');
  assert.equal((await api('PUT', '/notifications/preferences', { token: u.token, body: { occasions: { wetter: { push: true } } } })).body.error, 'invalid_occasions');
  assert.equal((await api('PUT', '/notifications/preferences', { token: u.token, body: { occasions: { report: { push: 'ja' } } } })).body.error, 'invalid_occasions');
});

test('Versand: lange kein Eintrag und Kilometerstand per Push, je Anlass nur einmal', async () => {
  const u = await newUser();
  const v = (await api('POST', '/vehicles', { token: u.token, body: { name: 'Pushauto', fuelType: 'e10' } })).body.id;
  const alt = new Date(Date.now() - 40 * 86400000).toISOString();
  assert.equal((await api('POST', '/fillups', { token: u.token, body: { vehicleId: v, odometerKm: 1000, amount: 40, totalCostEur: 70, filledAt: alt } })).status, 201);
  await api('POST', '/push/devices', { token: u.token, body: { endpoint: fcm(), keys: keys(), name: 'Handy' } });
  await api('PUT', '/notifications/preferences', { token: u.token, body: { occasions: { inactive: { push: true }, odometer: { push: true } } } });

  gesendet.length = 0;
  await lauf(u.id);
  assert.equal(gesendet.length, 1, JSON.stringify(gesendet));
  assert.equal(gesendet[0].title, 'Lange kein Eintrag');
  assert.match(gesendet[0].body, /^Pushauto: seit 40 Tagen nichts erfasst$/);
  assert.equal(gesendet[0].url, `pages/eintrag_hinzufuegen.php?fahrzeug_id=${v}`);
  assert.deepEqual(gesendet[0].optionen, { TTL: 3 * 86400, urgency: 'low', topic: 'inaktiv' });
  await lauf(u.id);
  assert.equal(gesendet.length, 1, 'kein zweites Mal');

  // Tankfüllung ohne Kilometerstand, vor 4 Stunden erfasst
  const f = await api('POST', '/fillups', { token: u.token, body: { vehicleId: v, amount: 30, totalCostEur: 50, filledAt: new Date(Date.now() - 5 * 3600000).toISOString() } });
  assert.equal(f.status, 201, JSON.stringify(f.body));
  await pool.query("UPDATE fillups SET created_at = now() - interval '4 hours' WHERE id = $1", [f.body.id]);
  await lauf(u.id);
  assert.equal(gesendet.length, 2, JSON.stringify(gesendet));
  assert.equal(gesendet[1].title, 'Kilometerstand nachtragen');
  assert.match(gesendet[1].url, /^pages\/tachostand_nachtragen\.php\?id=/);
});

test('Abgemeldete Geräte (410) werden gelöscht, der Anlass kommt später noch einmal', async () => {
  const u = await newUser();
  const v = (await api('POST', '/vehicles', { token: u.token, body: { name: 'Altgerät', fuelType: 'e10' } })).body.id;
  await api('POST', '/fillups', { token: u.token, body: { vehicleId: v, odometerKm: 500, amount: 20, totalCostEur: 30, filledAt: new Date(Date.now() - 50 * 86400000).toISOString() } });
  await api('POST', '/push/devices', { token: u.token, body: { endpoint: fcm(), keys: keys() } });
  await api('PUT', '/notifications/preferences', { token: u.token, body: { occasions: { inactive: { push: true } } } });

  fehlerStatus = 410;
  try {
    await lauf(u.id);
  } finally {
    fehlerStatus = null;
  }
  assert.equal((await api('GET', '/push/devices', { token: u.token })).body.pagination.total, 0);
  const log = await pool.query("SELECT 1 FROM mail_log WHERE user_id = $1 AND kind = 'push:inactive'", [u.id]);
  assert.equal(log.rowCount, 0, 'nicht als verschickt vermerkt');

  // Neues Gerät: jetzt kommt die Nachricht
  gesendet.length = 0;
  await api('POST', '/push/devices', { token: u.token, body: { endpoint: fcm(), keys: keys() } });
  await lauf(u.id);
  assert.equal(gesendet.length, 1);
});

test('Testnachricht', async () => {
  const u = await newUser();
  assert.equal((await api('POST', '/push/test', { token: u.token })).body.error, 'no_push_devices');
  await api('POST', '/push/devices', { token: u.token, body: { endpoint: fcm(), keys: keys() } });
  gesendet.length = 0;
  const r = await api('POST', '/push/test', { token: u.token });
  assert.deepEqual(r.body, { sent: 1, failed: 0, removed: 0 });
  assert.equal(gesendet[0].url, 'pages/benachrichtigungen.php');
});
