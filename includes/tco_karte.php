<?php
// Gesamtkosten (TCO, #79): Kennzahlen und Anteile aus GET /vehicles/:id/tco. Die Zahlen rechnet die API, hier wird nur dargestellt.
// Erwartet: $tco (Antwort der API), $fahrzeug_id, $darfAendern (bool, Link zum Ergänzen der Angaben)
$tcoZahl = fn($wert, int $stellen = 2) => number_format((float)$wert, $stellen, ',', '.');
$tcoGruppen = kategorieGruppen();
$tcoName = fn(string $k) => $k === 'wertverlust' ? 'Wertverlust' : ($tcoGruppen[$k]['name'] ?? $k);
$tcoFarbe = fn(string $k) => $k === 'wertverlust' ? '#6c757d' : ($tcoGruppen[$k]['color'] ?? '#adb5bd');
$tcoIcon = fn(string $k) => $k === 'wertverlust' ? 'fa-arrow-trend-down' : ($tcoGruppen[$k]['icon'] ?? 'fa-ellipsis');
$tcoVerkauft = ($tco['valueBasis'] ?? null) === 'sale' || ($tco['sale'] ?? null) !== null;
?>
<div class="card border-0 shadow-sm mb-4" id="gesamtkosten">
    <div class="card-header bg-transparent py-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
        <h3 class="h6 mb-0"><i class="fas fa-scale-balanced text-primary me-2" aria-hidden="true"></i>Gesamtkosten<?= $tcoVerkauft ? ' (bis zum Verkauf)' : '' ?></h3>
        <a class="btn btn-sm btn-outline-secondary" target="_blank" href="../pages/bericht_gesamtkosten.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>"><i class="fas fa-print me-1" aria-hidden="true"></i>Bericht</a>
    </div>
    <div class="card-body">
        <div class="kennzahl-raster kennzahl-raster-4 kennzahl-raster-weit mb-3">
            <div><div class="kennzahl">
                <div class="fs-label">Gesamtkosten</div>
                <div class="kennzahl-wert"><?= $tcoZahl($tco['total']) ?> <small class="fw-normal">€</small></div>
                <div class="small text-body-secondary"><?= !empty($tco['complete']) ? 'mit Wertverlust' : 'ohne Wertverlust' ?></div>
            </div></div>
            <div><div class="kennzahl">
                <div class="fs-label">Pro Monat</div>
                <div class="kennzahl-wert"><?= $tco['perMonth'] !== null ? $tcoZahl($tco['perMonth']) . ' <small class="fw-normal">€</small>' : '—' ?></div>
                <div class="small text-body-secondary"><?= $tco['ownershipMonths'] !== null ? $tcoZahl($tco['ownershipMonths'], 1) . ' Monate Besitzzeit' : 'noch keine Besitzzeit' ?></div>
            </div></div>
            <div><div class="kennzahl">
                <div class="fs-label">Pro Kilometer</div>
                <div class="kennzahl-wert"><?= $tco['perKm'] !== null ? $tcoZahl($tco['perKm']) . ' <small class="fw-normal">€/km</small>' : '—' ?></div>
                <div class="small text-body-secondary"><?= $tco['distanceKm'] ? $tcoZahl($tco['distanceKm'], 0) . ' km gefahren' : 'Tachostände fehlen' ?></div>
            </div></div>
            <div><div class="kennzahl">
                <div class="fs-label">Wertverlust</div>
                <div class="kennzahl-wert"><?= $tco['valueLoss'] !== null ? $tcoZahl($tco['valueLoss']) . ' <small class="fw-normal">€</small>' : '—' ?></div>
                <div class="small text-body-secondary"><?= $tco['valueLossPerYear'] !== null ? $tcoZahl($tco['valueLossPerYear'], 0) . ' € pro Jahr' : 'nicht berechenbar' ?></div>
            </div></div>
        </div>

        <?php if ($tco['valueLoss'] === null): ?>
        <p class="small text-body-secondary mb-3">
            <i class="fas fa-circle-info me-1" aria-hidden="true"></i>Der Wertverlust fehlt noch:
            <?= $tco['purchase']['price'] === null ? 'Kaufpreis' : '' ?><?= $tco['purchase']['price'] === null && $tco['valueBasis'] === null ? ' und ' : '' ?><?= $tco['valueBasis'] === null ? ($tcoVerkauft ? 'Verkaufserlös' : 'geschätzter Restwert') : '' ?> fehlt.
            <?php if (!empty($darfAendern)): ?><a class="tipp-link" href="../pages/fahrzeug_bearbeiten.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>#termine">Angaben ergänzen</a><?php elseif ($tcoVerkauft): ?>Der Besitzer kann ihn beim Fahrzeug ergänzen.<?php endif; ?>
        </p>
        <?php endif; ?>

        <?php if ($tco['shares']): ?>
        <div class="progress mb-3" style="height: 0.75rem" role="img" aria-label="Anteile an den Gesamtkosten">
            <?php foreach ($tco['shares'] as $s): ?>
                <div class="progress-bar" style="width: <?= round((float)$s['share'], 2) ?>%; background-color: <?= $tcoFarbe($s['key']) ?>" title="<?= htmlspecialchars($tcoName($s['key'])) ?>"></div>
            <?php endforeach; ?>
        </div>
        <div class="row g-2">
            <?php foreach ($tco['shares'] as $s): ?>
            <div class="col-6 col-lg-4">
                <div class="d-flex align-items-center gap-2">
                    <?= symbolKreis($tcoIcon($s['key']), $tcoFarbe($s['key'])) ?>
                    <div class="min-w-0">
                        <div class="small text-body-secondary text-truncate"><?= htmlspecialchars($tcoName($s['key'])) ?></div>
                        <div class="fw-semibold"><?= $tcoZahl($s['total']) ?> € <small class="text-body-secondary fw-normal"><?= $s['share'] !== null ? $tcoZahl($s['share'], 0) . ' %' : '' ?></small></div>
                    </div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>
        <p class="fs-footnote mt-3 mb-0">Alle gebuchten Ausgaben (auch Leasing- und Finanzierungsraten) plus Wertverlust, über die ganze Besitzzeit, unabhängig vom gewählten Jahr.</p>
    </div>
</div>
