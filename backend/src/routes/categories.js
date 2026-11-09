// Routen: /categories, /categories/:categoryId
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const { createHash } = require('crypto');
const categories = require('../services/categories');
const plans = require('../services/plans');
const { pool } = require('../db');
const { serverError } = require('../lib/http');
const { loadPlanUser } = require('../lib/planUser');
const { auth } = require('../middleware/auth');
const { requireVerified } = require('../middleware/verified');

const router = express.Router();

// Kategorien (#95): feste Kategorien mit Tarif-Kennzeichen plus eigene Kategorien des Benutzers.
// Clients dürfen die Antwort kurz zwischenspeichern (ETag für die erneute Abfrage).
router.get('/categories', auth, async (req, res) => {
  try {
    const user = await loadPlanUser(pool, req.user.sub);
    const body = await categories.listForUser(pool, user);
    const etag = '"' + createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27) + '"';
    res.set('Cache-Control', 'private, max-age=300');
    res.set('ETag', etag);
    if (req.get('If-None-Match') === etag) return res.status(304).end();
    res.json(body);
  } catch (e) {
    serverError(res, e);
  }
});

// Eigene Kategorie anlegen (nur mit Tarif-Recht customCategories, höchstens customCategories Stück)
router.post('/categories', auth, requireVerified('customCategories'), async (req, res) => {
  const v = categories.validateCustomInput(req.body || {});
  if (v.error) return res.status(400).json(v);
  try {
    const user = await loadPlanUser(pool, req.user.sub);
    const max = plans.limitOf(user, 'customCategories') ?? 0;
    if (max <= 0) return plans.planRequired(res, 'customCategories', { limit: 0, plan: plans.effectivePlan(user) });
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM expense_categories WHERE user_id = $1', [req.user.sub]);
    if (count.rows[0].n >= max) return res.status(403).json({ error: 'category_limit_reached', limit: max });
    const r = await pool.query(
      `INSERT INTO expense_categories (user_id, name, icon, color, group_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, icon, color, group_key`,
      [req.user.sub, v.value.name, v.value.icon, v.value.color, v.value.group]
    );
    res.status(201).json(categories.customToApi(r.rows[0], true));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'name_taken' });
    serverError(res, e);
  }
});

// Eigene Kategorie ändern (Name, Icon, Farbe, Gruppe). Auch nach dem Herabstufen erlaubt: es entsteht nichts Neues.
router.patch('/categories/:categoryId', auth, async (req, res) => {
  const v = categories.validateCustomInput(req.body || {}, true);
  if (v.error) return res.status(400).json(v);
  const cols = { name: 'name', icon: 'icon', color: 'color', group: 'group_key' };
  const fields = [];
  const values = [];
  for (const [k, col] of Object.entries(cols)) {
    if (v.value[k] !== undefined) { values.push(v.value[k]); fields.push(`${col} = $${values.length}`); }
  }
  if (fields.length === 0) return res.status(400).json({ error: 'nothing_to_update' });
  try {
    values.push(String(req.params.categoryId || '').trim(), req.user.sub);
    const r = await pool.query(
      `UPDATE expense_categories SET ${fields.join(', ')}, updated_at = now()
       WHERE id::text = $${values.length - 1} AND user_id = $${values.length}
       RETURNING id, name, icon, color, group_key`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'category_not_found' });
    const user = await loadPlanUser(pool, req.user.sub);
    res.json(categories.customToApi(r.rows[0], (plans.limitOf(user, 'customCategories') ?? 0) > 0));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'name_taken' });
    serverError(res, e);
  }
});

// Eigene Kategorie löschen. Hängen noch Ausgaben daran, muss ?moveTo=<Schlüssel> sagen, wohin sie wandern.
router.delete('/categories/:categoryId', auth, async (req, res) => {
  const id = String(req.params.categoryId || '').trim();
  const moveTo = req.query.moveTo ? String(req.query.moveTo).trim() : '';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query('SELECT id FROM expense_categories WHERE id::text = $1 AND user_id = $2 FOR UPDATE', [id, req.user.sub]);
    if (c.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'category_not_found' }); }
    const key = categories.customKey(c.rows[0].id);
    const used = await client.query('SELECT COUNT(*)::int AS n FROM expenses WHERE user_id = $1 AND category = $2', [req.user.sub, key]);
    const n = used.rows[0].n;
    if (n > 0) {
      const ziel = categories.BUILTIN_BY_KEY[moveTo];
      if (!moveTo) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'category_in_use', entries: n }); }
      if (moveTo === key || (ziel && ziel.form !== 'expense')) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'invalid_moveTo' }); }
      const fehler = await categories.checkUsable(client, await loadPlanUser(client, req.user.sub), moveTo);
      if (fehler) {
        await client.query('ROLLBACK');
        return res.status(fehler.status).json(fehler.status === 403 ? fehler.body : { error: 'invalid_moveTo', category: moveTo });
      }
      await client.query('UPDATE expenses SET category = $3 WHERE user_id = $1 AND category = $2', [req.user.sub, key, moveTo]);
    }
    await client.query('DELETE FROM expense_categories WHERE id = $1', [c.rows[0].id]);
    await client.query('COMMIT');
    res.json({ deleted: key, moved: n, moveTo: n > 0 ? moveTo : null });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, e);
  } finally {
    client.release();
  }
});

module.exports = router;
