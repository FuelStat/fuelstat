-- backend/database/postgres_016_mfa_last_counter.sql
-- 2FA-Codes nur einmal verwendbar (RFC 6238, Abschnitt 5.2): zuletzt akzeptierter TOTP-Zähler je Konto.
-- Nur eine neue, leere Spalte – verträglich mit dem alten API-Code, kann also vor dem Neustart eingespielt werden.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_counter bigint NULL;

COMMIT;
