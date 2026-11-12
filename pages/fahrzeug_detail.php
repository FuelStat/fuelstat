<?php
include '../includes/session.php';
include '../includes/header.php';
include '../includes/functions.php';

if (!isset($_GET['id'])) {
    die("Fahrzeug-ID fehlt.");
}
$fahrzeug_id = $_GET['id'];

try {
    $fahrzeug = $api->getVehicle($fahrzeug_id);
} catch (Throwable $e) {
    die("Fahrzeug nicht gefunden.");
}

include '../includes/fahrzeug_kontext.php';
?>

<div class="container mt-lg-3">
    <!-- Der Name steht sichtbar im Foto (Allgemein), in der Kopfleiste (mobil) und im Fahrzeugwechsler (PC) -->
    <h1 class="visually-hidden"><?= htmlspecialchars($fahrzeug['name'] ?? 'Fahrzeug') ?></h1>
    <?php if (!$istBesitzer): ?>
    <p class="fs-label mt-2 mb-2"><i class="fas fa-users me-1" aria-hidden="true"></i>Geteilt von <?= htmlspecialchars((string)($fahrzeug['owner_name'] ?? '')) ?> · <?= $rolle === 'editor' ? 'du kannst Einträge erfassen' : 'nur ansehen' ?></p>
    <?php endif; ?>

    <!-- Reiter: am PC Tabs, mobil wischbare Leiste, die unter der Kopfleiste stehen bleibt -->
    <ul class="nav nav-tabs fahrzeug-reiter no-swipe" id="fahrzeugTabs" role="tablist">
        <li class="nav-item" role="presentation"><a class="nav-link" id="allgemein-tab" data-bs-toggle="tab" data-bs-target="#reiter-allgemein" href="#allgemein" role="tab">Allgemein</a></li>
        <li class="nav-item" role="presentation"><a class="nav-link" id="eintraege-tab" data-bs-toggle="tab" data-bs-target="#reiter-eintraege" href="#eintraege" role="tab">Einträge</a></li>
        <li class="nav-item" role="presentation"><a class="nav-link" id="statistiken-tab" data-bs-toggle="tab" data-bs-target="#reiter-statistiken" href="#statistiken" role="tab">Statistiken</a></li>
        <li class="nav-item" role="presentation"><a class="nav-link" id="ausgaben-tab" data-bs-toggle="tab" data-bs-target="#reiter-ausgaben" href="#ausgaben" role="tab">Ausgaben</a></li>
        <li class="nav-item" role="presentation"><a class="nav-link" id="fahrten-tab" data-bs-toggle="tab" data-bs-target="#reiter-fahrten" href="#fahrten" role="tab">Fahrten</a></li>
        <li class="nav-item" role="presentation"><a class="nav-link" id="einstellungen-tab" data-bs-toggle="tab" data-bs-target="#reiter-einstellungen" href="#einstellungen" role="tab">Einstellungen</a></li>
    </ul>

    <!-- Tab Inhalte. IDs mit "reiter-", damit #eintraege usw. in der Adresse keinen Sprung des Browsers auslösen:
         sonst steht die Seite nach dem Laden ein Stück gescrollt, und iOS zeichnet Kopf- und App-Leiste weich (#97) -->
    <div class="tab-content" id="fahrzeugTabsContent">
        <div class="tab-pane fade" id="reiter-allgemein" role="tabpanel"><?php include '../tabs/allgemein.php'; ?></div>
        <?php // Die übrigen Reiter lädt die Seite erst beim Öffnen (pages/reiter.php, #160): sonst käme bei vielen
              // Einträgen alles auf einmal (mehrere MB HTML) ?>
        <?php foreach (['eintraege', 'statistiken', 'ausgaben', 'fahrten', 'einstellungen'] as $reiterName): ?>
        <div class="tab-pane fade" id="reiter-<?= $reiterName ?>" role="tabpanel" data-reiter="<?= $reiterName ?>">
            <div class="reiter-laden text-center text-body-secondary py-5" role="status">
                <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Wird geladen …
            </div>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'js/reiter-wischen.js')) ?>"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var reiter = document.getElementById('fahrzeugTabs');

  // Reiter nachladen (#160): Inhalt von reiter.php einsetzen und seine Skripte der Reihe nach ausführen
  // (per innerHTML eingefügte Skripte laufen sonst nicht). Externe Skripte wie Chart.js nur einmal laden.
  var geladeneSkripte = new Set(Array.prototype.map.call(document.querySelectorAll('script[src]'), function (s) { return s.src.split('?')[0]; }));
  function skripteAusfuehren(bereich) {
    var kette = Promise.resolve();
    Array.prototype.forEach.call(bereich.querySelectorAll('script'), function (alt) {
      kette = kette.then(function () {
        var quelle = alt.src ? alt.src.split('?')[0] : '';
        if (quelle && geladeneSkripte.has(quelle)) { alt.remove(); return; }
        return new Promise(function (fertig) {
          var neu = document.createElement('script');
          Array.prototype.forEach.call(alt.attributes, function (a) { neu.setAttribute(a.name, a.value); });
          neu.textContent = alt.textContent;
          if (quelle) {
            geladeneSkripte.add(quelle);
            neu.onload = fertig;
            neu.onerror = fertig;
          }
          alt.replaceWith(neu);
          if (!quelle) fertig();
        });
      });
    });
    return kette;
  }
  function ladeReiter(pane) {
    if (!pane || !pane.dataset.reiter || pane.dataset.geladen) return;
    pane.dataset.geladen = '1';
    var parameter = new URLSearchParams(window.location.search);
    parameter.set('reiter', pane.dataset.reiter);
    fetch('reiter.php?' + parameter.toString(), { credentials: 'same-origin', headers: { 'Accept': 'text/html' } })
      .then(function (antwort) {
        // Abgemeldet: Seite neu laden, die leitet zur Anmeldung
        if (antwort.status === 401) { window.location.reload(); throw new Error('abgemeldet'); }
        if (!antwort.ok) throw new Error('Status ' + antwort.status);
        return antwort.text();
      })
      .then(function (html) {
        pane.innerHTML = html;
        return skripteAusfuehren(pane);
      })
      .then(function () {
        if (window.fuelstatDiagrammFarben) window.fuelstatDiagrammFarben();
        pane.dispatchEvent(new CustomEvent('reiter-geladen', { bubbles: true }));
      })
      .catch(function () {
        delete pane.dataset.geladen;
        pane.innerHTML = '<div class="alert alert-warning mt-3" role="alert">Dieser Bereich konnte nicht geladen werden. '
          + '<button type="button" class="btn btn-link alert-link p-0 align-baseline">Erneut versuchen</button></div>';
        pane.querySelector('button').addEventListener('click', function () { ladeReiter(pane); });
      });
  }

  function zeige(hash) {
    var link = reiter.querySelector('.nav-link[href="' + hash + '"]') || reiter.querySelector('.nav-link[href="#allgemein"]');
    bootstrap.Tab.getOrCreateInstance(link).show();
  }

  // Reiter öffnen (Antippen und Wischen): kein Springen zum Anker, aber Hash setzen, damit Neuladen und Zurück funktionieren
  function oeffne(link) {
    bootstrap.Tab.getOrCreateInstance(link).show();
    history.replaceState(null, '', link.getAttribute('href'));
  }

  reiter.querySelectorAll('.nav-link').forEach(function (link) {
    link.addEventListener('show.bs.tab', function () { ladeReiter(document.querySelector(link.getAttribute('data-bs-target'))); });
    link.addEventListener('click', function (e) {
      e.preventDefault();
      oeffne(link);
    });

    link.addEventListener('shown.bs.tab', function () {
      // Aktiven Reiter mobil in die Mitte der Leiste schieben
      reiter.scrollTo({left: link.offsetLeft - (reiter.clientWidth - link.offsetWidth) / 2, behavior: 'smooth'});
      // War die Seite weit nach unten gescrollt, zum Anfang des neuen Reiters springen (nicht beim Laden der Seite).
      // Maßstab ist die tatsächliche Höhe der Kopfleiste (inkl. Notch-Abstand), nicht der CSS-Wert.
      // (shown.bs.tab kommt nach der Überblendung, daher wird die Markierung erst hier verbraucht)
      if (ersterAufruf) {
        ersterAufruf = false;
      } else {
        var kopf = document.querySelector('.kopfleiste');
        // Bezug ist der (nicht klebende) Container der Reiter; bei Abständen unter 24 px ganz nach oben
        var oben = reiter.parentElement.getBoundingClientRect().top + window.scrollY - (kopf ? kopf.offsetHeight : 0);
        if (oben < 24) oben = 0;
        if (window.scrollY > oben + 1) window.scrollTo(0, oben);
      }
      // Untere Leiste: "Statistik" oder "Fahrzeuge" hervorheben
      var statistik = link.getAttribute('href') === '#statistiken';
      var tabStatistik = document.getElementById('tabbarStatistik');
      var tabFahrzeuge = document.getElementById('tabbarFahrzeuge');
      if (tabStatistik) tabStatistik.classList.toggle('active', statistik);
      var kopfStatistik = document.getElementById('kopfStatistik');
      if (kopfStatistik) kopfStatistik.classList.toggle('active', statistik);
      if (tabFahrzeuge) tabFahrzeuge.classList.toggle('active', !statistik);
      // Nach einem Wischen den neuen Inhalt aus der Wischrichtung einblenden
      var inhalt = document.querySelector('.hauptinhalt') || document.getElementById('fahrzeugTabsContent');
      var richtung = inhalt.dataset.wischRichtung;
      if (richtung) {
        delete inhalt.dataset.wischRichtung;
        var pane = document.querySelector(link.getAttribute('data-bs-target'));
        pane.classList.remove('wisch-vor', 'wisch-zurueck');
        void pane.offsetWidth;
        pane.classList.add(richtung === 'vor' ? 'wisch-vor' : 'wisch-zurueck');
      }
    });
  });

  // Mobil: zwischen den Reitern wischen (#88), Desktop unverändert
  // Ganzer Hauptbereich der Seite, damit auch unter kurzen Inhalten gewischt werden kann
  reiterWischen({ reiter: reiter, bereich: document.querySelector('.hauptinhalt') || document.getElementById('fahrzeugTabsContent'), wechsel: oeffne });

  var ersterAufruf = true;
  zeige(window.location.hash || '#allgemein');
  // z. B. "Statistik" in der unteren Leiste, während diese Seite schon offen ist
  window.addEventListener('hashchange', function () { zeige(window.location.hash); });
});
</script>

<?php include '../includes/footer.php'; ?>
