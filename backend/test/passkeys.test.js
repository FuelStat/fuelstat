// Passkeys (WebAuthn, #2) gegen die Testdatenbank, mit einem Software-Authenticator (ES256, Attestation „none“).
// Eigene Datei (eigener Prozess), weil APP_URL hier eine HTTPS-Adresse sein muss.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';
process.env.NOTIFICATIONS_ENABLED = 'false';
process.env.APP_URL = 'https://fuelstat.test';
delete process.env.WEBAUTHN_RP_ID;
delete process.env.WEBAUTHN_ORIGINS;
delete process.env.PLAN_LIMITS_ENABLED;
delete process.env.EMAIL_VERIFICATION;

if (!process.env.DATABASE_URL) {
  test('Passkeys übersprungen: DATABASE_URL fehlt', { skip: true }, () => {});
  return;
}

const { isoCBOR } = require('@simplewebauthn/server/helpers');
const { app, pool } = require('../src/server');
const passkeys = require('../src/services/passkeys');
const ORIGIN = 'https://fuelstat.test';
const RP_ID = 'fuelstat.test';
let server;
let base;

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

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

// Software-Authenticator: ein Schlüsselpaar je Passkey, Nutzerprüfung immer „ja“
function authenticator({ origin = ORIGIN, rpId = RP_ID } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(16);
  let counter = 0;
  let userHandle = null;
  const flags = (at) => 0x01 | 0x04 | (at ? 0x40 : 0);
  const authData = (at) => {
    const zaehler = Buffer.alloc(4);
    zaehler.writeUInt32BE(counter);
    const teile = [sha256(rpId), Buffer.from([flags(at)]), zaehler];
    if (at) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credId.length);
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
      teile.push(Buffer.alloc(16), len, credId, Buffer.from(isoCBOR.encode(cose)));
    }
    return Buffer.concat(teile);
  };
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    id: b64u(credId),
    create(options) {
      userHandle = options.user.id;
      const cd = clientData('webauthn.create', options.challenge);
      const att = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(true)]]));
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd), attestationObject: b64u(att), transports: ['internal'] }
      };
    },
    get(options, { handle = userHandle } = {}) {
      counter++;
      const cd = clientData('webauthn.get', options.challenge);
      const ad = authData(false);
      const signature = crypto.sign('sha256', Buffer.concat([ad, sha256(cd)]), privateKey);
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(signature), userHandle: handle }
      };
    }
  };
}

async function konto() {
  const email = `passkey-${crypto.randomUUID()}@example.test`;
  const r = await api('POST', '/auth/register', { body: { email, password: 'Passwort123', acceptTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const login = await api('POST', '/auth/login', { body: { email, password: 'Passwort123' } });
  assert.equal(login.status, 200);
  return { email, token: login.body.token, id: login.body.user.id };
}

async function passkeyAnlegen(k, a, name) {
  const o = await api('POST', '/auth/passkeys/register/options', { token: k.token, body: { currentPassword: 'Passwort123' } });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return api('POST', '/auth/passkeys/register', { token: k.token, body: { challengeId: o.body.challengeId, response: a.create(o.body.options), name } });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

test.after(async () => {
  await pool.query(`DELETE FROM users WHERE email LIKE 'passkey-%@example.test'`);
  server.close();
  await pool.end();
});

test('Konfiguration: Relying Party aus APP_URL, nur HTTPS oder localhost', () => {
  assert.deepEqual(passkeys.config({ APP_URL: 'https://tanken.example.de/' }), { rpID: 'tanken.example.de', origins: ['https://tanken.example.de'] });
  assert.deepEqual(passkeys.config({ APP_URL: 'http://localhost:8099' }), { rpID: 'localhost', origins: ['http://localhost:8099'] });
  assert.equal(passkeys.config({ APP_URL: 'http://tanken.example.de' }), null);
  assert.equal(passkeys.config({ APP_URL: 'http://127.0.0.1:8099' }), null);
  assert.equal(passkeys.config({}), null);
  assert.deepEqual(passkeys.config({ APP_URL: 'https://a.example.de', WEBAUTHN_RP_ID: 'example.de', WEBAUTHN_ORIGINS: 'https://a.example.de, https://b.example.de/' }),
    { rpID: 'example.de', origins: ['https://a.example.de', 'https://b.example.de'] });
});

test('Health meldet passkeys_enabled', async () => {
  const h = await api('GET', '/health');
  assert.equal(h.body.passkeys_enabled, true);
});

test('Passkey anlegen, anmelden, umbenennen, löschen', async () => {
  const k = await konto();
  const a = authenticator();

  // Ohne bzw. mit falschem Passwort keine Optionen
  assert.equal((await api('POST', '/auth/passkeys/register/options', { token: k.token, body: {} })).status, 401);
  assert.equal((await api('POST', '/auth/passkeys/register/options', { token: k.token, body: { currentPassword: 'falsch' } })).body.error, 'invalid_current_password');
  assert.equal((await api('POST', '/auth/passkeys/register/options', { body: { currentPassword: 'Passwort123' } })).status, 401);

  const o = await api('POST', '/auth/passkeys/register/options', { token: k.token, body: { currentPassword: 'Passwort123' } });
  assert.equal(o.status, 200);
  assert.equal(o.body.options.rp.id, RP_ID);
  assert.equal(o.body.options.authenticatorSelection.userVerification, 'required');
  assert.equal(o.body.options.authenticatorSelection.residentKey, 'required');
  assert.equal(Buffer.from(o.body.options.user.id, 'base64url').toString('hex'), k.id.replace(/-/g, ''));
  const antwort = a.create(o.body.options);
  const neu = await api('POST', '/auth/passkeys/register', { token: k.token, body: { challengeId: o.body.challengeId, response: antwort, name: '  iPhone  ' } });
  assert.equal(neu.status, 201, JSON.stringify(neu.body));
  assert.equal(neu.body.name, 'iPhone');
  assert.equal(neu.body.public_key, undefined);
  // Challenge nur einmal verwendbar
  const nochmal = await api('POST', '/auth/passkeys/register', { token: k.token, body: { challengeId: o.body.challengeId, response: antwort } });
  assert.equal(nochmal.body.error, 'invalid_challenge');
  // Derselbe Passkey wird beim nächsten Anlegen ausgeschlossen
  const o2 = await api('POST', '/auth/passkeys/register/options', { token: k.token, body: { currentPassword: 'Passwort123' } });
  assert.deepEqual(o2.body.options.excludeCredentials.map((c) => c.id), [a.id]);

  // Anmelden ohne E-Mail und Passwort
  const lo = await api('POST', '/auth/passkeys/login/options', { body: {} });
  assert.equal(lo.status, 200);
  assert.equal(lo.body.options.rpId, RP_ID);
  assert.equal(lo.body.options.userVerification, 'required');
  const login = await api('POST', '/auth/passkeys/login', { body: { challengeId: lo.body.challengeId, response: a.get(lo.body.options) } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.email, k.email);
  const who = await api('GET', '/whoami', { token: login.body.token });
  assert.equal(who.body.email, k.email);

  // Liste: last_used_at gesetzt, kein Schlüssel
  const liste = await api('GET', '/auth/passkeys', { token: k.token });
  assert.equal(liste.body.pagination.total, 1);
  assert.ok(liste.body.data[0].last_used_at);
  assert.equal(liste.body.data[0].public_key, undefined);

  const umbenannt = await api('PATCH', `/auth/passkeys/${neu.body.id}`, { token: k.token, body: { name: 'Mac' } });
  assert.equal(umbenannt.body.name, 'Mac');
  assert.equal((await api('PATCH', `/auth/passkeys/${neu.body.id}`, { token: k.token, body: { name: ' ' } })).body.error, 'invalid_name');

  // Fremde Konten sehen und ändern ihn nicht
  const fremd = await konto();
  assert.equal((await api('GET', '/auth/passkeys', { token: fremd.token })).body.pagination.total, 0);
  assert.equal((await api('DELETE', `/auth/passkeys/${neu.body.id}`, { token: fremd.token })).status, 404);

  assert.equal((await api('DELETE', `/auth/passkeys/${neu.body.id}`, { token: k.token })).status, 204);
  const lo2 = await api('POST', '/auth/passkeys/login/options', { body: {} });
  const weg = await api('POST', '/auth/passkeys/login', { body: { challengeId: lo2.body.challengeId, response: a.get(lo2.body.options) } });
  assert.equal(weg.status, 401);
  assert.equal(weg.body.error, 'unknown_passkey');
});

test('Passkey ersetzt 2FA; Apps bekommen eine Gerätesitzung', async () => {
  const k = await konto();
  await pool.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [k.id]);
  const a = authenticator();
  assert.equal((await passkeyAnlegen(k, a, 'Schlüssel')).status, 201);
  const pw = await api('POST', '/auth/login', { body: { email: k.email, password: 'Passwort123' } });
  assert.equal(pw.body.error, 'mfa_required');
  const lo = await api('POST', '/auth/passkeys/login/options', { body: {} });
  const r = await api('POST', '/auth/passkeys/login', {
    body: { challengeId: lo.body.challengeId, response: a.get(lo.body.options), device: { name: 'Testgerät', platform: 'ios', appVersion: '0.2.0' } }
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.refreshToken);
  assert.equal(r.body.session.name, 'Testgerät');
});

test('Gefälschte Antworten werden abgelehnt', async () => {
  const k = await konto();
  const a = authenticator();
  assert.equal((await passkeyAnlegen(k, a)).status, 201);

  // Falsche Herkunft (Phishing-Seite)
  const phishing = authenticator({ origin: 'https://fuelstat-login.example' });
  const o = await api('POST', '/auth/passkeys/register/options', { token: k.token, body: { currentPassword: 'Passwort123' } });
  const r = await api('POST', '/auth/passkeys/register', { token: k.token, body: { challengeId: o.body.challengeId, response: phishing.create(o.body.options) } });
  assert.equal(r.body.error, 'invalid_passkey_response');

  // Signatur passt nicht zur Challenge
  const lo = await api('POST', '/auth/passkeys/login/options', { body: {} });
  const falsch = a.get({ challenge: b64u(crypto.randomBytes(32)) });
  assert.equal((await api('POST', '/auth/passkeys/login', { body: { challengeId: lo.body.challengeId, response: falsch } })).status, 401);

  // Fremde Benutzer-ID im userHandle
  const lo2 = await api('POST', '/auth/passkeys/login/options', { body: {} });
  const fremd = a.get(lo2.body.options, { handle: b64u(crypto.randomBytes(16)) });
  assert.equal((await api('POST', '/auth/passkeys/login', { body: { challengeId: lo2.body.challengeId, response: fremd } })).body.error, 'invalid_passkey_response');

  // Unbekannte challengeId
  const lo3 = await api('POST', '/auth/passkeys/login/options', { body: {} });
  assert.equal((await api('POST', '/auth/passkeys/login', { body: { challengeId: 'gibt-es-nicht', response: a.get(lo3.body.options) } })).body.error, 'invalid_challenge');
  // Registrierungs-Challenge taugt nicht zum Anmelden
  const o3 = await api('POST', '/auth/passkeys/register/options', { token: k.token, body: { currentPassword: 'Passwort123' } });
  assert.equal((await api('POST', '/auth/passkeys/login', { body: { challengeId: o3.body.challengeId, response: a.get(o3.body.options) } })).body.error, 'invalid_challenge');
});

test('Challenges laufen ab und gelten nur für ihren Zweck und ihr Konto', () => {
  const t0 = Date.now();
  const id = passkeys.storeChallenge('abc', 'register', 'u1', t0);
  assert.equal(passkeys.takeChallenge(id, 'register', 'u2', t0), null);
  const id2 = passkeys.storeChallenge('abc', 'register', 'u1', t0);
  assert.equal(passkeys.takeChallenge(id2, 'register', 'u1', t0 + 6 * 60 * 1000), null);
  const id3 = passkeys.storeChallenge('abc', 'login', null, t0);
  assert.equal(passkeys.takeChallenge(id3, 'login', null, t0 + 1000), 'abc');
  assert.equal(passkeys.takeChallenge(id3, 'login', null, t0 + 1000), null);
});
