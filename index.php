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
        <h1 class="h3 mb-0">Meine Fahrzeuge</h1>
        <?php if ($sortiermodus): ?>
            <a href="index.php" class="btn btn-primary btn-sm"><i class="fas fa-check me-1"></i> Fertig</a>
        <?php elseif (count($vehicles) > 1): ?>
            <a href="index.php?sortieren=1" class="btn btn-outline-secondary btn-sm"><i class="fas fa-sort me-1"></i> <span class="d-none d-sm-inline">Reihenfolge ändern</span><span class="d-sm-none">Ordnen</span></a>
        <?php endif; ?>
    </div>
    <?php if ($ladeFehler): ?>
        <div class="alert alert-danger">Die Fahrzeuge konnten gerade nicht geladen werden. Bitte versuche es gleich noch einmal.</div>
    <?php elseif (count($vehicles) > 0): ?>
        <div class="row row-cols-1 row-cols-sm-2 row-cols-lg-3 g-3 g-sm-4">
            <?php
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
                            $teile[] = number_format($wert, 1, ',', '.') . ' ' . ($u === null ? $einheit : einheitKurz($u));
                        }
                    }
                    if ($teile) {
                        $verbrauchHtml = htmlspecialchars('Ø ' . implode(' + ', $teile) . '/100 km');
                        // Trend-Pfeil: letzter Abschnitt mind. 5 % über bzw. unter dem Durchschnitt (nur bei einer Einheit)
                        $zuletzt = $stats['trend']['current'] ?? null;
                        $schnitt = $stats['avgConsumption'] ?? null;
                        if ($einheiten === [null] && $zuletzt !== null && $schnitt > 0 && abs($zuletzt - $schnitt) / $schnitt >= 0.05) {
                            $hoeher = $zuletzt > $schnitt;
                            $text = 'Zuletzt ' . number_format($zuletzt, 1, ',', '.') . ' ' . $einheit . '/100 km, ' . ($hoeher ? 'mehr' : 'weniger') . ' als im Durchschnitt';
                            $verbrauchHtml .= ' <i class="fas fa-arrow-trend-' . ($hoeher ? 'up text-danger' : 'down text-success') . '" title="' . htmlspecialchars($text) . '" aria-hidden="true"></i>'
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
                // Bereits als HTML (Werte escaped, Trend-Pfeil als Icon)
                $kennzahlen = array_filter([
                    $currentOdo !== null ? htmlspecialchars(number_format($currentOdo, 0, ',', '.') . ' km') : '',
                    $verbrauchHtml,
                ]);
                $detailLink = 'pages/fahrzeug_detail.php?id=' . urlencode($vehicleId);
            ?>
            <div class="col">
                <div class="card fahrzeug-karte h-100 border-0 shadow-sm">
                    <div class="fahrzeug-bild">
                        <img src="<?= htmlspecialchars($bildUrl) ?>" alt="" loading="lazy">
                    </div>
                    <div class="card-body min-w-0">
                        <h2 class="h5 card-title fw-semibold mb-1 text-truncate">
                            <?php if ($sortiermodus): ?>
                                <?= htmlspecialchars($displayName) ?>
                            <?php else: ?>
                                <a href="<?= htmlspecialchars($detailLink) ?>" class="stretched-link text-reset text-decoration-none"><?= htmlspecialchars($displayName) ?></a>
                            <?php endif; ?>
                        </h2>
                        <?php if (!empty($row['license_plate'])): ?><span class="kennzeichen small mb-1"><?= htmlspecialchars($row['license_plate']) ?></span><?php endif; ?>
                        <?php if (($row['role'] ?? 'owner') !== 'owner'): ?><span class="badge text-bg-light border mb-1"><i class="fas fa-users me-1" aria-hidden="true"></i>von <?= htmlspecialchars((string)($row['owner_name'] ?? '')) ?></span><?php endif; ?>
                        <div class="small text-body-secondary text-truncate"><?= $kennzahlen ? implode(' · ', $kennzahlen) : 'Noch keine Einträge' ?></div>
                        <?php if ($hinweis): ?>
                            <span class="badge text-bg-<?= $ueberfaellig ? 'danger' : 'warning' ?> mt-2"><i class="fas fa-bell me-1"></i><?= htmlspecialchars($hinweis) ?></span>
                        <?php endif; ?>
                        <?php if ($tachoFehlt > 0): ?>
                            <!-- Tachostand vergessen (#41): führt zur Eintragsliste mit "Nachtragen" -->
                            <span class="badge text-bg-warning mt-2"><i class="fas fa-gauge-high me-1"></i><?= $tachoFehlt === 1 ? '1 Tachostand fehlt' : $tachoFehlt . ' Tachostände fehlen' ?></span>
                        <?php endif; ?>
                    </div>
                    <div class="fahrzeug-aktionen">
                        <?php if ($sortiermodus): ?>
                            <form method="post" action="includes/fahrzeug_sortieren.php" class="btn-group" aria-label="Reihenfolge ändern">
                                <input type="hidden" name="id" value="<?= htmlspecialchars($vehicleId) ?>">
                                <input type="hidden" name="sortieren" value="1">
                                <button type="submit" name="richtung" value="hoch" class="btn btn-outline-secondary" title="Nach vorne" <?= $index === 0 ? 'disabled' : '' ?>><i class="fas fa-arrow-up d-sm-none"></i><i class="fas fa-arrow-left d-none d-sm-inline"></i></button>
                                <button type="submit" name="richtung" value="runter" class="btn btn-outline-secondary" title="Nach hinten" <?= $index === count($vehicles) - 1 ? 'disabled' : '' ?>><i class="fas fa-arrow-down d-sm-none"></i><i class="fas fa-arrow-right d-none d-sm-inline"></i></button>
                            </form>
                        <?php else: ?>
                            <a href="pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($vehicleId)) ?>" class="btn btn-primary btn-eintrag" title="Neuer Eintrag" aria-label="Neuer Eintrag für <?= htmlspecialchars($displayName) ?>">
                                <i class="fas fa-plus"></i><span class="d-none d-sm-inline ms-1">Eintrag</span>
                            </a>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
    <?php else: ?>
        <div class="card border-0 shadow-sm text-center mx-auto" style="max-width: 36rem;">
            <div class="card-body p-5">
                <i class="fas fa-car-side fa-3x mb-3"></i>
                <h2 class="h4">Noch kein Fahrzeug angelegt</h2>
                <p class="text-body-secondary mb-4">Lege dein erstes Fahrzeug an, danach kannst du Tankfüllungen, Ladevorgänge und Ausgaben erfassen.</p>
                <a href="pages/fahrzeug_hinzufuegen.php" class="btn btn-primary btn-lg px-4">
                    <i class="fas fa-plus me-2"></i>Fahrzeug hinzufügen
                </a>
                <p class="small text-body-secondary mt-4 mb-0">
                    <i class="fas fa-file-import me-1"></i>Daten aus einer anderen App oder Excel? Nach dem Anlegen unter „Einträge“ → „Import“ übernehmen.
                </p>
            </div>
        </div>
    <?php endif; ?>
</div>

<?php include 'includes/footer.php'; ?>
