<?php
// Reiter "Fahrten" (#52): Fahrtenbuch zur eigenen Übersicht – km je Zweck, Anteil dienstlich, Monatsübersicht,
// Liste mit Filter und CSV-Export (Plus). Alle Zahlen rechnet die API (/trips/summary).
include_once __DIR__ . '/../includes/api_helpers.php';

$fahrtJahr = isset($_GET['fjahr']) && $_GET['fjahr'] !== '' ? (int)$_GET['fjahr'] : null;
$fahrtZweck = isset($_GET['fzweck']) && array_key_exists($_GET['fzweck'], fahrtZwecke()) ? (string)$_GET['fzweck'] : null;
$zwecke = fahrtZwecke();
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
// Filter-Chips: Zweck als Link (Jahr bleibt erhalten)
$filterUrl = fn(?string $zweck) => 'fahrzeug_detail.php?' . http_build_query(array_filter([
    'id' => $fahrzeug_id, 'fjahr' => $fahrtJahr, 'fzweck' => $zweck,
], fn($v) => $v !== null && $v !== '')) . '#fahrten';
// Liste nach Monat gruppieren, wie im Reiter „Einträge“ (#144)
$fahrtenJeMonat = [];
foreach ($fahrtListe as $t) {
    $fahrtenJeMonat[date('Y-m', strtotime($t['started_at']))][] = $t;
}
?>
<div class="mt-3 mt-lg-4 fahrten-liste">
  <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
    <?php if ($darfErfassen): ?>
    <a href="../pages/fahrt.php?fahrzeug_id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-primary"><i class="fas fa-route" aria-hidden="true"></i>Fahrt erfassen</a>
    <?php endif; ?>
    <form method="get" action="fahrzeug_detail.php#fahrten" class="d-flex gap-2">
      <input type="hidden" name="id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
      <?php if ($fahrtZweck !== null): ?><input type="hidden" name="fzweck" value="<?= htmlspecialchars($fahrtZweck) ?>"><?php endif; ?>
      <select name="fjahr" class="form-select w-auto" aria-label="Jahr" onchange="this.form.submit()">
        <option value="">Alle Jahre</option>
        <?php foreach (array_keys($alleJahre) as $y): ?><option value="<?= $y ?>" <?= $fahrtJahr === $y ? 'selected' : '' ?>><?= $y ?></option><?php endforeach; ?>
      </select>
      <noscript><button class="btn btn-secondary">Anzeigen</button></noscript>
    </form>
    <?php if ($fahrtSumme && $fahrtSumme['count'] > 0): ?>
      <?php if (!empty($fahrtSumme['canExport'])): ?>
      <a download class="btn btn-secondary ms-auto" href="../pages/fahrten_export.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?><?= $fahrtJahr ? '&jahr=' . $fahrtJahr : '' ?>"><i class="fas fa-file-csv" aria-hidden="true"></i>CSV</a>
      <?php else: ?>
      <span class="ms-auto fs-footnote"><i class="fas fa-lock me-1" aria-hidden="true"></i>Export als CSV mit Plus</span>
      <?php endif; ?>
    <?php endif; ?>
  </div>

  <!-- Filter nach Zweck -->
  <nav class="chip-leiste mb-3" aria-label="Nach Zweck filtern">
    <a class="chip<?= $fahrtZweck === null ? ' active' : '' ?>" href="<?= htmlspecialchars($filterUrl(null)) ?>"<?= $fahrtZweck === null ? ' aria-current="true"' : '' ?>>Alle</a>
    <?php foreach ($zwecke as $wert => $name): ?>
    <a class="chip<?= $fahrtZweck === $wert ? ' active' : '' ?>" href="<?= htmlspecialchars($filterUrl($wert)) ?>"<?= $fahrtZweck === $wert ? ' aria-current="true"' : '' ?>><?= htmlspecialchars($name) ?></a>
    <?php endforeach; ?>
  </nav>

  <?php if (!$fahrtSumme || $fahrtSumme['count'] === 0): ?>
    <div class="card leer-zustand mx-auto">
      <div class="card-body">
        <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-route"></i></span>
        <h2>Noch keine Fahrten<?= $fahrtJahr ? ' in ' . $fahrtJahr : '' ?></h2>
        <p class="text-body-secondary mb-0">Das Fahrtenbuch hilft beim Überblick über private und dienstliche Strecken.</p>
        <p class="fs-footnote mb-0">Ein Fahrtenbuch zur eigenen Übersicht, kein vom Finanzamt anerkanntes Fahrtenbuch.</p>
      </div>
    </div>
  <?php else: ?>
    <!-- Kennzahlen -->
    <div class="row g-2 mb-3">
      <div class="col-6 col-lg-3"><div class="kennzahl">
        <div>Gefahren · <?= (int)$fahrtSumme['count'] ?> <?= (int)$fahrtSumme['count'] === 1 ? 'Fahrt' : 'Fahrten' ?></div>
        <div class="kennzahl-wert"><?= $km($fahrtSumme['totalKm']) ?></div>
      </div></div>
      <div class="col-6 col-lg-3"><div class="kennzahl">
        <div>Anteil dienstlich</div>
        <div class="kennzahl-wert"><?= $fahrtSumme['businessShare'] !== null ? number_format((float)$fahrtSumme['businessShare'], 1, ',', '.') . ' %' : '–' ?></div>
      </div></div>
      <?php foreach ($zwecke as $wert => $name): $z = $fahrtSumme['byPurpose'][$wert] ?? ['km' => 0, 'count' => 0, 'estimatedCost' => null]; if (!$z['count']) continue; ?>
      <div class="col-6 col-lg-3"><div class="kennzahl">
        <div><span class="farb-punkt" style="--farbe: <?= fahrtFarbe($wert) ?>" aria-hidden="true"></span><?= htmlspecialchars($name) ?></div>
        <div class="kennzahl-wert"><?= $km($z['km']) ?></div>
        <?php if ($z['estimatedCost'] !== null): ?><div title="Kosten pro km des Fahrzeugs × Strecke">≈ <?= number_format((float)$z['estimatedCost'], 2, ',', '.') ?> € geschätzt</div><?php endif; ?>
      </div></div>
      <?php endforeach; ?>
    </div>

    <!-- km je Monat und Zweck: Balken je Monat, darunter dieselben Werte als Tabelle (Textalternative) -->
    <div class="card mb-3">
      <div class="card-body">
        <h2 class="mb-3">Kilometer je Monat</h2>
        <?php $maxMonat = max(1, ...array_map(fn($m) => array_sum(array_map(fn($w) => (float)$m[$w], array_keys($zwecke))), $fahrtSumme['months'])); ?>
        <div class="monats-balken" aria-hidden="true">
          <?php foreach (array_reverse($fahrtSumme['months']) as $m): ?>
          <div class="monats-balken-zeile">
            <span class="fs-label zahl"><?= htmlspecialchars(formatMonat($m['month'])) ?></span>
            <span class="monats-balken-spur">
              <?php foreach (array_keys($zwecke) as $wert): if ((float)$m[$wert] <= 0) continue; ?>
              <span style="width: <?= round((float)$m[$wert] / $maxMonat * 100, 2) ?>%; --farbe: <?= fahrtFarbe($wert) ?>"></span>
              <?php endforeach; ?>
            </span>
            <span class="fs-label zahl text-end"><?= $km(array_sum(array_map(fn($w) => (float)$m[$w], array_keys($zwecke)))) ?></span>
          </div>
          <?php endforeach; ?>
        </div>
        <div class="d-flex flex-wrap gap-3 mt-3 fs-label" aria-hidden="true">
          <?php foreach ($zwecke as $wert => $name): ?><span><span class="farb-punkt" style="--farbe: <?= fahrtFarbe($wert) ?>"></span><?= htmlspecialchars($name) ?></span><?php endforeach; ?>
        </div>
        <details class="mt-3">
          <summary class="fs-label">Werte als Tabelle</summary>
          <div class="table-responsive mt-2">
            <table class="table table-sm mb-0">
              <thead><tr><th scope="col">Monat</th><?php foreach ($zwecke as $name): ?><th scope="col" class="text-end"><?= $name ?></th><?php endforeach; ?></tr></thead>
              <tbody>
              <?php foreach (array_reverse($fahrtSumme['months']) as $m): ?>
                <tr><th scope="row" class="fw-normal"><?= htmlspecialchars(formatMonat($m['month'], true)) ?></th>
                  <?php foreach (array_keys($zwecke) as $wert): ?><td class="text-end"><?= (float)$m[$wert] > 0 ? $km($m[$wert]) : '–' ?></td><?php endforeach; ?>
                </tr>
              <?php endforeach; ?>
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>

    <!-- Liste: je Monat eine Karte, Zeilen wie im Reiter „Einträge“ -->
    <?php foreach ($fahrtenJeMonat as $monat => $fahrten): ?>
    <section class="eintrag-monat">
      <h3 class="eintrag-monat-titel">
        <span><?= htmlspecialchars(formatMonat($monat, true)) ?></span>
        <span><?= $km(array_sum(array_map(fn($t) => (float)$t['distance_km'], $fahrten))) ?></span>
      </h3>
      <ul class="list-group eintrag-gruppe">
        <?php foreach ($fahrten as $t):
            $vonAnderen = (string)($t['created_by'] ?? '') !== $ichId;
            $darfAendern = $istBesitzer || ($darfErfassen && !$vonAnderen);
            $strecke = implode(' → ', array_filter([(string)($t['start_place'] ?? ''), (string)($t['end_place'] ?? '')], fn($x) => $x !== ''));
            $bearbeitenUrl = '../pages/fahrt.php?id=' . urlencode($t['id']) . '&fahrzeug_id=' . urlencode($fahrzeug_id);
        ?>
        <li class="list-group-item eintrag-zeile">
          <?= symbolKreis('fa-route', fahrtFarbe($t['purpose'] ?? null)) ?>
          <a <?= $darfAendern ? 'href="' . htmlspecialchars($bearbeitenUrl) . '"' : 'aria-disabled="true"' ?> class="eintrag-text text-reset text-decoration-none min-w-0">
            <span class="d-block fs-headline text-truncate"><?= htmlspecialchars($strecke !== '' ? $strecke : 'Fahrt') ?></span>
            <span class="d-block fs-label"><?= htmlspecialchars(implode(' · ', array_filter([
                date('d.m.', strtotime($t['started_at'])),
                $zwecke[$t['purpose']] ?? (string)$t['purpose'],
                number_format((int)$t['odometer_end'], 0, ',', '.') . ' km',
                $vonAnderen ? 'von ' . ($t['created_by_name'] ?? '') : '',
            ]))) ?></span>
            <?php if (!empty($t['note'])): ?><span class="d-block fs-label text-truncate"><?= htmlspecialchars((string)$t['note']) ?></span><?php endif; ?>
          </a>
          <span class="eintrag-betrag"><?= $km($t['distance_km']) ?></span>
          <?php if ($darfAendern): ?>
          <a class="kopf-symbol" href="<?= htmlspecialchars($bearbeitenUrl) ?>" aria-label="Fahrt vom <?= date('d.m.Y', strtotime($t['started_at'])) ?> bearbeiten"><i class="fas fa-pen" aria-hidden="true"></i></a>
          <?php else: ?>
          <span class="px-1" aria-hidden="true"></span>
          <?php endif; ?>
        </li>
        <?php endforeach; ?>
      </ul>
    </section>
    <?php endforeach; ?>
    <?php if (!$fahrtListe): ?><p class="text-body-secondary text-center my-4">Keine Fahrten für diesen Filter.</p><?php endif; ?>
    <p class="fs-footnote mt-4">Fahrtenbuch zur eigenen Übersicht, kein vom Finanzamt anerkanntes Fahrtenbuch. Geschätzte Kosten: Kosten pro km des Fahrzeugs × Strecke.</p>
  <?php endif; ?>
</div>
