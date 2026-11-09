<?php
// Passwort vergessen (#141): Link anfordern. Die Antwort ist immer gleich, egal ob es ein Konto mit der Adresse gibt.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

$fehler = '';
$gesendet = false;
$email = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim((string)($_POST['email'] ?? ''));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $fehler = 'Bitte eine gültige E-Mail-Adresse eingeben.';
    } else {
        try {
            getApiClient(null)->postForgotPassword($email);
            $gesendet = true;
        } catch (Throwable $e) {
            $fehler = [
                'mail_not_configured' => 'Auf dieser Installation ist kein Mailserver eingerichtet. Bitte wende dich an den Betreiber.',
                'too_many_requests' => 'Zu viele Anfragen. Bitte versuch es in 15 Minuten noch einmal.',
            ][$e->getMessage()] ?? ($e->getCode() === 429
                ? 'Zu viele Anfragen. Bitte versuch es in 15 Minuten noch einmal.'
                : 'Das hat gerade nicht geklappt. Bitte versuch es später noch einmal.');
        }
    }
}

include '../includes/header.php';
?>
<div class="container">
  <div class="row justify-content-center mt-5">
    <div class="col-md-6 col-lg-4">
      <div class="card shadow"><div class="card-body p-4">
        <h1 class="h4 mb-3"><i class="fas fa-key me-2 text-primary" aria-hidden="true"></i>Passwort vergessen</h1>
        <?php if ($gesendet): ?>
          <div class="alert alert-success" role="status">Wenn es ein Konto mit <strong><?= htmlspecialchars($email) ?></strong> gibt, haben wir dir einen Link zum Zurücksetzen geschickt. Er gilt eine Stunde. Bitte auch im Spam-Ordner nachsehen.</div>
          <a href="passwort_zuruecksetzen.php" class="btn btn-outline-secondary w-100 mb-2">Code aus der Mail eingeben</a>
          <a href="login.php" class="btn btn-link w-100">Zur Anmeldung</a>
        <?php else: ?>
          <?php if ($fehler): ?><div class="alert alert-danger" role="alert"><?= htmlspecialchars($fehler) ?></div><?php endif; ?>
          <p class="text-body-secondary small">Gib die E-Mail-Adresse deines Kontos ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.</p>
          <form method="post">
            <label for="email" class="form-label">E-Mail-Adresse</label>
            <input type="email" class="form-control mb-3" id="email" name="email" autocomplete="username" value="<?= htmlspecialchars($email) ?>" required>
            <button type="submit" class="btn btn-primary w-100">Link schicken</button>
          </form>
          <div class="text-center mt-3"><a href="login.php" class="small text-decoration-none">Zurück zur Anmeldung</a></div>
        <?php endif; ?>
      </div></div>
    </div>
  </div>
</div>
<?php include '../includes/footer.php'; ?>
