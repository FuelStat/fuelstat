// Mindest- und empfohlene App-Version (#118). Die API kennt ihre Brüche, deshalb stehen die Werte hier im Code und
// nicht in der .env: Wer eine Änderung ausliefert, die ältere Apps nicht mehr verstehen (nur während der Beta erlaubt,
// siehe docs/api.md „API-Vertrag“), hebt minimum an; recommended ist die App-Version, die alle Funktionen dieser
// API-Version nutzt. null = keine Vorgabe.
//
// Apps schicken bei jeder Anfrage "X-Fuelstat-Client: ios/0.2.0" (Plattform/Version). Ist die Version kleiner als
// minimum, antwortet die API mit 426 app_update_required; /health beantwortet sie immer, damit die App den Hinweis
// zeigen kann.
const APP_VERSIONS = {
  // iOS 0.2.0: erste Version mit Listen in Seiten (#160) und Gerätesitzungen (#117); 0.1.0 versteht die API nicht mehr
  // iOS 0.2.2: kommt mit der Archivierung von Fahrzeugen (409 vehicle_archived, Status, Archiv), den Bauteil-Terminen und den
  // neuen Feldern von 0.13.0 zurecht; ältere Apps zeigen archivierte Fahrzeuge als normale und scheitern beim Erfassen
  ios: { minimum: '0.2.2', recommended: '0.2.2' },
  android: { minimum: null, recommended: null }
};

// Erste App-Version, die die Registrierung ohne Token versteht (#141: 202, Konto erst nach dem Link aus der Mail).
// Ältere Apps bekommen bis dahin die alte Antwort (Konto sofort, Token, 409 bei vorhandener Adresse). Sobald minimum
// mindestens diese Version ist, erreicht keine alte App mehr die Registrierung; dann kann der alte Weg entfallen.
const REGISTRATION_WITHOUT_TOKEN = { ios: '0.2.3', android: null };

const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/** "ios/0.2.0" bzw. "ios/0.2.0 (42)" → { platform, version } oder null */
function parseClient(header) {
  const m = /^(ios|android)\/(\d{1,4}\.\d{1,4}\.\d{1,4})(?:[ \t].{0,40})?$/i.exec(String(header || '').slice(0, 80));
  return m ? { platform: m[1].toLowerCase(), version: m[2] } : null;
}

/** Vergleich zweier Versionen „x.y.z“: negativ, 0 oder positiv */
function compareVersions(a, b) {
  const x = VERSION_RE.exec(a);
  const y = VERSION_RE.exec(b);
  if (!x || !y) throw new Error('Ungültige Version');
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d;
  }
  return 0;
}

/** Für GET /health: { ios: { minimum_version, recommended_version }, android: … } */
function appVersionsForHealth(versions = APP_VERSIONS) {
  return Object.fromEntries(Object.entries(versions).map(([p, v]) => [p, { minimum_version: v.minimum, recommended_version: v.recommended }]));
}

/** Middleware: zu alte Apps bekommen 426 statt Antworten, die sie nicht verstehen */
function requireSupportedApp(versions = APP_VERSIONS) {
  return (req, res, next) => {
    const client = parseClient(req.header('X-Fuelstat-Client'));
    const minimum = client && versions[client.platform]?.minimum;
    if (!minimum || req.path === '/api/v1/health' || compareVersions(client.version, minimum) >= 0) return next();
    return res.status(426).json({
      error: 'app_update_required',
      message: 'Bitte aktualisiere die App, diese Version wird nicht mehr unterstützt.',
      minimum_version: minimum,
      recommended_version: versions[client.platform].recommended
    });
  };
}

/** Alte App, die nach der Registrierung sofort ein Token erwartet? (#141) */
function legacyRegistration(req, versions = REGISTRATION_WITHOUT_TOKEN) {
  const client = parseClient(req.header('X-Fuelstat-Client'));
  const ab = client && versions[client.platform];
  return Boolean(ab) && compareVersions(client.version, ab) < 0;
}

/** Kam die Anfrage aus einer App (Header X-Fuelstat-Client)? Für Links in Mails (#175) */
const fromApp = (req) => parseClient(req.header('X-Fuelstat-Client')) !== null;

module.exports = { APP_VERSIONS, REGISTRATION_WITHOUT_TOKEN, appVersionsForHealth, compareVersions, fromApp, legacyRegistration, parseClient, requireSupportedApp };
