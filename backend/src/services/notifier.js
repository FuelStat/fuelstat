// backend/src/services/notifier.js
// Erinnerungs-Mails und Monatsberichte. Läuft stündlich (startNotifier) und lässt sich manuell auslösen.
const { getVehicleReminders } = require('./reminders');
const { getVehicleStats } = require('./stats');
const { sendUserMail, loadDefaultSmtp, withDefaultSmtp } = require('./mail');
const categories = require('./categories');
const { accessibleVehicles } = require('./vehicleAccess');

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
        due.push({ ...r, vehicle: v.name, ref: `${v.id}:${r.category}:${r.due_date}:${r.status}` });
      }
    }
  }
  return due;
}

function reminderMail(due) {
  const line = (r) => {
    const when = r.status === 'ueberfaellig' ? 'überfällig' : (r.days === 0 ? 'heute fällig' : `fällig in ${r.days} Tagen`);
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
      `SELECT unit, COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(total_cost_eur), 0) AS cost
       FROM fillups WHERE vehicle_id = $1 AND filled_at >= $2 AND filled_at < $3
       GROUP BY unit ORDER BY unit = 'kwh', unit`,
      [v.id, start, end]
    );
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

    // Je Einheit eine Zeile (Plug-in-Hybrid: Tankfüllungen in Litern und Ladevorgänge in kWh)
    const energy = f.rows.map((r) => {
      const us = segs.filter((s) => s.unit === r.unit);
      const km = us.reduce((a, s) => a + Number(s.km), 0);
      const amount = us.reduce((a, s) => a + Number(s.liters_segment), 0);
      return {
        label: vorgaengeName(v.fuel_type, r.unit),
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

/** Neue Erinnerungen und den Bericht des Vormonats für einen Benutzer verschicken. */
async function notifyUser(pool, settings, now = new Date()) {
  if (settings.reminders_enabled) {
    const due = await collectDueReminders(pool, settings);
    const fresh = await claim(pool, settings.user_id, 'reminder', due.map((r) => r.ref));
    if (fresh.length) {
      try {
        await sendUserMail(settings, reminderMail(due.filter((r) => fresh.includes(r.ref))));
        await recordResult(pool, settings.user_id, null);
      } catch (e) {
        await release(pool, settings.user_id, 'reminder', fresh);
        await recordResult(pool, settings.user_id, e);
      }
    }
  }

  // Kilometerstand nachtragen: gehört zu den Erinnerungen, jeder Eintrag nur einmal (mail_log kind 'odometer')
  if (settings.reminders_enabled) {
    const missing = await collectMissingOdometers(pool, settings, now);
    const fresh = await claim(pool, settings.user_id, 'odometer', missing.map((f) => f.ref));
    if (fresh.length) {
      try {
        await sendUserMail(settings, odometerMail(missing.filter((f) => fresh.includes(f.ref))));
        await recordResult(pool, settings.user_id, null);
      } catch (e) {
        await release(pool, settings.user_id, 'odometer', fresh);
        await recordResult(pool, settings.user_id, e);
      }
    }
  }

  if (settings.monthly_report) {
    const { year, month } = previousMonth(now);
    const ref = `${year}-${String(month).padStart(2, '0')}`;
    const fresh = await claim(pool, settings.user_id, 'report', [ref]);
    if (fresh.length) {
      try {
        await sendUserMail(settings, reportMail(await buildMonthlyReport(pool, settings, year, month)));
        await recordResult(pool, settings.user_id, null);
      } catch (e) {
        await release(pool, settings.user_id, 'report', fresh);
        await recordResult(pool, settings.user_id, e);
      }
    }
  }
}

async function runNotifications(pool, now = new Date()) {
  const defaults = await loadDefaultSmtp(pool);
  // Nur Konten mit bestätigter Adresse (#135): keine Mails an Adressen, deren Inhaber nicht zugestimmt hat
  const r = await pool.query(`${SETTINGS_SQL} WHERE (s.reminders_enabled OR s.monthly_report) AND u.email_verified_at IS NOT NULL`);
  for (const row of r.rows) {
    const settings = withDefaultSmtp(row, defaults);
    if (!settings.smtp_host) continue;
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
  loadUserSettings, collectDueReminders, reminderMail, collectMissingOdometers, odometerMail, buildMonthlyReport, reportMail,
  previousMonth, notifyUser, runNotifications, startNotifier
};
