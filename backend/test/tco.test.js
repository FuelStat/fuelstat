// Gesamtkosten (TCO) und Wertverlust (#79). Eigene Datei (eigener Prozess).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

if (!process.env.DATABASE_URL) {
  test('TCO übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
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
async function newUser() {
  const r = await api('POST', '/auth/register', { body: { email: `tco-${unique()}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token };
}
async function newVehicle(token, extra = {}) {
  const r = await api('POST', '/vehicles', { token, body: { name: `Auto ${unique()}`, fuelType: 'e10', ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const expense = (token, vehicleId, category, amountEur, occurredAt, odometerKm) =>
  api('POST', '/entries', { token, body: { vehicleId, category, amountEur, occurredAt, ...(odometerKm ? { odometerKm } : {}) } });
const fillup = (token, vehicleId, odometerKm, totalCostEur, filledAt) =>
  api('POST', '/fillups', { token, body: { vehicleId, odometerKm, amount: 40, totalCostEur, filledAt } });

test('TCO ohne Angaben: laufende Kosten ja, Wertverlust null, nicht vollständig', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  const leer = (await api('GET', `/vehicles/${v.id}/tco`, { token: u.token })).body;
  assert.equal(leer.total, 0);
  assert.equal(leer.valueLoss, null);
  assert.equal(leer.complete, false);
  assert.equal(leer.perMonth, null);
  assert.equal(leer.perKm, null);
  await expense(u.token, v.id, 'Versicherung', 600, '2026-01-10T10:00:00Z');
  await expense(u.token, v.id, 'Wartung', 400, '2026-03-10T10:00:00Z', 10500);
  await fillup(u.token, v.id, 10000, 50, '2026-02-01T10:00:00Z');
  await fillup(u.token, v.id, 11000, 70, '2026-04-01T10:00:00Z');
  const t = (await api('GET', `/vehicles/${v.id}/tco`, { token: u.token })).body;
  assert.equal(t.running.total, 1120);
  assert.equal(t.total, 1120, 'ohne Wertverlust nur die laufenden Kosten');
  assert.equal(t.complete, false);
  assert.equal(t.valueLoss, null);
  assert.equal(t.distanceKm, 1000);
  assert.equal(t.perKm, 1.12);
  assert.equal(t.from, '2026-01-10', 'ohne Kaufdatum: erster Eintrag');
  assert.ok(t.perMonth > 0);
  const gruppen = Object.fromEntries(t.running.groups.map((g) => [g.key, g.total]));
  assert.deepEqual([gruppen.fix, gruppen.wartung, gruppen.kraftstoff], [600, 400, 120]);
  assert.deepEqual(t.shares.map((s) => s.key), ['fix', 'wartung', 'kraftstoff']);
  assert.equal(t.shares.reduce((s, x) => s + x.share, 0).toFixed(0), '100');
});

test('TCO mit Kaufpreis und Restwert: Wertverlust, pro Jahr, Anteil', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token, { purchaseDate: '2024-01-01', purchasePrice: 20000 });
  await expense(u.token, v.id, 'Versicherung', 1000, '2024-06-01T10:00:00Z');
  const ohne = (await api('GET', `/vehicles/${v.id}/tco`, { token: u.token })).body;
  assert.equal(ohne.valueLoss, null, 'Kaufpreis allein reicht nicht, nichts wird geschätzt');
  assert.equal(ohne.complete, false);
  assert.equal(ohne.purchase.price, 20000);
  const r = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { residualValue: 14000 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = (await api('GET', `/vehicles/${v.id}/tco`, { token: u.token })).body;
  assert.equal(t.valueLoss, 6000);
  assert.equal(t.valueBasis, 'residual');
  assert.equal(t.total, 7000);
  assert.equal(t.complete, true);
  assert.equal(t.from, '2024-01-01');
  assert.ok(t.valueLossPerYear > 0 && t.valueLossPerYear < 6000);
  assert.deepEqual(t.shares[0].key, 'wertverlust');
  assert.equal(t.shares[0].share, 85.7);
  assert.equal((await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { residualValue: -1 } })).body.error, 'invalid_residualValue');
});

test('TCO verkauft: Erlös statt Restwert, Besitzzeit endet am Verkaufsdatum, /costs-Monate ebenso', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token, { purchaseDate: '2023-01-01', purchasePrice: 15000, residualValue: 1 });
  await expense(u.token, v.id, 'Steuer', 120, '2023-02-01T10:00:00Z');
  const verkauf = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { status: 'sold', saleDate: '2023-12-31', salePrice: 11000, saleOdometerKm: 30000 } });
  assert.equal(verkauf.status, 200, JSON.stringify(verkauf.body));
  const t = (await api('GET', `/vehicles/${v.id}/tco`, { token: u.token })).body;
  assert.equal(t.valueBasis, 'sale');
  assert.equal(t.valueLoss, 4000, 'Restwert zählt bei verkauften Fahrzeugen nicht');
  assert.equal(t.residualValue, null);
  assert.equal(t.to, '2023-12-31');
  assert.equal(t.ownershipDays, 365);
  assert.equal(t.sale.odometerKm, 30000);
  assert.equal(t.total, 4120);
  assert.ok(Math.abs(t.valueLossPerYear - 4000) < 5, 'ein Jahr Besitzzeit, rund 4.000 € pro Jahr');
  assert.ok(Math.abs(t.perMonth - 4120 / 12) < 0.02);
  // Archiviert bleibt lesbar
  assert.equal((await api('GET', `/vehicles/${v.id}/tco`, { token: u.token })).status, 200);
  // Ø je Monat in /costs zählt nur bis zum Verkaufsmonat (Februar bis Dezember 2023 = 11 Monate)
  const kosten = (await api('GET', `/vehicles/${v.id}/costs`, { token: u.token })).body;
  assert.equal(kosten.monthCount, 11);
});

test('TCO: Verkauf ohne Erlös bleibt unvollständig; Zugriff nur für berechtigte Konten', async () => {
  const u = await newUser();
  const fremd = await newUser();
  const v = await newVehicle(u.token, { purchasePrice: 9000 });
  await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { status: 'sold' } });
  const t = (await api('GET', `/vehicles/${v.id}/tco`, { token: u.token })).body;
  assert.equal(t.valueLoss, null);
  assert.equal(t.complete, false);
  assert.equal((await api('GET', `/vehicles/${v.id}/tco`, { token: fremd.token })).status, 404);
  assert.equal((await api('GET', `/vehicles/${v.id}/tco`)).status, 401);
  assert.equal((await api('GET', '/vehicles/kein-uuid/tco', { token: u.token })).status, 404);
});
