<?php
// Neues Passwort festlegen (#141): Link aus der Mail (?token=…) oder Code von Hand. Danach ist man auf allen Geräten
// abgemeldet und meldet sich mit dem neuen Passwort an (bei aktiver 2FA weiterhin mit Code).
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

$token = trim((string)($_POST['token'] ?? $_GET['token'] ?? ''));
$fehler = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $neu = (string)($_POST['password'] ?? '');
    $wiederholung = (string)($_POST['password_confirm'] ?? '');
    if ($token === '') {
        $fehler = 'Bitte den Code aus der Mail eingeben.';
    } elseif (strlen($neu) < 8) {
        $fehler = 'Das Passwort muss mindestens 8 Zeichen lang sein.';
    } elseif ($neu !== $wiederholung) {
        $fehler = 'Die Passwörter stimmen nicht überein.';
    } else {
        try {
            getApiClient(null)->postResetPassword($token, $neu);
            // Eine bestehende Sitzung in diesem Browser gehört zu einem jetzt widerrufenen Token
            clearApiToken();
            $_SESSION['success_message'] = 'Dein Passwort ist geändert. Du wurdest auf allen Geräten abgemeldet – bitte melde dich neu an.';
            header('Location: login.php');
            exit;
        } catch (Throwable $e) {
            $fehler = [
                'invalid_token' => 'Dieser Link ist ungültig oder wurde schon benutzt. Bitte fordere einen neuen an.',
                'token_expired' => 'Dieser Link ist abgelaufen (gültig eine Stunde). Bitte fordere einen neuen an.',
                'password_too_short' => 'Das Passwort muss mindestens 8 Zeichen lang sein.',
            ][$e->getMessage()] ?? 'Das hat gerade nicht geklappt. Bitte versuch es später noch einmal.';
        }
    }
}

include '../includes/header.php';
?>
<div class="container">
  <div class="row justify-content-center mt-5">
    <div class="col-md-6 col-lg-4">
      <div class="card shadow"><div class="card-body p-4">
        <h1 class="h4 mb-3"><i class="fas fa-key me-2 text-primary" aria-hidden="true"></i>Neues Passwort</h1>
        <?php if ($fehler): ?>
          <div class="alert alert-danger" role="alert"><?= htmlspecialchars($fehler) ?>
            <?php if (str_contains($fehler, 'neuen an')): ?><a href="passwort_vergessen.php" class="alert-link">Neuen Link anfordern</a><?php endif; ?>
          </div>
        <?php endif; ?>
        <form method="post">
          <?php if (isset($_GET['token']) && $_GET['token'] !== ''): ?>
            <input type="hidden" name="token" value="<?= htmlspecialchars($token) ?>">
          <?php else: ?>
            <label for="token" class="form-label">Code aus der Mail</label>
            <input type="text" class="form-control mb-3" id="token" name="token" value="<?= htmlspecialchars($token) ?>" autocomplete="one-time-code" spellcheck="false" required>
          <?php endif; ?>
          <label for="password" class="form-label">Neues Passwort</label>
          <input type="password" class="form-control mb-3" id="password" name="password" autocomplete="new-password" minlength="8" placeholder="Mindestens 8 Zeichen" required>
          <label for="password_confirm" class="form-label">Neues Passwort wiederholen</label>
          <input type="password" class="form-control mb-3" id="password_confirm" name="password_confirm" autocomplete="new-password" required>
          <button type="submit" class="btn btn-primary w-100">Passwort speichern</button>
        </form>
      </div></div>
    </div>
  </div>
</div>
<?php include '../includes/footer.php'; ?>
