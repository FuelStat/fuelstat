// Kleine HTTP-Hilfen: einheitliche 500-Antwort, Eingaben in Zahl/Text wandeln, UUID-Prüfung.
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = { UUID_RE, optionalNumber, optionalText, serverError };
