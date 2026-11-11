// Kraftstoffsorten und Energiearten (#140). Eine Liste für API, Web-App und Apps (GET /api/v1/fuels).
//
// - Ein Fahrzeug hat eine oder mehrere Sorten (vehicles.fuels), eine davon ist der Standard (default_fuel).
// - Jeder Tank- bzw. Ladevorgang hat eine Sorte (fillups.fuel); die Einheit ergibt sich aus der Sorte.
// - Verbrauch wird je Energieart gerechnet (E5, E10 und Super Plus zusammen als Benzin), Preise je Sorte.
//
// Die Zuordnung für Bestandsdaten (Antriebsart + Einheit → Sorte, Antriebsart → Sorten) gibt es zusätzlich als
// SQL-Funktionen in der Migration postgres_021_fuels.sql; ein Test prüft, dass beide übereinstimmen.

// Energiearten: Name, Einheit und CO₂-Faktor (kg je Einheit; Verbrenner direkte Emission, Strom deutscher Strommix)
const ENERGIES = {
  petrol: { name: 'Benzin', unit: 'l', co2: 2.37 },
  diesel: { name: 'Diesel', unit: 'l', co2: 2.65 },
  lpg: { name: 'Autogas', unit: 'l', co2: 1.64 },
  cng: { name: 'Erdgas', unit: 'kg', co2: 2.79 },
  electricity: { name: 'Strom', unit: 'kwh', co2: 0.363 },
  hydrogen: { name: 'Wasserstoff', unit: 'kg', co2: 0.0 },
  other: { name: 'Sonstiges', unit: 'l', co2: null }
};
const ENERGY_ORDER = Object.keys(ENERGIES);

// Sorten in Anzeigereihenfolge. premium: Mehrpreis wird gegenüber den anderen Sorten derselben Energieart gezeigt.
// tankerkoenig: Sorte, deren Preis Tankerkönig liefert (sonst keine Preise in der Tankstellensuche)
const FUELS = [
  { key: 'super_e5', name: 'Super E5', energy: 'petrol', tankerkoenig: 'e5' },
  { key: 'super_e10', name: 'Super E10', energy: 'petrol', tankerkoenig: 'e10' },
  { key: 'super_plus', name: 'Super Plus (98)', energy: 'petrol', premium: true },
  { key: 'premium_petrol', name: 'Premium-Benzin', energy: 'petrol', premium: true, hint: 'z. B. Ultimate 102, V-Power Racing' },
  { key: 'diesel', name: 'Diesel', energy: 'diesel', tankerkoenig: 'diesel' },
  { key: 'premium_diesel', name: 'Premium-Diesel', energy: 'diesel', premium: true, hint: 'z. B. Ultimate Diesel, V-Power Diesel' },
  { key: 'hvo100', name: 'HVO100', energy: 'diesel' },
  { key: 'lpg', name: 'Autogas (LPG)', energy: 'lpg' },
  { key: 'cng', name: 'Erdgas (CNG)', energy: 'cng' },
  { key: 'bio_cng', name: 'Bio-CNG', energy: 'cng' },
  { key: 'electricity', name: 'Strom', energy: 'electricity' },
  { key: 'hydrogen', name: 'Wasserstoff', energy: 'hydrogen' },
  { key: 'other', name: 'Sonstiges', energy: 'other' }
].map((f) => ({ premium: false, tankerkoenig: null, hint: null, ...f, unit: ENERGIES[f.energy].unit }));

const BY_KEY = new Map(FUELS.map((f) => [f.key, f]));
const MAX_FUELS = 8;
// Unter diesem Anteil an den Energiekosten (%) gilt eine Energieart als nebenbei getankt (z. B. Benzin beim
// Autogas-Auto): ihr Verbrauch über die Gesamtstrecke sagt wenig aus, Clients zeigen ihn nicht als Wert
const MINOR_SHARE = 10;

const fuelInfo = (key) => BY_KEY.get(String(key || '')) ?? null;
const energyOf = (key) => fuelInfo(key)?.energy ?? 'other';
const unitOf = (key) => fuelInfo(key)?.unit ?? 'l';

// Bisherige Antriebsarten → Sorten des Fahrzeugs (die erste ist der Standard)
const DEFAULT_FUELS = {
  e5: ['super_e5'],
  e10: ['super_e10'],
  diesel: ['diesel'],
  lpg: ['lpg'],
  cng: ['cng'],
  electric: ['electricity'],
  hybrid: ['super_e5'],
  phev: ['super_e5', 'electricity'],
  hydrogen: ['hydrogen'],
  other: ['other']
};

function defaultFuelsFor(fuelType) {
  return [...(DEFAULT_FUELS[String(fuelType || '').toLowerCase()] ?? ['super_e5'])];
}

/** Sorte eines Eintrags aus Antriebsart und Einheit, wie vor #140 (für Bestandsdaten und Clients ohne fuel). */
function legacyFuel(fuelType, unit) {
  const f = String(fuelType || '').toLowerCase();
  const u = String(unit || 'l').toLowerCase();
  if (u === 'kwh') return 'electricity';
  if (u === 'kg') return f === 'hydrogen' ? 'hydrogen' : 'cng';
  if (f === 'diesel') return 'diesel';
  if (f === 'e10') return 'super_e10';
  if (f === 'lpg') return 'lpg';
  if (f === 'other') return 'other';
  return 'super_e5';
}

/** Antriebsart aus den Sorten, wenn ein Client nur fuels schickt. */
function fuelTypeFor(fuels, defaultFuel) {
  const energies = new Set(fuels.map(energyOf));
  const combustion = ['petrol', 'diesel'].some((e) => energies.has(e));
  if (energies.has('electricity')) return combustion ? 'phev' : (energies.size === 1 ? 'electric' : 'other');
  const main = energyOf(defaultFuel ?? fuels[0]);
  if (main === 'petrol') return (defaultFuel ?? fuels[0]) === 'super_e10' ? 'e10' : 'e5';
  return { diesel: 'diesel', lpg: 'lpg', cng: 'cng', hydrogen: 'hydrogen' }[main] ?? 'other';
}

/** Sorten und Standard eines Fahrzeugs aus der Datenbankzeile (leere Liste: aus der Antriebsart). */
function vehicleFuels(row) {
  const list = Array.isArray(row?.fuels) && row.fuels.length ? row.fuels.filter((k) => BY_KEY.has(k)) : [];
  const fuels = list.length ? list : defaultFuelsFor(row?.fuel_type);
  const defaultFuel = fuels.includes(row?.default_fuel) ? row.default_fuel : fuels[0];
  return { fuels, defaultFuel };
}

/**
 * Sorte für einen neuen Eintrag ohne ausdrückliche Sorte: Standard des Fahrzeugs, wenn er zur Einheit passt,
 * sonst die erste Sorte des Fahrzeugs mit dieser Einheit, sonst die Zuordnung wie vor #140.
 */
function fuelForUnit(vehicleRow, unit) {
  const { fuels, defaultFuel } = vehicleFuels(vehicleRow);
  if (!unit) return defaultFuel;
  if (unitOf(defaultFuel) === unit) return defaultFuel;
  return fuels.find((k) => unitOf(k) === unit) ?? legacyFuel(vehicleRow?.fuel_type, unit);
}

/**
 * Gesendete Sortenliste prüfen.
 * @returns {{ fuels?: string[], error?: string }}
 */
function parseFuelList(raw) {
  if (!Array.isArray(raw)) return { error: 'invalid_fuels' };
  const fuels = [...new Set(raw.map((k) => String(k || '').trim().toLowerCase()))];
  if (!fuels.length || fuels.length > MAX_FUELS || fuels.some((k) => !BY_KEY.has(k))) return { error: 'invalid_fuels' };
  return { fuels };
}

/** SQL-Ausdruck: Energieart einer Sorten-Spalte (nur Werte aus dem Katalog, keine Benutzereingaben). */
function energySql(column) {
  const whens = FUELS.map((f) => `WHEN '${f.key}' THEN '${f.energy}'`).join(' ');
  return `(CASE ${column} ${whens} ELSE 'other' END)`;
}

/** Katalog für GET /fuels */
function catalog() {
  return {
    energies: ENERGY_ORDER.map((key) => ({ key, name: ENERGIES[key].name, unit: ENERGIES[key].unit, co2Factor: ENERGIES[key].co2 })),
    fuels: FUELS.map(({ key, name, energy, unit, premium, tankerkoenig, hint }) => ({ key, name, energy, unit, premium, tankerkoenig, hint })),
    // Vorschlag je Antriebsart (fuelType) für Formulare; die erste Sorte ist der Standard
    fuelTypeDefaults: DEFAULT_FUELS
  };
}

module.exports = {
  ENERGIES, ENERGY_ORDER, FUELS, DEFAULT_FUELS, MAX_FUELS, MINOR_SHARE,
  fuelInfo, energyOf, unitOf, defaultFuelsFor, legacyFuel, fuelTypeFor, vehicleFuels, fuelForUnit,
  parseFuelList, energySql, catalog
};
