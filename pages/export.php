<?php
// CSV-Export aller Einträge eines Fahrzeugs (Semikolon + UTF-8-BOM, damit Excel es direkt öffnet)
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';

if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$fahrzeug_id = trim($_GET['id'] ?? '');
$jahr = isset($_GET['jahr']) && $_GET['jahr'] !== '' ? (int)$_GET['jahr'] : null;

$api = getApiClient();
try {
    $fahrzeug = $api->getVehicle($fahrzeug_id);
} catch (Throwable $e) {
    http_response_code(404);
    exit('Fahrzeug nicht gefunden.');
}
$einheit = einheitKurz(getEinheitFuerKraftstoff($fahrzeug['fuel_type'] ?? null));
$fuelType = (string)($fahrzeug['fuel_type'] ?? 'other');
$begriffe = verbrauchsBegriffe($fuelType);

$zeilen = [];
foreach (getMergedEintraegeFromApi($api, $fahrzeug_id)['eintraege'] as $monatsEintraege) {
    foreach ($monatsEintraege as $e) {
        if ($jahr === null || (int)substr($e['datum'], 0, 4) === $jahr) {
            $zeilen[] = $e;
        }
    }
}
usort($zeilen, fn($a, $b) => strcmp($a['datum'], $b['datum']));

// Texte, die Excel als Formel ausführen würde (=, +, -, @ …), mit Apostroph entschärfen
$text = fn($wert) => preg_match('/^[=+\-@\t\r]/', (string)$wert) ? "'" . $wert : (string)$wert;
$zahl = fn($wert, int $stellen) => $wert === null || $wert === '' ? '' : number_format((float)$wert, $stellen, ',', '');
$dateiname = preg_replace('/[^A-Za-z0-9_-]+/', '_', $fahrzeug['name'] ?? 'fahrzeug') . ($jahr ? '_' . $jahr : '') . '.csv';

header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $dateiname . '"');
$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF");
// Plug-in-Hybrid: Liter und kWh in einer Datei, deshalb eigene Spalte "Einheit" (wird beim Import wieder erkannt)
$phev = $fuelType === 'phev';
// Mehrere Sorten (#140): Spalte "Sorte" (wird beim Import wieder erkannt)
$mitSorte = count(sortenDesFahrzeugs($fahrzeug)) > 1;
$kopf = $phev
    ? ['Datum', 'Kategorie', 'Tachostand (km)', 'Menge', 'Einheit', 'Kosten (EUR)', 'Voll', 'Lücke davor', 'Verbrauch (pro 100km)', 'Ort/Anbieter', 'Beschreibung']
    : ['Datum', 'Kategorie', 'Tachostand (km)', 'Menge (' . $einheit . ')', 'Kosten (EUR)', $begriffe['voll'], 'Lücke davor', 'Verbrauch (' . $einheit . '/100km)', 'Ort/Anbieter', 'Beschreibung'];
if ($mitSorte) {
    array_splice($kopf, 4, 0, ['Sorte']);
}
fputcsv($out, $kopf, ';');
foreach ($zeilen as $e) {
    $istTank = $e['kategorie'] === 'Tankfuellung';
    fputcsv($out, array_merge([
        date('d.m.Y', strtotime($e['datum'])),
        $text(getKategorieName($e['kategorie'], $fuelType, $e['einheit'] ?? null)),
        $e['tachostand'] ?? '',
        $istTank ? $zahl($e['menge'], 2) : '',
    ], $mitSorte ? [$istTank && !empty($e['sorte']) ? $text(sortenName($e['sorte'])) : ''] : [], $phev ? [$istTank ? einheitKurz($e['einheit'] ?? 'l') : ''] : [], [
        $zahl($e['kosten'], 2),
        $istTank ? (!empty($e['vollgetankt']) ? 'ja' : 'nein') : '',
        $istTank ? (!empty($e['skip_previous']) ? 'ja' : 'nein') : '',
        $istTank ? $zahl($e['l_per_100km'] ?? null, 2) : '',
        $text($e['standort'] ?? ''),
        $text($e['beschreibung'] ?? ''),
    ]), ';');
}
fclose($out);
