<?php
// Passkeys verwalten (#2): Liste, umbenennen, entfernen; neuer Passkey per Skript (js/passkey.js, WebAuthn).
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}

$api = getApiClient();
$error = '';
$meldungen = [
    'passkey_not_found' => 'Diesen Passkey gibt es nicht mehr.',
    'invalid_name' => 'Bitte einen Namen eingeben.',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $aktion = (string)($_POST['aktion'] ?? '');
    $id = (string)($_POST['id'] ?? '');
    try {
        if ($aktion === 'umbenennen') {
            $api->patchPasskey($id, trim((string)($_POST['name'] ?? '')));
            $_SESSION['success_message'] = 'Passkey umbenannt.';
        } elseif ($aktion === 'entfernen') {
            $api->deletePasskey($id);
            $_SESSION['success_message'] = 'Passkey entfernt. Lösche ihn auch auf dem Gerät bzw. im Passwort-Manager, damit er dort nicht mehr angeboten wird.';
        }
        header('Location: passkeys.php', true, 303);
        exit;
    } catch (Throwable $e) {
        $error = $meldungen[$e->getMessage()] ?? $e->getMessage();
    }
}

$aktiv = passkeysAktiv();
$liste = [];
try {
    $liste = $api->getPasskeys();
} catch (Throwable $e) {
    $error = $error ?: $e->getMessage();
}

$datum = function (?string $wert): string {
    return $wert ? (new DateTime($wert))->setTimezone(new DateTimeZone('Europe/Berlin'))->format('d.m.Y') : '–';
};

include '../includes/header.php';
?>
<div class="container">
    <div class="row justify-content-center mt-5">
        <div class="col-md-8 col-lg-6">
            <div class="card shadow">
                <div class="card-body p-4">
                    <h1 class="h4 mb-3"><i class="fas fa-fingerprint me-2 text-primary" aria-hidden="true"></i>Passkeys</h1>
                    <p>Mit einem Passkey meldest du dich per Face ID, Fingerabdruck, Windows Hello oder Sicherheitsschlüssel an – ohne Passwort und ohne 2FA-Code. Dein Passwort bleibt als Rückfallweg.</p>
                    <p class="fs-label">Fuelstat speichert nur den öffentlichen Schlüssel. Der private Schlüssel bleibt auf deinem Gerät bzw. in deinem Passwort-Manager (z. B. iCloud-Schlüsselbund, Google, 1Password).</p>

                    <?php if (isset($_SESSION['success_message'])): ?>
                        <div class="alert alert-success" role="status"><?= htmlspecialchars($_SESSION['success_message']) ?></div>
                        <?php unset($_SESSION['success_message']); ?>
                    <?php endif; ?>
                    <?php if ($error !== ''): ?>
                        <div class="alert alert-danger" role="alert"><?= htmlspecialchars($error) ?></div>
                    <?php endif; ?>

                    <h2 class="h6 mt-4 mb-2">Deine Passkeys</h2>
                    <?php if (!$liste): ?>
                        <p class="fs-label mb-3">Noch kein Passkey eingerichtet.</p>
                    <?php else: ?>
                    <ul class="list-group mb-3">
                        <?php foreach ($liste as $p):
                            $name = (string)($p['name'] ?? 'Passkey');
                            $info = array_filter([
                                !empty($p['backed_up']) ? 'synchronisiert' : 'nur auf einem Gerät',
                                'eingerichtet ' . $datum($p['created_at'] ?? null),
                                'zuletzt genutzt ' . $datum($p['last_used_at'] ?? null),
                            ]); ?>
                        <li class="list-group-item">
                            <div class="d-flex align-items-center gap-3">
                                <i class="fas fa-key fa-fw" aria-hidden="true"></i>
                                <div class="flex-grow-1 min-w-0">
                                    <div class="text-truncate"><?= htmlspecialchars($name) ?></div>
                                    <div class="fs-label"><?= htmlspecialchars(implode(' · ', $info)) ?></div>
                                </div>
                                <form method="post" class="flex-shrink-0" onsubmit="return confirm('Diesen Passkey entfernen? Du kannst dich damit dann nicht mehr anmelden.');">
                                    <input type="hidden" name="aktion" value="entfernen">
                                    <input type="hidden" name="id" value="<?= htmlspecialchars((string)$p['id']) ?>">
                                    <button type="submit" class="btn btn-sm btn-secondary" aria-label="<?= htmlspecialchars('„' . $name . '“ entfernen') ?>">Entfernen</button>
                                </form>
                            </div>
                            <details class="mt-2">
                                <summary class="fs-label">Umbenennen</summary>
                                <form method="post" class="d-flex gap-2 mt-2">
                                    <input type="hidden" name="aktion" value="umbenennen">
                                    <input type="hidden" name="id" value="<?= htmlspecialchars((string)$p['id']) ?>">
                                    <label class="visually-hidden" for="name-<?= htmlspecialchars((string)$p['id']) ?>">Neuer Name</label>
                                    <input type="text" class="form-control form-control-sm" id="name-<?= htmlspecialchars((string)$p['id']) ?>" name="name" maxlength="100" value="<?= htmlspecialchars($name) ?>" required>
                                    <button type="submit" class="btn btn-sm btn-outline-primary">Speichern</button>
                                </form>
                            </details>
                        </li>
                        <?php endforeach; ?>
                    </ul>
                    <?php endif; ?>

                    <h2 class="h6 mt-4 mb-2">Passkey hinzufügen</h2>
                    <?php if (!$aktiv): ?>
                        <p class="fs-label mb-0">Auf diesem Server sind Passkeys nicht eingerichtet (sie brauchen eine HTTPS-Adresse).</p>
                    <?php else: ?>
                        <p class="fs-label" data-passkey-nicht-unterstuetzt>Dieser Browser unterstützt keine Passkeys.</p>
                        <form id="passkeyAnlegen" class="d-none" data-passkey-unterstuetzt data-csrf="<?= htmlspecialchars(csrfToken()) ?>">
                            <div class="mb-3">
                                <label for="passkeyName" class="form-label">Name</label>
                                <input type="text" class="form-control" id="passkeyName" name="name" maxlength="100" placeholder="z. B. iPhone, MacBook, YubiKey">
                                <div class="form-text">Damit du ihn in der Liste wiedererkennst.</div>
                            </div>
                            <div class="mb-3">
                                <label for="passkeyPasswort" class="form-label">Aktuelles Passwort</label>
                                <input type="password" class="form-control" id="passkeyPasswort" name="passwort" autocomplete="current-password" required>
                                <div class="form-text">Zur Sicherheit, weil ein Passkey Passwort und 2FA ersetzt.</div>
                            </div>
                            <div id="passkeyAnlegenMeldung" class="alert alert-danger d-none" role="alert"></div>
                            <button type="submit" class="btn btn-primary"><i class="fas fa-plus me-2" aria-hidden="true"></i>Passkey hinzufügen</button>
                        </form>
                    <?php endif; ?>
                    <div class="mt-4"><a href="einstellungen.php" class="btn btn-outline-secondary">Zurück</a></div>
                </div>
            </div>
        </div>
    </div>
</div>
<?php if ($aktiv): ?>
<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'vendor/simplewebauthn/simplewebauthn-browser.umd.min.js')) ?>"></script>
<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'js/passkey.js')) ?>"></script>
<?php endif; ?>
<?php include '../includes/footer.php'; ?>
