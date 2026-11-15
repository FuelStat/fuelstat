<?php
// Alle Fahrzeuge als Karten mit Reihenfolge (#158). Start (index.php) zeigt ein gewähltes Fahrzeug.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
include '../includes/functions.php';
include '../includes/header.php';

$vehicles = [];
$ladeFehler = false;
try {
    $vehicles = $api->getVehicles();
} catch (Throwable $e) {
    $ladeFehler = true;
}
?>

<?php $aktive = array_values(array_filter($vehicles, fn($v) => ($v['status'] ?? 'active') === 'active'));
$archiv = array_values(array_filter($vehicles, fn($v) => ($v['status'] ?? 'active') !== 'active'));
$sortiermodus = !empty($_GET['sortieren']) && count($aktive) > 1; ?>
<div class="container mt-3 mt-lg-4">
    <div class="d-flex justify-content-between align-items-center gap-2 mb-3 mb-lg-4">
        <h1 class="mb-0">Meine Fahrzeuge</h1>
        <?php if ($sortiermodus): ?>
            <a href="fahrzeuge.php" class="btn btn-primary btn-sm"><i class="fas fa-check me-1"></i> Fertig</a>
        <?php elseif (count($aktive) > 1): ?>
            <a href="fahrzeuge.php?sortieren=1" class="btn btn-secondary btn-sm"><i class="fas fa-sort" aria-hidden="true"></i><span class="d-none d-sm-inline">Reihenfolge ändern</span><span class="d-sm-none">Ordnen</span></a>
        <?php endif; ?>
    </div>
    <?php if ($ladeFehler): ?>
        <div class="alert alert-danger">Die Fahrzeuge konnten gerade nicht geladen werden. Bitte versuche es gleich noch einmal.</div>
    <?php elseif (count($vehicles) > 0): ?>
        <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3">
            <?php
            $kraftstoffNamen = getKraftstoffOptionen();
            // Statistik und Fälligkeiten gleichzeitig laden statt nacheinander (#89); archivierte Fahrzeuge haben keine Termine
            $api->vorladen(array_merge(...array_map(fn($v) => array_merge(
                ['/vehicles/' . rawurlencode((string)$v['id']) . '/stats'],
                ($v['status'] ?? 'active') === 'active' ? ['/vehicles/' . rawurlencode((string)$v['id']) . '/reminders'] : []
            ), array_values($vehicles))));
            $archiviert = false;
            foreach (array_values($aktive) as $index => $row) {
                include __DIR__ . '/../includes/fahrzeug_karte.php';
            }
            ?>
        </div>
        <?php if ($archiv): ?>
        <!-- Archiv (#79): verkaufte und stillgelegte Fahrzeuge, nur lesbar, eingeklappt -->
        <details class="fahrzeug-archiv mt-4"<?= !$aktive ? ' open' : '' ?>>
            <summary class="fs-headline mb-3">Archiv (<?= count($archiv) ?>)</summary>
            <p class="fs-label">Verkaufte und stillgelegte Fahrzeuge. Alle Daten bleiben lesbar, ändern lässt sich nichts mehr, bis du ein Fahrzeug wieder aktivierst.</p>
            <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3">
                <?php
                $archiviert = true;
                foreach (array_values($archiv) as $index => $row) {
                    include __DIR__ . '/../includes/fahrzeug_karte.php';
                }
                ?>
            </div>
        </details>
        <?php endif; ?>
    <?php else: ?>
        <!-- EmptyState: Symbol, ein Satz, eine Aktion -->
        <div class="card leer-zustand mx-auto">
            <div class="card-body">
                <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-car-side"></i></span>
                <h2>Noch kein Fahrzeug angelegt</h2>
                <p class="text-body-secondary mb-4">Lege dein erstes Fahrzeug an, danach kannst du Tankfüllungen, Ladevorgänge und Ausgaben erfassen.</p>
                <a href="fahrzeug_hinzufuegen.php" class="btn btn-primary btn-lg px-4">
                    <i class="fas fa-plus" aria-hidden="true"></i>Fahrzeug hinzufügen
                </a>
                <p class="fs-footnote mt-4 mb-0">
                    <i class="fas fa-file-import me-1"></i>Daten aus einer anderen App oder Excel? Nach dem Anlegen unter „Einträge“ → „Import“ übernehmen.
                </p>
            </div>
        </div>
    <?php endif; ?>
</div>

<?php include '../includes/footer.php'; ?>
