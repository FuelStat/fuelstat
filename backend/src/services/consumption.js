// Verbrauch, Mengen und CO₂ je Fahrzeug und Einheit (#82). Bisher rechnete das PHP-Frontend diese Werte aus den
// rohen Einträgen nach (includes/api_helpers.php: verbrauchAusTankfuellungen, getStatistikDatenFromApi).
// Grundlage sind die Full-to-Full-Abschnitte aus services/stats.js – es gibt nur diese eine Rechnung.
//
// - Abschnitte, Monate und Jahre je Energieart getrennt (#140; Plug-in-Hybrid: Benzin und Strom, Autogas-Auto:
//   Autogas und Benzin). Sorten derselben Energieart (E5, E10, Super Plus) zählen zusammen.
// - byUnit (bisheriges Format) zeigt je Einheit die Hauptenergieart der Einheit, siehe stats.mainEnergies
// - Ein Abschnitt gehört zu Tag, Monat und Jahr der vollen Füllung, die ihn abschließt (Europe/Berlin)
// - Monats- und Jahresverbrauch: Menge ÷ Strecke aller Abschnitte im Zeitraum (gewichtet, nicht Ø der Werte)
// - Gekaufte Menge und Kosten: alle Tank-/Ladevorgänge, auch ohne Tachostand
// - CO₂: gekaufte Menge × Emissionsfaktor (Verbrenner: direkte Emission, Strom: deutscher Strommix)
// - Hauptkennzahl (#156): Plug-in-Hybride zeigen €/100 km über alle Energiearten (Benzin und Strom), alle anderen
//   Antriebsarten den Verbrauch je Einheit (l, kWh, kg /100 km). Die API legt das fest (`primary`), Clients zeigen es nur an.
//   €/100 km je Monat und Jahr: Energiekosten aller Tank-/Ladevorgänge im Zeitraum ÷ Strecke im Zeitraum aus echten
//   Tachoständen. Kostenlos geladen heißt 0 € (die Spalte ist NOT NULL), nicht „unbekannt“.

const { getVehicleStats, mainEnergies } = require('./stats');
const { ENERGIES, ENERGY_ORDER, FUELS, MINOR_SHARE, energyOf, vehicleFuels } = require('./fuels');
const { monthOf, periodDistance } = require('./costs');

const TZ = 'Europe/Berlin';
const UNIT_ORDER = ['l', 'kwh', 'kg'];
// Kürzeste Strecke (km), ab der ein Monat bei „günstigster/teuerster Monat“ zählt
const MIN_PERIOD_KM = 100;

const energyCo2 = (energy) => ENERGIES[energy]?.co2 ?? null;

const round = (x, n) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);

// Tag "JJJJ-MM-TT" in Europe/Berlin (Format einmal anlegen, siehe costs.monthOf)
const TAG_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function dayOf(date) {
  return TAG_FORMAT.format(date);
}

function rate(amount, km) {
  return km > 0 ? round((amount / km) * 100, 2) : null;
}

// Hauptkennzahl eines Fahrzeugs (#156). Die Antriebsart entscheidet, nicht der Client.
function primaryMetric(fuelType, costPer100km, mainUnit) {
  if (fuelType === 'phev' && costPer100km !== null) {
    return { metric: 'costPer100km', unit: 'eur_per_100km', value: costPer100km };
  }
  return { metric: 'consumption', unit: mainUnit?.unit ?? null, value: mainUnit?.avg ?? null };
}

/**
 * Verbrauch je Energieart, Preise je Sorte.
 * @returns {Promise<object|null>} null, wenn das Fahrzeug nicht dem Konto gehört
 */
async function getVehicleConsumption(db, userId, vehicleId) {
  const stats = await getVehicleStats(db, userId, vehicleId);
  if (stats?.error) return null;
  const v = await db.query('SELECT fuel_type, fuels, default_fuel FROM vehicles WHERE id = $1', [vehicleId]);
  const vehicle = v.rows[0] ?? {};
  const fuelType = vehicle.fuel_type ?? null;
  const { fuels: vehicleFuelList, defaultFuel } = vehicleFuels(vehicle);

  const fills = await db.query(
    `SELECT fuel, unit, amount::float8 AS amount, total_cost_eur::float8 AS cost, filled_at,
            CASE WHEN odometer_estimated THEN NULL ELSE odometer_km END AS odo, created_at
       FROM fillups WHERE vehicle_id = $1`,
    [vehicleId]
  );
  const rows = fills.rows.map((f) => ({ ...f, energy: energyOf(f.fuel) }));

  // Energiearten: die des Fahrzeugs (Standard zuerst), dann weitere vorhandene; ohne Einträge die des Standards
  const vehicleEnergies = [...new Set([defaultFuel, ...vehicleFuelList].map(energyOf))];
  const present = new Set(rows.map((r) => r.energy));
  const energies = [...new Set([...vehicleEnergies.filter((e) => present.has(e) || !present.size), ...present])]
    .filter((e) => present.has(e) || e === energyOf(defaultFuel))
    .sort((a, b) => {
      const ia = vehicleEnergies.indexOf(a);
      const ib = vehicleEnergies.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || ENERGY_ORDER.indexOf(a) - ENERGY_ORDER.indexOf(b);
    });

  const byEnergy = {};
  for (const energy of energies) {
    const unit = ENERGIES[energy]?.unit ?? 'l';
    const factor = energyCo2(energy);

    // Abschnitte, älteste zuerst (stats liefert neueste zuerst)
    const segments = stats.segments
      .filter((s) => s.energy === energy && Number(s.km) > 0)
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
    const energyFills = rows.filter((f) => f.energy === energy);
    for (const f of energyFills) {
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
    const amountBought = energyFills.reduce((a, f) => a + (Number(f.amount) || 0), 0);
    const cost = energyFills.reduce((a, f) => a + (Number(f.cost) || 0), 0);
    const avg = rate(amountConsumed, kmConsumed);
    const values = segments.map((s) => s.consumption).filter((x) => x !== null);

    byEnergy[energy] = {
      energy,
      name: ENERGIES[energy]?.name ?? energy,
      unit,
      avg,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      kmConsumed,
      amountConsumed: round(amountConsumed, 3),
      amountBought: round(amountBought, 3),
      cost: round(cost, 2),
      avgPrice: amountBought > 0 ? round(cost / amountBought, 3) : null,
      fillCount: energyFills.length,
      // Anteil an den Energiekosten in %, unten gesetzt
      costShare: null,
      minor: false,
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

  const energyList = Object.values(byEnergy);
  const energyCost = round(energyList.reduce((a, e) => a + e.cost, 0), 2);
  for (const e of energyList) {
    e.costShare = energyCost > 0 ? round((e.cost / energyCost) * 100, 1) : null;
    e.minor = energyList.length > 1 && e.costShare !== null && e.costShare < MINOR_SHARE;
  }

  // Preise und Anteile je Sorte (#140): Ø Preis, Anteil an der Menge der Energieart, Mehrpreis von Premium-Sorten
  const byFuel = {};
  for (const info of FUELS) {
    const list = rows.filter((r) => r.fuel === info.key);
    if (!list.length) continue;
    const amount = list.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const cost = list.reduce((a, r) => a + (Number(r.cost) || 0), 0);
    const energyAmount = byEnergy[info.energy]?.amountBought ?? 0;
    byFuel[info.key] = {
      fuel: info.key,
      name: info.name,
      energy: info.energy,
      unit: info.unit,
      premium: info.premium,
      fillCount: list.length,
      amount: round(amount, 3),
      cost: round(cost, 2),
      avgPrice: amount > 0 ? round(cost / amount, 3) : null,
      shareOfEnergy: energyAmount > 0 ? round((amount / energyAmount) * 100, 1) : null,
      markup: null
    };
  }
  // Mehrpreis: Premium-Sorte gegenüber dem Ø Preis der übrigen Sorten derselben Energieart (Menge gewichtet)
  for (const f of Object.values(byFuel)) {
    if (!f.premium || f.avgPrice === null) continue;
    const base = Object.values(byFuel).filter((x) => x.energy === f.energy && !x.premium && x.amount > 0);
    const baseAmount = base.reduce((a, x) => a + x.amount, 0);
    if (!baseAmount) continue;
    const basePrice = base.reduce((a, x) => a + x.cost, 0) / baseAmount;
    f.markup = { perUnit: round(f.avgPrice - basePrice, 3), percent: basePrice > 0 ? round(((f.avgPrice - basePrice) / basePrice) * 100, 1) : null, basePrice: round(basePrice, 3) };
  }

  // Energiekosten pro 100 km über alle Energiearten (wie costs.costPerKm.energy): Kosten aller Einträge mit echtem
  // Tachostand nach dem ersten, geteilt durch die Strecke vom ersten bis zum letzten
  const withOdo = rows.filter((r) => r.odo !== null && r.odo !== undefined)
    .sort((a, b) => a.odo - b.odo || new Date(a.filled_at) - new Date(b.filled_at) || new Date(a.created_at) - new Date(b.created_at));
  const span = withOdo.length > 1 ? withOdo[withOdo.length - 1].odo - withOdo[0].odo : 0;
  const costPer100km = span > 0 ? round((withOdo.slice(1).reduce((a, r) => a + (Number(r.cost) || 0), 0) / span) * 100, 2) : null;

  // €/100 km je Monat und Jahr (#156). Einzelne Monate schwanken stark, wenn selten getankt wird; Bestwerte und
  // schlechteste Werte zählen deshalb nur Zeiträume ab MIN_PERIOD_KM.
  const readings = withOdo.filter((r) => r.odo > 0).map((r) => ({ odo: r.odo, month: monthOf(new Date(r.filled_at)) }));
  const periodRates = (keyLength) => {
    const keyOf = (r) => r.month.slice(0, keyLength);
    const costByKey = new Map();
    for (const r of rows) {
      const k = monthOf(new Date(r.filled_at)).slice(0, keyLength);
      costByKey.set(k, (costByKey.get(k) ?? 0) + (Number(r.cost) || 0));
    }
    return [...costByKey.keys()].sort().reverse().map((key) => {
      const distanceKm = periodDistance(readings, keyOf, key);
      const cost = round(costByKey.get(key), 2);
      return { period: key, cost, distanceKm, costPer100km: distanceKm ? round((cost / distanceKm) * 100, 2) : null };
    });
  };
  const rateMonths = periodRates(7);
  const rateYears = periodRates(4);
  const ranked = rateMonths.filter((m) => m.costPer100km !== null && m.distanceKm >= MIN_PERIOD_KM);
  const best = ranked.length > 1 ? ranked.reduce((a, b) => (b.costPer100km < a.costPer100km ? b : a)) : null;
  const worst = ranked.length > 1 ? ranked.reduce((a, b) => (b.costPer100km > a.costPer100km ? b : a)) : null;

  // Bisheriges Format je Einheit: die Hauptenergieart der Einheit
  const mainByUnit = mainEnergies(vehicle, energies.map((e) => ({ energy: e, count: byEnergy[e].fillCount })));
  const units = Object.keys(mainByUnit)
    .filter((u) => byEnergy[mainByUnit[u]])
    .sort((a, b) => {
      const ea = energies.indexOf(mainByUnit[a]);
      const eb = energies.indexOf(mainByUnit[b]);
      return ea - eb || UNIT_ORDER.indexOf(a) - UNIT_ORDER.indexOf(b);
    });
  const byUnit = {};
  for (const unit of units) {
    const { energy, name: _n, costShare: _c, minor: _m, ...rest } = byEnergy[mainByUnit[unit]];
    byUnit[unit] = { ...rest, unit, energy };
  }

  const withCo2 = energyList.filter((e) => e.co2.totalKg !== null);
  return {
    fuelType,
    fuels: vehicleFuelList,
    defaultFuel,
    units,
    byUnit,
    energies,
    byEnergy,
    byFuel,
    energyCost,
    costPer100km,
    // Hauptkennzahl (#156): Plug-in-Hybrid €/100 km, sonst der Verbrauch der Hauptenergieart. Ohne berechenbare Kosten
    // (noch keine Strecke) bleibt es beim Verbrauch.
    primary: primaryMetric(fuelType, costPer100km, units[0] ? byUnit[units[0]] : null),
    // €/100 km je Monat und Jahr, neueste zuerst; costPer100km null ohne Strecke. best/worst: Monate ab MIN_PERIOD_KM
    costPer100kmPeriods: { months: rateMonths, years: rateYears, best, worst, minPeriodKm: MIN_PERIOD_KM },
    // Anteil der Ladekosten an den Energiekosten in %, nur bei mehreren Energiearten
    electricShare: energies.length > 1 && byEnergy.electricity && energyCost > 0 ? round((byEnergy.electricity.cost / energyCost) * 100, 1) : null,
    co2: {
      totalKg: withCo2.length ? round(withCo2.reduce((a, e) => a + e.co2.totalKg, 0), 1) : null,
      gPerKm: energyList.some((e) => e.co2.gPerKm !== null) ? round(energyList.reduce((a, e) => a + (e.co2.gPerKm ?? 0), 0), 1) : null
    }
  };
}

/**
 * Hauptkennzahl für /stats (#156), damit Fahrzeugkarte und Start sie ohne zweiten Aufruf bekommen. Nur Plug-in-Hybride
 * brauchen die Verbrauchsrechnung (€/100 km); alle anderen Antriebsarten ergeben sich aus den Stats.
 */
async function primaryForStats(db, userId, vehicleId, stats) {
  const v = await db.query('SELECT fuel_type FROM vehicles WHERE id = $1', [vehicleId]);
  if (v.rows[0]?.fuel_type === 'phev') {
    const c = await getVehicleConsumption(db, userId, vehicleId);
    if (c) return c.primary;
  }
  return { metric: 'consumption', unit: Object.keys(stats.units ?? {})[0] ?? null, value: stats.avgConsumption ?? null };
}

module.exports = { getVehicleConsumption, primaryForStats };
