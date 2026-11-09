</div> <!-- Ende von .hauptinhalt -->
<?php require_once __DIR__ . '/version.php'; ?>

<!-- Footer -->
<footer class="bg-body-tertiary text-center text-muted py-3 mt-4">
  <small>
    &copy; <?php echo date('Y'); ?> Mario Caraggiu — 
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/impressum.php" class="text-decoration-none">Impressum</a> | 
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/datenschutz.php" class="text-decoration-none">Datenschutz</a> |
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/nutzungsbedingungen.php" class="text-decoration-none">Nutzungsbedingungen</a> |
    <button type="button" class="btn btn-link btn-sm p-0 align-baseline text-decoration-none" id="cookieHinweisOeffnen" style="font-size: inherit;">Cookie-Hinweis</button> |
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/neuigkeiten.php" class="text-decoration-none" title="Neuigkeiten">Version <?= htmlspecialchars(fuelstatVersion()) ?><span class="badge rounded-pill text-bg-primary ms-1 d-none" data-neu-version>neu</span></a>
  </small>
</footer>

<!-- Cookie-Hinweis (#33): Fuelstat nutzt nur technisch notwendige Speicherungen, daher ein Hinweis statt einer
     Einwilligungsabfrage. Kommen optionale Dienste dazu (Statistik, Karten …), braucht es hier eine echte Auswahl
     mit gleichwertigem "Ablehnen"; solche Skripte dürfen erst laden, wenn fuelstatEinwilligung.erlaubt(...) true ist. -->
<div class="cookie-hinweis" id="cookieHinweis" role="region" aria-label="Hinweis zu Cookies" hidden>
  <p class="mb-2 mb-sm-0 small">
    <i class="fas fa-cookie-bite me-1" aria-hidden="true"></i>
    Fuelstat verwendet nur technisch notwendige Cookies und Browser-Speicher, z. B. für die Anmeldung und die gewählte Darstellung – kein Tracking, keine Werbung.
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/datenschutz.php#cookies">Mehr erfahren</a>
  </p>
  <button type="button" class="btn btn-primary btn-sm flex-shrink-0" id="cookieHinweisOk">Verstanden</button>
</div>
<script>
  // Neuigkeiten (#111): Hinweis "neu", bis die aktuelle Version auf der Seite Neuigkeiten angesehen wurde.
  // Nur angemeldet und nur, wenn schon einmal eine frühere Version gesehen wurde (nicht bei der ersten Nutzung).
  (function () {
    var version = <?= json_encode(fuelstatVersion()) ?>, gesehen = null;
    try { gesehen = localStorage.getItem('fuelstat-version-gesehen'); } catch (e) { return; }
    if (gesehen === null) { try { localStorage.setItem('fuelstat-version-gesehen', version); } catch (e) {} return; }
    if (gesehen === version) return;
    document.querySelectorAll('[data-neu-version]').forEach(function (el) { el.classList.remove('d-none'); });
  })();
  window.fuelstatEinwilligung = {
    // Bisher gibt es keine optionalen Dienste: alles außer "notwendig" ist nicht erlaubt
    erlaubt: function (kategorie) { return kategorie === 'notwendig'; }
  };
  (function () {
    var KEY = 'fuelstat-cookie-hinweis';
    var leiste = document.getElementById('cookieHinweis');
    var ok = document.getElementById('cookieHinweisOk');
    var gesehen = false;
    try { gesehen = localStorage.getItem(KEY) === '1'; } catch (e) { /* privater Modus: Hinweis zeigen */ }
    function zeige() { leiste.hidden = false; ok.focus({ preventScroll: true }); }
    if (!gesehen) leiste.hidden = false;
    ok.addEventListener('click', function () {
      leiste.hidden = true;
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* nicht speicherbar: beim nächsten Aufruf wieder */ }
    });
    document.getElementById('cookieHinweisOeffnen').addEventListener('click', zeige);
    leiste.addEventListener('keydown', function (e) { if (e.key === 'Escape') ok.click(); });
  })();
</script>

<!-- Bootstrap JS -->
<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'vendor/bootstrap/bootstrap.bundle.min.js')) ?>"></script>

<!-- Custom JS -->
<script src="<?php echo htmlspecialchars($baseUrl); ?>js/script.js?v=<?= @filemtime(__DIR__ . '/../js/script.js') ?: 1 ?>"></script>
<script src="<?php echo htmlspecialchars($baseUrl); ?>js/ziehen-neu-laden.js?v=<?= @filemtime(__DIR__ . '/../js/ziehen-neu-laden.js') ?: 1 ?>"></script>

<!-- CSRF-Token in alle POST-Formulare einfügen (wird in includes/session.php geprüft) -->
<script>
  document.querySelectorAll('form').forEach(function (form) {
    if ((form.getAttribute('method') || '').toLowerCase() !== 'post' || form.querySelector('input[name="csrf_token"]')) return;
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'csrf_token';
    input.value = <?= json_encode(function_exists('csrfToken') ? csrfToken() : '') ?>;
    form.appendChild(input);
  });
</script>

<!-- Darkmode-Umschalter und Diagrammfarben -->
<script>
  (function () {
    var root = document.documentElement;
    var toggles = document.querySelectorAll('.theme-umschalter');
    var themeMeta = document.querySelector('meta[name="theme-color"]');

    function applyChartTheme() {
      if (!window.Chart) return;
      var css = getComputedStyle(root);
      var text = css.getPropertyValue('--bs-body-color').trim();
      var grid = css.getPropertyValue('--bs-border-color-translucent').trim();
      Chart.defaults.color = text;
      Chart.defaults.borderColor = grid;
      Object.values(Chart.instances || {}).forEach(function (chart) {
        Object.values(chart.options.scales || {}).forEach(function (scale) {
          if (scale.ticks) scale.ticks.color = text;
          if (scale.grid) scale.grid.color = grid;
        });
        if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
          chart.options.plugins.legend.labels.color = text;
        }
        chart.update('none');
      });
    }

    function updateIcon() {
      var dark = root.getAttribute('data-bs-theme') === 'dark';
      if (themeMeta) themeMeta.setAttribute('content', dark ? '#2b3035' : '#f8f9fa');
      toggles.forEach(function (toggle) {
        var icon = toggle.querySelector('i');
        icon.classList.toggle('fa-sun', dark);
        icon.classList.toggle('fa-moon', !dark);
        toggle.title = dark ? 'Hell darstellen' : 'Dunkel darstellen';
        var text = toggle.querySelector('.theme-text');
        if (text) text.textContent = dark ? 'Helle Darstellung' : 'Dunkle Darstellung';
      });
    }

    toggles.forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var next = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-bs-theme', next);
        try { localStorage.setItem('fuelstat-theme', next); } catch (e) {}
        updateIcon();
        applyChartTheme();
      });
    });

    updateIcon();
    applyChartTheme();
  })();
</script>

<!-- Mobil: Fahrzeug-Blatt öffnet je nach Knopf Details, neuen Eintrag oder Statistik -->
<script>
  (function () {
    var blatt = document.getElementById('blattFahrzeuge');
    if (!blatt) return;
    var titel = {details: 'Meine Fahrzeuge', eintrag: 'Eintrag für welches Fahrzeug?', statistik: 'Statistik für welches Fahrzeug?'};
    blatt.addEventListener('show.bs.offcanvas', function (event) {
      var aktion = (event.relatedTarget && event.relatedTarget.dataset.aktion) || 'details';
      document.getElementById('blattFahrzeugeTitel').textContent = titel[aktion] || titel.details;
      blatt.querySelectorAll('.blatt-fahrzeug').forEach(function (link) {
        link.href = link.dataset[aktion] || link.dataset.details;
      });
      var neu = blatt.querySelector('.blatt-neu');
      if (neu) neu.classList.toggle('d-none', aktion !== 'details');
    });
    // Link auf dieselbe Seite mit anderem #Reiter: Blatt trotzdem schließen
    blatt.addEventListener('click', function (event) {
      if (event.target.closest('a')) bootstrap.Offcanvas.getOrCreateInstance(blatt).hide();
    });
  })();
</script>

<!-- Offline (#1): Der Service Worker zeigt ohne Verbindung den zuletzt geladenen Stand der Übersicht bzw. Fahrzeugseite
     und setzt data-offline-stand am <html>. Hier der Hinweis dazu; Formulare sind offline gesperrt. -->
<script>
  (function () {
    var stand = document.documentElement.getAttribute('data-offline-stand');
    if (!stand) return;
    var zeit = new Date(stand);
    var text = isNaN(zeit) ? '' : ' vom ' + zeit.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
    var hinweis = document.createElement('div');
    hinweis.className = 'alert alert-warning d-flex align-items-center gap-2 mb-3';
    hinweis.setAttribute('role', 'status');
    hinweis.innerHTML = '<i class="fas fa-wifi" aria-hidden="true"></i><span class="flex-grow-1"></span>'
      + '<button type="button" class="btn btn-sm btn-outline-dark d-none">Neu laden</button>';
    hinweis.querySelector('span').textContent = 'Offline: Du siehst den zuletzt geladenen Stand' + text + '. Ändern geht erst wieder mit Verbindung.';
    var neuLaden = hinweis.querySelector('button');
    neuLaden.addEventListener('click', function () { location.reload(); });
    var ziel = document.querySelector('.hauptinhalt') || document.body;
    ziel.insertBefore(hinweis, ziel.firstChild);
    window.addEventListener('online', function () { neuLaden.classList.remove('d-none'); });
    document.addEventListener('submit', function (event) {
      event.preventDefault();
      alert('Offline kann nichts gespeichert werden. Bitte mit Verbindung neu laden.');
    }, true);
  })();
</script>

<!-- Service Worker for PWA -->
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('<?php echo htmlspecialchars($baseUrl); ?>service-worker.js', { scope: '<?php echo htmlspecialchars($basePath === '/' ? '/' : $basePath . '/'); ?>' }).then(registration => {
        console.log('Service Worker registriert mit Scope: ', registration.scope);
      }, err => {
        console.log('Service Worker Registrierung fehlgeschlagen: ', err);
      });
		// Alte Registrierungen unter /js/ bereinigen
		navigator.serviceWorker.getRegistrations && navigator.serviceWorker.getRegistrations().then(registrations => {
			registrations.forEach(reg => {
				const sw = reg.active || reg.installing || reg.waiting;
				const scriptURL = sw && sw.scriptURL ? sw.scriptURL : '';
				if (scriptURL.endsWith('/js/service-worker.js')) {
					reg.unregister();
				}
			});
		});
    });
  }
</script>

</body>
</html>
