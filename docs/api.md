# Fuelstat V2 API

Base URL: https://tanken.1emc.de/api/v1  
Content-Type: application/json (Uploads: multipart/form-data)  
Auth: Bearer JWT (Authorization Header), Token gilt 7 Tage

Maschinenlesbare Beschreibung: `docs/openapi.1.0.0.yaml`.

## Übersicht aller Endpunkte

Pfade relativ zu `/api/v1`. „Auth“: ohne = öffentlich, ✓ = angemeldet, Admin = nur `ADMIN_USER_IDS`, Selbst/Admin = eigenes Konto oder Admin.

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/health` | – | Healthcheck, enthält `registration_enabled` und `beta_phase` |
| GET | `/db-ping` | – | Datenbank erreichbar? |
| GET | `/whoami` | ✓ | Eigenes Konto inkl. `is_admin`, `beta_tester`, Tarif und Rechte |
| POST | `/auth/register` | – | Konto anlegen, liefert Token |
| POST | `/auth/login` | – | Anmelden (bei 2FA: `mfa_required` + `mfaToken`) |
| POST | `/auth/login/mfa` | – | Zweiter Schritt mit 2FA-Code |
| POST | `/auth/refresh` | ✓ | Anmeldung verlängern: neues Token (7 Tage), höchstens 90 Tage nach dem letzten Login |
| POST | `/auth/password` | ✓ | Passwort ändern, widerruft alle Tokens |
| POST | `/auth/mfa/setup` · `/enable` · `/disable` | ✓ | 2FA einrichten, aktivieren, abschalten |
| GET | `/auth/users` | Admin | Alle Benutzer mit Aktivität |
| GET · PATCH · DELETE | `/auth/users/:userId` | Selbst/Admin | Konto lesen, `email`/`username`/`profileImageUrl` ändern, löschen |
| PUT | `/auth/users/:userId/beta` | Admin | Beta-Tester setzen |
| PUT | `/auth/users/:userId/plan` | Admin | Tarif setzen (`plan`, optional `planUntil`) |
| PUT | `/auth/plans` | Admin | Tarif für mehrere Konten (`userIds`, `plan`, optional `planUntil`) |
| GET | `/auth/users/:userId/plan-history` | Admin | Verlauf der Tarifänderungen eines Kontos |
| POST | `/auth/users/:userId/revoke-all` | Selbst/Admin | Auf allen Geräten abmelden |
| GET | `/auth/tokens` | ✓ | Gesperrte Tokens (Admin: alle) |
| POST | `/auth/tokens/revoke` | ✓ | Ein Token sperren (Abmelden) |
| GET · PUT | `/auth/mail-settings` | ✓ | E-Mail-Einstellungen |
| POST | `/auth/mail-settings/test` · `/send-now` | ✓ | Test-Mail, Erinnerungen bzw. Bericht sofort |
| GET · POST | `/vehicles` | ✓ | Fahrzeuge auflisten, anlegen |
| GET · PATCH · DELETE | `/vehicles/:vehicleId` | ✓ | Fahrzeug lesen, ändern, löschen (samt Einträgen) |
| GET | `/vehicles/:vehicleId/stats` | ✓ | Tachostand, Ø Preis, Verbrauchsabschnitte, Trend je Einheit |
| GET | `/vehicles/:vehicleId/costs?year=` | ✓ | Kosten: Summen, Kosten pro km, laufender Monat, Monats- und Kategoriesummen |
| GET | `/vehicles/:vehicleId/consumption` | ✓ | Verbrauch je Einheit: Abschnitte, Monate, Jahre, Ø/Min/Max, Mengen, CO₂, Stromanteil |
| GET | `/stations?lat=&lng=&radius=&type=` | ✓ | Tankstellen in der Nähe mit aktuellen Preisen (Tankerkönig) |
| GET | `/charging-stations?lat=&lng=&radius=` | ✓ | Ladestationen in der Nähe (Open Charge Map) |
| GET | `/vehicles/:vehicleId/reminders` | ✓ | Fälligkeiten TÜV, Wartung, Versicherung, Steuer |
| POST | `/vehicles/:vehicleId/import` | ✓ | Massenimport (CSV) |
| GET | `/vehicles/:vehicleId/fillups` | ✓ | Tank- und Ladevorgänge (`limit`, `offset`) |
| POST | `/fillups` | ✓ | Tank- bzw. Ladevorgang anlegen |
| GET · PATCH · DELETE | `/fillups/:fillupId` | ✓ | Lesen, ändern (nur 14 Tage), löschen |
| GET | `/vehicles/:vehicleId/entries` | ✓ | Ausgaben und Fahrten (`limit`, `offset`) |
| POST | `/entries` | ✓ | Ausgabe anlegen |
| GET · PATCH · DELETE | `/entries/:entryId` | ✓ | Ausgabe lesen, ändern, löschen |
| GET | `/categories` | ✓ | Kategorien für Ausgaben (fest, Premium, eigene) |
| POST | `/categories` | ✓ | Eigene Kategorie anlegen (Plus) |
| PATCH · DELETE | `/categories/:categoryId` | ✓ | Eigene Kategorie ändern, löschen (`?moveTo=`) |
| POST | `/media/upload` | ✓ | Profilbild hochladen (Feld `file`) |
| GET | `/media` · `/media/:mediaId` | ✓ | Eigene Bilder |
| DELETE | `/media/:mediaId` | ✓ | Bild löschen |
| POST | `/vehicles/:vehicleId/media/upload` | ✓ | Fahrzeugbild hochladen (Feld `file`) |
| GET | `/vehicles/:vehicleId/media` | ✓ | Bilder eines Fahrzeugs |
| DELETE | `/vehicles/:vehicleId/media/:mediaId` | ✓ | Fahrzeugbild löschen |
| POST | `/feedback` | ✓ | Feedback senden |
| GET | `/feedback` | Admin | Feedback-Eingang |
| PATCH | `/feedback/:id` | Admin | Feedback als erledigt markieren |

## Auth

### POST /auth/register
Legt einen neuen User an und gibt direkt ein JWT zurück.

**Body**
```json
{
  "email": "mario@test.local",
  "password": "SuperSecret123!"
}
````

**Responses**

* 201

```json
{
  "token": "<jwt>",
  "user": {
    "id": "<uuid>",
    "email": "mario@test.local",
    "created_at": "2025-12-23T08:34:47.135Z"
  }
}
```

* 400: `invalid_email` | `password_too_short`
* 409: `email_already_exists`
* 500: `server_error`

### POST /auth/login

Gibt bei gültigen Credentials ein JWT zurück.

**Body**

```json
{
  "email": "mario@test.local",
  "password": "SuperSecret123!"
}
```

**Responses**

* 200 wie Register (token + user)
* 400: `missing_credentials`
* 401: `invalid_credentials`
* 500: `server_error`

## Benutzer & Admin-Rechte

Die Endpunkte unter `/auth/users` und `/auth/tokens` sind auf den eigenen Account beschränkt:

* `GET /auth/users` (alle User auflisten): nur Admins
* `GET|PATCH|DELETE /auth/users/:userId` und `POST /auth/users/:userId/revoke-all`: nur der eigene User oder Admins
* `POST /auth/tokens/revoke`: eigene Tokens jeder, fremde nur Admins
* `GET /auth/tokens`: Admins sehen alle (optional `?userId=`), alle anderen nur ihre eigenen

Admins werden über die Umgebungsvariable `ADMIN_USER_IDS` (kommagetrennte User-UUIDs) in der `.env` des Backends festgelegt. Ohne diese Variable gibt es keine Admins.

Gelöschte Konten: Tokens eines inzwischen gelöschten Kontos werden mit **401** `{ "error": "account_not_found" }` abgelehnt – auch wenn die ID noch in `ADMIN_USER_IDS` steht.

Fehlende Rechte: **403** `{ "error": "forbidden" }`

### Tarife (Free / Plus / Flotte)

Grundgerüst für ein späteres Premium-Modell. Was ein Tarif darf, steht an einer Stelle: `backend/src/services/plans.js`.

* `users.plan` (`free`, `plus`, `fleet`) und `users.plan_until` (Ende, `null` = unbefristet; danach gilt `free`). Admins setzen beides mit `PUT /auth/users/:userId/plan`, für mehrere Konten auf einmal mit `PUT /auth/plans` `{ "userIds": [...], "plan": "plus", "planUntil": null }` (Antwort `{ updated, changed, plan, planUntil }`: `updated` = gefundene Konten, `changed` = davon tatsächlich geändert; max. 1000 IDs, sonst 400 `invalid_userIds`), oder in der Benutzerverwaltung (Häkchen, „Alle auswählen“, „Tarif setzen“). Optional `note` (bis 200 Zeichen) fürs Protokoll, z. B. „Tester“.
* `PLAN_LIMITS_ENABLED=true` in der `.env` schaltet die Grenzen ein. **Standard: aus**, dann haben alle Konten mindestens die Rechte von `plus`.
* `GET /whoami` liefert `plan`, `planUntil`, `effectivePlan` (gerade geltender Tarif), `limitsEnabled` und `features` (z. B. `maxVehicles: 1`, `sharing: false`; `null` = unbegrenzt).
* Verbietet der Tarif etwas, antwortet die API mit **403** `{ "error": "plan_required", "feature": "maxVehicles", "limit": 1, "plan": "free" }`. Derzeit geprüft: Anzahl Fahrzeuge beim Anlegen, Premium- und eigene Kategorien (siehe Kategorien). Herabstufen löscht nichts.
* Datenexport ist nie an einen Tarif gebunden (DSGVO Art. 20).

**Wer darf den Tarif ändern (#102)?** Nur der Betreiber: Admins über die beiden Endpunkte oben oder auf dem Server mit `backend/scripts/tarif-setzen.js` (siehe `docs/betrieb.md`), später zusätzlich ein verifizierter Webhook des Zahlungsanbieters (#59). Kein anderer Endpunkt nimmt `plan`, `plan_until` oder `beta_tester` an – Profil-Updates (`PATCH /auth/users/:userId`) und die Registrierung ignorieren solche Felder. Ein Client kann den Tarif lesen (`/whoami`), aber nie ändern; die API prüft Rechte immer anhand des gespeicherten Tarifs.

* Jede tatsächliche Änderung landet in `plan_changes` (Konto, alter und neuer Tarif samt Laufzeit, Quelle `admin`/`cli`/`webhook`, ändernder Admin, Notiz, Zeitpunkt; keine Tokens oder Zahlungsdaten). `GET /auth/users/:userId/plan-history` (Admin) → `{ changes: [{ oldPlan, oldPlanUntil, newPlan, newPlanUntil, source, changedBy, note, createdAt }] }`, neueste zuerst, höchstens 50.
* Abgewiesene Zugriffe auf Admin-Funktionen schreibt die API ins Log: `[admin] abgewiesen: <Methode> <Pfad> von Konto <id>`.

### Anmeldung verlängern

`POST /auth/refresh` tauscht ein gültiges Token gegen ein neues mit wieder 7 Tagen Laufzeit (neue `jti`). Das Token trägt `auth_time`, den Zeitpunkt des letzten Logins mit Passwort; er wird übernommen. Liegt er mehr als 90 Tage zurück, antwortet die API mit **401** `{ "error": "reauth_required" }`. Widerrufene Tokens („Auf allen Geräten abmelden“, Passwortwechsel) werden wie bei jedem Aufruf abgelehnt. Das PHP-Frontend verlängert bei aktiver Nutzung, sobald das Token älter als einen Tag ist (höchstens ein Versuch pro Stunde).

## Health & Diagnostics

### GET /health

Healthcheck, ohne Auth.

**Response 200**

```json
{
  "status": "healthy",
  "timestamp": "2025-12-23T09:00:00.000Z",
  "service": "fuelstat-api-v2"
}
```

### GET /db-ping

DB Ping, ohne Auth.

**Response 200**

```json
{ "ok": true, "result": { "ok": 1 } }
```

## Vehicles (Auth required)

### POST /vehicles

Legt ein Fahrzeug für den eingeloggten User an.

**Header**
Authorization: Bearer <jwt>

**Body** (nur `name` und `fuelType` sind Pflicht)

```json
{
  "name": "Mazda CX-60",
  "fuelType": "phev",
  "brand": "Mazda",
  "model": "CX-60 e-Skyactiv PHEV",
  "year": 2023,
  "odometerKm": 12,
  "tankCapacity": 50,
  "batteryCapacity": 17.8,
  "sortOrder": 0
}
```

* `odometerKm`: Tachostand bei Anschaffung (Basis für die Fahrleistung)
* `tankCapacity`: Tank in l bzw. kg, bei Elektroautos der Akku in kWh
* `batteryCapacity`: Akku in kWh, nur für Plug-in-Hybride
* `PATCH /vehicles/:vehicleId` nimmt dieselben Felder (alle optional, `null` leert optionale Felder)

**fuelType erlaubt**
`diesel`, `e5`, `e10`, `lpg`, `cng`, `electric`, `hybrid` (Vollhybrid, tankt nur), `phev` (Plug-in-Hybrid, tankt und lädt), `hydrogen`, `other`

**Response 201**

```json
{
  "id": "<uuid>",
  "name": "Mazda CX-60",
  "fuel_type": "phev",
  "brand": "Mazda",
  "model": "CX-60 e-Skyactiv PHEV",
  "year": 2023,
  "image_url": null,
  "odometer_km": 12,
  "mileage_km": null,
  "tank_capacity": "50.000",
  "battery_capacity": "17.800",
  "sort_order": 0,
  "created_at": "2026-10-29T08:38:47.952Z",
  "updated_at": "2026-10-29T08:38:47.952Z"
}
```

**Errors**

* 400: `missing_name` | `invalid_fuelType` | `invalid_year` | `invalid_odometerKm` | `invalid_tankCapacity` | `invalid_batteryCapacity`
* 401: `missing_token` | `invalid_token`
* 500: `server_error`


**Zusatzangaben (#45, alle optional, auch bei `PATCH /vehicles/:vehicleId`)**

| Feld | Typ | Hinweis |
|---|---|---|
| `licensePlate` | Text, max. 15 | wird in Großbuchstaben gespeichert |
| `vin` | Text, max. 17 | Fahrgestellnummer, ohne Leerzeichen |
| `firstRegistration` | Datum `YYYY-MM-DD` | ohne TÜV-Eintrag: erster TÜV nach 36 Monaten |
| `purchaseDate`, `saleDate` | Datum | |
| `purchasePrice`, `salePrice` | Betrag ≥ 0 | |
| `serviceIntervalMonths` (1–60), `serviceIntervalKm` (1.000–100.000) | Ganzzahl | ersetzt 12 Monate / 15.000 km bei den Fälligkeiten |
| `oilIntervalMonths`, `oilIntervalKm` | Ganzzahl | |
| `insuranceCompany`, `insurancePremium`, `insuranceDueMonth` (1–12) | | mit Monat: Erinnerung auch ohne Eintrag |
| `taxAmount`, `taxDueMonth` (1–12) | | mit Monat: Erinnerung auch ohne Eintrag |
| `tireSizeSummer`, `tireSizeWinter` | Text, max. 30 | |

`null` bzw. leer löscht einen Wert; ungültige Werte liefern 400 `invalid_<feld>` (z. B. `invalid_taxDueMonth`). Antworten enthalten die Felder als Spalten (`license_plate`, `first_registration`, …); Datumsfelder als `YYYY-MM-DD`.

### GET /vehicles

Listet alle Fahrzeuge des Users, sortiert nach `sort_order`, danach neueste zuerst. Felder wie bei `POST /vehicles`.

## Fillups (Auth required)

### POST /fillups

Legt eine Tankfüllung bzw. einen Ladevorgang an. Prüft, ob `vehicleId` dem User gehört.

**Header**
Authorization: Bearer <jwt>

**Body**

```json
{
  "vehicleId": "<vehicle-uuid>",
  "odometerKm": 12845,
  "amount": 47.2,
  "unit": "l",
  "totalCostEur": 86.3,
  "station": "Aral",
  "filledAt": "2025-12-23T09:16:08.998Z",
  "isFull": true,
  "skipPrevious": false
}
```

**Notes**

* `unit` optional: Ohne Angabe gilt die Einheit des Fahrzeugs (`electric` → `kwh`, `cng`/`hydrogen` → `kg`, sonst `l`). Plug-in-Hybride (`phev`) erlauben `l` (getankt) und `kwh` (geladen), Standard `l`.
* `liters` und `priceTotalEur` werden als alte Namen für `amount` und `totalCostEur` weiter angenommen.
* `station` optional, `filledAt` optional (Standard `now()`).
* `odometerKm` optional: Wer den Tachostand an der Tankstelle vergessen hat, lässt ihn weg und trägt ihn später per `PATCH` nach. `odometerEstimated: true` markiert einen nur geschätzten Wert.
* Einträge ohne echten Tachostand (fehlt oder geschätzt) zählen bei Kosten und Menge, schließen aber keinen Verbrauchsabschnitt ab: Ihre Menge fließt wie bei einer Teilbetankung in den nächsten vollen Abschnitt mit Tachostand. Bei gleichem Zeitpunkt stehen sie hinter den Einträgen mit Tachostand.
* `price_per_unit` berechnet die API selbst.

**Response 201**: der angelegte Eintrag mit `amount`, `unit`, `total_cost_eur`, `price_per_unit`, `is_full`, `skip_previous`, `odometer_estimated` und `warnings` (siehe „Tachostand-Prüfung“) (Felder wie bei der Liste unten).

**Errors**

* 400: `missing_vehicleId` | `invalid_odometerKm` | `invalid_amount` | `invalid_totalCostEur` | `invalid_filledAt` | `invalid_unit`
* 401: `missing_token` | `invalid_token`
* 404: `vehicle_not_found`
* 500: `server_error`

### GET /vehicles/:vehicleId/fillups?limit=50

Listet Fillups zu einem Vehicle (nur wenn es dem User gehört).

**Header**
Authorization: Bearer <jwt>

**Query**

* `limit` optional (default 50, min 1, max 200)

**Response 200**

```json
[
  {
    "id": "<uuid>",
    "odometer_km": 12845,
    "amount": "47.200",
    "unit": "l",
    "total_cost_eur": "86.30",
    "price_per_unit": "1.8284",
    "station": "Aral",
    "filled_at": "2025-12-23T09:16:08.998Z",
    "created_at": "2025-12-23T09:16:08.998Z",
    "is_full": true,
    "skip_previous": false,
    "odometer_estimated": false,
    "liters": "47.200",
    "price_total_eur": "86.30",
    "price_per_liter": "1.8284"
  }
]
```

**Errors**

* 401: `missing_token` | `invalid_token`
* 404: `vehicle_not_found`
* 500: `server_error`

### GET · PATCH · DELETE /fillups/:fillupId

* `GET` liefert einen Eintrag.
* `PATCH` nimmt `odometerKm` (`null` = fehlt), `odometerEstimated`, `amount`, `unit`, `totalCostEur`, `station`, `filledAt`, `isFull`, `skipPrevious` (alle optional). Nur innerhalb von 14 Tagen nach `filled_at`, sonst 409 `fillup_edit_window_expired`. **Ausnahme:** Enthält der Body nur `odometerKm` (und ggf. `odometerEstimated`), geht es immer – so lässt sich der Tachostand nachtragen. Ein neu gesetzter Tachostand gilt als echt, wenn `odometerEstimated` fehlt.
* `DELETE` löscht immer. War der Eintrag älter als 14 Tage, bekommt der nächste Eintrag `skip_previous = true`, damit über die Lücke kein falscher Verbrauch entsteht. Antwort: `{ "deletedId", "olderThan14Days", "nextUpdated", "message" }`.

Fremde oder ungültige IDs liefern 404 `fillup_not_found`.

## Stats (Auth required)

### GET /vehicles/:vehicleId/stats

Gibt aktuelle Kennzahlen und Full-to-Full-Abschnitte zurück. Abschnitte laufen je Einheit von einer vollen Füllung zur nächsten; beim Plug-in-Hybrid also getrennt für Liter und kWh.

**Header**
Authorization: Bearer <jwt>

**Response 200 (Beispiel Plug-in-Hybrid)**

```json
{
  "currentOdo": 68831,
  "avgPricePerLiter": "1.774",
  "avgConsumption": 2.7,
  "segments": [
    {
      "full_id": "<fillup-uuid>",
      "full_at": "2026-10-26T12:00:00.000Z",
      "unit": "kwh",
      "km": 92,
      "liters_segment": "16.590",
      "l_per_100km": "18.03"
    }
  ],
  "trend": { "current": 1.4, "avgPrev": 2.31, "diff": -0.91 },
  "units": {
    "l":   { "avgPrice": "1.774", "avgConsumption": 2.7,  "trend": { "current": 1.4,   "avgPrev": 2.31,  "diff": -0.91 } },
    "kwh": { "avgPrice": "0.273", "avgConsumption": 20.01, "trend": { "current": 18.03, "avgPrev": 22.4, "diff": -4.37 } }
  }
}
```

* `avgPricePerLiter`, `avgConsumption` und `trend` gelten für die Einheit des Fahrzeugs (beim Plug-in-Hybrid Liter); `units` enthält die Werte für jede vorhandene Einheit.
* `missingOdometer`: Anzahl Tank-/Ladevorgänge ohne echten Tachostand (fehlt oder geschätzt). `currentOdo` berücksichtigt nur echte Werte.
* `avgConsumption`: Ø Verbrauch pro 100 km über alle Abschnitte, nach km gewichtet. Abschnitte ohne Strecke (zwei volle Einträge beim selben Tachostand) zählen nicht. `trend.current` ist nur der letzte Abschnitt.
* `l_per_100km` ist je nach Einheit l, kWh oder kg pro 100 km.
* `distance`: gefahrene km `{ "km": 9400, "since": "purchase" }` – seit Anschaffung (Tachostand beim Anlegen des Fahrzeugs), sonst seit dem ersten echten Tachostand eines Tank-/Ladevorgangs (`"since": "firstEntry"`); `null` ohne Tachostand (#82).

**Errors**

* 401: `missing_token` | `invalid_token`
* 404: `vehicle_not_found`
* 500: `server_error`

### GET /vehicles/:vehicleId/costs?year=2026

Kosten eines Fahrzeugs (#124), gerechnet in der API, damit Web-App und Apps dieselben Zahlen zeigen. Ohne `year` gesamter Zeitraum, mit `year` ein Kalenderjahr. Monate und Jahre in **Europe/Berlin**.

```json
{
  "year": null,
  "currency": "EUR",
  "total": { "energy": 165, "expenses": 300, "total": 465 },
  "distanceKm": 1000,
  "costPerKm": { "energy": 0.105, "total": 0.465 },
  "perMonth": 93,
  "monthCount": 5,
  "currentMonth": { "month": "2026-03", "energy": 0, "expenses": 0, "total": 0 },
  "previousMonth": { "month": "2026-02", "energy": 55, "expenses": 0, "total": 55 },
  "months": [
    { "month": "2026-02", "energy": 55, "expenses": 0, "total": 55, "count": 2,
      "counts": { "fuel": 1, "charge": 0, "expense": 0, "trip": 1, "odometer": 0 },
      "byType": { "fuel": 55, "charge": 0, "expense": 0 } }
  ]
}
```

* **Kosten:** `energy` = Tank- und Ladevorgänge, `expenses` = Ausgaben, deren Kategorie als Kosten zählt (nicht Fahrt, Kilometerstand). Beträge in EUR, auf Cent gerundet.
* **`distanceKm`:** Strecke im Zeitraum aus echten Tachoständen (Tank-/Ladevorgänge ohne Schätzung und Ausgaben mit Tachostand, auch „Kilometerstand notieren“). Kilometer zählen erst ab dem ersten erfassten Tachostand; im Jahr vom letzten Stand vor Jahresbeginn (sonst dem ersten im Jahr) bis zum letzten im Jahr.
* **`costPerKm.total`:** alle Kosten im Zeitraum ÷ `distanceKm`. **`costPerKm.energy`:** Kosten der Tank-/Ladevorgänge mit echtem Tachostand nach dem ersten ÷ Strecke vom ersten bis zum letzten (die erste Füllung bezahlt die Strecke davor). Beide in €/km auf 4 Stellen, `null` ohne Strecke (nie 0).
* **`perMonth`:** Kosten ÷ `monthCount`, gezählt vom ersten Monat mit Kosten (im Jahr: frühestens Januar) bis zum laufenden Monat bzw. Dezember; Monate ohne Kosten zählen mit.
* **`currentMonth`, `previousMonth`:** laufender Monat und Vormonat, unabhängig von `year`.
* **`months`:** nur Monate mit Einträgen, neueste zuerst. `counts` je Eintragsart (`fuel`, `charge`, `expense`, `trip`, `odometer`), `byType` (Kosten je Art) und `byCategory` (Kosten je Kategorie) – so kann eine gefilterte Eintragsliste ihre Monatssumme bilden und ein Diagramm nach Kostengruppen stapeln, ohne zu rechnen.
* **`categories`:** Summe und Anzahl je Kategorie im Zeitraum, größte zuerst: `[{ "key": "Versicherung", "total": 300, "count": 1 }]`. Tank- und Ladevorgänge heißen `Tankfuellung:<Einheit>` (`Tankfuellung:l`, `Tankfuellung:kwh`, `Tankfuellung:kg`), damit Plug-in-Hybride Kraftstoff und Strom getrennt zeigen können; Namen, Farben und Gruppen liefert `GET /categories`.
* **`years`:** Jahre mit Kosten (gesamter Zeitraum, unabhängig von `year`), neueste zuerst – für eine Jahresauswahl.

Fehler: 400 `invalid_year`, 404 `vehicle_not_found` (auch für fremde Fahrzeuge).

### GET /vehicles/:vehicleId/consumption

Verbrauch, Mengen und CO₂ je Einheit (#82). Grundlage sind dieselben Full-to-Full-Abschnitte wie bei `/stats`; die Clients rechnen nichts nach.

```json
{
  "fuelType": "phev",
  "units": ["l", "kwh"],
  "byUnit": {
    "l": {
      "unit": "l", "avg": 4, "min": 4, "max": 4,
      "kmConsumed": 1000, "amountConsumed": 40, "amountBought": 70, "cost": 122.5, "avgPrice": 1.75, "fillCount": 2,
      "co2": { "factor": 2.37, "totalKg": 165.9, "gPerKm": 94.8 },
      "segments": [{ "fullId": "<fillup-uuid>", "date": "2026-01-20", "month": "2026-01", "km": 1000, "amount": 40, "consumption": 4 }],
      "months": [{ "month": "2026-01", "km": 1000, "amount": 40, "consumption": 4 }],
      "years": [{ "year": 2026, "fillCount": 2, "amountBought": 70, "cost": 122.5, "amountConsumed": 40, "kmConsumed": 1000, "consumption": 4, "co2Kg": 165.9 }]
    },
    "kwh": { "unit": "kwh", "...": "…" }
  },
  "energyCost": 140.7,
  "electricShare": 12.9,
  "co2": { "totalKg": 189.5, "gPerKm": 167.4 }
}
```

* `units`: vorhandene Einheiten, die zur Antriebsart passende zuerst (Plug-in-Hybrid: Liter, dann kWh); ohne Einträge die Standardeinheit
* `consumption`, `avg`, `min`, `max`: Einheit pro 100 km (l, kWh oder kg). Ein Abschnitt gehört zu Tag, Monat und Jahr der vollen Füllung, die ihn abschließt (Europe/Berlin). Monats-, Jahres- und Ø-Werte sind Menge ÷ Strecke aller Abschnitte im Zeitraum (nach km gewichtet), nicht der Mittelwert der Einzelwerte
* `amountBought`, `cost`, `fillCount`: alle Tank-/Ladevorgänge, auch ohne Tachostand; `amountConsumed`, `kmConsumed`: nur abgeschlossene Abschnitte
* CO₂: gekaufte Menge × Faktor (`factor` in kg je Einheit: Benzin 2,37, Diesel 2,65, Autogas 1,64, Erdgas 2,79, Strom 0,363 deutscher Strommix, Wasserstoff 0; Plug-in-Hybrid: Liter wie Benzin, kWh wie Strom); `gPerKm` aus dem Ø-Verbrauch. `null`, wenn kein Faktor bekannt ist
* `electricShare`: Anteil der Ladekosten an den Energiekosten in %, nur bei mehreren Einheiten

Fehler: 404 `vehicle_not_found` (auch für fremde Fahrzeuge).

## Ausgaben (Entries) (Auth required)

`POST /entries` `{ "vehicleId", "category", "amountEur", "odometerKm", "occurredAt", "vendor", "description" }`. Pflicht sind `vehicleId`, `category` und `amountEur`. `category` ist ein Schlüssel aus `GET /categories` (siehe unten); unbekannte Kategorien lehnt die API mit 400 `unknown_category` ab, Premium- bzw. eigene Kategorien ohne passenden Tarif mit 403 `plan_required` (`feature`: `premiumCategories` bzw. `customCategories`).

* `GET /entries/:entryId` – einzelne Ausgabe
* `PATCH /entries/:entryId` – Felder `category`, `amountEur`, `odometerKm`, `occurredAt`, `vendor`, `description` (alle optional; `null` löscht optionale Felder)
* `DELETE /entries/:entryId` – 204

Beim Ändern bleibt die bisherige Kategorie immer erlaubt, auch nach dem Herabstufen oder bei alten Freitext-Kategorien aus früheren Importen.

## Kategorien (Auth required)

Die einzige Quelle für Kategorien ist `backend/src/services/categories.js`; Web-Frontend und Apps holen sie über die API.

`GET /categories` → `{ groups, categories, custom }`

* `groups`: Gruppen für Auswertungen `{ key, name, icon, color }` (`kraftstoff`, `fix`, `wartung`, `unterwegs`, `sonstiges`)
* `categories`: je Kategorie `{ key, name, icon, color, group, form, countsAsCost, plan, custom, selectable, available }`
  * `key` ist fest und steht so in `expenses.category`; `name`, `icon` (Font Awesome 6), `color` und `group` immer aus der API anzeigen
  * `form`: `expense` (Ausgabe), `trip` (Fahrt), `odometer` (nur Kilometerstand) oder `fillup` (Tank-/Ladevorgang, nur für Name und Icon)
  * `countsAsCost: false` (Fahrt, Kilometerstand) zählt in keiner Kostensumme
  * `plan`: `free` oder `plus`; `available` sagt, ob der Benutzer sie für neue Einträge wählen kann. Gesperrte mit Hinweis „mit Plus“ anzeigen statt weglassen
  * `selectable: false` für Tankfüllung, Fahrt und Kilometerstand (eigene Formulare)
  * eigene Kategorien: `custom: true`, `id`, `key` = `custom:<id>`
  * alte Freitext-Kategorien aus früheren Importen: `legacy: true`, nicht wählbar
* `custom`: `{ max, used, canCreate, icons, colors, nameMaxLength }` – erlaubte Symbole und Farben für eigene Kategorien
* Antwort mit `Cache-Control: private, max-age=300` und `ETag` (`If-None-Match` → 304)

Feste Kategorien: Free – `Versicherung`, `Steuer`, `TUV`, `Werkstatt`, `Reparatur`, `Wartung`, `Inspektion`, `Reifen`, `Sonstiges` (plus `Fahrt`, `Kilometerstand`); Plus – `Dekor` (Zubehör & Dekor), `Pflege`, `Parken`, `Maut`, `Leasing`.

Eigene Kategorien (Tarif-Recht `customCategories`, Plus: 10 je Benutzer):

* `POST /categories` `{ "name", "icon", "color", "group" }` → 201 Kategorie. Fehler: 400 `missing_name`, `name_too_long`, `invalid_icon`, `invalid_color`, `invalid_group`, `name_taken` (Name einer festen Kategorie); 409 `name_taken`; 403 `plan_required` oder `category_limit_reached`
* `PATCH /categories/:categoryId` – dieselben Felder, alle optional (auch nach dem Herabstufen erlaubt)
* `DELETE /categories/:categoryId?moveTo=<key>` → `{ deleted, moved, moveTo }`. Hängen Ausgaben daran, ist `moveTo` Pflicht (sonst 409 `category_in_use` mit `entries`); Ziel muss eine wählbare Ausgaben-Kategorie sein (400 `invalid_moveTo`)

Fremde oder ungültige IDs liefern 404 `entry_not_found`.

## Listen seitenweise laden

`GET /vehicles/:vehicleId/fillups` und `GET /vehicles/:vehicleId/entries` akzeptieren neben `limit` (max. 200) auch `offset`. Das PHP-Frontend lädt so alle Einträge.

## Passwort und 2FA (Auth required)

* `POST /auth/password` `{ "currentPassword", "newPassword" }` – widerruft alle bestehenden Tokens und gibt `{ "token" }` zurück. Fehler: 401 `invalid_current_password`, 400 `password_too_short`
* `POST /auth/mfa/setup` – erzeugt ein TOTP-Secret `{ "secret", "otpauthUrl" }` (noch nicht aktiv)
* `POST /auth/mfa/enable` `{ "code" }` – aktiviert 2FA nach korrektem Code
* `POST /auth/mfa/disable` `{ "password", "code" }` – deaktiviert 2FA

Bei aktivem 2FA antwortet `POST /auth/login` ohne `code` mit 401 `{ "error": "mfa_required", "mfaToken": "…" }`. Das `mfaToken` ist 5 Minuten gültig und wird mit dem Code an `POST /auth/login/mfa` `{ "mfaToken", "code" }` geschickt; die Antwort enthält dann das Zugangstoken. Ein falscher Code liefert 401 `invalid_mfa_code`, ein abgelaufenes `mfaToken` 401 `invalid_mfa_token`. Alternativ kann `code` direkt bei `/auth/login` mitgeschickt werden. **Jeder Code gilt nur einmal** (RFC 6238, 5.2): ein bereits verwendeter oder ein älterer Code als der zuletzt akzeptierte liefert ebenfalls `invalid_mfa_code` – auch beim Aktivieren und Abschalten der 2FA. Clients sollten nach einem erfolgreichen Login also nicht denselben Code erneut senden.

**Fehlversuche:** Login: nach 10 falschen Versuchen je Kombination aus IP-Adresse und E-Mail sowie nach 50 falschen Versuchen je IP-Adresse über alle Konten antwortet `/auth/login` dieser IP 15 Minuten lang mit 429 `too_many_attempts`; andere IP-Adressen sind nicht betroffen, ein Konto lässt sich also nicht von Fremden aussperren. Eine erfolgreiche Anmeldung hebt nur die Sperre dieser IP für dieses Konto auf. 2FA und Passwortänderung: nach 5 falschen 2FA-Codes bzw. 10 falschen Passwörtern je Konto 429 `too_many_attempts` (setzt jeweils ein korrektes Passwort bzw. eine Anmeldung voraus). Die IP-Adresse kommt über `X-Forwarded-For` von nginx bzw. dem PHP-Frontend; die API übernimmt den Header nur von lokalen bzw. privaten Adressen.

**Registrierung:** Mit `REGISTRATION_ENABLED=false` antwortet `POST /auth/register` mit 403 `registration_disabled`. TOTP: 30 Sekunden, 6 Stellen, SHA1 (kompatibel mit Google Authenticator, Aegis, 1Password usw.).

`GET /whoami` liefert zusätzlich `is_admin`.

## Tachostand-Prüfung

`POST`/`PATCH` auf `/fillups` und `/entries` speichern immer, liefern aber `warnings` mit, wenn der Tachostand unplausibel wirkt (z. B. nach einem Tippfehler; ein Tachotausch bleibt möglich):

```json
"warnings": [{ "code": "lower_than_previous", "refDate": "2026-02-01", "refKm": 11000, "message": "Niedriger als der Tachostand vom 01.02.2026 (11.000 km)." }]
```

| `code` | Bedeutung |
|---|---|
| `lower_than_previous` | kleiner als ein Eintrag an einem früheren Tag |
| `higher_than_next` | größer als ein Eintrag an einem späteren Tag |
| `jump` | mehr als 2.000 km und mehr als 800 km pro Tag seit dem letzten Eintrag |
| `below_purchase` | kleiner als der Tachostand bei Anschaffung (nur ohne früheren Eintrag) |

Verglichen wird mit allen echten Tachoständen des Fahrzeugs (Tankfüllungen, Ladungen, Ausgaben); fehlende und geschätzte Werte zählen nicht. Dieselben Regeln nutzt das Formular (`includes/tacho_pruefung.php`).

## Tankfüllungen: vollgetankt und Lücken

`POST /fillups` übernimmt `isFull` (Standard `true`) und `skipPrevious` (Standard `false`). Eine Vollbetankung mit `skipPrevious = true` ist ein neuer Startpunkt für die Verbrauchsberechnung: Über die Lücke davor wird kein Verbrauch berechnet.

## CSV-Import (Auth required)

`POST /vehicles/:vehicleId/import`

```json
{
  "fillups": [{ "filledAt": "2026-01-05", "odometerKm": 38337, "amount": 33.5, "totalCostEur": 61.2, "station": "Aral", "isFull": true, "skipPrevious": false, "unit": "l" }],
  "entries": [{ "occurredAt": "2026-01-02", "category": "Versicherung", "amountEur": 420, "odometerKm": null, "vendor": "HUK", "description": "Jahresbeitrag" }]
}
```

* max. 1000 Zeilen pro Anfrage, alles in einer Transaktion
* bei ungültigen Zeilen 400 `invalid_rows` mit `rows: [{ type, index, error }]`, es wird nichts importiert
* `unit` je Zeile gilt nur bei Plug-in-Hybriden (`l` oder `kwh`), sonst immer die Einheit des Fahrzeugs
* `odometerKm` darf bei Tank- und Ladevorgängen fehlen (später nachtragen)
* Duplikate werden übersprungen: Tank- bzw. Ladevorgang mit gleichem Datum, Tachostand und gleicher Einheit (ohne Tachostand: zusätzlich gleiche Menge), Ausgabe mit gleichem Datum, Kategorie und Betrag
* Antwort 201: `{ "imported": { "fillups", "entries" }, "skipped": { "fillups", "entries" }, "duplicates": [{ type, index }], "warnings": [{ type, index, code, message, … }] }`; `index` bezieht sich auf die Position in `fillups` bzw. `entries`, `warnings` wie bei der Tachostand-Prüfung
* `"dryRun": true`: alles prüfen, aber nichts speichern (Antwort 200 mit `dryRun: true`); die Import-Vorschau im Frontend markiert damit doppelte Zeilen und unplausible Tachostände
* Ungültige IDs in der URL (keine UUID) liefern 404 wie unbekannte Einträge

## Fälligkeiten (Auth required)

`GET /vehicles/:vehicleId/reminders` – Liste mit `title`, `category`, `last`, `due_date`, `due_km`, `status` (`ok`, `bald`, `ueberfaellig`, `unbekannt`), `days` und `source` (`eintrag`, `erstzulassung`, `faelligkeitsmonat`). Regeln: TÜV alle 24 Monate, Wartung/Inspektion alle 12 Monate oder 15.000 km (bzw. das Intervall des Fahrzeugs), Versicherung und Steuer jährlich, jeweils ab dem letzten Eintrag. Ohne TÜV-Eintrag zählt die Erstzulassung (+36 Monate, danach +24); ist für Versicherung oder Steuer ein Fälligkeitsmonat hinterlegt, gilt der nächste 1. dieses Monats. „bald“ = innerhalb der Vorlaufzeit aus den Mail-Einstellungen (Standard 30 Tage) oder weniger als 1.000 km.

## E-Mail-Benachrichtigungen (Auth required)

* `GET /auth/mail-settings` – Einstellungen; das Passwort wird nie zurückgegeben, nur `has_password`
* `PUT /auth/mail-settings` – `smtpHost`, `smtpPort` (25, 465, 587, 2525), `smtpSecurity` (`tls`, `starttls`, `none`), `smtpUser`, `smtpPassword` (nur senden, wenn es sich ändert), `clearPassword`, `fromAddress`, `toAddress`, `remindersEnabled`, `reminderDays` (1–180), `monthlyReport`
* `POST /auth/mail-settings/test` – Test-Mail
* `POST /auth/mail-settings/send-now` `{ "type": "reminders" | "report" }` – sofort senden (Bericht für den Vormonat)

Mit `remindersEnabled` kommt außerdem einmal je Eintrag die Erinnerung „Kilometerstand nachtragen“: für Tank- und Ladevorgänge der letzten 14 Tage ohne echten Tachostand, frühestens 3 Stunden nach dem Erfassen (`mail_log.kind = 'odometer'`). Ist `APP_URL` gesetzt, enthält sie einen Link direkt zum Nachtragen.

Ohne eigenen `smtpHost` wird der Standard-Mailserver verwendet (SMTP-Zugang von `MAIL_DEFAULT_USER_ID` bzw. des ersten Admins). Die Mails gehen dann immer an die Konto-Adresse; `to_address` wird ignoriert. `GET` liefert dazu `default_available`, `default_from` und `uses_default`. Test-Mail und Sofortversand über den Standard-Server: höchstens 5 in 15 Minuten (`429 too_many_attempts`).

### Beta und Feedback

* `GET /health` enthält `beta_phase` (aus `BETA_PHASE`, Standard `true`)
* `GET /auth/users` (Admin) enthält zusätzlich `vehicle_count`, `last_login_at`, `last_seen_at` (letzte Nutzung, höchstens stündlich aktualisiert) und `last_entry_at` (letzte Erfassung einer Tankfüllung oder Ausgabe)
* `GET /whoami` und `GET /auth/users` enthalten `beta_tester`; neue Konten werden während der Beta-Phase als Beta-Tester angelegt
* `PUT /auth/users/:userId/beta` `{ "betaTester": true|false }` – nur Admin
* `POST /feedback` `{ "category": "fehler"|"idee"|"lob"|"sonstiges", "message": "…" (3–5000 Zeichen), "page": "/pfad" }` → `201 { id, saved, mailed }`. Wird gespeichert und über den Standard-Mailserver an `FEEDBACK_EMAIL` bzw. den Empfänger des Standard-Servers geschickt (Reply-To = Absender). Höchstens 10 je 15 Minuten.
* `GET /feedback` – Liste (nur Admin), offene zuerst
* `PATCH /feedback/:id` `{ "done": true|false }` – nur Admin

Fehler: 400 `mail_not_configured`, 400 `smtp_host_not_allowed` (interne Adresse), 400 `smtp_host_not_found`, 502 `smtp_failed` mit `detail` (Meldung des Mailservers).

Ein Job im Backend prüft stündlich: Erinnerungs-Mails, sobald ein Termin bald fällig ist und noch einmal, wenn er überfällig ist; der Monatsbericht des Vormonats geht am Monatsanfang raus. Jede Mail wird nur einmal verschickt (`mail_log`).

Umgebungsvariablen des Backends:

* `MAIL_ENCRYPTION_KEY` – Schlüssel für die SMTP-Passwörter (Standard: aus `JWT_SECRET` abgeleitet; wer `JWT_SECRET` ändert, muss dann die SMTP-Passwörter neu eingeben)
* `ALLOW_PRIVATE_SMTP=true` – Mailserver mit internen Adressen erlauben (z. B. eigener Server im selben Netz)
* `NOTIFICATIONS_ENABLED=false` – automatischen Versand abschalten

## Bilder (Auth required)

Upload als `multipart/form-data` mit dem Feld `file`, höchstens 20 MB. Erlaubt sind nur JPEG, PNG, GIF und WebP; geprüft wird der Inhalt, nicht die Dateiendung.

Verarbeitung (#103): Das Bild wird nach EXIF gedreht, verkleinert (Fahrzeugbild höchstens 1600 px, Profilbild 800 px lange Kante, nie vergrößert) und als **WebP ohne Metadaten** (kein GPS) unter zufälligem Namen in `UPLOAD_DIR` gespeichert. Das Original wird nicht aufbewahrt. Animierte GIFs werden zum ersten Bild.

Abruf nur signiert: In allen Antworten (`url`, `image_url`, `profile_image_url`) stehen Adressen der Form `/api/v1/files/<datei>.webp?exp=<Unix-Zeit>&sig=<Signatur>`. Sie gelten bis zum Ende des nächsten Tages (UTC) und bleiben einen Tag lang gleich, damit Browser und Apps sie zwischenspeichern können (`Cache-Control: private`). Ohne gültige Signatur oder nach Ablauf: 404. Öffentlich unter `/uploads/` liegt nichts mehr. Signierte Adressen, die ein Client als `imageUrl`/`profileImageUrl` zurückschickt, speichert die API wieder als interne Adresse `/uploads/<datei>`. Schlüssel: `MEDIA_SIGNING_KEY` (optional, sonst aus `JWT_SECRET` abgeleitet).

Bestehende Bilder umstellen (einmalig, wiederholbar): `docker compose exec api node scripts/bilder-optimieren.js --probe` (zeigt nur an), danach ohne `--probe`.

* `POST /media/upload` → Profilbild; danach `PATCH /auth/users/:userId { "profileImageUrl": url }`
* `POST /vehicles/:vehicleId/media/upload` → Fahrzeugbild; danach `PATCH /vehicles/:vehicleId { "imageUrl": url }`
* Fehler: 400 `missing_file`, 400 `invalid_image`, 404 `vehicle_not_found` bzw. `media_not_found`

## Tankstellen und Ladestationen (Auth required)

Fremddienste fragt ausschließlich die API (#123): Web-App und Apps nutzen dieselben Endpunkte, die Keys liegen nur in `infra/.env`.

### GET /stations?lat=52.52&lng=13.40&radius=5&type=e10

Tankstellen im Umkreis mit aktuellen Preisen von [Tankerkönig](https://www.tankerkoenig.de) (Lizenz CC BY 4.0, die Quelle muss angezeigt werden). Für die Erfassung in Web-App und Apps; der API-Key bleibt auf dem Server (`TANKERKOENIG_API_KEY`).

* `lat`, `lng`: Standort (Pflicht), als Dezimalzahl wie `52.52` (bis 20 Nachkommastellen; `0x10`, `5e1` o. Ä. ergeben 400)
* `radius`: 1–25 km, Standard 5
* `type`: `e5`, `e10`, `diesel` oder `all` (Standard). Andere Werte (z. B. Elektro) gelten als `all`.
* Sortiert nach Entfernung. Ergebnisse werden 2 Minuten zwischengespeichert (Standort auf etwa 100 m gerundet), höchstens 30 Abfragen pro Minute und Konto.

```json
{
  "stations": [
    { "id": "51d4b55e-a095-1aa0-e100-80009459e03a", "name": "JET BERLIN", "brand": "JET",
      "street": "Mustergasse", "houseNumber": "1", "postCode": "10115", "place": "Berlin",
      "lat": 52.52, "lng": 13.40, "distanceKm": 0.8, "isOpen": true,
      "prices": { "e10": 1.719 } }
  ],
  "source": "Tankerkönig", "license": "CC BY 4.0", "sourceUrl": "https://www.tankerkoenig.de"
}
```

Bei `type=all` enthält `prices` die Felder `e5`, `e10` und `diesel`; fehlt eine Sorte, ist der Wert `null`.

Fehler: 400 `invalid_coordinates` bzw. `invalid_radius`, 429 `too_many_requests`, 502 `stations_unavailable` (Tankerkönig nicht erreichbar), 503 `stations_not_configured` (kein Key gesetzt).

### GET /charging-stations?lat=48.96&lng=10.13&radius=15

Ladestationen im Umkreis von [Open Charge Map](https://openchargemap.org) (Lizenz CC BY 4.0 bzw. die des jeweiligen Datenanbieters, die Quelle muss angezeigt werden). Key auf dem Server: `OCM_API_KEY`.

* `lat`, `lng`, `radius` wie bei `/stations`; höchstens 30 Treffer, nach Entfernung sortiert
* Ergebnisse werden 6 Stunden zwischengespeichert (Standort auf etwa 100 m gerundet), höchstens 30 Abfragen pro Minute und Konto

```json
{
  "stations": [
    { "id": "123456", "name": "EnBW HPC Ellwangen", "operator": "EnBW mobility+",
      "street": "Rotenbacher Str. 1", "place": "Ellwangen", "postCode": "73479",
      "lat": 48.96, "lng": 10.13, "distanceKm": 12.3,
      "points": 4, "maxKw": 300, "connectors": ["CCS", "Typ 2"],
      "usageCost": "0,59 €/kWh", "isOperational": true }
  ],
  "source": "Open Charge Map", "license": "CC BY 4.0", "sourceUrl": "https://openchargemap.org"
}
```

* `operator`: `null`, wenn unbekannt; `connectors`: Steckertypen kurz und deutsch (`CCS`, `Typ 2`, `CHAdeMO`, `Schuko` …); `usageCost`: Freitext des Betreibers oder `null`; `isOperational: false` = außer Betrieb

Fehler: 400 `invalid_coordinates` bzw. `invalid_radius`, 429 `too_many_requests`, 502 `charging_stations_unavailable` (Open Charge Map nicht erreichbar), 503 `charging_stations_not_configured` (kein Key gesetzt).

## Common error format

```json
{ "error": "some_error_code" }
```

Interne Fehler (500) enthalten keine Details mehr; sie stehen nur im Log der API.

## Quick curl examples

### Register

```bash
curl -s https://tanken.1emc.de/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"mario@test.local","password":"SuperSecret123!"}'
```

### Create vehicle

```bash
curl -s https://tanken.1emc.de/api/v1/vehicles \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mein Auto","fuelType":"diesel"}'
```

### Create fillup

```bash
curl -s https://tanken.1emc.de/api/v1/fillups \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"vehicleId":"<uuid>","odometerKm":12845,"amount":47.2,"totalCostEur":86.3,"station":"Aral"}'
```

