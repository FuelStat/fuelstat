// API-Tests gegen eine echte Postgres-Testdatenbank (#58).
// Voraussetzung: DATABASE_URL zeigt auf eine Datenbank mit dem Schema aus backend/database/postgres_init.sql.
// Lokal z. B.: createdb fuelstat_test && psql -d fuelstat_test -f backend/database/postgres_init.sql
//              DATABASE_URL=postgresql://…/fuelstat_test npm test
// Jeder Lauf legt eigene Konten mit zufälliger E-Mail an, die Datenbank muss also nicht geleert werden.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('node:os').tmpdir();
delete process.env.PLAN_LIMITS_ENABLED;
delete process.env.CORS_ORIGINS;

if (!process.env.DATABASE_URL) {
  test('API-Tests übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
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

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

const unique = () => crypto.randomBytes(6).toString('hex');
async function newUser() {
  const email = `test-${unique()}@example.test`;
  const r = await api('POST', '/auth/register', { body: { email, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { email, token: r.body.token, id: r.body.user.id };
}
async function newVehicle(token, fuelType = 'e10', extra = {}) {
  const r = await api('POST', '/vehicles', { token, body: { name: `Auto ${unique()}`, fuelType, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}
async function fillup(token, vehicleId, data) {
  const r = await api('POST', '/fillups', { token, body: { vehicleId, totalCostEur: 0, ...data } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

// TOTP (RFC 6238) für den 2FA-Test
function totp(secretBase32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

test('Healthcheck', async () => {
  const r = await api('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'healthy');
  // Version (#111): dieselbe wie in der Datei VERSION
  const version = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
  assert.equal(r.body.version, version);
});

test('Registrierung und Login', async () => {
  const u = await newUser();
  assert.equal((await api('POST', '/auth/register', { body: { email: u.email, password: 'Passwort123' } })).status, 409);
  assert.equal((await api('POST', '/auth/register', { body: { email: 'x@y.de', password: 'kurz' } })).body.error, 'password_too_short');
  const ok = await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort123' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  const falsch = await api('POST', '/auth/login', { body: { email: u.email, password: 'falsch-falsch' } });
  assert.equal(falsch.status, 401);
  assert.equal((await api('GET', '/vehicles')).status, 401, 'ohne Token');
  const me = await api('GET', '/whoami', { token: u.token });
  assert.equal(me.body.email, u.email);
  assert.equal(me.body.plan, 'free');
  assert.equal(me.body.effectivePlan, 'plus', 'ohne PLAN_LIMITS_ENABLED volle Rechte');
});

test('2FA: einrichten, Login ohne/mit Code, zweistufig', async () => {
  const u = await newUser();
  const setup = await api('POST', '/auth/mfa/setup', { token: u.token });
  assert.equal(setup.status, 200);
  const secret = setup.body.secret;
  assert.equal((await api('POST', '/auth/mfa/enable', { token: u.token, body: { code: totp(secret) } })).status, 200);
  // Secret liegt verschlüsselt in der Datenbank (#55)
  const db = await pool.query('SELECT mfa_secret FROM users WHERE id = $1', [u.id]);
  assert.match(db.rows[0].mfa_secret, /^v1:/);

  const ohne = await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort123' } });
  assert.equal(ohne.status, 401);
  assert.equal(ohne.body.error, 'mfa_required');
  assert.ok(ohne.body.mfaToken);
  const falsch = await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort123', code: '000000' } });
  assert.equal(falsch.body.error, 'invalid_mfa_code');
  const mit = await api('POST', '/auth/login', { body: { email: u.email, password: 'Passwort123', code: totp(secret) } });
  assert.equal(mit.status, 200);
  const schritt2 = await api('POST', '/auth/login/mfa', { body: { mfaToken: ohne.body.mfaToken, code: totp(secret) } });
  assert.equal(schritt2.status, 200);
  assert.ok(schritt2.body.token);
});

test('Fremde Fahrzeuge und Einträge sind nicht erreichbar (404)', async () => {
  const a = await newUser();
  const b = await newUser();
  const v = await newVehicle(a.token);
  const f = await fillup(a.token, v, { odometerKm: 1000, amount: 40 });
  for (const [m, p, body] of [
    ['GET', `/vehicles/${v}`],
    ['PATCH', `/vehicles/${v}`, { name: 'gekapert' }],
    ['DELETE', `/vehicles/${v}`],
    ['GET', `/vehicles/${v}/stats`],
    ['GET', `/vehicles/${v}/fillups`],
    ['GET', `/vehicles/${v}/entries`],
    ['POST', '/fillups', { vehicleId: v, odometerKm: 1, amount: 1, totalCostEur: 1 }],
    ['POST', '/entries', { vehicleId: v, category: 'Werkstatt', amountEur: 1 }],
    ['GET', `/fillups/${f.id}`],
    ['PATCH', `/fillups/${f.id}`, { odometerKm: 5 }],
    ['DELETE', `/fillups/${f.id}`],
    ['POST', `/vehicles/${v}/import`, { fillups: [{ filledAt: '2026-01-01', odometerKm: 1, amount: 1, totalCostEur: 1 }] }]
  ]) {
    const r = await api(m, p, { token: b.token, body });
    assert.equal(r.status, 404, `${m} ${p} → ${r.status}`);
  }
  // Fahrzeug und Eintrag sind unverändert
  assert.equal((await api('GET', `/fillups/${f.id}`, { token: a.token })).body.odometer_km, 1000);
});

test('Tanken: Verbrauch Full-to-Full mit Teilbetankung', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  await fillup(u.token, v, { odometerKm: 1000, amount: 40, totalCostEur: 70, filledAt: '2026-01-01T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 1300, amount: 10, totalCostEur: 18, isFull: false, filledAt: '2026-01-05T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 1500, amount: 25, totalCostEur: 45, filledAt: '2026-01-10T12:00:00Z' });
  const s = (await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body;
  assert.equal(s.currentOdo, 1500);
  assert.equal(s.segments.length, 1);
  assert.equal(Number(s.segments[0].km), 500);
  assert.equal(Number(s.segments[0].l_per_100km), 7);
  assert.equal(s.avgConsumption, 7);
});

test('Kosten (#124): Summen, Kosten pro km, Jahr, nur eigene Fahrzeuge', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  await fillup(u.token, v, { odometerKm: 10000, amount: 40, totalCostEur: 60, filledAt: '2025-11-10T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 10500, amount: 30, totalCostEur: 50, filledAt: '2025-12-20T12:00:00Z' });
  await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Versicherung', amountEur: 300, occurredAt: '2026-01-02T12:00:00Z' } });
  await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Kilometerstand', amountEur: 0, odometerKm: 10800, occurredAt: '2026-01-15T12:00:00Z' } });
  await fillup(u.token, v, { odometerKm: 11000, amount: 32, totalCostEur: 55, filledAt: '2026-01-31T23:30:00Z' });

  const c = await api('GET', `/vehicles/${v}/costs`, { token: u.token });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.total, { energy: 165, expenses: 300, total: 465 });
  assert.equal(c.body.distanceKm, 1000);
  assert.equal(c.body.costPerKm.total, 0.465);
  assert.equal(c.body.costPerKm.energy, 0.105);
  assert.equal(c.body.months[0].month, '2026-02', 'Monat in Europe/Berlin');
  assert.ok(c.body.currentMonth.month && c.body.previousMonth.month);

  const j = await api('GET', `/vehicles/${v}/costs?year=2026`, { token: u.token });
  assert.equal(j.body.year, 2026);
  assert.deepEqual(j.body.total, { energy: 55, expenses: 300, total: 355 });
  assert.equal(j.body.distanceKm, 500);

  assert.equal((await api('GET', `/vehicles/${v}/costs?year=20x6`, { token: u.token })).body.error, 'invalid_year');
  assert.equal((await api('GET', `/vehicles/${v}/costs`)).status, 401);
  const fremd = await newUser();
  assert.equal((await api('GET', `/vehicles/${v}/costs`, { token: fremd.token })).status, 404, 'fremdes Fahrzeug');
  assert.equal((await api('GET', '/vehicles/keine-uuid/costs', { token: u.token })).status, 404);
});

// Verbrauch (#82): Fälle aus den früheren PHP-Tests TachostandFehltTest, StatistikGleicherTagTest,
// PluginHybridStatistikTest und VerbrauchProMonatTest, jetzt gegen die API
const verbrauchVon = async (token, v) => {
  const r = await api('GET', `/vehicles/${v}/consumption`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const nah = (a, b) => a !== null && Math.abs(a - b) < 0.01;

test('Verbrauch (#82): Einträge ohne bzw. mit geschätztem Tachostand, Nachtragen', async () => {
  const u = await newUser();
  // 1. Volle Füllung ohne Tachostand: ein Abschnitt 1000 → 2000 mit 30 + 40 l; zählt als Tankstopp und bei den Kosten
  let v = await newVehicle(u.token);
  await fillup(u.token, v, { odometerKm: 1000, amount: 50, totalCostEur: 100, filledAt: '2025-03-01T12:00:00Z' });
  await fillup(u.token, v, { amount: 30, totalCostEur: 60, filledAt: '2025-03-10T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 2000, amount: 40, totalCostEur: 80, filledAt: '2025-03-20T12:00:00Z' });
  let c = await verbrauchVon(u.token, v);
  let l = c.byUnit.l;
  assert.equal(l.segments.length, 1);
  assert.equal(l.segments[0].date, '2025-03-20');
  assert.ok(nah(l.segments[0].consumption, 7), 'Menge ohne Tachostand zählt zum nächsten Abschnitt');
  assert.equal(l.years[0].fillCount, 3);
  assert.ok(nah(l.years[0].cost, 240));

  // 5. Nachtragen teilt den Abschnitt wieder auf
  const ohne = (await api('GET', `/vehicles/${v}/fillups`, { token: u.token })).body.find((f) => f.odometer_km === null);
  assert.equal((await api('PATCH', `/fillups/${ohne.id}`, { token: u.token, body: { odometerKm: 1450 } })).status, 200);
  l = (await verbrauchVon(u.token, v)).byUnit.l;
  assert.deepEqual(l.segments.map((s) => s.date), ['2025-03-10', '2025-03-20']);
  assert.ok(nah(l.segments[0].consumption, 30 / 450 * 100) && nah(l.segments[1].consumption, 40 / 550 * 100));

  // 3. Tag mit drei Einträgen, einer ohne Tachostand: der zählt zum nächsten Abschnitt
  v = await newVehicle(u.token);
  await fillup(u.token, v, { odometerKm: 1000, amount: 50, filledAt: '2025-03-25T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 1400, amount: 8, isFull: false, filledAt: '2025-04-01T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 1500, amount: 20, filledAt: '2025-04-01T12:00:00Z' });
  await fillup(u.token, v, { amount: 5, isFull: false, filledAt: '2025-04-01T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 1800, amount: 45, filledAt: '2025-04-10T12:00:00Z' });
  l = (await verbrauchVon(u.token, v)).byUnit.l;
  assert.ok(nah(l.segments[0].consumption, 28 / 500 * 100), 'bis 1.500 km: 8 + 20 l');
  assert.ok(nah(l.segments[1].consumption, 50 / 300 * 100), 'bis 1.800 km: 5 + 45 l');
});

test('Verbrauch (#82): mehrere Ladungen am selben Tag', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token, 'electric');
  const lade = (km, kwh, tag, voll = true) => fillup(u.token, v, { odometerKm: km, amount: kwh, unit: 'kwh', isFull: voll, filledAt: `2025-06-${tag}T12:00:00Z` });
  await lade(850, 22, '01');
  await lade(1000, 20, '08');
  await lade(1150, 25, '10');
  await lade(1300, 24, '10');
  await lade(1420, 8, '11', false);
  await lade(1440, 12, '11');
  const k = (await verbrauchVon(u.token, v)).byUnit.kwh;
  assert.equal(k.segments.length, 4);
  assert.ok(nah(k.segments[1].consumption, 25 / 150 * 100) && nah(k.segments[2].consumption, 24 / 150 * 100), 'zwei Ladungen am 10.06.');
  assert.ok(nah(k.segments[3].consumption, 20 / 140 * 100), 'Zwischen- und Vollladung am 11.06.');
  assert.ok(nah(k.years[0].amountConsumed, 89));
  assert.equal(k.co2.factor, 0.363);
});

test('Verbrauch (#82): Plug-in-Hybrid getrennt, CO₂, Stromanteil, Monate gewichtet', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token, 'phev', { batteryCapacity: 17.8 });
  const f = (km, menge, unit, kosten, tag, voll = true) => fillup(u.token, v, { odometerKm: km, amount: menge, unit, totalCostEur: kosten, isFull: voll, filledAt: `2026-01-${tag}T12:00:00Z` });
  await f(1000, 14, 'kwh', 3.92, '01');
  await f(1000, 30, 'l', 52.5, '01');
  await f(1050, 14, 'kwh', 3.92, '02');
  await f(1200, 15, 'kwh', 4.20, '05');
  await f(1400, 10, 'kwh', 2.80, '10', false);
  await f(2000, 40, 'l', 70, '20');
  await f(2000, 12, 'kwh', 3.36, '20');
  const c = await verbrauchVon(u.token, v);
  assert.deepEqual(c.units, ['l', 'kwh'], 'Kraftstoff zuerst');
  const l = c.byUnit.l;
  assert.equal(l.segments.length, 1);
  assert.ok(nah(l.years[0].consumption, 4));
  assert.equal(l.years[0].fillCount, 2);
  assert.equal(l.co2.factor, 2.37);
  assert.ok(nah(l.co2.totalKg, 70 * 2.37));
  const k = c.byUnit.kwh;
  assert.equal(k.segments.length, 3);
  assert.ok(nah(k.years[0].amountConsumed, 51));
  assert.equal(k.years[0].kmConsumed, 1000);
  assert.ok(nah(k.years[0].cost, 18.2));
  assert.ok(Math.abs(c.electricShare - 18.2 / (122.5 + 18.2) * 100) < 0.06, "Stromanteil auf 0,1 % gerundet");
  assert.ok(nah(c.co2.totalKg, 70 * 2.37 + 65 * 0.363));
  assert.ok(c.co2.gPerKm > 0);

  // Fahrleistung in /stats: ohne Tachostand beim Anlegen seit dem ersten Eintrag
  const s = (await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body;
  assert.deepEqual(s.distance, { km: 1000, since: 'firstEntry' });
});

test('Verbrauch (#82): Monatswerte aus Menge und Strecke der Abschnitte, Fahrleistung seit Anschaffung', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token, 'e10', { odometerKm: 60000 });
  const t = (datum, menge, km, voll = true) => fillup(u.token, v, { odometerKm: km, amount: menge, isFull: voll, filledAt: `${datum}T12:00:00Z` });
  await t('2025-05-08', 47.2, 60092);
  await t('2025-05-26', 27.5, 60495);
  await t('2025-06-14', 13.2, 60695);
  await t('2025-06-26', 20.0, 60830, false);
  await t('2025-07-05', 21.8, 61020);
  await t('2025-07-24', 16.9, 61280);
  const c = await verbrauchVon(u.token, v);
  const m = Object.fromEntries(c.byUnit.l.months.map((x) => [x.month, x.consumption]));
  assert.ok(nah(m['2025-05'], 6.82), `Mai ${m['2025-05']}`);
  assert.ok(nah(m['2025-06'], 6.60), `Juni ${m['2025-06']}`);
  assert.ok(nah(m['2025-07'], 10.03), `Juli ${m['2025-07']}`);
  assert.equal(c.byUnit.l.min, 6.5);
  const s = (await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body;
  assert.deepEqual(s.distance, { km: 1280, since: 'purchase' });

  assert.equal((await api('GET', `/vehicles/${v}/consumption`)).status, 401);
  const fremd = await newUser();
  assert.equal((await api('GET', `/vehicles/${v}/consumption`, { token: fremd.token })).status, 404);
});

test('Plug-in-Hybrid: Liter und kWh getrennt', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token, 'phev', { batteryCapacity: 17.8 });
  await fillup(u.token, v, { odometerKm: 1000, amount: 30, unit: 'l', filledAt: '2026-01-01T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 1000, amount: 15, unit: 'kwh', filledAt: '2026-01-01T13:00:00Z' });
  await fillup(u.token, v, { odometerKm: 1100, amount: 18, unit: 'kwh', filledAt: '2026-01-03T12:00:00Z' });
  await fillup(u.token, v, { odometerKm: 2000, amount: 40, unit: 'l', filledAt: '2026-01-20T12:00:00Z' });
  assert.equal((await api('POST', '/fillups', { token: u.token, body: { vehicleId: v, odometerKm: 2100, amount: 5, totalCostEur: 1, unit: 'kg' } })).status, 400);
  const s = (await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body;
  assert.equal(s.units.l.avgConsumption, 4);
  assert.equal(s.units.kwh.avgConsumption, 18);
});

test('Kilometerstand fehlt (#41): Abschnitt, Nachtragen nach 14 Tagen', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  await fillup(u.token, v, { odometerKm: 1000, amount: 50, filledAt: '2025-01-01T12:00:00Z' });
  const ohne = await fillup(u.token, v, { amount: 30, filledAt: '2025-01-10T12:00:00Z' });
  assert.equal(ohne.odometer_km, null);
  await fillup(u.token, v, { odometerKm: 2000, amount: 40, filledAt: '2025-01-20T12:00:00Z' });
  let s = (await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body;
  assert.equal(s.missingOdometer, 1);
  assert.equal(s.segments.length, 1, 'Eintrag ohne km schließt keinen Abschnitt ab');
  assert.equal(Number(s.segments[0].liters_segment), 70);

  // Nachtragen geht trotz 14-Tage-Frist, andere Änderungen nicht
  assert.equal((await api('PATCH', `/fillups/${ohne.id}`, { token: u.token, body: { odometerKm: 1450, amount: 31 } })).status, 409);
  const nach = await api('PATCH', `/fillups/${ohne.id}`, { token: u.token, body: { odometerKm: 1450 } });
  assert.equal(nach.status, 200);
  assert.equal(nach.body.odometer_km, 1450);
  s = (await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body;
  assert.equal(s.missingOdometer, 0);
  assert.equal(s.segments.length, 2);

  // Geschätzter Wert zählt nicht
  const geschaetzt = await fillup(u.token, v, { odometerKm: 2600, odometerEstimated: true, amount: 35, filledAt: '2025-02-01T12:00:00Z' });
  assert.equal(geschaetzt.odometer_estimated, true);
  s = (await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body;
  assert.equal(s.currentOdo, 2000);
  assert.equal(s.missingOdometer, 1);
});

test('Tachostand-Prüfung (#51): Warnung statt Ablehnung', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token, 'diesel', { odometerKm: 5000 });
  const erst = await fillup(u.token, v, { odometerKm: 4000, amount: 40, filledAt: '2026-01-01T12:00:00Z' });
  assert.deepEqual(erst.warnings.map((w) => w.code), ['below_purchase']);
  await fillup(u.token, v, { odometerKm: 6000, amount: 40, filledAt: '2026-01-10T12:00:00Z' });
  const ok = await fillup(u.token, v, { odometerKm: 6500, amount: 40, filledAt: '2026-01-20T12:00:00Z' });
  assert.deepEqual(ok.warnings, []);
  const zurueck = await fillup(u.token, v, { odometerKm: 6100, amount: 40, filledAt: '2026-01-25T12:00:00Z' });
  assert.deepEqual(zurueck.warnings.map((w) => w.code), ['lower_than_previous'], 'gespeichert, aber mit Warnung');
  const sprung = await fillup(u.token, v, { odometerKm: 16500, amount: 40, filledAt: '2026-01-26T12:00:00Z' });
  assert.deepEqual(sprung.warnings.map((w) => w.code), ['jump']);
  // Ohne Tachostand keine Warnung; Ausgaben werden ebenso geprüft
  assert.deepEqual((await fillup(u.token, v, { amount: 10, filledAt: '2026-01-27T12:00:00Z' })).warnings, []);
  const ausgabe = await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Werkstatt', amountEur: 100, odometerKm: 100, occurredAt: '2026-01-28T12:00:00Z' } });
  assert.equal(ausgabe.status, 201);
  assert.deepEqual(ausgabe.body.warnings.map((w) => w.code), ['lower_than_previous']);
  assert.equal((await api('DELETE', `/entries/${ausgabe.body.id}`, { token: u.token })).status, 204);
  // PATCH korrigiert die Warnung
  const korrigiert = await api('PATCH', `/fillups/${zurueck.id}`, { token: u.token, body: { odometerKm: 6600 } });
  assert.deepEqual(korrigiert.body.warnings, []);
});

test('Kilometerstand notieren (#42) zählt als aktueller Tachostand, nicht als Kosten', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  await fillup(u.token, v, { odometerKm: 1000, amount: 40, totalCostEur: 70, filledAt: '2026-01-01T12:00:00Z' });
  const notiz = await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Kilometerstand', amountEur: 0, odometerKm: 1350, occurredAt: '2026-01-05T12:00:00Z' } });
  assert.equal(notiz.status, 201);
  assert.deepEqual(notiz.body.warnings, []);
  const s = (await api('GET', `/vehicles/${v}/stats`, { token: u.token })).body;
  assert.equal(s.currentOdo, 1350);
  assert.equal(s.segments.length, 0, 'kein Verbrauchsabschnitt');
});

test('Fahrzeugangaben (#45): speichern, ändern, prüfen', async () => {
  const u = await newUser();
  const anlegen = await api('POST', '/vehicles', { token: u.token, body: {
    name: 'Detail', fuelType: 'diesel', licensePlate: ' aa-bb 123 ', vin: 'wvw zzz 1jz xw000001', firstRegistration: '2021-03-15',
    purchaseDate: '2021-04-01', purchasePrice: 24999.5, serviceIntervalMonths: 24, serviceIntervalKm: 30000,
    insuranceCompany: 'HUK', insurancePremium: 420, insuranceDueMonth: 1, taxAmount: 180, taxDueMonth: 6, tireSizeSummer: '205/55 R16'
  } });
  assert.equal(anlegen.status, 201, JSON.stringify(anlegen.body));
  const v = anlegen.body;
  assert.equal(v.license_plate, 'AA-BB 123');
  assert.equal(v.vin, 'WVWZZZ1JZXW000001');
  assert.equal(v.first_registration, '2021-03-15', 'Datum ohne Zeitzonenverschiebung');
  assert.equal(Number(v.purchase_price), 24999.5);
  assert.equal(v.service_interval_months, 24);

  const geaendert = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { licensePlate: '', taxDueMonth: 7 } });
  assert.equal(geaendert.status, 200);
  assert.equal(geaendert.body.license_plate, null);
  assert.equal(geaendert.body.tax_due_month, 7);
  assert.equal(geaendert.body.insurance_company, 'HUK', 'nicht gesendete Felder bleiben');

  for (const [feld, wert] of [['taxDueMonth', 13], ['firstRegistration', '15.03.2021'], ['purchasePrice', -1], ['serviceIntervalKm', 50], ['vin', 'X'.repeat(18)]]) {
    const r = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { [feld]: wert } });
    assert.equal(r.status, 400, feld);
    assert.equal(r.body.error, `invalid_${feld}`);
  }
  assert.equal((await api('GET', `/vehicles/${v.id}`, { token: u.token })).body.tire_size_summer, '205/55 R16');
});

test('Fälligkeiten aus Fahrzeugangaben (#45)', async () => {
  const u = await newUser();
  const heute = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  // Erstzulassung vor 30 Monaten: erster TÜV in 6 Monaten (36 Monate nach Erstzulassung)
  const ez = new Date(Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth() - 30, 10));
  const tuevErwartet = iso(new Date(Date.UTC(ez.getUTCFullYear(), ez.getUTCMonth() + 36, 10)));
  const naechsterMonat = ((heute.getUTCMonth() + 1) % 12) + 1;
  const v = await newVehicle(u.token, 'e10', { firstRegistration: iso(ez), serviceIntervalMonths: 24, taxDueMonth: naechsterMonat });
  // Wartung vor 13 Monaten: mit 24-Monats-Intervall noch nicht fällig
  await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Wartung', amountEur: 300,
    occurredAt: iso(new Date(Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth() - 13, 1))) } });
  const r = (await api('GET', `/vehicles/${v}/reminders`, { token: u.token })).body;
  const nach = Object.fromEntries(r.map((x) => [x.category, x]));
  assert.equal(nach.TUV.due_date, tuevErwartet);
  assert.equal(nach.TUV.source, 'erstzulassung');
  assert.equal(nach.Wartung.status, 'ok');
  assert.equal(nach.Steuer.source, 'faelligkeitsmonat');
  assert.equal(nach.Steuer.due_date.slice(5, 7), String(naechsterMonat).padStart(2, '0'));
  assert.equal(nach.Versicherung.status, 'unbekannt');
});

test('Ausgabe ohne Tachostand speichert null, nicht 0', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  for (const odometerKm of [null, '']) {
    const r = await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Versicherung', amountEur: 300, odometerKm } });
    assert.equal(r.status, 201);
    assert.equal(r.body.odometer_km, null);
  }
});

test('Import: Probelauf, Duplikate, Warnungen', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  await fillup(u.token, v, { odometerKm: 10000, amount: 40, filledAt: '2026-01-01T12:00:00Z' });
  const daten = {
    fillups: [
      { filledAt: '2026-01-01', odometerKm: 10000, amount: 40, totalCostEur: 70 }, // Duplikat
      { filledAt: '2026-01-10', odometerKm: 10600, amount: 38, totalCostEur: 66 },
      { filledAt: '2026-01-15', odometerKm: 9000, amount: 20, totalCostEur: 35 }, // kleiner als vorher
      { filledAt: '2026-01-20', amount: 30, totalCostEur: 52 } // ohne km
    ],
    entries: [{ occurredAt: '2026-01-12', category: 'Werkstatt', amountEur: 120 }]
  };
  const probe = await api('POST', `/vehicles/${v}/import`, { token: u.token, body: { ...daten, dryRun: true } });
  assert.equal(probe.status, 200);
  assert.equal(probe.body.dryRun, true);
  assert.deepEqual(probe.body.duplicates, [{ type: 'fillup', index: 0 }]);
  // Der Ausreißer (Zeile 2) macht auch den Vorgänger verdächtig: dieselbe Logik wie im Formular
  assert.deepEqual(probe.body.warnings.map((w) => [w.type, w.index, w.code]), [['fillup', 1, 'higher_than_next'], ['fillup', 2, 'lower_than_previous']]);
  assert.equal((await api('GET', `/vehicles/${v}/fillups`, { token: u.token })).body.length, 1, 'Probelauf schreibt nichts');

  const echt = await api('POST', `/vehicles/${v}/import`, { token: u.token, body: daten });
  assert.equal(echt.status, 201);
  assert.deepEqual(echt.body.imported, { fillups: 3, entries: 1 });
  assert.deepEqual(echt.body.skipped, { fillups: 1, entries: 0 });
  const nochmal = await api('POST', `/vehicles/${v}/import`, { token: u.token, body: daten });
  assert.deepEqual(nochmal.body.imported, { fillups: 0, entries: 0 }, 'zweiter Import überspringt alles');

  const kaputt = await api('POST', `/vehicles/${v}/import`, { token: u.token, body: { fillups: [{ filledAt: 'gestern', amount: 1, totalCostEur: 1 }] } });
  assert.equal(kaputt.status, 400);
  assert.equal(kaputt.body.error, 'invalid_rows');
});

test('Tarife (#44): Grenzen nur mit PLAN_LIMITS_ENABLED', async () => {
  const u = await newUser();
  await newVehicle(u.token);
  await newVehicle(u.token);
  process.env.PLAN_LIMITS_ENABLED = 'true';
  try {
    const r = await api('POST', '/vehicles', { token: u.token, body: { name: 'Drittes', fuelType: 'e10' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'plan_required');
    assert.equal(r.body.feature, 'maxVehicles');
  } finally {
    delete process.env.PLAN_LIMITS_ENABLED;
  }
  assert.equal((await api('POST', '/vehicles', { token: u.token, body: { name: 'Drittes', fuelType: 'e10' } })).status, 201);
  // Tarif setzen ist nur für Admins
  assert.equal((await api('PUT', '/auth/plans', { token: u.token, body: { userIds: [u.id], plan: 'plus' } })).status, 403);
});

test('Tarifstatus nur serverseitig (#102): verbotene und erlaubte Änderungen, Protokoll', async () => {
  const u = await newUser();
  const andere = await newUser();
  const admin = await newUser();
  const tarif = async (token) => (await api('GET', '/whoami', { token })).body.plan;

  // Normale Konten: weder sich selbst noch andere hochstufen, weder einzeln noch gesammelt
  for (const [ziel, label] of [[u.id, 'selbst'], [andere.id, 'anderes Konto']]) {
    assert.equal((await api('PUT', `/auth/users/${ziel}/plan`, { token: u.token, body: { plan: 'plus' } })).status, 403, label);
    assert.equal((await api('PUT', `/auth/users/${ziel}/beta`, { token: u.token, body: { betaTester: true } })).status, 403, label);
  }
  assert.equal((await api('PUT', '/auth/plans', { token: u.token, body: { userIds: [u.id], plan: 'fleet' } })).status, 403);
  assert.equal((await api('GET', `/auth/users/${u.id}/plan-history`, { token: u.token })).status, 403);

  // Manipuliertes Profil-Update: Tarif-, Laufzeit- und Beta-Felder werden ignoriert
  const patch = await api('PATCH', `/auth/users/${u.id}`, {
    token: u.token,
    body: { username: `neu-${unique()}`, plan: 'fleet', plan_until: '2099-01-01', planUntil: '2099-01-01', beta_tester: false, betaTester: false, is_admin: true }
  });
  assert.equal(patch.status, 200);
  assert.equal(await tarif(u.token), 'free');
  const ohneErlaubtesFeld = await api('PATCH', `/auth/users/${u.id}`, { token: u.token, body: { plan: 'plus' } });
  assert.equal(ohneErlaubtesFeld.status, 400);
  assert.equal(ohneErlaubtesFeld.body.error, 'nothing_to_update');
  assert.equal(await tarif(u.token), 'free');

  // Registrierung mit Tarif im Body bleibt free
  const reg = await api('POST', '/auth/register', { body: { email: `test-${unique()}@example.test`, password: 'Passwort123', plan: 'plus' } });
  assert.equal(reg.status, 201);
  assert.equal(await tarif(reg.body.token), 'free');

  // Betreiber (Admin): setzen, ändern, zurücksetzen – mit Protokoll
  const vorher = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = admin.id;
  try {
    assert.equal((await api('PUT', `/auth/users/${u.id}/plan`, { token: admin.token, body: { plan: 'gold' } })).status, 400);
    assert.equal((await api('PUT', '/auth/users/keine-uuid/plan', { token: admin.token, body: { plan: 'plus' } })).status, 404);

    const plus = await api('PUT', `/auth/users/${u.id}/plan`, { token: admin.token, body: { plan: 'plus', planUntil: '2030-01-31', note: 'Tester' } });
    assert.equal(plus.status, 200);
    assert.equal(plus.body.plan, 'plus');
    assert.equal(await tarif(u.token), 'plus');

    // Gleicher Tarif noch einmal: kein neuer Protokolleintrag
    const gleich = await api('PUT', '/auth/plans', { token: admin.token, body: { userIds: [u.id], plan: 'plus', planUntil: '2030-01-31' } });
    assert.equal(gleich.status, 200);
    assert.equal(gleich.body.updated, 1);
    assert.equal(gleich.body.changed, 0);

    assert.equal((await api('PUT', `/auth/users/${u.id}/plan`, { token: admin.token, body: { plan: 'free', planUntil: '2031-01-01' } })).status, 200);
    assert.equal(await tarif(u.token), 'free');

    const verlauf = await api('GET', `/auth/users/${u.id}/plan-history`, { token: admin.token });
    assert.equal(verlauf.status, 200);
    assert.equal(verlauf.body.changes.length, 2);
    const [zurueck, hoch] = verlauf.body.changes;
    assert.equal(zurueck.oldPlan, 'plus');
    assert.equal(zurueck.newPlan, 'free');
    assert.equal(zurueck.newPlanUntil, null, 'Free ist immer unbefristet');
    assert.equal(hoch.oldPlan, 'free');
    assert.equal(hoch.newPlan, 'plus');
    assert.equal(hoch.source, 'admin');
    assert.equal(hoch.changedBy, admin.id);
    assert.equal(hoch.note, 'Tester');
    assert.ok(hoch.newPlanUntil.startsWith('2030-01-31'));
  } finally {
    if (vorher === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = vorher;
  }
});

test('Kategorien (#95): Liste, Premium, eigene Kategorien', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);

  // Liste mit Gruppen, festen Kategorien und Cache-Angaben
  const liste = await api('GET', '/categories', { token: u.token });
  assert.equal(liste.status, 200);
  assert.match(liste.headers.get('cache-control'), /private/);
  const etag = liste.headers.get('etag');
  assert.ok(etag);
  assert.equal((await api('GET', '/categories', { token: u.token, headers: { 'if-none-match': etag } })).status, 304);
  assert.equal((await api('GET', '/categories')).status, 401, 'nur mit Anmeldung');
  const nachKey = Object.fromEntries(liste.body.categories.map((c) => [c.key, c]));
  assert.equal(nachKey.TUV.name, 'TÜV');
  assert.equal(nachKey.Parken.plan, 'plus');
  assert.equal(nachKey.Parken.available, true, 'Beta: alle haben Plus-Rechte');
  assert.equal(nachKey.Fahrt.countsAsCost, false);
  assert.equal(nachKey.Tankfuellung.selectable, false);
  assert.equal(liste.body.custom.max, 10);

  // Unbekannte Kategorie und Tankfüllung als Ausgabe werden abgelehnt
  assert.equal((await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Quatsch', amountEur: 1 } })).body.error, 'unknown_category');
  assert.equal((await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Tankfuellung', amountEur: 1 } })).body.error, 'invalid_category');

  // Eigene Kategorie anlegen, prüfen, verwenden
  assert.equal((await api('POST', '/categories', { token: u.token, body: { name: 'tüv' } })).body.error, 'name_taken', 'Name einer festen Kategorie');
  assert.equal((await api('POST', '/categories', { token: u.token, body: { name: 'X', icon: 'fa-evil' } })).body.error, 'invalid_icon');
  const eigene = await api('POST', '/categories', { token: u.token, body: { name: 'Fähre', icon: 'fa-ferry', color: '#0dcaf0', group: 'unterwegs' } });
  assert.equal(eigene.status, 201, JSON.stringify(eigene.body));
  assert.equal(eigene.body.key, `custom:${eigene.body.id}`);
  assert.equal((await api('POST', '/categories', { token: u.token, body: { name: 'FÄHRE' } })).status, 409);
  const e1 = await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: eigene.body.key, amountEur: 80 } });
  assert.equal(e1.status, 201, JSON.stringify(e1.body));
  const umb = await api('PATCH', `/categories/${eigene.body.id}`, { token: u.token, body: { name: 'Fähre Sylt' } });
  assert.equal(umb.body.name, 'Fähre Sylt');

  // Fremde eigene Kategorien sind tabu
  const fremd = await newUser();
  const fv = await newVehicle(fremd.token);
  assert.equal((await api('POST', '/entries', { token: fremd.token, body: { vehicleId: fv, category: eigene.body.key, amountEur: 1 } })).body.error, 'unknown_category');
  assert.equal((await api('PATCH', `/categories/${eigene.body.id}`, { token: fremd.token, body: { name: 'x' } })).status, 404);
  assert.equal((await api('DELETE', `/categories/${eigene.body.id}`, { token: fremd.token })).status, 404);

  // Grenze: 10 eigene Kategorien
  for (let i = 2; i <= 10; i++) assert.equal((await api('POST', '/categories', { token: u.token, body: { name: `Eigene ${i}` } })).status, 201);
  const zuViel = await api('POST', '/categories', { token: u.token, body: { name: 'Elf' } });
  assert.equal(zuViel.status, 403);
  assert.equal(zuViel.body.error, 'category_limit_reached');

  // Free-Tarif (mit aktiven Grenzen): Premium und eigene gesperrt, Bestand bleibt änderbar
  process.env.PLAN_LIMITS_ENABLED = 'true';
  try {
    const free = await api('GET', '/categories', { token: u.token });
    const f = Object.fromEntries(free.body.categories.map((c) => [c.key, c]));
    assert.equal(f.Parken.available, false);
    assert.equal(f.Werkstatt.available, true);
    assert.equal(f[eigene.body.key].available, false);
    assert.equal(free.body.custom.canCreate, false);
    const p = await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: 'Parken', amountEur: 3 } });
    assert.equal(p.status, 403);
    assert.equal(p.body.feature, 'premiumCategories');
    assert.equal((await api('POST', '/entries', { token: u.token, body: { vehicleId: v, category: eigene.body.key, amountEur: 3 } })).body.feature, 'customCategories');
    assert.equal((await api('POST', '/categories', { token: u.token, body: { name: 'Neu' } })).body.feature, 'customCategories');
    // Bestehende Ausgabe mit eigener Kategorie: Betrag ändern geht, Kategorie bleibt
    const patch = await api('PATCH', `/entries/${e1.body.id}`, { token: u.token, body: { category: eigene.body.key, amountEur: 90 } });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    // Import ordnet gesperrte Kategorien nicht stillschweigend zu
    const imp = await api('POST', `/vehicles/${v}/import`, { token: u.token, body: { dryRun: true, entries: [{ occurredAt: '2026-02-01', category: 'Maut', amountEur: 10 }] } });
    assert.equal(imp.status, 400);
    assert.equal(imp.body.rows[0].error, 'plan_required');
  } finally {
    delete process.env.PLAN_LIMITS_ENABLED;
  }

  // Löschen: mit Ausgaben nur mit Ziel; die Ausgaben wandern mit
  const del = await api('DELETE', `/categories/${eigene.body.id}`, { token: u.token });
  assert.equal(del.status, 409);
  assert.equal(del.body.entries, 1);
  assert.equal((await api('DELETE', `/categories/${eigene.body.id}?moveTo=Fahrt`, { token: u.token })).body.error, 'invalid_moveTo');
  const ok = await api('DELETE', `/categories/${eigene.body.id}?moveTo=Parken`, { token: u.token });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.moved, 1);
  assert.equal((await api('GET', `/entries/${e1.body.id}`, { token: u.token })).body.category, 'Parken');
});

test('Bilder (#103): verkleinert, WebP, ohne Metadaten, nur signiert abrufbar', async () => {
  const sharp = require('sharp');
  const u = await newUser();
  const v = await newVehicle(u.token);
  // Großes JPEG mit EXIF (Autor) wie von einer Handykamera
  const jpeg = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .jpeg({ quality: 95 }).withExif({ IFD0: { Artist: 'Testkamera', Copyright: 'Geheim' } }).toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif, 'Testbild hat EXIF');

  const form = new FormData();
  form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'foto.jpg');
  const up = await fetch(`${base}/vehicles/${v}/media/upload`, { method: 'POST', headers: { authorization: `Bearer ${u.token}` }, body: form });
  const media = await up.json();
  assert.equal(up.status, 201, JSON.stringify(media));
  assert.equal(media.mime_type, 'image/webp');
  assert.match(media.url, /^\/api\/v1\/files\/[0-9a-f-]{36}\.webp\?exp=\d+&sig=[\w-]+$/, 'Antwort enthält signierte Adresse');
  assert.ok(media.bytes < jpeg.length / 5, `deutlich kleiner (${media.bytes} statt ${jpeg.length})`);

  // Abrufen: mit Signatur ja, ohne bzw. manipuliert nein
  const origin = base.replace(/\/api\/v1$/, '');
  const bild = await fetch(origin + media.url);
  assert.equal(bild.status, 200);
  assert.match(bild.headers.get('cache-control'), /private/);
  const buf = Buffer.from(await bild.arrayBuffer());
  const meta = await sharp(buf).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(Math.max(meta.width, meta.height), 1600);
  assert.equal(meta.exif, undefined, 'keine EXIF-Daten mehr');
  const datei = media.url.split('?')[0];
  assert.equal((await fetch(origin + datei)).status, 404, 'ohne Signatur');
  assert.equal((await fetch(origin + media.url.replace(/sig=[\w-]+/, 'sig=falsch'))).status, 404, 'falsche Signatur');
  assert.equal((await fetch(origin + media.url.replace(/exp=\d+/, 'exp=1000000000'))).status, 404, 'abgelaufen');
  assert.equal((await fetch(origin + '/uploads/' + datei.split('/').pop())).status, 404, 'kein öffentliches /uploads');

  // Bild als Fahrzeugbild setzen: signierte Adresse wird intern gespeichert und beim Lesen neu signiert
  const patch = await api('PATCH', `/vehicles/${v}`, { token: u.token, body: { imageUrl: media.url } });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const intern = await pool.query('SELECT image_url FROM vehicles WHERE id = $1', [v]);
  assert.match(intern.rows[0].image_url, /^\/uploads\/[0-9a-f-]{36}\.webp$/);
  assert.match((await api('GET', `/vehicles/${v}`, { token: u.token })).body.image_url, /^\/api\/v1\/files\//);

  // Kein Bild: abgelehnt
  const kaputt = new FormData();
  kaputt.append('file', new Blob([Buffer.from('kein bild')], { type: 'image/jpeg' }), 'x.jpg');
  assert.equal((await fetch(`${base}/media/upload`, { method: 'POST', headers: { authorization: `Bearer ${u.token}` }, body: kaputt })).status, 400);
});

test('Ungültige IDs liefern 404 statt 500', async () => {
  const u = await newUser();
  for (const p of ['/fillups/xyz', '/entries/xyz', '/vehicles/xyz', '/vehicles/xyz/stats', '/vehicles/xyz/fillups']) {
    assert.equal((await api('GET', p, { token: u.token })).status, 404, p);
  }
});

test('Anmeldung verlängern (#56)', async () => {
  const jwt = require('jsonwebtoken');
  const u = await newUser();
  const alt = jwt.decode(u.token);
  assert.ok(alt.auth_time, 'Login setzt auth_time');
  const r = await api('POST', '/auth/refresh', { token: u.token });
  assert.equal(r.status, 200);
  const neu = jwt.decode(r.body.token);
  assert.notEqual(neu.jti, alt.jti);
  assert.equal(neu.auth_time, alt.auth_time, 'auth_time bleibt beim Verlängern');
  assert.equal((await api('GET', '/whoami', { token: r.body.token })).status, 200);
  assert.equal((await api('POST', '/auth/refresh')).status, 401, 'ohne Token');

  // Letzter echter Login vor mehr als 90 Tagen: neu anmelden
  const uralt = jwt.sign({ sub: u.id, email: u.email, jti: crypto.randomUUID(), auth_time: Math.floor(Date.now() / 1000) - 91 * 86400 },
    process.env.JWT_SECRET, { expiresIn: '7d' });
  const r2 = await api('POST', '/auth/refresh', { token: uralt });
  assert.equal(r2.status, 401);
  assert.equal(r2.body.error, 'reauth_required');

  // "Auf allen Geräten abmelden" gilt auch für das Verlängern
  await new Promise((res) => setTimeout(res, 1100));
  assert.equal((await api('POST', `/auth/users/${u.id}/revoke-all`, { token: r.body.token })).status, 201);
  assert.equal((await api('POST', '/auth/refresh', { token: r.body.token })).status, 401);
});

test('Ladestationssuche (#123): nur angemeldet, prüft Eingaben, ohne Key 503', async () => {
  const u = await newUser();
  const vorher = process.env.OCM_API_KEY;
  try {
    assert.equal((await api('GET', '/charging-stations?lat=48.9&lng=10.1')).status, 401, 'ohne Token');

    delete process.env.OCM_API_KEY;
    const ohneKey = await api('GET', '/charging-stations?lat=48.9&lng=10.1', { token: u.token });
    assert.equal(ohneKey.status, 503);
    assert.equal(ohneKey.body.error, 'charging_stations_not_configured');

    process.env.OCM_API_KEY = 'test-key';
    const falsch = await api('GET', '/charging-stations?lat=48.9&lng=200', { token: u.token });
    assert.equal(falsch.status, 400);
    assert.equal(falsch.body.error, 'invalid_coordinates');
    assert.equal((await api('GET', '/charging-stations?lat=48&lng=10&radius=0', { token: u.token })).body.error, 'invalid_radius');
  } finally {
    if (vorher === undefined) delete process.env.OCM_API_KEY; else process.env.OCM_API_KEY = vorher;
  }
});

test('CORS ist ohne CORS_ORIGINS aus', async () => {
  const r = await api('GET', '/health', { headers: { origin: 'https://boese.example' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('Tankstellensuche: nur angemeldet, prüft Eingaben, ohne Key 503', async () => {
  const u = await newUser();
  const vorher = process.env.TANKERKOENIG_API_KEY;
  try {
    assert.equal((await api('GET', '/stations?lat=52.52&lng=13.4')).status, 401, 'ohne Token');

    delete process.env.TANKERKOENIG_API_KEY;
    const ohneKey = await api('GET', '/stations?lat=52.52&lng=13.4', { token: u.token });
    assert.equal(ohneKey.status, 503);
    assert.equal(ohneKey.body.error, 'stations_not_configured');

    // Ungültige Eingaben werden geprüft, bevor Tankerkönig gefragt wird
    process.env.TANKERKOENIG_API_KEY = 'test-key';
    const falsch = await api('GET', '/stations?lat=95&lng=13.4', { token: u.token });
    assert.equal(falsch.status, 400);
    assert.equal(falsch.body.error, 'invalid_coordinates');
    assert.equal((await api('GET', '/stations?lat=52&lng=13&radius=50', { token: u.token })).body.error, 'invalid_radius');
  } finally {
    if (vorher === undefined) delete process.env.TANKERKOENIG_API_KEY; else process.env.TANKERKOENIG_API_KEY = vorher;
  }
});
