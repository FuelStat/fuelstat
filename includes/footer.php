</div> <!-- Ende von .hauptinhalt -->
<?php require_once __DIR__ . '/version.php'; ?>

<!-- Footer -->
<footer class="seitenfuss">
  &copy; <?php echo date('Y'); ?> Mario Caraggiu
  <span class="seitenfuss-links">
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/impressum.php">Impressum</a>
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/datenschutz.php">Datenschutz</a>
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/nutzungsbedingungen.php">Nutzungsbedingungen</a>
    <button type="button" class="btn btn-link" id="cookieHinweisOeffnen">Cookie-Hinweis</button>
    <a href="<?php echo htmlspecialchars($baseUrl); ?>pages/neuigkeiten.php" title="Neuigkeiten">Version <?= htmlspecialchars(fuelstatVersion()) ?><span class="badge text-bg-primary ms-1 d-none" data-neu-version>neu</span></a>
  </span>
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
  // Nachgeladene Inhalte (Reiter der Fahrzeugseite, #160): Token beim Absenden ergänzen
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement) || (form.getAttribute('method') || '').toLowerCase() !== 'post' || form.querySelector('input[name="csrf_token"]')) return;
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'csrf_token';
    input.value = <?= json_encode(function_exists('csrfToken') ? csrfToken() : '') ?>;
    form.appendChild(input);
  }, true);
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
      // Achsenbeschriftung in TextSecondary, Achsen und Gitter in Separator (docs/design.md 3.6)
      var text = css.getPropertyValue('--fs-text-secondary').trim();
      var grid = css.getPropertyValue('--fs-separator').trim();
      Chart.defaults.font.family = css.getPropertyValue('--bs-body-font-family').trim() || Chart.defaults.font.family;
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
      if (themeMeta) themeMeta.setAttribute('content', dark ? '#0E1624' : '#F2F6F8');
      toggles.forEach(function (toggle) {
        var icon = toggle.querySelector('i');
        icon.classList.toggle('fa-sun', dark);
        icon.classList.toggle('fa-moon', !dark);
        var tipp = dark ? 'Hell darstellen' : 'Dunkel darstellen';
        toggle.setAttribute('aria-label', tipp);
        if (toggle.hasAttribute('data-tipp')) {
          toggle.setAttribute('data-tipp', tipp);
          var t = window.bootstrap && bootstrap.Tooltip.getInstance(toggle);
          if (t) t.setContent({ '.tooltip-inner': tipp });
        } else {
          toggle.title = tipp;
        }
        var text = toggle.querySelector('.theme-text');
        if (text) text.textContent = dark ? 'Helle Darstellung' : 'Dunkle Darstellung';
      });
    }

    toggles.forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var next = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-bs-theme', next);
        try { localStorage.setItem('fuelstat-theme', next); } catch (e) {}
        // Diagramme haben ihre Reihenfarben beim Zeichnen aus den Tokens gelesen: mit neuen Farben neu aufbauen
        if (window.Chart && Object.keys(Chart.instances || {}).length) { location.reload(); return; }
        updateIcon();
        applyChartTheme();
      });
    });

    // Kopfleiste: Tooltips für die Symbole (#145) und Trennlinie, sobald gescrollt ist
    if (window.bootstrap && window.matchMedia('(hover: hover)').matches) {
      document.querySelectorAll('[data-tipp]').forEach(function (el) {
        new bootstrap.Tooltip(el, { title: function () { return el.getAttribute('data-tipp'); }, placement: 'bottom', trigger: 'hover focus', delay: { show: 300, hide: 0 } });
      });
    }
    var kopf = document.querySelector('.kopfleiste');
    if (kopf) {
      var gescrollt = function () { kopf.classList.toggle('gescrollt', window.scrollY > 4); };
      window.addEventListener('scroll', gescrollt, { passive: true });
      gescrollt();
    }

    updateIcon();
    applyChartTheme();
    // Für Diagramme in nachgeladenen Reitern (#160)
    window.fuelstatDiagrammFarben = applyChartTheme;
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
      + '<button type="button" class="btn btn-sm btn-primary d-none">Neu laden</button>';
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
  // Zahl auf dem App-Symbol (Push, #136) gilt als gesehen, sobald die App offen ist
  if ('clearAppBadge' in navigator && document.visibilityState === 'visible') {
    navigator.clearAppBadge().catch(function () {});
  }
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
