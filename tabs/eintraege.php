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
// Einheiten aus den Sorten des Fahrzeugs (#140), sonst aus dem Antrieb; Sorte nur zeigen, wo es mehrere je Einheit gibt
$katalogSortenListe = sortenKatalog()['sorten'];
$einheitenJeSorte = array_map(fn($k) => $katalogSortenListe[$k]['unit'] ?? '', sortenDesFahrzeugs($fahrzeug ?? []));
$sortenJeEinheit = array_count_values(array_filter($einheitenJeSorte));
$einheitenFz = $sortenJeEinheit ? array_keys($sortenJeEinheit) : einheitenFuerKraftstoff($fuelType);
$filterArten = array_filter([
    'tanken' => in_array('l', $einheitenFz, true) || in_array('kg', $einheitenFz, true) || isset($vorhandeneArten['tanken']) ? 'Tanken' : null,
    'laden' => in_array('kwh', $einheitenFz, true) || isset($vorhandeneArten['laden']) ? 'Laden' : null,
    'ausgabe' => 'Ausgaben',
    'fahrt' => isset($vorhandeneArten['fahrt']) ? 'Fahrten' : null,
    'km' => isset($vorhandeneArten['km']) ? 'km-Notizen' : null,
]);
$euro = fn($v) => number_format((float)$v, 2, ',', '.') . ' €';
$proSeite = 40;
$zeilenNr = 0;
?>

<div class="mt-3 mt-lg-4 eintraege-liste">
  <!-- „Eintrag erfassen“ steckt im Plus der unteren Leiste (mobil) bzw. in der Kopfleiste (PC) -->
  <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
    <div class="such-feld flex-grow-1">
      <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
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
    <div class="dropdown flex-shrink-0">
      <button type="button" class="btn btn-secondary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
        <i class="fas fa-arrow-right-arrow-left" aria-hidden="true"></i><span class="d-none d-sm-inline">Export und Import</span><span class="d-sm-none visually-hidden">Export und Import</span>
      </button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li><a class="dropdown-item" download href="../pages/export.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?><?= $jahr !== null ? '&jahr=' . $jahr : '' ?>"><i class="fas fa-file-csv fa-fw" aria-hidden="true"></i>Als CSV für Excel herunterladen</a></li>
        <li><a class="dropdown-item" href="../pages/bericht.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?><?= $jahr !== null ? '&jahr=' . $jahr : '' ?>" target="_blank"><i class="fas fa-file-pdf fa-fw" aria-hidden="true"></i>Bericht drucken oder als PDF speichern</a></li>
        <?php if ($istBesitzer): ?>
        <li><hr class="dropdown-divider"></li>
        <li><a class="dropdown-item" href="../pages/import.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>"><i class="fas fa-file-import fa-fw" aria-hidden="true"></i>Einträge aus CSV-Datei importieren</a></li>
        <?php endif; ?>
      </ul>
    </div>
  </div>

  <!-- Filter nach Art -->
  <div class="chip-leiste mb-3" role="group" aria-label="Nach Art filtern" id="artFilter">
    <button type="button" class="chip active" data-art="" aria-pressed="true">Alle</button>
    <?php foreach ($filterArten as $art => $name): ?>
      <button type="button" class="chip" data-art="<?= $art ?>" aria-pressed="false"><?= $name ?></button>
    <?php endforeach; ?>
  </div>

  <?php if (empty($eintraege)): ?>
    <div class="card leer-zustand mx-auto">
      <div class="card-body">
        <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-list"></i></span>
        <h2>Noch keine Einträge<?= $jahr !== null ? ' in ' . $jahr : '' ?></h2>
        <?php if ($darfErfassen): ?>
        <a href="../pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-primary mt-2">Ersten Eintrag erfassen</a>
        <?php endif; ?>
      </div>
    </div>
  <?php else: ?>
    <?php foreach ($eintraege as $monat => $entries):
      $summe = array_sum(array_map(fn($e) => istEintragOhneKosten($e['kategorie'] ?? '') ? 0 : (float)($e['kosten'] ?? 0), $entries)); ?>
      <section class="eintrag-monat">
        <h3 class="eintrag-monat-titel">
          <span><?= htmlspecialchars(formatMonat($monat, true)) ?></span>
          <span class="monat-summe" data-summe="<?= $summe ?>"><?= $euro($summe) ?></span>
        </h3>
        <ul class="list-group eintrag-gruppe">
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
              $type === 'fillup' && !empty($e['sorte']) && ($sortenJeEinheit[$eEinheit] ?? 0) > 1 ? sortenName($e['sorte']) : '',
              $v !== null ? number_format($v, 2, ',', '.') . ' ' . $kurz . '/100 km' : '',
          ]);
          $editUrl = $type === 'trip'
              ? '../pages/fahrt.php?id=' . urlencode($e['id']) . '&fahrzeug_id=' . urlencode($fahrzeug_id)
              : '../pages/eintrag_bearbeiten.php?id=' . urlencode($e['id']) . '&fahrzeug_id=' . urlencode($fahrzeug_id) . '&type=' . $type;
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
            <?php
            // Tanken/Laden in der Energiefarbe, Fahrten nach Zweck, km-Notiz neutral, Ausgaben in der Kategoriefarbe der API
            $symbolFarbe = match ($art) {
                'tanken', 'laden' => energieFarbe($fuelType, $eEinheit, $e['sorte'] ?? null),
                'fahrt' => fahrtFarbe($e['zweck'] ?? null),
                'km' => 'var(--fs-purpose-odometer)',
                default => getKategorieFarbe($e['kategorie'] ?? null),
            };
            echo symbolKreis(getCategoryIcon($e['kategorie'], $fuelType, $eEinheit), $symbolFarbe); ?>
            <a <?= $darfAendern ? 'href="' . htmlspecialchars($editUrl) . '"' : 'aria-disabled="true"' ?> class="eintrag-text text-reset text-decoration-none min-w-0">
              <span class="d-block fs-headline text-truncate"><?= htmlspecialchars($titel) ?></span>
              <span class="d-block fs-label"><?= htmlspecialchars(implode(' · ', $details)) ?></span>
              <?php if (!empty($e['beschreibung']) && $type !== 'fillup'): ?><span class="d-block fs-label text-truncate"><?= htmlspecialchars($e['beschreibung']) ?></span><?php endif; ?>
              <?php if ($tachoFehlt || ($type === 'fillup' && empty($e['vollgetankt']))): ?>
              <span class="d-flex flex-wrap gap-1 mt-1">
                <?php if ($tachoFehlt): ?><span class="badge text-bg-warning"><i class="fas fa-gauge-high" aria-hidden="true"></i><?= empty($e['tachostand']) ? 'Tachostand fehlt' : 'Tachostand geschätzt' ?></span><?php endif; ?>
                <?php if ($type === 'fillup' && empty($e['vollgetankt'])): ?><span class="badge text-bg-secondary"><?= begriffeFuerEinheit($fuelType, $eEinheit)['teil'] ?></span><?php endif; ?>
              </span>
              <?php endif; ?>
            </a>
            <span class="eintrag-betrag"><?= $ohneKosten ? '' : $euro($e['kosten'] ?? 0) ?></span>
            <?php if ($darfAendern): ?>
            <div class="dropdown">
              <button class="kopf-symbol" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Aktionen für diesen Eintrag">
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
            <span class="px-1" aria-hidden="true"></span>
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
      <button type="button" class="btn btn-secondary" id="mehrEintraege" <?= $zeilenNr > $proSeite ? '' : 'hidden' ?>>Weitere Einträge anzeigen</button>
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
