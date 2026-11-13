<?php
// Passkeys (#2): Der Browser holt hier die WebAuthn-Optionen und schickt die Antwort von Face ID, Fingerabdruck,
// Windows Hello oder Sicherheitsschlüssel zurück; die Seite leitet beides an die API weiter (der Browser ruft die API
// nicht selbst auf) und legt nach der Anmeldung das Token in die Sitzung wie login.php. Antwort als JSON.
// CSRF-Schutz über includes/session.php.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function antworten(array $daten, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($daten, JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    antworten(['error' => 'method_not_allowed'], 405);
}

$aktion = (string)($_POST['aktion'] ?? '');
$challengeId = (string)($_POST['challengeId'] ?? '');
// Antwort des Browsers (PublicKeyCredential.toJSON) als Objekt, damit {} nicht zu [] wird
$antwort = json_decode((string)($_POST['antwort'] ?? ''));

try {
    if ($aktion === 'anmelden_optionen') {
        antworten(getApiClient(null)->postPasskeyLoginOptions());
    }
    if ($aktion === 'anmelden') {
        if (!is_object($antwort)) {
            antworten(['error' => 'invalid_passkey_response'], 400);
        }
        $r = getApiClient(null)->postPasskeyLogin($challengeId, $antwort);
        $token = (string)($r['token'] ?? '');
        if ($token === '') {
            antworten(['error' => 'no_token'], 502);
        }
        unset($_SESSION['mfa_pending']);
        session_regenerate_id(true);
        setApiToken($token, ['id' => $r['user']['id'] ?? null, 'email' => $r['user']['email'] ?? '']);
        // Nach dem Login dorthin, wo man hinwollte (wie login.php); nur Seiten dieser App
        $ziel = (string)($_SESSION['nach_login'] ?? '');
        unset($_SESSION['nach_login']);
        $ziel = preg_match('~^pages/[a-z_]+\.php(\?[A-Za-z0-9_=&%-]*)?$~', $ziel) ? '../' . $ziel : '../index.php';
        antworten(['ok' => true, 'ziel' => $ziel]);
    }

    if (!isApiAuthenticated()) {
        antworten(['error' => 'not_authenticated'], 401);
    }
    $api = getApiClient();
    if ($aktion === 'anlegen_optionen') {
        antworten($api->postPasskeyRegisterOptions((string)($_POST['passwort'] ?? '')));
    }
    if ($aktion === 'anlegen') {
        if (!is_object($antwort)) {
            antworten(['error' => 'invalid_passkey_response'], 400);
        }
        $name = mb_substr(trim((string)($_POST['name'] ?? '')), 0, 100);
        $passkey = $api->postPasskeyRegister($challengeId, $antwort, $name !== '' ? $name : null);
        $_SESSION['success_message'] = 'Passkey „' . ($passkey['name'] ?? $name) . '“ ist eingerichtet. Du kannst dich jetzt damit anmelden.';
        antworten(['ok' => true]);
    }
    antworten(['error' => 'invalid_action'], 400);
} catch (FuelstatApiException $e) {
    antworten(['error' => $e->getMessage()], $e->getCode() >= 400 ? $e->getCode() : 400);
} catch (Throwable $e) {
    error_log('[passkey] ' . $e->getMessage());
    antworten(['error' => 'server_error'], 500);
}
