// Startpunkt der Fuelstat-API (#110): Anwendung laden, Port öffnen, Hintergrundaufgaben starten.
// Aufbau: app.js (Middleware, Routen) · routes/ (Endpunkte je Fachbereich) · middleware/ (Anmeldung, Limits,
// Uploads) · services/ (Fachlogik) · lib/ (kleine Hilfen) · config.js · db.js – siehe docs/backend.md.
const { app } = require('./app');
const { pool } = require('./db');
const { PORT } = require('./config');
const notifier = require('./services/notifier');

// Direkt gestartet (node src/server.js, nodemon, Docker): Port öffnen und Hintergrundaufgaben starten.
// Von den Tests importiert (backend/test): nur die App exportieren, die Tests starten sie selbst.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend V2 läuft auf Port ${PORT}`);
    notifier.startNotifier(pool);
  });
}

module.exports = { app, pool };
