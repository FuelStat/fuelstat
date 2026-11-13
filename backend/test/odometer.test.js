// Reine Tests der Tachostand-Prüfung (#51), ohne Datenbank
const test = require('node:test');
const assert = require('node:assert/strict');
const { odometerWarnings } = require('../src/services/odometer');

const punkte = [
  { date: '2026-01-01', km: 10000 },
  { date: '2026-02-01', km: 11000 },
  { date: '2026-03-01', km: 12000 }
];
const codes = (w) => w.map((x) => x.code);

test('plausibler Wert ergibt keine Warnung', () => {
  assert.deepEqual(odometerWarnings(punkte, { date: '2026-02-15', km: 11500 }), []);
});

test('kleiner als ein früherer Eintrag', () => {
  const w = odometerWarnings(punkte, { date: '2026-02-15', km: 10500 });
  assert.deepEqual(codes(w), ['lower_than_previous']);
  assert.equal(w[0].refKm, 11000);
  assert.match(w[0].message, /01\.02\.2026/);
});

test('größer als ein späterer Eintrag', () => {
  assert.deepEqual(codes(odometerWarnings(punkte, { date: '2026-02-15', km: 12500 })), ['higher_than_next']);
});

test('unplausibler Sprung: mehr als 2.000 km und mehr als 800 km pro Tag', () => {
  assert.deepEqual(codes(odometerWarnings(punkte, { date: '2026-03-02', km: 15000 })), ['jump']);
  // 3.000 km in 30 Tagen ist plausibel
  assert.deepEqual(odometerWarnings(punkte, { date: '2026-03-31', km: 15000 }), []);
});

test('kleiner als bei Anschaffung, wenn es keinen früheren Eintrag gibt', () => {
  assert.deepEqual(codes(odometerWarnings([], { date: '2026-01-01', km: 500 }, 1000)), ['below_purchase']);
  assert.deepEqual(odometerWarnings([], { date: '2026-01-01', km: 1500 }, 1000), []);
});

test('ohne Tachostand (#41) wird nichts geprüft', () => {
  assert.deepEqual(odometerWarnings(punkte, { date: '2026-02-15', km: null }), []);
});

test('Einträge am selben Tag werden nach Uhrzeit verglichen', () => {
  // Gleicher Zeitpunkt: der vorhandene Eintrag gilt als früher (der neue wird danach erfasst)
  assert.deepEqual(codes(odometerWarnings(punkte, { date: '2026-02-01', km: 10900 })), ['lower_than_previous']);
  // Morgens 12.000 km, abends 11.500 km: Warnung
  const tag = [{ date: '2026-05-10', at: '2026-05-10T07:00:00Z', km: 12000 }];
  assert.deepEqual(codes(odometerWarnings(tag, { date: '2026-05-10T18:00:00Z', km: 11500 })), ['lower_than_previous']);
  // Nachgetragen für morgens, abends schon 12.000 km: höher als der spätere Eintrag
  const abends = [{ date: '2026-05-10', at: '2026-05-10T18:00:00Z', km: 12000 }];
  assert.deepEqual(codes(odometerWarnings(abends, { date: '2026-05-10T07:00:00Z', km: 12100 })), ['higher_than_next']);
  assert.deepEqual(odometerWarnings(abends, { date: '2026-05-10T07:00:00Z', km: 11900 }), []);
});
