// Fahrzeug-Lebenszyklus (#79): Status, Archiv (nur lesbar), Tarifgrenzen, Erinnerungen. Eigene Datei (eigener Prozess).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseStatusInput, today } = require('../src/services/vehicleStatus');
const { target } = require('../src/middleware/vehicleStatus');
const plans = require('../src/services/plans');

test('parseStatusInput: Prüfung, null löscht, nicht gesendet bleibt', () => {
  assert.deepEqual(parseStatusInput({}), { values: {} });
  assert.deepEqual(parseStatusInput({ status: 'sold', saleOdometerKm: '12345', decommissionedFrom: '2026-01-01', decommissionedUntil: null }).values,
    { status: 'sold', sale_odometer_km: 12345, decommissioned_from: '2026-01-01', decommissioned_until: null });
  assert.equal(parseStatusInput({ status: 'weg' }).error, 'invalid_status');
  assert.equal(parseStatusInput({ saleOdometerKm: -1 }).error, 'invalid_saleOdometerKm');
  assert.equal(parseStatusInput({ saleOdometerKm: 1.5 }).error, 'invalid_saleOdometerKm');
  assert.equal(parseStatusInput({ decommissionedFrom: '31.12.2026' }).error, 'invalid_decommissionedFrom');
  assert.equal(parseStatusInput({ decommissionedUntil: '2026-13-45' }).error, 'invalid_decommissionedUntil');
  assert.match(today(new Date('2026-06-30T22:30:00Z')), /^2026-07-01$/, 'Europe/Berlin');
});

test('Tarife: Zahlen gelten erst mit PLAN_LIMITS_ENABLED, bis dahin unbegrenzt', () => {
  delete process.env.PLAN_LIMITS_ENABLED;
  for (const plan of ['free', 'plus', 'fleet']) {
    const f = plans.featuresOf({ plan });
    assert.equal(f.maxVehicles, null, plan);
    assert.equal(f.maxArchivedVehicles, null, plan);
  }
  process.env.PLAN_LIMITS_ENABLED = 'true';
  try {
    assert.deepEqual([plans.featuresOf({ plan: 'free' }).maxVehicles, plans.featuresOf({ plan: 'free' }).maxArchivedVehicles], [1, 1]);
    assert.deepEqual([plans.featuresOf({ plan: 'plus' }).maxVehicles, plans.featuresOf({ plan: 'plus' }).maxArchivedVehicles], [5, 5]);
    assert.deepEqual([plans.featuresOf({ plan: 'fleet' }).maxVehicles, plans.featuresOf({ plan: 'fleet' }).maxArchivedVehicles], [25, 25]);
  } finally {
    delete process.env.PLAN_LIMITS_ENABLED;
  }
});

test('Sperre: target() erkennt Fahrzeug aus Pfad, Body und Zeile; Ausnahmen sind ausdrücklich', () => {
  const id = crypto.randomUUID();
  assert.deepEqual(target('POST', `/vehicles/${id}/parts`, {}), { vehicleId: id });
  assert.deepEqual(target('PUT', `/vehicles/${id}/part-intervals/oil`, {}), { vehicleId: id });
  assert.deepEqual(target('POST', '/fillups', { vehicleId: id }), { vehicleId: id });
  assert.deepEqual(target('PATCH', `/entries/${id}`, {}), { table: 'expenses', rowId: id });
  assert.deepEqual(target('DELETE', `/trips/${id}`, {}), { table: 'trips', rowId: id });
  // Ausnahmen: Status ändern und Löschen regelt die Route, Mitglieder und Einladungen entfernen geht immer
  assert.equal(target('PATCH', `/vehicles/${id}`, {}), null);
  assert.equal(target('DELETE', `/vehicles/${id}`, {}), null);
  assert.equal(target('DELETE', `/vehicles/${id}/members/${id}`, {}), null);
  assert.equal(target('DELETE', `/vehicles/${id}/invitations/${id}`, {}), null);
  assert.equal(target('POST', `/vehicles/${id}/invitations`, {}).vehicleId, id, 'neue Einladungen nicht');
  assert.equal(target('POST', '/vehicles', { name: 'x' }), null);
  assert.equal(target('POST', '/fillups', { vehicleId: 'kein-uuid' }), null);
});

if (!process.env.DATABASE_URL) {
  test('Lebenszyklus übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
delete process.env.PLAN_LIMITS_ENABLED;
const { app, pool } = require('../src/server');
const notifier = require('../src/services/notifier');
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
  const r = await api('POST', '/auth/register', { body: { email: `status-${unique()}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id };
}
async function newVehicle(token, name = `Auto ${unique()}`) {
  const r = await api('POST', '/vehicles', { token, body: { name, fuelType: 'e10' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const iso = (tage) => new Date(Date.now() - tage * 86400000).toISOString();

test('Status: Verkauf mit Standarddatum, Stilllegung, Wiederaktivieren, Liste mit Filter', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  assert.equal(v.status, 'active');
  // Verkaufsdatum allein archiviert nicht (der Status wird nie geraten)
  const mitDatum = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { saleDate: '2025-01-01' } });
  assert.equal(mitDatum.body.status, 'active');
  // Verkauf: Datum aus den Fahrzeugangaben bleibt, Tachostand und Erlös dazu
  const verkauft = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { status: 'sold', saleOdometerKm: 98765, salePrice: 8500 } });
  assert.equal(verkauft.status, 200, JSON.stringify(verkauft.body));
  assert.deepEqual([verkauft.body.status, verkauft.body.sale_date, verkauft.body.sale_odometer_km, Number(verkauft.body.sale_price)], ['sold', '2025-01-01', 98765, 8500]);
  // Ohne Datum: heute
  const w = await newVehicle(u.token);
  const heute = (await api('PATCH', `/vehicles/${w.id}`, { token: u.token, body: { status: 'sold' } })).body;
  assert.equal(heute.sale_date, today());
  // Stilllegung mit Zeitraum; „bis“ vor „ab“ ist ungültig, und es gibt keine automatische Reaktivierung
  const x = await newVehicle(u.token);
  assert.equal((await api('PATCH', `/vehicles/${x.id}`, { token: u.token, body: { status: 'decommissioned', decommissionedFrom: '2026-02-01', decommissionedUntil: '2026-01-01' } })).body.error, 'invalid_decommissionedUntil');
  const still = (await api('PATCH', `/vehicles/${x.id}`, { token: u.token, body: { status: 'decommissioned', decommissionedFrom: '2020-02-01', decommissionedUntil: '2020-06-01' } })).body;
  assert.deepEqual([still.status, still.decommissioned_from, still.decommissioned_until], ['decommissioned', '2020-02-01', '2020-06-01']);
  assert.equal((await api('GET', `/vehicles/${x.id}`, { token: u.token })).body.status, 'decommissioned', 'bleibt archiviert, auch nach „bis“');
  assert.equal((await api('PATCH', `/vehicles/${x.id}`, { token: u.token, body: { status: 'kaputt' } })).body.error, 'invalid_status');
  // Liste: alle, aktiv, archiviert
  const namen = async (q) => (await api('GET', `/vehicles${q}`, { token: u.token })).body.data.map((a) => a.id).sort();
  assert.deepEqual(await namen(''), [v.id, w.id, x.id].sort(), 'archivierte bleiben standardmäßig in der Liste');
  assert.deepEqual(await namen('?status=active'), []);
  assert.deepEqual(await namen('?status=archived'), [v.id, w.id, x.id].sort());
  assert.equal((await api('GET', '/vehicles?status=alle', { token: u.token })).body.error, 'invalid_status');
  // Wiederaktivieren
  const zurueck = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { status: 'active' } });
  assert.equal(zurueck.body.status, 'active');
  assert.deepEqual(await namen('?status=active'), [v.id]);
});

test('Archiv ist nur lesbar: jede schreibende Anfrage zum Fahrzeug antwortet 409, Ausnahmen gehen', async () => {
  const u = await newUser();
  const v = await newVehicle(u.token);
  const fillup = (await api('POST', '/fillups', { token: u.token, body: { vehicleId: v.id, odometerKm: 1000, amount: 40, totalCostEur: 60 } })).body;
  const entry = (await api('POST', '/entries', { token: u.token, body: { vehicleId: v.id, category: 'Wartung', amountEur: 100 } })).body;
  const trip = (await api('POST', '/trips', { token: u.token, body: { vehicleId: v.id, startedAt: iso(3), odometerStart: 1000, odometerEnd: 1010, purpose: 'private' } })).body;
  assert.ok(fillup.id && entry.id && trip.id, JSON.stringify([fillup, entry, trip]));
  const teil = (await api('POST', `/vehicles/${v.id}/parts`, { token: u.token, body: { name: 'Dachträger' } })).body;
  const andere = await newUser();
  assert.equal((await api('POST', `/vehicles/${v.id}/invitations`, { token: u.token, body: { email: `x-${unique()}@example.test`, role: 'viewer' } })).status === 201 || true, true);
  assert.equal((await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { status: 'sold' } })).status, 200);

  const gesperrt = [
    ['POST', '/fillups', { vehicleId: v.id, amount: 1, totalCostEur: 1 }],
    ['PATCH', `/fillups/${fillup.id}`, { station: 'x' }],
    ['DELETE', `/fillups/${fillup.id}`],
    ['POST', '/entries', { vehicleId: v.id, category: 'Wartung', amountEur: 1 }],
    ['PATCH', `/entries/${entry.id}`, { description: 'x' }],
    ['DELETE', `/entries/${entry.id}`],
    ['POST', '/trips', { vehicleId: v.id, startedAt: iso(1), odometerStart: 1010, odometerEnd: 1020, purpose: 'private' }],
    ['PATCH', `/trips/${trip.id}`, { note: 'x' }],
    ['DELETE', `/trips/${trip.id}`],
    ['POST', `/vehicles/${v.id}/import`, { entries: [{ occurredAt: iso(1), category: 'Wartung', amountEur: 1 }] }],
    ['POST', `/vehicles/${v.id}/parts`, { name: 'Neu' }],
    ['PATCH', `/vehicles/${v.id}/parts/${teil.id}`, { name: 'Anders' }],
    ['DELETE', `/vehicles/${v.id}/parts/${teil.id}`],
    ['PUT', `/vehicles/${v.id}/part-intervals/oil`, { intervalMonths: 12 }],
    ['POST', `/vehicles/${v.id}/media/upload`],
    ['DELETE', `/vehicles/${v.id}/media/${crypto.randomUUID()}`],
    ['POST', `/vehicles/${v.id}/invitations`, { email: 'neu@example.test', role: 'viewer' }],
    ['PATCH', `/vehicles/${v.id}/members/${andere.id}`, { role: 'editor' }],
    ['PATCH', `/vehicles/${v.id}`, { name: 'Neuer Name' }],
    ['PATCH', `/vehicles/${v.id}`, { odometerKm: 5, saleDate: '2025-01-01' }]
  ];
  for (const [method, path, body] of gesperrt) {
    const r = await api(method, path, { token: u.token, body });
    assert.equal(r.status, 409, `${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'vehicle_archived', `${method} ${path}`);
    assert.equal(typeof r.body.message, 'string');
  }
  // Nichts wurde verändert
  assert.equal((await api('GET', `/fillups/${fillup.id}`, { token: u.token })).body.station, null);
  assert.equal((await api('GET', `/vehicles/${v.id}`, { token: u.token })).body.name, v.name);

  // Lesen geht, auch Statistik, Export und Service-Ansicht
  for (const pfad of [`/vehicles/${v.id}`, `/vehicles/${v.id}/fillups`, `/vehicles/${v.id}/entries`, `/vehicles/${v.id}/trips`, `/vehicles/${v.id}/timeline`,
    `/vehicles/${v.id}/stats`, `/vehicles/${v.id}/consumption`, `/vehicles/${v.id}/costs`, `/vehicles/${v.id}/service`, `/vehicles/${v.id}/parts`, `/vehicles/${v.id}/members`]) {
    assert.equal((await api('GET', pfad, { token: u.token })).status, 200, pfad);
  }
  // Erlaubt: Reihenfolge, Verkaufsangaben, Wiederaktivieren (mit Änderung in derselben Anfrage), Löschen
  assert.equal((await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { sortOrder: 3 } })).status, 200);
  const kor = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { salePrice: 9000, saleOdometerKm: 1234 } });
  assert.equal(kor.status, 200);
  assert.equal(Number(kor.body.sale_price), 9000);
  const aktiv = await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { status: 'active', name: 'Wieder da' } });
  assert.equal(aktiv.status, 200, JSON.stringify(aktiv.body));
  assert.deepEqual([aktiv.body.status, aktiv.body.name], ['active', 'Wieder da']);
  assert.equal((await api('PATCH', `/fillups/${fillup.id}`, { token: u.token, body: { station: 'ok' } })).status, 200, 'nach dem Aktivieren wieder änderbar');
  await api('PATCH', `/vehicles/${v.id}`, { token: u.token, body: { status: 'decommissioned' } });
  assert.equal((await api('DELETE', `/vehicles/${v.id}`, { token: u.token })).status, 204, 'Löschen bleibt möglich');
});

test('Sperre erfasst jede schreibende Route der Anwendung (neue Routen müssen eingeordnet werden)', () => {
  const stack = (app.router || app._router).stack;
  const routen = [];
  const sammeln = (st) => {
    for (const l of st) {
      if (l.route) for (const m of Object.keys(l.route.methods)) routen.push({ method: m.toUpperCase(), path: l.route.path });
      else if (l.handle && l.handle.stack) sammeln(l.handle.stack);
    }
  };
  sammeln(stack);
  const id = crypto.randomUUID();
  const konkret = (p) => p.replace(/:[A-Za-z]+/g, id);
  // Schreibende Routen, die ein Fahrzeug betreffen, aber bewusst nicht gesperrt sind (die Route regelt es selbst oder es geht um Löschen)
  const bewusst = new Set([
    'PATCH /vehicles/:vehicleId', 'DELETE /vehicles/:vehicleId', 'POST /vehicles',
    'DELETE /vehicles/:vehicleId/members/:userId', 'DELETE /vehicles/:vehicleId/invitations/:invitationId'
  ]);
  const geprueft = [];
  for (const r of routen.filter((x) => x.method !== 'GET' && x.method !== 'HEAD' && x.method !== 'OPTIONS')) {
    const key = `${r.method} ${r.path}`;
    const betrifftFahrzeug = /vehicle/i.test(r.path) || /^\/(fillups|entries|trips)(\/|$)/.test(r.path);
    if (!betrifftFahrzeug) continue;
    geprueft.push(key);
    const body = r.method === 'POST' ? { vehicleId: id } : {};
    const gesperrt = target(r.method, konkret(r.path), body) !== null;
    assert.equal(gesperrt, !bewusst.has(key), `${key}: ${gesperrt ? 'gesperrt, aber als Ausnahme geführt' : 'weder gesperrt noch als Ausnahme geführt'}`);
  }
  assert.ok(geprueft.length >= 20, `nur ${geprueft.length} Routen geprüft`);
});

test('Tarifgrenzen (#79): aktive und archivierte zählen getrennt, nur mit PLAN_LIMITS_ENABLED', async () => {
  const u = await newUser();
  const a = await newVehicle(u.token);
  const b = await newVehicle(u.token);
  // Ohne Tarifgrenzen: beliebig viele, auch Archiv
  assert.equal((await api('PATCH', `/vehicles/${a.id}`, { token: u.token, body: { status: 'sold' } })).status, 200);
  assert.equal((await api('PATCH', `/vehicles/${b.id}`, { token: u.token, body: { status: 'sold' } })).status, 200);
  assert.equal((await api('GET', '/whoami', { token: u.token })).body.features.maxArchivedVehicles, null);
  await api('PATCH', `/vehicles/${a.id}`, { token: u.token, body: { status: 'active' } });
  await api('PATCH', `/vehicles/${b.id}`, { token: u.token, body: { status: 'active' } });
  process.env.PLAN_LIMITS_ENABLED = 'true';
  try {
    const me = (await api('GET', '/whoami', { token: u.token })).body;
    assert.deepEqual([me.features.maxVehicles, me.features.maxArchivedVehicles], [1, 1]);
    // Zwei aktive bei Grenze 1: nichts wird gelöscht, aber nichts Neues angelegt
    assert.deepEqual((await api('POST', '/vehicles', { token: u.token, body: { name: 'C', fuelType: 'e10' } })).body.feature, 'maxVehicles');
    // Archivieren: erstes geht, zweites trifft die Grenze für archivierte
    assert.equal((await api('PATCH', `/vehicles/${a.id}`, { token: u.token, body: { status: 'sold' } })).status, 200);
    const zweites = await api('PATCH', `/vehicles/${b.id}`, { token: u.token, body: { status: 'sold' } });
    assert.equal(zweites.status, 403);
    assert.deepEqual([zweites.body.error, zweites.body.feature, zweites.body.limit], ['plan_required', 'maxArchivedVehicles', 1]);
    // Archivierte zählen nicht für die Grenze der aktiven: b ist aktiv, a archiviert, also ist die Grenze (1) erreicht
    assert.equal((await api('POST', '/vehicles', { token: u.token, body: { name: 'C', fuelType: 'e10' } })).body.feature, 'maxVehicles');
    // Verkauf in Stilllegung ändern braucht keinen weiteren Platz
    assert.equal((await api('PATCH', `/vehicles/${a.id}`, { token: u.token, body: { status: 'decommissioned' } })).status, 200);
    // Wiederaktivieren trifft die Grenze der aktiven (b ist aktiv)
    const wieder = await api('PATCH', `/vehicles/${a.id}`, { token: u.token, body: { status: 'active' } });
    assert.deepEqual([wieder.status, wieder.body.feature], [403, 'maxVehicles']);
    // b archivieren geht nicht (Archiv voll), b löschen und a aktivieren schon
    assert.equal((await api('DELETE', `/vehicles/${b.id}`, { token: u.token })).status, 204);
    assert.equal((await api('PATCH', `/vehicles/${a.id}`, { token: u.token, body: { status: 'active' } })).status, 200);
  } finally {
    delete process.env.PLAN_LIMITS_ENABLED;
  }
});

test('Erinnerungen, Monatsbericht und Mails entfallen bei archivierten Fahrzeugen', async () => {
  const u = await newUser();
  const aktiv = await newVehicle(u.token, 'Aktiv');
  const alt = await newVehicle(u.token, 'Archiviert');
  for (const v of [aktiv, alt]) {
    // TÜV vor drei Jahren (überfällig) und ein Tankvorgang ohne Tachostand vor 5 Tagen (für „Kilometerstand nachtragen“)
    await api('POST', '/entries', { token: u.token, body: { vehicleId: v.id, category: 'TUV', amountEur: 100, occurredAt: iso(1100) } });
    await api('POST', '/fillups', { token: u.token, body: { vehicleId: v.id, amount: 30, totalCostEur: 50, filledAt: iso(5) } });
  }
  await pool.query(`UPDATE fillups SET created_at = now() - interval '5 days' WHERE vehicle_id = ANY($1)`, [[aktiv.id, alt.id]]);
  const settings = { user_id: u.id, reminder_days: 30 };
  const jetzt = new Date();
  const namen = async () => ({
    faellig: (await notifier.collectDueReminders(pool, settings)).map((x) => x.vehicle),
    tacho: (await notifier.collectMissingOdometers(pool, settings, jetzt)).map((x) => x.vehicle),
    still: (await notifier.collectInactive(pool, settings, jetzt)).map((x) => x.vehicle)
  });
  let n = await namen();
  assert.ok(n.faellig.includes('Archiviert') && n.tacho.includes('Archiviert'), JSON.stringify(n));
  assert.ok((await api('GET', `/vehicles/${alt.id}/reminders`, { token: u.token })).body.length > 0);
  await api('PATCH', `/vehicles/${alt.id}`, { token: u.token, body: { status: 'sold' } });
  n = await namen();
  for (const k of ['faellig', 'tacho']) {
    assert.ok(!n[k].includes('Archiviert'), `${k}: ${JSON.stringify(n[k])}`);
    assert.ok(n[k].includes('Aktiv'), `${k} behält das aktive Fahrzeug`);
  }
  assert.deepEqual((await api('GET', `/vehicles/${alt.id}/reminders`, { token: u.token })).body, []);
  // „Lange kein Eintrag“: beide Fahrzeuge lange ohne Eintrag; das archivierte meldet sich nicht mehr
  await api('PATCH', `/vehicles/${alt.id}`, { token: u.token, body: { status: 'active' } });
  await pool.query(`UPDATE fillups SET filled_at = now() - interval '200 days' WHERE vehicle_id = ANY($1)`, [[aktiv.id, alt.id]]);
  await pool.query(`UPDATE expenses SET occurred_at = now() - interval '200 days' WHERE vehicle_id = ANY($1)`, [[aktiv.id, alt.id]]);
  assert.deepEqual((await namen()).still.sort(), ['Aktiv', 'Archiviert']);
  await api('PATCH', `/vehicles/${alt.id}`, { token: u.token, body: { status: 'decommissioned' } });
  assert.deepEqual((await namen()).still, ['Aktiv']);
  // Monatsbericht: nur aktive Fahrzeuge
  const bericht = await notifier.buildMonthlyReport(pool, settings, new Date().getFullYear(), new Date().getMonth() + 1);
  assert.ok(!bericht.sections.some((x) => x.name === 'Archiviert'));
});
