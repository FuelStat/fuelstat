<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';

if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}

$api = getApiClient();
$error = '';
$user = ['email' => $_SESSION['user_email'] ?? '', 'username' => '', 'profile_image_url' => null, 'mfa_enabled' => false];

try {
    $user = array_merge($user, $api->getWhoAmI());
} catch (Throwable $e) {
    error_log('[Einstellungen] getWhoAmI failed: ' . $e->getMessage());
}
$userId = $user['id'] ?? ($_SESSION['user_id'] ?? '');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $aktion = $_POST['aktion'] ?? 'profil';
    try {
        if ($aktion === 'profil') {
            $email = trim($_POST['email'] ?? '');
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new RuntimeException('Bitte eine gültige E-Mail-Adresse angeben.');
            }
            $daten = ['email' => $email, 'username' => trim($_POST['username'] ?? '')];

            $bild = $_FILES['profilbild'] ?? null;
            if ($bild && $bild['error'] !== UPLOAD_ERR_NO_FILE) {
                if ($bild['error'] !== UPLOAD_ERR_OK) {
                    throw new RuntimeException('Das Profilbild konnte nicht hochgeladen werden (zu groß?).');
                }
                $mime = (new finfo(FILEINFO_MIME_TYPE))->file($bild['tmp_name']) ?: '';
                if (!in_array($mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true)) {
                    throw new RuntimeException('Nur JPEG, PNG, GIF und WebP sind als Bild erlaubt.');
                }
                $media = $api->uploadUserMedia($bild['tmp_name'], $mime, basename((string)$bild['name']));
                $daten['profileImageUrl'] = $media['url'];
            } elseif (!empty($_POST['profilbild_entfernen'])) {
                $daten['profileImageUrl'] = null;
            }

            $user = array_merge($user, $api->patchUser($userId, $daten));
            $_SESSION['user_email'] = $user['email'];
            $_SESSION['success_message'] = !empty($user['pending_email']) && ($daten['email'] ?? '') === $user['pending_email']
                ? 'Profil gespeichert. Wir haben einen Bestätigungslink an ' . $user['pending_email'] . ' geschickt; bis du ihn öffnest, gilt deine bisherige Adresse.'
                : 'Profil gespeichert.';
        } elseif ($aktion === 'alle_abmelden') {
            $api->revokeAllTokens($userId);
            // Auch das eigene Token ist jetzt ungültig: lokal abmelden
            clearApiToken();
            $_SESSION['success_message'] = 'Du wurdest auf allen Geräten abgemeldet.';
            header('Location: login.php');
            exit;
        } elseif ($aktion === 'konto_loeschen') {
            if (trim($_POST['bestaetigung'] ?? '') !== 'LÖSCHEN') {
                throw new RuntimeException('Bitte zur Bestätigung LÖSCHEN eingeben.');
            }
            $api->deleteUser($userId);
            clearApiToken();
            $_SESSION['success_message'] = 'Dein Konto und alle Daten wurden gelöscht.';
            header('Location: login.php');
            exit;
        }
        header('Location: einstellungen.php');
        exit;
    } catch (Throwable $e) {
        $error = $e->getMessage() === 'email_already_exists'
            ? 'Diese E-Mail-Adresse wird bereits verwendet.'
            : (tarifHinweis($e) ?? $e->getMessage());
    }
}

include '../includes/header.php';
?>

<div class="container">
    <div class="row justify-content-center mt-5">
        <div class="col-md-10 col-lg-8">
            <?php if ($error): ?>
                <div class="alert alert-danger"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>

            <div class="card shadow mb-4">
                <div class="card-body p-4">
                    <h3 class="h4 mb-4"><i class="fas fa-user-edit me-2 text-primary"></i>Profil</h3>
                    <form method="post" enctype="multipart/form-data">
                        <input type="hidden" name="aktion" value="profil">
                        <div class="d-flex align-items-center mb-3">
                            <?php if (!empty($user['profile_image_url'])): ?>
                                <img src="<?= htmlspecialchars(fahrzeugBildUrl(['image_url' => $user['profile_image_url']], $baseUrl)) ?>" alt="Profilbild" class="rounded-circle me-3" style="width:64px;height:64px;object-fit:cover">
                            <?php else: ?>
                                <i class="fas fa-user-circle fa-4x text-secondary me-3"></i>
                            <?php endif; ?>
                            <div class="flex-grow-1">
                                <label for="profilbild" class="form-label mb-1">Profilbild</label>
                                <input type="file" class="form-control" id="profilbild" name="profilbild" accept="image/jpeg,image/png,image/gif,image/webp">
                                <?php if (!empty($user['profile_image_url'])): ?>
                                    <div class="form-check mt-1">
                                        <input class="form-check-input" type="checkbox" id="profilbild_entfernen" name="profilbild_entfernen" value="1">
                                        <label class="form-check-label" for="profilbild_entfernen">Profilbild entfernen</label>
                                    </div>
                                <?php endif; ?>
                            </div>
                        </div>
                        <div class="mb-3">
                            <label for="username" class="form-label">Benutzername</label>
                            <input type="text" class="form-control" id="username" name="username" value="<?= htmlspecialchars($user['username'] ?? '') ?>" placeholder="optional">
                        </div>
                        <div class="mb-4">
                            <label for="email" class="form-label">E-Mail-Adresse</label>
                            <input type="email" class="form-control" id="email" name="email" value="<?= htmlspecialchars($user['email'] ?? '') ?>" required>
                            <?php if (!empty($user['pending_email'])): ?>
                                <div class="form-text">Neue Adresse <strong><?= htmlspecialchars($user['pending_email']) ?></strong> wartet auf Bestätigung. <a href="email_bestaetigen.php">Link erneut senden oder Code eingeben</a></div>
                            <?php elseif (isset($user['email_verified']) && !$user['email_verified']): ?>
                                <div class="form-text text-warning-emphasis">Noch nicht bestätigt. <a href="email_bestaetigen.php">E-Mail bestätigen</a></div>
                            <?php endif; ?>
                        </div>
                        <button type="submit" class="btn btn-primary"><i class="fas fa-save me-2"></i>Speichern</button>
                    </form>
                </div>
            </div>

            <div class="card shadow mb-4">
                <div class="card-body p-4">
                    <h3 class="h4 mb-3"><i class="fas fa-lock me-2 text-primary"></i>Sicherheit</h3>
                    <div class="d-flex flex-wrap gap-2 mb-3">
                        <a href="passwort_aendern.php" class="btn btn-outline-primary"><i class="fas fa-key me-2"></i>Passwort ändern</a>
                        <a href="mfa_einrichten.php" class="btn btn-outline-primary"><i class="fas fa-shield-alt me-2"></i>2FA <?= !empty($user['mfa_enabled']) ? 'verwalten' : 'einrichten' ?></a>
                        <a href="benachrichtigungen.php" class="btn btn-outline-primary"><i class="fas fa-envelope me-2"></i>E-Mail-Benachrichtigungen</a>
                    </div>
                    <p class="mb-2">2FA ist <strong><?= !empty($user['mfa_enabled']) ? 'aktiv' : 'nicht aktiv' ?></strong>.</p>
                    <form method="post" onsubmit="return confirm('Wirklich auf allen Geräten abmelden, auch hier?');">
                        <input type="hidden" name="aktion" value="alle_abmelden">
                        <button type="submit" class="btn btn-outline-secondary"><i class="fas fa-sign-out-alt me-2"></i>Auf allen Geräten abmelden</button>
                    </form>
                </div>
            </div>

            <div class="card shadow border-danger mb-4">
                <div class="card-body p-4">
                    <h3 class="h4 mb-3 text-danger"><i class="fas fa-trash me-2"></i>Konto löschen</h3>
                    <p>Löscht dein Konto mit allen Fahrzeugen, Tank- und Ladevorgängen und Ausgaben endgültig.</p>
                    <form method="post" onsubmit="return confirm('Konto und alle Daten endgültig löschen?');">
                        <input type="hidden" name="aktion" value="konto_loeschen">
                        <div class="mb-3">
                            <label for="bestaetigung" class="form-label">Zur Bestätigung <strong>LÖSCHEN</strong> eingeben</label>
                            <input type="text" class="form-control" id="bestaetigung" name="bestaetigung" autocomplete="off" required>
                        </div>
                        <button type="submit" class="btn btn-danger">Konto endgültig löschen</button>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<?php include '../includes/footer.php'; ?>
