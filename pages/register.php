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

        // Honigtopf gegen Formular-Roboter (#198): Das Feld ist für Menschen unsichtbar. Gefüllt: dieselbe Rückmeldung wie
        // bei einer echten Registrierung, aber keine Anfrage an die API.
        if (trim((string)($_POST['hp_kontrolle'] ?? '')) !== '') {
            $_SESSION['success_message'] = 'Fast geschafft! Wir haben dir eine Mail geschickt. Öffne den Link darin und gib dein Passwort ein, dann legen wir dein Konto an. Der Link gilt 7 Tage.';
            header('Location: login.php');
            exit;
        }
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
                // Mit Mailserver (#141): Das Konto entsteht erst mit dem Link aus der Mail. Die Antwort ist für jede Adresse
                // gleich, auch für eine schon registrierte (deren Inhaber bekommt stattdessen einen Hinweis per Mail).
                $_SESSION['success_message'] = !empty($response['verificationRequired'])
                    ? 'Fast geschafft! Wir haben dir eine Mail geschickt. Öffne den Link darin und gib dein Passwort ein, dann legen wir dein Konto an. Der Link gilt 7 Tage.'
                    : 'Registrierung erfolgreich! Du kannst dich jetzt anmelden.';
                header('Location: login.php');
                exit;
            } catch (RuntimeException $e) {
                $msg = $e->getMessage();
                if (strpos($msg, 'email_already_exists') !== false || $e->getCode() === 409) {
                    $error = "Diese E-Mail-Adresse ist bereits registriert.";
                } elseif ($msg === 'too_many_requests' || $e->getCode() === 429) {
                    $error = 'Von diesem Anschluss kamen gerade sehr viele Registrierungen. Bitte versuch es später noch einmal.';
                } elseif ($msg === 'registration_disabled') {
                    $error = "Die Registrierung neuer Konten ist auf dieser Installation deaktiviert.";
                } else {
                    $error = fehlerText($e);
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
                        <!-- Honigtopf (#198): für Menschen unsichtbar, Roboter füllen es aus -->
                        <div class="visually-hidden" aria-hidden="true">
                            <label for="hp_kontrolle">Dieses Feld leer lassen</label>
                            <input type="text" id="hp_kontrolle" name="hp_kontrolle" tabindex="-1" autocomplete="off" data-1p-ignore data-lpignore="true">
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
