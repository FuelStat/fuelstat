// Routen: /vehicles/:vehicleId/consumption, /vehicles/:vehicleId/costs, /vehicles/:vehicleId/reminders, /vehicles/:vehicleId/stats
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const { pool } = require('../db');
const { UUID_RE, serverError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { getVehicleConsumption } = require('../services/consumption');
const { getVehicleCosts } = require('../services/costs');
const { getVehicleReminders } = require('../services/reminders');
const { getVehicleStats } = require('../services/stats');

const router = express.Router();

// Fälligkeiten (TÜV, Wartung, Versicherung, Steuer) eines Fahrzeugs
router.get('/vehicles/:vehicleId/reminders', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  try {
    const v = await pool.query('SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, req.user.sub]);
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });
    const s = await pool.query('SELECT reminder_days FROM user_mail_settings WHERE user_id = $1', [req.user.sub]);
    res.json(await getVehicleReminders(pool, req.user.sub, vehicleId, s.rows[0]?.reminder_days ?? 30));
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'vehicle_not_found' });
    serverError(res, e);
  }
});

router.get('/vehicles/:vehicleId/stats', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();

  try {
    const data = await getVehicleStats(pool, req.user.sub, vehicleId);
    if (data?.error === 'vehicle_not_found') return res.status(404).json({ error: 'vehicle_not_found' });
    res.json(data);
  } catch (e) {
    serverError(res, e);
  }
});

// Verbrauch, Mengen und CO₂ je Einheit (#82): Abschnitte, Monate, Jahre, Ø/Min/Max, Stromanteil
router.get('/vehicles/:vehicleId/consumption', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!UUID_RE.test(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  try {
    const data = await getVehicleConsumption(pool, req.user.sub, vehicleId);
    if (!data) return res.status(404).json({ error: 'vehicle_not_found' });
    res.json(data);
  } catch (e) {
    serverError(res, e);
  }
});

// Kosten je Fahrzeug (#124): Summen, Kosten pro km, laufender Monat, Monatssummen; optional ?year=JJJJ
router.get('/vehicles/:vehicleId/costs', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  let year = null;
  if (req.query.year !== undefined && req.query.year !== '') {
    year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return res.status(400).json({ error: 'invalid_year' });
  }
  if (!UUID_RE.test(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  try {
    const data = await getVehicleCosts(pool, req.user.sub, vehicleId, { year });
    if (!data) return res.status(404).json({ error: 'vehicle_not_found' });
    res.json(data);
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
