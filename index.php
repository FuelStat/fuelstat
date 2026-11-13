<?php
// Start (#158, docs/design.md 7.1): ein Fahrzeug im Blick – Wechsler, Hero, drei Kennzahlen, nächste Termine,
// letzte Einträge. Welches Fahrzeug, entscheidet includes/header.php ($startFahrzeug: gewählt, zuletzt genutzt oder
// das erste). Alle Fahrzeuge als Karten: pages/fahrzeuge.php. Alle Zahlen kommen aus der API.
include 'includes/session.php';
include 'includes/functions.php';
include 'includes/header.php';

// Nicht angemeldet: Willkommensseite mit Registrierung/Login
if (!isApiAuthenticated()) {
    echo '<div class="container mt-4">';
    include 'includes/willkommen.php';
    echo '</div>';
    include 'includes/footer.php';
    exit;
}

$vehicles = [];
$ladeFehler = false;
try {
    $vehicles = $api->getVehicles();
} catch (Throwable $e) {
    $ladeFehler = true;
}
$fz = null;
foreach ($vehicles as $v) {
    if ($startFahrzeug && (string)$v['id'] === (string)$startFahrzeug['id']) {
        $fz = $v;
    }
}

if ($fz):
    $vid = (string)$fz['id'];
    $detail = 'pages/fahrzeug_detail.php?id=' . urlencode($vid);
    $fuelType = $fz['fuel_type'] ?? null;
    $einheit = einheitKurz(getEinheitFuerKraftstoff($fuelType));
    $kraftstoffNamen = getKraftstoffOptionen();
    $euro = fn($v) => number_format((float)$v, 2, ',', '.') . ' €';

    $stats = $costs = $liste = [];
    try { $stats = $api->getVehicleStats($vid); } catch (Throwable $e) { }
    try { $costs = $api->getVehicleCosts($vid); } catch (Throwable $e) { }
    try { $liste = $api->getTimeline($vid, ['per_page' => 5]); } catch (Throwable $e) { }
    $termine = getFaelligkeitenFromApi($api, $vid);

    // Kachel 1: Ø Verbrauch über alle Abschnitte; Plug-in-Hybrid: Kraftstoff und Strom nebeneinander
    $verbrauch = [];
    foreach (count($stats['units'] ?? []) > 1 ? ['l', 'kwh'] : [null] as $u) {
        $wert = $u === null ? ($stats['avgConsumption'] ?? null) : ($stats['units'][$u]['avgConsumption'] ?? null);
        if ($wert !== null) {
            $verbrauch[] = [number_format((float)$wert, 1, ',', '.'), ($u === null ? $einheit : einheitKurz($u)) . '/100 km'];
        }
    }
    $kmKosten = $costs['costPerKm']['total'] ?? null;
    $monat = $costs['currentMonth']['total'] ?? null;

    // Nächste Termine: nur solche mit Datum, dringendste zuerst, höchstens drei
    $rang = ['ueberfaellig' => 0, 'bald' => 1, 'ok' => 2];
    $naechste = array_values(array_filter($termine, fn($t) => ($t['art'] ?? 'due') === 'due' && !empty($t['faellig_datum'])));
    usort($naechste, fn($a, $b) => [$rang[$a['status']] ?? 9, $a['tage'] ?? PHP_INT_MAX] <=> [$rang[$b['status']] ?? 9, $b['tage'] ?? PHP_INT_MAX]);
    $naechste = array_slice($naechste, 0, 3);

    $zwecke = fahrtZwecke();
    $tachoFehlt = (int)($stats['missingOdometer'] ?? 0);
endif;
?>
<div class="container mt-3 mt-lg-4 start">
<?php if ($ladeFehler): ?>
    <div class="alert alert-danger">Die Fahrzeuge konnten gerade nicht geladen werden. Bitte versuche es gleich noch einmal.</div>
<?php elseif (!$fz): ?>
    <!-- EmptyState: Symbol, ein Satz, eine Aktion -->
    <div class="card leer-zustand mx-auto">
        <div class="card-body">
            <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-car-side"></i></span>
            <h1 class="h2">Noch kein Fahrzeug angelegt</h1>
            <p class="text-body-secondary mb-4">Lege dein erstes Fahrzeug an, danach kannst du Tankfüllungen, Ladevorgänge und Ausgaben erfassen.</p>
            <a href="pages/fahrzeug_hinzufuegen.php" class="btn btn-primary btn-lg px-4">
                <i class="fas fa-plus" aria-hidden="true"></i>Fahrzeug hinzufügen
            </a>
            <p class="fs-footnote mt-4 mb-0">
                <i class="fas fa-file-import me-1" aria-hidden="true"></i>Daten aus einer anderen App oder Excel? Nach dem Anlegen unter „Einträge“ → „Import“ übernehmen.
            </p>
        </div>
    </div>
<?php else: ?>
    <h1 class="visually-hidden">Start: <?= htmlspecialchars($fz['name'] ?? 'Fahrzeug') ?></h1>

    <!-- VehicleSwitcher (mobil; am PC steht er in der Kopfleiste) -->
    <div class="d-flex align-items-center gap-2 mb-3 d-lg-none">
        <?php if (count($vehicles) > 1): ?>
        <div class="dropdown min-w-0">
            <button type="button" class="kopf-wechsler dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Fahrzeug wählen, gewählt: <?= htmlspecialchars($fz['name'] ?? '') ?>">
                <i class="fas fa-car-side" aria-hidden="true"></i><span class="text-truncate"><?= htmlspecialchars($fz['name'] ?? 'Fahrzeug') ?></span>
            </button>
            <ul class="dropdown-menu">
                <?php foreach ($vehicles as $v): $aktiv = (string)$v['id'] === $vid; ?>
                <li><a class="dropdown-item<?= $aktiv ? ' active' : '' ?>" href="index.php?fahrzeug=<?= htmlspecialchars(urlencode((string)$v['id'])) ?>"<?= $aktiv ? ' aria-current="true"' : '' ?>><i class="fas fa-car-side fa-fw" aria-hidden="true"></i><?= htmlspecialchars($v['name'] ?? 'Fahrzeug') ?></a></li>
                <?php endforeach; ?>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="pages/fahrzeuge.php"><i class="fas fa-table-cells-large fa-fw" aria-hidden="true"></i>Alle Fahrzeuge</a></li>
            </ul>
        </div>
        <?php endif; ?>
    </div>

    <div class="row g-3 g-lg-4">
        <div class="col-lg-5">
            <!-- VehicleHero: Foto, Name, Kennzeichen, Kilometerstand, Energie-Badge; führt zum Fahrzeug -->
            <a href="<?= htmlspecialchars($detail) ?>" class="fahrzeug-hero fahrzeug-hero-gross d-block text-reset text-decoration-none" aria-label="<?= htmlspecialchars(($fz['name'] ?? 'Fahrzeug') . ' öffnen') ?>">
                <img src="<?= htmlspecialchars(fahrzeugBildUrl($fz, $baseUrl)) ?>" alt="">
                <span class="fahrzeug-hero-text">
                    <span class="fahrzeug-hero-name text-truncate d-block"><?= htmlspecialchars($fz['name'] ?? 'Fahrzeug') ?></span>
                    <span class="d-flex flex-wrap align-items-center gap-2">
                        <?php if (!empty($fz['license_plate'])): ?><span class="kennzeichen"><?= htmlspecialchars($fz['license_plate']) ?></span><?php endif; ?>
                        <span class="energie-badge" style="--farbe: <?= energieFarbe($fuelType) ?>"><i class="fas <?= verbrauchsBegriffe($fuelType)['icon'] ?>" aria-hidden="true"></i><?= htmlspecialchars($kraftstoffNamen[$fuelType ?? ''] ?? 'Sonstiges') ?></span>
                        <?php if (($stats['currentOdo'] ?? null) !== null): ?><span class="fahrzeug-hero-zeile"><?= number_format((int)$stats['currentOdo'], 0, ',', '.') ?> km</span><?php endif; ?>
                    </span>
                </span>
            </a>
            <?php if (($fz['role'] ?? 'owner') !== 'owner' || $tachoFehlt > 0): ?>
            <div class="d-flex flex-wrap gap-2 mt-2">
                <?php if (($fz['role'] ?? 'owner') !== 'owner'): ?><span class="fs-label"><i class="fas fa-users me-1" aria-hidden="true"></i>Geteilt von <?= htmlspecialchars((string)($fz['owner_name'] ?? '')) ?></span><?php endif; ?>
                <?php if ($tachoFehlt > 0): ?>
                <a class="badge text-bg-warning text-decoration-none" href="<?= htmlspecialchars($detail) ?>#eintraege"><i class="fas fa-gauge-high" aria-hidden="true"></i><?= $tachoFehlt === 1 ? '1 Tachostand fehlt' : $tachoFehlt . ' Tachostände fehlen' ?></a>
                <?php endif; ?>
            </div>
            <?php endif; ?>

            <!-- Drei Kennzahlen; Termine gehören nicht in die Kacheln -->
            <div class="row row-cols-3 g-2 mt-1 start-kennzahlen">
                <div class="col">
                    <div class="kennzahl h-100">
                        <div class="kennzahl-wert"><?php if ($verbrauch): ?><?= implode(' + ', array_map(fn($x) => htmlspecialchars($x[0]) . ' <small>' . htmlspecialchars($x[1]) . '</small>', $verbrauch)) ?><?php else: ?>–<?php endif; ?></div>
                        Ø Verbrauch
                    </div>
                </div>
                <div class="col">
                    <div class="kennzahl h-100">
                        <div class="kennzahl-wert"><?= $kmKosten !== null ? htmlspecialchars(number_format((float)$kmKosten, 2, ',', '.')) . ' <small>€/km</small>' : '–' ?></div>
                        Kosten je km
                    </div>
                </div>
                <div class="col">
                    <div class="kennzahl h-100">
                        <div class="kennzahl-wert"><?= $monat !== null ? htmlspecialchars($euro($monat)) : '–' ?></div>
                        Diesen Monat
                    </div>
                </div>
            </div>
        </div>

        <div class="col-lg-7 d-flex flex-column gap-3 gap-lg-4">
            <!-- Nächste Termine (höchstens drei) -->
            <section class="card" aria-labelledby="startTermine">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h2 class="mb-0" id="startTermine">Nächste Termine</h2>
                    <a href="<?= htmlspecialchars($detail) ?>#allgemein" class="tipp-link">Alle anzeigen</a>
                </div>
                <?php if ($naechste): ?>
                <ul class="list-group list-group-flush">
                    <?php foreach ($naechste as $t): ?>
                    <li class="list-group-item termin-zeile">
                        <?= symbolKreis(getCategoryIcon($t['kategorie']), 'var(--fs-brand)') ?>
                        <div class="termin-text">
                            <div class="fs-headline"><?= htmlspecialchars($t['titel']) ?></div>
                            <div class="fs-label"><?= date('d.m.Y', strtotime($t['faellig_datum'])) ?><?php if (!empty($t['faellig_km'])): ?> oder bei <?= number_format((int)$t['faellig_km'], 0, ',', '.') ?> km<?php endif; ?></div>
                        </div>
                        <?= statusBadge((string)$t['status'], isset($t['tage']) ? terminAbstand((int)$t['tage']) : '', 'ms-auto') ?>
                    </li>
                    <?php endforeach; ?>
                </ul>
                <?php else: ?>
                <div class="card-body fs-label">Keine Termine mit Datum. <a class="tipp-link" href="<?= htmlspecialchars($detail) ?>#allgemein">TÜV, Wartung und Versicherung eintragen</a>, um erinnert zu werden.</div>
                <?php endif; ?>
            </section>

            <!-- Letzte Einträge (fünf) -->
            <section class="card" aria-labelledby="startEintraege">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h2 class="mb-0" id="startEintraege">Letzte Einträge</h2>
                    <a href="<?= htmlspecialchars($detail) ?>#eintraege" class="tipp-link">Alle anzeigen</a>
                </div>
                <?php if (!empty($liste['data'])): ?>
                <ul class="list-group list-group-flush">
                    <?php foreach ($liste['data'] as $x):
                        $kind = $x['kind'] ?? 'expense';
                        $unit = $x['unit'] ?? null;
                        if ($kind === 'fuel' || $kind === 'charge') {
                            $titel = begriffeFuerEinheit($fuelType, $unit)['vorgang'];
                            $zusatz = $x['place'] ?? '';
                            $farbe = energieFarbe($fuelType, $unit, $x['fuel'] ?? null);
                            $symbol = getCategoryIcon('Tankfuellung', $fuelType, $unit);
                        } elseif ($kind === 'trip') {
                            $titel = 'Fahrt';
                            $zusatz = $zwecke[$x['purpose'] ?? ''] ?? '';
                            $farbe = fahrtFarbe($x['purpose'] ?? null);
                            $symbol = 'fa-route';
                        } elseif ($kind === 'odometer') {
                            $titel = 'Kilometerstand';
                            $zusatz = $x['description'] ?? '';
                            $farbe = 'var(--fs-purpose-odometer)';
                            $symbol = getCategoryIcon('Kilometerstand');
                        } else {
                            $titel = getKategorieName($x['category'] ?? '');
                            $zusatz = $x['description'] ?: ($x['place'] ?? '');
                            $farbe = getKategorieFarbe($x['category'] ?? null);
                            $symbol = getCategoryIcon($x['category'] ?? '');
                        }
                        $datum = (new DateTime((string)$x['at']))->setTimezone(new DateTimeZone('Europe/Berlin'))->format('d.m.Y');
                        $betrag = $kind === 'trip'
                            ? number_format((float)($x['distance_km'] ?? 0), fmod((float)($x['distance_km'] ?? 0), 1) ? 1 : 0, ',', '.') . ' km'
                            : (!empty($x['countsAsCost']) ? $euro($x['cost'] ?? 0) : '');
                    ?>
                    <li class="list-group-item eintrag-zeile">
                        <?= symbolKreis($symbol, $farbe) ?>
                        <div class="eintrag-text min-w-0">
                            <span class="d-block fs-headline text-truncate"><?= htmlspecialchars($titel . ($zusatz !== '' ? ' · ' . $zusatz : '')) ?></span>
                            <span class="d-block fs-label"><?= htmlspecialchars($datum . (!empty($x['odometer_km']) ? ' · ' . number_format((int)$x['odometer_km'], 0, ',', '.') . ' km' : '')) ?></span>
                        </div>
                        <span class="eintrag-betrag"><?= htmlspecialchars($betrag) ?></span>
                    </li>
                    <?php endforeach; ?>
                </ul>
                <?php else: ?>
                <div class="card-body">
                    <p class="fs-label mb-2">Noch keine Einträge.</p>
                    <?php if (in_array($fz['role'] ?? 'owner', ['owner', 'editor'], true)): ?>
                    <a href="pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($vid)) ?>" class="btn btn-primary">Ersten Eintrag erfassen</a>
                    <?php endif; ?>
                </div>
                <?php endif; ?>
            </section>
        </div>
    </div>
<?php endif; ?>
</div>

<?php include 'includes/footer.php'; ?>
