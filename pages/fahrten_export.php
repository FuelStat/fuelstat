<?php
// Fahrtenbuch als CSV (#52, Plus): reicht den Export der API durch. Tarif und Rechte prüft die API.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$fahrzeugId = (string)($_GET['id'] ?? '');
$jahr = isset($_GET['jahr']) && $_GET['jahr'] !== '' ? (int)$_GET['jahr'] : null;
try {
    $csv = getApiClient()->getTripsCsv($fahrzeugId, $jahr);
} catch (Throwable $e) {
    $_SESSION['error_message'] = tarifHinweis($e) ?? 'Der Export ist fehlgeschlagen.';
    header('Location: fahrzeug_detail.php?id=' . urlencode($fahrzeugId) . '#fahrten');
    exit;
}
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="fahrtenbuch' . ($jahr ? '-' . $jahr : '') . '.csv"');
header('X-Content-Type-Options: nosniff');
echo $csv;
