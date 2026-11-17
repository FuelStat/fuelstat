<?php
// Termine eines Fahrzeugs (#206, docs/design.md 7.6): die vollständige Liste hat ihre Heimat in „Service“, Start zeigt
// höchstens drei. Alles aus /reminders (API-first): erst die Fristen, dann die Bauteile (Gruppe aus der API), in der
// Gruppe die dringendsten zuerst, die reine Info (letzter Reifenwechsel) zuletzt.
// Erwartet: $api, $fahrzeug_id, $darfErfassen
$faelligkeiten = getFaelligkeitenFromApi($api, $fahrzeug_id);
$statusReihenfolge = ['ueberfaellig' => 0, 'bald' => 1, 'ok' => 2, 'unbekannt' => 3];
$gruppeRang = fn(array $f) => ($f['gruppe'] ?? 'deadline') === 'deadline' ? 0 : 1;
usort($faelligkeiten, fn($a, $b) => [$gruppeRang($a), $a['art'] === 'info', $statusReihenfolge[$a['status']] ?? 9, $a['tage'] ?? PHP_INT_MAX]
    <=> [$gruppeRang($b), $b['art'] === 'info', $statusReihenfolge[$b['status']] ?? 9, $b['tage'] ?? PHP_INT_MAX]);
// Tachostand und Beschreibung des letzten Eintrags, z. B. „zuletzt 12.03.2026 bei 61.200 km · Ölwechsel“
$zuletzt = function (array $f, string $wort = 'zuletzt'): string {
    $teile = [$wort . ' ' . date('d.m.Y', strtotime($f['letzte'])) . (!empty($f['letzte_km']) ? ' bei ' . number_format((int)$f['letzte_km'], 0, ',', '.') . ' km' : '')];
    if (!empty($f['letzte_beschreibung'])) {
        $teile[] = $f['letzte_beschreibung'];
    }
    // Höchstens zwei Zeilen (#205); Antippen bzw. Fokus zeigt den ganzen Text, title für die Maus
    $text = htmlspecialchars(implode(' · ', $teile));
    return '<span class="termin-zuletzt" tabindex="0" title="' . $text . '">' . $text . '</span>';
};
$eintragUrl = '../pages/eintrag_hinzufuegen.php?fahrzeug_id=' . urlencode($fahrzeug_id);
if (!$faelligkeiten) {
    return;
}
?>
<!-- Termine: Fälligkeiten und letzter Reifenwechsel aus /reminders in einer Karte -->
<div class="card mt-3 mt-lg-4" id="termine">
    <div class="card-header d-flex justify-content-between align-items-center">
        <h2 class="mb-0">Termine</h2>
        <?php if ($darfErfassen): ?>
        <a href="<?= htmlspecialchars($eintragUrl) ?>&kategorie=Wartung" class="btn btn-secondary btn-sm">Wartung eintragen</a>
        <?php endif; ?>
    </div>
    <ul class="list-group list-group-flush">
        <?php
        // Zwischenüberschriften (#206): Fristen, dann Bauteile (mit Intervall, Schätzung, letzter Reifenwechsel);
        // nur wenn beide Gruppen vorkommen. Reihenfolge und Gruppe liefert die API.
        $gruppeName = fn(array $f) => ($f['gruppe'] ?? 'deadline') === 'deadline' ? 'Fristen' : 'Bauteile';
        $mitUeberschriften = count(array_unique(array_map($gruppeName, $faelligkeiten))) > 1;
        $letzteGruppe = null;
        ?>
        <?php foreach ($faelligkeiten as $f):
            if ($mitUeberschriften && $gruppeName($f) !== $letzteGruppe):
                $letzteGruppe = $gruppeName($f); ?>
        <li class="list-group-item termin-gruppe"><h3 class="fs-label fw-semibold mb-0"><?= $letzteGruppe ?></h3></li>
        <?php endif;
            // Status kommt aus der API; hier nur der Abstand in Worten („in 12 Tagen“, „seit 5 Tagen überfällig“)
            $text = isset($f['tage']) && !empty($f['faellig_datum'])
                ? (($f['quelle'] ?? '') === 'lebensdauer' ? 'ca. ' : '') . terminAbstand((int)$f['tage'])
                : (['ueberfaellig' => 'überfällig', 'bald' => 'bald fällig', 'ok' => 'in Ordnung'][$f['status']] ?? 'Datum fehlt');
            $info = $f['art'] === 'info';
        ?>
        <li class="list-group-item termin-zeile">
            <?= symbolKreis($f['symbol'] ?? getCategoryIcon($f['kategorie']), 'var(--fs-brand)') ?>
            <div class="termin-text">
                <div class="fs-headline"><?= htmlspecialchars($f['titel']) ?></div>
                <div class="fs-label">
                    <?php if (!empty($f['teil'])): ?>
                        <?php // Bauteil (#78): nach Intervall oder, als Schätzung, aus der bisherigen Lebensdauer ?>
                        <?= ($f['quelle'] ?? '') === 'lebensdauer' ? 'geschätzt ' : '' ?><?= $f['faellig_datum'] ? 'am ' . date('d.m.Y', strtotime($f['faellig_datum'])) : '' ?><?= $f['faellig_datum'] && $f['faellig_km'] ? ' oder ' : '' ?><?= $f['faellig_km'] ? 'bei ' . number_format($f['faellig_km'], 0, ',', '.') . ' km' : '' ?>
                        <?php if (!empty($f['letzte'])): ?><br><?= $zuletzt($f) ?><?php endif; ?>
                    <?php elseif ($info): ?>
                        <?php if (!empty($f['letzte'])): ?>
                            <?= $zuletzt($f, 'letzter Wechsel am') ?>
                        <?php else: ?>
                            <a class="tipp-link" href="<?= htmlspecialchars($eintragUrl) ?>&kategorie=<?= urlencode($f['kategorie']) ?>">Reifenwechsel erfassen</a>
                        <?php endif; ?>
                    <?php elseif ($f['faellig_datum']): ?>
                        fällig am <?= date('d.m.Y', strtotime($f['faellig_datum'])) ?><?php if ($f['faellig_km']): ?> oder bei <?= number_format($f['faellig_km'], 0, ',', '.') ?> km<?php endif; ?>
                        <?php if (!empty($f['letzte'])): ?>
                            <br><?= $zuletzt($f) ?>
                        <?php elseif (($f['quelle'] ?? null) === 'erstzulassung'): ?>
                            <br>berechnet aus der Erstzulassung
                        <?php elseif (($f['quelle'] ?? null) === 'faelligkeitsmonat'): ?>
                            <br>laut Fahrzeugangaben
                        <?php endif; ?>
                    <?php else: ?>
                        <a class="tipp-link" href="<?= htmlspecialchars($eintragUrl) ?>&kategorie=<?= urlencode($f['kategorie']) ?>"><?= htmlspecialchars($f['titel']) ?> eintragen</a>, um erinnert zu werden
                    <?php endif; ?>
                </div>
            </div>
            <?php if (!$info): ?><?= statusBadge((string)$f['status'], $text, 'ms-auto') ?><?php endif; ?>
        </li>
        <?php endforeach; ?>
    </ul>
</div>
