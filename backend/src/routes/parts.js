// Routen: /vehicles/:vehicleId/parts, /vehicles/:vehicleId/parts/:partId, /vehicles/:vehicleId/part-intervals/:partKey,
// /vehicles/:vehicleId/service
// Service-Historie je Bauteil (#78): Bauteil-Auswahl (eingebaut und eigene), eigene Bauteile, Wechselintervalle und die
// Übersicht je Bauteil mit Historie, Lebensdauer und nächstem Wechsel.
const express = require('express');
const { pool } = require('../db');
const { serverError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { vehicleRole, RECHTE } = require('../services/vehicleAccess');
const parts = require('../services/parts');

const router = express.Router();

const vehicleIdOf = (req) => String(req.params.vehicleId || '').trim();

// Rolle prüfen: 404 ohne Zugriff, 403 ohne das Recht
async function requireRole(req, res, action) {
  const role = await vehicleRole(pool, req.user.sub, vehicleIdOf(req));
  if (!role) {
    res.status(404).json({ error: 'vehicle_not_found' });
    return null;
  }
  if (action && !RECHTE[action].has(role)) {
    res.status(403).json({ error: action === 'write' ? 'read_only' : 'owner_only' });
    return null;
  }
  return role;
}

const notFound22P02 = (e, res) => (e.code === '22P02' ? (res.status(404).json({ error: 'vehicle_not_found' }), true) : false);

// Auswahl für Formulare: eingebaute Bauteile (feste Schlüssel) und eigene des Fahrzeugs
router.get('/vehicles/:vehicleId/parts', auth, async (req, res) => {
  try {
    if (!(await requireRole(req, res))) return;
    res.json({ groups: parts.GROUPS, parts: await parts.loadCatalog(pool, vehicleIdOf(req)), custom: { max: parts.MAX_CUSTOM_PARTS } });
  } catch (e) {
    if (!notFound22P02(e, res)) serverError(res, e);
  }
});

function parseName(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > parts.NAME_MAX) return { error: 'invalid_name' };
  return { name };
}

// Eigenes Bauteil anlegen (wer Einträge erfassen darf)
router.post('/vehicles/:vehicleId/parts', auth, async (req, res) => {
  const n = parseName(req.body);
  if (n.error) return res.status(400).json({ error: n.error });
  try {
    if (!(await requireRole(req, res, 'write'))) return;
    const vehicleId = vehicleIdOf(req);
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM vehicle_parts WHERE vehicle_id = $1', [vehicleId]);
    if (count.rows[0].n >= parts.MAX_CUSTOM_PARTS) return res.status(409).json({ error: 'too_many_parts', limit: parts.MAX_CUSTOM_PARTS });
    // Gleicher Name wie ein eingebautes oder eigenes Bauteil: das vorhandene verwenden statt Dopplung
    const taken = (await parts.loadCatalog(pool, vehicleId)).some((p) => p.name.toLowerCase() === n.name.toLowerCase());
    if (taken) return res.status(409).json({ error: 'part_exists' });
    const r = await pool.query('INSERT INTO vehicle_parts (vehicle_id, name) VALUES ($1, $2) RETURNING id, name', [vehicleId, n.name]);
    res.status(201).json({ key: parts.CUSTOM_PREFIX + r.rows[0].id, id: r.rows[0].id, name: r.rows[0].name, icon: 'fa-screwdriver-wrench', group: 'eigene', builtin: false });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'part_exists' });
    if (!notFound22P02(e, res)) serverError(res, e);
  }
});

// Eigenes Bauteil umbenennen
router.patch('/vehicles/:vehicleId/parts/:partId', auth, async (req, res) => {
  const n = parseName(req.body);
  if (n.error) return res.status(400).json({ error: n.error });
  const partId = String(req.params.partId || '');
  if (!parts.UUID_RE.test(partId)) return res.status(404).json({ error: 'part_not_found' });
  try {
    if (!(await requireRole(req, res, 'write'))) return;
    const vehicleId = vehicleIdOf(req);
    const taken = (await parts.loadCatalog(pool, vehicleId)).some((p) => p.id !== partId && p.name.toLowerCase() === n.name.toLowerCase());
    if (taken) return res.status(409).json({ error: 'part_exists' });
    const r = await pool.query('UPDATE vehicle_parts SET name = $3 WHERE id = $1 AND vehicle_id = $2 RETURNING id, name', [partId, vehicleId, n.name]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'part_not_found' });
    res.json({ key: parts.CUSTOM_PREFIX + r.rows[0].id, id: r.rows[0].id, name: r.rows[0].name, icon: 'fa-screwdriver-wrench', group: 'eigene', builtin: false });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'part_exists' });
    if (!notFound22P02(e, res)) serverError(res, e);
  }
});

// Eigenes Bauteil löschen: entfernt es von allen Einträgen und löscht sein Intervall (die Einträge selbst bleiben)
router.delete('/vehicles/:vehicleId/parts/:partId', auth, async (req, res) => {
  const partId = String(req.params.partId || '');
  if (!parts.UUID_RE.test(partId)) return res.status(404).json({ error: 'part_not_found' });
  const client = await pool.connect();
  try {
    if (!(await requireRole(req, res, 'write'))) return;
    const vehicleId = vehicleIdOf(req);
    const key = parts.CUSTOM_PREFIX + partId;
    await client.query('BEGIN');
    const r = await client.query('DELETE FROM vehicle_parts WHERE id = $1 AND vehicle_id = $2', [partId, vehicleId]);
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'part_not_found' });
    }
    await client.query('DELETE FROM expense_parts WHERE part_key = $1 AND expense_id IN (SELECT id FROM expenses WHERE vehicle_id = $2)', [key, vehicleId]);
    await client.query('DELETE FROM vehicle_part_intervals WHERE vehicle_id = $1 AND part_key = $2', [vehicleId, key]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (!notFound22P02(e, res)) serverError(res, e);
  } finally {
    client.release();
  }
});

// Wechselintervall eines Bauteils setzen (nur Besitzer, wie die übrigen Fahrzeugdaten): { intervalMonths, intervalKm },
// beide null oder leer löscht. Motoröl schreibt in die Fahrzeugangaben (oilIntervalMonths/Km), dort steht der Wert nur einmal.
router.put('/vehicles/:vehicleId/part-intervals/:partKey', auth, async (req, res) => {
  const partKey = String(req.params.partKey || '');
  const whole = (v, min, max) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const months = whole(req.body?.intervalMonths, 1, 240);
  const km = whole(req.body?.intervalKm, 1000, 1000000);
  if (months === undefined) return res.status(400).json({ error: 'invalid_intervalMonths' });
  if (km === undefined) return res.status(400).json({ error: 'invalid_intervalKm' });
  try {
    if (!(await requireRole(req, res, 'manage'))) return;
    const vehicleId = vehicleIdOf(req);
    const catalog = await parts.loadCatalog(pool, vehicleId);
    if (!catalog.some((p) => p.key === partKey)) return res.status(404).json({ error: 'part_not_found' });
    if (partKey === 'oil') {
      await pool.query('UPDATE vehicles SET oil_interval_months = $2, oil_interval_km = $3, updated_at = now() WHERE id = $1', [vehicleId, months, km]);
    } else if (months === null && km === null) {
      await pool.query('DELETE FROM vehicle_part_intervals WHERE vehicle_id = $1 AND part_key = $2', [vehicleId, partKey]);
    } else {
      await pool.query(
        `INSERT INTO vehicle_part_intervals (vehicle_id, part_key, interval_months, interval_km) VALUES ($1, $2, $3, $4)
         ON CONFLICT (vehicle_id, part_key) DO UPDATE SET interval_months = EXCLUDED.interval_months, interval_km = EXCLUDED.interval_km`,
        [vehicleId, partKey, months, km]
      );
    }
    res.json({ key: partKey, interval: months === null && km === null ? null : { months, km } });
  } catch (e) {
    if (!notFound22P02(e, res)) serverError(res, e);
  }
});

// Übersicht je Bauteil: Wechsel, Historie, Lebensdauer, Intervall, nächster Wechsel
router.get('/vehicles/:vehicleId/service', auth, async (req, res) => {
  try {
    if (!(await requireRole(req, res))) return;
    const s = await pool.query('SELECT reminder_days FROM user_mail_settings WHERE user_id = $1', [req.user.sub]);
    const data = await parts.getVehicleService(pool, req.user.sub, vehicleIdOf(req), { warnDays: s.rows[0]?.reminder_days ?? 30 });
    if (!data) return res.status(404).json({ error: 'vehicle_not_found' });
    res.json(data);
  } catch (e) {
    if (!notFound22P02(e, res)) serverError(res, e);
  }
});

module.exports = router;
