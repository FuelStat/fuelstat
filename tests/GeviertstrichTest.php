<?php
// Kein Geviertstrich „—“ in Oberfläche, API-Texten und Mails (#209, docs/design.md 1.1 „KI-Look“).
// Leere Werte zeigt leerWert() als „–“ mit Screenreader-Text; Gedankenstriche im Text sind „ – “.
// Geprüft werden PHP, JavaScript, CSS und manifest.json im Projekt sowie backend/src. Tests, Abhängigkeiten
// und die Doku (CHANGELOG mit veröffentlichten Abschnitten, design.md mit Beispielen) bleiben außen vor.

require_once __DIR__ . '/../includes/functions.php';

$wurzel = dirname(__DIR__);
$ausgenommen = ['vendor', 'node_modules', 'tests', 'backend/test', '.git', 'webfonts', 'uploads', 'images'];
$funde = [];
$iterator = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(
    new RecursiveDirectoryIterator($wurzel, FilesystemIterator::SKIP_DOTS),
    function (SplFileInfo $datei) use ($wurzel, $ausgenommen) {
        $relativ = ltrim(str_replace('\\', '/', substr($datei->getPathname(), strlen($wurzel))), '/');
        foreach ($ausgenommen as $a) {
            if ($relativ === $a || str_starts_with($relativ, $a . '/') || str_contains($relativ, '/node_modules/')) {
                return false;
            }
        }
        return $datei->isDir() || preg_match('/\.(php|js|css)$/', $relativ) || $relativ === 'manifest.json';
    }
));
foreach ($iterator as $datei) {
    foreach (file($datei->getPathname()) as $nr => $zeile) {
        if (str_contains($zeile, '—')) {
            $funde[] = ltrim(substr($datei->getPathname(), strlen($wurzel)), '/') . ':' . ($nr + 1);
        }
    }
}
assert($funde === [], "Geviertstrich „—“ gefunden (leerWert() bzw. „ – “ verwenden):\n" . implode("\n", $funde));

// Der Helfer: sichtbar „–“, für Screenreader „keine Angabe“
assert(leerWert() === '<span aria-hidden="true">–</span><span class="visually-hidden">keine Angabe</span>');

echo "All tests passed\n";
