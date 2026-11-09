// Kategorien für Ausgaben (#95): die einzige Quelle für Web-Frontend und Apps.
// GET /api/v1/categories liefert diese Liste plus die eigenen Kategorien des Benutzers.
//
// Schlüssel (key) sind fest: sie stehen so in expenses.category und dürfen sich nie ändern.
// Name, Icon, Farbe und Gruppe dürfen sich ändern; Clients zeigen immer die Angaben aus dem API an.
// Eigene Kategorien (nur mit Tarif-Recht customCategories) haben den Schlüssel "custom:<uuid>".

const plans = require('./plans');

// Gruppen für Auswertungen (Kostenstruktur, Jahresvergleich)
const GROUPS = [
  { key: 'kraftstoff', name: 'Tanken & Laden', icon: 'fa-gas-pump', color: '#0d6efd' },
  { key: 'fix', name: 'Fixkosten', icon: 'fa-shield-alt', color: '#6f42c1' },
  { key: 'wartung', name: 'Werkstatt & Wartung', icon: 'fa-tools', color: '#fd7e14' },
  { key: 'unterwegs', name: 'Parken & Maut', icon: 'fa-square-parking', color: '#0dcaf0' },
  { key: 'sonstiges', name: 'Sonstiges', icon: 'fa-ellipsis', color: '#20c997' }
];
const GROUP_KEYS = GROUPS.map((g) => g.key);

// form: welches Formular die Kategorie nutzt
//   expense  = normale Ausgabe (Kosten, Anbieter, Beschreibung)
//   trip     = Fahrt (Fahrtenbuch, ohne Kosten)
//   odometer = nur Kilometerstand notieren (ohne Kosten)
//   fillup   = Tank- oder Ladevorgang (eigener Endpunkt /fillups, hier nur für Namen, Icon und Farbe)
// selectable: kann in der Kategorie-Auswahl einer Ausgabe gewählt werden
const BUILTIN = [
  { key: 'Tankfuellung', name: 'Tankfüllung', icon: 'fa-gas-pump', color: '#0d6efd', group: 'kraftstoff', form: 'fillup', countsAsCost: true, plan: 'free', selectable: false },
  { key: 'Versicherung', name: 'Versicherung', icon: 'fa-shield-alt', color: '#6f42c1', group: 'fix', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'Steuer', name: 'Steuer', icon: 'fa-money-bill-wave', color: '#a370f7', group: 'fix', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'TUV', name: 'TÜV', icon: 'fa-calendar-check', color: '#d63384', group: 'wartung', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'Werkstatt', name: 'Werkstatt', icon: 'fa-tools', color: '#fd7e14', group: 'wartung', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'Reparatur', name: 'Reparatur', icon: 'fa-car-crash', color: '#dc3545', group: 'wartung', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'Wartung', name: 'Wartung', icon: 'fa-cogs', color: '#e8590c', group: 'wartung', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'Inspektion', name: 'Inspektion', icon: 'fa-wrench', color: '#ffc107', group: 'wartung', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'Reifen', name: 'Reifen', icon: 'fa-car-side', color: '#6c757d', group: 'wartung', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'Sonstiges', name: 'Sonstiges', icon: 'fa-receipt', color: '#adb5bd', group: 'sonstiges', form: 'expense', countsAsCost: true, plan: 'free', selectable: true },
  { key: 'Dekor', name: 'Zubehör & Dekor', icon: 'fa-paint-roller', color: '#20c997', group: 'sonstiges', form: 'expense', countsAsCost: true, plan: 'plus', selectable: true },
  { key: 'Pflege', name: 'Pflege & Waschen', icon: 'fa-soap', color: '#3dd5f3', group: 'sonstiges', form: 'expense', countsAsCost: true, plan: 'plus', selectable: true },
  { key: 'Parken', name: 'Parken', icon: 'fa-square-parking', color: '#0dcaf0', group: 'unterwegs', form: 'expense', countsAsCost: true, plan: 'plus', selectable: true },
  { key: 'Maut', name: 'Maut & Vignette', icon: 'fa-road', color: '#0aa2c0', group: 'unterwegs', form: 'expense', countsAsCost: true, plan: 'plus', selectable: true },
  { key: 'Leasing', name: 'Leasing & Finanzierung', icon: 'fa-file-contract', color: '#59359a', group: 'fix', form: 'expense', countsAsCost: true, plan: 'plus', selectable: true },
  { key: 'Fahrt', name: 'Fahrt', icon: 'fa-route', color: '#198754', group: 'sonstiges', form: 'trip', countsAsCost: false, plan: 'free', selectable: false },
  { key: 'Kilometerstand', name: 'Kilometerstand', icon: 'fa-gauge-high', color: '#6c757d', group: 'sonstiges', form: 'odometer', countsAsCost: false, plan: 'free', selectable: false }
];
const BUILTIN_BY_KEY = Object.fromEntries(BUILTIN.map((c) => [c.key, c]));

// Ohne Kosten (Fahrtenbuch, Kilometerstand): zählen in keiner Kostensumme
const NON_COST_KEYS = BUILTIN.filter((c) => !c.countsAsCost).map((c) => c.key);

// Erlaubte Icons und Farben für eigene Kategorien (feste Auswahl: Clients brauchen nichts frei Eingegebenes darzustellen)
const CUSTOM_ICONS = [
  'fa-tag', 'fa-receipt', 'fa-star', 'fa-heart', 'fa-car', 'fa-car-side', 'fa-car-battery', 'fa-oil-can', 'fa-spray-can',
  'fa-soap', 'fa-brush', 'fa-key', 'fa-lock', 'fa-shield-alt', 'fa-file-invoice', 'fa-file-contract', 'fa-money-bill-wave',
  'fa-credit-card', 'fa-wrench', 'fa-tools', 'fa-screwdriver-wrench', 'fa-bolt', 'fa-plug', 'fa-lightbulb', 'fa-music',
  'fa-mobile-screen', 'fa-camera', 'fa-road', 'fa-square-parking', 'fa-ferry', 'fa-train', 'fa-suitcase', 'fa-dog',
  'fa-child', 'fa-snowflake', 'fa-sun', 'fa-umbrella', 'fa-box', 'fa-gift', 'fa-graduation-cap'
];
const CUSTOM_COLORS = ['#0d6efd', '#6610f2', '#6f42c1', '#d63384', '#dc3545', '#fd7e14', '#ffc107', '#198754', '#20c997', '#0dcaf0', '#6c757d', '#343a40'];
const CUSTOM_PREFIX = 'custom:';
const NAME_MAX = 40;

const customKey = (id) => CUSTOM_PREFIX + id;
const isCustomKey = (key) => String(key || '').startsWith(CUSTOM_PREFIX);
const customIdOf = (key) => (isCustomKey(key) ? String(key).slice(CUSTOM_PREFIX.length) : null);

// Eigene Kategorien eines Benutzers (für Liste und Prüfung)
async function loadCustom(db, userId) {
  const r = await db.query(
    `SELECT id, name, icon, color, group_key, created_at, updated_at
     FROM expense_categories WHERE user_id = $1 ORDER BY lower(name)`,
    [userId]
  );
  return r.rows;
}

// Eigene Kategorien der Besitzer von Fahrzeugen, die mit dem Benutzer geteilt sind (#53): nur zum Anzeigen,
// damit Einträge des Besitzers nicht als "custom:…" erscheinen. Auswählen kann sie nur ihr Besitzer.
async function loadSharedCustom(db, userId) {
  const r = await db.query(
    `SELECT DISTINCT c.id, c.name, c.icon, c.color, c.group_key, c.created_at, c.updated_at
       FROM vehicle_members m
       JOIN vehicles v ON v.id = m.vehicle_id
       JOIN expense_categories c ON c.user_id = v.user_id
      WHERE m.user_id = $1
      ORDER BY c.name`,
    [userId]
  );
  return r.rows;
}

function customToApi(row, available) {
  return {
    key: customKey(row.id),
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    group: row.group_key,
    form: 'expense',
    countsAsCost: true,
    plan: 'plus',
    custom: true,
    selectable: true,
    available
  };
}

// Vollständige Liste für einen Benutzer. user braucht plan und plan_until.
// Alte Kategorien aus früheren Importen (freier Text) werden mit legacy: true angehängt, damit Clients sie anzeigen können.
async function listForUser(db, user) {
  const premium = plans.hasFeature(user, 'premiumCategories');
  const maxCustom = plans.limitOf(user, 'customCategories') ?? 0;
  const custom = await loadCustom(db, user.id);
  const legacy = await db.query(
    `SELECT DISTINCT category FROM expenses
     WHERE user_id = $1 AND category <> ALL($2) AND category NOT LIKE 'custom:%'
     ORDER BY category`,
    [user.id, BUILTIN.map((c) => c.key)]
  );
  const categories = [
    ...BUILTIN.map((c) => ({ ...c, custom: false, available: c.selectable && (c.plan === 'free' || premium) })),
    ...custom.map((row) => customToApi(row, maxCustom > 0)),
    ...(await loadSharedCustom(db, user.id)).map((row) => ({ ...customToApi(row, false), selectable: false, shared: true })),
    ...legacy.rows.map((r) => ({
      key: r.category, name: r.category, icon: 'fa-tag', color: '#adb5bd', group: 'sonstiges', form: 'expense',
      countsAsCost: true, plan: 'free', custom: false, legacy: true, selectable: false, available: false
    }))
  ];
  return {
    groups: GROUPS,
    categories,
    custom: {
      max: maxCustom,
      used: custom.length,
      canCreate: maxCustom > 0 && custom.length < maxCustom,
      icons: CUSTOM_ICONS,
      colors: CUSTOM_COLORS,
      nameMaxLength: NAME_MAX
    }
  };
}

/**
 * Darf der Benutzer diese Kategorie für einen neuen oder geänderten Eintrag verwenden?
 * Liefert null (ok) oder { status, body } für die Fehlerantwort.
 * form: optional die erwartete Formular-Art (z. B. 'expense'); Fahrt und Kilometerstand sind über ihre eigenen Wege erlaubt.
 */
async function checkUsable(db, user, key) {
  const k = String(key || '').trim();
  if (!k) return { status: 400, body: { error: 'missing_category' } };
  const builtin = BUILTIN_BY_KEY[k];
  if (builtin) {
    if (builtin.form === 'fillup') return { status: 400, body: { error: 'invalid_category', category: k } };
    if (builtin.plan !== 'free' && !plans.hasFeature(user, 'premiumCategories')) {
      return { status: 403, body: { error: 'plan_required', feature: 'premiumCategories', category: k, plan: plans.effectivePlan(user) } };
    }
    return null;
  }
  const id = customIdOf(k);
  if (id) {
    const r = await db.query('SELECT 1 FROM expense_categories WHERE id::text = $1 AND user_id = $2', [id, user.id]);
    if (r.rowCount === 0) return { status: 400, body: { error: 'unknown_category', category: k } };
    if (!((plans.limitOf(user, 'customCategories') ?? 0) > 0)) {
      return { status: 403, body: { error: 'plan_required', feature: 'customCategories', category: k, plan: plans.effectivePlan(user) } };
    }
    return null;
  }
  return { status: 400, body: { error: 'unknown_category', category: k } };
}

// Eingaben für eigene Kategorien prüfen; partial = nur übergebene Felder (PATCH)
function validateCustomInput(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) return { error: 'missing_name' };
    if (name.length > NAME_MAX) return { error: 'name_too_long', max: NAME_MAX };
    if (isCustomKey(name)) return { error: 'invalid_name' };
    const kollision = BUILTIN.find((c) => c.key.toLowerCase() === name.toLowerCase() || c.name.toLowerCase() === name.toLowerCase());
    if (kollision) return { error: 'name_taken', category: kollision.key };
    out.name = name;
  }
  if (!partial || body.icon !== undefined) {
    const icon = body.icon === undefined || body.icon === null || body.icon === '' ? 'fa-tag' : String(body.icon);
    if (!CUSTOM_ICONS.includes(icon)) return { error: 'invalid_icon', allowed: CUSTOM_ICONS };
    out.icon = icon;
  }
  if (!partial || body.color !== undefined) {
    const color = body.color === undefined || body.color === null || body.color === '' ? '#6c757d' : String(body.color).toLowerCase();
    if (!CUSTOM_COLORS.includes(color)) return { error: 'invalid_color', allowed: CUSTOM_COLORS };
    out.color = color;
  }
  if (!partial || body.group !== undefined) {
    const group = body.group === undefined || body.group === null || body.group === '' ? 'sonstiges' : String(body.group);
    if (!GROUP_KEYS.includes(group) || group === 'kraftstoff') return { error: 'invalid_group', allowed: GROUP_KEYS.filter((g) => g !== 'kraftstoff') };
    out.group = group;
  }
  return { value: out };
}

// Anzeigenamen für Schlüssel (z. B. Monatsbericht); eigene Kategorien über die Tabelle
async function namesForUser(db, userId) {
  const names = Object.fromEntries(BUILTIN.map((c) => [c.key, c.name]));
  for (const row of await loadSharedCustom(db, userId)) names[customKey(row.id)] = row.name;
  for (const row of await loadCustom(db, userId)) names[customKey(row.id)] = row.name;
  return names;
}

module.exports = {
  GROUPS, BUILTIN, BUILTIN_BY_KEY, NON_COST_KEYS, CUSTOM_ICONS, CUSTOM_COLORS, NAME_MAX,
  customKey, isCustomKey, customIdOf, loadCustom, loadSharedCustom, customToApi, listForUser, checkUsable, validateCustomInput, namesForUser
};
