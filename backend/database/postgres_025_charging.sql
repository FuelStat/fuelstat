-- backend/database/postgres_025_charging.sql
-- Ladevorgänge (#25): Ladeart, Ladestand vorher/nachher (%) und Ladedauer (Minuten) an Tank-/Ladevorgängen.
-- Alles optional und nur für kWh-Einträge. Mehrfach ausführbar und mit dem alten API-Code verträglich
-- (der die neuen Spalten nicht kennt); bestehende Einträge bleiben unverändert (alle Werte leer).
BEGIN;

ALTER TABLE fillups ADD COLUMN IF NOT EXISTS charge_type text NULL;
ALTER TABLE fillups ADD COLUMN IF NOT EXISTS soc_before_pct smallint NULL;
ALTER TABLE fillups ADD COLUMN IF NOT EXISTS soc_after_pct smallint NULL;
ALTER TABLE fillups ADD COLUMN IF NOT EXISTS charge_minutes integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fillups_charge_check') THEN
    ALTER TABLE fillups ADD CONSTRAINT fillups_charge_check CHECK (
      (charge_type IS NULL OR charge_type IN ('home', 'ac_public', 'dc'))
      AND (soc_before_pct IS NULL OR soc_before_pct BETWEEN 0 AND 100)
      AND (soc_after_pct IS NULL OR soc_after_pct BETWEEN 0 AND 100)
      AND (soc_before_pct IS NULL OR soc_after_pct IS NULL OR soc_after_pct >= soc_before_pct)
      AND (charge_minutes IS NULL OR charge_minutes BETWEEN 1 AND 4320)
      -- nur kWh-Einträge (Laden) haben diese Angaben
      AND (unit = 'kwh' OR (charge_type IS NULL AND soc_before_pct IS NULL AND soc_after_pct IS NULL AND charge_minutes IS NULL))
    );
  END IF;
END $$;

COMMIT;
