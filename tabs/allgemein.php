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
    $fahrzeug['license_plate'] ?? '',
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

// Nächster Termin (#48): der dringendste mit Datum steht oben
$naechsterTermin = null;
foreach ($faelligkeiten as $f) {
    if (!empty($f['faellig_datum'])) {
        $naechsterTermin = $f;
        break;
    }
}
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
    <div class="row g-4">
        <div class="col-md-4">
            <img src="<?= htmlspecialchars(fahrzeugBildUrl($fahrzeug, $baseUrl)) ?>" alt="Fahrzeugbild" class="img-fluid rounded-4 w-100 object-fit-cover" style="aspect-ratio: 16 / 9;">
        </div>
        <div class="col-md-8">
            <?php if ($fahrzeugDetails): ?>
                <p class="text-body-secondary small mb-3"><?= htmlspecialchars(implode(' · ', $fahrzeugDetails)) ?></p>
            <?php endif; ?>

            <?php if ($naechsterTermin):
                $tFarbe = ['ueberfaellig' => 'danger', 'bald' => 'warning'][$naechsterTermin['status']] ?? 'secondary';
                $tage = (int)$naechsterTermin['tage']; ?>
            <!-- Nächster Termin prominent (#48) -->
            <a href="#termine" class="naechster-termin text-reset text-decoration-none border-<?= $tFarbe ?> mb-3">
                <i class="fas <?= getCategoryIcon($naechsterTermin['kategorie']) ?> text-<?= $tFarbe ?>"></i>
                <span class="flex-grow-1 min-w-0">
                    <span class="d-block small text-body-secondary">Nächster Termin</span>
                    <span class="fw-semibold"><?= htmlspecialchars($naechsterTermin['titel']) ?></span>
                    <span class="text-body-secondary">· <?= date('d.m.Y', strtotime($naechsterTermin['faellig_datum'])) ?></span>
                </span>
                <span class="badge text-bg-<?= $tFarbe ?>"><?= $tage < 0 ? 'seit ' . abs($tage) . ' Tagen' : ($tage === 0 ? 'heute' : 'in ' . $tage . ' Tagen') ?></span>
            </a>
            <?php endif; ?>

            <div class="row g-2">
                <div class="col-6 col-lg-3">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Tachostand</div>
                        <div class="kennzahl-wert"><?= $currentOdo !== null ? number_format($currentOdo, 0, ',', '.') . ' km' : '—' ?></div>
                    </div>
                </div>
                <div class="col-6 col-lg-3">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Fahrleistung</div>
                        <div class="kennzahl-wert"><?= $fahrleistung !== null ? number_format($fahrleistung['km'], 0, ',', '.') . ' km' : '—' ?></div>
                        <?php if ($fahrleistung !== null): ?><div class="small text-body-secondary"><?= htmlspecialchars($fahrleistung['basis']) ?></div><?php endif; ?>
                    </div>
                </div>
                <div class="col-6 col-lg-3">
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
                <div class="col-6 col-lg-3">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Ø Verbrauch <?= begriffeFuerEinheit($fuel_type, $u)['energie'] ?></div>
                        <div class="kennzahl-wert"><?= $wSchnitt !== null ? number_format($wSchnitt, 2, ',', '.') . ' <small class="fw-normal">' . einheitKurz($u) . '/100 km</small>' : '—' ?></div>
                        <?php if ($wZusatz): ?><div class="small text-body-secondary"><?= implode(' · ', $wZusatz) ?></div><?php endif; ?>
                    </div>
                </div>
                <?php endforeach; ?>
                <?php if (!$verbrauchJeEinheit): ?>
                <div class="col-6 col-lg-3">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Ø Verbrauch</div>
                        <div class="kennzahl-wert"><?= $schnitt !== null ? number_format($schnitt, 2, ',', '.') . ' <small class="fw-normal">' . $einheitKurz . '/100 km</small>' : '—' ?></div>
                        <?php if ($aktuell !== null): ?>
                            <div class="small text-body-secondary">zuletzt <?= number_format($aktuell, 2, ',', '.') ?><?php if ($diff !== null && abs($diff) >= 0.01): ?>
                                <span class="text-<?= $diff > 0 ? 'danger' : 'success' ?>">(<?= ($diff > 0 ? '+' : '') . number_format($diff, 2, ',', '.') ?>)</span><?php endif; ?></div>
                        <?php endif; ?>
                    </div>
                </div>
                <div class="col-6 col-lg-3">
                    <div class="kennzahl">
                        <div class="small text-body-secondary">Ø Preis/<?= $einheitKurz ?></div>
                        <div class="kennzahl-wert"><?= $avgPrice !== null ? number_format($avgPrice, 3, ',', '.') . ' €' : '—' ?></div>
                    </div>
                </div>
                <?php endif; ?>
            </div>

            <?php if ($hatVerlauf): ?>
            <!-- Letzte 6 Monate: Kosten (Balken) und Verbrauch (Linie) -->
            <div class="card border-0 shadow-sm mt-4">
                <div class="card-body">
                    <h3 class="h6 mb-2">Letzte 6 Monate</h3>
                    <div class="diagramm-mini"><canvas id="verlaufMini" aria-label="Kosten und Verbrauch der letzten 6 Monate" role="img"></canvas></div>
                </div>
            </div>
            <?php endif; ?>

            <!-- Termine: Fälligkeiten und letzte Wartung, TÜV und Reifen in einer Karte -->
            <div class="card border-0 shadow-sm mt-4" id="termine">
                <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3">
                    <h3 class="h5 mb-0">Termine</h3>
                    <a href="<?= htmlspecialchars($eintragUrl) ?>&kategorie=Wartung" class="btn btn-outline-primary btn-sm">
                        <i class="fas fa-plus me-1"></i> Erfassen
                    </a>
                </div>
                <ul class="list-group list-group-flush">
                    <?php foreach ($faelligkeiten as $f):
                        $farbe = ['ueberfaellig' => 'danger', 'bald' => 'warning', 'ok' => 'success', 'unbekannt' => 'secondary'][$f['status']] ?? 'secondary';
                        $text = ['ueberfaellig' => 'überfällig', 'bald' => 'bald fällig', 'ok' => 'ok', 'unbekannt' => 'offen'][$f['status']] ?? $f['status'];
                        $letzter = $letzteEintraege[$f['kategorie']] ?? null;
                    ?>
                    <li class="list-group-item d-flex align-items-center gap-3 py-3">
                        <i class="fas <?= getCategoryIcon($f['kategorie']) ?> fa-fw text-body-secondary"></i>
                        <div class="flex-grow-1 min-w-0">
                            <div class="fw-semibold"><?= htmlspecialchars($f['titel']) ?></div>
                            <div class="small text-body-secondary">
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
                        <span class="badge text-bg-<?= $farbe ?>"><?= $text ?></span>
                    </li>
                    <?php endforeach; ?>
                    <li class="list-group-item d-flex align-items-center gap-3 py-3">
                        <i class="fas <?= getCategoryIcon('Reifen') ?> fa-fw text-body-secondary"></i>
                        <div class="flex-grow-1 min-w-0">
                            <div class="fw-semibold"><?= getKategorieName('Reifen') ?></div>
                            <div class="small text-body-secondary">
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

            <div class="d-flex gap-2 mt-4">
                <a href="../pages/fahrzeug_bearbeiten.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-primary">
                    <i class="fas fa-edit"></i> Bearbeiten
                </a>
                <form method="post" action="../pages/fahrzeug_loeschen.php" onsubmit="return confirm('Möchtest du dieses Fahrzeug wirklich löschen? Alle zugehörigen Einträge werden ebenfalls entfernt!');">
                    <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                    <button type="submit" class="btn btn-outline-danger">
                        <i class="fas fa-trash-alt"></i> Löschen
                    </button>
                </form>
            </div>
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
        { type: 'bar', label: 'Kosten (€)', data: daten.map(function (d) { return d.kosten; }), backgroundColor: stil.getPropertyValue('--bs-primary').trim() || '#0d6efd', borderRadius: 4, yAxisID: 'y' }
      ].concat(mitVerbrauch ? [{ type: 'line', label: <?= json_encode('Verbrauch (' . $einheitKurz . '/100 km)') ?>, data: daten.map(function (d) { return d.verbrauch; }), borderColor: stil.getPropertyValue('--bs-success').trim() || '#198754', backgroundColor: 'transparent', tension: .3, spanGaps: true, yAxisID: 'y2' }] : [])
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: mitVerbrauch, labels: { boxWidth: 12 } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: function (v) { return v + ' €'; } } },
        y2: { display: mitVerbrauch, position: 'right', grid: { drawOnChartArea: false } }
      }
    }
  });
});
</script>
<?php endif; ?>
