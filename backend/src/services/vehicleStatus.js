// Fahrzeug-Lebenszyklus (#79): aktiv, verkauft oder stillgelegt.
//
// - Verkaufte und stillgelegte Fahrzeuge sind **archiviert**: alle Daten und Statistiken bleiben lesbar, geändert wird
//   nichts mehr (siehe middleware/vehicleStatus.js). Erinnerungen und Monatsbericht entfallen.
// - Der Status wird nie geraten: Auch ein Fahrzeug mit Verkaufsdatum (#45) bleibt aktiv, bis der Besitzer es archiviert.
// - Wieder aktivieren (und Verkauf in Stilllegung ändern oder umgekehrt) ist Sache des Besitzers. „Abgemeldet bis“ ist nur eine
//   Angabe, keine automatische Reaktivierung (sie würde die Grenze für aktive Fahrzeuge umgehen).
// - Grenzen (services/plans.js, nur mit PLAN_LIMITS_ENABLED): Anlegen und Aktivieren zählen aktive Fahrzeuge des Kontos,
//   Archivieren die archivierten. Herabstufen löscht nichts.
// - Verkaufsdatum und -erlös bleiben die Spalten sale_date und sale_price (#45); neu sind der Tachostand beim Verkauf und der
//   Zeitraum der Stilllegung.
const plans = require('./plans');

const STATUSES = ['active', 'sold', 'decommissioned'];
const STATUS_COLUMNS = 'status, sale_odometer_km, decommissioned_from, decommissioned_until';
const isArchived = (status) => status !== 'active';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v) => DAY.test(String(v)) && !Number.isNaN(Date.parse(v));

// Heutiges Datum in Europe/Berlin als YYYY-MM-DD
function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Statusangaben aus einer Anfrage prüfen (status, saleOdometerKm, decommissionedFrom, decommissionedUntil).
 * Nicht gesendet = unverändert, null/'' = löschen.
 * @returns {{ values: Object<string, any>, error?: string }} values: Spalte → Wert
 */
function parseStatusInput(body = {}) {
  const values = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return { values, error: 'invalid_status' };
    values.status = body.status;
  }
  if (body.saleOdometerKm !== undefined) {
    if (body.saleOdometerKm === null || body.saleOdometerKm === '') values.sale_odometer_km = null;
    else {
      const n = Number(body.saleOdometerKm);
      if (!Number.isInteger(n) || n < 0) return { values, error: 'invalid_saleOdometerKm' };
      values.sale_odometer_km = n;
    }
  }
  for (const [name, col] of [['decommissionedFrom', 'decommissioned_from'], ['decommissionedUntil', 'decommissioned_until']]) {
    if (body[name] === undefined) continue;
    if (body[name] === null || body[name] === '') values[col] = null;
    else if (!validDay(body[name])) return { values, error: `invalid_${name}` };
    else values[col] = String(body[name]);
  }
  return { values };
}

/** Aktive und archivierte Fahrzeuge des Kontos (nur eigene, keine geteilten) */
async function countOwned(db, userId) {
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active, COUNT(*) FILTER (WHERE status <> 'active')::int AS archived,
            (SELECT plan FROM users WHERE id = $1) AS plan, (SELECT plan_until FROM users WHERE id = $1) AS plan_until
       FROM vehicles WHERE user_id = $1`,
    [userId]
  );
  return r.rows[0];
}

/**
 * Darf das Konto ein Fahrzeug anlegen bzw. aktivieren (maxVehicles) oder archivieren (maxArchivedVehicles)?
 * @param {'active'|'archive'} kind
 * @returns {{ feature, limit, plan } | null} null = erlaubt, sonst die Angaben für planRequired
 */
async function checkLimit(db, userId, kind) {
  const c = await countOwned(db, userId);
  const konto = { plan: c.plan, plan_until: c.plan_until };
  const feature = kind === 'archive' ? 'maxArchivedVehicles' : 'maxVehicles';
  const limit = plans.limitOf(konto, feature);
  const used = kind === 'archive' ? c.archived : c.active;
  return limit !== null && used >= limit ? { feature, limit, plan: plans.effectivePlan(konto) } : null;
}

/**
 * Statuswechsel prüfen und die zu schreibenden Spalten ergänzen (Standarddatum heute).
 * @param {object} cur aktuelle Zeile (status, sale_date)
 * @param {object} input Ergebnis von parseStatusInput().values
 * @returns {Promise<{ values?: object, limit?: object, error?: string }>}
 */
async function planTransition(db, userId, cur, input, now = new Date()) {
  const values = { ...input };
  const target = values.status ?? cur.status;
  if (target === 'sold' && cur.status !== 'sold') {
    // Ohne Angabe gilt ein vorhandenes Verkaufsdatum, sonst heute
    if (values.sale_date === undefined && !cur.sale_date) values.sale_date = today(now);
  }
  if (target === 'decommissioned' && cur.status !== 'decommissioned' && values.decommissioned_from === undefined && !cur.decommissioned_from) {
    values.decommissioned_from = today(now);
  }
  const from = values.decommissioned_from !== undefined ? values.decommissioned_from : cur.decommissioned_from;
  const until = values.decommissioned_until !== undefined ? values.decommissioned_until : cur.decommissioned_until;
  if (from && until && String(until) < String(from)) return { error: 'invalid_decommissionedUntil' };
  if (values.status !== undefined && values.status !== cur.status) {
    const wasArchived = isArchived(cur.status);
    const willArchive = isArchived(values.status);
    if (!wasArchived && willArchive) {
      const limit = await checkLimit(db, userId, 'archive');
      if (limit) return { limit };
    } else if (wasArchived && !willArchive) {
      const limit = await checkLimit(db, userId, 'active');
      if (limit) return { limit };
    }
  }
  return { values };
}

module.exports = { STATUSES, STATUS_COLUMNS, isArchived, today, parseStatusInput, countOwned, checkLimit, planTransition };
