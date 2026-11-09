-- backend/database/postgres_017_email_verification.sql
-- E-Mail-Adresse bestätigen (#135): Zeitpunkt der Bestätigung, ausstehende neue Adresse und Bestätigungs-Tokens.
-- Verträglich mit dem alten API-Code (nur neue Spalten und eine neue Tabelle), kann also vor dem Neustart laufen.
-- Mehrfach ausführbar: Bestehende Konten gelten als bestätigt – aber nur beim ersten Einspielen, damit ein zweiter
-- Lauf keine inzwischen neu registrierten, noch unbestätigten Konten freischaltet.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified_at timestamptz NULL;
    UPDATE users SET email_verified_at = created_at;
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email text NULL;

CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,                     -- Adresse, die bestätigt wird (Konto-Adresse oder neue Adresse)
  token_hash text NOT NULL UNIQUE,         -- SHA-256 des Tokens; das Token selbst steht nur in der Mail
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id, created_at DESC);

COMMIT;
