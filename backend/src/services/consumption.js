// Verbrauch, Mengen und CO₂ je Fahrzeug und Einheit (#82). Bisher rechnete das PHP-Frontend diese Werte aus den
// rohen Einträgen nach (includes/api_helpers.php: verbrauchAusTankfuellungen, getStatistikDatenFromApi).
// Grundlage sind die Full-to-Full-Abschnitte aus services/stats.js – es gibt nur diese eine Rechnung.
//
// - Abschnitte, Monate und Jahre je Einheit getrennt (Plug-in-Hybrid: Liter und kWh)
// - Ein Abschnitt gehört zu Tag, Monat und Jahr der vollen Füllung, die ihn abschließt (Europe/Berlin)
// - Monats- und Jahresverbrauch: Menge ÷ Strecke aller Abschnitte im Zeitraum (gewichtet, nicht Ø der Werte)
// - Gekaufte Menge und Kosten: alle Tank-/Ladevorgänge, auch ohne Tachostand
// - CO₂: gekaufte Menge × Emissionsfaktor (Verbrenner: direkte Emission, Strom: deutscher Strommix)

const { getVehicleStats, unitForFuelType } = require('./stats');

const TZ = 'Europe/Berlin';
const UNIT_ORDER = ['l', 'kwh', 'kg'];

// kg CO₂ je Einheit; Plug-in-Hybrid: Liter wie Benzin, kWh wie Strom
const CO2_FACTORS = {
  e5: 2.37, e10: 2.37, petrol: 2.37, hybrid: 2.37,
  diesel: 2.65,
  lpg: 1.64,
  cng: 2.79,
  electric: 0.363,
  hydrogen: 0.0
};

function co2Factor(fuelType, unit) {
  let f = String(fuelType || '').toLowerCase();
  if (f === 'phev') f = unit === 'kwh' ? 'electric' : 'e5';
  return Object.prototype.hasOwnProperty.call(CO2_FACTORS, f) ? CO2_FACTORS[f] : null;
}

const round = (x, n) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);

// Tag "JJJJ-MM-TT" in Europe/Berlin
function dayOf(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function rate(amount, km) {
  return km > 0 ? round((amount / km) * 100, 2) : null;
}

/**
 * Verbrauch je Einheit.
 * @returns {Promise<object|null>} null, wenn das Fahrzeug nicht dem Konto gehört
 */
async function getVehicleConsumption(db, userId, vehicleId) {
  const stats = await getVehicleStats(db, userId, vehicleId);
  if (stats?.error) return null;
  const v = await db.query('SELECT fuel_type FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, userId]);
  const fuelType = v.rows[0]?.fuel_type ?? null;

  const fills = await db.query(
    `SELECT unit, amount::float8 AS amount, total_cost_eur::float8 AS cost, filled_at
       FROM fillups WHERE user_id = $1 AND vehicle_id = $2`,
    [userId, vehicleId]
  );

  // Einheiten: vorhandene, die zur Antriebsart passende zuerst; ohne Einträge die Standardeinheit
  const present = new Set(fills.rows.map((f) => f.unit));
  if (!present.size) present.add(unitForFuelType(fuelType));
  const primary = unitForFuelType(fuelType);
  const units = [...present].sort((a, b) =>
    (a === primary ? -1 : b === primary ? 1 : 0) || UNIT_ORDER.indexOf(a) - UNIT_ORDER.indexOf(b));

  const byUnit = {};
  for (const unit of units) {
    const factor = co2Factor(fuelType, unit);

    // Abschnitte, älteste zuerst (stats liefert neueste zuerst)
    const segments = stats.segments
      .filter((s) => s.unit === unit && Number(s.km) > 0)
      .map((s) => {
        const date = dayOf(new Date(s.full_at));
        const km = Number(s.km);
        const amount = Number(s.liters_segment);
        return { fullId: s.full_id, date, month: date.slice(0, 7), year: Number(date.slice(0, 4)), km, amount: round(amount, 3), consumption: rate(amount, km) };
      })
      .reverse();

    const monthMap = new Map();
    for (const s of segments) {
      const m = monthMap.get(s.month) ?? { month: s.month, km: 0, amount: 0 };
      m.km += s.km;
      m.amount += s.amount;
      monthMap.set(s.month, m);
    }
    const months = [...monthMap.values()].map((m) => ({ month: m.month, km: m.km, amount: round(m.amount, 3), consumption: rate(m.amount, m.km) }));

    const yearMap = new Map();
    const year = (y) => {
      if (!yearMap.has(y)) yearMap.set(y, { year: y, fillCount: 0, amountBought: 0, cost: 0, amountConsumed: 0, kmConsumed: 0 });
      return yearMap.get(y);
    };
    const unitFills = fills.rows.filter((f) => f.unit === unit);
    for (const f of unitFills) {
      const y = year(Number(dayOf(new Date(f.filled_at)).slice(0, 4)));
      y.fillCount += 1;
      y.amountBought += Number(f.amount) || 0;
      y.cost += Number(f.cost) || 0;
    }
    for (const s of segments) {
      const y = year(s.year);
      y.amountConsumed += s.amount;
      y.kmConsumed += s.km;
    }
    const years = [...yearMap.values()]
      .sort((a, b) => b.year - a.year)
      .map((y) => ({
        year: y.year,
        fillCount: y.fillCount,
        amountBought: round(y.amountBought, 3),
        cost: round(y.cost, 2),
        amountConsumed: round(y.amountConsumed, 3),
        kmConsumed: y.kmConsumed,
        consumption: rate(y.amountConsumed, y.kmConsumed),
        co2Kg: factor === null ? null : round(y.amountBought * factor, 1)
      }));

    const kmConsumed = segments.reduce((a, s) => a + s.km, 0);
    const amountConsumed = segments.reduce((a, s) => a + s.amount, 0);
    const amountBought = unitFills.reduce((a, f) => a + (Number(f.amount) || 0), 0);
    const cost = unitFills.reduce((a, f) => a + (Number(f.cost) || 0), 0);
    const avg = rate(amountConsumed, kmConsumed);
    const values = segments.map((s) => s.consumption).filter((x) => x !== null);

    byUnit[unit] = {
      unit,
      avg,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      kmConsumed,
      amountConsumed: round(amountConsumed, 3),
      amountBought: round(amountBought, 3),
      cost: round(cost, 2),
      avgPrice: stats.units?.[unit]?.avgPrice !== undefined && stats.units[unit].avgPrice !== null ? Number(stats.units[unit].avgPrice) : null,
      fillCount: unitFills.length,
      co2: {
        factor,
        totalKg: factor === null ? null : round(amountBought * factor, 1),
        // g/km aus dem Ø-Verbrauch: l/100 km ÷ 100 × kg/l × 1000
        gPerKm: factor === null || avg === null ? null : round((avg / 100) * factor * 1000, 1)
      },
      segments: segments.map(({ year: _y, ...s }) => s),
      months,
      years
    };
  }

  // Summen über alle Einheiten (Plug-in-Hybrid: Kraftstoff und Strom)
  const list = Object.values(byUnit);
  const withCo2 = list.filter((u) => u.co2.totalKg !== null);
  const energyCost = round(list.reduce((a, u) => a + u.cost, 0), 2);
  return {
    fuelType,
    units,
    byUnit,
    energyCost,
    // Anteil der Ladekosten an den Energiekosten in %, nur bei mehreren Einheiten
    electricShare: units.length > 1 && byUnit.kwh && energyCost > 0 ? round((byUnit.kwh.cost / energyCost) * 100, 1) : null,
    co2: {
      totalKg: withCo2.length ? round(withCo2.reduce((a, u) => a + u.co2.totalKg, 0), 1) : null,
      gPerKm: list.some((u) => u.co2.gPerKm !== null) ? round(list.reduce((a, u) => a + (u.co2.gPerKm ?? 0), 0), 1) : null
    }
  };
}

module.exports = { getVehicleConsumption, co2Factor, CO2_FACTORS };
