<?php
// Push auf diesem Gerät (#136): Der Browser meldet sein Push-Abo hier an bzw. ab; die Seite leitet es an die API
// weiter (der Browser ruft die API nicht selbst auf). Antwort als JSON. CSRF-Schutz über includes/session.php.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
header('Content-Type: application/json; charset=utf-8');

if (!isApiAuthenticated()) {
    http_response_code(401);
    echo json_encode(['error' => 'not_authenticated']);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

$api = getApiClient();
$aktion = (string)($_POST['aktion'] ?? '');
try {
    if ($aktion === 'abonnieren') {
        $abo = json_decode((string)($_POST['abo'] ?? ''), true);
        if (!is_array($abo) || !isset($abo['endpoint'], $abo['keys']) || !is_array($abo['keys'])) {
            throw new RuntimeException('invalid_subscription');
        }
        $api->postPushDevice([
            'kind' => 'webpush',
            'endpoint' => (string)$abo['endpoint'],
            'keys' => ['p256dh' => (string)($abo['keys']['p256dh'] ?? ''), 'auth' => (string)($abo['keys']['auth'] ?? '')],
            'name' => mb_substr(trim((string)($_POST['name'] ?? '')), 0, 100) ?: null,
        ]);
        echo json_encode(['ok' => true]);
    } elseif ($aktion === 'abmelden') {
        try {
            $api->deletePushDeviceByEndpoint((string)($_POST['endpoint'] ?? ''));
        } catch (FuelstatApiException $e) {
            // Schon weg (z. B. vom Push-Dienst abgemeldet): auch gut
            if ($e->getMessage() !== 'device_not_found') {
                throw $e;
            }
        }
        echo json_encode(['ok' => true]);
    } elseif ($aktion === 'test') {
        echo json_encode($api->postPushTest());
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'invalid_action']);
    }
} catch (Throwable $e) {
    $status = $e instanceof FuelstatApiException && $e->getCode() >= 400 ? $e->getCode() : 400;
    http_response_code($status);
    echo json_encode(['error' => $e->getMessage()]);
}
