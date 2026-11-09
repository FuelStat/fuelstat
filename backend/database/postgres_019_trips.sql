-- backend/database/postgres_019_trips.sql
-- Fahrtenbuch (#52): eigene Tabelle für Fahrten mit Tachostand Start/Ende, Orten, Zweck und Fahrer.
-- Bisherige Fahrten (Ausgaben der Kategorie "Fahrt", Strecke und km stehen in der Beschreibung, #43) werden
-- übernommen. Die alten Zeilen bleiben stehen (verträglich mit dem alten API-Code); die neue API blendet
-- übernommene Fahrten in der Ausgabenliste aus (legacy_expense_id). Mehrfach ausführbar.
BEGIN;

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

-- Alte Fahrten übernehmen: "Bolbingen → Aalen – Arbeit (42 km)"; Zweck bleibt als Notiz, Kategorie "privat"
INSERT INTO trips (vehicle_id, user_id, started_at, odometer_start, odometer_end, distance_km,
                   start_place, end_place, purpose, note, legacy_expense_id, created_at)
SELECT e.vehicle_id, e.user_id, e.occurred_at,
       CASE WHEN km IS NOT NULL AND km <= e.odometer_km THEN e.odometer_km - round(km)::int END,
       e.odometer_km,
       COALESCE(km, 0),
       -- Von/Nach nur, wenn die Beschreibung dem Muster "Von → Nach" folgt; sonst ist der Text eine Notiz
       CASE WHEN strecke LIKE '% → %' THEN NULLIF(trim(split_part(strecke, ' → ', 1)), '') END,
       CASE WHEN strecke LIKE '% → %' THEN NULLIF(trim(split_part(strecke, ' → ', 2)), '') END,
       'private',
       CASE WHEN strecke LIKE '% → %' THEN NULLIF(trim(zweck), '')
            ELSE NULLIF(NULLIF(trim(concat_ws(' – ', NULLIF(strecke, ''), zweck)), ''), 'Fahrt') END,
       e.id, e.created_at
FROM (
  SELECT e.*,
         NULLIF(replace(replace(substring(e.description FROM '\(([\d.,]+) km\)$'), '.', ''), ',', '.'), '')::numeric AS km,
         split_part(regexp_replace(COALESCE(e.description, ''), '\s*\([\d.,]+ km\)$', ''), ' – ', 1) AS strecke,
         CASE WHEN regexp_replace(COALESCE(e.description, ''), '\s*\([\d.,]+ km\)$', '') LIKE '% – %'
              THEN substring(regexp_replace(e.description, '\s*\([\d.,]+ km\)$', '') FROM position(' – ' IN regexp_replace(e.description, '\s*\([\d.,]+ km\)$', '')) + 3)
         END AS zweck
  FROM expenses e
  WHERE e.category = 'Fahrt' AND e.odometer_km IS NOT NULL
) e
WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.legacy_expense_id = e.id);

COMMIT;
