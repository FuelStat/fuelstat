// Kosten je Fahrzeug (#124, Teil von #82): Summen, Kosten pro km, laufender Monat, Monatssummen.
// Bisher rechnete das PHP-Frontend diese Werte selbst (tabs/ausgaben.php, tabs/statistiken.php,
// includes/api_helpers.php); jetzt liefert sie die API für Web-App und Apps gleich.
//
// Regeln:
// - Kosten zählen: alle Tank- und Ladevorgänge (Energie) und Ausgaben, deren Kategorie als Kosten zählt
//   (nicht Fahrt und Kilometerstand, siehe services/categories.js).
// - Monate und Jahre in Europe/Berlin.
// - Strecke nur aus echten Tachoständen: Tank-/Ladevorgänge ohne Schätzung (#41) und Ausgaben mit Tachostand
//   (inkl. "Kilometerstand notieren"). Kilometer zählen erst ab dem ersten erfassten Tachostand.
// - Energiekosten pro km: Kosten aller Tank-/Ladevorgänge mit echtem Tachostand nach dem ersten, geteilt durch die
//   Strecke vom ersten bis zum letzten (die erste Füllung hat die Strecke davor bezahlt).
// - Gesamtkosten pro km: alle Kosten im Zeitraum geteilt durch die Strecke im Zeitraum.
// - Ohne Strecke ist der Wert null, nie 0.

const { NON_COST_KEYS } = require('./categories');

const TZ = 'Europe/Berlin';
const round2 = (x) => Math.round(x * 100) / 100;
// €/km auf 4 Stellen: genau genug für €/100 km mit zwei Nachkommastellen
const round4 = (x) => Math.round(x * 10000) / 10000;

// Monat "JJJJ-MM" eines Zeitpunkts in Europe/Berlin
function monthOf(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}`;
}

function previousMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

function typeOf(row) {
  if (row.src === 'fillup') return row.kind === 'kwh' ? 'charge' : 'fuel';
  if (row.kind === 'Fahrt') return 'trip';
  if (row.kind === 'Kilometerstand') return 'odometer';
  return 'expense';
}

/** Alle Einträge eines Fahrzeugs als einheitliche Zeilen; null, wenn das Fahrzeug nicht dem Konto gehört. */
async function loadRows(db, userId, vehicleId) {
  const v = await db.query('SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, userId]);
  if (v.rowCount === 0) return null;
  const r = await db.query(
    `SELECT 'fillup' AS src, unit AS kind, total_cost_eur::float8 AS cost,
            CASE WHEN odometer_estimated THEN NULL ELSE odometer_km END AS odo, filled_at AS at, created_at
       FROM fillups WHERE user_id = $1 AND vehicle_id = $2
     UNION ALL
     SELECT 'expense', category, amount_eur::float8, odometer_km, occurred_at, created_at
       FROM expenses WHERE user_id = $1 AND vehicle_id = $2`,
    [userId, vehicleId]
  );
  return r.rows.map((row) => {
    const at = new Date(row.at);
    const month = monthOf(at);
    const type = typeOf(row);
    return {
      type,
      // Kategorie-Schlüssel wie in /categories; Tank-/Ladevorgänge je Einheit ("Tankfuellung:l", "Tankfuellung:kwh")
      category: row.src === 'fillup' ? `Tankfuellung:${row.kind}` : row.kind,
      cost: Number(row.cost) || 0,
      countsAsCost: type === 'fuel' || type === 'charge' || (type === 'expense' && !NON_COST_KEYS.includes(row.kind)),
      odo: row.odo === null || row.odo === undefined ? null : Number(row.odo),
      at,
      createdAt: new Date(row.created_at),
      month,
      year: Number(month.slice(0, 4))
    };
  });
}

// Strecke im Zeitraum aus echten Tachoständen
function distanceKm(rows, year) {
  const readings = rows.filter((r) => r.odo !== null && r.odo > 0);
  if (year === null) {
    if (!readings.length) return null;
    const odos = readings.map((r) => r.odo);
    const d = Math.max(...odos) - Math.min(...odos);
    return d > 0 ? d : null;
  }
  const maxBefore = (y) => {
    const o = readings.filter((r) => r.year < y).map((r) => r.odo);
    return o.length ? Math.max(...o) : null;
  };
  const end = maxBefore(year + 1);
  let start = maxBefore(year);
  if (start === null) {
    // Erster Tachostand liegt im Jahr: ab da zählen
    const inYear = readings.filter((r) => r.year === year).map((r) => r.odo);
    start = inYear.length ? Math.min(...inYear) : null;
  }
  return end !== null && start !== null && end > start ? end - start : null;
}

// Energiekosten pro km aus Tank-/Ladevorgängen mit echtem Tachostand
function energyCostPerKm(rows) {
  const f = rows
    .filter((r) => (r.type === 'fuel' || r.type === 'charge') && r.odo !== null)
    .sort((a, b) => a.odo - b.odo || a.at - b.at || a.createdAt - b.createdAt);
  if (f.length < 2) return null;
  const span = f[f.length - 1].odo - f[0].odo;
  if (span <= 0) return null;
  return round4(f.slice(1).reduce((s, r) => s + r.cost, 0) / span);
}

function sums(rows) {
  const energy = rows.filter((r) => r.countsAsCost && r.type !== 'expense').reduce((s, r) => s + r.cost, 0);
  const expenses = rows.filter((r) => r.countsAsCost && r.type === 'expense').reduce((s, r) => s + r.cost, 0);
  return { energy: round2(energy), expenses: round2(expenses), total: round2(energy + expenses) };
}

/**
 * Kostenübersicht eines Fahrzeugs.
 * @param {number|null} year Kalenderjahr (Europe/Berlin) oder null für den gesamten Zeitraum
 * @returns {Promise<object|null>} null, wenn das Fahrzeug nicht dem Konto gehört
 */
async function getVehicleCosts(db, userId, vehicleId, { year = null, now = new Date() } = {}) {
  const all = await loadRows(db, userId, vehicleId);
  if (!all) return null;
  const rows = year === null ? all : all.filter((r) => r.year === year);
  const costRows = rows.filter((r) => r.countsAsCost);

  const total = sums(rows);
  const distance = distanceKm(all, year);

  // Ø je Monat: vom ersten Monat mit Kosten bis heute bzw. bis Jahresende; Monate ohne Kosten zählen mit
  const currentMonth = monthOf(now);
  const firstCostMonth = all.filter((r) => r.countsAsCost).map((r) => r.month).sort()[0] ?? null;
  let monthCount = 0;
  if (firstCostMonth) {
    const from = year === null || firstCostMonth > `${year}-01` ? firstCostMonth : `${year}-01`;
    const to = year === null || `${year}-12` >= currentMonth ? currentMonth : `${year}-12`;
    monthCount = to >= from ? monthsBetween(from, to) : 0;
  }

  // Monatssummen für die Eintragsliste, je Eintragsart (die Liste kann so nach Art filtern)
  const byMonth = new Map();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? {
      month: r.month, energy: 0, expenses: 0, total: 0,
      count: 0, counts: { fuel: 0, charge: 0, expense: 0, trip: 0, odometer: 0 },
      byType: { fuel: 0, charge: 0, expense: 0 },
      byCategory: {}
    };
    m.count += 1;
    m.counts[r.type] += 1;
    if (r.countsAsCost) {
      m.byCategory[r.category] = (m.byCategory[r.category] ?? 0) + r.cost;
      m.byType[r.type] += r.cost;
      if (r.type === 'expense') m.expenses += r.cost; else m.energy += r.cost;
      m.total += r.cost;
    }
    byMonth.set(r.month, m);
  }
  const months = [...byMonth.values()]
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .map((m) => ({
      ...m,
      energy: round2(m.energy),
      expenses: round2(m.expenses),
      total: round2(m.total),
      byType: { fuel: round2(m.byType.fuel), charge: round2(m.byType.charge), expense: round2(m.byType.expense) },
      byCategory: Object.fromEntries(Object.entries(m.byCategory).map(([k, x]) => [k, round2(x)]))
    }));

  // Summe und Anzahl je Kategorie im Zeitraum, größte zuerst (#82)
  const catMap = new Map();
  for (const r of costRows) {
    const c = catMap.get(r.category) ?? { key: r.category, total: 0, count: 0 };
    c.total += r.cost;
    c.count += 1;
    catMap.set(r.category, c);
  }
  const categories = [...catMap.values()]
    .map((c) => ({ ...c, total: round2(c.total) }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

  const monthSums = (month) => ({ month, ...sums(all.filter((r) => r.month === month)) });

  return {
    year,
    currency: 'EUR',
    total,
    distanceKm: distance,
    costPerKm: {
      energy: energyCostPerKm(rows),
      total: distance ? round4(total.total / distance) : null
    },
    // Ø je Monat und die Zahl der Monate, über die gemittelt wird
    perMonth: monthCount > 0 && costRows.length ? round2(total.total / monthCount) : null,
    monthCount,
    currentMonth: monthSums(currentMonth),
    previousMonth: monthSums(previousMonth(currentMonth)),
    categories,
    // Jahre mit Kosten (gesamter Zeitraum), neueste zuerst – für die Jahresauswahl
    years: [...new Set(all.filter((r) => r.countsAsCost).map((r) => r.year))].sort((a, b) => b - a),
    months
  };
}

module.exports = { getVehicleCosts, monthOf, previousMonth, distanceKm, energyCostPerKm };
