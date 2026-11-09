// Routen: /vehicles, /vehicles/:vehicleId
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const media = require('../services/media');
const plans = require('../services/plans');
const { pool } = require('../db');
const { optionalNumber, optionalText, serverError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { FUEL_TYPES } = require('../services/stats');
const { VEHICLE_EXTRA_COLUMNS, parseVehicleExtras } = require('../services/vehicleFields');
const { checkUnverifiedLimit } = require('../middleware/verified');

const router = express.Router();

// Create vehicle
router.post('/vehicles', auth, async (req, res) => {
  // Ohne bestätigte E-Mail-Adresse nur ein Fahrzeug (#135)
  try {
    if (await checkUnverifiedLimit(res, req.user.sub, 'vehicle')) return;
  } catch (e) {
    return serverError(res, e);
  }
  const name = String(req.body?.name || '').trim();
  const fuelType = String(req.body?.fuelType || '').trim().toLowerCase();

  if (!name) return res.status(400).json({ error: 'missing_name' });
  if (!FUEL_TYPES.has(fuelType)) return res.status(400).json({ error: 'invalid_fuelType' });

  const brand = req.body?.brand ? String(req.body.brand).trim() : null;
  const model = req.body?.model ? String(req.body.model).trim() : null;
  const year = optionalNumber(req.body?.year) ?? null;
  const imageUrl = req.body?.imageUrl ? media.normalizeInput(String(req.body.imageUrl).trim()) : null;
  const odometerKm = optionalNumber(req.body?.odometerKm) ?? null;
  const mileageKm = optionalNumber(req.body?.mileageKm) ?? null;
  const tankCapacity = optionalNumber(req.body?.tankCapacity) ?? null;
  const batteryCapacity = optionalNumber(req.body?.batteryCapacity) ?? null;
  const sortOrder = req.body?.sortOrder !== undefined ? Number(req.body.sortOrder) : 0;

  if (year !== null && (!Number.isFinite(year) || year < 1886 || year > 2100)) {
    return res.status(400).json({ error: 'invalid_year' });
  }
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
    return res.status(400).json({ error: 'invalid_odometerKm' });
  }
  if (mileageKm !== null && (!Number.isFinite(mileageKm) || mileageKm < 0)) {
    return res.status(400).json({ error: 'invalid_mileageKm' });
  }
  if (tankCapacity !== null && (!Number.isFinite(tankCapacity) || tankCapacity <= 0)) {
    return res.status(400).json({ error: 'invalid_tankCapacity' });
  }
  if (batteryCapacity !== null && (!Number.isFinite(batteryCapacity) || batteryCapacity <= 0)) {
    return res.status(400).json({ error: 'invalid_batteryCapacity' });
  }
  if (!Number.isFinite(sortOrder)) {
    return res.status(400).json({ error: 'invalid_sortOrder' });
  }
  // Zusatzangaben (#45): Kennzeichen, Erstzulassung, Kauf, Intervalle, Versicherung, Steuer, Reifen
  const extras = parseVehicleExtras(req.body);
  if (extras.error) return res.status(400).json({ error: extras.error });

  try {
    // Tarifgrenze (nur aktiv mit PLAN_LIMITS_ENABLED=true). Herabstufen löscht nichts, es verhindert nur neue Fahrzeuge.
    const u = await pool.query(
      `SELECT plan, plan_until, (SELECT COUNT(*)::int FROM vehicles WHERE user_id = $1) AS vehicle_count
       FROM users WHERE id = $1`,
      [req.user.sub]
    );
    const konto = u.rows[0] || { plan: 'free', vehicle_count: 0 };
    const maxVehicles = plans.limitOf(konto, 'maxVehicles');
    if (maxVehicles !== null && konto.vehicle_count >= maxVehicles) {
      return plans.planRequired(res, 'maxVehicles', { limit: maxVehicles, plan: plans.effectivePlan(konto) });
    }

    const r = await pool.query(
      `INSERT INTO vehicles (
         user_id, name, fuel_type, brand, model, year, image_url,
         odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, name, fuel_type, brand, model, year, image_url,
                 odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order, ${VEHICLE_EXTRA_COLUMNS},
                 created_at, updated_at`,
      [req.user.sub, name, fuelType, brand, model, year, imageUrl, odometerKm, mileageKm, tankCapacity, batteryCapacity, sortOrder]
    );
    const cols = Object.keys(extras.values);
    if (cols.length) {
      const u2 = await pool.query(
        `UPDATE vehicles SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND user_id = $2
         RETURNING id, name, fuel_type, brand, model, year, image_url,
                   odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order, ${VEHICLE_EXTRA_COLUMNS},
                   created_at, updated_at`,
        [r.rows[0].id, req.user.sub, ...cols.map((c) => extras.values[c])]
      );
      return res.status(201).json(u2.rows[0]);
    }
    res.status(201).json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// List vehicles
router.get('/vehicles', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, fuel_type, brand, model, year, image_url,
              odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order, ${VEHICLE_EXTRA_COLUMNS},
              created_at, updated_at
       FROM vehicles
       WHERE user_id = $1
       ORDER BY sort_order ASC, created_at DESC`,
      [req.user.sub]
    );
    res.json(r.rows);
  } catch (e) {
    serverError(res, e);
  }
});

// Get single vehicle with details
router.get('/vehicles/:vehicleId', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();

  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  try {
    const r = await pool.query(
      `SELECT
         id,
         name,
         fuel_type,
         brand,
         model,
         year,
         image_url,
         odometer_km,
         mileage_km,
         tank_capacity,
         battery_capacity,
         sort_order,
         ${VEHICLE_EXTRA_COLUMNS},
         created_at,
         updated_at
       FROM vehicles
       WHERE id = $1 AND user_id = $2`,
      [vehicleId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Update vehicle (partial)
router.patch('/vehicles/:vehicleId', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  let name =
    req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
  let fuelType =
    req.body?.fuelType !== undefined
      ? String(req.body.fuelType).trim().toLowerCase()
      : undefined;
  const brand = optionalText(req.body?.brand);
  const model = optionalText(req.body?.model);
  const year = optionalNumber(req.body?.year);
  const imageUrl = media.normalizeInput(optionalText(req.body?.imageUrl));
  const odometerKm = optionalNumber(req.body?.odometerKm);
  const mileageKm = optionalNumber(req.body?.mileageKm);
  const tankCapacity = optionalNumber(req.body?.tankCapacity);
  const batteryCapacity = optionalNumber(req.body?.batteryCapacity);
  const sortOrder =
    req.body?.sortOrder !== undefined ? Number(req.body.sortOrder) : undefined;

  if (name !== undefined && !name) {
    return res.status(400).json({ error: 'invalid_name' });
  }
  if (fuelType !== undefined && !FUEL_TYPES.has(fuelType)) {
    return res.status(400).json({ error: 'invalid_fuelType' });
  }
  if (year !== undefined && year !== null && (!Number.isFinite(year) || year < 1886 || year > 2100)) {
    return res.status(400).json({ error: 'invalid_year' });
  }
  if (odometerKm !== undefined && odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
    return res.status(400).json({ error: 'invalid_odometerKm' });
  }
  if (mileageKm !== undefined && mileageKm !== null && (!Number.isFinite(mileageKm) || mileageKm < 0)) {
    return res.status(400).json({ error: 'invalid_mileageKm' });
  }
  if (tankCapacity !== undefined && tankCapacity !== null && (!Number.isFinite(tankCapacity) || tankCapacity <= 0)) {
    return res.status(400).json({ error: 'invalid_tankCapacity' });
  }
  if (batteryCapacity !== undefined && batteryCapacity !== null && (!Number.isFinite(batteryCapacity) || batteryCapacity <= 0)) {
    return res.status(400).json({ error: 'invalid_batteryCapacity' });
  }
  if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
    return res.status(400).json({ error: 'invalid_sortOrder' });
  }
  const extras = parseVehicleExtras(req.body);
  if (extras.error) return res.status(400).json({ error: extras.error });

  if (
    Object.keys(extras.values).length === 0 &&
    name === undefined &&
    fuelType === undefined &&
    brand === undefined &&
    model === undefined &&
    year === undefined &&
    imageUrl === undefined &&
    odometerKm === undefined &&
    mileageKm === undefined &&
    tankCapacity === undefined &&
    batteryCapacity === undefined &&
    sortOrder === undefined
  ) {
    return res.status(400).json({ error: 'nothing_to_update' });
  }

  try {
    // Sicherstellen, dass das Fahrzeug dem User gehört
    const existing = await pool.query(
      'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.user.sub]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    // Dynamisches Update je nach gesendeten Feldern
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(name);
    }
    if (fuelType !== undefined) {
      fields.push(`fuel_type = $${idx++}`);
      values.push(fuelType);
    }
    if (brand !== undefined) {
      fields.push(`brand = $${idx++}`);
      values.push(brand);
    }
    if (model !== undefined) {
      fields.push(`model = $${idx++}`);
      values.push(model);
    }
    if (year !== undefined) {
      fields.push(`year = $${idx++}`);
      values.push(year);
    }
    if (imageUrl !== undefined) {
      fields.push(`image_url = $${idx++}`);
      values.push(imageUrl);
    }
    if (odometerKm !== undefined) {
      fields.push(`odometer_km = $${idx++}`);
      values.push(odometerKm);
    }
    if (mileageKm !== undefined) {
      fields.push(`mileage_km = $${idx++}`);
      values.push(mileageKm);
    }
    if (tankCapacity !== undefined) {
      fields.push(`tank_capacity = $${idx++}`);
      values.push(tankCapacity);
    }
    if (batteryCapacity !== undefined) {
      fields.push(`battery_capacity = $${idx++}`);
      values.push(batteryCapacity);
    }
    if (sortOrder !== undefined) {
      fields.push(`sort_order = $${idx++}`);
      values.push(sortOrder);
    }
    for (const [col, value] of Object.entries(extras.values)) {
      fields.push(`${col} = $${idx++}`);
      values.push(value);
    }

    fields.push(`updated_at = now()`);
    values.push(vehicleId);
    values.push(req.user.sub);

    const r = await pool.query(
      `UPDATE vehicles
       SET ${fields.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id, name, fuel_type, brand, model, year, image_url,
                 odometer_km, mileage_km, tank_capacity, battery_capacity, sort_order, ${VEHICLE_EXTRA_COLUMNS},
                 created_at, updated_at`,
      values
    );

    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Delete vehicle
router.delete('/vehicles/:vehicleId', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });

  try {
    const r = await pool.query(
      'DELETE FROM vehicles WHERE id = $1 AND user_id = $2 RETURNING id',
      [vehicleId, req.user.sub]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'vehicle_not_found' });
    }

    // 204 No Content, keine Response-Payload nötig
    return res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
