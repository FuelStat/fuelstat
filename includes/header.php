<?php
require_once __DIR__ . '/api_helpers.php';

require_once __DIR__ . '/basis_url.php';

// Fahrzeuge des eingeloggten Benutzers über API (user_id wird ignoriert; API nutzt JWT)
$api = getApiClient();

// Abfragen, die diese Seite sicher braucht, gleichzeitig vorladen statt nacheinander (#89)
if (isApiAuthenticated()) {
    $vorabSkript = basename($_SERVER['SCRIPT_NAME'] ?? '');
    $vorab = ['/whoami', FuelstatApi::ersteSeite('/vehicles')];
    // Ansichten eines Fahrzeugs (#206) tragen die ID in ?id=
    $ansichtSkripte = ['eintraege.php', 'statistik.php', 'service.php', 'fahrten.php', 'fahrzeugdaten.php'];
    $vorabId = (string)($_GET['fahrzeug_id'] ?? (in_array($vorabSkript, $ansichtSkripte, true) ? ($_GET['id'] ?? '') : ''));
    // Start (#158): Fahrzeug der Sitzung (#206) mit Kennzahlen, Terminen und letzten Einträgen; ohne Wahl das zuletzt
    // ermittelte Standardfahrzeug (nur zum Vorladen gemerkt, siehe unten)
    $startId = $vorabSkript === 'index.php'
        ? (string)($_GET['fahrzeug'] ?? ($_SESSION['fahrzeug_wahl'] ?? ($_SESSION['fahrzeug_vorladen'] ?? ''))) : '';
    if ($startId !== '' && preg_match('/^[0-9a-f-]{36}$/', $startId)) {
        $p = '/vehicles/' . rawurlencode($startId);
        array_push($vorab, $p . '/stats', $p . '/reminders', $p . '/costs', $p . '/timeline?per_page=5');
    }
    if ($vorabId !== '' && in_array($vorabSkript, [...$ansichtSkripte, 'eintrag_hinzufuegen.php'], true)) {
        $p = '/vehicles/' . rawurlencode($vorabId);
        array_push($vorab, $p, $p . '/stats');
        if ($vorabSkript === 'service.php') {
            $vorab[] = $p . '/reminders';
        } elseif ($vorabSkript === 'eintrag_hinzufuegen.php') {
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
                'status' => $v['status'] ?? 'active', // active | sold | decommissioned (#79)
                'role' => $v['role'] ?? 'owner', // owner | editor | viewer (#53)
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
    && !in_array(basename($_SERVER['SCRIPT_NAME'] ?? ''), ['nutzungsbedingungen.php', 'datenschutz.php', 'impressum.php', 'einstellungen.php', 'logout.php', 'email_bestaetigen.php', 'fehler.php'], true)) {
    header('Location: ' . $baseUrl . 'pages/nutzungsbedingungen.php');
    exit;
}

// --- Navigation: Seitentitel, Zurück-Link und Fahrzeug-Kontext für die mobile Ansicht ---
$angemeldet = isApiAuthenticated();
$alleFahrzeuge = $angemeldet ? getUserVehicles($_SESSION['user_id'] ?? null) : [];
// Wechsler, Start und „Eintrag erfassen“ kennen nur aktive Fahrzeuge; verkaufte und stillgelegte (#79) stehen im Archiv
// unter „Meine Fahrzeuge“ und bleiben über ihre Seite erreichbar ($alleFahrzeuge).
$userVehicles = array_values(array_filter($alleFahrzeuge, fn($v) => $v['status'] === 'active'));
$skript = basename($_SERVER['SCRIPT_NAME'] ?? '');

// Fahrzeug, um das es auf der aktuellen Seite geht (nur eigene Fahrzeuge)
$ansichtSkripte = ['eintraege.php', 'statistik.php', 'service.php', 'fahrten.php', 'fahrzeugdaten.php'];
$kontextId = (string)($_GET['fahrzeug_id'] ?? (in_array($skript, [...$ansichtSkripte, 'fahrzeug_bearbeiten.php', 'import.php'], true) ? ($_GET['id'] ?? '') : ''));
$kontextFahrzeug = null;
foreach ($alleFahrzeuge as $vehicle) {
    if ($kontextId !== '' && (string)$vehicle['id'] === $kontextId) {
        $kontextFahrzeug = $vehicle;
    }
}
// Fahrzeugwahl der Sitzung (#206, docs/design.md 7.2): gilt für Start, Einträge, Statistik und „＋“ bis zur Abmeldung
// und wird nicht dauerhaft gemerkt. Ohne Wahl gilt das Standardfahrzeug (erstes aktives der Reihenfolge). Gewählt wird im
// Wechsler auf Start (?fahrzeug=…), in Einträge und Statistik und beim Speichern eines Eintrags (eintrag_speichern.php).
$wahlId = (string)($_SESSION['fahrzeug_wahl'] ?? '');
if ($skript === 'index.php' && isset($_GET['fahrzeug'])) {
    $wahlId = (string)$_GET['fahrzeug'];
} elseif (in_array($skript, ['eintraege.php', 'statistik.php'], true) && $kontextFahrzeug && $kontextFahrzeug['status'] === 'active') {
    $wahlId = (string)$kontextFahrzeug['id'];
}
$sitzungsFahrzeug = null;
foreach ($userVehicles as $vehicle) {
    if ((string)$vehicle['id'] === $wahlId) {
        $sitzungsFahrzeug = $vehicle;
    }
}
if ($sitzungsFahrzeug) {
    $_SESSION['fahrzeug_wahl'] = (string)$sitzungsFahrzeug['id'];
} elseif ($userVehicles) {
    // Die Wahl gibt es nicht (mehr) unter den aktiven Fahrzeugen: Standardfahrzeug. Ist die Liste leer (auch wenn die
    // API gerade nicht antwortet), bleibt die Wahl für den nächsten Aufruf stehen.
    unset($_SESSION['fahrzeug_wahl']);
    $sitzungsFahrzeug = $userVehicles[0];
}
// Nur fürs Vorladen von Start (oben): das Fahrzeug, das Start zuletzt gezeigt hat. Keine Wahl, ändert nichts an ihr.
if ($sitzungsFahrzeug) {
    $_SESSION['fahrzeug_vorladen'] = (string)$sitzungsFahrzeug['id'];
}
// Das frühere Fahrzeug-Cookie (bis 0.13) entfernen: Die Wahl gilt nur noch für die Sitzung
if (isset($_COOKIE['fuelstat_fahrzeug']) && !headers_sent()) {
    setcookie('fuelstat_fahrzeug', '', ['expires' => time() - 3600, 'path' => '/']);
}
$startFahrzeug = null;
if ($angemeldet && $skript === 'index.php' && $sitzungsFahrzeug) {
    $startFahrzeug = $sitzungsFahrzeug;
    $kontextFahrzeug = $startFahrzeug;
}
$detailUrl = $kontextFahrzeug ? fahrzeugSeite('fahrzeugdaten', $kontextFahrzeug['id']) : null;
$eintraegeUrl = $kontextFahrzeug ? fahrzeugSeite('eintraege', $kontextFahrzeug['id']) : null;

// [Titel, Zurück-Link relativ zu $baseUrl]
$seitenInfo = [
    // Ansichten eines Fahrzeugs (#206): Einträge und Statistik sind Bereiche der Leiste, die übrigen liegen hinter Start
    'eintraege.php'            => ['Einträge', null],
    'statistik.php'            => ['Statistik', null],
    'service.php'              => ['Service', 'index.php'],
    'fahrten.php'              => ['Fahrten', 'index.php'],
    'fahrzeugdaten.php'        => ['Fahrzeugdaten', 'index.php'],
    'fahrzeug_hinzufuegen.php' => ['Neues Fahrzeug', 'index.php'],
    'fahrzeuge.php'            => ['Fahrzeuge', 'index.php'],
    'passkeys.php'             => ['Passkeys', null],
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
    'fahrt.php'                => ['Fahrt', fahrzeugSeite('fahrten', (string)($_GET['fahrzeug_id'] ?? ''))],
    // Auch ohne Anmeldung erreichbar
    'login.php'                => ['Anmelden', null],
    'register.php'             => ['Registrieren', null],
    'datenschutz.php'          => ['Datenschutz', null],
    'impressum.php'            => ['Impressum', null],
    'fehler.php'               => ['Seite nicht gefunden', null],
];
// Titel in der mobilen Kopfleiste (angemeldet); der Titel des Dokuments gilt immer (docs/design.md §11: „Seite – App“,
// Start nur „App“). tests/SeitentitelTest.php prüft, dass jede Seite hier steht.
[$seitenTitel, $zurueckUrl] = $angemeldet && isset($seitenInfo[$skript]) ? $seitenInfo[$skript] : [null, null];
$dokumentTitel = $seitenInfo[$skript][0] ?? null;

// Aktiver Eintrag der unteren Leiste (Statistik wird auf der Fahrzeugseite per JS umgeschaltet)
$tabbarAktiv = [
    // Leiste (#206, docs/design.md 7.1): Start · Einträge · ＋ · Statistik · Profil. Service, Fahrten und Fahrzeugdaten
    // liegen hinter Start, die Liste der Fahrzeuge unter Profil.
    'index.php' => 'uebersicht', 'service.php' => 'uebersicht', 'fahrten.php' => 'uebersicht', 'fahrt.php' => 'uebersicht',
    'fahrzeugdaten.php' => 'uebersicht', 'fahrzeug_bearbeiten.php' => 'uebersicht',
    'eintraege.php' => 'eintraege', 'import.php' => 'eintraege', 'tachostand_nachtragen.php' => 'eintraege',
    'statistik.php' => 'statistik',
    'eintrag_hinzufuegen.php' => 'eintrag', 'eintrag_bearbeiten.php' => 'eintrag', 'schnell.php' => 'eintrag',
    'fahrzeuge.php' => 'profil', 'fahrzeug_hinzufuegen.php' => 'profil', 'passkeys.php' => 'profil',
    'einstellungen.php' => 'profil', 'passwort_aendern.php' => 'profil', 'mfa_einrichten.php' => 'profil',
    'benachrichtigungen.php' => 'profil', 'admin.php' => 'profil', 'feedback.php' => 'profil',
    'kategorien.php' => 'profil', 'neuigkeiten.php' => 'profil', 'email_bestaetigen.php' => 'profil', 'einladungen.php' => 'profil',
][$skript] ?? null;

// Ziel von „＋“: das aktive Fahrzeug der Seite, sonst das Fahrzeug der Sitzung (#206). Nur zum Ansehen geteilte Fahrzeuge
// (#53) nehmen keine Einträge an; dann das erste Fahrzeug, bei dem man erfassen darf.
$darfErfassenIn = fn($v) => $v && $v['status'] === 'active' && $v['role'] !== 'viewer';
$zielFahrzeug = $darfErfassenIn($kontextFahrzeug) ? $kontextFahrzeug
    : ($darfErfassenIn($sitzungsFahrzeug) ? $sitzungsFahrzeug
        : (array_values(array_filter($userVehicles, $darfErfassenIn))[0] ?? null));
// Ziel von „Einträge“ und „Statistik“ (#206): das Fahrzeug der Seite (auch archiviert oder nur zum Ansehen), sonst das
// der Sitzung; nur mit archivierten Fahrzeugen das erste davon
$bereichFahrzeug = $kontextFahrzeug ?? $sitzungsFahrzeug ?? ($alleFahrzeuge[0] ?? null);
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
    <title><?= $dokumentTitel !== null ? htmlspecialchars($dokumentTitel) . ' – ' : '' ?>Fuelstat</title>

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

    <!-- Lade- und Fehlerzustände beim Nachladen (#211); früh geladen, weil Skripte in den Seiten es sofort nutzen -->
    <script src="<?= htmlspecialchars($baseUrl) ?>js/zustaende.js?v=<?= @filemtime(__DIR__ . '/../js/zustaende.js') ?: 1 ?>"></script>

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
            <?php if ($angemeldet && $skript === 'fahrzeugdaten.php' && $kontextFahrzeug && $kontextFahrzeug['status'] === 'active'): ?>
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
                <span class="text-truncate"><?= htmlspecialchars($kontextFahrzeug ? trim($kontextFahrzeug['marke'] . ' ' . $kontextFahrzeug['modell']) : 'Fahrzeuge') ?></span>
            </button>
            <ul class="dropdown-menu" aria-labelledby="fahrzeugeDropdown">
                <?php foreach ($userVehicles as $vehicle): ?>
                    <li>
                        <a class="dropdown-item<?= $kontextFahrzeug && $kontextFahrzeug['id'] === $vehicle['id'] ? ' active' : '' ?>" href="<?= htmlspecialchars($baseUrl . fahrzeugSeite(in_array($skript, $ansichtSkripte, true) ? ($skript === 'statistik.php' && ($_GET['teil'] ?? '') === 'kosten' ? 'kosten' : basename($skript, '.php')) : 'uebersicht', $vehicle['id'])) ?>"<?= $kontextFahrzeug && $kontextFahrzeug['id'] === $vehicle['id'] ? ' aria-current="true"' : '' ?>>
                            <i class="fas fa-car-side fa-fw" aria-hidden="true"></i><?php echo htmlspecialchars(trim($vehicle['marke'] . ' ' . $vehicle['modell'])); ?>
                        </a>
                    </li>
                <?php endforeach; ?>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeuge.php"><i class="fas fa-table-cells-large fa-fw" aria-hidden="true"></i>Fahrzeuge verwalten</a></li>
                <li><a class="dropdown-item" href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_hinzufuegen.php"><i class="fas fa-plus fa-fw" aria-hidden="true"></i>Fahrzeug hinzufügen</a></li>
            </ul>
        </div>
        <?php endif; ?>

        <ul class="kopf-nav d-none d-lg-flex ms-auto">
            <?php if ($angemeldet): ?>
                <?php
                // Ziel von „Eintrag erfassen“ wie in der unteren Leiste: aktuelles Fahrzeug bzw. das der Sitzung
                $erfassenUrl = $zielFahrzeug ? 'pages/eintrag_hinzufuegen.php?fahrzeug_id=' . urlencode($zielFahrzeug['id'])
                    : 'pages/fahrzeug_hinzufuegen.php';
                ?>
                <li class="me-2">
                    <a class="btn btn-primary" href="<?= htmlspecialchars($baseUrl . $erfassenUrl) ?>">
                        <i class="fas fa-plus" aria-hidden="true"></i><?= $zielFahrzeug ? 'Eintrag erfassen' : 'Fahrzeug hinzufügen' ?>
                    </a>
                </li>
                <li>
                    <a class="kopf-symbol<?= $tabbarAktiv === 'uebersicht' ? ' active' : '' ?>" href="<?= htmlspecialchars($baseUrl) ?>index.php" aria-label="Start" data-tipp="Start"<?= $tabbarAktiv === 'uebersicht' ? ' aria-current="page"' : '' ?>>
                        <i class="fas fa-house" aria-hidden="true"></i>
                    </a>
                </li>
                <?php if ($bereichFahrzeug): $bid = $bereichFahrzeug['id']; ?>
                <li>
                    <a class="kopf-symbol<?= $tabbarAktiv === 'eintraege' ? ' active' : '' ?>" href="<?= htmlspecialchars($baseUrl . fahrzeugSeite('eintraege', $bid)) ?>" aria-label="Einträge" data-tipp="Einträge"<?= $tabbarAktiv === 'eintraege' ? ' aria-current="page"' : '' ?>>
                        <i class="fas fa-list-ul" aria-hidden="true"></i>
                    </a>
                </li>
                <li>
                    <a class="kopf-symbol<?= $tabbarAktiv === 'statistik' ? ' active' : '' ?>" id="kopfStatistik" href="<?= htmlspecialchars($baseUrl . fahrzeugSeite('statistik', $bid)) ?>" aria-label="Statistik" data-tipp="Statistik"<?= $tabbarAktiv === 'statistik' ? ' aria-current="page"' : '' ?>>
                        <i class="fas fa-chart-line" aria-hidden="true"></i>
                    </a>
                </li>
                <!-- Weitere Ansichten des Fahrzeugs (#206, docs/design.md 7.7): am PC als Menü „Fahrzeug“ -->
                <li class="dropdown">
                    <?php $fahrzeugMenueAktiv = in_array($skript, ['service.php', 'fahrten.php', 'fahrzeugdaten.php', 'fahrzeug_bearbeiten.php'], true); ?>
                    <button type="button" class="kopf-symbol dropdown-toggle<?= $fahrzeugMenueAktiv ? ' active' : '' ?>" id="fahrzeugMenue" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Fahrzeug: Service, Fahrten, Fahrzeugdaten" data-tipp="Fahrzeug">
                        <i class="fas fa-car-side" aria-hidden="true"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="fahrzeugMenue">
                        <li><h6 class="dropdown-header text-truncate"><?= htmlspecialchars($bereichFahrzeug['modell']) ?></h6></li>
                        <?php foreach (['service' => ['fa-screwdriver-wrench', 'Service'], 'fahrten' => ['fa-route', 'Fahrten'], 'fahrzeugdaten' => ['fa-file-lines', 'Fahrzeugdaten']] as $ansicht => [$symbol, $name]): ?>
                        <li><a class="dropdown-item<?= $skript === $ansicht . '.php' ? ' active' : '' ?>" href="<?= htmlspecialchars($baseUrl . fahrzeugSeite($ansicht, $bid)) ?>"<?= $skript === $ansicht . '.php' ? ' aria-current="page"' : '' ?>><i class="fas <?= $symbol ?> fa-fw" aria-hidden="true"></i><?= $name ?></a></li>
                        <?php endforeach; ?>
                    </ul>
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
                            <div class="fs-headline text-truncate"><?= htmlspecialchars(($currentUser['username'] ?? '') ?: 'Profil') ?></div>
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
    <?php if ($bereichFahrzeug): ?>
    <a href="<?= htmlspecialchars($baseUrl . fahrzeugSeite('eintraege', $bereichFahrzeug['id'])) ?>" id="tabbarEintraege" class="tabbar-link<?= $tabbarAktiv === 'eintraege' ? ' active' : '' ?>"<?= $tabbarAktiv === 'eintraege' ? ' aria-current="page"' : '' ?>>
        <i class="fas fa-list-ul" aria-hidden="true"></i><span>Einträge</span>
    </a>
    <?php else: ?>
    <button type="button" id="tabbarEintraege" class="tabbar-link" disabled>
        <i class="fas fa-list-ul" aria-hidden="true"></i><span>Einträge</span>
    </button>
    <?php endif; ?>
    <?php if ($zielFahrzeug): ?>
    <a href="<?= htmlspecialchars($baseUrl) ?>pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($zielFahrzeug['id'])) ?>" class="tabbar-link tabbar-plus<?= $tabbarAktiv === 'eintrag' ? ' active' : '' ?>" aria-label="Eintrag erfassen">
        <span class="tabbar-kreis"><i class="fas fa-plus" aria-hidden="true"></i></span>
    </a>
    <?php else: ?>
    <a href="<?= htmlspecialchars($baseUrl) ?>pages/fahrzeug_hinzufuegen.php" class="tabbar-link tabbar-plus" aria-label="Fahrzeug hinzufügen">
        <span class="tabbar-kreis"><i class="fas fa-plus" aria-hidden="true"></i></span>
    </a>
    <?php endif; ?>
    <?php if ($bereichFahrzeug): // auch archivierte Fahrzeuge haben Statistiken ?>
    <a href="<?= htmlspecialchars($baseUrl . fahrzeugSeite('statistik', $bereichFahrzeug['id'])) ?>" id="tabbarStatistik" class="tabbar-link<?= $tabbarAktiv === 'statistik' ? ' active' : '' ?>"<?= $tabbarAktiv === 'statistik' ? ' aria-current="page"' : '' ?>>
        <i class="fas fa-chart-line" aria-hidden="true"></i><span>Statistik</span>
    </a>
    <?php else: ?>
    <button type="button" id="tabbarStatistik" class="tabbar-link" disabled>
        <i class="fas fa-chart-line" aria-hidden="true"></i><span>Statistik</span>
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
                <h2 class="offcanvas-title h5 mb-0 text-truncate" id="blattProfilTitel"><?= htmlspecialchars(($currentUser['username'] ?? '') ?: 'Profil') ?></h2>
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
