// Fahrzeugfelder, die die OpenAPI beschreiben muss (#181): sortOrder und odometerKm. Eigene Datei (eigener Prozess).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

if (!process.env.DATABASE_URL) {
  test('Fahrzeugfelder übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
delete process.env.PLAN_LIMITS_ENABLED;
const { app, pool } = require('../src/server');
const yaml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../docs/openapi.1.0.0.yaml'), 'utf8');
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

test('sortOrder und odometerKm: setzen, sortieren, Fehler; beide stehen in den Request-Schemas der OpenAPI', async () => {
  const r = await api('POST', '/auth/register', { body: { email: `vehicles-${crypto.randomBytes(5).toString('hex')}@example.test`, password: 'Passwort123' } });
  const token = r.body.token;
  const neu = (name, extra) => api('POST', '/vehicles', { token, body: { name, fuelType: 'e10', ...extra } });
  const b = (await neu('B', { sortOrder: 2, odometerKm: 12345 })).body;
  const a = (await neu('A', { sortOrder: 1 })).body;
  const c = (await neu('C', { sortOrder: 3 })).body;
  assert.equal(b.odometer_km, 12345);
  assert.equal(b.sort_order, 2);
  const namen = async () => (await api('GET', '/vehicles', { token })).body.data.map((v) => v.name);
  assert.deepEqual(await namen(), ['A', 'B', 'C']);
  // Umordnen per PATCH
  await api('PATCH', `/vehicles/${c.id}`, { token, body: { sortOrder: 0 } });
  assert.deepEqual(await namen(), ['C', 'A', 'B']);
  // Fehler wie in der Doku
  assert.equal((await neu('X', { sortOrder: 'abc' })).body.error, 'invalid_sortOrder');
  assert.equal((await neu('X', { odometerKm: -1 })).body.error, 'invalid_odometerKm');
  assert.equal((await api('PATCH', `/vehicles/${a.id}`, { token, body: { sortOrder: 'x' } })).body.error, 'invalid_sortOrder');
  assert.equal((await api('PATCH', `/vehicles/${a.id}`, { token, body: { odometerKm: -5 } })).body.error, 'invalid_odometerKm');
  // Die Request-Schemas nennen jedes Feld, das die Routen lesen
  for (const schema of ['VehicleCreateRequest', 'VehiclePatchRequest']) {
    const start = yaml.indexOf(`    ${schema}:\n`);
    const teil = yaml.slice(start, start + 1 + yaml.slice(start + 1).search(/\n {4}[A-Za-z]+:\n/));
    for (const feld of ['sortOrder', 'odometerKm', 'brand', 'model', 'year', 'imageUrl', 'mileageKm']) {
      assert.ok(teil.includes(`        ${feld}:`), `${schema} ohne ${feld}`);
    }
  }
});
