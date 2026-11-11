<?php
// includes/functions.php – Hilfsfunktionen ohne Datenbankzugriff (Daten kommen über die API, siehe includes/api_helpers.php)
require_once __DIR__ . '/kategorien.php';

// --------------------------------------------------
// 0. System-Checks
// --------------------------------------------------
function isGdExtensionAvailable(): bool
{
    return extension_loaded('gd') && function_exists('imagecreatefromjpeg');
}

// --------------------------------------------------
// 1. Icons
// --------------------------------------------------
function getCategoryIcon(string $kategorie, ?string $fuelType = null, ?string $einheit = null): string
{
    if ($kategorie === 'Tankfuellung' && $fuelType !== null) {
        return begriffeFuerEinheit($fuelType, $einheit)['icon'];
    }
    if ($kategorie === 'Verbrauch') {
        return 'fa-chart-line';
    }
    // Icons kommen mit den Kategorien vom API (#95)
    return kategorieInfo($kategorie)['icon'] ?? 'fa-tag';
}

function formatMonat(string $monat, bool $lang = false): string
{
    $kurz = [1 => 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    $voll = [1 => 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    $date = DateTime::createFromFormat('!Y-m', $monat);
    if (!$date) {
        return $monat;
    }
    $namen = $lang ? $voll : $kurz;
    return $namen[(int)$date->format('n')] . ' ' . $date->format('Y');
}

function formatLabels(array $arr): array
{
    $formatted = [];
    foreach ($arr as $key => $value) {
        $formatted[formatMonat($key)] = $value;
    }
    return $formatted;
}

/**
 * Übersetzt interne Kategorienamen in benutzerfreundliche Namen mit Umlauten
 * 
 * @param string $kategorie Der interne Kategoriename
 * @return string Der benutzerfreundliche Name mit Umlauten
 */
/**
 * Kraftstoffarten, wie die API sie kennt, mit Anzeigenamen.
 */
function getKraftstoffOptionen(): array
{
    return [
        'diesel' => 'Diesel',
        'e5' => 'Benzin (E5)',
        'e10' => 'Benzin (E10)',
        'lpg' => 'Autogas (LPG)',
        'cng' => 'Erdgas (CNG)',
        'electric' => 'Elektro',
        'hybrid' => 'Hybrid (ohne Stecker)',
        'phev' => 'Plug-in-Hybrid',
        'hydrogen' => 'Wasserstoff',
        'other' => 'Andere',
    ];
}

/**
 * URL des Fahrzeugbilds, sonst Platzhalter. $baseUrl ist die App-Basis-URL mit Slash am Ende.
 */
function fahrzeugBildUrl(array $fahrzeug, string $baseUrl): string
{
    $url = trim((string)($fahrzeug['image_url'] ?? ''));
    if ($url === '') {
        return $baseUrl . 'images/platzhalter.jpg';
    }
    if (preg_match('#^https?://#i', $url)) {
        return $url;
    }
    return $baseUrl . ltrim($url, '/');
}

/** Begriffe für eine Energieart aus der API (#140): petrol, diesel, lpg, cng, electricity, hydrogen, other */
function begriffeFuerEnergie(string $energie): array
{
    return verbrauchsBegriffe(['petrol' => 'e5', 'electricity' => 'electric'][$energie] ?? $energie);
}

/**
 * Mengeneinheit passend zum Kraftstoff (wie im Backend abgeleitet): 'l', 'kwh' oder 'kg'.
 */
function getEinheitFuerKraftstoff(?string $fuelType): string
{
    $fuelType = strtolower((string)$fuelType);
    if ($fuelType === 'electric') {
        return 'kwh';
    }
    if ($fuelType === 'cng' || $fuelType === 'hydrogen') {
        return 'kg';
    }
    return 'l';
}

/** Alle Einheiten eines Fahrzeugs, Standard zuerst: Plug-in-Hybride tanken (l) und laden (kWh). */
function einheitenFuerKraftstoff(?string $fuelType): array
{
    return strtolower((string)$fuelType) === 'phev' ? ['l', 'kwh'] : [getEinheitFuerKraftstoff($fuelType)];
}

/** Kurzform für Anzeigen wie "41,2 l" oder "kWh/100km". */
function einheitKurz(?string $einheit): string
{
    return ['kwh' => 'kWh', 'kg' => 'kg'][strtolower((string)$einheit)] ?? 'l';
}

/** Langform für Formularbeschriftungen wie "Menge (Liter)". */
function einheitLang(?string $einheit): string
{
    return ['kwh' => 'kWh', 'kg' => 'kg'][strtolower((string)$einheit)] ?? 'Liter';
}

/**
 * Begriffe passend zur Antriebsart: Verbrenner tanken an der Tankstelle, E-Autos laden an der Ladestation.
 * Alle sichtbaren Texte zu Tank-/Ladevorgängen sollen von hier kommen, nie fest "tanken" oder "laden".
 * Ohne Fahrzeug (null) gibt es neutrale Begriffe, z. B. für Übersichten über mehrere Fahrzeuge.
 */
function verbrauchsBegriffe(?string $fuelType): array
{
    $fuelType = strtolower((string)$fuelType);
    if ($fuelType === 'electric') {
        return [
            'art' => 'strom',
            'vorgang' => 'Ladevorgang', 'vorgaenge' => 'Ladevorgänge', 'vorgaengen' => 'Ladevorgängen',
            'stopps' => 'Ladestopps', 'verb' => 'laden', 'Verb' => 'Laden',
            'menge' => 'Geladen', 'menge_gesamt' => 'Geladen gesamt',
            'voll' => 'Vollgeladen', 'teil' => 'Teilladung',
            'luecke' => 'Vorherige Ladevorgänge ignorieren',
            'station' => 'Ladestation', 'stationen' => 'Ladestationen',
            'energie' => 'Strom', 'kosten' => 'Stromkosten', 'preis' => 'Strompreis',
            'speicher' => 'Akku', 'icon' => 'fa-charging-station',
            'beispiel_ort' => 'z. B. Zuhause (Wallbox)',
        ];
    }
    if ($fuelType === '' || $fuelType === 'phev') {
        return [
            'art' => $fuelType === 'phev' ? 'phev' : 'neutral',
            'vorgang' => 'Tank-/Ladevorgang', 'vorgaenge' => 'Tank- und Ladevorgänge', 'vorgaengen' => 'Tank- und Ladevorgängen',
            'stopps' => 'Tank-/Ladestopps', 'verb' => 'tanken/laden', 'Verb' => 'Tanken/Laden',
            'menge' => 'Getankt/geladen', 'menge_gesamt' => 'Getankt/geladen gesamt',
            'voll' => 'Voll getankt/geladen', 'teil' => 'Teilweise',
            'luecke' => 'Vorherige Einträge ignorieren',
            'station' => 'Tankstelle/Ladestation', 'stationen' => 'Tankstellen/Ladestationen',
            'energie' => 'Kraftstoff/Strom', 'kosten' => 'Energiekosten', 'preis' => 'Preis',
            'speicher' => 'Tank/Akku', 'icon' => 'fa-gas-pump',
            'beispiel_ort' => 'z. B. Aral München Nord',
        ];
    }
    return [
        'art' => in_array($fuelType, ['cng', 'hydrogen'], true) ? 'gas' : 'fluessig',
        'vorgang' => 'Tankfüllung', 'vorgaenge' => 'Tankfüllungen', 'vorgaengen' => 'Tankfüllungen',
        'stopps' => 'Tankstopps', 'verb' => 'tanken', 'Verb' => 'Tanken',
        'menge' => 'Getankt', 'menge_gesamt' => 'Getankt gesamt',
        'voll' => 'Vollgetankt', 'teil' => 'Teilbetankung',
        'luecke' => 'Vorherige Tankfüllungen ignorieren',
        'station' => 'Tankstelle', 'stationen' => 'Tankstellen',
        'energie' => ['hydrogen' => 'Wasserstoff', 'cng' => 'Erdgas', 'lpg' => 'Autogas'][$fuelType] ?? 'Kraftstoff',
        'kosten' => ['hydrogen' => 'Wasserstoffkosten', 'cng' => 'Gaskosten', 'lpg' => 'Gaskosten'][$fuelType] ?? 'Kraftstoffkosten',
        'preis' => ['hydrogen' => 'Wasserstoffpreis', 'cng' => 'Gaspreis', 'lpg' => 'Gaspreis'][$fuelType] ?? 'Spritpreis',
        'speicher' => 'Tank', 'icon' => 'fa-gas-pump',
        'beispiel_ort' => 'z. B. Aral München Nord',
    ];
}

/**
 * Begriffe für einen einzelnen Eintrag: beim Plug-in-Hybrid entscheidet dessen Einheit
 * (kWh = Ladevorgang, sonst Tankfüllung), bei allen anderen die Antriebsart.
 */
function begriffeFuerEinheit(?string $fuelType, ?string $einheit): array
{
    if (strtolower((string)$fuelType) === 'phev' && $einheit !== null) {
        return verbrauchsBegriffe(strtolower($einheit) === 'kwh' ? 'electric' : 'e5');
    }
    return verbrauchsBegriffe($fuelType);
}

/**
 * Anzeigename einer Kategorie. Mit Kraftstoff des Fahrzeugs heißt "Tankfuellung" beim E-Auto "Ladevorgang",
 * beim Plug-in-Hybrid je nach Einheit des Eintrags.
 */
function getKategorieName($kategorie, ?string $fuelType = null, ?string $einheit = null) {
    if ($kategorie === 'Tankfuellung') {
        return $fuelType === null ? 'Tankfüllung' : begriffeFuerEinheit($fuelType, $einheit)['vorgang'];
    }
    // Anzeigenamen kommen mit den Kategorien vom API (#95); unbekannte (alte Importe) heißen wie gespeichert
    return kategorieInfo((string)$kategorie)['name'] ?? (string)$kategorie;
}
