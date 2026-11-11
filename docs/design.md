# Fuelstat – Design

**Einzige Quelle für das Aussehen von Fuelstat** auf allen Plattformen: Web-App/PWA (dieses Repository),
iOS ([FuelStat/fuelstat-ios](https://github.com/FuelStat/fuelstat-ios)) und Android
([FuelStat/fuelstat-android](https://github.com/FuelStat/fuelstat-android)). Entstanden mit #153.

Die Plattform-Dokumente beschreiben nur noch, was auf ihrer Plattform anders oder genauer ist:

- iOS: [`docs/design.md`](https://github.com/FuelStat/fuelstat-ios/blob/main/docs/design.md) – Bildschirme in SwiftUI, Komponenten in `Fuelstat/Design/`
- Android: [`docs/design.md`](https://github.com/FuelStat/fuelstat-android/blob/main/docs/design.md) – Übertragung auf Material 3 und Compose
- Web/PWA: Abschnitt [Web und PWA](#11-web-und-pwa) in diesem Dokument, Tokens in `css/style.css`

**Ändern:** Ein Token (Farbe, Schriftgrad, Abstand, Radius) wird **zuerst hier** geändert, dann in den
Plattformen – im selben PR oder in verlinkten PRs. Ein Plattform-Dokument darf einen Wert nie neu festlegen,
nur auf ihn verweisen.

Inhalt:

1. [Richtung](#1-richtung)
2. [Marke](#2-marke)
3. [Farben](#3-farben)
4. [Typografie](#4-typografie)
5. [Abstände, Raster und Formen](#5-abstände-raster-und-formen)
6. [Token-Zuordnung je Plattform](#6-token-zuordnung-je-plattform)
7. [Navigation und Aufbau](#7-navigation-und-aufbau)
8. [Gemeinsame Bausteine](#8-gemeinsame-bausteine)
9. [Plattform-Leitplanken](#9-plattform-leitplanken)
10. [Barrierefreiheit](#10-barrierefreiheit)
11. [Web und PWA](#11-web-und-pwa)
12. [Bestandsaufnahme und Entscheidungen](#12-bestandsaufnahme-und-entscheidungen)

---

## 1. Richtung

**Ruhig, kartenbasiert, mit Fotos, eine starke Farbe.** Fuelstat ist ein persönlicher Begleiter für das
eigene Fahrzeug, kein Shop und keine Mietplattform. Es gibt kein „Jetzt kaufen“, keine Bewertungen, keine
Werbebanner.

1. **Das Fahrzeug steht im Mittelpunkt.** Foto und Name tragen jede Fahrzeugseite.
2. **Zahlen zuerst.** Verbrauch, Kosten je km und der nächste Termin sind der Grund, die App zu öffnen:
   groß, früh, ohne Tippen.
3. **Ein Tipp zum Erfassen.** Tanken oder Laden erfassen ist von überall einen Tipp entfernt.
4. **Nativ statt nachgebaut.** Jede Plattform nutzt ihre eigenen Bedienelemente, Symbole und Systemschrift
   (siehe [Leitplanken](#9-plattform-leitplanken)). Gleich bleiben Farben, Abstände, Formen, Begriffe und der
   Aufbau der Seiten – man erkennt ein Produkt, nicht eine kopierte Oberfläche.
5. **Die Daten kommen von der API.** Kennzahlen, Kategorien und deren Farben liefert die API; das Design
   legt fest, *wie* sie erscheinen, nicht *was* berechnet wird.

## 2. Marke

> **Markenspezifisch.** Alles in diesem Abschnitt hängt am Namen und Logo „Fuelstat“ und ändert sich bei
> einer Umbenennung (#151). Der Rest des Dokuments bleibt dann gültig; nur die Werte hier und die
> Token `Brand`/`BrandDeep`/`OnBrand` werden getauscht.

| Element | Festlegung |
|---|---|
| Produktname | „Fuelstat“ (so geschrieben, auch am Satzanfang) |
| Logo / App-Icon | Tacho-Motiv mit Petrol-Auto auf Navy; Skala grün → gelb → orange |
| Markenfarbe | Petrol `#0A717A` (hell) / Teal `#5ED3CF` (dunkel) → Token `Brand` |
| Dunkler Anker | Navy `#0A1C33` → Token `BrandDeep` (hell), Willkommensseite in beiden Modi |
| Willkommensseite | Navy-Fläche wie das Icon, weiße Schrift, Teal-Akzente, Tacho als Illustration |
| Tacho-Skala (Illustration auf Navy) | `#3DD17A` · `#F5C542` · `#FF8A5B` |

Warum Petrol: Es liegt zwischen Blau (Technik, Vertrauen) und Grün (Strom, Sparen) und passt damit zu
Verbrennern **und** E-Autos. Reines Grün bleibt frei für Status und Strom.

## 3. Farben

Eine Markenfarbe, ein dunkler Anker, sonst neutral. Jede Farbe ist ein **Token mit Hell- und Dunkelwert**;
in Views, Templates und Komponenten stehen nie Hex-Werte, sondern Token-Namen.

**Token-, Rollen- und Bausteinnamen** (`EnergyPetrol`, `TextSecondary`, `sectionTitle`, `StatTile` …) sind
Namen für den Code. Sie erscheinen **nie als Text in der Oberfläche** – auch nicht in Mockups; dort
höchstens als Anmerkung außerhalb des Bildschirms.

**Flächen hinter Text** sind nur `Brand` (mit `OnBrand`), `Card`, `CardTint` und `Background`. Status-,
Energie-, Zweck- und Kategoriefarben färben Symbole, Punkte, Balken, Linien und Symbolkreise (getönt),
aber nie eine Fläche, auf der Text steht – also keine gelbe Kachel „Tanken“ mit weißer Schrift.

### 3.1 Grundfarben

| Token | Hell | Dunkel | Verwendung |
|---|---|---|---|
| `Brand` | `#0A717A` | `#5ED3CF` | Primäre Buttons, „+“, gewählte Chips, Links, aktiver Tab |
| `OnBrand` | `#FFFFFF` | `#0A1C33` | Text und Symbole auf `Brand`-Flächen |
| `BrandDeep` | `#0A1C33` | `#DCE8F5` | Hero-Köpfe, Überschriften auf getönten Flächen |
| `Background` | `#F2F6F8` | `#0E1624` | Seitenhintergrund |
| `Card` | `#FFFFFF` | `#1A2230` | Karten, Blätter (Sheets), Dialoge |
| `CardTint` | `#E2F1F2` | `#22303A` | Kennzahl-Kacheln, Symbolkreise, nicht gewählte Chips |
| `Text` | `#14202E` | `#E6EDF5` | Fließtext, Titel |
| `TextSecondary` | `#4A5868` | `#A3B1C2` | Beschriftungen, Untertitel, Datum |
| `Separator` | `#D5DEE6` | `#2E3B48` | Trennlinien, Rahmen von Eingabefeldern (nur dekorativ) |

Im Dunkelmodus soll Fuelstat wirken wie das Icon: Navy-Flächen mit Teal-Akzenten. Darum ist der dunkle
Hintergrund ein dunkles Navy und kein reines Schwarz.

Geprüfte Kontraste (WCAG 2.x):

| Paar | Hell | Dunkel |
|---|---|---|
| `Brand` auf `Background` / `Card` / `CardTint` | 5,3 / 5,7 / 5,0 | 10,1 / 8,9 / 7,5 |
| `OnBrand` auf `Brand` | 5,7 | 9,5 |
| `BrandDeep` auf `Card` | 17,1 | 12,9 |
| `Text` auf `Background` / `Card` / `CardTint` | 15,1 / 16,5 / 14,2 | 15,4 / 13,5 / 11,5 |
| `TextSecondary` auf `Background` / `Card` / `CardTint` | 6,7 / 7,3 / 6,3 | 8,3 / 7,3 / 6,2 |

### 3.2 Status

Aus der Tacho-Skala des Icons. Immer zusammen mit Symbol oder Text, nie nur Farbe.

| Token | Hell | Dunkel | Bedeutung | Kontrast auf `Card` (hell / dunkel) |
|---|---|---|---|---|
| `StatusOK` | `#18723A` | `#4ADE80` | in Ordnung, gespeichert | 6,0 / 9,2 |
| `StatusSoon` | `#8A5A00` | `#F5C542` | bald fällig, Hinweis | 5,9 / 9,8 |
| `StatusOverdue` | `#B93A0C` | `#FF8A5B` | überfällig, Fehler, Löschen | 5,7 / 6,9 |

`StatusOverdue` ist zugleich die Fehlerfarbe (Formularfehler, destruktive Aktionen).

**Den Status von Terminen bestimmt die API**, nicht die Oberfläche: `GET /vehicles/:vehicleId/reminders`
liefert je Termin `status`. Die Clients übersetzen nur in Farbe, Symbol und Text:

| `status` der API | Token | Badge-Text (Beispiel) | Bedeutung |
|---|---|---|---|
| `ok` | `StatusOK` | „in 4 Monaten“ | Fälligkeit liegt außerhalb der Vorlaufzeit |
| `bald` | `StatusSoon` | „in 12 Tagen“, „in 800 km“ | innerhalb der Vorlaufzeit (Standard 30 Tage) oder unter 1.000 km |
| `ueberfaellig` | `StatusOverdue` | „seit 5 Tagen überfällig“ | Datum oder Kilometerstand überschritten |
| `unbekannt` | `TextSecondary` (neutral) | „Datum fehlt“ | Keine Grundlage für eine Fälligkeit |

Ein Termin in zwölf Tagen ist also gelb („bald“), nicht rot. Rot heißt ausschließlich „überschritten“
oder Fehler.

### 3.3 Energie (je Kraftstoffart)

Fest je Kraftstoffart, für Symbole, Fahrzeug-Platzhalter und Diagrammreihen. Alle erreichen mindestens 3:1
auf `Card` in beiden Modi (Symbole und große Schrift). Nicht als Fläche hinter Text (siehe oben): Die
Typauswahl beim Erfassen sind Chips in `CardTint` mit Symbol in der Energiefarbe; der gewählte Chip ist
`Brand`/`OnBrand`.

| Token | Hell | Dunkel | Kraftstoffarten |
|---|---|---|---|
| `EnergyElectric` | `#0F883B` | `#3DD17A` | Elektro (und der Strom-Anteil von PHEV beim Laden) |
| `EnergyPetrol` | `#8A6D00` | `#F2C230` | Benzin (E5, E10), Hybrid, PHEV beim Tanken, Sonstige |
| `EnergyDiesel` | `#C0501A` | `#FF9A52` | Diesel |
| `EnergyGas` | `#2563EB` | `#6CA8FF` | LPG, CNG |
| `EnergyHydrogen` | `#0E7490` | `#3FD6EE` | Wasserstoff |

Zuordnung zu den Energiearten der API (#140, `GET /fuels`): `petrol` → `EnergyPetrol`, `diesel` → `EnergyDiesel`,
`lpg` und `cng` → `EnergyGas`, `electricity` → `EnergyElectric`, `hydrogen` → `EnergyHydrogen`, `other` →
`EnergyPetrol`. Diagramme mit mehreren Energiearten (z. B. Benzin und Autogas) färben jede Reihe so; bei nur einer
Energieart bleibt die Reihe in `Brand`.

### 3.4 Zweck-Farben (Eintragsarten und Fahrten)

| Bereich | Token | Hell | Dunkel | Regel |
|---|---|---|---|---|
| Tanken | – | – | – | Energiefarbe der Kraftstoffart des Fahrzeugs (`EnergyPetrol`, `EnergyDiesel` …) |
| Laden | – | – | – | `EnergyElectric` |
| Ausgabe | `PurposeExpense` | `#6D4FC2` | `#B9A3FF` | Allgemeines Ausgaben-Symbol; ist die Kategorie bekannt, deren Farbe aus der API |
| Kilometerstand | `PurposeOdometer` | `#5B6675` | `#A3B1C2` | Neutral |
| Fahrt privat | `TripPrivate` | `#5B6675` | `#A3B1C2` | Neutral |
| Fahrt dienstlich | `TripBusiness` | `#0A717A` | `#5ED3CF` | = `Brand` |
| Fahrt Arbeitsweg | `TripCommute` | `#0E7490` | `#3FD6EE` | = `EnergyHydrogen` (Cyan) |

Zweck-Farben stehen immer neben Text (Badge mit Wort, Legende), nie allein.

### 3.5 Ausgabe-Kategorien

Kategorien, ihre Symbole und Farben kommen aus der API (`GET /api/v1/categories`,
`backend/src/services/categories.js`); eigene Kategorien wählen ihre Farbe aus einer festen Liste. Die
Clients **übernehmen diese Farben unverändert** und legen keine eigenen fest. Weil Kategoriefarben Daten sind
und nicht für beide Modi geprüft, gilt:

- Kategoriefarbe nur als Punkt oder Grafik (Symbolkreis, Balken, Tortenstück), nie als Textfarbe und
  nie als Fläche hinter Text.
- Daneben steht immer der Name der Kategorie.
- Symbol im Kreis: Kreis in der Kategoriefarbe mit 15 % Deckkraft, Symbol in `Text`.

### 3.6 Diagramme

- Reihen bekommen ihre Farbe aus Energie-, Zweck- oder Kategoriefarben; Kosten ohne weitere Aufteilung in `Brand`.
- Achsen und Gitter in `Separator`, Achsenbeschriftung in `TextSecondary`.
- Jede Reihe hat zusätzlich ein zweites Unterscheidungsmerkmal, wenn es mehr als zwei sind (Legende mit
  Namen, Linienart oder direkte Beschriftung).
- Jedes Diagramm hat eine Textalternative (siehe [Barrierefreiheit](#10-barrierefreiheit)).

## 4. Typografie

**Systemschrift auf jeder Plattform**, keine eigenen Schriften: SF Pro (iOS), Roboto bzw. die
Systemschrift (Android), System-Schriftstapel von Bootstrap (Web). Schriftgrößen folgen **Rollen**, die
jede Plattform auf ihre skalierbare Typo-Skala abbildet. Feste Pixelgrößen sind verboten.

| Rolle | Verwendung | iOS (Dynamic Type) | Android (Material, sp) | Web (rem, Basis 16 px) |
|---|---|---|---|---|
| `screenTitle` | Titel einer Seite | `.largeTitle` bold (34) | `headlineMedium` (28) | `1.75rem`, 700 |
| `figureHero` | Große Kennzahl im Hero | `.title` bold, rounded (28) | `headlineMedium` (28) | `1.75rem`, 700 |
| `sectionTitle` | Abschnitt, Kartentitel | `.title3` bold (20) | `titleLarge` (22) | `1.25rem`, 700 |
| `figure` | Kennzahl in Kacheln | `.title2` bold, rounded (22) | `titleLarge` (22) | `1.375rem`, 700 |
| `headline` | Zeilentitel, Buttons | `.headline` (17, semibold) | `titleMedium` (16, medium) | `1.0625rem`, 600 |
| `body` | Fließtext, Eingaben | `.body` (17) | `bodyLarge` (16) | `1rem`, 400 |
| `label` | Beschriftungen, Untertitel | `.subheadline` (15) | `bodyMedium` (14) | `0.875rem`, 400 |
| `footnote` | Hinweise – **kleinste Größe für Information** | `.footnote` (13) | `bodySmall` (12) | `0.8125rem`, 400 |
| `unit` | Einheit neben einer Zahl, Badges | `.caption` (12) | `labelSmall` (11) | `0.75rem`, 600 |

Regeln:

- Zahlen in Kennzahlen und Tabellen mit **gleich breiten Ziffern** (iOS `.monospacedDigit()`,
  Android `fontFeatureSettings = "tnum"`, Web `font-variant-numeric: tabular-nums`).
- Kennzahlen: großer Wert, kleine Einheit daneben in `unit`, kurze Beschriftung darunter in `label`.
- Zeilenhöhe Fließtext 1,5, Überschriften 1,2. Text darf umbrechen; Container haben keine feste Höhe.
- Zahlen- und Datumsformat deutsch (`1.234,5 km`, `1,689 €`, `11.11.2026`).

## 5. Abstände, Raster und Formen

### 5.1 Abstände (4er-Raster)

Alle Abstände sind Vielfache von 4; erlaubt sind nur diese Stufen:

| Token | Wert | Typische Verwendung |
|---|---|---|
| `xxs` | 4 | Abstand Wert – Einheit, Symbol – Text in Badges |
| `xs` | 8 | Zwischen Chips, zwischen Zeilen einer Gruppe |
| `s` | 12 | Innen in Kacheln und Chips |
| `m` | 16 | **Seitenrand, Abstand zwischen Karten, Innenabstand von Karten** |
| `l` | 24 | Zwischen Abschnitten |
| `xl` | 32 | Große Abschnitte, Kopf der Willkommensseite |

Einheit: pt (iOS), dp (Android), px (Web; in CSS als `rem`, 16 px = 1 rem).

### 5.2 Layout

- Seitenrand 16 auf Telefonen; ab Tablet-Breite (Web ≥ 768 px, Android ≥ 600 dp, iPad regular) 24.
- Inhalt auf großen Bildschirmen höchstens **1200 px** breit und zentriert; Formulare höchstens 640 px.
- Kennzahl-Kacheln in Reihen zu drei (Telefon) bzw. bis sechs (breit); Karten auf breiten Bildschirmen im
  Raster mit 16 Abstand.

### 5.3 Formen

Radien sind Form-Tokens und gehören nicht zum Abstandsraster.

| Token | Wert | Verwendung |
|---|---|---|
| `radiusCard` | 20 | Karten, Blätter (obere Ecken), Dialoge, Fahrzeugfoto im Hero |
| `radiusTile` | 14 | Kacheln, Eingabefelder, Buttons |
| `radiusCapsule` | vollständig rund | Chips, Badges, Kapsel-Buttons, „+“ (Kreis) |

Auf iOS mit kontinuierlichen Ecken (`.continuous`), auf den anderen Plattformen normale Rundung.

### 5.4 Ebenen und Schatten

- Karten auf `Background` brauchen **keinen Schatten**; der Farbunterschied trennt sie.
- Höchstens ein weicher Schatten auf schwebenden Elementen: „+“-Knopf, Blätter über Fotos.
- Fotos: abgerundet, unten ein leichter Verlauf für die Lesbarkeit von Text darauf.

### 5.5 Bewegung

Standardübergänge der Plattform. Keine Animation, die Inhalt verzögert. „Bewegung reduzieren“
(`prefers-reduced-motion`, iOS Reduce Motion, Android „Animationen entfernen“) wird respektiert.

## 6. Token-Zuordnung je Plattform

Gleicher Name, gleicher Wert, plattformübliche Schreibweise.

### 6.1 Farben

| Token | Web/PWA (CSS) | iOS (Asset-Katalog / `Theme`) | Android (Compose) |
|---|---|---|---|
| `Brand` | `--fs-brand` (→ `--bs-primary`) | `Brand` / `Theme.brand` | `colorScheme.primary` |
| `OnBrand` | `--fs-on-brand` | `OnBrand` / `Theme.onBrand` | `colorScheme.onPrimary` |
| `BrandDeep` | `--fs-brand-deep` | `BrandDeep` / `Theme.brandDeep` | `FuelstatColors.brandDeep`, `colorScheme.onSecondaryContainer` |
| `Background` | `--fs-background` (→ `--bs-body-bg`) | `Background` / `Theme.background` | `colorScheme.background`, `surface` |
| `Card` | `--fs-card` (→ `--bs-card-bg`) | `Card` / `Theme.card` | `colorScheme.surfaceContainerLow` |
| `CardTint` | `--fs-card-tint` | `CardTint` / `Theme.cardTint` | `colorScheme.secondaryContainer` |
| `Text` | `--fs-text` (→ `--bs-body-color`) | System `.primary` (label) | `colorScheme.onBackground`, `onSurface` |
| `TextSecondary` | `--fs-text-secondary` (→ `--bs-secondary-color`) | System `.secondary` | `colorScheme.onSurfaceVariant` |
| `Separator` | `--fs-separator` (→ `--bs-border-color`) | System `separator` | `colorScheme.outlineVariant` |
| `StatusOK` | `--fs-status-ok` | `StatusOK` / `Theme.Status.ok` | `FuelstatColors.statusOk` |
| `StatusSoon` | `--fs-status-soon` | `StatusSoon` / `Theme.Status.soon` | `FuelstatColors.statusSoon` |
| `StatusOverdue` | `--fs-status-overdue` (→ `--bs-danger`) | `StatusOverdue` / `Theme.Status.overdue` | `colorScheme.error`, `FuelstatColors.statusOverdue` |
| `EnergyElectric` | `--fs-energy-electric` | `EnergyElectric` / `Theme.Energy.electricity` | `FuelstatColors.energyElectric` |
| `EnergyPetrol` | `--fs-energy-petrol` | `EnergyPetrol` / `Theme.Energy.petrol` | `FuelstatColors.energyPetrol` |
| `EnergyDiesel` | `--fs-energy-diesel` | `EnergyDiesel` / `Theme.Energy.diesel` | `FuelstatColors.energyDiesel` |
| `EnergyGas` | `--fs-energy-gas` | `EnergyGas` / `Theme.Energy.gas` | `FuelstatColors.energyGas` |
| `EnergyHydrogen` | `--fs-energy-hydrogen` | `EnergyHydrogen` / `Theme.Energy.hydrogen` | `FuelstatColors.energyHydrogen` |
| `PurposeExpense` | `--fs-purpose-expense` | `PurposeExpense` / `Theme.Purpose.expense` | `FuelstatColors.purposeExpense` |
| `PurposeOdometer` | `--fs-purpose-odometer` | `PurposeOdometer` / `Theme.Purpose.odometer` | `FuelstatColors.purposeOdometer` |
| `TripPrivate` | `--fs-trip-private` | `TripPrivate` / `Theme.Trip.private` | `FuelstatColors.tripPrivate` |
| `TripBusiness` | `--fs-trip-business` | `TripBusiness` / `Theme.Trip.business` | `FuelstatColors.tripBusiness` |
| `TripCommute` | `--fs-trip-commute` | `TripCommute` / `Theme.Trip.commute` | `FuelstatColors.tripCommute` |

- **Web:** Die `--fs-*`-Variablen stehen in `css/style.css` unter `:root` (hell) und
  `[data-bs-theme="dark"]` (dunkel). Die Bootstrap-Variablen in der Spalte (→ …) sind im Abschnitt „Thema“
  derselben Datei auf sie gelegt; neue Regeln verwenden direkt `var(--fs-…)`.
- **Noch nicht angelegt** sind `Text`, `TextSecondary`, `Separator` (Android, Web-Verwendung) sowie die
  Zweck- und Fahrt-Tokens auf iOS: Sie entstehen mit dem ersten Bildschirm, der sie braucht, mit genau den
  Namen und Werten hier.
- **iOS:** Farben als Named Colors im Asset-Katalog mit Hell-/Dunkel-Variante, Zugriff nur über `Theme`.
  `Text`, `TextSecondary` und `Separator` nutzt iOS als Systemfarben (näherungsweise gleiche Werte,
  passen sich „Kontrast erhöhen“ an). Das Widget hat eigene Kopien der benötigten Farben.
- **Android:** `lightColorScheme`/`darkColorScheme` aus den Werten oben, alles ohne passende
  Material-Rolle in `FuelstatColors` (über `CompositionLocal`). Material-Rollen, die hier nicht
  vorkommen, werden aus den nächstliegenden Tokens abgeleitet, nicht frei gewählt.

### 6.2 Abstände, Radien, Schrift

| Token | Web/PWA (CSS) | iOS (`Theme`) | Android (Compose) |
|---|---|---|---|
| `xxs` … `xl` | `--fs-space-xxs` … `--fs-space-xl` | `Theme.Spacing.xxs` … `.xl` | `FuelstatSpacing.xxs` … `.xl` (dp) |
| `radiusCard` | `--fs-radius-card` | `Theme.Radius.card`, `.card`-Shape | `FuelstatShapes.card` (= `shapes.large`) |
| `radiusTile` | `--fs-radius-tile` | `Theme.Radius.tile`, `.tile`-Shape | `FuelstatShapes.tile` (= `shapes.medium`) |
| `radiusCapsule` | `--fs-radius-capsule` (`50rem`) | `Capsule()` | `CircleShape` / `RoundedCornerShape(50)` |
| Schriftrollen | `--fs-font-<rolle>` bzw. Klassen `.fs-<rolle>` | Text-Styles wie in [Typografie](#4-typografie) | `MaterialTheme.typography.<stil>` wie in [Typografie](#4-typografie) |

## 7. Navigation und Aufbau

Gleiche Bereiche und Begriffe auf allen Plattformen:

| Bereich | Inhalt |
|---|---|
| **Start** | Gewähltes Fahrzeug: Hero, Kennzahlen, nächste Termine, Tankstellen in der Nähe, letzte Einträge |
| **Einträge** | Alle Einträge nach Monat gruppiert, Suche und Filter |
| **＋ Erfassen** | Kein Bereich, sondern die Schnellerfassung (Tanken, Laden, Ausgabe, Kilometerstand, Fahrt) |
| **Statistik** | Diagramme und Jahresübersicht des gewählten Fahrzeugs |
| **Profil** | Konto, Fahrzeuge, Erinnerungen, Import/Export, Einstellungen, Über |

- **Fahrzeugwechsler** oben auf Start, Einträge und Statistik: Name mit Pfeil („VW Golf ▾“), öffnet eine
  Liste mit Foto, Name, Kennzeichen; die Wahl bleibt gespeichert.
- **„+“** ist ein gefüllter Kreis in `Brand`, Bezeichnung für Screenreader „Eintrag erfassen“. Es gibt
  **genau ein „+“ je Bildschirm**: auf iOS und in der PWA (mobil) in der Mitte der Tab-Leiste, auf Android
  als FAB über der Navigationsleiste – nie beides.
- Wie die Navigation dargestellt wird, entscheidet die Plattform (siehe [Leitplanken](#9-plattform-leitplanken)).

### 7.1 Start – Beispielinhalt

Damit Entwürfe, Mockups (auch KI-generierte) und Vorschauen den richtigen Inhalt zeigen: so sieht Start mit
echten Daten aus, von oben nach unten. Alle Texte deutsch, Zahlen im deutschen Format (Dezimalkomma,
Tausenderpunkt, `€` nachgestellt mit Leerzeichen, Datum `TT.MM.JJJJ`).

1. **Kopf:** links Fahrzeugwechsler „VW Golf ▾“, rechts das Profilbild (kleiner Kreis).
2. **Hero:** Fahrzeugfoto, „VW Golf“, „B-FS 1234“, „84.312 km“, Badge „Benzin“.
3. **Drei Kennzahl-Kacheln in einer Reihe:**
   „6,4 l/100 km“ – Ø Verbrauch · „0,14 €/km“ – Kosten je km · „182,40 €“ – Diesen Monat.
   Termine gehören nicht in die Kacheln.
4. **Nächste Termine** (höchstens drei, „Alle anzeigen“):
   - TÜV – 23.11.2026 – Badge „in 12 Tagen“ (`StatusSoon`)
   - Inspektion – 06.11.2026 – Badge „seit 5 Tagen überfällig“ (`StatusOverdue`)
   - Versicherung – 01.03.2027 – Badge „in 4 Monaten“ (`StatusOK`)
5. **In der Nähe:** kleine Karte, „Aral Hauptstraße“, „Super E10 1,689 € · 350 m“.
6. **Letzte Einträge** (drei bis fünf, „Alle anzeigen“):
   - Tanken · Aral Hauptstraße · 08.11.2026 · 84.312 km · 62,30 €
   - Werkstatt · Ölwechsel · 02.11.2026 · 149,00 €
   - Fahrt · dienstlich · 31.10.2026 · 124 km

Bei einem E-Auto heißt die erste Kachel „16,8 kWh/100 km“ und der Eintrag „Laden · … · 18,40 €“.

**Häufige Fehler in Entwürfen:** englische Texte oder Zahlenformate (`6.4`, `$10.00`), Token-Namen als
Beschriftung, rote Badges für „bald fällig“, farbige Flächen mit weißer Schrift, Ziffernkästchen
(`CodeField`) für Kilometerstand oder Beträge, zwei „+“ auf einem Bildschirm, Farbe ohne Text (z. B.
farbige Pillen in Tabellen), sehr kleiner grauer Text.

## 8. Gemeinsame Bausteine

Jede Plattform hat diese Bausteine genau einmal und verwendet sie überall. Namen auf allen Plattformen gleich.

| Baustein | Inhalt |
|---|---|
| `CardContainer` | Fläche `Card`, Radius `radiusCard`, Innenabstand `m` |
| `StatTile` | Wert (`figure`), Einheit (`unit`), Beschriftung (`label`), optional Trend; Fläche `CardTint` |
| `SectionHeader` | Titel (`sectionTitle`) mit optionalem „Alle anzeigen“ |
| `FilterChip`, `ChipGroup` | Kapsel; gewählt `Brand`/`OnBrand`, sonst `CardTint`/`Text` |
| `StatusBadge` | OK / bald fällig / überfällig – Symbol **und** Text in Statusfarbe |
| `VehicleHero` | Foto, Name, Kennzeichen, Kilometerstand, Energie-Badge |
| `VehicleSwitcher` | Kopf-Knopf und Auswahlliste |
| `EntryRow` | Symbol im getönten Kreis (36), Titel, Datum und km, Betrag rechtsbündig |
| `PrimaryButton` | Volle Breite, `Brand`, Ladezustand, Mindesthöhe 44 pt / 48 dp / 44 px |
| `NumberField` | Großes Zahlenfeld mit sichtbarer Beschriftung und Einheit („Kilometerstand“, „km“), Zahlentastatur mit Komma; für Kilometerstand, Menge, Preis, Betrag |
| `CodeField` | Sechs Ziffernfelder **nur für den 2FA-Code**, mit Einfügen und Autofill |
| `EmptyState` | Symbol, ein Satz, eine Aktion |

Fahrzeug ohne Foto: getönter Platzhalter mit Auto-Symbol in der Energiefarbe des Fahrzeugs.

## 9. Plattform-Leitplanken

**Fest auf allen Plattformen (Marke):** Farb-Tokens, Abstände, Radien, Schriftrollen, Begriffe und
Bereiche, Reihenfolge der Inhalte auf Start, Statusfarben mit Symbol, „+“ in `Brand`.

**Plattformtypisch – erlaubt und erwünscht:**

| Thema | iOS | Android | Web/PWA |
|---|---|---|---|
| Navigation | Tab-Leiste unten, „+“ in der Mitte, kein FAB | Navigation Bar mit genau vier Zielen (ohne „+“) und FAB „+“; Navigation Rail auf großen Bildschirmen | Unter 992 px Tab-Leiste unten mit „+“ in der Mitte; ab 992 px Kopfleiste mit Symbolen und Button „Eintrag erfassen“ |
| Systemflächen | Liquid Glass/Materials der Systemleisten (iOS 26) nicht überdecken | Edge-to-edge, Systemleisten transparent | Safe Areas (`env(safe-area-inset-*)`), `theme-color` = `Background` |
| Symbole | SF Symbols | Material Symbols (Rounded) | Font Awesome (vorhanden) |
| Blätter/Dialoge | Sheets mit Detents | Modal Bottom Sheet, Vollbild-Dialog für Formulare | Offcanvas von unten (mobil), Modal (Desktop) |
| Rückmeldung | Haptik (Erfolg, Warnung) | Ripple, Haptik sparsam, Snackbar mit „Rückgängig“ | Toast; Fokus bleibt sichtbar |
| Zurück | Wischen vom Rand | Predictive Back | Browser-Zurück funktioniert auf jeder Seite |
| Aktualisieren | Pull-to-refresh | Pull-to-refresh | Pull-to-refresh in der installierten PWA, nicht in Formularen |
| Listen | Swipe-Aktionen | Swipe oder langes Drücken | Sichtbare Buttons (kein Wischen) |
| Dynamische Farben | – | **Aus**: Material You würde die Markenfarbe ersetzen | – |

Nicht erlaubt: eigene Schriften, Hex-Werte im Code, Leisten im Stil einer anderen Plattform (z. B. iOS-Tab-Leiste
auf Android, Material-FAB auf iOS), Werbebanner auf Start, Elemente aus Inspirations-Entwürfen eins zu eins.

## 10. Barrierefreiheit

Gilt für jede neue Seite und jeden Baustein auf allen Plattformen:

- **Kontrast:** Text mindestens 4,5:1, große Schrift (ab ca. 18 pt fett/24 pt) und Symbole 3:1, in beiden
  Modi. Neue Farben werden mit Wert hier eingetragen und geprüft.
- **Nie nur Farbe:** Status, Zweck und Kategorie immer mit Symbol oder Text.
- **Tippflächen:** mindestens 44 × 44 pt (iOS), 48 × 48 dp (Android), 44 × 44 px (Web), auch wenn das
  sichtbare Element kleiner ist.
- **Skalierbare Schrift:** Dynamic Type bis zu den Accessibility-Größen, `sp` mit Systemschriftgröße,
  `rem` mit Browser-Zoom bis 200 % ohne waagerechtes Scrollen. Layouts brechen um statt abzuschneiden.
- **Screenreader:** Jedes Bedienelement nur mit Symbol hat eine Bezeichnung (VoiceOver-Label,
  `contentDescription`, `aria-label`). Kennzahlen werden als ganzer Satz vorgelesen („Durchschnittsverbrauch
  6,4 Liter pro 100 Kilometer“). Dekorative Bilder sind ausgeblendet.
- **Formulare:** Sichtbare Beschriftung über jedem Feld (Platzhalter ist kein Label), Fehler als Text am
  Feld und für Screenreader angekündigt.
- **Diagramme:** Zusammenfassung in einem Satz (Spanne, Höchst- und Tiefstwert, Trend) und die Werte als
  Tabelle oder Liste erreichbar.
- **Fokus und Tastatur (Web):** sichtbarer Fokusrahmen in `Brand`, logische Reihenfolge, alles per Tastatur
  bedienbar.
- **Bewegung:** „Bewegung reduzieren“ wird respektiert.

## 11. Web und PWA

Plattform-Besonderheiten der Web-App (PHP mit Bootstrap 5.3):

- **Tokens:** `--fs-*` in `css/style.css`. Bootstrap bleibt die Grundlage; seine Variablen sind dort im
  Abschnitt „Thema“ auf die Tokens gelegt, statt eigene Komponenten nachzubauen. Dunkelmodus über
  `data-bs-theme="dark"`. Templates verwenden die Bootstrap-Klassen weiter (`btn-primary`, `card`, `badge`,
  `alert` …) und bekommen das Fuelstat-Aussehen von selbst.
- **Status-Klassen:** `btn-danger`, `text-bg-warning`, `alert-success` usw. sind getönte Flächen mit Text bzw.
  Symbol in der Statusfarbe – nie eine volle Statusfläche hinter Text.
- **Bausteine in PHP** (`includes/functions.php`): `symbolKreis()` (Symbol im getönten Kreis), `statusBadge()`
  (Status aus der API als Badge mit Symbol und Text), `energieFarbe()` und `fahrtFarbe()` (Token je
  Kraftstoffart bzw. Zweck), `terminAbstand()` („in 12 Tagen“). Dazu die CSS-Klassen `.kennzahl` (StatTile),
  `.chip`/`.chip-leiste` (FilterChip), `.fahrzeug-hero` (VehicleHero), `.eintrag-zeile` (EntryRow),
  `.leer-zustand` (EmptyState) und die Schriftrollen `.fs-<rolle>`.
- **Kopfleiste (PC):** Fahrzeugwechsler links, rechts der Button „Eintrag erfassen“ und die Bereiche als
  Symbole mit Tooltip und `aria-label` (#145); der aktive Bereich ist in `Brand` auf `CardTint` markiert.
- **Abstände:** Bootstrap-Abstände 1–3 (4, 8, 16 px) passen ins Raster; 4 (24) ebenfalls; 5 (48) nur für
  große Leerflächen. Für 12 und 32 die Tokens `--fs-space-s`/`--fs-space-xl`.
- **Navigation:** unter 992 px Tab-Leiste unten mit „+“-Kreis, darüber Kopfleiste mit Titel; ab 992 px
  Kopfleiste mit allen Bereichen. Beides respektiert Safe Areas.
- **PWA:** `manifest.json` (`theme_color`, `background_color`) und `<meta name="theme-color">` verwenden
  `Background` des aktiven Modus. Pull-to-refresh nur in der installierten App und nicht in Formularen.
- **Diagramme (Chart.js):** Farben aus den CSS-Variablen lesen (`getComputedStyle`), nicht im Skript festlegen.
  Beim Wechsel der Darstellung lädt eine Seite mit Diagrammen neu, damit die Reihen die Farben des neuen Modus bekommen.
- **Bereiche:** Die Web-App zeigt auf „Start“ alle Fahrzeuge als Karten und die Bereiche Einträge, Statistiken,
  Ausgaben und Fahrten als Reiter der Fahrzeugseite. Die Aufteilung aus Abschnitt 7 (Start mit einem gewählten
  Fahrzeug) ist das Ziel für einen späteren Schritt.
- **Seitenbreite:** Inhalt in `container-xl` (max. 1200 px); Formulare in einer Spalte bis 640 px.

## 12. Bestandsaufnahme und Entscheidungen

Stand November 2026, Quellen: `docs/design.md` in fuelstat-ios und fuelstat-android, `css/style.css`,
`includes/kategorien.php`, `backend/src/services/categories.js`, `tabs/fahrten.php`, `manifest.json`.

| # | Widerspruch | Entscheidung |
|---|---|---|
| 1 | Markenfarbe: Web Bootstrap-Blau `#0D6EFD`, iOS Petrol `#0A717A` | Petrol/Teal (`Brand`). Im Web umgestellt. |
| 2 | Dunkler Hintergrund: iOS Systemschwarz, Web Bootstrap `#212529`, Android offen | `#0E1624` (Navy) überall; iOS-Asset angepasst. |
| 3 | Tanken: Web blau, iOS je Kraftstoffart | Energiefarbe der Kraftstoffart; Laden immer `EnergyElectric`. Im Web umgestellt. |
| 4 | Fahrt-Zwecke: Web Bootstrap `secondary`/`primary`/`info`, sonst nicht festgelegt | `TripPrivate` neutral, `TripBusiness` = `Brand`, `TripCommute` Cyan – gleiche Logik wie bisher im Web. |
| 5 | Kategoriefarben (Bootstrap-Palette aus der API) nicht für Dunkelmodus geprüft | Bleiben Daten der API; nur als Fläche mit Namen daneben (3.5). Prüfung der Palette ist ein eigenes Thema für die API. |
| 6 | Radien: Web `.75rem` (12) für Kacheln, `1.25rem` für Blätter; iOS 20/14 | 20 (Karten, Blätter) und 14 (Kacheln, Felder, Buttons). |
| 7 | Abstände: Bootstrap 4/8/16/24/48, iOS 4/8/12/16/24/32 | Stufen aus 5.1; Bootstrap-Stufen, die passen, bleiben nutzbar. |
| 8 | Android: Dynamic Color offen | Aus, damit die Marke erkennbar bleibt. |
| 9 | Textfarben nur implizit (Systemfarben, Bootstrap `#212529`) | `Text`, `TextSecondary`, `Separator` als Tokens; iOS nutzt weiter Systemfarben. |
| 10 | Schrift: iOS-Stile ohne Entsprechung im Web, Android nur „Material-Skala“ | Rollen in Abschnitt 4 mit Zuordnung je Plattform. |
| 11 | `theme-color` im Web hell `#F8F9FA` / dunkel `#2B3035` | Ist jetzt `Background` (`#F2F6F8` / `#0E1624`). |
| 12 | Bezeichnung des „+“: Web „Neuer Eintrag“, iOS „Eintrag erfassen“ | „Eintrag erfassen“ überall; im Web umgestellt. |

**Ausblick:** Sobald die Tokens stabil sind, kann eine maschinenlesbare Token-Datei (Design-Tokens-Format)
CSS, iOS-Asset-Katalog und Compose-Theme erzeugen (in #153 bewusst nicht enthalten).
