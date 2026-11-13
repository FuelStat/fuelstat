// Routen: /fillups, /fillups/:fillupId, /vehicles/:vehicleId/fillups
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const { pageOrReply, queryPage, pageOfArray } = require('../lib/pagination');
const { pool } = require('../db');
const { optionalNumber, serverError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { checkOdometer } = require('../services/odometer');
const { unitsForFuelType } = require('../services/stats');
const { fuelInfo, unitOf, vehicleFuels, fuelForUnit } = require('../services/fuels');
const { checkUnverifiedLimit } = require('../middleware/verified');
const { vehicleRole, canEditEntry, RECHTE } = require('../services/vehicleAccess');

const router = express.Router();

// Add fillup (generalisiert: amount + unit)
router.post('/fillups', auth, async (req, res) => {
  // Ohne bestätigte E-Mail-Adresse nur ein Eintrag (#135)
  try {
    if (await checkUnverifiedLimit(res, req.user.sub, 'entry')) return;
  } catch (e) {
    return serverError(res, e);
  }
  const vehicleId = String(req.body?.vehicleId || '').trim();
  // Tachostand darf fehlen (#41) und später nachgetragen werden; geschätzte Werte sind nur Platzhalter
  const odometerKm = optionalNumber(req.body?.odometerKm) ?? null;
  const odometerEstimated = odometerKm !== null && req.body?.odometerEstimated === true;

  const amount = Number(req.body?.amount);
  const totalCostEur = Number(req.body?.totalCostEur);

  const station = req.body?.station ? String(req.body.station).trim() : null;
  const filledAt = req.body?.filledAt ? new Date(req.body.filledAt) : null;
  const isFull = req.body?.isFull !== undefined ? Boolean(req.body.isFull) : true;
  const skipPrevious = req.body?.skipPrevious !== undefined ? Boolean(req.body.skipPrevious) : false;

  // unit optional: wenn nicht gesetzt, aus der Sorte bzw. dem Standard des Fahrzeugs
  let unit = req.body?.unit ? String(req.body.unit).trim().toLowerCase() : null;
  // Sorte (#140) optional: fehlt sie, gilt der Standard des Fahrzeugs für die Einheit
  let fuel = req.body?.fuel ? String(req.body.fuel).trim().toLowerCase() : null;

  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) return res.status(400).json({ error: 'invalid_odometerKm' });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'invalid_amount' });
  if (!Number.isFinite(totalCostEur) || totalCostEur < 0) return res.status(400).json({ error: 'invalid_totalCostEur' });
  if (filledAt && Number.isNaN(filledAt.getTime())) return res.status(400).json({ error: 'invalid_filledAt' });

  const allowedUnits = new Set(['l', 'kwh', 'kg']);

  try {
    // Zugriff (#53): erfassen dürfen Besitzer und Mitfahrer
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (!role) return res.status(404).json({ error: 'vehicle_not_found' });
    if (!RECHTE.write.has(role)) return res.status(403).json({ error: 'read_only' });
    const v = await pool.query('SELECT fuel_type, fuels, default_fuel FROM vehicles WHERE id = $1', [vehicleId]);
    const vehicle = v.rows[0];
    const fuelType = String(vehicle.fuel_type || '').toLowerCase();

    if (fuel) {
      // Nur Sorten des Fahrzeugs; die Einheit ergibt sich aus der Sorte
      if (!fuelInfo(fuel) || !vehicleFuels(vehicle).fuels.includes(fuel)) return res.status(400).json({ error: 'invalid_fuel' });
      if (unit && unit !== unitOf(fuel)) return res.status(400).json({ error: 'invalid_unit' });
      unit = unitOf(fuel);
    } else {
      if (!unit) unit = unitOf(vehicleFuels(vehicle).defaultFuel);
      if (!allowedUnits.has(unit)) return res.status(400).json({ error: 'invalid_unit' });
      // Plug-in-Hybrid: Liter (getankt) oder kWh (geladen), nichts anderes
      if (fuelType === 'phev' && !unitsForFuelType(fuelType).includes(unit)) return res.status(400).json({ error: 'invalid_unit' });
      fuel = fuelForUnit(vehicle, unit);
    }

    const r = await pool.query(
      `INSERT INTO fillups (
         user_id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         is_full,
         skip_previous,
         odometer_estimated,
         fuel
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::numeric,
         $5,
         $6::numeric,
         CASE
           WHEN $4::numeric > 0
             THEN ROUND(($6::numeric / $4::numeric), 4)
           ELSE NULL
         END,
         $7,
         COALESCE($8, now()),
         $9,
         $10,
         $11,
         $12
       )
       RETURNING id, vehicle_id, odometer_km, amount, unit, fuel, total_cost_eur, price_per_unit, station, filled_at, created_at, is_full, skip_previous, odometer_estimated`,
      [req.user.sub, vehicleId, odometerKm === null ? null : Math.round(odometerKm), amount, unit, totalCostEur, station, filledAt, isFull, skipPrevious, odometerEstimated, fuel]
    );

    // Unplausibler Tachostand: speichern, aber warnen (#51)
    res.status(201).json({ ...r.rows[0], warnings: await checkOdometer(pool, req.user.sub, vehicleId, r.rows[0]) });
  } catch (e) {
    serverError(res, e);
  }
});

// Get single fillup by id
router.get('/fillups/:fillupId', auth, async (req, res) => {
  const fillupId = String(req.params.fillupId || '').trim();

  if (!fillupId) return res.status(400).json({ error: 'missing_fillupId' });

  try {
    const r = await pool.query(
      `SELECT
         id,
         user_id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         fuel,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         created_at,
         is_full,
         skip_previous,
         odometer_estimated
       FROM fillups
       WHERE id = $1`,
      [fillupId]
    );

    // Sichtbar für alle mit Zugriff aufs Fahrzeug (#53)
    if (r.rowCount === 0 || !(await vehicleRole(pool, req.user.sub, r.rows[0].vehicle_id))) {
      return res.status(404).json({ error: 'fillup_not_found' });
    }

    const row = r.rows[0];

    res.json(row);
  } catch (e) {
    serverError(res, e);
  }
});

// Update fillup (partial, 14-Tage-Bearbeitungsfenster ab filled_at)
router.patch('/fillups/:fillupId', auth, async (req, res) => {
  const fillupId = String(req.params.fillupId || '').trim();

  if (!fillupId) return res.status(400).json({ error: 'missing_fillupId' });

  try {
    // Bestehenden Datensatz laden + Besitz prüfen
    const existingRes = await pool.query(
      `SELECT
         id,
         user_id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         fuel,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         created_at,
         is_full,
         skip_previous,
         odometer_estimated
       FROM fillups
       WHERE id = $1`,
      [fillupId]
    );

    const roleBearbeiten = existingRes.rowCount ? await vehicleRole(pool, req.user.sub, existingRes.rows[0].vehicle_id) : null;
    if (!roleBearbeiten) {
      return res.status(404).json({ error: 'fillup_not_found' });
    }
    // Besitzer ändern alle Einträge, Mitfahrer nur selbst erfasste (#53)
    if (!canEditEntry(roleBearbeiten, existingRes.rows[0].user_id, req.user.sub)) {
      return res.status(403).json({ error: 'entry_not_editable' });
    }

    const existing = existingRes.rows[0];

    // Eingehende Änderungen parsen (teilweise, optional)
    const body = req.body || {};

    // 14 Tage Änderungsfenster ab filled_at. Ausnahme (#41): nur den Tachostand nachtragen ist immer möglich.
    const nurTachostand = Object.keys(body).length > 0 &&
      Object.keys(body).every(k => k === 'odometerKm' || k === 'odometerEstimated');
    const now = new Date();
    const filledAtOriginal = new Date(existing.filled_at);
    const diffMs = now.getTime() - filledAtOriginal.getTime();
    const maxMs = 14 * 24 * 60 * 60 * 1000; // 14 Tage

    if (diffMs > maxMs && !nurTachostand) {
      return res.status(409).json({
        error: 'fillup_edit_window_expired',
        message:
          'Tank-/Ladevorgänge können nur innerhalb von 14 Tagen nach dem Tank-/Ladedatum bearbeitet werden.'
      });
    }

    // null bzw. leer: Tachostand entfernen (fehlt)
    const patchOdometerKm = optionalNumber(body.odometerKm);
    const patchOdometerEstimated =
      body.odometerEstimated !== undefined ? body.odometerEstimated === true : undefined;

    const patchAmount =
      body.amount !== undefined ? Number(body.amount) : undefined;
    const patchTotalCostEur =
      body.totalCostEur !== undefined ? Number(body.totalCostEur) : undefined;

    const patchUnit =
      body.unit !== undefined ? String(body.unit).trim().toLowerCase() : undefined;

    const patchFuel =
      body.fuel !== undefined && body.fuel !== null && body.fuel !== '' ? String(body.fuel).trim().toLowerCase() : undefined;

    const patchStation =
      body.station !== undefined ? String(body.station).trim() : undefined;

    const patchFilledAt =
      body.filledAt !== undefined ? new Date(body.filledAt) : undefined;

    const patchIsFull =
      body.isFull !== undefined ? Boolean(body.isFull) : undefined;

    const patchSkipPrevious =
      body.skipPrevious !== undefined ? Boolean(body.skipPrevious) : undefined;

    // Wenn nichts Sinnvolles geändert werden soll
    if (
      patchOdometerKm === undefined &&
      patchAmount === undefined &&
      patchTotalCostEur === undefined &&
      patchUnit === undefined &&
      patchFuel === undefined &&
      patchStation === undefined &&
      patchFilledAt === undefined &&
      patchIsFull === undefined &&
      patchSkipPrevious === undefined &&
      patchOdometerEstimated === undefined
    ) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }

    // Zielwerte (bestehend oder gepatcht)
    const newOdometerKm =
      patchOdometerKm !== undefined ? patchOdometerKm : existing.odometer_km;
    // numeric-Spalten kommen von pg als Text ("30.000"); für die Prüfung unten in Zahlen umwandeln
    const newAmount =
      patchAmount !== undefined ? patchAmount : Number(existing.amount);
    const newTotalCostEur =
      patchTotalCostEur !== undefined ? patchTotalCostEur : Number(existing.total_cost_eur);
    let newUnit =
      patchUnit !== undefined ? patchUnit : existing.unit;
    // Sorte (#140): ausdrücklich gesendet (Einheit folgt daraus), sonst bei geänderter Einheit die passende Sorte
    // des Fahrzeugs, sonst unverändert
    let newFuel = existing.fuel;
    if (patchFuel !== undefined || newUnit !== existing.unit) {
      const vehicle = (await pool.query('SELECT fuel_type, fuels, default_fuel FROM vehicles WHERE id = $1', [existing.vehicle_id])).rows[0];
      if (patchFuel !== undefined) {
        // Eine Sorte, die nicht mehr am Fahrzeug steht, darf ein Eintrag behalten
        if (!fuelInfo(patchFuel) || (patchFuel !== existing.fuel && !vehicleFuels(vehicle).fuels.includes(patchFuel))) {
          return res.status(400).json({ error: 'invalid_fuel' });
        }
        if (patchUnit !== undefined && patchUnit !== unitOf(patchFuel)) return res.status(400).json({ error: 'invalid_unit' });
        newFuel = patchFuel;
        newUnit = unitOf(patchFuel);
      } else {
        newFuel = fuelForUnit(vehicle, newUnit);
      }
    }
    const newStation =
      patchStation !== undefined ? patchStation : existing.station;
    const newFilledAt =
      patchFilledAt !== undefined ? patchFilledAt : new Date(existing.filled_at);
    const newIsFull =
      patchIsFull !== undefined ? patchIsFull : existing.is_full;
    const newSkipPrevious =
      patchSkipPrevious !== undefined ? patchSkipPrevious : existing.skip_previous;
    // Ein neu eingetragener Tachostand gilt als echt, außer es wird ausdrücklich "geschätzt" mitgeschickt
    const newOdometerEstimated = newOdometerKm === null ? false
      : patchOdometerEstimated !== undefined ? patchOdometerEstimated
      : patchOdometerKm !== undefined ? false
      : existing.odometer_estimated;

    // Validierungen auf Zielwerten
    if (newOdometerKm !== null && (!Number.isFinite(newOdometerKm) || newOdometerKm < 0)) {
      return res.status(400).json({ error: 'invalid_odometerKm' });
    }
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }
    if (!Number.isFinite(newTotalCostEur) || newTotalCostEur < 0) {
      return res.status(400).json({ error: 'invalid_totalCostEur' });
    }
    if (Number.isNaN(newFilledAt.getTime())) {
      return res.status(400).json({ error: 'invalid_filledAt' });
    }

    const allowedUnits = new Set(['l', 'kwh', 'kg']);
    if (!newUnit || !allowedUnits.has(newUnit)) {
      return res.status(400).json({ error: 'invalid_unit' });
    }

    const updateRes = await pool.query(
      `UPDATE fillups
       SET
         odometer_km   = $1,
         amount        = $2::numeric,
         unit          = $3,
         total_cost_eur = $4::numeric,
         price_per_unit = CASE
           WHEN $2::numeric > 0
             THEN ROUND(($4::numeric / $2::numeric), 4)
           ELSE NULL
         END,
         station       = $5,
         filled_at     = $6,
         is_full       = $7,
         skip_previous = $8,
         odometer_estimated = $10,
         fuel = $11
       WHERE id = $9
       RETURNING
         id,
         user_id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         fuel,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         created_at,
         is_full,
         skip_previous,
         odometer_estimated`,
      [
        newOdometerKm === null ? null : Math.round(newOdometerKm),
        newAmount,
        newUnit,
        newTotalCostEur,
        newStation,
        newFilledAt,
        newIsFull,
        newSkipPrevious,
        fillupId,
        newOdometerEstimated,
        newFuel
      ]
    );

    const updated = updateRes.rows[0];

    res.json({ ...updated, warnings: await checkOdometer(pool, req.user.sub, updated.vehicle_id, updated) });
  } catch (e) {
    serverError(res, e);
  }
});

// Delete fillup (immer möglich; bei >14 Tagen wird nächster Fillup auf skip_previous=true gesetzt)
router.delete('/fillups/:fillupId', auth, async (req, res) => {
  const fillupId = String(req.params.fillupId || '').trim();
  if (!fillupId) return res.status(400).json({ error: 'missing_fillupId' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Zu löschenden Fillup laden + Besitz prüfen
    const existingRes = await client.query(
      `SELECT
         id,
         user_id,
         vehicle_id,
         odometer_km,
         filled_at
       FROM fillups
       WHERE id = $1
       FOR UPDATE`,
      [fillupId]
    );

    const roleLoeschen = existingRes.rowCount ? await vehicleRole(client, req.user.sub, existingRes.rows[0].vehicle_id) : null;
    if (!roleLoeschen) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'fillup_not_found' });
    }
    if (!canEditEntry(roleLoeschen, existingRes.rows[0].user_id, req.user.sub)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'entry_not_editable' });
    }

    const existing = existingRes.rows[0];
    const filledAt = new Date(existing.filled_at);
    const now = new Date();
    const diffMs = now.getTime() - filledAt.getTime();
    const maxMs = 14 * 24 * 60 * 60 * 1000; // 14 Tage
    const olderThan14Days = diffMs > maxMs;

    // Fillup löschen
    await client.query('DELETE FROM fillups WHERE id = $1', [fillupId]);

    let nextUpdated = false;

    if (olderThan14Days) {
      // Nächsten Fillup anhand filled_at finden und skip_previous = true setzen
      const nextRes = await client.query(
        `SELECT id
         FROM fillups
         WHERE vehicle_id = $1
           AND filled_at > $2
         ORDER BY filled_at ASC
         LIMIT 1`,
        [existing.vehicle_id, filledAt]
      );

      if (nextRes.rowCount === 1) {
        const nextId = nextRes.rows[0].id;
        await client.query(
          `UPDATE fillups
           SET skip_previous = true
           WHERE id = $1`,
          [nextId]
        );
        nextUpdated = true;
      }
    }

    await client.query('COMMIT');

    return res.status(200).json({
      deletedId: existing.id,
      olderThan14Days,
      nextUpdated,
      message: olderThan14Days
        ? 'Ein Tank-/Ladevorgang, der älter als 14 Tage ist, wurde gelöscht. Der nachfolgende Vorgang wird bei der Verbrauchsberechnung nicht mehr den vorherigen berücksichtigen (skip_previous = true).'
        : 'Tank-/Ladevorgang wurde gelöscht.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    serverError(res, e);
  } finally {
    client.release();
  }
});

// List fillups by vehicle
router.get('/vehicles/:vehicleId/fillups', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  // Seitenweise (#160)
  const p = pageOrReply(req, res);
  if (!p) return;

  try {
    if (!(await vehicleRole(pool, req.user.sub, vehicleId))) return res.status(404).json({ error: 'vehicle_not_found' });

    res.json(await queryPage(pool, {
      sql: `SELECT
         id,
         vehicle_id,
         odometer_km,
         amount,
         unit,
         fuel,
         total_cost_eur,
         price_per_unit,
         station,
         filled_at,
         created_at,
         is_full,
         skip_previous,
         odometer_estimated,
         user_id AS created_by,
         (SELECT COALESCE(u.username, u.email) FROM users u WHERE u.id = fillups.user_id) AS created_by_name
       FROM fillups
       WHERE vehicle_id = $1
       ORDER BY filled_at DESC, created_at DESC, id DESC`,
      countSql: 'SELECT COUNT(*)::int AS total FROM fillups WHERE vehicle_id = $1',
      params: [vehicleId]
    }, p));
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
