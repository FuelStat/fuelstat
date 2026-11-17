-- backend/database/postgres_030_image_urls.sql
-- Bildadressen (#196): Fahrzeug- und Profilbilder dürfen nur noch auf eigene Upload-Dateien zeigen. Diese Migration leert
-- Adressen auf fremde Server und Pseudo-Adressen (http:, https:, javascript:, data:, "//host/…"). Relative Pfade auf
-- Upload-Dateien bleiben unberührt, egal wie MEDIA_BASE_URL heißt. Mehrfach ausführbar, mit dem alten API-Code verträglich.
BEGIN;

UPDATE vehicles SET image_url = NULL
WHERE image_url IS NOT NULL AND (image_url ~ '^\s*[A-Za-z][A-Za-z0-9+.-]*:' OR image_url ~ '^\s*//');

UPDATE users SET profile_image_url = NULL
WHERE profile_image_url IS NOT NULL AND (profile_image_url ~ '^\s*[A-Za-z][A-Za-z0-9+.-]*:' OR profile_image_url ~ '^\s*//');

COMMIT;
