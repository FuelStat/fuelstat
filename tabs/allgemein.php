<?php
include_once __DIR__ . '/../includes/functions.php';
include_once __DIR__ . '/../includes/api_helpers.php';

$stats = getVehicleStatsForDisplay($api, $fahrzeug_id);
$currentOdo = $stats['currentOdo'] ?? null;
$trend = $stats['trend'] ?? null;
$avgPrice = $stats['avgPricePerLiter'] ?? null;
$fahrleistung = getFahrleistungFromApi($stats);
$faelligkeiten = getFaelligkeitenFromApi($api, $fahrzeug_id);

$letzterReifen = getLetzterEintragApi($api, $fahrzeug_id, 'Reifen');
$letzteWartung = getLetzterEintragApi($api, $fahrzeug_id, 'Wartung');
$letzterTUV = getLetzterEintragApi($api, $fahrzeug_id, 'TUV');

$fuel_type = $fahrzeug['fuel_type'] ?? $fahrzeug['kraftstoff'] ?? '';
$kraftstoffTexte = getKraftstoffOptionen();

// Marke, Modell, Baujahr, Kraftstoff und Tank- bzw. Akkugröße als eine Zeile
$fahrzeugDetails = array_filter([
    trim(($fahrzeug['brand'] ?? '') . ' ' . ($fahrzeug['model'] ?? '')),
    !empty($fahrzeug['year']) ? 'Baujahr ' . (int)$fahrzeug['year'] : '',
    // Mehrere Sorten (#140): statt der Antriebsart die Sorten, z. B. „Autogas (LPG), Super E5“
    count(sortenDesFahrzeugs($fahrzeug)) > 1
        ? implode(', ', array_map('sortenName', sortenDesFahrzeugs($fahrzeug)))
        : ($kraftstoffTexte[$fuel_type] ?? ucfirst((string)$fuel_type)),
    !empty($fahrzeug['tank_capacity']) ? ($fuel_type === 'phev' ? 'Tank' : $begriffe['speicher']) . ' ' . number_format((float)$fahrzeug['tank_capacity'], fmod((float)$fahrzeug['tank_capacity'], 1) ? 1 : 0, ',', '.') . ' ' . $einheitKurz : '',
    // Plug-in-Hybrid: Akku zusätzlich zum Tank
    !empty($fahrzeug['battery_capacity']) && $fuel_type === 'phev' ? 'Akku ' . number_format((float)$fahrzeug['battery_capacity'], fmod((float)$fahrzeug['battery_capacity'], 1) ? 1 : 0, ',', '.') . ' kWh' : '',
]);
// Plug-in-Hybrid mit Tank- und Ladevorgängen: Verbrauch je Einheit statt einer Kachel für Verbrauch und Preis
$verbrauchJeEinheit = count($stats['units'] ?? []) > 1 ? $stats['units'] : [];
uksort($verbrauchJeEinheit, fn($a, $b) => array_search($a, ['l', 'kwh', 'kg']) <=> array_search($b, ['l', 'kwh', 'kg']));

// Termine: dringendste zuerst, danach Reifen (ohne Fälligkeit)
$statusReihenfolge = ['ueberfaellig' => 0, 'bald' => 1, 'ok' => 2, 'unbekannt' => 3];
usort($faelligkeiten, fn($a, $b) => [$statusReihenfolge[$a['status']] ?? 9, $a['tage'] ?? PHP_INT_MAX] <=> [$statusReihenfolge[$b['status']] ?? 9, $b['tage'] ?? PHP_INT_MAX]);
$letzteEintraege = ['Wartung' => $letzteWartung, 'TUV' => $letzterTUV];
// Kachel "Ø Verbrauch": Durchschnitt über alle Abschnitte, darunter der letzte Abschnitt im Vergleich dazu
$schnitt = $stats['avgConsumption'] ?? null;
$aktuell = $trend['current'] ?? null;
$diff = $aktuell !== null && $schnitt !== null ? round($aktuell - $schnitt, 2) : null;
$eintragUrl = '../pages/eintrag_hinzufuegen.php?fahrzeug_id=' . urlencode($fahrzeug_id);

// Kosten dieses Jahr und Verlauf der letzten 6 Monate (Kosten als Balken, Verbrauch als Linie); Werte aus der API (#82)
$statistik = getStatistikDatenFromApi($api, $fahrzeug_id);
$diesesJahr = (string)date('Y');
$kostenMonat = $statistik['kostenProMonat'];
$kostenJahr = array_sum(array_filter($kostenMonat, fn($monat) => str_starts_with((string)$monat, $diesesJahr), ARRAY_FILTER_USE_KEY));
$verbrauchMonat = $statistik['verbrauchProMonat'];
$verlauf = [];
for ($i = 5; $i >= 0; $i--) {
    $m = date('Y-m', strtotime(date('Y-m-01') . " -$i months"));
    $verlauf[] = ['monat' => formatMonat($m), 'kosten' => round($kostenMonat[$m] ?? 0, 2), 'verbrauch' => isset($verbrauchMonat[$m]) && $verbrauchMonat[$m] > 0 ? (float)$verbrauchMonat[$m] : null];
}
$hatVerlauf = array_sum(array_column($verlauf, 'kosten')) > 0;
?>

<div class="mt-3 mt-lg-4">
    <div class="row g-3 g-lg-4">
        <div class="col-lg-5">
            <div class="hero-spalte">
                <!-- VehicleHero: Foto, Name, Kennzeichen, Kilometerstand, Energie-Badge -->
                <div class="fahrzeug-hero fahrzeug-hero-gross">
                    <img src="<?= htmlspecialchars(fahrzeugBildUrl($fahrzeug, $baseUrl)) ?>" alt="">
                    <?php if ($istBesitzer): ?>
                    <div class="fahrzeug-hero-aktionen d-none d-lg-flex">
                        <a href="../pages/fahrzeug_bearbeiten.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="hero-knopf" aria-label="Fahrzeug bearbeiten" data-tipp="Fahrzeug bearbeiten"><i class="fas fa-pen" aria-hidden="true"></i></a>
                    </div>
                    <?php endif; ?>
                    <div class="fahrzeug-hero-text">
                        <div class="fahrzeug-hero-name text-truncate" aria-hidden="true"><?= htmlspecialchars($fahrzeug['name'] ?? 'Fahrzeug') ?></div>
                        <div class="d-flex flex-wrap align-items-center gap-2">
                            <?php if (!empty($fahrzeug['license_plate'])): ?><span class="kennzeichen"><?= htmlspecialchars($fahrzeug['license_plate']) ?></span><?php endif; ?>
                            <span class="energie-badge" style="--farbe: <?= energieFarbe($fuel_type) ?>"><i class="fas <?= $begriffe['icon'] ?>" aria-hidden="true"></i><?= htmlspecialchars($kraftstoffTexte[$fuel_type] ?? ucfirst((string)$fuel_type)) ?></span>
                            <?php if ($currentOdo !== null): ?><span class="fahrzeug-hero-zeile zahl"><?= number_format($currentOdo, 0, ',', '.') ?> km</span><?php endif; ?>
                        </div>
                    </div>
                </div>
                <?php if ($fahrzeugDetails): ?>
                    <p class="fs-label mt-2 mb-0 px-1"><?= htmlspecialchars(implode(' · ', $fahrzeugDetails)) ?></p>
                <?php endif; ?>
            </div>
        </div>
        <div class="col-lg-7">
            <div class="row g-2">
                <div class="col-6 col-md-4">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Tachostand</div>
                        <div class="kennzahl-wert"><?= $currentOdo !== null ? number_format($currentOdo, 0, ',', '.') . ' km' : '—' ?></div>
                    </div>
                </div>
                <div class="col-6 col-md-4">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Fahrleistung</div>
                        <div class="kennzahl-wert"><?= $fahrleistung !== null ? number_format($fahrleistung['km'], 0, ',', '.') . ' km' : '—' ?></div>
                        <?php if ($fahrleistung !== null): ?><div class="small text-body-secondary"><?= htmlspecialchars($fahrleistung['basis']) ?></div><?php endif; ?>
                    </div>
                </div>
                <div class="col-6 col-md-4">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Kosten <?= $diesesJahr ?></div>
                        <div class="kennzahl-wert"><?= number_format($kostenJahr, 2, ',', '.') ?> €</div>
                    </div>
                </div>
                <?php foreach ($verbrauchJeEinheit as $u => $w):
                    // Durchschnitt statt letztem Abschnitt: beim Plug-in-Hybrid schwankt der Wert je nach elektrischem Anteil stark
                    $wSchnitt = $w['avgConsumption'] ?? null;
                    $wAktuell = $w['trend']['current'] ?? null;
                    $wZusatz = array_filter([
                        $wAktuell !== null ? 'zuletzt ' . number_format($wAktuell, 2, ',', '.') : '',
                        $w['avgPrice'] !== null ? 'Ø ' . number_format((float)$w['avgPrice'], 3, ',', '.') . ' €/' . einheitKurz($u) : '',
                    ]); ?>
                <div class="col-6 col-md-4">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Ø Verbrauch <?= begriffeFuerEinheit($fuel_type, $u)['energie'] ?></div>
                        <div class="kennzahl-wert"><?= $wSchnitt !== null ? number_format($wSchnitt, 2, ',', '.') . ' <small class="fw-normal">' . einheitKurz($u) . '/100 km</small>' : '—' ?></div>
                        <?php if ($wZusatz): ?><div class="small text-body-secondary"><?= implode(' · ', $wZusatz) ?></div><?php endif; ?>
                    </div>
                </div>
                <?php endforeach; ?>
                <?php if (!$verbrauchJeEinheit): ?>
                <div class="col-6 col-md-4">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Ø Verbrauch</div>
                        <div class="kennzahl-wert"><?= $schnitt !== null ? number_format($schnitt, 2, ',', '.') . ' <small class="fw-normal">' . $einheitKurz . '/100 km</small>' : '—' ?></div>
                        <?php if ($aktuell !== null): ?>
                            <div class="small text-body-secondary">zuletzt <?= number_format($aktuell, 2, ',', '.') ?><?php if ($diff !== null && abs($diff) >= 0.01): ?>
                                <span class="text-<?= $diff > 0 ? 'danger' : 'success' ?>">(<?= ($diff > 0 ? '+' : '') . number_format($diff, 2, ',', '.') ?>)</span><?php endif; ?></div>
                        <?php endif; ?>
                    </div>
                </div>
                <div class="col-6 col-md-4">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Ø Preis/<?= $einheitKurz ?></div>
                        <div class="kennzahl-wert"><?= $avgPrice !== null ? number_format($avgPrice, 3, ',', '.') . ' €' : '—' ?></div>
                    </div>
                </div>
                <?php endif; ?>
            </div>

            <!-- Termine: Fälligkeiten und letzte Wartung, TÜV und Reifen in einer Karte -->
            <div class="card mt-3" id="termine">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h2 class="mb-0">Nächste Termine</h2>
                    <?php if ($darfErfassen): ?>
                    <a href="<?= htmlspecialchars($eintragUrl) ?>&kategorie=Wartung" class="btn btn-secondary btn-sm">Termin erfassen</a>
                    <?php endif; ?>
                </div>
                <ul class="list-group list-group-flush">
                    <?php foreach ($faelligkeiten as $f):
                        // Status kommt aus der API; hier nur der Abstand in Worten („in 12 Tagen“, „seit 5 Tagen überfällig“)
                        $text = isset($f['tage']) && !empty($f['faellig_datum'])
                            ? terminAbstand((int)$f['tage'])
                            : (['ueberfaellig' => 'überfällig', 'bald' => 'bald fällig', 'ok' => 'in Ordnung'][$f['status']] ?? 'Datum fehlt');
                        $letzter = $letzteEintraege[$f['kategorie']] ?? null;
                    ?>
                    <li class="list-group-item termin-zeile">
                        <?= symbolKreis(getCategoryIcon($f['kategorie']), 'var(--fs-brand)') ?>
                        <div class="termin-text">
                            <div class="fs-headline"><?= htmlspecialchars($f['titel']) ?></div>
                            <div class="fs-label">
                                <?php if ($f['faellig_datum']): ?>
                                    fällig am <?= date('d.m.Y', strtotime($f['faellig_datum'])) ?><?php if ($f['faellig_km']): ?> oder bei <?= number_format($f['faellig_km'], 0, ',', '.') ?> km<?php endif; ?>
                                    <?php if (!empty($f['letzte'])): ?>
                                        <br>zuletzt <?= date('d.m.Y', strtotime($f['letzte'])) ?><?php if ($letzter && !empty($letzter['tachostand'])): ?> bei <?= number_format((int)$letzter['tachostand'], 0, ',', '.') ?> km<?php endif; ?>
                                        <?php if ($letzter && !empty($letzter['beschreibung'])): ?> · <?= htmlspecialchars($letzter['beschreibung']) ?><?php endif; ?>
                                    <?php elseif (($f['quelle'] ?? null) === 'erstzulassung'): ?>
                                        <br>berechnet aus der Erstzulassung
                                    <?php elseif (($f['quelle'] ?? null) === 'faelligkeitsmonat'): ?>
                                        <br>laut Fahrzeugangaben
                                    <?php endif; ?>
                                <?php else: ?>
                                    <a href="<?= htmlspecialchars($eintragUrl) ?>&kategorie=<?= urlencode($f['kategorie']) ?>">Letzten Termin erfassen</a>, um erinnert zu werden
                                <?php endif; ?>
                            </div>
                        </div>
                        <?= statusBadge((string)$f['status'], $text, 'ms-auto') ?>
                    </li>
                    <?php endforeach; ?>
                    <li class="list-group-item d-flex align-items-center gap-3">
                        <?= symbolKreis(getCategoryIcon('Reifen'), 'var(--fs-brand)') ?>
                        <div class="flex-grow-1 min-w-0">
                            <div class="fs-headline"><?= getKategorieName('Reifen') ?></div>
                            <div class="fs-label">
                                <?php if ($letzterReifen): ?>
                                    letzter Wechsel am <?= date('d.m.Y', strtotime($letzterReifen['datum'])) ?><?php if (!empty($letzterReifen['tachostand'])): ?> bei <?= number_format((int)$letzterReifen['tachostand'], 0, ',', '.') ?> km<?php endif; ?>
                                    <?php if (!empty($letzterReifen['beschreibung'])): ?> · <?= htmlspecialchars($letzterReifen['beschreibung']) ?><?php endif; ?>
                                <?php else: ?>
                                    <a href="<?= htmlspecialchars($eintragUrl) ?>&kategorie=Reifen">Reifenwechsel erfassen</a>
                                <?php endif; ?>
                            </div>
                        </div>
                    </li>
                </ul>
            </div>

            <?php if ($hatVerlauf): ?>
            <!-- Letzte 6 Monate: Kosten (Balken) und Verbrauch (Linie) -->
            <div class="card mt-3">
                <div class="card-body">
                    <h2 class="mb-2">Letzte 6 Monate</h2>
                    <div class="diagramm-mini"><canvas id="verlaufMini" aria-label="Kosten und Verbrauch der letzten 6 Monate" role="img"></canvas></div>
                </div>
            </div>
            <?php endif; ?>

            <?php if ($istBesitzer): ?>
            <div class="d-flex flex-wrap gap-2 mt-3">
                <a href="../pages/fahrzeug_bearbeiten.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-secondary">
                    <i class="fas fa-pen" aria-hidden="true"></i>Fahrzeug bearbeiten
                </a>
                <form method="post" action="../pages/fahrzeug_loeschen.php" onsubmit="return confirm('Möchtest du dieses Fahrzeug wirklich löschen? Alle zugehörigen Einträge werden ebenfalls entfernt!');">
                    <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                    <button type="submit" class="btn btn-outline-danger">
                        <i class="fas fa-trash-alt" aria-hidden="true"></i>Fahrzeug löschen
                    </button>
                </form>
            </div>
            <?php endif; ?>
        </div>
    </div>
</div>

<?php if ($hatVerlauf): ?>
<script>
// Mini-Diagramm (#48); Chart.js wird vom Statistik-Reiter derselben Seite geladen
document.addEventListener('DOMContentLoaded', function () {
  var ctx = document.getElementById('verlaufMini');
  if (!ctx || !window.Chart) return;
  var daten = <?= json_encode($verlauf, JSON_UNESCAPED_UNICODE) ?>;
  var stil = getComputedStyle(document.documentElement);
  var mitVerbrauch = daten.some(function (d) { return d.verbrauch !== null; });
  new Chart(ctx, {
    data: {
      labels: daten.map(function (d) { return d.monat; }),
      datasets: [
        { type: 'bar', label: 'Kosten (€)', data: daten.map(function (d) { return d.kosten; }), backgroundColor: stil.getPropertyValue('--fs-brand').trim(), borderRadius: 6, yAxisID: 'y', order: 2 }
      ].concat(mitVerbrauch ? [{ type: 'line', label: <?= json_encode('Verbrauch (' . $einheitKurz . '/100 km)') ?>, data: daten.map(function (d) { return d.verbrauch; }), borderColor: stil.getPropertyValue('--fs-energy-<?= energieToken($fuel_type) ?>').trim(), backgroundColor: stil.getPropertyValue('--fs-card').trim(), borderWidth: 2.5, pointRadius: 3, order: 1, tension: .3, spanGaps: true, yAxisID: 'y2' }] : [])
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: mitVerbrauch, labels: { boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: function (v) { return v + ' €'; } } },
        y2: { display: mitVerbrauch, position: 'right', grid: { drawOnChartArea: false } }
      }
    }
  });
});
</script>
<?php endif; ?>
