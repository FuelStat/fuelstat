// Anmeldung: Token ausstellen und prüfen, zuletzt aktiv/letzter Login, Admin- und Eigentümer-Prüfung.
// Aus backend/src/server.js ausgelagert (#110); auth() prüft seitdem auch, ob das Konto noch existiert.
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { pool } = require('../db');
const { UUID_RE } = require('../lib/http');

// auth_time: Zeitpunkt des letzten echten Logins (Sekunden). Beim Verlängern (#56) wird er übernommen, damit
// eine aktive Anmeldung höchstens MAX_SESSION_DAYS lang ohne Passwort weiterläuft.
const MAX_SESSION_DAYS = 90;
function signToken(user, authTime = Math.floor(Date.now() / 1000)) {
  const jti = randomUUID();
  return jwt.sign(
    { sub: user.id, email: user.email, jti, auth_time: authTime },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// "Zuletzt aktiv" für die Benutzerverwaltung: höchstens einmal pro Stunde und Benutzer in die Datenbank schreiben
const lastSeenWritten = new Map();
const LAST_SEEN_INTERVAL_MS = 60 * 60 * 1000;

function touchLastSeen(userId) {
  const now = Date.now();
  if (!userId || now - (lastSeenWritten.get(userId) || 0) < LAST_SEEN_INTERVAL_MS) return;
  lastSeenWritten.set(userId, now);
  pool.query(
    `UPDATE users SET last_seen_at = now()
     WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour')`,
    [userId]
  ).catch((e) => console.error('[last_seen]', e.message));
}

async function recordLogin(userId) {
  lastSeenWritten.set(String(userId), Date.now());
  await pool.query('UPDATE users SET last_login_at = now(), last_seen_at = now() WHERE id = $1', [userId])
    .catch((e) => console.error('[last_login]', e.message));
}

// Token aus "Authorization: Bearer <token>". Ohne überlappende Wiederholungen im Regex, damit ein
// präparierter Header die Prüfung nicht quadratisch verlangsamt (ReDoS).
function bearerToken(req) {
  const h = String(req.header('Authorization') || '');
  if (h.length > 8192) return null;
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(h);
  return m ? m[1] : null;
}

async function auth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'missing_token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const sub = String(payload.sub || '');
    if (!UUID_RE.test(sub)) return res.status(401).json({ error: 'invalid_token' });

    // Gerätesitzung (#117): Zugriffstokens der Apps tragen die id ihrer Sitzung
    const sid = payload.sid === undefined ? null : String(payload.sid);
    if (sid !== null && !UUID_RE.test(sid)) return res.status(401).json({ error: 'invalid_token' });

    // Eine Abfrage für vier Prüfungen: Konto existiert noch (gelöschte Konten – auch Admins aus ADMIN_USER_IDS –
    // dürfen mit alten Tokens nichts mehr tun), Token einzeln widerrufen (jti), alle Tokens des Kontos widerrufen,
    // Gerätesitzung beendet
    const r = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM revoked_tokens WHERE jti = $2) AS jti_revoked,
              (SELECT revoked_after FROM user_token_revocations WHERE user_id = u.id) AS revoked_after,
              ($3::uuid IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM device_sessions s WHERE s.id = $3 AND s.user_id = u.id AND s.revoked_at IS NULL)) AS session_revoked
         FROM users u WHERE u.id = $1`,
      [sub, payload.jti ? String(payload.jti) : null, sid]
    );
    if (r.rowCount === 0) return res.status(401).json({ error: 'account_not_found' });
    if (r.rows[0].jti_revoked) return res.status(401).json({ error: 'token_revoked' });
    if (r.rows[0].session_revoked) return res.status(401).json({ error: 'session_revoked' });

    // User-weite Revocation: alle Tokens vor revoked_after sind ungültig
    if (r.rows[0].revoked_after && payload.iat) {
      const revokedAfter = new Date(r.rows[0].revoked_after);
      const tokenIat = new Date(payload.iat * 1000); // iat ist in Sekunden
      if (tokenIat < revokedAfter) {
        return res.status(401).json({ error: 'token_revoked_for_user' });
      }
    }

    req.user = payload;
    touchLastSeen(String(payload.sub || ''));
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// Admins werden über ADMIN_USER_IDS (kommagetrennte User-IDs) in der .env festgelegt
function isAdmin(req) {
  const adminIds = String(process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return adminIds.includes(String(req.user?.sub || ''));
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    // Abgewiesene Zugriffe auf Admin-Funktionen protokollieren (#102): Konto, Methode, Route – ohne Body und Token.
    // Routenmuster statt der aufgerufenen URL, damit kein Text vom Client ins Log gelangt (Log-Injection).
    const route = String(req.baseUrl || '') + String(req.route?.path || '');
    const konto = UUID_RE.test(String(req.user?.sub || '')) ? req.user.sub : '-';
    const methode = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? req.method : 'ANDERE';
    console.warn(`[admin] abgewiesen: ${methode} ${route || '(unbekannte Route)'} von Konto ${konto}`);
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
}

// Zugriff nur auf den eigenen User (:userId), außer für Admins
function requireSelfOrAdmin(req, res, next) {
  const userId = String(req.params.userId || '').trim();
  if (userId !== String(req.user?.sub || '') && !isAdmin(req)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
}

module.exports = { LAST_SEEN_INTERVAL_MS, MAX_SESSION_DAYS, auth, bearerToken, isAdmin, lastSeenWritten, recordLogin, requireAdmin, requireSelfOrAdmin, signToken, touchLastSeen };
