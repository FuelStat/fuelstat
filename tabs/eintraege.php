<?php
// Reiter "Einträge" (#47): kompakte Liste je Monat mit Summe, Filter nach Art, Suche, Aktionen im Menü.
// Seitenweise vom Server (#160): Die API liefert Tank-/Ladevorgänge, Ausgaben und Fahrten gemischt
// (GET /vehicles/:id/timeline), gefiltert, gesucht und mit Monatssummen. Weitere Seiten, Filter und Suche lädt das
// Skript unten über pages/reiter.php nach (?nur=zeilen bzw. ?nur=liste), statt alle Einträge auf einmal zu schicken.
include_once __DIR__ . '/../includes/functions.php';
include_once __DIR__ . '/../includes/api_helpers.php';

$jahr = isset($_GET['jahr']) && $_GET['jahr'] !== '' ? (int)$_GET['jahr'] : null;
$artZuTyp = ['tanken' => 'fuel', 'laden' => 'charge', 'ausgabe' => 'expense', 'fahrt' => 'trip', 'km' => 'odometer'];
$filterArt = isset($artZuTyp[$_GET['art'] ?? '']) ? (string)$_GET['art'] : '';
$suche = mb_substr(trim((string)($_GET['q'] ?? '')), 0, 100);
$seite = max(1, (int)($_GET['seite'] ?? 1));
$nur = in_array($_GET['nur'] ?? '', ['liste', 'zeilen'], true) ? $_GET['nur'] : '';
$proSeite = 50;

$ladeFehler = false;
try {
    $liste = $api->getTimeline($fahrzeug_id, [
        'page' => $seite, 'per_page' => $proSeite, 'type' => $artZuTyp[$filterArt] ?? null, 'year' => $jahr, 'q' => $suche,
    ]);
} catch (Throwable $e) {
    $ladeFehler = true;
    $liste = ['data' => [], 'pagination' => ['has_more' => false, 'total' => 0], 'months' => [], 'years' => [], 'kinds' => []];
}
$jahrListe = $liste['years'] ?? [];
$monatsSummen = array_column($liste['months'] ?? [], 'total', 'month');
$weitere = !empty($liste['pagination']['has_more']);
$eintraege = [];
foreach ($liste['data'] ?? [] as $x) {
    $e = eintragAusTimeline($x);
    $eintraege[substr($e['datum'], 0, 7)][] = $e;
}

// Art eines Eintrags für Filter und Darstellung
$artVon = function (array $e) {
    if (($e['type'] ?? '') === 'fillup') {
        return ($e['einheit'] ?? '') === 'kwh' ? 'laden' : 'tanken';
    }
    return ['trip' => 'fahrt', 'odometer' => 'km'][kategorieFormular($e['kategorie'] ?? '')] ?? 'ausgabe';
};
// Einheiten aus den Sorten des Fahrzeugs (#140), sonst aus dem Antrieb; Sorte nur zeigen, wo es mehrere je Einheit gibt
$katalogSortenListe = sortenKatalog()['sorten'];
$einheitenJeSorte = array_map(fn($k) => $katalogSortenListe[$k]['unit'] ?? '', sortenDesFahrzeugs($fahrzeug ?? []));
$sortenJeEinheit = array_count_values(array_filter($einheitenJeSorte));
$einheitenFz = $sortenJeEinheit ? array_keys($sortenJeEinheit) : einheitenFuerKraftstoff($fuelType);
$euro = fn($v) => number_format((float)$v, 2, ',', '.') . ' €';

// Monate mit ihren Einträgen (eine Seite)
$zeigeMonate = function () use ($eintraege, $monatsSummen, $artVon, $euro, $fuelType, $einheitKurz, $sortenJeEinheit, $fahrzeug_id, $istBesitzer, $darfErfassen, $ichId) {
    foreach ($eintraege as $monat => $entries):
        $summe = (float)($monatsSummen[$monat] ?? 0); ?>
      <section class="eintrag-monat" data-monat="<?= htmlspecialchars($monat) ?>">
        <h3 class="eintrag-monat-titel">
          <span><?= htmlspecialchars(formatMonat($monat, true)) ?></span>
          <span class="monat-summe"><?= $euro($summe) ?></span>
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
        ?>
          <li class="list-group-item eintrag-zeile" data-art="<?= $art ?>">
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
                <i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="<?= htmlspecialchars($editUrl) ?>"><i class="fas fa-pen fa-fw me-2" aria-hidden="true"></i>Bearbeiten</a></li>
                <?php if ($tachoFehlt): ?>
                <!-- Tachostand fehlt oder ist nur geschätzt (#41): jederzeit nachtragbar, auch nach 14 Tagen -->
                <li><a class="dropdown-item" href="<?= htmlspecialchars($nachtragenUrl) ?>"><i class="fas fa-gauge-high fa-fw me-2" aria-hidden="true"></i>Tachostand nachtragen</a></li>
                <?php endif; ?>
                <li><hr class="dropdown-divider"></li>
                <li>
                  <form method="post" action="../pages/eintrag_loeschen.php" class="m-0" onsubmit="return confirm('Eintrag vom <?= htmlspecialchars(date('d.m.Y', strtotime($e['datum']))) ?> löschen?');">
                    <input type="hidden" name="id" value="<?= htmlspecialchars($e['id']) ?>">
                    <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                    <input type="hidden" name="type" value="<?= $type ?>">
                    <button class="dropdown-item text-danger"><i class="fas fa-trash fa-fw me-2" aria-hidden="true"></i>Löschen</button>
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
    <?php endforeach;
};

// Nur die Liste (Filter, Suche) bzw. nur weitere Zeilen (nächste Seite)
$zeigeListe = function () use ($zeigeMonate, $eintraege, $weitere, $jahr, $filterArt, $suche, $ladeFehler, $liste, $darfErfassen, $fahrzeug_id) { ?>
    <?php if ($ladeFehler): ?>
      <div class="alert alert-warning">Die Einträge konnten gerade nicht geladen werden. Bitte die Seite neu laden.</div>
    <?php elseif (empty($eintraege)): ?>
      <?php if ($filterArt !== '' || $suche !== ''): ?>
      <div class="alert alert-secondary">Keine passenden Einträge<?= $jahr !== null ? ' in ' . $jahr : '' ?>.</div>
      <?php else: ?>
      <div class="card leer-zustand mx-auto">
        <div class="card-body">
          <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-list"></i></span>
          <h2>Noch keine Einträge<?= $jahr !== null ? ' in ' . $jahr : '' ?></h2>
          <?php if ($darfErfassen): ?>
          <a href="../pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>" class="btn btn-primary mt-2">Ersten Eintrag erfassen</a>
          <?php endif; ?>
        </div>
      </div>
      <?php endif; ?>
    <?php else: ?>
      <p class="visually-hidden" aria-live="polite"><?= (int)($liste['pagination']['total'] ?? 0) ?> Einträge</p>
      <div class="eintrag-monate"><?php $zeigeMonate(); ?></div>
      <div class="text-center mb-4">
        <button type="button" class="btn btn-secondary" id="mehrEintraege" <?= $weitere ? '' : 'hidden' ?>>Weitere Einträge anzeigen</button>
      </div>
    <?php endif;
};

if ($nur === 'zeilen') {
    echo '<div data-weitere="' . ($weitere ? '1' : '0') . '">';
    $zeigeMonate();
    echo '</div>';
    return;
}
if ($nur === 'liste') {
    $zeigeListe();
    return;
}

// Filter-Chips: Arten, die das Fahrzeug haben kann bzw. die vorkommen (Zählung der API ohne Filter)
$vorhanden = $liste['kinds'] ?? [];
$filterArten = array_filter([
    'tanken' => in_array('l', $einheitenFz, true) || in_array('kg', $einheitenFz, true) || !empty($vorhanden['fuel']) ? 'Tanken' : null,
    'laden' => in_array('kwh', $einheitenFz, true) || !empty($vorhanden['charge']) ? 'Laden' : null,
    'ausgabe' => 'Ausgaben',
    'fahrt' => !empty($vorhanden['trip']) ? 'Fahrten' : null,
    'km' => !empty($vorhanden['odometer']) ? 'km-Notizen' : null,
]);
?>

<div class="mt-3 mt-lg-4 eintraege-liste" data-fahrzeug="<?= htmlspecialchars($fahrzeug_id) ?>" data-jahr="<?= $jahr ?? '' ?>">
  <!-- „Eintrag erfassen“ steckt im Plus der unteren Leiste (mobil) bzw. in der Kopfleiste (PC) -->
  <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
    <div class="such-feld flex-grow-1">
      <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
      <input type="search" class="form-control" id="eintragSuche" placeholder="Ort oder Beschreibung" aria-label="Einträge durchsuchen" value="<?= htmlspecialchars($suche) ?>">
    </div>
    <form method="get" action="fahrzeug_detail.php#eintraege" class="d-flex">
      <input type="hidden" name="id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
      <select name="jahr" class="form-select w-auto" aria-label="Jahr" onchange="this.form.submit()">
        <option value="">Alle Jahre</option>
        <?php foreach ($jahrListe as $y): ?>
        <option value="<?= (int)$y ?>" <?= $jahr === (int)$y ? 'selected' : '' ?>><?= (int)$y ?></option>
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
    <button type="button" class="chip <?= $filterArt === '' ? 'active' : '' ?>" data-art="" aria-pressed="<?= $filterArt === '' ? 'true' : 'false' ?>">Alle</button>
    <?php foreach ($filterArten as $art => $name): ?>
      <button type="button" class="chip <?= $filterArt === $art ? 'active' : '' ?>" data-art="<?= $art ?>" aria-pressed="<?= $filterArt === $art ? 'true' : 'false' ?>"><?= $name ?></button>
    <?php endforeach; ?>
  </div>

  <div id="eintragListe" aria-busy="false"><?php $zeigeListe(); ?></div>
</div>

<script>
// Filter, Suche und "Weitere anzeigen" fragen den Server (#160); die Liste ersetzt bzw. ergänzt sich mit dessen HTML
(function () {
  var bereich = document.querySelector('.eintraege-liste');
  if (!bereich) return;
  var liste = document.getElementById('eintragListe');
  var suche = document.getElementById('eintragSuche');
  var zustand = { art: <?= json_encode($filterArt) ?>, q: suche.value, seite: 1 };
  var anfrage = 0;

  function url(nur, seite) {
    var p = new URLSearchParams({ id: bereich.dataset.fahrzeug, reiter: 'eintraege', nur: nur, seite: String(seite) });
    if (bereich.dataset.jahr) p.set('jahr', bereich.dataset.jahr);
    if (zustand.art) p.set('art', zustand.art);
    if (zustand.q) p.set('q', zustand.q);
    return 'reiter.php?' + p.toString();
  }
  function holen(adresse) {
    return fetch(adresse, { credentials: 'same-origin', headers: { 'Accept': 'text/html' } }).then(function (r) {
      if (r.status === 401) { window.location.reload(); throw new Error('abgemeldet'); }
      if (!r.ok) throw new Error('Status ' + r.status);
      return r.text();
    });
  }
  function fehler() {
    liste.setAttribute('aria-busy', 'false');
    liste.insertAdjacentHTML('afterbegin', '<div class="alert alert-warning" role="alert">Das hat gerade nicht geklappt. Bitte noch einmal versuchen.</div>');
  }
  // Filter oder Suche geändert: Liste neu von Seite 1
  function neuLaden() {
    var nr = ++anfrage;
    zustand.seite = 1;
    liste.setAttribute('aria-busy', 'true');
    holen(url('liste', 1)).then(function (html) {
      if (nr !== anfrage) return; // eine neuere Anfrage läuft schon
      liste.innerHTML = html;
      liste.setAttribute('aria-busy', 'false');
      mehrKnopf();
    }).catch(fehler);
  }
  // Nächste Seite: Monate anhängen; ein Monat, der schon da ist, bekommt die neuen Zeilen dazu
  function mehrLaden(knopf) {
    knopf.disabled = true;
    holen(url('zeilen', zustand.seite + 1)).then(function (html) {
      var neu = document.createElement('div');
      neu.innerHTML = html;
      var huelle = neu.firstElementChild;
      var monate = liste.querySelector('.eintrag-monate');
      Array.prototype.forEach.call(huelle.querySelectorAll('.eintrag-monat'), function (m) {
        var da = monate.querySelector('.eintrag-monat[data-monat="' + m.dataset.monat + '"] .eintrag-gruppe');
        if (da) {
          Array.prototype.forEach.call(m.querySelectorAll('.eintrag-zeile'), function (z) { da.appendChild(z); });
        } else {
          monate.appendChild(m);
        }
      });
      zustand.seite += 1;
      knopf.hidden = huelle.dataset.weitere !== '1';
      knopf.disabled = false;
    }).catch(function () { knopf.disabled = false; fehler(); });
  }
  function mehrKnopf() {
    var knopf = document.getElementById('mehrEintraege');
    if (knopf) knopf.addEventListener('click', function () { mehrLaden(knopf); });
  }

  bereich.querySelectorAll('#artFilter [data-art]').forEach(function (knopf) {
    knopf.addEventListener('click', function () {
      zustand.art = knopf.dataset.art;
      bereich.querySelectorAll('#artFilter [data-art]').forEach(function (k) {
        k.classList.toggle('active', k === knopf);
        k.setAttribute('aria-pressed', k === knopf ? 'true' : 'false');
      });
      neuLaden();
    });
  });
  var warten;
  suche.addEventListener('input', function () {
    clearTimeout(warten);
    warten = setTimeout(function () {
      var q = suche.value.trim();
      if (q === zustand.q) return;
      zustand.q = q;
      neuLaden();
    }, 300);
  });
  mehrKnopf();
})();
</script>
