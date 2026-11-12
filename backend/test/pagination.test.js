// Seitenweises Laden (#160): Baustein lib/pagination.js, Listen-Endpunkte und die Eintragsliste /timeline.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parsePagination, paginated, MAX_PER_PAGE, DEFAULT_PER_PAGE } = require('../src/lib/pagination');

test('parsePagination: Standard, Alias limit, Obergrenze, ungültige Werte', () => {
  assert.deepEqual(parsePagination({}), { page: 1, perPage: DEFAULT_PER_PAGE, limit: DEFAULT_PER_PAGE, offset: 0 });
  assert.deepEqual(parsePagination({ page: '3', per_page: '10' }), { page: 3, perPage: 10, limit: 10, offset: 20 });
  assert.equal(parsePagination({ limit: '7' }).perPage, 7);
  assert.equal(parsePagination({ per_page: '5000' }).perPage, MAX_PER_PAGE);
  assert.equal(parsePagination({ page: '0' }).error, 'invalid_page');
  assert.equal(parsePagination({ page: 'x' }).error, 'invalid_page');
  assert.equal(parsePagination({ per_page: '-1' }).error, 'invalid_per_page');
  assert.equal(parsePagination({ per_page: '2.5' }).error, 'invalid_per_page');
});

test('paginated: Angaben zur Seite', () => {
  assert.deepEqual(paginated([1, 2], 5, { page: 1, perPage: 2 }).pagination, { current_page: 1, per_page: 2, total: 5, total_pages: 3, has_more: true });
  assert.deepEqual(paginated([5], 5, { page: 3, perPage: 2 }).pagination, { current_page: 3, per_page: 2, total: 5, total_pages: 3, has_more: false });
  assert.equal(paginated([], 0, { page: 1, perPage: 25 }).pagination.total_pages, 1);
});

if (!process.env.DATABASE_URL) {
  test('API-Tests für Paginierung übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
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
  const r = await api('POST', '/auth/register', { body: { email: `pag-${unique()}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // Bestätigt, damit mehr als ein Fahrzeug und Eintrag möglich sind (#135)
  await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
  return r.body.token;
}

test('Listen: Umschlag { data, pagination }, Blättern ohne Lücken und Doppelte', async () => {
  const token = await newUser();
  const v = (await api('POST', '/vehicles', { token, body: { name: 'Seiten', fuelType: 'e10' } })).body.id;
  // 23 Tankvorgänge, zwei davon zur selben Zeit (eindeutige Reihenfolge über id)
  for (let i = 0; i < 23; i++) {
    const r = await api('POST', '/fillups', { token, body: { vehicleId: v, amount: 10 + i, totalCostEur: 20, odometerKm: 1000 + i * 100, filledAt: new Date(Date.UTC(2026, 0, 1 + Math.min(i, 21))).toISOString() } });
    assert.equal(r.status, 201);
  }
  const seite1 = await api('GET', `/vehicles/${v}/fillups?per_page=10`, { token });
  assert.equal(seite1.status, 200);
  assert.equal(seite1.body.data.length, 10);
  assert.deepEqual(seite1.body.pagination, { current_page: 1, per_page: 10, total: 23, total_pages: 3, has_more: true });
  const ids = new Set();
  for (let page = 1; page <= 3; page++) {
    const r = await api('GET', `/vehicles/${v}/fillups?per_page=10&page=${page}`, { token });
    r.body.data.forEach((f) => ids.add(f.id));
    assert.equal(r.body.pagination.has_more, page < 3);
  }
  assert.equal(ids.size, 23, 'jede Zeile genau einmal');
  // Hinter der letzten Seite: leer, aber mit Gesamtzahl
  const leer = await api('GET', `/vehicles/${v}/fillups?per_page=10&page=9`, { token });
  assert.equal(leer.body.data.length, 0);
  assert.equal(leer.body.pagination.total, 23);
  // Standardgröße und Obergrenze
  assert.equal((await api('GET', `/vehicles/${v}/fillups`, { token })).body.pagination.per_page, 25);
  assert.equal((await api('GET', `/vehicles/${v}/fillups?per_page=1000`, { token })).body.pagination.per_page, 100);
  assert.equal((await api('GET', `/vehicles/${v}/fillups?page=0`, { token })).body.error, 'invalid_page');
  // Fahrzeuge, Ausgaben, Fahrten, Medien, Einladungen, Tokens ebenfalls im Umschlag
  for (const pfad of ['/vehicles', `/vehicles/${v}/entries`, `/vehicles/${v}/trips`, `/vehicles/${v}/media`, '/media', '/invitations', '/auth/tokens']) {
    const r = await api('GET', pfad, { token });
    assert.equal(r.status, 200, pfad);
    assert.ok(Array.isArray(r.body.data) && r.body.pagination, pfad);
  }
});

test('Eintragsliste /timeline: gemischt, gefiltert, gesucht, mit Monatssummen und Verbrauch', async () => {
  const token = await newUser();
  const v = (await api('POST', '/vehicles', { token, body: { name: 'Mischung', fuelType: 'phev' } })).body.id;
  const f = (data) => api('POST', '/fillups', { token, body: { vehicleId: v, ...data } });
  await f({ odometerKm: 1000, amount: 40, totalCostEur: 70, station: 'Aral Mitte', filledAt: '2026-01-05T10:00:00Z' });
  await f({ odometerKm: 1500, amount: 30, totalCostEur: 54, station: 'Shell Nord', filledAt: '2026-01-20T10:00:00Z' });
  await f({ odometerKm: 1600, amount: 10, totalCostEur: 4, unit: 'kwh', station: 'Wallbox', filledAt: '2026-02-02T10:00:00Z' });
  await api('POST', '/entries', { token, body: { vehicleId: v, category: 'Werkstatt', amountEur: 120, vendor: 'Autohaus Süd', description: 'Ölwechsel', occurredAt: '2026-01-25T10:00:00Z' } });
  await api('POST', '/entries', { token, body: { vehicleId: v, category: 'Kilometerstand', amountEur: 0, odometerKm: 1550, occurredAt: '2026-01-28T10:00:00Z' } });
  await api('POST', '/trips', { token, body: { vehicleId: v, startedAt: '2025-12-30T08:00:00Z', odometerStart: 900, odometerEnd: 950, startPlace: 'Zuhause', endPlace: 'Büro', purpose: 'private' } });

  let r = await api('GET', `/vehicles/${v}/timeline?per_page=4`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.pagination.total, 6);
  assert.deepEqual(r.body.data.map((x) => x.kind), ['charge', 'odometer', 'expense', 'fuel']);
  assert.deepEqual(r.body.years, [2026, 2025]);
  assert.deepEqual(r.body.kinds, { fuel: 2, charge: 1, expense: 1, odometer: 1, trip: 1 });
  // Monatssummen über den ganzen Monat (auch Einträge der nächsten Seite), km-Notiz ohne Kosten
  assert.deepEqual(r.body.months, [{ month: '2026-02', count: 1, total: 4 }, { month: '2026-01', count: 4, total: 244 }]);
  // Verbrauch je Tankvorgang aus den Abschnitten
  const shell = r.body.data.find((x) => x.place === 'Shell Nord');
  assert.ok(Math.abs(shell.consumption - 6) < 0.01);
  assert.equal(r.body.data.find((x) => x.kind === 'odometer').countsAsCost, false);

  // Seite 2: Rest
  r = await api('GET', `/vehicles/${v}/timeline?per_page=4&page=2`, { token });
  assert.deepEqual(r.body.data.map((x) => x.kind), ['fuel', 'trip']);
  const fahrt = r.body.data.find((x) => x.kind === 'trip');
  assert.equal(fahrt.start_place, 'Zuhause');
  assert.equal(fahrt.distance_km, 50);

  // Filter nach Art, Jahr und Suche
  r = await api('GET', `/vehicles/${v}/timeline?type=fuel,charge`, { token });
  assert.equal(r.body.pagination.total, 3);
  r = await api('GET', `/vehicles/${v}/timeline?year=2025`, { token });
  assert.deepEqual(r.body.data.map((x) => x.kind), ['trip']);
  r = await api('GET', `/vehicles/${v}/timeline?q=öl`, { token });
  assert.deepEqual(r.body.data.map((x) => x.category), ['Werkstatt']);
  r = await api('GET', `/vehicles/${v}/timeline?q=${encodeURIComponent('100%')}`, { token });
  assert.equal(r.body.pagination.total, 0, '% gilt wörtlich');
  // Monatssummen mit Filter: nur die Treffer
  r = await api('GET', `/vehicles/${v}/timeline?type=expense`, { token });
  assert.deepEqual(r.body.months, [{ month: '2026-01', count: 1, total: 120 }]);
  assert.equal((await api('GET', `/vehicles/${v}/timeline?type=urlaub`, { token })).body.error, 'invalid_type');

  // Fremde sehen nichts
  const fremd = await newUser();
  assert.equal((await api('GET', `/vehicles/${v}/timeline`, { token: fremd })).status, 404);
});
