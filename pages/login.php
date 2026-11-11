<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
ob_start();

// Bereits angemeldet (z. B. doppelt abgeschicktes Formular, Lesezeichen oder Home-Bildschirm-Symbol
// auf die Login-Seite): direkt zur Übersicht statt ein leeres Login-Formular zu zeigen
if (isApiAuthenticated()) {
    unset($_SESSION['mfa_pending']);
    header('Location: ../index.php', true, 303);
    exit;
}

$error = '';
// 2FA-Zwischenschritt: nur das kurzlebige mfaToken der API liegt in der Session (kein Passwort)
$pending = $_SESSION['mfa_pending'] ?? null;
if ($pending && ($pending['time'] ?? 0) < time() - 300) {
    unset($_SESSION['mfa_pending']);
    $pending = null;
}
if (isset($_GET['abbrechen'])) {
    unset($_SESSION['mfa_pending']);
    $pending = null;
}
$show_mfa_form = $pending !== null;

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {

        $mfaSchritt = isset($_POST['code']) && $pending;
        $email = $mfaSchritt ? ($pending['email'] ?? '') : trim($_POST['email'] ?? '');
        $password = $_POST['password'] ?? '';

        if (!$mfaSchritt && ($email === '' || $password === '')) {
            $error = "Bitte E-Mail und Passwort eingeben.";
        } else {
            try {
                // Login ohne Session-Token aufrufen (sonst wird alter Bearer mitgeschickt → 401)
                $apiLogin = getApiClient(null);
                $response = $mfaSchritt
                    ? $apiLogin->postAuthLoginMfa($pending['mfa_token'], preg_replace('/\s+/', '', (string)$_POST['code']))
                    : $apiLogin->postAuthLogin($email, $password);
                $data = $response['data'] ?? $response;
                $token = $data['token'] ?? $data['access_token'] ?? $data['accessToken'] ?? '';
                $user = $data['user'] ?? [];
                $userId = $user['id'] ?? $user['userId'] ?? null;
                if ($token !== '') {
                    unset($_SESSION['mfa_pending']);
                    session_regenerate_id(true);
                    setApiToken($token, [
                        'id' => $userId,
                        'email' => $user['email'] ?? $email,
                    ]);
                    // Nach dem Login dorthin, wo man hinwollte (z. B. App-Kürzel "Tanken", #42); nur Seiten dieser App
                    $ziel = (string)($_SESSION['nach_login'] ?? '');
                    unset($_SESSION['nach_login']);
                    $ziel = preg_match('~^pages/[a-z_]+\.php(\?[A-Za-z0-9_=&%-]*)?$~', $ziel) ? '../' . $ziel : '../index.php';
                    session_write_close();
                    while (ob_get_level()) {
                        ob_end_clean();
                    }
                    header('Location: ' . $ziel, true, 303);
                    exit;
                }
                error_log('[Login] missing token in response for ' . $email . ', keys=' . implode(',', array_keys($data)));
                $error = 'Login-Antwort enthielt kein Token.';
            } catch (RuntimeException $e) {
                $msg = $e->getMessage();
                error_log('[Login] API-Fehler: ' . $e->getCode() . ' ' . $msg);
                if ($msg === 'mfa_required' && $e instanceof FuelstatApiException && !empty($e->data['mfaToken'])) {
                    $_SESSION['mfa_pending'] = ['email' => $email, 'mfa_token' => $e->data['mfaToken'], 'time' => time()];
                    $show_mfa_form = true;
                } elseif ($msg === 'invalid_mfa_code') {
                    $show_mfa_form = true;
                    $error = 'Der Code ist falsch, abgelaufen oder wurde schon verwendet. Bitte den nächsten Code aus der App eingeben.';
                } elseif ($msg === 'too_many_attempts') {
                    $error = 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.';
                } elseif ($msg === 'invalid_mfa_token') {
                    unset($_SESSION['mfa_pending']);
                    $show_mfa_form = false;
                    $error = 'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.';
                } elseif ($e->getCode() === 401 || $msg === 'invalid_credentials') {
                    unset($_SESSION['mfa_pending']);
                    $show_mfa_form = false;
                    $error = "Ungültige E-Mail oder Passwort.";
                } else {
                    $error = $msg;
                }
            }
        }
    }

    include '../includes/header.php';
} catch (Exception $e) {
    error_log("Fehler in login.php: " . $e->getMessage());
    die("Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.");
}
?>

<div class="container">
    <div class="row justify-content-center mt-5">
        <div class="col-md-6 col-lg-4">
            <div class="card anmelde-karte">
                <div class="card-body p-4">
                    <div class="text-center mb-4">
                        <img src="<?= htmlspecialchars($baseUrl) ?>images/icon-192x192.png" alt="" class="anmelde-logo" width="64" height="64">
                        <h1 class="mt-3 mb-1">Anmelden</h1>
                        <p class="text-body-secondary mb-0">Schön, dass du da bist.</p>
                    </div>

                    <?php if ($error !== ''): ?>
                        <div class="alert alert-danger" role="alert">
                            <?= htmlspecialchars($error) ?>
                        </div>
                    <?php endif; ?>

                    <?php if (isset($_SESSION['success_message'])): ?>
                        <div class="alert alert-success" role="alert">
                            <?php
                            echo htmlspecialchars($_SESSION['success_message']);
                            unset($_SESSION['success_message']);
                            ?>
                        </div>
                    <?php endif; ?>

                    <?php if ($show_mfa_form): ?>
                    <form method="post">
                        <p class="text-muted">Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
                        <div class="mb-4">
                            <label for="code" class="form-label">Bestätigungscode</label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="fas fa-shield-alt"></i></span>
                                <input type="text" class="form-control" id="code" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}"
                                       autocomplete="one-time-code" placeholder="123456" required autofocus>
                            </div>
                        </div>
                        <div class="d-grid gap-2">
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-sign-in-alt me-2"></i> Bestätigen
                            </button>
                            <a href="login.php?abbrechen=1" class="btn btn-outline-secondary">Abbrechen</a>
                        </div>
                    </form>
                    <?php else: ?>
                    <form method="post">
                        <div class="mb-3">
                            <label for="email" class="form-label">E-Mail</label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="fas fa-envelope"></i></span>
                                <input type="email" class="form-control" id="email" name="email" autocomplete="username"
                                       placeholder="name@example.de" required>
                            </div>
                        </div>
                        <div class="mb-4">
                            <label for="password" class="form-label">Passwort</label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="fas fa-lock"></i></span>
                                <input type="password" class="form-control" id="password" name="password" autocomplete="current-password"
                                        required>
                            </div>
                            <div class="text-end mt-1"><a href="passwort_vergessen.php" class="small text-decoration-none">Passwort vergessen?</a></div>
                        </div>
                        <div class="d-grid">
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-sign-in-alt me-2"></i> Anmelden
                            </button>
                        </div>
                    </form>
                    <?php endif; ?>

                    <div class="text-center mt-4">
                        <p class="text-muted mb-0">
                            Noch kein Konto?
                            <a href="register.php" class="text-decoration-none">Jetzt registrieren</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
// Formular nur einmal abschicken (Handy: Enter auf der Tastatur + Tipp auf den Button)
document.querySelectorAll('form[method="post"]').forEach(form => {
    form.addEventListener('submit', event => {
        if (form.dataset.gesendet) {
            event.preventDefault();
            return;
        }
        form.dataset.gesendet = '1';
        const button = form.querySelector('button[type="submit"]');
        if (button) {
            button.disabled = true;
        }
    });
});
</script>
<?php include '../includes/footer.php'; ?>
