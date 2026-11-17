<?php
// Service-Historie (#78): Wechselintervall eines Bauteils speichern, eigene Bauteile anlegen und entfernen.
// Die Prüfung der Werte und die Rechte (Intervall nur Besitzer) liegen in der API.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

if (!isApiAuthenticated() || $_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: login.php');
    exit;
}
$api = getApiClient();
$fahrzeug_id = trim((string)($_POST['fahrzeug_id'] ?? ''));
$aktion = (string)($_POST['aktion'] ?? '');
$ganz = function (string $name): ?int {
    $wert = trim((string)($_POST[$name] ?? ''));
    return $wert === '' ? null : (is_numeric($wert) ? (int)round((float)$wert) : -1);
};
$meldungen = [
    'invalid_intervalMonths' => 'Das Intervall in Monaten muss eine ganze Zahl von 1 bis 240 sein.',
    'invalid_intervalKm' => 'Das Intervall in km muss zwischen 1.000 und 1.000.000 liegen.',
    'invalid_name' => 'Bitte einen Namen mit höchstens 40 Zeichen eingeben.',
    'part_exists' => 'Dieses Bauteil gibt es schon.',
    'too_many_parts' => 'Du hast schon 30 eigene Bauteile. Entferne zuerst eines.',
    'owner_only' => 'Das Intervall kann nur der Besitzer des Fahrzeugs ändern.',
];
try {
    if ($fahrzeug_id === '') {
        throw new RuntimeException('Fahrzeug fehlt.');
    }
    if ($aktion === 'intervall') {
        $api->putPartInterval($fahrzeug_id, (string)($_POST['teil'] ?? ''), $ganz('monate'), $ganz('km'));
        $_SESSION['success_message'] = 'Intervall gespeichert.';
    } elseif ($aktion === 'bauteil_neu') {
        $api->postVehiclePart($fahrzeug_id, trim((string)($_POST['name'] ?? '')));
        $_SESSION['success_message'] = 'Bauteil hinzugefügt. Du kannst es jetzt beim Erfassen einer Ausgabe wählen.';
    } elseif ($aktion === 'bauteil_loeschen') {
        $api->deleteVehiclePart($fahrzeug_id, (string)($_POST['teil_id'] ?? ''));
        $_SESSION['success_message'] = 'Bauteil entfernt.';
    }
} catch (Throwable $e) {
    $_SESSION['error_message'] = $meldungen[$e->getMessage()] ?? fehlerText($e);
}
header('Location: ../' . fahrzeugSeite('service', (string)($fahrzeug_id)), true, 303);
exit;
