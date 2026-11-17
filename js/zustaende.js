// Zustände beim Nachladen (#211, docs/design.md 8.1): Platzhalter statt Spinner, Fehler im Klartext mit „Erneut
// versuchen“, Ladezustand am Knopf. Wird im <head> geladen, damit Skripte in den Seiten es sofort nutzen können.
(function () {
  var TEXT_OFFLINE = 'Keine Verbindung. Prüfe dein Netz und versuche es erneut.';
  var TEXT_SPAETER = 'Das hat gerade nicht geklappt. Versuche es gleich noch einmal.';

  // HTML vom eigenen Server holen. Abgemeldet (401): Seite neu laden, dann leitet sie zur Anmeldung.
  function holen(adresse) {
    return fetch(adresse, { credentials: 'same-origin', headers: { 'Accept': 'text/html' } }).then(function (r) {
      if (r.status === 401) { window.location.reload(); throw new Error('abgemeldet'); }
      if (!r.ok) throw new Error('status');
      return r.text();
    });
  }

  // Ohne Netz meldet fetch einen TypeError; dann zählt navigator.onLine
  function fehlerText(fehler) {
    return (navigator.onLine === false || (fehler && fehler.name === 'TypeError')) ? TEXT_OFFLINE : TEXT_SPAETER;
  }

  // Meldung mit „Erneut versuchen“ an den Anfang von ziel (bzw. vor ziel mit vor=true); eine alte Meldung dort geht weg
  function fehler(ziel, err, nochmal, vor) {
    var alt = (vor ? ziel.parentNode : ziel).querySelector(':scope > .zustand-fehler');
    if (alt) alt.remove();
    var box = document.createElement('div');
    box.className = 'alert alert-warning zustand-fehler';
    box.setAttribute('role', 'alert');
    var text = document.createElement('span');
    text.textContent = fehlerText(err);
    box.appendChild(text);
    if (nochmal) {
      var knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'btn btn-secondary btn-sm';
      knopf.textContent = 'Erneut versuchen';
      knopf.addEventListener('click', function () { box.remove(); nochmal(); });
      box.appendChild(knopf);
    }
    if (vor) ziel.parentNode.insertBefore(box, ziel); else ziel.insertBefore(box, ziel.firstChild);
    return box;
  }

  // Platzhalter in Listenhöhe, erst nach 300 ms (schnelle Antworten flackern nicht). Rückgabe: Funktion zum Beenden.
  // Ein neues Laden auf demselben Ziel beendet das vorige (sonst überschreibt dessen Uhr die neue Liste).
  function laden(ziel, zeilen) {
    if (ziel.fsLadenEnde) ziel.fsLadenEnde();
    ziel.setAttribute('aria-busy', 'true');
    var hoehe = ziel.offsetHeight;
    var uhr = setTimeout(function () {
      var html = '<div class="platzhalter-liste" aria-hidden="true">';
      for (var i = 0; i < (zeilen || 6); i++) html += '<div class="platzhalter-zeile"><span></span><span></span></div>';
      ziel.style.minHeight = Math.min(hoehe, window.innerHeight) + 'px';
      ziel.innerHTML = html + '</div><span class="visually-hidden">Wird geladen …</span>';
    }, 300);
    var ende = function () {
      clearTimeout(uhr);
      ziel.style.minHeight = '';
      ziel.setAttribute('aria-busy', 'false');
      if (ziel.fsLadenEnde === ende) ziel.fsLadenEnde = null;
    };
    ziel.fsLadenEnde = ende;
    return ende;
  }

  // Ladezustand am Knopf: belegt, mit kleinem Kreis, Text bleibt
  function knopfLaedt(knopf, an) {
    knopf.disabled = an;
    knopf.classList.toggle('knopf-laedt', an);
    if (an) knopf.setAttribute('aria-busy', 'true'); else knopf.removeAttribute('aria-busy');
  }

  window.fsZustand = { holen: holen, fehler: fehler, fehlerText: fehlerText, laden: laden, knopfLaedt: knopfLaedt };
})();
