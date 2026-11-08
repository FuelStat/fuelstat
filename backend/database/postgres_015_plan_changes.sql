-- backend/database/postgres_015_plan_changes.sql
-- Protokoll der Tarifänderungen (#102): wer hat wann welchen Tarif gesetzt, über welchen Weg.
-- Tarife ändern nur Admins über die API, der Betreiber über backend/scripts/tarif-setzen.js
-- und später ein verifizierter Zahlungsanbieter-Webhook (#59). Keine Tokens oder Zahlungsdaten.
BEGIN;

CREATE TABLE IF NOT EXISTS plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_plan text NOT NULL,
  old_plan_until timestamptz NULL,
  new_plan text NOT NULL,
  new_plan_until timestamptz NULL,
  source text NOT NULL CHECK (source IN ('admin', 'cli', 'webhook')),
  changed_by uuid NULL,  -- Admin-Konto bei source = 'admin'; bewusst ohne Fremdschlüssel, damit das Protokoll bleibt
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_changes_user ON plan_changes(user_id, created_at DESC);

COMMIT;
