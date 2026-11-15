// Route: GET /vehicles/:vehicleId/export – CSV der Einträge eines Fahrzeugs (#184). Das Format steht in services/entriesExport.js.
// Der Fahrtenbuch-Export (Plus) ist /vehicles/:vehicleId/trips/export. Datenexport ist nie an einen Tarif gebunden (DSGVO Art. 20).
const express = require('express');
const { pool } = require('../db');
const { UUID_RE, serverError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { buildEntriesCsv } = require('../services/entriesExport');

const router = express.Router();

router.get('/vehicles/:vehicleId/export', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  let year = null;
  if (req.query.year !== undefined && req.query.year !== '') {
    year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return res.status(400).json({ error: 'invalid_year' });
  }
  if (!UUID_RE.test(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  try {
    const file = await buildEntriesCsv(pool, req.user.sub, vehicleId, { year });
    if (!file) return res.status(404).json({ error: 'vehicle_not_found' });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.csv);
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
