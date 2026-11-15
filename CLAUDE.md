# Fuelstat – Hinweise für Claude und andere Agents

Web-App (PHP-Frontend), API (Node.js/Express) und Datenbank (PostgreSQL) von Fuelstat.
Die Planung (Milestones) von Web-App und API liegt in diesem Repository. Die iOS-App
([FuelStat/fuelstat-ios](https://github.com/FuelStat/fuelstat-ios)) hat eine eigene Versionsnummer
und plant ihre Versionen mit eigenen Milestones dort. Was die App von der API braucht, steht hier in
den Milestones mit Datum, und zwar vor der App-Version, die es braucht (Zeitplan in #116). Das
Sammel-Issue #116 (Milestone „iOS-App“) verbindet beides, die App-Issues hängen dort als Sub-Issues.
Ändern sich Termine auf einer Seite, den Abgleich in #116 nachziehen.

## Release-Prozess

Ausführlich in [`docs/betrieb.md`](docs/betrieb.md#versionen-und-releases). Kurzfassung, damit
nichts vergessen wird:

**Versionsnummer:** Semantic Versioning, während der Beta `0.x.y`. Einzige Quelle ist die Datei
`VERSION`. PATCH für Fehlerbehebungen, MINOR für neue Funktionen, MAJOR für Brüche (z. B.
API-Änderungen, die Apps anpassen müssen). Die geplanten Versionen sind die Milestones.

1. **Laufend:** Jeder PR mit sichtbarer Änderung trägt sie in `CHANGELOG.md` unter
   `## [Unreleased]` ein (Kategorien: Neu, Verbessert, Behoben, Sicherheit, Abgekündigt, Technik). Die Release-Notes
   lesen auch Nutzer: **keine SQL-Befehle, Migrationen oder Server-Einstellungen** darin. Was Betreiber beim
   Ausrollen tun müssen, steht in `docs/update-hinweise.md` unter `## [Unreleased]`.
2. **Mindest-App-Version prüfen – bei jedem Release, bevor der Release-PR entsteht.** Die Werte stehen in
   `backend/src/lib/appVersions.js` (`minimum`/`recommended` je Plattform, `GET /health` meldet sie, ältere Apps
   bekommen 426). Die Frage lautet: *Kommt die zuletzt veröffentlichte App-Version (neuester Tag in
   [FuelStat/fuelstat-ios](https://github.com/FuelStat/fuelstat-ios), `git ls-remote --tags`) mit allem zurecht, was
   dieses Release an der API ändert?* Dazu den CHANGELOG-Abschnitt (vor allem „Technik“) und die gemergten PRs seit dem
   letzten Tag durchgehen. Eine Anhebung ist nötig bei:
   - entfernten oder umbenannten Feldern und Endpunkten, geänderten Typen, geschlossenen Enums, die neue Werte
     bekommen, neuen Fehlercodes, die die App nicht kennt (z. B. `409 vehicle_archived`), und Verhalten, das sich für
     die App ändert (schreibgeschützte Fahrzeuge, geänderte Reihenfolge, neue Pflichtfelder);
   - `minimum` anheben, wenn die alte App damit nicht mehr arbeiten kann oder falsche Dinge tut; `recommended`, wenn
     sie läuft, aber Neues nicht nutzt.
   Die Zielversion muss in fuelstat-ios **schon getaggt** sein (sonst sperrt das Release alle Geräte aus; sonst zuerst
   dort ein Issue und die App-Version abwarten). Wird angehoben: `appVersions.js`, Beispiel in `docs/api.md`,
   Vertragstest (`backend/test/contract.test.js`, `emailVerification.test.js`), CHANGELOG „Technik“ und ein Punkt in
   `docs/update-hinweise.md` („Erst ausrollen, wenn die iOS-App X.Y.Z installiert ist“). **Das Ergebnis steht immer im
   Text des Release-PRs**, auch wenn nichts zu tun ist („Mindest-App-Version: unverändert 0.2.2, weil …“) – ein
   Release-PR ohne diese Zeile ist nicht fertig.
3. **Release vorbereiten** in einem eigenen PR:

   ```bash
   node backend/scripts/neue-version.js X.Y.Z
   ```

   Das setzt `VERSION`, `backend/package.json` und `backend/package-lock.json` und schließt
   `[Unreleased]` als `## [X.Y.Z] - JJJJ-MM-TT` ab. Vor dem PR `php tests/VersionTest.php`.
4. **PR mergen.**
5. **Tag setzen** auf dem gemergten `main` – das löst `.github/workflows/release.yml` aus, der
   Tag, `VERSION`, `package.json` und CHANGELOG prüft und das GitHub-Release mit dem Text aus dem
   CHANGELOG anlegt (0.x als „Pre-release“):

   ```bash
   git tag -a vX.Y.Z -m "Fuelstat X.Y.Z"
   git push origin vX.Y.Z
   ```

   Der Tag baut außerdem das API-Image `ghcr.io/fuelstat/fuelstat-api:X.Y.Z` (#134).
6. **Ausrollen** auf dem Server, genau in der Reihenfolge aus `docs/betrieb.md` („Aktualisieren“):
   sichern → `sudo infra/ausrollen.sh X.Y.Z`. Das Skript zeigt die Hinweise aus `docs/update-hinweise.md`, neue
   Migrationen und geänderte Beispieldateien, lädt das Image, stellt den Code aufs Tag um, spielt
   **Migrationen ein, bevor die API neu startet**, fragt nach `.env`/nginx, startet die API, lädt
   PHP-FPM neu und prüft `/api/v1/health`. Zurückrollen: dasselbe Skript mit der vorigen Version.

   Von Hand (ohne Registry): sichern → Tag auschecken → Hinweise lesen → Migrationen → `.env`/nginx →
   `cd infra && sudo docker compose up -d --build` und `sudo systemctl reload php8.4-fpm` →
   `/api/v1/health`. Wer Ausroll-Schritte nennt (in PRs, CHANGELOG oder Antworten), nennt sie in
   dieser Reihenfolge.

**Erinnern:** Der Maintainer möchte an diesen Ablauf erinnert werden. Weise am Ende einer Aufgabe
darauf hin, wenn

- unter `## [Unreleased]` Einträge stehen, die seit dem letzten Tag nicht veröffentlicht sind –
  mit Vorschlag für die nächste Versionsnummer;
- ein Release-PR gemergt ist, aber das Tag `vX.Y.Z` fehlt (`git tag`, `git ls-remote --tags origin`);
- ein Tag existiert, der Server aber noch nicht ausgerollt ist (Schritt 6);
- ein Release-PR ohne die Zeile zur Mindest-App-Version geöffnet werden soll (Schritt 2), oder ein Tag gesetzt wird,
  ohne dass sie geprüft ist: erst nachholen. Ein veröffentlichtes Tag nicht verschieben; muss die Mindestversion
  nachträglich angehoben werden, ist das ein Patch-Release (der Maintainer entscheidet).

Tags setzt und pusht Claude nur, wenn der Maintainer ausdrücklich darum bittet.

## Checkliste für jeden PR

Vor dem PR prüfen und am Ende einer Aufgabe daran erinnern, was davon fehlt:

- **CHANGELOG:** sichtbare Änderung unter `## [Unreleased]` eingetragen (ohne SQL und Betreiber-Details). Die CI
  (`changelog.yml`) prüft den Eintrag; ohne sichtbare Änderung das Label `kein changelog` setzen.
- **Mindest-App-Version:** ändert der PR etwas, das die veröffentlichte App nicht versteht (siehe Release-Prozess,
  Schritt 2: Felder, Fehlercodes, Enums, Verhalten), im PR-Text nennen, in `docs/api.md` unter „API-Vertrag“ festhalten
  und beim Release `appVersions.js` anheben. Ist die App dafür noch nicht fertig, ein Issue in FuelStat/fuelstat-ios
  anlegen (mit der benötigten Backend-Version) und die Änderung abwärtskompatibel halten, bis die App-Version getaggt
  ist.
- **Update-Hinweise für Betreiber:** bei allem, was beim Ausrollen über `ausrollen.sh` hinaus zu tun ist (einmaliger
  Befehl, neue Einstellung in `infra/.env`, nginx), ein Punkt mit dem genauen Befehl in `docs/update-hinweise.md`
  unter `## [Unreleased]`. Nie in den CHANGELOG.
- **Neue oder geänderte API-Endpunkte:** `docs/api.md` (Übersichtstabelle und eigener Abschnitt)
  und `docs/openapi.1.0.0.yaml` angepasst (neue Felder auch in den Schemas, die `additionalProperties: false`
  haben); unter `/api/v1` abwärtskompatibel (Ausnahme während der Beta siehe Regeln). Die CI prüft mit `tests/openapi_abgleich.py`, dass jede Route
  in der OpenAPI steht. Endpunkte, die Apps nutzen, stehen im Vertragstest `backend/test/contract.test.js`
  (prüft Antworten gegen die OpenAPI); Regeln und Mindest-App-Version siehe `docs/api.md` („API-Vertrag“).
- **Datenbankschema:** neue Migration `backend/database/postgres_0NN_name.sql` (in einer
  Transaktion, mehrfach ausführbar: `IF NOT EXISTS` u. Ä.), dieselbe Änderung in
  `postgres_init.sql` für Neuinstallationen, Zeile in der Migrationstabelle in `docs/betrieb.md`
  (und dort den Stand „enthält alles bis einschließlich 0NN“), kein
  Einspiel-Befehl nötig (`ausrollen.sh` spielt sie ein, von Hand siehe `betrieb.md`), nur wenn zusätzlich etwas zu tun
  ist, ein Punkt in `docs/update-hinweise.md`. Migrationen müssen vor dem Neustart der API laufen können, also mit dem alten
  API-Code verträglich sein.
- **Konfiguration:** neue oder geänderte Variablen in `infra/.env.example` mit Kommentar
  (Zweck, Standardwert, ob Pflicht), ebenso `infra/backup/backup.env.example` und die
  nginx-Beispiele (`infra/nginx-sicherheit.conf.example`, `infra/nginx/fuelstat.conf.example`);
  bei Bedarf `docs/installation.md`.
- **Funktionen:** Funktionsliste im `README.md` aktualisiert; neue oder geänderte Funktionen der
  Web-App in der iOS-Feature-Referenz
  [FuelStat/fuelstat-ios#15](https://github.com/FuelStat/fuelstat-ios/issues/15) ergänzt, damit
  die App nachzieht.
- **Tests:** passende Tests ergänzt (`backend/test`, `tests/`).
- **Design:** neue oder geänderte Oberflächen folgen [`docs/design.md`](docs/design.md) (Tokens statt
  Hex-Werten, Barrierefreiheit). Ändert sich ein Token, zuerst dort, dann in Web, iOS und Android.

## Regeln

- **Aufbau der API:** `backend/src` ist nach Fachbereichen aufgeteilt (`routes/`, `services/`, `middleware/`, `lib/`), siehe [`docs/backend.md`](docs/backend.md). Neue Endpunkte ins passende Routen-Modul, Fachlogik in einen Service.

- **Design:** [`docs/design.md`](docs/design.md) ist die einzige Quelle für das Aussehen von Web/PWA,
  iOS und Android (Farben, Schrift, Abstände, Radien, Bausteine, Plattform-Leitplanken,
  Barrierefreiheit). Neue CSS-Regeln verwenden die `--fs-*`-Variablen aus `css/style.css`, keine Hex-Werte.
  Die Design-Dokumente der Apps beschreiben nur Plattform-Besonderheiten und verweisen hierher.

- **API-first:** Fachliche Berechnungen gehören in die API, nicht ins PHP-Frontend (#82). Clients
  stellen nur dar.
- **Externe Dienste nur über die API** (Tankerkönig, Open Charge Map, später weitere): kein
  direkter Aufruf aus PHP oder den Apps; API-Keys nur in der Server-Konfiguration (#123).
- Änderungen an der API abwärtskompatibel unter `/api/v1`; Brüche nur über `/api/v2`.
  **Während der Beta (bis 1.0.0)** dürfen veraltete Felder und Endpunkte entfallen, wenn Web-App und
  iOS-App sie nicht (mehr) nutzen oder im selben Zug angepasst werden – Clients außer diesen beiden gibt es
  nicht. Ab 1.0.0 gilt die Regel ohne Ausnahme (#118). Doku in `docs/api.md` und `docs/openapi.1.0.0.yaml`
  mit anpassen.
- Alte Migrationen und Umstellungen für ältere Installationen dürfen entfallen, sobald alle bekannten
  Installationen sie hinter sich haben (während der Beta nur tanken.1emc.de); Stand in `docs/betrieb.md`.
- Tarifregeln setzt ausschließlich die API durch (#102).
- Keine Secrets committen (`.env`, Keys, Tokens).
- Oberfläche, Doku und Commit-Texte auf Deutsch; PRs folgen `.github/pull_request_template.md`.
