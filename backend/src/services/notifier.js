// backend/src/services/notifier.js
// Benachrichtigungen per E-Mail und Push (#136): Termine, Kilometerstand nachtragen, Monatsbericht und lange kein
// Eintrag. Je Anlass wählt der Benutzer die Kanäle; jeder Kanal hat sein eigenes Versandprotokoll (mail_log, für Push
// mit "push:" davor), damit nichts doppelt kommt. Läuft stündlich (startNotifier) und lässt sich manuell auslösen.
const { getVehicleReminders } = require('./reminders');
const { getVehicleStats } = require('./stats');
const { energySql, ENERGIES, ENERGY_ORDER } = require('./fuels');
const { sendUserMail, loadDefaultSmtp, withDefaultSmtp } = require('./mail');
const categories = require('./categories');
const { accessibleVehicles } = require('./vehicleAccess');
const push = require('./push');

// Anlässe und ihre Kanäle (Spalten in user_mail_settings). E-Mail für Termine und Monatsbericht heißt aus
// Kompatibilität weiter reminders_enabled bzw. monthly_report.
const OCCASIONS = ['reminders', 'odometer', 'report', 'inactive'];
const MAIL_FLAG = { reminders: 'reminders_enabled', odometer: 'odometer_mail', report: 'monthly_report', inactive: 'inactive_mail' };
const PUSH_FLAG = { reminders: 'push_reminders', odometer: 'push_odometer', report: 'push_report', inactive: 'push_inactive' };
const LOG_KIND = { reminders: 'reminder', odometer: 'odometer', report: 'report', inactive: 'inactive' };
// „Lange kein Eintrag“: so viele Tage ohne Tankfüllung, Ausgabe oder Fahrt
const INACTIVE_DAYS = 30;

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const UNITS = { l: 'l', kwh: 'kWh', kg: 'kg' };
// Bezeichnung der Tank- bzw. Ladevorgänge passend zur Einheit (wie verbrauchsBegriffe() im Frontend)
const vorgaengeName = (fuelType, unit) => (fuelType === 'electric' || unit === 'kwh' ? 'Ladevorgänge' : 'Tankfüllungen');

const fmt = (n, digits = 2) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDate = (iso) => iso.split('-').reverse().join('.');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Einstellungen eines Benutzers (auch ohne gespeicherte Zeile), ohne eigenen Server mit dem Standard-Mailserver
const SETTINGS_SQL = `
  SELECT s.*, u.id AS user_id, u.email AS account_email, COALESCE(s.reminder_days, 30) AS reminder_days
  FROM users u LEFT JOIN user_mail_settings s ON s.user_id = u.id`;

async function loadUserSettings(pool, userId, defaults) {
  const r = await pool.query(`${SETTINGS_SQL} WHERE u.id = $1`, [userId]);
  if (!r.rows[0]) return null;
  return withDefaultSmtp(r.rows[0], defaults === undefined ? await loadDefaultSmtp(pool) : defaults);
}

async function loadVehicles(pool, userId) {
  const r = await pool.query(
    // Eigene und geteilte Fahrzeuge (#53): Erinnerungen und Monatsbericht schaltet jedes Mitglied für sich ein
    `SELECT id, name, fuel_type FROM vehicles v WHERE ${accessibleVehicles('v', 1)}
     ORDER BY (v.user_id <> $1), sort_order ASC, created_at DESC`,
    [userId]
  );
  return r.rows;
}

/** Fällige bzw. bald fällige Termine aller Fahrzeuge, jeweils mit eindeutiger Referenz fürs Versandprotokoll. */
async function collectDueReminders(pool, settings) {
  const due = [];
  for (const v of await loadVehicles(pool, settings.user_id)) {
    const reminders = await getVehicleReminders(pool, settings.user_id, v.id, settings.reminder_days);
    for (const r of reminders) {
      if (r.status === 'bald' || r.status === 'ueberfaellig') {
        due.push({ ...r, vehicle: v.name, vehicle_id: v.id, ref: `${v.id}:${r.category}:${r.due_date}:${r.status}` });
      }
    }
  }
  return due;
}

const faelligText = (r) => (r.status === 'ueberfaellig' ? 'überfällig' : (r.days === 0 ? 'heute fällig' : `fällig in ${r.days} Tagen`));

function reminderMail(due) {
  const line = (r) => {
    const when = faelligText(r);
    const km = r.due_km ? ` oder bei ${fmt(r.due_km, 0)} km` : '';
    return { text: `${r.vehicle}: ${r.title} – ${when} (${fmtDate(r.due_date)}${km})`, overdue: r.status === 'ueberfaellig' };
  };
  const lines = due.map(line);
  const subject = due.some((r) => r.status === 'ueberfaellig')
    ? 'Fuelstat: Termine überfällig'
    : 'Fuelstat: Termine bald fällig';
  const text = `Hallo,\n\nfolgende Termine stehen an:\n\n${lines.map((l) => '- ' + l.text).join('\n')}\n\nDeine Fuelstat-App`;
  const html = `<p>Hallo,</p><p>folgende Termine stehen an:</p><ul>${lines
    .map((l) => `<li${l.overdue ? ' style="color:#b02a37"' : ''}>${esc(l.text)}</li>`).join('')}</ul><p>Deine Fuelstat-App</p>`;
  return { subject, text, html };
}

// Erinnerung "Kilometerstand nachtragen" (#41): Tank-/Ladevorgänge ohne echten Tachostand, frühestens
// ODOMETER_REMINDER_HOURS nach dem Erfassen. Nur Einträge der letzten 14 Tage (keine Mails für alte Importe).
const ODOMETER_REMINDER_HOURS = 3;

async function collectMissingOdometers(pool, settings, now = new Date()) {
  const r = await pool.query(
    `SELECT f.id, f.vehicle_id, f.filled_at, f.amount, f.unit, f.odometer_estimated, v.name AS vehicle, v.fuel_type
     FROM fillups f JOIN vehicles v ON v.id = f.vehicle_id
     WHERE f.user_id = $1 AND (f.odometer_km IS NULL OR f.odometer_estimated)
       AND f.created_at <= $2::timestamptz - make_interval(hours => $3)
       AND f.filled_at >= $2::timestamptz - interval '14 days'
     ORDER BY f.filled_at`,
    [settings.user_id, now, ODOMETER_REMINDER_HOURS]
  );
  return r.rows.map((row) => ({ ...row, ref: row.id }));
}

function odometerMail(rows, appUrl = process.env.APP_URL) {
  const base = appUrl ? String(appUrl).replace(/\/+$/, '') : null;
  const items = rows.map((f) => {
    const was = f.fuel_type === 'electric' || f.unit === 'kwh' ? 'Ladevorgang' : 'Tankfüllung';
    const datum = fmtDate(new Date(f.filled_at).toISOString().slice(0, 10));
    const text = `${f.vehicle}: ${was} vom ${datum} (${fmt(f.amount)} ${UNITS[f.unit] || f.unit})${f.odometer_estimated ? ', bisher nur geschätzt' : ''}`;
    const link = base ? `${base}/pages/tachostand_nachtragen.php?id=${encodeURIComponent(f.id)}&fahrzeug_id=${encodeURIComponent(f.vehicle_id)}` : null;
    return { text, link };
  });
  const subject = rows.length === 1 ? 'Fuelstat: Kilometerstand nachtragen' : `Fuelstat: ${rows.length} Kilometerstände nachtragen`;
  const hint = base ? '' : '\nDu findest die Einträge in der Eintragsliste des Fahrzeugs („Nachtragen“).\n';
  const text = `Hallo,\n\nbei diesen Einträgen fehlt noch der Kilometerstand. Mit ihm stimmt die Verbrauchsberechnung wieder:\n\n${items
    .map((i) => '- ' + i.text + (i.link ? `\n  ${i.link}` : '')).join('\n')}\n${hint}\nDeine Fuelstat-App`;
  const html = `<p>Hallo,</p><p>bei diesen Einträgen fehlt noch der Kilometerstand. Mit ihm stimmt die Verbrauchsberechnung wieder:</p><ul>${items
    .map((i) => `<li>${esc(i.text)}${i.link ? ` – <a href="${esc(i.link)}">jetzt nachtragen</a>` : ''}</li>`).join('')}</ul>${base
    ? '' : '<p>Du findest die Einträge in der Eintragsliste des Fahrzeugs („Nachtragen“).</p>'}<p>Deine Fuelstat-App</p>`;
  return { subject, text, html };
}

// --- Push-Texte (#136): knapp, ein Tipp öffnet die passende Seite (url relativ zur App) ---
function reminderPush(due) {
  const ueberfaellig = due.some((r) => r.status === 'ueberfaellig');
  if (due.length === 1) {
    const r = due[0];
    return { title: ueberfaellig ? 'Termin überfällig' : 'Termin bald fällig', body: `${r.vehicle}: ${r.title} – ${faelligText(r)}`,
      url: `pages/fahrzeug_detail.php?id=${encodeURIComponent(r.vehicle_id)}`, tag: 'termine',
      badge: 1, ttl: 3 * 86400, urgency: ueberfaellig ? 'high' : 'normal' };
  }
  const fahrzeuge = [...new Set(due.map((r) => r.vehicle_id))];
  return {
    title: ueberfaellig ? `${due.length} Termine, davon überfällige` : `${due.length} Termine bald fällig`,
    body: due.slice(0, 3).map((r) => `${r.vehicle}: ${r.title}`).join(' · ') + (due.length > 3 ? ' …' : ''),
    url: fahrzeuge.length === 1 ? `pages/fahrzeug_detail.php?id=${encodeURIComponent(fahrzeuge[0])}` : '',
    tag: 'termine',
    badge: due.length,
    ttl: 3 * 86400,
    urgency: ueberfaellig ? 'high' : 'normal'
  };
}

function odometerPush(rows) {
  const was = (f) => (f.fuel_type === 'electric' || f.unit === 'kwh' ? 'Ladevorgang' : 'Tankfüllung');
  const datum = (f) => fmtDate(new Date(f.filled_at).toISOString().slice(0, 10)).slice(0, 6);
  if (rows.length === 1) {
    const f = rows[0];
    return { title: 'Kilometerstand nachtragen', body: `${f.vehicle}: ${was(f)} vom ${datum(f)}`,
      url: `pages/tachostand_nachtragen.php?id=${encodeURIComponent(f.id)}&fahrzeug_id=${encodeURIComponent(f.vehicle_id)}`, tag: 'tachostand',
      ttl: 2 * 86400, urgency: 'normal' };
  }
  return { title: `${rows.length} Kilometerstände nachtragen`, body: [...new Set(rows.map((f) => f.vehicle))].join(', '),
    url: `pages/fahrzeug_detail.php?id=${encodeURIComponent(rows[0].vehicle_id)}#eintraege`, tag: 'tachostand', ttl: 2 * 86400, urgency: 'normal' };
}

function reportPush(report) {
  return { title: `Monatsbericht ${report.label}`, body: `Kosten aller Fahrzeuge: ${fmt(report.total)} €`, url: '', tag: 'monatsbericht',
    ttl: 7 * 86400, urgency: 'low' };
}

/** Fahrzeuge, für die seit INACTIVE_DAYS nichts erfasst wurde (nur solche mit früheren Einträgen) */
async function collectInactive(pool, settings, now = new Date()) {
  const r = await pool.query(
    `SELECT v.id AS vehicle_id, v.name AS vehicle,
            GREATEST((SELECT MAX(filled_at) FROM fillups WHERE vehicle_id = v.id),
                     (SELECT MAX(occurred_at) FROM expenses WHERE vehicle_id = v.id),
                     (SELECT MAX(started_at) FROM trips WHERE vehicle_id = v.id)) AS last_at
       FROM vehicles v WHERE ${accessibleVehicles('v', 1)}`,
    [settings.user_id]
  );
  const grenze = now.getTime() - INACTIVE_DAYS * 86400000;
  return r.rows
    .filter((x) => x.last_at && new Date(x.last_at).getTime() < grenze)
    .map((x) => ({
      ...x,
      days: Math.floor((now.getTime() - new Date(x.last_at).getTime()) / 86400000),
      // Je Pause nur eine Nachricht: neuer Eintrag = neue Referenz
      ref: `${x.vehicle_id}:${new Date(x.last_at).toISOString().slice(0, 10)}`
    }));
}

function inactiveMail(rows) {
  const lines = rows.map((x) => `${x.vehicle}: seit ${x.days} Tagen nichts erfasst`);
  return {
    subject: rows.length === 1 ? `Fuelstat: ${rows[0].vehicle} – lange kein Eintrag` : 'Fuelstat: lange kein Eintrag',
    text: `Hallo,\n\nfür diese Fahrzeuge wurde länger nichts erfasst:\n\n${lines.map((l) => '- ' + l).join('\n')}\n\nWenn du getankt hast oder gefahren bist, trag es nach – dann stimmen Verbrauch und Kosten.\n\nDeine Fuelstat-App`,
    html: `<p>Hallo,</p><p>für diese Fahrzeuge wurde länger nichts erfasst:</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p>Wenn du getankt hast oder gefahren bist, trag es nach – dann stimmen Verbrauch und Kosten.</p><p>Deine Fuelstat-App</p>`
  };
}

function inactivePush(rows) {
  const x = rows[0];
  return {
    title: 'Lange kein Eintrag',
    body: rows.length === 1 ? `${x.vehicle}: seit ${x.days} Tagen nichts erfasst` : rows.map((r) => r.vehicle).join(', ') + ': länger nichts erfasst',
    url: `pages/eintrag_hinzufuegen.php?fahrzeug_id=${encodeURIComponent(x.vehicle_id)}`,
    tag: 'inaktiv',
    ttl: 3 * 86400,
    urgency: 'low'
  };
}

/** Monatsdaten aller Fahrzeuge für einen Monat (year, month 1-12). */
async function buildMonthlyReport(pool, settings, year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const label = `${MONTHS[month - 1]} ${year}`;
  const sections = [];
  let total = 0;

  // Anzeigenamen der Kategorien inklusive eigener (#95)
  const categoryNames = await categories.namesForUser(pool, settings.user_id);
  for (const v of await loadVehicles(pool, settings.user_id)) {
    // Summen des ganzen Fahrzeugs, auch was Mitglieder erfasst haben (#53)
    const f = await pool.query(
      `SELECT ${energySql('fuel')} AS energy, unit, COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(total_cost_eur), 0) AS cost
       FROM fillups WHERE vehicle_id = $1 AND filled_at >= $2 AND filled_at < $3
       GROUP BY 1, 2`,
      [v.id, start, end]
    );
    f.rows.sort((a, b) => ENERGY_ORDER.indexOf(a.energy) - ENERGY_ORDER.indexOf(b.energy));
    const e = await pool.query(
      `SELECT category, SUM(amount_eur) AS cost
       FROM expenses WHERE vehicle_id = $1 AND occurred_at >= $2 AND occurred_at < $3 AND category <> ALL($4)
       GROUP BY category ORDER BY SUM(amount_eur) DESC`,
      [v.id, start, end, categories.NON_COST_KEYS]
    );
    const odo = await pool.query(
      `SELECT (SELECT MAX(odometer_km) FROM fillups WHERE vehicle_id = $1 AND filled_at < $3 AND NOT odometer_estimated) AS end_odo,
              (SELECT MAX(odometer_km) FROM fillups WHERE vehicle_id = $1 AND filled_at < $2 AND NOT odometer_estimated) AS start_odo`,
      [v.id, start, end]
    );
    const stats = await getVehicleStats(pool, settings.user_id, v.id);
    const segs = (stats.segments || []).filter((s) => new Date(s.full_at) >= start && new Date(s.full_at) < end);
    const reminders = (await getVehicleReminders(pool, settings.user_id, v.id, settings.reminder_days))
      .filter((r) => r.status === 'bald' || r.status === 'ueberfaellig');

    // Je Energieart eine Zeile (#140; Plug-in-Hybrid: Tankfüllungen und Ladevorgänge, Autogas-Auto: Autogas und Benzin)
    const mehrere = new Set(f.rows.filter((r) => r.unit !== 'kwh').map((r) => r.energy)).size > 1;
    const energy = f.rows.map((r) => {
      const us = segs.filter((s) => s.energy === r.energy);
      const km = us.reduce((a, s) => a + Number(s.km), 0);
      const amount = us.reduce((a, s) => a + Number(s.liters_segment), 0);
      return {
        label: vorgaengeName(v.fuel_type, r.unit) + (mehrere && r.unit !== 'kwh' ? ` ${ENERGIES[r.energy]?.name ?? ''}`.trimEnd() : ''),
        unit: UNITS[r.unit] || 'l',
        fillups: r.n,
        amount: Number(r.amount),
        cost: Number(r.cost),
        consumption: km > 0 ? (amount / km) * 100 : null
      };
    });
    const fuelCost = energy.reduce((a, x) => a + x.cost, 0);
    const otherCost = e.rows.reduce((a, r) => a + Number(r.cost), 0);
    const cost = fuelCost + otherCost;
    total += cost;
    const { end_odo: endOdo, start_odo: startOdo } = odo.rows[0];
    sections.push({
      name: v.name,
      energy,
      fillups: energy.reduce((a, x) => a + x.fillups, 0),
      expenses: e.rows.map((r) => ({ category: categoryNames[r.category] || r.category, cost: Number(r.cost) })),
      cost,
      km: endOdo !== null && startOdo !== null ? endOdo - startOdo : null,
      reminders
    });
  }
  return { label, sections, total };
}

function reportMail(report) {
  const textParts = [`Hallo,\n\nhier ist deine Fuelstat-Übersicht für ${report.label}.\n`];
  const htmlParts = [`<p>Hallo,</p><p>hier ist deine Fuelstat-Übersicht für <strong>${esc(report.label)}</strong>.</p>`];

  const active = report.sections.filter((s) => s.fillups > 0 || s.expenses.length > 0 || s.reminders.length > 0);
  if (active.length === 0) {
    textParts.push('\nIn diesem Monat wurden keine Einträge erfasst und es stehen keine Termine an.\n');
    htmlParts.push('<p>In diesem Monat wurden keine Einträge erfasst und es stehen keine Termine an.</p>');
  }
  for (const s of active) {
    const leer = s.fillups === 0 && s.expenses.length === 0;
    const rows = leer ? [['Einträge', 'keine in diesem Monat']] : [
      ...s.energy.map((x) => [x.label, `${x.fillups} (${fmt(x.amount)} ${x.unit}, ${fmt(x.cost)} €)`]),
      ...s.expenses.map((x) => [x.category, `${fmt(x.cost)} €`]),
      ['Kosten gesamt', `${fmt(s.cost)} €`],
      ['Gefahrene Strecke', s.km !== null ? `${fmt(s.km, 0)} km` : '–'],
      // Ohne Tank-/Ladevorgang im Monat bleibt es bei einer Zeile mit „–“
      ...(s.energy.length ? s.energy : [{ consumption: null }]).map((x) => [
        s.energy.length > 1 ? `Ø Verbrauch (${x.unit})` : 'Ø Verbrauch',
        x.consumption !== null ? `${fmt(x.consumption)} ${x.unit}/100km` : '–'
      ])
    ];
    const due = s.reminders.map((r) => `${r.title}: ${r.status === 'ueberfaellig' ? 'überfällig' : 'fällig am ' + fmtDate(r.due_date)}`);
    textParts.push(`\n${s.name}\n${rows.map(([k, v]) => `  ${k}: ${v}`).join('\n')}${due.length ? '\n  Termine: ' + due.join(', ') : ''}\n`);
    htmlParts.push(`<h3 style="margin-bottom:4px">${esc(s.name)}</h3><table cellpadding="4" style="border-collapse:collapse">${rows
      .map(([k, v]) => `<tr><td style="color:#555">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('')}</table>${due.length
      ? `<p style="color:#b02a37">Termine: ${esc(due.join(', '))}</p>` : ''}`);
  }
  textParts.push(`\nGesamtkosten aller Fahrzeuge: ${fmt(report.total)} €\n\nDeine Fuelstat-App`);
  htmlParts.push(`<p><strong>Gesamtkosten aller Fahrzeuge: ${fmt(report.total)} €</strong></p><p>Deine Fuelstat-App</p>`);
  return { subject: `Fuelstat: Monatsbericht ${report.label}`, text: textParts.join(''), html: htmlParts.join('') };
}

function previousMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Referenzen im Protokoll reservieren; zurück kommen nur die noch nicht verschickten. */
async function claim(pool, userId, kind, refs) {
  if (refs.length === 0) return [];
  const r = await pool.query(
    `INSERT INTO mail_log (user_id, kind, ref)
     SELECT $1, $2, unnest($3::text[])
     ON CONFLICT (user_id, kind, ref) DO NOTHING
     RETURNING ref`,
    [userId, kind, refs]
  );
  return r.rows.map((row) => row.ref);
}

async function release(pool, userId, kind, refs) {
  if (refs.length) await pool.query('DELETE FROM mail_log WHERE user_id = $1 AND kind = $2 AND ref = ANY($3)', [userId, kind, refs]);
}

async function recordResult(pool, userId, error) {
  await pool.query(
    error
      ? 'UPDATE user_mail_settings SET last_error = $2 WHERE user_id = $1'
      : 'UPDATE user_mail_settings SET last_sent_at = now(), last_error = NULL WHERE user_id = $1',
    error ? [userId, String(error.message || error).slice(0, 500)] : [userId]
  );
}

// Einen Anlass über einen Kanal verschicken: Referenzen reservieren, senden, bei Fehler wieder freigeben
async function viaMail(pool, settings, occasion, items, build) {
  const kind = LOG_KIND[occasion];
  const fresh = await claim(pool, settings.user_id, kind, items.map((i) => i.ref));
  if (!fresh.length) return;
  try {
    await sendUserMail(settings, await build(items.filter((i) => fresh.includes(i.ref))));
    await recordResult(pool, settings.user_id, null);
  } catch (e) {
    await release(pool, settings.user_id, kind, fresh);
    await recordResult(pool, settings.user_id, e);
  }
}

async function viaPush(pool, settings, occasion, items, build) {
  const kind = 'push:' + LOG_KIND[occasion];
  const fresh = await claim(pool, settings.user_id, kind, items.map((i) => i.ref));
  if (!fresh.length) return;
  try {
    const r = await push.sendToUser(pool, settings.user_id, await build(items.filter((i) => fresh.includes(i.ref))));
    // Kein Gerät erreicht (z. B. Push-Dienst gestört): beim nächsten Lauf noch einmal versuchen
    if (r.sent === 0) await release(pool, settings.user_id, kind, fresh);
  } catch (e) {
    await release(pool, settings.user_id, kind, fresh);
    console.error('[notifier] push', settings.user_id, e.message);
  }
}

/** Alle fälligen Anlässe eines Benutzers über die gewählten Kanäle verschicken. */
async function notifyUser(pool, settings, now = new Date()) {
  const mailOk = Boolean(settings.smtp_host);
  const pushOk = Boolean(push.config()) && OCCASIONS.some((o) => settings[PUSH_FLAG[o]]) && await push.hasDevices(pool, settings.user_id);
  const kanaele = (o) => ({ mail: mailOk && Boolean(settings[MAIL_FLAG[o]]), push: pushOk && Boolean(settings[PUSH_FLAG[o]]) });

  // Monatsbericht nur einmal berechnen, auch wenn er per E-Mail und Push geht
  let bericht = null;
  const { year, month } = previousMonth(now);
  const holeBericht = async () => (bericht ||= await buildMonthlyReport(pool, settings, year, month));

  const anlaesse = {
    reminders: { collect: () => collectDueReminders(pool, settings), mail: reminderMail, push: reminderPush },
    // Kilometerstand nachtragen (#41): jeder Eintrag nur einmal
    odometer: { collect: () => collectMissingOdometers(pool, settings, now), mail: (x) => odometerMail(x), push: odometerPush },
    report: {
      collect: async () => [{ ref: `${year}-${String(month).padStart(2, '0')}` }],
      mail: async () => reportMail(await holeBericht()),
      push: async () => reportPush(await holeBericht())
    },
    inactive: { collect: () => collectInactive(pool, settings, now), mail: inactiveMail, push: inactivePush }
  };

  for (const o of OCCASIONS) {
    const k = kanaele(o);
    if (!k.mail && !k.push) continue;
    const items = await anlaesse[o].collect();
    if (!items.length) continue;
    if (k.mail) await viaMail(pool, settings, o, items, anlaesse[o].mail);
    if (k.push) await viaPush(pool, settings, o, items, anlaesse[o].push);
  }
}

async function runNotifications(pool, now = new Date()) {
  const defaults = await loadDefaultSmtp(pool);
  // Nur Konten mit bestätigter Adresse (#135): keine Mails an Adressen, deren Inhaber nicht zugestimmt hat
  const aktiv = OCCASIONS.flatMap((o) => [MAIL_FLAG[o], PUSH_FLAG[o]]).map((c) => `s.${c}`).join(' OR ');
  const r = await pool.query(`${SETTINGS_SQL} WHERE (${aktiv}) AND u.email_verified_at IS NOT NULL`);
  for (const row of r.rows) {
    const settings = withDefaultSmtp(row, defaults);
    try {
      await notifyUser(pool, settings, now);
    } catch (e) {
      console.error('[notifier]', settings.user_id, e.message);
    }
  }
}

/** Stündlich prüfen (erstmals 1 Minute nach dem Start). Abschaltbar mit NOTIFICATIONS_ENABLED=false. */
function startNotifier(pool) {
  if (process.env.NOTIFICATIONS_ENABLED === 'false') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runNotifications(pool);
    } catch (e) {
      console.error('[notifier]', e.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = {
  OCCASIONS, MAIL_FLAG, PUSH_FLAG, INACTIVE_DAYS,
  loadUserSettings, collectDueReminders, reminderMail, reminderPush, collectMissingOdometers, odometerMail, odometerPush,
  collectInactive, inactiveMail, inactivePush, buildMonthlyReport, reportMail, reportPush,
  previousMonth, notifyUser, runNotifications, startNotifier
};
