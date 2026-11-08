// PostgreSQL-Verbindungspool (eine Instanz für die ganze API).
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const { Pool } = require('pg');

// DATE-Spalten (z. B. Erstzulassung) als 'YYYY-MM-DD' liefern, nicht als Date mit Zeitzonenverschiebung
require('pg').types.setTypeParser(1082, (v) => v);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = { pool };
