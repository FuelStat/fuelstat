// Gesamtkosten (TCO) und Wertverlust eines Fahrzeugs (#79).
// Bausteine:
// - Laufende Kosten: alle gebuchten Tank-/Ladevorgänge und Ausgaben, die als Kosten zählen (services/costs.js), mit
//   Gruppen und Kategorien. Leasing- und Finanzierungsraten zählen dazu, wenn sie als Ausgabe gebucht sind; es gibt keine
//   eigenen Raten- oder Laufzeitfelder.
// - Wertverlust: Kaufpreis minus Verkaufserlös (verkauftes Fahrzeug) bzw. minus geschätztem Restwert (sonst). Fehlt eine der
//   beiden Angaben, ist der Wertverlust null (nie 0 und nie geschätzt), und `complete` ist false.
// - Gesamtkosten = laufende Kosten + Wertverlust (falls bekannt).
// - Besitzzeit: vom Kaufdatum (sonst vom ersten Eintrag) bis zum Verkaufsdatum (sonst heute), in Europe/Berlin.
//   Kosten pro Monat und Wertverlust pro Jahr teilen durch diese Zeit, Kosten pro km durch die Strecke aus echten Tachoständen.
// Alle Zahlen kommen hier aus der API, Web-App und Apps stellen sie nur dar.
const { loadRows, groupTotals, sums, round2, round4, TZ } = require('./costs');
const { distanceKm } = require('./costs');

const DAY_MS = 86400000;
const dayOf = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: TZ });
const dayDiff = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
const money = (x) => (x === null || x === undefined ? null : Number(x));

async function getVehicleTco(db, userId, vehicleId, { now = new Date() } = {}) {
  const all = await loadRows(db, userId, vehicleId);
  if (!all) return null;
  const v = (await db.query(
    `SELECT status, to_char(purchase_date, 'YYYY-MM-DD') AS purchase_date, purchase_price::float8 AS purchase_price,
            to_char(sale_date, 'YYYY-MM-DD') AS sale_date, sale_price::float8 AS sale_price, sale_odometer_km,
            residual_value::float8 AS residual_value
       FROM vehicles WHERE id = $1`,
    [vehicleId]
  )).rows[0];

  const costRows = all.filter((r) => r.countsAsCost);
  const running = sums(all);
  const sold = v.status === 'sold' || v.sale_date !== null;

  // Besitzzeit
  const today = dayOf(now);
  const firstEntry = all.length ? dayOf(all.map((r) => r.at).sort((a, b) => a - b)[0]) : null;
  const from = v.purchase_date ?? firstEntry;
  let to = v.sale_date ?? today;
  if (from && to < from) to = from;
  const days = from ? dayDiff(from, to) + 1 : null;
  const months = days ? Math.round((days / 30.4375) * 10) / 10 : null;

  // Wertverlust: bei verkauften Fahrzeugen zählt der Erlös, sonst der geschätzte Restwert
  const endValue = sold ? v.sale_price : v.residual_value;
  const valueLoss = v.purchase_price !== null && endValue !== null ? round2(v.purchase_price - endValue) : null;
  const valueLossPerYear = valueLoss !== null && days >= 30 ? round2(valueLoss / (days / 365.25)) : null;

  const total = round2(running.total + (valueLoss ?? 0));
  const distance = distanceKm(all, null);

  const groups = groupTotals(costRows, running.total);
  const categoryMap = new Map();
  for (const r of costRows) {
    const c = categoryMap.get(r.category) ?? { key: r.category, total: 0, count: 0 };
    c.total += r.cost;
    c.count += 1;
    categoryMap.set(r.category, c);
  }
  const categories = [...categoryMap.values()]
    .map((c) => ({ ...c, total: round2(c.total), share: total > 0 ? Math.round((c.total / total) * 1000) / 10 : null }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

  // Anteile an den Gesamtkosten: Kostengruppen und Wertverlust (nur ein Verlust zählt als Anteil)
  const shareParts = [...groups.filter((g) => g.total > 0).map((g) => ({ key: g.key, total: g.total })),
    ...(valueLoss !== null && valueLoss > 0 ? [{ key: 'wertverlust', total: valueLoss }] : [])];
  const shares = shareParts
    .map((p) => ({ ...p, share: total > 0 ? Math.round((p.total / total) * 1000) / 10 : null }))
    .sort((a, b) => b.total - a.total);

  return {
    currency: 'EUR',
    status: v.status,
    from,
    to: from ? to : null,
    ownershipDays: days,
    ownershipMonths: months,
    distanceKm: distance,
    purchase: { date: v.purchase_date, price: money(v.purchase_price) },
    sale: sold ? { date: v.sale_date, price: money(v.sale_price), odometerKm: v.sale_odometer_km } : null,
    residualValue: sold ? null : money(v.residual_value),
    // Womit der Wertverlust gerechnet ist: sale (Verkaufserlös), residual (geschätzter Restwert) oder null
    valueBasis: endValue === null ? null : sold ? 'sale' : 'residual',
    valueLoss,
    valueLossPerYear,
    running: {
      total: running.total,
      energy: running.energy,
      expenses: running.expenses,
      groups,
      categories: categories.map(({ share, ...c }) => c)
    },
    total,
    // false, solange der Wertverlust fehlt (Kaufpreis oder Verkaufserlös bzw. Restwert nicht angegeben)
    complete: valueLoss !== null,
    perMonth: months && total > 0 ? round2(total / Math.max(months, 1)) : null,
    perKm: distance && total > 0 ? round4(total / distance) : null,
    shares,
    categories
  };
}

module.exports = { getVehicleTco };
