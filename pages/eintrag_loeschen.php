<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
$api = getApiClient();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    die('Ungültige Anfrage.');
}
if (!isset($_POST['id'], $_POST['fahrzeug_id'])) {
    die('Eintrag-ID oder Fahrzeug-ID fehlt.');
}
$eintrag_id = trim($_POST['id']);
$fahrzeug_id = trim($_POST['fahrzeug_id']);
$type = $_POST['type'] ?? 'entry';

if ($type === 'fillup') {
    try {
        $api->deleteFillup($eintrag_id);
        $_SESSION['success_message'] = 'Eintrag gelöscht.';
    } catch (Throwable $e) {
        $_SESSION['error_message'] = tarifHinweis($e) ?? $e->getMessage();
    }
} elseif ($type === 'trip') {
    // Fahrtenbuch (#52)
    try {
        $api->deleteTrip($eintrag_id);
        $_SESSION['success_message'] = 'Fahrt gelöscht.';
    } catch (Throwable $e) {
        $_SESSION['error_message'] = tarifHinweis($e) ?? $e->getMessage();
    }
} else {
    try {
        $api->deleteEntry($eintrag_id);
        $_SESSION['success_message'] = 'Ausgabe gelöscht.';
    } catch (Throwable $e) {
        $_SESSION['error_message'] = tarifHinweis($e) ?? $e->getMessage();
    }
}
header('Location: fahrzeug_detail.php?id=' . rawurlencode($fahrzeug_id));
exit;
