<?php
// Reiter "Fahrten" (#52): Fahrtenbuch zur eigenen Übersicht – km je Zweck, Anteil dienstlich, Monatsübersicht,
// Liste mit Filter und CSV-Export (Plus). Alle Zahlen rechnet die API (/trips/summary).
include_once __DIR__ . '/../includes/api_helpers.php';

$fahrtJahr = isset($_GET['fjahr']) && $_GET['fjahr'] !== '' ? (int)$_GET['fjahr'] : null;
$fahrtZweck = isset($_GET['fzweck']) && array_key_exists($_GET['fzweck'], fahrtZwecke()) ? (string)$_GET['fzweck'] : null;
$zwecke = fahrtZwecke();
$zweckFarbe = ['private' => 'secondary', 'business' => 'primary', 'commute' => 'info'];
$km = fn($v) => number_format((float)$v, fmod((float)$v, 1) ? 1 : 0, ',', '.') . ' km';

$fahrtSumme = null;
$fahrtListe = [];
$alleJahre = [];
try {
    $fahrtSumme = $api->getTripSummary($fahrzeug_id, $fahrtJahr);
    $fahrtListe = $api->getVehicleTrips($fahrzeug_id, $fahrtJahr, $fahrtZweck);
    foreach ($api->getVehicleTrips($fahrzeug_id) as $t) {
        $alleJahre[(int)date('Y', strtotime($t['started_at']))] = true;
    }
    krsort($alleJahre);
} catch (Throwable $e) {
    error_log('[Fahrten] ' . $e->getMessage());
}
$basisUrl = 'fahrzeug_detail.php?id=' . urlencode($fahrzeug_id);
?>
<div class="mt-3 mt-lg-4">
  <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
    <?php if ($darfErfassen): ?>
    <a href="../pages/fahrt.php?fahrzeug_id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-success"><i class="fas fa-plus me-1"></i>Neue Fahrt</a>
    <?php endif; ?>
    <form method="get" action="fahrzeug_detail.php#fahrten" class="d-flex flex-wrap gap-2">
      <input type="hidden" name="id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
      <select name="fjahr" class="form-select w-auto" aria-label="Jahr" onchange="this.form.submit()">
        <option value="">Alle Jahre</option>
        <?php foreach (array_keys($alleJahre) as $y): ?><option value="<?= $y ?>" <?= $fahrtJahr === $y ? 'selected' : '' ?>><?= $y ?></option><?php endforeach; ?>
      </select>
      <select name="fzweck" class="form-select w-auto" aria-label="Zweck" onchange="this.form.submit()">
        <option value="">Alle Zwecke</option>
        <?php foreach ($zwecke as $wert => $name): ?><option value="<?= $wert ?>" <?= $fahrtZweck === $wert ? 'selected' : '' ?>><?= $name ?></option><?php endforeach; ?>
      </select>
      <noscript><button class="btn btn-outline-secondary">Anzeigen</button></noscript>
    </form>
    <?php if ($fahrtSumme && $fahrtSumme['count'] > 0): ?>
      <?php if (!empty($fahrtSumme['canExport'])): ?>
      <a download class="btn btn-outline-primary ms-lg-auto" href="../pages/fahrten_export.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?><?= $fahrtJahr ? '&jahr=' . $fahrtJahr : '' ?>"><i class="fas fa-file-csv me-1"></i>CSV</a>
      <?php else: ?>
      <span class="ms-lg-auto small text-body-secondary"><i class="fas fa-lock me-1"></i>Export als CSV mit Plus</span>
      <?php endif; ?>
    <?php endif; ?>
  </div>

  <?php if (!$fahrtSumme || $fahrtSumme['count'] === 0): ?>
    <div class="card border-0 shadow-sm"><div class="card-body text-body-secondary">
      Noch keine Fahrten<?= $fahrtJahr ? ' in ' . $fahrtJahr : '' ?>. Das Fahrtenbuch hilft beim Überblick über private und dienstliche Strecken.
      <span class="d-block small mt-1">Hinweis: Es ist ein Fahrtenbuch zur eigenen Übersicht, kein vom Finanzamt anerkanntes Fahrtenbuch.</span>
    </div></div>
  <?php else: ?>
    <!-- Kennzahlen -->
    <div class="row g-3 mb-3">
      <div class="col-6 col-lg-3"><div class="card border-0 shadow-sm h-100"><div class="card-body">
        <div class="small text-body-secondary">Gefahren</div><div class="h5 mb-0"><?= $km($fahrtSumme['totalKm']) ?></div>
        <div class="small text-body-secondary"><?= (int)$fahrtSumme['count'] ?> Fahrten</div>
      </div></div></div>
      <div class="col-6 col-lg-3"><div class="card border-0 shadow-sm h-100"><div class="card-body">
        <div class="small text-body-secondary">Anteil dienstlich</div>
        <div class="h5 mb-0"><?= $fahrtSumme['businessShare'] !== null ? number_format((float)$fahrtSumme['businessShare'], 1, ',', '.') . ' %' : '–' ?></div>
      </div></div></div>
      <?php foreach ($zwecke as $wert => $name): $z = $fahrtSumme['byPurpose'][$wert] ?? ['km' => 0, 'count' => 0, 'estimatedCost' => null]; if (!$z['count']) continue; ?>
      <div class="col-6 col-lg-3"><div class="card border-0 shadow-sm h-100"><div class="card-body">
        <div class="small text-body-secondary"><?= $name ?></div><div class="h5 mb-0"><?= $km($z['km']) ?></div>
        <?php if ($z['estimatedCost'] !== null): ?><div class="small text-body-secondary">≈ <?= number_format((float)$z['estimatedCost'], 2, ',', '.') ?> € (Kosten pro km × Strecke)</div><?php endif; ?>
      </div></div></div>
      <?php endforeach; ?>
    </div>

    <!-- km je Monat und Zweck -->
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <h3 class="h6">km je Monat</h3>
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead><tr><th>Monat</th><?php foreach ($zwecke as $name): ?><th class="text-end"><?= $name ?></th><?php endforeach; ?></tr></thead>
            <tbody>
            <?php foreach (array_reverse($fahrtSumme['months']) as $m): ?>
              <tr><td><?= htmlspecialchars(date('m/Y', strtotime($m['month'] . '-01'))) ?></td>
                <?php foreach (array_keys($zwecke) as $wert): ?><td class="text-end"><?= (float)$m[$wert] > 0 ? $km($m[$wert]) : '–' ?></td><?php endforeach; ?>
              </tr>
            <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Liste -->
    <ul class="list-group mb-4">
      <?php foreach ($fahrtListe as $t):
          $vonAnderen = (string)($t['created_by'] ?? '') !== $ichId;
          $darfAendern = $istBesitzer || ($darfErfassen && !$vonAnderen);
          $strecke = implode(' → ', array_filter([(string)($t['start_place'] ?? ''), (string)($t['end_place'] ?? '')], fn($x) => $x !== ''));
      ?>
      <li class="list-group-item d-flex align-items-center gap-3">
        <span class="badge text-bg-<?= $zweckFarbe[$t['purpose']] ?? 'secondary' ?>"><?= htmlspecialchars($zwecke[$t['purpose']] ?? $t['purpose']) ?></span>
        <span class="flex-grow-1 min-w-0">
          <span class="d-block fw-semibold text-truncate"><?= htmlspecialchars($strecke !== '' ? $strecke : 'Fahrt') ?></span>
          <span class="d-block small text-body-secondary"><?= htmlspecialchars(implode(' · ', array_filter([
              date('d.m.Y', strtotime($t['started_at'])),
              number_format((int)$t['odometer_end'], 0, ',', '.') . ' km Tachostand',
              (string)($t['note'] ?? ''),
              $vonAnderen ? 'von ' . ($t['created_by_name'] ?? '') : '',
          ]))) ?></span>
        </span>
        <span class="text-nowrap"><?= $km($t['distance_km']) ?></span>
        <?php if ($darfAendern): ?>
        <a class="btn btn-sm btn-link text-body-secondary" href="../pages/fahrt.php?id=<?= htmlspecialchars(urlencode($t['id'])) ?>&fahrzeug_id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" aria-label="Fahrt bearbeiten"><i class="fas fa-pen"></i></a>
        <?php endif; ?>
      </li>
      <?php endforeach; ?>
      <?php if (!$fahrtListe): ?><li class="list-group-item text-body-secondary">Keine Fahrten für diesen Filter.</li><?php endif; ?>
    </ul>
    <p class="small text-body-secondary">Fahrtenbuch zur eigenen Übersicht, kein vom Finanzamt anerkanntes Fahrtenbuch. Geschätzte Kosten: Kosten pro km des Fahrzeugs × Strecke.</p>
  <?php endif; ?>
</div>
