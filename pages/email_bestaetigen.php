<?php
// E-Mail-Adresse bestätigen (#135): Link aus der Mail (?token=…), Code von Hand eingeben, Mail erneut senden.
// Der Link funktioniert auch ohne Anmeldung (z. B. auf einem anderen Gerät geöffnet): Das Token selbst ist der Nachweis.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

$fehler = '';
$erfolg = '';
$angemeldetHier = isApiAuthenticated();

$bestaetigen = function (string $token) use (&$fehler, &$erfolg): void {
    try {
        $r = getApiClient(null)->postVerifyEmail($token);
        $erfolg = 'Danke! Die E-Mail-Adresse ' . ($r['email'] ?? '') . ' ist bestätigt.';
    } catch (Throwable $e) {
        $fehler = [
            'invalid_token' => 'Dieser Link ist ungültig oder wurde schon benutzt. Bitte fordere einen neuen an.',
            'token_expired' => 'Dieser Link ist abgelaufen (gültig 24 Stunden). Bitte fordere einen neuen an.',
            'email_already_exists' => 'Diese E-Mail-Adresse gehört inzwischen zu einem anderen Konto.',
        ][$e->getMessage()] ?? 'Die Bestätigung hat nicht geklappt. Bitte versuch es später noch einmal.';
    }
};

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['token']) && is_string($_GET['token']) && $_GET['token'] !== '') {
    $bestaetigen(trim($_GET['token']));
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $aktion = $_POST['aktion'] ?? '';
    if ($aktion === 'code') {
        $code = trim((string)($_POST['code'] ?? ''));
        if ($code === '') {
            $fehler = 'Bitte den Code aus der Mail eingeben.';
        } else {
            $bestaetigen($code);
        }
    } elseif ($aktion === 'erneut' && $angemeldetHier) {
        try {
            $r = getApiClient()->postResendVerification();
            $erfolg = 'Wir haben einen neuen Link an ' . ($r['email'] ?? 'deine Adresse') . ' geschickt. Er gilt 24 Stunden.';
        } catch (Throwable $e) {
            $fehler = [
                'resend_too_soon' => 'Die letzte Mail ist gerade erst rausgegangen. Bitte warte eine Minute.',
                'too_many_attempts' => 'Heute wurden schon mehrere Mails verschickt. Bitte versuch es morgen noch einmal.',
                'already_verified' => 'Deine E-Mail-Adresse ist bereits bestätigt.',
                'mail_not_configured' => 'Auf dieser Installation ist kein Mailserver eingerichtet.',
                'smtp_failed' => 'Die Mail konnte gerade nicht verschickt werden. Bitte später noch einmal versuchen.',
            ][$e->getMessage()] ?? 'Die Mail konnte nicht verschickt werden.';
        }
    }
}

include '../includes/header.php';
?>
<div class="container">
  <div class="row justify-content-center mt-4">
    <div class="col-md-8 col-lg-6">
      <div class="card shadow">
        <div class="card-body p-4">
          <h1 class="h4 mb-3"><i class="fas fa-envelope-open-text me-2 text-primary" aria-hidden="true"></i>E-Mail bestätigen</h1>
          <?php if ($erfolg): ?>
            <div class="alert alert-success" role="status"><?= htmlspecialchars($erfolg) ?></div>
          <?php endif; ?>
          <?php if ($fehler): ?>
            <div class="alert alert-danger" role="alert"><?= htmlspecialchars($fehler) ?></div>
          <?php endif; ?>

          <?php if ($erfolg && !isset($_POST['aktion'])): ?>
            <a class="btn btn-primary" href="<?= htmlspecialchars($baseUrl) ?><?= $angemeldetHier ? 'index.php' : 'pages/login.php' ?>"><?= $angemeldetHier ? 'Weiter zu Fuelstat' : 'Zur Anmeldung' ?></a>
          <?php else: ?>
            <p class="text-body-secondary">Wir haben dir eine Mail mit einem Link geschickt. Öffne den Link oder gib den Code aus der Mail hier ein.</p>
            <form method="post" class="mb-4">
              <input type="hidden" name="aktion" value="code">
              <label for="code" class="form-label">Code aus der Mail</label>
              <div class="input-group">
                <input type="text" class="form-control" id="code" name="code" autocomplete="one-time-code" spellcheck="false" required>
                <button type="submit" class="btn btn-primary">Bestätigen</button>
              </div>
            </form>
            <?php if ($angemeldetHier): ?>
              <form method="post">
                <input type="hidden" name="aktion" value="erneut">
                <button type="submit" class="btn btn-outline-secondary"><i class="fas fa-paper-plane me-2" aria-hidden="true"></i>Mail erneut senden</button>
                <div class="form-text">Keine Mail bekommen? Bitte auch im Spam-Ordner nachsehen.</div>
              </form>
            <?php endif; ?>
          <?php endif; ?>
        </div>
      </div>
    </div>
  </div>
</div>
<?php include '../includes/footer.php'; ?>
