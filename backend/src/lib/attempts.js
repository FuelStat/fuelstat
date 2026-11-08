// Fehlversuche zählen und sperren (Login, 2FA, Test-Mails, Feedback), im Speicher des Prozesses.
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.

// --- Schutz vor Durchprobieren (Passwort, 2FA-Code): Fehlversuche je Schlüssel zählen ---
// Im Speicher des Prozesses; reicht für eine API-Instanz. Zählt nur Fehlversuche, Erfolg setzt zurück.
const failedAttempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function isLockedOut(key, max) {
  const entry = failedAttempts.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= max;
}

function recordFailure(key) {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || entry.resetAt < now) failedAttempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  else entry.count++;
}

function clearFailures(key) {
  failedAttempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failedAttempts) if (entry.resetAt < now) failedAttempts.delete(key);
}, 10 * 60 * 1000).unref();

// Login: 10 Fehlversuche je Kombination aus IP und E-Mail, zusätzlich 50 je IP über alle Konten (gegen das Durchprobieren
// vieler Konten). Bewusst keine Sperre nur je E-Mail: Sonst könnte jeder ein fremdes Konto per Absicht aussperren.
const LOGIN_MAX_FAILURES = 10;
const LOGIN_IP_MAX_FAILURES = 50;
const MFA_MAX_FAILURES = 5;

function tooManyAttempts(res) {
  return res.status(429).json({ error: 'too_many_attempts', retry_after_minutes: 15 });
}

module.exports = { ATTEMPT_WINDOW_MS, LOGIN_IP_MAX_FAILURES, LOGIN_MAX_FAILURES, MFA_MAX_FAILURES, clearFailures, failedAttempts, isLockedOut, recordFailure, tooManyAttempts };
