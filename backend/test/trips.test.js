// Fahrtenbuch (#52) gegen die Testdatenbank.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
delete process.env.PLAN_LIMITS_ENABLED;
delete process.env.MAIL_DEFAULT_USER_ID;

if (!process.env.DATABASE_URL) {
  test('Fahrtenbuch-Tests übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}

const { app, pool } = require('../src/server');
const { summarize, toCsv, parseTrip } = require('../src/services/trips');
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
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const unique = () => crypto.randomBytes(6).toString('hex');
async function konto(name = 'fahrer') {
  const email = `${name}-${unique()}@example.test`;
  const r = await api('POST', '/auth/register', { body: { email, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { email, token: r.body.token, id: r.body.user.id };
}
async function fahrzeug(token) {
  return (await api('POST', '/vehicles', { token, body: { name: `Auto ${unique()}`, fuelType: 'diesel', odometerKm: 10000 } })).body.id;
}

test('parseTrip: Strecke aus Tachoständen oder angegeben, Prüfungen', () => {
  assert.equal(parseTrip({ odometerStart: 100, odometerEnd: 142 }).values.distance_km, 42);
  const nurKm = parseTrip({ odometerEnd: 500, distanceKm: 20 }).values;
  assert.equal(nurKm.odometer_start, 480, 'Start aus Ende minus Strecke');
  assert.equal(parseTrip({ odometerEnd: 500, distanceKm: 12.5 }).values.odometer_start, null, 'krumme Strecke: Start offen');
  assert.equal(parseTrip({ odometerStart: 200, odometerEnd: 100 }).error, 'invalid_odometerStart');
  assert.equal(parseTrip({ odometerEnd: 100 }).error, 'invalid_distanceKm');
  assert.equal(parseTrip({ distanceKm: 5 }).error, 'invalid_odometerEnd');
  assert.equal(parseTrip({ odometerEnd: 100, distanceKm: 5, purpose: 'urlaub' }).error, 'invalid_purpose');
  assert.equal(parseTrip({ odometerEnd: 100, distanceKm: 5, startedAt: '2026-01-02T10:00:00Z', endedAt: '2026-01-02T09:00:00Z' }).error, 'invalid_endedAt');
});

test('Auswertung und CSV', () => {
  const liste = [
    { started_at: '2026-01-10T08:00:00Z', distance_km: 30, purpose: 'business', start_place: 'A', end_place: 'B', odometer_start: 1, odometer_end: 31, created_by_name: 'x', note: '=HYPERLINK("böse")' },
    { started_at: '2026-01-20T08:00:00Z', distance_km: 10, purpose: 'private', odometer_end: 41, created_by_name: 'x' },
    { started_at: '2026-02-01T08:00:00Z', distance_km: 60, purpose: 'commute', odometer_end: 101, created_by_name: 'x' }
  ];
  const s = summarize(liste, { costPerKm: { total: 0.25 } });
  assert.equal(s.totalKm, 100);
  assert.equal(s.businessShare, 30);
  assert.equal(s.byPurpose.commute.estimatedCost, 15);
  assert.deepEqual(s.months.map((m) => m.month), ['2026-01', '2026-02']);
  assert.equal(s.months[0].business, 30);
  const csv = toCsv(liste, { costPerKm: 0.25 });
  assert.ok(csv.startsWith('﻿Datum;'));
  assert.ok(csv.includes(`"'=HYPERLINK(""böse"")"`), 'Formel entschärft');
  assert.ok(csv.includes(';Dienstlich;'));
  assert.ok(csv.includes(';7,50;'), 'Kosten 30 km × 0,25 €');
});

test('Fahrten: anlegen, auflisten, filtern, ändern, löschen, Tachostand', async () => {
  const u = await konto();
  const v = await fahrzeug(u.token);
  const t1 = await api('POST', '/trips', { token: u.token, body: {
    vehicleId: v, startedAt: '2026-03-02T07:30:00Z', endedAt: '2026-03-02T08:10:00Z', odometerStart: 10000, odometerEnd: 10042,
    startPlace: 'Bolbingen', endPlace: 'Aalen', purpose: 'business', note: 'Kunde'
  } });
  assert.equal(t1.status, 201, JSON.stringify(t1.body));
  assert.equal(t1.body.distance_km, 42);
  assert.equal(t1.body.created_by, u.id);
  assert.deepEqual(t1.body.warnings, []);
  const t2 = await api('POST', '/trips', { token: u.token, body: { vehicleId: v, startedAt: '2025-12-24T10:00:00Z', odometerEnd: 9990, distanceKm: 15, purpose: 'private' } });
  assert.equal(t2.status, 201);

  assert.equal((await api('GET', `/vehicles/${v}/trips`, { token: u.token })).body.length, 2);
  assert.equal((await api('GET', `/vehicles/${v}/trips?year=2026`, { token: u.token })).body.length, 1);
  assert.equal((await api('GET', `/vehicles/${v}/trips?purpose=private`, { token: u.token })).body[0].id, t2.body.id);
  assert.equal((await api('GET', `/vehicles/${v}/trips?purpose=urlaub`, { token: u.token })).status, 400);

  // Fahrten liefern den aktuellen Tachostand
  assert.equal((await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body.currentOdo, 10042);

  const sum = await api('GET', `/vehicles/${v}/trips/summary?year=2026`, { token: u.token });
  assert.equal(sum.status, 200);
  assert.equal(sum.body.totalKm, 42);
  assert.equal(sum.body.businessShare, 100);
  assert.equal(sum.body.canExport, true, 'ohne Tarifgrenzen volle Rechte');

  const p = await api('PATCH', `/trips/${t1.body.id}`, { token: u.token, body: { odometerEnd: 10050, purpose: 'commute' } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.distance_km, 50);
  assert.equal(p.body.purpose, 'commute');

  const csv = await api('GET', `/vehicles/${v}/trips/export?year=2026`, { token: u.token });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(String(csv.body).includes('Bolbingen'));

  assert.equal((await api('DELETE', `/trips/${t2.body.id}`, { token: u.token })).status, 204);
  assert.equal((await api('GET', `/trips/${t2.body.id}`, { token: u.token })).status, 404);
});

test('Fahrten: Rechte für Fremde und geteilte Fahrzeuge (#53)', async () => {
  const a = await konto('besitzer');
  const b = await konto('mitfahrer');
  const c = await konto('ansehen');
  const d = await konto('fremd');
  const v = await fahrzeug(a.token);
  const tA = (await api('POST', '/trips', { token: a.token, body: { vehicleId: v, odometerEnd: 10100, distanceKm: 100 } })).body;
  for (const [t, role] of [[b, 'editor'], [c, 'viewer']]) {
    const inv = await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: t.email, role } });
    assert.equal((await api('POST', `/invitations/${inv.body.id}/accept`, { token: t.token })).status, 200);
  }
  // Fremde: nichts
  assert.equal((await api('GET', `/vehicles/${v}/trips`, { token: d.token })).status, 404);
  assert.equal((await api('GET', `/trips/${tA.id}`, { token: d.token })).status, 404);
  assert.equal((await api('POST', '/trips', { token: d.token, body: { vehicleId: v, odometerEnd: 10200, distanceKm: 100 } })).status, 404);
  assert.equal((await api('DELETE', `/trips/${tA.id}`, { token: d.token })).status, 404);
  // Mitfahrer: erfassen, eigene ändern, fremde nicht
  const tB = await api('POST', '/trips', { token: b.token, body: { vehicleId: v, odometerEnd: 10200, distanceKm: 100, purpose: 'business' } });
  assert.equal(tB.status, 201);
  assert.equal((await api('PATCH', `/trips/${tB.body.id}`, { token: b.token, body: { note: 'ok' } })).status, 200);
  assert.equal((await api('PATCH', `/trips/${tA.id}`, { token: b.token, body: { note: 'nein' } })).body.error, 'entry_not_editable');
  // Nur ansehen
  assert.equal((await api('GET', `/vehicles/${v}/trips/summary`, { token: c.token })).body.totalKm, 200);
  assert.equal((await api('POST', '/trips', { token: c.token, body: { vehicleId: v, odometerEnd: 10300, distanceKm: 100 } })).body.error, 'read_only');
  // Besitzer ändert alle
  assert.equal((await api('PATCH', `/trips/${tB.body.id}`, { token: a.token, body: { note: 'Chef' } })).status, 200);
});

test('Fahrtenbuch im Free-Tarif: zwei Zwecke, kein Export', async () => {
  const u = await konto('free');
  const v = await fahrzeug(u.token);
  process.env.PLAN_LIMITS_ENABLED = 'true';
  try {
    assert.equal((await api('POST', '/trips', { token: u.token, body: { vehicleId: v, odometerEnd: 10100, distanceKm: 100, purpose: 'business' } })).status, 201);
    const arbeitsweg = await api('POST', '/trips', { token: u.token, body: { vehicleId: v, odometerEnd: 10200, distanceKm: 100, purpose: 'commute' } });
    assert.equal(arbeitsweg.status, 403);
    assert.equal(arbeitsweg.body.feature, 'tripCategories');
    const exp = await api('GET', `/vehicles/${v}/trips/export`, { token: u.token });
    assert.equal(exp.status, 403);
    assert.equal(exp.body.feature, 'tripExport');
    const sum = (await api('GET', `/vehicles/${v}/trips/summary`, { token: u.token })).body;
    assert.deepEqual(sum.allowedPurposes, ['private', 'business']);
    assert.equal(sum.canExport, false);
  } finally {
    delete process.env.PLAN_LIMITS_ENABLED;
  }
});

test('Übernommene alte Fahrten stehen nicht doppelt in der Ausgabenliste', async () => {
  const u = await konto('alt');
  const v = await fahrzeug(u.token);
  const alt = await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Fahrt', amountEur: 0, odometerKm: 10042, description: 'A → B – Arbeit (42 km)' } });
  assert.equal(alt.status, 201, JSON.stringify(alt.body));
  await pool.query(
    `INSERT INTO trips (vehicle_id, user_id, started_at, odometer_end, distance_km, legacy_expense_id) VALUES ($1, $2, now(), 10042, 42, $3)`,
    [v, u.id, alt.body.id]
  );
  const liste = (await api('GET', `/vehicles/${v}/entries`, { token: u.token })).body;
  assert.ok(!liste.some((e) => e.id === alt.body.id));
  assert.equal((await api('GET', `/vehicles/${v}/trips`, { token: u.token })).body.length, 1);
});
