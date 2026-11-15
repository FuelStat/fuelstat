// Service-Historie je Bauteil (#78): Bauteile an Werkstatt-, Wartungs-, Reparatur- und Reifen-Einträgen, eigene
// Bauteile je Fahrzeug, Lebensdauer (km und Monate zwischen zwei Wechseln) und nächster Wechsel.
//
// Regeln:
// - Eingebaute Bauteile haben feste Schlüssel (wie die Kategorien); eigene Bauteile gehören zum Fahrzeug,
//   Schlüssel "custom:<uuid>". Namen und Icons dürfen sich ändern, Clients zeigen die Angaben der API.
// - Es gibt keine Standardintervalle je Bauteil: Fälligkeit kommt aus dem eigenen Intervall am Fahrzeug oder, ohne
//   Intervall, aus der bisherigen Ø-Lebensdauer (mindestens zwei Wechsel, Quelle "lifetime", nur eine Schätzung).
//   Motoröl nutzt vehicles.oil_interval_months/km, der Wert steht nur dort.
// - Kosten je Bauteil: der Anteil, wenn angegeben; der ganze Eintrag nur bei genau einem Bauteil; sonst unbekannt
//   (nie gleichmäßig verteilt).
// - Lebensdauer braucht zwei Wechsel desselben Bauteils; km nur, wenn beide einen Tachostand haben.
const { canAccessVehicle } = require('./vehicleAccess');
const { currentOdometer } = require('./odometer');

// Gruppen: Anzeige in Gruppen, nicht fest vorgeschrieben
const BUILTIN = [
  { key: 'oil', name: 'Motoröl & Filter', icon: 'fa-oil-can', group: 'motor' },
  { key: 'spark_plugs', name: 'Zündkerzen', icon: 'fa-bolt', group: 'motor' },
  { key: 'timing_belt', name: 'Zahnriemen', icon: 'fa-gear', group: 'motor' },
  { key: 'brake_pads_front', name: 'Bremsbeläge vorn', icon: 'fa-compact-disc', group: 'bremsen' },
  { key: 'brake_pads_rear', name: 'Bremsbeläge hinten', icon: 'fa-compact-disc', group: 'bremsen' },
  { key: 'brake_discs', name: 'Bremsscheiben', icon: 'fa-circle-notch', group: 'bremsen' },
  { key: 'brake_fluid', name: 'Bremsflüssigkeit', icon: 'fa-droplet', group: 'bremsen' },
  { key: 'tires_summer', name: 'Sommerreifen', icon: 'fa-sun', group: 'reifen' },
  { key: 'tires_winter', name: 'Winterreifen', icon: 'fa-snowflake', group: 'reifen' },
  { key: 'battery_12v', name: 'Batterie (12 V)', icon: 'fa-car-battery', group: 'sonstiges' },
  { key: 'cabin_filter', name: 'Innenraumfilter', icon: 'fa-wind', group: 'sonstiges' },
  { key: 'ac_service', name: 'Klimaservice', icon: 'fa-temperature-low', group: 'sonstiges' }
];
const BUILTIN_BY_KEY = Object.fromEntries(BUILTIN.map((p) => [p.key, p]));
const GROUPS = [
  { key: 'motor', name: 'Motor' },
  { key: 'bremsen', name: 'Bremsen' },
  { key: 'reifen', name: 'Reifen' },
  { key: 'sonstiges', name: 'Sonstiges' }
];
const CUSTOM_PREFIX = 'custom:';
const CUSTOM_ICON = 'fa-screwdriver-wrench';
const NAME_MAX = 40;
const MAX_CUSTOM_PARTS = 30;
const MAX_PARTS_PER_ENTRY = 12;
const HISTORY_LIMIT = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86400000;
const MONTH_DAYS = 30.4375;

const isCustomKey = (key) => String(key || '').startsWith(CUSTOM_PREFIX);

/** Eingebaute und eigene Bauteile eines Fahrzeugs als Liste für Formulare und Auswahl */
async function loadCatalog(db, vehicleId) {
  const r = await db.query('SELECT id, name, created_at FROM vehicle_parts WHERE vehicle_id = $1 ORDER BY lower(name)', [vehicleId]);
  const custom = r.rows.map((p) => ({ key: CUSTOM_PREFIX + p.id, name: p.name, icon: CUSTOM_ICON, group: 'eigene', builtin: false, id: p.id }));
  return [...BUILTIN.map((p) => ({ ...p, builtin: true })), ...custom];
}

/**
 * Bauteile aus der Anfrage prüfen: [{ key, costShare }] oder nur Schlüssel. undefined = nicht gesendet (unverändert).
 * @returns {Promise<{ parts?: Array<{key, costShare}>, error?: string }>}
 */
async function parseParts(db, vehicleId, raw, amountEur) {
  if (raw === undefined) return {};
  if (raw === null) return { parts: [] };
  if (!Array.isArray(raw)) return { error: 'invalid_parts' };
  if (raw.length > MAX_PARTS_PER_ENTRY) return { error: 'too_many_parts', max: MAX_PARTS_PER_ENTRY };
  const catalog = raw.length ? await loadCatalog(db, vehicleId) : [];
  const known = new Set(catalog.map((p) => p.key));
  const parts = [];
  const seen = new Set();
  for (const item of raw) {
    const key = typeof item === 'string' ? item : item?.key;
    if (typeof key !== 'string' || !known.has(key)) return { error: 'unknown_part', key: typeof key === 'string' ? key : null };
    if (seen.has(key)) return { error: 'duplicate_part', key };
    seen.add(key);
    let costShare = typeof item === 'object' ? item.costShare : undefined;
    if (costShare === undefined || costShare === null || costShare === '') costShare = null;
    else {
      costShare = Number(costShare);
      if (!Number.isFinite(costShare) || costShare < 0) return { error: 'invalid_costShare', key };
      costShare = Math.round(costShare * 100) / 100;
    }
    parts.push({ key, costShare });
  }
  const sum = parts.reduce((a, p) => a + (p.costShare ?? 0), 0);
  if (amountEur !== undefined && sum > Number(amountEur) + 0.005) return { error: 'cost_share_exceeds_amount' };
  return { parts };
}

/** Bauteile eines Eintrags ersetzen (in der Transaktion des Aufrufers) */
async function saveParts(db, expenseId, parts) {
  await db.query('DELETE FROM expense_parts WHERE expense_id = $1', [expenseId]);
  for (const p of parts) {
    await db.query('INSERT INTO expense_parts (expense_id, part_key, cost_share) VALUES ($1, $2, $3)', [expenseId, p.key, p.costShare]);
  }
}

/** Anzeigeform für Antworten: [{ key, name, cost_share }] zu Schlüsseln und Anteilen; Namen aus dem Katalog */
function describeParts(rows, catalogByKey) {
  return rows.map((p) => ({ key: p.part_key ?? p.key, name: catalogByKey[p.part_key ?? p.key]?.name ?? 'Bauteil', cost_share: p.cost_share === null || p.cost_share === undefined ? null : Number(p.cost_share) }));
}

/** Bauteile je Eintrag für mehrere Einträge: Map expenseId → [{ key, name, cost_share }] (Namen aus dem Fahrzeug) */
async function partsByExpense(db, vehicleId, expenseIds) {
  const map = new Map();
  if (!expenseIds.length) return map;
  const [rows, catalog] = await Promise.all([
    db.query('SELECT expense_id, part_key, cost_share FROM expense_parts WHERE expense_id = ANY($1::uuid[]) ORDER BY part_key', [expenseIds]),
    loadCatalog(db, vehicleId)
  ]);
  const byKey = Object.fromEntries(catalog.map((p) => [p.key, p]));
  for (const r of rows.rows) {
    if (!map.has(r.expense_id)) map.set(r.expense_id, []);
    map.get(r.expense_id).push(...describeParts([r], byKey));
  }
  return map;
}

const toDay = (d) => new Date(Date.UTC(new Date(d).getUTCFullYear(), new Date(d).getUTCMonth(), new Date(d).getUTCDate()));
const dayString = (d) => d.toISOString().slice(0, 10);
const round1 = (x) => Math.round(x * 10) / 10;

// Monate addieren wie in services/reminders.js
function addMonths(date, months) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Lebensdauer aus den Wechseln eines Bauteils (neueste zuerst oder beliebig): Abstände zwischen aufeinanderfolgenden
 * Wechseln in km und Monaten. null bei weniger als zwei Wechseln. km zählen nur, wenn beide Wechsel einen Tachostand
 * haben und der Stand nicht zurückgeht.
 */
function lifetimeOf(changes) {
  const sorted = [...changes].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (sorted.length < 2) return null;
  const kms = [];
  const months = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const days = (toDay(cur.date) - toDay(prev.date)) / DAY_MS;
    if (days > 0) months.push(days / MONTH_DAYS);
    if (prev.odometer_km !== null && cur.odometer_km !== null && cur.odometer_km > prev.odometer_km) kms.push(cur.odometer_km - prev.odometer_km);
  }
  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const last = { km: kms.length ? kms[kms.length - 1] : null, months: months.length ? round1(months[months.length - 1]) : null };
  return {
    changes: sorted.length,
    avgKm: kms.length ? Math.round(avg(kms)) : null,
    avgMonths: months.length ? round1(avg(months)) : null,
    lastKm: last.km,
    lastMonths: last.months
  };
}

/**
 * Nächster Wechsel: aus dem eigenen Intervall (Quelle "interval", Zeit und/oder km, was zuerst kommt) oder, ohne
 * Intervall, aus der Ø-Lebensdauer (Quelle "lifetime", nur geschätzt, nie „überfällig“). Ohne beides null.
 */
function nextChange({ last, interval, lifetime, currentOdo, warnDays = 30, today = new Date() }) {
  if (!last) return null;
  const lastDay = toDay(last.date);
  const todayUtc = toDay(today);
  let months = interval?.months ?? null;
  let km = interval?.km ?? null;
  let source = 'interval';
  if (months === null && km === null) {
    if (!lifetime || (lifetime.avgMonths === null && lifetime.avgKm === null)) return null;
    months = lifetime.avgMonths !== null ? Math.round(lifetime.avgMonths) : null;
    km = lifetime.avgKm;
    source = 'lifetime';
  }
  const due = months !== null ? addMonths(lastDay, months) : null;
  const dueKm = km !== null && last.odometer_km !== null ? last.odometer_km + km : null;
  const days = due ? Math.round((due - todayUtc) / DAY_MS) : null;
  const restKm = dueKm !== null && currentOdo !== null && currentOdo !== undefined ? dueKm - currentOdo : null;
  if (due === null && dueKm === null) return null;
  let status = 'ok';
  const overdue = (days !== null && days < 0) || (restKm !== null && restKm <= 0);
  const soon = (days !== null && days <= warnDays) || (restKm !== null && restKm <= 1000);
  // Eine Schätzung aus der Lebensdauer heißt nie „überfällig“ (kein Mail, kein Alarm), höchstens „bald“
  if (overdue) status = source === 'lifetime' ? 'bald' : 'ueberfaellig';
  else if (soon) status = 'bald';
  return { due_date: due ? dayString(due) : null, due_km: dueKm, days, status, source };
}

/** Intervalle des Fahrzeugs je Bauteil: Map key → { months, km }; Öl aus den Fahrzeugspalten */
async function loadIntervals(db, vehicleId) {
  const [r, v] = await Promise.all([
    db.query('SELECT part_key, interval_months, interval_km FROM vehicle_part_intervals WHERE vehicle_id = $1', [vehicleId]),
    db.query('SELECT oil_interval_months, oil_interval_km FROM vehicles WHERE id = $1', [vehicleId])
  ]);
  const map = new Map(r.rows.map((x) => [x.part_key, { months: x.interval_months, km: x.interval_km }]));
  const oil = v.rows[0];
  if (oil && (oil.oil_interval_months || oil.oil_interval_km)) map.set('oil', { months: oil.oil_interval_months ?? null, km: oil.oil_interval_km ?? null });
  return map;
}

/** Alle Wechsel des Fahrzeugs: Zeilen mit Bauteil, Datum, Tachostand, Kosten, Anbieter */
async function loadChanges(db, vehicleId) {
  const r = await db.query(
    `SELECT ep.part_key, ep.cost_share, e.id AS entry_id, e.category, e.occurred_at AS date, e.odometer_km, e.amount_eur::float8 AS amount,
            e.vendor, e.description,
            (SELECT COUNT(*)::int FROM expense_parts x WHERE x.expense_id = e.id) AS parts_in_entry
       FROM expense_parts ep JOIN expenses e ON e.id = ep.expense_id
      WHERE e.vehicle_id = $1
      ORDER BY e.occurred_at DESC, e.created_at DESC`,
    [vehicleId]
  );
  return r.rows.map((x) => ({
    part_key: x.part_key,
    entry_id: x.entry_id,
    category: x.category,
    date: x.date,
    odometer_km: x.odometer_km === null ? null : Number(x.odometer_km),
    // Kostenanteil, sonst der ganze Eintrag bei genau einem Bauteil, sonst unbekannt
    cost: x.cost_share !== null ? Number(x.cost_share) : x.parts_in_entry === 1 ? Number(x.amount) : null,
    vendor: x.vendor,
    description: x.description
  }));
}

/**
 * Service-Übersicht eines Fahrzeugs: je Bauteil mit Wechseln, Historie (neueste zuerst, höchstens HISTORY_LIMIT),
 * Lebensdauer, Intervall und nächstem Wechsel.
 * @returns {Promise<object|null>} null ohne Zugriff
 */
async function getVehicleService(db, userId, vehicleId, { warnDays = 30, today = new Date() } = {}) {
  if (!(await canAccessVehicle(db, userId, vehicleId, 'read'))) return null;
  const [catalog, intervals, changes, currentOdo] = await Promise.all([
    loadCatalog(db, vehicleId), loadIntervals(db, vehicleId), loadChanges(db, vehicleId), currentOdometer(db, vehicleId)
  ]);
  const parts = [];
  for (const p of catalog) {
    const list = changes.filter((c) => c.part_key === p.key);
    const interval = intervals.get(p.key) ?? null;
    // Bauteile ohne Wechsel und ohne Intervall bleiben außen vor (die Auswahl steht in /parts)
    if (!list.length && !interval) continue;
    const lifetime = lifetimeOf(list);
    const last = list[0] ?? null;
    parts.push({
      key: p.key,
      name: p.name,
      icon: p.icon,
      group: p.group,
      builtin: p.builtin,
      interval,
      changes: list.length,
      last: last ? { entry_id: last.entry_id, date: dayString(toDay(last.date)), odometer_km: last.odometer_km, cost: last.cost, vendor: last.vendor } : null,
      lifetime,
      next: nextChange({ last, interval, lifetime, currentOdo, warnDays, today }),
      total_cost: Math.round(list.reduce((a, c) => a + (c.cost ?? 0), 0) * 100) / 100,
      history: list.slice(0, HISTORY_LIMIT).map((c) => ({
        entry_id: c.entry_id, category: c.category, date: dayString(toDay(c.date)), odometer_km: c.odometer_km, cost: c.cost, vendor: c.vendor, description: c.description
      }))
    });
  }
  // Bauteile mit nächstem Wechsel zuerst (dringendste), dann nach Katalogreihenfolge
  const rank = { ueberfaellig: 0, bald: 1, ok: 2 };
  parts.sort((a, b) => (rank[a.next?.status] ?? 3) - (rank[b.next?.status] ?? 3) || (a.next?.days ?? 1e9) - (b.next?.days ?? 1e9));
  return { current_odometer_km: currentOdo, history_limit: HISTORY_LIMIT, parts };
}

/**
 * Bauteile als Termine (#78) im Format von /reminders: nur Bauteile mit nächstem Wechsel (eigenes Intervall oder Ø-Lebensdauer
 * ab zwei Wechseln). category "part:<key>", source "bauteil" (Intervall) oder "lebensdauer" (Schätzung: nie ueberfaellig,
 * und der Notifier schickt dafür weder Mail noch Push).
 */
async function getPartReminders(db, vehicleId, { warnDays = 30, today = new Date() } = {}) {
  const [catalog, intervals, changes, currentOdo] = await Promise.all([
    loadCatalog(db, vehicleId), loadIntervals(db, vehicleId), loadChanges(db, vehicleId), currentOdometer(db, vehicleId)
  ]);
  const rows = [];
  for (const p of catalog) {
    const list = changes.filter((c) => c.part_key === p.key);
    if (!list.length) continue;
    const last = list[0];
    const next = nextChange({ last, interval: intervals.get(p.key) ?? null, lifetime: lifetimeOf(list), currentOdo, warnDays, today });
    if (!next) continue;
    rows.push({
      title: p.name,
      category: `part:${p.key}`,
      part_key: p.key,
      icon: p.icon,
      kind: 'due',
      last: dayString(toDay(last.date)),
      last_odometer_km: last.odometer_km,
      last_description: last.description || null,
      due_date: next.due_date,
      due_km: next.due_km,
      status: next.status,
      days: next.days,
      source: next.source === 'lifetime' ? 'lebensdauer' : 'bauteil'
    });
  }
  return rows;
}

module.exports = {
  getPartReminders,
  BUILTIN, BUILTIN_BY_KEY, GROUPS, CUSTOM_PREFIX, NAME_MAX, MAX_CUSTOM_PARTS, MAX_PARTS_PER_ENTRY, HISTORY_LIMIT, UUID_RE,
  isCustomKey, loadCatalog, parseParts, saveParts, partsByExpense, describeParts, lifetimeOf, nextChange, loadIntervals, loadChanges, getVehicleService
};
