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
  ios: { minimum: '0.2.0', recommended: '0.2.0' },
  android: { minimum: null, recommended: null }
};

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

module.exports = { APP_VERSIONS, appVersionsForHealth, compareVersions, parseClient, requireSupportedApp };
