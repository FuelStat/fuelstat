<?php
/**
 * Hilfsfunktionen für den CSV-Import (pages/import.php).
 * Ohne API-Zugriff, damit sie sich einzeln testen lassen (tests/CsvImportTest.php).
 */

/** Felder, denen CSV-Spalten zugeordnet werden können, mit Anzeigename. */
function importFelder(): array
{
    return [
        'datum' => 'Datum *',
        'art' => 'Art / Kategorie',
        'tachostand' => 'Tachostand (km)',
        'menge' => 'Menge (l/kWh/kg)',
        'einheit' => 'Einheit (l oder kWh, für Plug-in-Hybride)',
        'sorte' => 'Sorte (z. B. Super E10, Premium-Diesel, Autogas)',
        'kosten' => 'Kosten gesamt (€)',
        'preis' => 'Preis pro Einheit (€)',
        'vollgetankt' => 'Voll getankt bzw. geladen',
        'luecke' => 'Lücke davor (vorheriger Tank-/Ladevorgang fehlt)',
        'ort' => 'Tankstelle / Ladestation / Ort',
        'beschreibung' => 'Beschreibung / Notiz',
    ];
}

/** Spaltenüberschrift vereinheitlichen: klein, ohne Klammerzusatz, nur Buchstaben/Ziffern. */
function importNormalisiereKopf(string $kopf): string
{
    $kopf = mb_strtolower(trim($kopf), 'UTF-8');
    $kopf = preg_replace('/\(.*?\)/u', '', $kopf);
    $kopf = strtr($kopf, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
    return preg_replace('/[^a-z0-9]/', '', $kopf);
}

/**
 * Spalten automatisch zuordnen anhand üblicher Überschriften (Fuelstat-Export, Spritmonitor, Excel-Listen).
 * @return array Feld => Spaltenindex
 */
function importErkenneZuordnung(array $kopfzeile): array
{
    $synonyme = [
        'datum' => ['datum', 'date', 'tankdatum', 'ladedatum', 'tag'],
        'art' => ['art', 'typ', 'type', 'kategorie', 'category', 'eintragstyp'],
        'tachostand' => ['tachostand', 'kilometerstand', 'kmstand', 'odometer', 'tacho', 'km', 'odometerkm'],
        'menge' => ['menge', 'liter', 'litre', 'liters', 'amount', 'quantity', 'tankmenge', 'kwh', 'getankt', 'geladen', 'energie', 'lademenge'],
        'kosten' => ['kosten', 'gesamtpreis', 'betrag', 'preisgesamt', 'gesamtkosten', 'total', 'cost', 'costs', 'summe', 'preis'],
        'einheit' => ['einheit', 'unit', 'mengeneinheit', 'energieart'],
        'sorte' => ['sorte', 'kraftstoffsorte', 'kraftstoff', 'fuel', 'fueltype', 'spritsorte'],
        'preis' => ['preisproeinheit', 'preisproliter', 'literpreis', 'preisl', 'priceperliter', 'priceperunit', 'einzelpreis', 'preisprokwh', 'kwhpreis', 'strompreis', 'preiskwh'],
        'vollgetankt' => ['vollgetankt', 'vollgeladen', 'voll', 'full', 'volltank', 'isfull', 'vollgetanktbzwgeladen'],
        'luecke' => ['lueckedavor', 'luecke', 'skipprevious', 'vorherigeignorieren', 'vorherigetankfuellungignorieren'],
        'ort' => ['ort', 'tankstelle', 'ladestation', 'ladesaeule', 'station', 'ortanbieter', 'anbieter', 'vendor', 'location', 'standort'],
        'beschreibung' => ['beschreibung', 'notiz', 'bemerkung', 'note', 'notes', 'description', 'kommentar', 'comment'],
    ];
    $zuordnung = [];
    foreach ($kopfzeile as $index => $kopf) {
        $norm = importNormalisiereKopf((string)$kopf);
        foreach ($synonyme as $feld => $liste) {
            if (!isset($zuordnung[$feld]) && in_array($norm, $liste, true)) {
                $zuordnung[$feld] = $index;
                break;
            }
        }
    }
    return $zuordnung;
}

/**
 * CSV-Text einlesen: BOM entfernen, Windows-1252 nach UTF-8 wandeln, Trennzeichen (; , Tab) erkennen.
 * @return array ['kopf' => array, 'zeilen' => array]
 */
function importLeseCsv(string $inhalt): array
{
    $inhalt = preg_replace('/^\xEF\xBB\xBF/', '', $inhalt);
    if (!mb_check_encoding($inhalt, 'UTF-8')) {
        $inhalt = mb_convert_encoding($inhalt, 'UTF-8', 'Windows-1252');
    }
    $ersteZeile = strtok($inhalt, "\r\n") ?: '';
    $trenner = ';';
    $anzahl = -1;
    foreach ([';', ',', "\t"] as $kandidat) {
        $n = substr_count($ersteZeile, $kandidat);
        if ($n > $anzahl) {
            $anzahl = $n;
            $trenner = $kandidat;
        }
    }

    $stream = fopen('php://memory', 'r+');
    fwrite($stream, $inhalt);
    rewind($stream);
    $kopf = null;
    $zeilen = [];
    while (($zeile = fgetcsv($stream, 0, $trenner, '"', '')) !== false) {
        if ($zeile === [null] || implode('', array_map('trim', $zeile)) === '') {
            continue;
        }
        if ($kopf === null) {
            $kopf = array_map('trim', $zeile);
        } else {
            $zeilen[] = $zeile;
        }
    }
    fclose($stream);
    return ['kopf' => $kopf ?? [], 'zeilen' => $zeilen];
}

/** Dezimalzahl aus "1.234,56", "1234.56", "41,2 l", "75,31 €" usw. */
function importZahl(?string $wert): ?float
{
    $wert = trim((string)$wert);
    $wert = preg_replace('/[^0-9,.\-]/', '', $wert);
    if ($wert === '' || $wert === '-') {
        return null;
    }
    $komma = strrpos($wert, ',');
    $punkt = strrpos($wert, '.');
    if ($komma !== false && $punkt !== false) {
        // Das zuletzt stehende Zeichen ist das Dezimaltrennzeichen
        $wert = $komma > $punkt
            ? str_replace(['.', ','], ['', '.'], $wert)
            : str_replace(',', '', $wert);
    } elseif ($komma !== false) {
        $wert = str_replace(',', '.', $wert);
    }
    return is_numeric($wert) ? (float)$wert : null;
}

/** Ganzzahl (Tachostand): Tausenderpunkte und Einheiten werden ignoriert, Nachkommastellen abgeschnitten. */
function importGanzzahl(?string $wert): ?int
{
    $wert = trim((string)$wert);
    $wert = preg_replace('/[,.]\d{1,2}$/', '', $wert);
    $ziffern = preg_replace('/\D/', '', $wert);
    return $ziffern === '' ? null : (int)$ziffern;
}

/** Datum aus 31.12.2025, 31.12.25, 2025-12-31, 31/12/2025 (optional mit Uhrzeit) als Y-m-d. */
function importDatum(?string $wert): ?string
{
    $wert = trim((string)$wert);
    if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})/', $wert, $m)) {
        [$j, $mo, $t] = [(int)$m[1], (int)$m[2], (int)$m[3]];
    } elseif (preg_match('/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/', $wert, $m)) {
        [$t, $mo, $j] = [(int)$m[1], (int)$m[2], (int)$m[3]];
        if ($j < 100) {
            $j += $j > 69 ? 1900 : 2000;
        }
    } else {
        return null;
    }
    return checkdate($mo, $t, $j) ? sprintf('%04d-%02d-%02d', $j, $mo, $t) : null;
}

/** Ja/Nein-Werte; leere Angaben ergeben $standard. */
function importJaNein(?string $wert, bool $standard = true): bool
{
    $wert = mb_strtolower(trim((string)$wert), 'UTF-8');
    if ($wert === '') {
        return $standard;
    }
    return !in_array($wert, ['nein', 'no', 'n', '0', 'false', 'falsch', 'teil', 'teilweise', 'partial'], true);
}

/** Mengeneinheit aus "l", "Liter", "kWh" usw.; unbekannt: null. */
function importEinheit(?string $wert): ?string
{
    $norm = importNormalisiereKopf((string)$wert);
    return match ($norm) {
        'l', 'liter', 'litre', 'liters', 'ltr' => 'l',
        'kwh', 'kilowattstunden' => 'kwh',
        'kg', 'kilogramm' => 'kg',
        default => null,
    };
}

/**
 * Sorte (#140) aus Schlüssel oder Namen der API-Liste, z. B. "super_e10", "Super E10", "E10", "LPG"; unbekannt: null.
 * Ob die Sorte zum Fahrzeug gehört, prüft die API (sonst gilt der Standard des Fahrzeugs).
 */
function importSorte(?string $wert, array $katalog): ?string
{
    $norm = importNormalisiereKopf((string)$wert);
    if ($norm === '') {
        return null;
    }
    $kurz = ['e5' => 'super_e5', 'e10' => 'super_e10', 'superplus' => 'super_plus', 'super98' => 'super_plus',
        'autogas' => 'lpg', 'erdgas' => 'cng', 'strom' => 'electricity', 'h2' => 'hydrogen'];
    if (isset($kurz[$norm])) {
        return $kurz[$norm];
    }
    foreach ($katalog as $key => $sorte) {
        if ($norm === importNormalisiereKopf($key) || $norm === importNormalisiereKopf((string)($sorte['name'] ?? ''))) {
            return $key;
        }
    }
    return null;
}

/**
 * Art/Kategorie einer Zeile bestimmen.
 * Für Plug-in-Hybride verrät die Art auch die Einheit: "Laden" heißt kWh, "Tanken" Liter.
 * @return array ['typ' => 'fillup'|'entry', 'kategorie' => string, 'einheit' => 'l'|'kwh'|null]
 */
function importArt(?string $wert, ?float $menge, string $standardKategorie): array
{
    $norm = importNormalisiereKopf((string)$wert);
    $tank = ['tankfuellung', 'tanken', 'tankstopp', 'fuel', 'refuel', 'refueling', 'fillup', 'kraftstoff', 'getankt'];
    $lade = ['laden', 'ladevorgang', 'ladung', 'aufladen', 'geladen', 'charge', 'charging'];
    if (in_array($norm, $lade, true)) {
        return ['typ' => 'fillup', 'kategorie' => 'Tankfuellung', 'einheit' => 'kwh'];
    }
    if (in_array($norm, $tank, true)) {
        return ['typ' => 'fillup', 'kategorie' => 'Tankfuellung', 'einheit' => 'l'];
    }
    if ($norm === '' && $menge !== null && $menge > 0) {
        return ['typ' => 'fillup', 'kategorie' => 'Tankfuellung', 'einheit' => null];
    }
    $bekannt = [
        'versicherung' => 'Versicherung', 'werkstatt' => 'Werkstatt', 'inspektion' => 'Inspektion',
        'steuer' => 'Steuer', 'kfzsteuer' => 'Steuer', 'reparatur' => 'Reparatur', 'reifen' => 'Reifen',
        'tuev' => 'TUV', 'tuv' => 'TUV', 'hu' => 'TUV', 'wartung' => 'Wartung', 'kundendienst' => 'Wartung',
        'dekor' => 'Dekor', 'zubehoer' => 'Dekor', 'fahrt' => 'Fahrt', 'kilometerstand' => 'Kilometerstand',
        'parken' => 'Parken', 'parkgebuehr' => 'Parken', 'maut' => 'Maut', 'vignette' => 'Maut',
        'pflege' => 'Pflege', 'waesche' => 'Pflege', 'autowaesche' => 'Pflege', 'waschen' => 'Pflege',
        'leasing' => 'Leasing', 'finanzierung' => 'Leasing', 'kredit' => 'Leasing',
        'sonstiges' => 'Sonstiges', 'sonstige' => 'Sonstiges', 'other' => 'Sonstiges',
    ];
    if ($norm === '') {
        return ['typ' => 'entry', 'kategorie' => $standardKategorie, 'einheit' => null];
    }
    return ['typ' => 'entry', 'kategorie' => $bekannt[$norm] ?? trim((string)$wert), 'einheit' => null];
}

/**
 * Alle Zeilen anhand der Zuordnung umwandeln.
 * @return array ['fillups' => [...], 'entries' => [...], 'fehler' => [zeilennummer => meldung], 'vorschau' => [...]]
 */
function importWandleUm(array $zeilen, array $zuordnung, string $standardKategorie): array
{
    $hole = fn(array $zeile, string $feld) => isset($zuordnung[$feld]) && $zuordnung[$feld] !== '' ? ($zeile[(int)$zuordnung[$feld]] ?? null) : null;
    // zeilenNr: Zeilennummer der Datei je Eintrag in fillups bzw. entries (für Hinweise aus der API-Vorschau)
    $ergebnis = ['fillups' => [], 'entries' => [], 'fehler' => [], 'vorschau' => [], 'zeilenNr' => ['fillup' => [], 'entry' => []]];

    foreach ($zeilen as $i => $zeile) {
        $nr = $i + 2; // Zeilennummer in der Datei (1 = Kopfzeile)
        $datum = importDatum($hole($zeile, 'datum'));
        $menge = importZahl($hole($zeile, 'menge'));
        $kosten = importZahl($hole($zeile, 'kosten'));
        $preis = importZahl($hole($zeile, 'preis'));
        $tacho = importGanzzahl($hole($zeile, 'tachostand'));
        $art = importArt($hole($zeile, 'art'), $menge, $standardKategorie);
        $ort = trim((string)$hole($zeile, 'ort'));
        $beschreibung = trim((string)$hole($zeile, 'beschreibung'));
        // Spalte "Einheit" vor der Art; die API übernimmt sie nur bei Fahrzeugen mit mehreren Einheiten (Plug-in-Hybrid)
        $einheit = importEinheit($hole($zeile, 'einheit')) ?? $art['einheit'];
        $sorte = $art['typ'] === 'fillup' ? importSorte($hole($zeile, 'sorte'), $sortenKatalog ??= (function_exists('sortenKatalog') ? sortenKatalog()['sorten'] : [])) : null;

        if ($kosten === null && $menge !== null && $preis !== null) {
            $kosten = round($menge * $preis, 2);
        }

        $fehler = null;
        if ($datum === null) {
            $fehler = 'Datum fehlt oder ist ungültig';
        } elseif ($art['typ'] === 'fillup' && ($menge === null || $menge < 0)) {
            $fehler = 'Tank-/Ladevorgang ohne gültige Menge';
        } elseif ($kosten === null || $kosten < 0) {
            $fehler = 'Kosten fehlen oder sind ungültig';
        }

        $vorschau = [
            'nr' => $nr, 'datum' => $datum, 'kategorie' => $art['kategorie'], 'tachostand' => $tacho,
            'menge' => $art['typ'] === 'fillup' ? $menge : null, 'einheit' => $art['typ'] === 'fillup' ? $einheit : null, 'kosten' => $kosten,
            'vollgetankt' => $art['typ'] === 'fillup' ? importJaNein($hole($zeile, 'vollgetankt')) : null,
            'ort' => $ort, 'beschreibung' => $beschreibung, 'fehler' => $fehler,
        ];
        $ergebnis['vorschau'][] = $vorschau;
        if ($fehler !== null) {
            $ergebnis['fehler'][$nr] = $fehler;
            continue;
        }

        $zeitpunkt = $datum . 'T12:00:00.000Z';
        $ergebnis['zeilenNr'][$art['typ']][] = $nr;
        if ($art['typ'] === 'fillup') {
            $ergebnis['fillups'][] = [
                'filledAt' => $zeitpunkt,
                'odometerKm' => $tacho,
                'amount' => $menge,
                'totalCostEur' => $kosten,
                'station' => $ort !== '' ? $ort : null,
                'isFull' => $vorschau['vollgetankt'],
                'skipPrevious' => importJaNein($hole($zeile, 'luecke'), false),
            ] + ($einheit !== null ? ['unit' => $einheit] : []) + ($sorte !== null ? ['fuel' => $sorte] : []);
        } else {
            $ergebnis['entries'][] = [
                'occurredAt' => $zeitpunkt,
                'category' => $art['kategorie'],
                'amountEur' => $kosten,
                'odometerKm' => $tacho,
                'vendor' => $ort !== '' ? $ort : null,
                'description' => $beschreibung !== '' ? $beschreibung : null,
            ];
        }
    }
    return $ergebnis;
}

/**
 * Probelauf des Imports in der API (#51): bereits vorhandene Zeilen und unplausible Tachostände.
 * @return array [zeilennummer => ['art' => 'doppelt'|'warnung', 'text' => string]]
 */
function importPruefeVorab($api, string $vehicleId, array $umgewandelt): array
{
    $hinweise = [];
    foreach (['fillup' => 'fillups', 'entry' => 'entries'] as $typ => $schluessel) {
        foreach (array_chunk($umgewandelt[$schluessel], 500, true) as $paket) {
            $offset = (int)array_key_first($paket);
            $r = $api->postVehicleImport($vehicleId, $typ === 'fillup' ? array_values($paket) : [], $typ === 'entry' ? array_values($paket) : [], true);
            foreach ($r['duplicates'] ?? [] as $d) {
                $nr = $umgewandelt['zeilenNr'][$typ][$offset + (int)$d['index']] ?? null;
                if ($nr !== null) {
                    $hinweise[$nr] = ['art' => 'doppelt', 'text' => 'Bereits vorhanden, wird übersprungen'];
                }
            }
            foreach ($r['warnings'] ?? [] as $w) {
                $nr = $umgewandelt['zeilenNr'][$typ][$offset + (int)$w['index']] ?? null;
                if ($nr !== null && !isset($hinweise[$nr])) {
                    $hinweise[$nr] = ['art' => 'warnung', 'text' => 'Tachostand prüfen: ' . (string)($w['message'] ?? '')];
                }
            }
        }
    }
    return $hinweise;
}

/**
 * Kategorien der Ausgaben mit dem Katalog des API abgleichen (#95).
 * Erkannt wird der Schlüssel oder der Anzeigename (auch eigener Kategorien, z. B. aus einem Export).
 * Unbekannte werden – wenn gewünscht und im Tarif noch Platz ist – als eigene Kategorie angelegt ("neu:<Name>"),
 * sonst wie gesperrte Kategorien zu "Sonstiges"; der ursprüngliche Name bleibt dann in der Beschreibung erhalten.
 * @param array $katalog Antwort von GET /categories (kategorienKatalog())
 * @return array $umgewandelt mit angepassten entries/vorschau und 'kategorien' => ['neu' => [Name, ...], 'sonstiges' => [Name => Anzahl]]
 */
function importKategorienZuordnen(array $umgewandelt, array $katalog, bool $eigeneAnlegen): array
{
    $nachSchluessel = [];
    $nachName = [];
    foreach ($katalog['categories'] ?? [] as $k) {
        if (($k['form'] ?? 'expense') === 'fillup' || !empty($k['legacy'])) {
            continue;
        }
        $nachSchluessel[$k['key']] = $k;
        $nachName[mb_strtolower($k['name'])] = $k;
    }
    $frei = !empty($katalog['custom']['canCreate']) ? max(0, (int)$katalog['custom']['max'] - (int)$katalog['custom']['used']) : 0;
    $neu = [];
    $sonstiges = [];
    $vorschauIndex = [];
    foreach ($umgewandelt['vorschau'] as $i => $z) {
        $vorschauIndex[$z['nr']] = $i;
    }
    foreach ($umgewandelt['entries'] as $i => &$e) {
        $original = trim((string)$e['category']);
        $k = $nachSchluessel[$original] ?? $nachName[mb_strtolower($original)] ?? null;
        $nutzbar = $k !== null && (!empty($k['available']) || in_array($k['form'] ?? '', ['trip', 'odometer'], true));
        $anzeige = null;
        if ($nutzbar) {
            $e['category'] = $k['key'];
            $anzeige = $k['name'];
        } elseif ($k === null && $eigeneAnlegen && (isset($neu[mb_strtolower($original)]) || count($neu) < $frei)) {
            $neu[mb_strtolower($original)] = $original;
            $e['category'] = 'neu:' . $original;
            $anzeige = $original . ' (neue eigene Kategorie)';
        } else {
            $e['category'] = 'Sonstiges';
            $e['description'] = trim($original . (($e['description'] ?? '') !== '' ? ' – ' . $e['description'] : ''));
            $sonstiges[$original] = ($sonstiges[$original] ?? 0) + 1;
            $anzeige = 'Sonstiges (' . $original . ')';
        }
        $nr = $umgewandelt['zeilenNr']['entry'][$i] ?? null;
        if ($nr !== null && isset($vorschauIndex[$nr])) {
            $umgewandelt['vorschau'][$vorschauIndex[$nr]]['kategorie_text'] = $anzeige;
        }
    }
    unset($e);
    $umgewandelt['kategorien'] = ['neu' => array_values($neu), 'sonstiges' => $sonstiges];
    return $umgewandelt;
}

/** Platzhalter "neu:<Name>" durch Schlüssel ersetzen (nach dem Anlegen) bzw. für den Probelauf durch "Sonstiges" */
function importKategorienErsetzen(array $entries, array $schluessel): array
{
    foreach ($entries as &$e) {
        if (str_starts_with((string)$e['category'], 'neu:')) {
            $e['category'] = $schluessel[mb_strtolower(substr($e['category'], 4))] ?? 'Sonstiges';
        }
    }
    return $entries;
}
