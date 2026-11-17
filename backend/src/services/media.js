// Bilder (#103): beim Hochladen verkleinern, als WebP speichern, Metadaten (EXIF/GPS) entfernen,
// und nur über signierte, ablaufende Adressen ausliefern.
//
// In der Datenbank steht weiterhin die interne Adresse "/uploads/<uuid>.webp". In API-Antworten wird sie
// automatisch durch "/api/v1/files/<uuid>.webp?exp=…&sig=…" ersetzt (signDeep). Nur wer die Antwort bekommt
// (also das Fahrzeug bzw. Profil sehen darf), bekommt eine gültige Adresse.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL || '/uploads';
const FILES_PATH = '/api/v1/files/';
const NAME_RE = /^[0-9a-f-]{36}\.(webp|jpg|png|gif)$/;
// Kantenlängen: Fahrzeugbilder werden groß angezeigt, Profilbilder nur klein
const MAX_EDGE = { vehicle: 1600, user: 800 };
const WEBP_QUALITY = 80;

// Schlüssel für die Signatur: eigener Wert oder aus JWT_SECRET abgeleitet (bleibt bei Neustarts gleich)
function signingKey() {
  const basis = process.env.MEDIA_SIGNING_KEY || `fuelstat-media:${process.env.JWT_SECRET || ''}`;
  return crypto.createHash('sha256').update(basis).digest();
}

function signature(name, exp) {
  return crypto.createHmac('sha256', signingKey()).update(`${name}:${exp}`).digest('base64url').slice(0, 32);
}

// Ablauf: Ende des nächsten Tages (UTC). Die Adresse bleibt einen Tag lang gleich, Browser können das Bild cachen.
function expiry(now = Date.now()) {
  const d = new Date(now);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2) / 1000);
}

function nameFromStored(url) {
  const s = String(url || '');
  if (!s.startsWith(MEDIA_BASE_URL + '/')) return null;
  const name = s.slice(MEDIA_BASE_URL.length + 1);
  return NAME_RE.test(name) ? name : null;
}

function signedUrl(stored, now = Date.now()) {
  const name = nameFromStored(stored);
  if (!name) return stored;
  const exp = expiry(now);
  return `${FILES_PATH}${name}?exp=${exp}&sig=${signature(name, exp)}`;
}

function verify(name, exp, sig, now = Date.now()) {
  if (!NAME_RE.test(String(name || ''))) return false;
  const e = Number(exp);
  if (!Number.isInteger(e) || e * 1000 < now) return false;
  const erwartet = Buffer.from(signature(name, e));
  const bekommen = Buffer.from(String(sig || ''));
  return erwartet.length === bekommen.length && crypto.timingSafeEqual(erwartet, bekommen);
}

// Eingaben von Clients (z. B. image_url zurückgeschickt): signierte Adresse wieder in die interne umwandeln
function normalizeInput(value) {
  if (value === null || value === undefined || value === '') return value;
  const s = String(value);
  const i = s.indexOf(FILES_PATH);
  if (i === -1) return s;
  const name = s.slice(i + FILES_PATH.length).split('?')[0];
  return NAME_RE.test(name) ? `${MEDIA_BASE_URL}/${name}` : s;
}

/**
 * Bildadresse aus einer Client-Eingabe prüfen (#196): erlaubt sind nur Dateien, die das Konto selbst hochgeladen hat
 * (user_media oder vehicle_media), der bisherige Wert (unverändert zurückgeschickt) und null/leer zum Entfernen.
 * Fremde Server, javascript:/data:-Adressen und Upload-Dateien anderer Konten sind ungültig.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {*} value Eingabe (undefined = nicht gesendet)
 * @param {{ accountId: string, current?: string|null }} opts Konto, dem die Datei gehören muss; gespeicherter Wert
 * @returns {Promise<{ ok: boolean, value?: string|null }>} value: interne Adresse "/uploads/<name>" oder null
 */
async function checkOwnUpload(db, value, { accountId, current = null }) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || String(value).trim() === '') return { ok: true, value: null };
  const stored = normalizeInput(String(value).trim());
  if (!nameFromStored(stored)) return { ok: false };
  if (current && stored === current) return { ok: true, value: stored };
  const r = await db.query(
    `SELECT 1 FROM user_media WHERE url = $1 AND user_id = $2
     UNION ALL SELECT 1 FROM vehicle_media WHERE url = $1 AND user_id = $2
     LIMIT 1`,
    [stored, accountId]
  );
  return r.rowCount > 0 ? { ok: true, value: stored } : { ok: false };
}

const KEYS = new Set(['image_url', 'profile_image_url', 'url']);
// Alle Bildadressen in einer API-Antwort signieren (Objekte und Listen beliebiger Tiefe)
function signDeep(body, now = Date.now()) {
  if (Array.isArray(body)) return body.map((x) => signDeep(x, now));
  if (!body || typeof body !== 'object' || body instanceof Date || Buffer.isBuffer(body)) return body;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = KEYS.has(k) && typeof v === 'string' ? signedUrl(v, now) : signDeep(v, now);
  }
  return out;
}

/**
 * Bild verkleinern, nach EXIF drehen, als WebP ohne Metadaten speichern.
 * @param {string} source Pfad der hochgeladenen Datei
 * @param {string} target Pfad der Zieldatei (.webp)
 * @param {'vehicle'|'user'} art
 * @returns {{ bytes: number, width: number, height: number }}
 */
async function optimizeImage(source, target, art) {
  const max = MAX_EDGE[art] || MAX_EDGE.vehicle;
  // rotate() ohne Winkel wendet die EXIF-Ausrichtung an; sharp übernimmt Metadaten nur mit withMetadata(), also nie
  const info = await sharp(source, { pages: 1, limitInputPixels: 100e6 })
    .rotate()
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(target);
  return { bytes: info.size, width: info.width, height: info.height };
}

function filePath(uploadDir, name) {
  return NAME_RE.test(String(name || '')) ? path.join(uploadDir, name) : null;
}

async function exists(p) {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

module.exports = {
  MEDIA_BASE_URL, FILES_PATH, MAX_EDGE, NAME_RE,
  signedUrl, verify, normalizeInput, checkOwnUpload, signDeep, optimizeImage, filePath, expiry, exists
};
