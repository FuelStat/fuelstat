// Tarif ändern und protokollieren (#102). Einzige Stelle, die users.plan und users.plan_until schreibt.
// Aufrufer: Admin-Endpunkte (source 'admin'), backend/scripts/tarif-setzen.js ('cli'),
// später ein verifizierter Zahlungsanbieter-Webhook ('webhook', #59).
// Ins Protokoll kommen nur tatsächliche Änderungen; keine Tokens oder Zahlungsdaten.

const SOURCES = ['admin', 'cli', 'webhook'];

function sameTime(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

// Setzt den Tarif für alle userIds in einer Transaktion. Liefert die betroffenen Konten mit altem und neuem Stand.
// Unbekannte IDs werden übergangen (nicht in der Ergebnisliste).
async function setPlans(pool, { userIds, plan, planUntil = null, source, changedBy = null, note = null }) {
  if (!SOURCES.includes(source)) throw new Error(`unbekannte Quelle: ${source}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const alt = await client.query(
      'SELECT id, email, plan, plan_until FROM users WHERE id = ANY($1::uuid[]) FOR UPDATE',
      [userIds]
    );
    const result = [];
    for (const u of alt.rows) {
      const changed = u.plan !== plan || !sameTime(u.plan_until, planUntil);
      if (changed) {
        await client.query('UPDATE users SET plan = $2, plan_until = $3, updated_at = now() WHERE id = $1', [
          u.id, plan, planUntil
        ]);
        await client.query(
          `INSERT INTO plan_changes (user_id, old_plan, old_plan_until, new_plan, new_plan_until, source, changed_by, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [u.id, u.plan, u.plan_until, plan, planUntil, source, changedBy, note]
        );
      }
      result.push({ id: u.id, email: u.email, oldPlan: u.plan, oldPlanUntil: u.plan_until, plan, plan_until: planUntil, changed });
    }
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function history(db, userId, limit = 50) {
  const r = await db.query(
    `SELECT old_plan, old_plan_until, new_plan, new_plan_until, source, changed_by, note, created_at
       FROM plan_changes WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return r.rows.map((x) => ({
    oldPlan: x.old_plan,
    oldPlanUntil: x.old_plan_until,
    newPlan: x.new_plan,
    newPlanUntil: x.new_plan_until,
    source: x.source,
    changedBy: x.changed_by,
    note: x.note,
    createdAt: x.created_at
  }));
}

module.exports = { setPlans, history, SOURCES };
