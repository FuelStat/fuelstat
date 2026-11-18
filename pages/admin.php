<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}

$api = getApiClient();
try {
    $ich = $api->getWhoAmI();
} catch (Throwable $e) {
    $ich = [];
}
if (empty($ich['is_admin'])) {
    http_response_code(403);
    die('Kein Zugriff. Admins werden über ADMIN_USER_IDS in der Backend-.env festgelegt.');
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $zielId = trim($_POST['user_id'] ?? '');
    $aktion = $_POST['aktion'] ?? '';
    try {
        // Beta-Status und Feedback betreffen auch das eigene Konto
        if ($aktion === 'beta') {
            $api->putUserBeta($zielId, !empty($_POST['wert']));
            header('Location: admin.php');
            exit;
        }
        if ($aktion === 'tarif') {
            $bis = trim($_POST['plan_until'] ?? '');
            $api->putUserPlan($zielId, (string)($_POST['plan'] ?? 'free'), $bis !== '' ? $bis . 'T23:59:59' : null);
            header('Location: admin.php');
            exit;
        }
        // Tarif für mehrere ausgewählte Benutzer auf einmal
        if ($aktion === 'tarif_sammel') {
            $ids = array_values(array_filter(array_map('strval', (array)($_POST['user_ids'] ?? []))));
            if (!$ids) {
                throw new RuntimeException('Bitte mindestens einen Benutzer auswählen.');
            }
            $bis = trim($_POST['plan_until'] ?? '');
            $plan = (string)($_POST['plan'] ?? 'plus');
            $ergebnis = $api->putPlans($ids, $plan, $bis !== '' ? $bis . 'T23:59:59' : null);
            $_SESSION['success_message'] = sprintf('Tarif %s für %d Benutzer gesetzt.', tarifNamen()[$plan] ?? $plan, (int)($ergebnis['updated'] ?? 0));
            header('Location: admin.php');
            exit;
        }
        if ($aktion === 'feedback') {
            $api->patchFeedback(trim($_POST['feedback_id'] ?? ''), !empty($_POST['wert']));
            header('Location: admin.php#feedback');
            exit;
        }
        if ($zielId === ($ich['id'] ?? '')) {
            throw new RuntimeException('Das eigene Konto bitte über die Einstellungen verwalten.');
        }
        if (($_POST['aktion'] ?? '') === 'abmelden') {
            $api->revokeAllTokens($zielId);
            $_SESSION['success_message'] = 'Benutzer wurde auf allen Geräten abgemeldet.';
        } elseif (($_POST['aktion'] ?? '') === 'loeschen') {
            $api->deleteUser($zielId);
            $_SESSION['success_message'] = 'Benutzer gelöscht.';
        }
        header('Location: admin.php');
        exit;
    } catch (Throwable $e) {
        $error = fehlerText($e);
    }
}

try {
    $benutzer = $api->getUsers();
} catch (Throwable $e) {
    $benutzer = [];
    $error = fehlerText($e);
}
// Registrierungen (#198): Hinweis, wenn die Grenze je Stunde Mails zurückgehalten hat
try {
    $registrierung = $api->getRegistrationStatus();
} catch (Throwable $e) {
    $registrierung = null;
}
try {
    $feedback = $api->getFeedback();
} catch (Throwable $e) {
    $feedback = [];
}
$betaAnzahl = count(array_filter($benutzer, fn($u) => !empty($u['beta_tester'])));
// Aktiv = in den letzten 7 Tagen angemeldet oder etwas eingetragen
$zuletzt = fn($u) => max(strtotime($u['last_seen_at'] ?? '') ?: 0, strtotime($u['last_entry_at'] ?? '') ?: 0);
$aktivAnzahl = count(array_filter($benutzer, fn($u) => $zuletzt($u) >= strtotime('-7 days')));

/** Zeitpunkt kurz und lesbar: "heute 14:05", "gestern", "vor 5 Tagen", sonst Datum; Tooltip mit genauer Zeit */
function zeitpunkt(?string $wert): string
{
    $ts = $wert ? strtotime($wert) : false;
    if (!$ts) {
        return '<span class="text-body-secondary">' . leerWert() . '</span>';
    }
    $tage = (int)floor((strtotime('today') - strtotime(date('Y-m-d', $ts))) / 86400);
    $text = match (true) {
        $tage <= 0 => 'heute ' . date('H:i', $ts),
        $tage === 1 => 'gestern',
        $tage < 30 => 'vor ' . $tage . ' Tagen',
        default => date('d.m.Y', $ts),
    };
    $farbe = $tage < 7 ? '' : ($tage < 30 ? ' text-body-secondary' : ' text-danger-emphasis');
    return '<span class="text-nowrap' . $farbe . '" title="' . date('d.m.Y H:i', $ts) . '">' . $text . '</span>';
}
$offenAnzahl = count(array_filter($feedback, fn($f) => empty($f['done'])));
$artInfo = [
    'fehler' => ['fa-bug', 'danger', 'Fehler'],
    'idee' => ['fa-lightbulb', 'warning', 'Idee'],
    'lob' => ['fa-heart', 'success', 'Lob'],
    'sonstiges' => ['fa-comment', 'secondary', 'Sonstiges'],
];

include '../includes/header.php';
?>
<div class="container mt-5">
    <h2><i class="fas fa-users-cog me-2"></i>Benutzerverwaltung</h2>
    <p class="text-body-secondary"><?= count($benutzer) ?> Benutzer, davon <?= $aktivAnzahl ?> in den letzten 7 Tagen aktiv und <?= $betaAnzahl ?> Beta-Tester<?= $offenAnzahl ? ' · <a href="#feedback">' . $offenAnzahl . ' offene Feedbacks</a>' : '' ?></p>
    <?php if ($error): ?>
        <div class="alert alert-danger"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>
    <?php if ($registrierung): ?>
        <p class="small text-body-secondary">Registrierungen: <?= (int)$registrierung['pendingRegistrations'] ?> offen (Link noch nicht geöffnet), <?= (int)$registrierung['unverifiedAccounts'] ?> unbestätigte Konten · <?= (int)$registrierung['mailsLastHour'] ?> von höchstens <?= (int)$registrierung['mailsPerHourLimit'] ?> Registrierungsmails in der letzten Stunde</p>
        <?php if (!empty($registrierung['blockedLast24h'])): ?>
            <div class="alert alert-warning" role="status">
                <strong>Registrierungsmails zurückgehalten.</strong> In den letzten 24 Stunden wurde die Grenze von <?= (int)$registrierung['mailsPerHourLimit'] ?> Mails je Stunde erreicht. Zurückgehaltene Mails: <?= (int)$registrierung['blockedLast24h'] ?>, zuletzt <?= zeitpunkt($registrierung['lastBlockedAt'] ?? null) ?>. Das kann ein Angriff auf den Mailserver sein. Die Grenze steht in <code>REGISTER_MAILS_PER_HOUR</code> in <code>infra/.env</code>.
            </div>
        <?php endif; ?>
    <?php endif; ?>
    <!-- Tarif für mehrere Benutzer: Häkchen in der Tabelle setzen, dann hier Tarif wählen -->
    <form method="post" id="tarifSammel" class="d-flex flex-wrap gap-2 align-items-center mb-3 p-2 rounded bg-body-tertiary"
          onsubmit="return confirm('Tarif für ' + document.querySelectorAll('.tarif-auswahl:checked').length + ' Benutzer setzen?');">
        <input type="hidden" name="aktion" value="tarif_sammel">
        <span class="small text-body-secondary">Tarif für <strong id="tarifAnzahl">0</strong> ausgewählte Benutzer:</span>
        <select name="plan" class="form-select form-select-sm w-auto" aria-label="Tarif für ausgewählte Benutzer">
            <?php foreach (tarifNamen() as $wert => $name): ?>
                <option value="<?= $wert ?>" <?= $wert === 'plus' ? 'selected' : '' ?>><?= $name ?></option>
            <?php endforeach; ?>
        </select>
        <input type="date" name="plan_until" class="form-control form-control-sm w-auto" aria-label="Gültig bis (leer = unbefristet)" title="Gültig bis (leer = unbefristet)">
        <button class="btn btn-sm btn-primary" id="tarifSammelKnopf" disabled>Tarif setzen</button>
        <?php if (empty($ich['limitsEnabled'])): ?>
            <span class="small text-body-secondary">Grenzen sind noch nicht aktiv (<code>PLAN_LIMITS_ENABLED</code>), bis dahin haben alle den vollen Umfang.</span>
        <?php endif; ?>
    </form>
    <div class="table-responsive">
        <table class="table align-middle">
            <thead>
                <tr>
                    <th><input class="form-check-input" type="checkbox" id="tarifAlle" aria-label="Alle Benutzer auswählen" title="Alle auswählen"></th>
                    <th>E-Mail</th><th>Benutzername</th>
                    <th class="text-end">Fahrzeuge</th>
                    <th title="Zuletzt die App benutzt (wird höchstens stündlich aktualisiert)">Zuletzt aktiv</th>
                    <th>Letzter Login</th>
                    <th title="Wann zuletzt eine Tankfüllung, Ladung oder Ausgabe erfasst wurde (auch per Import)">Letzter Eintrag</th>
                    <th>Zwei-Faktor</th><th>Beta-Tester</th>
                    <th title="Tarif und optionales Ablaufdatum<?= empty($ich['limitsEnabled']) ? '. Grenzen sind noch nicht aktiv (PLAN_LIMITS_ENABLED), alle haben den vollen Umfang.' : '' ?>">Tarif</th>
                    <th>Registriert</th><th></th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($benutzer as $u): $istIch = ($u['id'] ?? '') === ($ich['id'] ?? ''); ?>
                <tr>
                    <td><input class="form-check-input tarif-auswahl" type="checkbox" name="user_ids[]" form="tarifSammel" value="<?= htmlspecialchars($u['id']) ?>" aria-label="<?= htmlspecialchars($u['email'] ?? '') ?> auswählen"></td>
                    <td><?= htmlspecialchars($u['email'] ?? '') ?><?= $istIch ? ' <span class="badge text-bg-primary">Du</span>' : '' ?></td>
                    <td><?= htmlspecialchars($u['username'] ?? '') ?></td>
                    <td class="text-end"><?= (int)($u['vehicle_count'] ?? 0) ?></td>
                    <td><?= zeitpunkt($u['last_seen_at'] ?? null) ?></td>
                    <td><?= zeitpunkt($u['last_login_at'] ?? null) ?></td>
                    <td><?= zeitpunkt($u['last_entry_at'] ?? null) ?></td>
                    <td><?= !empty($u['mfa_enabled']) ? '<i class="fas fa-check text-success"></i>' : leerWert() ?></td>
                    <td>
                        <form method="post" class="form-check form-switch mb-0">
                            <input type="hidden" name="aktion" value="beta">
                            <input type="hidden" name="user_id" value="<?= htmlspecialchars($u['id']) ?>">
                            <input type="hidden" name="wert" value="<?= empty($u['beta_tester']) ? '1' : '' ?>">
                            <input class="form-check-input" type="checkbox" role="switch" aria-label="Beta-Tester" onchange="this.form.submit()" <?= !empty($u['beta_tester']) ? 'checked' : '' ?>>
                        </form>
                    </td>
                    <td>
                        <form method="post" class="d-flex gap-1 align-items-center mb-0">
                            <input type="hidden" name="aktion" value="tarif">
                            <input type="hidden" name="user_id" value="<?= htmlspecialchars($u['id']) ?>">
                            <!-- Speichert direkt beim Ändern -->
                            <select name="plan" class="form-select form-select-sm w-auto" aria-label="Tarif" onchange="this.form.submit()">
                                <?php foreach (tarifNamen() as $wert => $name): ?>
                                    <option value="<?= $wert ?>" <?= ($u['plan'] ?? 'free') === $wert ? 'selected' : '' ?>><?= $name ?></option>
                                <?php endforeach; ?>
                            </select>
                            <input type="date" name="plan_until" class="form-control form-control-sm w-auto" aria-label="Tarif gültig bis (leer = unbefristet)" title="Gültig bis (leer = unbefristet)"
                                   value="<?= !empty($u['plan_until']) ? htmlspecialchars(date('Y-m-d', strtotime($u['plan_until']))) : '' ?>" onchange="this.form.submit()">
                        </form>
                    </td>
                    <td><?= isset($u['created_at']) ? date('d.m.Y', strtotime($u['created_at'])) : '' ?></td>
                    <td class="text-end">
                        <?php if (!$istIch): ?>
                        <form method="post" class="d-inline" onsubmit="return confirm('Diesen Benutzer auf allen Geräten abmelden?');">
                            <input type="hidden" name="user_id" value="<?= htmlspecialchars($u['id']) ?>">
                            <button name="aktion" value="abmelden" class="btn btn-sm btn-outline-secondary" title="Abmelden"><i class="fas fa-sign-out-alt"></i></button>
                        </form>
                        <form method="post" class="d-inline" onsubmit="return confirm('Benutzer <?= htmlspecialchars(addslashes($u['email'] ?? '')) ?> mit allen Daten löschen?');">
                            <input type="hidden" name="user_id" value="<?= htmlspecialchars($u['id']) ?>">
                            <button name="aktion" value="loeschen" class="btn btn-sm btn-outline-danger" title="Löschen"><i class="fas fa-trash"></i></button>
                        </form>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>

    <h3 class="h4 mt-5 mb-3" id="feedback"><i class="fas fa-comment-dots me-2"></i>Feedback</h3>
    <?php if (!$feedback): ?>
        <p class="text-body-secondary">Noch kein Feedback eingegangen.</p>
    <?php endif; ?>
    <div class="d-flex flex-column gap-3 mb-5">
        <?php foreach ($feedback as $f): [$icon, $farbe, $artName] = $artInfo[$f['category']] ?? $artInfo['sonstiges']; ?>
        <div class="card border-0 shadow-sm<?= !empty($f['done']) ? ' opacity-50' : '' ?>">
            <div class="card-body">
                <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
                    <div>
                        <span class="badge text-bg-<?= $farbe ?> me-2"><i class="fas <?= $icon ?> me-1"></i><?= $artName ?></span>
                        <?php if (!empty($f['username'])): ?><strong class="me-1"><?= htmlspecialchars($f['username']) ?></strong><?php endif; ?>
                        <?php if (!empty($f['user_email'])): ?>
                            <a href="mailto:<?= htmlspecialchars($f['user_email']) ?>?subject=<?= rawurlencode('Dein Fuelstat-Feedback') ?>" title="Antworten"><?= htmlspecialchars($f['user_email']) ?></a>
                        <?php else: ?>
                            <span class="text-body-secondary">gelöschtes Konto</span>
                        <?php endif; ?>
                        <?php if (!empty($f['beta_tester'])): ?><span class="badge rounded-pill text-bg-warning ms-1">Beta</span><?php endif; ?>
                        <div class="small text-body-secondary"><?= date('d.m.Y H:i', strtotime($f['created_at'])) ?><?= !empty($f['page']) ? ' · ' . htmlspecialchars($f['page']) : '' ?></div>
                    </div>
                    <form method="post">
                        <input type="hidden" name="aktion" value="feedback">
                        <input type="hidden" name="feedback_id" value="<?= htmlspecialchars($f['id']) ?>">
                        <input type="hidden" name="wert" value="<?= empty($f['done']) ? '1' : '' ?>">
                        <button class="btn btn-sm <?= empty($f['done']) ? 'btn-outline-success' : 'btn-outline-secondary' ?>">
                            <i class="fas <?= empty($f['done']) ? 'fa-check' : 'fa-rotate-left' ?> me-1"></i><?= empty($f['done']) ? 'Erledigt' : 'Wieder öffnen' ?>
                        </button>
                    </form>
                </div>
                <p class="mb-1" style="white-space: pre-wrap;"><?= htmlspecialchars($f['message']) ?></p>
                <?php if (!empty($f['user_agent'])): ?>
                    <div class="small text-body-secondary text-truncate" title="<?= htmlspecialchars($f['user_agent']) ?>"><i class="fas fa-mobile-screen me-1"></i><?= htmlspecialchars($f['user_agent']) ?></div>
                <?php endif; ?>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
</div>
<script>
// Auswahl für "Tarif setzen": Zähler, Knopf und "Alle auswählen"
(function () {
  var alle = document.getElementById('tarifAlle');
  var boxen = Array.prototype.slice.call(document.querySelectorAll('.tarif-auswahl'));
  var anzahl = document.getElementById('tarifAnzahl');
  var knopf = document.getElementById('tarifSammelKnopf');
  function aktualisiere() {
    var n = boxen.filter(function (b) { return b.checked; }).length;
    anzahl.textContent = n;
    knopf.disabled = n === 0;
    alle.checked = n > 0 && n === boxen.length;
    alle.indeterminate = n > 0 && n < boxen.length;
  }
  alle.addEventListener('change', function () { boxen.forEach(function (b) { b.checked = alle.checked; }); aktualisiere(); });
  boxen.forEach(function (b) { b.addEventListener('change', aktualisiere); });
  aktualisiere();
})();
</script>
<?php include '../includes/footer.php'; ?>
