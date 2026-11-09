<?php
// Reiter "Einstellungen" (#48): Fahrzeugangaben als Karten, gruppiert wie das Bearbeiten-Formular.
// "Bearbeiten" springt direkt in den passenden Abschnitt; Löschen steht abgesetzt in der Gefahrenzone.
$kraftstoffTexte = getKraftstoffOptionen() + ['petrol' => 'Benzin'];
$fuelTypeWert = $fahrzeug['fuel_type'] ?? '';
$datum = fn($d) => !empty($d) ? date('d.m.Y', strtotime($d)) : '';
$euro = fn($v) => $v !== null && $v !== '' ? number_format((float)$v, 2, ',', '.') . ' €' : '';
$zahl = fn($v, $einheit) => !empty($v) ? number_format((float)$v, fmod((float)$v, 1) ? 1 : 0, ',', '.') . ' ' . $einheit : '';
$monatsName = fn($m) => $m ? [1 => 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][(int)$m] : '';
$intervall = function ($monate, $km) {
    return implode(' oder ', array_filter([$monate ? $monate . ' Monate' : '', $km ? number_format((int)$km, 0, ',', '.') . ' km' : '']));
};
$mitMonat = fn(array $teile, $m) => implode(' · ', array_filter(array_merge($teile, [($n = $monatsName($m)) ? 'fällig im ' . $n : ''])));

$gruppen = [
    'grunddaten' => ['Grunddaten', 'fa-car-side', [
        'Name' => $fahrzeug['name'] ?? '',
        'Kennzeichen' => $fahrzeug['license_plate'] ?? '',
        'Marke und Modell' => trim(($fahrzeug['brand'] ?? '') . ' ' . ($fahrzeug['model'] ?? '')),
        'Baujahr' => $fahrzeug['year'] ?? '',
        'Erstzulassung' => $datum($fahrzeug['first_registration'] ?? null),
        'FIN' => $fahrzeug['vin'] ?? '',
    ]],
    'technik' => ['Technik', 'fa-gears', array_merge([
        'Antriebsart' => $kraftstoffTexte[$fuelTypeWert] ?? $fuelTypeWert,
        ($fuelTypeWert === 'phev' ? 'Tank' : $begriffe['speicher']) . 'größe' => $zahl($fahrzeug['tank_capacity'] ?? null, $einheitKurz),
    ], $fuelTypeWert === 'phev' ? ['Akkugröße' => $zahl($fahrzeug['battery_capacity'] ?? null, 'kWh')] : [], [
        'Tachostand bei Anschaffung' => isset($fahrzeug['odometer_km']) ? number_format((int)$fahrzeug['odometer_km'], 0, ',', '.') . ' km' : '',
        'Reifen Sommer' => $fahrzeug['tire_size_summer'] ?? '',
        'Reifen Winter' => $fahrzeug['tire_size_winter'] ?? '',
    ])],
    'termine' => ['Kauf und Termine', 'fa-calendar-check', [
        'Kauf' => implode(' · ', array_filter([$datum($fahrzeug['purchase_date'] ?? null), $euro($fahrzeug['purchase_price'] ?? null)])),
        'Verkauf' => implode(' · ', array_filter([$datum($fahrzeug['sale_date'] ?? null), $euro($fahrzeug['sale_price'] ?? null)])),
        'Wartung' => $intervall($fahrzeug['service_interval_months'] ?? null, $fahrzeug['service_interval_km'] ?? null) ?: 'Standard: 12 Monate oder 15.000 km',
        'Ölwechsel' => $intervall($fahrzeug['oil_interval_months'] ?? null, $fahrzeug['oil_interval_km'] ?? null),
        'Versicherung' => $mitMonat([$fahrzeug['insurance_company'] ?? '', $euro($fahrzeug['insurance_premium'] ?? null)], $fahrzeug['insurance_due_month'] ?? null),
        'Kfz-Steuer' => $mitMonat([$euro($fahrzeug['tax_amount'] ?? null)], $fahrzeug['tax_due_month'] ?? null),
    ]],
];
$bearbeitenUrl = '../pages/fahrzeug_bearbeiten.php?id=' . urlencode($fahrzeug_id);
?>
<div class="mt-3 mt-lg-4">
    <div class="row g-3">
        <?php foreach ($gruppen as $abschnitt => [$titel, $icon, $zeilen]):
            $leer = count(array_filter($zeilen, fn($w) => $w === '' || $w === null)); ?>
        <div class="col-md-6">
            <div class="card border-0 shadow-sm h-100 angaben-karte">
                <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3">
                    <h3 class="h6 mb-0"><i class="fas <?= $icon ?> me-2 text-primary"></i><?= $titel ?></h3>
                    <?php if ($istBesitzer): ?><a href="<?= htmlspecialchars($bearbeitenUrl . '#' . $abschnitt) ?>" class="btn btn-sm btn-outline-primary"><i class="fas fa-pen me-1"></i>Bearbeiten</a><?php endif; ?>
                </div>
                <div class="card-body pb-2">
                    <dl class="row mb-0">
                        <?php foreach ($zeilen as $label => $w): ?>
                            <dt class="col-5"><?= htmlspecialchars($label) ?></dt>
                            <dd class="col-7"><?= $w !== '' && $w !== null ? htmlspecialchars((string)$w) : '<span class="text-body-tertiary">–</span>' ?></dd>
                        <?php endforeach; ?>
                    </dl>
                    <?php if ($leer >= 3 && $istBesitzer): ?>
                        <p class="small text-body-secondary mb-2"><a href="<?= htmlspecialchars($bearbeitenUrl . '#' . $abschnitt) ?>">Fehlende Angaben ergänzen</a> – sie verbessern Termine und Auswertungen.</p>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        <?php endforeach; ?>
        <div class="col-md-6">
            <div class="card border-0 shadow-sm h-100 angaben-karte">
                <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3">
                    <h3 class="h6 mb-0"><i class="fas fa-image me-2 text-primary"></i>Bild</h3>
                    <?php if ($istBesitzer): ?><a href="<?= htmlspecialchars($bearbeitenUrl . '#bild') ?>" class="btn btn-sm btn-outline-primary"><i class="fas fa-pen me-1"></i>Ändern</a><?php endif; ?>
                </div>
                <div class="card-body">
                    <img src="<?= htmlspecialchars(fahrzeugBildUrl($fahrzeug, $baseUrl)) ?>" alt="Fahrzeugbild" class="rounded-3 w-100 object-fit-cover" style="max-height: 180px;">
                </div>
            </div>
        </div>
    </div>


    <!-- Teilen (#53): Besitzer lädt ein und verwaltet Mitglieder; Mitglieder sehen, wer Zugriff hat, und können gehen -->
    <?php
    $teilen = null;
    try {
        $teilen = $api->getVehicleMembers($fahrzeug_id);
    } catch (Throwable $e) {
        error_log('[Teilen] Mitglieder nicht geladen: ' . $e->getMessage());
    }
    $rollenNamen = ['owner' => 'Besitzer', 'editor' => 'Mitfahrer', 'viewer' => 'Nur ansehen'];
    $teilenUrl = '../pages/fahrzeug_teilen.php';
    ?>
    <?php if ($teilen !== null): ?>
    <div class="card border-0 shadow-sm mt-4 angaben-karte" id="teilen">
        <div class="card-header bg-transparent py-3">
            <h3 class="h6 mb-0"><i class="fas fa-users me-2 text-primary"></i>Geteilt mit</h3>
        </div>
        <div class="card-body">
            <ul class="list-group list-group-flush mb-3">
                <?php if (!empty($teilen['owner'])): ?>
                <li class="list-group-item px-0 d-flex align-items-center gap-2">
                    <span class="flex-grow-1 text-truncate"><?= htmlspecialchars((string)$teilen['owner']['name']) ?><?= (string)$teilen['owner']['user_id'] === $ichId ? ' (du)' : '' ?></span>
                    <span class="badge text-bg-primary">Besitzer</span>
                </li>
                <?php endif; ?>
                <?php foreach ($teilen['members'] ?? [] as $m): $ich = (string)$m['user_id'] === $ichId; ?>
                <li class="list-group-item px-0 d-flex flex-wrap align-items-center gap-2">
                    <span class="flex-grow-1 text-truncate"><?= htmlspecialchars((string)$m['name']) ?><?= $ich ? ' (du)' : '' ?></span>
                    <?php if ($istBesitzer): ?>
                    <form method="post" action="<?= $teilenUrl ?>" class="d-flex gap-2 m-0">
                        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                        <input type="hidden" name="user_id" value="<?= htmlspecialchars((string)$m['user_id']) ?>">
                        <select name="role" class="form-select form-select-sm w-auto" aria-label="Rolle von <?= htmlspecialchars((string)$m['name']) ?>" onchange="this.form.aktion.value='rolle'; this.form.submit()">
                            <option value="editor" <?= $m['role'] === 'editor' ? 'selected' : '' ?>>Mitfahrer</option>
                            <option value="viewer" <?= $m['role'] === 'viewer' ? 'selected' : '' ?>>Nur ansehen</option>
                        </select>
                        <input type="hidden" name="aktion" value="entfernen">
                        <button type="submit" class="btn btn-sm btn-outline-danger" onclick="this.form.aktion.value='entfernen'; return confirm('Zugriff entziehen? Bereits erfasste Einträge bleiben beim Fahrzeug.');" aria-label="Entfernen"><i class="fas fa-user-minus"></i></button>
                    </form>
                    <?php else: ?>
                    <span class="badge text-bg-secondary"><?= $rollenNamen[$m['role']] ?? $m['role'] ?></span>
                    <?php endif; ?>
                </li>
                <?php endforeach; ?>
                <?php foreach ($teilen['invitations'] ?? [] as $inv): ?>
                <li class="list-group-item px-0 d-flex align-items-center gap-2">
                    <span class="flex-grow-1 text-truncate text-body-secondary"><?= htmlspecialchars((string)$inv['email']) ?> · eingeladen bis <?= date('d.m.', strtotime($inv['expires_at'])) ?></span>
                    <span class="badge text-bg-light"><?= $rollenNamen[$inv['role']] ?? $inv['role'] ?></span>
                    <form method="post" action="<?= $teilenUrl ?>" class="m-0">
                        <input type="hidden" name="aktion" value="zurueckziehen">
                        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                        <input type="hidden" name="einladung_id" value="<?= htmlspecialchars((string)$inv['id']) ?>">
                        <button type="submit" class="btn btn-sm btn-outline-secondary" aria-label="Einladung zurückziehen"><i class="fas fa-xmark"></i></button>
                    </form>
                </li>
                <?php endforeach; ?>
            </ul>
            <?php if ($istBesitzer): ?>
            <form method="post" action="<?= $teilenUrl ?>" class="row g-2 align-items-end">
                <input type="hidden" name="aktion" value="einladen">
                <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                <div class="col-sm-6">
                    <label for="teilenEmail" class="form-label small mb-1">E-Mail-Adresse</label>
                    <input type="email" class="form-control" id="teilenEmail" name="email" required placeholder="name@example.de">
                </div>
                <div class="col-sm-3">
                    <label for="teilenRolle" class="form-label small mb-1">Rolle</label>
                    <select class="form-select" id="teilenRolle" name="role">
                        <option value="editor">Mitfahrer</option>
                        <option value="viewer">Nur ansehen</option>
                    </select>
                </div>
                <div class="col-sm-3 d-grid">
                    <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane me-1"></i>Einladen</button>
                </div>
                <div class="col-12 form-text">Mitfahrer sehen alles und erfassen Tank-/Ladevorgänge und Ausgaben; ändern können sie nur ihre eigenen Einträge. Die Einladung gilt 14 Tage und lässt sich nur mit genau dieser E-Mail-Adresse annehmen.</div>
            </form>
            <?php else: ?>
            <form method="post" action="<?= $teilenUrl ?>" class="m-0" onsubmit="return confirm('Dieses Fahrzeug verlassen? Deine Einträge bleiben beim Fahrzeug.');">
                <input type="hidden" name="aktion" value="verlassen">
                <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                <button type="submit" class="btn btn-outline-danger"><i class="fas fa-right-from-bracket me-1"></i>Fahrzeug verlassen</button>
            </form>
            <?php endif; ?>
        </div>
    </div>
    <?php endif; ?>

    <?php if ($istBesitzer): ?>
    <!-- Gefahrenzone: klar abgesetzt -->
    <div class="card border-danger-subtle mt-4 mb-4">
        <div class="card-body d-flex flex-wrap align-items-center gap-3">
            <div class="flex-grow-1">
                <h3 class="h6 text-danger mb-1"><i class="fas fa-triangle-exclamation me-2"></i>Fahrzeug löschen</h3>
                <p class="small text-body-secondary mb-0">Löscht das Fahrzeug mit allen <?= $begriffe['vorgaengen'] ?>, Ausgaben und Bildern endgültig.</p>
            </div>
            <form method="post" action="../pages/fahrzeug_loeschen.php" class="m-0"
                  onsubmit="return confirm(<?= htmlspecialchars(json_encode('„' . ($fahrzeug['name'] ?? 'Fahrzeug') . '“ mit allen Einträgen endgültig löschen?'), ENT_QUOTES) ?>);">
                <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                <button type="submit" class="btn btn-outline-danger"><i class="fas fa-trash-alt me-1"></i>Löschen</button>
            </form>
        </div>
    </div>
    <?php endif; ?>
</div>
