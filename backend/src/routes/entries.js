// Routen: /entries, /entries/:entryId, /vehicles/:vehicleId/entries
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const { pageOrReply, queryPage, pageOfArray } = require('../lib/pagination');
const categories = require('../services/categories');
const { pool } = require('../db');
const { optionalNumber, serverError } = require('../lib/http');
const { tooLongText } = require('../lib/textLimits');
const { loadPlanUser } = require('../lib/planUser');
const { auth } = require('../middleware/auth');
const { checkOdometer } = require('../services/odometer');
const { checkUnverifiedLimit } = require('../middleware/verified');
const { vehicleRole, canEditEntry, RECHTE } = require('../services/vehicleAccess');
const parts = require('../services/parts');

const router = express.Router();

// Fehlerantwort für ungültige Bauteile (#78)
const bauteileFehler = (b) => ({ error: b.error, ...(b.key !== undefined ? { key: b.key } : {}), ...(b.max ? { max: b.max } : {}) });

// Bauteile eines Eintrags für Antworten (#78): [{ key, name, cost_share }]
async function partsOf(vehicleId, entryId) {
  return (await parts.partsByExpense(pool, vehicleId, [entryId])).get(entryId) ?? [];
}

// Create non-fuel expense entry
router.post('/entries', auth, async (req, res) => {
  // Ohne bestätigte E-Mail-Adresse nur ein Eintrag (#135)
  try {
    if (await checkUnverifiedLimit(res, req.user.sub, 'entry')) return;
  } catch (e) {
    return serverError(res, e);
  }
  const vehicleId = String(req.body?.vehicleId || '').trim();
  const category = String(req.body?.category || '').trim();

  const amountEur = Number(req.body?.amountEur);
  // null bzw. leer = kein Tachostand (nicht 0 km)
  const odometerKm = optionalNumber(req.body?.odometerKm) ?? null;
  const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;

  const vendor = req.body?.vendor ? String(req.body.vendor).trim() : null;
  const description = req.body?.description ? String(req.body.description).trim() : null;
  const zuLang = tooLongText(req.body, ['vendor', 'description']); // #197
  if (zuLang) return res.status(400).json(zuLang);

  if (!vehicleId) return res.status(400).json({ error: 'missing_vehicleId' });
  if (!category) return res.status(400).json({ error: 'missing_category' });
  if (!Number.isFinite(amountEur) || amountEur < 0) {
    return res.status(400).json({ error: 'invalid_amountEur' });
  }
  if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
    return res.status(400).json({ error: 'invalid_odometerKm' });
  }
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    return res.status(400).json({ error: 'invalid_occurredAt' });
  }

  try {
    // Zugriff (#53): erfassen dürfen Besitzer und Mitfahrer
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (!role) return res.status(404).json({ error: 'vehicle_not_found' });
    if (!RECHTE.write.has(role)) return res.status(403).json({ error: 'read_only' });

    // Kategorie bekannt und im Tarif enthalten? (#95)
    const fehler = await categories.checkUsable(pool, await loadPlanUser(pool, req.user.sub), category);
    if (fehler) return res.status(fehler.status).json(fehler.body);

    // Bauteile (#78): nur an Werkstatt, Wartung, Reparatur, Inspektion und Reifen
    const bauteile = await parts.parseParts(pool, vehicleId, req.body?.parts, amountEur);
    if (bauteile.error) return res.status(400).json(bauteileFehler(bauteile));
    if (bauteile.parts?.length && !categories.allowsParts(category)) return res.status(400).json({ error: 'parts_not_allowed' });

    const client = await pool.connect();
    let r;
    try {
      await client.query('BEGIN');
      r = await client.query(
      `INSERT INTO expenses (
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::numeric,
         $5,
         COALESCE($6, now()),
         $7,
         $8
       )
       RETURNING
         id,
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description,
         created_at`,
      [req.user.sub, vehicleId, category, amountEur, odometerKm, occurredAt, vendor, description]
      );
      if (bauteile.parts?.length) await parts.saveParts(client, r.rows[0].id, bauteile.parts);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    res.status(201).json({ ...r.rows[0], parts: await partsOf(vehicleId, r.rows[0].id), warnings: await checkOdometer(pool, req.user.sub, vehicleId, r.rows[0]) });
  } catch (e) {
    serverError(res, e);
  }
});

// List expense entries by vehicle
const ENTRY_COLUMNS = `
  id,
  user_id,
  vehicle_id,
  category,
  amount_eur,
  odometer_km,
  occurred_at,
  vendor,
  description,
  created_at`;

// Get single entry (expense)
router.get('/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  try {
    const r = await pool.query(`SELECT ${ENTRY_COLUMNS} FROM expenses WHERE id = $1`, [entryId]);
    // Sichtbar für alle mit Zugriff aufs Fahrzeug (#53)
    if (r.rowCount === 0 || !(await vehicleRole(pool, req.user.sub, r.rows[0].vehicle_id))) {
      return res.status(404).json({ error: 'entry_not_found' });
    }
    res.json({ ...r.rows[0], parts: await partsOf(r.rows[0].vehicle_id, r.rows[0].id), warnings: await checkOdometer(pool, req.user.sub, r.rows[0].vehicle_id, r.rows[0]) });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

// Patch single entry (expense)
router.patch('/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  const body = req.body || {};
  const fields = [];
  const values = [];
  let idx = 1;

  if (body.category !== undefined) {
    const category = String(body.category).trim();
    if (!category) return res.status(400).json({ error: 'missing_category' });
    fields.push(`category = $${idx++}`);
    values.push(category);
  }
  if (body.amountEur !== undefined) {
    const amountEur = Number(body.amountEur);
    if (!Number.isFinite(amountEur) || amountEur < 0) return res.status(400).json({ error: 'invalid_amountEur' });
    fields.push(`amount_eur = $${idx++}`);
    values.push(amountEur);
  }
  if (body.odometerKm !== undefined) {
    const odometerKm = body.odometerKm === null || body.odometerKm === '' ? null : Number(body.odometerKm);
    if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
      return res.status(400).json({ error: 'invalid_odometerKm' });
    }
    fields.push(`odometer_km = $${idx++}`);
    values.push(odometerKm);
  }
  if (body.occurredAt !== undefined) {
    const occurredAt = new Date(body.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return res.status(400).json({ error: 'invalid_occurredAt' });
    fields.push(`occurred_at = $${idx++}`);
    values.push(occurredAt);
  }
  const zuLang = tooLongText(body, ['vendor', 'description']); // #197
  if (zuLang) return res.status(400).json(zuLang);
  if (body.vendor !== undefined) {
    fields.push(`vendor = $${idx++}`);
    values.push(body.vendor === null ? null : String(body.vendor).trim() || null);
  }
  if (body.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(body.description === null ? null : String(body.description).trim() || null);
  }

  if (fields.length === 0 && body.parts === undefined) return res.status(400).json({ error: 'nothing_to_update' });

  try {
    // Besitzer ändern alle Einträge, Mitfahrer nur selbst erfasste (#53)
    const alt = await pool.query('SELECT category, user_id, vehicle_id, amount_eur FROM expenses WHERE id = $1', [entryId]);
    const role = alt.rowCount ? await vehicleRole(pool, req.user.sub, alt.rows[0].vehicle_id) : null;
    if (!role) return res.status(404).json({ error: 'entry_not_found' });
    if (!canEditEntry(role, alt.rows[0].user_id, req.user.sub)) return res.status(403).json({ error: 'entry_not_editable' });
    // Neue Kategorie prüfen; die bisherige bleibt immer erlaubt (auch nach dem Herabstufen oder aus alten Importen)
    if (body.category !== undefined) {
      const neu = String(body.category).trim();
      if (alt.rows[0].category !== neu) {
        const fehler = await categories.checkUsable(pool, await loadPlanUser(pool, req.user.sub), neu);
        if (fehler) return res.status(fehler.status).json(fehler.body);
      }
    }
    // Bauteile (#78): fehlt "parts", bleiben sie; [] oder null löscht; ein Wechsel auf eine Kategorie ohne Bauteile entfernt sie
    const vehicleId = alt.rows[0].vehicle_id;
    const neueKategorie = body.category !== undefined ? String(body.category).trim() : alt.rows[0].category;
    const neuerBetrag = body.amountEur !== undefined ? Number(body.amountEur) : Number(alt.rows[0].amount_eur);
    const bauteile = await parts.parseParts(pool, vehicleId, body.parts, neuerBetrag);
    if (bauteile.error) return res.status(400).json(bauteileFehler(bauteile));
    if (bauteile.parts?.length && !categories.allowsParts(neueKategorie)) return res.status(400).json({ error: 'parts_not_allowed' });
    let ersetzen = bauteile.parts ?? null;
    if (ersetzen === null && !categories.allowsParts(neueKategorie)) ersetzen = [];
    if (ersetzen === null && body.amountEur !== undefined) {
      // Kostenanteile dürfen nach einer Änderung des Betrags nicht über ihm liegen
      const anteile = await pool.query('SELECT COALESCE(SUM(cost_share), 0)::float8 AS summe FROM expense_parts WHERE expense_id = $1', [entryId]);
      if (anteile.rows[0].summe > neuerBetrag + 0.005) return res.status(400).json({ error: 'cost_share_exceeds_amount' });
    }

    const client = await pool.connect();
    let r;
    try {
      await client.query('BEGIN');
      if (fields.length) {
        values.push(entryId);
        r = await client.query(`UPDATE expenses SET ${fields.join(', ')} WHERE id = $${idx} RETURNING ${ENTRY_COLUMNS}`, values);
      } else {
        r = await client.query(`SELECT ${ENTRY_COLUMNS} FROM expenses WHERE id = $1`, [entryId]);
      }
      if (r.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'entry_not_found' });
      }
      if (ersetzen !== null) await parts.saveParts(client, entryId, ersetzen);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.json({ ...r.rows[0], parts: await partsOf(vehicleId, entryId) });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

// Delete single entry (expense)
router.delete('/entries/:entryId', auth, async (req, res) => {
  const entryId = String(req.params.entryId || '').trim();
  try {
    const alt = await pool.query('SELECT user_id, vehicle_id FROM expenses WHERE id = $1', [entryId]);
    const role = alt.rowCount ? await vehicleRole(pool, req.user.sub, alt.rows[0].vehicle_id) : null;
    if (!role) return res.status(404).json({ error: 'entry_not_found' });
    if (!canEditEntry(role, alt.rows[0].user_id, req.user.sub)) return res.status(403).json({ error: 'entry_not_editable' });
    await pool.query('DELETE FROM expenses WHERE id = $1', [entryId]);
    res.status(204).send();
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'entry_not_found' });
    serverError(res, e);
  }
});

router.get('/vehicles/:vehicleId/entries', auth, async (req, res) => {
  const vehicleId = String(req.params.vehicleId || '').trim();
  // Seitenweise (#160)
  const p = pageOrReply(req, res);
  if (!p) return;

  try {
    // Zugriff (#53): Besitzer und Mitglieder sehen alle Einträge des Fahrzeugs
    if (!(await vehicleRole(pool, req.user.sub, vehicleId))) return res.status(404).json({ error: 'vehicle_not_found' });

    // Alte "Fahrt"-Einträge, die ins Fahrtenbuch übernommen wurden (Migration 019, #52), nicht doppelt zeigen
    const filter = `vehicle_id = $1
         AND NOT (category = 'Fahrt' AND EXISTS (SELECT 1 FROM trips t WHERE t.legacy_expense_id = expenses.id))`;
    const seite = await queryPage(pool, {
      sql: `SELECT
         id,
         user_id,
         vehicle_id,
         category,
         amount_eur,
         odometer_km,
         occurred_at,
         vendor,
         description,
         created_at,
         user_id AS created_by,
         (SELECT COALESCE(u.username, u.email) FROM users u WHERE u.id = expenses.user_id) AS created_by_name
       FROM expenses
       WHERE ${filter}
       ORDER BY occurred_at DESC, created_at DESC, id DESC`,
      countSql: `SELECT COUNT(*)::int AS total FROM expenses WHERE ${filter}`,
      params: [vehicleId]
    }, p);
    // Bauteile (#78) der Einträge dieser Seite
    const bauteile = await parts.partsByExpense(pool, vehicleId, seite.data.map((x) => x.id));
    res.json({ ...seite, data: seite.data.map((x) => ({ ...x, parts: bauteile.get(x.id) ?? [] })) });
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
