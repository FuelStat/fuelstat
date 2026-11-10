# Betrieb und Wartung

Updates, Datenbank-Migrationen, Datensicherung und Sicherheitsdetails einer laufenden Installation. Ersteinrichtung: [Installation](installation.md).

## Versionen und Releases

Fuelstat folgt [Semantic Versioning](https://semver.org/lang/de/) (`MAJOR.MINOR.PATCH`); während der Beta bleibt die Hauptversion 0. Die **einzige Quelle** der Versionsnummer ist die Datei `VERSION`. Das Frontend zeigt sie im Footer und unter „Neuigkeiten“, die API unter `GET /api/v1/health` (`version`, aus `backend/package.json`). Die CI prüft, dass alle Stellen übereinstimmen (`tests/VersionTest.php`).

- **Laufend:** Jeder PR mit sichtbarer Änderung trägt sie in `CHANGELOG.md` unter `## [Unreleased]` ein.
- **Release vorbereiten** (setzt `VERSION`, `backend/package.json` und schließt `[Unreleased]` als neue Version ab):

  ```bash
  node backend/scripts/neue-version.js 0.10.0
  ```

  Dann committen und als PR mergen.
- **Veröffentlichen** auf dem gemergten `main`:

  ```bash
  git tag -a v0.10.0 -m "Fuelstat 0.10.0"
  git push origin v0.10.0
  ```

  Der Workflow `.github/workflows/release.yml` prüft Tag, `VERSION` und `CHANGELOG.md`, legt das GitHub-Release mit dem Text der Version an (0.x und Vorabversionen als „Pre-release“) und veröffentlicht das API-Image `ghcr.io/fuelstat/fuelstat-api:X.Y.Z` (#134).
- **Changelog-Prüfung:** Die CI (`.github/workflows/changelog.yml`) verlangt in jedem PR einen Eintrag unter `## [Unreleased]`. Für PRs ohne sichtbare Änderung das Label `kein changelog` setzen.
- **Ausrollen:** wie unter „Aktualisieren“. Unter „Neuigkeiten“ sehen Admins eine Warnung, wenn API und Frontend unterschiedliche Versionen melden (API-Image nicht neu gebaut).
- **Welche Version?** PATCH für Fehlerbehebungen, MINOR für neue Funktionen, MAJOR für Brüche (z. B. API-Änderungen, die Apps anpassen müssen). Vorabversionen: `1.0.0-rc.1`.

## Aktualisieren

Live läuft immer genau eine **veröffentlichte Version** (Tag `vX.Y.Z`) mit dem fertigen API-Image dieser Version aus der GitHub Container Registry (#134). Reihenfolge einhalten: **Migrationen vor dem Neustart der API**, sonst startet neuer API-Code gegen ein altes Schema.

### Mit dem Skript (empfohlen)

1. **Sichern** (empfohlen, vor allem wenn Migrationen anstehen), falls die Datensicherung eingerichtet ist:

   ```bash
   sudo systemctl start fuelstat-backup.service
   ```

2. **Ausrollen**, im Projektordner:

   ```bash
   sudo infra/ausrollen.sh 0.11.0
   ```

   Das Skript
   - holt die Tags und zeigt die „Hinweise zum Update“ der Version, die neuen Migrationen und geänderte Beispiel-Konfigurationen (`infra/.env.example`, nginx, Backup) an und fragt, ob es weitergehen soll;
   - lädt das API-Image der Version (die alte API läuft dabei weiter);
   - stellt den Code auf das Tag um (Git läuft als Besitzer des Projektordners);
   - spielt die neuen Migrationen der Reihe nach ein – **vor** dem Neustart der API;
   - fragt bei geänderter Beispiel-Konfiguration, ob `.env` bzw. nginx nachgezogen sind (sonst Abbruch an dieser Stelle; erneut aufrufen, sobald es erledigt ist);
   - setzt `FUELSTAT_VERSION` in `infra/.env`, startet die API mit dem neuen Image, lädt PHP-FPM neu und wartet, bis `/api/v1/health` die neue Version meldet.

3. **Kontrollieren:** unter „Neuigkeiten“ erscheint für Admins keine Warnung zu unterschiedlichen Versionen.

**Zurückrollen** auf die vorige Version: `sudo infra/ausrollen.sh 0.10.0`. Migrationen bleiben eingespielt; sie sind mit dem alten API-Code verträglich.

Der Code steht danach auf dem Tag (detached HEAD). Ein bloßes `git pull` geht dort nicht und würde auch nur das PHP-Frontend aktualisieren, nicht API und Datenbank.

**Zwischenstand ausrollen** (neuester `main`, noch nicht veröffentlicht – etwa um Ergebnisse vor dem nächsten Release auf dem eigenen Server zu sehen):

```bash
sudo infra/ausrollen.sh main
```

Gleiche Reihenfolge wie oben: zeigt die neuen Commits, die Hinweise unter `[Unreleased]`, neue Migrationen und geänderte Beispiel-Konfiguration, stellt den Code auf `main`, **baut** das API-Image aus dem Code (`FUELSTAT_VERSION=main`), spielt die Migrationen vor dem Neustart ein, startet die API und lädt PHP-FPM neu. Nachgefragt wird nur, wenn Migrationen oder Konfigurationsänderungen anstehen; ist `main` schon ausgerollt, tut das Skript nichts. Zurück auf ein Release: `sudo infra/ausrollen.sh X.Y.Z`. Ein Zwischenstand ist nicht durch ein Release geprüft – Datensicherung vorher wie oben.

**Das Image ist öffentlich?** Beim ersten Release legt GitHub das Paket `fuelstat-api` an. Unter GitHub → Organisation → Packages → `fuelstat-api` → Package settings die Sichtbarkeit auf „Public“ stellen. Bleibt es privat, braucht der Server einmalig `sudo docker login ghcr.io` mit einem Token (Recht `read:packages`).

### Von Hand oder ohne Registry

Wer einen eigenen Stand betreibt (Fork, Entwicklung) oder kein Image laden kann, baut die API wie bisher selbst. `FUELSTAT_VERSION` in `infra/.env` dann leer lassen bzw. entfernen.

1. **Sichern** (siehe oben).
2. **Code holen:** `git fetch --tags && git checkout vX.Y.Z` (oder `git pull` für den neuesten Stand von `main`).
3. **Prüfen, was zu tun ist:** „Hinweise zum Update“ der neuen Version(en) in `CHANGELOG.md` lesen und nachsehen, ob Migrationen, Beispiel-Konfigurationen oder nginx-Beispiele dazugekommen sind:

   ```bash
   git diff --stat ORIG_HEAD -- backend/database infra/.env.example infra/nginx-sicherheit.conf.example infra/nginx/fuelstat.conf.example infra/backup/backup.env.example
   ```

4. **Neue Migrationen einspielen**, der Reihe nach (siehe [Datenbank-Migrationen](#datenbank-migrationen)); die Datenbank läuft dabei weiter, die API noch mit dem alten Code:

   ```bash
   cd infra
   sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_0NN_name.sql
   ```

5. **Konfiguration nachziehen**, falls die Hinweise es verlangen: neue Variablen aus `infra/.env.example` in `infra/.env` übernehmen, nginx-Änderungen einspielen (`sudo nginx -t && sudo systemctl reload nginx`).

6. **API neu bauen und starten, Frontend neu laden:**

   ```bash
   cd infra && sudo docker compose up -d --build   # API: neues Image mit aktuellem Code und aktuellen Paketen
   sudo systemctl reload php8.4-fpm                 # Frontend
   ```

7. **Kontrollieren:** `curl -s http://127.0.0.1:3000/api/v1/health` meldet die neue Version; unter „Neuigkeiten“ erscheint für Admins keine Warnung zu unterschiedlichen Versionen.

Hinweis: Das PHP-Frontend liegt im Repository und nutzt den neuen Code schon ab Schritt 2. Zwischen Schritt 2 und 6 also zügig arbeiten oder bei größeren Updates kurz in Kauf nehmen, dass Frontend und API nicht zusammenpassen.

**Einmalig beim Umstieg auf den `prod`-Container (November 2026):** Bis dahin lief die API im Entwicklungs-Container mit eingebundenem Code und eigenem `node_modules`-Volume. Dadurch kamen Paket-Updates nicht an. Umstellen:

```bash
cd infra
sudo chown -R 1000:1000 ../uploads          # Uploads gehören jetzt dem Benutzer "node"
sudo docker compose up -d --build api
sudo docker volume rm infra_api_node_modules # altes Paket-Volume wird nicht mehr gebraucht
```

**Einmalig nach dem Update auf geschützte Bilder (#103):** vorhandene Bilder verkleinern, als WebP ohne Metadaten speichern und `/uploads/` in nginx sperren (`infra/nginx-sicherheit.conf.example`):

```bash
cd infra
sudo docker compose exec api node scripts/bilder-optimieren.js --probe   # zeigt nur an
sudo docker compose exec api node scripts/bilder-optimieren.js           # umstellen
```

## Datenbank-Migrationen

Neue Installationen brauchen keine Migrationen: `postgres_init.sql` enthält bereits alles bis einschließlich 020. Bestehende Installationen spielen alle noch fehlenden Migrationen der Reihe nach ein:

| Datei | Inhalt |
|---|---|
| `postgres_002` bis `postgres_005` | Ausgaben, Einheiten, Token-Sperrlisten, Fahrzeug- und Profildetails, Bilder (nur für Installationen vor Dezember 2025) |
| `postgres_006_fix_fillup_units.sql` | Einheit bestehender Tank- und Ladevorgänge aus der Antriebsart korrigieren |
| `postgres_007_mail_settings.sql` | SMTP-Einstellungen je Benutzer und Versandprotokoll |
| `postgres_008_beta_feedback.sql` | Beta-Tester-Kennzeichen und Feedback |
| `postgres_009_user_activity.sql` | Letzter Login und zuletzt aktiv |
| `postgres_010_plugin_hybrid.sql` | Antriebsart Plug-in-Hybrid (`phev`) und Akkugröße |
| `postgres_011_plans.sql` | Tarif je Konto (`plan`, `plan_until`), siehe `PLAN_LIMITS_ENABLED` |
| `postgres_012_missing_odometer.sql` | Tank-/Ladevorgänge ohne Tachostand, Markierung „geschätzt“, Erinnerung „Kilometerstand nachtragen“ |
| `postgres_013_vehicle_details.sql` | Fahrzeugangaben: Kennzeichen, FIN, Erstzulassung, Kauf/Verkauf, Intervalle, Versicherung, Steuer, Reifen |
| `postgres_014_expense_categories.sql` | Eigene Kategorien für Ausgaben (Plus) |
| `postgres_015_plan_changes.sql` | Protokoll der Tarifänderungen (#102) |
| `postgres_016_mfa_last_counter.sql` | Zuletzt akzeptierter 2FA-Code je Konto, damit jeder Code nur einmal gilt |
| `postgres_017_email_verification.sql` | E-Mail-Bestätigung (bestehende Konten gelten als bestätigt), ausstehende neue Adresse, Zustimmung zu den Nutzungsbedingungen (#135) |
| `postgres_018_vehicle_sharing.sql` | Fahrzeuge teilen: Mitglieder und Einladungen (#53) |
| `postgres_019_trips.sql` | Fahrtenbuch; übernimmt bisherige „Fahrt“-Einträge (#52) |
| `postgres_020_password_resets.sql` | Passwort vergessen: Links zum Zurücksetzen (#141) |

Alle Migrationen laufen in einer Transaktion und lassen sich gefahrlos ein zweites Mal ausführen. Mit `infra/ausrollen.sh` passiert das automatisch; von Hand wie unter [Aktualisieren](#von-hand-oder-ohne-registry), Schritt 4, z. B. `< ../backend/database/postgres_014_expense_categories.sql`.

## Tarife verwalten

Den Tarif eines Kontos ändert nur der Betreiber (#102): in der Benutzerverwaltung (Admins aus `ADMIN_USER_IDS`) oder direkt auf dem Server, auch ohne Web-Oberfläche:

```bash
cd infra
sudo docker compose exec api node scripts/tarif-setzen.js nutzer@example.org                                  # Tarif und Verlauf anzeigen
sudo docker compose exec api node scripts/tarif-setzen.js nutzer@example.org plus --bis 2027-06-30 --notiz "Tester"
sudo docker compose exec api node scripts/tarif-setzen.js nutzer@example.org free                             # zurücksetzen
```

Statt der E-Mail geht auch die Konto-ID. Jede Änderung wird mit Quelle, Zeitpunkt und Notiz in `plan_changes` protokolliert; der Verlauf steht auch unter `GET /api/v1/auth/users/:userId/plan-history`. Abgewiesene Zugriffe auf Admin-Funktionen erscheinen im API-Log (`sudo docker compose logs api | grep abgewiesen`).

## Datensicherung

`infra/backup/` enthält Sicherung und Wiederherstellung (Datenbank per `pg_dump` und hochgeladene Bilder):

1. `cp infra/backup/backup.env.example infra/backup/backup.env` und Pfade eintragen
2. Verschlüsselung (empfohlen): `age-keygen -o fuelstat-backup-key.txt`. Den **privaten** Schlüssel offline aufbewahren (z. B. im Passwortmanager), auf dem Server nur den öffentlichen Schlüssel als `BACKUP_AGE_RECIPIENT` eintragen.
3. Optional externe Kopie per `rsync`, z. B. auf eine Hetzner Storage Box (`BACKUP_REMOTE`)
4. Täglich automatisch:

   ```bash
   sudo cp infra/backup/fuelstat-backup.service infra/backup/fuelstat-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now fuelstat-backup.timer
   ```

   Aufbewahrung: 14 tägliche und 12 wöchentliche Sicherungen (einstellbar). Danach sind gelöschte Daten auch aus den Sicherungen verschwunden; die Datenschutzerklärung nennt dafür 90 Tage (`backup_tage` in `includes/betreiber.php`).
5. **Wiederherstellung regelmäßig testen** (spielt in eine eigene Testdatenbank ein und zählt Zeilen, ohne die echten Daten anzufassen):

   ```bash
   sudo AGE_IDENTITY=/pfad/zu/fuelstat-backup-key.txt infra/backup/fuelstat-restore.sh --test /var/backups/fuelstat/daily/fuelstat-db-….dump.age
   ```

   Im Ernstfall `--echt` statt `--test` (überschreibt die Datenbank nach Rückfrage, optional mit dem Uploads-Archiv als drittem Argument).

## Sicherheit

- Sicherheitslücken bitte vertraulich melden, siehe [`SECURITY.md`](../SECURITY.md). Die Kontaktdaten stehen auch in `/.well-known/security.txt` (RFC 9116); deren `Expires`-Datum spätestens nach einem Jahr verlängern.
- Uploads werden anhand ihres Inhalts geprüft (nur JPEG, PNG, GIF, WebP) und unter einem zufälligen Namen mit passender Endung gespeichert.
- Rate Limiting in der API: angemeldet 600 Anfragen pro Minute je Konto, ohne Anmeldung 300 je IP, Uploads 30 und Importe 60 je 10 Minuten (Antwort `429 too_many_requests`). Die API vertraut `X-Forwarded-For` nur von lokalen bzw. privaten Adressen (nginx, Docker-Netz).
- Code-Scanning mit CodeQL über `.github/workflows/codeql.yml` (erweiterte Einrichtung, ohne `vendor/`); in den Repository-Einstellungen muss dafür die Standard-Einrichtung von CodeQL aus sein.
- Login, 2FA-Code und Passwortänderung werden nach 10 bzw. 5 Fehlversuchen für 15 Minuten gesperrt (je E-Mail-Adresse bzw. Benutzer, im Speicher der API).
- Alle Formulare sind per CSRF-Token geschützt; die Session-Cookies sind `HttpOnly` und `SameSite=Lax`.
- Öffentliche Registrierung abschalten: `REGISTRATION_ENABLED=false` in der Backend-`.env` (Admins legen Konten dann z. B. über die Datenbank an).
