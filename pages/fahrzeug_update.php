<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';
$api = getApiClient();

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_POST['fahrzeug_id'])) {
    header('Location: ../index.php');
    exit;
}
$fahrzeug_id = trim($_POST['fahrzeug_id']);
$daten = fahrzeugDatenAusPost($_POST);

if ($daten['name'] === '' || !array_key_exists($daten['fuelType'], getKraftstoffOptionen())) {
    $_SESSION['error_message'] = 'Name und gültige Kraftstoffart sind erforderlich.';
    header('Location: fahrzeug_bearbeiten.php?id=' . rawurlencode($fahrzeug_id));
    exit;
}

try {
    $api->patchVehicle($fahrzeug_id, $daten);
    $bildFehler = speichereFahrzeugBild($api, $fahrzeug_id, $_FILES, $_POST);
    if ($bildFehler !== null) {
        $_SESSION['warning_message'] = 'Fahrzeug gespeichert, aber: ' . $bildFehler;
    } else {
        $_SESSION['success_message'] = 'Fahrzeug aktualisiert.';
    }
    header('Location: ../' . fahrzeugSeite('fahrzeugdaten', (string)($fahrzeug_id)));
    exit;
} catch (Throwable $e) {
    $_SESSION['error_message'] = fahrzeugFehlerText($e);
    header('Location: fahrzeug_bearbeiten.php?id=' . rawurlencode($fahrzeug_id));
    exit;
}
