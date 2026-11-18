-- backend/database/postgres_031_registrations.sql
-- Registrierung (#141, #198):
-- - pending_registrations: Mit Mailserver entsteht ein Konto erst, wenn der Link aus der Mail geöffnet wird. Bis dahin
--   liegt die Anfrage hier (nur Hashes von Passwort und Tokens). Sie verfällt nach 7 Tagen, nach 5 Tagen kommt eine
--   Erinnerung mit einem zweiten Link.
-- - registration_mails: Protokoll der Mails, die eine Registrierung auslöst, für die Grenzen je Adresse und je Stunde
--   (#198). Statt der Adresse steht nur ihr Hash darin; Einträge werden nach 2 Tagen gelöscht.
-- - users.unverified_reminder_sent_at: Erinnerung an noch nicht bestätigte Konten von früher; gelöscht wird
--   frühestens 2 Tage danach.
-- Mehrfach ausführbar, mit dem alten API-Code verträglich (neue Tabellen und eine neue Spalte).
BEGIN;

CREATE TABLE IF NOT EXISTS pending_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  terms_version text NULL,
  terms_accepted_at timestamptz NULL,
  token_hash text NOT NULL UNIQUE,
  reminder_token_hash text NULL UNIQUE,
  from_app boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reminder_sent_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_registrations_expires ON pending_registrations(expires_at);

CREATE TABLE IF NOT EXISTS registration_mails (
  id bigserial PRIMARY KEY,
  address_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('verify', 'exists', 'reminder', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registration_mails_address ON registration_mails(address_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_registration_mails_created ON registration_mails(created_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS unverified_reminder_sent_at timestamptz NULL;

COMMIT;
