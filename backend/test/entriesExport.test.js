// CSV-Export der Einträge (#184). Eigene Datei (eigener Prozess).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { zahl, csvField } = require('../src/services/entriesExport');

test('Format: Zahlen wie PHP number_format, Felder wie fputcsv', () => {
  assert.equal(zahl(12.345, 2), '12,35');
  assert.equal(zahl(1234.5, 2), '1234,50');
  assert.equal(zahl(-0.005, 2), '-0,01');
  assert.equal(zahl(null, 2), '');
  assert.equal(zahl('', 2), '');
  assert.equal(zahl(0, 2), '0,00');
  assert.equal(csvField('Aral'), 'Aral');
  assert.equal(csvField('Aral Aalen'), '"Aral Aalen"', 'Leerzeichen wird wie bei fputcsv eingefasst');
  assert.equal(csvField('a;b'), '"a;b"');
  assert.equal(csvField('sagt "hi"'), '"sagt ""hi"""');
  assert.equal(csvField('zwei\nZeilen'), '"zwei\nZeilen"');
  assert.equal(csvField(null), '');
  assert.equal(csvField(48853), '48853');
});

if (!process.env.DATABASE_URL) {
  test('Export übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
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
async function raw(method, path, { token, body } = {}) {
  return fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}
async function api(method, path, opts) {
  const res = await raw(method, path, opts);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const unique = () => crypto.randomBytes(6).toString('hex');
async function newUser() {
  const r = await api('POST', '/auth/register', { body: { email: `export-${unique()}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token;
}
async function newVehicle(token, body) {
  const r = await api('POST', '/vehicles', { token, body: { name: 'Mein Käfer', fuelType: 'e10', ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const lines = (csv) => csv.replace(/^﻿/, '').trimEnd().split('\n');

test('Export Verbrenner: Kopf, Zeilen aufsteigend, Formeln entschärft, ohne Fahrten, Jahresfilter, Dateiname', async () => {
  const token = await newUser();
  const v = await newVehicle(token);
  await api('POST', '/fillups', { token, body: { vehicleId: v.id, odometerKm: 1000, amount: 40, totalCostEur: 60.5, filledAt: '2025-06-01T10:00:00Z', station: 'Aral Aalen' } });
  await api('POST', '/fillups', { token, body: { vehicleId: v.id, odometerKm: 1500, amount: 30.125, totalCostEur: 45, filledAt: '2026-01-02T10:00:00Z', isFull: false } });
  await api('POST', '/entries', { token, body: { vehicleId: v.id, category: 'Wartung', amountEur: 120, occurredAt: '2025-08-01T10:00:00Z', vendor: '=HYPERLINK("böse")', description: 'Öl; Filter' } });
  await api('POST', '/trips', { token, body: { vehicleId: v.id, startedAt: '2025-09-01T10:00:00Z', odometerEnd: 1200, distanceKm: 20 } });
  const res = await raw('GET', `/vehicles/${v.id}/export`, { token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="Mein_K_fer.csv"');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8-BOM für Excel');
  const csv = bytes.toString('utf8');
  assert.ok(csv.startsWith('\uFEFFDatum;Kategorie;"Tachostand (km)";"Menge (l)";"Kosten (EUR)";Vollgetankt;"Lücke davor";"Verbrauch (l/100km)";Ort/Anbieter;Beschreibung\n'));
  const z = lines(csv);
  assert.equal(z.length, 4, 'Kopf plus drei Einträge, ohne Fahrt');
  assert.ok(z[1].startsWith('01.06.2025;Tankfüllung;1000;40,00;60,50;ja;nein;;"Aral Aalen";'), z[1]);
  assert.ok(z[2].startsWith('01.08.2025;Wartung;;;120,00;;;;"\'=HYPERLINK(""böse"")";"Öl;'), z[2]);
  assert.ok(z[3].startsWith('02.01.2026;Tankfüllung;1500;30,13;45,00;nein;nein;'), z[3]);
  // Jahresfilter und Dateiname
  const j = await raw('GET', `/vehicles/${v.id}/export?year=2026`, { token });
  assert.equal(j.headers.get('content-disposition'), 'attachment; filename="Mein_K_fer_2026.csv"');
  assert.equal(lines(await j.text()).length, 2);
  assert.equal((await api('GET', `/vehicles/${v.id}/export?year=abc`, { token })).body.error, 'invalid_year');
});

test('Export Plug-in-Hybrid: Einheit, Sorte, Ladespalten, Bauteile', async () => {
  const token = await newUser();
  const v = await newVehicle(token, { fuelType: 'phev' });
  await api('POST', '/fillups', { token, body: { vehicleId: v.id, odometerKm: 100, amount: 30, totalCostEur: 50, unit: 'l', filledAt: '2026-02-01T10:00:00Z' } });
  const lade = await api('POST', '/fillups', { token, body: { vehicleId: v.id, odometerKm: 200, amount: 12, totalCostEur: 3.6, unit: 'kwh', filledAt: '2026-02-02T10:00:00Z', chargeType: 'dc', socBeforePct: 20, socAfterPct: 80, chargeMinutes: 35 } });
  assert.equal(lade.status, 201, JSON.stringify(lade.body));
  const e = await api('POST', '/entries', { token, body: { vehicleId: v.id, category: 'Werkstatt', amountEur: 300, occurredAt: '2026-02-03T10:00:00Z', parts: [{ key: 'brake_pads_front' }, { key: 'brake_discs' }] } });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  const csv = await (await raw('GET', `/vehicles/${v.id}/export`, { token })).text();
  const z = lines(csv);
  assert.equal(z[0], 'Datum;Kategorie;"Tachostand (km)";Menge;Sorte;Einheit;"Kosten (EUR)";Voll;"Lücke davor";Ladeart;"Ladestand vorher (%)";"Ladestand nachher (%)";"Ladedauer (min)";"Verbrauch (pro 100km)";Ort/Anbieter;Beschreibung;Bauteile');
  assert.ok(z[1].startsWith('01.02.2026;Tankfüllung;100;30,00;"Super E5";l;50,00;ja;nein;;;;;'), z[1]);
  assert.ok(z[2].startsWith('02.02.2026;Ladevorgang;200;12,00;Strom;kWh;3,60;ja;nein;"Schnelllader, DC";20;80;35;'), z[2]);
  assert.ok(/^03\.02\.2026;Werkstatt;;;;;300,00;.*;"Bremsscheiben \| Bremsbeläge vorn"$/.test(z[3]), z[3]);
});

test('Export: Elektroauto ohne Sorte, nur Mitglieder dürfen, 401 und 404', async () => {
  const token = await newUser();
  const fremd = await newUser();
  const v = await newVehicle(token, { fuelType: 'electric' });
  await api('POST', '/fillups', { token, body: { vehicleId: v.id, odometerKm: 50, amount: 10, totalCostEur: 3, filledAt: '2026-03-01T10:00:00Z' } });
  const csv = await (await raw('GET', `/vehicles/${v.id}/export`, { token })).text();
  assert.ok(lines(csv)[0].startsWith('Datum;Kategorie;"Tachostand (km)";"Menge (kWh)";"Kosten (EUR)";Vollgeladen;"Lücke davor";Ladeart;'));
  assert.equal((await raw('GET', `/vehicles/${v.id}/export`, { token: fremd })).status, 404);
  assert.equal((await raw('GET', `/vehicles/${v.id}/export`)).status, 401);
  assert.equal((await raw('GET', '/vehicles/kein-uuid/export', { token })).status, 404);
  // Archivierte Fahrzeuge bleiben exportierbar
  await api('PATCH', `/vehicles/${v.id}`, { token, body: { status: 'sold' } });
  assert.equal((await raw('GET', `/vehicles/${v.id}/export`, { token })).status, 200);
});
