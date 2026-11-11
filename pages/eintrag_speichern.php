<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
$api = getApiClient();

$fahrzeug_id = trim($_POST['fahrzeug_id'] ?? '');
$eintragstyp = $_POST['eintragstyp'] ?? '';
$datum = $_POST['datum'] ?? null;
// Leer = Tachostand fehlt (#41): bei Tank-/Ladevorgängen und Ausgaben erlaubt, bei Fahrten nicht
$tachoEingabe = trim((string)($_POST['tachostand'] ?? ''));
$tachostand = $tachoEingabe !== '' ? (int)$tachoEingabe : null;
$tachoGeschaetzt = $tachostand !== null && !empty($_POST['tachostand_geschaetzt']);

$tachoPflicht = in_array($eintragstyp, ['Fahrt', 'Kilometerstand'], true);
if (!$fahrzeug_id || !$datum || ($tachostand === null && $tachoPflicht)) {
    $_SESSION['error_message'] = $tachoPflicht ? 'Datum und Tachostand sind erforderlich.' : 'Fahrzeug und Datum sind erforderlich.';
    header('Location: eintrag_hinzufuegen.php?fahrzeug_id=' . rawurlencode($fahrzeug_id));
    exit;
}

$dateTime = $datum . 'T12:00:00.000Z'; // ISO für API

try {
    if ($eintragstyp === 'Tankfuellung') {
        // Fehlt Menge oder Gesamtpreis, aus dem Preis pro Einheit berechnen; leer wird nie still zu 0
        $werte = mengeUndKostenAusFormular($_POST);
        if ($werte['fehler'] !== null) {
            $_SESSION['error_message'] = $werte['fehler'];
            header('Location: eintrag_hinzufuegen.php?fahrzeug_id=' . rawurlencode($fahrzeug_id));
            exit;
        }
        $menge = $werte['menge'];
        $kosten = $werte['kosten'];
        $station = trim($_POST['standort'] ?? '');
        $vollgetankt = isset($_POST['vollgetankt']);
        $skipPrevious = isset($_POST['skip_previous']);
        // Sorte (#140): die API leitet die Einheit daraus ab. Ohne Sorte wie bisher: Plug-in-Hybrid getankt (l) oder
        // geladen (kWh), sonst leitet die API die Einheit vom Fahrzeug ab
        $sorte = preg_match('/^[a-z0-9_]{1,30}$/', (string)($_POST['sorte'] ?? '')) ? $_POST['sorte'] : null;
        $einheit = $sorte === null && in_array($_POST['einheit'] ?? '', ['l', 'kwh'], true) ? $_POST['einheit'] : null;
        $api->postFillup([
            'vehicleId' => $fahrzeug_id,
            'odometerKm' => $tachostand,
            'odometerEstimated' => $tachoGeschaetzt,
            'amount' => $menge,
            'totalCostEur' => $kosten,
            'station' => $station !== '' ? $station : null,
            'filledAt' => $dateTime,
            'isFull' => $vollgetankt,
            'skipPrevious' => $skipPrevious,
        ] + ($einheit !== null ? ['unit' => $einheit] : []) + ($sorte !== null ? ['fuel' => $sorte] : []));
    } elseif ($eintragstyp === 'Andere Ausgabe') {
        $kategorie = trim($_POST['kategorie'] ?? '');
        $kosten = (float)($_POST['kosten'] ?? 0);
        $beschreibung = trim($_POST['beschreibung'] ?? '');
        if ($kategorie === '') {
            $_SESSION['error_message'] = 'Bitte eine Kategorie wählen.';
            header('Location: eintrag_hinzufuegen.php?fahrzeug_id=' . rawurlencode($fahrzeug_id));
            exit;
        }
        $api->postEntry([
            'vehicleId' => $fahrzeug_id,
            'category' => $kategorie,
            'amountEur' => $kosten,
            'odometerKm' => $tachostand,
            'occurredAt' => $dateTime,
            'description' => $beschreibung !== '' ? $beschreibung : null,
        ]);
    } elseif ($eintragstyp === 'Fahrt') {
        // Fahrtenbuch (#52): Tachostand ist der Stand am Ende der Fahrt; Start aus "km" oder dem Feld Startstand
        $km = trim(str_replace(',', '.', (string)($_POST['gefahrene_km'] ?? '')));
        $start = trim((string)($_POST['tachostand_start'] ?? ''));
        $zweck = (string)($_POST['fahrt_zweck'] ?? 'private');
        $api->postTrip(array_filter([
            'vehicleId' => $fahrzeug_id,
            'startedAt' => $dateTime,
            'odometerEnd' => $tachostand,
            'odometerStart' => is_numeric($start) ? (int)$start : null,
            'distanceKm' => !is_numeric($start) && is_numeric($km) ? (float)$km : null,
            'startPlace' => trim((string)($_POST['startort'] ?? '')) ?: null,
            'endPlace' => trim((string)($_POST['zielort'] ?? '')) ?: null,
            'purpose' => array_key_exists($zweck, fahrtZwecke()) ? $zweck : 'private',
            'note' => trim((string)($_POST['zweck'] ?? '')) ?: null,
        ], fn($v) => $v !== null));
    } elseif ($eintragstyp === 'Kilometerstand') {
        // Nur Tachostand notieren (#42): eigener Eintrag ohne Kosten
        $notiz = trim($_POST['beschreibung'] ?? '');
        $api->postEntry([
            'vehicleId' => $fahrzeug_id,
            'category' => 'Kilometerstand',
            'amountEur' => 0,
            'odometerKm' => $tachostand,
            'occurredAt' => $dateTime,
            'description' => $notiz !== '' ? $notiz : null,
        ]);
    } else {
        $_SESSION['error_message'] = 'Ungültiger Eintragstyp.';
        header('Location: eintrag_hinzufuegen.php?fahrzeug_id=' . rawurlencode($fahrzeug_id));
        exit;
    }
    $_SESSION['success_message'] = $eintragstyp === 'Tankfuellung' && ($tachostand === null || $tachoGeschaetzt)
        ? 'Eintrag gespeichert. Den Tachostand kannst du in der Eintragsliste nachtragen.'
        : ($eintragstyp === 'Kilometerstand' ? 'Kilometerstand notiert.' : 'Eintrag gespeichert.');
    // Schnellerfassung (#42): zuletzt genutztes Fahrzeug merken
    setcookie('fuelstat_fahrzeug', $fahrzeug_id, ['expires' => time() + 365 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Lax']);
    header('Location: fahrzeug_detail.php?id=' . rawurlencode($fahrzeug_id));
    exit;
} catch (Throwable $e) {
    $_SESSION['error_message'] = eintragFehlerText($e);
    header('Location: eintrag_hinzufuegen.php?fahrzeug_id=' . rawurlencode($fahrzeug_id));
    exit;
}
