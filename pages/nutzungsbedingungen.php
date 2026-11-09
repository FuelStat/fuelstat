<?php
// Nutzungsbedingungen (#135). Angemeldete Konten, die der gültigen Fassung noch nicht zugestimmt haben, landen hier
// (Weiterleitung in includes/header.php) und stimmen unten zu. Die Version kommt aus der API (TERMS_VERSION).
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

$fassung = nutzungsbedingungenVersion();
$fehler = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isApiAuthenticated() && $fassung !== null) {
    if (empty($_POST['zustimmung'])) {
        $fehler = 'Bitte bestätige, dass du die Nutzungsbedingungen akzeptierst.';
    } else {
        try {
            getApiClient()->postAcceptTerms($fassung);
            $_SESSION['success_message'] = 'Danke! Du hast den Nutzungsbedingungen zugestimmt.';
            header('Location: ../index.php');
            exit;
        } catch (Throwable $e) {
            $fehler = 'Die Zustimmung konnte nicht gespeichert werden. Bitte lade die Seite neu und versuch es noch einmal.';
        }
    }
}

$b = require __DIR__ . '/../includes/betreiber.php';
include '../includes/header.php';
$terminStand = nutzungsbedingungenStand($fassung);
$zustimmenNoetig = $angemeldet && !empty($currentUser['terms']['required']);
?>
<div class="container">
  <div class="row justify-content-center mt-4">
    <div class="col-lg-9">
      <h1 class="h3 mb-3">Nutzungsbedingungen</h1>
      <?php if ($zustimmenNoetig): ?>
        <div class="alert alert-info" role="status">
          <?= empty($currentUser['terms']['accepted_version']) ? 'Bitte lies die Nutzungsbedingungen und stimme ihnen unten zu, um Fuelstat weiter zu nutzen.' : 'Die Nutzungsbedingungen haben sich geändert. Bitte lies die neue Fassung und stimme ihr unten zu, um Fuelstat weiter zu nutzen.' ?>
        </div>
      <?php endif; ?>
      <?php if ($fehler): ?><div class="alert alert-danger" role="alert"><?= htmlspecialchars($fehler) ?></div><?php endif; ?>
      <div class="card border-0 shadow-sm"><div class="card-body p-4 rechtstext">
        <?php include __DIR__ . '/../includes/nutzungsbedingungen_text.php'; ?>
      </div></div>

      <?php if ($zustimmenNoetig): ?>
      <form method="post" class="card border-0 shadow-sm mt-3 mb-4"><div class="card-body">
        <div class="form-check mb-3">
          <input class="form-check-input" type="checkbox" id="zustimmung" name="zustimmung" value="1" required>
          <label class="form-check-label" for="zustimmung">Ich akzeptiere die Nutzungsbedingungen (Stand: <?= htmlspecialchars($terminStand) ?>).</label>
        </div>
        <p class="small text-body-secondary">Wie wir deine Daten verarbeiten, steht in der <a href="datenschutz.php">Datenschutzerklärung</a>. Wenn du nicht zustimmen möchtest, kannst du dein Konto unter <a href="einstellungen.php">Profil</a> löschen.</p>
        <button type="submit" class="btn btn-primary"><i class="fas fa-check me-1"></i>Zustimmen und weiter</button>
      </div></form>
      <?php endif; ?>
    </div>
  </div>
</div>
<?php include '../includes/footer.php'; ?>
