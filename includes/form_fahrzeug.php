<?php
// Gemeinsames Fahrzeugformular für Anlegen und Bearbeiten (#45).
// Anlegen: Assistent in 4 Schritten mit Live-Vorschau der Fahrzeugkarte. Bearbeiten: dieselben Abschnitte aufklappbar.
// Erwartet: $fahrzeug (array, leer beim Anlegen), $formAction, $abbrechenUrl, $baseUrl
$f = $fahrzeug ?? [];
$istNeu = empty($f['id']);
$aktuellerKraftstoff = $f['fuel_type'] ?? 'e5';
if ($aktuellerKraftstoff === 'petrol') {
    $aktuellerKraftstoff = 'e5';
}
$hatBild = !empty($f['image_url']);
// Kraftstoffsorten (#140): beim Anlegen der Vorschlag zur Antriebsart, beim Bearbeiten die des Fahrzeugs
$katalog = sortenKatalog();
$fahrzeugSorten = $istNeu ? ($katalog['standards'][$aktuellerKraftstoff] ?? []) : sortenDesFahrzeugs($f);
$fahrzeugStandard = $istNeu ? ($fahrzeugSorten[0] ?? null) : standardSorte($f, $fahrzeugSorten);
// Die meisten Fahrzeuge haben eine Sorte: die Auswahl ist nur offen, wenn das Fahrzeug mehrere oder andere Sorten hat
// als die Antriebsart vorschlägt
$sortenVorschlag = $katalog['standards'][$aktuellerKraftstoff] ?? [];
$gleicheSorten = fn(array $a, array $b) => count($a) === count($b) && !array_diff($a, $b);
$sortenErweitert = !$istNeu && !$gleicheSorten($fahrzeugSorten, $sortenVorschlag);
$wert = fn(string $spalte) => htmlspecialchars((string)($f[$spalte] ?? ''));
$zahl = fn(string $spalte) => isset($f[$spalte]) && $f[$spalte] !== null ? htmlspecialchars((string)(float)$f[$spalte]) : '';
$monate = [1 => 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
$monatsAuswahl = function (string $name, $aktuell) use ($monate) {
    $html = '<select class="form-select" id="' . $name . '" name="' . $name . '"><option value="">–</option>';
    foreach ($monate as $nr => $text) {
        $html .= '<option value="' . $nr . '"' . ((int)$aktuell === $nr ? ' selected' : '') . '>' . $text . '</option>';
    }
    return $html . '</select>';
};
$schritte = [
    'grunddaten' => ['1', 'Grunddaten', 'fa-car-side'],
    'technik' => ['2', 'Technik', 'fa-gears'],
    'termine' => ['3', 'Kauf und Termine', 'fa-calendar-check'],
    'bild' => ['4', 'Bild', 'fa-image'],
];
// Beim Bearbeiten: Abschnitt als aufklappbare Karte; beim Anlegen: Schritt des Assistenten
$abschnittStart = function (string $id) use ($istNeu, $schritte) {
    [$nr, $titel, $icon] = $schritte[$id];
    if ($istNeu) {
        return '<section class="assistent-schritt" data-schritt="' . $nr . '" id="schritt_' . $id . '"' . ($nr === '1' ? '' : ' hidden') . '>'
            . '<h2 class="h5 mb-3"><i class="fas ' . $icon . ' me-2 text-primary"></i>' . $titel . '</h2>';
    }
    return '<div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button' . ($nr === '1' ? '' : ' collapsed') . '" type="button" data-bs-toggle="collapse" data-bs-target="#abschnitt_' . $id . '" aria-expanded="' . ($nr === '1' ? 'true' : 'false') . '">'
        . '<i class="fas ' . $icon . ' me-2 text-primary"></i>' . $titel . '</button></h2>'
        . '<div id="abschnitt_' . $id . '" class="accordion-collapse collapse' . ($nr === '1' ? ' show' : '') . '"><div class="accordion-body">';
};
$abschnittEnde = fn() => $istNeu ? '</section>' : '</div></div></div>';
?>
<div class="row g-4 fahrzeug-formular">
<div class="<?= $istNeu ? 'col-lg-8' : 'col-12' ?>">
<form method="post" action="<?= htmlspecialchars($formAction) ?>" enctype="multipart/form-data" id="fahrzeugForm" novalidate>
    <?php if (!$istNeu): ?>
        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($f['id']) ?>">
    <?php endif; ?>

    <?php if ($istNeu): ?>
    <!-- Fortschritt des Assistenten -->
    <ol class="assistent-schritte mb-4" aria-label="Schritte">
        <?php foreach ($schritte as $id => [$nr, $titel]): ?>
            <li data-schritt="<?= $nr ?>"<?= $nr === '1' ? ' class="aktiv" aria-current="step"' : '' ?>><span class="nr"><?= $nr ?></span><span class="titel"><?= $titel ?></span></li>
        <?php endforeach; ?>
    </ol>
    <?php else: ?>
    <div class="accordion mb-3" id="fahrzeugAbschnitte">
    <?php endif; ?>

    <?= $abschnittStart('grunddaten') ?>
        <div class="row g-3">
            <div class="col-md-6">
                <label for="name" class="form-label">Name / Bezeichnung</label>
                <input type="text" id="name" name="name" class="form-control" placeholder="z. B. Familienkutsche" value="<?= $wert('name') ?>" required maxlength="100">
                <div class="invalid-feedback">Bitte einen Namen eingeben.</div>
            </div>
            <div class="col-md-6">
                <label for="licensePlate" class="form-label">Kennzeichen</label>
                <input type="text" id="licensePlate" name="licensePlate" class="form-control text-uppercase" placeholder="z. B. AA-BC 123" value="<?= $wert('license_plate') ?>" maxlength="15" autocapitalize="characters">
            </div>
            <div class="col-md-4">
                <label for="brand" class="form-label">Marke</label>
                <input type="text" id="brand" name="brand" class="form-control" placeholder="z. B. Kia" value="<?= $wert('brand') ?>">
            </div>
            <div class="col-md-4">
                <label for="model" class="form-label">Modell</label>
                <input type="text" id="model" name="model" class="form-control" placeholder="z. B. Ceed SW" value="<?= $wert('model') ?>">
            </div>
            <div class="col-md-4">
                <label for="year" class="form-label">Baujahr</label>
                <input type="number" id="year" name="year" class="form-control" min="1886" max="2100" value="<?= $wert('year') ?>">
            </div>
            <div class="col-md-6">
                <label for="firstRegistration" class="form-label">Erstzulassung</label>
                <input type="date" id="firstRegistration" name="firstRegistration" class="form-control" value="<?= $wert('first_registration') ?>">
                <div class="form-text">Ohne TÜV-Eintrag: erster TÜV 36 Monate danach.</div>
            </div>
            <div class="col-md-6">
                <label for="vin" class="form-label">FIN (Fahrgestellnummer)</label>
                <input type="text" id="vin" name="vin" class="form-control text-uppercase" value="<?= $wert('vin') ?>" maxlength="17" pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{11,17}" autocapitalize="characters">
                <div class="invalid-feedback">11 bis 17 Zeichen, ohne I, O und Q.</div>
            </div>
        </div>
    <?= $abschnittEnde() ?>

    <?= $abschnittStart('technik') ?>
        <div class="row g-3">
            <div class="col-md-6">
                <label for="fuelType" class="form-label">Antriebsart</label>
                <select id="fuelType" name="fuelType" class="form-select" required>
                    <?php foreach (getKraftstoffOptionen() as $wertK => $text): ?>
                        <option value="<?= $wertK ?>" <?= $wertK === $aktuellerKraftstoff ? 'selected' : '' ?>><?= $text ?></option>
                    <?php endforeach; ?>
                </select>
                <?php if ($katalog['sorten']): ?>
                <button type="button" class="btn btn-link btn-sm px-0" id="sortenErweitert" aria-controls="sortenBereich" aria-expanded="<?= $sortenErweitert ? 'true' : 'false' ?>">
                    <i class="fas fa-sliders me-1" aria-hidden="true"></i>Erweitert: mehrere Kraftstoffe oder Sorten
                </button>
                <?php endif; ?>
            </div>
            <div class="col-md-6">
                <label for="odometerKm" class="form-label">Tachostand bei Anschaffung (km)</label>
                <input type="number" id="odometerKm" name="odometerKm" class="form-control" min="0" inputmode="numeric" value="<?= $wert('odometer_km') ?>">
                <div class="form-text">Wird für die Fahrleistung verwendet.</div>
            </div>
            <?php if ($katalog['sorten']): ?>
            <!-- Kraftstoffsorten (#140): alles, was das Fahrzeug tankt bzw. lädt; einer davon ist der Standard.
                 Zugeklappt folgen die Sorten der Antriebsart (wie bei der API ohne Sortenliste). -->
            <div class="col-12" id="sortenBereich" <?= $sortenErweitert ? '' : 'hidden' ?>>
                <fieldset id="sortenAuswahl" aria-describedby="sortenHinweis">
                    <legend class="form-label fs-6 mb-1">Kraftstoffe</legend>
                    <div class="form-text mt-0 mb-2" id="sortenHinweis">Für Fahrzeuge mit mehreren Kraftstoffen (z. B. Benzin und Autogas) oder wechselnden Sorten (E5 und E10, Diesel und Premium-Diesel). Verbrauch rechnet Fuelstat je Energieart, Preise je Sorte. Der Standard ist bei neuen Einträgen vorausgewählt.</div>
                    <div class="row g-2">
                        <?php foreach ($katalog['energien'] as $energieKey => $energie):
                            $sortenDerEnergie = array_filter($katalog['sorten'], fn($s) => ($s['energy'] ?? '') === $energieKey);
                            if (!$sortenDerEnergie) continue; ?>
                        <div class="col-12 col-md-6 col-xl-4 sorten-spalte">
                            <div class="sorten-gruppe" data-energie="<?= htmlspecialchars($energieKey) ?>">
                                <div class="sorten-gruppe-titel"><?= htmlspecialchars($energie['name']) ?></div>
                                <?php foreach ($sortenDerEnergie as $key => $sorte):
                                    $gewaehlt = in_array($key, $fahrzeugSorten, true); ?>
                                <div class="sorte-zeile">
                                    <div class="form-check mb-0">
                                        <input class="form-check-input sorte-check" type="checkbox" name="fuels[]" value="<?= htmlspecialchars($key) ?>" id="sorte_<?= htmlspecialchars($key) ?>" <?= $gewaehlt ? 'checked' : '' ?>>
                                        <label class="form-check-label" for="sorte_<?= htmlspecialchars($key) ?>"><?= htmlspecialchars($sorte['name']) ?><?php if (!empty($sorte['hint'])): ?> <span class="text-body-secondary small">(<?= htmlspecialchars($sorte['hint']) ?>)</span><?php endif; ?></label>
                                    </div>
                                    <div class="form-check mb-0 sorte-standard" <?= $gewaehlt ? '' : 'hidden' ?>>
                                        <input class="form-check-input" type="radio" name="defaultFuel" value="<?= htmlspecialchars($key) ?>" id="standard_<?= htmlspecialchars($key) ?>" <?= $key === $fahrzeugStandard ? 'checked' : '' ?> <?= $gewaehlt ? '' : 'disabled' ?>>
                                        <label class="form-check-label small" for="standard_<?= htmlspecialchars($key) ?>">Standard<span class="visually-hidden"> (<?= htmlspecialchars($sorte['name']) ?>)</span></label>
                                    </div>
                                </div>
                                <?php endforeach; ?>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                    <button type="button" class="btn btn-link btn-sm px-0 mt-1" id="sortenAlle" aria-expanded="false">Weitere Kraftstoffe zeigen</button>
                    <div class="invalid-feedback" id="sortenFehler">Bitte mindestens einen Kraftstoff wählen.</div>
                </fieldset>
            </div>
            <?php endif; ?>
            <div class="col-md-6">
                <label for="tankCapacity" class="form-label" id="tankCapacityLabel">Tank- bzw. Akkugröße</label>
                <input type="number" id="tankCapacity" name="tankCapacity" class="form-control" min="0" step="0.1" inputmode="decimal" value="<?= $zahl('tank_capacity') ?>">
                <div class="form-text" id="tankCapacityHinweis">In Liter, kWh bzw. kg.</div>
            </div>
            <!-- Plug-in-Hybrid: Akku zusätzlich zum Tank -->
            <div class="col-md-6" id="batteryCapacityFeld">
                <label for="batteryCapacity" class="form-label">Akkugröße (kWh)</label>
                <input type="number" id="batteryCapacity" name="batteryCapacity" class="form-control" min="0" step="0.1" inputmode="decimal" value="<?= $zahl('battery_capacity') ?>">
                <div class="form-text">Kapazität laut Hersteller (brutto oder nutzbar).</div>
            </div>
            <div class="col-md-6">
                <label for="tireSizeSummer" class="form-label">Reifengröße Sommer</label>
                <input type="text" id="tireSizeSummer" name="tireSizeSummer" class="form-control" placeholder="z. B. 205/55 R16 91V" value="<?= $wert('tire_size_summer') ?>" maxlength="30">
            </div>
            <div class="col-md-6">
                <label for="tireSizeWinter" class="form-label">Reifengröße Winter</label>
                <input type="text" id="tireSizeWinter" name="tireSizeWinter" class="form-control" placeholder="z. B. 195/65 R15 91T" value="<?= $wert('tire_size_winter') ?>" maxlength="30">
            </div>
        </div>
    <?= $abschnittEnde() ?>

    <?= $abschnittStart('termine') ?>
        <h3 class="h6 text-body-secondary">Kauf</h3>
        <div class="row g-3 mb-4">
            <div class="col-6 col-md-3"><label for="purchaseDate" class="form-label">Kaufdatum</label><input type="date" id="purchaseDate" name="purchaseDate" class="form-control" value="<?= $wert('purchase_date') ?>"></div>
            <div class="col-6 col-md-3"><label for="purchasePrice" class="form-label">Kaufpreis (€)</label><input type="number" id="purchasePrice" name="purchasePrice" class="form-control" min="0" step="0.01" inputmode="decimal" value="<?= $zahl('purchase_price') ?>"></div>
            <div class="col-6 col-md-3"><label for="saleDate" class="form-label">Verkauft am</label><input type="date" id="saleDate" name="saleDate" class="form-control" value="<?= $wert('sale_date') ?>"></div>
            <div class="col-6 col-md-3"><label for="salePrice" class="form-label">Verkaufspreis (€)</label><input type="number" id="salePrice" name="salePrice" class="form-control" min="0" step="0.01" inputmode="decimal" value="<?= $zahl('sale_price') ?>"></div>
        </div>
        <h3 class="h6 text-body-secondary">Intervalle laut Hersteller</h3>
        <div class="row g-3 mb-1">
            <div class="col-6 col-md-3"><label for="serviceIntervalMonths" class="form-label">Wartung (Monate)</label><input type="number" id="serviceIntervalMonths" name="serviceIntervalMonths" class="form-control" min="1" max="60" inputmode="numeric" placeholder="12" value="<?= $wert('service_interval_months') ?>"></div>
            <div class="col-6 col-md-3"><label for="serviceIntervalKm" class="form-label">Wartung (km)</label><input type="number" id="serviceIntervalKm" name="serviceIntervalKm" class="form-control" min="1000" max="100000" step="1000" inputmode="numeric" placeholder="15000" value="<?= $wert('service_interval_km') ?>"></div>
            <div class="col-6 col-md-3"><label for="oilIntervalMonths" class="form-label">Ölwechsel (Monate)</label><input type="number" id="oilIntervalMonths" name="oilIntervalMonths" class="form-control" min="1" max="60" inputmode="numeric" value="<?= $wert('oil_interval_months') ?>"></div>
            <div class="col-6 col-md-3"><label for="oilIntervalKm" class="form-label">Ölwechsel (km)</label><input type="number" id="oilIntervalKm" name="oilIntervalKm" class="form-control" min="1000" max="100000" step="1000" inputmode="numeric" value="<?= $wert('oil_interval_km') ?>"></div>
        </div>
        <div class="form-text mb-4">Leer: Wartung alle 12 Monate oder 15.000 km.</div>
        <h3 class="h6 text-body-secondary">Versicherung und Steuer</h3>
        <div class="row g-3">
            <div class="col-md-5"><label for="insuranceCompany" class="form-label">Versicherung</label><input type="text" id="insuranceCompany" name="insuranceCompany" class="form-control" placeholder="z. B. HUK-Coburg" value="<?= $wert('insurance_company') ?>" maxlength="100"></div>
            <div class="col-6 col-md-3"><label for="insurancePremium" class="form-label">Beitrag/Jahr (€)</label><input type="number" id="insurancePremium" name="insurancePremium" class="form-control" min="0" step="0.01" inputmode="decimal" value="<?= $zahl('insurance_premium') ?>"></div>
            <div class="col-6 col-md-4"><label for="insuranceDueMonth" class="form-label">fällig im</label><?= $monatsAuswahl('insuranceDueMonth', $f['insurance_due_month'] ?? null) ?></div>
            <div class="col-6 col-md-3 offset-md-5"><label for="taxAmount" class="form-label">Kfz-Steuer/Jahr (€)</label><input type="number" id="taxAmount" name="taxAmount" class="form-control" min="0" step="0.01" inputmode="decimal" value="<?= $zahl('tax_amount') ?>"></div>
            <div class="col-6 col-md-4"><label for="taxDueMonth" class="form-label">fällig im</label><?= $monatsAuswahl('taxDueMonth', $f['tax_due_month'] ?? null) ?></div>
        </div>
        <div class="form-text">Mit Fälligkeitsmonat erinnert Fuelstat auch ohne vorherigen Eintrag.</div>
    <?= $abschnittEnde() ?>

    <?= $abschnittStart('bild') ?>
        <?php if ($hatBild): ?>
            <div class="mb-2"><img src="<?= htmlspecialchars(fahrzeugBildUrl($f, $baseUrl)) ?>" alt="Aktuelles Fahrzeugbild" class="img-thumbnail" style="max-height:120px"></div>
        <?php endif; ?>
        <label for="bild" class="form-label">Fahrzeugbild</label>
        <input type="file" id="bild" name="bild" class="form-control" accept="image/jpeg,image/png,image/gif,image/webp">
        <div class="form-text">Große Fotos werden vor dem Hochladen automatisch verkleinert.</div>
        <?php if ($hatBild): ?>
            <div class="form-check mt-2">
                <input class="form-check-input" type="checkbox" id="bild_entfernen" name="bild_entfernen" value="1">
                <label class="form-check-label" for="bild_entfernen">Bild entfernen</label>
            </div>
        <?php endif; ?>
    <?= $abschnittEnde() ?>

    <?php if (!$istNeu): ?>
    </div>
    <?php endif; ?>

    <div class="formular-aktionen">
        <?php if ($istNeu): ?>
            <button type="button" class="btn btn-outline-secondary btn-lg" id="btnZurueck" hidden><i class="fas fa-chevron-left me-1"></i>Zurück</button>
            <button type="button" class="btn btn-primary btn-lg flex-grow-1" id="btnWeiter">Weiter<i class="fas fa-chevron-right ms-1"></i></button>
            <button type="submit" class="btn btn-primary btn-lg flex-grow-1" id="btnSpeichern" hidden><i class="fas fa-check me-1"></i>Fahrzeug anlegen</button>
        <?php else: ?>
            <button type="submit" class="btn btn-primary btn-lg flex-grow-1" id="btnSpeichern"><i class="fas fa-check me-1"></i>Speichern</button>
        <?php endif; ?>
        <a href="<?= htmlspecialchars($abbrechenUrl) ?>" class="btn btn-outline-secondary btn-lg">Abbrechen</a>
    </div>
</form>
</div>

<?php if ($istNeu): ?>
<!-- Live-Vorschau der Fahrzeugkarte (wie auf der Startseite) -->
<div class="col-lg-4 d-none d-lg-block">
    <div class="sticky-top" style="top: 5rem;">
        <div class="small text-body-secondary mb-2">Vorschau</div>
        <div class="card fahrzeug-karte border-0 shadow-sm">
            <div class="fahrzeug-bild"><img id="vorschauBild" src="<?= htmlspecialchars(fahrzeugBildUrl([], $baseUrl)) ?>" alt=""></div>
            <div class="card-body">
                <h3 class="h5 card-title fw-semibold mb-1 text-truncate" id="vorschauName">Neues Fahrzeug</h3>
                <div class="small text-body-secondary text-truncate" id="vorschauZeile"></div>
                <span class="badge text-bg-light border mt-2 kennzeichen" id="vorschauKennzeichen" hidden></span>
            </div>
        </div>
    </div>
</div>
<?php endif; ?>
</div>

<script>
(function () {
  var form = document.getElementById('fahrzeugForm');
  var auswahl = document.getElementById('fuelType');
  // Beschriftung passend zur Antriebsart (Tank in l/kg, Akku in kWh); Akku zusätzlich nur beim Plug-in-Hybrid
  var texte = {
    electric: ['Akkugröße (kWh)', 'Nutzbare Kapazität laut Hersteller.'],
    cng: ['Tankgröße (kg)', 'Fassungsvermögen in Kilogramm.'],
    hydrogen: ['Tankgröße (kg)', 'Fassungsvermögen in Kilogramm.']
  };
  // Kraftstoffsorten (#140): Vorschlag je Antriebsart, Standard nur für gewählte Sorten
  var sortenStandards = <?= json_encode($katalog['standards'] ?? [], JSON_UNESCAPED_UNICODE) ?>;
  var sortenChecks = Array.prototype.slice.call(document.querySelectorAll('.sorte-check'));
  // Gruppen ohne gewählte Sorte erst auf Wunsch zeigen (die Liste wäre auf dem Handy sehr lang)
  var sortenAlleZeigen = false;
  var sortenKnopf = document.getElementById('sortenAlle');
  function sortenGruppen() {
    document.querySelectorAll('.sorten-spalte').forEach(function (spalte) {
      spalte.hidden = !sortenAlleZeigen && !spalte.querySelector('.sorte-check:checked');
    });
    if (sortenKnopf) {
      sortenKnopf.textContent = sortenAlleZeigen ? 'Nur gewählte Kraftstoffe zeigen' : 'Weitere Kraftstoffe zeigen';
      sortenKnopf.setAttribute('aria-expanded', sortenAlleZeigen ? 'true' : 'false');
    }
  }
  if (sortenKnopf) sortenKnopf.addEventListener('click', function () { sortenAlleZeigen = !sortenAlleZeigen; sortenGruppen(); });
  // „Erweitert“: Sortenauswahl auf- und zuklappen
  var erweitertKnopf = document.getElementById('sortenErweitert');
  if (erweitertKnopf) erweitertKnopf.addEventListener('click', function () {
    var bereich = document.getElementById('sortenBereich');
    bereich.hidden = !bereich.hidden;
    erweitertKnopf.setAttribute('aria-expanded', bereich.hidden ? 'false' : 'true');
    if (!bereich.hidden) bereich.querySelector('.sorte-check').focus({ preventScroll: false });
  });
  function sortenAktualisieren() {
    var gewaehlt = sortenChecks.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    var standardGesetzt = false;
    sortenChecks.forEach(function (c) {
      var radio = document.getElementById('standard_' + c.value);
      var an = gewaehlt.indexOf(c.value) >= 0;
      radio.disabled = !an;
      radio.closest('.sorte-standard').hidden = !an;
      if (!an) radio.checked = false;
      if (radio.checked) standardGesetzt = true;
    });
    if (!standardGesetzt && gewaehlt.length) document.getElementById('standard_' + gewaehlt[0]).checked = true;
    // Mindestens eine Sorte: die Prüfung beim Weiter/Speichern greift über die erste Checkbox
    if (sortenChecks.length) sortenChecks[0].setCustomValidity(gewaehlt.length ? '' : 'Bitte mindestens einen Kraftstoff wählen.');
    var fehler = document.getElementById('sortenFehler');
    if (fehler) fehler.classList.toggle('d-block', sortenChecks.length > 0 && gewaehlt.length === 0);
    if (!gewaehlt.length) sortenAlleZeigen = true;
    sortenGruppen();
  }
  sortenChecks.forEach(function (c) { c.addEventListener('change', sortenAktualisieren); });
  sortenAktualisieren();
  function antrieb() {
    var t = texte[auswahl.value] || ['Tankgröße (Liter)', 'Fassungsvermögen in Litern.'];
    document.getElementById('tankCapacityLabel').textContent = t[0];
    document.getElementById('tankCapacityHinweis').textContent = t[1];
    document.getElementById('batteryCapacityFeld').hidden = auswahl.value !== 'phev';
    vorschau();
  }
  auswahl.addEventListener('change', function () {
    // Andere Antriebsart: Sorten vorschlagen (wie die API, wenn nur die Antriebsart geändert wird)
    var vorschlag = sortenStandards[auswahl.value];
    if (vorschlag && sortenChecks.length) {
      sortenChecks.forEach(function (c) { c.checked = vorschlag.indexOf(c.value) >= 0; });
      sortenChecks.forEach(function (c) { document.getElementById('standard_' + c.value).checked = c.value === vorschlag[0]; });
      sortenAktualisieren();
    }
    antrieb();
  });

  // Live-Vorschau (nur beim Anlegen vorhanden)
  function vorschau() {
    var name = document.getElementById('vorschauName');
    if (!name) return;
    var feld = function (id) { return document.getElementById(id).value.trim(); };
    name.textContent = feld('name') || 'Neues Fahrzeug';
    document.getElementById('vorschauZeile').textContent = [
      [feld('brand'), feld('model')].filter(Boolean).join(' '),
      auswahl.options[auswahl.selectedIndex].text,
      feld('year') ? 'Baujahr ' + feld('year') : ''
    ].filter(Boolean).join(' · ');
    var kz = document.getElementById('vorschauKennzeichen');
    kz.textContent = feld('licensePlate').toUpperCase();
    kz.hidden = !kz.textContent;
  }
  form.addEventListener('input', vorschau);

  // Assistent: Schritt für Schritt, jeweils mit Prüfung der Felder des Schritts
  var schritte = Array.prototype.slice.call(form.querySelectorAll('.assistent-schritt'));
  if (schritte.length) {
    var aktuell = 0;
    var weiter = document.getElementById('btnWeiter');
    var zurueck = document.getElementById('btnZurueck');
    var speichern = document.getElementById('btnSpeichern');
    var zeige = function (i) {
      aktuell = i;
      schritte.forEach(function (s, n) { s.hidden = n !== i; });
      document.querySelectorAll('.assistent-schritte li').forEach(function (li, n) {
        li.classList.toggle('aktiv', n === i);
        li.classList.toggle('erledigt', n < i);
        if (n === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
      zurueck.hidden = i === 0;
      weiter.hidden = i === schritte.length - 1;
      speichern.hidden = i !== schritte.length - 1;
      var erstes = schritte[i].querySelector('input, select');
      if (erstes) erstes.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    var gueltig = function (i) {
      var ok = true;
      schritte[i].querySelectorAll('input, select').forEach(function (el) {
        if (!el.checkValidity()) { el.classList.add('is-invalid'); ok = false; } else { el.classList.remove('is-invalid'); }
      });
      return ok;
    };
    weiter.addEventListener('click', function () { if (gueltig(aktuell)) zeige(aktuell + 1); });
    zurueck.addEventListener('click', function () { zeige(aktuell - 1); });
    // Enter springt zum nächsten Schritt statt das Formular halb ausgefüllt abzuschicken
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && speichern.hidden) { e.preventDefault(); weiter.click(); }
    });
  }
  // Beim Absenden alle Felder prüfen; beim Bearbeiten den Abschnitt mit dem Fehler aufklappen
  form.addEventListener('submit', function (e) {
    if (form.checkValidity()) return;
    e.preventDefault();
    var fehler = form.querySelector(':invalid');
    form.querySelectorAll('input, select').forEach(function (el) { el.classList.toggle('is-invalid', !el.checkValidity()); });
    var bereich = fehler.closest('.accordion-collapse');
    if (bereich && window.bootstrap) bootstrap.Collapse.getOrCreateInstance(bereich).show();
    var schritt = fehler.closest('.assistent-schritt');
    if (schritt && typeof zeige === 'function') zeige(schritte.indexOf(schritt));
    fehler.focus();
  });

  // Große Fotos (z. B. vom Handy) vor dem Upload auf max. 1600 px verkleinern; Vorschau zeigt das Bild
  document.getElementById('bild').addEventListener('change', async function (event) {
    var input = event.target;
    var file = input.files && input.files[0];
    var bild = document.getElementById('vorschauBild');
    if (file && bild) bild.src = URL.createObjectURL(file);
    if (!file || !file.type.startsWith('image/') || file.type === 'image/gif' || !window.DataTransfer) return;
    try {
      var bitmap = await createImageBitmap(file);
      var scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 1500000) return;
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.85); });
      if (!blob) return;
      var dt = new DataTransfer();
      dt.items.add(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
      input.files = dt.files;
    } catch (e) {
      // Verkleinern nicht möglich: Originaldatei hochladen
    }
  });

  antrieb();

  // Bearbeiten: Sprung aus "Einstellungen" (#48), z. B. fahrzeug_bearbeiten.php?id=…#termine öffnet diesen Abschnitt
  if (!schritte.length && location.hash) {
    var ziel = document.getElementById('abschnitt_' + location.hash.slice(1).replace(/[^a-z]/g, ''));
    if (ziel) {
      window.addEventListener('DOMContentLoaded', function () {
        if (!window.bootstrap) return;
        document.querySelectorAll('#fahrzeugAbschnitte .accordion-collapse.show').forEach(function (offen) {
          if (offen !== ziel) bootstrap.Collapse.getOrCreateInstance(offen, { toggle: false }).hide();
        });
        bootstrap.Collapse.getOrCreateInstance(ziel, { toggle: false }).show();
        ziel.closest('.accordion-item').scrollIntoView({ block: 'start' });
      });
    }
  }
})();
</script>
