// Routen: /auth/mail-settings, /auth/mail-settings/send-now, /auth/mail-settings/test
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const notifier = require('../services/notifier');
const { pool } = require('../db');
const { isLockedOut, recordFailure, tooManyAttempts } = require('../lib/attempts');
const { optionalNumber, optionalText, serverError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { ALLOWED_PORTS, encryptSecret, loadDefaultSmtp, resolveSmtpHost, sendUserMail } = require('../services/mail');
const { requireVerified } = require('../middleware/verified');

const router = express.Router();

// --- E-Mail-Benachrichtigungen (SMTP-Zugang je Benutzer) ---
function mailSettingsResponse(row, defaults) {
  return {
    // Ohne eigenen Server verschickt Fuelstat über den Standard-Mailserver an die Konto-Adresse
    default_available: Boolean(defaults),
    default_from: defaults ? (defaults.from_address || defaults.smtp_user || defaults.account_email) : null,
    uses_default: Boolean(defaults) && !row?.smtp_host,
    smtp_host: row?.smtp_host ?? null,
    smtp_port: row?.smtp_port ?? null,
    smtp_security: row?.smtp_security ?? 'starttls',
    smtp_user: row?.smtp_user ?? null,
    has_password: Boolean(row?.smtp_password_enc),
    from_address: row?.from_address ?? null,
    to_address: row?.to_address ?? null,
    reminders_enabled: row?.reminders_enabled ?? false,
    reminder_days: row?.reminder_days ?? 30,
    monthly_report: row?.monthly_report ?? false,
    last_sent_at: row?.last_sent_at ?? null,
    last_error: row?.last_error ?? null
  };
}

const MAIL_ERROR_CODES = new Set(['mail_not_configured', 'smtp_host_not_allowed']);
function mailErrorResponse(res, e) {
  if (MAIL_ERROR_CODES.has(e.code)) return res.status(400).json({ error: e.code });
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return res.status(400).json({ error: 'smtp_host_not_found' });
  // SMTP-Fehler (Login, TLS, Verbindung) an den Benutzer weitergeben, damit er die Einstellungen korrigieren kann
  return res.status(502).json({ error: 'smtp_failed', detail: e.message });
}

router.get('/auth/mail-settings', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM user_mail_settings WHERE user_id = $1', [req.user.sub]);
    res.json(mailSettingsResponse(r.rows[0], await loadDefaultSmtp(pool)));
  } catch (e) {
    serverError(res, e);
  }
});

router.put('/auth/mail-settings', auth, requireVerified('mail'), async (req, res) => {
  const b = req.body || {};
  const host = optionalText(b.smtpHost) ?? null;
  const port = optionalNumber(b.smtpPort) ?? null;
  const security = b.smtpSecurity === undefined ? 'starttls' : String(b.smtpSecurity);
  // Länge zuerst prüfen (E-Mail max. 254 Zeichen) und Domain ohne überlappende Wiederholung: kein ReDoS
  const emailOk = (v) => v === null || (v.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(v));
  const fromAddress = optionalText(b.fromAddress) ?? null;
  const toAddress = optionalText(b.toAddress) ?? null;
  const reminderDays = optionalNumber(b.reminderDays) ?? 30;

  if (host !== null && (host.length > 253 || !/^[a-z0-9.-]+$/i.test(host))) return res.status(400).json({ error: 'invalid_smtpHost' });
  if (host !== null && !ALLOWED_PORTS.includes(port)) return res.status(400).json({ error: 'invalid_smtpPort', allowed: ALLOWED_PORTS });
  if (!['tls', 'starttls', 'none'].includes(security)) return res.status(400).json({ error: 'invalid_smtpSecurity' });
  if (!emailOk(fromAddress)) return res.status(400).json({ error: 'invalid_fromAddress' });
  if (!emailOk(toAddress)) return res.status(400).json({ error: 'invalid_toAddress' });
  if (!Number.isInteger(reminderDays) || reminderDays < 1 || reminderDays > 180) return res.status(400).json({ error: 'invalid_reminderDays' });

  try {
    const defaults = await loadDefaultSmtp(pool);
    if ((b.remindersEnabled || b.monthlyReport) && host === null && !defaults) return res.status(400).json({ error: 'mail_not_configured' });
    if (host !== null) await resolveSmtpHost(host);

    // Passwort: nur ändern, wenn ein neues gesendet wird; clearPassword löscht es
    let passwordSql = 'smtp_password_enc';
    const values = [req.user.sub, host, host ? port : null, security, optionalText(b.smtpUser) ?? null, fromAddress, toAddress,
      Boolean(b.remindersEnabled), reminderDays, Boolean(b.monthlyReport)];
    if (b.smtpPassword) {
      values.push(encryptSecret(b.smtpPassword));
      passwordSql = `$${values.length}`;
    } else if (b.clearPassword) {
      passwordSql = 'NULL';
    }

    const r = await pool.query(
      `INSERT INTO user_mail_settings (user_id, smtp_host, smtp_port, smtp_security, smtp_user, from_address, to_address,
                                       reminders_enabled, reminder_days, monthly_report, smtp_password_enc)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${passwordSql === 'smtp_password_enc' ? 'NULL' : passwordSql})
       ON CONFLICT (user_id) DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port, smtp_security = EXCLUDED.smtp_security,
         smtp_user = EXCLUDED.smtp_user, from_address = EXCLUDED.from_address, to_address = EXCLUDED.to_address,
         reminders_enabled = EXCLUDED.reminders_enabled, reminder_days = EXCLUDED.reminder_days,
         monthly_report = EXCLUDED.monthly_report,
         smtp_password_enc = ${passwordSql === 'smtp_password_enc' ? 'user_mail_settings.smtp_password_enc' : passwordSql},
         updated_at = now()
       RETURNING *`,
      values
    );
    res.json(mailSettingsResponse(r.rows[0], defaults));
  } catch (e) {
    if (e.code === 'smtp_host_not_allowed' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return mailErrorResponse(res, e);
    serverError(res, e);
  }
});

// Manuelles Senden über den Standard-Mailserver begrenzen (schützt den Server des Betreibers vor Missbrauch)
const MANUAL_DEFAULT_MAILS = 5;
function manualMailLimited(settings, userId) {
  if (!settings?.uses_default) return false;
  const key = `default-mail:${userId}`;
  if (isLockedOut(key, MANUAL_DEFAULT_MAILS)) return true;
  recordFailure(key);
  return false;
}

// Test-Mail mit den gespeicherten Einstellungen
router.post('/auth/mail-settings/test', auth, requireVerified('mail'), async (req, res) => {
  try {
    const settings = await notifier.loadUserSettings(pool, req.user.sub);
    if (manualMailLimited(settings, req.user.sub)) return tooManyAttempts(res);
    await sendUserMail(settings, {
      subject: 'Fuelstat: Test-Mail',
      text: 'Hallo,\n\ndie E-Mail-Einstellungen in Fuelstat funktionieren.\n\nDeine Fuelstat-App',
      html: '<p>Hallo,</p><p>die E-Mail-Einstellungen in Fuelstat funktionieren.</p><p>Deine Fuelstat-App</p>'
    });
    res.json({ sent: true });
  } catch (e) {
    mailErrorResponse(res, e);
  }
});

// Erinnerungen bzw. Monatsbericht (Vormonat) sofort senden – unabhängig davon, ob sie schon verschickt wurden
router.post('/auth/mail-settings/send-now', auth, requireVerified('mail'), async (req, res) => {
  const type = String(req.body?.type || '');
  if (!['reminders', 'report'].includes(type)) return res.status(400).json({ error: 'invalid_type' });
  try {
    const settings = await notifier.loadUserSettings(pool, req.user.sub);
    if (manualMailLimited(settings, req.user.sub)) return tooManyAttempts(res);
    if (type === 'reminders') {
      const due = await notifier.collectDueReminders(pool, settings);
      if (due.length === 0) return res.json({ sent: false, reason: 'nothing_due' });
      await sendUserMail(settings, notifier.reminderMail(due));
      return res.json({ sent: true, count: due.length });
    }
    const { year, month } = notifier.previousMonth();
    await sendUserMail(settings, notifier.reportMail(await notifier.buildMonthlyReport(pool, settings, year, month)));
    res.json({ sent: true });
  } catch (e) {
    mailErrorResponse(res, e);
  }
});

module.exports = router;
