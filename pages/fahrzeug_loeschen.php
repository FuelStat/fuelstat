<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
$api = getApiClient();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    die('Ungültige Anfrage.');
}
if (!isset($_POST['fahrzeug_id'])) {
    die('Fahrzeug-ID fehlt.');
}
$fahrzeug_id = trim($_POST['fahrzeug_id']);

try {
    // Bilddateien zuerst entfernen, sonst bleiben sie nach dem Löschen im Upload-Ordner liegen
    try {
        foreach ($api->getVehicleMedia($fahrzeug_id) as $media) {
            $api->deleteVehicleMedia($fahrzeug_id, $media['id']);
        }
    } catch (Throwable $e) {
        error_log('[Fahrzeug löschen] Bilder nicht entfernt: ' . $e->getMessage());
    }
    $api->deleteVehicle($fahrzeug_id);
    $_SESSION['success_message'] = 'Fahrzeug erfolgreich gelöscht.';
} catch (Throwable $e) {
    $_SESSION['error_message'] = fehlerText($e);
}
header('Location: ../index.php');
exit;
