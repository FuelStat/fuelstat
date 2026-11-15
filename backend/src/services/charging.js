// Angaben zum Ladevorgang (#25): Ladeart, Ladestand vorher/nachher in %, Ladedauer in Minuten.
// Sie gehören nur zu kWh-Einträgen; bei Tankfüllungen (l, kg) sind sie immer leer. Alles ist optional: Wer nichts
// angibt, rechnet wie bisher. Der Ladestand ist die Grundlage für Verbrauch ohne „voll geladen“ (services/stats.js).

const CHARGE_TYPES = ['home', 'ac_public', 'dc'];
// Spalten für RETURNING und SELECT, an jede Spaltenliste von fillups anhängen
const CHARGE_COLUMNS = 'charge_type, soc_before_pct, soc_after_pct, charge_minutes';
// Längste plausible Ladedauer: drei Tage (z. B. Urlaubsladung an der Steckdose)
const MAX_CHARGE_MINUTES = 4320;

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

/** Gibt es im Body Ladeangaben (auch null zum Löschen)? */
function hasChargeInput(body = {}) {
  return ['chargeType', 'socBeforePct', 'socAfterPct', 'chargeMinutes'].some((k) => has(body, k));
}

// Ganze Zahl im Bereich oder null (leer); sonst undefined = ungültig
function wholeNumber(value, min, max) {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/**
 * Ladeangaben aus dem Body mit dem bisherigen Stand (beim Bearbeiten) zusammenführen und prüfen.
 * Fehlende Schlüssel bleiben, null löscht.
 * @param {object} body Anfrage (chargeType, socBeforePct, socAfterPct, chargeMinutes)
 * @param {object|null} existing bisherige Zeile (charge_type, …) oder null
 * @param {string} unit Einheit des Eintrags nach der Änderung
 * @returns {{ error: string } | { chargeType, socBeforePct, socAfterPct, chargeMinutes }}
 */
function resolveCharge(body = {}, existing = null, unit = 'kwh') {
  const merged = {
    chargeType: has(body, 'chargeType') ? body.chargeType : existing?.charge_type ?? null,
    socBeforePct: has(body, 'socBeforePct') ? body.socBeforePct : existing?.soc_before_pct ?? null,
    socAfterPct: has(body, 'socAfterPct') ? body.socAfterPct : existing?.soc_after_pct ?? null,
    chargeMinutes: has(body, 'chargeMinutes') ? body.chargeMinutes : existing?.charge_minutes ?? null
  };
  const empty = { chargeType: null, socBeforePct: null, socAfterPct: null, chargeMinutes: null };

  if (unit !== 'kwh') {
    // Wechselt ein Eintrag von Laden zu Tanken, entfallen die Angaben; neue Angaben bei Tankfüllungen sind ein Fehler
    const sent = ['chargeType', 'socBeforePct', 'socAfterPct', 'chargeMinutes'].some((k) => has(body, k) && body[k] !== null && body[k] !== '');
    return sent ? { error: 'charge_fields_kwh_only' } : empty;
  }

  const chargeType = merged.chargeType === null || merged.chargeType === '' ? null : String(merged.chargeType);
  if (chargeType !== null && !CHARGE_TYPES.includes(chargeType)) return { error: 'invalid_chargeType' };
  const socBeforePct = wholeNumber(merged.socBeforePct, 0, 100);
  if (socBeforePct === undefined) return { error: 'invalid_socBeforePct' };
  const socAfterPct = wholeNumber(merged.socAfterPct, 0, 100);
  if (socAfterPct === undefined) return { error: 'invalid_socAfterPct' };
  if (socBeforePct !== null && socAfterPct !== null && socAfterPct < socBeforePct) return { error: 'invalid_soc' };
  const chargeMinutes = wholeNumber(merged.chargeMinutes, 1, MAX_CHARGE_MINUTES);
  if (chargeMinutes === undefined) return { error: 'invalid_chargeMinutes' };
  return { chargeType, socBeforePct, socAfterPct, chargeMinutes };
}

module.exports = { CHARGE_TYPES, CHARGE_COLUMNS, MAX_CHARGE_MINUTES, hasChargeInput, resolveCharge };
