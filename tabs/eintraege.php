<?php
// Reiter "Einträge" (#47): kompakte Liste je Monat mit Summe, Filter nach Art, Suche, Aktionen im Menü.
include_once __DIR__ . '/../includes/functions.php';
include_once __DIR__ . '/../includes/api_helpers.php';

$jahr = isset($_GET['jahr']) && $_GET['jahr'] !== '' ? (int)$_GET['jahr'] : null;

$merged = getMergedEintraegeFromApi($api, $fahrzeug_id);
$jahrListe = $merged['jahrListe'];
$eintraege = [];
foreach ($merged['eintraege'] as $monat => $entries) {
    if ($jahr === null || (int)substr($monat, 0, 4) === $jahr) {
        $eintraege[$monat] = $entries;
    }
}

// Art eines Eintrags für Filter und Darstellung
$artVon = function (array $e) {
    if (($e['type'] ?? '') === 'fillup') {
        return ($e['einheit'] ?? '') === 'kwh' ? 'laden' : 'tanken';
    }
    return ['trip' => 'fahrt', 'odometer' => 'km'][kategorieFormular($e['kategorie'] ?? '')] ?? 'ausgabe';
};
// Filter-Chips: nur Arten, die das Fahrzeug haben kann bzw. die vorkommen
$vorhandeneArten = [];
foreach ($eintraege as $entries) {
    foreach ($entries as $e) {
        $vorhandeneArten[$artVon($e)] = true;
    }
}
$filterArten = array_filter([
    'tanken' => in_array('l', einheitenFuerKraftstoff($fuelType), true) || in_array('kg', einheitenFuerKraftstoff($fuelType), true) || isset($vorhandeneArten['tanken']) ? 'Tanken' : null,
    'laden' => in_array('kwh', einheitenFuerKraftstoff($fuelType), true) || isset($vorhandeneArten['laden']) ? 'Laden' : null,
    'ausgabe' => 'Ausgaben',
    'fahrt' => isset($vorhandeneArten['fahrt']) ? 'Fahrten' : null,
    'km' => isset($vorhandeneArten['km']) ? 'km-Notizen' : null,
]);
$farbe = ['tanken' => 'primary', 'laden' => 'success', 'ausgabe' => 'warning', 'fahrt' => 'info', 'km' => 'secondary'];
$euro = fn($v) => number_format((float)$v, 2, ',', '.') . ' €';
$proSeite = 40;
$zeilenNr = 0;
?>

<div class="mt-3 mt-lg-4 eintraege-liste">
  <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
    <!-- Mobil steckt "Neuer Eintrag" im Plus der unteren Leiste -->
    <?php if ($darfErfassen): ?>
    <a href="../pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-success flex-shrink-0 d-none d-lg-inline-block">
      <i class="fas fa-plus me-1"></i> Neuer&nbsp;Eintrag
    </a>
    <?php endif; ?>
    <div class="input-group flex-grow-1" style="min-width: 12rem; max-width: 22rem;">
      <span class="input-group-text"><i class="fas fa-magnifying-glass"></i></span>
      <input type="search" class="form-control" id="eintragSuche" placeholder="Ort oder Beschreibung" aria-label="Einträge durchsuchen">
    </div>
    <form method="get" action="fahrzeug_detail.php#eintraege" class="d-flex">
      <input type="hidden" name="id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
      <select name="jahr" class="form-select w-auto" aria-label="Jahr" onchange="this.form.submit()">
        <option value="">Alle Jahre</option>
        <?php foreach ($jahrListe as $y): ?>
        <option value="<?= $y ?>" <?= $jahr === $y ? 'selected' : '' ?>><?= $y ?></option>
        <?php endforeach; ?>
      </select>
      <noscript><button class="btn btn-outline-secondary ms-2">Anzeigen</button></noscript>
    </form>
    <div class="btn-group flex-shrink-0 ms-lg-auto">
      <a download href="../pages/export.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?><?= $jahr !== null ? '&jahr=' . $jahr : '' ?>" class="btn btn-outline-primary" title="Als CSV für Excel herunterladen">
        <i class="fas fa-file-csv"></i><span class="d-none d-sm-inline ms-1">CSV</span>
      </a>
      <a href="../pages/bericht.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?><?= $jahr !== null ? '&jahr=' . $jahr : '' ?>" class="btn btn-outline-primary" title="Druckansicht, auch zum Speichern als PDF" target="_blank">
        <i class="fas fa-file-pdf"></i><span class="d-none d-sm-inline ms-1">Bericht</span>
      </a>
      <?php if ($istBesitzer): ?>
      <a href="../pages/import.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-outline-primary" title="Einträge aus einer CSV-Datei übernehmen">
        <i class="fas fa-file-import"></i><span class="d-none d-sm-inline ms-1">Import</span>
      </a>
      <?php endif; ?>
    </div>
  </div>

  <!-- Filter nach Art -->
  <div class="d-flex flex-wrap gap-1 mb-3" role="group" aria-label="Nach Art filtern" id="artFilter">
    <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill active" data-art="" aria-pressed="true">Alle</button>
    <?php foreach ($filterArten as $art => $name): ?>
      <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill" data-art="<?= $art ?>" aria-pressed="false"><?= $name ?></button>
    <?php endforeach; ?>
  </div>

  <?php if (empty($eintraege)): ?>
    <div class="alert alert-secondary">Noch keine Einträge<?= $jahr !== null ? ' in ' . $jahr : '' ?>.</div>
  <?php else: ?>
    <?php foreach ($eintraege as $monat => $entries):
      $summe = array_sum(array_map(fn($e) => istEintragOhneKosten($e['kategorie'] ?? '') ? 0 : (float)($e['kosten'] ?? 0), $entries)); ?>
      <section class="eintrag-monat">
        <h3 class="eintrag-monat-titel">
          <span><?= htmlspecialchars(formatMonat($monat, true)) ?></span>
          <span class="text-body-secondary fw-normal monat-summe" data-summe="<?= $summe ?>"><?= $euro($summe) ?></span>
        </h3>
        <ul class="list-group eintrag-gruppe mb-3">
        <?php foreach ($entries as $e):
          $art = $artVon($e);
          $type = $e['type'] ?? 'entry';
          $eEinheit = $e['einheit'] ?? null;
          $kurz = $eEinheit !== null ? einheitKurz($eEinheit) : $einheitKurz;
          $ohneKosten = istEintragOhneKosten($e['kategorie'] ?? '');
          $tachoFehlt = $type === 'fillup' && !hatEchtenTachostand($e);
          $v = $type === 'fillup' && isset($e['l_per_100km']) ? (float)$e['l_per_100km'] : null;
          $titel = getKategorieName($e['kategorie'], $fuelType, $eEinheit) . (!empty($e['standort']) ? ' · ' . $e['standort'] : '');
          $details = array_filter([
              date('d.m.', strtotime($e['datum'])),
              !empty($e['tachostand']) ? (!empty($e['tachostand_geschaetzt']) ? 'ca. ' : '') . number_format((int)$e['tachostand'], 0, ',', '.') . ' km' : '',
              $type === 'fillup' ? number_format((float)($e['menge'] ?? 0), 2, ',', '.') . ' ' . $kurz : '',
              $v !== null ? number_format($v, 2, ',', '.') . ' ' . $kurz . '/100 km' : '',
          ]);
          $editUrl = '../pages/eintrag_bearbeiten.php?id=' . urlencode($e['id']) . '&fahrzeug_id=' . urlencode($fahrzeug_id) . '&type=' . $type;
          $nachtragenUrl = '../pages/tachostand_nachtragen.php?id=' . urlencode($e['id']) . '&fahrzeug_id=' . urlencode($fahrzeug_id);
          // Geteilte Fahrzeuge (#53): Besitzer ändern alle Einträge, Mitfahrer nur eigene, Nur-Ansehen keine
          $vonAnderen = !empty($e['erfasst_von']) && (string)$e['erfasst_von'] !== $ichId;
          $darfAendern = $istBesitzer || ($darfErfassen && !$vonAnderen);
          if ($vonAnderen && !empty($e['erfasst_von_name'])) {
              $details[] = 'von ' . $e['erfasst_von_name'];
          }
          $zeilenNr++;
        ?>
          <li class="list-group-item eintrag-zeile" data-art="<?= $art ?>" data-kosten="<?= $ohneKosten ? 0 : (float)($e['kosten'] ?? 0) ?>"
              data-suche="<?= htmlspecialchars(mb_strtolower(($e['standort'] ?? '') . ' ' . ($e['beschreibung'] ?? '') . ' ' . getKategorieName($e['kategorie'], $fuelType, $eEinheit))) ?>"
              <?= $zeilenNr > $proSeite ? 'hidden data-spaeter' : '' ?>>
            <span class="eintrag-icon text-bg-<?= $farbe[$art] ?>"><i class="fas <?= getCategoryIcon($e['kategorie'], $fuelType, $eEinheit) ?>"></i></span>
            <a <?= $darfAendern ? 'href="' . htmlspecialchars($editUrl) . '"' : 'aria-disabled="true"' ?> class="eintrag-text text-reset text-decoration-none min-w-0">
              <span class="d-block fw-semibold text-truncate"><?= htmlspecialchars($titel) ?></span>
              <span class="d-block small text-body-secondary"><?= htmlspecialchars(implode(' · ', $details)) ?></span>
              <?php if (!empty($e['beschreibung']) && $type !== 'fillup'): ?><span class="d-block small text-truncate"><?= htmlspecialchars($e['beschreibung']) ?></span><?php endif; ?>
              <?php if ($tachoFehlt || ($type === 'fillup' && empty($e['vollgetankt']))): ?>
              <span class="d-flex flex-wrap gap-1 mt-1">
                <?php if ($tachoFehlt): ?><span class="badge text-bg-warning"><i class="fas fa-gauge-high me-1"></i><?= empty($e['tachostand']) ? 'Tachostand fehlt' : 'Tachostand geschätzt' ?></span><?php endif; ?>
                <?php if ($type === 'fillup' && empty($e['vollgetankt'])): ?><span class="badge text-bg-secondary"><?= begriffeFuerEinheit($fuelType, $eEinheit)['teil'] ?></span><?php endif; ?>
              </span>
              <?php endif; ?>
            </a>
            <span class="eintrag-betrag"><?= $ohneKosten ? '' : $euro($e['kosten'] ?? 0) ?></span>
            <?php if ($darfAendern): ?>
            <div class="dropdown">
              <button class="btn btn-sm btn-link text-body-secondary px-2" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Aktionen">
                <i class="fas fa-ellipsis-vertical"></i>
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="<?= htmlspecialchars($editUrl) ?>"><i class="fas fa-pen fa-fw me-2"></i>Bearbeiten</a></li>
                <?php if ($tachoFehlt): ?>
                <!-- Tachostand fehlt oder ist nur geschätzt (#41): jederzeit nachtragbar, auch nach 14 Tagen -->
                <li><a class="dropdown-item" href="<?= htmlspecialchars($nachtragenUrl) ?>"><i class="fas fa-gauge-high fa-fw me-2"></i>Tachostand nachtragen</a></li>
                <?php endif; ?>
                <li><hr class="dropdown-divider"></li>
                <li>
                  <form method="post" action="../pages/eintrag_loeschen.php" class="m-0" onsubmit="return confirm('Eintrag vom <?= htmlspecialchars(date('d.m.Y', strtotime($e['datum']))) ?> löschen?');">
                    <input type="hidden" name="id" value="<?= htmlspecialchars($e['id']) ?>">
                    <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                    <input type="hidden" name="type" value="<?= $type ?>">
                    <button class="dropdown-item text-danger"><i class="fas fa-trash fa-fw me-2"></i>Löschen</button>
                  </form>
                </li>
              </ul>
            </div>
            <?php else: ?>
            <span class="px-2" aria-hidden="true"></span>
            <?php endif; ?>
            <?php if ($tachoFehlt && $darfAendern): ?>
            <a class="visually-hidden-focusable small" href="<?= htmlspecialchars($nachtragenUrl) ?>">Nachtragen</a>
            <?php endif; ?>
          </li>
        <?php endforeach; ?>
        </ul>
      </section>
    <?php endforeach; ?>
    <div class="text-center mb-4">
      <button type="button" class="btn btn-outline-secondary" id="mehrEintraege" <?= $zeilenNr > $proSeite ? '' : 'hidden' ?>>Weitere Einträge anzeigen</button>
    </div>
    <p class="text-body-secondary text-center d-none" id="keineTreffer">Keine passenden Einträge.</p>
  <?php endif; ?>
</div>

<script>
// Filter nach Art, Suche und "Weitere anzeigen"; Monatssummen zählen nur die sichtbaren Einträge
(function () {
  var liste = document.querySelector('.eintraege-liste');
  if (!liste) return;
  var zeilen = Array.prototype.slice.call(liste.querySelectorAll('.eintrag-zeile'));
  var art = '';
  var suche = document.getElementById('eintragSuche');
  var mehr = document.getElementById('mehrEintraege');
  var proSeite = <?= $proSeite ?>;
  var grenze = proSeite;
  var euro = function (n) { return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; };

  function anwenden() {
    var text = (suche.value || '').trim().toLowerCase();
    var gefiltert = art !== '' || text !== '';
    var n = 0;
    zeilen.forEach(function (z) {
      var passt = (art === '' || z.dataset.art === art) && (text === '' || z.dataset.suche.indexOf(text) !== -1);
      if (passt) n++;
      // Beim Filtern alle Treffer zeigen, sonst nur bis zur Grenze
      z.hidden = !passt || (!gefiltert && n > grenze);
    });
    liste.querySelectorAll('.eintrag-monat').forEach(function (m) {
      var sichtbar = Array.prototype.filter.call(m.querySelectorAll('.eintrag-zeile'), function (z) { return !z.hidden; });
      m.hidden = sichtbar.length === 0;
      // Ohne Filter die Summe des ganzen Monats, mit Filter nur der Treffer
      var summe = m.querySelector('.monat-summe');
      summe.textContent = euro(gefiltert ? sichtbar.reduce(function (s, z) { return s + Number(z.dataset.kosten); }, 0) : Number(summe.dataset.summe));
    });
    if (mehr) mehr.hidden = gefiltert || n <= grenze;
    var leer = document.getElementById('keineTreffer');
    if (leer) leer.classList.toggle('d-none', n > 0);
  }
  liste.querySelectorAll('#artFilter [data-art]').forEach(function (knopf) {
    knopf.addEventListener('click', function () {
      art = knopf.dataset.art;
      liste.querySelectorAll('#artFilter [data-art]').forEach(function (k) {
        k.classList.toggle('active', k === knopf);
        k.setAttribute('aria-pressed', k === knopf ? 'true' : 'false');
      });
      anwenden();
    });
  });
  suche.addEventListener('input', anwenden);
  if (mehr) mehr.addEventListener('click', function () { grenze += proSeite; anwenden(); });
  anwenden();
})();
</script>
