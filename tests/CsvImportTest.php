<?php
require __DIR__ . '/../includes/csv_import.php';

// Zahlen
assert(importZahl('1.234,56') === 1234.56);
assert(importZahl('1,234.56') === 1234.56);
assert(importZahl('41,2 l') === 41.2);
assert(importZahl('75.31 €') === 75.31);
assert(importZahl('') === null);
assert(importGanzzahl('39.945') === 39945);
assert(importGanzzahl('39945,5') === 39945);
assert(importGanzzahl('39 945 km') === 39945);

// Datum
assert(importDatum('31.12.2025') === '2025-12-31');
assert(importDatum('1.2.25') === '2025-02-01');
assert(importDatum('2025-12-31 14:30') === '2025-12-31');
assert(importDatum('31/12/2025') === '2025-12-31');
assert(importDatum('31.02.2025') === null);

// Ja/Nein und Art
assert(importJaNein('') === true);
assert(importJaNein('nein') === false);
assert(importJaNein('', false) === false);
assert(importJaNein('ja', false) === true);
assert(importArt('Tankfüllung', null, 'Werkstatt')['typ'] === 'fillup');
assert(importArt('', 40.0, 'Werkstatt')['typ'] === 'fillup');
assert(importArt('TÜV', null, 'Werkstatt')['kategorie'] === 'TUV');
assert(importArt('', null, 'Werkstatt')['kategorie'] === 'Werkstatt');

// Eigener Export wird wieder erkannt (Windows-1252, Semikolon, BOM-los)
$csv = "Datum;Kategorie;Tachostand (km);Menge (l);Kosten (EUR);Vollgetankt;Verbrauch (l/100km);Ort/Anbieter;Beschreibung\r\n"
     . "05.01.2026;Tankfüllung;38.337;33,50;61,20;ja;7,94;SB Tankstelle;\r\n"
     . "02.01.2026;Versicherung;;;420,00;;;HUK;Jahresbeitrag\r\n"
     . "20.02.2026;Tankfüllung;40.200;20,00;36,50;nein;;;\r\n"
     . "kaputt;Tankfüllung;1;1;1;;;;\r\n";
$daten = importLeseCsv(mb_convert_encoding($csv, 'Windows-1252', 'UTF-8'));
assert(count($daten['zeilen']) === 4);
$zuordnung = importErkenneZuordnung($daten['kopf']);
assert($zuordnung === ['datum' => 0, 'art' => 1, 'tachostand' => 2, 'menge' => 3, 'kosten' => 4, 'vollgetankt' => 5, 'ort' => 7, 'beschreibung' => 8]);
$r = importWandleUm($daten['zeilen'], $zuordnung, 'Werkstatt');
assert(count($r['fillups']) === 2);
assert(count($r['entries']) === 1);
assert($r['fehler'] === [5 => 'Datum fehlt oder ist ungültig']);
assert($r['fillups'][0] === ['filledAt' => '2026-01-05T12:00:00.000Z', 'odometerKm' => 38337, 'amount' => 33.5, 'totalCostEur' => 61.2, 'station' => 'SB Tankstelle', 'isFull' => true, 'skipPrevious' => false, 'unit' => 'l']);
assert($r['fillups'][1]['isFull'] === false);
assert($r['entries'][0]['category'] === 'Versicherung' && $r['entries'][0]['odometerKm'] === null && $r['entries'][0]['vendor'] === 'HUK');

// Kosten aus Menge x Preis, Komma-getrennt mit englischen Überschriften
$daten = importLeseCsv("date,odometer,liters,price per liter\n2025-03-01,1000,40,1.75\n");
$r = importWandleUm($daten['zeilen'], importErkenneZuordnung($daten['kopf']), 'Werkstatt');
assert($r['fillups'][0]['totalCostEur'] === 70.0);
assert(!isset($r['fillups'][0]['unit']), 'ohne Art und Einheit entscheidet die API');

// Plug-in-Hybrid: Einheit aus der Spalte "Einheit", sonst aus der Art (Laden = kWh, Tanken = Liter)
$daten = importLeseCsv("Datum;Kategorie;Tachostand (km);Menge;Einheit;Kosten (EUR);Voll\n"
    . "05.01.2026;Laden;38302;14,80;kWh;4,14;ja\n"
    . "05.01.2026;Tanken;38337;41,20;l;72,10;ja\n"
    . "06.01.2026;Laden;38390;9,60;;2,69;ja\n"
    . "07.01.2026;Tankfüllung;38420;12,00;kWh;3,36;nein\n");
$zuordnung = importErkenneZuordnung($daten['kopf']);
assert(($zuordnung['einheit'] ?? null) === 4, 'Spalte Einheit erkannt');
$r = importWandleUm($daten['zeilen'], $zuordnung, 'Werkstatt');
assert(array_column($r['fillups'], 'unit') === ['kwh', 'l', 'kwh', 'kwh'], 'Spalte Einheit vor der Art');
assert(array_column($r['vorschau'], 'einheit') === ['kwh', 'l', 'kwh', 'kwh']);
assert(importEinheit('Liter') === 'l' && importEinheit('KWH') === 'kwh' && importEinheit('egal') === null);
assert(importArt('Ladevorgang', null, 'Werkstatt') === ['typ' => 'fillup', 'kategorie' => 'Tankfuellung', 'einheit' => 'kwh']);

// Kategorien mit dem Katalog des API abgleichen (#95)
$katalog = [
    'categories' => [
        ['key' => 'Werkstatt', 'name' => 'Werkstatt', 'form' => 'expense', 'available' => true],
        ['key' => 'TUV', 'name' => 'TÜV', 'form' => 'expense', 'available' => true],
        ['key' => 'Parken', 'name' => 'Parken', 'form' => 'expense', 'available' => false],
        ['key' => 'custom:1', 'name' => 'Fähre', 'form' => 'expense', 'available' => true, 'custom' => true],
        ['key' => 'Fahrt', 'name' => 'Fahrt', 'form' => 'trip', 'available' => false],
    ],
    'custom' => ['max' => 10, 'used' => 9, 'canCreate' => true],
];
$daten = importLeseCsv("Datum;Kategorie;Kosten (EUR);Beschreibung\n"
    . "01.02.2026;TÜV;120;HU\n"
    . "02.02.2026;fähre;30;\n"
    . "03.02.2026;Parken;3;Bahnhof\n"
    . "04.02.2026;Schlüsseldienst;80;\n"
    . "05.02.2026;Glasbruch;200;\n"
    . "06.02.2026;Fahrt;0;A → B\n");
$basis = importWandleUm($daten['zeilen'], importErkenneZuordnung($daten['kopf']), 'Werkstatt');
$r = importKategorienZuordnen($basis, $katalog, true);
assert(array_column($r['entries'], 'category') === ['TUV', 'custom:1', 'Sonstiges', 'neu:Schlüsseldienst', 'Sonstiges', 'Fahrt'], json_encode(array_column($r['entries'], 'category')));
assert($r['entries'][2]['description'] === 'Parken – Bahnhof', 'gesperrte Kategorie bleibt in der Beschreibung');
assert($r['entries'][4]['description'] === 'Glasbruch', 'nur noch ein Platz frei');
assert($r['kategorien']['neu'] === ['Schlüsseldienst']);
assert($r['vorschau'][3]['kategorie_text'] === 'Schlüsseldienst (neue eigene Kategorie)');
$ohne = importKategorienZuordnen($basis, $katalog, false);
assert($ohne['entries'][3]['category'] === 'Sonstiges' && $ohne['kategorien']['neu'] === []);
assert(array_column(importKategorienErsetzen($r['entries'], ['schlüsseldienst' => 'custom:2']), 'category')[3] === 'custom:2');
assert(array_column(importKategorienErsetzen($r['entries'], []), 'category')[3] === 'Sonstiges', 'Probelauf ohne neue Kategorien');

// Sorte (#140): Schlüssel, Name oder Kurzform
$sorten = ['super_e10' => ['name' => 'Super E10'], 'premium_diesel' => ['name' => 'Premium-Diesel'], 'lpg' => ['name' => 'Autogas (LPG)']];
assert(importSorte('Super E10', $sorten) === 'super_e10');
assert(importSorte('premium_diesel', $sorten) === 'premium_diesel');
assert(importSorte('Premium-Diesel', $sorten) === 'premium_diesel');
assert(importSorte('Autogas (LPG)', $sorten) === 'lpg');
assert(importSorte('E10', $sorten) === 'super_e10');
assert(importSorte('Autogas', $sorten) === 'lpg');
assert(importSorte('Kerosin', $sorten) === null);
assert(importSorte('', $sorten) === null);
assert(importErkenneZuordnung(['Datum', 'Sorte', 'Menge'])['sorte'] === 1);

echo "All tests passed\n";
