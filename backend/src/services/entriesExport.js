// CSV-Export der Einträge eines Fahrzeugs (#184): Tank-/Ladevorgänge, Ausgaben und Kilometerstände, ohne Fahrten (die haben
// ihren eigenen Export, siehe services/trips.js). Bisher baute das PHP-Frontend (pages/export.php) die Datei aus der
// Eintragsliste; jetzt kommt sie aus der API, damit Web-App und Apps dasselbe Format bekommen und es nur an einer Stelle
// gepflegt wird.
//
// Format (wie bisher): Semikolon, UTF-8 mit BOM, deutsches Zahlenformat (Komma, ohne Tausendertrennung), Datum TT.MM.JJJJ in
// Europe/Berlin, Zeilen aufsteigend nach Datum, Anführungszeichen wie PHP fputcsv (Felder mit Trennzeichen, Anführungszeichen,
// Leerzeichen, Tab, Backslash oder Zeilenumbruch), Zeilenende \n. Texte, die ein Tabellenprogramm als Formel ausführen würde
// (=, +, -, @, Tab, Zeilenumbruch am Anfang), bekommen ein Apostroph vorangestellt.
// Der CSV-Import der Web-App (includes/csv_import.php) erkennt die Spalten wieder.
//
// Spalten: Datum, Kategorie, Tachostand (km), Menge (Einheit) [Sorte] [Einheit], Kosten (EUR), Vollgetankt (je Antriebsart),
// Lücke davor, [Ladeart, Ladestand vorher (%), Ladestand nachher (%), Ladedauer (min)], Verbrauch (Einheit/100km), Ort/Anbieter,
// Beschreibung, [Bauteile]. Sorte steht bei Fahrzeugen mit mehreren Sorten, Einheit beim Plug-in-Hybrid, die Ladespalten bei
// Fahrzeugen, die laden, Bauteile nur, wenn ein Eintrag Bauteile hat.
const { UNION, FILTER, consumptionByFillup } = require('./timeline');
const { namesForUser } = require('./categories');
const { loadCatalog } = require('./parts');
const { fuelInfo, vehicleFuels } = require('./fuels');
const { canAccessVehicle } = require('./vehicleAccess');

const TZ = 'Europe/Berlin';
const KINDS = ['fuel', 'charge', 'expense', 'odometer'];
const LADEARTEN = { home: 'Zu Hause (Wallbox)', ac_public: 'Öffentlich, AC', dc: 'Schnelllader, DC' };
const UNIT_SHORT = { kwh: 'kWh', kg: 'kg' };
const unitShort = (u) => UNIT_SHORT[String(u).toLowerCase()] ?? 'l';

const deDate = (d) => new Date(d).toLocaleDateString('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

// Wie PHP number_format($wert, $stellen, ',', ''): kaufmännisch gerundet, Komma, ohne Tausendertrennung
function zahl(v, digits) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const f = 10 ** digits;
  return (Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * f) / f).toFixed(digits).replace('.', ',');
}

// Formeln in Tabellenprogrammen verhindern (CSV-Injection)
const text = (v) => (/^[=+\-@\t\r]/.test(String(v ?? '')) ? `'${v}` : String(v ?? ''));

// Feld wie PHP fputcsv mit Trennzeichen ; und Anführungszeichen "
function csvField(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\\\n\r\t ]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Begriffe wie includes/functions.php (verbrauchsBegriffe): Name des Vorgangs und „Voll“-Überschrift je Antriebsart
function terms(fuelType, unit) {
  const ft = String(fuelType || '').toLowerCase();
  const u = ft === 'phev' && unit ? (String(unit).toLowerCase() === 'kwh' ? 'electric' : 'e5') : ft;
  if (u === 'electric') return { vorgang: 'Ladevorgang', voll: 'Vollgeladen' };
  if (u === '' || u === 'phev') return { vorgang: 'Tank-/Ladevorgang', voll: 'Voll getankt/geladen' };
  return { vorgang: 'Tankfüllung', voll: 'Vollgetankt' };
}
const mainUnit = (ft) => ({ electric: 'kwh', cng: 'kg', hydrogen: 'kg' }[String(ft || '').toLowerCase()] ?? 'l');

/**
 * Datei für ein Fahrzeug.
 * @param {number|null} year Kalenderjahr (Europe/Berlin) oder null für alle Jahre
 * @returns {Promise<{ csv: string, filename: string }|null>} null, wenn das Fahrzeug nicht zugänglich ist
 */
async function buildEntriesCsv(db, userId, vehicleId, { year = null } = {}) {
  if (!(await canAccessVehicle(db, userId, vehicleId, 'read'))) return null;
  const v = (await db.query('SELECT name, fuel_type, fuels, default_fuel FROM vehicles WHERE id = $1', [vehicleId])).rows[0];
  const fuelType = String(v.fuel_type || 'other');
  const rows = (await db.query(
    `WITH a AS (${UNION})
     SELECT a.* FROM a WHERE ${FILTER}
      ORDER BY a.at ASC, a.created_at ASC, a.id ASC`,
    [vehicleId, KINDS, year, null]
  )).rows;

  const names = await namesForUser(db, userId);
  const consumption = rows.some((r) => r.type === 'fillup') ? await consumptionByFillup(db, userId, vehicleId) : new Map();
  const catalog = rows.some((r) => r.parts) ? Object.fromEntries((await loadCatalog(db, vehicleId)).map((p) => [p.key, p.name])) : {};
  const partNames = (r) => (r.parts ?? []).map((p) => catalog[p.key] ?? 'Bauteil').join(' | ');

  const phev = fuelType === 'phev';
  const withFuel = vehicleFuels(v).fuels.length > 1;
  const withCharging = fuelType === 'electric' || phev;
  const withParts = rows.some((r) => r.parts && r.parts.length);
  const unit = unitShort(mainUnit(fuelType));

  const head = phev
    ? ['Datum', 'Kategorie', 'Tachostand (km)', 'Menge', 'Einheit', 'Kosten (EUR)', 'Voll', 'Lücke davor', 'Verbrauch (pro 100km)', 'Ort/Anbieter', 'Beschreibung']
    : ['Datum', 'Kategorie', 'Tachostand (km)', `Menge (${unit})`, 'Kosten (EUR)', terms(fuelType).voll, 'Lücke davor', `Verbrauch (${unit}/100km)`, 'Ort/Anbieter', 'Beschreibung'];
  if (withFuel) head.splice(4, 0, 'Sorte');
  if (withParts) head.push('Bauteile');
  if (withCharging) head.splice(head.indexOf('Lücke davor') + 1, 0, 'Ladeart', 'Ladestand vorher (%)', 'Ladestand nachher (%)', 'Ladedauer (min)');

  const lines = [head];
  for (const r of rows) {
    const tank = r.type === 'fillup';
    lines.push([
      deDate(r.at),
      text(tank ? terms(fuelType, r.unit).vorgang : names[r.category] ?? r.category),
      r.odometer_km ?? '',
      tank ? zahl(r.amount, 2) : '',
      ...(withFuel ? [tank && r.fuel ? text(fuelInfo(r.fuel)?.name ?? r.fuel) : ''] : []),
      ...(phev ? [tank ? unitShort(r.unit) : ''] : []),
      zahl(r.cost, 2),
      tank ? (r.is_full ? 'ja' : 'nein') : '',
      tank ? (r.skip_previous ? 'ja' : 'nein') : '',
      ...(withCharging ? [
        tank ? LADEARTEN[r.charge_type] ?? '' : '',
        tank ? r.soc_before_pct ?? '' : '',
        tank ? r.soc_after_pct ?? '' : '',
        tank ? r.charge_minutes ?? '' : ''
      ] : []),
      tank ? zahl(consumption.get(String(r.id)) ?? null, 2) : '',
      text(r.place ?? ''),
      text(r.description ?? ''),
      ...(withParts ? [text(partNames(r))] : [])
    ]);
  }
  const filename = `${String(v.name || 'fahrzeug').replace(/[^A-Za-z0-9_-]+/g, '_')}${year ? `_${year}` : ''}.csv`;
  return { csv: '﻿' + lines.map((l) => l.map(csvField).join(';')).join('\n') + '\n', filename };
}

module.exports = { buildEntriesCsv, zahl, csvField };
