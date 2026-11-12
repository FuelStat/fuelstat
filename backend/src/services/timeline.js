// Eintragsliste eines Fahrzeugs (#160): Tank-/Ladevorgänge, Ausgaben und Fahrten gemischt, neueste zuerst,
// seitenweise, mit Filter nach Art und Jahr, Suche und Monatssummen. Für die Liste in Web-App und Apps, die sonst
// alle Einträge laden und selbst zusammenführen müssten.
const { NON_COST_KEYS } = require('./categories');
const { getVehicleStats } = require('./stats');
const { paginated } = require('../lib/pagination');
const { monthOf } = require('./costs');

const KINDS = ['fuel', 'charge', 'expense', 'trip', 'odometer'];
const TZ = 'Europe/Berlin';

// Alle Einträge als einheitliche Zeilen ($1 = Fahrzeug)
const UNION = `
  SELECT 'fillup' AS type, CASE WHEN f.unit = 'kwh' THEN 'charge' ELSE 'fuel' END AS kind,
         f.id, f.filled_at AS at, f.created_at, 'Tankfuellung' AS category,
         f.total_cost_eur::float8 AS cost, f.amount::float8 AS amount, f.unit, f.fuel,
         f.odometer_km, f.odometer_estimated, f.is_full, f.skip_previous,
         f.station AS place, NULL::text AS description,
         NULL::text AS purpose, NULL::float8 AS distance_km, NULL::text AS start_place, NULL::text AS end_place,
         f.user_id AS created_by
    FROM fillups f WHERE f.vehicle_id = $1
  UNION ALL
  SELECT 'entry', CASE e.category WHEN 'Kilometerstand' THEN 'odometer' WHEN 'Fahrt' THEN 'trip' ELSE 'expense' END,
         e.id, e.occurred_at, e.created_at, e.category,
         e.amount_eur::float8, NULL, NULL, NULL,
         e.odometer_km, false, NULL, NULL,
         e.vendor, e.description,
         NULL, NULL, NULL, NULL,
         e.user_id
    FROM expenses e
   WHERE e.vehicle_id = $1
     -- Alte "Fahrt"-Einträge, die ins Fahrtenbuch übernommen wurden (Migration 019, #52), nicht doppelt zeigen
     AND NOT (e.category = 'Fahrt' AND EXISTS (SELECT 1 FROM trips t WHERE t.legacy_expense_id = e.id))
  UNION ALL
  SELECT 'trip', 'trip', t.id, t.started_at, t.created_at, 'Fahrt',
         NULL, NULL, NULL, NULL,
         t.odometer_end, false, NULL, NULL,
         NULL, t.note,
         t.purpose, t.distance_km::float8, t.start_place, t.end_place,
         t.user_id
    FROM trips t WHERE t.vehicle_id = $1`;

// Filter ($2 Arten, $3 Jahr, $4 Suchmuster)
const FILTER = `($2::text[] IS NULL OR a.kind = ANY($2))
  AND ($3::int IS NULL OR EXTRACT(YEAR FROM a.at AT TIME ZONE '${TZ}') = $3)
  AND ($4::text IS NULL OR concat_ws(' ', a.place, a.description, a.category, a.start_place, a.end_place) ILIKE $4)`;

const MONTH = `to_char(a.at AT TIME ZONE '${TZ}', 'YYYY-MM')`;

/**
 * Filter aus der Anfrage prüfen.
 * @returns {{ kinds: string[]|null, year: number|null, q: string|null } | { error: string }}
 */
function parseFilter(query = {}) {
  let kinds = null;
  if (query.type !== undefined && query.type !== '') {
    kinds = [...new Set(String(query.type).split(',').map((k) => k.trim()).filter(Boolean))];
    if (!kinds.length || kinds.some((k) => !KINDS.includes(k))) return { error: 'invalid_type' };
  }
  let year = null;
  if (query.year !== undefined && query.year !== '') {
    year = Number(query.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return { error: 'invalid_year' };
  }
  const q = query.q !== undefined ? String(query.q).trim().slice(0, 100) : '';
  return { kinds, year, q: q || null };
}

// Suchtext als ILIKE-Muster; % und _ im Text gelten wörtlich
const pattern = (q) => (q === null ? null : `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);

/**
 * Eine Seite der Eintragsliste.
 * @param p Seitenangaben aus lib/pagination
 */
async function getTimeline(db, userId, vehicleId, filter, p) {
  const params = [vehicleId, filter.kinds, filter.year, pattern(filter.q)];
  const [rows, count, kinds, years] = await Promise.all([
    db.query(
      `WITH a AS (${UNION})
       SELECT a.*, (SELECT COALESCE(u.username, u.email) FROM users u WHERE u.id = a.created_by) AS created_by_name
         FROM a WHERE ${FILTER}
        ORDER BY a.at DESC, a.created_at DESC, a.id DESC
        LIMIT $5 OFFSET $6`,
      [...params, p.limit, p.offset]
    ),
    db.query(`WITH a AS (${UNION}) SELECT COUNT(*)::int AS total FROM a WHERE ${FILTER}`, params),
    // Arten und Jahre ohne Filter, für Filter-Chips und Jahresauswahl
    db.query(`WITH a AS (${UNION}) SELECT a.kind, COUNT(*)::int AS n FROM a GROUP BY a.kind`, [vehicleId]),
    db.query(
      `WITH a AS (${UNION}) SELECT DISTINCT EXTRACT(YEAR FROM a.at AT TIME ZONE '${TZ}')::int AS year FROM a ORDER BY 1 DESC`,
      [vehicleId]
    )
  ]);

  // Monatssummen der Monate auf dieser Seite, über den ganzen Monat (mit denselben Filtern)
  const monthKeys = [...new Set(rows.rows.map((r) => monthOf(new Date(r.at))))];
  let months = [];
  if (monthKeys.length) {
    const m = await db.query(
      `WITH a AS (${UNION})
       SELECT ${MONTH} AS month, COUNT(*)::int AS count,
              COALESCE(SUM(a.cost) FILTER (WHERE a.kind IN ('fuel', 'charge')
                                          OR (a.kind = 'expense' AND NOT (a.category = ANY($6::text[])))), 0)::float8 AS total
         FROM a WHERE ${FILTER} AND ${MONTH} = ANY($5::text[])
        GROUP BY 1 ORDER BY 1 DESC`,
      [...params, monthKeys, NON_COST_KEYS]
    );
    months = m.rows.map((r) => ({ month: r.month, count: r.count, total: Math.round(r.total * 100) / 100 }));
  }

  // Verbrauch je Tank-/Ladevorgang aus den Abschnitten (#82); nebenbei getankte Energiearten ohne Wert (#140)
  let consumption = new Map();
  if (rows.rows.some((r) => r.type === 'fillup')) {
    const stats = await getVehicleStats(db, userId, vehicleId);
    consumption = new Map((stats.segments || [])
      .filter((s) => s.l_per_100km !== null && !stats.energies?.[s.energy]?.minor)
      .map((s) => [String(s.full_id), Number(s.l_per_100km)]));
  }

  const data = rows.rows.map((r) => ({
    ...r,
    countsAsCost: r.kind === 'fuel' || r.kind === 'charge' || (r.kind === 'expense' && !NON_COST_KEYS.includes(r.category)),
    consumption: r.type === 'fillup' ? consumption.get(String(r.id)) ?? null : null
  }));

  return {
    ...paginated(data, count.rows[0].total, p),
    months,
    years: years.rows.map((r) => r.year),
    kinds: Object.fromEntries(kinds.rows.map((r) => [r.kind, r.n]))
  };
}

module.exports = { KINDS, parseFilter, getTimeline };
