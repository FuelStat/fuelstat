// Ladestationen in der Nähe über Open Charge Map (https://openchargemap.org), Gegenstück zu services/stations.js (#123).
// Der API-Key bleibt auf dem Server (OCM_API_KEY). Daten: Open Charge Map, Lizenz CC BY 4.0 bzw. die des Datenanbieters.
// Datenmodell der Antwort: https://github.com/openchargemap/ocm-system (ChargePoint, AddressInfo, ConnectionInfo).
//
// Ladestationen ändern sich selten, deshalb hält der Cache Ergebnisse 6 Stunden für den gerundeten Standort vor.

const { parseQuery: parseStationQuery } = require('./stations');

const POI_URL = 'https://api.openchargemap.io/v3/poi/';
const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const TIMEOUT_MS = 10 * 1000;
const MAX_RESULTS = 30;

const cache = new Map();

/** Wie bei Tankstellen: lat, lng, radius (1–25 km, Standard 5); eine Sorte gibt es hier nicht. */
function parseQuery(query) {
  const p = parseStationQuery(query);
  if (p.error) return p;
  return { lat: p.lat, lng: p.lng, radius: p.radius };
}

/** Steckertypen kurz und deutsch, z. B. "Type 2 (Socket Only)" → "Typ 2", "CCS (Type 2)" → "CCS" */
function connectorName(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('ccs') || t.includes('combo')) return 'CCS';
  if (t.includes('chademo')) return 'CHAdeMO';
  if (t.includes('tesla')) return 'Tesla';
  if (t.includes('type 2') || t.includes('mennekes')) return 'Typ 2';
  if (t.includes('type 1') || t.includes('j1772')) return 'Typ 1';
  if (t.includes('schuko') || t.includes('cee 7/4')) return 'Schuko';
  if (t.includes('europlug') || t.includes('cee 7/16')) return 'Eurostecker';
  if (t.includes('cee')) return 'CEE';
  return String(title || '').trim();
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Open-Charge-Map-Treffer auf das reduzieren, was die Clients brauchen; nach Entfernung sortiert. */
function normalize(pois) {
  const list = [];
  for (const poi of Array.isArray(pois) ? pois : []) {
    if (!poi || typeof poi !== 'object' || Array.isArray(poi)) continue;
    const address = poi.AddressInfo && typeof poi.AddressInfo === 'object' ? poi.AddressInfo : {};
    const connections = Array.isArray(poi.Connections) ? poi.Connections.filter((c) => c && typeof c === 'object') : [];
    const powers = connections.map((c) => Number(c.PowerKW) || 0).filter((x) => x > 0);
    const connectors = [...new Set(connections.map((c) => connectorName(c.ConnectionType?.Title)).filter(Boolean))];
    let operator = text(poi.OperatorInfo?.Title);
    if (operator && operator.toLowerCase().includes('unknown')) operator = null;
    const points = Number(poi.NumberOfPoints) > 0
      ? Number(poi.NumberOfPoints)
      : connections.reduce((sum, c) => sum + Math.max(1, Number(c.Quantity) || 1), 0);
    const distance = num(address.Distance);

    list.push({
      id: poi.ID !== undefined && poi.ID !== null ? String(poi.ID) : null,
      name: text(address.Title) || operator || 'Ladestation',
      operator,
      street: text(address.AddressLine1),
      place: text(address.Town),
      postCode: text(address.Postcode),
      lat: num(address.Latitude),
      lng: num(address.Longitude),
      distanceKm: distance === null ? null : Math.round(distance * 10) / 10,
      points: points || null,
      maxKw: powers.length ? Math.round(Math.max(...powers) * 10) / 10 : null,
      connectors,
      usageCost: text(poi.UsageCost),
      isOperational: poi.StatusType?.IsOperational !== false
    });
  }
  return list.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

/**
 * Ladestationen im Umkreis.
 * @param {{ lat: number, lng: number, radius: number }} params aus parseQuery
 * @param {{ apiKey: string, fetchImpl?: Function, now?: number }} options
 * @returns {Promise<object[] | null>} null bei Fehlern von Open Charge Map
 */
async function nearbyChargingStations(params, { apiKey, fetchImpl = fetch, now = Date.now() } = {}) {
  // Auf etwa 100 m runden: Nachbarn teilen sich den Cache
  const key = [params.radius, params.lat.toFixed(3), params.lng.toFixed(3)].join(':');
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.stations;

  const url = `${POI_URL}?${new URLSearchParams({
    output: 'json',
    latitude: String(params.lat),
    longitude: String(params.lng),
    distance: String(params.radius),
    distanceunit: 'KM',
    maxresults: String(MAX_RESULTS),
    verbose: 'false'
  })}`;

  let data;
  try {
    // Key im Header, nicht in der URL (taucht so in keinem Log auf)
    const res = await fetchImpl(url, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json', 'User-Agent': 'Fuelstat (https://github.com/FuelStat/fuelstat)' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const stations = normalize(data);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, stations });
  return stations;
}

function clearCache() {
  cache.clear();
}

module.exports = { parseQuery, normalize, connectorName, nearbyChargingStations, clearCache };
