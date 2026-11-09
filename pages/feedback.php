<?php
// Feedback senden (Beta): Fehler, Ideen, Lob – landet in der API und per Mail beim Betreiber
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}

$arten = [
    'fehler' => ['fa-bug', 'Fehler', 'Etwas funktioniert nicht oder sieht falsch aus'],
    'idee' => ['fa-lightbulb', 'Idee', 'Ein Wunsch oder Verbesserungsvorschlag'],
    'lob' => ['fa-heart', 'Lob', 'Was dir gut gefällt'],
    'sonstiges' => ['fa-comment', 'Sonstiges', 'Alles andere'],
];

// Seite, von der aus das Feedback kommt (nur interne Pfade)
$von = (string)($_POST['von'] ?? $_GET['von'] ?? '');
if ($von !== '' && (!str_starts_with($von, '/') || str_starts_with($von, '//') || strlen($von) > 300)) {
    $von = '';
}

$error = '';
$art = $_POST['art'] ?? ($_GET['art'] ?? 'fehler');
$nachricht = trim($_POST['nachricht'] ?? '');
if (!isset($arten[$art])) {
    $art = 'fehler';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (mb_strlen($nachricht) < 3) {
        $error = 'Bitte schreib kurz, worum es geht.';
    } elseif (mb_strlen($nachricht) > 5000) {
        $error = 'Die Nachricht ist zu lang (höchstens 5.000 Zeichen).';
    } else {
        try {
            getApiClient()->postFeedback($art, $nachricht, $von !== '' ? $von : null);
            header('Location: feedback.php?danke=1');
            exit;
        } catch (Throwable $e) {
            $error = tarifHinweis($e) ?? ($e->getMessage() === 'too_many_attempts'
                ? 'Du hast gerade sehr viel Feedback geschickt. Bitte versuch es in 15 Minuten noch einmal.'
                : 'Das Feedback konnte nicht gesendet werden. Bitte versuch es später noch einmal.');
        }
    }
}

include '../includes/header.php';
?>
<div class="container">
    <div class="row justify-content-center mt-3 mt-lg-5">
        <div class="col-md-10 col-lg-7">
            <?php if (!empty($_GET['danke'])): ?>
                <div class="card border-0 shadow-sm text-center">
                    <div class="card-body p-5">
                        <i class="fas fa-circle-check fa-3x text-success mb-3"></i>
                        <h1 class="h4">Danke für dein Feedback!</h1>
                        <p class="text-body-secondary mb-4">Es ist angekommen. Wenn es Rückfragen gibt, melde ich mich per E-Mail bei dir.</p>
                        <div class="d-flex flex-column flex-sm-row justify-content-center gap-2">
                            <a href="../index.php" class="btn btn-primary">Zur Übersicht</a>
                            <a href="feedback.php" class="btn btn-outline-secondary">Weiteres Feedback senden</a>
                        </div>
                    </div>
                </div>
            <?php else: ?>
                <div class="card border-0 shadow-sm">
                    <div class="card-body p-4">
                        <h1 class="h4 mb-2"><i class="fas fa-comment-dots me-2 text-primary"></i>Feedback senden</h1>
                        <p class="text-body-secondary">
                            <?php if (istBetaPhase()): ?>Fuelstat ist in der Beta-Phase. <?php endif; ?>
                            Jeder Hinweis hilft: Fehler, Ideen oder einfach, was dir gefällt. Deine Nachricht geht direkt an den Entwickler, Antworten kommen an deine E-Mail-Adresse.
                        </p>
                        <?php if ($error): ?>
                            <div class="alert alert-danger"><?= htmlspecialchars($error) ?></div>
                        <?php endif; ?>
                        <form method="post">
                            <input type="hidden" name="von" value="<?= htmlspecialchars($von) ?>">
                            <div class="row g-2 mb-3" role="radiogroup" aria-label="Art des Feedbacks">
                                <?php foreach ($arten as $schluessel => [$icon, $titel, $hinweis]): ?>
                                <div class="col-6 col-md-3">
                                    <input type="radio" class="btn-check" name="art" id="art-<?= $schluessel ?>" value="<?= $schluessel ?>" <?= $art === $schluessel ? 'checked' : '' ?>>
                                    <label class="btn btn-outline-primary w-100 h-100 py-3 feedback-art" for="art-<?= $schluessel ?>" title="<?= htmlspecialchars($hinweis) ?>">
                                        <i class="fas <?= $icon ?> d-block fs-4 mb-1"></i><?= $titel ?>
                                    </label>
                                </div>
                                <?php endforeach; ?>
                            </div>
                            <div class="mb-3">
                                <label for="nachricht" class="form-label">Deine Nachricht</label>
                                <textarea class="form-control" id="nachricht" name="nachricht" rows="6" maxlength="5000" required
                                          placeholder="Was ist passiert, was hast du erwartet? Bei Fehlern hilft: Auf welcher Seite, mit welchem Gerät?"><?= htmlspecialchars($nachricht) ?></textarea>
                            </div>
                            <?php if ($von !== ''): ?>
                                <p class="small text-body-secondary"><i class="fas fa-link me-1"></i>Wird mitgeschickt: die Seite, von der du kommst (<?= htmlspecialchars(strtok($von, '?')) ?>), und dein Browser.</p>
                            <?php endif; ?>
                            <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane me-2"></i>Feedback senden</button>
                        </form>
                    </div>
                </div>
            <?php endif; ?>
        </div>
    </div>
</div>
<?php include '../includes/footer.php'; ?>
