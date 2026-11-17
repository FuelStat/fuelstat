// Zusätzliche Fahrzeugangaben (#45). Eine Stelle für Name in der API (camelCase), Spalte und Prüfung,
// damit POST und PATCH /vehicles sowie die Abfragen nicht jedes Feld einzeln aufzählen müssen.

const text = (max, normalize = (v) => v) => (v) => {
  const s = normalize(String(v).trim());
  return s.length <= max ? s : undefined;
};
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v)) ? String(v) : undefined);
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 10000000 ? Math.round(n * 100) / 100 : undefined;
};
// Dezimalzahl in [min, max] mit höchstens drei Nachkommastellen (gerundet)
const decimal = (min, max) => (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1000) / 1000 : undefined;
};
const int = (min, max) => (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

// [Name in der API, Spalte, Prüfung → Wert oder undefined (= ungültig)]
const VEHICLE_EXTRA_FIELDS = [
  ['licensePlate', 'license_plate', text(15, (s) => s.toUpperCase().replace(/\s+/g, ' '))],
  ['vin', 'vin', text(17, (s) => s.toUpperCase().replace(/\s+/g, ''))],
  ['firstRegistration', 'first_registration', date],
  ['purchaseDate', 'purchase_date', date],
  ['purchasePrice', 'purchase_price', money],
  ['saleDate', 'sale_date', date],
  ['salePrice', 'sale_price', money],
  ['residualValue', 'residual_value', money],
  // Eigener CO₂-Faktor für Strom in kg/kWh (#25), z. B. Ökostrom oder PV; null = deutscher Strommix
  ['electricityCo2Factor', 'electricity_co2_factor', decimal(0, 2)],
  ['serviceIntervalMonths', 'service_interval_months', int(1, 60)],
  ['serviceIntervalKm', 'service_interval_km', int(1000, 100000)],
  ['oilIntervalMonths', 'oil_interval_months', int(1, 60)],
  ['oilIntervalKm', 'oil_interval_km', int(1000, 100000)],
  ['insuranceCompany', 'insurance_company', text(100)],
  ['insurancePremium', 'insurance_premium', money],
  ['insuranceDueMonth', 'insurance_due_month', int(1, 12)],
  ['taxAmount', 'tax_amount', money],
  ['taxDueMonth', 'tax_due_month', int(1, 12)],
  ['tireSizeSummer', 'tire_size_summer', text(30)],
  ['tireSizeWinter', 'tire_size_winter', text(30)]
];

const VEHICLE_EXTRA_COLUMNS = VEHICLE_EXTRA_FIELDS.map(([, col]) => col).join(', ');

/**
 * Gesendete Zusatzfelder prüfen. Nicht gesendet = unverändert, null/'' = löschen.
 * @returns {{ values: Object<string, any>, error?: string }} values: Spalte → Wert
 */
function parseVehicleExtras(body) {
  const values = {};
  for (const [name, col, check] of VEHICLE_EXTRA_FIELDS) {
    const raw = body?.[name];
    if (raw === undefined) continue;
    if (raw === null || raw === '') { values[col] = null; continue; }
    const v = check(raw);
    if (v === undefined) return { values, error: `invalid_${name}` };
    values[col] = v === '' ? null : v;
  }
  return { values };
}

module.exports = { VEHICLE_EXTRA_FIELDS, VEHICLE_EXTRA_COLUMNS, parseVehicleExtras };
