// Bildadressen nur aus eigenen Uploads (#196): imageUrl (Fahrzeuge) und profileImageUrl (Konto). Eigene Datei (eigener Prozess).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  test('Bildadressen übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fuelstat-bilder-'));
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
async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function newUser() {
  const r = await api('POST', '/auth/register', { body: { email: `bilder-${crypto.randomBytes(5).toString('hex')}@example.test`, password: 'Passwort123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id };
}
async function newVehicle(token, extra = {}) {
  return api('POST', '/vehicles', { token, body: { name: `Auto ${crypto.randomBytes(3).toString('hex')}`, fuelType: 'e10', ...extra } });
}
let png;
async function upload(token, p) {
  png ??= await require('sharp')({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 90, b: 160 } } }).png().toBuffer();
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'bild.png');
  const res = await fetch(base + p, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body; // url ist signiert: /api/v1/files/<name>?exp=…&sig=…
}
const intern = (signiert) => `/uploads/${signiert.split('?')[0].split('/').pop()}`;
const gespeichert = async (sql, id) => (await pool.query(sql, [id])).rows[0];

const FREMD = ['https://evil.example/pixel.gif?victim', 'http://evil.example/a.webp', '//evil.example/a.webp', 'javascript:alert(1)',
  'JavaScript:alert(1)', ' data:image/png;base64,AAAA', 'data:text/html,<script>1</script>', '/uploads/../../etc/passwd', 'kein-bild'];

test('Fahrzeugbild: nur eigene Uploads, sonst 400 invalid_imageUrl', async () => {
  const a = await newUser();
  const b = await newUser();
  const v = (await newVehicle(a.token)).body.id;
  const v2 = (await newVehicle(a.token)).body.id;
  const vb = (await newVehicle(b.token)).body.id;

  // Fremde Server, Pseudo-Adressen und Unsinn: beim Anlegen und beim Ändern abgelehnt, nichts gespeichert
  for (const url of FREMD) {
    const neu = await newVehicle(a.token, { imageUrl: url });
    assert.equal(neu.status, 400, `POST ${url}`);
    assert.equal(neu.body.error, 'invalid_imageUrl');
    const patch = await api('PATCH', `/vehicles/${v}`, { token: a.token, body: { imageUrl: url } });
    assert.equal(patch.status, 400, `PATCH ${url}`);
    assert.equal(patch.body.error, 'invalid_imageUrl');
  }
  assert.equal((await gespeichert('SELECT image_url FROM vehicles WHERE id = $1', v)).image_url, null);

  // Datei eines anderen Kontos: weder signiert noch als interne Adresse
  const fremd = await upload(b.token, `/vehicles/${vb}/media/upload`);
  for (const url of [fremd.url, intern(fremd.url), `https://tanken.example${fremd.url}`]) {
    const r = await api('PATCH', `/vehicles/${v}`, { token: a.token, body: { imageUrl: url } });
    assert.equal(r.status, 400, url);
    assert.equal(r.body.error, 'invalid_imageUrl');
  }
  assert.equal((await newVehicle(a.token, { imageUrl: fremd.url })).status, 400, 'POST mit fremder Datei');

  // Eigene Datei: signiert (wie die Upload-Antwort) wird intern gespeichert
  const eigen = await upload(a.token, `/vehicles/${v}/media/upload`);
  const ok = await api('PATCH', `/vehicles/${v}`, { token: a.token, body: { imageUrl: eigen.url } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await gespeichert('SELECT image_url FROM vehicles WHERE id = $1', v)).image_url, intern(eigen.url));
  assert.match(ok.body.image_url, /^\/api\/v1\/files\//);
  // Unverändert zurückgeschickt (auch die neu signierte Adresse aus GET) ist in Ordnung
  const gelesen = (await api('GET', `/vehicles/${v}`, { token: a.token })).body.image_url;
  assert.equal((await api('PATCH', `/vehicles/${v}`, { token: a.token, body: { imageUrl: gelesen, name: 'Neu' } })).status, 200);
  // Eigene Datei eines anderen eigenen Fahrzeugs und eigenes Profilbild-Upload: gehören dem Konto
  assert.equal((await api('PATCH', `/vehicles/${v2}`, { token: a.token, body: { imageUrl: eigen.url } })).status, 200);
  const kontoBild = await upload(a.token, '/media/upload');
  const mitBild = await newVehicle(a.token, { imageUrl: kontoBild.url });
  assert.equal(mitBild.status, 201, JSON.stringify(mitBild.body));
  assert.equal((await gespeichert('SELECT image_url FROM vehicles WHERE id = $1', mitBild.body.id)).image_url, intern(kontoBild.url));
  // Entfernen mit null oder leer
  assert.equal((await api('PATCH', `/vehicles/${v}`, { token: a.token, body: { imageUrl: null } })).status, 200);
  assert.equal((await gespeichert('SELECT image_url FROM vehicles WHERE id = $1', v)).image_url, null);
  assert.equal((await api('PATCH', `/vehicles/${v2}`, { token: a.token, body: { imageUrl: '' } })).status, 200);
  assert.equal((await gespeichert('SELECT image_url FROM vehicles WHERE id = $1', v2)).image_url, null);
  assert.equal((await newVehicle(a.token, { imageUrl: '' })).status, 201, 'leer beim Anlegen');
});

test('Profilbild: nur eigene Uploads des Kontos, auch wenn ein Admin es setzt', async () => {
  const a = await newUser();
  const b = await newUser();
  const fremd = await upload(b.token, '/media/upload');
  for (const url of [...FREMD, fremd.url, intern(fremd.url)]) {
    const r = await api('PATCH', `/auth/users/${a.id}`, { token: a.token, body: { profileImageUrl: url } });
    assert.equal(r.status, 400, url);
    assert.equal(r.body.error, 'invalid_profileImageUrl');
  }
  assert.equal((await gespeichert('SELECT profile_image_url FROM users WHERE id = $1', a.id)).profile_image_url, null);

  const eigen = await upload(a.token, '/media/upload');
  const ok = await api('PATCH', `/auth/users/${a.id}`, { token: a.token, body: { profileImageUrl: eigen.url } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await gespeichert('SELECT profile_image_url FROM users WHERE id = $1', a.id)).profile_image_url, intern(eigen.url));
  // Unverändert zurückgeschickt mit anderen Feldern
  assert.equal((await api('PATCH', `/auth/users/${a.id}`, { token: a.token, body: { username: `anna-${crypto.randomBytes(3).toString('hex')}`, profileImageUrl: ok.body.profile_image_url } })).status, 200);

  // Admin: darf B nur Dateien von B geben, nicht seine eigenen oder die von A
  const vorher = process.env.ADMIN_USER_IDS;
  const admin = await newUser();
  process.env.ADMIN_USER_IDS = admin.id;
  try {
    const adminBild = await upload(admin.token, '/media/upload');
    for (const url of [adminBild.url, eigen.url]) {
      const r = await api('PATCH', `/auth/users/${b.id}`, { token: admin.token, body: { profileImageUrl: url } });
      assert.equal(r.body.error, 'invalid_profileImageUrl', url);
    }
    assert.equal((await api('PATCH', `/auth/users/${b.id}`, { token: admin.token, body: { profileImageUrl: fremd.url } })).status, 200);
    assert.equal((await api('PATCH', '/auth/users/kein-konto', { token: admin.token, body: { profileImageUrl: null } })).status, 404);
  } finally {
    if (vorher === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = vorher;
  }
  assert.equal((await api('PATCH', `/auth/users/${a.id}`, { token: a.token, body: { profileImageUrl: null } })).status, 200);
  assert.equal((await gespeichert('SELECT profile_image_url FROM users WHERE id = $1', a.id)).profile_image_url, null);
});

test('Konto löschen entfernt nur eigene Dateien, auch wenn ein altes Profilbild auf eine fremde zeigt', async () => {
  const a = await newUser();
  const b = await newUser();
  const fremd = await upload(b.token, '/media/upload');
  const datei = path.join(process.env.UPLOAD_DIR, fremd.url.split('?')[0].split('/').pop());
  assert.ok(fs.existsSync(datei));
  const eigen = await upload(a.token, '/media/upload');
  const eigeneDatei = path.join(process.env.UPLOAD_DIR, eigen.url.split('?')[0].split('/').pop());
  // Stand aus der Zeit vor #196: A zeigt direkt in der Datenbank auf die Datei von B
  await pool.query('UPDATE users SET profile_image_url = $2 WHERE id = $1', [a.id, intern(fremd.url)]);
  assert.equal((await api('DELETE', `/auth/users/${a.id}`, { token: a.token })).status, 204);
  assert.ok(fs.existsSync(datei), 'Datei von B bleibt');
  assert.ok(!fs.existsSync(eigeneDatei), 'eigene Datei von A ist weg');
});

test('Migration 030 leert fremde Adressen und lässt Upload-Pfade stehen', async () => {
  const u = await newUser();
  const v = (await newVehicle(u.token)).body.id;
  const sql = fs.readFileSync(path.join(__dirname, '../database/postgres_030_image_urls.sql'), 'utf8');
  const faelle = [
    ['https://evil.example/p.gif', null], ['javascript:alert(1)', null], ['data:image/png;base64,AA', null], ['//evil.example/x', null],
    ['/uploads/0b8e7f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.webp', '/uploads/0b8e7f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.webp'],
    ['/medien/0b8e7f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg', '/medien/0b8e7f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg']
  ];
  for (const [vorher, nachher] of faelle) {
    await pool.query('UPDATE vehicles SET image_url = $2 WHERE id = $1', [v, vorher]);
    await pool.query('UPDATE users SET profile_image_url = $2 WHERE id = $1', [u.id, vorher]);
    await pool.query(sql);
    await pool.query(sql); // mehrfach ausführbar
    assert.equal((await gespeichert('SELECT image_url FROM vehicles WHERE id = $1', v)).image_url, nachher, vorher);
    assert.equal((await gespeichert('SELECT profile_image_url FROM users WHERE id = $1', u.id)).profile_image_url, nachher, vorher);
  }
});
