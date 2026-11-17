<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}

$api = getApiClient();
$error = '';
$mfaAktiv = false;
try {
    $mfaAktiv = !empty($api->getWhoAmI()['mfa_enabled']);
} catch (Throwable $e) {
    $error = fehlerText($e);
}

// Secret aus dem laufenden Einrichtungsvorgang (für erneute Anzeige bei falschem Code)
$setup = $_SESSION['mfa_setup'] ?? null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $aktion = $_POST['aktion'] ?? '';
    $code = preg_replace('/\s+/', '', (string)($_POST['code'] ?? ''));
    try {
        if ($aktion === 'starten' && !$mfaAktiv) {
            $setup = $api->postMfaSetup();
            $_SESSION['mfa_setup'] = $setup;
        } elseif ($aktion === 'aktivieren' && !$mfaAktiv && $setup) {
            $api->postMfaEnable($code);
            unset($_SESSION['mfa_setup']);
            $_SESSION['success_message'] = 'Zwei-Faktor-Authentifizierung ist aktiviert.';
            header('Location: einstellungen.php');
            exit;
        } elseif ($aktion === 'deaktivieren' && $mfaAktiv) {
            $api->postMfaDisable($_POST['password'] ?? '', $code);
            $_SESSION['success_message'] = 'Zwei-Faktor-Authentifizierung ist deaktiviert.';
            header('Location: einstellungen.php');
            exit;
        }
    } catch (Throwable $e) {
        $meldungen = [
            'invalid_mfa_code' => 'Der Code ist falsch oder abgelaufen.',
            'invalid_current_password' => 'Das Passwort ist falsch.',
            'too_many_attempts' => 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.',
        ];
        $error = $meldungen[$e->getMessage()] ?? fehlerText($e);
    }
}

include '../includes/header.php';
?>
<div class="container">
    <div class="row justify-content-center mt-5">
        <div class="col-md-8 col-lg-6">
            <div class="card shadow">
                <div class="card-body p-4">
                    <h3 class="h4 mb-4"><i class="fas fa-shield-alt me-2 text-primary"></i>Zwei-Faktor-Authentifizierung</h3>
                    <?php if ($error): ?>
                        <div class="alert alert-danger"><?= htmlspecialchars($error) ?></div>
                    <?php endif; ?>

                    <?php if ($mfaAktiv): ?>
                        <div class="alert alert-success"><i class="fas fa-check-circle me-2"></i>Der Zwei-Faktor-Schutz ist aktiv. Beim Anmelden wird ein Code aus deiner Authenticator-App abgefragt.</div>
                        <h5 class="mt-4">Zwei-Faktor-Schutz ausschalten</h5>
                        <form method="post">
                            <input type="hidden" name="aktion" value="deaktivieren">
                            <div class="mb-3">
                                <label for="password" class="form-label">Passwort</label>
                                <input type="password" class="form-control" id="password" name="password" autocomplete="current-password" required>
                            </div>
                            <div class="mb-3">
                                <label for="code" class="form-label">Aktueller Code</label>
                                <input type="text" class="form-control" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
                            </div>
                            <button type="submit" class="btn btn-outline-danger">Zwei-Faktor-Schutz ausschalten</button>
                        </form>
                    <?php elseif ($setup): ?>
                        <ol class="ps-3">
                            <li class="mb-2">Scanne den QR-Code mit einer Authenticator-App (z. B. Google Authenticator, Aegis, 1Password).</li>
                            <li class="mb-2">Oder gib den Schlüssel manuell ein: <code class="user-select-all"><?= htmlspecialchars(trim(chunk_split($setup['secret'], 4, ' '))) ?></code></li>
                            <li>Gib den angezeigten 6-stelligen Code ein.</li>
                        </ol>
                        <div id="qrcode" class="bg-white p-3 d-inline-block rounded mb-3"></div>
                        <form method="post">
                            <input type="hidden" name="aktion" value="aktivieren">
                            <div class="mb-3">
                                <label for="code" class="form-label">Code aus der App</label>
                                <input type="text" class="form-control" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" required autofocus>
                            </div>
                            <button type="submit" class="btn btn-primary">Zwei-Faktor-Schutz einschalten</button>
                            <a href="einstellungen.php" class="btn btn-outline-secondary ms-2">Abbrechen</a>
                        </form>
                        <script src="<?= htmlspecialchars(assetUrl('../', 'vendor/qrcodejs/qrcode.min.js')) ?>"></script>
                        <script>
                          if (window.QRCode) {
                            new QRCode(document.getElementById('qrcode'), { text: <?= json_encode($setup['otpauthUrl']) ?>, width: 180, height: 180 });
                          } else {
                            document.getElementById('qrcode').remove();
                          }
                        </script>
                    <?php else: ?>
                        <p>Mit dem Zwei-Faktor-Schutz brauchst du beim Anmelden zusätzlich zum Passwort einen Code aus einer Authenticator-App auf deinem Handy.</p>
                        <form method="post">
                            <input type="hidden" name="aktion" value="starten">
                            <button type="submit" class="btn btn-primary">Zwei-Faktor-Schutz einrichten</button>
                            <a href="einstellungen.php" class="btn btn-outline-secondary ms-2">Zurück</a>
                        </form>
                    <?php endif; ?>
                </div>
            </div>
        </div>
    </div>
</div>
<?php include '../includes/footer.php'; ?>
