// Gerätesitzungen für native Apps (#117): kurzlebiges Zugriffstoken plus Refresh-Token je Gerät.
//
// - Das Refresh-Token ist zufällig (32 Byte) und steht nur als SHA-256-Hash in der Datenbank.
// - Jede Verwendung tauscht es gegen ein neues (Rotation). Kommt ein bereits verwendetes Token noch einmal, ist es
//   vermutlich gestohlen: Die ganze Gerätesitzung wird beendet. Ausnahme: innerhalb von REUSE_GRACE_SECONDS nach der
//   Verwendung (zwei gleichzeitige Anfragen derselben App) gibt es nur einen Fehler, die Sitzung bleibt bestehen.
// - Zugriffstokens einer Gerätesitzung tragen deren id (sid); middleware/auth.js lehnt sie ab, sobald die Sitzung
//   beendet ist. Die Web-App nutzt weiter die bisherigen 7-Tage-Tokens ohne Gerätesitzung.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PLATFORMS = ['ios', 'android', 'other'];
const ACCESS_TOKEN_SECONDS = 30 * 60;
const SESSION_IDLE_DAYS = 180;
const REUSE_GRACE_SECONDS = 30;
// Verwendete Refresh-Tokens so lange aufheben, um Wiederverwendung zu erkennen
const USED_TOKEN_KEEP_DAYS = 30;

const SESSION_COLUMNS = 'id, name, platform, app_version, created_at, last_used_at';

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Angaben zum Gerät aus dem Login prüfen. Ohne device bleibt es beim bisherigen Token der Web-App.
 * @returns {{ device: null } | { device: { name, platform, appVersion } } | { error: string }}
 */
function parseDevice(input) {
  if (input === undefined || input === null) return { device: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'invalid_device' };
  const name = text(input.name, 100);
  const platform = typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : '';
  if (!name) return { error: 'invalid_device_name' };
  if (!PLATFORMS.includes(platform)) return { error: 'invalid_device_platform' };
  return { device: { name, platform, appVersion: text(input.appVersion, 30) } };
}

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newRefreshToken = () => crypto.randomBytes(32).toString('base64url');

function signAccessToken(user, sessionId, authTime) {
  return jwt.sign(
    { sub: user.id, email: user.email, jti: crypto.randomUUID(), sid: sessionId, auth_time: authTime },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_SECONDS }
  );
}

async function issueRefreshToken(db, sessionId) {
  const token = newRefreshToken();
  await db.query('INSERT INTO device_refresh_tokens (token_hash, session_id) VALUES ($1, $2)', [hash(token), sessionId]);
  return token;
}

const sessionOut = (row) => ({
  id: row.id,
  name: row.name,
  platform: row.platform,
  app_version: row.app_version,
  created_at: row.created_at,
  last_used_at: row.last_used_at
});

/** Neue Gerätesitzung nach erfolgreichem Login. Liefert die Felder für die Login-Antwort. */
async function createSession(db, user, device) {
  // Nebenbei aufräumen: beendete und lange nicht genutzte Sitzungen dieses Kontos
  await db.query(
    `DELETE FROM device_sessions
      WHERE user_id = $1 AND (revoked_at < now() - interval '30 days'
                              OR last_used_at < now() - make_interval(days => $2 + 30))`,
    [user.id, SESSION_IDLE_DAYS]
  );
  const r = await db.query(
    `INSERT INTO device_sessions (user_id, name, platform, app_version) VALUES ($1, $2, $3, $4)
     RETURNING ${SESSION_COLUMNS}, extract(epoch from created_at)::bigint AS auth_time`,
    [user.id, device.name, device.platform, device.appVersion]
  );
  const s = r.rows[0];
  return {
    token: signAccessToken(user, s.id, Number(s.auth_time)),
    refreshToken: await issueRefreshToken(db, s.id),
    expiresIn: ACCESS_TOKEN_SECONDS,
    session: sessionOut(s)
  };
}

/**
 * Refresh-Token gegen neues Zugriffs- und Refresh-Token tauschen (Rotation).
 * @returns {{ token, refreshToken, expiresIn } | { error: string }}
 */
async function refresh(pool, refreshToken, { appVersion } = {}) {
  if (typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 200) {
    return { error: 'invalid_refresh_token' };
  }
  const h = hash(refreshToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Atomar als verwendet markieren: von zwei gleichzeitigen Anfragen gewinnt genau eine
    const used = await client.query(
      'UPDATE device_refresh_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING session_id',
      [h]
    );
    if (used.rowCount === 0) {
      const alt = await client.query(
        `SELECT session_id, used_at > now() - make_interval(secs => $2) AS in_grace
           FROM device_refresh_tokens WHERE token_hash = $1`,
        [h, REUSE_GRACE_SECONDS]
      );
      if (alt.rowCount === 0) {
        await client.query('ROLLBACK');
        return { error: 'invalid_refresh_token' };
      }
      if (!alt.rows[0].in_grace) {
        // Wiederverwendung: Sitzung beenden, auch das zuletzt ausgegebene Token gilt nicht mehr
        await client.query(
          `UPDATE device_sessions SET revoked_at = now(), revoked_reason = 'refresh_token_reused'
            WHERE id = $1 AND revoked_at IS NULL`,
          [alt.rows[0].session_id]
        );
        await client.query('COMMIT');
        console.warn(`[sessions] Refresh-Token wiederverwendet, Sitzung ${alt.rows[0].session_id} beendet`);
        return { error: 'refresh_token_reused' };
      }
      await client.query('ROLLBACK');
      return { error: 'refresh_token_already_used' };
    }

    const s = await client.query(
      `SELECT s.id, s.revoked_at, s.last_used_at < now() - make_interval(days => $2) AS idle,
              extract(epoch from s.created_at)::bigint AS auth_time, u.id AS user_id, u.email
         FROM device_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1`,
      [used.rows[0].session_id, SESSION_IDLE_DAYS]
    );
    const row = s.rows[0];
    if (!row || row.revoked_at || row.idle) {
      await client.query('ROLLBACK');
      return { error: !row || row.revoked_at ? 'session_revoked' : 'session_expired' };
    }
    await client.query(
      'UPDATE device_sessions SET last_used_at = now(), app_version = COALESCE($2, app_version) WHERE id = $1',
      [row.id, text(appVersion, 30)]
    );
    await client.query(
      `DELETE FROM device_refresh_tokens
        WHERE session_id = $1 AND used_at < now() - make_interval(days => $2)`,
      [row.id, USED_TOKEN_KEEP_DAYS]
    );
    const neu = await issueRefreshToken(client, row.id);
    await client.query('COMMIT');
    return {
      token: signAccessToken({ id: row.user_id, email: row.email }, row.id, Number(row.auth_time)),
      refreshToken: neu,
      expiresIn: ACCESS_TOKEN_SECONDS
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Aktive Gerätesitzungen eines Kontos, zuletzt genutzte zuerst */
async function listSessions(db, userId) {
  const r = await db.query(
    `SELECT ${SESSION_COLUMNS} FROM device_sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND last_used_at >= now() - make_interval(days => $2)
      ORDER BY last_used_at DESC, id`,
    [userId, SESSION_IDLE_DAYS]
  );
  return r.rows.map(sessionOut);
}

/** Eine Gerätesitzung des Kontos beenden. @returns {boolean} gefunden */
async function revokeSession(db, userId, sessionId, reason = 'logout') {
  const r = await db.query(
    `UPDATE device_sessions SET revoked_at = now(), revoked_reason = $3
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sessionId, userId, reason]
  );
  return r.rowCount > 0;
}

/**
 * „Auf allen Geräten abmelden“: alle bisherigen Zugriffstokens (auch der Web-App) und alle Gerätesitzungen.
 * Für Passwortänderung, Passwort-Reset und /auth/users/:id/revoke-all.
 */
async function revokeAllForUser(db, userId, reason) {
  const r = await db.query(
    `INSERT INTO user_token_revocations (user_id, revoked_after, reason) VALUES ($1, now(), $2)
     ON CONFLICT (user_id) DO UPDATE SET revoked_after = now(), reason = COALESCE(EXCLUDED.reason, user_token_revocations.reason)
     RETURNING user_id, revoked_after, reason`,
    [userId, reason]
  );
  await db.query(
    `UPDATE device_sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason || 'revoke_all']
  );
  return r.rows[0];
}

module.exports = {
  PLATFORMS, ACCESS_TOKEN_SECONDS, SESSION_IDLE_DAYS, REUSE_GRACE_SECONDS,
  parseDevice, createSession, refresh, listSessions, revokeSession, revokeAllForUser, hash
};
