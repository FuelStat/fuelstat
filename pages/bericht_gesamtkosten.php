<?php
// Druckansicht „Gesamtkosten“ (TCO, #79): Besitzzeit, laufende Kosten je Gruppe und Kategorie, Wertverlust, Kennzahlen.
// Über den Browser als PDF speichern. Alle Zahlen kommen aus GET /vehicles/:id/tco.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';

if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$fahrzeug_id = trim($_GET['id'] ?? '');
$api = getApiClient();
try {
    $fahrzeug = $api->getVehicle($fahrzeug_id);
    $tco = $api->getVehicleTco($fahrzeug_id);
} catch (Throwable $e) {
    http_response_code(404);
    exit('Fahrzeug nicht gefunden.');
}
$fuelType = (string)($fahrzeug['fuel_type'] ?? 'other');
$gruppen = kategorieGruppen();
$f2 = fn($v) => number_format((float)$v, 2, ',', '.');
$datum = fn($d) => $d ? date('d.m.Y', strtotime($d)) : '–';
$details = array_filter([
    trim(($fahrzeug['brand'] ?? '') . ' ' . ($fahrzeug['model'] ?? '')),
    !empty($fahrzeug['year']) ? 'Baujahr ' . (int)$fahrzeug['year'] : '',
    (getKraftstoffOptionen()[$fahrzeug['fuel_type'] ?? ''] ?? ''),
    ['sold' => 'verkauft', 'decommissioned' => 'stillgelegt'][$tco['status']] ?? '',
]);
$shareName = fn(string $k) => $k === 'wertverlust' ? 'Wertverlust' : ($gruppen[$k]['name'] ?? $k);
?>
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <title>Fuelstat-Gesamtkosten <?= htmlspecialchars($fahrzeug['name'] ?? '') ?></title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="<?= htmlspecialchars(assetUrl('../', 'vendor/bootstrap/bootstrap.min.css')) ?>" rel="stylesheet">
    <style>
        body { background: #fff; color: #212529; font-size: 0.9rem; }
        @media print { .no-print { display: none !important; } a { text-decoration: none; color: inherit; } }
        table { page-break-inside: auto; } tr { page-break-inside: avoid; }
    </style>
</head>
<body class="p-4">
    <div class="no-print mb-4 d-flex gap-2">
        <button class="btn btn-primary" onclick="window.print()">Drucken / als PDF speichern</button>
        <a class="btn btn-outline-secondary" href="fahrzeug_detail.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>#ausgaben">Zurück</a>
    </div>

    <h1 class="h3 mb-1">Gesamtkosten: <?= htmlspecialchars($fahrzeug['name'] ?? 'Fahrzeug') ?></h1>
    <p class="text-muted mb-4"><?= htmlspecialchars(implode(' · ', $details)) ?> · Besitzzeit: <?= $datum($tco['from']) ?> bis <?= $datum($tco['to']) ?><?= $tco['ownershipMonths'] !== null ? ' (' . number_format((float)$tco['ownershipMonths'], 1, ',', '.') . ' Monate)' : '' ?> · erstellt am <?= date('d.m.Y') ?></p>

    <h2 class="h5">Kennzahlen</h2>
    <table class="table table-sm table-bordered mb-4">
        <tbody>
            <tr><th scope="row">Gesamtkosten<?= $tco['complete'] ? '' : ' (ohne Wertverlust)' ?></th><td class="text-end"><?= $f2($tco['total']) ?> €</td></tr>
            <tr><th scope="row">Pro Monat</th><td class="text-end"><?= $tco['perMonth'] !== null ? $f2($tco['perMonth']) . ' €' : '–' ?></td></tr>
            <tr><th scope="row">Pro Kilometer</th><td class="text-end"><?= $tco['perKm'] !== null ? $f2($tco['perKm']) . ' €/km' : '–' ?></td></tr>
            <tr><th scope="row">Gefahrene Kilometer</th><td class="text-end"><?= $tco['distanceKm'] ? number_format((int)$tco['distanceKm'], 0, ',', '.') . ' km' : '–' ?></td></tr>
            <tr><th scope="row">Wertverlust pro Jahr</th><td class="text-end"><?= $tco['valueLossPerYear'] !== null ? $f2($tco['valueLossPerYear']) . ' €' : '–' ?></td></tr>
        </tbody>
    </table>

    <h2 class="h5">Wertverlust</h2>
    <table class="table table-sm table-bordered mb-4">
        <tbody>
            <tr><th scope="row">Kaufpreis<?= $tco['purchase']['date'] ? ' (' . $datum($tco['purchase']['date']) . ')' : '' ?></th><td class="text-end"><?= $tco['purchase']['price'] !== null ? $f2($tco['purchase']['price']) . ' €' : 'nicht angegeben' ?></td></tr>
            <?php if ($tco['sale'] !== null): ?>
            <tr><th scope="row">Verkaufserlös<?= $tco['sale']['date'] ? ' (' . $datum($tco['sale']['date']) . ')' : '' ?></th><td class="text-end"><?= $tco['sale']['price'] !== null ? $f2($tco['sale']['price']) . ' €' : 'nicht angegeben' ?></td></tr>
            <?php else: ?>
            <tr><th scope="row">Geschätzter Restwert</th><td class="text-end"><?= $tco['residualValue'] !== null ? $f2($tco['residualValue']) . ' €' : 'nicht angegeben' ?></td></tr>
            <?php endif; ?>
            <tr><th scope="row">Wertverlust</th><td class="text-end"><?= $tco['valueLoss'] !== null ? $f2($tco['valueLoss']) . ' €' : 'nicht berechenbar' ?></td></tr>
        </tbody>
    </table>

    <h2 class="h5">Kosten nach Kostengruppe</h2>
    <table class="table table-sm table-bordered mb-4">
        <thead><tr><th>Gruppe</th><th class="text-end">Einträge</th><th class="text-end">Anteil</th><th class="text-end">Summe</th></tr></thead>
        <tbody>
        <?php foreach ($tco['running']['groups'] as $g): if ($g['count'] === 0) continue; ?>
            <tr><td><?= htmlspecialchars($gruppen[$g['key']]['name'] ?? $g['key']) ?></td><td class="text-end"><?= $g['count'] ?></td><td class="text-end"><?= $g['share'] !== null ? $f2($g['share']) . ' %' : '–' ?></td><td class="text-end"><?= $f2($g['total']) ?> €</td></tr>
        <?php endforeach; ?>
        </tbody>
        <tfoot><tr><th colspan="3">Laufende Kosten</th><th class="text-end"><?= $f2($tco['running']['total']) ?> €</th></tr></tfoot>
    </table>

    <h2 class="h5">Kosten nach Kategorie</h2>
    <table class="table table-sm table-bordered mb-4">
        <thead><tr><th>Kategorie</th><th class="text-end">Einträge</th><th class="text-end">Anteil an den Gesamtkosten</th><th class="text-end">Summe</th></tr></thead>
        <tbody>
        <?php foreach ($tco['categories'] as $k): [$kat, $einheit] = str_starts_with($k['key'], 'Tankfuellung:') ? ['Tankfuellung', substr($k['key'], 13)] : [$k['key'], null]; ?>
            <tr><td><?= htmlspecialchars(getKategorieName($kat, $fuelType, $einheit)) ?></td><td class="text-end"><?= $k['count'] ?></td><td class="text-end"><?= $k['share'] !== null ? $f2($k['share']) . ' %' : '–' ?></td><td class="text-end"><?= $f2($k['total']) ?> €</td></tr>
        <?php endforeach; ?>
        <?php if ($tco['valueLoss'] !== null && $tco['valueLoss'] > 0): ?>
            <tr><td>Wertverlust</td><td class="text-end">–</td><td class="text-end"><?= $tco['total'] > 0 ? $f2($tco['valueLoss'] / $tco['total'] * 100) . ' %' : '–' ?></td><td class="text-end"><?= $f2($tco['valueLoss']) ?> €</td></tr>
        <?php endif; ?>
        </tbody>
        <tfoot><tr><th colspan="3">Gesamtkosten</th><th class="text-end"><?= $f2($tco['total']) ?> €</th></tr></tfoot>
    </table>
    <p class="text-muted small">Berechnet von Fuelstat aus den gebuchten Ausgaben (auch Leasing- und Finanzierungsraten) plus Wertverlust. Fehlen Kaufpreis oder Restwert bzw. Verkaufserlös, bleibt der Wertverlust unberücksichtigt.</p>
</body>
</html>
