<?php
// Druckansicht / PDF-Bericht für ein Fahrzeug (über den Browser als PDF speichern)
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
$daten = getStatistikDatenFromApi($api, $fahrzeug_id, $jahr);
$jahresdaten = $jahr === null ? $daten['jahresdaten'] : array_intersect_key($daten['jahresdaten'], [$jahr => true]);
$kategorien = $daten['detailAusgabenDaten'];
uasort($kategorien, fn($a, $b) => $b['summe'] <=> $a['summe']);
$gesamt = array_sum(array_column($kategorien, 'summe'));

$eintraege = [];
foreach (getMergedEintraegeFromApi($api, $fahrzeug_id)['eintraege'] as $monatsEintraege) {
    foreach ($monatsEintraege as $e) {
        if ($jahr === null || (int)substr($e['datum'], 0, 4) === $jahr) {
            $eintraege[] = $e;
        }
    }
}
usort($eintraege, fn($a, $b) => strcmp($a['datum'], $b['datum']));
// Jahresübersicht je Einheit (Plug-in-Hybrid: eine Tabelle für Kraftstoff, eine für Strom)
$tabellen = [];
foreach ($daten['einheiten'] ?: [getEinheitFuerKraftstoff($fuelType) => ['jahresdaten' => $daten['jahresdaten']]] as $u => $ud) {
    $tabellen[$u] = [
        'kurz' => einheitKurz($u),
        'begriffe' => begriffeFuerEinheit($fuelType, $u),
        'faktor' => $ud['api']['co2']['factor'] ?? null,
        'jahre' => $jahr === null ? $ud['jahresdaten'] : array_intersect_key($ud['jahresdaten'], [$jahr => true]),
    ];
}
$details = array_filter([
    trim(($fahrzeug['brand'] ?? '') . ' ' . ($fahrzeug['model'] ?? '')),
    !empty($fahrzeug['year']) ? 'Baujahr ' . (int)$fahrzeug['year'] : '',
    (getKraftstoffOptionen()[$fahrzeug['fuel_type'] ?? ''] ?? ''),
]);
$f2 = fn($v) => number_format((float)$v, 2, ',', '.');
?>
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <title>Fuelstat-Bericht <?= htmlspecialchars($fahrzeug['name'] ?? '') ?><?= $jahr ? ' ' . $jahr : '' ?></title>
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
        <a class="btn btn-outline-secondary" href="fahrzeug_detail.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>">Zurück</a>
    </div>

    <h1 class="h3 mb-1"><?= htmlspecialchars($fahrzeug['name'] ?? 'Fahrzeug') ?></h1>
    <p class="text-muted mb-4"><?= htmlspecialchars(implode(' · ', $details)) ?> · Zeitraum: <?= $jahr ?: 'gesamt' ?> · erstellt am <?= date('d.m.Y') ?></p>

    <?php foreach ($tabellen as $t): ?>
    <h2 class="h5">Jahresübersicht<?= count($tabellen) > 1 ? ' ' . $t['begriffe']['energie'] : '' ?></h2>
    <table class="table table-sm table-bordered mb-4">
        <thead><tr><th>Jahr</th><th><?= $t['begriffe']['vorgaenge'] ?></th><th><?= $t['begriffe']['menge'] ?> (<?= $t['kurz'] ?>)</th><th><?= $t['begriffe']['kosten'] ?></th><th>Ø <?= $t['kurz'] ?>/100km</th><?php if ($t['faktor'] !== null): ?><th>CO₂</th><?php endif; ?></tr></thead>
        <tbody>
        <?php foreach ($t['jahre'] as $y => $d): ?>
            <tr>
                <td><?= $y ?></td>
                <td><?= $d['anzahl_tankstops'] ?></td>
                <td><?= $f2($d['gekauft_menge']) ?></td>
                <td><?= $f2($d['gekauft_ausgaben']) ?> €</td>
                <td><?= $d['verbrauch_l100km'] > 0 ? $f2($d['verbrauch_l100km']) : '–' ?></td>
                <?php if ($t['faktor'] !== null): ?><td><?= number_format((float)($d['co2_kg'] ?? 0), 0, ',', '.') ?> kg</td><?php endif; ?>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <?php endforeach; ?>

    <h2 class="h5">Kosten nach Kategorie</h2>
    <table class="table table-sm table-bordered mb-4">
        <thead><tr><th>Kategorie</th><th>Einträge</th><th>Anteil</th><th>Summe</th></tr></thead>
        <tbody>
        <?php foreach ($kategorien as $kat => $d): ?>
            <tr>
                <td><?= htmlspecialchars(getKategorieName($kat, $fuelType)) ?></td>
                <td><?= $d['anzahl'] ?></td>
                <td><?= $gesamt > 0 ? $f2($d['summe'] / $gesamt * 100) : '0,00' ?> %</td>
                <td><?= $f2($d['summe']) ?> €</td>
            </tr>
        <?php endforeach; ?>
        </tbody>
        <tfoot><tr><th colspan="3">Gesamt</th><th><?= $f2($gesamt) ?> €</th></tr></tfoot>
    </table>

    <h2 class="h5">Alle Einträge</h2>
    <table class="table table-sm table-striped">
        <thead><tr><th>Datum</th><th>Kategorie</th><th>km</th><th>Menge</th><th><?= count($tabellen) > 1 ? 'pro 100 km' : $einheit . '/100km' ?></th><th>Kosten</th><th>Ort / Beschreibung</th></tr></thead>
        <tbody>
        <?php foreach ($eintraege as $e):
            $istTank = $e['kategorie'] === 'Tankfuellung';
            $eEinheit = $e['einheit'] ?? null;
            $eKurz = $eEinheit !== null ? einheitKurz($eEinheit) : $einheit; ?>
            <tr>
                <td><?= date('d.m.Y', strtotime($e['datum'])) ?></td>
                <td><?= htmlspecialchars(getKategorieName($e['kategorie'], $fuelType, $eEinheit)) ?><?= $istTank && empty($e['vollgetankt']) ? ' (' . begriffeFuerEinheit($fuelType, $eEinheit)['teil'] . ')' : '' ?></td>
                <td><?= $e['tachostand'] !== null ? number_format((int)$e['tachostand'], 0, ',', '.') : '' ?></td>
                <td><?= $istTank ? $f2($e['menge']) . ' ' . $eKurz : '' ?></td>
                <td><?= $istTank && isset($e['l_per_100km']) ? $f2($e['l_per_100km']) . (count($tabellen) > 1 ? ' ' . $eKurz : '') : '' ?></td>
                <td><?= $f2($e['kosten']) ?> €</td>
                <td><?= htmlspecialchars(trim(($e['standort'] ?? '') . ' ' . ($e['beschreibung'] ?? ''))) ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</body>
</html>
