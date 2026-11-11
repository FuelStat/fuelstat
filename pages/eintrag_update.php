<?php
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';
$api = getApiClient();

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_POST['id'], $_POST['fahrzeug_id'])) {
    header('Location: ../index.php');
    exit;
}
$eintrag_id = trim($_POST['id']);
$fahrzeug_id = trim($_POST['fahrzeug_id']);
$type = $_POST['type'] ?? 'fillup';

if ($type === 'entry') {
    $datum = $_POST['datum'] ?? '';
    $tachostand = trim($_POST['tachostand'] ?? '');
    $kategorie = trim($_POST['kategorie'] ?? '');
    $art = kategorieFormular($kategorie);
    $daten = [
        'category' => $kategorie,
        'odometerKm' => $tachostand !== '' ? (int)$tachostand : null,
        'occurredAt' => $datum . 'T12:00:00.000Z',
    ];
    if ($art === 'trip') {
        // Fahrt (#43): Von/Nach/Zweck/km stehen in der Beschreibung
        $daten += ['amountEur' => 0, 'vendor' => null, 'description' => fahrtBeschreibung($_POST)];
    } elseif ($art === 'odometer') {
        $notiz = trim($_POST['beschreibung'] ?? '');
        $daten += ['amountEur' => 0, 'vendor' => null, 'description' => $notiz !== '' ? $notiz : null];
    } else {
        $standort = trim($_POST['standort'] ?? '');
        $beschreibung = trim($_POST['beschreibung'] ?? '');
        $daten += [
            'amountEur' => (float)str_replace(',', '.', (string)($_POST['kosten'] ?? 0)),
            'vendor' => $standort !== '' ? $standort : null,
            'description' => $beschreibung !== '' ? $beschreibung : null,
        ];
    }
    try {
        $api->patchEntry($eintrag_id, $daten);
        $_SESSION['success_message'] = (['trip' => 'Fahrt', 'odometer' => 'Kilometerstand'][$art] ?? 'Ausgabe') . ' aktualisiert.';
    } catch (Throwable $e) {
        $_SESSION['error_message'] = eintragFehlerText($e);
        header('Location: eintrag_bearbeiten.php?id=' . rawurlencode($eintrag_id) . '&fahrzeug_id=' . rawurlencode($fahrzeug_id) . '&type=entry');
        exit;
    }
    header('Location: fahrzeug_detail.php?id=' . rawurlencode($fahrzeug_id) . '#eintraege');
    exit;
}

$datum = $_POST['datum'] ?? '';
// Leer = Tachostand fehlt (#41); ein unveränderter geschätzter Wert bleibt als Schätzung markiert
$tachoEingabe = trim((string)($_POST['tachostand'] ?? ''));
$tachostand = $tachoEingabe !== '' ? (int)$tachoEingabe : null;
$tachoGeschaetzt = $tachostand !== null && isset($_POST['tachostand_geschaetzt_wert'])
    && (int)$_POST['tachostand_geschaetzt_wert'] === $tachostand;
// Fehlt Menge oder Gesamtpreis, aus dem Preis pro Einheit berechnen; leer wird nie still zu 0
$werte = mengeUndKostenAusFormular($_POST);
if ($werte['fehler'] !== null) {
    $_SESSION['error_message'] = $werte['fehler'];
    header('Location: eintrag_bearbeiten.php?id=' . rawurlencode($eintrag_id) . '&fahrzeug_id=' . rawurlencode($fahrzeug_id) . '&type=fillup');
    exit;
}
$menge = $werte['menge'];
$kosten = $werte['kosten'];
$standort = trim($_POST['standort'] ?? '');
$vollgetankt = isset($_POST['vollgetankt']);
$skipPrevious = isset($_POST['skip_previous']);
$filledAt = $datum ? $datum . 'T12:00:00.000Z' : null;

try {
    // Einheit aus dem Kraftstoff des Fahrzeugs (korrigiert auch früher falsch als Liter gespeicherte Einträge);
    // Plug-in-Hybride wählen sie im Formular (getankt oder geladen)
    $vehicle = $api->getVehicle($fahrzeug_id);
    $einheiten = einheitenFuerKraftstoff($vehicle['fuel_type'] ?? null);
    $einheit = in_array($_POST['einheit'] ?? '', $einheiten, true) ? $_POST['einheit'] : $einheiten[0];
    // Sorte (#140): bestimmt die Einheit; ohne Sorte (Katalog nicht erreichbar) wie bisher die Einheit
    $sorte = preg_match('/^[a-z0-9_]{1,30}$/', (string)($_POST['sorte'] ?? '')) ? $_POST['sorte'] : null;
    if ($sorte !== null) {
        $einheit = sortenKatalog()['sorten'][$sorte]['unit'] ?? $einheit;
    }
    $api->patchFillup($eintrag_id, ($sorte !== null ? ['fuel' => $sorte] : ['unit' => $einheit]) + [
        'odometerKm' => $tachostand,
        'odometerEstimated' => $tachoGeschaetzt,
        'amount' => $menge,
        'totalCostEur' => $kosten,
        'station' => $standort !== '' ? $standort : null,
        'filledAt' => $filledAt,
        'isFull' => $vollgetankt,
        'skipPrevious' => $skipPrevious,
    ]);
    $_SESSION['success_message'] = begriffeFuerEinheit($vehicle['fuel_type'] ?? 'other', $einheit)['vorgang'] . ' aktualisiert.';
} catch (Throwable $e) {
    $_SESSION['error_message'] = $e->getMessage() === 'fillup_edit_window_expired'
        ? 'Tank- und Ladevorgänge können nur innerhalb von 14 Tagen bearbeitet werden. Ältere Einträge kannst du löschen und neu anlegen.'
        : $e->getMessage();
}
header('Location: fahrzeug_detail.php?id=' . rawurlencode($fahrzeug_id));
exit;
