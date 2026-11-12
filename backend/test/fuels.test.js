// Mehrere Kraftstoffe je Fahrzeug (#140): Sortenkatalog, Fahrzeuge mit Sorten, Sorte je Eintrag, Verbrauch je
// Energieart, Preise je Sorte, Import. Unit-Tests ohne Datenbank, API-Tests mit DATABASE_URL (wie api.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fuels = require('../src/services/fuels');

test('Sortenkatalog: Einheit aus der Energieart, Standards je Antriebsart', () => {
  assert.equal(fuels.unitOf('super_e10'), 'l');
  assert.equal(fuels.unitOf('cng'), 'kg');
  assert.equal(fuels.unitOf('electricity'), 'kwh');
  assert.equal(fuels.energyOf('premium_diesel'), 'diesel');
  assert.equal(fuels.energyOf('gibtsnicht'), 'other');
  assert.deepEqual(fuels.defaultFuelsFor('phev'), ['super_e5', 'electricity']);
  for (const [fuelType, list] of Object.entries(fuels.DEFAULT_FUELS)) {
    for (const k of list) assert.ok(fuels.fuelInfo(k), `${fuelType}: ${k} im Katalog`);
  }
  // Antriebsart aus Sorten
  assert.equal(fuels.fuelTypeFor(['super_e5', 'electricity']), 'phev');
  assert.equal(fuels.fuelTypeFor(['electricity']), 'electric');
  assert.equal(fuels.fuelTypeFor(['lpg', 'super_e5'], 'lpg'), 'lpg');
  assert.equal(fuels.fuelTypeFor(['super_e10', 'super_plus'], 'super_e10'), 'e10');
  assert.equal(fuels.fuelTypeFor(['premium_diesel', 'diesel'], 'premium_diesel'), 'diesel');
  // Sorte für eine Einheit: Standard, sonst passende Sorte, sonst wie bisher
  const lpgAuto = { fuel_type: 'lpg', fuels: ['lpg', 'super_e5'], default_fuel: 'lpg' };
  assert.equal(fuels.fuelForUnit(lpgAuto, 'l'), 'lpg');
  assert.equal(fuels.fuelForUnit({ fuel_type: 'phev', fuels: ['super_e5', 'electricity'], default_fuel: 'super_e5' }, 'kwh'), 'electricity');
  assert.equal(fuels.fuelForUnit({ fuel_type: 'e5', fuels: [], default_fuel: null }, 'kwh'), 'electricity');
  // Leere Liste aus der Datenbank: Sorten aus der Antriebsart
  assert.deepEqual(fuels.vehicleFuels({ fuel_type: 'diesel', fuels: [] }), { fuels: ['diesel'], defaultFuel: 'diesel' });
  assert.deepEqual(fuels.parseFuelList(['LPG', 'super_e5', 'lpg']), { fuels: ['lpg', 'super_e5'] });
  assert.equal(fuels.parseFuelList([]).error, 'invalid_fuels');
  assert.equal(fuels.parseFuelList(['kerosin']).error, 'invalid_fuels');
  assert.equal(fuels.parseFuelList('lpg').error, 'invalid_fuels');
});

if (!process.env.DATABASE_URL) {
  test('API-Tests für Sorten übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
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
async function newUser() {
  const r = await api('POST', '/auth/register', { body: { email: `fuels-${unique()}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token;
}
async function newVehicle(token, body) {
  const r = await api('POST', '/vehicles', { token, body: { name: `Auto ${unique()}`, ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function fillup(token, vehicleId, data) {
  const r = await api('POST', '/fillups', { token, body: { vehicleId, totalCostEur: 0, ...data } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const nah = (a, b) => a !== null && a !== undefined && Math.abs(a - b) < 0.01;

test('SQL-Funktionen der Migration stimmen mit services/fuels.js überein', async () => {
  for (const fuelType of Object.keys(fuels.DEFAULT_FUELS)) {
    const r = await pool.query('SELECT fuelstat_standard_sorten($1) AS list', [fuelType]);
    assert.deepEqual(r.rows[0].list, fuels.defaultFuelsFor(fuelType), fuelType);
    for (const unit of ['l', 'kwh', 'kg']) {
      const s = await pool.query('SELECT fuelstat_sorte_aus_altdaten($1, $2) AS fuel', [fuelType, unit]);
      assert.equal(s.rows[0].fuel, fuels.legacyFuel(fuelType, unit), `${fuelType}/${unit}`);
    }
  }
});

test('GET /fuels liefert Katalog ohne Anmeldung', async () => {
  const r = await api('GET', '/fuels');
  assert.equal(r.status, 200);
  assert.ok(r.body.fuels.some((f) => f.key === 'premium_diesel' && f.energy === 'diesel' && f.premium && f.unit === 'l'));
  assert.ok(r.body.energies.some((e) => e.key === 'electricity' && e.unit === 'kwh'));
});

test('Fahrzeug: Sorten beim Anlegen und Bearbeiten', async () => {
  const token = await newUser();
  // Ohne Sorten: aus der Antriebsart (alte Clients)
  let v = await newVehicle(token, { fuelType: 'phev' });
  assert.deepEqual(v.fuels, ['super_e5', 'electricity']);
  assert.equal(v.default_fuel, 'super_e5');
  // Mit Sorten und Standard; Antriebsart aus den Sorten
  v = await newVehicle(token, { fuels: ['super_e5', 'lpg'], defaultFuel: 'lpg' });
  assert.equal(v.fuel_type, 'lpg');
  assert.deepEqual(v.fuels, ['super_e5', 'lpg']);
  assert.equal(v.default_fuel, 'lpg');
  // Ungültig
  assert.equal((await api('POST', '/vehicles', { token, body: { name: 'X', fuels: ['kerosin'] } })).body.error, 'invalid_fuels');
  assert.equal((await api('POST', '/vehicles', { token, body: { name: 'X', fuelType: 'e5', defaultFuel: 'diesel' } })).body.error, 'invalid_defaultFuel');

  // Bearbeiten: gleiche Antriebsart (z. B. App schickt das ganze Formular) lässt die Sorten in Ruhe
  let p = await api('PATCH', `/vehicles/${v.id}`, { token, body: { fuelType: 'lpg', name: 'Gasauto' } });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.fuels, ['super_e5', 'lpg']);
  // Nur Standard ändern
  p = await api('PATCH', `/vehicles/${v.id}`, { token, body: { defaultFuel: 'super_e5' } });
  assert.equal(p.body.default_fuel, 'super_e5');
  assert.equal((await api('PATCH', `/vehicles/${v.id}`, { token, body: { defaultFuel: 'diesel' } })).body.error, 'invalid_defaultFuel');
  // Andere Antriebsart ohne Sorten: Sorten der neuen Antriebsart
  p = await api('PATCH', `/vehicles/${v.id}`, { token, body: { fuelType: 'diesel' } });
  assert.deepEqual(p.body.fuels, ['diesel']);
  assert.equal(p.body.default_fuel, 'diesel');
  // Sorten ändern; der Standard bleibt, solange er dabei ist
  p = await api('PATCH', `/vehicles/${v.id}`, { token, body: { fuels: ['premium_diesel', 'diesel'] } });
  assert.deepEqual(p.body.fuels, ['premium_diesel', 'diesel']);
  assert.equal(p.body.default_fuel, 'diesel');
  const liste = (await api('GET', '/vehicles', { token })).body.data.find((x) => x.id === v.id);
  assert.deepEqual(liste.fuels, ['premium_diesel', 'diesel']);
});

test('Tankvorgang: Sorte, Einheit aus der Sorte, Standard ohne Sorte', async () => {
  const token = await newUser();
  const v = await newVehicle(token, { fuels: ['lpg', 'super_e5'] });
  // Ohne Sorte und Einheit: Standard (LPG)
  let f = await fillup(token, v.id, { amount: 40, totalCostEur: 40 });
  assert.equal(f.fuel, 'lpg');
  assert.equal(f.unit, 'l');
  // Alte Feldnamen gibt es nicht mehr (Beta-Aufräumen)
  assert.equal(f.liters, undefined);
  assert.equal(f.price_per_liter, undefined);
  // Mit Sorte
  f = await fillup(token, v.id, { amount: 10, totalCostEur: 18, fuel: 'super_e5' });
  assert.equal(f.fuel, 'super_e5');
  // Sorte gehört nicht zum Fahrzeug, Einheit passt nicht
  assert.equal((await api('POST', '/fillups', { token, body: { vehicleId: v.id, amount: 1, totalCostEur: 1, fuel: 'diesel' } })).body.error, 'invalid_fuel');
  assert.equal((await api('POST', '/fillups', { token, body: { vehicleId: v.id, amount: 1, totalCostEur: 1, fuel: 'lpg', unit: 'kg' } })).body.error, 'invalid_unit');
  // Bearbeiten: Sorte ändern
  const p = await api('PATCH', `/fillups/${f.id}`, { token, body: { fuel: 'lpg' } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.fuel, 'lpg');
  assert.equal((await api('GET', `/fillups/${f.id}`, { token })).body.fuel, 'lpg');
  // Plug-in-Hybrid ohne Sorte, nur mit Einheit (alte Clients): Strom
  const phev = await newVehicle(token, { fuelType: 'phev' });
  assert.equal((await fillup(token, phev.id, { amount: 10, totalCostEur: 4, unit: 'kwh' })).fuel, 'electricity');
  const list = (await api('GET', `/vehicles/${phev.id}/fillups`, { token })).body.data;
  assert.equal(list[0].fuel, 'electricity');
});

test('Verbrauch je Energieart: Benzin und Autogas getrennt, E5/E10 zusammen, Mehrpreis Premium', async () => {
  const token = await newUser();
  // Autogas-Auto: LPG und Benzin je eigene Abschnitte
  const gas = await newVehicle(token, { fuels: ['lpg', 'super_e5'], defaultFuel: 'lpg' });
  await fillup(token, gas.id, { odometerKm: 1000, amount: 40, totalCostEur: 40, fuel: 'lpg', filledAt: '2025-05-01T10:00:00Z' });
  await fillup(token, gas.id, { odometerKm: 1010, amount: 3, totalCostEur: 5.4, fuel: 'super_e5', filledAt: '2025-05-01T11:00:00Z' });
  await fillup(token, gas.id, { odometerKm: 1400, amount: 40, totalCostEur: 40, fuel: 'lpg', filledAt: '2025-05-10T10:00:00Z' });
  await fillup(token, gas.id, { odometerKm: 1800, amount: 42, totalCostEur: 42, fuel: 'lpg', filledAt: '2025-05-20T10:00:00Z' });
  await fillup(token, gas.id, { odometerKm: 1810, amount: 2, totalCostEur: 3.6, fuel: 'super_e5', filledAt: '2025-05-20T11:00:00Z' });
  let c = (await api('GET', `/vehicles/${gas.id}/consumption`, { token })).body;
  assert.deepEqual(c.energies, ['lpg', 'petrol']);
  assert.ok(nah(c.byEnergy.lpg.avg, 82 / 800 * 100), 'LPG nur aus LPG-Abschnitten');
  assert.ok(nah(c.byEnergy.petrol.avg, 2 / 800 * 100), 'Benzin über die Strecke zwischen Benzin-Füllungen');
  assert.equal(c.byEnergy.petrol.minor, true, 'Benzin ist beim Autogas-Auto Nebensache');
  assert.equal(c.byEnergy.lpg.minor, false);
  // Bisheriges Format je Einheit: Hauptenergieart des Standards (LPG)
  assert.equal(c.byUnit.l.energy, 'lpg');
  assert.ok(nah(c.byUnit.l.avg, c.byEnergy.lpg.avg));
  // Kennzahlen: stats je Energieart
  const s = (await api('GET', `/vehicles/${gas.id}/stats`, { token })).body;
  assert.ok(nah(s.energies.lpg.avgConsumption, 82 / 800 * 100));
  assert.ok(s.energies.petrol);
  assert.ok(nah(Number(s.avgPricePerLiter), 122 / 122), 'Hauptwert ist der LPG-Preis');
  // Kosten je Energieart
  const k = (await api('GET', `/vehicles/${gas.id}/costs`, { token })).body;
  assert.deepEqual(k.energies.map((e) => e.energy), ['petrol', 'lpg']);

  // E5/E10-Mix: ein Abschnitt über beide Sorten; Super Plus mit Mehrpreis
  const benziner = await newVehicle(token, { fuels: ['super_e10', 'super_e5', 'super_plus'] });
  await fillup(token, benziner.id, { odometerKm: 5000, amount: 40, totalCostEur: 68, fuel: 'super_e10', filledAt: '2025-06-01T10:00:00Z' });
  await fillup(token, benziner.id, { odometerKm: 5500, amount: 30, totalCostEur: 54, fuel: 'super_e5', filledAt: '2025-06-10T10:00:00Z' });
  await fillup(token, benziner.id, { odometerKm: 6000, amount: 35, totalCostEur: 70, fuel: 'super_plus', filledAt: '2025-06-20T10:00:00Z' });
  c = (await api('GET', `/vehicles/${benziner.id}/consumption`, { token })).body;
  assert.deepEqual(c.energies, ['petrol']);
  assert.equal(c.byEnergy.petrol.segments.length, 2);
  assert.ok(nah(c.byEnergy.petrol.avg, 65 / 1000 * 100));
  assert.ok(nah(c.byFuel.super_plus.avgPrice, 2));
  // Basispreis: E10 und E5 nach Menge gewichtet (122 € / 70 l)
  assert.ok(nah(c.byFuel.super_plus.markup.perUnit, 2 - 122 / 70));
  assert.ok(nah(c.byFuel.super_e10.shareOfEnergy, 40 / 105 * 100));
  assert.equal(c.byFuel.super_e10.markup, null);
  assert.ok(nah(c.costPer100km, (54 + 70) / 1000 * 100));
});

test('Import: Sorte je Zeile, sonst Standard der Einheit', async () => {
  const token = await newUser();
  const v = await newVehicle(token, { fuels: ['diesel', 'premium_diesel'] });
  const r = await api('POST', `/vehicles/${v.id}/import`, {
    token,
    body: {
      fillups: [
        { filledAt: '2025-07-01T10:00:00Z', odometerKm: 100, amount: 40, totalCostEur: 68, fuel: 'premium_diesel' },
        { filledAt: '2025-07-10T10:00:00Z', odometerKm: 700, amount: 38, totalCostEur: 60 },
        { filledAt: '2025-07-20T10:00:00Z', odometerKm: 1300, amount: 39, totalCostEur: 62, fuel: 'lpg' }
      ]
    }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = (await api('GET', `/vehicles/${v.id}/fillups`, { token })).body.data.sort((a, b) => a.odometer_km - b.odometer_km);
  assert.deepEqual(list.map((f) => f.fuel), ['premium_diesel', 'diesel', 'diesel']);
});
