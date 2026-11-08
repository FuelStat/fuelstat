// Reine Tests der Ladestationssuche (#123), ohne Datenbank und ohne Netz (Open Charge Map wird nachgestellt).
// Übernimmt die Fälle aus dem früheren tests/LadestationenTest.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery, normalize, connectorName, nearbyChargingStations, clearCache } = require('../src/services/chargingStations');

test.beforeEach(() => clearCache());

const POIS = [
  {
    ID: 2,
    UsageCost: '0,59 €/kWh',
    NumberOfPoints: 4,
    OperatorInfo: { Title: 'EnBW mobility+' },
    StatusType: { IsOperational: true, Title: 'Operational' },
    AddressInfo: { Title: 'EnBW HPC Ellwangen', AddressLine1: 'Rotenbacher Str. 1', Town: 'Ellwangen', Postcode: '73479', Distance: 12.345, Latitude: 48.96, Longitude: 10.13 },
    Connections: [
      { ConnectionType: { Title: 'CCS (Type 2)' }, PowerKW: 300.0, Quantity: 4 },
      { ConnectionType: { Title: 'Type 2 (Socket Only)' }, PowerKW: 22.0, Quantity: 1 }
    ]
  },
  {
    ID: 1,
    OperatorInfo: { Title: '(Unknown Operator)' },
    StatusType: { IsOperational: false },
    AddressInfo: { Title: 'Rathausplatz', Town: 'Bopfingen', Distance: 0.8 },
    Connections: [{ ConnectionType: { Title: 'Type 2 (Socket Only)' }, PowerKW: 11.0, Quantity: 2 }]
  },
  'kaputt',
  null
];

test('Suchparameter wie bei Tankstellen, ohne Sorte', () => {
  assert.deepEqual(parseQuery({ lat: '48.9', lng: '10.1' }), { lat: 48.9, lng: 10.1, radius: 5 });
  assert.deepEqual(parseQuery({ lat: '48.9', lng: '10.1', radius: '15', type: 'diesel' }), { lat: 48.9, lng: 10.1, radius: 15 });
  assert.deepEqual(parseQuery({ lat: '91', lng: '10' }), { error: 'invalid_coordinates' });
  assert.deepEqual(parseQuery({ lat: '48', lng: '10', radius: '30' }), { error: 'invalid_radius' });
});

test('Aufbereitung: Sortierung, Betreiber, Betriebsstatus, Ladepunkte, Leistung, Stecker', () => {
  const s = normalize(POIS);
  assert.equal(s.length, 2, 'ungültige Einträge werden übersprungen');
  assert.equal(s[0].name, 'Rathausplatz', 'nach Entfernung sortiert');
  assert.equal(s[0].operator, null, 'unbekannter Betreiber wird ausgeblendet');
  assert.equal(s[0].isOperational, false, 'außer Betrieb erkannt');
  assert.equal(s[0].points, 2, 'Ladepunkte aus Quantity, wenn NumberOfPoints fehlt');
  assert.equal(s[0].usageCost, null);
  assert.equal(s[1].id, '2');
  assert.equal(s[1].maxKw, 300);
  assert.deepEqual(s[1].connectors, ['CCS', 'Typ 2'], 'Stecker kurz und deutsch');
  assert.equal(s[1].distanceKm, 12.3, 'Entfernung auf 0,1 km gerundet');
  assert.equal(s[1].usageCost, '0,59 €/kWh', 'Kostenhinweis übernommen');
  assert.equal(s[1].place, 'Ellwangen');
  assert.equal(s[1].street, 'Rotenbacher Str. 1');
  assert.equal(s[1].postCode, '73479');
  assert.equal(s[1].lat, 48.96);
  assert.equal(normalize([{ AddressInfo: {}, OperatorInfo: { Title: 'Stadtwerke' } }])[0].name, 'Stadtwerke', 'ohne Titel gilt der Betreiber');
  assert.deepEqual(normalize('kein Array'), []);
});

test('Steckernamen', () => {
  assert.equal(connectorName('CHAdeMO'), 'CHAdeMO');
  assert.equal(connectorName('Europlug 2-Pin (CEE 7/16)'), 'Eurostecker');
  assert.equal(connectorName('CEE 7/4 - Schuko - Type F'), 'Schuko');
  assert.equal(connectorName('IEC 60309 3-pin (CEE blue)'), 'CEE');
  assert.equal(connectorName('Tesla (Model S/X)'), 'Tesla');
  assert.equal(connectorName('Type 1 (J1772)'), 'Typ 1');
  assert.equal(connectorName(' Exotisch '), 'Exotisch');
});

test('Abfrage: Key nur im Header, nie in URL oder Antwort; Cache 6 Stunden', async () => {
  const aufrufe = [];
  const fetchImpl = async (url, opts) => {
    aufrufe.push({ url: new URL(url), opts });
    return { ok: true, json: async () => POIS };
  };
  const p = { lat: 48.9612, lng: 10.1301, radius: 15 };
  const s = await nearbyChargingStations(p, { apiKey: 'geheim', fetchImpl, now: 0 });
  assert.equal(s.length, 2);
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url.searchParams.get('distance'), '15');
  assert.equal(aufrufe[0].url.searchParams.get('distanceunit'), 'KM');
  assert.ok(!aufrufe[0].url.href.includes('geheim'), 'Key nicht in der URL');
  assert.equal(aufrufe[0].opts.headers['X-API-Key'], 'geheim');
  assert.ok(!JSON.stringify(s).includes('geheim'), 'Key nicht in der Antwort');

  await nearbyChargingStations({ ...p, lat: 48.9614 }, { apiKey: 'geheim', fetchImpl, now: 5 * 60 * 60 * 1000 });
  assert.equal(aufrufe.length, 1, 'innerhalb von 6 Stunden und ~100 m aus dem Cache');
  await nearbyChargingStations(p, { apiKey: 'geheim', fetchImpl, now: 7 * 60 * 60 * 1000 });
  assert.equal(aufrufe.length, 2, 'danach neu gefragt');
});

test('Fehler von Open Charge Map: null, nichts gecacht', async () => {
  const p = { lat: 48, lng: 10, radius: 5 };
  assert.equal(await nearbyChargingStations(p, { apiKey: 'k', fetchImpl: async () => ({ ok: false, json: async () => [] }) }), null);
  assert.equal(await nearbyChargingStations(p, { apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ fehler: 1 }) }) }), null);
  assert.equal(await nearbyChargingStations(p, { apiKey: 'k', fetchImpl: async () => { throw new Error('Timeout'); } }), null);
  let gefragt = false;
  const ok = await nearbyChargingStations(p, { apiKey: 'k', fetchImpl: async () => { gefragt = true; return { ok: true, json: async () => [] }; } });
  assert.deepEqual(ok, []);
  assert.ok(gefragt, 'Fehler wurden nicht gecacht');
});
