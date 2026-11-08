// Zwei-Faktor-Anmeldung: TOTP (RFC 6238), Base32, verschlüsselte Secrets.
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const { createHmac, timingSafeEqual } = require('crypto');
const { pool } = require('../db');
const { decryptSecret, encryptSecret } = require('./mail');

// --- TOTP (RFC 6238) für 2FA: 30 s, 6 Stellen, SHA1 – kompatibel mit gängigen Authenticator-Apps ---
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCode(secretBase32, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const num = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(num).padStart(6, '0');
}

// Erlaubt ±1 Zeitfenster (je 30 s) für leicht abweichende Uhren
// 2FA-Secrets liegen verschlüsselt in der Datenbank (AES-256-GCM, eigener Schlüssel 'mfa').
// Ältere, noch unverschlüsselte Werte werden beim Start umgewandelt (encryptLegacyMfaSecrets).
function storeMfaSecret(secretBase32) {
  return encryptSecret(secretBase32, 'mfa');
}

function readMfaSecret(stored) {
  if (!stored) return null;
  if (!String(stored).startsWith('v1:')) return String(stored);
  try {
    return decryptSecret(stored, 'mfa');
  } catch (e) {
    // Falscher Schlüssel (z. B. JWT_SECRET ohne MAIL_ENCRYPTION_KEY geändert): 2FA-Codes gelten als falsch
    console.error('[mfa] Secret nicht entschlüsselbar:', e.message);
    return null;
  }
}

async function encryptLegacyMfaSecrets() {
  const r = await pool.query("SELECT id, mfa_secret FROM users WHERE mfa_secret IS NOT NULL AND mfa_secret NOT LIKE 'v1:%'");
  for (const row of r.rows) {
    await pool.query('UPDATE users SET mfa_secret = $1 WHERE id = $2 AND mfa_secret = $3', [storeMfaSecret(row.mfa_secret), row.id, row.mfa_secret]);
  }
  if (r.rowCount) console.log(`[mfa] ${r.rowCount} 2FA-Secret(s) verschlüsselt`);
}

function verifyTotp(secretBase32, code) {
  const given = String(code || '').replace(/\s/g, '');
  if (!secretBase32 || !/^\d{6}$/.test(given)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secretBase32, counter + delta));
    if (timingSafeEqual(expected, Buffer.from(given))) return true;
  }
  return false;
}

// Kurzlebiges Token für den 2FA-Schritt (eigener Schlüssel, kann nicht als Zugangstoken benutzt werden)
const MFA_TOKEN_SECRET = `${process.env.JWT_SECRET}:mfa-step`;

module.exports = { BASE32_ALPHABET, MFA_TOKEN_SECRET, base32Decode, base32Encode, encryptLegacyMfaSecrets, readMfaSecret, storeMfaSecret, totpCode, verifyTotp };
