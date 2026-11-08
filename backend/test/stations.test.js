// Reine Tests der Tankstellensuche, ohne Datenbank und ohne Netz (Tankerkönig wird nachgestellt)
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery, nearbyStations, clearCache } = require('../src/services/stations');

test.beforeEach(() => clearCache());

const antwort = (body, ok = true) => async () => ({ ok, json: async () => body });

test('Suchparameter: Standardwerte und Grenzen', () => {
  assert.deepEqual(parseQuery({ lat: '52.52', lng: '13.4' }), { lat: 52.52, lng: 13.4, radius: 5, type: 'all' });
  assert.equal(parseQuery({ lat: '52.52', lng: '13.4', type: 'DIESEL' }).type, 'diesel');
  assert.equal(parseQuery({ lat: '52.52', lng: '13.4', type: 'electric' }).type, 'all');
  assert.deepEqual(parseQuery({ lat: '91', lng: '13.4' }), { error: 'invalid_coordinates' });
  assert.deepEqual(parseQuery({ lat: '', lng: '13.4' }), { error: 'invalid_coordinates' });
  assert.deepEqual(parseQuery({ lng: '13.4' }), { error: 'invalid_coordinates' });
  assert.deepEqual(parseQuery({ lat: 'abc', lng: '13.4' }), { error: 'invalid_coordinates' });
  assert.deepEqual(parseQuery({ lat: '52', lng: '13', radius: '26' }), { error: 'invalid_radius' });
  assert.deepEqual(parseQuery({ lat: '52', lng: '13', radius: '0' }), { error: 'invalid_radius' });
  // nur Dezimalzahlen
  assert.deepEqual(parseQuery({ lat: '0x10', lng: '13' }), { error: 'invalid_coordinates' });
  assert.deepEqual(parseQuery({ lat: '5e1', lng: '13' }), { error: 'invalid_coordinates' });
  assert.deepEqual(parseQuery({ lat: 'Infinity', lng: '13' }), { error: 'invalid_coordinates' });
  assert.deepEqual(parseQuery({ lat: ['52', '53'], lng: '13' }), { error: 'invalid_coordinates' }, 'mehrfacher Parameter');
  assert.deepEqual(parseQuery({ lat: '52', lng: '13', radius: '0x5' }), { error: 'invalid_radius' });
  assert.deepEqual(parseQuery({ lat: ' -33.8688 ', lng: '151.2093', radius: '12.5' }), { lat: -33.8688, lng: 151.2093, radius: 12.5, type: 'all' });
  // Browser (Web-App) schickt die Koordinaten ungekürzt, iOS mit 5 Nachkommastellen
  assert.equal(parseQuery({ lat: String(48.85234567890123), lng: String(10.098765432109876) }).lat, 48.85234567890123);
  assert.equal(parseQuery({ lat: '48.85235', lng: '10.09877' }).lng, 10.09877);
});

test('eine Sorte: Preis aus "price", nach Entfernung sortiert, Key nur im Aufruf an Tankerkönig', async () => {
  let aufgerufen;
  const fetchImpl = async (url) => {
    aufgerufen = new URL(url);
    return {
      ok: true,
      json: async () => ({
        ok: true,
        stations: [
          { id: 'b', name: 'Fern', brand: 'ARAL', dist: 2.4, price: 1.759, isOpen: true, postCode: 1234,
            street: 'Weg', houseNumber: '1', place: 'Ort', lat: 52.5, lng: 13.4 },
          { id: 'a', name: ' ', brand: 'JET', dist: 0.8, price: false, isOpen: false, lat: 52.51, lng: 13.41 }
        ]
      })
    };
  };
  const stations = await nearbyStations({ lat: 52.52, lng: 13.4, radius: 5, type: 'e10' },
    { apiKey: 'geheim', fetchImpl });

  assert.equal(aufgerufen.searchParams.get('apikey'), 'geheim');
  assert.equal(aufgerufen.searchParams.get('type'), 'e10');
  assert.deepEqual(stations.map((s) => s.id), ['a', 'b']);
  assert.equal(stations[0].name, 'JET', 'ohne Namen gilt die Marke');
  assert.deepEqual(stations[0].prices, { e10: null }, 'false wird null');
  assert.deepEqual(stations[1].prices, { e10: 1.759 });
  assert.equal(stations[1].postCode, '01234', 'Postleitzahl mit führender Null');
  assert.ok(!JSON.stringify(stations).includes('geheim'), 'der Key steht nie in der Antwort');
});

test('alle Sorten: e5, e10 und diesel', async () => {
  const stations = await nearbyStations({ lat: 52, lng: 13, radius: 5, type: 'all' }, {
    apiKey: 'k',
    fetchImpl: antwort({ ok: true, stations: [{ id: 'x', name: 'X', dist: 1, e5: 1.8, e10: 1.74, diesel: null }] })
  });
  assert.deepEqual(stations[0].prices, { e5: 1.8, e10: 1.74, diesel: null });
});

test('Fehler von Tankerkönig ergeben null', async () => {
  const params = { lat: 52, lng: 13, radius: 5, type: 'all' };
  assert.equal(await nearbyStations(params, { apiKey: 'k', fetchImpl: antwort({ ok: false, message: 'apikey' }) }), null);
  assert.equal(await nearbyStations(params, { apiKey: 'k', fetchImpl: antwort({}, false) }), null);
  assert.equal(await nearbyStations(params, { apiKey: 'k', fetchImpl: async () => { throw new Error('offline'); } }), null);
});

test('Cache: gleiche Suche in der Nähe innerhalb von 2 Minuten fragt Tankerkönig nicht erneut', async () => {
  let aufrufe = 0;
  const fetchImpl = async () => {
    aufrufe += 1;
    return { ok: true, json: async () => ({ ok: true, stations: [] }) };
  };
  const now = 1_000_000;
  await nearbyStations({ lat: 52.52001, lng: 13.4, radius: 5, type: 'e5' }, { apiKey: 'k', fetchImpl, now });
  await nearbyStations({ lat: 52.52004, lng: 13.4, radius: 5, type: 'e5' }, { apiKey: 'k', fetchImpl, now: now + 60_000 });
  assert.equal(aufrufe, 1);
  await nearbyStations({ lat: 52.52, lng: 13.4, radius: 5, type: 'e5' }, { apiKey: 'k', fetchImpl, now: now + 180_000 });
  assert.equal(aufrufe, 2, 'nach Ablauf wieder frisch');
  await nearbyStations({ lat: 52.52, lng: 13.4, radius: 5, type: 'diesel' }, { apiKey: 'k', fetchImpl, now: now + 180_000 });
  assert.equal(aufrufe, 3, 'andere Sorte, eigener Eintrag');
});
