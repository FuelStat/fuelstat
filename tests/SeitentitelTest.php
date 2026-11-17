<?php
// Jede Seite hat einen eigenen Titel „Seite – App“ (#211, docs/design.md §11): Wer includes/header.php einbindet (direkt
// oder über includes/fahrzeug_seite.php), steht mit seinem Dateinamen in $seitenInfo. Ausnahme: Start (nur „App“).
// Die Berichte (bericht*.php) sind eigene Druckdokumente mit eigenem <title> und binden den Kopf nicht ein.

$wurzel = dirname(__DIR__);
$kopf = file_get_contents($wurzel . '/includes/header.php');
$start = strpos($kopf, '$seitenInfo = [');
$ende = strpos($kopf, "\n];", $start);
assert($start !== false && $ende !== false, '$seitenInfo nicht gefunden');
preg_match_all("/^\s*'([a-z_]+\.php)'\s*=>\s*\['([^']+)'/m", substr($kopf, $start, $ende - $start), $treffer);
$titel = array_combine($treffer[1], $treffer[2]);
assert(count($titel) > 20, 'zu wenige Einträge in $seitenInfo erkannt');

$fehlend = [];
foreach (glob($wurzel . '/pages/*.php') as $datei) {
    $name = basename($datei);
    $inhalt = file_get_contents($datei);
    if (!preg_match('#includes/(header|fahrzeug_seite)\.php#', $inhalt)) {
        continue; // Weiterleitungen, Formular-Ziele, JSON-Endpunkte, Berichte
    }
    if (!isset($titel[$name])) {
        $fehlend[] = $name;
    }
}
assert($fehlend === [], "Ohne Seitentitel in includes/header.php (\$seitenInfo):\n" . implode("\n", $fehlend));

// Jeder Eintrag gehört zu einer Seite, die es gibt, und kein Titel kommt doppelt vor
foreach (array_keys($titel) as $name) {
    assert(is_file($wurzel . '/pages/' . $name), "\$seitenInfo nennt $name, die Seite gibt es nicht");
}
$doppelt = array_keys(array_filter(array_count_values($titel), fn($n) => $n > 1));
assert($doppelt === [], 'Doppelte Seitentitel: ' . implode(', ', $doppelt));

// Berichte: eigener Titel
foreach (['bericht.php', 'bericht_gesamtkosten.php'] as $bericht) {
    assert(str_contains(file_get_contents($wurzel . '/pages/' . $bericht), '<title>'), "$bericht ohne <title>");
}

echo "All tests passed\n";
