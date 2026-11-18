# Update-Hinweise für Betreiber

Was beim Ausrollen einer Version zu tun ist, soweit es über `sudo infra/ausrollen.sh X.Y.Z` hinausgeht: einmalige Befehle, Einstellungen in `infra/.env`, nginx. Das ist Sache der Betreiber und steht deshalb **nicht** in den Release-Notes (`CHANGELOG.md`), die auch Nutzer lesen.

- Das Skript `infra/ausrollen.sh` zeigt vor dem Ausrollen den Abschnitt der Version (bzw. `[Unreleased]` bei `main`) aus dieser Datei, spielt **neue Migrationen selbst ein** (vor dem API-Neustart) und weist auf geänderte Beispiel-Konfiguration hin. Migrationen und ihr manuelles Einspielen stehen in [`betrieb.md`](betrieb.md#datenbank-migrationen); hier gehören sie nur hin, wenn zusätzlich etwas zu beachten ist.
- Neue Einträge in einem PR kommen unter `## [Unreleased]`. `node backend/scripts/neue-version.js X.Y.Z` schließt den Abschnitt beim Release ab (wie im CHANGELOG).
- Vor jedem Ausrollen: sichern (`sudo systemctl start fuelstat-backup.service`).

## [Unreleased]

- **Textgrenzen (#197):** Die API nimmt Freitexte nur noch bis zu einer Länge an (Fahrzeugname, Marke, Modell, Benutzername 100; Tankstelle/Ort/Anbieter 200; Beschreibung 2000). Vorhandene längere Werte bleiben lesbar, lassen sich aber erst nach dem Kürzen wieder speichern. Ob es solche Werte gibt (erwartet: überall 0):

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT count(*) FROM vehicles WHERE length(name) > 100 OR length(brand) > 100 OR length(model) > 100) AS fahrzeuge, (SELECT count(*) FROM users WHERE length(username) > 100) AS konten, (SELECT count(*) FROM fillups WHERE length(station) > 200) AS tanken, (SELECT count(*) FROM expenses WHERE length(vendor) > 200 OR length(description) > 2000) AS ausgaben"'
  ```

- **Eigene Fehlerseiten (#211), nginx anpassen:** Damit statt „404 Not Found – nginx“ die Seite im Aussehen der App
  erscheint, im `server`-Block für 443 (vor `location / {`) diese Zeilen ergänzen, wie in
  `infra/nginx/fuelstat.conf.example`:

  ```nginx
  error_page 403 /pages/fehler.php?code=403;
  error_page 404 /pages/fehler.php?code=404;
  error_page 500 502 503 504 /fehler.html;
  location = /fehler.html { internal; }
  ```

  Danach prüfen und neu laden: `sudo nginx -t && sudo systemctl reload nginx`. Test: `https://<domain>/gibtsnicht.php`
  zeigt „Seite nicht gefunden“ mit Status 404 (`curl -sI https://<domain>/gibtsnicht.php | head -1`). Fehler, die die API
  unter `/api/v1/` meldet, bleiben JSON.

- Migration `030_image_urls` (spielt `infra/ausrollen.sh` vor dem Neustart der API ein) leert Fahrzeug- und Profilbilder, die auf fremde Server oder `javascript:`/`data:` zeigen (#196). Wer vorher sehen will, ob es solche Einträge gibt (erwartet: 0):

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT count(*) FROM vehicles WHERE image_url ~ '"'"'^\s*([A-Za-z][A-Za-z0-9+.-]*:|//)'"'"') AS fahrzeuge, (SELECT count(*) FROM users WHERE profile_image_url ~ '"'"'^\s*([A-Za-z][A-Za-z0-9+.-]*:|//)'"'"') AS profile"'
  ```

## [0.13.1] - 2026-11-17

- Nichts Besonderes: sichern (`sudo systemctl start fuelstat-backup.service`), dann `sudo infra/ausrollen.sh 0.13.1`. Das Skript spielt die neue Migration `029_electricity_co2` vor dem Neustart der API ein (eine neue, leere Spalte; mit dem alten API-Code verträglich). Die Mindest-App-Version bleibt bei iOS 0.2.2.

## [0.13.0] - 2026-11-15

- **Erst ausrollen, wenn die iOS-App 0.2.2 auf allen genutzten Geräten installiert ist:** Die Mindestversion für iOS steigt von 0.2.0 auf 0.2.2 (`backend/src/lib/appVersions.js`); Apps darunter bekommen danach nur noch „Update nötig“ (426). Prüfen nach dem Ausrollen: `curl -s https://<domain>/api/v1/health` zeigt `"minimum_version":"0.2.2"` bei `ios`.

- Sichern (`sudo systemctl start fuelstat-backup.service`), dann ausrollen.

- Einmalig Orte „null“ aufräumen, die das Bearbeiten ohne Ort früher geschrieben hat:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE fillups SET station = NULL WHERE station = '"'"'null'"'"'"'
  ```

- Migration `024_passkeys` einspielen, **bevor** die API neu startet (macht `infra/ausrollen.sh` selbst; mit dem alten API-Code verträglich). Von Hand:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_024_passkeys.sql
  ```

- Migration `025_charging` einspielen, **bevor** die API neu startet (macht `infra/ausrollen.sh` selbst; mit dem alten API-Code verträglich, bestehende Einträge bleiben unverändert). Von Hand:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_025_charging.sql
  ```

- Migration `026_parts` einspielen, **bevor** die API neu startet (macht `infra/ausrollen.sh` selbst; mit dem alten API-Code verträglich, bestehende Einträge bleiben unverändert). Von Hand:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_026_parts.sql
  ```

- Migration `027_vehicle_status` einspielen, **bevor** die API neu startet (macht `infra/ausrollen.sh` selbst; mit dem alten API-Code verträglich, alle Fahrzeuge bleiben aktiv). Von Hand:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_027_vehicle_status.sql
  ```

- Migration `028_residual_value` einspielen, **bevor** die API neu startet (macht `infra/ausrollen.sh` selbst; mit dem alten API-Code verträglich). Von Hand:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_028_residual_value.sql
  ```

- Die neuen Grenzen für aktive und archivierte Fahrzeuge (Free 1+1, Plus 5+5, Flotte 25+25) gelten erst mit `PLAN_LIMITS_ENABLED=true`; bis dahin ändert sich beim Ausrollen nichts.

- Passkeys brauchen `APP_URL` mit `https://` in `infra/.env` (oder `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGINS`, siehe `infra/.env.example`). Prüfen: `curl -s https://<domain>/api/v1/health` zeigt `"passkeys_enabled":true`.

## [0.12.2] - 2026-11-13

- Erst ausrollen, wenn die iOS-App 0.2.0 auf allen genutzten Geräten installiert ist: App-Versionen darunter erhalten danach nur noch „Update nötig“.

## [0.12.1] - 2026-11-13

- Migration `022_device_sessions` einspielen, **bevor** die API neu startet (macht `infra/ausrollen.sh` selbst; mit dem alten API-Code verträglich). Von Hand:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_022_device_sessions.sql
  ```

- Migration `023_push` einspielen, **bevor** die API neu startet (macht `infra/ausrollen.sh` selbst; mit dem alten API-Code verträglich). „Kilometerstand nachtragen“ per E-Mail übernimmt die bisherige Einstellung der Termin-Erinnerungen. Von Hand:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_023_push.sql
  ```

- **Für Push** (optional) einmal VAPID-Schlüssel erzeugen, die drei Zeilen in `infra/.env` eintragen (`VAPID_SUBJECT` mit eigener Kontaktadresse) und die API neu starten. Ohne Schlüssel bleibt Push aus:

  ```bash
  cd infra
  sudo docker compose exec api node scripts/vapid-schluessel.js
  sudo docker compose up -d
  ```

## [0.12.0] - 2026-11-12

- **iOS-App mitaktualisieren** (#160): Die Listen der API haben ein neues Format; ältere Builds der App zeigen danach keine Fahrzeuge und Einträge mehr. Die App aus `main` von FuelStat/fuelstat-ios neu auf das Gerät spielen.
- **Nur von 0.11.0 aus:** Die Migrationen bis 020 sind entfernt. Ältere Installationen spielen zuerst 0.11.0 ein.
- Vor dem Update prüfen, dass alle 2FA-Schlüssel verschlüsselt sind (die Umwandlung beim Start entfällt); das Ergebnis muss `0` sein:

  ```bash
  cd infra
  echo "SELECT COUNT(*) FROM users WHERE mfa_secret IS NOT NULL AND mfa_secret NOT LIKE 'v1:%';" | sudo docker compose exec -T db sh -c 'psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  ```

- Migration `021_fuels` einspielen, **bevor** die API neu startet (macht `infra/ausrollen.sh` selbst). Sie ist mit dem alten API-Code verträglich: Trigger setzen die Sorte für Einträge, die der alte Code bis zum Neustart noch anlegt. Von Hand:

  ```bash
  cd infra
  sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_021_fuels.sql
  ```

## [0.11.0] - 2026-11-09

- **Ab dieser Version mit dem Skript ausrollen** (#134): `sudo infra/ausrollen.sh 0.11.0` im Projektordner. Es spielt die Migrationen 017, 018, 019 und 020 selbst vor dem Neustart der API ein. Beim ersten Mal steht das Skript erst nach `git pull` bzw. `git fetch --tags && git checkout v0.11.0` zur Verfügung. Von Hand: Migrationen einspielen, **bevor** die API neu startet:
  `cd infra && for m in 017_email_verification 018_vehicle_sharing 019_trips 020_password_resets; do sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_$m.sql; done`
- **Image öffentlich stellen:** Nach dem ersten Release unter GitHub → FuelStat → Packages → `fuelstat-api` → Package settings die Sichtbarkeit auf „Public“ stellen (sonst `sudo docker login ghcr.io` auf dem Server).
- **Nutzungsbedingungen einschalten:** in `infra/.env` `TERMS_VERSION=2026-11-09` setzen (Text: `includes/nutzungsbedingungen_text.php`, Betreiberangaben aus `includes/betreiber.php`). Ohne den Eintrag gibt es keine Zustimmung.
- **Links in Mails:** Bestätigungs- und Einladungsmails verlinken auf `APP_URL` (in `infra/.env`, z. B. `APP_URL=https://tanken.1emc.de`); ohne `APP_URL` enthalten sie nur den Code bzw. den Hinweis auf die Anmeldung. E-Mail-Bestätigung abschalten: `EMAIL_VERIFICATION=false`.
- Im Repository einmal das Label `kein changelog` anlegen (für PRs ohne sichtbare Änderung).

## [0.10.0] - 2026-11-08

- **Vor dem `git pull`** die API-Keys umziehen, sonst bricht der Pull wegen `api/ocm.key` ab: Tankerkönig-Key (aus `api/key.key`) als `TANKERKOENIG_API_KEY` und Open-Charge-Map-Key (aus `api/ocm.key`) als `OCM_API_KEY` in `infra/.env` eintragen; danach `git update-index --no-skip-worktree api/ocm.key && git checkout -- api/ocm.key`. Nach dem Ausrollen `api/key.key` löschen.
- Migration einspielen, **bevor** die API neu startet: `cd infra && sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_015_plan_changes.sql`
- Migration einspielen, **bevor** die API neu startet: `cd infra && sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_016_mfa_last_counter.sql`
- Läuft die Seite hinter Cloudflare: in nginx `real_ip` für die Cloudflare-Adressen einrichten (siehe `docs/installation.md`, „Hinter Cloudflare“), damit Login-Sperren je IP nicht viele Nutzer gemeinsam treffen. Ohne Cloudflare ist nichts zu tun.

## [0.9.1] - 2026-11-06

- Für die Tankstellensuche in den Apps den Tankerkönig-Key als `TANKERKOENIG_API_KEY` in `infra/.env` eintragen (derselbe wie in `api/key.key`) und die API neu starten.
- Auf bestehenden Installationen die Git-Adresse umstellen: `git remote set-url origin https://github.com/FuelStat/fuelstat.git` (die alte Adresse leitet GitHub vorerst weiter).

## [0.9.0] - 2026-11-06

- Datenbank auf Stand Migration 014 bringen (`docs/betrieb.md`)
- Einmalig vorhandene Bilder umstellen: `sudo docker compose exec api node scripts/bilder-optimieren.js`
- nginx: `/uploads/` sperren, `FUELSTAT_API_BASE_URL` direkt auf `127.0.0.1:3000` setzen (`docs/installation.md`)
