-- backend/database/postgres_027_vehicle_status.sql
-- Fahrzeug-Lebenszyklus (#79): Status aktiv, verkauft oder stillgelegt. Verkaufte und stillgelegte Fahrzeuge sind archiviert:
-- alle Daten bleiben lesbar, es lässt sich nichts mehr ändern, Erinnerungen und Monatsbericht entfallen, und sie zählen nicht
-- für die Fahrzeuggrenze des Tarifs. Verkaufsdatum und -erlös bleiben die vorhandenen Spalten sale_date und sale_price (#45).
-- Mehrfach ausführbar und mit dem alten API-Code verträglich; alle bestehenden Fahrzeuge bleiben aktiv (auch solche mit
-- Verkaufsdatum: der Status wird nie geraten).
BEGIN;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sale_odometer_km integer NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS decommissioned_from date NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS decommissioned_until date NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_status_check') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_status_check CHECK (
      status IN ('active', 'sold', 'decommissioned')
      AND (sale_odometer_km IS NULL OR sale_odometer_km >= 0)
      AND (decommissioned_until IS NULL OR decommissioned_from IS NULL OR decommissioned_until >= decommissioned_from)
    );
  END IF;
END $$;

-- Für die Fahrzeuggrenze (aktive und archivierte je Besitzer zählen)
CREATE INDEX IF NOT EXISTS idx_vehicles_user_status ON vehicles(user_id, status);

COMMIT;
