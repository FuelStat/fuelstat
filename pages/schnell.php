<?php
// Schnellerfassung (#42): Ziel der App-Kürzel "Tanken/Laden" und "Kilometerstand notieren" (manifest.json).
// Ein Fahrzeug: direkt zum Formular. Mehrere: Auswahl, das zuletzt genutzte Fahrzeug zuerst.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

$art = in_array($_GET['art'] ?? '', ['tanken', 'km'], true) ? $_GET['art'] : 'tanken';
if (!isApiAuthenticated()) {
    $_SESSION['nach_login'] = 'pages/schnell.php?art=' . $art;
    header('Location: login.php');
    exit;
}

$api = getApiClient();
try {
    // Nur Fahrzeuge, bei denen man erfassen darf (geteilte zum Ansehen nicht, #53)
    $fahrzeuge = array_values(array_filter($api->getVehicles(), fn($v) => ($v['role'] ?? 'owner') !== 'viewer'));
} catch (Throwable $e) {
    $fahrzeuge = [];
}
if (!$fahrzeuge) {
    header('Location: fahrzeug_hinzufuegen.php');
    exit;
}
// Zuletzt genutztes Fahrzeug (Cookie aus eintrag_speichern.php) nach vorn
$letztes = (string)($_COOKIE['fuelstat_fahrzeug'] ?? '');
usort($fahrzeuge, fn($a, $b) => (($b['id'] ?? '') === $letztes) <=> (($a['id'] ?? '') === $letztes));
$zielUrl = fn(array $f) => 'eintrag_hinzufuegen.php?fahrzeug_id=' . rawurlencode($f['id']) . '&art=' . $art;
if (count($fahrzeuge) === 1) {
    header('Location: ' . $zielUrl($fahrzeuge[0]));
    exit;
}

include '../includes/functions.php';
include '../includes/header.php';
?>
<div class="container mt-3 mt-lg-5" style="max-width: 560px;">
    <h1 class="h4 mb-3"><?= $art === 'km' ? 'Kilometerstand notieren' : 'Tanken oder Laden' ?>: Fahrzeug wählen</h1>
    <div class="list-group">
        <?php foreach ($fahrzeuge as $i => $f): ?>
            <a class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3" href="<?= htmlspecialchars($zielUrl($f)) ?>">
                <img src="<?= htmlspecialchars(fahrzeugBildUrl($f, $baseUrl)) ?>" alt="" width="56" height="40" class="rounded object-fit-cover">
                <span class="flex-grow-1">
                    <span class="fw-semibold d-block"><?= htmlspecialchars($f['name'] ?? 'Fahrzeug') ?></span>
                    <?php if (($f['id'] ?? '') === $letztes): ?><span class="small text-body-secondary">zuletzt genutzt</span><?php endif; ?>
                </span>
                <i class="fas fa-chevron-right opacity-50"></i>
            </a>
        <?php endforeach; ?>
    </div>
</div>
<?php include '../includes/footer.php'; ?>
