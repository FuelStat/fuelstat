<?php
/**
 * Hilfsfunktionen für die Ausgabe von API-Daten im bisherigen Anzeigeformat.
 * Stellt z.B. zusammengeführte Einträge (Fillups + Entries) und Stats bereit.
 */

require_once __DIR__ . '/api_config.php';
require_once __DIR__ . '/fuelstat_api.php';
require_once __DIR__ . '/kategorien.php';

if (!function_exists('getApiClient')) {
    function getApiClient(?string $token = null): FuelstatApi
    {
        return new FuelstatApi($token ?? getApiToken());
    }
}

/**
 * URL einer mitgelieferten Datei mit ?v=<Änderungszeit>, damit nach einem Deploy nie eine alte Version aus dem Cache kommt
 * @param string $praefix $baseUrl oder ein relativer Pfad wie '../'
 * @param string $pfad Pfad ab dem App-Verzeichnis, z. B. 'vendor/bootstrap/bootstrap.min.css'
 */
function assetUrl(string $praefix, string $pfad): string
{
    return $praefix . $pfad . '?v=' . (@filemtime(__DIR__ . '/../' . $pfad) ?: 1);
}

/**
 * Läuft die Beta-Phase? (aus /health der API, 10 Minuten in der Session zwischengespeichert)
 */
function istBetaPhase(): bool
{
    $cache = $_SESSION['beta_phase_cache'] ?? null;
    if (is_array($cache) && $cache['bis'] > time()) {
        return $cache['wert'];
    }
    try {
        $wert = (getApiClient(null)->getHealth()['beta_phase'] ?? false) === true;
    } catch (Throwable $e) {
        return false;
    }
    if (session_status() === PHP_SESSION_ACTIVE) {
        $_SESSION['beta_phase_cache'] = ['wert' => $wert, 'bis' => time() + 600];
    }
    return $wert;
}

/**
 * Gültige Fassung der Nutzungsbedingungen (#135) aus /health (TERMS_VERSION der API), 10 Minuten zwischengespeichert;
 * null = keine Zustimmung nötig.
 */
function nutzungsbedingungenVersion(): ?string
{
    $cache = $_SESSION['terms_version_cache'] ?? null;
    if (is_array($cache) && $cache['bis'] > time()) {
        return $cache['wert'];
    }
    try {
        $wert = getApiClient(null)->getHealth()['terms_version'] ?? null;
        $wert = is_string($wert) && $wert !== '' ? $wert : null;
    } catch (Throwable $e) {
        return null;
    }
    if (session_status() === PHP_SESSION_ACTIVE) {
        $_SESSION['terms_version_cache'] = ['wert' => $wert, 'bis' => time() + 600];
    }
    return $wert;
}

/** "Stand" der Nutzungsbedingungen: Version im Format JJJJ-MM-TT als Datum, sonst die Version selbst */
function nutzungsbedingungenStand(?string $version): string
{
    if ($version !== null && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $version, $m)) {
        $monate = [1 => 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        return (int)$m[3] . '. ' . $monate[(int)$m[2]] . ' ' . $m[1];
    }
    return $version ?? 'Entwurf';
}

/**
 * Fillups und Entries einer Fahrzeug-ID holen und zu einer einheitlichen Liste
 * mit Keys (id, datum, kategorie, menge, kosten, tachostand, vollgetankt, …) zusammenführen.
 * @return array [ 'eintraege' => [ 'Y-m' => [ ... ] ], 'jahrListe' => [ Jahre ] ]
 */
function getMergedEintraegeFromApi($api, string $vehicleId): array
{
    // Die Fahrzeugseite braucht die Einträge in mehreren Reitern: einmal pro Seitenaufruf laden (#89)
    // WeakMap: der Zwischenspeicher hängt am API-Objekt und verschwindet mit ihm (keine veralteten Daten)
    static $zwischenspeicher = null;
    $zwischenspeicher ??= new WeakMap();
    $jeFahrzeug = $zwischenspeicher[$api] ?? [];
    if (!isset($jeFahrzeug[$vehicleId])) {
        $jeFahrzeug[$vehicleId] = ladeMergedEintraegeFromApi($api, $vehicleId);
        $zwischenspeicher[$api] = $jeFahrzeug;
    }
    return $jeFahrzeug[$vehicleId];
}

function ladeMergedEintraegeFromApi($api, string $vehicleId): array
{
    $fillups = [];
    $entries = [];
    $fahrten = [];
    try {
        $fillups = $api->getAllVehicleFillups($vehicleId);
        $entries = $api->getAllVehicleEntries($vehicleId);
    } catch (Throwable $e) {
        return ['eintraege' => [], 'jahrListe' => []];
    }
    try {
        $fahrten = $api->getVehicleTrips($vehicleId);
    } catch (Throwable $e) {
        error_log('[Einträge] Fahrten nicht geladen: ' . $e->getMessage());
    }

    $stats = null;
    try {
        $stats = $api->getVehicleStats($vehicleId);
    } catch (Throwable $e) {
    }

    $lPer100ByFillupId = [];
    if ($stats && !empty($stats['segments'])) {
        foreach ($stats['segments'] as $seg) {
            // Nebenbei getankte Energieart (#140, z. B. Benzin beim Autogas-Auto): kein Verbrauch je Eintrag
            if (!empty($stats['energies'][$seg['energy'] ?? '']['minor'])) {
                continue;
            }
            if (isset($seg['full_id'], $seg['l_per_100km'])) {
                $lPer100ByFillupId[$seg['full_id']] = $seg['l_per_100km'];
            }
        }
    }

    $list = [];

    foreach ($fillups as $f) {
        $datum = isset($f['filled_at']) ? date('Y-m-d', strtotime($f['filled_at'])) : '';
        $list[] = [
            'id' => $f['id'],
            'type' => 'fillup',
            'datum' => $datum,
            'kategorie' => 'Tankfuellung',
            'menge' => $f['amount'] ?? 0,
            'kosten' => $f['total_cost_eur'] ?? 0,
            // null = Tachostand fehlt (#41), kann nachgetragen werden
            'tachostand' => isset($f['odometer_km']) ? (int)$f['odometer_km'] : null,
            'tachostand_geschaetzt' => !empty($f['odometer_estimated']),
            'vollgetankt' => $f['is_full'] ?? true,
            'skip_previous' => $f['skip_previous'] ?? false,
            'standort' => $f['station'] ?? '',
            'einheit' => $f['unit'] ?? 'l',
            'sorte' => $f['fuel'] ?? null,
            'l_per_100km' => $lPer100ByFillupId[$f['id']] ?? null,
            // Geteilte Fahrzeuge (#53): wer den Eintrag erfasst hat
            'erfasst_von' => $f['created_by'] ?? null,
            'erfasst_von_name' => $f['created_by_name'] ?? null,
        ];
    }

    foreach ($entries as $e) {
        $datum = isset($e['occurred_at']) ? date('Y-m-d', strtotime($e['occurred_at'])) : '';
        $list[] = [
            'id' => $e['id'],
            'type' => 'entry',
            'datum' => $datum,
            'kategorie' => $e['category'] ?? 'Sonstige',
            'kosten' => $e['amount_eur'] ?? 0,
            'tachostand' => $e['odometer_km'] ?? null,
            'beschreibung' => $e['description'] ?? '',
            'standort' => $e['vendor'] ?? '',
            'menge' => null,
            'vollgetankt' => false,
            'erfasst_von' => $e['created_by'] ?? null,
            'erfasst_von_name' => $e['created_by_name'] ?? null,
        ];
    }

    // Fahrtenbuch (#52): Fahrten als eigene Einträge, Bearbeiten über pages/fahrt.php
    foreach ($fahrten as $t) {
        $list[] = [
            'id' => $t['id'],
            'type' => 'trip',
            'datum' => isset($t['started_at']) ? date('Y-m-d', strtotime($t['started_at'])) : '',
            'kategorie' => 'Fahrt',
            'kosten' => 0,
            'tachostand' => $t['odometer_end'] ?? null,
            'beschreibung' => fahrtText($t),
            'standort' => '',
            'menge' => null,
            'vollgetankt' => false,
            'zweck' => $t['purpose'] ?? 'private',
            'erfasst_von' => $t['created_by'] ?? null,
            'erfasst_von_name' => $t['created_by_name'] ?? null,
        ];
    }

    usort($list, function ($a, $b) {
        $d = strcmp($b['datum'], $a['datum']);
        if ($d !== 0) return $d;
        // Ohne Tachostand bei gleichem Datum oben (= nach den Einträgen mit Tachostand, wie in der Statistik)
        $ta = $a['tachostand'] ?? PHP_INT_MAX;
        $tb = $b['tachostand'] ?? PHP_INT_MAX;
        return $tb <=> $ta;
    });

    $eintraege = [];
    $jahre = [];
    foreach ($list as $row) {
        $monat = $row['datum'] ? substr($row['datum'], 0, 7) : '';
        if ($monat) {
            $eintraege[$monat][] = $row;
            $y = (int)substr($row['datum'], 0, 4);
            if ($y && !in_array($y, $jahre, true)) {
                $jahre[] = $y;
            }
        }
    }
    rsort($jahre);

    return ['eintraege' => $eintraege, 'jahrListe' => $jahre];
}

/**
 * Stats für Anzeige (Tachostand, Verbrauch, Trend) aus API.
 */
function getVehicleStatsForDisplay($api, string $vehicleId): array
{
    try {
        return $api->getVehicleStats($vehicleId);
    } catch (Throwable $e) {
        return [];
    }
}

/**
 * Gefahrene Kilometer aus der API (/stats → distance, #82): seit Anschaffung, sonst seit dem ersten Eintrag.
 * @param array $stats Antwort von getVehicleStatsForDisplay()
 * @return array|null [ 'km' => int, 'basis' => string ]
 */
function getFahrleistungFromApi(array $stats): ?array
{
    $d = $stats['distance'] ?? null;
    if (!is_array($d) || !isset($d['km'])) {
        return null;
    }
    return ['km' => (int)$d['km'], 'basis' => ($d['since'] ?? '') === 'purchase' ? 'seit Anschaffung' : 'seit dem ersten Eintrag'];
}

/**
 * Letzten Eintrag einer Kategorie für ein Fahrzeug (aus API Entries).
 */
function getLetzterEintragApi($api, string $vehicleId, string $category): ?array
{
    try {
        $entries = $api->getAllVehicleEntries($vehicleId);
        foreach ($entries as $e) {
            if (isset($e['category']) && strcasecmp($e['category'], $category) === 0) {
                return [
                    'datum' => $e['occurred_at'] ?? '',
                    'tachostand' => $e['odometer_km'] ?? null,
                    'kosten' => $e['amount_eur'] ?? 0,
                    'beschreibung' => $e['description'] ?? '',
                ];
            }
        }
    } catch (Throwable $e) {
    }
    return null;
}

/** Tachostand vorhanden und nicht nur geschätzt (#41)? */
function hatEchtenTachostand(array $row): bool
{
    return isset($row['tachostand']) && $row['tachostand'] !== '' && empty($row['tachostand_geschaetzt']);
}

/**
 * Statistik- und Ausgabendaten für Statistik, Übersicht und Bericht. Alle Werte rechnet die API (#82):
 * Verbrauch, Mengen und CO₂ aus /vehicles/:id/consumption, Kosten aus /vehicles/:id/costs.
 * Diese Funktion bringt sie nur in die Form, die die Seiten erwarten.
 *
 * @param int|null $jahr Kosten (Kategorien, Monate) nur für dieses Jahr; Verbrauch immer gesamt
 */
function getStatistikDatenFromApi($api, string $vehicleId, ?int $jahr = null): array
{
    $leer = ['verbrauchswerte' => [], 'verbrauchProMonat' => [], 'kostenProMonat' => [], 'jahresdaten' => [],
        'ausgabenDaten' => [], 'detailAusgabenDaten' => [], 'verfuegbareJahre' => [], 'einheiten' => [],
        'verbrauch' => null, 'kosten' => null];
    $pfad = '/vehicles/' . rawurlencode($vehicleId);
    $api->vorladen([$pfad . '/consumption', $pfad . '/costs' . ($jahr !== null ? '?year=' . $jahr : '')]);
    try {
        $verbrauch = $api->getVehicleConsumption($vehicleId);
        $kosten = $api->getVehicleCosts($vehicleId, $jahr);
    } catch (Throwable $e) {
        return $leer;
    }

    $jahre = $kosten['years'] ?? [];
    $einheiten = [];
    // Je Energieart (#140: Benzin und Autogas getrennt, E5/E10 zusammen)
    foreach ($verbrauch['energies'] ?? [] as $u) {
        $ud = $verbrauch['byEnergy'][$u];
        // Verbrauch je Abschnitt: Datum der abschließenden vollen Füllung; weitere am selben Tag mit " #2", " #3" …
        $werte = [];
        foreach ($ud['segments'] as $seg) {
            if ($seg['consumption'] === null) continue;
            $schluessel = $seg['date'];
            for ($n = 2; isset($werte[$schluessel]); $n++) {
                $schluessel = $seg['date'] . ' #' . $n;
            }
            $werte[$schluessel] = (float)$seg['consumption'];
        }
        $monate = [];
        foreach ($ud['months'] as $m) {
            $monate[$m['month']] = (float)($m['consumption'] ?? 0);
        }
        // Jahresübersicht mit allen Jahren, in denen es Kosten gab (auch ohne Tank-/Ladevorgang)
        $jahresdaten = [];
        foreach (array_unique(array_merge($jahre, array_column($ud['years'], 'year'))) as $y) {
            $jahresdaten[(int)$y] = ['anzahl_tankstops' => 0, 'gekauft_menge' => 0.0, 'gekauft_ausgaben' => 0.0,
                'verbrauch_menge' => 0.0, 'verbrauch_km' => 0.0, 'verbrauch_l100km' => 0.0, 'co2_kg' => null];
        }
        foreach ($ud['years'] as $y) {
            $jahresdaten[(int)$y['year']] = [
                'anzahl_tankstops' => (int)$y['fillCount'],
                'gekauft_menge' => (float)$y['amountBought'],
                'gekauft_ausgaben' => (float)$y['cost'],
                'verbrauch_menge' => (float)$y['amountConsumed'],
                'verbrauch_km' => (float)$y['kmConsumed'],
                'verbrauch_l100km' => (float)($y['consumption'] ?? 0),
                'co2_kg' => $y['co2Kg'],
            ];
        }
        krsort($jahresdaten);
        $einheiten[$u] = ['verbrauchswerte' => $werte, 'verbrauchProMonat' => $monate, 'jahresdaten' => $jahresdaten, 'api' => $ud,
            'einheit' => $ud['unit'] ?? $u, 'energie' => $ud['energy'] ?? null, 'name' => $ud['name'] ?? null,
            // Nebenbei getankt (z. B. Benzin beim Autogas-Auto): kein aussagekräftiger Verbrauch
            'nebenbei' => !empty($ud['minor'])];
    }

    // Kosten je Kategorie; Tank- und Ladevorgänge zusammen als "Tankfuellung" (Plug-in-Hybrid getrennt siehe 'kosten')
    $detail = [];
    foreach ($kosten['categories'] ?? [] as $c) {
        $k = str_starts_with($c['key'], 'Tankfuellung:') ? 'Tankfuellung' : $c['key'];
        $detail[$k] ??= ['summe' => 0.0, 'anzahl' => 0];
        $detail[$k]['summe'] += (float)$c['total'];
        $detail[$k]['anzahl'] += (int)$c['count'];
    }
    $kostenProMonat = [];
    foreach ($kosten['months'] ?? [] as $m) {
        if ($m['total'] > 0) {
            $kostenProMonat[$m['month']] = (float)$m['total'];
        }
    }
    ksort($kostenProMonat);

    $haupt = $einheiten ? reset($einheiten) : ['verbrauchswerte' => [], 'verbrauchProMonat' => [], 'jahresdaten' => array_fill_keys($jahre, [])];
    return [
        'verbrauchswerte' => $haupt['verbrauchswerte'],
        'verbrauchProMonat' => $haupt['verbrauchProMonat'],
        'kostenProMonat' => $kostenProMonat,
        'jahresdaten' => $haupt['jahresdaten'],
        'ausgabenDaten' => array_map(fn($x) => $x['summe'], $detail),
        'detailAusgabenDaten' => $detail,
        'verfuegbareJahre' => $jahre,
        'einheiten' => $einheiten,
        'gesamtKosten' => (float)($kosten['total']['total'] ?? 0),
        // Rohdaten der API für Kennzahlen (Ø, Min, Max, CO₂, Stromanteil, Kosten pro km)
        'verbrauch' => $verbrauch,
        'kosten' => $kosten,
    ];
}

/**
 * Fahrzeugdaten aus dem Formular (includes/form_fahrzeug.php) für die API aufbereiten.
 * Leere optionale Felder werden als null gesendet, damit sie beim Bearbeiten gelöscht werden.
 */
/**
 * Kraftstoffsorten und Energiearten aus der API (#140), je Sitzung eine Stunde zwischengespeichert.
 * @return array{sorten: array<string, array>, energien: array<string, array>, standards: array<string, string[]>}
 */
function sortenKatalog(): array
{
    static $katalog = null;
    if ($katalog !== null) {
        return $katalog;
    }
    $cache = $_SESSION['sorten_katalog'] ?? null;
    if (!is_array($cache) || ($cache['zeit'] ?? 0) < time() - 3600 || empty($cache['daten']['fuels'])) {
        try {
            $cache = ['zeit' => time(), 'daten' => getApiClient()->getFuels()];
            $_SESSION['sorten_katalog'] = $cache;
        } catch (Throwable $e) {
            $cache = ['zeit' => 0, 'daten' => []];
        }
    }
    $d = $cache['daten'];
    return $katalog = [
        'sorten' => array_column($d['fuels'] ?? [], null, 'key'),
        'energien' => array_column($d['energies'] ?? [], null, 'key'),
        'standards' => $d['fuelTypeDefaults'] ?? [],
    ];
}

/** Sorten eines Fahrzeugs (Standard zuerst); ohne Sortenliste (Katalog nicht erreichbar): aus der Antriebsart */
function sortenDesFahrzeugs(array $fahrzeug): array
{
    $sorten = array_values(array_filter((array)($fahrzeug['fuels'] ?? []), 'is_string'));
    if (!$sorten) {
        $sorten = sortenKatalog()['standards'][$fahrzeug['fuel_type'] ?? ''] ?? [];
    }
    $standard = standardSorte($fahrzeug, $sorten);
    if ($standard !== null) {
        $sorten = array_values(array_unique(array_merge([$standard], $sorten)));
    }
    return $sorten;
}

function standardSorte(array $fahrzeug, ?array $sorten = null): ?string
{
    $sorten ??= array_values((array)($fahrzeug['fuels'] ?? []));
    $standard = $fahrzeug['default_fuel'] ?? null;
    return in_array($standard, $sorten, true) ? $standard : ($sorten[0] ?? null);
}

/** Anzeigename einer Sorte, z. B. „Super E10“ */
function sortenName(?string $sorte): string
{
    return (string)(sortenKatalog()['sorten'][$sorte]['name'] ?? $sorte ?? '');
}

function fahrzeugDatenAusPost(array $post): array
{
    $optionalInt = function (string $key) use ($post) {
        $v = trim((string)($post[$key] ?? ''));
        return $v === '' ? null : (int)$v;
    };
    $optionalText = function (string $key) use ($post) {
        $v = trim((string)($post[$key] ?? ''));
        return $v === '' ? null : $v;
    };
    $tank = trim(str_replace(',', '.', (string)($post['tankCapacity'] ?? '')));
    // Akku nur beim Plug-in-Hybrid (Elektroautos tragen ihren Akku im Feld für den Tank ein)
    $akku = ($post['fuelType'] ?? '') === 'phev' ? trim(str_replace(',', '.', (string)($post['batteryCapacity'] ?? ''))) : '';
    // Kraftstoffsorten (#140): Mehrfachauswahl, einer davon Standard
    $sorten = array_values(array_unique(array_filter(array_map('strval', (array)($post['fuels'] ?? [])), fn($s) => $s !== '')));
    $standard = (string)($post['defaultFuel'] ?? '');

    return [
        'name' => trim((string)($post['name'] ?? '')),
        'fuelType' => (string)($post['fuelType'] ?? ''),
        'brand' => $optionalText('brand'),
        'model' => $optionalText('model'),
        'year' => $optionalInt('year'),
        'odometerKm' => $optionalInt('odometerKm'),
        'tankCapacity' => $tank === '' ? null : (float)$tank,
        'batteryCapacity' => $akku === '' ? null : (float)$akku,
    ] + ($sorten ? ['fuels' => $sorten, 'defaultFuel' => in_array($standard, $sorten, true) ? $standard : $sorten[0]] : [])
      + fahrzeugZusatzAusPost($post);
}

/** Zusatzangaben zum Fahrzeug (#45): Formularfeld => [API-Name, Typ, Beschriftung für Fehlermeldungen] */
function fahrzeugZusatzFelder(): array
{
    return [
        'licensePlate' => ['text', 'Kennzeichen'],
        'vin' => ['text', 'FIN'],
        'firstRegistration' => ['datum', 'Erstzulassung'],
        'purchaseDate' => ['datum', 'Kaufdatum'],
        'purchasePrice' => ['zahl', 'Kaufpreis'],
        'saleDate' => ['datum', 'Verkaufsdatum'],
        'salePrice' => ['zahl', 'Verkaufspreis'],
        'serviceIntervalMonths' => ['ganzzahl', 'Wartungsintervall (Monate)'],
        'serviceIntervalKm' => ['ganzzahl', 'Wartungsintervall (km)'],
        'oilIntervalMonths' => ['ganzzahl', 'Ölwechsel (Monate)'],
        'oilIntervalKm' => ['ganzzahl', 'Ölwechsel (km)'],
        'insuranceCompany' => ['text', 'Versicherung'],
        'insurancePremium' => ['zahl', 'Versicherungsbeitrag'],
        'insuranceDueMonth' => ['ganzzahl', 'Fälligkeit Versicherung'],
        'taxAmount' => ['zahl', 'Kfz-Steuer'],
        'taxDueMonth' => ['ganzzahl', 'Fälligkeit Kfz-Steuer'],
        'tireSizeSummer' => ['text', 'Reifengröße Sommer'],
        'tireSizeWinter' => ['text', 'Reifengröße Winter'],
    ];
}

/** Zusatzangaben aus dem Formular; leere Felder werden als null gesendet (= löschen). */
function fahrzeugZusatzAusPost(array $post): array
{
    $daten = [];
    foreach (fahrzeugZusatzFelder() as $feld => [$typ]) {
        $wert = trim((string)($post[$feld] ?? ''));
        if ($wert === '') {
            $daten[$feld] = null;
        } elseif ($typ === 'zahl') {
            $daten[$feld] = is_numeric(str_replace(',', '.', $wert)) ? (float)str_replace(',', '.', $wert) : $wert;
        } elseif ($typ === 'ganzzahl') {
            $daten[$feld] = ctype_digit($wert) ? (int)$wert : $wert;
        } else {
            $daten[$feld] = $wert;
        }
    }
    return $daten;
}

/** Verständliche Meldung für Fehler der Fahrzeug-API (z. B. invalid_taxDueMonth) */
function fahrzeugFehlerText(Throwable $e): string
{
    $code = $e->getMessage();
    if (str_starts_with($code, 'invalid_')) {
        $feld = substr($code, 8);
        $namen = array_map(fn($f) => $f[1], fahrzeugZusatzFelder()) + ['year' => 'Baujahr', 'odometerKm' => 'Tachostand', 'tankCapacity' => 'Tank-/Akkugröße', 'batteryCapacity' => 'Akkugröße', 'name' => 'Name'];
        if (isset($namen[$feld])) {
            return 'Bitte prüfen: ' . $namen[$feld] . '.';
        }
    }
    return tarifHinweis($e) ?? $code;
}

/**
 * Hochgeladenes Fahrzeugbild speichern bzw. Bild entfernen (Feld "bild" / Checkbox "bild_entfernen").
 * Ältere Bilder des Fahrzeugs werden dabei gelöscht.
 * @return string|null Fehlermeldung oder null bei Erfolg/keiner Änderung
 */
function speichereFahrzeugBild($api, string $vehicleId, array $files, array $post): ?string
{
    $datei = $files['bild'] ?? null;
    $hatDatei = $datei && ($datei['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
    $entfernen = !empty($post['bild_entfernen']);

    if (!$hatDatei && !$entfernen) {
        return null;
    }

    try {
        $alteMedien = $api->getVehicleMedia($vehicleId);
    } catch (Throwable $e) {
        $alteMedien = [];
    }

    $neueMediaId = null;
    if ($hatDatei) {
        if ($datei['error'] !== UPLOAD_ERR_OK) {
            return $datei['error'] === UPLOAD_ERR_INI_SIZE || $datei['error'] === UPLOAD_ERR_FORM_SIZE
                ? 'Das Bild ist zu groß.'
                : 'Das Bild konnte nicht hochgeladen werden.';
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($datei['tmp_name']) ?: '';
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true)) {
            return 'Nur JPEG, PNG, GIF und WebP sind als Bild erlaubt.';
        }
        try {
            $media = $api->uploadVehicleMedia($vehicleId, $datei['tmp_name'], $mime, basename((string)$datei['name']));
            $api->patchVehicle($vehicleId, ['imageUrl' => $media['url']]);
            $neueMediaId = $media['id'] ?? null;
        } catch (Throwable $e) {
            return tarifHinweis($e) ?? 'Bild-Upload fehlgeschlagen: ' . $e->getMessage();
        }
    } else {
        try {
            $api->patchVehicle($vehicleId, ['imageUrl' => null]);
        } catch (Throwable $e) {
            return 'Bild konnte nicht entfernt werden: ' . $e->getMessage();
        }
    }

    foreach ($alteMedien as $m) {
        if (isset($m['id']) && $m['id'] !== $neueMediaId) {
            try {
                $api->deleteVehicleMedia($vehicleId, $m['id']);
            } catch (Throwable $e) {
                error_log('[Fahrzeugbild] Altes Bild nicht gelöscht: ' . $e->getMessage());
            }
        }
    }
    return null;
}

/**
 * Fälligkeiten (TÜV, Wartung, Versicherung, Steuer) aus der API (Regeln in backend/src/services/reminders.js).
 * @return array Liste mit titel, kategorie, letzte, faellig_datum, faellig_km, status (ok|bald|ueberfaellig|unbekannt), tage
 */
function getFaelligkeitenFromApi($api, string $vehicleId): array
{
    try {
        $liste = $api->getVehicleReminders($vehicleId);
    } catch (Throwable $e) {
        return [];
    }
    return array_map(fn($r) => [
        'titel' => $r['title'],
        'kategorie' => $r['category'],
        'letzte' => $r['last'],
        'faellig_datum' => $r['due_date'],
        'faellig_km' => $r['due_km'],
        'status' => $r['status'],
        'tage' => $r['days'],
        'quelle' => $r['source'] ?? null, // eintrag | erstzulassung | faelligkeitsmonat (#45)
    ], $liste);
}

/**
 * Menge und Gesamtpreis eines Tank- bzw. Ladevorgangs aus dem Formular. Fehlt einer der beiden Werte,
 * wird er aus dem Preis pro Einheit berechnet. Leer ist nicht 0: ohne Angabe gibt es eine Fehlermeldung,
 * eine bewusst eingetragene 0 (z. B. kostenloses Laden) bleibt erlaubt.
 * @return array ['menge' => float|null, 'kosten' => float|null, 'fehler' => string|null]
 */
function mengeUndKostenAusFormular(array $post): array
{
    $zahl = function (string $key) use ($post): ?float {
        $v = trim(str_replace(',', '.', (string)($post[$key] ?? '')));
        return $v === '' || !is_numeric($v) ? null : (float)$v;
    };
    $menge = $zahl('menge');
    $preis = $zahl('preis_pro_einheit');
    $kosten = $zahl('kosten');

    if ($kosten === null && $menge !== null && $preis !== null) {
        $kosten = round($menge * $preis, 2);
    }
    if ($menge === null && $kosten !== null && $preis !== null && $preis > 0) {
        $menge = round($kosten / $preis, 2);
    }

    $fehler = null;
    if ($menge === null || $menge <= 0) {
        $fehler = 'Bitte die Menge angeben (oder Gesamtpreis und Preis pro Einheit).';
    } elseif ($kosten === null || $kosten < 0) {
        $fehler = 'Bitte den Gesamtpreis angeben (oder den Preis pro Einheit). Für kostenloses Laden 0 eintragen.';
    }
    return ['menge' => $menge, 'kosten' => $kosten, 'fehler' => $fehler];
}

/** Fahrtenbuch (#52): Anzeigenamen der Zwecke */
function fahrtZwecke(): array
{
    return ['private' => 'Privat', 'business' => 'Dienstlich', 'commute' => 'Arbeitsweg'];
}

/** Kurztext einer Fahrt aus dem Fahrtenbuch, z. B. "Bolbingen → Aalen · Dienstlich · 42 km" */
function fahrtText(array $t): string
{
    $strecke = implode(' → ', array_filter([(string)($t['start_place'] ?? ''), (string)($t['end_place'] ?? '')], fn($x) => $x !== ''));
    $km = (float)($t['distance_km'] ?? 0);
    return implode(' · ', array_filter([
        $strecke,
        fahrtZwecke()[$t['purpose'] ?? ''] ?? '',
        $km > 0 ? number_format($km, fmod($km, 1) ? 1 : 0, ',', '.') . ' km' : '',
        (string)($t['note'] ?? ''),
    ], fn($x) => $x !== ''));
}

/**
 * Beschreibung einer Fahrt aus dem Formular, z. B. "Bolbingen → Aalen – Arbeit (42 km)".
 * Bis zum neuen Fahrtenbuch (#52) stehen die gefahrenen Kilometer in der Beschreibung (#43).
 */
function fahrtBeschreibung(array $post): string
{
    $start = trim((string)($post['startort'] ?? ''));
    $ziel = trim((string)($post['zielort'] ?? ''));
    $zweck = trim((string)($post['zweck'] ?? ''));
    $km = trim(str_replace(',', '.', (string)($post['gefahrene_km'] ?? '')));

    $strecke = implode(' → ', array_filter([$start, $ziel], fn($t) => $t !== ''));
    $text = implode(' – ', array_filter([$strecke, $zweck], fn($t) => $t !== ''));
    if (is_numeric($km) && (float)$km > 0) {
        $text .= ($text !== '' ? ' ' : '') . '(' . number_format((float)$km, fmod((float)$km, 1) ? 1 : 0, ',', '.') . ' km)';
    }
    return $text !== '' ? $text : 'Fahrt';
}

/**
 * Gegenstück zu fahrtBeschreibung(): Von, Nach, Zweck und km aus der gespeicherten Beschreibung (zum Bearbeiten).
 * Freier Text, der nicht dem Muster folgt, landet vollständig im Zweck.
 */
function fahrtAusBeschreibung(?string $text): array
{
    $text = trim((string)$text);
    $ergebnis = ['startort' => '', 'zielort' => '', 'zweck' => '', 'gefahrene_km' => ''];
    if ($text === '' || $text === 'Fahrt') {
        return $ergebnis;
    }
    if (preg_match('/^(.*?)\s*\(([\d.]+(?:,\d+)?) km\)$/u', $text, $m)) {
        $ergebnis['gefahrene_km'] = str_replace(',', '.', str_replace('.', '', $m[2]));
        $text = $m[1];
    }
    $teile = explode(' – ', $text, 2);
    $strecke = $teile[0];
    $zweck = $teile[1] ?? '';
    if (str_contains($strecke, ' → ')) {
        [$ergebnis['startort'], $ergebnis['zielort']] = array_map('trim', explode(' → ', $strecke, 2));
        $ergebnis['zweck'] = trim($zweck);
    } elseif ($zweck === '' && $strecke !== '' && $ergebnis['gefahrene_km'] !== '') {
        // "Ulm (12 km)": nur ein Ort
        $ergebnis['zielort'] = trim($strecke);
    } else {
        $ergebnis['zweck'] = trim($text);
    }
    return $ergebnis;
}

/** Verständliche Meldung für Fehler der Ausgaben-API (Kategorie, Tarif) */
function eintragFehlerText(Throwable $e): string
{
    $hinweis = tarifHinweis($e);
    if ($hinweis !== null) {
        return $hinweis;
    }
    return [
        'unknown_category' => 'Diese Kategorie gibt es nicht (mehr). Bitte eine andere wählen.',
        'invalid_category' => 'Bitte eine Kategorie wählen.',
        'missing_category' => 'Bitte eine Kategorie wählen.',
        'invalid_amountEur' => 'Bitte einen gültigen Betrag eingeben.',
        'invalid_odometerKm' => 'Bitte einen gültigen Tachostand eingeben.',
    ][$e->getMessage()] ?? $e->getMessage();
}

/**
 * Tarife (Issue #44): Text für die API-Antwort 403 plan_required, sonst null.
 * Solange PLAN_LIMITS_ENABLED in der API aus ist, kommt diese Antwort nie.
 */
function tarifHinweis(Throwable $e): ?string
{
    if ($e instanceof FuelstatApiException && $e->getMessage() === 'email_not_verified') {
        return emailBestaetigenHinweis($e);
    }
    // Geteilte Fahrzeuge (#53)
    $zugriff = [
        'read_only' => 'Dieses Fahrzeug ist mit dir nur zum Ansehen geteilt.',
        'owner_only' => 'Das darf nur der Besitzer des Fahrzeugs.',
        'entry_not_editable' => 'Diesen Eintrag hat jemand anderes erfasst. Ändern kann ihn nur der Besitzer des Fahrzeugs.',
    ];
    if ($e instanceof FuelstatApiException && isset($zugriff[$e->getMessage()])) {
        return $zugriff[$e->getMessage()];
    }
    if (!($e instanceof FuelstatApiException) || $e->getMessage() !== 'plan_required') {
        return null;
    }
    $texte = [
        'maxVehicles' => 'Dein Tarif umfasst %s. Weitere Fahrzeuge sind eine Premium-Funktion.',
        'sharing' => 'Fahrzeuge teilen ist eine Premium-Funktion.',
        'comparison' => 'Der Fahrzeugvergleich ist eine Premium-Funktion.',
        'pdfReport' => 'Der PDF-Bericht ist eine Premium-Funktion.',
        'tripCategories' => 'Weitere Fahrtenbuch-Kategorien sind eine Premium-Funktion.',
        'premiumCategories' => 'Diese Kategorie gibt es mit Plus. Wähle z. B. „Sonstiges“.',
        'customCategories' => 'Eigene Kategorien sind eine Plus-Funktion.',
    ];
    $feature = (string)($e->data['feature'] ?? '');
    $limit = (int)($e->data['limit'] ?? 1);
    return sprintf($texte[$feature] ?? 'Das ist eine Premium-Funktion.', $limit === 1 ? 'ein Fahrzeug' : $limit . ' Fahrzeuge');
}

/**
 * E-Mail-Bestätigung (#135): Text für die API-Antwort 403 email_not_verified.
 * Bis zur Bestätigung erlaubt die API ein Fahrzeug und einen Eintrag; alles Weitere erst danach.
 */
function emailBestaetigenHinweis(?Throwable $e = null): string
{
    $feature = $e instanceof FuelstatApiException ? (string)($e->data['feature'] ?? '') : '';
    $was = [
        'maxVehicles' => 'Weitere Fahrzeuge kannst du anlegen',
        'maxEntries' => 'Weitere Einträge kannst du erfassen',
        'upload' => 'Bilder kannst du hochladen',
        'import' => 'Der Import ist möglich',
        'mail' => 'E-Mail-Benachrichtigungen kannst du einrichten',
        'feedback' => 'Feedback kannst du senden',
        'stations' => 'Die Tankstellen- und Ladestationssuche ist verfügbar',
        'customCategories' => 'Eigene Kategorien kannst du anlegen',
        'sharing' => 'Fahrzeuge kannst du teilen',
    ][$feature] ?? 'Diese Funktion ist verfügbar';
    return $was . ', sobald du deine E-Mail-Adresse bestätigt hast. Den Link dazu haben wir dir per Mail geschickt (Profil → „E-Mail bestätigen“).';
}

/** Anzeigenamen der Tarife */
function tarifNamen(): array
{
    return ['free' => 'Free', 'plus' => 'Plus', 'fleet' => 'Flotte'];
}
