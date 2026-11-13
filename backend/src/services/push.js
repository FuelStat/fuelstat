// Push-Benachrichtigungen (#136). Heute Web Push für die installierte PWA (Android, iOS ab 16.4, Desktop-Browser);
// die Tabelle push_devices kennt schon APNs und FCM, damit native Apps später nur andocken.
//
// - VAPID-Schlüssel nur im Backend (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in infra/.env). Ohne Schlüssel
//   ist Push aus; die Web-App zeigt dann keinen Knopf.
// - Inhalte sind Ende-zu-Ende verschlüsselt (RFC 8291): Der Push-Dienst des Browser-Herstellers (Google, Apple,
//   Mozilla, Microsoft) sieht nur Adresse, Größe und Zeitpunkt. Texte bleiben trotzdem knapp.
// - Abos, die der Push-Dienst mit 404/410 ablehnt (abgemeldet, Browserdaten gelöscht), werden sofort gelöscht.
// - Adressen nur von bekannten Push-Diensten (sonst könnte ein Abo die API Anfragen an beliebige Server schicken).
// - Je Anlass TTL (wie lange der Push-Dienst für ein Gerät ohne Netz aufhebt), Urgency (very-low … high, spart Akku)
//   und Topic (ersetzt eine noch nicht zugestellte Nachricht desselben Anlasses) – siehe Apple „Sending web push
//   notifications in web apps and browsers“, gilt genauso für Google und Mozilla.
// - Der VAPID-JWT wird je Push-Dienst nur alle VAPID_REFRESH_MS neu signiert (Apple: nicht öfter als stündlich).
// - Fehler mit Grund (z. B. 403 BadJwtToken, 413 PayloadTooLarge) landen in push_devices.last_error;
//   404/410 löschen das Gerät, 429/5xx gelten als vorübergehend (der Anlass wird beim nächsten Lauf wiederholt).
const webpush = require('web-push');
const vapidHelper = require('web-push/src/vapid-helper');

const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const MAX_DEVICES = 20;
const TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 28 * 24 * 60 * 60;
const URGENCIES = ['very-low', 'low', 'normal', 'high'];
// Payload höchstens 4 KB (Apple, RFC 8291); unsere Nachrichten bleiben weit darunter
const MAX_PAYLOAD_BYTES = 3000;
const VAPID_REFRESH_MS = 6 * 60 * 60 * 1000;
const VAPID_VALID_SECONDS = 12 * 60 * 60;

// VAPID-Kopfzeile je Push-Dienst (Origin der Adresse) zwischenspeichern
const vapidCache = new Map();
function vapidAuthorization(endpoint, cfg, now = Date.now()) {
  const audience = new URL(endpoint).origin;
  const key = `${audience}|${cfg.publicKey}|${cfg.subject}`;
  const hit = vapidCache.get(key);
  if (hit && now - hit.at < VAPID_REFRESH_MS) return hit.header;
  const header = vapidHelper.getVapidHeaders(audience, cfg.subject, cfg.publicKey, cfg.privateKey, 'aes128gcm',
    Math.floor(now / 1000) + VAPID_VALID_SECONDS).Authorization;
  vapidCache.set(key, { header, at: now });
  return header;
}

// Grund aus der Antwort des Push-Dienstes, z. B. Apple {"reason":"BadJwtToken"}
function fehlerText(e) {
  if (!e || !e.statusCode) return String((e && e.message) || e).slice(0, 200);
  let grund = '';
  try {
    grund = JSON.parse(e.body || '{}').reason || '';
  } catch {
    grund = String(e.body || '').trim().slice(0, 80);
  }
  return `HTTP ${e.statusCode}${grund ? ' ' + grund : ''}`.slice(0, 200);
}

/** VAPID-Konfiguration oder null, wenn Push auf diesem Server aus ist */
function config() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) return null;
  // Kontakt für die Push-Dienste: mailto: oder https-Adresse; ohne Angabe die Adresse der Web-App
  let subject = String(process.env.VAPID_SUBJECT || '').trim();
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    const app = String(process.env.APP_URL || '').trim();
    subject = /^https:\/\//.test(app) ? app : 'mailto:admin@localhost';
  }
  return { publicKey, privateKey, subject };
}

/** Adresse eines Web-Push-Abos prüfen: https und ein bekannter Push-Dienst */
function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

const b64url = (v, min, max) => typeof v === 'string' && /^[A-Za-z0-9_-]+=*$/.test(v) && v.length >= min && v.length <= max;

/**
 * Abo aus der Anfrage prüfen ({ kind: 'webpush', endpoint, keys: { p256dh, auth }, name }).
 * @returns {{ device } | { error }}
 */
function parseDevice(body = {}) {
  const kind = body.kind === undefined ? 'webpush' : String(body.kind);
  if (kind !== 'webpush') return { error: 'unsupported_kind' };
  if (!validEndpoint(body.endpoint)) return { error: 'invalid_endpoint' };
  const keys = body.keys || {};
  if (!b64url(keys.p256dh, 80, 120) || !b64url(keys.auth, 16, 40)) return { error: 'invalid_keys' };
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  return { device: { kind, endpoint: body.endpoint, p256dh: keys.p256dh, auth: keys.auth, name } };
}

// Versand; in Tests durch ein Test-Double ersetzbar
let sender = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);
function setSender(fn) {
  sender = fn || ((subscription, payload, options) => webpush.sendNotification(subscription, payload, options));
}

/**
 * Nachricht an alle Web-Push-Geräte eines Kontos.
 * @param message { title, body, url (relativ zur App, z. B. "pages/fahrzeug_detail.php?id=…"), tag (zugleich Topic),
 *   badge (Zahl fürs App-Symbol, optional), ttl (Sekunden), urgency }
 * @returns {{ sent: number, failed: number, removed: number }}
 */
async function sendToUser(db, userId, message) {
  const cfg = config();
  const result = { sent: 0, failed: 0, removed: 0 };
  if (!cfg) return result;
  const r = await db.query(`SELECT id, endpoint, p256dh, auth FROM push_devices WHERE user_id = $1 AND kind = 'webpush'`, [userId]);
  const tag = /^[A-Za-z0-9_-]{1,32}$/.test(String(message.tag || '')) ? message.tag : undefined;
  const payload = JSON.stringify({
    title: String(message.title || 'Fuelstat').slice(0, 80),
    body: String(message.body || '').slice(0, 240),
    url: String(message.url || '').slice(0, 300),
    tag,
    badge: Number.isInteger(message.badge) && message.badge >= 0 ? message.badge : undefined
  });
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error('push_payload_too_large');
  const ttl = Number.isInteger(message.ttl) ? Math.min(Math.max(message.ttl, 0), MAX_TTL_SECONDS) : TTL_SECONDS;
  const urgency = URGENCIES.includes(message.urgency) ? message.urgency : 'normal';
  for (const d of r.rows) {
    try {
      await sender({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, {
        // VAPID selbst (zwischengespeichert), web-push signiert sonst bei jeder Nachricht neu
        vapidDetails: null,
        headers: { Authorization: vapidAuthorization(d.endpoint, cfg) },
        TTL: ttl,
        urgency,
        ...(tag ? { topic: tag } : {})
      });
      result.sent++;
      await db.query('UPDATE push_devices SET last_used_at = now(), last_error = NULL WHERE id = $1', [d.id]);
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        result.removed++;
        await db.query('DELETE FROM push_devices WHERE id = $1', [d.id]);
      } else {
        result.failed++;
        const text = fehlerText(e);
        if (e && (e.statusCode === 403 || e.statusCode === 400 || e.statusCode === 413)) console.warn('[push]', d.id, text);
        await db.query('UPDATE push_devices SET last_error = $2 WHERE id = $1', [d.id, text]);
      }
    }
  }
  return result;
}

async function hasDevices(db, userId) {
  const r = await db.query(`SELECT 1 FROM push_devices WHERE user_id = $1 AND kind = 'webpush' LIMIT 1`, [userId]);
  return r.rowCount > 0;
}

module.exports = { MAX_DEVICES, PUSH_HOSTS, config, validEndpoint, parseDevice, sendToUser, hasDevices, setSender, vapidAuthorization, fehlerText };
