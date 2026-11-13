-- backend/database/postgres_023_push.sql
-- Push-Benachrichtigungen (#136): Geräte bzw. Push-Abos je Benutzer, Kanäle je Anlass, Versandprotokoll für Push.
-- Mehrfach ausführbar und mit dem alten API-Code verträglich (der die neuen Spalten und Tabellen nicht kennt).
BEGIN;

-- Geräte für Push: Web Push (PWA) heute, APNs/FCM für native Apps später
CREATE TABLE IF NOT EXISTS push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('webpush', 'apns', 'fcm')),
  endpoint text NOT NULL UNIQUE,           -- Web Push: Adresse des Push-Dienstes; APNs/FCM: Geräte-Token
  p256dh text NULL,                        -- Web Push: öffentlicher Schlüssel des Browsers
  auth text NULL,                          -- Web Push: Auth-Geheimnis des Browsers
  name text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);

-- Kanäle je Anlass. E-Mail für Termine und Monatsbericht: reminders_enabled bzw. monthly_report wie bisher.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'user_mail_settings' AND column_name = 'odometer_mail') THEN
    ALTER TABLE user_mail_settings ADD COLUMN odometer_mail boolean NOT NULL DEFAULT false;
    -- „Kilometerstand nachtragen“ kam bisher mit den Termin-Erinnerungen
    UPDATE user_mail_settings SET odometer_mail = reminders_enabled;
  END IF;
END $$;

ALTER TABLE user_mail_settings
  ADD COLUMN IF NOT EXISTS inactive_mail boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_reminders boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_odometer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_report boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_inactive boolean NOT NULL DEFAULT false;

-- Versandprotokoll: neuer Anlass „lange kein Eintrag“ und je Anlass ein eigener Eintrag für Push
ALTER TABLE mail_log DROP CONSTRAINT IF EXISTS mail_log_kind_check;
ALTER TABLE mail_log ADD CONSTRAINT mail_log_kind_check CHECK (kind IN (
  'reminder', 'report', 'odometer', 'inactive', 'push:reminder', 'push:report', 'push:odometer', 'push:inactive'));

COMMIT;
