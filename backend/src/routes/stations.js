// Routen: /charging-stations, /stations
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const chargingStations = require('../services/chargingStations');
const stations = require('../services/stations');
const { auth } = require('../middleware/auth');
const { chargingStationsLimiter, stationsLimiter } = require('../middleware/rateLimits');

const router = express.Router();

// Tankstellen in der Nähe mit aktuellen Preisen (Tankerkönig), z. B. für die Erfassung in den Apps.
// Nur angemeldet: sonst könnte jeder das Kontingent des Keys verbrauchen. Der Key verlässt den Server nie.
router.get('/stations', auth, stationsLimiter, async (req, res) => {
  const apiKey = String(process.env.TANKERKOENIG_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'stations_not_configured' });

  const params = stations.parseQuery(req.query);
  if (params.error) return res.status(400).json({ error: params.error });

  const list = await stations.nearbyStations(params, { apiKey });
  if (!list) return res.status(502).json({ error: 'stations_unavailable' });
  res.json({ stations: list, source: 'Tankerkönig', license: 'CC BY 4.0', sourceUrl: 'https://www.tankerkoenig.de' });
});

// Ladestationen in der Nähe (Open Charge Map, #123), für Web-App und Apps. Der Key verlässt den Server nie.
router.get('/charging-stations', auth, chargingStationsLimiter, async (req, res) => {
  const apiKey = String(process.env.OCM_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'charging_stations_not_configured' });

  const params = chargingStations.parseQuery(req.query);
  if (params.error) return res.status(400).json({ error: params.error });

  const list = await chargingStations.nearbyChargingStations(params, { apiKey });
  if (!list) return res.status(502).json({ error: 'charging_stations_unavailable' });
  res.json({ stations: list, source: 'Open Charge Map', license: 'CC BY 4.0', sourceUrl: 'https://openchargemap.org' });
});

// ============================================
// Media Upload Endpoints (User Media)
// ============================================

module.exports = router;
