// Routen: /vehicles/:vehicleId/timeline (#160) – Eintragsliste mit Tank-/Ladevorgängen, Ausgaben und Fahrten
const express = require('express');
const { pool } = require('../db');
const { UUID_RE, serverError } = require('../lib/http');
const { pageOrReply } = require('../lib/pagination');
const { auth } = require('../middleware/auth');
const { vehicleRole } = require('../services/vehicleAccess');
const timeline = require('../services/timeline');

const router = express.Router();

// ?page=&per_page=&type=fuel,charge,expense,trip,odometer&year=&q=
router.get('/vehicles/:vehicleId/timeline', auth, async (req, res) => {
  const { vehicleId } = req.params;
  if (!UUID_RE.test(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  const p = pageOrReply(req, res);
  if (!p) return;
  const filter = timeline.parseFilter(req.query);
  if (filter.error) return res.status(400).json({ error: filter.error, ...(filter.error === 'invalid_type' ? { allowed: timeline.KINDS } : {}) });
  try {
    // Zugriff (#53): Besitzer und Mitglieder sehen alle Einträge des Fahrzeugs
    if (!(await vehicleRole(pool, req.user.sub, vehicleId))) return res.status(404).json({ error: 'vehicle_not_found' });
    res.json(await timeline.getTimeline(pool, req.user.sub, vehicleId, filter, p));
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
