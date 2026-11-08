// Tests der aus server.js ausgelagerten Hilfen (#110), ohne Datenbank.
// lib/http und lib/attempts brauchen keine Umgebung; services/mfa liest JWT_SECRET erst beim Ver-/Entschlüsseln.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef';

const { optionalNumber, optionalText, UUID_RE } = require('../src/lib/http');
const { isLockedOut, recordFailure, clearFailures, LOGIN_MAX_FAILURES } = require('../src/lib/attempts');
const { base32Encode, base32Decode, totpCode, verifyTotp } = require('../src/services/mfa');

test('lib/http: Eingaben in Zahl und Text wandeln, UUIDs erkennen', () => {
  // undefined = Feld nicht gesendet (nicht ändern), null/'' = Feld leeren
  assert.equal(optionalNumber(undefined), undefined);
  assert.equal(optionalNumber(''), null);
  assert.equal(optionalNumber(null), null);
  assert.equal(optionalNumber('12.5'), 12.5);
  assert.ok(Number.isNaN(optionalNumber('12,5')), 'Komma ergibt NaN; die Routen prüfen das danach');
  assert.equal(optionalText(undefined), undefined);
  assert.equal(optionalText('  Werkstatt  '), 'Werkstatt');
  assert.equal(optionalText('   '), null);
  assert.ok(UUID_RE.test('1b4e28ba-2fa1-11d2-883f-0016d3cca427'));
  assert.ok(!UUID_RE.test('keine-uuid'));
});

test('lib/attempts: Sperre nach zu vielen Fehlversuchen, Aufheben nach Erfolg', () => {
  const key = `test:${Date.now()}`;
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    assert.equal(isLockedOut(key, LOGIN_MAX_FAILURES), false);
    recordFailure(key);
  }
  assert.equal(isLockedOut(key, LOGIN_MAX_FAILURES), true);
  clearFailures(key);
  assert.equal(isLockedOut(key, LOGIN_MAX_FAILURES), false);
});

test('services/mfa: Base32 und TOTP nach RFC 6238', () => {
  // Testvektor aus RFC 6238, Anhang B (SHA-1, Secret "12345678901234567890")
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(totpCode(secret, Math.floor(59 / 30)), '287082', 'T = 59 s (8-stellig 94287082)');
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), '081804', 'T = 1111111109 s (07081804)');
  assert.equal(verifyTotp(secret, totpCode(secret, Math.floor(Date.now() / 30000))), true);
  assert.equal(verifyTotp(secret, '12345'), false, 'nur 6 Ziffern');
  assert.equal(verifyTotp('', '123456'), false, 'ohne Secret');
});

test('middleware/rateLimits: Zähler je Konto nur mit gültig signiertem Token, sonst je IP', () => {
  const jwt = require('jsonwebtoken');
  const { limitKey } = require('../src/middleware/rateLimits');
  const req = (authorization) => ({ ip: '203.0.113.7', header: (n) => (n === 'Authorization' ? authorization : undefined) });
  const gueltig = jwt.sign({ sub: 'konto-1' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const gefaelscht = jwt.sign({ sub: 'konto-1' }, 'anderer-schluessel-0123456789', { algorithm: 'HS256' });
  assert.equal(limitKey(req(`Bearer ${gueltig}`)), 'u:konto-1');
  assert.match(limitKey(req(`Bearer ${gefaelscht}`)), /^ip:/, 'falsch signiert zählt als anonym');
  assert.match(limitKey(req('Bearer kaputt')), /^ip:/);
  assert.match(limitKey(req(undefined)), /^ip:/, 'ohne Token je IP');
});
