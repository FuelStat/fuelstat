<?php
// Benachrichtigungen (#136): je Anlass E-Mail und/oder Push, Push auf diesem Gerät, eigener SMTP-Zugang
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
    'push_not_configured' => 'Push-Benachrichtigungen sind auf diesem Server nicht eingerichtet.',
];
// Anlässe in der Reihenfolge der Seite (Schlüssel wie in der API)
$anlaesse = [
    'reminders' => ['fa-calendar-check', 'Termine', 'TÜV, Wartung, Versicherung und Steuer – vorher und noch einmal, wenn überfällig'],
    'odometer' => ['fa-gauge-high', 'Kilometerstand nachtragen', 'Wenn bei einer Tankfüllung der Kilometerstand fehlt'],
    'report' => ['fa-chart-line', 'Monatsbericht', 'Am Monatsanfang: Kosten, Strecke und Verbrauch je Fahrzeug'],
    'inactive' => ['fa-hourglass-half', 'Lange kein Eintrag', 'Wenn für ein Fahrzeug 30 Tage nichts erfasst wurde'],
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
        if ($aktion === 'kanaele') {
            $occ = [];
            foreach (array_keys($anlaesse) as $a) {
                $occ[$a] = ['email' => !empty($_POST['email'][$a]), 'push' => !empty($_POST['push'][$a])];
            }
            $api->putNotificationPreferences(['occasions' => $occ, 'reminder_days' => (int)($_POST['reminder_days'] ?? 30)]);
            $_SESSION['success_message'] = 'Benachrichtigungen gespeichert.';
        } elseif ($aktion === 'geraet_entfernen') {
            $api->deletePushDevice((string)($_POST['geraet'] ?? ''));
            $_SESSION['success_message'] = 'Das Gerät bekommt keine Push-Benachrichtigungen mehr.';
        } elseif ($aktion === 'speichern') {
            $daten = [
                'smtpHost' => trim($_POST['smtp_host'] ?? ''),
                'smtpPort' => trim($_POST['smtp_port'] ?? '') === '' ? null : (int)$_POST['smtp_port'],
                'smtpSecurity' => $_POST['smtp_security'] ?? 'starttls',
                'smtpUser' => trim($_POST['smtp_user'] ?? ''),
                'fromAddress' => trim($_POST['from_address'] ?? ''),
                'toAddress' => trim($_POST['to_address'] ?? ''),
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
    foreach (['smtp_host', 'smtp_port', 'smtp_security', 'smtp_user', 'from_address', 'to_address'] as $k) {
        $s[$k] = $_POST[$k] ?? '';
    }
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
try {
    $prefs = $api->getNotificationPreferences();
} catch (Throwable $e) {
    $prefs = ['occasions' => [], 'reminder_days' => 30, 'email_available' => $konfiguriert, 'push_available' => false];
}
$pushDa = !empty($prefs['push_available']);
$pushConfig = [];
$geraete = [];
if ($pushDa) {
    try {
        $pushConfig = $api->getPushConfig();
        $geraete = $api->getPushDevices();
    } catch (Throwable $e) {
        error_log('[Benachrichtigungen] Push: ' . $e->getMessage());
    }
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

            <!-- Je Anlass E-Mail und/oder Push (#136) -->
            <form method="post" class="card mb-4">
                <div class="card-body p-4">
                    <input type="hidden" name="aktion" value="kanaele">
                    <h2 class="h4 mb-1"><i class="fas fa-bell me-2 text-primary" aria-hidden="true"></i>Benachrichtigungen</h2>
                    <p class="fs-label mb-3">Wähle je Anlass, ob du eine E-Mail, eine Push-Benachrichtigung oder beides bekommst.</p>
                    <ul class="list-group mb-3">
                        <?php foreach ($anlaesse as $a => [$icon, $titel, $text]):
                            $o = $prefs['occasions'][$a] ?? ['email' => false, 'push' => false]; ?>
                        <li class="list-group-item py-3">
                            <div class="d-flex flex-wrap align-items-center gap-3">
                                <div class="flex-grow-1 min-w-0" style="flex-basis: 16rem">
                                    <div class="fw-semibold"><i class="fas <?= $icon ?> fa-fw me-1 text-primary" aria-hidden="true"></i><?= $titel ?></div>
                                    <div class="fs-label"><?= $text ?></div>
                                    <?php if ($a === 'reminders'): ?>
                                    <div class="d-flex align-items-center gap-2 mt-2">
                                        <label class="fs-label" for="reminder_days">Erinnern</label>
                                        <input type="number" class="form-control" style="width:5.5rem" id="reminder_days" name="reminder_days" min="1" max="180" value="<?= (int)($prefs['reminder_days'] ?? 30) ?>">
                                        <span class="fs-label">Tage vorher</span>
                                    </div>
                                    <?php endif; ?>
                                </div>
                                <div class="d-flex gap-3 flex-shrink-0">
                                    <div class="form-check form-switch m-0">
                                        <input class="form-check-input" type="checkbox" role="switch" id="email_<?= $a ?>" name="email[<?= $a ?>]" value="1" <?= !empty($o['email']) ? 'checked' : '' ?> <?= !empty($prefs['email_available']) ? '' : 'disabled' ?>>
                                        <label class="form-check-label" for="email_<?= $a ?>">E-Mail<span class="visually-hidden">: <?= $titel ?></span></label>
                                    </div>
                                    <div class="form-check form-switch m-0">
                                        <input class="form-check-input" type="checkbox" role="switch" id="push_<?= $a ?>" name="push[<?= $a ?>]" value="1" <?= !empty($o['push']) ? 'checked' : '' ?> <?= $pushDa ? '' : 'disabled' ?>>
                                        <label class="form-check-label" for="push_<?= $a ?>">Push<span class="visually-hidden">: <?= $titel ?></span></label>
                                    </div>
                                </div>
                            </div>
                        </li>
                        <?php endforeach; ?>
                    </ul>
                    <?php if (!$pushDa): ?>
                    <p class="fs-label">Push-Benachrichtigungen sind auf diesem Server nicht eingerichtet.</p>
                    <?php elseif (!$geraete): ?>
                    <p class="fs-label"><i class="fas fa-circle-info me-1" aria-hidden="true"></i>Push kommt erst, wenn du es unten auf mindestens einem Gerät aktivierst.</p>
                    <?php endif; ?>
                    <?php if (empty($prefs['email_available'])): ?>
                    <p class="fs-label">Für E-Mails trage unten zuerst einen Mailserver ein.</p>
                    <?php endif; ?>
                    <button type="submit" class="btn btn-primary"><i class="fas fa-save" aria-hidden="true"></i>Speichern</button>
                </div>
            </form>

            <?php if ($pushDa): ?>
            <!-- Push auf diesem Gerät: Erlaubnis nur nach Klick, auf iOS erst nach „Zum Home-Bildschirm“ -->
            <div class="card mb-4" id="pushBereich" data-vapid="<?= htmlspecialchars((string)($pushConfig['vapidPublicKey'] ?? '')) ?>" data-csrf="<?= htmlspecialchars(csrfToken()) ?>">
                <div class="card-body p-4">
                    <h2 class="h4 mb-1"><i class="fas fa-mobile-screen me-2 text-primary" aria-hidden="true"></i>Push auf diesem Gerät</h2>
                    <p class="fs-label mb-3" id="pushStatus" role="status" aria-live="polite">Wird geprüft …</p>
                    <div class="alert alert-info d-none" id="pushIosHinweis">
                        <strong>Auf dem iPhone und iPad zuerst zum Home-Bildschirm hinzufügen:</strong> In Safari auf
                        <i class="fas fa-arrow-up-from-bracket" aria-hidden="true"></i><span class="visually-hidden">Teilen</span> tippen,
                        „Zum Home-Bildschirm“ wählen und Fuelstat von dort öffnen. Dann lassen sich Push-Benachrichtigungen hier aktivieren (ab iOS 16.4).
                    </div>
                    <div class="d-flex flex-wrap gap-2">
                        <button type="button" class="btn btn-primary d-none" id="pushAn"><i class="fas fa-bell" aria-hidden="true"></i>Benachrichtigungen aktivieren</button>
                        <button type="button" class="btn btn-secondary d-none" id="pushTest"><i class="fas fa-paper-plane" aria-hidden="true"></i>Testnachricht senden</button>
                        <button type="button" class="btn btn-secondary d-none" id="pushAus"><i class="fas fa-bell-slash" aria-hidden="true"></i>Auf diesem Gerät abschalten</button>
                    </div>
                    <?php if ($geraete): ?>
                    <h3 class="h6 mt-4 mb-2">Geräte mit Push</h3>
                    <ul class="list-group">
                        <?php foreach ($geraete as $g):
                            $zuletzt = !empty($g['last_used_at']) ? (new DateTime($g['last_used_at']))->setTimezone(new DateTimeZone('Europe/Berlin'))->format('d.m.Y, H:i') : '–'; ?>
                        <li class="list-group-item d-flex align-items-center gap-3">
                            <i class="fas fa-bell fa-fw" aria-hidden="true"></i>
                            <div class="flex-grow-1 min-w-0">
                                <div class="text-truncate"><?= htmlspecialchars((string)($g['name'] ?? 'Gerät')) ?></div>
                                <div class="fs-label">zuletzt <?= $zuletzt ?><?= !empty($g['last_error']) ? ' · Fehler: ' . htmlspecialchars((string)$g['last_error']) : '' ?></div>
                            </div>
                            <form method="post" class="flex-shrink-0">
                                <input type="hidden" name="aktion" value="geraet_entfernen">
                                <input type="hidden" name="geraet" value="<?= htmlspecialchars((string)$g['id']) ?>">
                                <button type="submit" class="btn btn-sm btn-secondary" aria-label="<?= htmlspecialchars('Push für „' . ($g['name'] ?? 'Gerät') . '“ abschalten') ?>">Entfernen</button>
                            </form>
                        </li>
                        <?php endforeach; ?>
                    </ul>
                    <?php endif; ?>
                </div>
            </div>
            <?php endif; ?>

            <form method="post" class="card mb-4">
                <div class="card-body p-4">
                    <input type="hidden" name="aktion" value="speichern">
                    <h2 class="h4 mb-3"><i class="fas fa-envelope me-2 text-primary" aria-hidden="true"></i>E-Mail</h2>

                    <h3 class="h5">Mailserver (SMTP)</h3>
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

            <div class="card mb-4">
                <div class="card-body p-4">
                    <h2 class="h5">E-Mail ausprobieren</h2>
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
<?php if ($pushDa): ?>
<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'js/push.js')) ?>"></script>
<?php endif; ?>
<?php include '../includes/footer.php'; ?>
