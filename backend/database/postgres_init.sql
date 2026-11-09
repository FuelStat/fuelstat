-- backend/database/postgres_init.sql
-- Vollständiges Schema für eine NEUE Installation (Stand: Migration 020).
-- Beim ersten Start der Datenbank spielt Docker diese Datei automatisch ein (siehe infra/docker-compose.yml).
-- Bestehende Installationen nutzen stattdessen die Migrationen postgres_0XX_*.sql.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Benutzer
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,             -- bcrypt
  username text NULL UNIQUE,
  mfa_secret text NULL,                    -- TOTP-Secret, nur bei aktiver 2FA genutzt
  mfa_last_counter bigint NULL,            -- zuletzt akzeptierter TOTP-Zähler: jeder 2FA-Code gilt nur einmal
  mfa_enabled boolean NOT NULL DEFAULT false,
  profile_image_url text NULL,
  beta_tester boolean NOT NULL DEFAULT false,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'fleet')), -- siehe backend/src/services/plans.js
  plan_until timestamptz NULL,             -- Ende des Tarifs, NULL = unbefristet
  last_login_at timestamptz NULL,
  last_seen_at timestamptz NULL,           -- höchstens stündlich aktualisiert
  email_verified_at timestamptz NULL,      -- Adresse bestätigt (#135); NULL = noch nicht, Funktionen begrenzt
  pending_email text NULL,                 -- neue Adresse, bis sie bestätigt ist
  terms_version text NULL,                 -- zugestimmte Fassung der Nutzungsbedingungen (TERMS_VERSION, #135)
  terms_accepted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- E-Mail-Bestätigung (#135): nur der Hash des Tokens, das Token steht nur in der Mail
CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id, created_at DESC);

-- Fahrzeuge
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- hybrid = Vollhybrid (tankt nur), phev = Plug-in-Hybrid (tankt und lädt)
  fuel_type text NOT NULL CHECK (fuel_type = ANY (ARRAY['diesel','e5','e10','lpg','cng','electric','hybrid','phev','hydrogen','other'])),
  brand text NULL,
  model text NULL,
  year smallint NULL CHECK (year IS NULL OR (year >= 1886 AND year <= 2100)),
  image_url text NULL,
  odometer_km integer NULL,                -- Tachostand bei Anschaffung
  mileage_km integer NULL,
  tank_capacity numeric(10,3) NULL,        -- l bzw. kg, bei Elektroautos kWh
  battery_capacity numeric(10,3) NULL,     -- kWh, nur Plug-in-Hybride
  -- Zusatzangaben (#45), alle optional
  license_plate text NULL,
  vin text NULL,
  first_registration date NULL,            -- erster TÜV nach 36 Monaten
  purchase_date date NULL,
  purchase_price numeric(10,2) NULL CHECK (purchase_price IS NULL OR purchase_price >= 0),
  sale_date date NULL,
  sale_price numeric(10,2) NULL CHECK (sale_price IS NULL OR sale_price >= 0),
  service_interval_months smallint NULL CHECK (service_interval_months IS NULL OR service_interval_months BETWEEN 1 AND 60),
  service_interval_km integer NULL CHECK (service_interval_km IS NULL OR service_interval_km BETWEEN 1000 AND 100000),
  oil_interval_months smallint NULL CHECK (oil_interval_months IS NULL OR oil_interval_months BETWEEN 1 AND 60),
  oil_interval_km integer NULL CHECK (oil_interval_km IS NULL OR oil_interval_km BETWEEN 1000 AND 100000),
  insurance_company text NULL,
  insurance_premium numeric(10,2) NULL CHECK (insurance_premium IS NULL OR insurance_premium >= 0),
  insurance_due_month smallint NULL CHECK (insurance_due_month IS NULL OR insurance_due_month BETWEEN 1 AND 12),
  tax_amount numeric(10,2) NULL CHECK (tax_amount IS NULL OR tax_amount >= 0),
  tax_due_month smallint NULL CHECK (tax_due_month IS NULL OR tax_due_month BETWEEN 1 AND 12),
  tire_size_summer text NULL,
  tire_size_winter text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_user_created ON vehicles(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_user_sort ON vehicles(user_id, sort_order ASC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_user_brand_model ON vehicles(user_id, brand, model);

-- Tankfüllungen und Ladevorgänge; die Einheit gilt je Eintrag (Plug-in-Hybrid: l beim Tanken, kWh beim Laden)
CREATE TABLE IF NOT EXISTS fillups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  odometer_km integer NULL CHECK (odometer_km >= 0), -- darf fehlen und später nachgetragen werden
  odometer_estimated boolean NOT NULL DEFAULT false, -- nur geschätzt: zählt nicht für Verbrauch und Tachostand
  amount numeric(10,3) NOT NULL CHECK (amount >= 0),
  unit text NOT NULL DEFAULT 'l' CHECK (unit IN ('l','kwh','kg')),
  total_cost_eur numeric(10,2) NOT NULL CHECK (total_cost_eur >= 0),
  price_per_unit numeric(10,4),
  station text NULL,
  filled_at timestamptz NOT NULL DEFAULT now(),
  is_full boolean NOT NULL DEFAULT true,
  skip_previous boolean NOT NULL DEFAULT false, -- Lücke davor: Vollbetankung ist nur neuer Startpunkt
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fillups_user_vehicle_filled ON fillups(user_id, vehicle_id, filled_at DESC);
CREATE INDEX IF NOT EXISTS idx_fillups_vehicle_odo ON fillups(vehicle_id, odometer_km);

-- Andere Ausgaben (Versicherung, Werkstatt, TÜV …) und Fahrten
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  category text NOT NULL,
  amount_eur numeric(10,2) NOT NULL CHECK (amount_eur >= 0),
  odometer_km integer NULL CHECK (odometer_km >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  vendor text NULL,
  description text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_vehicle_date ON expenses(user_id, vehicle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_vehicle_odo ON expenses(vehicle_id, odometer_km);
CREATE INDEX IF NOT EXISTS idx_expenses_user_category ON expenses(user_id, category);

-- Eigene Kategorien für Ausgaben (#95); feste Kategorien stehen im Code (backend/src/services/categories.js).
-- Ausgaben mit eigener Kategorie speichern in expenses.category den Schlüssel "custom:<id>".
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  icon text NOT NULL DEFAULT 'fa-tag',
  color text NOT NULL DEFAULT '#6c757d',
  group_key text NOT NULL DEFAULT 'sonstiges',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_user_name ON expense_categories(user_id, lower(name));

-- Hochgeladene Bilder (Profil und Fahrzeuge)
CREATE TABLE IF NOT EXISTS user_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type text NOT NULL DEFAULT 'image',
  url text NOT NULL,
  mime_type text NULL,
  bytes integer NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_media_user_created ON user_media(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vehicle_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type text NOT NULL DEFAULT 'image',
  url text NOT NULL,
  mime_type text NULL,
  bytes integer NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_media_vehicle_created ON vehicle_media(vehicle_id, created_at DESC);

-- Abgemeldete Einzel-Tokens (JWT jti)
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  reason text NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens(user_id, revoked_at DESC);

-- "Auf allen Geräten abmelden": alle Tokens vor revoked_after sind ungültig
CREATE TABLE IF NOT EXISTS user_token_revocations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revoked_after timestamptz NOT NULL DEFAULT now(),
  reason text NULL
);

-- E-Mail-Benachrichtigungen: eigener SMTP-Zugang (optional) und Einstellungen je Benutzer
CREATE TABLE IF NOT EXISTS user_mail_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  smtp_host text NULL,
  smtp_port integer NULL CHECK (smtp_port IN (25, 465, 587, 2525)),
  smtp_security text NOT NULL DEFAULT 'starttls' CHECK (smtp_security IN ('tls', 'starttls', 'none')),
  smtp_user text NULL,
  smtp_password_enc text NULL,             -- AES-256-GCM verschlüsselt, siehe backend/src/services/mail.js
  from_address text NULL,
  to_address text NULL,                    -- leer = E-Mail-Adresse des Kontos
  reminders_enabled boolean NOT NULL DEFAULT false,
  reminder_days integer NOT NULL DEFAULT 30 CHECK (reminder_days BETWEEN 1 AND 180),
  monthly_report boolean NOT NULL DEFAULT false,
  last_sent_at timestamptz NULL,
  last_error text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Jede Erinnerung bzw. jeder Monatsbericht wird nur einmal verschickt
CREATE TABLE IF NOT EXISTS mail_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder', 'report', 'odometer')),
  ref text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref)
);

-- Feedback der Benutzer (bleibt beim Löschen des Kontos erhalten)
CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  user_email text NULL,
  category text NOT NULL CHECK (category IN ('fehler', 'idee', 'lob', 'sonstiges')),
  message text NOT NULL,
  page text NULL,
  user_agent text NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

-- Protokoll der Tarifänderungen (#102)
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


-- Fahrzeuge teilen (#53): Mitglieder mit Rolle und Einladungen; der Besitzer ist vehicles.user_id
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

-- Fahrtenbuch (#52)
CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Fahrer bzw. wer die Fahrt erfasst hat (#53)
  started_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  odometer_start integer NULL CHECK (odometer_start IS NULL OR odometer_start >= 0),
  odometer_end integer NOT NULL CHECK (odometer_end >= 0),
  distance_km numeric(9,1) NOT NULL CHECK (distance_km >= 0),
  start_place text NULL,
  end_place text NULL,
  purpose text NOT NULL DEFAULT 'private' CHECK (purpose IN ('private', 'business', 'commute')),
  note text NULL,
  legacy_expense_id uuid NULL UNIQUE,      -- übernommene alte "Fahrt"-Ausgabe
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (odometer_start IS NULL OR odometer_start <= odometer_end)
);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle_started ON trips(vehicle_id, started_at DESC);


-- Passwort vergessen (#141): nur der Hash des Tokens, 1 Stunde gültig, einmalig
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
