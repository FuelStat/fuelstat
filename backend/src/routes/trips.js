// Routen: /trips, /trips/:tripId, /vehicles/:vehicleId/trips, /vehicles/:vehicleId/trips/summary,
// /vehicles/:vehicleId/trips/export
// Fahrtenbuch (#52). Zugriff wie bei Einträgen (#53): lesen alle Mitglieder, erfassen Besitzer und Mitfahrer,
// ändern Besitzer alle und Mitfahrer eigene Fahrten.
const express = require('express');
const plans = require('../services/plans');
const trips = require('../services/trips');
const { pool } = require('../db');
const { UUID_RE, serverError } = require('../lib/http');
const { loadPlanUser } = require('../lib/planUser');
const { auth } = require('../middleware/auth');
const { checkUnverifiedLimit } = require('../middleware/verified');
const { getVehicleCosts } = require('../services/costs');
const { checkOdometer } = require('../services/odometer');
const { RECHTE, canEditEntry, vehicleRole } = require('../services/vehicleAccess');

const router = express.Router();

const ROW_SELECT = `SELECT ${trips.COLUMNS} FROM trips WHERE id = $1`;

// Zweck im Tarif enthalten? (Free: privat und dienstlich, Plus: zusätzlich Arbeitsweg)
async function purposeError(res, userId, purpose) {
  const user = await loadPlanUser(pool, userId);
  if (trips.allowedPurposes(user).includes(purpose)) return false;
  plans.planRequired(res, 'tripCategories', { limit: plans.limitOf(user, 'tripCategories'), plan: plans.effectivePlan(user) });
  return true;
}

// Kosten pro km für die Schätzung (gleiches Jahr, sonst gesamter Zeitraum)
async function costPerKmOf(userId, vehicleId, year) {
  const c = await getVehicleCosts(pool, userId, vehicleId, { year });
  return c?.costPerKm ?? null;
}

const jahrAus = (q) => {
  if (q === undefined || q === '') return { year: null };
  const y = Number(q);
  return Number.isInteger(y) && y >= 1900 && y <= 2100 ? { year: y } : { error: 'invalid_year' };
};

// Fahrt anlegen
router.post('/trips', auth, async (req, res) => {
  const vehicleId = String(req.body?.vehicleId || '').trim();
  if (!UUID_RE.test(vehicleId)) return res.status(400).json({ error: 'missing_vehicleId' });
  try {
    if (await checkUnverifiedLimit(res, req.user.sub, 'entry')) return;
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (!role) return res.status(404).json({ error: 'vehicle_not_found' });
    if (!RECHTE.write.has(role)) return res.status(403).json({ error: 'read_only' });
    const p = trips.parseTrip(req.body);
    if (p.error) return res.status(400).json(p);
    if (await purposeError(res, req.user.sub, p.values.purpose)) return;
    const v = p.values;
    const r = await pool.query(
      `INSERT INTO trips (vehicle_id, user_id, started_at, ended_at, odometer_start, odometer_end, distance_km,
                          start_place, end_place, purpose, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [vehicleId, req.user.sub, v.started_at, v.ended_at, v.odometer_start, v.odometer_end, v.distance_km,
        v.start_place, v.end_place, v.purpose, v.note]
    );
    const row = (await pool.query(ROW_SELECT, [r.rows[0].id])).rows[0];
    // Unplausibler Tachostand am Ende der Fahrt: speichern, aber warnen (#51)
    const warnings = await checkOdometer(pool, req.user.sub, vehicleId, { id: row.id, odometer_km: row.odometer_end, occurred_at: row.started_at });
    res.status(201).json({ ...row, warnings });
  } catch (e) {
    serverError(res, e);
  }
});

// Fahrten eines Fahrzeugs (?year=2026&purpose=business&limit=&offset=)
router.get('/vehicles/:vehicleId/trips', auth, async (req, res) => {
  const { vehicleId } = req.params;
  if (!UUID_RE.test(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  const j = jahrAus(req.query.year);
  if (j.error) return res.status(400).json({ error: j.error });
  const purpose = req.query.purpose ? String(req.query.purpose) : null;
  if (purpose && !trips.PURPOSES.includes(purpose)) return res.status(400).json({ error: 'invalid_purpose', allowed: trips.PURPOSES });
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500)));
  const offset = Math.max(0, Math.floor(Number(req.query.offset || 0)) || 0);
  try {
    if (!(await vehicleRole(pool, req.user.sub, vehicleId))) return res.status(404).json({ error: 'vehicle_not_found' });
    res.json(await trips.listTrips(pool, vehicleId, { year: j.year, purpose, limit, offset }));
  } catch (e) {
    serverError(res, e);
  }
});

// Auswertung: km je Zweck und Monat, Anteil dienstlich, geschätzte Kosten
router.get('/vehicles/:vehicleId/trips/summary', auth, async (req, res) => {
  const { vehicleId } = req.params;
  if (!UUID_RE.test(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  const j = jahrAus(req.query.year);
  if (j.error) return res.status(400).json({ error: j.error });
  try {
    if (!(await vehicleRole(pool, req.user.sub, vehicleId))) return res.status(404).json({ error: 'vehicle_not_found' });
    const liste = await trips.listTrips(pool, vehicleId, { year: j.year, limit: 100000 });
    const user = await loadPlanUser(pool, req.user.sub);
    res.json({
      ...trips.summarize(liste, { year: j.year, costPerKm: await costPerKmOf(req.user.sub, vehicleId, j.year) }),
      purposes: trips.PURPOSES,
      allowedPurposes: trips.allowedPurposes(user),
      canExport: plans.hasFeature(user, 'tripExport')
    });
  } catch (e) {
    serverError(res, e);
  }
});

// Export als CSV (Plus): für die eigene Übersicht bzw. als Grundlage für die Steuer
router.get('/vehicles/:vehicleId/trips/export', auth, async (req, res) => {
  const { vehicleId } = req.params;
  if (!UUID_RE.test(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  const j = jahrAus(req.query.year);
  if (j.error) return res.status(400).json({ error: j.error });
  try {
    if (!(await vehicleRole(pool, req.user.sub, vehicleId))) return res.status(404).json({ error: 'vehicle_not_found' });
    const user = await loadPlanUser(pool, req.user.sub);
    if (!plans.hasFeature(user, 'tripExport')) return plans.planRequired(res, 'tripExport', { plan: plans.effectivePlan(user) });
    const liste = await trips.listTrips(pool, vehicleId, { year: j.year, limit: 100000 });
    const kpk = await costPerKmOf(req.user.sub, vehicleId, j.year);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="fahrtenbuch${j.year ? '-' + j.year : ''}.csv"`);
    res.send(trips.toCsv(liste, { costPerKm: kpk?.total ?? kpk?.energy ?? null }));
  } catch (e) {
    serverError(res, e);
  }
});

// Einzelne Fahrt laden und Rechte prüfen; antwortet selbst bei Fehlern und liefert dann null
async function ladeFahrt(req, res, { aendern = false } = {}) {
  const { tripId } = req.params;
  if (!UUID_RE.test(String(tripId))) {
    res.status(404).json({ error: 'trip_not_found' });
    return null;
  }
  const r = await pool.query(`SELECT *, user_id AS created_by FROM trips WHERE id = $1`, [tripId]);
  const role = r.rowCount ? await vehicleRole(pool, req.user.sub, r.rows[0].vehicle_id) : null;
  if (!role) {
    res.status(404).json({ error: 'trip_not_found' });
    return null;
  }
  if (aendern && !canEditEntry(role, r.rows[0].user_id, req.user.sub)) {
    res.status(403).json({ error: 'entry_not_editable' });
    return null;
  }
  return r.rows[0];
}

router.get('/trips/:tripId', auth, async (req, res) => {
  try {
    const t = await ladeFahrt(req, res);
    if (!t) return;
    res.json((await pool.query(ROW_SELECT, [t.id])).rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

router.patch('/trips/:tripId', auth, async (req, res) => {
  try {
    const t = await ladeFahrt(req, res, { aendern: true });
    if (!t) return;
    const p = trips.parseTrip(req.body, t);
    if (p.error) return res.status(400).json(p);
    // Bisheriger Zweck bleibt erlaubt (z. B. nach dem Herabstufen), ein neuer muss im Tarif enthalten sein
    if (p.values.purpose !== t.purpose && (await purposeError(res, req.user.sub, p.values.purpose))) return;
    const v = p.values;
    await pool.query(
      `UPDATE trips SET started_at = $2, ended_at = $3, odometer_start = $4, odometer_end = $5, distance_km = $6,
              start_place = $7, end_place = $8, purpose = $9, note = $10, updated_at = now()
        WHERE id = $1`,
      [t.id, v.started_at, v.ended_at, v.odometer_start, v.odometer_end, v.distance_km, v.start_place, v.end_place, v.purpose, v.note]
    );
    const row = (await pool.query(ROW_SELECT, [t.id])).rows[0];
    const warnings = await checkOdometer(pool, req.user.sub, row.vehicle_id, { id: row.id, odometer_km: row.odometer_end, occurred_at: row.started_at });
    res.json({ ...row, warnings });
  } catch (e) {
    serverError(res, e);
  }
});

router.delete('/trips/:tripId', auth, async (req, res) => {
  try {
    const t = await ladeFahrt(req, res, { aendern: true });
    if (!t) return;
    await pool.query('DELETE FROM trips WHERE id = $1', [t.id]);
    res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
