-- backend/database/postgres_024_passkeys.sql
-- Passkeys (WebAuthn, #2): je Benutzer beliebig viele Passkeys. Gespeichert wird nur der öffentliche Schlüssel,
-- der private bleibt im Gerät bzw. Passwort-Manager. Mehrfach ausführbar und mit dem alten API-Code verträglich.
BEGIN;

CREATE TABLE IF NOT EXISTS user_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,      -- base64url, vom Authenticator vergeben
  public_key bytea NOT NULL,               -- COSE-Schlüssel
  counter bigint NOT NULL DEFAULT 0,       -- Signaturzähler (bei synchronisierten Passkeys meist 0)
  transports text[] NOT NULL DEFAULT '{}', -- z. B. internal, hybrid, usb
  device_type text NULL,                   -- singleDevice oder multiDevice
  backed_up boolean NOT NULL DEFAULT false,-- synchronisiert (iCloud-Schlüsselbund, Google, 1Password …)
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys(user_id);

COMMIT;
