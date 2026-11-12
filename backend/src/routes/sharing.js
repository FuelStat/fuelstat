// Routen: /vehicles/:vehicleId/members, /vehicles/:vehicleId/members/:userId, /vehicles/:vehicleId/invitations,
// /vehicles/:vehicleId/invitations/:invitationId, /invitations, /invitations/:invitationId/accept|decline
// Fahrzeuge teilen (#53). Rollen und Zugriff: services/vehicleAccess.js, Ablauf: services/sharing.js.
const express = require('express');
const { pageOrReply, queryPage, pageOfArray } = require('../lib/pagination');
const plans = require('../services/plans');
const sharing = require('../services/sharing');
const { pool } = require('../db');
const { UUID_RE, serverError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { requireVerified } = require('../middleware/verified');
const { MEMBER_ROLES, vehicleRole } = require('../services/vehicleAccess');

const router = express.Router();

const ungueltig = (...ids) => ids.some((id) => !UUID_RE.test(String(id || '')));

// Wer hat Zugriff? Für alle mit Zugriff; offene Einladungen sieht nur der Besitzer.
router.get('/vehicles/:vehicleId/members', auth, async (req, res) => {
  const { vehicleId } = req.params;
  if (ungueltig(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  try {
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (!role) return res.status(404).json({ error: 'vehicle_not_found' });
    res.json({ role, ...(await sharing.listMembers(pool, vehicleId, { withInvitations: role === 'owner' })) });
  } catch (e) {
    serverError(res, e);
  }
});

// Einladen (nur Besitzer, Tarif mit "sharing", bestätigte Adresse)
router.post('/vehicles/:vehicleId/invitations', auth, requireVerified('sharing'), async (req, res) => {
  const { vehicleId } = req.params;
  if (ungueltig(vehicleId)) return res.status(404).json({ error: 'vehicle_not_found' });
  try {
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (!role) return res.status(404).json({ error: 'vehicle_not_found' });
    if (role !== 'owner') return res.status(403).json({ error: 'owner_only' });
    const konto = await pool.query('SELECT plan, plan_until FROM users WHERE id = $1', [req.user.sub]);
    if (!plans.hasFeature(konto.rows[0], 'sharing')) {
      return plans.planRequired(res, 'sharing', { plan: plans.effectivePlan(konto.rows[0]) });
    }
    const r = await sharing.invite(pool, {
      vehicleId, ownerId: req.user.sub, email: req.body?.email, role: String(req.body?.role || 'editor')
    });
    if (r.error) {
      const { status, ...body } = r;
      return res.status(status).json(body);
    }
    res.status(201).json(r.invitation);
  } catch (e) {
    serverError(res, e);
  }
});

// Einladung zurückziehen (nur Besitzer)
router.delete('/vehicles/:vehicleId/invitations/:invitationId', auth, async (req, res) => {
  const { vehicleId, invitationId } = req.params;
  if (ungueltig(vehicleId, invitationId)) return res.status(404).json({ error: 'invitation_not_found' });
  try {
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (!role) return res.status(404).json({ error: 'vehicle_not_found' });
    if (role !== 'owner') return res.status(403).json({ error: 'owner_only' });
    const r = await pool.query(
      `UPDATE vehicle_invitations SET declined_at = now()
        WHERE id = $1 AND vehicle_id = $2 AND accepted_at IS NULL AND declined_at IS NULL RETURNING id`,
      [invitationId, vehicleId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'invitation_not_found' });
    res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

// Rolle eines Mitglieds ändern (nur Besitzer)
router.patch('/vehicles/:vehicleId/members/:userId', auth, async (req, res) => {
  const { vehicleId, userId } = req.params;
  const neu = String(req.body?.role || '');
  if (ungueltig(vehicleId, userId)) return res.status(404).json({ error: 'member_not_found' });
  if (!MEMBER_ROLES.includes(neu)) return res.status(400).json({ error: 'invalid_role', allowed: MEMBER_ROLES });
  try {
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (!role) return res.status(404).json({ error: 'vehicle_not_found' });
    if (role !== 'owner') return res.status(403).json({ error: 'owner_only' });
    const r = await pool.query(
      'UPDATE vehicle_members SET role = $3 WHERE vehicle_id = $1 AND user_id = $2 RETURNING user_id, role',
      [vehicleId, userId, neu]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'member_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    serverError(res, e);
  }
});

// Mitglied entfernen (Besitzer) bzw. Fahrzeug verlassen (Mitglied selbst, userId = "me" oder die eigene ID)
router.delete('/vehicles/:vehicleId/members/:userId', auth, async (req, res) => {
  const { vehicleId } = req.params;
  const userId = req.params.userId === 'me' ? req.user.sub : req.params.userId;
  if (ungueltig(vehicleId, userId)) return res.status(404).json({ error: 'member_not_found' });
  try {
    const role = await vehicleRole(pool, req.user.sub, vehicleId);
    if (!role) return res.status(404).json({ error: 'vehicle_not_found' });
    const selbst = String(userId) === String(req.user.sub);
    if (role === 'owner' && selbst) return res.status(400).json({ error: 'owner_cannot_leave' });
    if (role !== 'owner' && !selbst) return res.status(403).json({ error: 'owner_only' });
    const r = await pool.query('DELETE FROM vehicle_members WHERE vehicle_id = $1 AND user_id = $2 RETURNING user_id', [vehicleId, userId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'member_not_found' });
    res.status(204).send();
  } catch (e) {
    serverError(res, e);
  }
});

// Offene Einladungen an das eigene Konto
router.get('/invitations', auth, async (req, res) => {
  // Seitenweise (#160); offene Einladungen sind wenige, sie werden ganz geladen und dann geteilt
  const p = pageOrReply(req, res);
  if (!p) return;
  try {
    res.json(pageOfArray(await sharing.invitationsFor(pool, req.user.sub), p));
  } catch (e) {
    serverError(res, e);
  }
});

// Einladung annehmen bzw. ablehnen (einzeln eingebunden, damit der OpenAPI-Abgleich in der CI sie findet)
const antworten = (annehmen) => async (req, res) => {
  const { invitationId } = req.params;
  if (ungueltig(invitationId)) return res.status(404).json({ error: 'invitation_not_found' });
  try {
    const r = await sharing.respond(pool, req.user.sub, invitationId, annehmen);
    if (r.error) {
      const { status, ...body } = r;
      return res.status(status).json(body);
    }
    res.json({ [annehmen ? 'accepted' : 'declined']: true, vehicleId: r.vehicleId });
  } catch (e) {
    serverError(res, e);
  }
};
router.post('/invitations/:invitationId/accept', auth, antworten(true));
router.post('/invitations/:invitationId/decline', auth, antworten(false));

module.exports = router;
