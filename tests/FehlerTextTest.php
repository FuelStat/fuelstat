<?php
// fehlerText() (#211, docs/design.md 8.1): Klartext statt Status- und Fehlercodes, eigene Sätze der Seiten bleiben.
require_once __DIR__ . '/../includes/api_helpers.php';

$api = fn(string $code, int $status, array $data = []) => new FuelstatApiException($code, $status, null, $data);
$spaeter = 'Das hat gerade nicht geklappt. Versuche es gleich noch einmal.';
$faelle = [
    [new FuelstatVerbindungsException('API request failed: Connection refused'), $spaeter],
    [$api('server_error', 500), $spaeter],
    [$api('HTTP 502', 502), $spaeter],
    [$api('invalid_token', 401), 'Du bist abgemeldet. Melde dich bitte neu an.'],
    [$api('session_revoked', 401), 'Du bist abgemeldet. Melde dich bitte neu an.'],
    [$api('vehicle_not_found', 404), 'Das gibt es nicht oder du hast keinen Zugriff darauf.'],
    [$api('forbidden', 403), 'Das gibt es nicht oder du hast keinen Zugriff darauf.'],
    [$api('app_update_required', 426), 'Bitte aktualisiere die App, um weiterzumachen.'],
    [$api('too_many_requests', 429), 'Zu viele Versuche. Warte kurz und versuche es dann noch einmal.'],
    [$api('vehicle_archived', 409), 'Dieses Fahrzeug ist verkauft oder stillgelegt und nur lesbar. Aktiviere es wieder, um etwas zu ändern.'],
    [$api('invalid_taxDueMonth', 400), 'Das hat nicht geklappt. Prüfe deine Angaben und versuche es noch einmal.'],
    [$api('invalid_credentials', 401), 'Das hat nicht geklappt. Prüfe deine Angaben und versuche es noch einmal.'],
    [$api('irgendwas', 400, ['message' => 'Die Kategorie ist schon vergeben.']), 'Die Kategorie ist schon vergeben.'],
    // Zu langer Freitext (#197)
    [$api('invalid_station', 400, ['error' => 'invalid_station', 'max' => 200]), 'Ein Text ist zu lang. Erlaubt sind höchstens 200 Zeichen.'],
    [$api('invalid_description', 400, ['error' => 'invalid_description', 'max' => 2000]), 'Ein Text ist zu lang. Erlaubt sind höchstens 2.000 Zeichen.'],
    [new RuntimeException('Nur JPEG, PNG, GIF und WebP sind als Bild erlaubt.'), 'Nur JPEG, PNG, GIF und WebP sind als Bild erlaubt.'],
    [new RuntimeException('Das Profilbild konnte nicht hochgeladen werden (zu groß?).'), 'Das Profilbild konnte nicht hochgeladen werden (zu groß?).'],
    [new RuntimeException('curl_init failed'), $spaeter],
    [new RuntimeException('json_encode failed'), $spaeter],
    [new TypeError('Argument #1 must be of type array'), $spaeter],
];
foreach ($faelle as [$e, $erwartet]) {
    $text = fehlerText($e);
    assert($text === $erwartet, get_class($e) . ' ' . $e->getMessage() . ': ' . $text);
    // Nie ein Code in der Oberfläche
    assert(!preg_match('/HTTP \d{3}|\b(status|code) ?\d{3}\b|[a-z]+_[a-z_]+/i', $text), 'Code im Text: ' . $text);
}

// Fahrzeugformular: Feldname mit Grenze, unbekannte Codes nie roh (#197)
assert(fahrzeugFehlerText($api('invalid_brand', 400, ['max' => 100])) === 'Bitte prüfen: Marke (höchstens 100 Zeichen).');
assert(str_starts_with(fahrzeugFehlerText($api('invalid_taxDueMonth', 400)), 'Bitte prüfen: '));
assert(!str_contains(fahrzeugFehlerText($api('irgendein_code', 400)), '_'), 'kein roher Code');

echo "All tests passed\n";
