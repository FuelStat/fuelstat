-- backend/database/postgres_028_residual_value.sql
-- Gesamtkosten (#79): geschätzter Restwert eines Fahrzeugs, das noch gefahren wird. Zusammen mit Kaufpreis (#45) ergibt er
-- den Wertverlust; bei einem verkauften Fahrzeug gilt stattdessen der Verkaufserlös (sale_price).
-- Mehrfach ausführbar und mit dem alten API-Code verträglich.
BEGIN;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS residual_value numeric(10,2) NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_residual_value_check') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_residual_value_check CHECK (residual_value IS NULL OR residual_value >= 0);
  END IF;
END $$;

COMMIT;
