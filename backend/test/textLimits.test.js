// Obergrenzen für Freitexte (#197): je Feld ist die Grenze erlaubt und Grenze + 1 ergibt 400 invalid_<feld> mit max.
// Eigene Datei (eigener Prozess).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { TEXT_LIMITS, tooLongText } = require('../src/lib/textLimits');

test('tooLongText: Grenze, Grenze + 1, nicht gesendet, null, Leerzeichen am Rand zählen nicht', () => {
  assert.equal(tooLongText({ name: 'x'.repeat(100) }, ['name']), null);
  assert.deepEqual(tooLongText({ name: 'x'.repeat(101) }, ['name']), { error: 'invalid_name', max: 100 });
  assert.equal(tooLongText({ name: `  ${'x'.repeat(100)}  ` }, ['name']), null);
  assert.equal(tooLongText({}, ['name', 'note']), null);
  assert.equal(tooLongText({ note: null }, ['note']), null);
  assert.equal(tooLongText(undefined, ['note']), null);
  assert.deepEqual(tooLongText({ vendor: 'ok', description: 'x'.repeat(2001) }, ['vendor', 'description']), { error: 'invalid_description', max: 2000 });
  assert.throws(() => tooLongText({}, ['gibtsnicht']));
});

if (!process.env.DATABASE_URL) {
  test('Textgrenzen der Routen übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
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
const lang = (feld, plus = 0) => 'x'.repeat(TEXT_LIMITS[feld] + plus);

// Grenze erlaubt, Grenze + 1 abgelehnt; `senden` schickt das Feld mit dem Wert und liefert die Antwort
async function pruefe(feld, senden, okStatus) {
  const gut = await senden(lang(feld));
  assert.equal(gut.status, okStatus, `${feld} an der Grenze: ${JSON.stringify(gut.body)}`);
  const schlecht = await senden(lang(feld, 1));
  assert.equal(schlecht.status, 400, `${feld} über der Grenze`);
  assert.deepEqual(schlecht.body, { error: `invalid_${feld}`, max: TEXT_LIMITS[feld] });
  return gut;
}

test('Fahrzeuge, Tank- und Ladevorgänge, Ausgaben, Fahrten, Konto: Grenze ja, Grenze + 1 nein', async () => {
  const reg = await api('POST', '/auth/register', { body: { email: `text-${crypto.randomBytes(5).toString('hex')}@example.test`, password: 'Passwort123' } });
  const token = reg.body.token;
  const userId = reg.body.user.id;

  // Fahrzeug: anlegen und ändern
  let v;
  for (const feld of ['name', 'brand', 'model']) {
    const r = await pruefe(feld, (wert) => api('POST', '/vehicles', { token, body: { name: 'Auto', fuelType: 'e10', [feld]: wert } }), 201);
    v ??= r.body.id;
    await pruefe(feld, (wert) => api('PATCH', `/vehicles/${v}`, { token, body: { [feld]: wert } }), 200);
  }
  // Ein Fahrzeug mit langen Werten bleibt lesbar und lässt sich ohne die Felder weiter ändern
  assert.equal((await api('PATCH', `/vehicles/${v}`, { token, body: { year: 2020 } })).status, 200);

  // Tank- und Ladevorgang
  const f = await pruefe('station', (wert) => api('POST', '/fillups', { token, body: { vehicleId: v, odometerKm: 1000, amount: 40, totalCostEur: 70, station: wert } }), 201);
  await pruefe('station', (wert) => api('PATCH', `/fillups/${f.body.id}`, { token, body: { station: wert } }), 200);

  // Ausgabe
  for (const feld of ['vendor', 'description']) {
    const e = await pruefe(feld, (wert) => api('POST', '/entries', { token, body: { vehicleId: v, category: 'Werkstatt', amountEur: 10, [feld]: wert } }), 201);
    await pruefe(feld, (wert) => api('PATCH', `/entries/${e.body.id}`, { token, body: { [feld]: wert } }), 200);
  }

  // Fahrt: bisher stumm auf 200 Zeichen gekürzt
  let km = 2000;
  for (const feld of ['startPlace', 'endPlace', 'note']) {
    const t = await pruefe(feld, (wert) => api('POST', '/trips', { token, body: { vehicleId: v, odometerEnd: (km += 10), distanceKm: 10, purpose: 'private', [feld]: wert } }), 201);
    assert.equal(t.body[{ startPlace: 'start_place', endPlace: 'end_place', note: 'note' }[feld]].length, TEXT_LIMITS[feld], `${feld} ungekürzt gespeichert`);
    await pruefe(feld, (wert) => api('PATCH', `/trips/${t.body.id}`, { token, body: { [feld]: wert } }), 200);
  }

  // Konto
  await pruefe('username', (wert) => api('PATCH', `/auth/users/${userId}`, { token, body: { username: `${crypto.randomBytes(3).toString('hex')}${wert.slice(6)}` } }), 200);

  // Import: zu lange Texte je Zeile gemeldet, nichts importiert
  const imp = await api('POST', `/vehicles/${v}/import`, { token, body: {
    fillups: [{ filledAt: '2026-01-02T10:00:00Z', amount: 40, totalCostEur: 70, station: lang('station', 1) }],
    entries: [{ occurredAt: '2026-01-03T10:00:00Z', category: 'Werkstatt', amountEur: 5, description: lang('description', 1) }]
  } });
  assert.equal(imp.status, 400);
  assert.equal(imp.body.error, 'invalid_rows');
  assert.deepEqual(imp.body.rows, [
    { type: 'fillup', index: 0, error: 'invalid_station', max: TEXT_LIMITS.station },
    { type: 'entry', index: 0, error: 'invalid_description', max: TEXT_LIMITS.description }
  ]);
  const ok = await api('POST', `/vehicles/${v}/import`, { token, body: {
    fillups: [{ filledAt: '2026-01-02T10:00:00Z', amount: 40, totalCostEur: 70, station: lang('station') }]
  } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});
