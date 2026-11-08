// Express-App der Fuelstat-API (#110): Middleware-Kette und Routen. Gestartet wird sie in server.js.
// Die Reihenfolge ist Absicht und entspricht dem früheren server.js:
//   helmet → signierte Bilder (eigenes Limit) → allgemeines Rate-Limit → CORS → JSON → Bildadressen signieren
//   → Routen → Fehlerbehandlung für Uploads
require('./config'); // prüft Pflichtvariablen (DATABASE_URL, JWT_SECRET), bevor irgendetwas anderes startet
const express = require('express');
const helmet = require('helmet');
const media = require('./services/media');
const { CORS_ORIGINS } = require('./config');
const { apiLimiter } = require('./middleware/rateLimits');
const { uploadErrorHandler } = require('./middleware/upload');

const app = express();

// Die API läuft hinter nginx (Docker-Port auf 127.0.0.1): Client-IP aus X-Forwarded-For nur von lokalen bzw.
// privaten Adressen (Docker-Netz) übernehmen
app.set('trust proxy', 'loopback, uniquelocal');

app.use(helmet());
// Signierte Bilder vor dem allgemeinen Rate-Limit: eigene, großzügige Grenze (eine Seite lädt mehrere Bilder)
app.use('/api/v1', require('./routes/files'));
app.use(apiLimiter);
// CORS: Das PHP-Frontend ruft die API nur serverseitig auf, Browser anderer Seiten brauchen keinen Zugriff.
// Nur ausdrücklich erlaubte Ursprünge (CORS_ORIGINS, kommagetrennt) bekommen CORS-Header.
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

// Routen nach Fachbereich (Pfade relativ zu /api/v1)
for (const bereich of [
  'system', // health, whoami, db-ping
  'auth', // Registrierung, Login, 2FA, Passwort, Token
  'users', // Konten, Tarife, Beta (Admin bzw. eigenes Konto)
  'mailSettings', // E-Mail-Einstellungen, Test- und Sofortversand
  'vehicles', // Fahrzeuge
  'fillups', // Tank- und Ladevorgänge
  'categories', // Ausgaben-Kategorien
  'entries', // Ausgaben, Fahrten, Kilometerstände
  'import', // CSV-Import je Fahrzeug
  'statistics', // Kennzahlen, Verbrauch, Kosten, Fälligkeiten
  'stations', // Tankstellen und Ladestationen
  'media', // Profil- und Fahrzeugbilder
  'feedback'
]) {
  app.use('/api/v1', require(`./routes/${bereich}`));
}

app.use(uploadErrorHandler);

module.exports = { app };
