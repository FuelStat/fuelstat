<?php
// E-Mail-Benachrichtigungen: eigener SMTP-Zugang, Erinnerungen an Termine, Monatsbericht
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}

$api = getApiClient();
$error = '';
$meldungen = [
    'mail_not_configured' => 'Bitte zuerst einen Mailserver eintragen und speichern.',
    'too_many_attempts' => 'Über den Fuelstat-Mailserver kannst du höchstens 5 Mails in 15 Minuten manuell auslösen. Bitte etwas warten.',
    'smtp_host_not_allowed' => 'Dieser Mailserver ist nicht erlaubt (interne Adresse).',
    'smtp_host_not_found' => 'Der Mailserver wurde nicht gefunden. Bitte die Adresse prüfen.',
    'invalid_smtpHost' => 'Die Server-Adresse ist ungültig.',
    'invalid_smtpPort' => 'Erlaubte Ports sind 25, 465, 587 und 2525.',
    'invalid_fromAddress' => 'Die Absender-Adresse ist ungültig.',
    'invalid_toAddress' => 'Die Empfänger-Adresse ist ungültig.',
    'invalid_reminderDays' => 'Die Vorlaufzeit muss zwischen 1 und 180 Tagen liegen.',
];
$fehlertext = function (Throwable $e) use ($meldungen) {
    $code = $e->getMessage();
    if ($code === 'smtp_failed') {
        $detail = $e instanceof FuelstatApiException && $e->detail ? ' Meldung des Servers: ' . $e->detail : '';
        return 'Der Mailserver hat den Versand abgelehnt. Bitte Server, Port, Verschlüsselung und Zugangsdaten prüfen.' . $detail;
    }
    return tarifHinweis($e) ?? $meldungen[$code] ?? $code;
};

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $aktion = $_POST['aktion'] ?? 'speichern';
    try {
        if ($aktion === 'speichern') {
            $daten = [
                'smtpHost' => trim($_POST['smtp_host'] ?? ''),
                'smtpPort' => trim($_POST['smtp_port'] ?? '') === '' ? null : (int)$_POST['smtp_port'],
                'smtpSecurity' => $_POST['smtp_security'] ?? 'starttls',
                'smtpUser' => trim($_POST['smtp_user'] ?? ''),
                'fromAddress' => trim($_POST['from_address'] ?? ''),
                'toAddress' => trim($_POST['to_address'] ?? ''),
                'remindersEnabled' => !empty($_POST['reminders_enabled']),
                'reminderDays' => (int)($_POST['reminder_days'] ?? 30),
                'monthlyReport' => !empty($_POST['monthly_report']),
            ];
            if (($_POST['smtp_password'] ?? '') !== '') {
                $daten['smtpPassword'] = $_POST['smtp_password'];
            }
            if (!empty($_POST['clear_password'])) {
                $daten['clearPassword'] = true;
            }
            $api->putMailSettings($daten);
            $_SESSION['success_message'] = 'Einstellungen gespeichert.';
        } elseif ($aktion === 'test') {
            $api->postMailTest();
            $_SESSION['success_message'] = 'Test-Mail wurde verschickt.';
        } elseif ($aktion === 'erinnerungen' || $aktion === 'bericht') {
            $r = $api->postMailSendNow($aktion === 'bericht' ? 'report' : 'reminders');
            $_SESSION['success_message'] = empty($r['sent'])
                ? 'Aktuell ist kein Termin fällig, daher wurde keine Erinnerung verschickt.'
                : ($aktion === 'bericht' ? 'Monatsbericht für den Vormonat wurde verschickt.' : 'Erinnerung wurde verschickt.');
        }
        header('Location: benachrichtigungen.php');
        exit;
    } catch (Throwable $e) {
        $error = $fehlertext($e);
    }
}

try {
    $s = $api->getMailSettings();
} catch (Throwable $e) {
    $s = [];
    $error = $error ?: $e->getMessage();
}
// Bei Fehlern die eingegebenen Werte behalten
if ($error && $_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['aktion'] ?? '') === 'speichern') {
    foreach (['smtp_host', 'smtp_port', 'smtp_security', 'smtp_user', 'from_address', 'to_address', 'reminder_days'] as $k) {
        $s[$k] = $_POST[$k] ?? '';
    }
    $s['reminders_enabled'] = !empty($_POST['reminders_enabled']);
    $s['monthly_report'] = !empty($_POST['monthly_report']);
}
$wert = fn($k) => htmlspecialchars((string)($s[$k] ?? ''));
$eigenerServer = !empty($s['smtp_host']);
$standardServer = !empty($s['default_available']);
$konfiguriert = $eigenerServer || $standardServer;
try {
    $ich = $api->getWhoAmI();
} catch (Throwable $e) {
    $ich = [];
}
// Der Admin-Mailserver dient allen anderen als Standard: das hier deutlich machen
$istStandardGeber = !empty($ich['is_admin']) && $eigenerServer;

include '../includes/header.php';
?>
<div class="container">
    <div class="row justify-content-center mt-5">
        <div class="col-md-10 col-lg-8">
            <?php if ($error): ?>
                <div class="alert alert-danger"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>
            <?php if (!empty($s['last_error'])): ?>
                <div class="alert alert-warning"><strong>Letzter automatischer Versand fehlgeschlagen:</strong> <?= htmlspecialchars($s['last_error']) ?></div>
            <?php endif; ?>

            <form method="post" class="card shadow mb-4">
                <div class="card-body p-4">
                    <input type="hidden" name="aktion" value="speichern">
                    <h3 class="h4 mb-3"><i class="fas fa-envelope me-2 text-primary"></i>E-Mail-Benachrichtigungen</h3>

                    <h5 class="mt-3">Was soll verschickt werden?</h5>
                    <div class="form-check form-switch mb-2">
                        <input class="form-check-input" type="checkbox" role="switch" id="reminders_enabled" name="reminders_enabled" value="1" <?= !empty($s['reminders_enabled']) ? 'checked' : '' ?>>
                        <label class="form-check-label" for="reminders_enabled">Erinnerungen an TÜV, Wartung, Versicherung und Steuer</label>
                    </div>
                    <div class="row align-items-center mb-2 ms-4">
                        <label class="col-auto col-form-label" for="reminder_days">Erinnern</label>
                        <div class="col-auto"><input type="number" class="form-control" style="width:6rem" id="reminder_days" name="reminder_days" min="1" max="180" value="<?= $wert('reminder_days') ?: 30 ?>"></div>
                        <div class="col-auto">Tage vorher (und noch einmal, wenn ein Termin überfällig ist)</div>
                    </div>
                    <div class="form-check form-switch mb-3">
                        <input class="form-check-input" type="checkbox" role="switch" id="monthly_report" name="monthly_report" value="1" <?= !empty($s['monthly_report']) ? 'checked' : '' ?>>
                        <label class="form-check-label" for="monthly_report">Monatsbericht am Monatsanfang (Kosten, Strecke, Verbrauch je Fahrzeug)</label>
                    </div>

                    <h5 class="mt-4">Mailserver (SMTP)</h5>
                    <?php if ($istStandardGeber): ?>
                        <div class="alert alert-info small"><i class="fas fa-server me-2"></i>Dein Mailserver ist der <strong>Standard für alle Benutzer</strong> ohne eigenen Server. Er verschickt deren Erinnerungen an ihre Konto-Adresse und das Feedback an deinen Empfänger.</div>
                    <?php elseif ($standardServer && !$eigenerServer): ?>
                        <div class="alert alert-success small mb-3">
                            <i class="fas fa-circle-check me-2"></i>Du musst nichts eintragen: Fuelstat verschickt deine Mails über den eigenen Mailserver
                            (Absender <strong><?= htmlspecialchars($s['default_from'] ?? '') ?></strong>) an deine Konto-Adresse <strong><?= htmlspecialchars($ich['email'] ?? '') ?></strong>.
                        </div>
                        <button class="btn btn-link px-0 mb-2 text-start" type="button" data-bs-toggle="collapse" data-bs-target="#eigenerServer" aria-expanded="false">
                            <i class="fas fa-sliders me-1"></i>Eigenen Mailserver verwenden (optional)
                        </button>
                    <?php elseif ($standardServer): ?>
                        <p class="text-muted small">Du verwendest deinen eigenen Mailserver. Lässt du „Server“ leer, verschickt Fuelstat die Mails über den Fuelstat-Mailserver an deine Konto-Adresse.</p>
                    <?php endif; ?>
                    <div class="<?= $standardServer && !$eigenerServer && !$istStandardGeber ? 'collapse' : '' ?>" id="eigenerServer">
                    <?php if (!$standardServer || $eigenerServer): ?>
                    <p class="text-muted small">Die Mails werden über dein eigenes E-Mail-Konto verschickt. Die Zugangsdaten findest du bei deinem Anbieter, z. B. unter „SMTP“ oder „E-Mail-Programm einrichten“.</p>
                    <?php endif; ?>
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label class="form-label" for="smtp_host">Server</label>
                            <input type="text" class="form-control" id="smtp_host" name="smtp_host" placeholder="z. B. smtp.gmx.net" value="<?= $wert('smtp_host') ?>">
                        </div>
                        <div class="col-md-3">
                            <label class="form-label" for="smtp_port">Port</label>
                            <select class="form-select" id="smtp_port" name="smtp_port">
                                <?php foreach ([587 => '587', 465 => '465', 25 => '25', 2525 => '2525'] as $port => $text): ?>
                                    <option value="<?= $port ?>" <?= (int)($s['smtp_port'] ?? 587) === $port ? 'selected' : '' ?>><?= $text ?></option>
                                <?php endforeach; ?>
                            </select>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label" for="smtp_security">Verschlüsselung</label>
                            <select class="form-select" id="smtp_security" name="smtp_security">
                                <?php foreach (['starttls' => 'STARTTLS', 'tls' => 'SSL/TLS', 'none' => 'keine'] as $k => $text): ?>
                                    <option value="<?= $k ?>" <?= ($s['smtp_security'] ?? 'starttls') === $k ? 'selected' : '' ?>><?= $text ?></option>
                                <?php endforeach; ?>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="smtp_user">Benutzername</label>
                            <input type="text" class="form-control" id="smtp_user" name="smtp_user" autocomplete="off" placeholder="meist deine E-Mail-Adresse" value="<?= $wert('smtp_user') ?>">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="smtp_password">Passwort</label>
                            <input type="password" class="form-control" id="smtp_password" name="smtp_password" autocomplete="new-password"
                                   placeholder="<?= !empty($s['has_password']) ? 'gespeichert – leer lassen, um es zu behalten' : '' ?>">
                            <?php if (!empty($s['has_password'])): ?>
                                <div class="form-check mt-1">
                                    <input class="form-check-input" type="checkbox" id="clear_password" name="clear_password" value="1">
                                    <label class="form-check-label small" for="clear_password">Gespeichertes Passwort löschen</label>
                                </div>
                            <?php endif; ?>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="from_address">Absender</label>
                            <input type="email" class="form-control" id="from_address" name="from_address" placeholder="leer = Benutzername" value="<?= $wert('from_address') ?>">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="to_address">Empfänger</label>
                            <input type="email" class="form-control" id="to_address" name="to_address" placeholder="leer = E-Mail-Adresse deines Kontos" value="<?= $wert('to_address') ?>">
                        </div>
                    </div>
                    <p class="text-muted small mt-2 mb-3">Das Passwort wird verschlüsselt gespeichert. Viele Anbieter (z. B. Gmail, Outlook) verlangen dafür ein eigenes App-Passwort.</p>
                    </div>
                    <button type="submit" class="btn btn-primary"><i class="fas fa-save me-2"></i>Speichern</button>
                </div>
            </form>

            <div class="card shadow mb-4">
                <div class="card-body p-4">
                    <h5>Ausprobieren</h5>
                    <div class="d-flex flex-wrap gap-2">
                        <?php foreach (['test' => ['fa-paper-plane', 'Test-Mail senden'], 'erinnerungen' => ['fa-bell', 'Fällige Termine jetzt senden'], 'bericht' => ['fa-chart-line', 'Monatsbericht (Vormonat) jetzt senden']] as $aktion => [$icon, $text]): ?>
                        <form method="post">
                            <input type="hidden" name="aktion" value="<?= $aktion ?>">
                            <button type="submit" class="btn btn-outline-primary" <?= $konfiguriert ? '' : 'disabled' ?>><i class="fas <?= $icon ?> me-2"></i><?= $text ?></button>
                        </form>
                        <?php endforeach; ?>
                    </div>
                    <?php if (!empty($s['last_sent_at'])): ?>
                        <p class="text-muted small mt-3 mb-0">Zuletzt automatisch verschickt: <?= date('d.m.Y H:i', strtotime($s['last_sent_at'])) ?></p>
                    <?php endif; ?>
                </div>
            </div>
        </div>
    </div>
</div>
<?php include '../includes/footer.php'; ?>
