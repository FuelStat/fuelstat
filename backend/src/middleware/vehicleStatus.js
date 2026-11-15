// Archivierte Fahrzeuge (#79) sind nur lesbar. Eine zentrale Sperre für alle schreibenden Anfragen, die ein Fahrzeug
// betreffen, damit keine Route sie vergisst: Der Besitzer ändert nur den Status (PATCH /vehicles/:id, dort geprüft),
// löscht das Fahrzeug oder entfernt Mitglieder und Einladungen; alles andere antwortet 409 vehicle_archived.
//
// Erkannt wird das Fahrzeug aus dem Pfad (/vehicles/:id/…), aus dem Body (POST /fillups, /entries, /trips: vehicleId) oder
// über die Zeile (PATCH und DELETE /fillups|entries|trips/:id). test/vehicleStatus.test.js prüft, dass jede schreibende
// Route der Anwendung hier erfasst oder ausdrücklich ausgenommen ist.
const { pool } = require('../db');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const VEHICLE_PATH = new RegExp(`^/vehicles/(${ID})(?:/(.*))?$`, 'i');
// Zeilen, die zu einem Fahrzeug gehören: Pfadanfang → Tabelle mit vehicle_id
const ROW_TABLES = { fillups: 'fillups', entries: 'expenses', trips: 'trips' };
const ROW_PATH = new RegExp(`^/(fillups|entries|trips)/(${ID})$`, 'i');

// Auch bei archivierten Fahrzeugen erlaubt (Methode + Pfad unter /vehicles/:id/)
const ALLOWED_UNDER_VEHICLE = [
  /^DELETE members\/.+$/, // Mitglied entfernen bzw. selbst verlassen
  /^DELETE invitations\/.+$/ // offene Einladung zurückziehen
];

/** Pfad (ohne /api/v1) → { vehicleId } | { table, rowId } | null */
function target(method, path, body) {
  const v = VEHICLE_PATH.exec(path);
  if (v) {
    const rest = v[2];
    // PATCH und DELETE /vehicles/:id regeln die Routen selbst (Status ändern, löschen)
    if (rest === undefined) return null;
    if (ALLOWED_UNDER_VEHICLE.some((re) => re.test(`${method} ${rest}`))) return null;
    return { vehicleId: v[1] };
  }
  if ((path === '/fillups' || path === '/entries' || path === '/trips') && method === 'POST') {
    return typeof body?.vehicleId === 'string' && new RegExp(`^${ID}$`, 'i').test(body.vehicleId) ? { vehicleId: body.vehicleId } : null;
  }
  const row = ROW_PATH.exec(path);
  if (row && (method === 'PATCH' || method === 'DELETE')) return { table: ROW_TABLES[row[1].toLowerCase()], rowId: row[2] };
  return null;
}

async function archivedMiddleware(req, res, next) {
  try {
    if (!WRITE_METHODS.has(req.method) || !req.header('Authorization')) return next(); // ohne Anmeldung antwortet auth() mit 401
    const t = target(req.method, req.path, req.body);
    if (!t) return next();
    const r = t.vehicleId
      ? await pool.query('SELECT status FROM vehicles WHERE id = $1', [t.vehicleId])
      // t.table stammt aus der festen Tabelle oben, nicht aus der Anfrage
      : await pool.query(`SELECT v.status FROM ${t.table} x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.id = $1`, [t.rowId]);
    if (r.rowCount && r.rows[0].status !== 'active') {
      return res.status(409).json({
        error: 'vehicle_archived',
        message: 'Dieses Fahrzeug ist archiviert (verkauft oder stillgelegt) und nur lesbar. Aktiviere es wieder, um etwas zu ändern.',
        status: r.rows[0].status
      });
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { archivedMiddleware, target, ALLOWED_UNDER_VEHICLE };
