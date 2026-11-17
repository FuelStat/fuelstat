<?php
// Früher die Fahrzeugseite mit sieben Reitern; seit #206 (docs/design.md 7.2) sind die Ansichten eigene Seiten und die
// Übersicht ist Start. Alte Links (Lesezeichen, Mails, Push, installierte Kürzel) führen hierher und werden
// weitergeleitet. Der #Reiter kommt nicht beim Server an, deshalb entscheidet ein kleines Skript im Browser.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$id = (string)($_GET['id'] ?? '');
if ($id === '') {
    header('Location: ../index.php');
    exit;
}
try {
    $fz = getApiClient()->getVehicle($id);
} catch (Throwable $e) {
    $fz = null;
}
// Unbekannt oder kein Zugriff: die Ansicht zeigt dafür einen eigenen Hinweis
$aktiv = $fz !== null && ($fz['status'] ?? 'active') === 'active';
$rest = $_GET;
unset($rest['id']);
$ziel = fn(string $ansicht) => '../' . fahrzeugSeite($ansicht, $id, $rest);
// Übersicht: Start mit diesem Fahrzeug; archivierte Fahrzeuge stehen nicht auf Start, sie landen in den Fahrzeugdaten
$standard = $aktiv ? $ziel('uebersicht') : $ziel('fahrzeugdaten');
$ziele = [
    '#eintraege' => $ziel('eintraege'),
    '#statistiken' => $ziel('statistik'),
    '#ausgaben' => $ziel('kosten'),
    '#service' => $ziel('service'),
    '#fahrten' => $ziel('fahrten'),
    '#einstellungen' => $ziel('fahrzeugdaten'),
];
header('Cache-Control: no-store');
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Weiterleitung – Fuelstat</title>
<script>
  (function () {
    var ziele = <?= json_encode($ziele, JSON_UNESCAPED_SLASHES) ?>;
    location.replace(ziele[location.hash] || <?= json_encode($standard, JSON_UNESCAPED_SLASHES) ?>);
  })();
</script>
</head>
<body>
<p><a href="<?= htmlspecialchars($standard) ?>">Weiter zum Fahrzeug</a></p>
</body>
</html>
