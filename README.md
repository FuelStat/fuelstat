# Fuelstat

**Alle Fahrzeugkosten im Blick. Unabhängig vom Antrieb. Selbst gehostet.**

Fuelstat ist eine selbst gehostete Fahrzeug- und Kostenverwaltung. Erfasse Tankfüllungen, Ladevorgänge, Wartungen und weitere Ausgaben an einem zentralen Ort. Analysiere Verbrauch, Kosten pro Kilometer und die Entwicklung deiner Fahrzeuge.

Ob Benziner, Diesel, Autogas, Erdgas, Elektroauto, Hybrid oder Plug-in-Hybrid: Fuelstat unterstützt unterschiedliche Antriebsarten und hilft dir, die tatsächlichen Kosten deiner Mobilität zu verstehen.

**Live-Anwendung:** [tanken.1emc.de](https://tanken.1emc.de)  
**Quellcode:** [github.com/FuelStat/fuelstat](https://github.com/FuelStat/fuelstat)

---

## Warum Fuelstat?

Die Kosten eines Fahrzeugs bestehen aus mehr als nur dem Kraftstoffpreis. Tankfüllungen, Ladestrom, Versicherung, Wartung, Reparaturen und viele weitere Ausgaben summieren sich über die Zeit.

Fuelstat führt diese Informationen zusammen und macht sie nachvollziehbar.

- **Alle Fahrzeuge an einem Ort:** Verwalte mehrere Fahrzeuge mit unterschiedlichen Antriebsarten.
- **Verbrauch verstehen:** Analysiere Kraftstoff- und Stromverbrauch, Kosten pro Kilometer und langfristige Entwicklungen.
- **Ausgaben kontrollieren:** Behalte sämtliche Fahrzeugkosten nach Kategorien und Zeiträumen im Blick.
- **Wartung nicht vergessen:** Erhalte Erinnerungen an TÜV, Inspektionen, Versicherung und Steuer.
- **Überall verfügbar:** Nutze Fuelstat im Browser oder installiere die Anwendung als Progressive Web App.
- **Daten selbst verwalten:** Betreibe Fuelstat auf deinem eigenen Server und behalte die Kontrolle über deine Daten.

## Funktionen

### Fahrzeugverwaltung

- Mehrere Fahrzeuge mit individuellen Angaben, Bildern und Tachoständen
- Unterstützung für Benzin, Diesel, Autogas, Erdgas, Elektro, Hybrid, Plug-in-Hybrid und Wasserstoff
- Tank- und Akkugröße, Baujahr, Kennzeichen, FIN und Erstzulassung
- Kauf- und Verkaufsdaten sowie Wartungs- und Ölwechselintervalle
- Versicherungs- und Steuerinformationen
- Individuelle Reifengrößen
- Frei sortierbare Fahrzeugübersicht
- Fahrzeuge mit anderen Konten teilen: Mitfahrer erfassen mit, „Nur ansehen“ sieht alles; Einladung per E-Mail
- Hinweise auf anstehende und überfällige Termine

### Tank- und Ladeverwaltung

- Schnelle Erfassung von Tankfüllungen und Ladevorgängen
- Automatische Berechnung von Menge, Einzelpreis und Gesamtpreis
- Tankstellen in der Nähe mit aktuellen Preisen über Tankerkönig
- Ladestationen mit Leistung und Steckertypen über Open Charge Map
- Zuletzt verwendete Tankstellen und Ladestationen als Vorschläge
- Unterstützung für Teil- und Vollbetankungen sowie Teilladevorgänge
- Getrennte Verbrauchsauswertung für Kraftstoff und Strom bei Plug-in-Hybriden
- Plausibilitätsprüfung des Tachostands
- Nachträgliches Ergänzen fehlender Tachostände, auch nach 14 Tagen
- Separate Kilometerstandseinträge ohne Kosten

### Ausgaben und Fahrten

- Erfassung von Versicherung, Werkstatt, Inspektion, Steuer, Reparaturen, Reifen, TÜV und weiteren Kosten
- Verwaltung eigener Ausgabenkategorien
- Fahrtenbuch zur eigenen Übersicht: Fahrten mit Tachostand Start/Ende, Von/Nach, Zweck (privat, dienstlich, Arbeitsweg), km je Monat und Zweck, Anteil dienstlich, geschätzte Kosten, CSV-Export
- Monatlich gruppierte Eintragsübersicht
- Suche und Filter nach Eintragsart, Ort und Beschreibung
- Bearbeiten und Löschen von Einträgen

### Statistiken und Auswertungen

- Durchschnittlicher und aktueller Verbrauch
- Verbrauch pro Tankfüllung und pro Monat
- Jahresübersichten mit Verbrauch, Menge, Kosten und CO₂-Ausstoß
- Kosten pro Kilometer
- Monatliche Ausgaben und Kostenentwicklung
- Ausgaben nach Kategorien und Kostengruppen
- Wartungskosten je 10.000 Kilometer
- Jahresvergleiche
- CO₂-Ausstoß insgesamt und pro Kilometer

### Erinnerungen und Benachrichtigungen

- Erinnerungen an TÜV, Wartung, Versicherung und Kfz-Steuer
- Individuell einstellbare Vorlaufzeiten
- Hinweise auf überfällige Termine
- Erinnerung an fehlende Tachostände nach Tank- oder Ladevorgängen
- Monatlicher Bericht mit Kosten, Fahrleistung, Verbrauch und anstehenden Terminen
- Versand über den Betreiber-Mailserver oder einen eigenen SMTP-Server

### Import, Export und Datenaustausch

- CSV-Export für Tabellenkalkulationen
- Druckbare Berichte und PDF-Ausgabe
- CSV-Import aus Excel, anderen Anwendungen oder Fuelstat-Exporten
- Spaltenzuordnung und Importvorschau
- Erkennung möglicher Duplikate
- Importvorlagen passend zur jeweiligen Antriebsart

### Konto und Benutzerverwaltung

- Registrierung mit Bestätigung der E-Mail-Adresse und Zustimmung zu den Nutzungsbedingungen
- Anmeldung
- Optionale Zwei-Faktor-Authentifizierung
- Benutzerprofil mit Profilbild
- Passwortänderung, „Passwort vergessen“ per Mail und Abmeldung auf allen Geräten
- Kontolöschung
- Administratorbereich mit Benutzer-, Fahrzeug- und Aktivitätsübersicht
- Feedback-Funktion für Fehler, Ideen und Rückmeldungen
- Vorbereitetes Tarifmodell für Free, Plus und Flotte

### Mobile Nutzung und PWA

- Installierbar auf Smartphones und Tablets
- App-Navigation mit unterer Navigationsleiste
- Hell- und Dunkelmodus
- Schneller Seitenwechsel mit Ladeanzeige und Browser-Cache
- Wischgesten zum Wechseln zwischen den Fahrzeug-Reitern
- App-Kürzel für häufig verwendete Aktionen
- Offline lesbar: zuletzt geladene Übersicht und Fahrzeugseiten mit Bildern und Hinweis auf den Stand
- Zum Aktualisieren nach unten ziehen (installierte App)
- Optimierte und geschützte Fahrzeugbilder

---

## Technologie und Architektur

Fuelstat setzt auf eine getrennte Frontend- und Backend-Architektur. Die PHP-Anwendung kommuniziert ausschließlich über die API mit der Datenbank.

| Komponente | Technologie |
|---|---|
| Frontend | PHP 8 |
| Benutzeroberfläche | Bootstrap 5.3 |
| Diagramme | Chart.js |
| Backend/API | Node.js 24 LTS, Express |
| Datenbank | PostgreSQL 15 |
| Infrastruktur | Docker Compose |
| Webserver | nginx |
| Anwendungstyp | Progressive Web App |

### Architektur

```text
Browser
   |
   v
PHP-Frontend
   |
   v
Node.js REST API
   |
   v
PostgreSQL
```

Die API ist die zentrale Schnittstelle für Datenzugriffe. Dadurch können neben dem Webfrontend auch weitere Clients und zukünftige Anwendungen dieselben Funktionen nutzen.

Weitere technische Informationen:

- [API-Dokumentation](docs/api.md)
- [Aufbau der API (Backend)](docs/backend.md)
- [OpenAPI-Spezifikation](docs/openapi.1.0.0.yaml)

---

## Installation und Self-Hosting

Fuelstat kann auf einem eigenen Linux-Server betrieben werden. Hier die Kurzfassung; die vollständige, getestete Anleitung mit nginx-Tabelle, Prüfbefehlen und Hinweisen zu Cloudflare steht in **[docs/installation.md](docs/installation.md)**.

### Voraussetzungen

- Linux-Server
- Docker mit Docker Compose
- PHP 8.1 oder neuer, empfohlen PHP 8.4
- PHP-Erweiterungen `curl`, `mbstring` und `fileinfo`
- nginx oder ein vergleichbarer Webserver mit Reverse Proxy
- HTTPS-Zertifikat

### 1. Repository herunterladen

```bash
sudo mkdir -p /srv/www/fuelstat
sudo chown "$USER" /srv/www/fuelstat

git clone https://github.com/FuelStat/fuelstat.git \
  /srv/www/fuelstat/public
```

### 2. API und Datenbank einrichten

```bash
cd /srv/www/fuelstat/public/infra

cp .env.example .env
```

Die Datei `.env` enthält die Konfiguration für Datenbank, JWT und E-Mail-Verschlüsselung.

Geheimnisse generieren:

```bash
openssl rand -base64 48
```

Für `JWT_SECRET` und `MAIL_ENCRYPTION_KEY` jeweils einen eigenen Wert verwenden.

Anschließend:

```bash
mkdir -p ../uploads
sudo chown 1000:1000 ../uploads

sudo docker compose up -d --build
```

API-Status prüfen:

```bash
curl -s http://127.0.0.1:3000/api/v1/health
```

Die API und Adminer sind standardmäßig nur lokal erreichbar.

**Wichtig:** `MAIL_ENCRYPTION_KEY` dauerhaft und unabhängig vom JWT-Schlüssel setzen. Wird der Verschlüsselungsschlüssel geändert, können bereits gespeicherte SMTP-Passwörter und 2FA-Schlüssel nicht mehr entschlüsselt werden.

### 3. PHP-Frontend konfigurieren

Das Repository-Wurzelverzeichnis dient als Webroot.

Das Frontend benötigt keine eigene Datenbankverbindung. Sämtliche Datenzugriffe erfolgen über die API.

Die API-Adresse wird über `FUELSTAT_API_BASE_URL` konfiguriert. Standardmäßig:

```text
http://127.0.0.1:3000/api/v1
```

Die API sollte serverseitig direkt angesprochen werden, nicht über die öffentliche Domain.

Zusätzlich müssen folgende Angaben eingerichtet werden:

- Tankerkönig-API-Key als `TANKERKOENIG_API_KEY` und Open-Charge-Map-API-Key als `OCM_API_KEY` in `infra/.env` (die Web-App fragt beide Dienste nur über die API)
- Betreiberangaben in `includes/betreiber.php`

### 4. nginx konfigurieren

Beispielkonfigurationen befinden sich unter:

```text
infra/nginx/fuelstat.conf.example
infra/nginx-sicherheit.conf.example
```

Die Platzhalter für Domain, Webroot und PHP-FPM-Socket müssen angepasst werden.

Mindestens erforderlich sind:

- HTTPS und Weiterleitung von HTTP
- Reverse Proxy für `/api/v1/`
- PHP-FPM-Konfiguration mit `FUELSTAT_API_BASE_URL`
- Upload-Begrenzung
- Schutz interner Verzeichnisse und sensibler Dateien
- Geeignete Cache-Regeln für statische Dateien

Die Beispielkonfiguration enthält bereits entsprechende Regeln.

Nach der Anpassung:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

**Sicherheitshinweis:** Ohne die mitgelieferten nginx-Sicherheitsregeln können interne Dateien, Konfigurationen und Schlüssel versehentlich öffentlich erreichbar sein.

### 5. Erstes Konto und Administrator einrichten

1. Fuelstat im Browser öffnen und ein Konto registrieren.
2. Die eigene Benutzer-ID in der Datenbank ermitteln:

   ```bash
   sudo docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id, email from users"'
   ```

3. Die ID in `ADMIN_USER_IDS` in `infra/.env` eintragen.
4. API neu starten:

```bash
sudo docker compose up -d
```

Danach stehen Administratorfunktionen und Feedback-Verwaltung zur Verfügung.

---

## Betrieb und Wartung

Ausführlich mit allen Befehlen, der Liste der Migrationen, einmaligen Umstellungen und der Einrichtung der Datensicherung: **[docs/betrieb.md](docs/betrieb.md)**.

### Aktualisieren

Kurzfassung – die vollständige Reihenfolge mit Sicherung und Prüfung steht in [docs/betrieb.md](docs/betrieb.md#aktualisieren). Wichtig: neue **Migrationen vor dem Neustart der API** einspielen.

```bash
sudo infra/ausrollen.sh 0.11.0
```

Das Skript zeigt die „Hinweise zum Update“ und neue Migrationen, lädt das fertige API-Image der Version, stellt den Code auf das Tag um, spielt die Migrationen ein, startet die API und prüft `/api/v1/health`. Ohne Registry (eigener Fork, Entwicklung) wie bisher `git pull`, Migrationen einspielen, `cd infra && sudo docker compose up -d --build`.

### Datenbank-Migrationen

Neue Installationen erhalten das vollständige Schema über:

```text
backend/database/postgres_init.sql
```

Bestehende Installationen müssen fehlende Migrationen in der vorgesehenen Reihenfolge ausführen.

Die Migrationen befinden sich unter:

```text
backend/database/
```

Alle Migrationen laufen innerhalb einer Transaktion und sind für eine wiederholte Ausführung ausgelegt.

### Datensicherung

Fuelstat enthält Skripte zur Sicherung und Wiederherstellung der Datenbank und hochgeladener Bilder.

Die Backup-Funktionen unterstützen:

- PostgreSQL-Dumps
- Sicherung der hochgeladenen Bilder
- Optionale Verschlüsselung mit age
- Optionale externe Sicherung per rsync
- Automatische tägliche Backups über systemd
- Konfigurierbare Aufbewahrungsfristen
- Wiederherstellung in eine separate Testdatenbank

Die zugehörigen Dateien liegen in:

```text
infra/backup/
```

Eine regelmäßige Wiederherstellungsprobe wird ausdrücklich empfohlen.

---

## Sicherheit und Datenschutz

Sicherheit und Datenschutz sind wichtige Bestandteile von Fuelstat.

Zu den vorhandenen Schutzmaßnahmen gehören:

- Passwortbasierte Authentifizierung und optionale Zwei-Faktor-Authentifizierung
- JWT-basierte API-Authentifizierung
- HttpOnly- und SameSite-geschützte Cookies
- CSRF-Schutz für Formulare
- Rate Limiting für API-Anfragen, Uploads und Importe
- Serverseitige Prüfung hochgeladener Dateien
- Geschützte Bildauslieferung über signierte Adressen
- Verschlüsselte Speicherung sensibler Zugangsdaten
- Schutz interner Verzeichnisse und Konfigurationsdateien
- CodeQL-Code-Scanning

Sicherheitslücken bitte vertraulich melden. Die Kontaktdaten und Hinweise zur verantwortungsvollen Meldung stehen in der [SECURITY.md](SECURITY.md) und unter `/.well-known/security.txt`.

---

## Entwicklung

Fuelstat ist ein Open-Source-Projekt. Beiträge, Fehlerberichte und Verbesserungsvorschläge sind willkommen.

### Lokale Entwicklungsumgebung

Backend:

```bash
cd backend
npm install
npm run dev
```

Das Backend benötigt eine konfigurierte `DATABASE_URL` und einen `JWT_SECRET`.

Frontend:

```bash
php -S 127.0.0.1:8088
```

Dabei muss `FUELSTAT_API_BASE_URL` auf die lokal laufende API zeigen.

Alternativ kann die lokale Docker-Entwicklungsumgebung verwendet werden:

```bash
cd infra

docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  up -d --build
```

### Tests

PHP-Tests:

```bash
for t in tests/*.php; do
    php -d zend.assertions=1 "$t"
done
```

API-Tests:

```bash
createdb fuelstat_test

psql -d fuelstat_test \
  -f backend/database/postgres_init.sql

cd backend

DATABASE_URL=postgresql://localhost/fuelstat_test npm test
```

**Wichtig:** API-Tests niemals gegen die produktive Datenbank ausführen.

GitHub Actions führt bei Pull Requests und Pushes auf `main` automatisierte Prüfungen für PHP, API und YAML-Dateien aus.

Weitere Informationen:

- [Mitwirken am Projekt](CONTRIBUTING.md)
- [Verhaltenskodex](CODE_OF_CONDUCT.md)
- [Barrierefreiheit](ACCESSIBILITY.md)
- [Fehler melden](https://github.com/FuelStat/fuelstat/issues)
- [Verbesserungen vorschlagen](https://github.com/FuelStat/fuelstat/issues)

---

## Roadmap

Die Planung läuft über die [Milestones](https://github.com/FuelStat/fuelstat/milestones) in diesem Repository, auch für die iOS-App. Deren Aufgaben liegen in [FuelStat/fuelstat-ios](https://github.com/FuelStat/fuelstat-ios/issues) und sind hier über ein Sammel-Issue je Version eingeplant.

| Version | Schwerpunkt |
|---|---|
| [0.10.0 – Foundation](https://github.com/FuelStat/fuelstat/milestone/1) | Grundlage für native Apps und Tarife: Tarif nur serverseitig, modulare API, Statistik in der API, Release-Prozess |
| [0.11.0 – Sharing and Logbook](https://github.com/FuelStat/fuelstat/milestone/2) | Fahrzeuge mit anderen Konten teilen, neues Fahrtenbuch mit Zweck, Auswertung und Export |
| [0.12.0 – Maintenance, Costs and Charging](https://github.com/FuelStat/fuelstat/milestone/3) | Service-Historie je Bauteil, Gesamtkosten und Fahrzeug-Lebenszyklus, Ladevorgänge, Web-Push |
| [1.0.0 – End of Beta](https://github.com/FuelStat/fuelstat/milestone/4) | Bereit für zahlende Nutzer: Rechtliches und Zahlung, einheitliches Design, Fahrzeugvergleich, Budget und Kostenprognose |
| [2.0.0 – native iOS-Version](https://github.com/FuelStat/fuelstat/milestone/6) | Erste native App fürs iPhone auf derselben API; ab hier ist die API ein festes Versprechen an App-Clients |
| [Später](https://github.com/FuelStat/fuelstat/milestone/5) | Ideen ohne Termin, z. B. Dokumente je Fahrzeug, Flottenverwaltung, Passkeys, Kilometerstand automatisch |

Leitlinie: erst Zuverlässigkeit und Datensicherheit, dann müheloses Erfassen im Alltag, dann große neue Funktionen.

Offene Aufgaben und Fehler: [GitHub Issue Tracker](https://github.com/FuelStat/fuelstat/issues).

---

## Versionen

Aktuelle Version und alle Änderungen: [CHANGELOG.md](CHANGELOG.md), in der App unter „Neuigkeiten“ und als [GitHub-Releases](https://github.com/FuelStat/fuelstat/releases). Ablauf für neue Versionen: [docs/betrieb.md](docs/betrieb.md#versionen-und-releases).

---

## Lizenz

Fuelstat wird unter der **GNU Affero General Public License v3.0 (AGPL-3.0)** veröffentlicht.

Die Lizenz ermöglicht die private und kommerzielle Nutzung sowie die Weiterentwicklung des Projekts. Bei veränderten Versionen, die über ein Netzwerk bereitgestellt werden, müssen die entsprechenden Quellcode-Anforderungen der AGPL beachtet werden.

Details stehen in der [LICENSE](LICENSE).

---

## Kontakt

**Mario Caraggiu**

- GitHub: [@1emc](https://github.com/1emc)
- Projekt: [github.com/FuelStat/fuelstat](https://github.com/FuelStat/fuelstat)
- iOS-App (in Planung): [github.com/FuelStat/fuelstat-ios](https://github.com/FuelStat/fuelstat-ios)
- Live-Anwendung: [tanken.1emc.de](https://tanken.1emc.de)


