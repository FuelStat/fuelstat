-- backend/database/postgres_021_fuels.sql
-- Mehrere Kraftstoffe je Fahrzeug (#140): Sorten am Fahrzeug, Sorte je Tank- bzw. Ladevorgang.
--
-- - vehicles.fuels (Sorten des Fahrzeugs) und vehicles.default_fuel (Standard für neue Einträge)
-- - fillups.fuel (Sorte des Eintrags; die Einheit ergibt sich daraus)
-- - Bestandsdaten bekommen ihre Sorten aus Antriebsart und Einheit (wie bisher gerechnet).
--
-- Verträglich mit dem alten API-Code: Der kennt die neuen Spalten nicht. Trigger setzen sie bei neuen Fahrzeugen
-- und Einträgen aus Antriebsart und Einheit, bis die neue API läuft (und danach für Clients ohne Sorte).
-- Die Zuordnungen stehen gleich in backend/src/services/fuels.js (ein Test vergleicht beide).
-- Mehrfach ausführbar.
BEGIN;

-- Antriebsart → Sorten des Fahrzeugs (die erste ist der Standard)
CREATE OR REPLACE FUNCTION fuelstat_standard_sorten(fuel_type text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(fuel_type, ''))
    WHEN 'e5' THEN ARRAY['super_e5']
    WHEN 'e10' THEN ARRAY['super_e10']
    WHEN 'diesel' THEN ARRAY['diesel']
    WHEN 'lpg' THEN ARRAY['lpg']
    WHEN 'cng' THEN ARRAY['cng']
    WHEN 'electric' THEN ARRAY['electricity']
    WHEN 'hybrid' THEN ARRAY['super_e5']
    WHEN 'phev' THEN ARRAY['super_e5', 'electricity']
    WHEN 'hydrogen' THEN ARRAY['hydrogen']
    WHEN 'other' THEN ARRAY['other']
    ELSE ARRAY['super_e5']
  END
$$;

-- Antriebsart + Einheit → Sorte eines Eintrags (wie bisher gerechnet)
CREATE OR REPLACE FUNCTION fuelstat_sorte_aus_altdaten(fuel_type text, unit text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(coalesce(unit, 'l')) = 'kwh' THEN 'electricity'
    WHEN lower(coalesce(unit, 'l')) = 'kg' THEN CASE WHEN lower(coalesce(fuel_type, '')) = 'hydrogen' THEN 'hydrogen' ELSE 'cng' END
    WHEN lower(coalesce(fuel_type, '')) = 'diesel' THEN 'diesel'
    WHEN lower(coalesce(fuel_type, '')) = 'e10' THEN 'super_e10'
    WHEN lower(coalesce(fuel_type, '')) = 'lpg' THEN 'lpg'
    WHEN lower(coalesce(fuel_type, '')) = 'other' THEN 'other'
    ELSE 'super_e5'
  END
$$;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuels text[] NOT NULL DEFAULT '{}';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS default_fuel text NULL;
ALTER TABLE fillups ADD COLUMN IF NOT EXISTS fuel text NULL;

UPDATE vehicles SET fuels = fuelstat_standard_sorten(fuel_type) WHERE cardinality(fuels) = 0;
UPDATE vehicles SET default_fuel = fuels[1] WHERE default_fuel IS NULL OR NOT (default_fuel = ANY (fuels));

UPDATE fillups f SET fuel = fuelstat_sorte_aus_altdaten(v.fuel_type, f.unit)
  FROM vehicles v WHERE v.id = f.vehicle_id AND f.fuel IS NULL;

-- Neue Fahrzeuge ohne Sorten (alter API-Code): Sorten aus der Antriebsart
CREATE OR REPLACE FUNCTION fuelstat_fahrzeug_sorten() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fuels IS NULL OR cardinality(NEW.fuels) = 0 THEN
    NEW.fuels := fuelstat_standard_sorten(NEW.fuel_type);
  END IF;
  IF NEW.default_fuel IS NULL OR NOT (NEW.default_fuel = ANY (NEW.fuels)) THEN
    NEW.default_fuel := NEW.fuels[1];
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_vehicles_fuels ON vehicles;
CREATE TRIGGER trg_vehicles_fuels BEFORE INSERT OR UPDATE OF fuels, default_fuel ON vehicles
  FOR EACH ROW EXECUTE FUNCTION fuelstat_fahrzeug_sorten();

-- Einträge ohne Sorte (alter API-Code, Clients ohne Sorte): aus Antriebsart und Einheit. Ändert jemand nur die
-- Einheit (alter API-Code), passt die Sorte sich an.
CREATE OR REPLACE FUNCTION fuelstat_eintrag_sorte() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fuel IS NULL OR (TG_OP = 'UPDATE' AND NEW.unit IS DISTINCT FROM OLD.unit AND NEW.fuel IS NOT DISTINCT FROM OLD.fuel) THEN
    NEW.fuel := fuelstat_sorte_aus_altdaten((SELECT fuel_type FROM vehicles WHERE id = NEW.vehicle_id), NEW.unit);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_fillups_fuel ON fillups;
CREATE TRIGGER trg_fillups_fuel BEFORE INSERT OR UPDATE ON fillups
  FOR EACH ROW EXECUTE FUNCTION fuelstat_eintrag_sorte();

ALTER TABLE fillups ALTER COLUMN fuel SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fillups_vehicle_fuel ON fillups(vehicle_id, fuel);

COMMIT;
