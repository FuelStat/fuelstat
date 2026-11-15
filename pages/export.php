<?php
// CSV-Export aller Einträge eines Fahrzeugs (Semikolon + UTF-8-BOM, damit Excel es direkt öffnet).
// Die Datei baut die API (GET /vehicles/:id/export, #184), damit Web-App und Apps dasselbe Format bekommen;
// diese Seite reicht sie nur durch. Fahrten stehen im Export des Fahrtenbuchs (pages/fahrten_export.php).
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$fahrzeug_id = trim($_GET['id'] ?? '');
$jahr = isset($_GET['jahr']) && $_GET['jahr'] !== '' ? (int)$_GET['jahr'] : null;

try {
    [$csv, $dateiname] = getApiClient()->getEntriesCsv($fahrzeug_id, $jahr);
} catch (Throwable $e) {
    $code = $e instanceof FuelstatApiException ? $e->getCode() : 0;
    http_response_code($code === 404 ? 404 : 500);
    exit($code === 404 ? 'Fahrzeug nicht gefunden.' : 'Der Export ist fehlgeschlagen.');
}
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $dateiname . '"');
header('X-Content-Type-Options: nosniff');
echo $csv;
