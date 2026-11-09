<?php
// Fahrt anlegen und bearbeiten (#52): Datum, Tachostand Start/Ende bzw. Strecke, Von/Nach, Zweck, Notiz.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$api = getApiClient();
$fahrzeugId = (string)($_GET['fahrzeug_id'] ?? $_POST['fahrzeug_id'] ?? '');
$fahrtId = (string)($_GET['id'] ?? $_POST['id'] ?? '');
$zurueck = 'fahrzeug_detail.php?id=' . urlencode($fahrzeugId) . '#fahrten';
$fehler = '';
$fahrt = ['started_at' => date('c'), 'purpose' => 'private'];

if ($fahrtId !== '') {
    try {
        $fahrt = $api->getTrip($fahrtId);
        $fahrzeugId = (string)$fahrt['vehicle_id'];
        $zurueck = 'fahrzeug_detail.php?id=' . urlencode($fahrzeugId) . '#fahrten';
    } catch (Throwable $e) {
        $_SESSION['error_message'] = 'Diese Fahrt gibt es nicht (mehr).';
        header('Location: ' . $zurueck);
        exit;
    }
}

$fehlertexte = [
    'invalid_odometerEnd' => 'Bitte den Tachostand am Ende der Fahrt angeben.',
    'invalid_odometerStart' => 'Der Tachostand am Start muss kleiner als am Ende sein.',
    'invalid_distanceKm' => 'Bitte den Tachostand am Start oder die gefahrenen km angeben.',
    'invalid_startedAt' => 'Bitte ein gültiges Datum angeben.',
    'invalid_endedAt' => 'Das Ende liegt vor dem Start.',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $aktion = $_POST['aktion'] ?? 'speichern';
    try {
        if ($aktion === 'loeschen' && $fahrtId !== '') {
            $api->deleteTrip($fahrtId);
            $_SESSION['success_message'] = 'Fahrt gelöscht.';
        } else {
            $zahl = fn($k) => is_numeric(str_replace(',', '.', (string)($_POST[$k] ?? ''))) ? (float)str_replace(',', '.', (string)$_POST[$k]) : null;
            $start = $zahl('tachostand_start');
            $daten = [
                'startedAt' => date('c', strtotime(($_POST['datum'] ?? date('Y-m-d')) . ' ' . ($_POST['uhrzeit'] ?? '12:00'))),
                'odometerEnd' => $zahl('tachostand_ende'),
                'odometerStart' => $start,
                'distanceKm' => $start === null ? $zahl('gefahrene_km') : null,
                'startPlace' => trim((string)($_POST['startort'] ?? '')),
                'endPlace' => trim((string)($_POST['zielort'] ?? '')),
                'purpose' => (string)($_POST['zweck'] ?? 'private'),
                'note' => trim((string)($_POST['notiz'] ?? '')),
            ];
            if ($fahrtId !== '') {
                $api->patchTrip($fahrtId, $daten);
                $_SESSION['success_message'] = 'Fahrt gespeichert.';
            } else {
                $api->postTrip(['vehicleId' => $fahrzeugId] + $daten);
                $_SESSION['success_message'] = 'Fahrt eingetragen.';
            }
        }
        header('Location: ' . $zurueck);
        exit;
    } catch (Throwable $e) {
        $fehler = tarifHinweis($e) ?? ($fehlertexte[$e->getMessage()] ?? $e->getMessage());
        $fahrt = array_merge($fahrt, [
            'start_place' => $_POST['startort'] ?? '', 'end_place' => $_POST['zielort'] ?? '', 'note' => $_POST['notiz'] ?? '',
            'purpose' => $_POST['zweck'] ?? 'private', 'odometer_start' => $_POST['tachostand_start'] ?? '',
            'odometer_end' => $_POST['tachostand_ende'] ?? '', 'distance_km' => $_POST['gefahrene_km'] ?? '',
        ]);
    }
}

// Vorschlag für den Start: letzter bekannter Tachostand (#52)
$vorschlagStart = '';
if ($fahrtId === '') {
    try {
        $stats = $api->getVehicleStats($fahrzeugId);
        $vorschlagStart = isset($stats['currentOdo']) ? (string)(int)$stats['currentOdo'] : '';
    } catch (Throwable $e) {
    }
}
$wert = fn($k, $standard = '') => htmlspecialchars((string)($fahrt[$k] ?? $standard));
$zeit = strtotime((string)($fahrt['started_at'] ?? 'now'));

include '../includes/header.php';
?>
<div class="container">
  <div class="row justify-content-center mt-3 mt-lg-4">
    <div class="col-md-8 col-lg-6">
      <h1 class="h4 mb-3 d-none d-lg-block"><i class="fas fa-route me-2 text-primary" aria-hidden="true"></i><?= $fahrtId ? 'Fahrt bearbeiten' : 'Neue Fahrt' ?></h1>
      <?php if ($fehler): ?><div class="alert alert-danger" role="alert"><?= htmlspecialchars($fehler) ?></div><?php endif; ?>
      <form method="post" class="card border-0 shadow-sm"><div class="card-body">
        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeugId) ?>">
        <input type="hidden" name="id" value="<?= htmlspecialchars($fahrtId) ?>">
        <div class="row g-2 mb-3">
          <div class="col-7"><label for="datum" class="form-label">Datum</label><input type="date" id="datum" name="datum" class="form-control" value="<?= date('Y-m-d', $zeit) ?>" required></div>
          <div class="col-5"><label for="uhrzeit" class="form-label">Uhrzeit</label><input type="time" id="uhrzeit" name="uhrzeit" class="form-control" value="<?= date('H:i', $zeit) ?>"></div>
          <div class="col-6"><label for="startort" class="form-label">Von</label><input type="text" id="startort" name="startort" class="form-control" value="<?= $wert('start_place') ?>"></div>
          <div class="col-6"><label for="zielort" class="form-label">Nach</label><input type="text" id="zielort" name="zielort" class="form-control" value="<?= $wert('end_place') ?>"></div>
          <div class="col-6"><label for="tachostand_start" class="form-label">Tachostand Start</label><input type="number" inputmode="numeric" id="tachostand_start" name="tachostand_start" class="form-control" min="0" value="<?= $fahrtId ? $wert('odometer_start') : htmlspecialchars($vorschlagStart) ?>"></div>
          <div class="col-6"><label for="tachostand_ende" class="form-label">Tachostand Ende</label><input type="number" inputmode="numeric" id="tachostand_ende" name="tachostand_ende" class="form-control" min="0" value="<?= $wert('odometer_end') ?>" required></div>
          <div class="col-12 form-text">Ohne Startstand: gefahrene km angeben.</div>
          <div class="col-5"><label for="gefahrene_km" class="form-label">km</label><input type="number" inputmode="decimal" id="gefahrene_km" name="gefahrene_km" class="form-control" min="0" step="0.1" value="<?= $fahrtId && ($fahrt['odometer_start'] ?? null) === null ? $wert('distance_km') : '' ?>"></div>
          <div class="col-7">
            <label for="zweck" class="form-label">Zweck</label>
            <select id="zweck" name="zweck" class="form-select">
              <?php foreach (fahrtZwecke() as $w => $name): ?><option value="<?= $w ?>" <?= ($fahrt['purpose'] ?? '') === $w ? 'selected' : '' ?>><?= $name ?></option><?php endforeach; ?>
            </select>
          </div>
          <div class="col-12"><label for="notiz" class="form-label">Notiz (optional)</label><input type="text" id="notiz" name="notiz" class="form-control" maxlength="200" value="<?= $wert('note') ?>"></div>
        </div>
        <div class="d-flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary"><i class="fas fa-check me-1"></i>Speichern</button>
          <a href="<?= htmlspecialchars($zurueck) ?>" class="btn btn-outline-secondary">Abbrechen</a>
          <?php if ($fahrtId): ?>
          <button type="submit" name="aktion" value="loeschen" class="btn btn-outline-danger ms-auto" formnovalidate onclick="return confirm('Fahrt löschen?');"><i class="fas fa-trash me-1"></i>Löschen</button>
          <?php endif; ?>
        </div>
      </div></form>
    </div>
  </div>
</div>
<?php include '../includes/footer.php'; ?>
