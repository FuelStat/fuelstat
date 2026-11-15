<?php
include '../includes/session.php';
include '../includes/header.php';
include_once '../includes/functions.php';

if (!isset($_GET['id'])) {
    die("Fahrzeug-ID fehlt.");
}
$fahrzeug_id = trim($_GET['id']);

try {
    $fahrzeug = $api->getVehicle($fahrzeug_id);
} catch (Throwable $e) {
    die("Fahrzeug nicht gefunden.");
}

$formAction = 'fahrzeug_update.php';
$abbrechenUrl = 'fahrzeug_detail.php?id=' . urlencode($fahrzeug_id);
?>

<div class="container mt-3 mt-lg-5" style="max-width: 820px;">
    <h1 class="h3 d-none d-lg-block mb-3">Fahrzeug bearbeiten</h1>
    <?php if (($fahrzeug['status'] ?? 'active') === 'active'): ?>
        <?php include '../includes/form_fahrzeug.php'; ?>
    <?php else: ?>
        <!-- Archivierte Fahrzeuge (#79) sind nur lesbar: ändern lässt sich nur der Status -->
        <div class="alert alert-secondary"><i class="fas fa-lock me-1" aria-hidden="true"></i>Dieses Fahrzeug ist archiviert. Zum Bearbeiten der Fahrzeugdaten aktiviere es wieder.</div>
    <?php endif; ?>
    <?php include '../includes/form_fahrzeug_status.php'; ?>

    <div class="card border-danger mt-5 mb-4">
        <div class="card-body">
            <h5 class="card-title text-danger"><i class="fas fa-trash-alt text-danger me-2"></i>Fahrzeug löschen</h5>
            <p class="card-text">Löscht das Fahrzeug mit allen <?= verbrauchsBegriffe($fahrzeug['fuel_type'] ?? 'other')['vorgaengen'] ?>, Ausgaben und Bildern endgültig.</p>
            <form method="post" action="fahrzeug_loeschen.php"
                  onsubmit="return confirm(<?= htmlspecialchars(json_encode('„' . ($fahrzeug['name'] ?? 'Fahrzeug') . '“ mit allen Einträgen endgültig löschen?'), ENT_QUOTES) ?>);">
                <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                <button type="submit" class="btn btn-danger"><i class="fas fa-trash-alt me-1"></i> Fahrzeug löschen</button>
            </form>
        </div>
    </div>
</div>

<?php include '../includes/footer.php'; ?>
