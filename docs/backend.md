# Aufbau der API (backend/src)

Die API ist ein **modularer Monolith**: ein Node.js-Prozess mit Express, aufgeteilt nach fachlicher Verantwortung (#110). Endpunkte und Formate stehen in [api.md](api.md) und [openapi.1.0.0.yaml](openapi.1.0.0.yaml).

```text
backend/src/
├── server.js        Startpunkt: App laden, Port öffnen, Hintergrundaufgaben (2FA-Secrets, Benachrichtigungen)
├── app.js           Express-App: Middleware-Kette und Einbinden der Routen
├── config.js        Umgebung: Pfade, Port, CORS, Version, Beta-Phase; prüft DATABASE_URL und JWT_SECRET
├── db.js            PostgreSQL-Pool
├── routes/          Endpunkte je Fachbereich (Pfade relativ zu /api/v1)
├── middleware/      Querschnitt: Anmeldung, Rate-Limits, Uploads
├── services/        Fachlogik, ohne Express (testbar ohne HTTP)
└── lib/             kleine technische Hilfen
```

## Wohin gehört was?

| Ordner | Inhalt | Regel |
|---|---|---|
| `routes/` | Ein `express.Router` je Fachbereich: Eingaben prüfen, Rechte prüfen, Service bzw. Datenbank aufrufen, Antwort senden | Keine Berechnungen, die auch ein anderer Endpunkt oder der Monatsbericht braucht – die gehören in `services/` |
| `services/` | Fachlogik: Statistik (`stats`, `consumption`, `costs`), Tarife (`plans`, `planChanges`), Kategorien, Fälligkeiten, Mail und Benachrichtigungen, Bilder, Stationssuchen, 2FA (`mfa`), E-Mail-Bestätigung (`emailVerification`), **Zugriff auf Fahrzeuge (`vehicleAccess`)**, Teilen (`sharing`), Fahrtenbuch (`trips`) | Kein `req`/`res`; Datenbank als Parameter (`db`) oder über `db.js` |
| `middleware/` | `auth` (Token, Admin, eigenes Konto), `rateLimits`, `upload` (multer, Typprüfung am Inhalt), `verified` (Grenzen ohne bestätigte E-Mail-Adresse) | Gilt für viele Routen |
| `lib/` | `http` (500-Antwort, Eingaben wandeln, UUID), `attempts` (Fehlversuche sperren), `planUser` | Klein und ohne Fachwissen |

Die Routen-Module:

| Datei | Endpunkte |
|---|---|
| `system.js` | `/health`, `/whoami`, `/db-ping` |
| `files.js` | `/files/:name` – signierte Bilder, **vor** dem allgemeinen Rate-Limit eingehängt |
| `auth.js` | Registrierung, Login (inkl. 2FA-Schritt), Verlängern, Passwort, 2FA einrichten, Token sperren |
| `users.js` | Konten (lesen, ändern, löschen, überall abmelden), Admin: Benutzerliste, Beta, Tarife und Verlauf |
| `mailSettings.js` | E-Mail-Einstellungen, Test- und Sofortversand |
| `vehicles.js` | Fahrzeuge anlegen, lesen, ändern, löschen |
| `fillups.js` | Tank- und Ladevorgänge, Liste je Fahrzeug |
| `entries.js` | Ausgaben, Fahrten, Kilometerstände, Liste je Fahrzeug |
| `categories.js` | Kategorien inkl. eigener |
| `import.js` | CSV-Import je Fahrzeug |
| `statistics.js` | `/stats`, `/consumption`, `/costs`, `/reminders` je Fahrzeug |
| `stations.js` | Tankstellen und Ladestationen (Fremddienste nur hier, #123) |
| `media.js` | Profil- und Fahrzeugbilder |
| `feedback.js` | Feedback senden, Admin: lesen und erledigen |

## Reihenfolge der Middleware (app.js)

1. `helmet` – Sicherheits-Header
2. `routes/files` – signierte Bilder mit eigenem, großzügigem Limit
3. allgemeines Rate-Limit (je Konto bzw. anonym je IP)
4. CORS nur für `CORS_ORIGINS`
5. `express.json` (bis 2 MB für CSV-Importe)
6. Bildadressen in allen Antworten signieren
7. Routen
8. Fehlerbehandlung für Uploads (multer)

## Neue Endpunkte

1. In das passende Modul unter `routes/` (neues Modul nur für einen neuen Fachbereich, dann in der Liste in `app.js` ergänzen).
2. Fachliche Rechnung in einen Service, damit Web-App, Apps und Monatsbericht dieselben Zahlen bekommen.
3. Test in `backend/test` (Service-Tests ohne Datenbank, API-Tests mit Datenbank), Doku in `api.md` und OpenAPI – siehe Checkliste in `CLAUDE.md`.

## Tests

```bash
cd backend
DATABASE_URL=postgresql://…/fuelstat_test npm test
```

`api.test.js` braucht eine Datenbank mit `database/postgres_init.sql`; die übrigen Tests (`costs`, `stations`, `chargingStations`, `odometer`, `helpers`) laufen ohne.

## Zugriff auf Fahrzeuge (#53)

Fahrzeuge können geteilt sein. Deshalb prüft keine Route und kein Service mehr `user_id = $x`, sondern immer
`services/vehicleAccess.js`:

- `vehicleRole(db, userId, vehicleId)` → `owner` | `editor` | `viewer` | `null`
- `canAccessVehicle(db, userId, vehicleId, 'read' | 'write' | 'manage')`
- `canEditEntry(role, eintragUserId, userId)` – Besitzer alle Einträge, Mitfahrer eigene
- `accessibleVehicles('v', 1)` – SQL-Bedingung für Listen

Daten eines Fahrzeugs (Tank-/Ladevorgänge, Ausgaben, Fahrten) werden **nach `vehicle_id`** gelesen, nicht nach
`user_id`; `user_id` eines Eintrags ist der, der ihn erfasst hat. Ohne Zugriff antwortet die API mit 404
(die Existenz des Fahrzeugs bleibt verborgen), mit zu wenig Rechten mit 403 (`read_only`, `entry_not_editable`,
`owner_only`). Neue Endpunkte zu Fahrzeugdaten nutzen diese Funktionen und bekommen einen Test in
`test/sharing.test.js`, dass Fremde nichts sehen.
