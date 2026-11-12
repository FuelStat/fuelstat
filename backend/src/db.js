// PostgreSQL-Verbindungspool (eine Instanz für die ganze API).
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const { Pool, types } = require('pg');

// NUMERIC-Spalten (Beträge, Mengen, Strecken) als Zahl statt als Text ausliefern, wie in der OpenAPI beschrieben
// (#118). Die Werte haben höchstens wenige Nachkommastellen, double reicht.
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));

// DATE-Spalten (z. B. Erstzulassung) als 'YYYY-MM-DD' liefern, nicht als Date mit Zeitzonenverschiebung
require('pg').types.setTypeParser(1082, (v) => v);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = { pool };
