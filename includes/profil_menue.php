<?php
// Einträge des Benutzermenüs: am PC als Dropdown, mobil als Liste im Profil-Blatt (eingebunden von header.php)
$alsListe = !empty($profilMenueAlsListe);
$eintragKlasse = $alsListe ? 'list-group-item list-group-item-action d-flex align-items-center' : 'dropdown-item';
[$liAuf, $liZu] = $alsListe ? ['', ''] : ['<li>', '</li>'];
$icon = fn(string $name) => '<i class="fas ' . $name . ($alsListe ? ' fa-fw me-3' : ' me-2') . '"></i>';
$menue = [
    ['pages/einstellungen.php', 'fa-user-edit', 'Profil bearbeiten'],
    ['pages/passwort_aendern.php', 'fa-key', 'Passwort ändern'],
    ['pages/mfa_einrichten.php', 'fa-shield-alt', '2FA einrichten'],
    ['pages/benachrichtigungen.php', 'fa-envelope', 'E-Mail-Benachrichtigungen'],
    ['pages/kategorien.php', 'fa-tags', 'Kategorien'],
    ['pages/einladungen.php', 'fa-users', 'Einladungen'],
    ['pages/neuigkeiten.php', 'fa-bullhorn', 'Neuigkeiten'],
];
if (!empty($currentUser['is_admin'])) {
    $menue[] = ['pages/admin.php', 'fa-users-cog', 'Benutzerverwaltung & Feedback'];
}
// Am PC steht "Feedback" direkt in der Kopfleiste, mobil gehört es ins Profil-Blatt
if ($alsListe) {
    $menue[] = [substr($feedbackUrl, strlen($baseUrl)), 'fa-comment-dots', 'Feedback senden'];
}
foreach ($menue as [$ziel, $symbol, $text]): ?>
    <?= $liAuf ?><a class="<?= $eintragKlasse ?>" href="<?= htmlspecialchars($baseUrl . $ziel) ?>"><?= $icon($symbol) ?><?= htmlspecialchars($text) ?><?= $ziel === 'pages/neuigkeiten.php' ? '<span class="badge rounded-pill text-bg-primary ms-2 d-none" data-neu-version>neu</span>' : '' ?></a><?= $liZu ?>
<?php endforeach; ?>
<?php if ($alsListe): ?>
    <button type="button" class="<?= $eintragKlasse ?> theme-umschalter"><?= $icon('fa-moon') ?><span class="theme-text">Dunkle Darstellung</span></button>
<?php else: ?>
    <li><hr class="dropdown-divider"></li>
<?php endif; ?>
    <?= $liAuf ?><a class="<?= $eintragKlasse ?><?= $alsListe ? ' text-danger' : '' ?>" href="<?= htmlspecialchars($baseUrl) ?>pages/logout.php"><?= $icon('fa-sign-out-alt') ?>Abmelden</a><?= $liZu ?>
