// Tarife (Grundgerüst für ein späteres Premium-Modell, Issue #44).
// Eine Stelle legt fest, was welcher Tarif darf. Neue Funktionen fragen hier nach (hasFeature/limitOf),
// statt Tarifnamen im Code zu vergleichen.
//
// Solange PLAN_LIMITS_ENABLED nicht "true" ist, bekommen alle Konten die Rechte von "plus" (Beta-Phase).
// Datenexport (DSGVO Art. 20) ist nie an einen Tarif gebunden.

// maxVehicles: aktive Fahrzeuge, maxArchivedVehicles: archivierte (verkaufte und stillgelegte, nur lesbar, #79). Beide zählen
// nur Fahrzeuge des Kontos (nicht die mit ihm geteilten) und gelten erst mit PLAN_LIMITS_ENABLED=true; bis dahin sind sie
// unbegrenzt (siehe featuresOf).
const PLANS = {
  free: {
    maxVehicles: 1,
    maxArchivedVehicles: 1,
    tripCategories: 2, // Fahrtenbuch: privat und dienstlich (#52, services/trips.js)
    tripExport: false, // Fahrtenbuch als CSV
    premiumCategories: false, // zusätzliche Ausgaben-Kategorien (Parken, Maut, Pflege, …), siehe services/categories.js
    customCategories: 0, // Anzahl eigener Ausgaben-Kategorien
    sharing: false,
    comparison: false,
    pdfReport: false,
    pushReminders: false,
    fleet: false
  },
  plus: {
    maxVehicles: 5, // null = unbegrenzt
    maxArchivedVehicles: 5,
    tripCategories: null,
    tripExport: true,
    premiumCategories: true,
    customCategories: 10,
    sharing: true,
    comparison: true,
    pdfReport: true,
    pushReminders: true,
    fleet: false
  },
  fleet: {
    maxVehicles: 25,
    maxArchivedVehicles: 25,
    tripCategories: null,
    tripExport: true,
    premiumCategories: true,
    customCategories: 10,
    sharing: true,
    comparison: true,
    pdfReport: true,
    pushReminders: true,
    fleet: true
  }
};

const PLAN_NAMES = Object.keys(PLANS);

function limitsEnabled() {
  return String(process.env.PLAN_LIMITS_ENABLED || '').toLowerCase() === 'true';
}

// Gebuchter Tarif unter Berücksichtigung des Ablaufdatums
function bookedPlan(user, now = new Date()) {
  const plan = PLANS[user?.plan] ? user.plan : 'free';
  if (plan !== 'free' && user?.plan_until && new Date(user.plan_until) <= now) return 'free';
  return plan;
}

// Tarif, dessen Rechte gerade gelten (ohne aktive Grenzen mindestens "plus")
function effectivePlan(user, now = new Date()) {
  const plan = bookedPlan(user, now);
  if (!limitsEnabled() && plan === 'free') return 'plus';
  return plan;
}

function featuresOf(user, now = new Date()) {
  const features = { ...PLANS[effectivePlan(user, now)] };
  // Ohne aktive Tarifgrenzen (Beta) gibt es keine Obergrenze für Fahrzeuge, auch nicht die des Tarifs Plus
  if (!limitsEnabled()) {
    features.maxVehicles = null;
    features.maxArchivedVehicles = null;
  }
  return features;
}

function hasFeature(user, feature) {
  return featuresOf(user)[feature] === true;
}

// Zahlengrenze eines Tarifs; null = unbegrenzt
function limitOf(user, key) {
  const v = featuresOf(user)[key];
  return v === undefined ? null : v;
}

// Für whoami und die Benutzerverwaltung
function planInfo(user, now = new Date()) {
  return {
    plan: PLANS[user?.plan] ? user.plan : 'free',
    planUntil: user?.plan_until ?? null,
    effectivePlan: effectivePlan(user, now),
    limitsEnabled: limitsEnabled(),
    features: featuresOf(user, now)
  };
}

// Einheitliche Antwort, wenn ein Tarif etwas nicht erlaubt
function planRequired(res, feature, extra = {}) {
  return res.status(403).json({ error: 'plan_required', feature, ...extra });
}

module.exports = { PLANS, PLAN_NAMES, limitsEnabled, bookedPlan, effectivePlan, featuresOf, hasFeature, limitOf, planInfo, planRequired };
