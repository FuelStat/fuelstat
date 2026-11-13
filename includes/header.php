<?php
require_once __DIR__ . '/api_helpers.php';

require_once __DIR__ . '/basis_url.php';

// Fahrzeuge des eingeloggten Benutzers über API (user_id wird ignoriert; API nutzt JWT)
$api = getApiClient();

// Abfragen, die diese Seite sicher braucht, gleichzeitig vorladen statt nacheinander (#89)
if (isApiAuthenticated()) {
    $vorabSkript = basename($_SERVER['SCRIPT_NAME'] ?? '');
    $vorab = ['/whoami', FuelstatApi::ersteSeite('/vehicles')];
    $vorabId = (string)($_GET['fahrzeug_id'] ?? ($vorabSkript === 'fahrzeug_detail.php' ? ($_GET['id'] ?? '') : ''));
    if ($vorabId !== '' && in_array($vorabSkript, ['fahrzeug_detail.php', 'eintrag_hinzufuegen.php'], true)) {
        $p = '/vehicles/' . rawurlencode($vorabId);
        array_push($vorab, $p, $p . '/stats');
        if ($vorabSkript === 'fahrzeug_detail.php') {
            // Reiter „Allgemein“; die übrigen Reiter laden erst beim Öffnen (#160)
            array_push($vorab, $p . '/reminders', $p . '/costs');
        } else {
            $vorab[] = $p . '/fillups?per_page=100';
        }
    }
    $api->vorladen($vorab);
}

function getUserVehicles($user_id) {
    global $api;
    $vehicles = [];
    try {
        $list = $api->getVehicles();
        foreach ($list as $v) {
            $vehicles[] = [
                'id' => $v['id'],
                'marke' => '', // API liefert nur name
                'modell' => $v['name'] ?? '',
            ];
        }
    } catch (Throwable $e) {
        error_log('[Header] getVehicles failed: ' . $e->getMessage());
    }
    return $vehicles;
}

// Session validieren: Nur bei 401 (ungültiger/abgelaufener Token) ausloggen
$currentUser = null;
if (isApiAuthenticated()) {
    try {
        $currentUser = $api->getWhoAmI();
        // Aktive Nutzung verlängert die Anmeldung (#56), statt nach 7 Tagen abzumelden
        if (verlaengereAnmeldung($api)) {
            $api = getApiClient();
        }
    } catch (Throwable $e) {
        $code = method_exists($e, 'getCode') ? $e->getCode() : 0;
        error_log('[Header] getWhoAmI failed with code ' . $code . ': ' . $e->getMessage());
        if ($code === 401) {
            clearApiToken();
            $_SESSION = array();
            if (isset($_COOKIE[session_name()])) {
                $sessionCookieOptions = getSessionCookieOptions();
                setcookie(session_name(), '', [
                    'expires' => time() - 3600,
                    'path' => $sessionCookieOptions['path'],
                    'secure' => $sessionCookieOptions['secure'],
                    'httponly' => $sessionCookieOptions['httponly'],
                    'samesite' => $sessionCookieOptions['samesite'],
                ]);
            }
            session_destroy();
            header('Location: ' . $baseUrl . 'pages/login.php');
            exit;
        }
    }
}

// Nutzungsbedingungen (#135): Wer der gültigen Fassung noch nicht zugestimmt hat, stimmt zuerst zu. Erreichbar bleiben
// die Rechtstexte, das Profil (Konto löschen) und das Abmelden.
if (is_array($currentUser) && !empty($currentUser['terms']['required'])
    && !in_array(basename($_SERVER['SCRIPT_NAME'] ?? ''), ['nutzungsbedingungen.php', 'datenschutz.php', 'impressum.php', 'einstellungen.php', 'logout.php', 'email_bestaetigen.php'], true)) {
    header('Location: ' . $baseUrl . 'pages/nutzungsbedingungen.php');
    exit;
}

// --- Navigation: Seitentitel, Zurück-Link und Fahrzeug-Kontext für die mobile Ansicht ---
$angemeldet = isApiAuthenticated();
$userVehicles = $angemeldet ? getUserVehicles($_SESSION['user_id'] ?? null) : [];
$skript = basename($_SERVER['SCRIPT_NAME'] ?? '');

// Fahrzeug, um das es auf der aktuellen Seite geht (nur eigene Fahrzeuge)
$kontextId = (string)($_GET['fahrzeug_id'] ?? (in_array($skript, ['fahrzeug_detail.php', 'fahrzeug_bearbeiten.php', 'import.php'], true) ? ($_GET['id'] ?? '') : ''));
$kontextFahrzeug = null;
foreach ($userVehicles as $vehicle) {
    if ($kontextId !== '' && (string)$vehicle['id'] === $kontextId) {
        $kontextFahrzeug = $vehicle;
    }
}
$detailUrl = $kontextFahrzeug ? 'pages/fahrzeug_detail.php?id=' . urlencode($kontextFahrzeug['id']) : null;
$eintraegeUrl = $detailUrl ? $detailUrl . '#eintraege' : null;

// [Titel, Zurück-Link relativ zu $baseUrl]
$seitenInfo = [
    'fahrzeug_detail.php'      => [$kontextFahrzeug['modell'] ?? 'Fahrzeug', 'index.php'],
    'fahrzeug_hinzufuegen.php' => ['Neues Fahrzeug', 'index.php'],
    'fahrzeug_bearbeiten.php'  => ['Fahrzeug bearbeiten', $detailUrl],
    'eintrag_hinzufuegen.php'  => ['Eintrag erfassen', $eintraegeUrl],
    'eintrag_bearbeiten.php'   => ['Eintrag bearbeiten', $eintraegeUrl],
    'schnell.php'              => ['Schnellerfassung', 'index.php'],
    'tachostand_nachtragen.php' => ['Tachostand nachtragen', $eintraegeUrl],
    'import.php'               => ['Import', $eintraegeUrl],
    'einstellungen.php'        => ['Profil', null],
    'passwort_aendern.php'     => ['Passwort ändern', null],
    'mfa_einrichten.php'       => ['Zwei-Faktor-Schutz', null],
    'benachrichtigungen.php'   => ['Benachrichtigungen', null],
    'admin.php'                => ['Benutzerverwaltung', null],
    'onboarding.php'           => ['Willkommen', null],
    'feedback.php'             => ['Feedback', null],
    'kategorien.php'           => ['Kategorien', null],
    'neuigkeiten.php'          => ['Neuigkeiten', null],
    'email_bestaetigen.php'    => ['E-Mail bestätigen', null],
    'einladungen.php'          => ['Einladungen', null],
    'nutzungsbedingungen.php'  => ['Nutzungsbedingungen', null],
    'passwort_vergessen.php'   => ['Passwort vergessen', null],
    'passwort_zuruecksetzen.php' => ['Neues Passwort', null],
    'fahrt.php'                => ['Fahrt', 'fahrzeug_detail.php?id=' . urlencode((string)($_GET['fahrzeug_id'] ?? '')) . '#fahrten'],
];
[$seitenTitel, $zurueckUrl] = $angemeldet && isset($seitenInfo[$skript]) ? $seitenInfo[$skript] : [null, null];

// Aktiver Eintrag der unteren Leiste (Statistik wird auf der Fahrzeugseite per JS umgeschaltet)
$tabbarAktiv = [
    'index.php' => 'uebersicht',
    'fahrzeug_detail.php' => 'fahrzeuge', 'fahrzeug_bearbeiten.php' => 'fahrzeuge',
    'fahrzeug_hinzufuegen.php' => 'fahrzeuge', 'import.php' => 'fahrzeuge',
    'eintrag_hinzufuegen.php' => 'eintrag', 'eintrag_bearbeiten.php' => 'eintrag', 'schnell.php' => 'eintrag',
    'einstellungen.php' => 'profil', 'passwort_aendern.php' => 'profil', 'mfa_einrichten.php' => 'profil',
    'benachrichtigungen.php' => 'profil', 'admin.php' => 'profil', 'feedback.php' => 'profil',
    'kategorien.php' => 'profil', 'neuigkeiten.php' => 'profil', 'email_bestaetigen.php' => 'profil', 'einladungen.php' => 'profil', 'fahrt.php' => 'fahrzeuge',
][$skript] ?? null;

// Ziel von "+ Eintrag" und "Statistik": aktuelles Fahrzeug, das einzige Fahrzeug oder Auswahl im Blatt
$zielFahrzeug = $kontextFahrzeug ?? (count($userVehicles) === 1 ? $userVehicles[0] : null);
// Beta-Phase (Kennzeichen neben dem Logo) und Feedback-Link mit der aktuellen Seite als Kontext
$betaPhase = istBetaPhase();
$feedbackUrl = $baseUrl . 'pages/feedback.php' . ($skript !== 'feedback.php' ? '?von=' . rawurlencode($_SERVER['REQUEST_URI'] ?? '') : '');
$profilBildUrl = !empty($currentUser['profile_image_url'])
    ? (preg_match('#^https?://#i', $currentUser['profile_image_url']) ? $currentUser['profile_image_url'] : $baseUrl . ltrim($currentUser['profile_image_url'], '/'))
    : null;
?>
<!doctype html>
<html lang="de" class="light-style layout-menu-fixed layout-compact" dir="ltr">
<head>
    <meta charset="utf-8" />
    <title><?= $seitenTitel !== null ? htmlspecialchars($seitenTitel) . ' – ' : '' ?>Fuelstat</title>

    <meta name="description" content="" />

    <!-- Apple Information and PWA-Function -->
    <link rel="manifest" href="<?= htmlspecialchars($baseUrl) ?>manifest.json">
    <meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="mobile-web-app-capable" content="yes">
    <!-- iOS-Web-App: Statusleiste nicht durchsichtig, Inhalt beginnt darunter. Mit "black-translucent" lag die Kopfleiste
         unter der Statusleiste, und iOS hat sie auf scrollbaren Seiten weichgezeichnet (#97). Wirkt erst nach erneutem
         Hinzufügen zum Home-Bildschirm. -->
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <!-- Farbe der Statusleiste = Token Background des aktiven Modus (docs/design.md 11) -->
    <meta name="theme-color" content="#F2F6F8">
    <link rel="apple-touch-icon" href="<?= htmlspecialchars($baseUrl) ?>images/apple-touch-icon.png">
	<link rel="icon" type="image/x-icon" href="<?= htmlspecialchars($baseUrl) ?>images/new-icon.ico">
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">


    <!-- Darkmode: gespeicherte Wahl, sonst Systemeinstellung (vor dem CSS, damit nichts aufblitzt) -->
    <script>
      (function () {
        var theme = null;
        try { theme = localStorage.getItem('fuelstat-theme'); } catch (e) {}
        if (theme !== 'light' && theme !== 'dark') {
          theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-bs-theme', theme);
        // Farbe der Statusleiste (Android/Chrome) passend zur Kopfleiste
        document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#0E1624' : '#F2F6F8');
      })();
    </script>

    <!-- Bibliotheken lokal (vendor/), damit beim Aufruf keine Daten an CDNs gehen -->
    <link href="<?= htmlspecialchars(assetUrl($baseUrl, 'vendor/bootstrap/bootstrap.min.css')) ?>" rel="stylesheet">

    <!-- Font Awesome Icons -->
    <link href="<?= htmlspecialchars(assetUrl($baseUrl, 'css/all.min.css')) ?>" rel="stylesheet" />

    <!-- Custom CSS -->
    <!-- ?v= ändert sich bei jeder neuen Datei, damit Browser und Service Worker nie eine alte Version liefern -->
    <link rel="stylesheet" href="<?= htmlspecialchars($baseUrl) ?>css/style.css?v=<?= @filemtime(__DIR__ . '/../css/style.css') ?: 1 ?>" />
</head>

<body<?= $angemeldet ? ' class="mit-tabbar"' : '' ?>>

<!-- Kopfleiste: am PC Navigation als Symbole mit Tooltip (#145), mobil Zurück-Pfeil und Seitentitel
     (die Navigation steckt dort in der unteren Leiste) -->
<nav class="navbar sticky-top navbar-expand-lg kopfleiste" aria-label="Kopfleiste">
    <div class="container-fluid flex-nowrap gap-2">
        <?php if ($seitenTitel !== null): ?>
        <div class="d-flex d-lg-none align-items-center flex-grow-1 min-w-0">
            <?php if ($zurueckUrl !== null): ?>
            <a href="<?= htmlspecialchars($baseUrl . $zurueckUrl) ?>" class="btn btn-link px-0 me-1 kopf-zurueck" aria-label="Zurück">
                <i class="fas fa-chevron-left" aria-hidden="true"></i>
            </a>
            <?php endif; ?>
            <span class="navbar-brand mb-0 text-truncate kopf-titel"><?= htmlspecialchars($seitenTitel) ?></span>
        </div>
        <?php endif; ?>
        <a class="navbar-brand kopf-marke me-lg-3 <?= $seitenTitel !== null ? 'd-none d-lg-inline-flex' : '' ?>" href="<?= htmlspecialchars($baseUrl) ?>index.php">
            <img src="<?= htmlspecialchars($baseUrl) ?>images/icon-192x192.png" alt="" width="32" height="32">
            Fuelstat<?php if ($betaPhase): ?> <span class="badge text-bg-warning beta-badge">Beta</span><?php endif; ?>
        </a>

        <!-- Mobil: Aktionen rechts in der Kopfleiste -->
        <div class="d-flex d-lg-none align-items-center gap-1 ms-auto">
            <?php if ($angemeldet && $skript === 'fahrzeug_detail.php' && $kontextFahrzeug): ?>
                <a href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_bearbeiten.php?id=<?= htmlspecialchars(urlencode($kontextFahrzeug['id'])) ?>" class="kopf-symbol" aria-label="Fahrzeug bearbeiten">
                    <i class="fas fa-pen" aria-hidden="true"></i>
                </a>
            <?php elseif (!$angemeldet): ?>
                <button type="button" class="kopf-symbol theme-umschalter" aria-label="Darstellung umschalten">
                    <i class="fas fa-moon" aria-hidden="true"></i>
                </button>
                <?php if ($skript !== 'login.php'): ?>
                <a class="btn btn-sm btn-primary" href="<?= htmlspecialchars($baseUrl) ?>pages/login.php">Anmelden</a>
                <?php endif; ?>
            <?php endif; ?>
        </div>

        <!-- PC: Fahrzeugwechsler links, Navigation als Symbole rechts -->
        <?php if ($angemeldet && $userVehicles): ?>
        <div class="dropdown d-none d-lg-block">
            <button type="button" class="kopf-wechsler dropdown-toggle" id="fahrzeugeDropdown" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Fahrzeug wählen">
                <i class="fas fa-car-side" aria-hidden="true"></i>
                <span class="text-truncate"><?= htmlspecialchars($kontextFahrzeug ? trim($kontextFahrzeug['marke'] . ' ' . $kontextFahrzeug['modell']) : 'Meine Fahrzeuge') ?></span>
            </button>
            <ul class="dropdown-menu" aria-labelledby="fahrzeugeDropdown">
                <?php foreach ($userVehicles as $vehicle): ?>
                    <li>
                        <a class="dropdown-item<?= $kontextFahrzeug && $kontextFahrzeug['id'] === $vehicle['id'] ? ' active' : '' ?>" href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_detail.php?id=<?php echo htmlspecialchars($vehicle['id']); ?>"<?= $kontextFahrzeug && $kontextFahrzeug['id'] === $vehicle['id'] ? ' aria-current="true"' : '' ?>>
                            <i class="fas fa-car-side fa-fw" aria-hidden="true"></i><?php echo htmlspecialchars(trim($vehicle['marke'] . ' ' . $vehicle['modell'])); ?>
                        </a>
                    </li>
                <?php endforeach; ?>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_hinzufuegen.php"><i class="fas fa-plus fa-fw" aria-hidden="true"></i>Fahrzeug hinzufügen</a></li>
            </ul>
        </div>
        <?php endif; ?>

        <ul class="kopf-nav d-none d-lg-flex ms-auto">
            <?php if ($angemeldet): ?>
                <?php
                // Ziel von „Eintrag erfassen“ und „Statistik“ wie in der unteren Leiste: aktuelles bzw. einziges Fahrzeug
                $erfassenUrl = !$userVehicles ? 'pages/fahrzeug_hinzufuegen.php'
                    : ($zielFahrzeug ? 'pages/eintrag_hinzufuegen.php?fahrzeug_id=' . urlencode($zielFahrzeug['id']) : null);
                ?>
                <li class="me-2">
                    <?php if ($erfassenUrl !== null): ?>
                    <a class="btn btn-primary" href="<?= htmlspecialchars($baseUrl . $erfassenUrl) ?>">
                        <i class="fas fa-plus" aria-hidden="true"></i><?= $userVehicles ? 'Eintrag erfassen' : 'Fahrzeug hinzufügen' ?>
                    </a>
                    <?php else: ?>
                    <div class="dropdown">
                        <button type="button" class="btn btn-primary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
                            <i class="fas fa-plus" aria-hidden="true"></i>Eintrag erfassen
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li><h6 class="dropdown-header">Für welches Fahrzeug?</h6></li>
                            <?php foreach ($userVehicles as $vehicle): ?>
                            <li><a class="dropdown-item" href="<?= htmlspecialchars($baseUrl) ?>pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($vehicle['id'])) ?>"><i class="fas fa-car-side fa-fw" aria-hidden="true"></i><?= htmlspecialchars(trim($vehicle['marke'] . ' ' . $vehicle['modell'])) ?></a></li>
                            <?php endforeach; ?>
                        </ul>
                    </div>
                    <?php endif; ?>
                </li>
                <li>
                    <a class="kopf-symbol<?= $tabbarAktiv === 'uebersicht' ? ' active' : '' ?>" href="<?= htmlspecialchars($baseUrl) ?>index.php" aria-label="Start" data-tipp="Start"<?= $tabbarAktiv === 'uebersicht' ? ' aria-current="page"' : '' ?>>
                        <i class="fas fa-house" aria-hidden="true"></i>
                    </a>
                </li>
                <?php if ($zielFahrzeug): ?>
                <li>
                    <a class="kopf-symbol" id="kopfStatistik" href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_detail.php?id=<?= htmlspecialchars(urlencode($zielFahrzeug['id'])) ?>#statistiken" aria-label="Statistik" data-tipp="Statistik">
                        <i class="fas fa-chart-line" aria-hidden="true"></i>
                    </a>
                </li>
                <?php endif; ?>
                <li>
                    <a class="kopf-symbol<?= $skript === 'neuigkeiten.php' ? ' active' : '' ?>" href="<?= htmlspecialchars($baseUrl) ?>pages/neuigkeiten.php" aria-label="Neuigkeiten" data-tipp="Neuigkeiten"<?= $skript === 'neuigkeiten.php' ? ' aria-current="page"' : '' ?>>
                        <i class="fas fa-bullhorn" aria-hidden="true"></i>
                    </a>
                </li>
                <li>
                    <a class="kopf-symbol<?= $skript === 'feedback.php' ? ' active' : '' ?>" href="<?= htmlspecialchars($feedbackUrl) ?>" aria-label="Feedback senden" data-tipp="Feedback senden"<?= $skript === 'feedback.php' ? ' aria-current="page"' : '' ?>>
                        <i class="fas fa-comment-dots" aria-hidden="true"></i>
                    </a>
                </li>
            <?php endif; ?>
            <li>
                <button type="button" class="kopf-symbol theme-umschalter" aria-label="Darstellung umschalten" data-tipp="Darstellung umschalten">
                    <i class="fas fa-moon" aria-hidden="true"></i>
                </button>
            </li>
            <?php if ($angemeldet): ?>
                <li class="kopf-trenner" aria-hidden="true"></li>
                <li class="dropdown">
                    <button type="button" class="kopf-symbol dropdown-toggle<?= $tabbarAktiv === 'profil' && !in_array($skript, ['neuigkeiten.php', 'feedback.php'], true) ? ' active' : '' ?>" id="userSettingsDropdown" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Profil und Einstellungen<?= !empty($currentUser['username']) ? ' von ' . htmlspecialchars($currentUser['username']) : '' ?>" data-tipp="Profil">
                        <?php if ($profilBildUrl): ?>
                            <img src="<?= htmlspecialchars($profilBildUrl) ?>" alt="">
                        <?php else: ?>
                            <i class="fas fa-circle-user" aria-hidden="true"></i>
                        <?php endif; ?>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="userSettingsDropdown">
                        <li class="px-3 py-2">
                            <div class="fs-headline text-truncate"><?= htmlspecialchars(($currentUser['username'] ?? '') ?: 'Mein Konto') ?></div>
                            <?php if (!empty($currentUser['email'])): ?><div class="fs-footnote text-truncate"><?= htmlspecialchars($currentUser['email']) ?></div><?php endif; ?>
                        </li>
                        <li><hr class="dropdown-divider"></li>
                        <?php include __DIR__ . '/profil_menue.php'; ?>
                    </ul>
                </li>
            <?php else: ?>
                <?php if ($skript !== 'login.php'): ?>
                <li class="ms-2"><a class="btn btn-primary" href="<?= htmlspecialchars($baseUrl) ?>pages/login.php">Anmelden</a></li>
                <?php endif; ?>
            <?php endif; ?>
        </ul>
    </div>
</nav>

<?php if ($angemeldet): ?>
<!-- Mobil: untere Leiste wie in einer App -->
<nav class="tabbar d-lg-none" aria-label="Hauptnavigation">
    <a href="<?= htmlspecialchars($baseUrl) ?>index.php" class="tabbar-link<?= $tabbarAktiv === 'uebersicht' ? ' active' : '' ?>">
        <i class="fas fa-house" aria-hidden="true"></i><span>Start</span>
    </a>
    <button type="button" id="tabbarFahrzeuge" class="tabbar-link<?= $tabbarAktiv === 'fahrzeuge' ? ' active' : '' ?>" data-bs-toggle="offcanvas" data-bs-target="#blattFahrzeuge" data-aktion="details">
        <i class="fas fa-car"></i><span>Fahrzeuge</span>
    </button>
    <?php if (!$userVehicles): ?>
    <a href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_hinzufuegen.php" class="tabbar-link tabbar-plus" aria-label="Fahrzeug hinzufügen">
        <span class="tabbar-kreis"><i class="fas fa-plus"></i></span>
    </a>
    <?php elseif ($zielFahrzeug): ?>
    <a href="<?= htmlspecialchars($baseUrl) ?>pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($zielFahrzeug['id'])) ?>" class="tabbar-link tabbar-plus<?= $tabbarAktiv === 'eintrag' ? ' active' : '' ?>" aria-label="Eintrag erfassen">
        <span class="tabbar-kreis"><i class="fas fa-plus"></i></span>
    </a>
    <?php else: ?>
    <button type="button" class="tabbar-link tabbar-plus<?= $tabbarAktiv === 'eintrag' ? ' active' : '' ?>" data-bs-toggle="offcanvas" data-bs-target="#blattFahrzeuge" data-aktion="eintrag" aria-label="Eintrag erfassen">
        <span class="tabbar-kreis"><i class="fas fa-plus"></i></span>
    </button>
    <?php endif; ?>
    <?php if ($zielFahrzeug): ?>
    <a href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_detail.php?id=<?= htmlspecialchars(urlencode($zielFahrzeug['id'])) ?>#statistiken" id="tabbarStatistik" class="tabbar-link">
        <i class="fas fa-chart-line"></i><span>Statistik</span>
    </a>
    <?php else: ?>
    <button type="button" id="tabbarStatistik" class="tabbar-link" data-bs-toggle="offcanvas" data-bs-target="#blattFahrzeuge" data-aktion="statistik"<?= $userVehicles ? '' : ' disabled' ?>>
        <i class="fas fa-chart-line"></i><span>Statistik</span>
    </button>
    <?php endif; ?>
    <button type="button" class="tabbar-link<?= $tabbarAktiv === 'profil' ? ' active' : '' ?>" data-bs-toggle="offcanvas" data-bs-target="#blattProfil">
        <?php if ($profilBildUrl): ?>
            <img src="<?= htmlspecialchars($profilBildUrl) ?>" alt="" class="tabbar-avatar" width="24" height="24">
        <?php else: ?>
            <i class="fas fa-circle-user"></i>
        <?php endif; ?>
        <span>Profil</span>
    </button>
</nav>

<!-- Blatt: Fahrzeug wählen (Details, neuer Eintrag oder Statistik – je nach Knopf) -->
<div class="offcanvas offcanvas-bottom blatt d-lg-none" tabindex="-1" id="blattFahrzeuge" aria-labelledby="blattFahrzeugeTitel">
    <div class="blatt-griff"></div>
    <div class="offcanvas-header pb-2">
        <h2 class="offcanvas-title h5" id="blattFahrzeugeTitel">Meine Fahrzeuge</h2>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Schließen"></button>
    </div>
    <div class="offcanvas-body pt-0">
        <div class="list-group list-group-flush">
            <?php foreach ($userVehicles as $vehicle):
                $vid = urlencode($vehicle['id']); ?>
            <a class="list-group-item list-group-item-action d-flex align-items-center blatt-fahrzeug<?= $kontextFahrzeug && $kontextFahrzeug['id'] === $vehicle['id'] ? ' active' : '' ?>"
               href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_detail.php?id=<?= htmlspecialchars($vid) ?>"
               data-details="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_detail.php?id=<?= htmlspecialchars($vid) ?>#allgemein"
               data-statistik="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_detail.php?id=<?= htmlspecialchars($vid) ?>#statistiken"
               data-eintrag="<?= htmlspecialchars($baseUrl) ?>pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars($vid) ?>">
                <i class="fas fa-car-side fa-fw me-3" aria-hidden="true"></i><?= htmlspecialchars($vehicle['modell']) ?>
                <i class="fas fa-chevron-right ms-auto small opacity-50"></i>
            </a>
            <?php endforeach; ?>
            <a class="list-group-item list-group-item-action d-flex align-items-center text-primary blatt-neu" href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_hinzufuegen.php">
                <i class="fas fa-plus me-3"></i>Fahrzeug hinzufügen
            </a>
        </div>
    </div>
</div>

<!-- Blatt: Profil und Einstellungen -->
<div class="offcanvas offcanvas-bottom blatt d-lg-none" tabindex="-1" id="blattProfil" aria-labelledby="blattProfilTitel">
    <div class="blatt-griff"></div>
    <div class="offcanvas-header pb-2">
        <div class="d-flex align-items-center gap-3 min-w-0">
            <?php if ($profilBildUrl): ?>
                <img src="<?= htmlspecialchars($profilBildUrl) ?>" alt="" class="rounded-circle" style="width:44px;height:44px;object-fit:cover">
            <?php else: ?>
                <i class="fas fa-circle-user fa-2x text-body-secondary"></i>
            <?php endif; ?>
            <div class="min-w-0">
                <h2 class="offcanvas-title h5 mb-0 text-truncate" id="blattProfilTitel"><?= htmlspecialchars(($currentUser['username'] ?? '') ?: 'Mein Konto') ?></h2>
                <?php if (!empty($currentUser['email'])): ?>
                <div class="small text-body-secondary text-truncate"><?= htmlspecialchars($currentUser['email']) ?></div>
                <?php endif; ?>
                <?php if (!empty($currentUser['beta_tester'])): ?>
                <span class="badge rounded-pill text-bg-warning mt-1"><i class="fas fa-flask me-1"></i>Beta-Tester</span>
                <?php endif; ?>
            </div>
        </div>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Schließen"></button>
    </div>
    <div class="offcanvas-body pt-0">
        <div class="list-group list-group-flush">
            <?php $profilMenueAlsListe = true; include __DIR__ . '/profil_menue.php'; $profilMenueAlsListe = false; ?>
        </div>
    </div>
</div>
<?php endif; ?>

<!-- Hauptinhalt (wird in footer.php geschlossen) -->
<div class="hauptinhalt">

<?php if ($angemeldet && is_array($currentUser) && !empty($currentUser['pending_invitations']) && $skript !== 'einladungen.php'): ?>
<!-- Offene Einladungen zu geteilten Fahrzeugen (#53) -->
<div class="container mt-3 mt-lg-4">
  <div class="alert alert-info d-flex flex-wrap align-items-center gap-2 mb-0" role="status">
    <i class="fas fa-users" aria-hidden="true"></i>
    <span class="flex-grow-1"><?= (int)$currentUser['pending_invitations'] === 1 ? 'Jemand möchte ein Fahrzeug mit dir teilen.' : (int)$currentUser['pending_invitations'] . ' Einladungen zu geteilten Fahrzeugen warten auf dich.' ?></span>
    <a class="btn btn-sm btn-primary" href="<?= htmlspecialchars($baseUrl) ?>pages/einladungen.php">Ansehen</a>
  </div>
</div>
<?php endif; ?>
<?php if ($angemeldet && is_array($currentUser) && isset($currentUser['email_verified']) && !$currentUser['email_verified'] && $skript !== 'email_bestaetigen.php'): ?>
<!-- E-Mail-Adresse noch nicht bestätigt (#135): Funktionen sind bis dahin begrenzt -->
<div class="container mt-3 mt-lg-4">
  <div class="alert alert-warning d-flex flex-wrap align-items-center gap-2 mb-0" role="status">
    <i class="fas fa-envelope-open-text" aria-hidden="true"></i>
    <span class="flex-grow-1">Bitte bestätige deine E-Mail-Adresse <strong><?= htmlspecialchars((string)($currentUser['email'] ?? '')) ?></strong> über den Link in unserer Mail. Bis dahin sind ein Fahrzeug und ein Eintrag möglich.</span>
    <a class="btn btn-sm btn-primary" href="<?= htmlspecialchars($baseUrl) ?>pages/email_bestaetigen.php">Erneut senden oder Code eingeben</a>
  </div>
</div>
<?php endif; ?>

<?php if (isset($_SESSION['success_message']) || isset($_SESSION['warning_message']) || isset($_SESSION['error_message'])): ?>
<!-- Meldungen -->
<div class="container mt-3 mt-lg-4">

<?php
// Erfolgs- und Warnmeldungen anzeigen
if (isset($_SESSION['success_message'])) {
    echo '<div class="alert alert-success alert-dismissible fade show" role="alert">';
    echo '<i class="fas fa-check-circle me-2"></i>' . htmlspecialchars($_SESSION['success_message']);
    echo '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Schließen"></button>';
    echo '</div>';
    unset($_SESSION['success_message']);
}

if (isset($_SESSION['warning_message'])) {
    echo '<div class="alert alert-warning alert-dismissible fade show" role="alert">';
    echo '<i class="fas fa-exclamation-triangle me-2"></i>' . htmlspecialchars($_SESSION['warning_message']);
    echo '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Schließen"></button>';
    echo '</div>';
    unset($_SESSION['warning_message']);
}

if (isset($_SESSION['error_message'])) {
    echo '<div class="alert alert-danger alert-dismissible fade show" role="alert">';
    echo '<i class="fas fa-times-circle me-2"></i>' . htmlspecialchars($_SESSION['error_message']);
    echo '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Schließen"></button>';
    echo '</div>';
    unset($_SESSION['error_message']);
}
?>
</div>
<?php endif; ?>
