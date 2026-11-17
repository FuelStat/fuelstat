// Service-Historie je Bauteil (#78). Eigene Datei (eigener Prozess).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { lifetimeOf, nextChange } = require('../src/services/parts');

test('Lebensdauer: braucht zwei Wechsel, km nur mit zwei Tachoständen', () => {
  assert.equal(lifetimeOf([{ date: '2024-01-01', odometer_km: 1000 }]), null);
  const l = lifetimeOf([
    { date: '2025-01-01', odometer_km: 31000 },
    { date: '2023-01-01', odometer_km: 1000 },
    { date: '2024-01-01', odometer_km: 16000 }
  ]);
  assert.equal(l.changes, 3);
  assert.equal(l.avgKm, 15000);
  assert.equal(l.lastKm, 15000);
  assert.ok(Math.abs(l.avgMonths - 12) < 0.1);
  const ohneKm = lifetimeOf([{ date: '2023-01-01', odometer_km: null }, { date: '2024-01-01', odometer_km: 16000 }]);
  assert.equal(ohneKm.avgKm, null, 'ein Wechsel ohne Tachostand: keine km');
  assert.ok(ohneKm.avgMonths > 11);
  assert.equal(lifetimeOf([{ date: '2023-01-01', odometer_km: 5000 }, { date: '2024-01-01', odometer_km: 4000 }]).avgKm, null, 'Stand geht zurück');
});

test('Nächster Wechsel: Intervall oder Ø-Lebensdauer; eine Schätzung ist nie überfällig', () => {
  const today = new Date('2026-06-15T12:00:00Z');
  const last = { date: '2025-06-01T10:00:00Z', odometer_km: 40000 };
  // Eigenes Intervall: 12 Monate oder 15.000 km, was zuerst kommt
  let n = nextChange({ last, interval: { months: 12, km: 15000 }, currentOdo: 50000, today });
  assert.deepEqual([n.due_date, n.due_km, n.source, n.status], ['2026-06-01', 55000, 'interval', 'ueberfaellig']);
  n = nextChange({ last, interval: { months: 24, km: 15000 }, currentOdo: 54500, today });
  assert.equal(n.status, 'bald', 'weniger als 1.000 km');
  n = nextChange({ last, interval: { months: 24, km: null }, currentOdo: 50000, today });
  assert.deepEqual([n.due_date, n.due_km, n.status], ['2027-06-01', null, 'ok']);
  // Ohne Intervall und ohne Lebensdauer: kein Termin
  assert.equal(nextChange({ last, interval: null, lifetime: null, currentOdo: 1, today }), null);
  // Aus der Lebensdauer: nur Schätzung, auch bei lange überschrittenem Termin höchstens „bald“
  n = nextChange({ last, interval: null, lifetime: { avgMonths: 6, avgKm: 8000 }, currentOdo: 60000, today });
  assert.equal(n.source, 'lifetime');
  assert.equal(n.status, 'bald');
  assert.equal(nextChange({ last: null, interval: { months: 12 }, today }), null);
});

if (!process.env.DATABASE_URL) {
  test('Bauteile übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
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
  const r = await api('POST', '/auth/register', { body: { email: `parts-${unique()}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token;
}
async function newVehicle(token) {
  const r = await api('POST', '/vehicles', { token, body: { name: `Auto ${unique()}`, fuelType: 'e10' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const entry = (token, vehicleId, body) => api('POST', '/entries', { token, body: { vehicleId, category: 'Werkstatt', amountEur: 100, ...body } });

test('Auswahl: eingebaute Bauteile plus eigene; eigene anlegen, umbenennen, löschen', async () => {
  const token = await newUser();
  const v = await newVehicle(token);
  const katalog = (await api('GET', `/vehicles/${v.id}/parts`, { token })).body;
  assert.ok(katalog.parts.find((p) => p.key === 'oil' && p.builtin));
  assert.ok(katalog.parts.find((p) => p.key === 'brake_pads_front'));
  const neu = await api('POST', `/vehicles/${v.id}/parts`, { token, body: { name: ' Dachträger ' } });
  assert.equal(neu.status, 201, JSON.stringify(neu.body));
  assert.match(neu.body.key, /^custom:/);
  assert.equal(neu.body.name, 'Dachträger');
  assert.equal((await api('POST', `/vehicles/${v.id}/parts`, { token, body: { name: 'dachträger' } })).body.error, 'part_exists');
  assert.equal((await api('POST', `/vehicles/${v.id}/parts`, { token, body: { name: 'Zündkerzen' } })).body.error, 'part_exists', 'wie ein eingebautes');
  assert.equal((await api('POST', `/vehicles/${v.id}/parts`, { token, body: { name: ' ' } })).body.error, 'invalid_name');
  const um = await api('PATCH', `/vehicles/${v.id}/parts/${neu.body.id}`, { token, body: { name: 'Fahrradträger' } });
  assert.equal(um.body.name, 'Fahrradträger');
  // Fremdes Fahrzeug sieht nichts
  const fremd = await newUser();
  assert.equal((await api('GET', `/vehicles/${v.id}/parts`, { token: fremd })).status, 404);
  assert.equal((await api('POST', `/vehicles/${v.id}/parts`, { token: fremd, body: { name: 'x' } })).status, 404);

  // Löschen entfernt es von den Einträgen, die Einträge bleiben
  const e = await entry(token, v.id, { parts: [{ key: neu.body.key }, { key: 'oil' }] });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal((await api('DELETE', `/vehicles/${v.id}/parts/${neu.body.id}`, { token })).status, 204);
  const danach = (await api('GET', `/entries/${e.body.id}`, { token })).body;
  assert.deepEqual(danach.parts.map((p) => p.key), ['oil']);
  assert.equal((await api('DELETE', `/vehicles/${v.id}/parts/${neu.body.id}`, { token })).status, 404);
});

test('Einträge mit Bauteilen: nur in Werkstatt-Kategorien, Prüfungen, Kosten je Bauteil', async () => {
  const token = await newUser();
  const v = await newVehicle(token);
  // Mehrere Bauteile, Kostenanteil nur an einem
  const e = await entry(token, v.id, { amountEur: 300, parts: [{ key: 'brake_pads_front', costShare: 120 }, { key: 'brake_discs' }] });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.deepEqual(e.body.parts, [
    { key: 'brake_discs', name: 'Bremsscheiben', cost_share: null },
    { key: 'brake_pads_front', name: 'Bremsbeläge vorn', cost_share: 120 }
  ]);
  const fehler = async (body, erwartet) => {
    const r = await entry(token, v.id, body);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.error, erwartet);
  };
  await fehler({ category: 'Versicherung', parts: ['oil'] }, 'parts_not_allowed');
  await fehler({ parts: ['kolben'] }, 'unknown_part');
  await fehler({ parts: ['oil', { key: 'oil' }] }, 'duplicate_part');
  await fehler({ parts: 'oil' }, 'invalid_parts');
  await fehler({ amountEur: 50, parts: [{ key: 'oil', costShare: 30 }, { key: 'cabin_filter', costShare: 30 }] }, 'cost_share_exceeds_amount');
  await fehler({ parts: [{ key: 'oil', costShare: -1 }] }, 'invalid_costShare');
  await fehler({ parts: Array.from({ length: 13 }, (_, i) => ({ key: `custom:${crypto.randomUUID()}` })) }, 'too_many_parts');
  // Leere Liste und fehlende Angabe sind erlaubt, auch bei anderen Kategorien
  assert.equal((await entry(token, v.id, { category: 'Versicherung', parts: [] })).status, 201);
  assert.deepEqual((await entry(token, v.id, { category: 'Versicherung' })).body.parts, []);

  // PATCH: fehlt "parts", bleiben sie; [] löscht; Kategoriewechsel entfernt; Betrag unter den Anteilen wird abgelehnt
  let p = await api('PATCH', `/entries/${e.body.id}`, { token, body: { description: 'Bremsen neu' } });
  assert.equal(p.body.parts.length, 2, 'ein Client ohne Bauteile darf sie nicht löschen');
  p = await api('PATCH', `/entries/${e.body.id}`, { token, body: { amountEur: 100 } });
  assert.equal(p.body.error, 'cost_share_exceeds_amount');
  p = await api('PATCH', `/entries/${e.body.id}`, { token, body: { parts: ['brake_pads_rear'] } });
  assert.deepEqual(p.body.parts.map((x) => x.key), ['brake_pads_rear']);
  p = await api('PATCH', `/entries/${e.body.id}`, { token, body: { category: 'Sonstiges' } });
  assert.deepEqual(p.body.parts, [], 'Sonstiges hat keine Bauteile');
  p = await api('PATCH', `/entries/${e.body.id}`, { token, body: { category: 'Sonstiges', parts: ['oil'] } });
  assert.equal(p.body.error, 'parts_not_allowed');
  p = await api('PATCH', `/entries/${e.body.id}`, { token, body: { category: 'Wartung', parts: [{ key: 'oil', costShare: 40 }] } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  p = await api('PATCH', `/entries/${e.body.id}`, { token, body: { parts: [] } });
  assert.deepEqual(p.body.parts, []);

  // Liste liefert die Bauteile je Eintrag
  await entry(token, v.id, { parts: ['oil'] });
  const liste = (await api('GET', `/vehicles/${v.id}/entries`, { token })).body.data.filter((x) => x.parts.length);
  assert.deepEqual(liste.map((x) => x.parts[0].key), ['oil']);
  // Eintragsliste (Timeline): Bauteile an Ausgaben, null bei Tanken und Fahrten
  const zeilen = (await api('GET', `/vehicles/${v.id}/timeline`, { token })).body.data;
  const mitTeilen = zeilen.filter((z) => z.parts && z.parts.length);
  assert.deepEqual(mitTeilen.map((z) => z.parts[0].name), ['Motoröl & Filter']);
  assert.ok(zeilen.every((z) => z.type === 'entry' ? Array.isArray(z.parts) : z.parts === null));
  // Fremde Fahrzeuge: eine Bauteil-ID eines anderen Fahrzeugs ist unbekannt
  const andere = await newVehicle(token);
  const eigenes = (await api('POST', `/vehicles/${andere.id}/parts`, { token, body: { name: 'Nur hier' } })).body;
  await fehler({ parts: [eigenes.key] }, 'unknown_part');
});

test('Termine (#78): Bauteile mit Intervall oder Lebensdauer; Schätzungen nie überfällig und ohne Mail', async () => {
  const { collectDueReminders } = require('../src/services/notifier');
  const token = await newUser();
  const v = await newVehicle(token);
  const me = (await api('GET', '/whoami', { token })).body;
  const wechsel = (datum, km, parts) => entry(token, v.id, { category: 'Wartung', occurredAt: `${datum}T10:00:00Z`, odometerKm: km, parts });
  // Öl mit Intervall, lange überfällig; Zündkerzen zweimal gewechselt, ohne Intervall; Batterie nur einmal
  await wechsel('2022-01-01', 1000, ['oil']);
  await wechsel('2022-01-01', 1000, ['spark_plugs']);
  await wechsel('2023-01-01', 31000, ['spark_plugs']);
  await wechsel('2024-01-01', 40000, ['battery_12v']);
  await api('PUT', `/vehicles/${v.id}/part-intervals/oil`, { token, body: { intervalMonths: 12, intervalKm: 15000 } });
  const r = (await api('GET', `/vehicles/${v.id}/reminders`, { token })).body;
  // Gruppen (#206): Fristen, Bauteile mit Intervall, Schätzungen, zuletzt die Info-Zeile Reifen
  assert.deepEqual(r.map((x) => [x.title, x.group]), [
    ['TÜV', 'deadline'], ['Wartung / Inspektion', 'deadline'], ['Versicherung', 'deadline'], ['Kfz-Steuer', 'deadline'],
    ['Motoröl & Filter', 'part'], ['Zündkerzen', 'estimate'], ['Reifen', 'info']
  ]);
  const teile = r.filter((x) => x.part_key);
  assert.deepEqual(teile.map((x) => x.category), ['part:oil', 'part:spark_plugs']);
  const oel = teile.find((x) => x.part_key === 'oil');
  assert.deepEqual([oel.source, oel.status, oel.kind, oel.title], ['bauteil', 'ueberfaellig', 'due', 'Motoröl & Filter']);
  assert.equal(oel.last, '2022-01-01');
  const kerzen = teile.find((x) => x.part_key === 'spark_plugs');
  assert.equal(kerzen.source, 'lebensdauer');
  assert.equal(kerzen.status, 'bald', 'Schätzung lange überschritten, trotzdem nicht überfällig');
  // Batterie: ein Wechsel, kein Intervall: kein Termin
  assert.equal(teile.some((x) => x.part_key === 'battery_12v'), false);
  // Mail und Push nur für das Öl, nicht für die Schätzung
  const faellig = await collectDueReminders(pool, { user_id: me.id, reminder_days: 30 });
  const meine = faellig.filter((x) => x.vehicle_id === v.id && String(x.category).startsWith('part:'));
  assert.deepEqual(meine.map((x) => x.category), ['part:oil']);
  assert.ok(meine[0].ref.includes('part:oil'));
});

test('Termine (#206): Info-Zeile Reifen entfällt, wenn Sommer- oder Winterreifen als Bauteil einen Termin haben', async () => {
  const token = await newUser();
  const v = await newVehicle(token);
  const reifen = (datum, km, parts, description) => entry(token, v.id, { category: 'Reifen', occurredAt: `${datum}T10:00:00Z`, odometerKm: km, parts, description });
  // Ein Wechsel: noch keine Lebensdauer, also kein Bauteil-Termin; die Info-Zeile bleibt
  await reifen('2025-04-10', 30000, ['tires_summer'], 'Sommerreifen montiert');
  let r = (await api('GET', `/vehicles/${v.id}/reminders`, { token })).body;
  assert.deepEqual(r.filter((x) => x.group === 'info').map((x) => [x.title, x.last_description]), [['Reifen', 'Sommerreifen montiert']]);
  // Zweiter Wechsel: Sommerreifen haben eine Schätzung, die Info-Zeile würde denselben Wechsel wiederholen
  await reifen('2026-04-12', 46000, ['tires_summer'], 'Sommerreifen montiert');
  r = (await api('GET', `/vehicles/${v.id}/reminders`, { token })).body;
  assert.equal(r.some((x) => x.category === 'Reifen'), false, 'keine doppelte Reifen-Zeile');
  const sommer = r.find((x) => x.part_key === 'tires_summer');
  assert.deepEqual([sommer.group, sommer.last, sommer.last_description], ['estimate', '2026-04-12', 'Sommerreifen montiert']);
  assert.deepEqual(r.slice(0, 4).map((x) => x.group), ['deadline', 'deadline', 'deadline', 'deadline']);
});

test('Service-Übersicht: Historie, Kosten, Lebensdauer, Intervall, nächster Wechsel', async () => {
  const token = await newUser();
  const v = await newVehicle(token);
  const wechsel = (datum, km, extra) => entry(token, v.id, { category: 'Wartung', occurredAt: `${datum}T10:00:00Z`, odometerKm: km, vendor: 'Werkstatt Müller', ...extra });
  // Ölwechsel alle 12 Monate bzw. 15.000 km; bei einer Rechnung mit mehreren Arbeiten kein ganzer Betrag je Bauteil
  await wechsel('2023-01-01', 1000, { amountEur: 120, parts: ['oil'] });
  await wechsel('2024-01-01', 16000, { amountEur: 150, parts: [{ key: 'oil', costShare: 90 }, { key: 'cabin_filter' }] });
  await wechsel('2025-01-01', 31000, { amountEur: 130, parts: ['oil'] });
  // Bremsen nur einmal gewechselt, mit Intervall
  await wechsel('2025-03-01', 33000, { category: 'Reparatur', amountEur: 400, parts: ['brake_pads_front'] });

  // Ohne Intervall: nächster Wechsel aus der Lebensdauer, geschätzt und nie „überfällig“
  let s = (await api('GET', `/vehicles/${v.id}/service`, { token })).body;
  const oil = s.parts.find((p) => p.key === 'oil');
  assert.equal(oil.changes, 3);
  assert.equal(oil.last.date, '2025-01-01');
  assert.equal(oil.last.cost, 130);
  assert.deepEqual(oil.history.map((h) => h.cost), [130, 90, 120], 'Anteil, sonst ganzer Betrag bei einem Bauteil');
  assert.equal(oil.total_cost, 340);
  assert.equal(oil.lifetime.avgKm, 15000);
  assert.ok(Math.abs(oil.lifetime.avgMonths - 12) < 0.1);
  assert.equal(oil.next.source, 'lifetime');
  assert.notEqual(oil.next.status, 'ueberfaellig');
  const filter = s.parts.find((p) => p.key === 'cabin_filter');
  assert.equal(filter.last.cost, null, 'ein Bauteil von zwei ohne Anteil: unbekannt, nicht geteilt');
  assert.equal(filter.lifetime, null);
  assert.equal(filter.next, null, 'ohne Intervall und mit einem Wechsel kein Termin');
  const bremse = s.parts.find((p) => p.key === 'brake_pads_front');
  assert.equal(bremse.last.cost, 400);

  // Intervall setzen: eigener Wert gilt (Quelle interval), Öl schreibt in die Fahrzeugangaben
  assert.equal((await api('PUT', `/vehicles/${v.id}/part-intervals/brake_pads_front`, { token, body: { intervalMonths: 36, intervalKm: 60000 } })).status, 200);
  assert.equal((await api('PUT', `/vehicles/${v.id}/part-intervals/oil`, { token, body: { intervalMonths: 12, intervalKm: 15000 } })).status, 200);
  const fz = (await api('GET', `/vehicles/${v.id}`, { token })).body;
  assert.equal(fz.oil_interval_months, 12);
  assert.equal(fz.oil_interval_km, 15000);
  s = (await api('GET', `/vehicles/${v.id}/service`, { token })).body;
  assert.deepEqual([s.parts.find((p) => p.key === 'oil').next.source, s.parts.find((p) => p.key === 'oil').next.status], ['interval', 'ueberfaellig']);
  const b = s.parts.find((p) => p.key === 'brake_pads_front').next;
  assert.deepEqual([b.due_date, b.due_km, b.source], ['2028-03-01', 93000, 'interval']);
  // Intervall löschen
  assert.equal((await api('PUT', `/vehicles/${v.id}/part-intervals/brake_pads_front`, { token, body: { intervalMonths: null, intervalKm: null } })).body.interval, null);
  assert.equal((await api('GET', `/vehicles/${v.id}/service`, { token })).body.parts.find((p) => p.key === 'brake_pads_front').next, null);
  // Fehler und Rechte
  assert.equal((await api('PUT', `/vehicles/${v.id}/part-intervals/oil`, { token, body: { intervalMonths: 0 } })).body.error, 'invalid_intervalMonths');
  assert.equal((await api('PUT', `/vehicles/${v.id}/part-intervals/kolben`, { token, body: { intervalMonths: 6 } })).status, 404);
  const fremd = await newUser();
  assert.equal((await api('GET', `/vehicles/${v.id}/service`, { token: fremd })).status, 404);
  assert.equal((await api('PUT', `/vehicles/${v.id}/part-intervals/oil`, { token: fremd, body: { intervalMonths: 6 } })).status, 404);
});

test('Import: Bauteile je Ausgabe; nur bei passender Kategorie und mit bekannten Schlüsseln', async () => {
  const token = await newUser();
  const v = await newVehicle(token);
  const ok = await api('POST', `/vehicles/${v.id}/import`, { token, body: { entries: [
    { occurredAt: '2025-02-01T10:00:00Z', category: 'Wartung', amountEur: 200, odometerKm: 5000, parts: ['oil', { key: 'cabin_filter', costShare: 30 }] },
    { occurredAt: '2025-03-01T10:00:00Z', category: 'Versicherung', amountEur: 300 }
  ] } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const liste = (await api('GET', `/vehicles/${v.id}/entries`, { token })).body.data;
  assert.deepEqual(liste.find((x) => x.category === 'Wartung').parts.map((p) => p.key), ['cabin_filter', 'oil']);
  const falsch = await api('POST', `/vehicles/${v.id}/import`, { token, body: { entries: [{ occurredAt: '2025-04-01T10:00:00Z', category: 'Versicherung', amountEur: 10, parts: ['oil'] }] } });
  assert.equal(falsch.status, 400);
  assert.equal(falsch.body.rows[0].error, 'parts_not_allowed');
  const unbekannt = await api('POST', `/vehicles/${v.id}/import`, { token, body: { entries: [{ occurredAt: '2025-04-02T10:00:00Z', category: 'Wartung', amountEur: 10, parts: ['kolben'] }] } });
  assert.equal(unbekannt.body.rows[0].error, 'unknown_part');
  // Nichts davon wurde gespeichert
  assert.equal((await api('GET', `/vehicles/${v.id}/entries`, { token })).body.pagination.total, 2);
});
