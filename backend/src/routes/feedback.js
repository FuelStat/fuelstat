// Routen: /feedback, /feedback/:id
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const { pageOrReply, queryPage, pageOfArray } = require('../lib/pagination');
const { pool } = require('../db');
const { isLockedOut, recordFailure, tooManyAttempts } = require('../lib/attempts');
const { optionalText, serverError } = require('../lib/http');
const { auth, requireAdmin } = require('../middleware/auth');
const { loadDefaultSmtp, sendUserMail, withDefaultSmtp } = require('../services/mail');
const { requireVerified } = require('../middleware/verified');

const router = express.Router();

// --- Feedback der Benutzer (Beta) ---
const FEEDBACK_CATEGORIES = { fehler: 'Fehler', idee: 'Idee', lob: 'Lob', sonstiges: 'Sonstiges' };
const FEEDBACK_MAX_PER_WINDOW = 10;

/** Empfänger: FEEDBACK_EMAIL, sonst der Empfänger bzw. die Konto-Adresse des Standard-Mailservers */
function feedbackRecipient(defaults) {
  return process.env.FEEDBACK_EMAIL || defaults?.to_address || defaults?.account_email || null;
}

router.post('/feedback', auth, requireVerified('feedback'), async (req, res) => {
  const category = String(req.body?.category || '');
  const message = String(req.body?.message || '').trim();
  const page = optionalText(req.body?.page) ?? null;
  if (!FEEDBACK_CATEGORIES[category]) return res.status(400).json({ error: 'invalid_category' });
  if (message.length < 3 || message.length > 5000) return res.status(400).json({ error: 'invalid_message' });
  if (page !== null && page.length > 300) return res.status(400).json({ error: 'invalid_page' });

  const key = `feedback:${req.user.sub}`;
  if (isLockedOut(key, FEEDBACK_MAX_PER_WINDOW)) return tooManyAttempts(res);
  recordFailure(key);

  try {
    const u = await pool.query('SELECT email, username FROM users WHERE id = $1', [req.user.sub]);
    const user = u.rows[0] || {};
    const userAgent = String(req.get('user-agent') || '').slice(0, 300) || null;
    const r = await pool.query(
      `INSERT INTO feedback (user_id, user_email, category, message, page, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [req.user.sub, user.email || null, category, message, page, userAgent]
    );

    // Gespeichert ist es auf jeden Fall; die Mail an den Betreiber ist ein Zusatz
    let mailed = false;
    const defaults = await loadDefaultSmtp(pool);
    const to = feedbackRecipient(defaults);
    if (defaults && to) {
      const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const von = user.username ? `${user.username} <${user.email}>` : user.email;
      const zeilen = [`Von: ${von}`, `Art: ${FEEDBACK_CATEGORIES[category]}`, page ? `Seite: ${page}` : null, userAgent ? `Gerät: ${userAgent}` : null].filter(Boolean);
      try {
        await sendUserMail(withDefaultSmtp({}, defaults), {
          to,
          replyTo: user.email,
          subject: `Fuelstat-Feedback (${FEEDBACK_CATEGORIES[category]}) von ${user.username || user.email}`,
          text: `${zeilen.join('\n')}\n\n${message}\n`,
          html: `<p>${zeilen.map(esc).join('<br>')}</p><p style="white-space:pre-wrap">${esc(message)}</p>`
        });
        mailed = true;
      } catch (e) {
        console.error('[feedback] Mail fehlgeschlagen:', e.message);
      }
    }
    res.status(201).json({ id: r.rows[0].id, saved: true, mailed });
  } catch (e) {
    serverError(res, e);
  }
});

// Feedback-Liste für Admins (neueste zuerst)
router.get('/feedback', auth, requireAdmin, async (req, res) => {
  // Seitenweise (#160)
  const p = pageOrReply(req, res);
  if (!p) return;
  try {
    res.json(await queryPage(pool, {
      sql: `SELECT f.id, f.category, f.message, f.page, f.user_agent, f.done, f.created_at,
              COALESCE(u.email, f.user_email) AS user_email, u.username, u.beta_tester
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.done ASC, f.created_at DESC, f.id`,
      countSql: 'SELECT COUNT(*)::int AS total FROM feedback'
    }, p));
  } catch (e) {
    serverError(res, e);
  }
});

router.patch('/feedback/:id', auth, requireAdmin, async (req, res) => {
  if (typeof req.body?.done !== 'boolean') return res.status(400).json({ error: 'invalid_done' });
  try {
    const r = await pool.query('UPDATE feedback SET done = $2 WHERE id = $1 RETURNING id, done', [String(req.params.id), req.body.done]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'feedback_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'feedback_not_found' });
    serverError(res, e);
  }
});

module.exports = router;
