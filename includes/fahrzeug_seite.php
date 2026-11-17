<?php
// Rahmen der Ansichten eines Fahrzeugs (#206, docs/design.md 7.2): Einträge, Statistik, Service, Fahrten, Fahrzeugdaten
// sind eigene Seiten statt Reiter einer Fahrzeugseite. Lädt das Fahrzeug (?id=), setzt die gemeinsamen Angaben
// (includes/fahrzeug_kontext.php) und zeigt Überschrift, Hinweis bei archivierten und geteilten Fahrzeugen.
// Erwartet: $ansichtTitel (z. B. „Service“). Danach bindet die Seite ihren Inhalt ein und schließt mit
// includes/fahrzeug_seite_ende.php.
include __DIR__ . '/session.php';
require_once __DIR__ . '/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
include __DIR__ . '/header.php';
include __DIR__ . '/functions.php';
$fahrzeug_id = (string)($_GET['id'] ?? '');
$fahrzeug = null;
if ($fahrzeug_id !== '') {
    try {
        $fahrzeug = $api->getVehicle($fahrzeug_id);
    } catch (Throwable $e) {
        $fahrzeug = null;
    }
}
if ($fahrzeug === null) {
    // EmptyState statt eines leeren Bildschirms (docs/design.md 8.1); ein Text für „gibt es nicht“ und „kein Zugriff“
    ?>
<div class="container mt-4">
    <div class="card leer-zustand mx-auto">
        <div class="card-body">
            <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-car-side"></i></span>
            <h1 class="h2">Fahrzeug nicht gefunden</h1>
            <p class="text-body-secondary mb-4">Das gibt es nicht oder du hast keinen Zugriff darauf.</p>
            <a href="<?= htmlspecialchars($baseUrl) ?>index.php" class="btn btn-primary">Zur Startseite</a>
        </div>
    </div>
</div>
    <?php
    include __DIR__ . '/footer.php';
    exit;
}

include __DIR__ . '/fahrzeug_kontext.php';
?>
<div class="container fahrzeug-ansicht">
    <!-- Überschrift: mobil steht der Titel in der Kopfleiste, für Screenreader trotzdem als h1 -->
    <h1 class="seiten-titel h3 mt-lg-4 mb-0"><?= htmlspecialchars($ansichtTitel) ?> <span class="fw-normal text-body-secondary">· <?= htmlspecialchars($fahrzeug['name'] ?? 'Fahrzeug') ?></span></h1>
    <?php if ($archiviert): ?>
    <div class="alert alert-secondary d-flex flex-wrap align-items-center gap-2 mt-3 mb-0" role="status">
        <span class="flex-grow-1"><i class="fas fa-box-archive me-1" aria-hidden="true"></i><strong><?= htmlspecialchars(fahrzeugStatusText($fahrzeug)) ?>.</strong> Alle Daten bleiben lesbar, ändern lässt sich nichts.</span>
        <?php if ($istBesitzer): ?>
        <form method="post" action="fahrzeug_status.php" class="m-0">
            <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
            <input type="hidden" name="status" value="active">
            <button type="submit" class="btn btn-sm btn-secondary">Wieder aktivieren</button>
        </form>
        <?php endif; ?>
    </div>
    <?php endif; ?>
    <?php if (!$istBesitzer): ?>
    <p class="fs-label mt-2 mb-0"><i class="fas fa-users me-1" aria-hidden="true"></i>Geteilt von <?= htmlspecialchars((string)($fahrzeug['owner_name'] ?? '')) ?> · <?= $rolle === 'editor' ? 'du kannst Einträge erfassen' : 'nur ansehen' ?></p>
    <?php endif; ?>
