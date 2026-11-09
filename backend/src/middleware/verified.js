// Grenzen für Konten mit noch nicht bestätigter E-Mail-Adresse (#135). Setzt nur die API durch.
// Erlaubt: ein Fahrzeug, ein Eintrag, eigene Daten ansehen, Profil/Passwort/2FA, Konto löschen.
// Gesperrt: alles Übrige, was Mails auslöst, Speicher oder fremde Kontingente verbraucht oder andere erreicht.
// Antwort: 403 { error: 'email_not_verified', feature[, limit] }.
const { pool } = require('../db');
const { serverError } = require('../lib/http');

const UNVERIFIED_LIMITS = { maxVehicles: 1, maxEntries: 1 };

function notVerified(res, feature, extra = {}) {
  return res.status(403).json({ error: 'email_not_verified', feature, ...extra });
}

async function verifiedAt(userId) {
  const r = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.email_verified_at || null;
}

/** Ganze Funktion nur mit bestätigter Adresse (Middleware hinter auth). */
function requireVerified(feature) {
  return async (req, res, next) => {
    try {
      if (await verifiedAt(req.user.sub)) return next();
      return notVerified(res, feature);
    } catch (e) {
      return serverError(res, e);
    }
  };
}

/**
 * Anlegen mit Grenze: null = erlaubt, sonst wurde schon 403 geantwortet.
 * kind 'vehicle' (eigene Fahrzeuge) oder 'entry' (alle selbst erfassten Tank-/Ladevorgänge, Ausgaben, Fahrten).
 */
async function checkUnverifiedLimit(res, userId, kind) {
  if (await verifiedAt(userId)) return null;
  const sql = kind === 'vehicle'
    ? 'SELECT COUNT(*)::int AS n FROM vehicles WHERE user_id = $1'
    : `SELECT (SELECT COUNT(*) FROM fillups WHERE user_id = $1)
            + (SELECT COUNT(*) FROM expenses WHERE user_id = $1)
            + (SELECT COUNT(*) FROM trips WHERE user_id = $1) AS n`;
  const r = await pool.query(sql, [userId]);
  const feature = kind === 'vehicle' ? 'maxVehicles' : 'maxEntries';
  const limit = UNVERIFIED_LIMITS[feature];
  if (Number(r.rows[0].n) >= limit) return notVerified(res, feature, { limit });
  return null;
}

module.exports = { UNVERIFIED_LIMITS, requireVerified, checkUnverifiedLimit, notVerified };
