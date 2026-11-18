<?php
include_once __DIR__ . '/../includes/functions.php';
include_once __DIR__ . '/../includes/api_helpers.php';

if (!isset($fahrzeug_id) && isset($_GET['id'])) {
    $fahrzeug_id = $_GET['id'];
}
if (!isset($fahrzeug_id)) {
    die('Fahrzeug-ID fehlt.');
}

$d = getStatistikDatenFromApi($api, $fahrzeug_id);
$verbrauchswerte = $d['verbrauchswerte'];
$verbrauchProMonat = $d['verbrauchProMonat'];
$kostenProMonat = $d['kostenProMonat'];
$jahresdaten = $d['jahresdaten'];
// Energiekosten pro km rechnet die API (#124): Kosten aller Tank-/Ladevorgänge mit echtem Tachostand nach dem
// ersten, geteilt durch die Strecke dazwischen.
$kraftstoffKostenProKm = $d['kosten']['costPerKm']['energy'] ?? null;

$fuelTypeStat = (string)($fahrzeug['fuel_type'] ?? '');
$zahl = fn($wert, int $stellen = 2) => number_format((float)$wert, $stellen, ',', '.');
// Kennzahlen je Einheit kommen fertig aus der API (#82); Plug-in-Hybride haben zwei Einheiten (Liter und kWh)
$einheitenDaten = $d['einheiten'] ?: [getEinheitFuerKraftstoff($fuelTypeStat) => ['verbrauchswerte' => [], 'verbrauchProMonat' => [], 'jahresdaten' => $jahresdaten, 'api' => null]];
$mehrereEinheiten = count($einheitenDaten) > 1;
$proEinheit = [];
foreach ($einheitenDaten as $u => $ud) {
    $a = $ud['api'] ?? [];
    $monate = array_filter($ud['verbrauchProMonat'], fn($v) => $v > 0);
    ksort($monate);
    $einheitDerReihe = $ud['einheit'] ?? $u;
    $begriffeDerReihe = !empty($ud['energie']) ? begriffeFuerEnergie($ud['energie']) : begriffeFuerEinheit($fuelTypeStat, $u);
    $proEinheit[$u] = [
        'kurz' => einheitKurz($einheitDerReihe),
        'einheit' => $einheitDerReihe,
        'begriffe' => $begriffeDerReihe,
        // Name der Energieart (Benzin, Autogas, Strom …), sonst wie bisher nach Antrieb
        'name' => $ud['name'] ?? $begriffeDerReihe['energie'],
        'nebenbei' => !empty($ud['nebenbei']),
        'werte' => $ud['verbrauchswerte'],
        'monate' => $monate,
        'jahre' => $ud['jahresdaten'],
        'schnitt' => $a['avg'] ?? null,
        // Summenmethode (#25): kein Abschnitt (kein voller Eintrag, kein Ladestand), Ø aus der Summe aller Mengen ÷ Strecke
        'summe' => ($a['avgMethod'] ?? null) === 'sum',
        'min' => $a['min'] ?? null,
        'max' => $a['max'] ?? null,
        'gekauft' => (float)($a['amountBought'] ?? 0),
        'kosten' => (float)($a['cost'] ?? 0),
        'preis' => $a['avgPrice'] ?? null,
        // CO₂: gekaufte Menge × Emissionsfaktor (API)
        'co2_faktor' => $a['co2']['factor'] ?? null,
        // vehicle: eigener Wert des Fahrzeugs für Strom (#25), default: Standardwert der API
        'co2_quelle' => $a['co2']['source'] ?? null,
        'co2' => $a['co2']['totalKg'] ?? null,
    ];
}
// Hauptwerte: die erste Energieart, die nicht nur nebenbei getankt wird
$hauptEinheit = array_key_first(array_filter($proEinheit, fn($p) => !$p['nebenbei'])) ?? array_key_first($proEinheit);
$haupt = $proEinheit[$hauptEinheit];
// Diagramme ohne nebenbei getankte Energiearten (deren Verbrauch über die Gesamtstrecke sagt wenig)
$proEinheitDiagramm = array_filter($proEinheit, fn($p) => !$p['nebenbei']);
// Preise je Sorte (#140): nur wo eine Energieart mehrere Sorten hat (E5/E10, Diesel/Premium-Diesel) oder eine
// Premium-Sorte; bei Benzin + Autogas zeigen die Kennzahlen je Energieart schon alles
$sortenPreise = array_values($d['verbrauch']['byFuel'] ?? []);
$sortenJeEnergie = array_count_values(array_column($sortenPreise, 'energy'));
if (!array_filter($sortenJeEnergie, fn($n) => $n > 1) && !array_filter($sortenPreise, fn($s) => !empty($s['premium']))) {
    $sortenPreise = [];
}

// Summen über alle Einheiten (Plug-in-Hybrid: Kraftstoff und Strom) aus der API
$co2Faktor = $haupt['co2_faktor'];
$co2Gesamt = $d['verbrauch']['co2']['totalKg'] ?? null;
$co2ProKm = $d['verbrauch']['co2']['gPerKm'] ?? null;
$durchschnittPreis = $haupt['preis'];
$minVerbrauch = $haupt['min'];
$maxVerbrauch = $haupt['max'];
$durchschnittVerbrauch = $haupt['schnitt'];
$gekauftMenge = $haupt['gekauft'];
$gekauftKosten = $haupt['kosten'];
$verbrauchswerte = $haupt['werte'];
$energieKosten = (float)($d['verbrauch']['energyCost'] ?? array_sum(array_column($proEinheit, 'kosten')));
$stromAnteil = $d['verbrauch']['electricShare'] ?? null;

ksort($kostenProMonat);

// Plug-in-Hybrid (#156): €/100 km ist die Hauptkennzahl, die API legt das fest (primary). Je Monat und Jahr aus
// costPer100kmPeriods; l/100 km und kWh/100 km bleiben als weitere Kennzahlen daneben.
$kostenHaupt = kostenKennzahlHtml($d['verbrauch'] ?? []);
$ratePerioden = $d['verbrauch']['costPer100kmPeriods'] ?? [];
$rateJahre = array_column($ratePerioden['years'] ?? [], null, 'period');
$rateMonate = array_values(array_filter(array_reverse($ratePerioden['months'] ?? []), fn($m) => $m['costPer100km'] !== null));
$kostenTile = function () use ($kostenHaupt, $energieKosten, $stromAnteil, $zahl, $ratePerioden) {
    ob_start(); ?>
        <div>
            <div class="kennzahl">
                <div class="small text-body-secondary">Energiekosten</div>
                <div class="kennzahl-wert"><?= $kostenHaupt ?? leerWert() ?></div>
                <div class="small text-body-secondary"><?= $zahl($energieKosten) ?> €<?php if ($stromAnteil !== null): ?>, davon Strom <?= $zahl($stromAnteil, 0) ?> %<?php endif; ?></div>
            </div>
        </div>
    <?php return ob_get_clean();
};
$verbrauchProMonatFormatted = formatLabels($haupt['monate']);
$kostenProMonatFormatted = formatLabels($kostenProMonat);

// Bester, schlechtester und teuerster Monat (beim Plug-in-Hybrid nach dem Kraftstoff)
$highlights = [];
$hauptZusatz = $mehrereEinheiten ? ' (' . $haupt['name'] . ')' : '';
if ($verbrauchProMonatFormatted) {
    $wert = min($verbrauchProMonatFormatted);
    $highlights[] = ['fa-arrow-trend-down', 'success', 'Sparsamster Monat' . $hauptZusatz, array_search($wert, $verbrauchProMonatFormatted), number_format($wert, 2, ',', '.') . ' ' . $haupt['kurz'] . '/100 km'];
    $wert = max($verbrauchProMonatFormatted);
    $highlights[] = ['fa-arrow-trend-up', 'danger', 'Durstigster Monat' . $hauptZusatz, array_search($wert, $verbrauchProMonatFormatted), number_format($wert, 2, ',', '.') . ' ' . $haupt['kurz'] . '/100 km'];
}
if ($kostenHaupt !== null && !empty($ratePerioden['best']) && !empty($ratePerioden['worst'])) {
    // Günstigster und teuerster Monat nach €/100 km (nur Monate mit genug Strecke), vor den Verbrauchswerten
    array_unshift(
        $highlights,
        ['fa-arrow-trend-down', 'success', 'Niedrigste Energiekosten', formatMonat($ratePerioden['best']['period']), number_format($ratePerioden['best']['costPer100km'], 2, ',', '.') . ' €/100 km'],
        ['fa-arrow-trend-up', 'danger', 'Höchste Energiekosten', formatMonat($ratePerioden['worst']['period']), number_format($ratePerioden['worst']['costPer100km'], 2, ',', '.') . ' €/100 km']
    );
}
if ($kostenProMonatFormatted) {
    $wert = max($kostenProMonatFormatted);
    $highlights[] = ['fa-euro-sign', 'warning', 'Teuerster Monat', array_search($wert, $kostenProMonatFormatted), number_format($wert, 2, ',', '.') . ' €'];
}

// Monatsverbrauch aller Einheiten auf gemeinsamer Zeitachse (Plug-in-Hybrid: zwei Balken je Monat)
$alleMonate = [];
foreach ($proEinheitDiagramm as $p) {
    $alleMonate += $p['monate'];
}
ksort($alleMonate);
$monatsLabels = array_map(fn($m) => formatMonat($m), array_keys($alleMonate));

// Diagramm-Beschriftung: Datum kurz (25.11.24)
$kurzDatum = fn(array $werte) => array_map(fn($datum) => date('d.m.y', strtotime(substr($datum, 0, 10))), array_keys($werte));

$co2Hinweise = [];
foreach ($proEinheit as $u => $p) {
    if ($p['co2_faktor'] === null) continue;
    $co2Hinweise[] = $p['einheit'] === 'kwh'
        ? (($p['co2_quelle'] ?? null) === 'vehicle'
            ? 'Strom mit dem eigenen Wert des Fahrzeugs (' . $zahl($p['co2_faktor'], 3) . ' kg CO₂/kWh)'
            : 'Strom mit dem deutschen Strommix (' . $zahl($p['co2_faktor'], 3) . ' kg CO₂/kWh)')
        : 'Direkte Emission bei der Verbrennung (' . $zahl($p['co2_faktor']) . ' kg CO₂/' . $p['kurz'] . ')';
}
$co2Hinweis = 'Berechnet: ' . implode(', ', $co2Hinweise);
// Jahresübersicht: Jahre ohne Tank- oder Ladevorgang (nur andere Ausgaben) weglassen
$tankJahre = array_filter($jahresdaten, fn($jahr) => array_filter($proEinheit, fn($p) => ($p['jahre'][$jahr]['anzahl_tankstops'] ?? 0) > 0), ARRAY_FILTER_USE_KEY);
$jahrWerte = function (int $jahr) use ($proEinheit) {
    $kosten = 0.0;
    $co2 = null;
    foreach ($proEinheit as $p) {
        $j = $p['jahre'][$jahr] ?? null;
        if (!$j) continue;
        $kosten += $j['gekauft_ausgaben'];
        if (($j['co2_kg'] ?? null) !== null) {
            $co2 = ($co2 ?? 0) + $j['co2_kg'];
        }
    }
    return ['kosten' => $kosten, 'co2' => $co2];
};
?>

<div class="mt-3 mt-lg-4">
    <?php if (!$jahresdaten): ?>
        <!-- EmptyState: Symbol, ein Satz, eine Aktion (docs/design.md 8.1) -->
        <div class="card leer-zustand mx-auto">
            <div class="card-body">
                <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-chart-line"></i></span>
                <h2>Noch keine Statistik</h2>
                <p class="text-body-secondary mb-3">Ab zwei vollen <?= htmlspecialchars($begriffe['vorgaengen']) ?> siehst du hier Verbrauch und Kosten.</p>
                <?php if (!empty($darfErfassen)): ?>
                <a href="../pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-primary">Eintrag erfassen</a>
                <?php endif; ?>
            </div>
        </div>
    <?php else: ?>

    <!-- Kennzahlen -->
    <div class="kennzahl-raster kennzahl-raster-4 kennzahl-raster-weit mb-3">
        <?php if ($mehrereEinheiten): ?>
        <?php if ($kostenHaupt !== null) { echo $kostenTile(); } ?>
        <?php foreach ($proEinheit as $u => $p): ?>
        <div>
            <div class="kennzahl">
                <div class="small text-body-secondary">Ø <?= htmlspecialchars($p['name']) ?></div>
                <?php if ($p['nebenbei']): ?>
                <div class="kennzahl-wert"><?= leerWert() ?></div>
                <div class="small text-body-secondary">nur gelegentlich · <?= $zahl($p['gekauft'], 0) ?> <?= $p['kurz'] ?></div>
                <?php else: ?>
                <div class="kennzahl-wert"><?= $p['schnitt'] !== null ? $zahl($p['schnitt']) . ' <small class="fw-normal">' . $p['kurz'] . '/100 km</small>' : leerWert() ?></div>
                <div class="small text-body-secondary"><?= $zahl($p['gekauft'], 0) ?> <?= $p['kurz'] ?><?php if ($p['preis'] !== null): ?> · Ø <?= $zahl($p['preis'], 3) ?> €/<?= $p['kurz'] ?><?php endif; ?></div>
                <?php if ($p['summe']): ?><div class="small text-body-secondary">aus der Summe, ohne vollen Abschnitt</div><?php endif; ?>
                <?php endif; ?>
            </div>
        </div>
        <?php endforeach; ?>
        <?php if ($kostenHaupt === null): ?>
        <div>
            <div class="kennzahl">
                <div class="small text-body-secondary"><?= $begriffe['kosten'] ?></div>
                <div class="kennzahl-wert"><?= $kraftstoffKostenProKm !== null ? $zahl($kraftstoffKostenProKm * 100) . ' <small class="fw-normal">€/100 km</small>' : leerWert() ?></div>
                <div class="small text-body-secondary"><?= $zahl($energieKosten) ?> €<?php if ($stromAnteil !== null): ?>, davon Strom <?= $zahl($stromAnteil, 0) ?> %<?php endif; ?></div>
            </div>
        </div>
        <?php endif; ?>
        <?php else: ?>
        <div>
            <div class="kennzahl">
                <div class="small text-body-secondary">Ø Verbrauch</div>
                <div class="kennzahl-wert"><?= $durchschnittVerbrauch !== null ? $zahl($durchschnittVerbrauch) . ' <small class="fw-normal">' . $haupt['kurz'] . '/100 km</small>' : leerWert() ?></div>
                <?php if ($minVerbrauch !== null): ?><div class="small text-body-secondary"><?= $zahl($minVerbrauch, 1) ?> bis <?= $zahl($maxVerbrauch, 1) ?></div><?php endif; ?>
                <?php if ($haupt['summe']): ?><div class="small text-body-secondary">aus der Summe aller <?= $begriffe['vorgaenge'] ?>, ohne vollen Abschnitt</div><?php endif; ?>
            </div>
        </div>
        <div>
            <div class="kennzahl">
                <div class="small text-body-secondary"><?= $begriffe['kosten'] ?></div>
                <div class="kennzahl-wert"><?= $kraftstoffKostenProKm !== null ? $zahl($kraftstoffKostenProKm * 100) . ' <small class="fw-normal">€/100 km</small>' : leerWert() ?></div>
                <?php if ($durchschnittPreis !== null): ?><div class="small text-body-secondary">Ø <?= $zahl($durchschnittPreis, 3) ?> €/<?= $haupt['kurz'] ?></div><?php endif; ?>
            </div>
        </div>
        <div>
            <div class="kennzahl">
                <div class="small text-body-secondary"><?= $begriffe['menge_gesamt'] ?></div>
                <div class="kennzahl-wert"><?= $zahl($gekauftMenge, 0) ?> <small class="fw-normal"><?= $haupt['kurz'] ?></small></div>
                <div class="small text-body-secondary">für <?= $zahl($gekauftKosten) ?> €</div>
            </div>
        </div>
        <?php endif; ?>
        <div>
            <div class="kennzahl" title="<?= htmlspecialchars($co2Hinweis) ?>">
                <div class="small text-body-secondary">CO₂ gesamt</div>
                <div class="kennzahl-wert"><?= $co2Gesamt !== null ? $zahl($co2Gesamt / 1000) . ' <small class="fw-normal">t</small>' : leerWert() ?></div>
                <?php if ($co2ProKm !== null): ?><div class="small text-body-secondary">Ø <?= $zahl($co2ProKm, 0) ?> g/km</div><?php endif; ?>
            </div>
        </div>
    </div>

    <?php $ladeStat = $d['verbrauch']['chargeTypes'] ?? null;
    if ($ladeStat && ($ladeStat['typedShare'] ?? 0) > 0):
        $ladeLeistung = (bool)array_filter(array_column($ladeStat['types'], 'avgPowerKw'), fn($v) => $v !== null); ?>
    <!-- Laden nach Ladeart (#25): Anteil, Ø Preis und Leistung; Ladevorgänge ohne Angabe als eigene Zeile -->
    <div class="card border-0 shadow-sm mb-3">
        <div class="card-body">
            <h3 class="h6 mb-3">Laden nach Ladeart</h3>
            <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                    <thead><tr><th scope="col">Ladeart</th><th scope="col" class="text-end">Anteil</th><th scope="col" class="text-end">Ø €/kWh</th><?php if ($ladeLeistung): ?><th scope="col" class="text-end">Ø kW</th><?php endif; ?></tr></thead>
                    <tbody>
                    <?php foreach ($ladeStat['types'] as $t): ?>
                        <tr>
                            <th scope="row" class="fw-normal">
                                <?= htmlspecialchars(ladearten()[$t['type'] ?? ''] ?? 'Ohne Angabe') ?>
                                <span class="d-block fs-label"><?= (int)$t['count'] ?>× · <?= $zahl($t['amount'], 0) ?> kWh</span>
                            </th>
                            <td class="text-end text-nowrap"><?= $t['share'] !== null ? $zahl($t['share'], 0) . ' %' : leerWert() ?></td>
                            <td class="text-end text-nowrap"><?= $t['avgPrice'] !== null ? $zahl($t['avgPrice'], 3) : leerWert() ?></td>
                            <?php if ($ladeLeistung): ?><td class="text-end text-nowrap"><?= $t['avgPowerKw'] !== null ? $zahl($t['avgPowerKw'], 1) : leerWert() ?></td><?php endif; ?>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
            <p class="small text-body-secondary mb-0 mt-2">
                <?php if ($ladeStat['homeShare'] !== null): ?>Zu Hause <?= $zahl($ladeStat['homeShare'], 0) ?> %, unterwegs <?= $zahl(100 - $ladeStat['homeShare'], 0) ?> % der Ladungen mit Angabe. <?php endif; ?>
                Ladungen ohne Ladeart zählen dabei nicht mit. Die Leistung ergibt sich aus kWh ÷ Ladedauer, nur über Ladungen mit Ladedauer.
            </p>
        </div>
    </div>
    <?php endif; ?>

    <?php if ($sortenPreise): ?>
    <!-- Preise je Sorte (#140): Anteil an der Energieart, Ø Preis, Mehrpreis der Premium-Sorten -->
    <div class="card border-0 shadow-sm mb-3">
        <div class="card-body">
            <h3 class="h6 mb-3">Preise je Sorte</h3>
            <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                    <thead><tr><th scope="col">Sorte</th><th scope="col" class="text-end">Anteil</th><th scope="col" class="text-end">Ø Preis</th><th scope="col" class="text-end">Mehrpreis</th></tr></thead>
                    <tbody>
                    <?php foreach ($sortenPreise as $s): $kurzS = einheitKurz($s['unit'] ?? 'l'); ?>
                        <tr>
                            <th scope="row" class="fw-normal"><?= htmlspecialchars($s['name']) ?> <span class="text-body-secondary small">· <?= (int)$s['fillCount'] ?>×</span></th>
                            <td class="text-end text-nowrap"><?= $s['shareOfEnergy'] !== null ? $zahl($s['shareOfEnergy'], 0) . ' %' : leerWert() ?></td>
                            <td class="text-end text-nowrap"><?= $s['avgPrice'] !== null ? $zahl($s['avgPrice'], 3) . ' €/' . $kurzS : leerWert() ?></td>
                            <td class="text-end text-nowrap"><?php if (!empty($s['markup'])): ?>+<?= $zahl($s['markup']['perUnit'], 3) ?> €/<?= $kurzS ?><?php if ($s['markup']['percent'] !== null): ?> <span class="text-body-secondary small">(<?= $zahl($s['markup']['percent'], 1) ?> %)</span><?php endif; ?><?php else: ?><?= leerWert() ?><?php endif; ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
            <p class="small text-body-secondary mb-0 mt-2">Anteil: an der getankten Menge derselben Energieart. Mehrpreis: gegenüber dem Ø Preis der übrigen Sorten dieser Energieart.</p>
        </div>
    </div>
    <?php endif; ?>

    <?php if ($highlights): ?>
    <div class="row g-2 g-md-3 mb-3">
        <?php foreach ($highlights as [$icon, $farbe, $titel, $monat, $wert]): ?>
        <div class="col-md-4">
            <div class="hoehepunkt">
                <?= symbolKreis($icon, ['success' => 'var(--fs-status-ok)', 'danger' => 'var(--fs-status-overdue)', 'warning' => 'var(--fs-status-soon)'][$farbe] ?? 'var(--fs-brand)') ?>
                <div class="min-w-0">
                    <div class="fs-label"><?= $titel ?> · <?= htmlspecialchars($monat) ?></div>
                    <div class="fs-headline zahl"><?= $wert ?></div>
                </div>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>

    <!-- Diagramme: Verbrauch je Tank- bzw. Ladevorgang (Plug-in-Hybrid: je Einheit ein Diagramm) -->
    <div class="row g-3 mb-3">
        <?php foreach ($proEinheitDiagramm as $u => $p): ?>
        <div class="col-lg-6">
            <div class="card border-0 shadow-sm h-100">
                <div class="card-body">
                    <h3 class="h6 mb-3">Verbrauch pro <?= $p['begriffe']['vorgang'] ?> <small class="text-body-secondary fw-normal"><?= $p['kurz'] ?>/100 km</small></h3>
                    <?php if ($p['werte']): ?>
                        <div class="diagramm"><canvas id="verbrauchChart_<?= $u ?>"></canvas></div>
                    <?php else: ?>
                        <p class="text-body-secondary small mb-0">Ab zwei vollen <?= $p['begriffe']['vorgaengen'] ?> verfügbar.</p>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        <?php endforeach; ?>
        <?php if ($kostenHaupt !== null && $rateMonate): ?>
        <div class="col-12">
            <div class="card border-0 shadow-sm h-100">
                <div class="card-body">
                    <h3 class="h6 mb-3">Energiekosten pro Monat <small class="text-body-secondary fw-normal">€/100 km, Kraftstoff und Strom</small></h3>
                    <div class="diagramm"><canvas id="kostenKmMonatChart"></canvas></div>
                    <p class="small text-body-secondary mb-0 mt-2">Kosten der Tank- und Ladevorgänge im Monat ÷ gefahrene Strecke im Monat. Einzelne Monate schwanken, wenn selten getankt wird; der Jahreswert in der Tabelle ist stabiler.</p>
                </div>
            </div>
        </div>
        <?php endif; ?>
        <div class="<?= $mehrereEinheiten ? 'col-12' : 'col-lg-6' ?>">
            <div class="card border-0 shadow-sm h-100">
                <div class="card-body">
                    <h3 class="h6 mb-3">Verbrauch pro Monat <small class="text-body-secondary fw-normal"><?= implode(' bzw. ', array_unique(array_map(fn($p) => $p['kurz'] . '/100 km', $proEinheitDiagramm))) ?></small></h3>
                    <?php if ($alleMonate): ?>
                        <div class="diagramm"><canvas id="verbrauchMonatChart"></canvas></div>
                    <?php else: ?>
                        <p class="text-body-secondary small mb-0">Ab zwei vollen <?= $begriffe['vorgaengen'] ?> verfügbar.</p>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        <div class="col-12">
            <div class="card border-0 shadow-sm">
                <div class="card-body">
                    <h3 class="h6 mb-3">Ausgaben pro Monat <small class="text-body-secondary fw-normal">€, alle Kategorien</small></h3>
                    <div class="diagramm"><canvas id="kostenMonatChart"></canvas></div>
                </div>
            </div>
        </div>
    </div>

    <!-- Jahresübersicht: PC als Tabelle, Handy als Liste -->
    <div class="card border-0 shadow-sm">
        <div class="card-header bg-transparent py-3">
            <h3 class="h6 mb-0">Jahresübersicht</h3>
        </div>
        <div class="table-responsive d-none d-md-block">
            <table class="table table-hover align-middle mb-0 jahrestabelle">
                <thead>
                    <tr>
                        <th>Jahr</th>
                        <?php foreach ($proEinheit as $p): ?>
                        <?php if ($mehrereEinheiten): ?>
                        <th class="text-end"><?= htmlspecialchars($p['name']) ?></th>
                        <?php else: ?>
                        <th class="text-end"><?= $p['begriffe']['vorgaenge'] ?></th>
                        <th class="text-end"><?= $p['begriffe']['menge'] ?></th>
                        <?php endif; ?>
                        <?php endforeach; ?>
                        <th class="text-end">Kosten</th>
                        <?php if ($kostenHaupt !== null): ?><th class="text-end">€/100 km</th><?php endif; ?>
                        <?php if (!$mehrereEinheiten): ?>
                        <th class="text-end">Ø Preis</th>
                        <th class="text-end">Strecke</th>
                        <?php endif; ?>
                        <?php foreach ($proEinheit as $p): ?>
                        <th class="text-end"><?= $mehrereEinheiten ? 'Ø ' . htmlspecialchars($p['name']) : 'Verbrauch' ?></th>
                        <?php endforeach; ?>
                        <?php if ($co2Gesamt !== null): ?><th class="text-end">CO₂</th><?php endif; ?>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach (array_keys($tankJahre) as $jahr):
                        $summe = $jahrWerte($jahr);
                        $daten = $haupt['jahre'][$jahr];
                        $preis = $daten['gekauft_menge'] > 0 ? $daten['gekauft_ausgaben'] / $daten['gekauft_menge'] : null; ?>
                    <tr>
                        <th scope="row"><?= $jahr ?></th>
                        <?php foreach ($proEinheit as $p): $j = $p['jahre'][$jahr]; ?>
                        <?php if ($mehrereEinheiten): ?>
                        <!-- Plug-in-Hybrid: Anzahl und Menge in einer Spalte, damit die Tabelle nicht zu breit wird -->
                        <td class="text-end text-nowrap"><?= (int)$j['anzahl_tankstops'] ?> <span class="text-body-secondary">· <?= $zahl($j['gekauft_menge'], 0) ?> <?= $p['kurz'] ?></span></td>
                        <?php else: ?>
                        <td class="text-end"><?= (int)$j['anzahl_tankstops'] ?></td>
                        <td class="text-end"><?= $zahl($j['gekauft_menge']) ?> <?= $p['kurz'] ?></td>
                        <?php endif; ?>
                        <?php endforeach; ?>
                        <td class="text-end"><?= $zahl($summe['kosten']) ?> €</td>
                        <?php if ($kostenHaupt !== null): ?><td class="text-end fw-semibold text-nowrap"><?= isset($rateJahre[(string)$jahr]) && $rateJahre[(string)$jahr]['costPer100km'] !== null ? $zahl($rateJahre[(string)$jahr]['costPer100km']) . ' €' : leerWert() ?></td><?php endif; ?>
                        <?php if (!$mehrereEinheiten): ?>
                        <td class="text-end"><?= $preis !== null ? $zahl($preis, 3) . ' €/' . $haupt['kurz'] : leerWert() ?></td>
                        <td class="text-end"><?= $daten['verbrauch_km'] > 0 ? $zahl($daten['verbrauch_km'], 0) . ' km' : leerWert() ?></td>
                        <?php endif; ?>
                        <?php foreach ($proEinheit as $p): $j = $p['jahre'][$jahr]; ?>
                        <td class="text-end fw-semibold text-nowrap"><?= $j['verbrauch_l100km'] > 0 && !$p['nebenbei'] ? $zahl($j['verbrauch_l100km']) . ' ' . $p['kurz'] . '/100 km' : leerWert() ?></td>
                        <?php endforeach; ?>
                        <?php if ($co2Gesamt !== null): ?><td class="text-end"><?= $summe['co2'] !== null ? $zahl($summe['co2'], 0) . ' kg' : leerWert() ?></td><?php endif; ?>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <div class="list-group list-group-flush d-md-none">
            <?php $nr = 0; foreach (array_keys($tankJahre) as $jahr):
                $summe = $jahrWerte($jahr);
                $daten = $haupt['jahre'][$jahr];
                $preis = $daten['gekauft_menge'] > 0 ? $daten['gekauft_ausgaben'] / $daten['gekauft_menge'] : null; ?>
            <?php if ($nr++ === 3): ?>
            <div class="collapse" id="weitereJahre">
            <?php endif; ?>
            <div class="list-group-item py-3">
                <div class="d-flex justify-content-between align-items-baseline mb-2">
                    <span class="fw-semibold fs-5"><?= $jahr ?></span>
                    <span class="fw-semibold text-end"><?= implode(' · ', array_map(fn($p) => $p['jahre'][$jahr]['verbrauch_l100km'] > 0 ? $zahl($p['jahre'][$jahr]['verbrauch_l100km']) . ' ' . $p['kurz'] . '/100 km' : leerWert(), $proEinheitDiagramm ?: $proEinheit)) ?></span>
                </div>
                <div class="row row-cols-3 g-2 small">
                    <?php foreach ($proEinheit as $p): $j = $p['jahre'][$jahr]; ?>
                    <div><div class="text-body-secondary"><?= $p['begriffe']['vorgaenge'] ?><?= $mehrereEinheiten ? ' ' . htmlspecialchars($p['name']) : '' ?></div><?= (int)$j['anzahl_tankstops'] ?></div>
                    <div><div class="text-body-secondary"><?= $p['begriffe']['menge'] ?></div><?= $zahl($j['gekauft_menge'], 1) ?> <?= $p['kurz'] ?></div>
                    <?php endforeach; ?>
                    <div><div class="text-body-secondary">Kosten</div><?= $zahl($summe['kosten']) ?> €</div>
                    <?php if ($kostenHaupt !== null): ?><div><div class="text-body-secondary">€/100 km</div><?= isset($rateJahre[(string)$jahr]) && $rateJahre[(string)$jahr]['costPer100km'] !== null ? $zahl($rateJahre[(string)$jahr]['costPer100km']) . ' €' : leerWert() ?></div><?php endif; ?>
                    <?php if (!$mehrereEinheiten): ?>
                    <div><div class="text-body-secondary">Strecke</div><?= $daten['verbrauch_km'] > 0 ? $zahl($daten['verbrauch_km'], 0) . ' km' : leerWert() ?></div>
                    <div><div class="text-body-secondary">Ø Preis</div><?= $preis !== null ? $zahl($preis, 3) . ' €' : leerWert() ?></div>
                    <?php endif; ?>
                    <?php if ($summe['co2'] !== null): ?><div><div class="text-body-secondary">CO₂</div><?= $zahl($summe['co2'], 0) ?> kg</div><?php endif; ?>
                </div>
            </div>
            <?php endforeach; ?>
            <?php if (count($tankJahre) > 3): ?>
            </div>
            <button class="list-group-item list-group-item-action text-primary text-center" type="button" id="weitereJahreKnopf" data-bs-toggle="collapse" data-bs-target="#weitereJahre" aria-expanded="false">
                Alle <?= count($tankJahre) ?> Jahre anzeigen
            </button>
            <script>
                (function () {
                    var bereich = document.getElementById('weitereJahre');
                    var knopf = document.getElementById('weitereJahreKnopf');
                    var text = knopf.textContent.trim();
                    bereich.addEventListener('show.bs.collapse', function () { knopf.textContent = 'Weniger anzeigen'; });
                    bereich.addEventListener('hide.bs.collapse', function () { knopf.textContent = text; });
                })();
            </script>
            <?php endif; ?>
        </div>
    </div>
    <?php endif; ?>
</div>

<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'vendor/chartjs/chart.umd.min.js')) ?>"></script>
<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'js/diagramm-text.js')) ?>"></script>
<script>
(function () {
    if (!window.Chart) return;
    var css = getComputedStyle(document.documentElement);
    // Eine Energieart in der Hauptfarbe; mehrere je in ihrer Energie-Farbe aus docs/design.md (3.3)
    var hexRgb = function (hex) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim()); return m ? [1, 2, 3].map(function (i) { return parseInt(m[i], 16); }).join(',') : null; };
    var energieToken = { petrol: 'petrol', diesel: 'diesel', lpg: 'gas', cng: 'gas', electricity: 'electric', kwh: 'electric', hydrogen: 'hydrogen', other: 'petrol' };
    var hauptRgb = css.getPropertyValue('--fs-brand-rgb').trim();
    var mehrere = <?= json_encode(count($proEinheitDiagramm) > 1) ?>;
    var farbeFuer = function (schluessel) {
        var token = energieToken[schluessel];
        var rgb = (mehrere && token && hexRgb(css.getPropertyValue('--fs-energy-' + token))) || hauptRgb;
        return function (alpha) { return 'rgba(' + rgb + ',' + alpha + ')'; };
    };
    var farbe = farbeFuer('');
    var zahl = function (wert, stellen) { return Number(wert).toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }); };
    // Achsenbeschriftung: ganze Zahlen ohne, Zwischenschritte (0,5) mit einer Nachkommastelle
    var achse = function (v) { return zahl(v, Number.isInteger(v) ? 0 : 1); };

    // Gemeinsame Optionen: keine schrägen Beschriftungen, Werte mit Einheit im Tooltip
    function optionen(einheit, stellen, extra) {
        var o = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: function (c) { return (c.dataset.label ? c.dataset.label + ': ' : '') + zahl(c.parsed.y, stellen) + (c.dataset.einheit || einheit); } } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
                y: { ticks: { callback: achse } }
            }
        };
        return Object.assign(o, extra || {});
    }

    var einheiten = <?= json_encode(array_map(fn($p) => [
        'label' => $p['begriffe']['vorgang'],
        'energie' => $p['name'],
        'einheit' => ' ' . $p['kurz'] . '/100 km',
        'labels' => $kurzDatum($p['werte']),
        'werte' => array_values(array_map(fn($v) => round($v, 2), $p['werte'])),
        'schnitt' => $p['schnitt'] !== null ? round($p['schnitt'], 2) : null,
        'monate' => array_map(fn($m) => isset($p['monate'][$m]) ? round($p['monate'][$m], 2) : null, array_keys($alleMonate)),
    ], $proEinheitDiagramm), JSON_UNESCAPED_UNICODE) ?>;

    Object.keys(einheiten).forEach(function (u) {
        var e = einheiten[u];
        var el = document.getElementById('verbrauchChart_' + u);
        if (!el) return;
        var f = farbeFuer(u);
        var datasets = [{
            label: e.label, data: e.werte, borderColor: f(1), backgroundColor: f(.12),
            fill: true, cubicInterpolationMode: 'monotone', pointRadius: e.werte.length > 60 ? 0 : 2, pointHoverRadius: 5, borderWidth: 2
        }];
        if (e.schnitt !== null) {
            datasets.push({ label: 'Ø', data: e.werte.map(function () { return e.schnitt; }), borderColor: f(.6), borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
        }
        new Chart(el, { type: 'line', data: { labels: e.labels, datasets: datasets }, options: optionen(e.einheit, 2) });
    });

    var el = document.getElementById('verbrauchMonatChart');
    if (el) {
        // Plug-in-Hybrid: Kraftstoff links, Strom rechts auf eigener Achse
        // Gleiche Einheit (z. B. Benzin und Autogas in l) auf derselben Achse
        var ersteEinheit = einheiten[Object.keys(einheiten)[0]].einheit;
        var zweiteAchse = Object.keys(einheiten).find(function (u) { return einheiten[u].einheit !== ersteEinheit; });
        var datasets = Object.keys(einheiten).map(function (u) {
            var e = einheiten[u];
            return { label: mehrere ? e.energie : 'Verbrauch', einheit: e.einheit, data: e.monate, backgroundColor: farbeFuer(u)(.75), borderRadius: 4, yAxisID: e.einheit === ersteEinheit ? 'y' : 'y1' };
        });
        var extra = {};
        if (mehrere && zweiteAchse) {
            extra.scales = {
                x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
                y: { position: 'left', title: { display: true, text: einheiten[Object.keys(einheiten)[0]].einheit.trim() }, ticks: { callback: achse } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: einheiten[zweiteAchse].einheit.trim() }, ticks: { callback: achse } }
            };
        }
        if (mehrere) {
            extra.plugins = { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + (c.parsed.y === null ? 'keine Angabe' : zahl(c.parsed.y, 2) + c.dataset.einheit); } } } };
        }
        new Chart(el, { type: 'bar', data: { labels: <?= json_encode($monatsLabels, JSON_UNESCAPED_UNICODE) ?>, datasets: datasets }, options: optionen(einheiten[Object.keys(einheiten)[0]].einheit, 2, extra) });
    }

    el = document.getElementById('kostenKmMonatChart');
    if (el) {
        var rate = <?= json_encode(array_map(fn($m) => ['m' => formatMonat($m['period']), 'w' => $m['costPer100km']], $rateMonate), JSON_UNESCAPED_UNICODE) ?>;
        new Chart(el, {
            type: 'bar',
            data: { labels: rate.map(function (r) { return r.m; }), datasets: [{ label: 'Energiekosten', data: rate.map(function (r) { return r.w; }), backgroundColor: farbe(.75), borderRadius: 4 }] },
            options: optionen(' €/100 km', 2)
        });
    }

    el = document.getElementById('kostenMonatChart');
    if (el) {
        new Chart(el, {
            type: 'bar',
            data: { labels: <?= json_encode(array_keys($kostenProMonatFormatted)) ?>, datasets: [{ label: 'Ausgaben', data: <?= json_encode(array_values(array_map(fn($v) => round($v, 2), $kostenProMonatFormatted))) ?>, backgroundColor: farbe(.75), borderRadius: 4 }] },
            options: optionen(' €', 2)
        });
    }
})();
</script>
