// Konto löschen: vom Konto selbst, vom Admin (DELETE /auth/users/:id) und beim Aufräumen unbestätigter Konten (#141).
const fs = require('fs');
const sharing = require('./sharing');
const { storedMediaPath } = require('../middleware/upload');

/**
 * Löscht das Konto mit eigenen Fahrzeugen und Einträgen. Einträge an geteilten Fahrzeugen anderer gehen an den
 * jeweiligen Besitzer über (#53). Hochgeladene Bilder des Kontos werden danach entfernt.
 * @returns true, wenn es das Konto gab
 */
async function deleteAccount(pool, userId) {
  // Nur Dateien, die das Konto selbst hochgeladen hat: profile_image_url könnte aus der Zeit vor #196 auf eine fremde
  // Datei zeigen.
  const media = await pool.query(
    `SELECT url FROM user_media WHERE user_id = $1
     UNION SELECT url FROM vehicle_media WHERE user_id = $1`,
    [userId]
  );
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
  if (r.rowCount === 0) return false;
  await Promise.all(media.rows.map(({ url }) => {
    const p = storedMediaPath(url);
    return p ? fs.promises.unlink(p).catch(() => {}) : null;
  }));
  return true;
}

module.exports = { deleteAccount };
