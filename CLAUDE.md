# Fuelstat – Hinweise für Claude und andere Agents

Web-App (PHP-Frontend), API (Node.js/Express) und Datenbank (PostgreSQL) von Fuelstat.
Die zentrale Planung (Milestones) liegt in diesem Repository, auch für die iOS-App
([FuelStat/fuelstat-ios](https://github.com/FuelStat/fuelstat-ios)).

## Release-Prozess

Ausführlich in [`docs/betrieb.md`](docs/betrieb.md#versionen-und-releases). Kurzfassung, damit
nichts vergessen wird:

**Versionsnummer:** Semantic Versioning, während der Beta `0.x.y`. Einzige Quelle ist die Datei
`VERSION`. PATCH für Fehlerbehebungen, MINOR für neue Funktionen, MAJOR für Brüche (z. B.
API-Änderungen, die Apps anpassen müssen). Die geplanten Versionen sind die Milestones.

1. **Laufend:** Jeder PR mit sichtbarer Änderung trägt sie in `CHANGELOG.md` unter
   `## [Unreleased]` ein (Kategorien: Neu, Verbessert, Behoben, Sicherheit, Technik; dazu
   „Hinweise zum Update“, wenn beim Ausrollen etwas zu tun ist).
2. **Release vorbereiten** in einem eigenen PR:

   ```bash
   node backend/scripts/neue-version.js X.Y.Z
   ```

   Das setzt `VERSION`, `backend/package.json` und `backend/package-lock.json` und schließt
   `[Unreleased]` als `## [X.Y.Z] - JJJJ-MM-TT` ab. Vor dem PR `php tests/VersionTest.php`.
3. **PR mergen.**
4. **Tag setzen** auf dem gemergten `main` – das löst `.github/workflows/release.yml` aus, der
   Tag, `VERSION`, `package.json` und CHANGELOG prüft und das GitHub-Release mit dem Text aus dem
   CHANGELOG anlegt (0.x als „Pre-release“):

   ```bash
   git tag -a vX.Y.Z -m "Fuelstat X.Y.Z"
   git push origin vX.Y.Z
   ```

5. **Ausrollen** auf dem Server, genau in der Reihenfolge aus `docs/betrieb.md` („Aktualisieren“):
   sichern → `git pull` → „Hinweise zum Update“ lesen und geänderte Migrationen/Beispieldateien
   prüfen → **Migrationen einspielen, bevor die API neu startet** → `.env`/nginx nachziehen →
   `cd infra && sudo docker compose up -d --build` und `sudo systemctl reload php8.4-fpm` →
   `/api/v1/health` zeigt die neue Version.

   Ohne `--build` meldet die API weiter die alte Version, und unter „Neuigkeiten“ warnt die Seite
   Admins, dass API und Frontend nicht zusammenpassen. Wer Ausroll-Schritte nennt (in PRs,
   CHANGELOG oder Antworten), nennt sie in dieser Reihenfolge.

**Erinnern:** Der Maintainer möchte an diesen Ablauf erinnert werden. Weise am Ende einer Aufgabe
darauf hin, wenn

- unter `## [Unreleased]` Einträge stehen, die seit dem letzten Tag nicht veröffentlicht sind –
  mit Vorschlag für die nächste Versionsnummer;
- ein Release-PR gemergt ist, aber das Tag `vX.Y.Z` fehlt (`git tag`, `git ls-remote --tags origin`);
- ein Tag existiert, der Server aber noch nicht ausgerollt ist (Schritt 5).

Tags setzt und pusht Claude nur, wenn der Maintainer ausdrücklich darum bittet.

## Checkliste für jeden PR

Vor dem PR prüfen und am Ende einer Aufgabe daran erinnern, was davon fehlt:

- **CHANGELOG:** sichtbare Änderung unter `## [Unreleased]` eingetragen; bei allem, was beim
  Ausrollen zu tun ist, ein Punkt unter „Hinweise zum Update“ mit dem genauen Befehl.
- **Neue oder geänderte API-Endpunkte:** `docs/api.md` (Übersichtstabelle und eigener Abschnitt)
  und `docs/openapi.1.0.0.yaml` angepasst; nur abwärtskompatibel unter `/api/v1`.
- **Datenbankschema:** neue Migration `backend/database/postgres_0NN_name.sql` (in einer
  Transaktion, mehrfach ausführbar: `IF NOT EXISTS` u. Ä.), dieselbe Änderung in
  `postgres_init.sql` für Neuinstallationen, Zeile in der Migrationstabelle in `docs/betrieb.md`
  (und dort den Stand „enthält alles bis einschließlich 0NN“), Einspiel-Befehl unter „Hinweise zum
  Update“. Migrationen müssen vor dem Neustart der API laufen können, also mit dem alten
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

## Regeln

- **Aufbau der API:** `backend/src` ist nach Fachbereichen aufgeteilt (`routes/`, `services/`, `middleware/`, `lib/`), siehe [`docs/backend.md`](docs/backend.md). Neue Endpunkte ins passende Routen-Modul, Fachlogik in einen Service.

- **API-first:** Fachliche Berechnungen gehören in die API, nicht ins PHP-Frontend (#82). Clients
  stellen nur dar.
- **Externe Dienste nur über die API** (Tankerkönig, Open Charge Map, später weitere): kein
  direkter Aufruf aus PHP oder den Apps; API-Keys nur in der Server-Konfiguration (#123).
- Änderungen an der API nur abwärtskompatibel unter `/api/v1`; Brüche nur über `/api/v2`.
  Doku in `docs/api.md` und `docs/openapi.1.0.0.yaml` mit anpassen.
- Tarifregeln setzt ausschließlich die API durch (#102).
- Keine Secrets committen (`.env`, Keys, Tokens).
- Oberfläche, Doku und Commit-Texte auf Deutsch; PRs folgen `.github/pull_request_template.md`.
