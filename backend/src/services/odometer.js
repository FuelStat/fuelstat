// Plausibilitätsprüfung des Tachostands (#51), dieselben Regeln wie im Formular (includes/tacho_pruefung.php):
// kleiner als ein früherer Eintrag, größer als ein späterer, unplausibler Sprung (> 2.000 km und > 800 km/Tag),
// kleiner als bei Anschaffung. Das Ergebnis sind Warnungen, keine Ablehnung (z. B. nach einem Tachotausch).
// Einträge ohne Tachostand oder mit geschätztem Wert (#41) zählen nicht.

const JUMP_KM = 2000;
const JUMP_KM_PER_DAY = 800;

const fmtKm = (n) => Number(n).toLocaleString('de-DE') + ' km';
const fmtDate = (d) => d.split('-').reverse().join('.');
const dayOf = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * Reine Prüfung ohne Datenbank.
 * @param {{date: string, km: number}[]} points  bekannte, echte Tachostände (Datum YYYY-MM-DD)
 * @param {{date: string, km: number|null}} candidate  zu prüfender Wert
 * @param {number|null} purchaseKm  Tachostand bei Anschaffung
 * @returns {{code: string, message: string, refDate?: string, refKm?: number}[]}
 */
function odometerWarnings(points, candidate, purchaseKm = null) {
  if (candidate.km === null || candidate.km === undefined || !Number.isFinite(Number(candidate.km))) return [];
  const km = Number(candidate.km);
  const d = dayOf(candidate.date);
  let before = null;
  let after = null;
  for (const p of points) {
    const pd = dayOf(p.date);
    const pk = Number(p.km);
    if (pd < d && (!before || pk > before.km)) before = { date: pd, km: pk };
    if (pd > d && (!after || pk < after.km)) after = { date: pd, km: pk };
  }
  if (before && km < before.km) {
    return [{ code: 'lower_than_previous', refDate: before.date, refKm: before.km,
      message: `Niedriger als der Tachostand vom ${fmtDate(before.date)} (${fmtKm(before.km)}).` }];
  }
  if (after && km > after.km) {
    return [{ code: 'higher_than_next', refDate: after.date, refKm: after.km,
      message: `Höher als der Tachostand vom ${fmtDate(after.date)} (${fmtKm(after.km)}).` }];
  }
  if (before) {
    const diff = km - before.km;
    const days = Math.max(1, daysBetween(before.date, d));
    if (diff > JUMP_KM && diff / days > JUMP_KM_PER_DAY) {
      return [{ code: 'jump', refDate: before.date, refKm: before.km,
        message: `${fmtKm(diff)} seit dem ${fmtDate(before.date)} (${days === 1 ? 'an einem Tag' : 'in ' + days + ' Tagen'}).` }];
    }
  } else if (purchaseKm !== null && purchaseKm !== undefined && km < Number(purchaseKm)) {
    return [{ code: 'below_purchase', refKm: Number(purchaseKm),
      message: `Niedriger als der Tachostand bei Anschaffung (${fmtKm(purchaseKm)}).` }];
  }
  return [];
}

/** Bekannte echte Tachostände eines Fahrzeugs (Tankfüllungen, Ladungen und Ausgaben), optional ohne einen Eintrag. */
async function loadOdometerPoints(db, userId, vehicleId, excludeId = null) {
  const r = await db.query(
    `SELECT id, filled_at AS at, odometer_km AS km FROM fillups
       WHERE vehicle_id = $1 AND odometer_km IS NOT NULL AND NOT odometer_estimated
     UNION ALL
     SELECT id, occurred_at AS at, odometer_km AS km FROM expenses
       WHERE vehicle_id = $1 AND odometer_km IS NOT NULL`,
    [vehicleId]
  );
  // Aufrufer prüfen den Zugriff aufs Fahrzeug (#53); die Punkte gehören zum Fahrzeug, egal wer sie erfasst hat
  const v = await db.query('SELECT odometer_km FROM vehicles WHERE id = $1', [vehicleId]);
  return {
    points: r.rows.filter((p) => String(p.id) !== String(excludeId)).map((p) => ({ id: p.id, date: dayOf(p.at), km: Number(p.km) })),
    purchaseKm: v.rows[0]?.odometer_km ?? null
  };
}

/** Warnungen für einen gerade gespeicherten Eintrag (er selbst wird ausgenommen). */
async function checkOdometer(db, userId, vehicleId, row) {
  if (!row || row.odometer_km === null || row.odometer_km === undefined || row.odometer_estimated) return [];
  const { points, purchaseKm } = await loadOdometerPoints(db, userId, vehicleId, row.id);
  return odometerWarnings(points, { date: row.filled_at ?? row.occurred_at, km: row.odometer_km }, purchaseKm);
}

module.exports = { odometerWarnings, loadOdometerPoints, checkOdometer };
