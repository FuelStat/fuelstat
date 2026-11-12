// Fahrtenbuch (#52): Fahrten mit Tachostand Start/Ende, Orten, Zweck und Fahrer, Auswertung und CSV-Export.
// "Fahrtenbuch zur eigenen Übersicht" – kein vom Finanzamt anerkanntes Fahrtenbuch (dafür müssten Einträge
// nachträglich unveränderbar sein).
//
// Zwecke: private (privat) und business (dienstlich) im Free-Tarif, commute (Arbeitsweg) ab Plus
// (plans.js: tripCategories = Anzahl erlaubter Zwecke in dieser Reihenfolge). Export als CSV ab Plus (tripExport).
const plans = require('./plans');
const { monthOf } = require('./costs');
const { queryPage } = require('../lib/pagination');

const PURPOSES = ['private', 'business', 'commute'];
const PURPOSE_NAMES = { private: 'Privat', business: 'Dienstlich', commute: 'Arbeitsweg' };
const TEXT_MAX = 200;

const COLUMNS = `
  id, vehicle_id, user_id AS created_by,
  (SELECT COALESCE(u.username, u.email) FROM users u WHERE u.id = trips.user_id) AS created_by_name,
  started_at, ended_at, odometer_start, odometer_end, distance_km::float8 AS distance_km,
  start_place, end_place, purpose, note, created_at, updated_at`;

/** Zwecke, die der Tarif des Kontos erlaubt */
function allowedPurposes(user) {
  const limit = plans.limitOf(user, 'tripCategories');
  return limit === null ? PURPOSES : PURPOSES.slice(0, limit);
}

const text = (v) => (v === undefined ? undefined : v === null ? null : String(v).trim().slice(0, TEXT_MAX) || null);
const zahl = (v) => (v === undefined ? undefined : v === null || v === '' ? null : Number(v));
const datum = (v) => (v === undefined ? undefined : v === null || v === '' ? null : new Date(v));

/**
 * Eingaben prüfen und zusammenführen (neu oder PATCH auf `existing`).
 * Tachostand Ende ist Pflicht; die Strecke ergibt sich aus Start und Ende oder kommt als distanceKm.
 * @returns {{ values } | { error }}
 */
function parseTrip(body, existing = null) {
  const b = body || {};
  const v = {
    started_at: datum(b.startedAt) ?? (existing ? existing.started_at : undefined),
    ended_at: b.endedAt !== undefined ? datum(b.endedAt) : (existing ? existing.ended_at : null),
    odometer_start: b.odometerStart !== undefined ? zahl(b.odometerStart) : (existing ? existing.odometer_start : null),
    odometer_end: b.odometerEnd !== undefined ? zahl(b.odometerEnd) : (existing ? existing.odometer_end : undefined),
    start_place: b.startPlace !== undefined ? text(b.startPlace) : (existing ? existing.start_place : null),
    end_place: b.endPlace !== undefined ? text(b.endPlace) : (existing ? existing.end_place : null),
    purpose: b.purpose !== undefined ? String(b.purpose) : (existing ? existing.purpose : 'private'),
    note: b.note !== undefined ? text(b.note) : (existing ? existing.note : null)
  };
  if (v.started_at === undefined || v.started_at === null) v.started_at = new Date();
  if (Number.isNaN(new Date(v.started_at).getTime())) return { error: 'invalid_startedAt' };
  if (v.ended_at !== null && Number.isNaN(new Date(v.ended_at).getTime())) return { error: 'invalid_endedAt' };
  if (v.ended_at !== null && new Date(v.ended_at) < new Date(v.started_at)) return { error: 'invalid_endedAt' };
  if (!Number.isFinite(v.odometer_end) || v.odometer_end < 0) return { error: 'invalid_odometerEnd' };
  if (v.odometer_start !== null && (!Number.isFinite(v.odometer_start) || v.odometer_start < 0 || v.odometer_start > v.odometer_end)) {
    return { error: 'invalid_odometerStart' };
  }
  if (!PURPOSES.includes(v.purpose)) return { error: 'invalid_purpose', allowed: PURPOSES };

  let distance;
  if (v.odometer_start !== null) {
    distance = v.odometer_end - v.odometer_start;
  } else {
    const d = b.distanceKm !== undefined ? zahl(b.distanceKm) : (existing ? Number(existing.distance_km) : null);
    if (d === null || !Number.isFinite(d) || d < 0 || d > v.odometer_end) return { error: 'invalid_distanceKm' };
    distance = d;
    // Start aus Ende minus Strecke, wenn die Strecke ganze km sind (sonst bleibt der Start offen)
    if (Number.isInteger(d)) v.odometer_start = v.odometer_end - d;
  }
  v.odometer_end = Math.round(v.odometer_end);
  if (v.odometer_start !== null) v.odometer_start = Math.round(v.odometer_start);
  v.distance_km = Math.round(distance * 10) / 10;
  return { values: v };
}

/** Fahrten eines Fahrzeugs, neueste zuerst; optional Jahr (Europe/Berlin) und Zweck */
const TRIP_FILTER = `vehicle_id = $1
        AND ($2::int IS NULL OR EXTRACT(YEAR FROM started_at AT TIME ZONE 'Europe/Berlin') = $2)
        AND ($3::text IS NULL OR purpose = $3)`;

/** Alle Fahrten (für Auswertung und Export), neueste zuerst */
async function listTrips(db, vehicleId, { year = null, purpose = null } = {}) {
  const r = await db.query(
    `SELECT ${COLUMNS} FROM trips WHERE ${TRIP_FILTER} ORDER BY started_at DESC, created_at DESC, id DESC`,
    [vehicleId, year, purpose]
  );
  return r.rows;
}

const r1 = (n) => Math.round(n * 10) / 10;

const TRIP_MONTH = "to_char(started_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM')";

/**
 * Eine Seite Fahrten (#160), dazu `months` (Anzahl und km der Monate auf dieser Seite, über den ganzen Monat und mit
 * denselben Filtern) und `years` (alle Jahre mit Fahrten, ohne Filter) – damit Clients für Monatsköpfe und
 * Jahresauswahl nicht alle Fahrten laden müssen.
 */
async function listTripsPage(db, vehicleId, { year = null, purpose = null } = {}, p) {
  const params = [vehicleId, year, purpose];
  const [page, years] = await Promise.all([
    queryPage(db, {
      sql: `SELECT ${COLUMNS} FROM trips WHERE ${TRIP_FILTER} ORDER BY started_at DESC, created_at DESC, id DESC`,
      countSql: `SELECT COUNT(*)::int AS total FROM trips WHERE ${TRIP_FILTER}`,
      params
    }, p),
    db.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM started_at AT TIME ZONE 'Europe/Berlin')::int AS year
         FROM trips WHERE vehicle_id = $1 ORDER BY 1 DESC`,
      [vehicleId]
    )
  ]);
  const monthKeys = [...new Set(page.data.map((t) => monthOf(new Date(t.started_at))))];
  let months = [];
  if (monthKeys.length) {
    const m = await db.query(
      `SELECT ${TRIP_MONTH} AS month, COUNT(*)::int AS count, COALESCE(SUM(distance_km), 0)::float8 AS km
         FROM trips WHERE ${TRIP_FILTER} AND ${TRIP_MONTH} = ANY($4::text[])
        GROUP BY 1 ORDER BY 1 DESC`,
      [...params, monthKeys]
    );
    months = m.rows.map((r) => ({ month: r.month, count: r.count, km: r1(r.km) }));
  }
  return { ...page, months, years: years.rows.map((r) => r.year) };
}


/**
 * Auswertung: km je Zweck und Monat, Anteil dienstlich, geschätzte Kosten je Fahrt (Kosten pro km × Strecke).
 * @param costPerKm { energy, total } aus services/costs.js (null, wenn unbekannt)
 */
function summarize(trips, { year = null, costPerKm = null } = {}) {
  const byPurpose = Object.fromEntries(PURPOSES.map((p) => [p, { km: 0, count: 0 }]));
  const months = new Map();
  for (const t of trips) {
    const km = Number(t.distance_km) || 0;
    byPurpose[t.purpose].km += km;
    byPurpose[t.purpose].count += 1;
    const m = monthOf(new Date(t.started_at));
    if (!months.has(m)) months.set(m, Object.fromEntries(PURPOSES.map((p) => [p, 0])));
    months.get(m)[t.purpose] += km;
  }
  const totalKm = PURPOSES.reduce((s, p) => s + byPurpose[p].km, 0);
  const proKm = costPerKm?.total ?? costPerKm?.energy ?? null;
  for (const p of PURPOSES) {
    byPurpose[p].km = r1(byPurpose[p].km);
    byPurpose[p].estimatedCost = proKm !== null ? Math.round(byPurpose[p].km * proKm * 100) / 100 : null;
  }
  return {
    year,
    count: trips.length,
    totalKm: r1(totalKm),
    byPurpose,
    businessShare: totalKm > 0 ? Math.round((byPurpose.business.km / totalKm) * 1000) / 10 : null,
    costPerKm: proKm,
    months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([month, km]) => ({ month, ...Object.fromEntries(PURPOSES.map((p) => [p, r1(km[p])])) }))
  };
}

const csvFeld = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Formeln in Tabellenprogrammen verhindern (CSV-Injection) und Trennzeichen schützen
  const sicher = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
};
const deDatum = (d) => new Date(d).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** CSV (Semikolon, deutsches Zahlenformat, mit BOM für Excel) */
function toCsv(trips, { costPerKm = null } = {}) {
  const kopf = ['Datum', 'Ende', 'Von', 'Nach', 'Zweck', 'Tachostand Start', 'Tachostand Ende', 'km', 'Kosten (geschätzt, €)', 'Fahrer', 'Notiz'];
  const zeilen = trips.slice().reverse().map((t) => [
    deDatum(t.started_at),
    t.ended_at ? deDatum(t.ended_at) : '',
    t.start_place, t.end_place, PURPOSE_NAMES[t.purpose] || t.purpose,
    t.odometer_start, t.odometer_end,
    String(t.distance_km).replace('.', ','),
    costPerKm !== null ? (Math.round(Number(t.distance_km) * costPerKm * 100) / 100).toFixed(2).replace('.', ',') : '',
    t.created_by_name, t.note
  ]);
  return '﻿' + [kopf, ...zeilen].map((z) => z.map(csvFeld).join(';')).join('\r\n') + '\r\n';
}

module.exports = { PURPOSES, PURPOSE_NAMES, COLUMNS, allowedPurposes, parseTrip, listTrips, listTripsPage, summarize, toCsv };
