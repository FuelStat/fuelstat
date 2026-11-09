// Fahrzeuge teilen (#53) gegen die Testdatenbank: Rollen, Einladungen und vor allem kein Zugriff ohne Mitgliedschaft.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
delete process.env.PLAN_LIMITS_ENABLED;
delete process.env.MAIL_DEFAULT_USER_ID;

if (!process.env.DATABASE_URL) {
  test('Teilen-Tests übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
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

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const unique = () => crypto.randomBytes(6).toString('hex');
async function konto(name) {
  const email = `${name}-${unique()}@example.test`;
  const r = await api('POST', '/auth/register', { body: { email, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { email, token: r.body.token, id: r.body.user.id };
}
async function tanken(token, vehicleId, odometerKm, extra = {}) {
  return api('POST', '/fillups', { token, body: { vehicleId, odometerKm, amount: 40, unit: 'l', totalCostEur: 70, ...extra } });
}
async function einladenUndAnnehmen(besitzer, vehicleId, gast, role) {
  const inv = await api('POST', `/vehicles/${vehicleId}/invitations`, { token: besitzer.token, body: { email: gast.email, role } });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const ok = await api('POST', `/invitations/${inv.body.id}/accept`, { token: gast.token });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return inv.body;
}

test('Teilen: Rollen, Rechte und kein Zugriff für Fremde', async () => {
  const a = await konto('besitzer');
  const b = await konto('mitfahrer');
  const c = await konto('ansehen');
  const d = await konto('fremd');
  const v = (await api('POST', '/vehicles', { token: a.token, body: { name: 'Familienauto', fuelType: 'e10' } })).body.id;
  const fA = (await tanken(a.token, v, 1000)).body;

  // Fremde sehen nichts – nicht einmal, dass es das Fahrzeug gibt
  for (const path of [`/vehicles/${v}`, `/vehicles/${v}/stats`, `/vehicles/${v}/costs`, `/vehicles/${v}/consumption`,
    `/vehicles/${v}/fillups`, `/vehicles/${v}/entries`, `/vehicles/${v}/reminders`, `/vehicles/${v}/members`,
    `/vehicles/${v}/media`, `/fillups/${fA.id}`]) {
    const r = await api('GET', path, { token: d.token });
    assert.equal(r.status, 404, `GET ${path} für Fremde`);
  }
  assert.equal((await tanken(d.token, v, 1100)).status, 404);
  assert.equal((await api('PATCH', `/fillups/${fA.id}`, { token: d.token, body: { station: 'x' } })).status, 404);
  assert.equal((await api('DELETE', `/fillups/${fA.id}`, { token: d.token })).status, 404);
  assert.equal((await api('POST', `/vehicles/${v}/invitations`, { token: d.token, body: { email: d.email } })).status, 404);
  assert.ok(!(await api('GET', '/vehicles', { token: d.token })).body.some((x) => x.id === v));

  // Einladung: der Eingeladene sieht sie, ein Fremder kann sie nicht annehmen
  const invB = await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: b.email.toUpperCase(), role: 'editor' } });
  assert.equal(invB.status, 201, JSON.stringify(invB.body));
  assert.equal(invB.body.email, b.email, 'Adresse klein geschrieben');
  const offen = await api('GET', '/invitations', { token: b.token });
  assert.equal(offen.body.length, 1);
  assert.equal(offen.body[0].vehicle_name, 'Familienauto');
  assert.equal((await api('GET', '/invitations', { token: d.token })).body.length, 0);
  assert.equal((await api('POST', `/invitations/${invB.body.id}/accept`, { token: d.token })).status, 404, 'fremde Einladung');
  assert.equal((await api('POST', `/invitations/${invB.body.id}/accept`, { token: b.token })).status, 200);
  assert.equal((await api('POST', `/invitations/${invB.body.id}/accept`, { token: b.token })).status, 410, 'nur einmal');
  await einladenUndAnnehmen(a, v, c, 'viewer');

  // Liste: geteiltes Fahrzeug mit Rolle und Besitzer
  const listeB = (await api('GET', '/vehicles', { token: b.token })).body.find((x) => x.id === v);
  assert.equal(listeB.role, 'editor');
  assert.equal(listeB.owner_name, a.email);
  assert.equal((await api('GET', `/vehicles/${v}`, { token: c.token })).body.role, 'viewer');
  assert.equal((await api('GET', `/vehicles/${v}`, { token: a.token })).body.role, 'owner');

  // Mitfahrer: erfassen, eigene Einträge ändern, fremde nicht
  const fB = await tanken(b.token, v, 1500);
  assert.equal(fB.status, 201, JSON.stringify(fB.body));
  assert.equal((await api('PATCH', `/fillups/${fB.body.id}`, { token: b.token, body: { station: 'Aral' } })).status, 200);
  assert.equal((await api('PATCH', `/fillups/${fA.id}`, { token: b.token, body: { station: 'Aral' } })).body.error, 'entry_not_editable');
  assert.equal((await api('DELETE', `/fillups/${fA.id}`, { token: b.token })).status, 403);
  const eB = await api('POST', '/entries', { token: b.token, body: { vehicleId: v, category: 'Werkstatt', amountEur: 50 } });
  assert.equal(eB.status, 201);
  // Besitzer darf alle Einträge ändern
  assert.equal((await api('PATCH', `/entries/${eB.body.id}`, { token: a.token, body: { vendor: 'ATU' } })).status, 200);

  // Nur ansehen: lesen ja, schreiben nein
  for (const path of [`/vehicles/${v}/stats`, `/vehicles/${v}/costs`, `/vehicles/${v}/consumption`, `/vehicles/${v}/fillups`,
    `/vehicles/${v}/entries`, `/vehicles/${v}/reminders`, `/vehicles/${v}/members`, `/fillups/${fB.body.id}`]) {
    assert.equal((await api('GET', path, { token: c.token })).status, 200, `GET ${path} für Nur ansehen`);
  }
  assert.equal((await tanken(c.token, v, 1600)).body.error, 'read_only');
  assert.equal((await api('POST', '/entries', { token: c.token, body: { vehicleId: v, category: 'Werkstatt', amountEur: 5 } })).body.error, 'read_only');
  assert.equal((await api('PATCH', `/fillups/${fB.body.id}`, { token: c.token, body: { station: 'x' } })).status, 403);

  // Fahrzeug selbst, Import und Teilen: nur der Besitzer
  for (const t of [b, c]) {
    assert.equal((await api('PATCH', `/vehicles/${v}`, { token: t.token, body: { name: 'Meins' } })).body.error, 'owner_only');
    assert.equal((await api('DELETE', `/vehicles/${v}`, { token: t.token })).body.error, 'owner_only');
    assert.equal((await api('POST', `/vehicles/${v}/import`, { token: t.token, body: { fillups: [{ odometerKm: 1, amount: 1, totalCostEur: 1 }] } })).body.error, 'owner_only');
    assert.equal((await api('POST', `/vehicles/${v}/invitations`, { token: t.token, body: { email: d.email } })).body.error, 'owner_only');
    assert.equal((await api('PATCH', `/vehicles/${v}/members/${b.id}`, { token: t.token, body: { role: 'viewer' } })).body.error, 'owner_only');
  }
  // Mitglieder sehen keine offenen Einladungen, der Besitzer schon
  await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: d.email, role: 'viewer' } });
  assert.equal((await api('GET', `/vehicles/${v}/members`, { token: b.token })).body.invitations, undefined);
  assert.equal((await api('GET', `/vehicles/${v}/members`, { token: a.token })).body.invitations.length, 1);

  // Statistik und Listen enthalten Einträge aller Mitglieder, mit Erfasser
  const liste = (await api('GET', `/vehicles/${v}/fillups`, { token: a.token })).body;
  assert.equal(liste.length, 2);
  assert.equal(liste.find((f) => f.id === fB.body.id).created_by, b.id);
  assert.equal(liste.find((f) => f.id === fB.body.id).created_by_name, b.email);
  assert.equal((await api('GET', `/vehicles/${v}/stats`, { token: c.token })).body.currentOdo, 1500);

  // Rolle ändern, entfernen, verlassen
  assert.equal((await api('PATCH', `/vehicles/${v}/members/${c.id}`, { token: a.token, body: { role: 'editor' } })).status, 200);
  assert.equal((await tanken(c.token, v, 1700)).status, 201);
  assert.equal((await api('DELETE', `/vehicles/${v}/members/${b.id}`, { token: a.token })).status, 204);
  assert.equal((await api('GET', `/vehicles/${v}`, { token: b.token })).status, 404, 'entfernt: kein Zugriff mehr');
  assert.equal((await api('DELETE', `/vehicles/${v}/members/me`, { token: c.token })).status, 204);
  assert.equal((await api('GET', `/vehicles/${v}/stats`, { token: c.token })).status, 404, 'verlassen: kein Zugriff mehr');
  assert.equal((await api('DELETE', `/vehicles/${v}/members/me`, { token: a.token })).body.error, 'owner_cannot_leave');
  // Einträge entfernter Mitglieder bleiben beim Fahrzeug
  assert.equal((await api('GET', `/vehicles/${v}/fillups`, { token: a.token })).body.length, 3);
});

test('Einladungen: sich selbst, doppelt, abgelaufen, abgelehnt, zurückgezogen', async () => {
  const a = await konto('besitzer');
  const b = await konto('gast');
  const v = (await api('POST', '/vehicles', { token: a.token, body: { name: 'Auto', fuelType: 'diesel' } })).body.id;
  assert.equal((await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: a.email } })).body.error, 'cannot_invite_self');
  assert.equal((await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: 'kein-at' } })).body.error, 'invalid_email');
  assert.equal((await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: b.email, role: 'owner' } })).body.error, 'invalid_role');

  // Ablehnen
  const inv1 = (await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: b.email, role: 'viewer' } })).body;
  assert.equal((await api('POST', `/invitations/${inv1.id}/decline`, { token: b.token })).status, 200);
  assert.equal((await api('GET', `/vehicles/${v}`, { token: b.token })).status, 404);

  // Abgelaufen
  const inv2 = (await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: b.email, role: 'viewer' } })).body;
  await pool.query(`UPDATE vehicle_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [inv2.id]);
  assert.equal((await api('GET', '/invitations', { token: b.token })).body.length, 0);
  assert.equal((await api('POST', `/invitations/${inv2.id}/accept`, { token: b.token })).status, 410);

  // Zurückgezogen
  const inv3 = (await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: b.email, role: 'viewer' } })).body;
  assert.equal((await api('DELETE', `/vehicles/${v}/invitations/${inv3.id}`, { token: a.token })).status, 204);
  assert.equal((await api('POST', `/invitations/${inv3.id}/accept`, { token: b.token })).status, 410);

  // Doppelt: schon Mitglied
  await einladenUndAnnehmen(a, v, b, 'viewer');
  assert.equal((await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: b.email } })).body.error, 'already_member');

  // Unbestätigte Adresse kann nicht annehmen
  const u = await konto('unbestaetigt');
  await pool.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [u.id]);
  const inv4 = (await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: u.email } })).body;
  assert.equal((await api('POST', `/invitations/${inv4.id}/accept`, { token: u.token })).body.error, 'email_not_verified');
});

test('Konto eines Mitglieds löschen: seine Einträge bleiben beim Fahrzeug', async () => {
  const a = await konto('besitzer');
  const b = await konto('mitfahrer');
  const v = (await api('POST', '/vehicles', { token: a.token, body: { name: 'Auto', fuelType: 'e5' } })).body.id;
  await einladenUndAnnehmen(a, v, b, 'editor');
  const fB = (await tanken(b.token, v, 2000)).body;
  const eigenes = (await api('POST', '/vehicles', { token: b.token, body: { name: 'Eigenes', fuelType: 'e5' } })).body.id;
  await tanken(b.token, eigenes, 10);
  assert.equal((await api('DELETE', `/auth/users/${b.id}`, { token: b.token })).status, 204);
  const liste = (await api('GET', `/vehicles/${v}/fillups`, { token: a.token })).body;
  assert.equal(liste.length, 1);
  assert.equal(liste[0].id, fB.id);
  assert.equal(liste[0].created_by, a.id, 'an den Besitzer übergeben');
  const rest = await pool.query('SELECT COUNT(*)::int AS n FROM vehicles WHERE id = $1', [eigenes]);
  assert.equal(rest.rows[0].n, 0, 'eigene Fahrzeuge werden gelöscht');
});

test('Besitzer löscht das Fahrzeug: Mitglieder verlieren den Zugriff', async () => {
  const a = await konto('besitzer');
  const b = await konto('mitfahrer');
  const v = (await api('POST', '/vehicles', { token: a.token, body: { name: 'Auto', fuelType: 'e5' } })).body.id;
  await einladenUndAnnehmen(a, v, b, 'editor');
  assert.equal((await api('DELETE', `/vehicles/${v}`, { token: a.token })).status, 204);
  assert.equal((await api('GET', `/vehicles/${v}`, { token: b.token })).status, 404);
  assert.ok(!(await api('GET', '/vehicles', { token: b.token })).body.some((x) => x.id === v));
});

test('Teilen ist eine Plus-Funktion des Besitzers', async () => {
  const a = await konto('free');
  const b = await konto('gast');
  const v = (await api('POST', '/vehicles', { token: a.token, body: { name: 'Auto', fuelType: 'e5' } })).body.id;
  process.env.PLAN_LIMITS_ENABLED = 'true';
  try {
    const r = await api('POST', `/vehicles/${v}/invitations`, { token: a.token, body: { email: b.email } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'plan_required');
    assert.equal(r.body.feature, 'sharing');
  } finally {
    delete process.env.PLAN_LIMITS_ENABLED;
  }
});
