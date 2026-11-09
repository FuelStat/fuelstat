-- backend/database/postgres_020_password_resets.sql
-- Passwort vergessen (#141): Links zum Zurücksetzen. Nur der SHA-256-Hash des Tokens, 1 Stunde gültig, einmalig.
-- Nur eine neue Tabelle – verträglich mit dem alten API-Code. Mehrfach ausführbar.
BEGIN;

CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at DESC);

COMMIT;
