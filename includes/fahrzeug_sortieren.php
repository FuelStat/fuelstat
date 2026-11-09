<?php
// Fahrzeug in der Übersicht eine Position nach vorne oder hinten schieben (speichert sortOrder über die API)
include 'session.php';
require_once __DIR__ . '/api_config.php';
require_once __DIR__ . '/api_helpers.php';

if (!isApiAuthenticated()) {
    http_response_code(403);
    exit('Nicht eingeloggt.');
}

$id = trim((string)($_POST['id'] ?? ''));
$richtung = $_POST['richtung'] ?? '';
// Im Sortiermodus der Übersicht bleiben
$zurueck = !empty($_POST['sortieren']) ? '../index.php?sortieren=1' : '../index.php';

if ($id === '' || !in_array($richtung, ['hoch', 'runter'], true)) {
    header('Location: ' . $zurueck);
    exit;
}

try {
    $api = getApiClient();
    // Die API liefert die Fahrzeuge bereits in der gespeicherten Reihenfolge
    // Nur eigene Fahrzeuge: geteilte (#53) stehen immer dahinter und lassen sich nicht umsortieren
    $ids = array_column(array_filter($api->getVehicles(), fn($v) => ($v['role'] ?? 'owner') === 'owner'), 'id');
    $pos = array_search($id, $ids, true);
    $ziel = $richtung === 'hoch' ? $pos - 1 : $pos + 1;
    if ($pos !== false && $ziel >= 0 && $ziel < count($ids)) {
        [$ids[$pos], $ids[$ziel]] = [$ids[$ziel], $ids[$pos]];
        foreach ($ids as $i => $vehicleId) {
            $api->patchVehicle($vehicleId, ['sortOrder' => $i]);
        }
    }
} catch (Throwable $e) {
    $_SESSION['error_message'] = 'Reihenfolge konnte nicht gespeichert werden: ' . $e->getMessage();
}
header('Location: ' . $zurueck);
exit;
