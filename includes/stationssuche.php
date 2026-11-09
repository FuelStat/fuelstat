<?php
// Gemeinsame Weiterleitung der Stationssuchen an die Fuelstat-API (#123), genutzt von api/tankstellen.php
// und api/ladestationen.php. Antwortet mit dem JSON der API bzw. einer verständlichen Fehlermeldung.

/**
 * @param callable $abfrage   fn(FuelstatApi, array $query): array
 * @param string[] $parameter erlaubte Query-Parameter, die an die API gehen
 * @param string   $was       z. B. "Die Tankstellensuche" für Fehlermeldungen
 */
function stationssucheWeiterleiten(callable $abfrage, array $parameter, string $was): void
{
    header('Content-Type: application/json');
    $antwort = function (int $status, array $daten): void {
        http_response_code($status);
        echo json_encode($daten, JSON_UNESCAPED_UNICODE);
        exit;
    };

    if (!isApiAuthenticated()) {
        $antwort(401, ['error' => 'Bitte anmelden.']);
    }
    // Session nicht länger sperren als nötig (die Suche kann einige Sekunden dauern)
    session_write_close();

    $query = [];
    foreach ($parameter as $name) {
        if (isset($_GET[$name]) && is_string($_GET[$name]) && $_GET[$name] !== '') {
            $query[$name] = $_GET[$name];
        }
    }

    try {
        $antwort(200, $abfrage(new FuelstatApi(), $query));
    } catch (FuelstatApiException $e) {
        $code = $e->getCode();
        $meldung = match ($e->getMessage()) {
            'invalid_coordinates' => 'Ungültige Koordinaten',
            'invalid_radius' => 'Radius muss zwischen 1 und 25 km liegen',
            'stations_not_configured', 'charging_stations_not_configured' => $was . ' ist nicht eingerichtet.',
            'stations_unavailable', 'charging_stations_unavailable' => $was . ' ist gerade nicht erreichbar.',
            'too_many_requests' => 'Zu viele Suchen in kurzer Zeit. Bitte gleich noch einmal versuchen.',
            'email_not_verified' => $was . ' ist verfügbar, sobald du deine E-Mail-Adresse bestätigt hast.',
            default => $was . ' ist fehlgeschlagen.',
        };
        $antwort($code >= 400 && $code < 600 ? $code : 502, ['error' => $meldung]);
    } catch (Throwable $e) {
        error_log('[Stationssuche] ' . $e->getMessage());
        $antwort(502, ['error' => $was . ' ist gerade nicht erreichbar.']);
    }
}
