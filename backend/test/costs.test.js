// Reine Tests der Kostenberechnung (#124), ohne Datenbank: die Abfragen werden nachgestellt.
const test = require('node:test');
const assert = require('node:assert/strict');
const { getVehicleCosts, monthOf, previousMonth } = require('../src/services/costs');

// Zeilen wie aus loadRows: Tank-/Ladevorgänge (src fillup, kind = Einheit) und Ausgaben (kind = Kategorie)
const ZEILEN = [
  { src: 'fillup', kind: 'l', cost: 60, odo: 10000, at: '2025-11-10T12:00:00Z' },
  { src: 'fillup', kind: 'l', cost: 50, odo: 10500, at: '2025-12-20T12:00:00Z' },
  { src: 'expense', kind: 'Versicherung', cost: 300, odo: null, at: '2026-01-02T12:00:00Z' },
  { src: 'expense', kind: 'Kilometerstand', cost: 0, odo: 10800, at: '2026-01-15T12:00:00Z' },
  // 23:30 UTC am 31.1. ist in Berlin schon der 1.2.
  { src: 'fillup', kind: 'l', cost: 55, odo: 11000, at: '2026-01-31T23:30:00Z' },
  { src: 'expense', kind: 'Fahrt', cost: 12, odo: null, at: '2026-02-05T12:00:00Z' }
].map((z, i) => ({ ...z, created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));

function fakeDb(zeilen, gehoert = true) {
  return {
    query: async (sql) => (sql.includes('FROM vehicles')
      ? { rowCount: gehoert ? 1 : 0, rows: gehoert ? [{ role: 'owner' }] : [] } // Zugriffsprüfung (#53)
      : { rowCount: zeilen.length, rows: zeilen })
  };
}
const NOW = new Date('2026-03-15T10:00:00Z');

test('Monate in Europe/Berlin', () => {
  assert.equal(monthOf(new Date('2025-12-31T23:30:00Z')), '2026-01');
  assert.equal(monthOf(new Date('2026-06-30T21:59:00Z')), '2026-06');
  assert.equal(monthOf(new Date('2026-06-30T22:00:00Z')), '2026-07', 'Sommerzeit');
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(previousMonth('2026-11'), '2026-10');
});

test('gesamter Zeitraum: Summen, Strecke, Kosten pro km, Ø je Monat, Monatssummen', async () => {
  const c = await getVehicleCosts(fakeDb(ZEILEN), 'u', 'v', { now: NOW });
  assert.equal(c.year, null);
  assert.deepEqual(c.total, { energy: 165, expenses: 300, total: 465 }, 'Fahrt zählt nicht als Kosten');
  assert.equal(c.distanceKm, 1000, 'inkl. Tachostand aus "Kilometerstand notieren"');
  assert.equal(c.costPerKm.total, 0.465);
  assert.equal(c.costPerKm.energy, 0.105, 'erste Füllung zählt nicht: (50 + 55) / 1000');
  assert.equal(c.perMonth, 93, '465 € über 5 Monate (11/2025 bis 3/2026, auch ohne Kosten)');
  assert.equal(c.monthCount, 5);

  assert.deepEqual(c.months.map((m) => m.month), ['2026-02', '2026-01', '2025-12', '2025-11']);
  const feb = c.months[0];
  assert.equal(feb.count, 2);
  assert.deepEqual(feb.counts, { fuel: 1, charge: 0, expense: 0, trip: 1, odometer: 0 });
  assert.equal(feb.energy, 55);
  assert.equal(feb.total, 55);
  const jan = c.months[1];
  assert.equal(jan.expenses, 300);
  assert.equal(jan.counts.odometer, 1);
  assert.deepEqual(jan.byType, { fuel: 0, charge: 0, expense: 300 });

  assert.deepEqual(c.currentMonth, { month: '2026-03', energy: 0, expenses: 0, total: 0 });
  assert.deepEqual(c.previousMonth, { month: '2026-02', energy: 55, expenses: 0, total: 55 });
  assert.deepEqual(c.categories, [
    { key: 'Versicherung', total: 300, count: 1 },
    { key: 'Tankfuellung:l', total: 165, count: 3 }
  ], 'nur Kosten, größte zuerst');
  assert.deepEqual(c.years, [2026, 2025]);
  assert.deepEqual(jan.byCategory, { Versicherung: 300 }, 'Kilometerstand zählt nicht');
});

test('Kostengruppen, Wartung je 10.000 km, größte Ausgaben, Jahresvergleich (#180)', async () => {
  const mit = (kind, cost, odo, at, extra = {}) => ({ src: 'expense', kind, cost, odo, at, id: `e-${kind}-${at}`, vendor: null, description: null, ...extra });
  const zeilen = [
    { src: 'fillup', kind: 'l', cost: 60, odo: 10000, at: '2025-11-10T12:00:00Z', id: 'f1' },
    { src: 'fillup', kind: 'l', cost: 50, odo: 15000, at: '2026-01-20T12:00:00Z', id: 'f2' },
    mit('Versicherung', 300, null, '2026-01-02T12:00:00Z', { vendor: 'HUK' }),
    mit('Wartung', 200, 15500, '2026-02-01T12:00:00Z', { vendor: 'Autohaus' }),
    mit('Reifen', 400, null, '2026-02-10T12:00:00Z', { description: 'Winterreifen' }),
    mit('custom:abc', 90, null, '2026-02-12T12:00:00Z'),
    mit('Altlast frei', 10, null, '2026-02-15T12:00:00Z'),
    mit('Fahrt', 12, null, '2026-02-16T12:00:00Z'),
    mit('Kilometerstand', 0, 20000, '2026-03-01T12:00:00Z')
  ].map((z, i) => ({ ...z, created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  const db = {
    query: async (sql) => (sql.includes('FROM vehicles')
      ? { rowCount: 1, rows: [{ role: 'owner' }] }
      : sql.includes('expense_categories') ? { rowCount: 1, rows: [{ id: 'abc', group_key: 'wartung' }] } : { rowCount: zeilen.length, rows: zeilen })
  };
  const c = await getVehicleCosts(db, 'u', 'v', { now: NOW });
  assert.equal(c.total.total, 1110);
  const g = Object.fromEntries(c.groups.map((x) => [x.key, x]));
  assert.deepEqual(c.groups.map((x) => x.key), ['kraftstoff', 'fix', 'wartung', 'unterwegs', 'sonstiges'], 'alle Gruppen in der Reihenfolge aus /categories');
  assert.deepEqual([g.kraftstoff.total, g.kraftstoff.count], [110, 2]);
  assert.deepEqual([g.fix.total, g.wartung.total, g.wartung.count], [300, 690, 3], 'Wartung, Reifen und die eigene Kategorie (Gruppe wartung)');
  assert.deepEqual([g.unterwegs.total, g.unterwegs.count], [0, 0]);
  assert.deepEqual([g.sonstiges.total, g.sonstiges.count], [10, 1], 'freier Text aus alten Importen; Fahrt und Kilometerstand zählen nicht');
  assert.equal(g.wartung.share, 62.2);
  // 690 € auf 10.000 km (5.000 → 15.000 → 20.000 sind Tachostände; Strecke 10.000)
  assert.equal(c.distanceKm, 10000);
  assert.equal(c.maintenancePer10000Km, 690);
  assert.deepEqual(c.largestExpenses.map((x) => [x.category, x.cost]), [['Reifen', 400], ['Versicherung', 300], ['Wartung', 200], ['custom:abc', 90], ['Altlast frei', 10]]);
  assert.equal(c.largestExpenses.length, 5);
  assert.deepEqual([c.largestExpenses[0].id, c.largestExpenses[0].description, c.largestExpenses[1].vendor], [`e-Reifen-2026-02-10T12:00:00Z`, 'Winterreifen', 'HUK']);
  const feb = c.months.find((m) => m.month === '2026-02');
  assert.deepEqual(feb.byGroup, { kraftstoff: 0, fix: 0, wartung: 690, unterwegs: 0, sonstiges: 10 });
  assert.deepEqual(c.byYear.map((y) => y.year), [2026, 2025]);
  assert.equal(c.byYear[0].byGroup.fix, 300);
  assert.equal(c.byYear[1].byGroup.kraftstoff, 60);
  // Mit Jahr: Gruppen nur dieses Jahres, der Jahresvergleich bleibt vollständig; ohne Strecke null
  const j25 = await getVehicleCosts(db, 'u', 'v', { year: 2025, now: NOW });
  assert.equal(j25.groups.find((x) => x.key === 'kraftstoff').total, 60);
  assert.equal(j25.maintenancePer10000Km, null);
  assert.equal(j25.byYear.length, 2);
  assert.deepEqual(j25.largestExpenses, []);
});

test('einzelnes Jahr: Strecke ab Jahresbeginn bzw. ab erstem Tachostand im Jahr', async () => {
  const j26 = await getVehicleCosts(fakeDb(ZEILEN), 'u', 'v', { year: 2026, now: NOW });
  assert.deepEqual(j26.total, { energy: 55, expenses: 300, total: 355 });
  assert.equal(j26.distanceKm, 500, '11000 − letzter Stand vor 2026 (10500)');
  assert.equal(j26.costPerKm.total, 0.71);
  assert.equal(j26.costPerKm.energy, null, 'nur eine Füllung mit Tachostand im Jahr');
  assert.equal(j26.perMonth, 118.33, '355 € über Januar bis März');
  assert.equal(j26.currentMonth.month, '2026-03', 'laufender Monat unabhängig vom Jahr');

  const j25 = await getVehicleCosts(fakeDb(ZEILEN), 'u', 'v', { year: 2025, now: NOW });
  assert.deepEqual(j25.total, { energy: 110, expenses: 0, total: 110 });
  assert.equal(j25.distanceKm, 500, 'kein Stand vor 2025: ab erstem Stand im Jahr');
  assert.equal(j25.costPerKm.energy, 0.1);
  assert.equal(j25.perMonth, 55, '110 € über November und Dezember');

  const leer = await getVehicleCosts(fakeDb(ZEILEN), 'u', 'v', { year: 2020, now: NOW });
  assert.deepEqual(leer.total, { energy: 0, expenses: 0, total: 0 });
  assert.equal(leer.distanceKm, null);
  assert.equal(leer.costPerKm.total, null, 'ohne Strecke null, nicht 0');
  assert.equal(leer.perMonth, null);
  assert.deepEqual(leer.months, []);
});

test('Laden zählt als Energie (Plug-in-Hybrid), geschätzte Stände fehlen als null', async () => {
  const z = [
    { src: 'fillup', kind: 'l', cost: 70, odo: 1000, at: '2026-01-01T12:00:00Z' },
    { src: 'fillup', kind: 'kwh', cost: 8, odo: null, at: '2026-01-02T12:00:00Z' },
    { src: 'fillup', kind: 'kwh', cost: 9, odo: 1200, at: '2026-01-03T12:00:00Z' }
  ].map((x) => ({ ...x, created_at: x.at }));
  const c = await getVehicleCosts(fakeDb(z), 'u', 'v', { now: NOW });
  assert.deepEqual(c.total, { energy: 87, expenses: 0, total: 87 });
  assert.equal(c.distanceKm, 200);
  assert.equal(c.costPerKm.energy, 0.045, 'nur Füllungen mit Tachostand: 9 / 200');
  assert.deepEqual(c.months[0].byType, { fuel: 70, charge: 17, expense: 0 });
  assert.deepEqual(c.months[0].byCategory, { 'Tankfuellung:l': 70, 'Tankfuellung:kwh': 17 }, 'Plug-in-Hybrid getrennt');
});

test('fremdes oder unbekanntes Fahrzeug: null', async () => {
  assert.equal(await getVehicleCosts(fakeDb(ZEILEN, false), 'u', 'v', { now: NOW }), null);
});
