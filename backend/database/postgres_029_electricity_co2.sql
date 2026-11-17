-- backend/database/postgres_029_electricity_co2.sql
-- CO₂ beim Laden (#25): eigener Faktor für Strom je Fahrzeug in kg CO₂ je kWh, z. B. für Ökostrom oder PV-Strom.
-- NULL = deutscher Strommix (Standard der API). Mehrfach ausführbar und mit dem alten API-Code verträglich.
BEGIN;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS electricity_co2_factor numeric(5,3) NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_electricity_co2_factor_check') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_electricity_co2_factor_check
      CHECK (electricity_co2_factor IS NULL OR (electricity_co2_factor >= 0 AND electricity_co2_factor <= 2));
  END IF;
END $$;

COMMIT;
