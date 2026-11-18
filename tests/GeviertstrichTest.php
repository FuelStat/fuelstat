<?php
// Keine Gedankenstriche in Texten, die Nutzer lesen (#209, docs/design.md 1.1 „KI-Look“):
// 1. kein Geviertstrich „—“ in Code, API-Texten, Mails und Release-Notes;
// 2. kein Gedankenstrich „ – “ in Oberfläche, API-Texten, Mails, Push und Release-Notes;
// 3. kein nackter Leerwert „–“: leere Werte zeigt leerWert() („–“ mit Screenreader-Text „keine Angabe“), mitten im
//    Text steht ein Wort wie „noch nie“ oder „ohne Datum“.
// Erlaubt bleiben „–“ als „bis“ ohne Leerzeichen (08–18 Uhr) und der Trenner im Seitentitel „Seite – {App}“ (<title>).
// Geprüft werden PHP, JavaScript, CSS, HTML und manifest.json im Projekt sowie backend/src, dazu CHANGELOG.md (wird
// unter „Neuigkeiten“ angezeigt). Kommentare zählen nicht; Tests, Abhängigkeiten und die übrige Doku bleiben außen vor.

require_once __DIR__ . '/../includes/functions.php';

$wurzel = dirname(__DIR__);
$ausgenommen = ['vendor', 'node_modules', 'tests', 'backend/test', '.git', 'webfonts', 'uploads', 'images', 'docs'];
$iterator = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(
    new RecursiveDirectoryIterator($wurzel, FilesystemIterator::SKIP_DOTS),
    function (SplFileInfo $datei) use ($wurzel, $ausgenommen) {
        $relativ = ltrim(str_replace('\\', '/', substr($datei->getPathname(), strlen($wurzel))), '/');
        foreach ($ausgenommen as $a) {
            if ($relativ === $a || str_starts_with($relativ, $a . '/') || str_contains($relativ, '/node_modules/')) {
                return false;
            }
        }
        return $datei->isDir() || preg_match('/\.(php|js|css|html)$/', $relativ) || $relativ === 'manifest.json';
    }
));

// Kommentare entfernen: ganze Kommentarzeilen und Kommentare am Zeilenende („ // …“, „<!-- … -->“, „/* … */“)
$ohneKommentar = function (string $zeile): string {
    if (preg_match('~^\s*(//|\*|/\*|#|--|<!--)~', $zeile)) {
        return '';
    }
    $zeile = preg_replace('~<!--.*?-->|/\*.*?\*/~', '', $zeile);
    return preg_replace('~(^|\s)//\s.*$~', '', $zeile);
};

$geviert = $gedanke = $leer = [];
foreach ($iterator as $datei) {
    $relativ = ltrim(substr($datei->getPathname(), strlen($wurzel)), '/');
    foreach (file($datei->getPathname()) as $nr => $zeile) {
        $ort = $relativ . ':' . ($nr + 1);
        if (str_contains($zeile, '—')) {
            $geviert[] = $ort;
        }
        $code = $ohneKommentar($zeile);
        if (str_contains($code, ' – ') && !str_contains($code, '<title>')) {
            $gedanke[] = $ort;
        }
        // Nackter Leerwert: '–' bzw. "–" als ganzer String oder >–< als ganzer Zelleninhalt
        if ($relativ !== 'includes/functions.php' && preg_match("~(['\"])–\\1|>–<~u", $code)) {
            $leer[] = $ort;
        }
    }
}
// Release-Notes (CHANGELOG.md erscheint unter „Neuigkeiten“)
foreach (file($wurzel . '/CHANGELOG.md') as $nr => $zeile) {
    if (str_contains($zeile, '—')) {
        $geviert[] = 'CHANGELOG.md:' . ($nr + 1);
    }
    if (str_contains($zeile, ' – ')) {
        $gedanke[] = 'CHANGELOG.md:' . ($nr + 1);
    }
}

assert($geviert === [], "Geviertstrich „—“ gefunden (Punkt, Komma oder Doppelpunkt verwenden):\n" . implode("\n", $geviert));
assert($gedanke === [], "Gedankenstrich „ – “ in Texten gefunden (Punkt, Komma, Doppelpunkt; Aufzählung mit „ · “):\n" . implode("\n", $gedanke));
assert($leer === [], "Nackter Leerwert „–“ gefunden (leerWert() bzw. ein Wort wie „noch nie“):\n" . implode("\n", $leer));

// Der Helfer: sichtbar „–“, für Screenreader „keine Angabe“
assert(leerWert() === '<span aria-hidden="true">–</span><span class="visually-hidden">keine Angabe</span>');

echo "All tests passed\n";
