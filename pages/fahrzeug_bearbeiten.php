<?php
// Fahrzeug bearbeiten: nur die Stammdaten. Status und Löschen stehen in den Fahrzeugdaten (#206, docs/design.md 7.6).
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

$fahrzeug_id = trim((string)($_GET['id'] ?? ''));
$fahrzeug = null;
if ($fahrzeug_id !== '' && isApiAuthenticated()) {
    try {
        $fahrzeug = getApiClient()->getVehicle($fahrzeug_id);
    } catch (Throwable $e) {
        $fahrzeug = null;
    }
}
// Unbekannt, kein Zugriff, archiviert (nur lesbar, #79) oder nicht der Besitzer (#53): die Fahrzeugdaten zeigen den
// passenden Zustand
if ($fahrzeug === null || ($fahrzeug['status'] ?? 'active') !== 'active' || ($fahrzeug['role'] ?? 'owner') !== 'owner') {
    header('Location: ../' . fahrzeugSeite('fahrzeugdaten', $fahrzeug_id));
    exit;
}

include '../includes/header.php';
include_once '../includes/functions.php';

$formAction = 'fahrzeug_update.php';
$abbrechenUrl = '../' . fahrzeugSeite('fahrzeugdaten', (string)($fahrzeug_id));
?>

<div class="container mt-3 mt-lg-5" style="max-width: 820px;">
    <h1 class="h3 d-none d-lg-block mb-3">Fahrzeug bearbeiten</h1>
    <?php include '../includes/form_fahrzeug.php'; ?>
</div>

<?php include '../includes/footer.php'; ?>
