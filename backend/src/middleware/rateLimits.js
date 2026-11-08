// Rate-Limits je Konto bzw. IP für die API, Uploads, Import, Stationssuchen und Bilder.
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const jwt = require('jsonwebtoken');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const { bearerToken } = require('./auth');

// Rate Limiting. Das PHP-Frontend ruft die API über den Server selbst auf, alle Nutzer kämen also von
// derselben IP: angemeldete Anfragen zählen deshalb je Konto, nur anonyme je IP.
function limitKey(req) {
  const token = bearerToken(req);
  if (token) {
    try {
      return 'u:' + jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }).sub;
    } catch {
      // ungültiges Token: wie anonym behandeln
    }
  }
  return 'ip:' + ipKeyGenerator(req.ip || '');
}
const limiter = (windowMs, angemeldet, anonym) => rateLimit({
  windowMs,
  limit: (req) => (limitKey(req).startsWith('u:') ? angemeldet : anonym),
  keyGenerator: limitKey,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'too_many_requests' })
});
// Eine Seite im Frontend braucht höchstens etwa 20 API-Aufrufe
const apiLimiter = limiter(60 * 1000, 600, 300);
// Nach auth eingehängt, zählen also immer je Konto
const uploadLimiter = limiter(10 * 60 * 1000, 30, 30);
const importLimiter = limiter(10 * 60 * 1000, 60, 60);
// Tankstellensuche: schont das Kontingent des Tankerkönig-Keys (Ergebnisse sind zusätzlich 2 Minuten gecacht)
const stationsLimiter = limiter(60 * 1000, 30, 30);
// Ladestationssuche (#123): schont das Open-Charge-Map-Kontingent (Ergebnisse sind zusätzlich 6 Stunden gecacht)
const chargingStationsLimiter = limiter(60 * 1000, 30, 30);
// Signierte Bilder (#103): ohne Anmeldung, zählen je IP; großzügig, eine Seite lädt mehrere Bilder
const fileLimiter = limiter(60 * 1000, 2000, 2000);

module.exports = { apiLimiter, chargingStationsLimiter, fileLimiter, importLimiter, limitKey, limiter, stationsLimiter, uploadLimiter };
