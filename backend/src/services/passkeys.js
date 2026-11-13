// Passkeys (WebAuthn, #2). Anmelden mit Face ID, Fingerabdruck, Windows Hello oder Sicherheitsschlüssel statt
// Passwort und 2FA. Umsetzung direkt in der API mit @simplewebauthn/server, ohne externen Dienst.
//
// - Gespeichert wird nur der öffentliche Schlüssel (user_passkeys). Der private Schlüssel verlässt das Gerät bzw.
//   den Passwort-Manager nie.
// - Ein Passkey ist an die Domain gebunden (Relying Party ID). Standard: Host von APP_URL; abweichend
//   WEBAUTHN_RP_ID und WEBAUTHN_ORIGINS (kommagetrennt) in infra/.env. Nur über HTTPS (Ausnahme: localhost).
// - Passkeys sind „auffindbar“ (residentKey required): Bei der Anmeldung muss niemand die E-Mail eingeben.
// - Nutzerprüfung (Face ID, PIN …) ist Pflicht; damit ersetzt ein Passkey Passwort und 2FA.
// - Challenges liegen nur im Speicher (5 Minuten, einmal verwendbar). Ein Neustart der API verwirft sie; dann
//   startet der Browser einfach neu.
const { randomBytes } = require('crypto');
const swa = require('@simplewebauthn/server');

const RP_NAME = 'Fuelstat';
const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 10000;
const MAX_PASSKEYS = 20;
const NAME_MAX = 100;

/** Relying Party aus der Konfiguration oder null, wenn Passkeys auf diesem Server nicht gehen */
function config(env = process.env) {
  let appOrigin = null;
  let appHost = null;
  try {
    const u = new URL(String(env.APP_URL || '').trim());
    appOrigin = u.origin;
    appHost = u.hostname;
  } catch { /* keine APP_URL */ }
  const rpID = String(env.WEBAUTHN_RP_ID || '').trim().toLowerCase() || appHost;
  const origins = String(env.WEBAUTHN_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!origins.length && appOrigin) origins.push(appOrigin);
  if (!rpID || !origins.length) return null;
  // IP-Adressen sind als RP-ID nicht erlaubt; ohne HTTPS geht WebAuthn nur auf localhost
  if (/^[\d.]+$/.test(rpID) || rpID.includes(':')) return null;
  const sicher = (o) => o.startsWith('https://') || /^http:\/\/localhost(:\d+)?$/.test(o);
  if (!origins.every(sicher)) return null;
  return { rpID, origins };
}

// --- Challenges (einmal verwendbar) ---
const challenges = new Map();
function aufraeumen(now) {
  for (const [id, c] of challenges) if (c.expires <= now) challenges.delete(id);
}
function storeChallenge(challenge, purpose, userId = null, now = Date.now()) {
  if (challenges.size >= MAX_CHALLENGES) aufraeumen(now);
  if (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value);
  const id = randomBytes(18).toString('base64url');
  challenges.set(id, { challenge, purpose, userId, expires: now + CHALLENGE_MS });
  return id;
}
function takeChallenge(id, purpose, userId = null, now = Date.now()) {
  const c = challenges.get(String(id || ''));
  if (!c) return null;
  challenges.delete(String(id));
  if (c.expires <= now || c.purpose !== purpose || (userId && c.userId !== userId)) return null;
  return c.challenge;
}

const uuidBytes = (uuid) => Uint8Array.from(Buffer.from(String(uuid).replace(/-/g, ''), 'hex'));

function cleanName(name, fallback) {
  const n = typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '';
  return n || fallback;
}

/** Optionen für navigator.credentials.create() */
async function registrationOptions(db, user, cfg) {
  const vorhanden = await db.query('SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1', [user.id]);
  if (vorhanden.rowCount >= MAX_PASSKEYS) return { error: 'too_many_passkeys' };
  const options = await swa.generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: cfg.rpID,
    userName: user.email,
    userDisplayName: user.username || user.email,
    userID: uuidBytes(user.id),
    attestationType: 'none',
    excludeCredentials: vorhanden.rows.map((r) => ({ id: r.credential_id, transports: r.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
  });
  return { options, challengeId: storeChallenge(options.challenge, 'register', user.id) };
}

/** Antwort von navigator.credentials.create() prüfen und speichern */
async function register(db, userId, body, cfg) {
  const expectedChallenge = takeChallenge(body.challengeId, 'register', userId);
  if (!expectedChallenge) return { status: 400, error: 'invalid_challenge' };
  let v;
  try {
    v = await swa.verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: cfg.origins,
      expectedRPID: cfg.rpID,
      requireUserVerification: true
    });
  } catch {
    return { status: 400, error: 'invalid_passkey_response' };
  }
  if (!v.verified) return { status: 400, error: 'invalid_passkey_response' };
  const info = v.registrationInfo;
  const anzahl = await db.query('SELECT COUNT(*)::int AS n FROM user_passkeys WHERE user_id = $1', [userId]);
  if (anzahl.rows[0].n >= MAX_PASSKEYS) return { status: 409, error: 'too_many_passkeys' };
  try {
    const r = await db.query(
      `INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
      [userId, info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter || 0,
        Array.isArray(info.credential.transports) ? info.credential.transports.map(String).slice(0, 10) : [],
        info.credentialDeviceType || null, Boolean(info.credentialBackedUp), cleanName(body.name, `Passkey ${anzahl.rows[0].n + 1}`)]
    );
    return { passkey: r.rows[0] };
  } catch (e) {
    if (e.code === '23505') return { status: 409, error: 'passkey_exists' };
    throw e;
  }
}

/** Optionen für navigator.credentials.get(): ohne allowCredentials, der Browser bietet alle Passkeys an */
async function authenticationOptions(cfg) {
  const options = await swa.generateAuthenticationOptions({ rpID: cfg.rpID, userVerification: 'required' });
  return { options, challengeId: storeChallenge(options.challenge, 'login') };
}

/**
 * Antwort von navigator.credentials.get() prüfen.
 * @returns {{ userId } | { status, error }}
 */
async function authenticate(db, body, cfg) {
  const expectedChallenge = takeChallenge(body.challengeId, 'login');
  if (!expectedChallenge) return { status: 400, error: 'invalid_challenge' };
  const credentialId = typeof body.response?.id === 'string' ? body.response.id : '';
  if (!credentialId) return { status: 400, error: 'invalid_passkey_response' };
  const r = await db.query('SELECT id, user_id, credential_id, public_key, counter, transports FROM user_passkeys WHERE credential_id = $1', [credentialId]);
  // Unbekannter Passkey (z. B. auf dem Server gelöscht, im Gerät noch vorhanden)
  if (r.rowCount === 0) return { status: 401, error: 'unknown_passkey' };
  const pk = r.rows[0];
  // Bei auffindbaren Passkeys liefert der Authenticator die Benutzer-ID mit; sie muss passen
  const userHandle = body.response?.response?.userHandle;
  if (userHandle && Buffer.from(String(userHandle), 'base64url').toString('hex') !== String(pk.user_id).replace(/-/g, '')) {
    return { status: 401, error: 'invalid_passkey_response' };
  }
  let v;
  try {
    v = await swa.verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: cfg.origins,
      expectedRPID: cfg.rpID,
      credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports },
      requireUserVerification: true
    });
  } catch {
    return { status: 401, error: 'invalid_passkey_response' };
  }
  if (!v.verified) return { status: 401, error: 'invalid_passkey_response' };
  await db.query('UPDATE user_passkeys SET counter = $2, last_used_at = now() WHERE id = $1', [pk.id, v.authenticationInfo.newCounter]);
  return { userId: pk.user_id };
}

// Felder für Liste und Antworten (ohne Schlüssel)
const COLUMNS = 'id, name, device_type, backed_up, transports, created_at, last_used_at';

module.exports = {
  COLUMNS, MAX_PASSKEYS, NAME_MAX, config, cleanName, registrationOptions, register, authenticationOptions, authenticate,
  storeChallenge, takeChallenge
};
