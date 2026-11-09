// Fahrzeuge teilen (#53): Einladungen, Mitglieder, Rollen. Zugriffsprüfung selbst in services/vehicleAccess.js.
//
// Ablauf: Der Besitzer lädt eine E-Mail-Adresse mit Rolle ein (Mitfahrer oder Nur ansehen). Die Einladung gilt
// INVITATION_DAYS Tage. Annehmen kann nur, wer mit genau dieser Adresse angemeldet ist und sie bestätigt hat (#135) –
// ein weitergeleiteter Link nützt also niemand anderem. Mitglieder kann der Besitzer ändern und entfernen; Mitglieder
// können ein Fahrzeug selbst verlassen. Teilen ist eine Plus-Funktion des Besitzers (plans.js: sharing);
// eingeladene Mitglieder brauchen keinen eigenen Tarif.
const { sendUserMail, loadDefaultSmtp, withDefaultSmtp } = require('./mail');
const { MEMBER_ROLES } = require('./vehicleAccess');

const INVITATION_DAYS = 14;
const MAX_INVITATIONS_PER_DAY = 20;
const MAX_MEMBERS = 10;
const ROLLEN_NAMEN = { editor: 'Mitfahrer (sehen und erfassen)', viewer: 'Nur ansehen' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const normEmail = (e) => String(e || '').trim().toLowerCase();

/** Mitglieder (ohne Besitzer) und – für den Besitzer – offene Einladungen eines Fahrzeugs */
async function listMembers(db, vehicleId, { withInvitations = false } = {}) {
  const owner = await db.query(
    `SELECT u.id AS user_id, COALESCE(u.username, u.email) AS name, u.email
       FROM vehicles v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
    [vehicleId]
  );
  const members = await db.query(
    `SELECT m.user_id, COALESCE(u.username, u.email) AS name, u.email, m.role, m.created_at
       FROM vehicle_members m JOIN users u ON u.id = m.user_id
      WHERE m.vehicle_id = $1 ORDER BY m.created_at`,
    [vehicleId]
  );
  const result = { owner: owner.rows[0] ? { ...owner.rows[0], role: 'owner' } : null, members: members.rows };
  if (withInvitations) {
    const inv = await db.query(
      `SELECT id, email, role, expires_at, created_at FROM vehicle_invitations
        WHERE vehicle_id = $1 AND accepted_at IS NULL AND declined_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
      [vehicleId]
    );
    result.invitations = inv.rows;
  }
  return result;
}

function invitationMail({ vehicleName, inviterName, role }, appUrl = process.env.APP_URL) {
  const base = appUrl ? String(appUrl).replace(/\/+$/, '') : null;
  const link = base ? `${base}/pages/einladungen.php` : null;
  const subject = `Fuelstat: ${inviterName} teilt „${vehicleName}“ mit dir`;
  const text = `Hallo,\n\n${inviterName} möchte das Fahrzeug „${vehicleName}“ in Fuelstat mit dir teilen (${ROLLEN_NAMEN[role]}).\n\n`
    + (link ? `Annehmen oder ablehnen: ${link}\n` : 'Melde dich in Fuelstat an, um die Einladung anzunehmen oder abzulehnen (Profil → Einladungen).\n')
    + `Die Einladung gilt ${INVITATION_DAYS} Tage. Noch kein Konto? Registriere dich mit dieser E-Mail-Adresse.\n\nDeine Fuelstat-App`;
  const html = `<p>Hallo,</p><p>${esc(inviterName)} möchte das Fahrzeug „${esc(vehicleName)}“ in Fuelstat mit dir teilen (${esc(ROLLEN_NAMEN[role])}).</p>`
    + (link ? `<p><a href="${esc(link)}">Einladung ansehen</a></p>` : '<p>Melde dich in Fuelstat an, um die Einladung anzunehmen oder abzulehnen (Profil → Einladungen).</p>')
    + `<p>Die Einladung gilt ${INVITATION_DAYS} Tage. Noch kein Konto? Registriere dich mit dieser E-Mail-Adresse.</p><p>Deine Fuelstat-App</p>`;
  return { subject, text, html };
}

/**
 * Einladung anlegen (Aufrufer prüft: Besitzer, Tarif, bestätigte Adresse).
 * @returns {{ invitation } | { error, status }}
 */
async function invite(db, { vehicleId, ownerId, email, role, sender = sendUserMail }) {
  const adresse = normEmail(email);
  if (!adresse || !adresse.includes('@') || adresse.length > 254) return { status: 400, error: 'invalid_email' };
  if (!MEMBER_ROLES.includes(role)) return { status: 400, error: 'invalid_role', allowed: MEMBER_ROLES };

  const ich = await db.query('SELECT email, COALESCE(username, email) AS name FROM users WHERE id = $1', [ownerId]);
  if (normEmail(ich.rows[0]?.email) === adresse) return { status: 400, error: 'cannot_invite_self' };

  const mitglied = await db.query(
    `SELECT 1 FROM vehicle_members m JOIN users u ON u.id = m.user_id WHERE m.vehicle_id = $1 AND lower(u.email) = $2`,
    [vehicleId, adresse]
  );
  if (mitglied.rowCount) return { status: 409, error: 'already_member' };
  const anzahl = await db.query('SELECT COUNT(*)::int AS n FROM vehicle_members WHERE vehicle_id = $1', [vehicleId]);
  if (anzahl.rows[0].n >= MAX_MEMBERS) return { status: 409, error: 'member_limit_reached', limit: MAX_MEMBERS };
  const heute = await db.query(
    `SELECT COUNT(*)::int AS n FROM vehicle_invitations WHERE invited_by = $1 AND created_at > now() - interval '24 hours'`,
    [ownerId]
  );
  if (heute.rows[0].n >= MAX_INVITATIONS_PER_DAY) return { status: 429, error: 'too_many_invitations' };

  // Offene Einladung an dieselbe Adresse ersetzen statt doppeln
  await db.query(
    `UPDATE vehicle_invitations SET declined_at = now()
      WHERE vehicle_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND declined_at IS NULL`,
    [vehicleId, adresse]
  );
  const r = await db.query(
    `INSERT INTO vehicle_invitations (vehicle_id, invited_by, email, role, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
     RETURNING id, email, role, expires_at, created_at`,
    [vehicleId, ownerId, adresse, role, INVITATION_DAYS]
  );

  // Mail über den Standard-Mailserver; ohne Mailserver sieht der Eingeladene die Einladung nach der Anmeldung
  let mailed = false;
  try {
    const defaults = await loadDefaultSmtp(db);
    if (defaults) {
      const v = await db.query('SELECT name FROM vehicles WHERE id = $1', [vehicleId]);
      const settings = withDefaultSmtp({ user_id: ownerId, account_email: adresse }, defaults);
      await sender(settings, invitationMail({ vehicleName: v.rows[0].name, inviterName: ich.rows[0].name, role }));
      mailed = true;
    }
  } catch (e) {
    console.error('[sharing] Einladungsmail fehlgeschlagen:', e.code || e.message);
  }
  return { invitation: { ...r.rows[0], mailed } };
}

/** Offene Einladungen an die (bestätigte) Adresse des Kontos */
async function invitationsFor(db, userId) {
  const r = await db.query(
    `SELECT i.id, i.vehicle_id, v.name AS vehicle_name, i.role, i.expires_at, i.created_at,
            COALESCE(o.username, o.email) AS invited_by_name
       FROM users u
       JOIN vehicle_invitations i ON lower(i.email) = lower(u.email)
       JOIN vehicles v ON v.id = i.vehicle_id
       LEFT JOIN users o ON o.id = i.invited_by
      WHERE u.id = $1 AND u.email_verified_at IS NOT NULL
        AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.expires_at > now()
        AND v.user_id <> $1
        AND NOT EXISTS (SELECT 1 FROM vehicle_members m WHERE m.vehicle_id = i.vehicle_id AND m.user_id = $1)
      ORDER BY i.created_at DESC`,
    [userId]
  );
  return r.rows;
}

/**
 * Einladung annehmen oder ablehnen. Nur mit passender, bestätigter Adresse.
 * @returns {{ ok: true, vehicleId } | { status, error }}
 */
async function respond(pool, userId, invitationId, accept) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT i.id, i.vehicle_id, i.role, i.expires_at, i.accepted_at, i.declined_at, i.invited_by,
              v.user_id AS owner_id, (lower(i.email) = lower(u.email)) AS passt, u.email_verified_at
         FROM vehicle_invitations i
         JOIN vehicles v ON v.id = i.vehicle_id
         JOIN users u ON u.id = $2
        WHERE i.id = $1 FOR UPDATE OF i`,
      [invitationId, userId]
    );
    const inv = r.rows[0];
    // Fremde Einladungen sehen wie nicht vorhanden aus
    if (!inv || !inv.passt) {
      await client.query('ROLLBACK');
      return { status: 404, error: 'invitation_not_found' };
    }
    if (!inv.email_verified_at) {
      await client.query('ROLLBACK');
      return { status: 403, error: 'email_not_verified', feature: 'sharing' };
    }
    if (inv.accepted_at || inv.declined_at || new Date(inv.expires_at) <= new Date()) {
      await client.query('ROLLBACK');
      return { status: 410, error: 'invitation_expired' };
    }
    if (String(inv.owner_id) === String(userId)) {
      await client.query('ROLLBACK');
      return { status: 400, error: 'cannot_invite_self' };
    }
    if (accept) {
      await client.query(
        `INSERT INTO vehicle_members (vehicle_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (vehicle_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [inv.vehicle_id, userId, inv.role, inv.invited_by]
      );
      await client.query('UPDATE vehicle_invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
    } else {
      await client.query('UPDATE vehicle_invitations SET declined_at = now() WHERE id = $1', [inv.id]);
    }
    await client.query('COMMIT');
    return { ok: true, vehicleId: inv.vehicle_id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Einträge eines Kontos, das gelöscht wird, an fremden (geteilten) Fahrzeugen dem Besitzer zuordnen,
 * damit dessen Verlauf vollständig bleibt. Eigene Fahrzeuge werden ohnehin mit gelöscht.
 */
async function handOverEntries(db, userId) {
  for (const tabelle of ['fillups', 'expenses', 'trips']) {
    const vorhanden = await db.query('SELECT to_regclass($1) AS t', [tabelle]);
    if (!vorhanden.rows[0].t) continue;
    await db.query(
      `UPDATE ${tabelle} e SET user_id = v.user_id
         FROM vehicles v
        WHERE e.vehicle_id = v.id AND e.user_id = $1 AND v.user_id <> $1`,
      [userId]
    );
  }
}

module.exports = {
  INVITATION_DAYS, MAX_INVITATIONS_PER_DAY, MAX_MEMBERS,
  listMembers, invite, invitationsFor, respond, handOverEntries, invitationMail
};
