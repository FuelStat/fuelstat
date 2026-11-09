<?php
// Einladungen zu geteilten Fahrzeugen (#53): annehmen oder ablehnen.
// Die API zeigt nur Einladungen an die eigene, bestätigte E-Mail-Adresse.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$api = getApiClient();
$fehler = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $id = (string)($_POST['einladung_id'] ?? '');
    $annehmen = ($_POST['aktion'] ?? '') === 'annehmen';
    try {
        $r = $api->postInvitationAnswer($id, $annehmen);
        if ($annehmen) {
            $_SESSION['success_message'] = 'Einladung angenommen. Das Fahrzeug steht jetzt in deiner Übersicht.';
            header('Location: fahrzeug_detail.php?id=' . urlencode((string)($r['vehicleId'] ?? '')));
        } else {
            $_SESSION['success_message'] = 'Einladung abgelehnt.';
            header('Location: einladungen.php');
        }
        exit;
    } catch (Throwable $e) {
        $fehler = tarifHinweis($e) ?? ([
            'invitation_not_found' => 'Diese Einladung gibt es nicht (mehr).',
            'invitation_expired' => 'Diese Einladung ist abgelaufen oder wurde schon beantwortet.',
        ][$e->getMessage()] ?? $e->getMessage());
    }
}

$einladungen = [];
try {
    $einladungen = $api->getInvitations();
} catch (Throwable $e) {
    $fehler = $fehler ?: 'Einladungen konnten nicht geladen werden.';
}
$rollenNamen = ['editor' => 'Mitfahrer: sehen und erfassen', 'viewer' => 'Nur ansehen'];

include '../includes/header.php';
?>
<div class="container">
  <div class="row justify-content-center mt-4">
    <div class="col-md-8 col-lg-6">
      <h1 class="h4 mb-3 d-none d-lg-block"><i class="fas fa-envelope-open me-2 text-primary" aria-hidden="true"></i>Einladungen</h1>
      <?php if ($fehler): ?><div class="alert alert-danger" role="alert"><?= htmlspecialchars($fehler) ?></div><?php endif; ?>
      <?php if (!$einladungen): ?>
        <div class="card border-0 shadow-sm"><div class="card-body text-body-secondary">Keine offenen Einladungen.
          <?php if (isset($currentUser['email_verified']) && !$currentUser['email_verified']): ?>
            Einladungen erscheinen hier, sobald du <a href="email_bestaetigen.php">deine E-Mail-Adresse bestätigt</a> hast.
          <?php endif; ?>
        </div></div>
      <?php endif; ?>
      <?php foreach ($einladungen as $inv): ?>
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-body">
            <h2 class="h6 mb-1"><i class="fas fa-car-side me-2 text-primary" aria-hidden="true"></i><?= htmlspecialchars((string)$inv['vehicle_name']) ?></h2>
            <p class="small text-body-secondary mb-3">Von <?= htmlspecialchars((string)($inv['invited_by_name'] ?? '')) ?> · <?= htmlspecialchars($rollenNamen[$inv['role']] ?? $inv['role']) ?> · gültig bis <?= date('d.m.Y', strtotime($inv['expires_at'])) ?></p>
            <form method="post" class="d-flex gap-2 m-0">
              <input type="hidden" name="einladung_id" value="<?= htmlspecialchars((string)$inv['id']) ?>">
              <button type="submit" name="aktion" value="annehmen" class="btn btn-primary"><i class="fas fa-check me-1"></i>Annehmen</button>
              <button type="submit" name="aktion" value="ablehnen" class="btn btn-outline-secondary">Ablehnen</button>
            </form>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
  </div>
</div>
<?php include '../includes/footer.php'; ?>
