// Tankstellen in der Nähe mit aktuellen Preisen über Tankerkönig (für die Apps, FuelStat/fuelstat#116).
// Der API-Key bleibt auf dem Server (TANKERKOENIG_API_KEY). Daten: tankerkoenig.de, Lizenz CC BY 4.0.
//
// Antworten werden kurz zwischengespeichert: Wer an der Zapfsäule mehrmals sucht, verbraucht nicht jedes Mal
// das Kontingent des Keys. Die Preise ändern sich bei Tankerkönig ohnehin nur alle paar Minuten.

const LIST_URL = 'https://creativecommons.tankerkoenig.de/json/list.php';
// Tankerkönig kennt nur diese Sorten; alles andere (Elektro, Gas …) sucht alle Tankstellen
const TYPES = new Set(['e5', 'e10', 'diesel', 'all']);
const MAX_RADIUS_KM = 25;
const CACHE_MS = 2 * 60 * 1000;
const CACHE_MAX = 500;
const TIMEOUT_MS = 10 * 1000;

const cache = new Map();

/**
 * Suchparameter aus der Query prüfen.
 * @returns {{ lat: number, lng: number, radius: number, type: string } | { error: string }}
 */
// Nur Dezimalzahlen wie "52.52" oder "-13.4" – keine Hex-, Exponent- oder Sonderschreibweisen ("0x10", "1e2", "Infinity")
const DECIMAL = /^-?\d{1,4}(\.\d{1,20})?$/;
const decimal = (v) => (typeof v === 'string' && DECIMAL.test(v.trim()) ? Number(v) : NaN);

function parseQuery(query) {
  const lat = decimal(query?.lat);
  const lng = decimal(query?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: 'invalid_coordinates' };
  }
  const radius = query?.radius === undefined || query.radius === '' ? 5 : decimal(query.radius);
  if (!Number.isFinite(radius) || radius < 1 || radius > MAX_RADIUS_KM) {
    return { error: 'invalid_radius' };
  }
  const type = String(query?.type || 'all').toLowerCase();
  return { lat, lng, radius, type: TYPES.has(type) ? type : 'all' };
}

// Preis aus Tankerkönig: Zahl oder false/null, wenn die Sorte fehlt
const price = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function normalize(station, type) {
  const prices = type === 'all'
    ? { e5: price(station.e5), e10: price(station.e10), diesel: price(station.diesel) }
    : { [type]: price(station.price) };
  return {
    id: String(station.id),
    name: text(station.name) || text(station.brand) || 'Tankstelle',
    brand: text(station.brand),
    street: text(station.street),
    houseNumber: text(station.houseNumber),
    postCode: station.postCode ? String(station.postCode).padStart(5, '0') : null,
    place: text(station.place),
    lat: Number(station.lat),
    lng: Number(station.lng),
    distanceKm: Number.isFinite(Number(station.dist)) ? Number(station.dist) : null,
    isOpen: station.isOpen === true,
    prices
  };
}

/**
 * Tankstellen im Umkreis, nach Entfernung sortiert.
 * @param {{ lat: number, lng: number, radius: number, type: string }} params aus parseQuery
 * @param {{ apiKey: string, fetchImpl?: Function, now?: number }} options
 * @returns {Promise<object[] | null>} null bei Fehlern von Tankerkönig
 */
async function nearbyStations(params, { apiKey, fetchImpl = fetch, now = Date.now() } = {}) {
  // Auf etwa 100 m runden: Nachbarn an derselben Tankstelle teilen sich den Cache
  const key = [params.type, params.radius, params.lat.toFixed(3), params.lng.toFixed(3)].join(':');
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.stations;

  const url = `${LIST_URL}?${new URLSearchParams({
    lat: String(params.lat),
    lng: String(params.lng),
    rad: String(params.radius),
    type: params.type,
    sort: 'dist',
    apikey: apiKey
  })}`;

  let data;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  if (!data || data.ok === false || !Array.isArray(data.stations)) return null;

  const stations = data.stations
    .map((s) => normalize(s, params.type))
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, stations });
  return stations;
}

function clearCache() {
  cache.clear();
}

module.exports = { parseQuery, nearbyStations, clearCache, MAX_RADIUS_KM };
