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
    assert(!preg_match('/\b(HTTP )?[1-5]\d\d\b|[a-z]+_[a-z_]+/', $text), 'Code im Text: ' . $text);
}

echo "All tests passed\n";
