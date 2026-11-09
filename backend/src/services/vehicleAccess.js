// Zugriff auf Fahrzeuge (#53, Fahrzeuge teilen): eine zentrale Prüfung statt "user_id = $x" an jeder Stelle.
//
// Rollen
//   owner  – Besitzer (vehicles.user_id): alles, auch Fahrzeugdaten, Bilder, Import, Teilen und Löschen
//   editor – Mitfahrer: alles sehen, Tank-/Ladevorgänge, Ausgaben und Fahrten erfassen; eigene Einträge
//            bearbeiten und löschen
//   viewer – Nur ansehen
// Mitglieder stehen in vehicle_members; der Besitzer steht dort nicht, er ergibt sich aus vehicles.user_id.

const ROLES = ['owner', 'editor', 'viewer'];
const MEMBER_ROLES = ['editor', 'viewer'];
const RECHTE = {
  read: new Set(['owner', 'editor', 'viewer']),
  write: new Set(['owner', 'editor']), // Einträge erfassen
  manage: new Set(['owner']) // Fahrzeug ändern, Bilder, Import, Teilen, Löschen
};

/** Rolle des Kontos beim Fahrzeug oder null (kein Zugriff bzw. Fahrzeug gibt es nicht). */
async function vehicleRole(db, userId, vehicleId) {
  const r = await db.query(
    `SELECT CASE WHEN v.user_id = $1 THEN 'owner' ELSE m.role END AS role
       FROM vehicles v
       LEFT JOIN vehicle_members m ON m.vehicle_id = v.id AND m.user_id = $1
      WHERE v.id = $2`,
    [userId, vehicleId]
  );
  return r.rows[0]?.role ?? null;
}

/** Darf das Konto die Aktion (read | write | manage) am Fahrzeug ausführen? */
async function canAccessVehicle(db, userId, vehicleId, action = 'read') {
  const role = await vehicleRole(db, userId, vehicleId);
  return Boolean(role && RECHTE[action]?.has(role));
}

/**
 * Darf das Konto einen Eintrag (Tank-/Ladevorgang, Ausgabe, Fahrt) ändern oder löschen?
 * Besitzer alle, Mitfahrer nur selbst erfasste, Nur-Ansehen keine.
 */
function canEditEntry(role, entryUserId, userId) {
  if (role === 'owner') return true;
  return role === 'editor' && String(entryUserId) === String(userId);
}

/** SQL-Bedingung "Fahrzeug, auf das $n Zugriff hat", z. B. `WHERE ${accessibleVehicles('v', 1)}` */
function accessibleVehicles(alias, param) {
  return `(${alias}.user_id = $${param} OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = ${alias}.id AND vm.user_id = $${param}))`;
}

module.exports = { ROLES, MEMBER_ROLES, RECHTE, vehicleRole, canAccessVehicle, canEditEntry, accessibleVehicles };
