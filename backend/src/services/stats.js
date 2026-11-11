// backend/src/services/stats.js
const { canAccessVehicle } = require('./vehicleAccess');
const { energySql, vehicleFuels, energyOf, unitOf, ENERGIES, ENERGY_ORDER, MINOR_SHARE } = require('./fuels');

// Antriebsarten; 'phev' (Plug-in-Hybrid) tankt und lädt
const FUEL_TYPES = new Set(['diesel', 'e5', 'e10', 'lpg', 'cng', 'electric', 'hybrid', 'phev', 'hydrogen', 'other']);

// Mengeneinheit aus dem Kraftstoff des Fahrzeugs (Standard für neue Einträge)
function unitForFuelType(fuelType) {
  const f = String(fuelType || '').toLowerCase();
  if (f === 'electric') return 'kwh';
  if (f === 'cng' || f === 'hydrogen') return 'kg';
  return 'l';
}

// Alle Einheiten, die ein Fahrzeug haben kann; die erste ist der Standard
function unitsForFuelType(fuelType) {
  return String(fuelType || '').toLowerCase() === 'phev' ? ['l', 'kwh'] : [unitForFuelType(fuelType)];
}

/**
 * Je Einheit die Energieart, die für die bisherigen Felder je Einheit (units, byUnit) steht: die des Standards,
 * sonst die erste Sorte des Fahrzeugs mit dieser Einheit, sonst die vorhandene Energieart mit den meisten Einträgen.
 * Bei Fahrzeugen mit einer Energieart je Einheit (alle vor #140) ist das genau die bisherige Rechnung.
 */
function mainEnergies(vehicleRow, presentEnergies) {
  const { fuels, defaultFuel } = vehicleFuels(vehicleRow);
  const vehicleOrder = [...new Set([defaultFuel, ...fuels].map(energyOf))];
  const unitOfEnergy = (e) => ENERGIES[e]?.unit ?? 'l';
  const result = {};
  const unitsAll = new Set([...vehicleOrder, ...presentEnergies.map((p) => p.energy)].map(unitOfEnergy));
  for (const unit of unitsAll) {
    const withEntries = presentEnergies.filter((p) => unitOfEnergy(p.energy) === unit);
    // Vorhandene Einträge gehen vor: ein Benzin-/LPG-Auto ohne LPG-Einträge zeigt unter "l" weiter Benzin
    const fromVehicle = vehicleOrder.find((e) => unitOfEnergy(e) === unit && (!withEntries.length || withEntries.some((p) => p.energy === e)));
    result[unit] = fromVehicle ?? [...withEntries].sort((x, y) => y.count - x.count)[0].energy;
  }
  return result;
}

function trendOf(allRows) {
  // Abschnitte ohne Strecke (zwei volle Einträge beim selben Tachostand) haben keinen Verbrauch
  const segRows = allRows.filter(x => x.l_per_100km !== null);
  if (segRows.length < 2) return null;
  const current = Number(segRows[0].l_per_100km);
  const prev = segRows.slice(1, 4).map(x => Number(x.l_per_100km)).filter(Number.isFinite);
  if (!Number.isFinite(current) || !prev.length) return null;
  const avgPrev = prev.reduce((a, b) => a + b, 0) / prev.length;
  return {
    current: Number(current.toFixed(2)),
    avgPrev: Number(avgPrev.toFixed(2)),
    diff: Number((current - avgPrev).toFixed(2))
  };
}

async function getVehicleStats(pool, userId, vehicleId) {
  // Zugriff (#53): Besitzer und Mitglieder; Daten gehören zum Fahrzeug, nicht zu dem, der sie erfasst hat
  if (!(await canAccessVehicle(pool, userId, vehicleId, 'read'))) return { error: 'vehicle_not_found' };
  const v = await pool.query('SELECT fuel_type, fuels, default_fuel, odometer_km FROM vehicles WHERE id = $1', [vehicleId]);
  if (v.rowCount === 0) return { error: 'vehicle_not_found' };
  const primaryUnit = unitOf(vehicleFuels(v.rows[0]).defaultFuel);

  // Geschätzte Tachostände (#41) sind nur Platzhalter und zählen nirgends mit
  const odo = await pool.query(
    // Aktueller Tachostand: höchster echter Wert aus Tank-/Ladevorgängen und Ausgaben (inkl. "km notieren", #42)
    `SELECT GREATEST(
              MAX(odometer_km) FILTER (WHERE NOT odometer_estimated),
              (SELECT MAX(odometer_km) FROM expenses WHERE vehicle_id=$1),
              (SELECT MAX(odometer_end) FROM trips WHERE vehicle_id=$1)
            ) AS max_odo,
            COUNT(*) FILTER (WHERE odometer_km IS NULL OR odometer_estimated)::int AS missing,
            MIN(odometer_km) FILTER (WHERE NOT odometer_estimated) AS first_odo
     FROM fillups WHERE vehicle_id=$1`,
    [vehicleId]
  );
  const currentOdo = odo.rows[0]?.max_odo ?? null;
  const missingOdometer = odo.rows[0]?.missing ?? 0;

  // Fahrleistung (#82): seit Anschaffung (Tachostand beim Anlegen), sonst seit dem ersten echten Tachostand
  // eines Tank-/Ladevorgangs; ohne aktuellen Tachostand null
  const initialOdo = v.rows[0].odometer_km;
  const firstOdo = odo.rows[0]?.first_odo ?? null;
  let distance = null;
  if (currentOdo !== null) {
    if (initialOdo !== null && Number(initialOdo) <= Number(currentOdo)) {
      distance = { km: Number(currentOdo) - Number(initialOdo), since: 'purchase' };
    } else if (firstOdo !== null) {
      distance = { km: Number(currentOdo) - Number(firstOdo), since: 'firstEntry' };
    }
  }

  // Ø Preis je Energieart (#140; bisher je Einheit – Benzin und Autogas sind beide Liter)
  const ppl = await pool.query(
    `SELECT ${energySql('fuel')} AS energy, COUNT(*)::int AS count, COALESCE(SUM(total_cost_eur), 0)::float8 AS cost,
       CASE WHEN SUM(amount) > 0
         THEN ROUND((SUM(total_cost_eur) / SUM(amount))::numeric, 3)
         ELSE NULL
       END AS avg_price
     FROM fillups
     WHERE vehicle_id=$1
     GROUP BY 1`,
    [vehicleId]
  );

  // Full-to-Full-Abschnitte je Energieart (#140): Benzin von Tankfüllung zu Tankfüllung (E5, E10, Super Plus
  // gemeinsam), Autogas getrennt davon, kWh von Ladung zu Ladung
  const segments = await pool.query(
    `
    WITH ordered AS (
      -- Reihenfolge: Zeitpunkt, bei gleichem Zeitpunkt (z. B. importierte Ladungen eines Tages) der Tachostand.
      -- Einträge ohne (echten) Tachostand stehen bei gleichem Zeitpunkt hinter denen mit Tachostand, ihre Menge
      -- zählt also zum nächsten Abschnitt; untereinander entscheidet die Erfassungsreihenfolge.
      SELECT id, filled_at, odometer_km, amount, unit, ${energySql('fuel')} AS energy, is_full, skip_previous,
        (odometer_km IS NOT NULL AND NOT odometer_estimated) AS has_km,
        ROW_NUMBER() OVER (ORDER BY filled_at, odometer_km NULLS LAST, created_at) AS rn
      FROM fillups
      WHERE vehicle_id=$1
    ),
    fulls AS (
      SELECT *,
        LAG(odometer_km) OVER (PARTITION BY energy ORDER BY rn) AS prev_full_odo,
        LAG(rn) OVER (PARTITION BY energy ORDER BY rn) AS prev_full_rn
      FROM ordered
      -- Ohne echten Tachostand schließt auch eine Vollbetankung keinen Abschnitt ab (#41): Sie zählt wie eine
      -- Teilbetankung, ihre Menge fließt in den nächsten vollen Abschnitt mit Tachostand ein.
      WHERE is_full = true AND has_km
    ),
    seg AS (
      SELECT
        f.id AS full_id,
        f.filled_at AS full_at,
        f.unit,
        f.energy,
        f.rn,
        (f.odometer_km - f.prev_full_odo) AS km,
        (
          SELECT COALESCE(SUM(o.amount),0)
          FROM ordered o
          WHERE o.energy = f.energy AND o.rn > f.prev_full_rn AND o.rn <= f.rn
        ) AS liters_segment
      FROM fulls f
      -- skip_previous: Vollbetankung ist nur neuer Startpunkt (vorherige Tankfüllungen fehlen)
      WHERE f.prev_full_rn IS NOT NULL AND f.skip_previous = false
    )
    SELECT
      full_id, full_at, unit, energy, km, liters_segment,
      CASE WHEN km > 0 THEN ROUND(((liters_segment / km) * 100)::numeric, 2) ELSE NULL END AS l_per_100km
    FROM seg
    ORDER BY rn DESC
    `,
    [vehicleId]
  );

  const segRows = segments.rows;
  const energyCost = ppl.rows.reduce((a, r) => a + Number(r.cost), 0);
  const energies = {};
  for (const row of [...ppl.rows].sort((a, b) => ENERGY_ORDER.indexOf(a.energy) - ENERGY_ORDER.indexOf(b.energy))) {
    const segs = segRows.filter(s => s.energy === row.energy && Number(s.km) > 0);
    // Ø Verbrauch über alle Abschnitte (gewichtet nach km); beim Plug-in-Hybrid aussagekräftiger als der letzte Abschnitt
    const km = segs.reduce((a, x) => a + Number(x.km), 0);
    const amount = segs.reduce((a, x) => a + Number(x.liters_segment), 0);
    energies[row.energy] = {
      unit: ENERGIES[row.energy]?.unit ?? 'l',
      avgPrice: row.avg_price,
      avgConsumption: km > 0 ? Number((amount / km * 100).toFixed(2)) : null,
      trend: trendOf(segs),
      // Nebenbei getankt (#140, wie in /consumption): Verbrauch nicht als Wert zeigen
      minor: ppl.rows.length > 1 && energyCost > 0 && (Number(row.cost) / energyCost) * 100 < MINOR_SHARE
    };
  }

  // Bisherige Werte je Einheit: die Hauptenergieart der Einheit (bei Fahrzeugen vor #140 genau die bisherige Rechnung)
  const mainByUnit = mainEnergies(v.rows[0], ppl.rows.map((r) => ({ energy: r.energy, count: r.count })));
  const units = {};
  for (const [unit, energy] of Object.entries(mainByUnit)) {
    if (energies[energy]) {
      const { unit: _u, ...rest } = energies[energy];
      units[unit] = { ...rest, energy };
    }
  }

  // Passt die Einheit der Einträge nicht zur Antriebsart (z. B. später geändert), zählt die einzige vorhandene
  const unitKeys = Object.keys(units);
  const main = units[primaryUnit] ?? (unitKeys.length === 1 ? units[unitKeys[0]] : null);

  return {
    currentOdo,
    // Tank- und Ladevorgänge ohne echten Tachostand (fehlt oder nur geschätzt) – zum Nachtragen
    missingOdometer,
    // Gefahrene km: { km, since: 'purchase' | 'firstEntry' } oder null
    distance,
    // Für Fahrzeuge mit einer Einheit wie bisher; Plug-in-Hybride: Werte des Kraftstoffs, alles Weitere in units
    avgPricePerLiter: main?.avgPrice ?? null,
    // Ø Verbrauch über alle Abschnitte (gewichtet nach km); trend.current ist nur der letzte Abschnitt
    avgConsumption: main?.avgConsumption ?? null,
    segments: segRows,
    trend: main?.trend ?? null,
    // Je Einheit die Werte der Hauptenergieart der Einheit (bisheriges Format)
    units,
    // Je Energieart (#140): petrol, diesel, lpg, cng, electricity, hydrogen, other
    energies
  };
}

module.exports = { getVehicleStats, FUEL_TYPES, unitForFuelType, unitsForFuelType, mainEnergies };
