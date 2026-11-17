<?php
// Statistik eines Fahrzeugs (#206, Bereich „Statistik“ der Leiste) mit zwei Teilen: Verbrauch (tabs/statistiken.php)
// und Kosten mit Gesamtkosten, Kostenstruktur und Jahresvergleich (tabs/ausgaben.php). Höchstens fünf Segmente je
// Seite (docs/design.md 7); die beiden Teile bleiben getrennte Dateien, damit jede nur ihre Daten lädt.
$ansichtTitel = 'Statistik';
$teil = ($_GET['teil'] ?? '') === 'kosten' ? 'kosten' : 'verbrauch';
include __DIR__ . '/../includes/fahrzeug_seite.php';
$teilUrl = fn(string $t) => '../' . fahrzeugSeite($t === 'kosten' ? 'kosten' : 'statistik', $fahrzeug_id);
?>
    <nav class="chip-leiste mt-3" aria-label="Teil der Statistik">
        <a class="chip<?= $teil === 'verbrauch' ? ' active' : '' ?>" href="<?= htmlspecialchars($teilUrl('verbrauch')) ?>"<?= $teil === 'verbrauch' ? ' aria-current="page"' : '' ?>>Verbrauch</a>
        <a class="chip<?= $teil === 'kosten' ? ' active' : '' ?>" href="<?= htmlspecialchars($teilUrl('kosten')) ?>"<?= $teil === 'kosten' ? ' aria-current="page"' : '' ?>>Kosten</a>
    </nav>
<?php
include __DIR__ . '/../tabs/' . ($teil === 'kosten' ? 'ausgaben' : 'statistiken') . '.php';
include __DIR__ . '/../includes/fahrzeug_seite_ende.php';
