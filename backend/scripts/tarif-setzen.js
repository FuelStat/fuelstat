#!/usr/bin/env node
// Tarif eines Kontos setzen oder anzeigen – Betreiberweg ohne Web-Oberfläche (#102).
// Jede Änderung landet mit Quelle "cli" im Protokoll (Tabelle plan_changes).
//
// Aufruf im API-Container (liest DATABASE_URL wie die API):
//   docker compose exec api node scripts/tarif-setzen.js <E-Mail oder Konto-ID>                     # Tarif und Verlauf anzeigen
//   docker compose exec api node scripts/tarif-setzen.js <E-Mail oder Konto-ID> plus                # Plus, unbefristet
//   docker compose exec api node scripts/tarif-setzen.js <E-Mail oder Konto-ID> plus --bis 2027-06-30 --notiz "Tester"
//   docker compose exec api node scripts/tarif-setzen.js <E-Mail oder Konto-ID> free                # zurück auf Free
const { Pool } = require('pg');
const plans = require('../src/services/plans');
const planChanges = require('../src/services/planChanges');

function fehler(text) {
  console.error(text);
  process.exit(1);
}

function option(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const [konto, plan] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
if (!konto) fehler('Aufruf: node scripts/tarif-setzen.js <E-Mail oder Konto-ID> [free|plus|fleet] [--bis JJJJ-MM-TT] [--notiz "…"]');
if (plan && !plans.PLAN_NAMES.includes(plan)) fehler(`Unbekannter Tarif "${plan}". Erlaubt: ${plans.PLAN_NAMES.join(', ')}`);

let planUntil = null;
const bis = option('--bis');
if (bis) {
  const d = new Date(bis);
  if (Number.isNaN(d.getTime())) fehler('--bis im Format JJJJ-MM-TT angeben');
  planUntil = d.toISOString();
}
if (plan === 'free') planUntil = null;
const note = option('--notiz') ? String(option('--notiz')).slice(0, 200) : null;

async function main() {
  if (!process.env.DATABASE_URL) fehler('DATABASE_URL fehlt');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const feld = konto.includes('@') ? 'lower(email) = lower($1)' : 'id::text = $1';
    const r = await pool.query(`SELECT id, email, plan, plan_until FROM users WHERE ${feld}`, [konto]);
    if (r.rowCount === 0) fehler(`Konto "${konto}" nicht gefunden`);
    const u = r.rows[0];

    if (plan) {
      const [neu] = await planChanges.setPlans(pool, { userIds: [u.id], plan, planUntil, source: 'cli', note });
      console.log(neu.changed
        ? `${u.email}: ${u.plan} → ${plan}${planUntil ? ` bis ${planUntil.slice(0, 10)}` : ''}`
        : `${u.email}: unverändert (${plan})`);
    } else {
      const info = plans.planInfo(u);
      console.log(`${u.email} (${u.id})`);
      console.log(`Tarif: ${info.plan}${info.planUntil ? ` bis ${String(info.planUntil).slice(0, 10)}` : ''}, wirksam: ${info.effectivePlan}`);
    }

    const verlauf = await planChanges.history(pool, u.id, 10);
    if (verlauf.length) {
      console.log('Verlauf:');
      for (const c of verlauf) {
        console.log(`  ${c.createdAt.toISOString().slice(0, 16).replace('T', ' ')}  ${c.oldPlan} → ${c.newPlan}`
          + `${c.newPlanUntil ? ` bis ${c.newPlanUntil.toISOString().slice(0, 10)}` : ''}  (${c.source}${c.note ? `: ${c.note}` : ''})`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => fehler(e.message));
