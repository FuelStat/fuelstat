-- backend/database/postgres_018_vehicle_sharing.sql
-- Fahrzeuge mit anderen Konten teilen (#53): Mitglieder mit Rolle und Einladungen per E-Mail.
-- Der Besitzer steht nicht in vehicle_members, er ergibt sich aus vehicles.user_id.
-- Einträge (fillups, expenses) behalten in user_id, wer sie erfasst hat.
-- Nur neue Tabellen – verträglich mit dem alten API-Code, kann also vor dem Neustart laufen. Mehrfach ausführbar.
BEGIN;

CREATE TABLE IF NOT EXISTS vehicle_members (
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')), -- editor = Mitfahrer (erfassen), viewer = nur ansehen
  invited_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_members_user ON vehicle_members(user_id);

-- Einladungen gelten für eine E-Mail-Adresse: Annehmen kann nur, wer mit genau dieser (bestätigten) Adresse angemeldet ist
CREATE TABLE IF NOT EXISTS vehicle_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  invited_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz NULL,
  declined_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_invitations_email ON vehicle_invitations(lower(email)) WHERE accepted_at IS NULL AND declined_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_invitations_vehicle ON vehicle_invitations(vehicle_id);

COMMIT;
