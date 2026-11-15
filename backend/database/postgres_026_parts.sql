-- backend/database/postgres_026_parts.sql
-- Service-Historie je Bauteil (#78): Bauteile an Werkstatt-, Wartungs-, Reparatur- und Reifen-Einträgen,
-- eigene Bauteile je Fahrzeug, Wechselintervalle je Fahrzeug und Bauteil. Mehrfach ausführbar und mit dem alten
-- API-Code verträglich (der die neuen Tabellen nicht kennt); bestehende Einträge bleiben ohne Bauteile.
-- Die eingebauten Bauteile (Motoröl, Bremsbeläge …) stehen im Code (services/parts.js), nicht in der Datenbank.
BEGIN;

-- Eigene Bauteile eines Fahrzeugs (Schlüssel in der API: custom:<id>)
CREATE TABLE IF NOT EXISTS vehicle_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_parts_name ON vehicle_parts(vehicle_id, lower(name));

-- Welche Bauteile ein Eintrag (Rechnung) umfasst, optional mit Kostenanteil. part_key: eingebauter Schlüssel
-- (oil, brake_pads_front …) oder custom:<id>
CREATE TABLE IF NOT EXISTS expense_parts (
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  part_key text NOT NULL,
  cost_share numeric(10,2) NULL CHECK (cost_share >= 0),
  PRIMARY KEY (expense_id, part_key)
);
CREATE INDEX IF NOT EXISTS idx_expense_parts_key ON expense_parts(part_key);

-- Wechselintervall je Fahrzeug und Bauteil (Zeit und/oder km, was zuerst kommt). Motoröl nutzt weiter
-- vehicles.oil_interval_months/km, dort steht der Wert nur einmal.
CREATE TABLE IF NOT EXISTS vehicle_part_intervals (
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  part_key text NOT NULL,
  interval_months integer NULL CHECK (interval_months BETWEEN 1 AND 240),
  interval_km integer NULL CHECK (interval_km BETWEEN 1000 AND 1000000),
  PRIMARY KEY (vehicle_id, part_key),
  CHECK (interval_months IS NOT NULL OR interval_km IS NOT NULL)
);

COMMIT;
