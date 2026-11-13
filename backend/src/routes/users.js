// Routen: /auth/plans, /auth/users, /auth/users/:userId, /auth/users/:userId/beta, /auth/users/:userId/plan, /auth/users/:userId/plan-history, /auth/users/:userId/revoke-all
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const { pageOrReply, queryPage, pageOfArray } = require('../lib/pagination');
const fs = require('fs');
const media = require('../services/media');
const planChanges = require('../services/planChanges');
const plans = require('../services/plans');
const { pool } = require('../db');
const { UUID_RE, optionalText, serverError } = require('../lib/http');
const { auth, requireAdmin, requireSelfOrAdmin } = require('../middleware/auth');
const { storedMediaPath } = require('../middleware/upload');
const emailVerification = require('../services/emailVerification');
const sharing = require('../services/sharing');

const deviceSessions = require('../services/deviceSessions');
const router = express.Router();

// List all users (Admin-Endpoint)
router.get('/auth/users', auth, requireAdmin, async (req, res) => {
  // Seitenweise (#160)
  const p = pageOrReply(req, res);
  if (!p) return;
  try {
    res.json(await queryPage(pool, {
      sql: `SELECT
         id,
         email,
         username,
         mfa_enabled,
         profile_image_url,
         beta_tester,
         (email_verified_at IS NOT NULL) AS email_verified, pending_email,
         plan,
         plan_until,
         created_at,
         updated_at,
         last_login_at,
         last_seen_at,
         (SELECT COUNT(*)::int FROM vehicles v WHERE v.user_id = users.id) AS vehicle_count,
         -- Wann zuletzt etwas eingetragen wurde (Erfassungszeit, nicht das Datum des Eintrags – Importe zählen also auch)
         GREATEST(
           (SELECT MAX(f.created_at) FROM fillups f WHERE f.user_id = users.id),
           (SELECT MAX(e.created_at) FROM expenses e WHERE e.user_id = users.id)
         ) AS last_entry_at
       FROM users
       ORDER BY created_at ASC, id`,
      countSql: 'SELECT COUNT(*)::int AS total FROM users'
    }, p));
  } catch (e) {
    serverError(res, e);
  }
});

// Beta-Tester-Status setzen (nur Admin)
router.put('/auth/users/:userId/beta', auth, requireAdmin, async (req, res) => {
  if (typeof req.body?.betaTester !== 'boolean') return res.status(400).json({ error: 'invalid_betaTester' });
  try {
    const r = await pool.query(
      'UPDATE users SET beta_tester = $2, updated_at = now() WHERE id = $1 RETURNING id, email, beta_tester',
      [String(req.params.userId || '').trim(), req.body.betaTester]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'user_not_found' });
    serverError(res, e);
  }
});

// Tarif und Ablaufdatum aus dem Request prüfen; liefert { plan, planUntil } oder { error }
function parsePlanBody(body) {
  const plan = String(body?.plan || '').trim();
  if (!plans.PLAN_NAMES.includes(plan)) return { error: 'invalid_plan' };
  let planUntil = null;
  if (body?.planUntil !== undefined && body?.planUntil !== null && body?.planUntil !== '') {
    const d = new Date(String(body.planUntil));
    if (Number.isNaN(d.getTime())) return { error: 'invalid_planUntil' };
    planUntil = d.toISOString();
  }
  // Notiz fürs Protokoll (z. B. "Tester", "Kulanz"), optional und gekürzt
  const note = body?.note ? String(body.note).trim().slice(0, 200) || null : null;
  // Free ist immer unbefristet
  return { plan, planUntil: plan === 'free' ? null : planUntil, note };
}

// Tarif setzen (nur Admin), z. B. Plus für Tester und Freunde. planUntil: ISO-Datum oder null (unbefristet)
router.put('/auth/users/:userId/plan', auth, requireAdmin, async (req, res) => {
  const p = parsePlanBody(req.body);
  if (p.error) return res.status(400).json({ error: p.error, allowed: plans.PLAN_NAMES });
  const userId = String(req.params.userId || '').trim();
  if (!UUID_RE.test(userId)) return res.status(404).json({ error: 'user_not_found' });
  try {
    const [u] = await planChanges.setPlans(pool, {
      userIds: [userId], plan: p.plan, planUntil: p.planUntil, source: 'admin', changedBy: req.user.sub, note: p.note
    });
    if (!u) return res.status(404).json({ error: 'user_not_found' });
    res.json({ id: u.id, email: u.email, ...plans.planInfo(u) });
  } catch (e) {
    serverError(res, e);
  }
});

// Verlauf der Tarifänderungen eines Kontos (nur Admin, #102)
router.get('/auth/users/:userId/plan-history', auth, requireAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!UUID_RE.test(userId)) return res.status(404).json({ error: 'user_not_found' });
  try {
    res.json({ changes: await planChanges.history(pool, userId) });
  } catch (e) {
    serverError(res, e);
  }
});

// Tarif für mehrere Konten auf einmal setzen (nur Admin): { userIds: [...], plan, planUntil }
router.put('/auth/plans', auth, requireAdmin, async (req, res) => {
  const p = parsePlanBody(req.body);
  if (p.error) return res.status(400).json({ error: p.error, allowed: plans.PLAN_NAMES });
  const ids = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds.map((x) => String(x).trim()))] : [];
  if (ids.length === 0 || ids.length > 1000 || !ids.every((id) => UUID_RE.test(id))) {
    return res.status(400).json({ error: 'invalid_userIds' });
  }
  try {
    const r = await planChanges.setPlans(pool, {
      userIds: ids, plan: p.plan, planUntil: p.planUntil, source: 'admin', changedBy: req.user.sub, note: p.note
    });
    // updated = gefundene Konten (wie bisher), changed = davon tatsächlich geändert
    res.json({ updated: r.length, changed: r.filter((u) => u.changed).length, plan: p.plan, planUntil: p.planUntil });
  } catch (e) {
    serverError(res, e);
  }
});

// Get single user (eigener User oder Admin)
router.get('/auth/users/:userId', auth, requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'missing_userId' });

  try {
    const r = await pool.query(
      `SELECT
         id,
         email,
         username,
         mfa_enabled,
         profile_image_url,
         created_at,
         updated_at,
         (email_verified_at IS NOT NULL) AS email_verified, pending_email
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Patch single user (eigener User oder Admin)
router.patch('/auth/users/:userId', auth, requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'missing_userId' });

  const email =
    req.body?.email !== undefined
      ? String(req.body.email).trim().toLowerCase()
      : undefined;
  const username = optionalText(req.body?.username);
  const profileImageUrl = media.normalizeInput(optionalText(req.body?.profileImageUrl));

  if (email === undefined && username === undefined && profileImageUrl === undefined) {
    return res.status(400).json({ error: 'nothing_to_update' });
  }

  if (email !== undefined && (!email || !email.includes('@'))) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    // Neue E-Mail-Adresse (#135): Wer seine eigene Adresse ändert, muss die neue erst bestätigen; bis dahin gilt die
    // alte weiter (pending_email). Admins ändern fremde Adressen direkt; ohne Mailserver ändert sich die Adresse sofort.
    let bestaetigungAn = null;
    if (email !== undefined) {
      const aktuell = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      if (aktuell.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
      const eigene = userId === String(req.user.sub);
      if (email === aktuell.rows[0].email) {
        fields.push('pending_email = NULL');
      } else if (eigene && (await emailVerification.required(pool))) {
        const belegt = await pool.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [email, userId]);
        if (belegt.rowCount > 0) return res.status(409).json({ error: 'email_already_exists' });
        fields.push(`pending_email = $${idx++}`);
        values.push(email);
        bestaetigungAn = email;
      } else {
        fields.push(`email = $${idx++}`, 'pending_email = NULL', 'email_verified_at = now()');
        values.push(email);
      }
    }
    if (username !== undefined) {
      fields.push(`username = $${idx++}`);
      values.push(username);
    }
    if (profileImageUrl !== undefined) {
      fields.push(`profile_image_url = $${idx++}`);
      values.push(profileImageUrl);
    }

    fields.push(`updated_at = now()`);
    values.push(userId);

    const r = await pool.query(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING id, email, username, mfa_enabled, profile_image_url, created_at, updated_at,
                 (email_verified_at IS NOT NULL) AS email_verified, pending_email`,
      values
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    if (bestaetigungAn) {
      try {
        await emailVerification.sendVerification(pool, userId, bestaetigungAn, { change: true });
      } catch (e) {
        console.error('[users] Bestätigungsmail für neue Adresse fehlgeschlagen:', e.code || e.message);
      }
    }
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'email_already_exists' });
    }
    serverError(res, e);
  }
});

// Delete single user (eigener User oder Admin)
router.delete('/auth/users/:userId', auth, requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'missing_userId' });

  try {
    // Hochgeladene Bilder (Profil und Fahrzeuge) merken, damit nach dem Löschen keine Dateien liegen bleiben
    const media = await pool.query(
      `SELECT url FROM user_media WHERE user_id = $1
       UNION SELECT url FROM vehicle_media WHERE user_id = $1
       UNION SELECT profile_image_url FROM users WHERE id = $1 AND profile_image_url IS NOT NULL`,
      [userId]
    );

    // Einträge an geteilten Fahrzeugen anderer bleiben beim Fahrzeug (#53): sie gehen an den jeweiligen Besitzer über,
    // statt mit dem Konto gelöscht zu werden. Eigene Fahrzeuge samt allen Einträgen werden mit dem Konto gelöscht.
    const client = await pool.connect();
    let r;
    try {
      await client.query('BEGIN');
      await sharing.handOverEntries(client, userId);
      r = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    await Promise.all(media.rows.map(({ url }) => {
      const p = storedMediaPath(url);
      return p ? fs.promises.unlink(p).catch(() => {}) : null;
    }));

    return res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

// Revoke all tokens of a user (eigener User oder Admin)
router.post('/auth/users/:userId/revoke-all', auth, requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'missing_userId' });

  const reason =
    req.body?.reason !== undefined
      ? String(req.body.reason).trim()
      : null;

  try {
    // Sicherstellen, dass der User existiert
    const exists = await pool.query(
      'SELECT 1 FROM users WHERE id = $1',
      [userId]
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // Alle Tokens und alle Gerätesitzungen der Apps (#117)
    const row = await deviceSessions.revokeAllForUser(pool, userId, reason);

    res.status(201).json({
      userId: row.user_id,
      revokedAfter: row.revoked_after,
      reason: row.reason,
      message:
        'Alle bestehenden Tokens dieses Benutzers wurden widerrufen. Neue Logins erhalten wieder gültige Tokens.'
    });
  } catch (e) {
    serverError(res, e);
  }
});

module.exports = router;
