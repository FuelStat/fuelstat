// Routen: /vehicles/:vehicleId/import
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const categories = require('../services/categories');
const { pool } = require('../db');
const { serverError } = require('../lib/http');
const { loadPlanUser } = require('../lib/planUser');
const { auth } = require('../middleware/auth');
const { importLimiter } = require('../middleware/rateLimits');
const { loadOdometerPoints, odometerWarnings } = require('../services/odometer');
const { unitsForFuelType } = require('../services/stats');
const { requireVerified } = require('../middleware/verified');

const router = express.Router();

// Massen-Import (z. B. aus CSV): alle Zeilen in einer Transaktion, Duplikate werden übersprungen
router.post('/vehicles/:vehicleId/import', auth, requireVerified('import'), importLimiter, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  const fillups = Array.isArray(req.body?.fillups) ? req.body.fillups : [];
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

  if (fillups.length + entries.length === 0) return res.status(400).json({ error: 'nothing_to_import' });
  if (fillups.length + entries.length > 1000) return res.status(400).json({ error: 'too_many_rows', max: 1000 });

  // Validierung vorab: bei Fehlern wird nichts importiert
  const errors = [];
  const validDate = (v) => v && !Number.isNaN(new Date(v).getTime());
  const nonNegative = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;
  fillups.forEach((f, index) => {
    if (!validDate(f?.filledAt)) errors.push({ type: 'fillup', index, error: 'invalid_filledAt' });
    // Tachostand darf fehlen (#41)
    else if (f?.odometerKm !== undefined && f?.odometerKm !== null && f?.odometerKm !== '' && !nonNegative(f.odometerKm)) {
      errors.push({ type: 'fillup', index, error: 'invalid_odometerKm' });
    }
    else if (!nonNegative(f?.amount)) errors.push({ type: 'fillup', index, error: 'invalid_amount' });
    else if (!nonNegative(f?.totalCostEur)) errors.push({ type: 'fillup', index, error: 'invalid_totalCostEur' });
  });
  entries.forEach((e, index) => {
    if (!validDate(e?.occurredAt)) errors.push({ type: 'entry', index, error: 'invalid_occurredAt' });
    else if (!String(e?.category || '').trim()) errors.push({ type: 'entry', index, error: 'missing_category' });
    else if (!nonNegative(e?.amountEur)) errors.push({ type: 'entry', index, error: 'invalid_amountEur' });
    else if (e?.odometerKm !== undefined && e?.odometerKm !== null && e?.odometerKm !== '' && !nonNegative(e.odometerKm)) {
      errors.push({ type: 'entry', index, error: 'invalid_odometerKm' });
    }
  });
  // Kategorien prüfen (#95): nur bekannte und im Tarif enthaltene; Clients ordnen Unbekanntes vorher zu (z. B. "Sonstiges")
  if (errors.length === 0 && entries.length > 0) {
    try {
      const user = await loadPlanUser(pool, req.user.sub);
      const geprueft = new Map();
      for (const [index, e] of entries.entries()) {
        const key = String(e.category).trim();
        if (!geprueft.has(key)) geprueft.set(key, await categories.checkUsable(pool, user, key));
        const fehler = geprueft.get(key);
        if (fehler) errors.push({ type: 'entry', index, error: fehler.body.error, category: key, ...(fehler.body.feature ? { feature: fehler.body.feature } : {}) });
      }
    } catch (e) {
      return serverError(res, e);
    }
  }
  if (errors.length) return res.status(400).json({ error: 'invalid_rows', rows: errors.slice(0, 50) });

  const client = await pool.connect();
  try {
    const v = await client.query('SELECT fuel_type FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, req.user.sub]);
    if (v.rowCount === 0) return res.status(404).json({ error: 'vehicle_not_found' });
    // Einheit je Zeile nur, wo das Fahrzeug mehrere kennt (Plug-in-Hybrid: l und kWh), sonst immer die des Fahrzeugs
    const units = unitsForFuelType(v.rows[0].fuel_type);
    const unitOf = (f) => {
      const u = f.unit ? String(f.unit).trim().toLowerCase() : '';
      return units.includes(u) ? u : units[0];
    };

    // dryRun: alles prüfen und in der Transaktion anlegen, dann zurückrollen (Vorschau mit Duplikaten und Warnungen)
    const dryRun = req.body?.dryRun === true;
    await client.query('BEGIN');
    const result = { imported: { fillups: 0, entries: 0 }, skipped: { fillups: 0, entries: 0 }, duplicates: [], warnings: [] };
    const inserted = []; // { type, index, id, at, km }

    for (const [index, f] of fillups.entries()) {
      const filledAt = new Date(f.filledAt);
      const unit = unitOf(f);
      const odo = f.odometerKm === undefined || f.odometerKm === null || f.odometerKm === '' ? null : Math.round(Number(f.odometerKm));
      // Duplikat: gleicher Tag, gleicher Tachostand und gleiche Einheit (Tanken und Laden am selben Abend sind zwei Einträge);
      // ohne Tachostand zusätzlich gleiche Menge
      const dup = await client.query(
        `SELECT 1 FROM fillups
         WHERE vehicle_id = $1 AND user_id = $2 AND odometer_km IS NOT DISTINCT FROM $3::int AND filled_at::date = $4::date AND unit = $5
           AND ($3::int IS NOT NULL OR amount = $6::numeric)`,
        [vehicleId, req.user.sub, odo, filledAt, unit, Number(f.amount)]
      );
      if (dup.rowCount > 0) { result.skipped.fillups++; result.duplicates.push({ type: 'fillup', index }); continue; }
      const ins = await client.query(
        `INSERT INTO fillups (user_id, vehicle_id, odometer_km, amount, unit, total_cost_eur, price_per_unit, station, filled_at, is_full, skip_previous)
         VALUES ($1, $2, $3, $4::numeric, $5, $6::numeric,
                 CASE WHEN $4::numeric > 0 THEN ROUND($6::numeric / $4::numeric, 4) ELSE NULL END,
                 $7, $8, $9, $10)
         RETURNING id`,
        [
          req.user.sub, vehicleId, odo, Number(f.amount), unit, Number(f.totalCostEur),
          f.station ? String(f.station).trim() : null, filledAt,
          f.isFull !== undefined ? Boolean(f.isFull) : true,
          f.skipPrevious !== undefined ? Boolean(f.skipPrevious) : false
        ]
      );
      result.imported.fillups++;
      inserted.push({ type: 'fillup', index, id: ins.rows[0].id, at: filledAt, km: odo });
    }

    for (const [index, e] of entries.entries()) {
      const occurredAt = new Date(e.occurredAt);
      const category = String(e.category).trim();
      const dup = await client.query(
        `SELECT 1 FROM expenses
         WHERE vehicle_id = $1 AND user_id = $2 AND category = $3 AND amount_eur = $4::numeric AND occurred_at::date = $5::date`,
        [vehicleId, req.user.sub, category, Number(e.amountEur), occurredAt]
      );
      if (dup.rowCount > 0) { result.skipped.entries++; result.duplicates.push({ type: 'entry', index }); continue; }
      const odometerKm = e.odometerKm === undefined || e.odometerKm === null || e.odometerKm === '' ? null : Math.round(Number(e.odometerKm));
      const ins = await client.query(
        `INSERT INTO expenses (user_id, vehicle_id, category, amount_eur, odometer_km, occurred_at, vendor, description)
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8)
         RETURNING id`,
        [
          req.user.sub, vehicleId, category, Number(e.amountEur), odometerKm, occurredAt,
          e.vendor ? String(e.vendor).trim() : null, e.description ? String(e.description).trim() : null
        ]
      );
      result.imported.entries++;
      inserted.push({ type: 'entry', index, id: ins.rows[0].id, at: occurredAt, km: odometerKm });
    }

    // Tachostand-Prüfung (#51) gegen alle Einträge des Fahrzeugs inklusive der neuen Zeilen
    const { points, purchaseKm } = await loadOdometerPoints(client, req.user.sub, vehicleId);
    for (const row of inserted) {
      if (row.km === null) continue;
      const others = points.filter((p) => String(p.id) !== String(row.id));
      for (const w of odometerWarnings(others, { date: row.at, km: row.km }, purchaseKm)) {
        result.warnings.push({ type: row.type, index: row.index, ...w });
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      return res.json({ ...result, dryRun: true });
    }
    await client.query('COMMIT');
    res.status(201).json(result);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '22P02') return res.status(404).json({ error: 'vehicle_not_found' });
    serverError(res, e);
  } finally {
    client.release();
  }
});

module.exports = router;
