<?php
// Profil-Menü (#206, docs/design.md 7.4): am PC als Dropdown, mobil als Liste im Profil-Blatt (eingebunden von header.php).
// Gruppiert in der Reihenfolge Konto, Fahrzeuge, Daten, Benachrichtigungen, Über, Darstellung; Betreiber-Seiten nur für
// Admins in einer eigenen Gruppe. Passwort, Zwei-Faktor, Passkeys und Geräte stehen auf der Seite „Konto“.
$alsListe = !empty($profilMenueAlsListe);
$eintragKlasse = $alsListe ? 'list-group-item list-group-item-action d-flex align-items-center' : 'dropdown-item';
[$liAuf, $liZu] = $alsListe ? ['', ''] : ['<li>', '</li>'];
$icon = fn(string $name) => '<i class="fas ' . $name . ($alsListe ? ' fa-fw me-3' : ' fa-fw me-2') . '" aria-hidden="true"></i>';

// „Berichte und Export“ gehört zu den Einträgen eines Fahrzeugs (7.6); hier nur der Kurzweg zum Fahrzeug der Seite bzw.
// der Sitzung (header.php: $bereichFahrzeug)
$berichteZiel = !empty($bereichFahrzeug['id']) ? fahrzeugSeite('eintraege', (string)$bereichFahrzeug['id']) . '#berichte' : null;

$gruppen = [
    'Konto' => [
        ['pages/einstellungen.php', 'fa-user-shield', 'Profil und Sicherheit'],
    ],
    'Fahrzeuge' => [
        ['pages/fahrzeuge.php', 'fa-car-side', 'Fahrzeuge'],
    ],
    'Daten' => array_values(array_filter([
        ['pages/kategorien.php', 'fa-tags', 'Kategorien'],
        ['pages/einladungen.php', 'fa-users', 'Einladungen'],
        $berichteZiel !== null ? [$berichteZiel, 'fa-file-export', 'Berichte und Export'] : null,
    ])),
    'Benachrichtigungen' => [
        ['pages/benachrichtigungen.php', 'fa-bell', 'Benachrichtigungen'],
    ],
    'Über' => array_values(array_filter([
        ['pages/neuigkeiten.php', 'fa-bullhorn', 'Neuigkeiten'],
        // Am PC steht „Feedback senden“ direkt in der Kopfleiste
        $alsListe ? [substr($feedbackUrl, strlen($baseUrl)), 'fa-comment-dots', 'Feedback senden'] : null,
    ])),
];
if (!empty($currentUser['is_admin'])) {
    $gruppen['Betrieb'] = [['pages/admin.php', 'fa-users-cog', 'Benutzerverwaltung und Feedback']];
}

$erste = true;
foreach ($gruppen as $titel => $eintraege):
    // Eine Gruppe mit nur einem gleichnamigen Eintrag (Fahrzeuge, Benachrichtigungen) braucht keine Überschrift
    $ueberschrift = (count($eintraege) === 1 && $eintraege[0][2] === $titel) ? '' : $titel;
    if ($alsListe): ?>
    <div class="profil-gruppe<?= $erste ? ' mt-0' : '' ?>" role="presentation"><?= htmlspecialchars($ueberschrift) ?></div>
    <?php else: ?>
    <?php if (!$erste): ?><li><hr class="dropdown-divider"></li><?php endif; ?>
    <?php if ($ueberschrift !== ''): ?><li><h6 class="dropdown-header"><?= htmlspecialchars($ueberschrift) ?></h6></li><?php endif; ?>
    <?php endif;
    $erste = false;
    foreach ($eintraege as [$ziel, $symbol, $text]): ?>
    <?= $liAuf ?><a class="<?= $eintragKlasse ?>" href="<?= htmlspecialchars($baseUrl . $ziel) ?>"><?= $icon($symbol) ?><?= htmlspecialchars($text) ?><?= $ziel === 'pages/neuigkeiten.php' ? '<span class="badge rounded-pill text-bg-primary ms-2 d-none" data-neu-version>neu</span>' : '' ?></a><?= $liZu ?>
    <?php endforeach;
endforeach; ?>
<?php if ($alsListe): ?>
    <div class="profil-gruppe" role="presentation">Darstellung</div>
    <button type="button" class="<?= $eintragKlasse ?> theme-umschalter"><?= $icon('fa-moon') ?><span class="theme-text">Dunkle Darstellung</span></button>
    <div class="profil-gruppe" role="presentation"></div>
<?php else: ?>
    <li><hr class="dropdown-divider"></li>
<?php endif; ?>
    <?= $liAuf ?><a class="<?= $eintragKlasse ?><?= $alsListe ? ' text-danger' : '' ?>" href="<?= htmlspecialchars($baseUrl) ?>pages/logout.php"><?= $icon('fa-sign-out-alt') ?>Abmelden</a><?= $liZu ?>
