<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $aktuell = $_POST['current_password'] ?? '';
    $neu = $_POST['new_password'] ?? '';
    $wiederholung = $_POST['new_password_confirm'] ?? '';

    if ($aktuell === '' || $neu === '') {
        $error = 'Bitte alle Felder ausfüllen.';
    } elseif (strlen($neu) < 8) {
        $error = 'Das neue Passwort muss mindestens 8 Zeichen lang sein.';
    } elseif ($neu !== $wiederholung) {
        $error = 'Die neuen Passwörter stimmen nicht überein.';
    } else {
        try {
            $result = getApiClient()->postAuthPassword($aktuell, $neu);
            // Alle alten Tokens sind widerrufen: neues Token übernehmen
            setApiToken($result['token']);
            $_SESSION['success_message'] = 'Passwort geändert. Andere Geräte wurden abgemeldet.';
            header('Location: einstellungen.php');
            exit;
        } catch (Throwable $e) {
            $error = [
                'invalid_current_password' => 'Das aktuelle Passwort ist falsch.',
                'too_many_attempts' => 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.',
            ][$e->getMessage()] ?? fehlerText($e);
        }
    }
}

include '../includes/header.php';
?>
<div class="container">
    <div class="row justify-content-center mt-5">
        <div class="col-md-8 col-lg-6">
            <div class="card shadow">
                <div class="card-body p-4">
                    <h3 class="h4 mb-4"><i class="fas fa-key me-2 text-primary"></i>Passwort ändern</h3>
                    <?php if ($error): ?>
                        <div class="alert alert-danger"><?= htmlspecialchars($error) ?></div>
                    <?php endif; ?>
                    <form method="post">
                        <div class="mb-3">
                            <label for="current_password" class="form-label">Aktuelles Passwort</label>
                            <input type="password" class="form-control" id="current_password" name="current_password" autocomplete="current-password" required>
                        </div>
                        <div class="mb-3">
                            <label for="new_password" class="form-label">Neues Passwort</label>
                            <input type="password" class="form-control" id="new_password" name="new_password" autocomplete="new-password" minlength="8" required>
                            <div class="form-text">Mindestens 8 Zeichen.</div>
                        </div>
                        <div class="mb-4">
                            <label for="new_password_confirm" class="form-label">Neues Passwort wiederholen</label>
                            <input type="password" class="form-control" id="new_password_confirm" name="new_password_confirm" autocomplete="new-password" minlength="8" required>
                        </div>
                        <div class="d-grid gap-2">
                            <button type="submit" class="btn btn-primary"><i class="fas fa-save me-2"></i>Passwort ändern</button>
                            <a href="einstellungen.php" class="btn btn-outline-secondary">Abbrechen</a>
                        </div>
                    </form>
                    <p class="text-muted small mt-3 mb-0">Nach der Änderung werden alle anderen Geräte abgemeldet.</p>
                </div>
            </div>
        </div>
    </div>
</div>
<?php include '../includes/footer.php'; ?>
