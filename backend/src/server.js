const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { randomUUID, randomBytes, createHmac, createHash, timingSafeEqual } = require('crypto');
const multer = require('multer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { getVehicleStats, FUEL_TYPES, unitForFuelType, unitsForFuelType } = require('./services/stats');
const { getVehicleReminders } = require('./services/reminders');
const { encryptSecret, decryptSecret, sendUserMail, resolveSmtpHost, ALLOWED_PORTS, loadDefaultSmtp, withDefaultSmtp } = require('./services/mail');
const notifier = require('./services/notifier');
const plans = require('./services/plans');
const planChanges = require('./services/planChanges');
const categories = require('./services/categories');
const media = require('./services/media');
const stations = require('./services/stations');
// Version der API (#111): aus package.json, das neue-version.js zusammen mit VERSION pflegt
const API_VERSION = require('../package.json').version;
const { checkOdometer, loadOdometerPoints, odometerWarnings } = require('./services/odometer');
const { VEHICLE_EXTRA_COLUMNS, parseVehicleExtras } = require('./services/vehicleFields');

// Media Upload Konfiguration
// Standard-Uploadpfad: im Backend-Projektordner unter ../uploads (z. B. /srv/www/.../uploads)
const BACKEND_ROOT = path.resolve(__dirname, '..');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? (path.isAbsolute(process.env.UPLOAD_DIR)
    ? process.env.UPLOAD_DIR
    : path.resolve(BACKEND_ROOT, process.env.UPLOAD_DIR))
  : path.resolve(BACKEND_ROOT, 'uploads');
const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL || '/uploads';

const app = express();

// Die API läuft hinter nginx (Docker-Port auf 127.0.0.1): Client-IP aus X-Forwarded-For nur von lokalen bzw.
// privaten Adressen (Docker-Netz) übernehmen
app.set('trust proxy', 'loopback, uniquelocal');

// Rate Limiting. Das PHP-Frontend ruft die API über den Server selbst auf, alle Nutzer kämen also von
// derselben IP: angemeldete Anfragen zählen deshalb je Konto, nur anonyme je IP.
function limitKey(req) {
  const token = bearerToken(req);
  if (token) {
    try {
      return 'u:' + jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }).sub;
    } catch {
      // ungültiges Token: wie anonym behandeln
    }
  }
  return 'ip:' + ipKeyGenerator(req.ip || '');
}
const limiter = (windowMs, angemeldet, anonym) => rateLimit({
  windowMs,
  limit: (req) => (limitKey(req).startsWith('u:') ? angemeldet : anonym),
  keyGenerator: limitKey,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'too_many_requests' })
});
// Eine Seite im Frontend braucht höchstens etwa 20 API-Aufrufe
const apiLimiter = limiter(60 * 1000, 600, 300);
// Nach auth eingehängt, zählen also immer je Konto
const uploadLimiter = limiter(10 * 60 * 1000, 30, 30);
const importLimiter = limiter(10 * 60 * 1000, 60, 60);
// Tankstellensuche: schont das Kontingent des Tankerkönig-Keys (Ergebnisse sind zusätzlich 2 Minuten gecacht)
const stationsLimiter = limiter(60 * 1000, 30, 30);
// Signierte Bilder (#103): ohne Anmeldung, zählen je IP; großzügig, eine Seite lädt mehrere Bilder
const fileLimiter = limiter(60 * 1000, 2000, 2000);

app.use(helmet());
// Bilder nur mit gültiger Signatur ausliefern; kein öffentliches /uploads mehr.
// Eigene, großzügige Grenze statt der allgemeinen: eine Seite lädt mehrere Bilder.
// nosniff + CSP verhindern, dass Browser eine Datei als HTML/Skript ausführen.
app.get('/api/v1/files/:name', fileLimiter, (req, res) => {
  const name = String(req.params.name || '');
  if (!media.verify(name, req.query.exp, req.query.sig)) return res.status(404).end();
  const datei = media.filePath(UPLOAD_DIR, name);
  const restSekunden = Math.max(0, Number(req.query.exp) - Math.floor(Date.now() / 1000));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  // Nur der Browser darf zwischenspeichern (bis zum Ablauf der Adresse), Cloudflare & Co. nicht
  res.setHeader('Cache-Control', `private, max-age=${restSekunden}, immutable`);
  res.sendFile(datei, { dotfiles: 'deny', cacheControl: false }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});
app.use(apiLimiter);
// CORS: Das PHP-Frontend ruft die API nur serverseitig auf, Browser anderer Seiten brauchen keinen Zugriff.
// Nur ausdrücklich erlaubte Ursprünge (CORS_ORIGINS, kommagetrennt) bekommen CORS-Header.
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.header('Origin');
  if (!origin || !CORS_ORIGINS.includes(origin)) return next();
  res.set({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
    Vary: 'Origin'
  });
  return req.method === 'OPTIONS' ? res.status(204).end() : next();
});
// 2 MB erlaubt größere CSV-Importe (Frontend sendet max. 500 Zeilen pro Anfrage)
app.use(express.json({ limit: '2mb' }));

// Bildadressen in allen Antworten signieren (#103): intern "/uploads/<datei>", nach außen "/api/v1/files/<datei>?exp=…&sig=…"
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(media.signDeep(body));
  next();
});



const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL fehlt');
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  throw new Error('JWT_SECRET fehlt oder ist zu kurz');
}

// DATE-Spalten (z. B. Erstzulassung) als 'YYYY-MM-DD' liefern, nicht als Date mit Zeitzonenverschiebung
require('pg').types.setTypeParser(1082, (v) => v);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Upload-Verzeichnis erstellen falls nicht vorhanden
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  // Nie den Dateinamen des Uploaders übernehmen: Endung wird erst nach Prüfung des Inhalts vergeben
  filename: (req, file, cb) => {
    cb(null, `${randomUUID()}.upload`);
  }
});

// Bildtyp anhand des Dateiinhalts (Magic Bytes) bestimmen – der vom Client gesendete Typ ist nicht vertrauenswürdig
function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))) return { ext: '.gif', mime: 'image/gif' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  return null;
}

// Pfad einer hochgeladenen Datei immer selbst aus UPLOAD_DIR und dem von uns vergebenen Namen bilden
// (UUID + Endung, siehe storage oben), nie aus Angaben der Anfrage. Unerwartete Namen ergeben null.
function uploadPath(filename) {
  const name = path.basename(String(filename || ''));
  return /^[0-9a-f-]{36}\.(upload|jpg|png|gif|webp)$/.test(name) ? path.join(UPLOAD_DIR, name) : null;
}

// Datei zu einer gespeicherten Bild-URL (aus der Datenbank): nur der Dateiname zählt, nur einfache Namen
function storedMediaPath(url) {
  const name = path.basename(String(url || ''));
  return /^[\w-]+\.[a-z]{3,4}$/i.test(name) ? path.join(UPLOAD_DIR, name) : null;
}

function removeUpload(file) {
  const p = file && uploadPath(file.filename);
  return p ? fs.promises.unlink(p).catch(() => {}) : Promise.resolve();
}

// Nach multer: nur echte Bilder behalten und mit passender Endung speichern
async function verifyUploadedImage(req, res, next) {
  if (!req.file) return next();
  const source = uploadPath(req.file.filename);
  if (!source) return res.status(400).json({ error: 'invalid_image' });
  try {
    const fd = await fs.promises.open(source, 'r');
    const { buffer, bytesRead } = await fd.read(Buffer.alloc(16), 0, 16, 0);
    await fd.close();
    const type = detectImageType(buffer.subarray(0, bytesRead));
    if (!type) {
      await fs.promises.unlink(source).catch(() => {});
      return res.status(400).json({ error: 'invalid_image' });
    }
    // Verkleinern, nach EXIF drehen, als WebP ohne Metadaten (GPS) speichern; das Original wird nicht behalten (#103)
    const filename = path.basename(source).replace(/\.upload$/, '.webp');
    const target = path.join(UPLOAD_DIR, filename);
    let info;
    try {
      info = await media.optimizeImage(source, target, req.mediaArt || 'vehicle');
    } catch (e) {
      await fs.promises.unlink(target).catch(() => {});
      await fs.promises.unlink(source).catch(() => {});
      return res.status(400).json({ error: 'invalid_image' });
    }
    await fs.promises.unlink(source).catch(() => {});
    Object.assign(req.file, { filename, path: target, mimetype: 'image/webp', size: info.bytes });
    return next();
  } catch (e) {
    await fs.promises.unlink(source).catch(() => {});
    return res.status(500).json({ error: 'server_error' });
  }
}

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Nur JPEG, PNG, GIF und WebP Bilder sind erlaubt.'), false);
    }
  }
});

// auth_time: Zeitpunkt des letzten echten Logins (Sekunden). Beim Verlängern (#56) wird er übernommen, damit
// eine aktive Anmeldung höchstens MAX_SESSION_DAYS lang ohne Passwort weiterläuft.
const MAX_SESSION_DAYS = 90;
function signToken(user, authTime = Math.floor(Date.now() / 1000)) {
  const jti = randomUUID();
  return jwt.sign(
    { sub: user.id, email: user.email, jti, auth_time: authTime },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// "Zuletzt aktiv" für die Benutzerverwaltung: höchstens einmal pro Stunde und Benutzer in die Datenbank schreiben
const lastSeenWritten = new Map();
const LAST_SEEN_INTERVAL_MS = 60 * 60 * 1000;

function touchLastSeen(userId) {
  const now = Date.now();
  if (!userId || now - (lastSeenWritten.get(userId) || 0) < LAST_SEEN_INTERVAL_MS) return;
  lastSeenWritten.set(userId, now);
  pool.query(
    `UPDATE users SET last_seen_at = now()
     WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour')`,
    [userId]
  ).catch((e) => console.error('[last_seen]', e.message));
}

async function recordLogin(userId) {
  lastSeenWritten.set(String(userId), Date.now());
  await pool.query('UPDATE users SET last_login_at = now(), last_seen_at = now() WHERE id = $1', [userId])
    .catch((e) => console.error('[last_login]', e.message));
}

// Token aus "Authorization: Bearer <token>". Ohne überlappende Wiederholungen im Regex, damit ein
// präparierter Header die Prüfung nicht quadratisch verlangsamt (ReDoS).
function bearerToken(req) {
  const h = String(req.header('Authorization') || '');
  if (h.length > 8192) return null;
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(h);
  return m ? m[1] : null;
}

async function auth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'missing_token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // Falls Token eine jti besitzt, prüfen wir, ob es widerrufen wurde
    if (payload.jti) {
      const revoked = await pool.query(
        'SELECT 1 FROM revoked_tokens WHERE jti = $1',
        [payload.jti]
      );
      if (revoked.rowCount > 0) {
        return res.status(401).json({ error: 'token_revoked' });
      }
    }

    // User-weite Revocation: alle Tokens vor revoked_after sind ungültig
    if (payload.sub) {
      const r2 = await pool.query(
        'SELECT revoked_after FROM user_token_revocations WHERE user_id = $1',
        [payload.sub]
      );
      if (r2.rowCount === 1 && payload.iat) {
        const revokedAfter = new Date(r2.rows[0].revoked_after);
        const tokenIat = new Date(payload.iat * 1000); // iat ist in Sekunden
        if (tokenIat < revokedAfter) {
          return res.status(401).json({ error: 'token_revoked_for_user' });
        }
      }
    }

    req.user = payload;
    touchLastSeen(String(payload.sub || ''));
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// --- TOTP (RFC 6238) für 2FA: 30 s, 6 Stellen, SHA1 – kompatibel mit gängigen Authenticator-Apps ---
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCode(secretBase32, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const num = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(num).padStart(6, '0');
}

// Erlaubt ±1 Zeitfenster (je 30 s) für leicht abweichende Uhren
// 2FA-Secrets liegen verschlüsselt in der Datenbank (AES-256-GCM, eigener Schlüssel 'mfa').
// Ältere, noch unverschlüsselte Werte werden beim Start umgewandelt (encryptLegacyMfaSecrets).
function storeMfaSecret(secretBase32) {
  return encryptSecret(secretBase32, 'mfa');
}

function readMfaSecret(stored) {
  if (!stored) return null;
  if (!String(stored).startsWith('v1:')) return String(stored);
  try {
    return decryptSecret(stored, 'mfa');
  } catch (e) {
    // Falscher Schlüssel (z. B. JWT_SECRET ohne MAIL_ENCRYPTION_KEY geändert): 2FA-Codes gelten als falsch
    console.error('[mfa] Secret nicht entschlüsselbar:', e.message);
    return null;
  }
}

async function encryptLegacyMfaSecrets() {
  const r = await pool.query("SELECT id, mfa_secret FROM users WHERE mfa_secret IS NOT NULL AND mfa_secret NOT LIKE 'v1:%'");
  for (const row of r.rows) {
    await pool.query('UPDATE users SET mfa_secret = $1 WHERE id = $2 AND mfa_secret = $3', [storeMfaSecret(row.mfa_secret), row.id, row.mfa_secret]);
  }
  if (r.rowCount) console.log(`[mfa] ${r.rowCount} 2FA-Secret(s) verschlüsselt`);
}

function verifyTotp(secretBase32, code) {
  const given = String(code || '').replace(/\s/g, '');
  if (!secretBase32 || !/^\d{6}$/.test(given)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secretBase32, counter + delta));
    if (timingSafeEqual(expected, Buffer.from(given))) return true;
  }
  return false;
}

// --- Schutz vor Durchprobieren (Passwort, 2FA-Code): Fehlversuche je Schlüssel zählen ---
// Im Speicher des Prozesses; reicht für eine API-Instanz. Zählt nur Fehlversuche, Erfolg setzt zurück.
const failedAttempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function isLockedOut(key, max) {
  const entry = failedAttempts.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= max;
}

function recordFailure(key) {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || entry.resetAt < now) failedAttempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  else entry.count++;
}

function clearFailures(key) {
  failedAttempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failedAttempts) if (entry.resetAt < now) failedAttempts.delete(key);
}, 10 * 60 * 1000).unref();

const LOGIN_MAX_FAILURES = 10;
const MFA_MAX_FAILURES = 5;

function tooManyAttempts(res) {
  return res.status(429).json({ error: 'too_many_attempts', retry_after_minutes: 15 });
}

// Kurzlebiges Token für den 2FA-Schritt (eigener Schlüssel, kann nicht als Zugangstoken benutzt werden)
const MFA_TOKEN_SECRET = `${process.env.JWT_SECRET}:mfa-step`;

// Interne Fehler nur ins Log schreiben, nicht an den Client (verrät sonst Tabellen/Spalten)
function serverError(res, e) {
  // Ungültige UUID in der URL (z. B. /fillups/xyz): wie ein unbekannter Eintrag behandeln, kein Serverfehler
  if (e && e.code === '22P02') return res.status(404).json({ error: 'not_found' });
  console.error('[server_error]', e);
  return res.status(500).json({ error: 'server_error' });
}

// Optionale Zahl aus dem Request: undefined bleibt undefined, null/'' wird null
function optionalNumber(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return Number(value);
}

// Optionaler Text aus dem Request: undefined bleibt undefined, null/leer wird null
function optionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value).trim() || null;
}

// Beta-Phase: an, bis BETA_PHASE=false gesetzt wird. Neue Konten werden in der Beta als Beta-Tester markiert.
function isBetaPhase() {
  return process.env.BETA_PHASE !== 'false';
}

// Admins werden über ADMIN_USER_IDS (kommagetrennte User-IDs) in der .env festgelegt
function isAdmin(req) {
  const adminIds = String(process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return adminIds.includes(String(req.user?.sub || ''));
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    // Abgewiesene Zugriffe auf Admin-Funktionen protokollieren (#102): Konto, Methode, Pfad – ohne Body und Token
    console.warn(`[admin] abgewiesen: ${req.method} ${req.originalUrl.split('?')[0]} von Konto ${req.user?.sub || '-'}`);
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
}

// Zugriff nur auf den eigenen User (:userId), außer für Admins
function requireSelfOrAdmin(req, res, next) {
  const userId = String(req.params.userId || '').trim();
  if (userId !== String(req.user?.sub || '') && !isAdmin(req)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
}

// Healthcheck
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'fuelstat-api-v2',
    version: API_VERSION,
    registration_enabled: process.env.REGISTRATION_ENABLED !== 'false',
    beta_phase: isBetaPhase()
  });
});

// Anmeldung verlängern (#56): gültiges Token gegen ein neues mit wieder 7 Tagen Laufzeit tauschen.
// Das Frontend ruft das bei aktiver Nutzung höchstens einmal am Tag auf. Widerrufene Tokens kommen hier gar
// nicht an (auth), und spätestens MAX_SESSION_DAYS nach dem letzten Login ist eine neue Anmeldung nötig.
app.post('/api/v1/auth/refresh', auth, async (req, res) => {
  const authTime = Number(req.user.auth_time || req.user.iat || 0);
  if (!authTime || Date.now() / 1000 - authTime > MAX_SESSION_DAYS * 86400) {
    return res.status(401).json({ error: 'reauth_required' });
  }
  try {
    const r = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(401).json({ error: 'invalid_token' });
    res.json({ token: signToken(r.rows[0], authTime) });
  } catch (e) {
    serverError(res, e);
  }
});

// Whoami - zeigt aktuell angemeldeten User
app.get('/api/v1/whoami', auth, async (req, res) => {
  try {
    // Zusätzlich User-Daten aus DB holen für vollständige Info
    const r = await pool.query(
      `SELECT id, email, username, mfa_enabled, profile_image_url, beta_tester, plan, plan_until, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    res.json({
      id: r.rows[0].id,
      email: r.rows[0].email,
      username: r.rows[0].username,
      mfa_enabled: r.rows[0].mfa_enabled,
      profile_image_url: r.rows[0].profile_image_url,
      beta_tester: r.rows[0].beta_tester,
      created_at: r.rows[0].created_at,
      updated_at: r.rows[0].updated_at,
      is_admin: isAdmin(req),
      // Tarif und Rechte (plan, planUntil, effectivePlan, limitsEnabled, features)
      ...plans.planInfo(r.rows[0]),
      token: {
        jti: req.user.jti || null,
        iat: req.user.iat ? new Date(req.user.iat * 1000).toISOString() : null,
        exp: req.user.exp ? new Date(req.user.exp * 1000).toISOString() : null
      }
    });
  } catch (e) {
    serverError(res, e);
  }
});

// DB Ping
app.get('/api/v1/db-ping', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, result: r.rows[0] });
  } catch (e) {
    console.error('[db-ping]', e);
    res.status(500).json({ ok: false });
  }
});

// Register
app.post('/api/v1/auth/register', async (req, res) => {
  // Öffentliche Registrierung abschaltbar (z. B. für eine private Installation)
  if (process.env.REGISTRATION_ENABLED === 'false') return res.status(403).json({ error: 'registration_disabled' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !email.includes('@')) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO users (email, password_hash, beta_tester)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, mfa_enabled, profile_image_url, beta_tester, created_at, updated_at`,
      [email, passwordHash, isBetaPhase()]
    );
    const user = r.rows[0];
    await recordLogin(user.id);
    res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'email_already_exists' });
    serverError(res, e);
  }
});

// Login
app.post('/api/v1/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

  try {
    const r = await pool.query(
      `SELECT id, email, password_hash, username, mfa_enabled, mfa_secret, profile_image_url, created_at, updated_at
       FROM users WHERE email = $1`,
      [email]
    );
    const loginKey = `login:${email}`;
    if (isLockedOut(loginKey, LOGIN_MAX_FAILURES)) return tooManyAttempts(res);

    if (r.rowCount === 0) {
      recordFailure(loginKey);
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      recordFailure(loginKey);
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    clearFailures(loginKey);

    // 2FA: erst nach korrektem Passwort nach dem Code fragen
    if (user.mfa_enabled) {
      // Ohne Code: 401 mfa_required mit mfaToken. Das Token erlaubt nur den zweiten Schritt (POST /auth/login/mfa)
      // mit gültigem TOTP-Code und hängt nicht von der Eingabe ab – es wird deshalb immer erzeugt.
      const mfaToken = jwt.sign({ sub: user.id }, MFA_TOKEN_SECRET, { expiresIn: '5m' });
      const code = typeof req.body?.code === 'string' || typeof req.body?.code === 'number' ? String(req.body.code).trim() : '';
      if (!code) return res.status(401).json({ error: 'mfa_required', mfaToken });
      const mfaKey = `mfa:${user.id}`;
      if (isLockedOut(mfaKey, MFA_MAX_FAILURES)) return tooManyAttempts(res);
      if (!verifyTotp(readMfaSecret(user.mfa_secret), code)) {
        recordFailure(mfaKey);
        return res.status(401).json({ error: 'invalid_mfa_code' });
      }
      clearFailures(mfaKey);
    }

    delete user.password_hash;
    delete user.mfa_secret;
    await recordLogin(user.id);
    res.json({ token: signToken(user), user });
  } catch (e) {
    serverError(res, e);
  }
});

// 2FA-Login, Schritt 2: mfaToken aus der mfa_required-Antwort + Code aus der Authenticator-App
app.post('/api/v1/auth/login/mfa', async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(String(req.body?.mfaToken || ''), MFA_TOKEN_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'invalid_mfa_token' });
  }
  const mfaKey = `mfa:${payload.sub}`;
  if (isLockedOut(mfaKey, MFA_MAX_FAILURES)) return tooManyAttempts(res);
  try {
    const r = await pool.query(
      `SELECT id, email, username, mfa_enabled, mfa_secret, profile_image_url, created_at, updated_at
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (r.rowCount === 0 || !r.rows[0].mfa_enabled) return res.status(401).json({ error: 'invalid_mfa_token' });
    const user = r.rows[0];
    if (!verifyTotp(readMfaSecret(user.mfa_secret), req.body?.code)) {
      recordFailure(mfaKey);
      return res.status(401).json({ error: 'invalid_mfa_code' });
    }
    clearFailures(mfaKey);
    delete user.mfa_secret;
    await recordLogin(user.id);
    res.json({ token: signToken(user), user });
  } catch (e) {
    serverError(res, e);
  }
});

// Change own password (current password required). Revokes all existing tokens and returns a new one.
app.post('/api/v1/auth/password', auth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing_password' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'password_too_short' });

  try {
    const r = await pool.query('SELECT id, email, password_hash FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    const pwKey = `password:${req.user.sub}`;
    if (isLockedOut(pwKey, LOGIN_MAX_FAILURES)) return tooManyAttempts(res);
    const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
    if (!ok) {
      recordFailure(pwKey);
      return res.status(401).json({ error: 'invalid_current_password' });
    }
    clearFailures(pwKey);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, req.user.sub]);
    await pool.query(
      `INSERT INTO user_token_revocations (user_id, revoked_after, reason)
       VALUES ($1, now(), 'password_changed')
       ON CONFLICT (user_id) DO UPDATE SET revoked_after = now(), reason = 'password_changed'`,
      [req.user.sub]
    );
    // JWT-iat hat Sekundengenauigkeit: kurz warten, damit das neue Token nach revoked_after liegt
    await new Promise((resolve) => setTimeout(resolve, 1000));
    res.json({ token: signToken(r.rows[0]) });
  } catch (e) {
    serverError(res, e);
  }
});

// 2FA einrichten: neues Secret erzeugen (noch nicht aktiv, erst nach /mfa/enable)
app.post('/api/v1/auth/mfa/setup', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT email, mfa_enabled FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    if (r.rows[0].mfa_enabled) return res.status(409).json({ error: 'mfa_already_enabled' });

    const secret = base32Encode(randomBytes(20));
    await pool.query('UPDATE users SET mfa_secret = $1, updated_at = now() WHERE id = $2', [storeMfaSecret(secret), req.user.sub]);
    const label = encodeURIComponent(`Fuelstat:${r.rows[0].email}`);
    res.json({
      secret,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Fuelstat&algorithm=SHA1&digits=6&period=30`
    });
  } catch (e) {
    serverError(res, e);
  }
});

// 2FA aktivieren: Code aus der Authenticator-App bestätigen
app.post('/api/v1/auth/mfa/enable', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    if (r.rows[0].mfa_enabled) return res.status(409).json({ error: 'mfa_already_enabled' });
    if (!r.rows[0].mfa_secret) return res.status(400).json({ error: 'mfa_not_set_up' });
    const mfaKey = `mfa:${req.user.sub}`;
    if (isLockedOut(mfaKey, MFA_MAX_FAILURES)) return tooManyAttempts(res);
    if (!verifyTotp(readMfaSecret(r.rows[0].mfa_secret), req.body?.code)) {
      recordFailure(mfaKey);
      return res.status(400).json({ error: 'invalid_mfa_code' });
    }
    clearFailures(mfaKey);

    await pool.query('UPDATE users SET mfa_enabled = true, updated_at = now() WHERE id = $1', [req.user.sub]);
    res.json({ mfa_enabled: true });
  } catch (e) {
    serverError(res, e);
  }
});

// 2FA deaktivieren: Passwort und aktueller Code erforderlich
app.post('/api/v1/auth/mfa/disable', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT password_hash, mfa_secret, mfa_enabled FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    if (!r.rows[0].mfa_enabled) return res.status(400).json({ error: 'mfa_not_enabled' });
    const mfaKey = `mfa:${req.user.sub}`;
    if (isLockedOut(mfaKey, MFA_MAX_FAILURES)) return tooManyAttempts(res);
    const ok = await bcrypt.compare(String(req.body?.password || ''), r.rows[0].password_hash);
    if (!ok || !verifyTotp(readMfaSecret(r.rows[0].mfa_secret), req.body?.code)) {
      recordFailure(mfaKey);
      return res.status(ok ? 400 : 401).json({ error: ok ? 'invalid_mfa_code' : 'invalid_current_password' });
    }
    clearFailures(mfaKey);

    await pool.query('UPDATE users SET mfa_enabled = false, mfa_secret = NULL, updated_at = now() WHERE id = $1', [req.user.sub]);
    res.json({ mfa_enabled: false });
  } catch (e) {
    serverError(res, e);
  }
});

// List all users (Admin-Endpoint)
app.get('/api/v1/auth/users', auth, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         id,
         email,
         username,
         mfa_enabled,
         profile_image_url,
         beta_tester,
         plan,
         plan_until,
         created_at,
         updated_at,
         last_login_at,
         last_seen_at,
         (SELECT COUNT(*)::int FROM vehicles v WHERE v.user_id = users.id) AS vehicle_count,
         -- Wann zuletzt etwas eingetragen wurde (Erfassungszeit, nicht das Datum des Eintrags – Importe zählen also auch)
         GREATEST(
           (SELECT MAX(f.created_at) FROM fillups f WHERE f.user_id = users.id),
           (SELECT MAX(e.created_at) FROM expenses e WHERE e.user_id = users.id)
         ) AS last_entry_at
       FROM users
       ORDER BY created_at ASC`
    );
    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

// Beta-Tester-Status setzen (nur Admin)
app.put('/api/v1/auth/users/:userId/beta', auth, requireAdmin, async (req, res) => {
  if (typeof req.body?.betaTester !== 'boolean') return res.status(400).json({ error: 'invalid_betaTester' });
  try {
    const r = await pool.query(
      'UPDATE users SET beta_tester = $2, updated_at = now() WHERE id = $1 RETURNING id, email, beta_tester',
      [String(req.params.userId || '').trim(), req.body.betaTester]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'user_not_found' });
    serverError(res, e);
  }
});

// Tarif und Ablaufdatum aus dem Request prüfen; liefert { plan, planUntil } oder { error }
function parsePlanBody(body) {
  const plan = String(body?.plan || '').trim();
  if (!plans.PLAN_NAMES.includes(plan)) return { error: 'invalid_plan' };
  let planUntil = null;
  if (body?.planUntil !== undefined && body?.planUntil !== null && body?.planUntil !== '') {
    const d = new Date(String(body.planUntil));
    if (Number.isNaN(d.getTime())) return { error: 'invalid_planUntil' };
    planUntil = d.toISOString();
  }
  // Notiz fürs Protokoll (z. B. "Tester", "Kulanz"), optional und gekürzt
  const note = body?.note ? String(body.note).trim().slice(0, 200) || null : null;
  // Free ist immer unbefristet
  return { plan, planUntil: plan === 'free' ? null : planUntil, note };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tarif setzen (nur Admin), z. B. Plus für Tester und Freunde. planUntil: ISO-Datum oder null (unbefristet)
app.put('/api/v1/auth/users/:userId/plan', auth, requireAdmin, async (req, res) => {
  const p = parsePlanBody(req.body);
  if (p.error) return res.status(400).json({ error: p.error, allowed: plans.PLAN_NAMES });
  const userId = String(req.params.userId || '').trim();
  if (!UUID_RE.test(userId)) return res.status(404).json({ error: 'user_not_found' });
  try {
    const [u] = await planChanges.setPlans(pool, {
      userIds: [userId], plan: p.plan, planUntil: p.planUntil, source: 'admin', changedBy: req.user.sub, note: p.note
    });
    if (!u) return res.status(404).json({ error: 'user_not_found' });
    res.json({ id: u.id, email: u.email, ...plans.planInfo(u) });
  } catch (e) {
    serverError(res, e);
  }
});

// Verlauf der Tarifänderungen eines Kontos (nur Admin, #102)
app.get('/api/v1/auth/users/:userId/plan-history', auth, requireAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!UUID_RE.test(userId)) return res.status(404).json({ error: 'user_not_found' });
  try {
    res.json({ changes: await planChanges.history(pool, userId) });
  } catch (e) {
    serverError(res, e);
  }
});

// Tarif für mehrere Konten auf einmal setzen (nur Admin): { userIds: [...], plan, planUntil }
app.put('/api/v1/auth/plans', auth, requireAdmin, async (req, res) => {
  const p = parsePlanBody(req.body);
  if (p.error) return res.status(400).json({ error: p.error, allowed: plans.PLAN_NAMES });
  const ids = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds.map((x) => String(x).trim()))] : [];
  if (ids.length === 0 || ids.length > 1000 || !ids.every((id) => UUID_RE.test(id))) {
    return res.status(400).json({ error: 'invalid_userIds' });
  }
  try {
    const r = await planChanges.setPlans(pool, {
      userIds: ids, plan: p.plan, planUntil: p.planUntil, source: 'admin', changedBy: req.user.sub, note: p.note
    });
    // updated = gefundene Konten (wie bisher), changed = davon tatsächlich geändert
    res.json({ updated: r.length, changed: r.filter((u) => u.changed).length, plan: p.plan, planUntil: p.planUntil });
  } catch (e) {
    serverError(res, e);
  }
});

// Get single user (eigener User oder Admin)
app.get('/api/v1/auth/users/:userId', auth, requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'missing_userId' });

  try {
    const r = await pool.query(
      `SELECT
         id,
         email,
         username,
         mfa_enabled,
         profile_image_url,
         created_at,
         updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Patch single user (eigener User oder Admin)
app.patch('/api/v1/auth/users/:userId', auth, requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'missing_userId' });

  const email =
    req.body?.email !== undefined
      ? String(req.body.email).trim().toLowerCase()
      : undefined;
  const username = optionalText(req.body?.username);
  const profileImageUrl = media.normalizeInput(optionalText(req.body?.profileImageUrl));

  if (email === undefined && username === undefined && profileImageUrl === undefined) {
    return res.status(400).json({ error: 'nothing_to_update' });
  }

  if (email !== undefined && (!email || !email.includes('@'))) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(email);
    }
    if (username !== undefined) {
      fields.push(`username = $${idx++}`);
      values.push(username);
    }
    if (profileImageUrl !== undefined) {
      fields.push(`profile_image_url = $${idx++}`);
      values.push(profileImageUrl);
    }

    fields.push(`updated_at = now()`);
    values.push(userId);

    const r = await pool.query(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING id, email, username, mfa_enabled, profile_image_url, created_at, updated_at`,
      values
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'email_already_exists' });
    }
    serverError(res, e);
  }
});

// Delete single user (eigener User oder Admin)
app.delete('/api/v1/auth/users/:userId', auth, requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'missing_userId' });

  try {
    // Hochgeladene Bilder (Profil und Fahrzeuge) merken, damit nach dem Löschen keine Dateien liegen bleiben
    const media = await pool.query(
      `SELECT url FROM user_media WHERE user_id = $1
       UNION SELECT url FROM vehicle_media WHERE user_id = $1
       UNION SELECT profile_image_url FROM users WHERE id = $1 AND profile_image_url IS NOT NULL`,
      [userId]
    );

    const r = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [userId]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    await Promise.all(media.rows.map(({ url }) => {
      const p = storedMediaPath(url);
      return p ? fs.promises.unlink(p).catch(() => {}) : null;
    }));

    return res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

// Revoke all tokens of a user (eigener User oder Admin)
app.post('/api/v1/auth/users/:userId/revoke-all', auth, requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'missing_userId' });

  const reason =
    req.body?.reason !== undefined
      ? String(req.body.reason).trim()
      : null;

  try {
    // Sicherstellen, dass der User existiert
    const exists = await pool.query(
      'SELECT 1 FROM users WHERE id = $1',
      [userId]
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    const r = await pool.query(
      `INSERT INTO user_token_revocations (user_id, revoked_after, reason)
       VALUES ($1, now(), $2)
       ON CONFLICT (user_id) DO UPDATE
         SET revoked_after = now(),
             reason = COALESCE(EXCLUDED.reason, user_token_revocations.reason)
       RETURNING user_id, revoked_after, reason`,
      [userId, reason]
    );

    res.status(201).json({
      userId: r.rows[0].user_id,
      revokedAfter: r.rows[0].revoked_after,
      reason: r.rows[0].reason,
      message:
        'Alle bestehenden Tokens dieses Benutzers wurden widerrufen. Neue Logins erhalten wieder gültige Tokens.'
    });
  } catch (e) {
    serverError(res, e);
  }
});

// List revoked tokens (Admins: alle bzw. ?userId=, sonst nur die eigenen)
app.get('/api/v1/auth/tokens', auth, async (req, res) => {
  const userId = !isAdmin(req)
    ? String(req.user.sub)
    : req.query.userId !== undefined
      ? String(req.query.userId).trim()
      : null;

  try {
    let r;
    if (userId) {
      r = await pool.query(
        `SELECT jti, user_id, revoked_at, reason
         FROM revoked_tokens
         WHERE user_id = $1
         ORDER BY revoked_at DESC`,
        [userId]
      );
    } else {
      r = await pool.query(
        `SELECT jti, user_id, revoked_at, reason
         FROM revoked_tokens
         ORDER BY revoked_at DESC`
      );
    }

    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

// Revoke a token (eigene Tokens oder Admin)
app.post('/api/v1/auth/tokens/revoke', auth, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const reason =
    req.body?.reason !== undefined
      ? String(req.body.reason).trim()
      : null;

  if (!token) {
    return res.status(400).json({ error: 'missing_token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload.jti) {
      return res.status(400).json({
        error: 'cannot_revoke_legacy_token',
        message:
          'Dieses Token besitzt keine jti und kann daher serverseitig nicht widerrufen werden. Bitte den Benutzer neu einloggen lassen.'
      });
    }

    const jti = String(payload.jti);
    const userId = String(payload.sub);

    if (userId !== String(req.user.sub) && !isAdmin(req)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const r = await pool.query(
      `INSERT INTO revoked_tokens (jti, user_id, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (jti) DO UPDATE
         SET reason = COALESCE(EXCLUDED.reason, revoked_tokens.reason)`,
      [jti, userId, reason]
    );

    res.status(201).json({
      jti,
      userId,
      reason,
      message: 'Token wurde widerrufen und wird ab sofort abgelehnt.'
    });
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'invalid_token', detail: e.message });
    }
    serverError(res, e);
  }
});

// Create vehicle
app.post('/api/v1/vehicles', auth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const fuelType = String(req.body?.fuelType || '').trim().toLowerCase();

  if (!name) return res.status(400).json({ error: 'missing_name' });
  if (!FUEL_TYPES.has(fuelType)) return res.status(400).json({ error: 'invalid_fuelType' });

  const brand = req.body?.brand ? String(req.body.brand).trim() : null;
  const model = req.body?.model ? String(req.body.model).trim() : null;
  const year = optionalNumber(req.body?.year) ?? null;
  const imageUrl = req.body?.imageUrl ? media.normalizeInput(String(req.body.imageUrl).trim()) : null;
  const odometerKm = optionalNumber(req.body?.odometerKm) ?? null;
  const mileageKm = optionalNumber(req.body?.mileageKm) ?? null;
  const tankCapacity = optionalNumber(req.body?.tankCapacity) ?? null;
  const batteryCapacity = optionalNumber(req.body?.batteryCapacity) ?? null;
  const sortOrder = req.body?.sortOrder !== undefined ? Number(req.body.sortOrder) : 0;

  if (year !== null && (!Number.isFinite(year) || year < 1886 || year > 2100)) {
    return res.status(400).json({ error: 'invalid_year' });
  }
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
    return res.status(400).json({ error: 'invalid_odometerKm' });
  }
  if (mileageKm !== null && (!Number.isFinite(mileageKm) || mileageKm < 0)) {
    return res.status(400).json({ error: 'invalid_mileageKm' });
  }
  if (tankCapacity !== null && (!Number.isFinite(tankCapacity) || tankCapacity <= 0)) {
    return res.status(400).json({ error: 'invalid_tankCapacity' });
  }
  if (batteryCapacity !== null && (!Number.isFinite(batteryCapacity) || batteryCapacity <= 0)) {
    return res.status(400).json({ error: 'invalid_batteryCapacity' });
  }
  if (!Number.isFinite(sortOrder)) {
    return res.status(400).json({ error: 'invalid_sortOrder' });
  }
  // Zusatzangaben (#45): Kennzeichen, Erstzulassung, Kauf, Intervalle, Versicherung, Steuer, Reifen
  const extras = parseVehicleExtras(req.body);
  if (extras.error) return res.status(400).json({ error: extras.error });

  try {
    // Tarifgrenze (nur aktiv mit PLAN_LIMITS_ENABLED=true). Herabstufen löscht nichts, es verhindert nur neue Fahrzeuge.
    const u = await pool.query(
      `SELECT plan, plan_until, (SELECT COUNT(*)::int FROM vehicles WHERE user_id = $1) AS vehicle_count
       FROM users WHERE id = $1`,
      [req.user.sub]
    );
    const konto = u.rows[0] || { plan: 'free', vehicle_count: 0 };
    const maxVehicles = plans.limitOf(konto, 'maxVehicles');
    if (maxVehicles !== null && konto.vehicle_count >= maxVehicles) {
      return plans.planRequired(res, 'maxVehicles', { limit: maxVehicles, plan: plans.effectivePlan(konto) });
    }

    const r = await pool.query(
      `INSERT INTO vehicles (
         user_id, name, fuel_type, brand, model, year, image_url,
         odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, name, fuel_type, brand, model, year, image_url,
                 odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order, ${VEHICLE_EXTRA_COLUMNS},
                 created_at, updated_at`,
      [req.user.sub, name, fuelType, brand, model, year, imageUrl, odometerKm, mileageKm, tankCapacity, batteryCapacity, sortOrder]
    );
    const cols = Object.keys(extras.values);
    if (cols.length) {
      const u2 = await pool.query(
        `UPDATE vehicles SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND user_id = $2
         RETURNING id, name, fuel_type, brand, model, year, image_url,
                   odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order, ${VEHICLE_EXTRA_COLUMNS},
                   created_at, updated_at`,
        [r.rows[0].id, req.user.sub, ...cols.map((c) => extras.values[c])]
      );
      return res.status(201).json(u2.rows[0]);
    }
    res.status(201).json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// List vehicles
app.get('/api/v1/vehicles', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, fuel_type, brand, model, year, image_url,
              odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order, ${VEHICLE_EXTRA_COLUMNS},
              created_at, updated_at
       FROM vehicles
       WHERE user_id = $1
       ORDER BY sort_order ASC, created_at DESC`,
      [req.user.sub]
    );
    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

// Get single vehicle with details
app.get('/api/v1/vehicles/:vehicleId', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();

  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  try {
    const r = await pool.query(
      `SELECT
         id,
         name,
         fuel_type,
         brand,
         model,
         year,
         image_url,
         odometer_km,
         mileage_km,
         tank_capacity,
         battery_capacity,
         sort_order,
         ${VEHICLE_EXTRA_COLUMNS},
         created_at,
         updated_at
       FROM vehicles
       WHERE id = $1 AND user_id = $2`,
      [vehicleId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Update vehicle (partial)
app.patch('/api/v1/vehicles/:vehicleId', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  let name =
    req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
  let fuelType =
    req.body?.fuelType !== undefined
      ? String(req.body.fuelType).trim().toLowerCase()
      : undefined;
  const brand = optionalText(req.body?.brand);
  const model = optionalText(req.body?.model);
  const year = optionalNumber(req.body?.year);
  const imageUrl = media.normalizeInput(optionalText(req.body?.imageUrl));
  const odometerKm = optionalNumber(req.body?.odometerKm);
  const mileageKm = optionalNumber(req.body?.mileageKm);
  const tankCapacity = optionalNumber(req.body?.tankCapacity);
  const batteryCapacity = optionalNumber(req.body?.batteryCapacity);
  const sortOrder =
    req.body?.sortOrder !== undefined ? Number(req.body.sortOrder) : undefined;

  if (name !== undefined && !name) {
    return res.status(400).json({ error: 'invalid_name' });
  }
  if (fuelType !== undefined && !FUEL_TYPES.has(fuelType)) {
    return res.status(400).json({ error: 'invalid_fuelType' });
  }
  if (year !== undefined && year !== null && (!Number.isFinite(year) || year < 1886 || year > 2100)) {
    return res.status(400).json({ error: 'invalid_year' });
  }
  if (odometerKm !== undefined && odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
    return res.status(400).json({ error: 'invalid_odometerKm' });
  }
  if (mileageKm !== undefined && mileageKm !== null && (!Number.isFinite(mileageKm) || mileageKm < 0)) {
    return res.status(400).json({ error: 'invalid_mileageKm' });
  }
  if (tankCapacity !== undefined && tankCapacity !== null && (!Number.isFinite(tankCapacity) || tankCapacity <= 0)) {
    return res.status(400).json({ error: 'invalid_tankCapacity' });
  }
  if (batteryCapacity !== undefined && batteryCapacity !== null && (!Number.isFinite(batteryCapacity) || batteryCapacity <= 0)) {
    return res.status(400).json({ error: 'invalid_batteryCapacity' });
  }
  if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
    return res.status(400).json({ error: 'invalid_sortOrder' });
  }
  const extras = parseVehicleExtras(req.body);
  if (extras.error) return res.status(400).json({ error: extras.error });

  if (
    Object.keys(extras.values).length === 0 &&
    name === undefined &&
    fuelType === undefined &&
    brand === undefined &&
    model === undefined &&
    year === undefined &&
    imageUrl === undefined &&
    odometerKm === undefined &&
    mileageKm === undefined &&
    tankCapacity === undefined &&
    batteryCapacity === undefined &&
    sortOrder === undefined
  ) {
    return res.status(400).json({ error: 'nothing_to_update' });
  }

  try {
    // Sicherstellen, dass das Fahrzeug dem User gehört
    const existing = await pool.query(
      'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    // Dynamisches Update je nach gesendeten Feldern
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(name);
    }
    if (fuelType !== undefined) {
      fields.push(`fuel_type = $${idx++}`);
      values.push(fuelType);
    }
    if (brand !== undefined) {
      fields.push(`brand = $${idx++}`);
      values.push(brand);
    }
    if (model !== undefined) {
      fields.push(`model = $${idx++}`);
      values.push(model);
    }
    if (year !== undefined) {
      fields.push(`year = $${idx++}`);
      values.push(year);
    }
    if (imageUrl !== undefined) {
      fields.push(`image_url = $${idx++}`);
      values.push(imageUrl);
    }
    if (odometerKm !== undefined) {
      fields.push(`odometer_km = $${idx++}`);
      values.push(odometerKm);
    }
    if (mileageKm !== undefined) {
      fields.push(`mileage_km = $${idx++}`);
      values.push(mileageKm);
    }
    if (tankCapacity !== undefined) {
      fields.push(`tank_capacity = $${idx++}`);
      values.push(tankCapacity);
    }
    if (batteryCapacity !== undefined) {
      fields.push(`battery_capacity = $${idx++}`);
      values.push(batteryCapacity);
    }
    if (sortOrder !== undefined) {
      fields.push(`sort_order = $${idx++}`);
      values.push(sortOrder);
    }
    for (const [col, value] of Object.entries(extras.values)) {
      fields.push(`${col} = $${idx++}`);
      values.push(value);
    }

    fields.push(`updated_at = now()`);
    values.push(vehicleId);
    values.push(req.user.sub);

    const r = await pool.query(
      `UPDATE vehicles
       SET ${fields.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id, name, fuel_type, brand, model, year, image_url,
                 odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order, ${VEHICLE_EXTRA_COLUMNS},
                 created_at, updated_at`,
      values
    );

    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Delete vehicle
app.delete('/api/v1/vehicles/:vehicleId', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  try {
    const r = await pool.query(
      'DELETE FROM vehicles WHERE id = $1 AND user_id = $2 RETURNING id',
      [vehicleId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    // 204 No Content, keine Response-Payload nötig
    return res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

// Add fillup (generalisiert: amount + unit)
app.post('/api/v1/fillups', auth, async (req, res) => {
  const vehicleId = String(req.body?.vehicleId || '').trim();
  // Tachostand darf fehlen (#41) und später nachgetragen werden; geschätzte Werte sind nur Platzhalter
  const odometerKm = optionalNumber(req.body?.odometerKm) ?? null;
  const odometerEstimated = odometerKm !== null && req.body?.odometerEstimated === true;

  // Backward-compatible: akzeptiere liters ODER amount
  const amount = Number(req.body?.amount ?? req.body?.liters);
  const totalCostEur = Number(req.body?.totalCostEur ?? req.body?.priceTotalEur);

  const station = req.body?.station ? String(req.body.station).trim() : null;
  const filledAt = req.body?.filledAt ? new Date(req.body.filledAt) : null;
  const isFull = req.body?.isFull !== undefined ? Boolean(req.body.isFull) : true;
  const skipPrevious = req.body?.skipPrevious !== undefined ? Boolean(req.body.skipPrevious) : false;

  // unit optional: wenn nicht gesetzt, wird es aus vehicle.fuel_type abgeleitet
  let unit = req.body?.unit ? String(req.body.unit).trim().toLowerCase() : null;

  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) return res.status(400).json({ error: 'invalid_odometerKm' });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'invalid_amount' });
  if (!Number.isFinite(totalCostEur) || totalCostEur < 0) return res.status(400).json({ error: 'invalid_totalCostEur' });
  if (filledAt && Number.isNaN(filledAt.getTime())) return res.status(400).json({ error: 'invalid_filledAt' });

  const allowedUnits = new Set(['l', 'kwh', 'kg']);

  try {
    // ownership + fuel_type
    const v = await pool.query(
      'SELECT fuel_type FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });

    const fuelType = String(v.rows[0].fuel_type || '').toLowerCase();

    if (!unit) unit = unitForFuelType(fuelType);
    if (!allowedUnits.has(unit)) return res.status(400).json({ error: 'invalid_unit' });
    // Plug-in-Hybrid: Liter (getankt) oder kWh (geladen), nichts anderes
    if (fuelType === 'phev' && !unitsForFuelType(fuelType).includes(unit)) return res.status(400).json({ error: 'invalid_unit' });

    const r = await pool.query(
      `INSERT INTO fillups (
         user_id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         is_full,
         skip_previous,
         odometer_estimated
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::numeric,
         $5,
         $6::numeric,
         CASE
           WHEN $4::numeric > 0
             THEN ROUND(($6::numeric / $4::numeric), 4)
           ELSE NULL
         END,
         $7,
         COALESCE($8, now()),
         $9,
         $10,
         $11
       )
       RETURNING id, vehicle_id, odometer_km, amount, unit, total_cost_eur, price_per_unit, station, filled_at, created_at, is_full, skip_previous, odometer_estimated`,
      [req.user.sub, vehicleId, odometerKm === null ? null : Math.round(odometerKm), amount, unit, totalCostEur, station, filledAt, isFull, skipPrevious, odometerEstimated]
    );

    // Unplausibler Tachostand: speichern, aber warnen (#51)
    res.status(201).json({ ...r.rows[0], warnings: await checkOdometer(pool, req.user.sub, vehicleId, r.rows[0]) });
  } catch (e) {
    serverError(res, e);
  }
});

// Get single fillup by id
app.get('/api/v1/fillups/:fillupId', auth, async (req, res) => {
  const fillupId = String(req.params.fillupId || '').trim();

  if (!fillupId) return res.status(400).json({ error: 'missing_fillupId' });

  try {
    const r = await pool.query(
      `SELECT
         id,
         user_id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         created_at,
         is_full,
         skip_previous,
         odometer_estimated
       FROM fillups
       WHERE id = $1 AND user_id = $2`,
      [fillupId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'fillup_not_found' });
    }

    const row = r.rows[0];

    // Für ältere Clients zusätzlich kompatible Felder anbieten
    const legacy = {
      liters: row.unit === 'l' ? row.amount : null,
      price_total_eur: row.total_cost_eur,
      price_per_liter: row.unit === 'l' ? row.price_per_unit : null
    };

    res.json({ ...row, ...legacy });
  } catch (e) {
    serverError(res, e);
  }
});

// Update fillup (partial, 14-Tage-Bearbeitungsfenster ab filled_at)
app.patch('/api/v1/fillups/:fillupId', auth, async (req, res) => {
  const fillupId = String(req.params.fillupId || '').trim();

  if (!fillupId) return res.status(400).json({ error: 'missing_fillupId' });

  try {
    // Bestehenden Datensatz laden + Besitz prüfen
    const existingRes = await pool.query(
      `SELECT
         id,
         user_id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         created_at,
         is_full,
         skip_previous,
         odometer_estimated
       FROM fillups
       WHERE id = $1 AND user_id = $2`,
      [fillupId, req.user.sub]
    );

    if (existingRes.rowCount === 0) {
      return res.status(404).json({ error: 'fillup_not_found' });
    }

    const existing = existingRes.rows[0];

    // Eingehende Änderungen parsen (teilweise, optional)
    const body = req.body || {};

    // 14 Tage Änderungsfenster ab filled_at. Ausnahme (#41): nur den Tachostand nachtragen ist immer möglich.
    const nurTachostand = Object.keys(body).length > 0 &&
      Object.keys(body).every(k => k === 'odometerKm' || k === 'odometerEstimated');
    const now = new Date();
    const filledAtOriginal = new Date(existing.filled_at);
    const diffMs = now.getTime() - filledAtOriginal.getTime();
    const maxMs = 14 * 24 * 60 * 60 * 1000; // 14 Tage

    if (diffMs > maxMs && !nurTachostand) {
      return res.status(409).json({
        error: 'fillup_edit_window_expired',
        message:
          'Tank-/Ladevorgänge können nur innerhalb von 14 Tagen nach dem Tank-/Ladedatum bearbeitet werden.'
      });
    }

    // null bzw. leer: Tachostand entfernen (fehlt)
    const patchOdometerKm = optionalNumber(body.odometerKm);
    const patchOdometerEstimated =
      body.odometerEstimated !== undefined ? body.odometerEstimated === true : undefined;

    // Backward-kompatibel: amount oder liters
    const rawAmount =
      body.amount !== undefined ? body.amount : body.liters !== undefined ? body.liters : undefined;
    const patchAmount =
      rawAmount !== undefined ? Number(rawAmount) : undefined;

    // Backward-kompatibel: totalCostEur oder priceTotalEur
    const rawTotal =
      body.totalCostEur !== undefined
        ? body.totalCostEur
        : body.priceTotalEur !== undefined
        ? body.priceTotalEur
        : undefined;
    const patchTotalCostEur =
      rawTotal !== undefined ? Number(rawTotal) : undefined;

    const patchUnit =
      body.unit !== undefined ? String(body.unit).trim().toLowerCase() : undefined;

    const patchStation =
      body.station !== undefined ? String(body.station).trim() : undefined;

    const patchFilledAt =
      body.filledAt !== undefined ? new Date(body.filledAt) : undefined;

    const patchIsFull =
      body.isFull !== undefined ? Boolean(body.isFull) : undefined;

    const patchSkipPrevious =
      body.skipPrevious !== undefined ? Boolean(body.skipPrevious) : undefined;

    // Wenn nichts Sinnvolles geändert werden soll
    if (
      patchOdometerKm === undefined &&
      patchAmount === undefined &&
      patchTotalCostEur === undefined &&
      patchUnit === undefined &&
      patchStation === undefined &&
      patchFilledAt === undefined &&
      patchIsFull === undefined &&
      patchSkipPrevious === undefined &&
      patchOdometerEstimated === undefined
    ) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }

    // Zielwerte (bestehend oder gepatcht)
    const newOdometerKm =
      patchOdometerKm !== undefined ? patchOdometerKm : existing.odometer_km;
    // numeric-Spalten kommen von pg als Text ("30.000"); für die Prüfung unten in Zahlen umwandeln
    const newAmount =
      patchAmount !== undefined ? patchAmount : Number(existing.amount);
    const newTotalCostEur =
      patchTotalCostEur !== undefined ? patchTotalCostEur : Number(existing.total_cost_eur);
    const newUnit =
      patchUnit !== undefined ? patchUnit : existing.unit;
    const newStation =
      patchStation !== undefined ? patchStation : existing.station;
    const newFilledAt =
      patchFilledAt !== undefined ? patchFilledAt : new Date(existing.filled_at);
    const newIsFull =
      patchIsFull !== undefined ? patchIsFull : existing.is_full;
    const newSkipPrevious =
      patchSkipPrevious !== undefined ? patchSkipPrevious : existing.skip_previous;
    // Ein neu eingetragener Tachostand gilt als echt, außer es wird ausdrücklich "geschätzt" mitgeschickt
    const newOdometerEstimated = newOdometerKm === null ? false
      : patchOdometerEstimated !== undefined ? patchOdometerEstimated
      : patchOdometerKm !== undefined ? false
      : existing.odometer_estimated;

    // Validierungen auf Zielwerten
    if (newOdometerKm !== null && (!Number.isFinite(newOdometerKm) || newOdometerKm < 0)) {
      return res.status(400).json({ error: 'invalid_odometerKm' });
    }
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }
    if (!Number.isFinite(newTotalCostEur) || newTotalCostEur < 0) {
      return res.status(400).json({ error: 'invalid_totalCostEur' });
    }
    if (Number.isNaN(newFilledAt.getTime())) {
      return res.status(400).json({ error: 'invalid_filledAt' });
    }

    const allowedUnits = new Set(['l', 'kwh', 'kg']);
    if (!newUnit || !allowedUnits.has(newUnit)) {
      return res.status(400).json({ error: 'invalid_unit' });
    }

    const updateRes = await pool.query(
      `UPDATE fillups
       SET
         odometer_km   = $1,
         amount        = $2::numeric,
         unit          = $3,
         total_cost_eur = $4::numeric,
         price_per_unit = CASE
           WHEN $2::numeric > 0
             THEN ROUND(($4::numeric / $2::numeric), 4)
           ELSE NULL
         END,
         station       = $5,
         filled_at     = $6,
         is_full       = $7,
         skip_previous = $8,
         odometer_estimated = $11
       WHERE id = $9 AND user_id = $10
       RETURNING
         id,
         user_id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         created_at,
         is_full,
         skip_previous,
         odometer_estimated`,
      [
        newOdometerKm === null ? null : Math.round(newOdometerKm),
        newAmount,
        newUnit,
        newTotalCostEur,
        newStation,
        newFilledAt,
        newIsFull,
        newSkipPrevious,
        fillupId,
        req.user.sub,
        newOdometerEstimated
      ]
    );

    const updated = updateRes.rows[0];

    const legacy = {
      liters: updated.unit === 'l' ? updated.amount : null,
      price_total_eur: updated.total_cost_eur,
      price_per_liter: updated.unit === 'l' ? updated.price_per_unit : null
    };

    res.json({ ...updated, ...legacy, warnings: await checkOdometer(pool, req.user.sub, updated.vehicle_id, updated) });
  } catch (e) {
    serverError(res, e);
  }
});

// Delete fillup (immer möglich; bei >14 Tagen wird nächster Fillup auf skip_previous=true gesetzt)
app.delete('/api/v1/fillups/:fillupId', auth, async (req, res) => {
  const fillupId = String(req.params.fillupId || '').trim();
  if (!fillupId) return res.status(400).json({ error: 'missing_fillupId' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Zu löschenden Fillup laden + Besitz prüfen
    const existingRes = await client.query(
      `SELECT
         id,
         user_id,
         vehicle_id,
         odometer_km,
         filled_at
       FROM fillups
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [fillupId, req.user.sub]
    );

    if (existingRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'fillup_not_found' });
    }

    const existing = existingRes.rows[0];
    const filledAt = new Date(existing.filled_at);
    const now = new Date();
    const diffMs = now.getTime() - filledAt.getTime();
    const maxMs = 14 * 24 * 60 * 60 * 1000; // 14 Tage
    const olderThan14Days = diffMs > maxMs;

    // Fillup löschen
    await client.query(
      'DELETE FROM fillups WHERE id = $1 AND user_id = $2',
      [fillupId, req.user.sub]
    );

    let nextUpdated = false;

    if (olderThan14Days) {
      // Nächsten Fillup anhand filled_at finden und skip_previous = true setzen
      const nextRes = await client.query(
        `SELECT id
         FROM fillups
         WHERE user_id = $1
           AND vehicle_id = $2
           AND filled_at > $3
         ORDER BY filled_at ASC
         LIMIT 1`,
        [req.user.sub, existing.vehicle_id, filledAt]
      );

      if (nextRes.rowCount === 1) {
        const nextId = nextRes.rows[0].id;
        await client.query(
          `UPDATE fillups
           SET skip_previous = true
           WHERE id = $1 AND user_id = $2`,
          [nextId, req.user.sub]
        );
        nextUpdated = true;
      }
    }

    await client.query('COMMIT');

    return res.status(200).json({
      deletedId: existing.id,
      olderThan14Days,
      nextUpdated,
      message: olderThan14Days
        ? 'Ein Tank-/Ladevorgang, der älter als 14 Tage ist, wurde gelöscht. Der nachfolgende Vorgang wird bei der Verbrauchsberechnung nicht mehr den vorherigen berücksichtigen (skip_previous = true).'
        : 'Tank-/Ladevorgang wurde gelöscht.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// List fillups by vehicle
app.get('/api/v1/vehicles/:vehicleId/fillups', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const offset = Math.max(0, Math.floor(Number(req.query.offset || 0)) || 0);

  try {
    const v = await pool.query('SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, req.user.sub]);
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });

    const r = await pool.query(
      `SELECT
         id,
         odometer_km,
         amount,
         unit,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         created_at,
         is_full,
         skip_previous,
         odometer_estimated
       FROM fillups
       WHERE user_id = $1 AND vehicle_id = $2
       ORDER BY filled_at DESC, created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.user.sub, vehicleId, limit, offset]
    );

    // Für ältere Clients zusätzlich kompatible Felder anbieten
    res.json(r.rows.map((row) => ({
      ...row,
      liters: row.unit === 'l' ? row.amount : null,
      price_total_eur: row.total_cost_eur,
      price_per_liter: row.unit === 'l' ? row.price_per_unit : null
    })));
  } catch (e) {
    serverError(res, e);
  }
});

// Benutzer mit Tarif (für Kategorie-Prüfungen)
async function loadPlanUser(db, userId) {
  const r = await db.query('SELECT id, plan, plan_until FROM users WHERE id = $1', [userId]);
  return r.rows[0] || { id: userId, plan: 'free', plan_until: null };
}

// Kategorien (#95): feste Kategorien mit Tarif-Kennzeichen plus eigene Kategorien des Benutzers.
// Clients dürfen die Antwort kurz zwischenspeichern (ETag für die erneute Abfrage).
app.get('/api/v1/categories', auth, async (req, res) => {
  try {
    const user = await loadPlanUser(pool, req.user.sub);
    const body = await categories.listForUser(pool, user);
    const etag = '"' + createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27) + '"';
    res.set('Cache-Control', 'private, max-age=300');
    res.set('ETag', etag);
    if (req.get('If-None-Match') === etag) return res.status(304).end();
    res.json(body);
  } catch (e) {
    serverError(res, e);
  }
});

// Eigene Kategorie anlegen (nur mit Tarif-Recht customCategories, höchstens customCategories Stück)
app.post('/api/v1/categories', auth, async (req, res) => {
  const v = categories.validateCustomInput(req.body || {});
  if (v.error) return res.status(400).json(v);
  try {
    const user = await loadPlanUser(pool, req.user.sub);
    const max = plans.limitOf(user, 'customCategories') ?? 0;
    if (max <= 0) return plans.planRequired(res, 'customCategories', { limit: 0, plan: plans.effectivePlan(user) });
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM expense_categories WHERE user_id = $1', [req.user.sub]);
    if (count.rows[0].n >= max) return res.status(403).json({ error: 'category_limit_reached', limit: max });
    const r = await pool.query(
      `INSERT INTO expense_categories (user_id, name, icon, color, group_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, icon, color, group_key`,
      [req.user.sub, v.value.name, v.value.icon, v.value.color, v.value.group]
    );
    res.status(201).json(categories.customToApi(r.rows[0], true));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'name_taken' });
    serverError(res, e);
  }
});

// Eigene Kategorie ändern (Name, Icon, Farbe, Gruppe). Auch nach dem Herabstufen erlaubt: es entsteht nichts Neues.
app.patch('/api/v1/categories/:categoryId', auth, async (req, res) => {
  const v = categories.validateCustomInput(req.body || {}, true);
  if (v.error) return res.status(400).json(v);
  const cols = { name: 'name', icon: 'icon', color: 'color', group: 'group_key' };
  const fields = [];
  const values = [];
  for (const [k, col] of Object.entries(cols)) {
    if (v.value[k] !== undefined) { values.push(v.value[k]); fields.push(`${col} = $${values.length}`); }
  }
  if (fields.length === 0) return res.status(400).json({ error: 'nothing_to_update' });
  try {
    values.push(String(req.params.categoryId || '').trim(), req.user.sub);
    const r = await pool.query(
      `UPDATE expense_categories SET ${fields.join(', ')}, updated_at = now()
       WHERE id::text = $${values.length - 1} AND user_id = $${values.length}
       RETURNING id, name, icon, color, group_key`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'category_not_found' });
    const user = await loadPlanUser(pool, req.user.sub);
    res.json(categories.customToApi(r.rows[0], (plans.limitOf(user, 'customCategories') ?? 0) > 0));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'name_taken' });
    serverError(res, e);
  }
});

// Eigene Kategorie löschen. Hängen noch Ausgaben daran, muss ?moveTo=<Schlüssel> sagen, wohin sie wandern.
app.delete('/api/v1/categories/:categoryId', auth, async (req, res) => {
  const id = String(req.params.categoryId || '').trim();
  const moveTo = req.query.moveTo ? String(req.query.moveTo).trim() : '';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query('SELECT id FROM expense_categories WHERE id::text = $1 AND user_id = $2 FOR UPDATE', [id, req.user.sub]);
    if (c.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'category_not_found' }); }
    const key = categories.customKey(c.rows[0].id);
    const used = await client.query('SELECT COUNT(*)::int AS n FROM expenses WHERE user_id = $1 AND category = $2', [req.user.sub, key]);
    const n = used.rows[0].n;
    if (n > 0) {
      const ziel = categories.BUILTIN_BY_KEY[moveTo];
      if (!moveTo) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'category_in_use', entries: n }); }
      if (moveTo === key || (ziel && ziel.form !== 'expense')) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'invalid_moveTo' }); }
      const fehler = await categories.checkUsable(client, await loadPlanUser(client, req.user.sub), moveTo);
      if (fehler) {
        await client.query('ROLLBACK');
        return res.status(fehler.status).json(fehler.status === 403 ? fehler.body : { error: 'invalid_moveTo', category: moveTo });
      }
      await client.query('UPDATE expenses SET category = $3 WHERE user_id = $1 AND category = $2', [req.user.sub, key, moveTo]);
    }
    await client.query('DELETE FROM expense_categories WHERE id = $1', [c.rows[0].id]);
    await client.query('COMMIT');
    res.json({ deleted: key, moved: n, moveTo: n > 0 ? moveTo : null });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, e);
  } finally {
    client.release();
  }
});

// Create non-fuel expense entry
app.post('/api/v1/entries', auth, async (req, res) => {
  const vehicleId = String(req.body?.vehicleId || '').trim();
  const category = String(req.body?.category || '').trim();

  const amountEur = Number(req.body?.amountEur);
  // null bzw. leer = kein Tachostand (nicht 0 km)
  const odometerKm = optionalNumber(req.body?.odometerKm) ?? null;
  const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;

  const vendor = req.body?.vendor ? String(req.body.vendor).trim() : null;
  const description = req.body?.description ? String(req.body.description).trim() : null;

  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });
  if (!category) return res.status(400).json({ error: 'missing_category' });
  if (!Number.isFinite(amountEur) || amountEur < 0) {
    return res.status(400).json({ error: 'invalid_amountEur' });
  }
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
    return res.status(400).json({ error: 'invalid_odometerKm' });
  }
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    return res.status(400).json({ error: 'invalid_occurredAt' });
  }

  try {
    // Prüfen, ob das Fahrzeug zum User gehört
    const v = await pool.query(
      'SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });

    // Kategorie bekannt und im Tarif enthalten? (#95)
    const fehler = await categories.checkUsable(pool, await loadPlanUser(pool, req.user.sub), category);
    if (fehler) return res.status(fehler.status).json(fehler.body);

    const r = await pool.query(
      `INSERT INTO expenses (
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::numeric,
         $5,
         COALESCE($6, now()),
         $7,
         $8
       )
       RETURNING
         id,
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description,
         created_at`,
      [req.user.sub, vehicleId, category, amountEur, odometerKm, occurredAt, vendor, description]
    );

    res.status(201).json({ ...r.rows[0], warnings: await checkOdometer(pool, req.user.sub, vehicleId, r.rows[0]) });
  } catch (e) {
    serverError(res, e);
  }
});

// List expense entries by vehicle
const ENTRY_COLUMNS = `
  id,
  user_id,
  vehicle_id,
  category,
  amount_eur,
  odometer_km,
  occurred_at,
  vendor,
  description,
  created_at`;

// Get single entry (expense)
app.get('/api/v1/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  try {
    const r = await pool.query(
      `SELECT ${ENTRY_COLUMNS} FROM expenses WHERE id = $1 AND user_id = $2`,
      [entryId, req.user.sub]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'entry_not_found' });
    res.json({ ...r.rows[0], warnings: await checkOdometer(pool, req.user.sub, r.rows[0].vehicle_id, r.rows[0]) });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

// Patch single entry (expense)
app.patch('/api/v1/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  const body = req.body || {};
  const fields = [];
  const values = [];
  let idx = 1;

  if (body.category !== undefined) {
    const category = String(body.category).trim();
    if (!category) return res.status(400).json({ error: 'missing_category' });
    fields.push(`category = $${idx++}`);
    values.push(category);
  }
  if (body.amountEur !== undefined) {
    const amountEur = Number(body.amountEur);
    if (!Number.isFinite(amountEur) || amountEur < 0) return res.status(400).json({ error: 'invalid_amountEur' });
    fields.push(`amount_eur = $${idx++}`);
    values.push(amountEur);
  }
  if (body.odometerKm !== undefined) {
    const odometerKm = body.odometerKm === null || body.odometerKm === '' ? null : Number(body.odometerKm);
    if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
      return res.status(400).json({ error: 'invalid_odometerKm' });
    }
    fields.push(`odometer_km = $${idx++}`);
    values.push(odometerKm);
  }
  if (body.occurredAt !== undefined) {
    const occurredAt = new Date(body.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return res.status(400).json({ error: 'invalid_occurredAt' });
    fields.push(`occurred_at = $${idx++}`);
    values.push(occurredAt);
  }
  if (body.vendor !== undefined) {
    fields.push(`vendor = $${idx++}`);
    values.push(body.vendor === null ? null : String(body.vendor).trim() || null);
  }
  if (body.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(body.description === null ? null : String(body.description).trim() || null);
  }

  if (fields.length === 0) return res.status(400).json({ error: 'nothing_to_update' });

  try {
    // Neue Kategorie prüfen; die bisherige bleibt immer erlaubt (auch nach dem Herabstufen oder aus alten Importen)
    if (body.category !== undefined) {
      const alt = await pool.query('SELECT category FROM expenses WHERE id = $1 AND user_id = $2', [entryId, req.user.sub]);
      if (alt.rowCount === 0) return res.status(404).json({ error: 'entry_not_found' });
      const neu = String(body.category).trim();
      if (alt.rows[0].category !== neu) {
        const fehler = await categories.checkUsable(pool, await loadPlanUser(pool, req.user.sub), neu);
        if (fehler) return res.status(fehler.status).json(fehler.body);
      }
    }
    values.push(entryId, req.user.sub);
    const r = await pool.query(
      `UPDATE expenses SET ${fields.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING ${ENTRY_COLUMNS}`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'entry_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

// Delete single entry (expense)
app.delete('/api/v1/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  try {
    const r = await pool.query(
      'DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id',
      [entryId, req.user.sub]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'entry_not_found' });
    res.status(204).send();
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

app.get('/api/v1/vehicles/:vehicleId/entries', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const offset = Math.max(0, Math.floor(Number(req.query.offset || 0)) || 0);

  try {
    // Fahrzeug-Besitz prüfen
    const v = await pool.query(
      'SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });

    const r = await pool.query(
      `SELECT
         id,
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description,
         created_at
       FROM expenses
       WHERE user_id = $1 AND vehicle_id = $2
       ORDER BY occurred_at DESC, created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.user.sub, vehicleId, limit, offset]
    );

    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

// Massen-Import (z. B. aus CSV): alle Zeilen in einer Transaktion, Duplikate werden übersprungen
app.post('/api/v1/vehicles/:vehicleId/import', auth, importLimiter, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  const fillups = Array.isArray(req.body?.fillups) ? req.body.fillups : [];
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

  if (fillups.length + entries.length === 0) return res.status(400).json({ error: 'nothing_to_import' });
  if (fillups.length + entries.length > 1000) return res.status(400).json({ error: 'too_many_rows', max: 1000 });

  // Validierung vorab: bei Fehlern wird nichts importiert
  const errors = [];
  const validDate = (v) => v && !Number.isNaN(new Date(v).getTime());
  const nonNegative = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;
  fillups.forEach((f, index) => {
    if (!validDate(f?.filledAt)) errors.push({ type: 'fillup', index, error: 'invalid_filledAt' });
    // Tachostand darf fehlen (#41)
    else if (f?.odometerKm !== undefined && f?.odometerKm !== null && f?.odometerKm !== '' && !nonNegative(f.odometerKm)) {
      errors.push({ type: 'fillup', index, error: 'invalid_odometerKm' });
    }
    else if (!nonNegative(f?.amount)) errors.push({ type: 'fillup', index, error: 'invalid_amount' });
    else if (!nonNegative(f?.totalCostEur)) errors.push({ type: 'fillup', index, error: 'invalid_totalCostEur' });
  });
  entries.forEach((e, index) => {
    if (!validDate(e?.occurredAt)) errors.push({ type: 'entry', index, error: 'invalid_occurredAt' });
    else if (!String(e?.category || '').trim()) errors.push({ type: 'entry', index, error: 'missing_category' });
    else if (!nonNegative(e?.amountEur)) errors.push({ type: 'entry', index, error: 'invalid_amountEur' });
    else if (e?.odometerKm !== undefined && e?.odometerKm !== null && e?.odometerKm !== '' && !nonNegative(e.odometerKm)) {
      errors.push({ type: 'entry', index, error: 'invalid_odometerKm' });
    }
  });
  // Kategorien prüfen (#95): nur bekannte und im Tarif enthaltene; Clients ordnen Unbekanntes vorher zu (z. B. "Sonstiges")
  if (errors.length === 0 && entries.length > 0) {
    try {
      const user = await loadPlanUser(pool, req.user.sub);
      const geprueft = new Map();
      for (const [index, e] of entries.entries()) {
        const key = String(e.category).trim();
        if (!geprueft.has(key)) geprueft.set(key, await categories.checkUsable(pool, user, key));
        const fehler = geprueft.get(key);
        if (fehler) errors.push({ type: 'entry', index, error: fehler.body.error, category: key, ...(fehler.body.feature ? { feature: fehler.body.feature } : {}) });
      }
    } catch (e) {
      return serverError(res, e);
    }
  }
  if (errors.length) return res.status(400).json({ error: 'invalid_rows', rows: errors.slice(0, 50) });

  const client = await pool.connect();
  try {
    const v = await client.query('SELECT fuel_type FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, req.user.sub]);
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });
    // Einheit je Zeile nur, wo das Fahrzeug mehrere kennt (Plug-in-Hybrid: l und kWh), sonst immer die des Fahrzeugs
    const units = unitsForFuelType(v.rows[0].fuel_type);
    const unitOf = (f) => {
      const u = f.unit ? String(f.unit).trim().toLowerCase() : '';
      return units.includes(u) ? u : units[0];
    };

    // dryRun: alles prüfen und in der Transaktion anlegen, dann zurückrollen (Vorschau mit Duplikaten und Warnungen)
    const dryRun = req.body?.dryRun === true;
    await client.query('BEGIN');
    const result = { imported: { fillups: 0, entries: 0 }, skipped: { fillups: 0, entries: 0 }, duplicates: [], warnings: [] };
    const inserted = []; // { type, index, id, at, km }

    for (const [index, f] of fillups.entries()) {
      const filledAt = new Date(f.filledAt);
      const unit = unitOf(f);
      const odo = f.odometerKm === undefined || f.odometerKm === null || f.odometerKm === '' ? null : Math.round(Number(f.odometerKm));
      // Duplikat: gleicher Tag, gleicher Tachostand und gleiche Einheit (Tanken und Laden am selben Abend sind zwei Einträge);
      // ohne Tachostand zusätzlich gleiche Menge
      const dup = await client.query(
        `SELECT 1 FROM fillups
         WHERE vehicle_id = $1 AND user_id = $2 AND odometer_km IS NOT DISTINCT FROM $3::int AND filled_at::date = $4::date AND unit = $5
           AND ($3::int IS NOT NULL OR amount = $6::numeric)`,
        [vehicleId, req.user.sub, odo, filledAt, unit, Number(f.amount)]
      );
      if (dup.rowCount > 0) { result.skipped.fillups++; result.duplicates.push({ type: 'fillup', index }); continue; }
      const ins = await client.query(
        `INSERT INTO fillups (user_id, vehicle_id, odometer_km, amount, unit, total_cost_eur, price_per_unit, station, filled_at, is_full, skip_previous)
         VALUES ($1, $2, $3, $4::numeric, $5, $6::numeric,
                 CASE WHEN $4::numeric > 0 THEN ROUND($6::numeric / $4::numeric, 4) ELSE NULL END,
                 $7, $8, $9, $10)
         RETURNING id`,
        [
          req.user.sub, vehicleId, odo, Number(f.amount), unit, Number(f.totalCostEur),
          f.station ? String(f.station).trim() : null, filledAt,
          f.isFull !== undefined ? Boolean(f.isFull) : true,
          f.skipPrevious !== undefined ? Boolean(f.skipPrevious) : false
        ]
      );
      result.imported.fillups++;
      inserted.push({ type: 'fillup', index, id: ins.rows[0].id, at: filledAt, km: odo });
    }

    for (const [index, e] of entries.entries()) {
      const occurredAt = new Date(e.occurredAt);
      const category = String(e.category).trim();
      const dup = await client.query(
        `SELECT 1 FROM expenses
         WHERE vehicle_id = $1 AND user_id = $2 AND category = $3 AND amount_eur = $4::numeric AND occurred_at::date = $5::date`,
        [vehicleId, req.user.sub, category, Number(e.amountEur), occurredAt]
      );
      if (dup.rowCount > 0) { result.skipped.entries++; result.duplicates.push({ type: 'entry', index }); continue; }
      const odometerKm = e.odometerKm === undefined || e.odometerKm === null || e.odometerKm === '' ? null : Math.round(Number(e.odometerKm));
      const ins = await client.query(
        `INSERT INTO expenses (user_id, vehicle_id, category, amount_eur, odometer_km, occurred_at, vendor, description)
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8)
         RETURNING id`,
        [
          req.user.sub, vehicleId, category, Number(e.amountEur), odometerKm, occurredAt,
          e.vendor ? String(e.vendor).trim() : null, e.description ? String(e.description).trim() : null
        ]
      );
      result.imported.entries++;
      inserted.push({ type: 'entry', index, id: ins.rows[0].id, at: occurredAt, km: odometerKm });
    }

    // Tachostand-Prüfung (#51) gegen alle Einträge des Fahrzeugs inklusive der neuen Zeilen
    const { points, purchaseKm } = await loadOdometerPoints(client, req.user.sub, vehicleId);
    for (const row of inserted) {
      if (row.km === null) continue;
      const others = points.filter((p) => String(p.id) !== String(row.id));
      for (const w of odometerWarnings(others, { date: row.at, km: row.km }, purchaseKm)) {
        result.warnings.push({ type: row.type, index: row.index, ...w });
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      return res.json({ ...result, dryRun: true });
    }
    await client.query('COMMIT');
    res.status(201).json(result);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '22P02') return res.status(404).json({ error: 'vehicle_not_found' });
    serverError(res, e);
  } finally {
    client.release();
  }
});

// Fälligkeiten (TÜV, Wartung, Versicherung, Steuer) eines Fahrzeugs
app.get('/api/v1/vehicles/:vehicleId/reminders', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  try {
    const v = await pool.query('SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, req.user.sub]);
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });
    const s = await pool.query('SELECT reminder_days FROM user_mail_settings WHERE user_id = $1', [req.user.sub]);
    res.json(await getVehicleReminders(pool, req.user.sub, vehicleId, s.rows[0]?.reminder_days ?? 30));
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'vehicle_not_found' });
    serverError(res, e);
  }
});

// --- E-Mail-Benachrichtigungen (SMTP-Zugang je Benutzer) ---
function mailSettingsResponse(row, defaults) {
  return {
    // Ohne eigenen Server verschickt Fuelstat über den Standard-Mailserver an die Konto-Adresse
    default_available: Boolean(defaults),
    default_from: defaults ? (defaults.from_address || defaults.smtp_user || defaults.account_email) : null,
    uses_default: Boolean(defaults) && !row?.smtp_host,
    smtp_host: row?.smtp_host ?? null,
    smtp_port: row?.smtp_port ?? null,
    smtp_security: row?.smtp_security ?? 'starttls',
    smtp_user: row?.smtp_user ?? null,
    has_password: Boolean(row?.smtp_password_enc),
    from_address: row?.from_address ?? null,
    to_address: row?.to_address ?? null,
    reminders_enabled: row?.reminders_enabled ?? false,
    reminder_days: row?.reminder_days ?? 30,
    monthly_report: row?.monthly_report ?? false,
    last_sent_at: row?.last_sent_at ?? null,
    last_error: row?.last_error ?? null
  };
}

const MAIL_ERROR_CODES = new Set(['mail_not_configured', 'smtp_host_not_allowed']);
function mailErrorResponse(res, e) {
  if (MAIL_ERROR_CODES.has(e.code)) return res.status(400).json({ error: e.code });
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return res.status(400).json({ error: 'smtp_host_not_found' });
  // SMTP-Fehler (Login, TLS, Verbindung) an den Benutzer weitergeben, damit er die Einstellungen korrigieren kann
  return res.status(502).json({ error: 'smtp_failed', detail: e.message });
}

app.get('/api/v1/auth/mail-settings', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM user_mail_settings WHERE user_id = $1', [req.user.sub]);
    res.json(mailSettingsResponse(r.rows[0], await loadDefaultSmtp(pool)));
  } catch (e) {
    serverError(res, e);
  }
});

app.put('/api/v1/auth/mail-settings', auth, async (req, res) => {
  const b = req.body || {};
  const host = optionalText(b.smtpHost) ?? null;
  const port = optionalNumber(b.smtpPort) ?? null;
  const security = b.smtpSecurity === undefined ? 'starttls' : String(b.smtpSecurity);
  // Länge zuerst prüfen (E-Mail max. 254 Zeichen) und Domain ohne überlappende Wiederholung: kein ReDoS
  const emailOk = (v) => v === null || (v.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(v));
  const fromAddress = optionalText(b.fromAddress) ?? null;
  const toAddress = optionalText(b.toAddress) ?? null;
  const reminderDays = optionalNumber(b.reminderDays) ?? 30;

  if (host !== null && (host.length > 253 || !/^[a-z0-9.-]+$/i.test(host))) return res.status(400).json({ error: 'invalid_smtpHost' });
  if (host !== null && !ALLOWED_PORTS.includes(port)) return res.status(400).json({ error: 'invalid_smtpPort', allowed: ALLOWED_PORTS });
  if (!['tls', 'starttls', 'none'].includes(security)) return res.status(400).json({ error: 'invalid_smtpSecurity' });
  if (!emailOk(fromAddress)) return res.status(400).json({ error: 'invalid_fromAddress' });
  if (!emailOk(toAddress)) return res.status(400).json({ error: 'invalid_toAddress' });
  if (!Number.isInteger(reminderDays) || reminderDays < 1 || reminderDays > 180) return res.status(400).json({ error: 'invalid_reminderDays' });

  try {
    const defaults = await loadDefaultSmtp(pool);
    if ((b.remindersEnabled || b.monthlyReport) && host === null && !defaults) return res.status(400).json({ error: 'mail_not_configured' });
    if (host !== null) await resolveSmtpHost(host);

    // Passwort: nur ändern, wenn ein neues gesendet wird; clearPassword löscht es
    let passwordSql = 'smtp_password_enc';
    const values = [req.user.sub, host, host ? port : null, security, optionalText(b.smtpUser) ?? null, fromAddress, toAddress,
      Boolean(b.remindersEnabled), reminderDays, Boolean(b.monthlyReport)];
    if (b.smtpPassword) {
      values.push(encryptSecret(b.smtpPassword));
      passwordSql = `$${values.length}`;
    } else if (b.clearPassword) {
      passwordSql = 'NULL';
    }

    const r = await pool.query(
      `INSERT INTO user_mail_settings (user_id, smtp_host, smtp_port, smtp_security, smtp_user, from_address, to_address,
                                       reminders_enabled, reminder_days, monthly_report, smtp_password_enc)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${passwordSql === 'smtp_password_enc' ? 'NULL' : passwordSql})
       ON CONFLICT (user_id) DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port, smtp_security = EXCLUDED.smtp_security,
         smtp_user = EXCLUDED.smtp_user, from_address = EXCLUDED.from_address, to_address = EXCLUDED.to_address,
         reminders_enabled = EXCLUDED.reminders_enabled, reminder_days = EXCLUDED.reminder_days,
         monthly_report = EXCLUDED.monthly_report,
         smtp_password_enc = ${passwordSql === 'smtp_password_enc' ? 'user_mail_settings.smtp_password_enc' : passwordSql},
         updated_at = now()
       RETURNING *`,
      values
    );
    res.json(mailSettingsResponse(r.rows[0], defaults));
  } catch (e) {
    if (e.code === 'smtp_host_not_allowed' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return mailErrorResponse(res, e);
    serverError(res, e);
  }
});

// Manuelles Senden über den Standard-Mailserver begrenzen (schützt den Server des Betreibers vor Missbrauch)
const MANUAL_DEFAULT_MAILS = 5;
function manualMailLimited(settings, userId) {
  if (!settings?.uses_default) return false;
  const key = `default-mail:${userId}`;
  if (isLockedOut(key, MANUAL_DEFAULT_MAILS)) return true;
  recordFailure(key);
  return false;
}

// Test-Mail mit den gespeicherten Einstellungen
app.post('/api/v1/auth/mail-settings/test', auth, async (req, res) => {
  try {
    const settings = await notifier.loadUserSettings(pool, req.user.sub);
    if (manualMailLimited(settings, req.user.sub)) return tooManyAttempts(res);
    await sendUserMail(settings, {
      subject: 'Fuelstat: Test-Mail',
      text: 'Hallo,\n\ndie E-Mail-Einstellungen in Fuelstat funktionieren.\n\nDeine Fuelstat-App',
      html: '<p>Hallo,</p><p>die E-Mail-Einstellungen in Fuelstat funktionieren.</p><p>Deine Fuelstat-App</p>'
    });
    res.json({ sent: true });
  } catch (e) {
    mailErrorResponse(res, e);
  }
});

// Erinnerungen bzw. Monatsbericht (Vormonat) sofort senden – unabhängig davon, ob sie schon verschickt wurden
app.post('/api/v1/auth/mail-settings/send-now', auth, async (req, res) => {
  const type = String(req.body?.type || '');
  if (!['reminders', 'report'].includes(type)) return res.status(400).json({ error: 'invalid_type' });
  try {
    const settings = await notifier.loadUserSettings(pool, req.user.sub);
    if (manualMailLimited(settings, req.user.sub)) return tooManyAttempts(res);
    if (type === 'reminders') {
      const due = await notifier.collectDueReminders(pool, settings);
      if (due.length === 0) return res.json({ sent: false, reason: 'nothing_due' });
      await sendUserMail(settings, notifier.reminderMail(due));
      return res.json({ sent: true, count: due.length });
    }
    const { year, month } = notifier.previousMonth();
    await sendUserMail(settings, notifier.reportMail(await notifier.buildMonthlyReport(pool, settings, year, month)));
    res.json({ sent: true });
  } catch (e) {
    mailErrorResponse(res, e);
  }
});

// --- Feedback der Benutzer (Beta) ---
const FEEDBACK_CATEGORIES = { fehler: 'Fehler', idee: 'Idee', lob: 'Lob', sonstiges: 'Sonstiges' };
const FEEDBACK_MAX_PER_WINDOW = 10;

/** Empfänger: FEEDBACK_EMAIL, sonst der Empfänger bzw. die Konto-Adresse des Standard-Mailservers */
function feedbackRecipient(defaults) {
  return process.env.FEEDBACK_EMAIL || defaults?.to_address || defaults?.account_email || null;
}

app.post('/api/v1/feedback', auth, async (req, res) => {
  const category = String(req.body?.category || '');
  const message = String(req.body?.message || '').trim();
  const page = optionalText(req.body?.page) ?? null;
  if (!FEEDBACK_CATEGORIES[category]) return res.status(400).json({ error: 'invalid_category' });
  if (message.length < 3 || message.length > 5000) return res.status(400).json({ error: 'invalid_message' });
  if (page !== null && page.length > 300) return res.status(400).json({ error: 'invalid_page' });

  const key = `feedback:${req.user.sub}`;
  if (isLockedOut(key, FEEDBACK_MAX_PER_WINDOW)) return tooManyAttempts(res);
  recordFailure(key);

  try {
    const u = await pool.query('SELECT email, username FROM users WHERE id = $1', [req.user.sub]);
    const user = u.rows[0] || {};
    const userAgent = String(req.get('user-agent') || '').slice(0, 300) || null;
    const r = await pool.query(
      `INSERT INTO feedback (user_id, user_email, category, message, page, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [req.user.sub, user.email || null, category, message, page, userAgent]
    );

    // Gespeichert ist es auf jeden Fall; die Mail an den Betreiber ist ein Zusatz
    let mailed = false;
    const defaults = await loadDefaultSmtp(pool);
    const to = feedbackRecipient(defaults);
    if (defaults && to) {
      const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const von = user.username ? `${user.username} <${user.email}>` : user.email;
      const zeilen = [`Von: ${von}`, `Art: ${FEEDBACK_CATEGORIES[category]}`, page ? `Seite: ${page}` : null, userAgent ? `Gerät: ${userAgent}` : null].filter(Boolean);
      try {
        await sendUserMail(withDefaultSmtp({}, defaults), {
          to,
          replyTo: user.email,
          subject: `Fuelstat-Feedback (${FEEDBACK_CATEGORIES[category]}) von ${user.username || user.email}`,
          text: `${zeilen.join('\n')}\n\n${message}\n`,
          html: `<p>${zeilen.map(esc).join('<br>')}</p><p style="white-space:pre-wrap">${esc(message)}</p>`
        });
        mailed = true;
      } catch (e) {
        console.error('[feedback] Mail fehlgeschlagen:', e.message);
      }
    }
    res.status(201).json({ id: r.rows[0].id, saved: true, mailed });
  } catch (e) {
    serverError(res, e);
  }
});

// Feedback-Liste für Admins (neueste zuerst)
app.get('/api/v1/feedback', auth, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.id, f.category, f.message, f.page, f.user_agent, f.done, f.created_at,
              COALESCE(u.email, f.user_email) AS user_email, u.username, u.beta_tester
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.done ASC, f.created_at DESC
       LIMIT 200`
    );
    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

app.patch('/api/v1/feedback/:id', auth, requireAdmin, async (req, res) => {
  if (typeof req.body?.done !== 'boolean') return res.status(400).json({ error: 'invalid_done' });
  try {
    const r = await pool.query('UPDATE feedback SET done = $2 WHERE id = $1 RETURNING id, done', [String(req.params.id), req.body.done]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'feedback_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'feedback_not_found' });
    serverError(res, e);
  }
});

app.get('/api/v1/vehicles/:vehicleId/stats', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();

  try {
    const data = await getVehicleStats(pool, req.user.sub, vehicleId);
    if (data?.error === 'vehicle_not_found') return res.status(404).json({ error: 'vehicle_not_found' });
    res.json(data);
  } catch (e) {
    serverError(res, e);
  }
});


// Tankstellen in der Nähe mit aktuellen Preisen (Tankerkönig), z. B. für die Erfassung in den Apps.
// Nur angemeldet: sonst könnte jeder das Kontingent des Keys verbrauchen. Der Key verlässt den Server nie.
app.get('/api/v1/stations', auth, stationsLimiter, async (req, res) => {
  const apiKey = String(process.env.TANKERKOENIG_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'stations_not_configured' });

  const params = stations.parseQuery(req.query);
  if (params.error) return res.status(400).json({ error: params.error });

  const list = await stations.nearbyStations(params, { apiKey });
  if (!list) return res.status(502).json({ error: 'stations_unavailable' });
  res.json({ stations: list, source: 'Tankerkönig', license: 'CC BY 4.0', sourceUrl: 'https://www.tankerkoenig.de' });
});

// ============================================
// Media Upload Endpoints (User Media)
// ============================================

// Upload user media
app.post('/api/v1/media/upload', auth, uploadLimiter, (req, res, next) => { req.mediaArt = 'user'; next(); }, upload.single('file'), verifyUploadedImage, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'missing_file' });
  }

  const mediaType = String(req.body?.mediaType || 'image').trim();
  const url = `${MEDIA_BASE_URL}/${req.file.filename}`;
  const mimeType = req.file.mimetype;
  const bytes = req.file.size;

  try {
    const r = await pool.query(
      `INSERT INTO user_media (user_id, media_type, url, mime_type, bytes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, media_type, url, mime_type, bytes, created_at`,
      [req.user.sub, mediaType, url, mimeType, bytes]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    // Datei löschen falls DB-Insert fehlschlägt
    removeUpload(req.file);
    serverError(res, e);
  }
});

// List user media
app.get('/api/v1/media', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, user_id, media_type, url, mime_type, bytes, created_at
       FROM user_media
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.sub]
    );
    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

// Get single media
app.get('/api/v1/media/:mediaId', auth, async (req, res) => {
  const mediaId = String(req.params.mediaId || '').trim();
  if (!mediaId) return res.status(400).json({ error: 'missing_mediaId' });

  try {
    const r = await pool.query(
      `SELECT id, user_id, media_type, url, mime_type, bytes, created_at
       FROM user_media
       WHERE id = $1 AND user_id = $2`,
      [mediaId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'media_not_found' });
    }

    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Delete media
app.delete('/api/v1/media/:mediaId', auth, async (req, res) => {
  const mediaId = String(req.params.mediaId || '').trim();
  if (!mediaId) return res.status(400).json({ error: 'missing_mediaId' });

  try {
    const r = await pool.query(
      `SELECT url FROM user_media WHERE id = $1 AND user_id = $2`,
      [mediaId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'media_not_found' });
    }

    const url = r.rows[0].url;

    // Aus DB löschen
    await pool.query(
      'DELETE FROM user_media WHERE id = $1 AND user_id = $2',
      [mediaId, req.user.sub]
    );

    // Datei löschen (fehlt sie schon, ist das kein Fehler)
    const filePath = storedMediaPath(url);
    if (filePath) fs.promises.unlink(filePath).catch(() => {});

    return res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

// ============================================
// Media Upload Endpoints (Vehicle Media)
// ============================================

// Upload vehicle media
app.post('/api/v1/vehicles/:vehicleId/media/upload', auth, uploadLimiter, (req, res, next) => { req.mediaArt = 'vehicle'; next(); }, upload.single('file'), verifyUploadedImage, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  if (!req.file) {
    return res.status(400).json({ error: 'missing_file' });
  }

  try {
    // Prüfen, ob das Fahrzeug dem User gehört
    const v = await pool.query(
      'SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (v.rowCount === 0) {
      removeUpload(req.file);
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    const mediaType = String(req.body?.mediaType || 'image').trim();
    const url = `${MEDIA_BASE_URL}/${req.file.filename}`;
    const mimeType = req.file.mimetype;
    const bytes = req.file.size;

    const r = await pool.query(
      `INSERT INTO vehicle_media (vehicle_id, user_id, media_type, url, mime_type, bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, vehicle_id, user_id, media_type, url, mime_type, bytes, created_at`,
      [vehicleId, req.user.sub, mediaType, url, mimeType, bytes]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    // Datei löschen falls DB-Insert fehlschlägt
    removeUpload(req.file);
    serverError(res, e);
  }
});

// List vehicle media
app.get('/api/v1/vehicles/:vehicleId/media', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  try {
    // Prüfen, ob das Fahrzeug dem User gehört
    const v = await pool.query(
      'SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (v.rowCount === 0) {
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    const r = await pool.query(
      `SELECT id, vehicle_id, user_id, media_type, url, mime_type, bytes, created_at
       FROM vehicle_media
       WHERE vehicle_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [vehicleId, req.user.sub]
    );
    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

// Delete vehicle media
app.delete('/api/v1/vehicles/:vehicleId/media/:mediaId', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  const mediaId = String(req.params.mediaId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });
  if (!mediaId) return res.status(400).json({ error: 'missing_mediaId' });

  try {
    const r = await pool.query(
      `SELECT url FROM vehicle_media
       WHERE id = $1 AND vehicle_id = $2 AND user_id = $3`,
      [mediaId, vehicleId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'media_not_found' });
    }

    const url = r.rows[0].url;

    // Aus DB löschen
    await pool.query(
      'DELETE FROM vehicle_media WHERE id = $1 AND vehicle_id = $2 AND user_id = $3',
      [mediaId, vehicleId, req.user.sub]
    );

    // Datei löschen (fehlt sie schon, ist das kein Fehler)
    const filePath = storedMediaPath(url);
    if (filePath) fs.promises.unlink(filePath).catch(() => {});

    return res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

// Error Handler für multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'file_too_large', message: 'Datei ist zu groß (max. 20 MB)' });
    }
    return res.status(400).json({ error: 'upload_error', detail: error.message });
  }
  if (error) {
    return res.status(400).json({ error: 'upload_error', detail: error.message });
  }
  next();
});

// Direkt gestartet (node src/server.js, nodemon, Docker): Port öffnen und Hintergrundaufgaben starten.
// Von den Tests importiert (backend/test): nur die App exportieren, die Tests starten sie selbst.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend V2 läuft auf Port ${PORT}`);
    encryptLegacyMfaSecrets().catch((e) => console.error('[mfa] Verschlüsseln fehlgeschlagen:', e.message));
    notifier.startNotifier(pool);
  });
}

module.exports = { app, pool };
