// Konfiguration aus der Umgebung: Pfade, Port, CORS, Version, Beta-Phase. Prüft Pflichtvariablen beim Start.
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const path = require('path');

// Version der API (#111): aus package.json, das neue-version.js zusammen mit VERSION pflegt
const API_VERSION = require('../package.json').version;
// Media Upload Konfiguration
// Standard-Uploadpfad: im Backend-Projektordner unter ../uploads (z. B. /srv/www/.../uploads)
const BACKEND_ROOT = path.resolve(__dirname, '..');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? (path.isAbsolute(process.env.UPLOAD_DIR)
    ? process.env.UPLOAD_DIR
    : path.resolve(BACKEND_ROOT, process.env.UPLOAD_DIR))
  : path.resolve(BACKEND_ROOT, 'uploads');
const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL || '/uploads';

// CORS: Das PHP-Frontend ruft die API nur serverseitig auf, Browser anderer Seiten brauchen keinen Zugriff.
// Nur ausdrücklich erlaubte Ursprünge (CORS_ORIGINS, kommagetrennt) bekommen CORS-Header.
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL fehlt');
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  throw new Error('JWT_SECRET fehlt oder ist zu kurz');
}

// Beta-Phase: an, bis BETA_PHASE=false gesetzt wird. Neue Konten werden in der Beta als Beta-Tester markiert.
function isBetaPhase() {
  return process.env.BETA_PHASE !== 'false';
}

// Nutzungsbedingungen (#135): Version der gültigen Fassung, z. B. "2026-11-09". Leer = keine Zustimmung nötig
// (z. B. private Installation). Neue Version setzen, wenn sich der Text ändert: Konten müssen dann neu zustimmen.
function termsVersion() {
  const v = String(process.env.TERMS_VERSION || '').trim();
  return /^[0-9A-Za-z._-]{1,40}$/.test(v) ? v : null;
}

module.exports = { API_VERSION, BACKEND_ROOT, CORS_ORIGINS, MEDIA_BASE_URL, PORT, UPLOAD_DIR, isBetaPhase, termsVersion };
