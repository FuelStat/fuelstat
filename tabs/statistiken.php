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
// ersten, geteilt durch die Strecke dazwischen. Kosten pro Monat ebenfalls aus der API.
try {
    $kostenApi = $api->getVehicleCosts($fahrzeug_id);
} catch (Throwable $e) {
    $kostenApi = null;
}
$kraftstoffKostenProKm = $kostenApi['costPerKm']['energy'] ?? null;
if ($kostenApi !== null) {
    $kostenProMonat = [];
    foreach ($kostenApi['months'] as $m) {
        if ($m['total'] > 0) {
            $kostenProMonat[$m['month']] = (float)$m['total'];
        }
    }
    ksort($kostenProMonat);
}

$fuelTypeStat = (string)($fahrzeug['fuel_type'] ?? '');
$zahl = fn($wert, int $stellen = 2) => number_format((float)$wert, $stellen, ',', '.');
$durchschnittPreise = [];
try {
    $stats = $api->getVehicleStats($fahrzeug_id);
    foreach ($stats['units'] ?? [] as $u => $werte) {
        $durchschnittPreise[$u] = $werte['avgPrice'] ?? null;
    }
} catch (Throwable $e) {
}

// Kennzahlen je Einheit; Plug-in-Hybride haben zwei (Liter und kWh), alle anderen eine
$einheitenDaten = $d['einheiten'] ?: [getEinheitFuerKraftstoff($fuelTypeStat) => ['verbrauchswerte' => [], 'verbrauchProMonat' => [], 'jahresdaten' => $jahresdaten]];
$mehrereEinheiten = count($einheitenDaten) > 1;
$proEinheit = [];
foreach ($einheitenDaten as $u => $ud) {
    $menge = array_sum(array_column($ud['jahresdaten'], 'verbrauch_menge'));
    $km = array_sum(array_column($ud['jahresdaten'], 'verbrauch_km'));
    $gekauft = array_sum(array_column($ud['jahresdaten'], 'gekauft_menge'));
    $faktor = getCo2Faktor($fuelTypeStat, $u);
    $monate = array_filter($ud['verbrauchProMonat'], fn($v) => $v > 0);
    ksort($monate);
    $proEinheit[$u] = [
        'kurz' => einheitKurz($u),
        'begriffe' => begriffeFuerEinheit($fuelTypeStat, $u),
        'werte' => $ud['verbrauchswerte'],
        'monate' => $monate,
        'jahre' => $ud['jahresdaten'],
        'schnitt' => $km > 0 ? $menge / $km * 100 : null,
        'min' => $ud['verbrauchswerte'] ? min($ud['verbrauchswerte']) : null,
        'max' => $ud['verbrauchswerte'] ? max($ud['verbrauchswerte']) : null,
        'gekauft' => $gekauft,
        'kosten' => array_sum(array_column($ud['jahresdaten'], 'gekauft_ausgaben')),
        'preis' => $durchschnittPreise[$u] ?? null,
        'co2_faktor' => $faktor,
        // CO₂: getankte bzw. geladene Menge × Emissionsfaktor
        'co2' => $faktor !== null ? $gekauft * $faktor : null,
    ];
}
$haupt = reset($proEinheit);
$hauptEinheit = array_key_first($proEinheit);

// Für einzelne Einheit wie bisher; beim Plug-in-Hybrid Summe aus Kraftstoff und Strom
$co2Faktor = $haupt['co2_faktor'];
$co2Gesamt = null;
$co2ProKm = null;
foreach ($proEinheit as $p) {
    if ($p['co2'] !== null) {
        $co2Gesamt = ($co2Gesamt ?? 0) + $p['co2'];
        if ($p['schnitt'] !== null) {
            $co2ProKm = ($co2ProKm ?? 0) + $p['schnitt'] / 100 * $p['co2_faktor'] * 1000; // g/km
        }
    }
}
$durchschnittPreis = $haupt['preis'];
$minVerbrauch = $haupt['min'];
$maxVerbrauch = $haupt['max'];
$durchschnittVerbrauch = $haupt['schnitt'];
$gekauftMenge = $haupt['gekauft'];
$gekauftKosten = $haupt['kosten'];
$verbrauchswerte = $haupt['werte'];
$energieKosten = array_sum(array_column($proEinheit, 'kosten'));
$stromAnteil = $mehrereEinheiten && $energieKosten > 0 && isset($proEinheit['kwh']) ? $proEinheit['kwh']['kosten'] / $energieKosten * 100 : null;

ksort($kostenProMonat);
$verbrauchProMonatFormatted = formatLabels($haupt['monate']);
$kostenProMonatFormatted = formatLabels($kostenProMonat);

// Bester, schlechtester und teuerster Monat (beim Plug-in-Hybrid nach dem Kraftstoff)
$highlights = [];
$hauptZusatz = $mehrereEinheiten ? ' (' . $haupt['begriffe']['energie'] . ')' : '';
if ($verbrauchProMonatFormatted) {
    $wert = min($verbrauchProMonatFormatted);
    $highlights[] = ['fa-arrow-trend-down', 'success', 'Sparsamster Monat' . $hauptZusatz, array_search($wert, $verbrauchProMonatFormatted), number_format($wert, 2, ',', '.') . ' ' . $haupt['kurz'] . '/100 km'];
    $wert = max($verbrauchProMonatFormatted);
    $highlights[] = ['fa-arrow-trend-up', 'danger', 'Durstigster Monat' . $hauptZusatz, array_search($wert, $verbrauchProMonatFormatted), number_format($wert, 2, ',', '.') . ' ' . $haupt['kurz'] . '/100 km'];
}
if ($kostenProMonatFormatted) {
    $wert = max($kostenProMonatFormatted);
    $highlights[] = ['fa-euro-sign', 'warning', 'Teuerster Monat', array_search($wert, $kostenProMonatFormatted), number_format($wert, 2, ',', '.') . ' €'];
}

// Monatsverbrauch aller Einheiten auf gemeinsamer Zeitachse (Plug-in-Hybrid: zwei Balken je Monat)
$alleMonate = [];
foreach ($proEinheit as $p) {
    $alleMonate += $p['monate'];
}
ksort($alleMonate);
$monatsLabels = array_map(fn($m) => formatMonat($m), array_keys($alleMonate));

// Diagramm-Beschriftung: Datum kurz (25.11.24)
$kurzDatum = fn(array $werte) => array_map(fn($datum) => date('d.m.y', strtotime(substr($datum, 0, 10))), array_keys($werte));

$co2Hinweise = [];
foreach ($proEinheit as $u => $p) {
    if ($p['co2_faktor'] === null) continue;
    $co2Hinweise[] = $u === 'kwh'
        ? 'Strom mit dem deutschen Strommix (' . $zahl($p['co2_faktor'], 3) . ' kg CO₂/kWh)'
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
        if ($p['co2_faktor'] !== null) {
            $co2 = ($co2 ?? 0) + $j['gekauft_menge'] * $p['co2_faktor'];
        }
    }
    return ['kosten' => $kosten, 'co2' => $co2];
};
?>

<div class="mt-3 mt-lg-4">
    <?php if (!$jahresdaten): ?>
        <div class="card border-0 shadow-sm text-center">
            <div class="card-body p-5">
                <i class="fas fa-chart-line fa-2x mb-3"></i>
                <p class="mb-0 text-body-secondary">Noch keine <?= $begriffe['vorgaenge'] ?> erfasst. Ab zwei vollen <?= $begriffe['vorgaengen'] ?> gibt es hier Verbrauch, Kosten und Diagramme.</p>
            </div>
        </div>
    <?php else: ?>

    <!-- Kennzahlen -->
    <div class="row g-2 g-md-3 mb-3">
        <?php if ($mehrereEinheiten): ?>
        <?php foreach ($proEinheit as $u => $p): ?>
        <div class="col-6 col-lg-3">
            <div class="kennzahl">
                <div class="small text-body-secondary">Ø <?= $p['begriffe']['energie'] ?></div>
                <div class="kennzahl-wert"><?= $p['schnitt'] !== null ? $zahl($p['schnitt']) . ' <small class="fw-normal">' . $p['kurz'] . '/100 km</small>' : '—' ?></div>
                <div class="small text-body-secondary"><?= $zahl($p['gekauft'], 0) ?> <?= $p['kurz'] ?><?php if ($p['preis'] !== null): ?> · Ø <?= $zahl($p['preis'], 3) ?> €/<?= $p['kurz'] ?><?php endif; ?></div>
            </div>
        </div>
        <?php endforeach; ?>
        <div class="col-6 col-lg-3">
            <div class="kennzahl">
                <div class="small text-body-secondary"><?= $begriffe['kosten'] ?></div>
                <div class="kennzahl-wert"><?= $kraftstoffKostenProKm !== null ? $zahl($kraftstoffKostenProKm * 100) . ' <small class="fw-normal">€/100 km</small>' : '—' ?></div>
                <div class="small text-body-secondary"><?= $zahl($energieKosten) ?> €<?php if ($stromAnteil !== null): ?>, davon Strom <?= $zahl($stromAnteil, 0) ?> %<?php endif; ?></div>
            </div>
        </div>
        <?php else: ?>
        <div class="col-6 col-lg-3">
            <div class="kennzahl">
                <div class="small text-body-secondary">Ø Verbrauch</div>
                <div class="kennzahl-wert"><?= $durchschnittVerbrauch !== null ? $zahl($durchschnittVerbrauch) . ' <small class="fw-normal">' . $haupt['kurz'] . '/100 km</small>' : '—' ?></div>
                <?php if ($minVerbrauch !== null): ?><div class="small text-body-secondary"><?= $zahl($minVerbrauch, 1) ?> bis <?= $zahl($maxVerbrauch, 1) ?></div><?php endif; ?>
            </div>
        </div>
        <div class="col-6 col-lg-3">
            <div class="kennzahl">
                <div class="small text-body-secondary"><?= $begriffe['kosten'] ?></div>
                <div class="kennzahl-wert"><?= $kraftstoffKostenProKm !== null ? $zahl($kraftstoffKostenProKm * 100) . ' <small class="fw-normal">€/100 km</small>' : '—' ?></div>
                <?php if ($durchschnittPreis !== null): ?><div class="small text-body-secondary">Ø <?= $zahl($durchschnittPreis, 3) ?> €/<?= $haupt['kurz'] ?></div><?php endif; ?>
            </div>
        </div>
        <div class="col-6 col-lg-3">
            <div class="kennzahl">
                <div class="small text-body-secondary"><?= $begriffe['menge_gesamt'] ?></div>
                <div class="kennzahl-wert"><?= $zahl($gekauftMenge, 0) ?> <small class="fw-normal"><?= $haupt['kurz'] ?></small></div>
                <div class="small text-body-secondary">für <?= $zahl($gekauftKosten) ?> €</div>
            </div>
        </div>
        <?php endif; ?>
        <div class="col-6 col-lg-3">
            <div class="kennzahl" title="<?= htmlspecialchars($co2Hinweis) ?>">
                <div class="small text-body-secondary">CO₂ gesamt</div>
                <div class="kennzahl-wert"><?= $co2Gesamt !== null ? $zahl($co2Gesamt / 1000) . ' <small class="fw-normal">t</small>' : '—' ?></div>
                <?php if ($co2ProKm !== null): ?><div class="small text-body-secondary">Ø <?= $zahl($co2ProKm, 0) ?> g/km</div><?php endif; ?>
            </div>
        </div>
    </div>

    <?php if ($highlights): ?>
    <div class="row g-2 g-md-3 mb-3">
        <?php foreach ($highlights as [$icon, $farbe, $titel, $monat, $wert]): ?>
        <div class="col-md-4">
            <div class="kennzahl d-flex align-items-center gap-3">
                <span class="statistik-icon text-<?= $farbe ?> bg-<?= $farbe ?>-subtle"><i class="fas <?= $icon ?>"></i></span>
                <div class="min-w-0">
                    <div class="small text-body-secondary"><?= $titel ?> · <?= htmlspecialchars($monat) ?></div>
                    <div class="fw-semibold"><?= $wert ?></div>
                </div>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>

    <!-- Diagramme: Verbrauch je Tank- bzw. Ladevorgang (Plug-in-Hybrid: je Einheit ein Diagramm) -->
    <div class="row g-3 mb-3">
        <?php foreach ($proEinheit as $u => $p): ?>
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
        <div class="<?= $mehrereEinheiten ? 'col-12' : 'col-lg-6' ?>">
            <div class="card border-0 shadow-sm h-100">
                <div class="card-body">
                    <h3 class="h6 mb-3">Verbrauch pro Monat <small class="text-body-secondary fw-normal"><?= implode(' bzw. ', array_map(fn($p) => $p['kurz'] . '/100 km', $proEinheit)) ?></small></h3>
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
                        <th class="text-end"><?= $p['begriffe']['vorgaenge'] ?></th>
                        <?php else: ?>
                        <th class="text-end"><?= $p['begriffe']['vorgaenge'] ?></th>
                        <th class="text-end"><?= $p['begriffe']['menge'] ?></th>
                        <?php endif; ?>
                        <?php endforeach; ?>
                        <th class="text-end">Kosten</th>
                        <?php if (!$mehrereEinheiten): ?>
                        <th class="text-end">Ø Preis</th>
                        <th class="text-end">Strecke</th>
                        <?php endif; ?>
                        <?php foreach ($proEinheit as $p): ?>
                        <th class="text-end"><?= $mehrereEinheiten ? 'Ø ' . $p['begriffe']['energie'] : 'Verbrauch' ?></th>
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
                        <?php if (!$mehrereEinheiten): ?>
                        <td class="text-end"><?= $preis !== null ? $zahl($preis, 3) . ' €/' . $haupt['kurz'] : '—' ?></td>
                        <td class="text-end"><?= $daten['verbrauch_km'] > 0 ? $zahl($daten['verbrauch_km'], 0) . ' km' : '—' ?></td>
                        <?php endif; ?>
                        <?php foreach ($proEinheit as $p): $j = $p['jahre'][$jahr]; ?>
                        <td class="text-end fw-semibold text-nowrap"><?= $j['verbrauch_l100km'] > 0 ? $zahl($j['verbrauch_l100km']) . ' ' . $p['kurz'] . '/100 km' : '—' ?></td>
                        <?php endforeach; ?>
                        <?php if ($co2Gesamt !== null): ?><td class="text-end"><?= $summe['co2'] !== null ? $zahl($summe['co2'], 0) . ' kg' : '—' ?></td><?php endif; ?>
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
                    <span class="fw-semibold text-end"><?= implode(' · ', array_map(fn($p) => $p['jahre'][$jahr]['verbrauch_l100km'] > 0 ? $zahl($p['jahre'][$jahr]['verbrauch_l100km']) . ' ' . $p['kurz'] . '/100 km' : '—', $proEinheit)) ?></span>
                </div>
                <div class="row row-cols-3 g-2 small">
                    <?php foreach ($proEinheit as $p): $j = $p['jahre'][$jahr]; ?>
                    <div><div class="text-body-secondary"><?= $p['begriffe']['vorgaenge'] ?></div><?= (int)$j['anzahl_tankstops'] ?></div>
                    <div><div class="text-body-secondary"><?= $p['begriffe']['menge'] ?></div><?= $zahl($j['gekauft_menge'], 1) ?> <?= $p['kurz'] ?></div>
                    <?php endforeach; ?>
                    <div><div class="text-body-secondary">Kosten</div><?= $zahl($summe['kosten']) ?> €</div>
                    <?php if (!$mehrereEinheiten): ?>
                    <div><div class="text-body-secondary">Strecke</div><?= $daten['verbrauch_km'] > 0 ? $zahl($daten['verbrauch_km'], 0) . ' km' : '—' ?></div>
                    <div><div class="text-body-secondary">Ø Preis</div><?= $preis !== null ? $zahl($preis, 3) . ' €' : '—' ?></div>
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
<script>
(function () {
    if (!window.Chart) return;
    var css = getComputedStyle(document.documentElement);
    // Kraftstoff in der Hauptfarbe, Strom (beim Plug-in-Hybrid) in Grün
    var rgbWerte = { haupt: css.getPropertyValue('--bs-primary-rgb').trim(), kwh: css.getPropertyValue('--bs-success-rgb').trim() };
    var mehrere = <?= json_encode($mehrereEinheiten) ?>;
    var farbeFuer = function (einheit) { var rgb = mehrere && einheit === 'kwh' ? rgbWerte.kwh : rgbWerte.haupt; return function (alpha) { return 'rgba(' + rgb + ',' + alpha + ')'; }; };
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
        'energie' => $p['begriffe']['energie'],
        'einheit' => ' ' . $p['kurz'] . '/100 km',
        'labels' => $kurzDatum($p['werte']),
        'werte' => array_values(array_map(fn($v) => round($v, 2), $p['werte'])),
        'schnitt' => $p['schnitt'] !== null ? round($p['schnitt'], 2) : null,
        'monate' => array_map(fn($m) => isset($p['monate'][$m]) ? round($p['monate'][$m], 2) : null, array_keys($alleMonate)),
    ], $proEinheit), JSON_UNESCAPED_UNICODE) ?>;

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
        var datasets = Object.keys(einheiten).map(function (u, i) {
            var e = einheiten[u];
            return { label: mehrere ? e.energie : 'Verbrauch', einheit: e.einheit, data: e.monate, backgroundColor: farbeFuer(u)(.75), borderRadius: 4, yAxisID: i === 0 ? 'y' : 'y1' };
        });
        var extra = {};
        if (mehrere) {
            extra.scales = {
                x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
                y: { position: 'left', title: { display: true, text: einheiten[Object.keys(einheiten)[0]].einheit.trim() }, ticks: { callback: achse } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: einheiten[Object.keys(einheiten)[1]].einheit.trim() }, ticks: { callback: achse } }
            };
            extra.plugins = { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + (c.parsed.y === null ? '—' : zahl(c.parsed.y, 2) + c.dataset.einheit); } } } };
        }
        new Chart(el, { type: 'bar', data: { labels: <?= json_encode($monatsLabels, JSON_UNESCAPED_UNICODE) ?>, datasets: datasets }, options: optionen(einheiten[Object.keys(einheiten)[0]].einheit, 2, extra) });
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
