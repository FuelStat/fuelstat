# Changelog

Alle nennenswerten Änderungen an Fuelstat. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionsnummern nach [Semantic Versioning](https://semver.org/lang/de/): `MAJOR.MINOR.PATCH`. Bis zum Ende der Beta bleibt die Hauptversion 0.

Kategorien je Version: **Neu**, **Verbessert**, **Behoben**, **Sicherheit**, **Technik** und, wenn nötig, **Hinweise zum Update** (Migrationen, Befehle, Einstellungen). Die App zeigt diese Datei unter „Neuigkeiten“ an.

## [Unreleased]

### Verbessert
- **Neue Startseite** (#158): Start zeigt jetzt wie in der iOS-App ein Fahrzeug – das zuletzt genutzte bzw. gewählte – mit großem Foto, Kennzeichen und Tachostand, drei Kennzahlen (Ø Verbrauch, Kosten je km, Kosten diesen Monat), den nächsten drei Terminen und den letzten fünf Einträgen. Oben wechselst du das Fahrzeug; alle Fahrzeuge als Karten (mit „Ordnen“) findest du unter „Fahrzeuge“ → „Alle Fahrzeuge“.

## [0.12.2] - 2026-11-13

### Behoben
- **Tachostand-Prüfung** (#170): Zwei Einträge am selben Tag werden jetzt verglichen, z. B. morgens 12.000 km und abends 11.500 km ergibt eine Warnung. Der aktuelle Tachostand ist der jüngste Wert statt des höchsten; ein Tippfehler nach oben bleibt nicht mehr dauerhaft stehen und verfälscht Fahrleistung und km-Fälligkeiten nicht mehr.
- **TÜV aus der Erstzulassung** (#171): Ohne TÜV-Eintrag wird nur der erste TÜV (36 Monate nach Erstzulassung) berechnet, solange er bevorsteht. Bei älteren Fahrzeugen heißt es jetzt „Letzten Termin erfassen“ statt eines geratenen Datums.

### Verbessert
- **Reifen unter „Nächste Termine“** (#172): Der letzte Reifenwechsel kommt jetzt aus der API (`/reminders`, Zeile `Reifen`), ebenso Tachostand und Beschreibung des letzten Termins. Die Fahrzeugseite lädt dafür nicht mehr alle Ausgaben dreimal.

### Technik
- **Mindestversion der iOS-App 0.2.0** (#118): `/health` meldet für iOS `minimum_version` und `recommended_version` 0.2.0. Ältere App-Versionen (0.1.x) verstehen die Listen in Seiten (#160) nicht und bekommen 426 `app_update_required`.

### Hinweise zum Update
- Erst ausrollen, wenn die iOS-App 0.2.0 auf allen genutzten Geräten installiert ist: App-Versionen darunter erhalten danach nur noch „Update nötig“.

## [0.12.1] - 2026-11-13

### Neu
- **Push-Benachrichtigungen** (#136): Termine, „Kilometerstand nachtragen“ und den Monatsbericht gibt es jetzt auch als Push-Benachrichtigung der installierten Web-App – auf Android, am Computer und auf dem iPhone/iPad ab iOS 16.4 (dort nach „Zum Home-Bildschirm“). Unter „Benachrichtigungen“ wählst du je Anlass E-Mail, Push oder beides, aktivierst Push auf dem Gerät mit einem Klick und schickst eine Testnachricht. Ein Tipp auf die Nachricht öffnet die passende Seite; anstehende Termine zeigt das App-Symbol als Zahl.
- **Hinweis „Lange kein Eintrag“** (#136): Wurde für ein Fahrzeug 30 Tage nichts erfasst, kommt auf Wunsch eine Erinnerung per E-Mail oder Push.
- **Angemeldete Apps** (#117): Unter Einstellungen → Sicherheit siehst du, auf welchen Geräten die iPhone- bzw. Android-App angemeldet ist (Name, App-Version, zuletzt genutzt), und kannst einzelne Geräte abmelden. „Auf allen Geräten abmelden“ und eine Passwortänderung melden auch alle Apps ab.

### Sicherheit
- **Gerätesitzungen für Apps** (#117): Apps bekommen statt eines 7-Tage-Tokens ein Zugriffstoken für 30 Minuten und ein Refresh-Token je Gerät. Es gilt nur einmal (wird bei jeder Verwendung getauscht) und steht nur als Hash in der Datenbank; taucht ein schon getauschtes Token noch einmal auf, endet die Sitzung dieses Geräts. Apps bleiben so monatelang angemeldet, ohne dass ein langlebiges Token auf dem Gerät liegt. Die Web-App meldet sich unverändert an.

### Technik
- **API für Push** (#136): `GET/PUT /notifications/preferences` (Kanäle je Anlass), `GET /push/config`, `GET/POST/DELETE /push/devices`, `DELETE /push/devices/:id`, `POST /push/test`. Versand über `web-push` mit VAPID; je Anlass TTL, Urgency und Topic, VAPID-JWT je Push-Dienst zwischengespeichert, abgemeldete Geräte (404/410) werden gelöscht. `push_devices` kennt schon APNs und FCM für die nativen Apps. `PUT /auth/mail-settings` lässt fehlende Felder für Termine und Monatsbericht jetzt unverändert.
- **API-Vertrag** (#118): Regeln für abwärtskompatible Änderungen, Fehlerformat und Abkündigungen in `docs/api.md`; ein Vertragstest prüft die Antworten der Endpunkte, die Apps nutzen, gegen die OpenAPI. `/health` liefert je Plattform Mindest- und empfohlene App-Version (`apps`); Apps mit dem Header `X-Fuelstat-Client`, die älter als die Mindestversion sind, bekommen 426 `app_update_required`. Beträge, Mengen und Strecken kommen jetzt überall als Zahl statt als Text; die Liste der Tank- und Ladevorgänge enthält `vehicle_id`. Kein gültiges JSON im Anfragekörper ergibt 400 `invalid_json` (bisher fälschlich `upload_error`), unbekannte Pfade 404 `not_found` als JSON statt einer HTML-Seite.
- API (#117): `device` bei `POST /auth/register`, `/auth/login` und `/auth/login/mfa`; neu `POST /auth/session/refresh`, `GET /auth/sessions`, `DELETE /auth/sessions/:id` (auch `current`). Doku in `docs/api.md` („Gerätesitzungen für Apps“) und OpenAPI.

### Hinweise zum Update
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

### Verbessert
- **Barrierefreiheit** (#158): Jedes Diagramm hat eine Zusammenfassung für Screenreader (Zeitraum, Höchst- und Tiefstwert) und darunter „Werte als Tabelle“. Alle Buttons und Textlinks sind mindestens 44 px hoch bzw. so groß antippbar.
- Fahrzeugseite: „Fahrzeug löschen“ steht nur noch abgesetzt im Reiter „Einstellungen“, nicht mehr neben „Fahrzeug bearbeiten“. Das Erfassen heißt überall „Eintrag erfassen“.

### Behoben
- Fahrzeugseite: Das Diagramm „Letzte 6 Monate“ unter „Allgemein“ blieb seit 0.12.0 leer.
- Startseite: Die ganze Fahrzeugkarte führt wieder zum Fahrzeug – auch das Foto und die Kennzahlen, nicht nur der Name.

## [0.12.0] - 2026-11-12

### Neu
- **Mehrere Kraftstoffe je Fahrzeug** (#140): Unter „Antriebsart“ → „Erweitert“ wählst du, was ein Fahrzeug tankt bzw. lädt, z. B. Benzin und Autogas, Diesel und Premium-Diesel oder E5 und E10; einer davon ist der Standard. Beim Tanken wählst du die Sorte (bei nur einer Sorte bleibt alles wie bisher), die Tankstellensuche zeigt den Preis dieser Sorte. Verbrauch wird je Energieart gerechnet – E5, E10 und Super Plus zusammen als Benzin, Benzin und Autogas getrennt –, nur nebenbei getanktes Benzin beim Autogas-Auto zählt nicht als eigener Verbrauch. Die Statistik zeigt Preise je Sorte und den Mehrpreis von Premium-Sorten. Bestehende Fahrzeuge und Einträge bekommen ihre Sorte automatisch. CSV-Export und -Import mit Spalte „Sorte“.

### Verbessert
- **Neues Design der Web-App** nach dem gemeinsamen Design-Dokument (`docs/design.md`): Petrol als Markenfarbe, ruhige Karten ohne Rahmen und Schatten, größere Kennzahlen, Dunkelmodus in Navy wie das App-Icon. Gilt für alle Seiten, hell und dunkel, am Handy und am PC.
- Kopfleiste am PC (#145): Fahrzeugwechsler links, rechts „Eintrag erfassen“ und die Bereiche Start, Statistik, Neuigkeiten, Feedback, Darstellung und Profil als Symbole mit Tooltip; der aktive Bereich ist markiert.
- Startseite: jedes Fahrzeug als Karte mit großem Foto, Kennzeichen, Antriebsart, Tachostand und Verbrauch; fällige Termine als Hinweis mit Symbol.
- Fahrzeugseite: großes Fahrzeugfoto mit Name und Tachostand, darunter die Kennzahlen und die nächsten Termine mit Abstand in Worten („in 29 Tagen“, „seit 16 Tagen überfällig“).
- Fahrten (#144): Liste je Monat wie bei den Einträgen, Filter nach Zweck als Chips, Kilometer je Monat als Balken (Werte weiter als Tabelle abrufbar).
- Einträge: Symbole in der Farbe der Antriebsart bzw. Kategorie, Export und Import in einem Menü, Filter als Chips.
- Anmelden, Registrieren und Willkommensseite im neuen Design; die untere Leiste heißt jetzt „Start“ statt „Übersicht“, das Plus „Eintrag erfassen“.
- Barrierefreiheit: Tippflächen mindestens 44 px, Status immer mit Symbol und Text, geprüfte Kontraste in beiden Darstellungen.
- **Fahrzeugseite deutlich schneller** (#160): Sie lädt zuerst nur „Allgemein“; Einträge, Statistik, Ausgaben, Fahrten und Einstellungen kommen erst beim Öffnen. Die Eintragsliste kommt seitenweise vom Server (50 je Seite, „Weitere Einträge anzeigen“ lädt nach), Filter und Suche fragen den Server. Bei einem Fahrzeug mit rund 1.000 Einträgen schrumpft die Seite von 2,3 MB auf unter 50 KB. Die Fahrten kommen genauso seitenweise (50 je Seite, „Weitere Fahrten anzeigen“); der Abstand des Knopfs zur Liste darüber passt jetzt. Verbrauch und Kennzahlen rechnet die API dabei rund zehnmal so schnell.

### Technik
- **API: alle Listen seitenweise** (#160): `GET /vehicles`, `/fillups`, `/entries`, `/trips`, `/media`, `/invitations`, `/auth/tokens`, `/auth/users` und `/feedback` liefern `{ data, pagination }` statt einer reinen Liste, mit `?page=` und `?per_page=` (Standard 25, höchstens 100; `limit` als Alias, `offset` entfällt). `/trips` liefert zusätzlich `months` (Anzahl und km der Monate auf der Seite) und `years`. Neu `GET /vehicles/:id/timeline`: Tank-/Ladevorgänge, Ausgaben und Fahrten gemischt mit Filter, Suche und Monatssummen. Die iOS-App ist im selben Zug angepasst (FuelStat/fuelstat-ios). Verbrauchsabschnitte per laufender Summe statt Unterabfrage je Abschnitt.
- Gemeinsames Design-Dokument `docs/design.md` (#153) für Web, PWA, iOS und Android: Farben für hell und dunkel, Schriftrollen, Abstände, Radien, Zuordnung zu CSS, SwiftUI und Compose, Plattform-Leitplanken und Barrierefreiheit. Die Farb- und Abstandswerte stehen als `--fs-*`-Variablen in `css/style.css` bereit; sichtbar ändert sich noch nichts, die Umstellung folgt mit der Neugestaltung.
- Ausrollen: `sudo infra/ausrollen.sh main` rollt den neuesten Stand von `main` zwischen zwei Releases aus – in derselben Reihenfolge wie ein Release (Migrationen vor dem Neustart), die API wird dabei aus dem Code gebaut. Zurück auf ein Release mit `sudo infra/ausrollen.sh X.Y.Z`.
- Aufgeräumt: 16 nicht genutzte Font-Awesome-Stylesheets (≈ 490 KB, genutzt wird nur `css/all.min.css`), ungenutzte Funktionen in PHP und API, Reste der nie gültigen Antriebsart `petrol`. Altlasten für ältere Installationen entfernt: Migrationen 002–020 (in `postgres_init.sql` enthalten), die Umwandlung unverschlüsselter 2FA-Schlüssel beim Start, `scripts/bilder-optimieren.js` (#103) und die einmaligen Umstiegsanleitungen in `docs/betrieb.md`.
- API: Die alten Feldnamen `liters` und `priceTotalEur` (Anfrage) sowie `liters`, `price_total_eur` und `price_per_liter` (Antwort der Tank-/Ladevorgänge) entfallen; es gelten `amount`, `totalCostEur`, `total_cost_eur` und `price_per_unit`. Web-App und iOS-App nutzen sie nicht. Während der Beta dürfen solche Felder entfallen, ab 1.0.0 nicht mehr (`CLAUDE.md`).
- API (#140, abwärtskompatibel): `GET /fuels`, `fuels`/`defaultFuel` an Fahrzeugen, `fuel` an Tank-/Ladevorgängen und im Import, `energies`/`byEnergy`/`byFuel`/`costPer100km` in `/consumption`, `energies` in `/stats` und `/costs`. Bisherige Felder je Einheit bleiben.

### Hinweise zum Update
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

### Neu
- **Fahrzeuge teilen** (#53): Fahrzeuge lassen sich per E-Mail mit anderen Konten teilen – als Mitfahrer (sehen und erfassen, eigene Einträge ändern) oder nur zum Ansehen. Einladungen gelten 14 Tage und nur für die eingeladene, bestätigte Adresse. Bei jedem Eintrag steht, wer ihn erfasst hat. Mitglieder können ein Fahrzeug verlassen, der Besitzer kann Rollen ändern und Mitglieder entfernen; Einträge bleiben beim Fahrzeug. Teilen ist eine Plus-Funktion des Besitzers.
- **Fahrtenbuch** (#52): eigener Reiter „Fahrten“ mit Tachostand Start und Ende, Von/Nach, Zweck (privat, dienstlich, Arbeitsweg) und Notiz; km je Monat und Zweck, Anteil dienstlich, geschätzte Kosten je Zweck, Filter nach Jahr und Zweck, CSV-Export (Plus). Bisherige Fahrten werden übernommen. Fahrten liefern Tachostände für Prüfung, aktuellen Stand und Termine. Ein Fahrtenbuch zur eigenen Übersicht, kein vom Finanzamt anerkanntes.
- **E-Mail-Adresse bestätigen** (#135): Neue Konten bestätigen ihre Adresse über einen Link (24 Stunden gültig). Bis dahin sind ein Fahrzeug und ein Eintrag möglich. Eine geänderte Adresse gilt erst nach Bestätigung. Bestehende Konten gelten als bestätigt.
- **Passwort vergessen** (#141): Link per Mail, eine Stunde gültig und nur einmal verwendbar. Danach ist man auf allen Geräten abgemeldet; eine aktive 2FA bleibt aktiv. Die Seite verrät nicht, ob es ein Konto mit der Adresse gibt.
- **Nutzungsbedingungen** (#135): eigene Seite, Zustimmung bei der Registrierung; bestehende Konten stimmen beim nächsten Aufruf einmal zu, ebenso nach einer neuen Fassung.
- Offline lesen (#1): Ohne Internetverbindung zeigt die installierte App bzw. der Browser die zuletzt geladene Übersicht und die zuletzt geöffneten Fahrzeugseiten samt Fahrzeugbildern mit einem Hinweis auf den Stand. Speichern ist offline gesperrt. Die gespeicherten Seiten bleiben auf dem Gerät und werden beim Abmelden, bei jeder Anmeldung und nach 7 Tagen verworfen.
- Zum Aktualisieren nach unten ziehen in der installierten App (iOS und Android), wie in nativen Apps. Nicht in Formularen mit ungespeicherten Eingaben.

### Behoben
- Installation als App: Das 512-Pixel-Icon im Manifest zeigte auf eine fehlende Datei. Android/Chrome nutzt jetzt ein passendes Icon, dazu ein randloses Icon für den Home-Bildschirm unter Android (maskable) und iOS (`apple-touch-icon`) statt eines Icons mit hellen Ecken.

### Sicherheit
- Keine Erinnerungen und Berichte mehr an unbestätigte E-Mail-Adressen; eine neue Adresse kann ein Konto erst nach Bestätigung übernehmen (#135).

### Technik
- Release-Prozess (#134): Ein Tag baut das API-Image `ghcr.io/fuelstat/fuelstat-api:X.Y.Z`; `infra/ausrollen.sh X.Y.Z` rollt eine veröffentlichte Version aus (Hinweise anzeigen, Image laden, Code aufs Tag, Migrationen vor dem Neustart, API starten, PHP-FPM neu laden, Health prüfen) und rollt genauso zurück. Die CI verlangt in jedem PR einen Eintrag unter `[Unreleased]` (Label `kein changelog` zum Überspringen).
- Zentrale Zugriffsprüfung für Fahrzeuge (`services/vehicleAccess.js`) statt „gehört mir“ an rund 40 Stellen; Statistik, Kosten, Verbrauch, Termine und Monatsbericht rechnen über alle Einträge eines Fahrzeugs (#53).
- `manifest.json` mit `id`, `scope`, Sprache und Kategorien.
- API-Dokumentation (`docs/openapi.1.0.0.yaml`): Login mit 2FA vollständig beschrieben (Beispiele mit und ohne Code, Antworten `mfa_required` mit `mfaToken`, `invalid_mfa_code`, `429 too_many_attempts`); fehlende Felder in `/health` (`version`, `registration_enabled`, `beta_phase`), Benutzer, Fahrzeugen und Einträgen ergänzt – strenge Validatoren und Code-Generatoren lehnten echte Antworten bisher ab. Pfade nach Bereichen sortiert.
- Die CI prüft, dass jede API-Route in der OpenAPI dokumentiert ist (`tests/openapi_abgleich.py`).
- Neue API-Endpunkte unter `/api/v1`, alle abwärtskompatibel: `/auth/verify-email`, `/auth/resend-verification`, `/auth/accept-terms`, `/auth/forgot-password`, `/auth/reset-password`, `/vehicles/:id/members`, `/vehicles/:id/invitations`, `/invitations`, `/trips`, `/vehicles/:id/trips` (mit `summary` und `export`); neue Felder in `/health`, `/whoami`, Fahrzeugen und Einträgen (siehe `docs/api.md`).

### Hinweise zum Update
- **Ab dieser Version mit dem Skript ausrollen** (#134): `sudo infra/ausrollen.sh 0.11.0` im Projektordner. Es spielt die Migrationen 017, 018, 019 und 020 selbst vor dem Neustart der API ein. Beim ersten Mal steht das Skript erst nach `git pull` bzw. `git fetch --tags && git checkout v0.11.0` zur Verfügung. Von Hand: Migrationen einspielen, **bevor** die API neu startet:
  `cd infra && for m in 017_email_verification 018_vehicle_sharing 019_trips 020_password_resets; do sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_$m.sql; done`
- **Image öffentlich stellen:** Nach dem ersten Release unter GitHub → FuelStat → Packages → `fuelstat-api` → Package settings die Sichtbarkeit auf „Public“ stellen (sonst `sudo docker login ghcr.io` auf dem Server).
- **Nutzungsbedingungen einschalten:** in `infra/.env` `TERMS_VERSION=2026-11-09` setzen (Text: `includes/nutzungsbedingungen_text.php`, Betreiberangaben aus `includes/betreiber.php`). Ohne den Eintrag gibt es keine Zustimmung.
- **Links in Mails:** Bestätigungs- und Einladungsmails verlinken auf `APP_URL` (in `infra/.env`, z. B. `APP_URL=https://tanken.1emc.de`); ohne `APP_URL` enthalten sie nur den Code bzw. den Hinweis auf die Anmeldung. E-Mail-Bestätigung abschalten: `EMAIL_VERIFICATION=false`.
- Im Repository einmal das Label `kein changelog` anlegen (für PRs ohne sichtbare Änderung).

## [0.10.0] - 2026-11-08

### Sicherheit
- Gelöschte Konten: Bereits ausgestellte Tokens gelten nicht mehr – die API prüft bei jeder Anfrage, ob das Konto noch existiert. Vorher blieb ein Token bis zu 7 Tage gültig, bei Admins aus `ADMIN_USER_IDS` sogar mit Admin-Rechten.
- Login-Sperre je IP-Adresse und E-Mail statt nur je E-Mail, dazu ein Limit je IP über alle Konten: Fremde können ein Konto nicht mehr durch absichtliche Fehlversuche 15 Minuten lang aussperren. Das PHP-Frontend gibt dafür die Besucher-IP an die API weiter.
- 2FA-Codes gelten nur noch einmal (RFC 6238); ein abgefangener Code lässt sich nicht innerhalb seines Zeitfensters erneut verwenden.
- Abgewiesene Admin-Zugriffe werden mit dem Routenmuster statt der aufgerufenen Adresse protokolliert, damit keine Eingaben des Clients ins Log gelangen (Code-Scanning, Log-Injection).
- Rate-Limit: Ob eine Anfrage je Konto oder je IP gezählt wird, entscheidet nur noch das geprüfte Token, nicht ob der Client überhaupt eines mitschickt (Code-Scanning).
- Tankstellen- und Ladestationssuche nehmen Koordinaten und Radius nur noch als Dezimalzahlen an (z. B. `48.85235`); Hex- oder Exponent-Schreibweisen wie `0x10` werden mit 400 abgelehnt.
- Tarifänderungen werden protokolliert (wer, wann, von welchem zu welchem Tarif, über welchen Weg); abgewiesene Zugriffe auf Admin-Funktionen erscheinen im Log. Admins sehen den Verlauf je Konto über die API. Automatische Tests belegen, dass normale Konten ihren oder fremde Tarife nicht ändern können (#102).

### Neu
- API: `GET /api/v1/vehicles/:vehicleId/consumption` liefert Verbrauch je Einheit (Abschnitte, Monate, Jahre, Ø/Min/Max), gekaufte Mengen, CO₂ und den Stromanteil; `/stats` zusätzlich die Fahrleistung, `/costs` Summen je Kategorie und die Jahre mit Kosten (#82).
- API: `GET /api/v1/vehicles/:vehicleId/costs` liefert Kosten je Fahrzeug – Summen nach Energie und Ausgaben, Kosten pro km, Ø je Monat, laufender Monat und Vormonat sowie Monatssummen je Eintragsart, optional für ein Jahr (#124).
- API: `GET /api/v1/charging-stations` liefert Ladestationen in der Nähe (Open Charge Map) für Web-App und Apps (#123).
- Betreiber können Tarife auch ohne Web-Oberfläche setzen: `node scripts/tarif-setzen.js` im API-Container (siehe `docs/betrieb.md`, „Tarife verwalten“).

### Verbessert
- Statistik, Übersicht, Ausgaben und Bericht zeigen nur noch Werte, die die API rechnet (Verbrauch, CO₂, Stromanteil, Fahrleistung, Kosten je Kategorie, Monat und Jahr). Web-App und Apps haben damit dieselben Zahlen; Statistik und Übersicht laden dafür nicht mehr alle Einträge (#82).
- Kosten pro km, Ø je Monat, Strecke und Kosten je Monat in den Reitern „Ausgaben“ und „Statistiken“ kommen aus der API und sind damit in Web-App und Apps gleich. Die Strecke zählt jetzt nur echte Tachostände, dafür auch „Kilometerstand notieren“; geschätzte Stände zählen nicht mehr mit (#124).
- Tankstellen- und Ladestationssuche im Erfassungsformular laufen über die API: gleiche Ergebnisse wie in den Apps, und die Tankstellensuche nutzt jetzt den Zwischenspeicher der API (vorher fragte die Web-App bei jeder Suche Tankerkönig) (#123).

### Technik
- API aufgeteilt (#110): `server.js` startet nur noch, `app.js` baut die Middleware-Kette, Endpunkte liegen je Fachbereich unter `backend/src/routes/`, Querschnitt unter `middleware/` und `lib/`, 2FA als Service. Verhalten und Endpunkte unverändert; Aufbau beschrieben in `docs/backend.md`.
- Die doppelte Verbrauchsrechnung im PHP-Frontend ist entfernt; ihre Testfälle laufen jetzt als API-Tests (#82).
- Die Web-App ruft Tankerkönig und Open Charge Map nicht mehr selbst auf; die API-Keys liegen nur noch in `infra/.env` statt in `api/key.key` und `api/ocm.key` (#123).
- Betriebsdoku: Reihenfolge beim Aktualisieren korrigiert – Datenbank-Migrationen werden jetzt ausdrücklich **vor** dem Neustart der API eingespielt, mit Sicherung vorab und Kontrolle der Version danach (`docs/betrieb.md`, README).

### Hinweise zum Update
- **Vor dem `git pull`** die API-Keys umziehen, sonst bricht der Pull wegen `api/ocm.key` ab: Tankerkönig-Key (aus `api/key.key`) als `TANKERKOENIG_API_KEY` und Open-Charge-Map-Key (aus `api/ocm.key`) als `OCM_API_KEY` in `infra/.env` eintragen; danach `git update-index --no-skip-worktree api/ocm.key && git checkout -- api/ocm.key`. Nach dem Ausrollen `api/key.key` löschen.
- Migration einspielen, **bevor** die API neu startet: `cd infra && sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_015_plan_changes.sql`
- Migration einspielen, **bevor** die API neu startet: `cd infra && sudo docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../backend/database/postgres_016_mfa_last_counter.sql`
- Läuft die Seite hinter Cloudflare: in nginx `real_ip` für die Cloudflare-Adressen einrichten (siehe `docs/installation.md`, „Hinter Cloudflare“), damit Login-Sperren je IP nicht viele Nutzer gemeinsam treffen. Ohne Cloudflare ist nichts zu tun.

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

[Unreleased]: https://github.com/FuelStat/fuelstat/compare/v0.12.2...HEAD
[0.12.2]: https://github.com/FuelStat/fuelstat/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/FuelStat/fuelstat/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/FuelStat/fuelstat/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/FuelStat/fuelstat/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/FuelStat/fuelstat/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/FuelStat/fuelstat/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/FuelStat/fuelstat/releases/tag/v0.9.0
