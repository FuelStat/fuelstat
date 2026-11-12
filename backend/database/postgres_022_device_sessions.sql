-- backend/database/postgres_022_device_sessions.sql
-- Gerätesitzungen für native Apps (#117). Mehrfach ausführbar und mit dem alten API-Code verträglich (der die
-- Tabellen nicht kennt).
BEGIN;

-- Gerätesitzungen für native Apps (#117): Refresh-Token je Gerät, nur als SHA-256-Hash gespeichert
CREATE TABLE IF NOT EXISTS device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'other')),
  app_version text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  revoked_reason text NULL
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON device_sessions(user_id, last_used_at DESC);

-- Ausgegebene Refresh-Tokens; used_at gesetzt = schon getauscht (Wiederverwendung beendet die Sitzung)
CREATE TABLE IF NOT EXISTS device_refresh_tokens (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_device_refresh_tokens_session ON device_refresh_tokens(session_id);

COMMIT;
