<?php
// Status eines Fahrzeugs ändern (#79): aktiv, verkauft, stillgelegt
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';
$api = getApiClient();

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_POST['fahrzeug_id'])) {
    header('Location: ../index.php');
    exit;
}
$fahrzeug_id = trim($_POST['fahrzeug_id']);
$status = (string)($_POST['status'] ?? '');
if (!in_array($status, ['active', 'sold', 'decommissioned'], true)) {
    $_SESSION['error_message'] = 'Bitte einen Status wählen.';
    header('Location: ../' . fahrzeugSeite('fahrzeugdaten', (string)$fahrzeug_id) . '#status');
    exit;
}

$text = fn(string $k) => trim((string)($_POST[$k] ?? ''));
$daten = ['status' => $status];
if ($status === 'sold') {
    // Leere Felder: Verkaufsdatum fehlt = heute (API); Erlös und Tachostand leer = löschen
    if ($text('saleDate') !== '') $daten['saleDate'] = $text('saleDate');
    $daten['saleOdometerKm'] = $text('saleOdometerKm') === '' ? null : (ctype_digit($text('saleOdometerKm')) ? (int)$text('saleOdometerKm') : $text('saleOdometerKm'));
    $preis = str_replace(',', '.', $text('salePrice'));
    $daten['salePrice'] = $preis === '' ? null : (is_numeric($preis) ? (float)$preis : $preis);
} elseif ($status === 'decommissioned') {
    if ($text('decommissionedFrom') !== '') $daten['decommissionedFrom'] = $text('decommissionedFrom');
    $daten['decommissionedUntil'] = $text('decommissionedUntil') === '' ? null : $text('decommissionedUntil');
}

try {
    $api->patchVehicle($fahrzeug_id, $daten);
    $_SESSION['success_message'] = [
        'active' => 'Das Fahrzeug ist wieder aktiv.',
        'sold' => 'Das Fahrzeug ist als verkauft archiviert. Alle Daten bleiben lesbar.',
        'decommissioned' => 'Das Fahrzeug ist als stillgelegt archiviert. Alle Daten bleiben lesbar.',
    ][$status];
    header('Location: ../' . fahrzeugSeite('fahrzeugdaten', (string)($fahrzeug_id)));
} catch (Throwable $e) {
    $_SESSION['error_message'] = fahrzeugFehlerText($e);
    header('Location: ../' . fahrzeugSeite('fahrzeugdaten', (string)$fahrzeug_id) . '#status');
}
exit;
