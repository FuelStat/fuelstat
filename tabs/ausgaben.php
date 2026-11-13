<?php
include_once __DIR__ . '/../includes/functions.php';
include_once __DIR__ . '/../includes/api_helpers.php';

$selectedYear = isset($_GET['jahr']) && $_GET['jahr'] !== '' ? (int)$_GET['jahr'] : null;
$zahl = fn($wert, int $stellen = 2) => number_format((float)$wert, $stellen, ',', '.');

// Alle Einträge (Tankfüllungen und Ausgaben) flach, ohne Fahrten
$alle = [];
foreach (getMergedEintraegeFromApi($api, $fahrzeug_id)['eintraege'] as $monatsEintraege) {
    foreach ($monatsEintraege as $e) {
        if (!istEintragOhneKosten($e['kategorie'] ?? '') && !empty($e['datum'])) {
            $alle[] = $e;
        }
    }
}
usort($alle, fn($a, $b) => strcmp($a['datum'], $b['datum']));

// Summen je Kategorie, Monat und Jahr, Strecke, Kosten pro km und Ø je Monat rechnet die API (#124, #82), damit Web
// und Apps dieselben Zahlen zeigen. Die Einträge selbst braucht der Reiter nur noch für die größten Einzelausgaben.
$kostenPfad = fn(?int $jahr) => '/vehicles/' . rawurlencode($fahrzeug_id) . '/costs' . ($jahr !== null ? '?year=' . $jahr : '');
$kostenApi = function (?int $jahr) use ($api, $fahrzeug_id): ?array {
    try {
        return $api->getVehicleCosts($fahrzeug_id, $jahr);
    } catch (Throwable $e) {
        return null;
    }
};
$kostenGesamt = $kostenApi(null);
$jahre = array_map('intval', $kostenGesamt['years'] ?? []);
// Für den Jahresvergleich bzw. das gewählte Jahr gleichzeitig vorladen
$api->vorladen($selectedYear === null ? array_map($kostenPfad, $jahre) : [$kostenPfad($selectedYear)]);
$kosten = $selectedYear === null ? $kostenGesamt : $kostenApi($selectedYear);

$imZeitraum = fn($e) => $selectedYear === null || (int)substr($e['datum'], 0, 4) === $selectedYear;
$eintraege = array_values(array_filter($alle, $imZeitraum));

// Plug-in-Hybrid: Tanken und Laden als eigene Kategorien ("Tankfuellung:l" bzw. "Tankfuellung:kwh")
$istPhev = $fuelType === 'phev';
$katTeile = fn(string $k) => str_starts_with($k, 'Tankfuellung:') ? ['Tankfuellung', substr($k, 13)] : [$k, null];

// Kategorien zu Gruppen zusammenfassen (Kostenstruktur und Jahresvergleich)
$gruppen = $istPhev ? [
    'kraftstoff' => [begriffeFuerEinheit($fuelType, 'l')['Verb'], 'fa-gas-pump', energieFarbe($fuelType, 'l'), ['Tankfuellung:l']],
    'strom' => [begriffeFuerEinheit($fuelType, 'kwh')['Verb'], 'fa-charging-station', energieFarbe($fuelType, 'kwh'), ['Tankfuellung:kwh']],
] : [
    // Tanken bzw. Laden in der Energiefarbe des Fahrzeugs (docs/design.md 3.4)
    'kraftstoff' => [$begriffe['Verb'], $begriffe['icon'], energieFarbe($fuelType), ['Tankfuellung']],
];
// Weitere Gruppen kommen mit den Kategorien vom API (#95): Fixkosten, Werkstatt & Wartung, Parken & Maut, Sonstiges
foreach (kategorieGruppen() as $gKey => $g) {
    if ($gKey !== 'kraftstoff') {
        $gruppen[$gKey] = [$g['name'], $g['icon'], $g['color'], []];
    }
}
$gruppen['wartung'] ??= ['Werkstatt & Wartung', 'fa-tools', '#fd7e14', []];
$gruppeVon = function (string $kategorie) use ($gruppen): string {
    foreach ($gruppen as $schluessel => [, , , $kategorien]) {
        if (in_array($kategorie, $kategorien, true)) {
            return $schluessel;
        }
    }
    $g = getKategorieGruppe($kategorie);
    return isset($gruppen[$g]) && $g !== 'kraftstoff' ? $g : 'sonstiges';
};
$kategorieName = fn(string $k) => getKategorieName($katTeile($k)[0], $fuelType, $katTeile($k)[1]);
$kategorieIcon = fn(string $k) => getCategoryIcon($katTeile($k)[0], $fuelType, $katTeile($k)[1]);

// Farben je Kategorie (Diagramm und Liste): Tanken und Laden als Energie-Token, alles andere vom API
$kategorieFarben = ['Tankfuellung' => energieFarbe($fuelType), 'Tankfuellung:l' => energieFarbe($fuelType, 'l'), 'Tankfuellung:kwh' => energieFarbe($fuelType, 'kwh'), 'Tankfuellung:kg' => energieFarbe($fuelType, 'kg')];
foreach ($eintraege as $e) {
    $kategorieFarben[$e['kategorie']] ??= getKategorieFarbe($e['kategorie']);
}

// Kategorie-Schlüssel der API: Tank-/Ladevorgänge als "Tankfuellung:<Einheit>"; nur beim Plug-in-Hybrid getrennt zeigen
$apiSchluessel = fn(string $k) => !$istPhev && str_starts_with($k, 'Tankfuellung:') ? 'Tankfuellung' : $k;
$gruppenAus = function (array $jeKategorie) use ($gruppen, $gruppeVon, $apiSchluessel): array {
    $zeile = array_fill_keys(array_keys($gruppen), 0.0);
    foreach ($jeKategorie as $k => $betrag) {
        $zeile[$gruppeVon($apiSchluessel((string)$k))] += (float)$betrag;
    }
    return $zeile;
};

// Summen je Kategorie und Gruppe
$kategorien = [];
foreach ($kosten['categories'] ?? [] as $c) {
    $k = $apiSchluessel($c['key']);
    $kategorien[$k] ??= ['summe' => 0.0, 'anzahl' => 0];
    $kategorien[$k]['summe'] += (float)$c['total'];
    $kategorien[$k]['anzahl'] += (int)$c['count'];
}
uasort($kategorien, fn($a, $b) => $b['summe'] <=> $a['summe']);
$gruppenSummen = $gruppenAus(array_map(fn($x) => $x['summe'], $kategorien));
$gesamt = (float)($kosten['total']['total'] ?? 0);
$km = $kosten['distanceKm'] ?? null;
$proMonat = $kosten['perMonth'] ?? null;
$monate = (int)($kosten['monthCount'] ?? 0);
$proKm = $kosten['costPerKm']['total'] ?? null;
$wartungPro10k = $km ? $gruppenSummen['wartung'] / $km * 10000 : null;
$groessteKategorie = array_key_first($kategorien);
// Leere Gruppen (z. B. "Sonstiges" ohne Einträge) nicht anzeigen
$sichtbareGruppen = array_filter($gruppen, fn($g) => $gruppenSummen[$g] > 0, ARRAY_FILTER_USE_KEY);

// Ausgaben pro Monat, gestapelt nach Gruppe
$monatsReihen = [];
foreach ($kosten['months'] ?? [] as $m) {
    if ($m['total'] > 0) {
        $monatsReihen[$m['month']] = $gruppenAus($m['byCategory'] ?? []);
    }
}
ksort($monatsReihen);
if ($selectedYear !== null) {
    // Ganzes Jahr zeigen, auch Monate ohne Ausgaben
    for ($i = 1; $i <= 12; $i++) {
        $monatsReihen[sprintf('%d-%02d', $selectedYear, $i)] ??= array_fill_keys(array_keys($gruppen), 0.0);
    }
    ksort($monatsReihen);
}

// Jahresvergleich (nur bei "Alle Jahre")
$jahresVergleich = [];
$vergleichsGruppen = $gruppen;
if ($selectedYear === null) {
    foreach ($jahre as $j) {
        $kj = $kostenApi($j);
        $zeile = $gruppenAus(array_column($kj['categories'] ?? [], 'total', 'key'));
        $jahresVergleich[$j] = ['gruppen' => $zeile, 'summe' => (float)($kj['total']['total'] ?? 0), 'km' => $kj['distanceKm'] ?? null, 'pro_km' => $kj['costPerKm']['total'] ?? null];
    }
}
$vergleichsGruppen = array_filter($gruppen, fn($g) => array_sum(array_map(fn($z) => $z['gruppen'][$g], $jahresVergleich)) > 0, ARRAY_FILTER_USE_KEY);

// Größte Einzelausgaben (ohne Tankfüllungen)
$groesste = array_filter($eintraege, fn($e) => $e['kategorie'] !== 'Tankfuellung');
usort($groesste, fn($a, $b) => (float)$b['kosten'] <=> (float)$a['kosten']);
$groesste = array_slice($groesste, 0, 5);

$zeitraumText = $selectedYear !== null ? 'im Jahr ' . $selectedYear : 'gesamt';
?>

<div class="mt-3 mt-lg-4">
    <!-- Zeitraum -->
    <form method="get" action="fahrzeug_detail.php#ausgaben" class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <input type="hidden" name="id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
        <h3 class="h5 mb-0">Ausgaben <?= htmlspecialchars($zeitraumText) ?></h3>
        <select name="jahr" class="form-select w-auto" aria-label="Zeitraum" onchange="this.form.submit()">
            <option value="">Alle Jahre</option>
            <?php foreach ($jahre as $j): ?>
                <option value="<?= $j ?>" <?= $selectedYear === $j ? 'selected' : '' ?>><?= $j ?></option>
            <?php endforeach; ?>
        </select>
        <noscript><button class="btn btn-outline-secondary">Anzeigen</button></noscript>
    </form>

    <?php if (!$eintraege): ?>
        <div class="card border-0 shadow-sm text-center">
            <div class="card-body p-5">
                <i class="fas fa-euro-sign fa-2x mb-3"></i>
                <p class="mb-0 text-body-secondary"><?= $selectedYear !== null ? 'Im Jahr ' . $selectedYear . ' gibt es keine Ausgaben.' : 'Noch keine Ausgaben erfasst. ' . $begriffe['vorgaenge'] . ', Versicherung, Werkstatt und Co. tauchen hier automatisch auf.' ?></p>
            </div>
        </div>
    <?php else: ?>

    <!-- Kennzahlen -->
    <div class="row g-2 g-md-3 mb-3">
        <div class="col-6 col-lg-3">
            <div class="kennzahl">
                <div class="small text-body-secondary">Ausgaben</div>
                <div class="kennzahl-wert"><?= $zahl($gesamt) ?> <small class="fw-normal">€</small></div>
                <div class="small text-body-secondary"><?= count($eintraege) ?> <?= count($eintraege) === 1 ? 'Eintrag' : 'Einträge' ?></div>
            </div>
        </div>
        <div class="col-6 col-lg-3">
            <div class="kennzahl">
                <div class="small text-body-secondary">Ø pro Monat</div>
                <div class="kennzahl-wert"><?= $proMonat !== null ? $zahl($proMonat) . ' <small class="fw-normal">€</small>' : '—' ?></div>
                <div class="small text-body-secondary"><?= $monate ?> <?= $monate === 1 ? 'Monat' : 'Monate' ?></div>
            </div>
        </div>
        <div class="col-6 col-lg-3">
            <div class="kennzahl" title="Alle Ausgaben geteilt durch die gefahrenen Kilometer im Zeitraum">
                <div class="small text-body-secondary">Kosten pro km</div>
                <div class="kennzahl-wert"><?= $proKm !== null ? $zahl($proKm) . ' <small class="fw-normal">€/km</small>' : '—' ?></div>
                <div class="small text-body-secondary"><?= $km ? $zahl($km, 0) . ' km gefahren' : 'Tachostände fehlen' ?></div>
            </div>
        </div>
        <div class="col-6 col-lg-3">
            <div class="kennzahl">
                <div class="small text-body-secondary">Größter Posten</div>
                <div class="kennzahl-wert text-truncate"><?= htmlspecialchars($kategorieName($groessteKategorie)) ?></div>
                <div class="small text-body-secondary"><?= $gesamt > 0 ? $zahl($kategorien[$groessteKategorie]['summe'] / $gesamt * 100, 0) . ' % der Ausgaben' : '' ?></div>
            </div>
        </div>
    </div>

    <!-- Kostenstruktur: ein Balken, aufgeteilt nach Gruppen -->
    <div class="card border-0 shadow-sm mb-3">
        <div class="card-body">
            <h3 class="h6 mb-3">Kostenstruktur</h3>
            <div class="progress-stacked kostenbalken mb-3" role="img" aria-label="Kostenstruktur">
                <?php foreach ($gruppen as $g => [$name, , $farbe]): if ($gruppenSummen[$g] <= 0) continue; ?>
                    <div class="progress" style="width: <?= round($gruppenSummen[$g] / $gesamt * 100, 2) ?>%" title="<?= htmlspecialchars($name) ?>">
                        <div class="progress-bar" style="background-color: <?= $farbe ?>"></div>
                    </div>
                <?php endforeach; ?>
            </div>
            <div class="row g-2">
                <?php foreach ($sichtbareGruppen as $g => [$name, $icon, $farbe]): ?>
                <div class="col-6 col-lg-3">
                    <div class="d-flex align-items-start gap-2">
                        <?= symbolKreis($icon, $farbe) ?>
                        <div class="min-w-0">
                            <div class="small text-body-secondary text-truncate"><?= htmlspecialchars($name) ?></div>
                            <div class="fw-semibold"><?= $zahl($gruppenSummen[$g]) ?> €</div>
                            <div class="small text-body-secondary">
                                <?= $gesamt > 0 ? $zahl($gruppenSummen[$g] / $gesamt * 100, 0) . ' %' : '' ?>
                                <?php if ($g === 'wartung' && $wartungPro10k !== null): ?> · <?= $zahl($wartungPro10k, 0) ?> € / 10.000 km<?php endif; ?>
                            </div>
                        </div>
                    </div>
                </div>
                <?php endforeach; ?>
            </div>
        </div>
    </div>

    <div class="row g-3 mb-3">
        <!-- Kategorien -->
        <div class="col-lg-5">
            <div class="card border-0 shadow-sm h-100">
                <div class="card-body">
                    <h3 class="h6 mb-3">Nach Kategorie</h3>
                    <div class="diagramm diagramm-klein mb-3"><canvas id="kategorieChart"></canvas></div>
                    <ul class="list-unstyled mb-0">
                        <?php foreach ($kategorien as $k => $d): $anteil = $gesamt > 0 ? $d['summe'] / $gesamt * 100 : 0; $farbe = $kategorieFarben[$k] ?? getKategorieFarbe(null); ?>
                        <li class="mb-2">
                            <div class="d-flex justify-content-between align-items-baseline gap-2 small">
                                <span class="text-truncate"><span class="farb-punkt" style="--farbe: <?= $farbe ?>" aria-hidden="true"></span><i class="fas <?= $kategorieIcon($k) ?> fa-fw me-1" aria-hidden="true"></i><?= htmlspecialchars($kategorieName($k)) ?> <span class="text-body-secondary">(<?= $d['anzahl'] ?>)</span></span>
                                <span class="text-nowrap fw-semibold"><?= $zahl($d['summe']) ?> €</span>
                            </div>
                            <div class="progress mt-1" style="height: 4px;" role="presentation">
                                <div class="progress-bar" style="width: <?= round($anteil, 2) ?>%; background-color: <?= $farbe ?>"></div>
                            </div>
                        </li>
                        <?php endforeach; ?>
                    </ul>
                </div>
            </div>
        </div>
        <!-- Verlauf -->
        <div class="col-lg-7">
            <div class="card border-0 shadow-sm h-100">
                <div class="card-body">
                    <h3 class="h6 mb-3">Ausgaben pro Monat <small class="text-body-secondary fw-normal">€</small></h3>
                    <div class="diagramm diagramm-hoch"><canvas id="monatChart"></canvas></div>
                </div>
            </div>
        </div>
    </div>

    <?php if ($groesste): ?>
    <!-- Größte Einzelausgaben -->
    <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-transparent py-3"><h3 class="h6 mb-0">Größte Einzelausgaben <small class="text-body-secondary fw-normal">ohne <?= $begriffe['vorgaenge'] ?></small></h3></div>
        <ul class="list-group list-group-flush">
            <?php foreach ($groesste as $e): $farbe = $kategorieFarben[$e['kategorie']] ?? getKategorieFarbe(null); ?>
            <li class="list-group-item d-flex align-items-center gap-3 py-3">
                <?= symbolKreis(getCategoryIcon($e['kategorie'], $fuelType), $farbe) ?>
                <div class="flex-grow-1 min-w-0">
                    <div class="fw-semibold text-truncate"><?= htmlspecialchars($e['beschreibung'] ?: $kategorieName($e['kategorie'])) ?></div>
                    <div class="small text-body-secondary text-truncate"><?= date('d.m.Y', strtotime($e['datum'])) ?> · <?= htmlspecialchars($kategorieName($e['kategorie'])) ?><?= !empty($e['standort']) ? ' · ' . htmlspecialchars($e['standort']) : '' ?></div>
                </div>
                <span class="fw-semibold text-nowrap"><?= $zahl($e['kosten']) ?> €</span>
            </li>
            <?php endforeach; ?>
        </ul>
    </div>
    <?php endif; ?>

    <?php if (count($jahresVergleich) > 1): ?>
    <!-- Jahresvergleich: PC als Tabelle, Handy als Liste -->
    <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-transparent py-3"><h3 class="h6 mb-0">Jahresvergleich</h3></div>
        <div class="table-responsive d-none d-md-block">
            <table class="table table-hover align-middle mb-0 jahrestabelle">
                <thead>
                    <tr>
                        <th>Jahr</th>
                        <?php foreach ($vergleichsGruppen as [$name]): ?><th class="text-end"><?= htmlspecialchars($name) ?></th><?php endforeach; ?>
                        <th class="text-end">Gesamt</th>
                        <th class="text-end">Strecke</th>
                        <th class="text-end">€/km</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($jahresVergleich as $j => $z): ?>
                    <tr>
                        <th scope="row"><?= $j ?></th>
                        <?php foreach (array_keys($vergleichsGruppen) as $g): ?><td class="text-end"><?= $z['gruppen'][$g] > 0 ? $zahl($z['gruppen'][$g]) . ' €' : '—' ?></td><?php endforeach; ?>
                        <td class="text-end fw-semibold"><?= $zahl($z['summe']) ?> €</td>
                        <td class="text-end"><?= $z['km'] ? $zahl($z['km'], 0) . ' km' : '—' ?></td>
                        <td class="text-end"><?= $z['pro_km'] !== null ? $zahl($z['pro_km']) . ' €' : '—' ?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <div class="list-group list-group-flush d-md-none">
            <?php foreach ($jahresVergleich as $j => $z): ?>
            <div class="list-group-item py-3">
                <div class="d-flex justify-content-between align-items-baseline mb-2">
                    <span class="fw-semibold fs-5"><?= $j ?></span>
                    <span class="fw-semibold"><?= $zahl($z['summe']) ?> €</span>
                </div>
                <div class="row row-cols-2 g-2 small">
                    <?php foreach ($vergleichsGruppen as $g => [$name]): ?>
                    <div><div class="text-body-secondary"><?= htmlspecialchars($name) ?></div><?= $zahl($z['gruppen'][$g]) ?> €</div>
                    <?php endforeach; ?>
                    <div><div class="text-body-secondary">Strecke</div><?= $z['km'] ? $zahl($z['km'], 0) . ' km' : '—' ?></div>
                    <div><div class="text-body-secondary">Kosten pro km</div><?= $z['pro_km'] !== null ? $zahl($z['pro_km']) . ' €' : '—' ?></div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
    </div>
    <?php endif; ?>
    <?php endif; ?>
</div>

<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'vendor/chartjs/chart.umd.min.js')) ?>"></script>
<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'js/diagramm-text.js')) ?>"></script>
<script>
(function () {
    if (!window.Chart) return;
    var zahl = function (wert, stellen) { return Number(wert).toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }); };
    // Farben können Tokens sein (var(--fs-…)): für das Canvas in ihren Wert auflösen
    var css = getComputedStyle(document.documentElement);
    var farbe = function (f) { var m = /^var\((--[\w-]+)\)$/.exec(f); return m ? css.getPropertyValue(m[1]).trim() : f; };
    var euro = function (c) { return (c.dataset.label ? c.dataset.label + ': ' : c.label + ': ') + zahl(c.parsed.y !== undefined ? c.parsed.y : c.parsed, 2) + ' €'; };

    var el = document.getElementById('kategorieChart');
    if (el) {
        new Chart(el, {
            type: 'doughnut',
            data: {
                labels: <?= json_encode(array_map($kategorieName, array_keys($kategorien)), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?>,
                datasets: [{
                    data: <?= json_encode(array_map(fn($d) => round($d['summe'], 2), array_values($kategorien))) ?>,
                    backgroundColor: <?= json_encode(array_map(fn($k) => $kategorieFarben[$k] ?? getKategorieFarbe(null), array_keys($kategorien))) ?>.map(farbe),
                    borderColor: css.getPropertyValue('--fs-card').trim(),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '62%',
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.label + ': ' + zahl(c.parsed, 2) + ' €'; } } } }
            }
        });
    }

    el = document.getElementById('monatChart');
    if (el) {
        var monate = <?= json_encode(array_map(fn($m) => formatMonat($m), array_keys($monatsReihen)), JSON_UNESCAPED_UNICODE) ?>;
        var reihen = <?= json_encode(array_map(fn($g) => [
            'label' => $gruppen[$g][0],
            'data' => array_map(fn($z) => round($z[$g], 2), array_values($monatsReihen)),
            'backgroundColor' => $gruppen[$g][2],
            'borderRadius' => 3,
            'stack' => 'a',
        ], array_values(array_filter(array_keys($gruppen), fn($g) => $gruppenSummen[$g] > 0)))) ?>;
        reihen.forEach(function (r) { r.backgroundColor = farbe(r.backgroundColor); });
        new Chart(el, {
            type: 'bar',
            data: { labels: monate, datasets: reihen },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } },
                    tooltip: {
                        filter: function (c) { return c.parsed.y > 0; },
                        callbacks: {
                            label: euro,
                            footer: function (items) { return 'Summe: ' + zahl(items.reduce(function (s, c) { return s + c.parsed.y; }, 0), 2) + ' €'; }
                        }
                    }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
                    y: { stacked: true, ticks: { callback: function (v) { return zahl(v, 0); } } }
                }
            }
        });
    }
})();
</script>
