// API-Vertrag (#118): Antworten der Endpunkte, die Web-App und Apps nutzen, gegen docs/openapi.1.0.0.yaml prüfen,
// dazu das einheitliche Fehlerformat und die Mindest-App-Version.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { compareVersions, parseClient, requireSupportedApp } = require('../src/lib/appVersions');

test('App-Versionen: Header lesen und vergleichen', () => {
  assert.deepEqual(parseClient('ios/0.2.0'), { platform: 'ios', version: '0.2.0' });
  assert.deepEqual(parseClient('Android/1.10.3 (42)'), { platform: 'android', version: '1.10.3' });
  assert.equal(parseClient('ios/0.2'), null);
  assert.equal(parseClient('web/1.0.0'), null);
  assert.equal(parseClient(undefined), null);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('0.2.0', '0.10.0') < 0);
});

test('App-Versionen: zu alte App bekommt 426, /health immer', () => {
  const mw = requireSupportedApp({ ios: { minimum: '0.3.0', recommended: '0.4.0' }, android: { minimum: null, recommended: null } });
  const lauf = (header, p = '/api/v1/vehicles') => {
    let status = null; let body = null; let weiter = false;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    mw({ path: p, header: () => header }, res, () => { weiter = true; });
    return { status, body, weiter };
  };
  const alt = lauf('ios/0.2.9');
  assert.equal(alt.status, 426);
  assert.equal(alt.body.error, 'app_update_required');
  assert.equal(alt.body.minimum_version, '0.3.0');
  assert.equal(lauf('ios/0.3.0').weiter, true);
  assert.equal(lauf('ios/0.2.0', '/api/v1/health').weiter, true);
  assert.equal(lauf('android/0.0.1').weiter, true, 'ohne Vorgabe für Android');
  assert.equal(lauf(undefined).weiter, true, 'Web-App schickt keinen Header');
});

if (!process.env.DATABASE_URL) {
  test('Vertragstests gegen die OpenAPI übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
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

// OpenAPI laden; Ajv kennt OpenAPIs nullable, Beispiele u. Ä. werden ignoriert (strict: false)
const doc = YAML.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'openapi.1.0.0.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
// OpenAPI 3.0 nach JSON Schema: $ref in die OpenAPI umbiegen, nullable ohne type (z. B. neben $ref) als anyOf mit null
function umbiegen(s) {
  if (Array.isArray(s)) return s.map(umbiegen);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    out[k] = k === '$ref' && typeof v === 'string' ? v.replace(/^#\/components\//, 'openapi#/components/') : umbiegen(v);
  }
  if (out.nullable === true && out.type === undefined) {
    delete out.nullable;
    return { anyOf: [out, { type: 'null' }] };
  }
  return out;
}
ajv.addSchema({ $id: 'openapi', components: umbiegen(doc.components) });

function responseSchema(method, template, status) {
  const op = doc.paths['/api/v1' + template]?.[method.toLowerCase()];
  assert.ok(op, `${method} ${template} fehlt in der OpenAPI`);
  let r = op.responses?.[String(status)];
  assert.ok(r, `${method} ${template}: Status ${status} fehlt in der OpenAPI`);
  if (r.$ref) r = doc.components.responses[r.$ref.split('/').pop()];
  return r.content?.['application/json']?.schema || null;
}

const geprueft = new Set();
async function vertrag(method, template, params, { token, body, status, client } = {}) {
  const p = template.replace(/\{(\w+)\}/g, (_, k) => params[k]);
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(client ? { 'x-fuelstat-client': client } : {})
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (status !== undefined) assert.equal(res.status, status, `${method} ${p}: ${text.slice(0, 300)}`);
  if (res.status >= 400) {
    // Einheitliches Fehlerformat
    assert.equal(typeof json?.error, 'string', `${method} ${p}: Fehler ohne error-Code: ${text.slice(0, 200)}`);
  }
  const schema = responseSchema(method, template, res.status);
  if (schema && json !== null) {
    const valid = ajv.validate(umbiegen(schema), json);
    assert.ok(valid, `${method} ${template} ${res.status} passt nicht zur OpenAPI: ${ajv.errorsText(ajv.errors, { separator: '\n' })}\n${text.slice(0, 500)}`);
    geprueft.add(`${method} ${template} ${res.status}`);
  }
  return { status: res.status, body: json };
}

test('Antworten passen zur OpenAPI (Ablauf wie in der App)', async () => {
  const tageZurueck = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const device = { name: 'iPhone Vertrag', platform: 'ios', appVersion: '0.2.0' };
  const email = `vertrag-${unique()}@example.test`;
  await vertrag('GET', '/health', {}, { status: 200 });
  const reg = await vertrag('POST', '/auth/register', {}, { body: { email, password: 'Passwort123', device }, status: 201 });
  await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [reg.body.user.id]);
  await vertrag('POST', '/auth/login', {}, { body: { email, password: 'falsch123' }, status: 401 });
  const login = await vertrag('POST', '/auth/login', {}, { body: { email, password: 'Passwort123', device }, status: 200 });
  const token = login.body.token;
  const r = await vertrag('POST', '/auth/session/refresh', {}, { body: { refreshToken: login.body.refreshToken }, status: 200 });
  await vertrag('GET', '/auth/sessions', {}, { token: r.body.token, status: 200 });
  await vertrag('GET', '/whoami', {}, { token, status: 200 });
  await vertrag('GET', '/fuels', {}, { status: 200 });
  await vertrag('GET', '/categories', {}, { token, status: 200 });

  const v = await vertrag('POST', '/vehicles', {}, { token, body: { name: 'Vertragsauto', fuelType: 'phev', brand: 'Seat', model: 'Leon', year: 2021 }, status: 201 });
  const vehicleId = v.body.id;
  await vertrag('GET', '/vehicles', {}, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}', { vehicleId }, { token, status: 200 });
  await vertrag('PATCH', '/vehicles/{vehicleId}', { vehicleId }, { token, body: { licensePlate: 'AA-B 123' }, status: 200 });
  const f = (data) => vertrag('POST', '/fillups', {}, { token, body: { vehicleId, ...data }, status: 201 });
  await f({ odometerKm: 1000, amount: 40, totalCostEur: 70, station: 'Aral', filledAt: tageZurueck(12) });
  const f2 = await f({ odometerKm: 1500, amount: 30, totalCostEur: 54, filledAt: tageZurueck(8) });
  await f({ odometerKm: 1600, amount: 10, totalCostEur: 4, unit: 'kwh', filledAt: tageZurueck(2) });
  await vertrag('PATCH', '/fillups/{fillupId}', { fillupId: f2.body.id }, { token, body: { station: 'Shell' }, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/fillups', { vehicleId }, { token, status: 200 });
  await vertrag('POST', '/entries', {}, { token, body: { vehicleId, category: 'Werkstatt', amountEur: 120, vendor: 'Autohaus', occurredAt: tageZurueck(6) }, status: 201 });
  await vertrag('GET', '/vehicles/{vehicleId}/entries', { vehicleId }, { token, status: 200 });
  await vertrag('POST', '/trips', {}, { token, body: { vehicleId, startedAt: tageZurueck(4), odometerStart: 1550, odometerEnd: 1580, purpose: 'private' }, status: 201 });
  await vertrag('GET', '/vehicles/{vehicleId}/trips', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/trips/summary', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/timeline', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/stats', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/consumption', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/costs', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/reminders', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/members', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/vehicles/{vehicleId}/media', { vehicleId }, { token, status: 200 });
  await vertrag('GET', '/invitations', {}, { token, status: 200 });
  await vertrag('POST', '/feedback', {}, { token, body: { category: 'idee', message: 'Vertragstest', page: 'iOS-App 0.2.0' }, status: 201 });

  // Fehler: immer JSON mit error
  await vertrag('GET', '/vehicles/{vehicleId}', { vehicleId: crypto.randomUUID() }, { token, status: 404 });
  await vertrag('GET', '/vehicles', {}, { status: 401 });
  const kaputt = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{kaputt' });
  assert.deepEqual([kaputt.status, (await kaputt.json()).error], [400, 'invalid_json']);
  const unbekannt = await fetch(base + '/gibt-es-nicht');
  assert.deepEqual([unbekannt.status, (await unbekannt.json()).error], [404, 'not_found']);

  assert.ok(geprueft.size >= 30, `nur ${geprueft.size} Antworten gegen die OpenAPI geprüft`);
});
