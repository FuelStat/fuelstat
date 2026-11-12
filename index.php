<?php
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
?>

<?php $sortiermodus = !empty($_GET['sortieren']) && count($vehicles) > 1; ?>
<div class="container mt-3 mt-lg-4">
    <div class="d-flex justify-content-between align-items-center gap-2 mb-3 mb-lg-4">
        <h1 class="mb-0">Meine Fahrzeuge</h1>
        <?php if ($sortiermodus): ?>
            <a href="index.php" class="btn btn-primary btn-sm"><i class="fas fa-check me-1"></i> Fertig</a>
        <?php elseif (count($vehicles) > 1): ?>
            <a href="index.php?sortieren=1" class="btn btn-secondary btn-sm"><i class="fas fa-sort" aria-hidden="true"></i><span class="d-none d-sm-inline">Reihenfolge ändern</span><span class="d-sm-none">Ordnen</span></a>
        <?php endif; ?>
    </div>
    <?php if ($ladeFehler): ?>
        <div class="alert alert-danger">Die Fahrzeuge konnten gerade nicht geladen werden. Bitte versuche es gleich noch einmal.</div>
    <?php elseif (count($vehicles) > 0): ?>
        <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3">
            <?php
            $kraftstoffNamen = getKraftstoffOptionen();
            // Statistik und Fälligkeiten aller Fahrzeuge gleichzeitig laden statt nacheinander (#89)
            $api->vorladen(array_merge(...array_map(fn($v) => [
                '/vehicles/' . rawurlencode((string)$v['id']) . '/stats',
                '/vehicles/' . rawurlencode((string)$v['id']) . '/reminders',
            ], array_values($vehicles))));
            foreach (array_values($vehicles) as $index => $row):
                $vehicleId = $row['id'];
                $displayName = $row['name'] ?? 'Fahrzeug';
                $bildUrl = fahrzeugBildUrl($row, $baseUrl);
                $einheit = einheitKurz(getEinheitFuerKraftstoff($row['fuel_type'] ?? null));

                $currentOdo = null;
                $tachoFehlt = 0;
                $verbrauchHtml = '';
                try {
                    $stats = $api->getVehicleStats($vehicleId);
                    $currentOdo = $stats['currentOdo'] ?? null;
                    $tachoFehlt = (int)($stats['missingOdometer'] ?? 0);
                    // Ø über alle Abschnitte (der letzte Abschnitt allein schwankt zu stark);
                    // Plug-in-Hybrid: Kraftstoff und Strom nebeneinander, z. B. "Ø 2,7 l + 20,0 kWh/100 km"
                    $teile = [];
                    $einheiten = count($stats['units'] ?? []) > 1 ? ['l', 'kwh'] : [null];
                    foreach ($einheiten as $u) {
                        $wert = $u === null ? ($stats['avgConsumption'] ?? null) : ($stats['units'][$u]['avgConsumption'] ?? null);
                        if ($wert !== null) {
                            $teile[] = htmlspecialchars(number_format($wert, 1, ',', '.')) . ' <small>' . htmlspecialchars($u === null ? $einheit : einheitKurz($u)) . '</small>';
                        }
                    }
                    if ($teile) {
                        // Zahl groß, Einheit klein dahinter (StatTile); „/100 km“ gehört zur letzten Einheit
                        $verbrauchHtml = preg_replace('~</small>$~', '/100 km</small>', implode(' + ', $teile));
                        // Trend-Pfeil: letzter Abschnitt mind. 5 % über bzw. unter dem Durchschnitt (nur bei einer Einheit)
                        $zuletzt = $stats['trend']['current'] ?? null;
                        $schnitt = $stats['avgConsumption'] ?? null;
                        if ($einheiten === [null] && $zuletzt !== null && $schnitt > 0 && abs($zuletzt - $schnitt) / $schnitt >= 0.05) {
                            $hoeher = $zuletzt > $schnitt;
                            $text = 'Zuletzt ' . number_format($zuletzt, 1, ',', '.') . ' ' . $einheit . '/100 km, ' . ($hoeher ? 'mehr' : 'weniger') . ' als im Durchschnitt';
                            $verbrauchHtml .= ' <i class="fas fa-arrow-trend-' . ($hoeher ? 'up text-danger' : 'down text-success') . ' trend-pfeil" title="' . htmlspecialchars($text) . '" aria-hidden="true"></i>'
                                . '<span class="visually-hidden">' . htmlspecialchars($text) . '</span>';
                        }
                    }
                } catch (Throwable $e) {
                }
                // Termine zu einem Hinweis zusammenfassen
                $faellig = array_values(array_filter(
                    getFaelligkeitenFromApi($api, $vehicleId),
                    fn($f) => in_array($f['status'], ['ueberfaellig', 'bald'], true)
                ));
                $ueberfaellig = count(array_filter($faellig, fn($f) => $f['status'] === 'ueberfaellig'));
                $hinweis = null;
                if (count($faellig) === 1) {
                    $hinweis = $faellig[0]['titel'] . ($ueberfaellig ? ' überfällig' : ' bald fällig');
                } elseif ($faellig) {
                    $hinweis = count($faellig) . ' Termine ' . ($ueberfaellig ? 'fällig' : 'bald fällig');
                }
                $detailLink = 'pages/fahrzeug_detail.php?id=' . urlencode($vehicleId);
            ?>
            <div class="col">
                <article class="card fahrzeug-karte h-100">
                    <?php if (!$sortiermodus): ?>
                    <!-- Die ganze Karte führt zum Fahrzeug (Foto, Name, Kennzahlen). Der Link steht direkt in der Karte:
                         innerhalb des Fotos würde er nur dessen Textbereich abdecken. -->
                    <a href="<?= htmlspecialchars($detailLink) ?>" class="stretched-link karten-link" aria-label="<?= htmlspecialchars($displayName) ?> öffnen"></a>
                    <?php endif; ?>
                    <!-- VehicleHero: Foto mit Verlauf, darauf Name, Kennzeichen und Energie-Badge -->
                    <div class="fahrzeug-hero">
                        <img src="<?= htmlspecialchars($bildUrl) ?>" alt="" loading="lazy">
                        <div class="fahrzeug-hero-text">
                            <h2 class="fahrzeug-hero-name text-truncate"><?= htmlspecialchars($displayName) ?></h2>
                            <div class="d-flex flex-wrap align-items-center gap-2">
                                <?php if (!empty($row['license_plate'])): ?><span class="kennzeichen"><?= htmlspecialchars($row['license_plate']) ?></span><?php endif; ?>
                                <span class="energie-badge" style="--farbe: <?= energieFarbe($row['fuel_type'] ?? null) ?>"><i class="fas <?= verbrauchsBegriffe($row['fuel_type'] ?? null)['icon'] ?>" aria-hidden="true"></i><?= htmlspecialchars($kraftstoffNamen[$row['fuel_type'] ?? ''] ?? 'Sonstiges') ?></span>
                            </div>
                        </div>
                    </div>
                    <div class="card-body d-flex flex-column gap-3">
                        <?php if (($row['role'] ?? 'owner') !== 'owner'): ?><div class="fs-label text-truncate"><i class="fas fa-users me-1" aria-hidden="true"></i>Geteilt von <?= htmlspecialchars((string)($row['owner_name'] ?? '')) ?></div><?php endif; ?>
                        <div class="row g-2">
                            <div class="col-6">
                                <div class="kennzahl">
                                    <div class="kennzahl-wert"><?= $currentOdo !== null ? htmlspecialchars(number_format($currentOdo, 0, ',', '.')) . ' <small>km</small>' : '—' ?></div>
                                    Tachostand
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="kennzahl">
                                    <div class="kennzahl-wert"><?= $verbrauchHtml !== '' ? $verbrauchHtml : '—' ?></div>
                                    Ø Verbrauch
                                </div>
                            </div>
                        </div>
                        <?php if ($hinweis || $tachoFehlt > 0): ?>
                        <div class="d-flex flex-wrap gap-2">
                            <?php if ($hinweis): ?><?= statusBadge($ueberfaellig ? 'ueberfaellig' : 'bald', $hinweis) ?><?php endif; ?>
                            <?php if ($tachoFehlt > 0): ?>
                                <!-- Tachostand vergessen (#41): führt zur Eintragsliste mit "Nachtragen" -->
                                <span class="badge text-bg-warning"><i class="fas fa-gauge-high" aria-hidden="true"></i><?= $tachoFehlt === 1 ? '1 Tachostand fehlt' : $tachoFehlt . ' Tachostände fehlen' ?></span>
                            <?php endif; ?>
                        </div>
                        <?php endif; ?>
                        <div class="fahrzeug-aktionen mt-auto">
                            <?php if ($sortiermodus): ?>
                                <form method="post" action="includes/fahrzeug_sortieren.php" class="btn-group w-100" aria-label="Reihenfolge ändern">
                                    <input type="hidden" name="id" value="<?= htmlspecialchars($vehicleId) ?>">
                                    <input type="hidden" name="sortieren" value="1">
                                    <button type="submit" name="richtung" value="hoch" class="btn btn-secondary" aria-label="Nach vorne" <?= $index === 0 ? 'disabled' : '' ?>><i class="fas fa-arrow-up d-sm-none" aria-hidden="true"></i><i class="fas fa-arrow-left d-none d-sm-inline" aria-hidden="true"></i></button>
                                    <button type="submit" name="richtung" value="runter" class="btn btn-secondary" aria-label="Nach hinten" <?= $index === count($vehicles) - 1 ? 'disabled' : '' ?>><i class="fas fa-arrow-down d-sm-none" aria-hidden="true"></i><i class="fas fa-arrow-right d-none d-sm-inline" aria-hidden="true"></i></button>
                                </form>
                            <?php else: ?>
                                <a href="pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($vehicleId)) ?>" class="btn btn-secondary w-100" aria-label="Eintrag erfassen für <?= htmlspecialchars($displayName) ?>">
                                    <i class="fas <?= verbrauchsBegriffe($row['fuel_type'] ?? null)['icon'] ?>" aria-hidden="true"></i>Eintrag erfassen
                                </a>
                            <?php endif; ?>
                        </div>
                    </div>
                </article>
            </div>
            <?php endforeach; ?>
        </div>
    <?php else: ?>
        <!-- EmptyState: Symbol, ein Satz, eine Aktion -->
        <div class="card leer-zustand mx-auto">
            <div class="card-body">
                <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-car-side"></i></span>
                <h2>Noch kein Fahrzeug angelegt</h2>
                <p class="text-body-secondary mb-4">Lege dein erstes Fahrzeug an, danach kannst du Tankfüllungen, Ladevorgänge und Ausgaben erfassen.</p>
                <a href="pages/fahrzeug_hinzufuegen.php" class="btn btn-primary btn-lg px-4">
                    <i class="fas fa-plus" aria-hidden="true"></i>Fahrzeug hinzufügen
                </a>
                <p class="fs-footnote mt-4 mb-0">
                    <i class="fas fa-file-import me-1"></i>Daten aus einer anderen App oder Excel? Nach dem Anlegen unter „Einträge“ → „Import“ übernehmen.
                </p>
            </div>
        </div>
    <?php endif; ?>
</div>

<?php include 'includes/footer.php'; ?>
