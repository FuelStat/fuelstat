// Ladevorgänge (#25): Ladeart, Ladestand vorher/nachher, Ladedauer an kWh-Einträgen. Eigene Datei (eigener Prozess).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resolveCharge } = require('../src/services/charging');

test('resolveCharge: Prüfung, Zusammenführen mit dem Bestand, nur kWh', () => {
  assert.deepEqual(resolveCharge({}, null, 'kwh'), { chargeType: null, socBeforePct: null, socAfterPct: null, chargeMinutes: null });
  assert.deepEqual(resolveCharge({ chargeType: 'dc', socBeforePct: 20, socAfterPct: 80, chargeMinutes: 35 }, null, 'kwh'),
    { chargeType: 'dc', socBeforePct: 20, socAfterPct: 80, chargeMinutes: 35 });
  // Bearbeiten: fehlende Schlüssel bleiben, null löscht
  const alt = { charge_type: 'home', soc_before_pct: 30, soc_after_pct: 90, charge_minutes: 120 };
  assert.deepEqual(resolveCharge({ socAfterPct: 80 }, alt, 'kwh'), { chargeType: 'home', socBeforePct: 30, socAfterPct: 80, chargeMinutes: 120 });
  assert.deepEqual(resolveCharge({ chargeType: null, chargeMinutes: null }, alt, 'kwh'), { chargeType: null, socBeforePct: 30, socAfterPct: 90, chargeMinutes: null });
  assert.equal(resolveCharge({ chargeType: 'wallbox' }, null, 'kwh').error, 'invalid_chargeType');
  assert.equal(resolveCharge({ socBeforePct: 101 }, null, 'kwh').error, 'invalid_socBeforePct');
  assert.equal(resolveCharge({ socAfterPct: 55.5 }, null, 'kwh').error, 'invalid_socAfterPct');
  assert.equal(resolveCharge({ socBeforePct: 80, socAfterPct: 60 }, null, 'kwh').error, 'invalid_soc');
  assert.equal(resolveCharge({ socAfterPct: 50 }, { soc_before_pct: 70 }, 'kwh').error, 'invalid_soc', 'auch gegen den Bestand');
  assert.equal(resolveCharge({ chargeMinutes: 0 }, null, 'kwh').error, 'invalid_chargeMinutes');
  assert.equal(resolveCharge({ chargeMinutes: 5000 }, null, 'kwh').error, 'invalid_chargeMinutes');
  // Tanken: neue Angaben sind ein Fehler, vorhandene entfallen (Wechsel von Laden zu Tanken)
  assert.equal(resolveCharge({ chargeType: 'home' }, null, 'l').error, 'charge_fields_kwh_only');
  assert.deepEqual(resolveCharge({}, alt, 'l'), { chargeType: null, socBeforePct: null, socAfterPct: null, chargeMinutes: null });
  assert.deepEqual(resolveCharge({ chargeType: null }, null, 'l'), { chargeType: null, socBeforePct: null, socAfterPct: null, chargeMinutes: null });
});

if (!process.env.DATABASE_URL) {
  test('Ladevorgänge übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
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
async function newUser() {
  const r = await api('POST', '/auth/register', { body: { email: `charging-${unique()}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token;
}
async function newVehicle(token, body) {
  const r = await api('POST', '/vehicles', { token, body: { name: `Auto ${unique()}`, ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test('Ladeangaben anlegen, ändern, löschen; nur an kWh-Einträgen', async () => {
  const token = await newUser();
  const ev = await newVehicle(token, { fuelType: 'electric' });
  const neu = await api('POST', '/fillups', { token, body: { vehicleId: ev.id, odometerKm: 1000, amount: 30, totalCostEur: 9, chargeType: 'dc', socBeforePct: 20, socAfterPct: 80, chargeMinutes: 35 } });
  assert.equal(neu.status, 201, JSON.stringify(neu.body));
  assert.deepEqual([neu.body.charge_type, neu.body.soc_before_pct, neu.body.soc_after_pct, neu.body.charge_minutes], ['dc', 20, 80, 35]);

  // Ohne Angaben bleibt alles leer (alte Clients)
  const alt = await api('POST', '/fillups', { token, body: { vehicleId: ev.id, odometerKm: 1100, amount: 20, totalCostEur: 6 } });
  assert.deepEqual([alt.body.charge_type, alt.body.soc_before_pct, alt.body.soc_after_pct, alt.body.charge_minutes], [null, null, null, null]);

  // Fehler
  for (const [body, fehler] of [
    [{ chargeType: 'schnell' }, 'invalid_chargeType'],
    [{ socBeforePct: 90, socAfterPct: 50 }, 'invalid_soc'],
    [{ chargeMinutes: -3 }, 'invalid_chargeMinutes']
  ]) {
    const r = await api('POST', '/fillups', { token, body: { vehicleId: ev.id, amount: 10, totalCostEur: 3, ...body } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, fehler);
  }

  // Ändern: einzelne Felder, null löscht, nur Ladeangaben zählen als Änderung
  let p = await api('PATCH', `/fillups/${neu.body.id}`, { token, body: { socAfterPct: 90, chargeType: null } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual([p.body.charge_type, p.body.soc_before_pct, p.body.soc_after_pct, p.body.charge_minutes], [null, 20, 90, 35]);
  p = await api('PATCH', `/fillups/${neu.body.id}`, { token, body: { socAfterPct: 10 } });
  assert.equal(p.body.error, 'invalid_soc');

  // Liste und Eintragsliste liefern die Felder
  const liste = (await api('GET', `/vehicles/${ev.id}/fillups`, { token })).body.data.find((f) => f.id === neu.body.id);
  assert.equal(liste.soc_after_pct, 90);
  const zeile = (await api('GET', `/vehicles/${ev.id}/timeline`, { token })).body.data.find((f) => f.id === neu.body.id);
  assert.equal(zeile.charge_minutes, 35);
  const trip = (await api('GET', `/vehicles/${ev.id}/timeline`, { token })).body.data.find((f) => f.type !== 'fillup');
  assert.equal(trip, undefined);

  // Plug-in-Hybrid: Tanken lehnt Ladeangaben ab; Wechsel von Laden zu Tanken löscht sie
  const phev = await newVehicle(token, { fuelType: 'phev' });
  const tank = await api('POST', '/fillups', { token, body: { vehicleId: phev.id, unit: 'l', amount: 30, totalCostEur: 50, chargeType: 'home' } });
  assert.equal(tank.body.error, 'charge_fields_kwh_only');
  const laden = await api('POST', '/fillups', { token, body: { vehicleId: phev.id, unit: 'kwh', amount: 10, totalCostEur: 3, chargeType: 'home', socAfterPct: 100 } });
  assert.equal(laden.status, 201);
  const umgestellt = await api('PATCH', `/fillups/${laden.body.id}`, { token, body: { unit: 'l' } });
  assert.equal(umgestellt.status, 200, JSON.stringify(umgestellt.body));
  assert.deepEqual([umgestellt.body.charge_type, umgestellt.body.soc_after_pct], [null, null]);
});

test('Import: Ladeangaben je Zeile; Tankzeilen mit Ladeangaben werden abgelehnt', async () => {
  const token = await newUser();
  const phev = await newVehicle(token, { fuelType: 'phev' });
  const ok = await api('POST', `/vehicles/${phev.id}/import`, { token, body: { fillups: [
    { filledAt: '2025-03-01T18:00:00Z', odometerKm: 100, amount: 12, totalCostEur: 3.6, unit: 'kwh', chargeType: 'ac_public', socBeforePct: 15, socAfterPct: 70, chargeMinutes: 90 },
    { filledAt: '2025-03-05T10:00:00Z', odometerKm: 200, amount: 30, totalCostEur: 55, unit: 'l' }
  ] } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const f = (await api('GET', `/vehicles/${phev.id}/fillups`, { token })).body.data.find((x) => x.unit === 'kwh');
  assert.deepEqual([f.charge_type, f.soc_before_pct, f.soc_after_pct, f.charge_minutes], ['ac_public', 15, 70, 90]);
  const falsch = await api('POST', `/vehicles/${phev.id}/import`, { token, body: { fillups: [
    { filledAt: '2025-04-01T10:00:00Z', odometerKm: 300, amount: 30, totalCostEur: 55, unit: 'l', socAfterPct: 80 }
  ] } });
  assert.equal(falsch.status, 400);
  assert.equal(falsch.body.rows[0].error, 'charge_fields_kwh_only');
  const ungueltig = await api('POST', `/vehicles/${phev.id}/import`, { token, body: { fillups: [
    { filledAt: '2025-04-02T10:00:00Z', odometerKm: 310, amount: 10, totalCostEur: 3, unit: 'kwh', chargeType: 'zuhause' }
  ] } });
  assert.equal(ungueltig.body.rows[0].error, 'invalid_chargeType');
});

test('Auswertung nach Ladeart: Anteile, Ø Preis, Leistung, Gruppe ohne Angabe, zu Hause gegen unterwegs', async () => {
  const token = await newUser();
  const ev = await newVehicle(token, { fuelType: 'electric' });
  const laden = (data) => api('POST', '/fillups', { token, body: { vehicleId: ev.id, ...data } });
  await laden({ odometerKm: 1000, amount: 30, totalCostEur: 6, chargeType: 'home', chargeMinutes: 300, filledAt: '2025-05-01T10:00:00Z' });
  await laden({ odometerKm: 1200, amount: 30, totalCostEur: 9, chargeType: 'home', filledAt: '2025-05-05T10:00:00Z' });
  await laden({ odometerKm: 1400, amount: 40, totalCostEur: 28, chargeType: 'dc', chargeMinutes: 30, filledAt: '2025-05-10T10:00:00Z' });
  await laden({ odometerKm: 1600, amount: 20, totalCostEur: 10, filledAt: '2025-05-15T10:00:00Z' });
  const c = (await api('GET', `/vehicles/${ev.id}/consumption`, { token })).body.chargeTypes;
  assert.deepEqual(c.total, { count: 4, amount: 120, cost: 53 });
  assert.deepEqual(c.types.map((t) => t.type), ['home', 'dc', null], 'ohne Angabe als eigene Gruppe, AC öffentlich fehlt ohne Ladevorgänge');
  const home = c.types[0];
  assert.deepEqual([home.count, home.amount, home.cost, home.share], [2, 60, 15, 50]);
  assert.equal(home.avgPrice, 0.25);
  assert.equal(home.avgPowerKw, 6, 'nur der Ladevorgang mit Dauer: 30 kWh in 5 Stunden');
  assert.equal(c.types[1].avgPowerKw, 80, '40 kWh in 30 Minuten');
  assert.equal(c.types[2].avgPowerKw, null);
  assert.equal(c.typedShare, 83.3, '100 von 120 kWh mit Angabe');
  assert.equal(c.homeShare, 60, 'zu Hause 60 von 100 kWh mit Angabe');
  // Ohne Ladevorgänge: null
  const benziner = await newVehicle(token, { fuelType: 'e10' });
  await api('POST', '/fillups', { token, body: { vehicleId: benziner.id, odometerKm: 100, amount: 30, totalCostEur: 50 } });
  assert.equal((await api('GET', `/vehicles/${benziner.id}/consumption`, { token })).body.chargeTypes, null);
});

test('PATCH: station null oder leer entfernt den Ort, schreibt nicht den Text "null"', async () => {
  const token = await newUser();
  const ev = await newVehicle(token, { fuelType: 'electric' });
  const f = await api('POST', '/fillups', { token, body: { vehicleId: ev.id, amount: 10, totalCostEur: 3, station: 'Wallbox' } });
  assert.equal(f.body.station, 'Wallbox');
  let p = await api('PATCH', `/fillups/${f.body.id}`, { token, body: { station: null } });
  assert.equal(p.body.station, null);
  await api('PATCH', `/fillups/${f.body.id}`, { token, body: { station: ' Neu ' } });
  p = await api('PATCH', `/fillups/${f.body.id}`, { token, body: { station: '  ' } });
  assert.equal(p.body.station, null);
});

test('Verbrauch ohne „voll geladen“ (#25): Abschnitte aus dem Ladestand, kWh je Prozent aus den eigenen Ladungen', async () => {
  const token = await newUser();
  const ev = await newVehicle(token, { fuelType: 'electric' });
  const laden = (data) => api('POST', '/fillups', { token, body: { vehicleId: ev.id, totalCostEur: 0, isFull: false, ...data } });
  // 0,5 kWh je Prozent (Wallbox-Menge); der Wagen braucht 0,2 kWh/km = 40 % je 100 km
  await laden({ odometerKm: 1000, amount: 40, socBeforePct: 20, socAfterPct: 100, filledAt: '2025-06-01T10:00:00Z' });
  await laden({ odometerKm: 1200, amount: 30, socBeforePct: 20, socAfterPct: 80, filledAt: '2025-06-10T10:00:00Z' });
  await laden({ odometerKm: 1300, amount: 25, socBeforePct: 40, socAfterPct: 90, filledAt: '2025-06-15T10:00:00Z' });
  const s = (await api('GET', `/vehicles/${ev.id}/stats`, { token })).body;
  assert.equal(s.segments.length, 2, 'ohne einen einzigen vollen Eintrag, nur dank der Ladestände');
  const [neu, alt] = s.segments; // neueste zuerst
  assert.deepEqual([alt.km, Number(alt.liters_segment), Number(alt.l_per_100km), alt.method], [200, 40, 20, 'level']);
  assert.deepEqual([neu.km, Number(neu.liters_segment), Number(neu.l_per_100km), neu.method], [100, 20, 20, 'level']);
  assert.equal(s.avgConsumption, 20);
  assert.equal(s.energies.electricity.avgMethod, 'segments');
  const c = (await api('GET', `/vehicles/${ev.id}/consumption`, { token })).body;
  assert.equal(c.byEnergy.electricity.avg, 20);
  assert.equal(c.byEnergy.electricity.avgMethod, 'segments');
  assert.equal(c.byEnergy.electricity.coverage, 1);
  assert.equal(c.byEnergy.electricity.segments[0].method, 'level');
  // Die Eintragsliste zeigt den Verbrauch an der abschließenden Ladung
  const zeilen = (await api('GET', `/vehicles/${ev.id}/timeline`, { token })).body.data;
  assert.equal(zeilen.find((z) => z.odometer_km === 1300).consumption, 20);
});

test('Verbrauch ohne „voll geladen“: ohne Ladestände gilt wie bisher voll bis voll; Summenmethode nur als Ersatz', async () => {
  const token = await newUser();
  // Nur Teilladungen, keine Stände: kein Abschnitt, aber die Summenmethode liefert einen Wert (Menge nach der ersten ÷ Strecke)
  const ev = await newVehicle(token, { fuelType: 'electric' });
  for (const [odo, kwh] of [[1000, 20], [1200, 30], [1500, 45]]) {
    await api('POST', '/fillups', { token, body: { vehicleId: ev.id, odometerKm: odo, amount: kwh, totalCostEur: 0, isFull: false } });
  }
  const s = (await api('GET', `/vehicles/${ev.id}/stats`, { token })).body;
  assert.equal(s.segments.length, 0);
  assert.equal(s.avgConsumption, 15, '75 kWh auf 500 km');
  assert.equal(s.energies.electricity.avgMethod, 'sum');
  const c = (await api('GET', `/vehicles/${ev.id}/consumption`, { token })).body.byEnergy.electricity;
  assert.equal(c.avg, 15);
  assert.equal(c.avgMethod, 'sum');
  assert.equal(c.coverage, 0);
  assert.equal(c.sumConsumption, 15);

  // Mit vollen Ladungen bleibt es bei den Abschnitten; die Summenmethode steht nur daneben
  const voll = await newVehicle(token, { fuelType: 'electric' });
  for (const [odo, kwh] of [[1000, 20], [1200, 30], [1400, 36]]) {
    await api('POST', '/fillups', { token, body: { vehicleId: voll.id, odometerKm: odo, amount: kwh, totalCostEur: 0 } });
  }
  const v = (await api('GET', `/vehicles/${voll.id}/consumption`, { token })).body.byEnergy.electricity;
  assert.equal(v.avgMethod, 'segments');
  assert.equal(v.avg, 16.5, '66 kWh auf 400 km');
  assert.equal(v.coverage, 1);
  assert.equal(v.segments.every((x) => x.method === 'full'), true);

  // Immer auf 80 % geladen, nur „Ladestand nachher“ angegeben: gleicher Stand an beiden Eckpunkten braucht keine Umrechnung
  const halb = await newVehicle(token, { fuelType: 'electric' });
  for (const [odo, kwh] of [[1000, 20], [1200, 30], [1400, 36]]) {
    await api('POST', '/fillups', { token, body: { vehicleId: halb.id, odometerKm: odo, amount: kwh, totalCostEur: 0, socAfterPct: 80 } });
  }
  const h = (await api('GET', `/vehicles/${halb.id}/stats`, { token })).body;
  assert.deepEqual(h.segments.map((x) => [x.km, Number(x.liters_segment), x.method]).reverse(), [[200, 30, 'level'], [200, 36, 'level']]);
  // Unterschiedliche Stände ohne bestimmbares kWh je Prozent (kein Stand vorher): der Abschnitt fällt weg, der nächste beginnt dort
  const ungleich = await newVehicle(token, { fuelType: 'electric' });
  for (const [odo, kwh, soc] of [[1000, 20, 80], [1200, 30, 60], [1400, 36, 60]]) {
    await api('POST', '/fillups', { token, body: { vehicleId: ungleich.id, odometerKm: odo, amount: kwh, totalCostEur: 0, socAfterPct: soc } });
  }
  const u = (await api('GET', `/vehicles/${ungleich.id}/stats`, { token })).body;
  assert.deepEqual(u.segments.map((x) => [x.km, Number(x.liters_segment)]), [[200, 36]], 'nur der Abschnitt zwischen den beiden 60-%-Ladungen');

  // Unstimmige Angaben (Stand steigt stärker, als die geladene Menge hergibt): Abschnitt zählt nicht
  const falsch = await newVehicle(token, { fuelType: 'electric' });
  await api('POST', '/fillups', { token, body: { vehicleId: falsch.id, odometerKm: 1000, amount: 40, totalCostEur: 0, isFull: false, socBeforePct: 20, socAfterPct: 60 } });
  await api('POST', '/fillups', { token, body: { vehicleId: falsch.id, odometerKm: 1100, amount: 2, totalCostEur: 0, isFull: false, socBeforePct: 55, socAfterPct: 100 } });
  const f = (await api('GET', `/vehicles/${falsch.id}/stats`, { token })).body;
  assert.equal(f.segments.length, 0, 'verbraucht wären −38 kWh');
});
