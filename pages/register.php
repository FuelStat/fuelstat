<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
ob_start();

$error = '';
// Nutzungsbedingungen (#135): Pflicht-Checkbox, wenn die API eine Fassung vorgibt (TERMS_VERSION)
$termsVersion = nutzungsbedingungenVersion();

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $email = trim($_POST['email'] ?? '');
        $password = $_POST['password'] ?? '';
        $password_confirm = $_POST['password_confirm'] ?? '';

        if ($email === '' || $password === '') {
            $error = "Bitte alle Felder ausfüllen.";
        } elseif ($password !== $password_confirm) {
            $error = "Die Passwörter stimmen nicht überein.";
        } elseif (strlen($password) < 8) {
            $error = "Das Passwort muss mindestens 8 Zeichen lang sein.";
        } elseif ($termsVersion !== null && empty($_POST['nutzungsbedingungen'])) {
            $error = 'Bitte akzeptiere die Nutzungsbedingungen.';
        } else {
            try {
                $apiRegister = getApiClient(null);
                $response = $apiRegister->postAuthRegister($email, $password, $termsVersion);
                $_SESSION['success_message'] = isset($response['user']['email_verified']) && !$response['user']['email_verified']
                    ? 'Registrierung erfolgreich! Wir haben dir einen Link zum Bestätigen deiner E-Mail-Adresse geschickt. Du kannst dich schon anmelden; ein Fahrzeug und ein Eintrag gehen sofort, alles Weitere nach der Bestätigung.'
                    : 'Registrierung erfolgreich! Sie können sich jetzt anmelden.';
                header('Location: login.php');
                exit;
            } catch (RuntimeException $e) {
                $msg = $e->getMessage();
                if (strpos($msg, 'email_already_exists') !== false || $e->getCode() === 409) {
                    $error = "Diese E-Mail-Adresse ist bereits registriert.";
                } elseif ($msg === 'registration_disabled') {
                    $error = "Die Registrierung neuer Konten ist auf dieser Installation deaktiviert.";
                } else {
                    $error = $msg;
                }
            }
        }
    }

    include '../includes/header.php';
} catch (Exception $e) {
    error_log("Fehler in register.php: " . $e->getMessage());
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
                        <h1 class="mt-3 mb-1">Konto erstellen</h1>
                        <p class="text-body-secondary mb-0">In einer Minute startklar.</p>
                    </div>

                    <?php if ($error !== ''): ?>
                        <div class="alert alert-danger" role="alert"><?= htmlspecialchars($error) ?></div>
                    <?php endif; ?>

                    <form method="post">
                        <div class="mb-3">
                            <label for="email" class="form-label">E-Mail-Adresse</label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="fas fa-envelope"></i></span>
                                <input type="email" class="form-control" id="email" name="email"
                                       placeholder="name@example.de" required>
                            </div>
                        </div>
                        <div class="mb-3">
                            <label for="password" class="form-label">Passwort</label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="fas fa-lock"></i></span>
                                <input type="password" class="form-control" id="password" name="password"
                                       placeholder="Mindestens 8 Zeichen" required minlength="8">
                            </div>
                        </div>
                        <div class="mb-4">
                            <label for="password_confirm" class="form-label">Passwort bestätigen</label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="fas fa-lock"></i></span>
                                <input type="password" class="form-control" id="password_confirm" name="password_confirm"
                                       placeholder="Passwort wiederholen" required>
                            </div>
                        </div>
                        <?php if ($termsVersion !== null): ?>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="nutzungsbedingungen" name="nutzungsbedingungen" value="1" required>
                            <label class="form-check-label" for="nutzungsbedingungen">Ich akzeptiere die <a href="nutzungsbedingungen.php" target="_blank" rel="noopener">Nutzungsbedingungen</a>.</label>
                        </div>
                        <?php endif; ?>
                        <p class="small text-body-secondary mb-4">Wie wir deine Daten verarbeiten, steht in der <a href="datenschutz.php" target="_blank" rel="noopener">Datenschutzerklärung</a>.</p>
                        <div class="d-grid">
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-user-plus me-2"></i> Registrieren
                            </button>
                        </div>
                    </form>

                    <div class="text-center mt-4">
                        <p class="text-muted mb-0">
                            Bereits registriert?
                            <a href="login.php" class="text-decoration-none">Jetzt anmelden</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<?php include '../includes/footer.php'; ?>
