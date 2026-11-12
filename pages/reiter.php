<?php
// Inhalt eines Reiters der Fahrzeugseite, nachgeladen beim Öffnen (#160). Die Fahrzeugseite liefert nur „Allgemein“
// sofort aus; Einträge, Statistik, Ausgaben, Fahrten und Einstellungen holt sie per fetch von hier. Die Parameter der
// Seite (z. B. ?jahr=, ?fahrt_jahr=) kommen mit, die Reiter lesen sie wie bisher aus $_GET.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/basis_url.php';
include '../includes/functions.php';

$erlaubt = ['eintraege', 'statistiken', 'ausgaben', 'fahrten', 'einstellungen'];
$reiter = (string)($_GET['reiter'] ?? '');
$fahrzeug_id = (string)($_GET['id'] ?? '');
header('Content-Type: text/html; charset=utf-8');

if (!isApiAuthenticated()) {
    http_response_code(401);
    exit;
}
if (!in_array($reiter, $erlaubt, true) || $fahrzeug_id === '') {
    http_response_code(400);
    exit;
}

$api = getApiClient();
try {
    $fahrzeug = $api->getVehicle($fahrzeug_id);
} catch (Throwable $e) {
    http_response_code(404);
    exit;
}

include '../includes/fahrzeug_kontext.php';
include '../tabs/' . $reiter . '.php';
