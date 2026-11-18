// Obergrenzen für Freitexte in Anfragen (#197). Ohne Grenze konnte ein Konto beliebig große Texte speichern (nur das
// Body-Limit von 2 MB bremste); lange Texte zerschießen außerdem Listen, Export, Berichte, Mails und Push-Texte.
// Geprüft wird nur beim Schreiben: Ein gesendetes Feld, das nach dem Trimmen länger ist, ergibt 400 invalid_<feld> mit
// der Grenze in `max`. Nicht gesendete Felder und null bleiben unberührt, vorhandene Daten bleiben lesbar.
// Felder mit eigener Prüfung (Kennzeichen, VIN, Kategorie- und Bauteilnamen, Feedback, Mail) stehen bei ihrer Route.

const TEXT_LIMITS = Object.freeze({
  // Namen
  name: 100, // Fahrzeugname
  brand: 100,
  model: 100,
  username: 100,
  // Orte und Anbieter
  station: 200,
  vendor: 200,
  startPlace: 200,
  endPlace: 200,
  // Beschreibungen und Notizen
  description: 2000,
  note: 2000,
  // Technische Kennung beim Upload
  mediaType: 50
});

/**
 * Erstes zu langes Feld in `body` finden.
 * @param {object} body Anfragekörper (oder eine Zeile des Imports)
 * @param {string[]} felder Namen aus TEXT_LIMITS, die diese Route annimmt
 * @returns {{ error: string, max: number } | null} Fehlerantwort oder null
 */
function tooLongText(body, felder) {
  for (const feld of felder) {
    const max = TEXT_LIMITS[feld];
    if (max === undefined) throw new Error(`Keine Textgrenze für ${feld}`);
    const wert = body?.[feld];
    if (wert === undefined || wert === null) continue;
    if (String(wert).trim().length > max) return { error: `invalid_${feld}`, max };
  }
  return null;
}

module.exports = { TEXT_LIMITS, tooLongText };
