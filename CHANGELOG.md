# Changelog

Alle nennenswerten Änderungen an Fuelstat. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionsnummern nach [Semantic Versioning](https://semver.org/lang/de/): `MAJOR.MINOR.PATCH`. Bis zum Ende der Beta bleibt die Hauptversion 0.

Kategorien je Version: **Neu**, **Verbessert**, **Behoben**, **Sicherheit**, **Technik** und, wenn nötig, **Hinweise zum Update** (Migrationen, Befehle, Einstellungen). Die App zeigt diese Datei unter „Neuigkeiten“ an.

## [Unreleased]

### Sicherheit
- Tarifänderungen werden protokolliert (wer, wann, von welchem zu welchem Tarif, über welchen Weg); abgewiesene Zugriffe auf Admin-Funktionen erscheinen im Log. Admins sehen den Verlauf je Konto über die API. Automatische Tests belegen, dass normale Konten ihren oder fremde Tarife nicht ändern können (#102).

### Neu
- Betreiber können Tarife auch ohne Web-Oberfläche setzen: `node scripts/tarif-setzen.js` im API-Container (siehe `docs/betrieb.md`, „Tarife verwalten“).

### Technik
- Betriebsdoku: Reihenfolge beim Aktualisieren korrigiert – Datenbank-Migrationen werden jetzt ausdrücklich **vor** dem Neustart der API eingespielt, mit Sicherung vorab und Kontrolle der Version danach (`docs/betrieb.md`, README).

### Hinweise zum Update
- Migration einspielen, **bevor** die API neu startet: `cd infra && sudo docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_015_plan_changes.sql`

## [0.9.1] - 2026-11-06

### Neu
- API: `GET /api/v1/stations` liefert Tankstellen in der Nähe mit aktuellen Preisen von Tankerkönig, damit die Apps beim Tanken Tankstelle und Preis vorschlagen können. Der API-Key bleibt auf dem Server.

### Technik
- Das Repository ist umgezogen nach [FuelStat/fuelstat](https://github.com/FuelStat/fuelstat); Links in App und Doku zeigen auf die neue Adresse. Die iOS-App entsteht in [FuelStat/fuelstat-ios](https://github.com/FuelStat/fuelstat-ios).
- Abhängigkeiten aktualisiert: express-rate-limit 8.7.3 (API), actions/setup-node 7 (CI).

### Hinweise zum Update
- Für die Tankstellensuche in den Apps den Tankerkönig-Key als `TANKERKOENIG_API_KEY` in `infra/.env` eintragen (derselbe wie in `api/key.key`) und die API neu starten.
- Auf bestehenden Installationen die Git-Adresse umstellen: `git remote set-url origin https://github.com/FuelStat/fuelstat.git` (die alte Adresse leitet GitHub vorerst weiter).

## [0.9.0] - 2026-11-06

Erste Version mit Versionsnummer: alles, was Fuelstat bis zu diesem Stand kann.

### Neu
- Fahrzeuge für alle Antriebsarten (Benzin, Diesel, Autogas, Erdgas, Elektro, Hybrid, Plug-in-Hybrid, Wasserstoff) mit Foto, Kennzeichen, FIN, Kauf, Intervallen, Versicherung, Steuer und Reifengrößen; Anlegen als Assistent in vier Schritten
- Tanken, Laden, Ausgaben, Fahrten und reine Kilometerstände erfassen, mit Tankstellen- und Ladestationssuche samt aktuellem Preis
- Plug-in-Hybride: Tanken und Laden im selben Fahrzeug, Verbrauch getrennt, gemeinsame Energiekosten
- Statistiken: Verbrauch je Abschnitt, Monat und Jahr, Kosten pro km und Monat, CO₂, Jahresvergleich, Ausgaben nach Kategorie und Gruppe
- Fälligkeiten für TÜV, Wartung, Versicherung und Steuer mit E-Mail-Erinnerung; Monatsbericht per E-Mail
- Kategorien aus der API, dazu Premium-Kategorien (Parken, Maut, Pflege, Leasing, Zubehör) und bis zu 10 eigene Kategorien mit Symbol, Farbe und Gruppe
- Import aus CSV mit Spaltenzuordnung und Vorschau, Export als CSV und Bericht zum Drucken
- Konto mit Zwei-Faktor-Anmeldung, Profilbild, Abmelden auf allen Geräten, Konto löschen
- Benutzerverwaltung und Feedback-Eingang für Admins, Tarif-Grundgerüst (Free, Plus, Flotte)
- Als App auf dem Handy installierbar, mit unterer Navigationsleiste und Wischen zwischen den Reitern
- „Neuigkeiten“: diese Übersicht mit der installierten Version

### Verbessert
- Deutlich schnellere Seiten: Daten werden parallel und direkt von der API geladen, Ladebalken beim Seitenwechsel, „Zurück“ ohne Neuladen
- Bilder werden beim Hochladen verkleinert und als WebP gespeichert (aus mehreren MB werden einige hundert KB)
- Angemeldet bleiben bei aktiver Nutzung (bis zu 90 Tage)
- Einheitliches Design für Übersicht, Fahrzeugseite, Einträge und alle Eintragsformulare

### Behoben
- Der Preis pro Liter der gewählten Tankstelle wird nicht mehr von der automatischen Berechnung überschrieben
- Ort-Vorschläge verschwinden, sobald ein Ort eingetragen ist
- Kopfzeile in der iPhone-App wird nicht mehr weichgezeichnet

### Sicherheit
- Hochgeladene Bilder ohne Metadaten (kein GPS-Ort) und nur über signierte, ablaufende Adressen abrufbar
- 2FA-Schlüssel und SMTP-Passwörter verschlüsselt gespeichert, CORS standardmäßig aus, Rate Limiting, CSRF-Schutz, CodeQL

### Technik
- API: Node.js 24 mit Express, PostgreSQL 15, Betrieb im `prod`-Container; PHP-Frontend greift nur über die API zu
- Automatische Tests (PHP und API) und Prüfung der YAML-Dateien bei jedem Pull Request
- Datensicherung mit Verschlüsselung und Wiederherstellungsprobe

### Hinweise zum Update
- Datenbank auf Stand Migration 014 bringen (`docs/betrieb.md`)
- Einmalig vorhandene Bilder umstellen: `sudo docker compose exec api node scripts/bilder-optimieren.js`
- nginx: `/uploads/` sperren, `FUELSTAT_API_BASE_URL` direkt auf `127.0.0.1:3000` setzen (`docs/installation.md`)

[Unreleased]: https://github.com/FuelStat/fuelstat/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/FuelStat/fuelstat/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/FuelStat/fuelstat/releases/tag/v0.9.0
