// backend/src/services/reminders.js
// Fälligkeiten (TÜV, Wartung, Versicherung, Steuer) aus den erfassten Ausgaben ableiten.
// Regeln: TÜV alle 24 Monate, Wartung/Inspektion alle 12 Monate oder 15.000 km,
// Versicherung und Steuer jährlich – jeweils ab dem letzten Eintrag der Kategorie.
// Fahrzeugangaben (#45) gehen vor bzw. springen ein, wenn es keinen Eintrag gibt:
// - Erstzulassung: erster TÜV nach 36 Monaten – nur solange er bevorsteht. Danach ohne TÜV-Eintrag „unbekannt“:
//   wann zuletzt geprüft wurde, lässt sich aus der Erstzulassung nicht sagen.
// Reifen: nur zur Info (kind "info"), letzter Wechsel ohne Fälligkeit. Jede Zeile nennt Tachostand und Beschreibung
// des letzten Eintrags, damit Web-App und Apps dafür nicht alle Ausgaben laden müssen.
// - eigenes Wartungsintervall (Monate, km)
// - Fälligkeitsmonat von Versicherung und Steuer
const { canAccessVehicle } = require('./vehicleAccess');
const { currentOdometer } = require('./odometer');

const RULES = [
  { title: 'TÜV', categories: ['TUV'], months: 24, km: null },
  { title: 'Wartung / Inspektion', categories: ['Wartung', 'Inspektion'], months: 12, km: 15000 },
  { title: 'Versicherung', categories: ['Versicherung'], months: 12, km: null },
  { title: 'Kfz-Steuer', categories: ['Steuer'], months: 12, km: null },
  { title: 'Reifen', categories: ['Reifen'], months: null, km: null, info: true }
];

function toDateString(d) {
  return d.toISOString().slice(0, 10);
}

// Monate addieren wie PHP DateTime::modify('+N months') (31.01. + 1 Monat = 03.03.)
function addMonths(date, months) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * @param pool pg-Pool
 * @param {number} warnDays Vorlaufzeit in Tagen für "bald fällig"
 * @returns Liste mit title, category, last, due_date, due_km, status (ok|bald|ueberfaellig|unbekannt), days
 */
async function getVehicleReminders(pool, userId, vehicleId, warnDays = 30, today = new Date()) {
  // Zugriff (#53): Besitzer und Mitglieder; ohne Zugriff keine Termine
  if (!(await canAccessVehicle(pool, userId, vehicleId, 'read'))) return [];
  const categories = RULES.flatMap((r) => r.categories);
  const last = await pool.query(
    `SELECT DISTINCT ON (category) category, occurred_at, odometer_km, description
     FROM expenses
     WHERE vehicle_id = $1 AND category = ANY($2)
     ORDER BY category, occurred_at DESC, created_at DESC`,
    [vehicleId, categories]
  );
  // Jüngster echter Tachostand, nicht der höchste (services/odometer.js)
  const currentOdo = await currentOdometer(pool, vehicleId);

  const v = await pool.query(
    `SELECT first_registration, service_interval_months, service_interval_km, insurance_due_month, tax_due_month
     FROM vehicles WHERE id = $1`,
    [vehicleId]
  );
  const fz = v.rows[0] || {};

  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dayOf = (d) => { const x = new Date(d); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); };
  // Erster Tag des Monats m (1–12) frühestens ab "ab"
  const nextMonthStart = (m, ab) => {
    let d = new Date(Date.UTC(ab.getUTCFullYear(), m - 1, 1));
    if (d < new Date(Date.UTC(ab.getUTCFullYear(), ab.getUTCMonth(), 1))) d = new Date(Date.UTC(ab.getUTCFullYear() + 1, m - 1, 1));
    return d;
  };

  return RULES.map((rule) => {
    // Neuesten Eintrag aller Kategorien der Regel nehmen (Wartung oder Inspektion)
    const latest = last.rows
      .filter((r) => rule.categories.includes(r.category))
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))[0];

    const row = {
      title: rule.title,
      category: rule.categories[0],
      kind: rule.info ? 'info' : 'due', // info: nur letzter Eintrag, keine Fälligkeit (Reifen)
      last: null,
      last_odometer_km: latest && latest.odometer_km !== null ? Number(latest.odometer_km) : null,
      last_description: latest?.description || null,
      due_date: null,
      due_km: null,
      status: 'unbekannt',
      days: null,
      source: null // eintrag | erstzulassung | faelligkeitsmonat
    };
    const lastDay = latest ? dayOf(latest.occurred_at) : null;
    if (lastDay) row.last = toDateString(lastDay);
    if (rule.info) return row;
    const months = rule.categories[0] === 'Wartung' && fz.service_interval_months ? fz.service_interval_months : rule.months;
    const intervalKm = rule.km !== null && fz.service_interval_km ? fz.service_interval_km : rule.km;
    const dueMonth = rule.categories[0] === 'Versicherung' ? fz.insurance_due_month : rule.categories[0] === 'Steuer' ? fz.tax_due_month : null;

    let due = null;
    if (dueMonth) {
      // Fester Fälligkeitsmonat: nach einer Zahlung kommt der nächste Termin im Folgejahr
      due = nextMonthStart(dueMonth, lastDay ? addMonths(lastDay, 1) : todayUtc);
      row.source = 'faelligkeitsmonat';
    } else if (lastDay) {
      due = addMonths(lastDay, months);
      row.source = 'eintrag';
    } else if (rule.categories.includes('TUV') && fz.first_registration) {
      // Ohne TÜV-Eintrag: erster TÜV 36 Monate nach Erstzulassung – nur solange er bevorsteht (sonst unbekannt)
      const erster = addMonths(dayOf(fz.first_registration), 36);
      if (erster >= todayUtc) {
        due = erster;
        row.source = 'erstzulassung';
      }
    }
    if (!due) return row;

    const days = Math.round((due - todayUtc) / 86400000);
    row.due_date = toDateString(due);
    row.days = days;

    let restKm = null;
    if (intervalKm !== null && latest && latest.odometer_km !== null && currentOdo !== null) {
      row.due_km = latest.odometer_km + intervalKm;
      restKm = row.due_km - currentOdo;
    }

    // Ohne Eintrag lässt sich "überfällig" nicht sicher sagen (z. B. Steuer diesen Monat schon bezahlt)
    const sicher = row.source === 'eintrag' || (row.source === 'faelligkeitsmonat' && lastDay);
    if ((days < 0 && sicher) || (restKm !== null && restKm <= 0)) row.status = 'ueberfaellig';
    else if (days <= warnDays || (restKm !== null && restKm <= 1000)) row.status = 'bald';
    else row.status = 'ok';
    return row;
  });
}

module.exports = { getVehicleReminders, RULES };
