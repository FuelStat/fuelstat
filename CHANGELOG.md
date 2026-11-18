# Changelog

Alle nennenswerten Änderungen an Fuelstat. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionsnummern nach [Semantic Versioning](https://semver.org/lang/de/): `MAJOR.MINOR.PATCH`. Bis zum Ende der Beta bleibt die Hauptversion 0.

Kategorien je Version: **Neu**, **Verbessert**, **Behoben**, **Sicherheit**, **Technik**. Die App zeigt diese Datei unter „Neuigkeiten“ an. Was Betreiber beim Ausrollen tun müssen (einmalige Befehle, Einstellungen, Migrationen), steht **nicht** hier, sondern in [`docs/update-hinweise.md`](docs/update-hinweise.md).

## [Unreleased]

### Sicherheit
- Registrieren verrät nicht mehr, ob es für eine Adresse schon ein Konto gibt: Fuelstat schickt einen Link per Mail, und erst mit diesem Link entsteht dein Konto. Der Link gilt 7 Tage, nach 5 Tagen kommt eine Erinnerung. Gibt es die Adresse schon, bekommt ihr Inhaber stattdessen einen Hinweis mit dem Weg zur Anmeldung und zu „Passwort vergessen?“ (#141).
- Konten, deren Adresse nie bestätigt wurde, werden nach einer Erinnerung gelöscht, frühestens 2 Tage danach (#141).
- Schutz vor Massen-Registrierungen und Mail-Fluten: Von einem Anschluss gehen nur noch wenige Registrierungen je Stunde und Tag, an eine Adresse höchstens 3 Registrierungsmails am Tag (#198).

### Technik
- `POST /auth/register` antwortet mit Mailserver mit 202 ohne Token; das Konto legt erst `POST /auth/verify-email` an (`accountCreated`). iOS-Apps vor 0.2.3 bekommen übergangsweise die alte Antwort. Neue Grenze je IP mit 429 und `Retry-After`, neuer Admin-Endpunkt `GET /auth/registrations`. Das nginx-Beispiel schaltet HTTP/2 nicht mehr ein (#141, #198, #231).

## [0.14.0] - 2026-11-18

### Verbessert
- Ruhigere Texte: Gedankenstriche sind aus Oberfläche, Mails, Push-Nachrichten und Neuigkeiten verschwunden, dort stehen jetzt Punkt, Komma oder Doppelpunkt. Fehlende Werte zeigen überall einen kurzen Strich, den Screenreader als „keine Angabe“ vorlesen; mitten im Satz steht ein Wort wie „noch nie“ oder „ohne Datum“ (#209).
- Profil in Gruppen: Konto, Fahrzeuge, Daten, Benachrichtigungen, Über und Darstellung. Passwort und Zwei-Faktor-Schutz findest du unter „Profil und Sicherheit“. Berichte, CSV-Export (auch das Fahrtenbuch) und Import stehen gesammelt im Menü „Berichte und Export“ bei den Einträgen, erreichbar auch über Profil → Daten. Status (verkauft, stillgelegt) und Löschen eines Fahrzeugs stehen nur noch in den Fahrzeugdaten, „Fahrzeug bearbeiten“ enthält nur die Stammdaten (#206).
- Flotten-Tarif: Ab zwei aktiven Fahrzeugen zeigt Start alle Fahrzeuge als Karten mit Tachostand, Verbrauch und fälligen Terminen. Ein Tipp öffnet die Übersicht des Fahrzeugs, „Alle Fahrzeuge“ führt zurück (#206).
- Neuer Aufbau, gleich wie in den Apps: Die untere Leiste heißt **Start · Einträge · ＋ · Statistik · Profil**. Statt einer Fahrzeugseite mit sieben Reitern gibt es eigene Seiten: Einträge, Statistik (Verbrauch und Kosten), dazu Service mit allen Terminen, Fahrten und Fahrzeugdaten unter „Mehr zum Fahrzeug“ auf Start bzw. am PC im Menü „Fahrzeug“. Die Liste der Fahrzeuge steht im Profil. Alte Lesezeichen führen weiter an die richtige Stelle (#206).
- Eigene Seite „Seite nicht gefunden“ im Aussehen der App statt der Standardseite des Servers, mit „Zur Startseite“; ist der Server kurz nicht erreichbar, erscheint eine ruhige Seite mit „Erneut versuchen“ (#211).
- Fehlermeldungen im Klartext: Statt Fehlercodes wie „server_error“ sagt Fuelstat, was passiert ist und was du tun kannst. Beim Filtern und Nachladen von Einträgen und Fahrten erscheinen Platzhalter statt eines leeren Bereichs, bei Problemen eine Meldung mit „Erneut versuchen“ und ohne Netz „Keine Verbindung“. Ein leerer Filter bietet „Zurücksetzen“ (#211).
- Jede Seite hat einen eigenen Titel im Browser-Tab, auch Anmelden, Registrieren, Datenschutz und Impressum (#211).
- Fahrzeugwahl nur für die Sitzung: Nach dem Anmelden zeigt Start das erste Fahrzeug der Reihenfolge (einstellbar unter Profil → Fahrzeuge). Ein anderes gewähltes Fahrzeug gilt für Start, Einträge, Statistik und „＋“, bis du dich abmeldest; das Fahrzeug-Cookie entfällt. „Einträge“, „Statistik“ und „＋“ fragen nicht mehr nach dem Fahrzeug (#206).
- Einheitliche Begriffe in allen Apps: Der Knopf bei den Terminen heißt „Wartung eintragen“, der reine Kilometereintrag „Kilometerstand“, die Liste „Fahrzeuge“ (im Wechsler „Fahrzeuge verwalten“) und die Zwei-Faktor-Anmeldung überall „Zwei-Faktor-Schutz“. Die Seite „Passkeys“ zeigt auf dem Handy ihren Titel (#206).
- „Nächste Termine“ zeigt zuerst die Fristen (TÜV, Wartung, Versicherung, Steuer) und darunter die Bauteile; der letzte Reifenwechsel steht nicht mehr doppelt da, wenn Sommer- oder Winterreifen schon als Bauteil erscheinen (#206).
- Reiter „Ausgaben“: Ohne gewähltes Jahr steht nur noch die Karte „Gesamtkosten“ mit Summe, pro Monat und pro Kilometer. Bisher standen dieselben Kennzahlen darunter noch einmal mit anderen Werten. Mit gewähltem Jahr erscheinen die Zahlen dieses Jahres unter „Ausgaben im Jahr …“ (#206).
- Leere Werte in Kacheln und Tabellen zeigen einen kurzen Strich „–“, den Screenreader als „keine Angabe“ vorlesen (#209).

### Sicherheit
- Texte haben eine Obergrenze: Fahrzeugname, Marke, Modell und Benutzername 100 Zeichen, Tankstelle, Ort und Anbieter 200, Beschreibungen und Notizen 2.000. Bisher ließen sich beliebig lange Texte speichern, die Listen, Export, Berichte und Mails sprengen konnten. Die Formulare zeigen die Grenze schon beim Tippen, der CSV-Import markiert zu lange Zeilen in der Vorschau (#197).
- Fahrzeug- und Profilbilder lassen sich nur noch aus eigenen Uploads setzen. Bisher nahm die API jede Adresse an; über ein geteiltes Fahrzeug hätte so ein Bild von einem fremden Server die IP-Adresse der anderen verraten können. Solche Adressen werden beim Update entfernt, das Bild fällt dann auf den Platzhalter zurück. Beim Löschen eines Kontos werden nur noch dessen eigene Dateien entfernt (#196).

### Technik
- API: Zu lange Freitexte ergeben 400 `invalid_<feld>` mit der Grenze in `max` (z. B. `invalid_station`, `max: 200`); Fahrten kürzen Orte und Notiz nicht mehr stumm auf 200 Zeichen, die Notiz darf jetzt 2.000 haben. Der Import meldet zu lange Texte je Zeile (#197).
- API: `imageUrl` (Fahrzeuge) und `profileImageUrl` (Konto) antworten bei fremden Adressen und Dateien anderer Konten mit 400 `invalid_imageUrl` bzw. `invalid_profileImageUrl` (#196).
- API: Termine (`/vehicles/:id/reminders`) haben das Feld `group` (`deadline`, `part`, `estimate`, `info`) und kommen in dieser Reihenfolge (#206).
- Releases in einem Zug: `infra/veroeffentlichen.sh X.Y.Z` prüft den gemergten Release-PR und die CI, setzt das Tag, wartet auf GitHub-Release und API-Image, sichert und rollt aus. `infra/ausrollen.sh` bricht früh mit einer klaren Meldung ab, wenn ein Tag auf dem falschen Commit steht.

## [0.13.1] - 2026-11-17

### Neu
- Eigener CO₂-Wert für Strom: Bei Elektroautos und Plug-in-Hybriden lässt sich in den Fahrzeugdaten ein eigener Wert in kg CO₂ je kWh eintragen, z. B. für Ökostrom oder Strom aus der eigenen PV-Anlage. Ohne Angabe rechnet Fuelstat weiter mit dem deutschen Strommix (#25).

### Behoben
- CSV-Import: Die Spalte „Voll getankt/geladen“ aus dem eigenen Export wird wieder erkannt. Bisher galt beim erneuten Import jede Tankfüllung als Teilfüllung (#191).
- Darstellung auf dem Handy: Der Schließen-Knopf von Meldungen sitzt rechts auf Höhe des Textes, Kennzahl-Kacheln füllen jede Reihe (keine einzelne halbe Kachel mehr), und die Liste „Nächste Termine“ hat ein festes Muster mit Symbol an der Überschrift, Status darunter und höchstens zwei Zeilen Beschreibung (#205).

### Technik
- API: Die Eintragsliste (`/vehicles/:id/timeline`) filtert mit `missing_odometer=1` Tank- und Ladevorgänge ohne echten Tachostand und nennt deren Anzahl (`missingOdometer`), damit die Apps fehlende Kilometerstände vollständig auflisten können (#187).
- Release-Skript `neue-version.js`: setzt die neue Versionsüberschrift nur noch unter die Überschrift `## [Unreleased]`, nicht mehr in den Einleitungstext von `docs/update-hinweise.md`.
- Hinweise für Betreiber (einmalige Befehle, Einstellungen) stehen nicht mehr im CHANGELOG, sondern in `docs/update-hinweise.md`; `infra/ausrollen.sh` zeigt sie von dort an, `node backend/scripts/neue-version.js` schließt beide Dateien ab.

## [0.13.0] - 2026-11-15

### Neu
- **Anmelden mit Passkey** (#2): Unter „Profil“ → „Passkeys“ richtest du Face ID, Fingerabdruck, Windows Hello oder einen Sicherheitsschlüssel ein. Danach meldest du dich mit „Mit Passkey anmelden“ oder direkt aus den Vorschlägen im E-Mail-Feld an, ohne Passwort und ohne 2FA-Code. Das Passwort bleibt als Rückfallweg. Fuelstat speichert nur den öffentlichen Schlüssel.
- **Gesamtkosten und Wertverlust** (#79): Im Reiter „Ausgaben“ zeigt die Karte „Gesamtkosten“, was das Fahrzeug über die ganze Besitzzeit gekostet hat: laufende Kosten (Tanken/Laden, Versicherung, Steuer, Wartung, Reparatur, Reifen, Sonstiges, auch gebuchte Leasing- und Finanzierungsraten) plus Wertverlust (Kaufpreis minus geschätzter Restwert bzw. Verkaufserlös), dazu Kosten pro Monat und pro km, Wertverlust pro Jahr und die Anteile der Kostengruppen. Fehlen Kaufpreis oder Restwert/Erlös, bleibt der Wertverlust leer und die Karte sagt es, nichts wird geschätzt. Neues Feld „Geschätzter Restwert“ unter „Fahrzeug bearbeiten“ → „Kauf und Termine“; der „Gesamtkosten-Bericht“ lässt sich drucken oder als PDF speichern (Menü „Export und Import“ im Reiter „Einträge“ bzw. Knopf „Bericht“ an der Karte). Für alle Tarife.

### Verbessert
- **CSV-Export der Einträge ohne Fahrten** (#184): Die Datei unter „Export und Import“ enthält Tanken/Laden, Ausgaben und Kilometerstände. Fahrten stehen im Export des Fahrtenbuchs (Reiter „Fahrten“).
- **Verkaufte und stillgelegte Fahrzeuge** (#79): Unter „Fahrzeug bearbeiten“ → „Status“ markierst du ein Fahrzeug als verkauft (mit Datum, Tachostand und Erlös) oder stillgelegt (mit Zeitraum). Es wandert in „Meine Fahrzeuge“ in den eingeklappten Bereich „Archiv“, alle Daten, Statistiken und Exporte bleiben lesbar, ändern lässt sich nichts, bis du es wieder aktivierst. Für archivierte Fahrzeuge gibt es keine Termin-Erinnerungen, keine Mails und keinen Monatsbericht; Wechsler, Start und Schnellerfassung zeigen nur aktive Fahrzeuge. Mit Tarifgrenzen (siehe unten) zählen aktive und archivierte Fahrzeuge getrennt.
- **Kostengruppen, Wartung je 10.000 km und größte Ausgaben kommen aus der API** (#180): `GET /vehicles/:id/costs` liefert Summen je Kostengruppe (insgesamt, je Monat und je Jahr), die Wartungskosten je 10.000 km und die fünf größten Einzelausgaben. Der Reiter „Ausgaben“ zeigt dieselben Zahlen wie bisher, rechnet „Wartung je 10.000 km“ und „Größte Einzelausgaben“ aber nicht mehr selbst. Bestehende Werte ändern sich nicht.
- **Service-Historie je Bauteil** (#78): Bei Werkstatt, Wartung, Reparatur, Inspektion und Reifen wählst du, was gewechselt wurde (Motoröl & Filter, Bremsbeläge vorn/hinten, Bremsscheiben, Bremsflüssigkeit, Sommer-/Winterreifen, Batterie, Zündkerzen, Innenraumfilter, Klimaservice, Zahnriemen oder eigene Bauteile), bei mehreren Bauteilen optional mit Kostenanteil. Der neue Reiter „Service“ zeigt je Bauteil den letzten Wechsel, die Historie, die Lebensdauer (km und Monate zwischen zwei Wechseln) und den nächsten Wechsel. Den nächsten Wechsel legst du mit einem eigenen Intervall fest (Zeit und/oder km, was zuerst kommt); ohne Intervall schätzt Fuelstat ihn ab dem zweiten Wechsel aus der bisherigen Lebensdauer und kennzeichnet ihn als „ca.“. Eine Schätzung ist nie „überfällig“ und löst keine E-Mail und keinen Push aus. Bauteile mit Intervall erscheinen unter „Nächste Termine“ und in den Erinnerungen, CSV-Export und -Import haben eine Spalte „Bauteile“, der Bericht enthält die Service-Historie. Bestehende Einträge bekommen keine Bauteile; Fuelstat rät nichts.
- **Verbrauch auch ohne „voll geladen“** (#25): Mit dem **Ladestand nachher** rechnet Fuelstat den Verbrauch zwischen zwei Ladungen aus, auch wenn du nie auf 100 % lädst. Wie viele kWh ein Prozent sind, ergibt sich aus deinen eigenen Ladungen (Wallbox-Menge inklusive Ladeverlusten). Wo es keinen einzigen Abschnitt gibt, zeigt Fuelstat den Verbrauch aus der Summe aller Ladungen ÷ Strecke und sagt das dazu. Bisherige Verbrauchswerte ändern sich nicht.
- **Ladevorgänge genauer erfassen** (#25): Beim Laden kannst du jetzt die **Ladeart** (zu Hause/Wallbox, AC öffentlich, DC-Schnelllader), den **Ladestand vorher und nachher** und die **Ladedauer** angeben, alles freiwillig. Die Eintragsliste zeigt sie an. „Statistiken“ wertet Ladungen nach Ladeart aus (Anteil, Ø Preis je kWh, Ø Leistung, zu Hause gegen unterwegs). Ladungen ohne Angabe stehen als eigene Zeile, bestehende Auswertungen ändern sich nicht. CSV-Export und -Import kennen die neuen Spalten; ältere Dateien funktionieren weiter.
- **Plug-in-Hybride: Energiekosten je 100 km als Hauptkennzahl** (#156): Bei Plug-in-Hybriden stehen auf Start, Fahrzeugkarte, „Allgemein“, „Statistiken“ und im Bericht die Energiekosten in €/100 km über Benzin und Strom vorn; l/100 km und kWh/100 km bleiben daneben. „Statistiken“ zeigt dazu €/100 km je Monat und Jahr sowie den günstigsten und teuersten Monat, der Monatsbericht per E-Mail eine Zeile „Energiekosten je 100 km“. Benziner, Diesel, Elektro und Vollhybride bleiben unverändert.
- **Neue Startseite** (#158): Start zeigt jetzt wie in der iOS-App ein Fahrzeug (das zuletzt genutzte bzw. gewählte) mit großem Foto, Kennzeichen und Tachostand, drei Kennzahlen (Ø Verbrauch, Kosten je km, Kosten diesen Monat), den nächsten drei Terminen und den letzten fünf Einträgen. Oben wechselst du das Fahrzeug; alle Fahrzeuge als Karten (mit „Ordnen“) findest du unter „Fahrzeuge“ → „Alle Fahrzeuge“.
- **Mail-Links aus der iOS-App** (#175): Bestätigungs- und Passwort-Mails, die du in der App angefordert hast, bieten auf iPhone und iPad zusätzlich „Zurück zur Fuelstat-App“ bzw. „In der Fuelstat-App fortsetzen“. Im Browser geht beides weiterhin.

### Behoben
- **Ort „null“ nach dem Bearbeiten eines Tank-/Ladevorgangs**: Wurde ein Eintrag ohne Tankstelle bzw. Ladestation gespeichert, schrieb die API den Text „null“ als Ort. Jetzt bleibt der Ort leer; bereits betroffene Einträge bereinigt der Betreiber einmalig.
- **Passwort zurücksetzen meldet kein fremdes Konto mehr ab** (#175): Setzt du im Browser das Passwort eines anderen Kontos zurück, als dort angemeldet ist, bleibst du angemeldet; die Meldung nennt beide Konten. Nur das zurückgesetzte Konto wird auf allen Geräten abgemeldet.

### Technik
- Mindest-App-Version (#118): `GET /health` meldet für iOS `minimum_version` und `recommended_version` **0.2.2** (vorher 0.2.0). Ältere iOS-Apps bekommen `426 app_update_required`; erst ab 0.2.2 kennt die App archivierte Fahrzeuge (`409 vehicle_archived`), die Bauteil-Zeilen in den Erinnerungen und die neuen Felder dieser Version.
- CSV-Export der Einträge aus der API (#184): neuer Endpunkt `GET /vehicles/:id/export?year=` liefert dieselbe Datei wie bisher `pages/export.php` (Semikolon, UTF-8 mit BOM, Spalten je Antriebsart, Ladeangaben, Sorte, Bauteile); die Web-App reicht sie nur noch durch, damit Apps das Format nicht nachbauen müssen. Fahrten stehen nicht mehr in dieser Datei, sondern wie schon für Plus im Export des Fahrtenbuchs. Innerhalb eines Tages sind die Zeilen jetzt nach Erfassungszeit statt nach Tachostand sortiert.
- Gesamtkosten (#79): neuer Endpunkt `GET /vehicles/:id/tco` (laufende Kosten mit Gruppen und Kategorien, `valueLoss` = Kaufpreis minus Erlös/Restwert oder `null`, `complete`, `perMonth`, `perKm`, `valueLossPerYear`, `shares`), neues Fahrzeugfeld `residualValue` (Spalte `residual_value`, Migration 028). `/costs` zählt „Ø je Monat“ bei einem Fahrzeug mit Verkaufsdatum nur bis zum Verkaufsmonat.
- Fahrzeug-Lebenszyklus (#79): neue Spalten `status`, `sale_odometer_km`, `decommissioned_from`, `decommissioned_until` an `vehicles` (Migration 027). `PATCH /vehicles/:id` setzt sie über `status` (`active`, `sold`, `decommissioned`), `saleOdometerKm`, `decommissionedFrom`, `decommissionedUntil`; `GET /vehicles?status=active|archived|all`. Jede schreibende Anfrage zu einem archivierten Fahrzeug antwortet mit **409** `vehicle_archived` (zentrale Prüfung, Ausnahmen: Reihenfolge, Verkaufs-/Stilllegungsangaben, Wiederaktivieren, Löschen, Mitglieder und Einladungen entfernen). `/reminders` ist für archivierte Fahrzeuge leer. `/whoami` `features` enthält `maxArchivedVehicles` (Free 1, Plus 5, Flotte 25; wie `maxVehicles` nur mit `PLAN_LIMITS_ENABLED=true`, sonst `null`).
- `/vehicles/:id/consumption` und `/vehicles/:id/stats` liefern `primary` (Hauptkennzahl, von der API je Antriebsart festgelegt), `/consumption` zusätzlich `costPer100kmPeriods` (€/100 km je Monat und Jahr, günstigster und teuerster Monat) (#156). Keine Migration.
- `/costs` (#180): neue Felder `groups`, `maintenancePer10000Km`, `largestExpenses`, `byYear` und `months[].byGroup`, alle abwärtskompatibel. OpenAPI: `sortOrder`, `odometerKm`, `brand`, `model`, `year`, `imageUrl`, `mileageKm` in `VehicleCreateRequest` und `VehiclePatchRequest` (#181).
- Service-Historie (#78): neue Endpunkte `GET`/`POST /vehicles/:id/parts`, `PATCH`/`DELETE …/parts/:partId`, `PUT …/part-intervals/:key`, `GET …/service`; `/entries` (POST, PATCH, Listen), die Eintragsliste und der Import kennen `parts`; `/categories` meldet `allowsParts`; `/reminders` enthält zusätzlich Zeilen zu Bauteilen (`category` `part:<key>`, `source` `bauteil` oder `lebensdauer`). Migration 026 (`vehicle_parts`, `expense_parts`, `vehicle_part_intervals`).
- Verbrauch (#25): `/stats` und `/consumption` begrenzen Abschnitte auch durch Ladungen mit `soc_after_pct` (`method` je Abschnitt: `full` oder `level`) und liefern `avgMethod`, `sumConsumption` und `coverage`; ohne Abschnitt ist `avg` die Summenmethode. Keine Migration über 025 hinaus.
- Ladeangaben (#25): neue Spalten `charge_type`, `soc_before_pct`, `soc_after_pct`, `charge_minutes` an `fillups` (Migration 025), Eingabefelder `chargeType`, `socBeforePct`, `socAfterPct`, `chargeMinutes` bei `/fillups` und `/import`, `/consumption` liefert `chargeTypes`.
- Passkeys (#2): neue Endpunkte unter `/api/v1/auth/passkeys` (WebAuthn mit `@simplewebauthn/server` 14.0.3, im Browser `@simplewebauthn/browser` 14.0.0 unter `vendor/`), Tabelle `user_passkeys` (Migration 024), `/health` meldet `passkeys_enabled`.
- `POST /api/v1/auth/reset-password` antwortet zusätzlich mit `email` des zurückgesetzten Kontos. Links in Mails, die eine App angefordert hat (Kopfzeile `X-Fuelstat-Client`), tragen `&quelle=app` (#175).

## [0.12.2] - 2026-11-13

### Behoben
- **Tachostand-Prüfung** (#170): Zwei Einträge am selben Tag werden jetzt verglichen, z. B. morgens 12.000 km und abends 11.500 km ergibt eine Warnung. Der aktuelle Tachostand ist der jüngste Wert statt des höchsten; ein Tippfehler nach oben bleibt nicht mehr dauerhaft stehen und verfälscht Fahrleistung und km-Fälligkeiten nicht mehr.
- **TÜV aus der Erstzulassung** (#171): Ohne TÜV-Eintrag wird nur der erste TÜV (36 Monate nach Erstzulassung) berechnet, solange er bevorsteht. Bei älteren Fahrzeugen heißt es jetzt „Letzten Termin erfassen“ statt eines geratenen Datums.

### Verbessert
- **Reifen unter „Nächste Termine“** (#172): Der letzte Reifenwechsel kommt jetzt aus der API (`/reminders`, Zeile `Reifen`), ebenso Tachostand und Beschreibung des letzten Termins. Die Fahrzeugseite lädt dafür nicht mehr alle Ausgaben dreimal.

### Technik
- **Mindestversion der iOS-App 0.2.0** (#118): `/health` meldet für iOS `minimum_version` und `recommended_version` 0.2.0. Ältere App-Versionen (0.1.x) verstehen die Listen in Seiten (#160) nicht und bekommen 426 `app_update_required`.

## [0.12.1] - 2026-11-13

### Neu
- **Push-Benachrichtigungen** (#136): Termine, „Kilometerstand nachtragen“ und den Monatsbericht gibt es jetzt auch als Push-Benachrichtigung der installierten Web-App: auf Android, am Computer und auf dem iPhone/iPad ab iOS 16.4 (dort nach „Zum Home-Bildschirm“). Unter „Benachrichtigungen“ wählst du je Anlass E-Mail, Push oder beides, aktivierst Push auf dem Gerät mit einem Klick und schickst eine Testnachricht. Ein Tipp auf die Nachricht öffnet die passende Seite; anstehende Termine zeigt das App-Symbol als Zahl.
- **Hinweis „Lange kein Eintrag“** (#136): Wurde für ein Fahrzeug 30 Tage nichts erfasst, kommt auf Wunsch eine Erinnerung per E-Mail oder Push.
- **Angemeldete Apps** (#117): Unter Einstellungen → Sicherheit siehst du, auf welchen Geräten die iPhone- bzw. Android-App angemeldet ist (Name, App-Version, zuletzt genutzt), und kannst einzelne Geräte abmelden. „Auf allen Geräten abmelden“ und eine Passwortänderung melden auch alle Apps ab.

### Sicherheit
- **Gerätesitzungen für Apps** (#117): Apps bekommen statt eines 7-Tage-Tokens ein Zugriffstoken für 30 Minuten und ein Refresh-Token je Gerät. Es gilt nur einmal (wird bei jeder Verwendung getauscht) und steht nur als Hash in der Datenbank; taucht ein schon getauschtes Token noch einmal auf, endet die Sitzung dieses Geräts. Apps bleiben so monatelang angemeldet, ohne dass ein langlebiges Token auf dem Gerät liegt. Die Web-App meldet sich unverändert an.

### Technik
- **API für Push** (#136): `GET/PUT /notifications/preferences` (Kanäle je Anlass), `GET /push/config`, `GET/POST/DELETE /push/devices`, `DELETE /push/devices/:id`, `POST /push/test`. Versand über `web-push` mit VAPID; je Anlass TTL, Urgency und Topic, VAPID-JWT je Push-Dienst zwischengespeichert, abgemeldete Geräte (404/410) werden gelöscht. `push_devices` kennt schon APNs und FCM für die nativen Apps. `PUT /auth/mail-settings` lässt fehlende Felder für Termine und Monatsbericht jetzt unverändert.
- **API-Vertrag** (#118): Regeln für abwärtskompatible Änderungen, Fehlerformat und Abkündigungen in `docs/api.md`; ein Vertragstest prüft die Antworten der Endpunkte, die Apps nutzen, gegen die OpenAPI. `/health` liefert je Plattform Mindest- und empfohlene App-Version (`apps`); Apps mit dem Header `X-Fuelstat-Client`, die älter als die Mindestversion sind, bekommen 426 `app_update_required`. Beträge, Mengen und Strecken kommen jetzt überall als Zahl statt als Text; die Liste der Tank- und Ladevorgänge enthält `vehicle_id`. Kein gültiges JSON im Anfragekörper ergibt 400 `invalid_json` (bisher fälschlich `upload_error`), unbekannte Pfade 404 `not_found` als JSON statt einer HTML-Seite.
- API (#117): `device` bei `POST /auth/register`, `/auth/login` und `/auth/login/mfa`; neu `POST /auth/session/refresh`, `GET /auth/sessions`, `DELETE /auth/sessions/:id` (auch `current`). Doku in `docs/api.md` („Gerätesitzungen für Apps“) und OpenAPI.

### Verbessert
- **Barrierefreiheit** (#158): Jedes Diagramm hat eine Zusammenfassung für Screenreader (Zeitraum, Höchst- und Tiefstwert) und darunter „Werte als Tabelle“. Alle Buttons und Textlinks sind mindestens 44 px hoch bzw. so groß antippbar.
- Fahrzeugseite: „Fahrzeug löschen“ steht nur noch abgesetzt im Reiter „Einstellungen“, nicht mehr neben „Fahrzeug bearbeiten“. Das Erfassen heißt überall „Eintrag erfassen“.

### Behoben
- Fahrzeugseite: Das Diagramm „Letzte 6 Monate“ unter „Allgemein“ blieb seit 0.12.0 leer.
- Startseite: Die ganze Fahrzeugkarte führt wieder zum Fahrzeug, auch das Foto und die Kennzahlen, nicht nur der Name.

## [0.12.0] - 2026-11-12

### Neu
- **Mehrere Kraftstoffe je Fahrzeug** (#140): Unter „Antriebsart“ → „Erweitert“ wählst du, was ein Fahrzeug tankt bzw. lädt, z. B. Benzin und Autogas, Diesel und Premium-Diesel oder E5 und E10; einer davon ist der Standard. Beim Tanken wählst du die Sorte (bei nur einer Sorte bleibt alles wie bisher), die Tankstellensuche zeigt den Preis dieser Sorte. Verbrauch wird je Energieart gerechnet: E5, E10 und Super Plus zusammen als Benzin, Benzin und Autogas getrennt –, nur nebenbei getanktes Benzin beim Autogas-Auto zählt nicht als eigener Verbrauch. Die Statistik zeigt Preise je Sorte und den Mehrpreis von Premium-Sorten. Bestehende Fahrzeuge und Einträge bekommen ihre Sorte automatisch. CSV-Export und -Import mit Spalte „Sorte“.

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
- Ausrollen: `sudo infra/ausrollen.sh main` rollt den neuesten Stand von `main` zwischen zwei Releases aus, in derselben Reihenfolge wie ein Release (Migrationen vor dem Neustart), die API wird dabei aus dem Code gebaut. Zurück auf ein Release mit `sudo infra/ausrollen.sh X.Y.Z`.
- Aufgeräumt: 16 nicht genutzte Font-Awesome-Stylesheets (≈ 490 KB, genutzt wird nur `css/all.min.css`), ungenutzte Funktionen in PHP und API, Reste der nie gültigen Antriebsart `petrol`. Altlasten für ältere Installationen entfernt: Migrationen 002–020 (in `postgres_init.sql` enthalten), die Umwandlung unverschlüsselter 2FA-Schlüssel beim Start, `scripts/bilder-optimieren.js` (#103) und die einmaligen Umstiegsanleitungen in `docs/betrieb.md`.
- API: Die alten Feldnamen `liters` und `priceTotalEur` (Anfrage) sowie `liters`, `price_total_eur` und `price_per_liter` (Antwort der Tank-/Ladevorgänge) entfallen; es gelten `amount`, `totalCostEur`, `total_cost_eur` und `price_per_unit`. Web-App und iOS-App nutzen sie nicht. Während der Beta dürfen solche Felder entfallen, ab 1.0.0 nicht mehr (`CLAUDE.md`).
- API (#140, abwärtskompatibel): `GET /fuels`, `fuels`/`defaultFuel` an Fahrzeugen, `fuel` an Tank-/Ladevorgängen und im Import, `energies`/`byEnergy`/`byFuel`/`costPer100km` in `/consumption`, `energies` in `/stats` und `/costs`. Bisherige Felder je Einheit bleiben.

## [0.11.0] - 2026-11-09

### Neu
- **Fahrzeuge teilen** (#53): Fahrzeuge lassen sich per E-Mail mit anderen Konten teilen: als Mitfahrer (sehen und erfassen, eigene Einträge ändern) oder nur zum Ansehen. Einladungen gelten 14 Tage und nur für die eingeladene, bestätigte Adresse. Bei jedem Eintrag steht, wer ihn erfasst hat. Mitglieder können ein Fahrzeug verlassen, der Besitzer kann Rollen ändern und Mitglieder entfernen; Einträge bleiben beim Fahrzeug. Teilen ist eine Plus-Funktion des Besitzers.
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
- API-Dokumentation (`docs/openapi.1.0.0.yaml`): Login mit 2FA vollständig beschrieben (Beispiele mit und ohne Code, Antworten `mfa_required` mit `mfaToken`, `invalid_mfa_code`, `429 too_many_attempts`); fehlende Felder in `/health` (`version`, `registration_enabled`, `beta_phase`), Benutzer, Fahrzeugen und Einträgen ergänzt. Strenge Validatoren und Code-Generatoren lehnten echte Antworten bisher ab. Pfade nach Bereichen sortiert.
- Die CI prüft, dass jede API-Route in der OpenAPI dokumentiert ist (`tests/openapi_abgleich.py`).
- Neue API-Endpunkte unter `/api/v1`, alle abwärtskompatibel: `/auth/verify-email`, `/auth/resend-verification`, `/auth/accept-terms`, `/auth/forgot-password`, `/auth/reset-password`, `/vehicles/:id/members`, `/vehicles/:id/invitations`, `/invitations`, `/trips`, `/vehicles/:id/trips` (mit `summary` und `export`); neue Felder in `/health`, `/whoami`, Fahrzeugen und Einträgen (siehe `docs/api.md`).

## [0.10.0] - 2026-11-08

### Sicherheit
- Gelöschte Konten: Bereits ausgestellte Tokens gelten nicht mehr: Die API prüft bei jeder Anfrage, ob das Konto noch existiert. Vorher blieb ein Token bis zu 7 Tage gültig, bei Admins aus `ADMIN_USER_IDS` sogar mit Admin-Rechten.
- Login-Sperre je IP-Adresse und E-Mail statt nur je E-Mail, dazu ein Limit je IP über alle Konten: Fremde können ein Konto nicht mehr durch absichtliche Fehlversuche 15 Minuten lang aussperren. Das PHP-Frontend gibt dafür die Besucher-IP an die API weiter.
- 2FA-Codes gelten nur noch einmal (RFC 6238); ein abgefangener Code lässt sich nicht innerhalb seines Zeitfensters erneut verwenden.
- Abgewiesene Admin-Zugriffe werden mit dem Routenmuster statt der aufgerufenen Adresse protokolliert, damit keine Eingaben des Clients ins Log gelangen (Code-Scanning, Log-Injection).
- Rate-Limit: Ob eine Anfrage je Konto oder je IP gezählt wird, entscheidet nur noch das geprüfte Token, nicht ob der Client überhaupt eines mitschickt (Code-Scanning).
- Tankstellen- und Ladestationssuche nehmen Koordinaten und Radius nur noch als Dezimalzahlen an (z. B. `48.85235`); Hex- oder Exponent-Schreibweisen wie `0x10` werden mit 400 abgelehnt.
- Tarifänderungen werden protokolliert (wer, wann, von welchem zu welchem Tarif, über welchen Weg); abgewiesene Zugriffe auf Admin-Funktionen erscheinen im Log. Admins sehen den Verlauf je Konto über die API. Automatische Tests belegen, dass normale Konten ihren oder fremde Tarife nicht ändern können (#102).

### Neu
- API: `GET /api/v1/vehicles/:vehicleId/consumption` liefert Verbrauch je Einheit (Abschnitte, Monate, Jahre, Ø/Min/Max), gekaufte Mengen, CO₂ und den Stromanteil; `/stats` zusätzlich die Fahrleistung, `/costs` Summen je Kategorie und die Jahre mit Kosten (#82).
- API: `GET /api/v1/vehicles/:vehicleId/costs` liefert Kosten je Fahrzeug: Summen nach Energie und Ausgaben, Kosten pro km, Ø je Monat, laufender Monat und Vormonat sowie Monatssummen je Eintragsart, optional für ein Jahr (#124).
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
- Betriebsdoku: Reihenfolge beim Aktualisieren korrigiert: Datenbank-Migrationen werden jetzt ausdrücklich **vor** dem Neustart der API eingespielt, mit Sicherung vorab und Kontrolle der Version danach (`docs/betrieb.md`, README).

## [0.9.1] - 2026-11-06

### Neu
- API: `GET /api/v1/stations` liefert Tankstellen in der Nähe mit aktuellen Preisen von Tankerkönig, damit die Apps beim Tanken Tankstelle und Preis vorschlagen können. Der API-Key bleibt auf dem Server.

### Technik
- Das Repository ist umgezogen nach [FuelStat/fuelstat](https://github.com/FuelStat/fuelstat); Links in App und Doku zeigen auf die neue Adresse. Die iOS-App entsteht in [FuelStat/fuelstat-ios](https://github.com/FuelStat/fuelstat-ios).
- Abhängigkeiten aktualisiert: express-rate-limit 8.7.3 (API), actions/setup-node 7 (CI).

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

[Unreleased]: https://github.com/FuelStat/fuelstat/compare/v0.14.0...HEAD
[0.14.0]: https://github.com/FuelStat/fuelstat/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/FuelStat/fuelstat/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/FuelStat/fuelstat/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/FuelStat/fuelstat/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/FuelStat/fuelstat/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/FuelStat/fuelstat/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/FuelStat/fuelstat/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/FuelStat/fuelstat/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/FuelStat/fuelstat/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/FuelStat/fuelstat/releases/tag/v0.9.0
