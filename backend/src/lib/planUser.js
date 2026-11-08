// Konto mit Tarif laden – für Tarifprüfungen bei Kategorien, Einträgen und Import.
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.

// Benutzer mit Tarif (für Kategorie-Prüfungen)
async function loadPlanUser(db, userId) {
  const r = await db.query('SELECT id, plan, plan_until FROM users WHERE id = $1', [userId]);
  return r.rows[0] || { id: userId, plan: 'free', plan_until: null };
}

module.exports = { loadPlanUser };
