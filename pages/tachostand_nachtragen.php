<?php
// Tachostand eines Tank- oder Ladevorgangs nachtragen (#41). Geht auch nach Ablauf der 14-Tage-Frist,
// weil nur der Tachostand geändert wird.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';

if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$api = getApiClient();
$eintrag_id = trim((string)($_GET['id'] ?? $_POST['id'] ?? ''));
$fahrzeug_id = trim((string)($_GET['fahrzeug_id'] ?? $_POST['fahrzeug_id'] ?? ''));
$zurueck = '../' . fahrzeugSeite('eintraege', (string)($fahrzeug_id));
if ($eintrag_id === '' || $fahrzeug_id === '') {
    header('Location: ../index.php');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $km = trim((string)($_POST['tachostand'] ?? ''));
    if ($km === '' || !ctype_digit($km)) {
        $_SESSION['error_message'] = 'Bitte den Tachostand als ganze Zahl eintragen.';
        header('Location: tachostand_nachtragen.php?id=' . rawurlencode($eintrag_id) . '&fahrzeug_id=' . rawurlencode($fahrzeug_id));
        exit;
    }
    try {
        // Nur odometerKm (+ Markierung) schicken: dafür gilt die 14-Tage-Frist der API nicht
        $api->patchFillup($eintrag_id, ['odometerKm' => (int)$km, 'odometerEstimated' => !empty($_POST['tachostand_geschaetzt'])]);
        $_SESSION['success_message'] = 'Tachostand nachgetragen.';
        header('Location: ' . $zurueck);
    } catch (Throwable $e) {
        $_SESSION['error_message'] = $e->getMessage();
        header('Location: tachostand_nachtragen.php?id=' . rawurlencode($eintrag_id) . '&fahrzeug_id=' . rawurlencode($fahrzeug_id));
    }
    exit;
}

try {
    $eintrag = $api->getFillup($eintrag_id);
    $fahrzeug = $api->getVehicle($fahrzeug_id);
} catch (Throwable $e) {
    http_response_code(404);
    die('Eintrag nicht gefunden.');
}
if (($eintrag['vehicle_id'] ?? '') !== ($fahrzeug['id'] ?? '')) {
    http_response_code(404);
    die('Eintrag nicht gefunden.');
}

$fuelType = (string)($fahrzeug['fuel_type'] ?? 'other');
$einheit = $eintrag['unit'] ?? 'l';
$begriffe = begriffeFuerEinheit($fuelType, $einheit);
$datum = isset($eintrag['filled_at']) ? date('Y-m-d', strtotime($eintrag['filled_at'])) : '';
$menge = (float)($eintrag['amount'] ?? 0);

// Bekannte Tachostände davor und danach als Rahmen; Schätzung: letzter Stand davor + Menge ÷ Ø Verbrauch × 100
$davor = null;
$danach = null;
foreach (getMergedEintraegeFromApi($api, $fahrzeug_id)['eintraege'] as $monatsEintraege) {
    foreach ($monatsEintraege as $e) {
        if ($e['id'] === $eintrag_id || !hatEchtenTachostand($e) || (int)$e['tachostand'] <= 0) {
            continue;
        }
        if ($e['datum'] <= $datum && ($davor === null || (int)$e['tachostand'] > $davor['km'])) {
            $davor = ['km' => (int)$e['tachostand'], 'datum' => $e['datum']];
        }
        if ($e['datum'] > $datum && ($danach === null || (int)$e['tachostand'] < $danach['km'])) {
            $danach = ['km' => (int)$e['tachostand'], 'datum' => $e['datum']];
        }
    }
}
$schaetzung = null;
try {
    $stats = $api->getVehicleStats($fahrzeug_id);
    $schnitt = $einheit === 'kwh' && $fuelType === 'phev' ? null : ($stats['units'][$einheit]['avgConsumption'] ?? null);
    if ($davor !== null && $schnitt > 0 && $menge > 0 && $fuelType !== 'phev') {
        $schaetzung = (int)round($davor['km'] + $menge / $schnitt * 100);
        if ($danach !== null && $schaetzung > $danach['km']) {
            $schaetzung = $danach['km'];
        }
    }
} catch (Throwable $e) {
}

$tachoAusnahmeId = $eintrag_id;
include '../includes/header.php';
?>

<div class="container mt-4 mt-lg-5" style="max-width: 36rem;">
    <h1 class="h3">Tachostand nachtragen</h1>
    <p class="text-body-secondary">
        <?= htmlspecialchars($begriffe['vorgang']) ?> vom <?= $datum ? date('d.m.Y', strtotime($datum)) : '–' ?>:
        <?= number_format($menge, 2, ',', '.') ?> <?= einheitKurz($einheit) ?>,
        <?= number_format((float)($eintrag['total_cost_eur'] ?? 0), 2, ',', '.') ?> €<?= !empty($eintrag['station']) ? ' · ' . htmlspecialchars($eintrag['station']) : '' ?>
    </p>

    <form method="post" class="card border-0 shadow-sm p-3">
        <input type="hidden" name="id" value="<?= htmlspecialchars($eintrag_id) ?>">
        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
        <input type="hidden" name="datum" value="<?= htmlspecialchars($datum) ?>">
        <input type="hidden" name="tachostand_geschaetzt" id="tachostand_geschaetzt" value="">
        <label for="tachostand" class="form-label">Tachostand (km)</label>
        <input type="number" class="form-control form-control-lg" id="tachostand" name="tachostand" min="0" step="1" inputmode="numeric" required autofocus
               placeholder="<?= !empty($eintrag['odometer_estimated']) && isset($eintrag['odometer_km']) ? 'bisher geschätzt: ' . number_format((int)$eintrag['odometer_km'], 0, ',', '.') : '' ?>">
        <div class="form-text">
            <?php if ($davor !== null || $danach !== null): ?>
                <?= $davor !== null ? 'Davor: ' . number_format($davor['km'], 0, ',', '.') . ' km (' . date('d.m.Y', strtotime($davor['datum'])) . ')' : '' ?>
                <?= $davor !== null && $danach !== null ? ' · ' : '' ?>
                <?= $danach !== null ? 'Danach: ' . number_format($danach['km'], 0, ',', '.') . ' km (' . date('d.m.Y', strtotime($danach['datum'])) . ')' : '' ?>
            <?php endif; ?>
            <?php if (!empty($eintrag['odometer_estimated'])): ?>
                <br>Der eingetragene Wert ist nur geschätzt.
            <?php endif; ?>
        </div>
        <?php if ($schaetzung !== null): ?>
            <button type="button" class="btn btn-link btn-sm px-0 text-start" id="btnSchaetzung" data-km="<?= $schaetzung ?>">
                Schätzung übernehmen: ca. <?= number_format($schaetzung, 0, ',', '.') ?> km (aus <?= number_format($menge, 1, ',', '.') ?> <?= einheitKurz($einheit) ?>)
            </button>
        <?php endif; ?>
        <div class="d-flex gap-2 mt-3">
            <button type="submit" class="btn btn-primary">Speichern</button>
            <a href="<?= htmlspecialchars($zurueck) ?>" class="btn btn-outline-secondary">Abbrechen</a>
        </div>
    </form>
</div>

<script>
(function () {
  var feld = document.getElementById('tachostand');
  var markierung = document.getElementById('tachostand_geschaetzt');
  var knopf = document.getElementById('btnSchaetzung');
  // Eine übernommene Schätzung wird markiert und zählt nicht für den Verbrauch; eigene Eingabe gilt als echt
  if (knopf) knopf.addEventListener('click', function () {
    feld.value = knopf.dataset.km;
    markierung.value = '1';
    feld.dispatchEvent(new Event('input'));
    markierung.value = '1';
  });
  feld.addEventListener('input', function () { markierung.value = ''; });
})();
</script>

<?php
include '../includes/tacho_pruefung.php';
include '../includes/footer.php';
