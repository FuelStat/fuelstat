<?php
// Warnung bei unplausiblem Tachostand (Formulare „Eintrag erfassen“ und „Eintrag bearbeiten“).
// Erwartet: $api, $fahrzeug_id; optional $tachoAusnahmeId (der gerade bearbeitete Eintrag)
// und $tachoAnschaffung (Tachostand bei Anschaffung).
// Die Warnung blockiert nicht: Beim Speichern wird nur einmal nachgefragt (z. B. nach einem Tachotausch).

$tachoWerte = [];
foreach (getMergedEintraegeFromApi($api, $fahrzeug_id)['eintraege'] as $monatsEintraege) {
    foreach ($monatsEintraege as $e) {
        if ((int)($e['tachostand'] ?? 0) > 0 && empty($e['tachostand_geschaetzt']) && !empty($e['datum']) && (string)$e['id'] !== (string)($tachoAusnahmeId ?? '')) {
            $tachoWerte[] = ['d' => $e['datum'], 'km' => (int)$e['tachostand']];
        }
    }
}
?>
<script>
(function () {
  var werte = <?= json_encode($tachoWerte) ?>;
  var anschaffung = <?= json_encode(isset($tachoAnschaffung) && (int)$tachoAnschaffung > 0 ? (int)$tachoAnschaffung : null) ?>;
  var feld = document.querySelector('input[name="tachostand"]');
  var datumFeld = feld && feld.form ? feld.form.querySelector('input[name="datum"]') : null;
  if (!feld || !datumFeld) return;

  var hinweis = document.createElement('div');
  hinweis.className = 'form-text text-warning-emphasis d-none';
  hinweis.setAttribute('role', 'status');
  feld.insertAdjacentElement('afterend', hinweis);

  var km = function (n) { return Number(n).toLocaleString('de-DE') + ' km'; };
  var datum = function (d) { return d.split('-').reverse().join('.'); };
  var tage = function (von, bis) { return Math.round((new Date(bis) - new Date(von)) / 86400000); };

  // Liefert den Warntext oder null
  function pruefe() {
    var wert = parseInt(feld.value, 10);
    var d = datumFeld.value;
    if (!wert || !d) return null;
    var vorher = null, nachher = null;
    werte.forEach(function (w) {
      if (w.d < d && (!vorher || w.km > vorher.km)) vorher = w;
      if (w.d > d && (!nachher || w.km < nachher.km)) nachher = w;
    });
    if (vorher && wert < vorher.km) {
      return 'Niedriger als der Tachostand vom ' + datum(vorher.d) + ' (' + km(vorher.km) + '). Tippfehler?';
    }
    if (nachher && wert > nachher.km) {
      return 'Höher als der Tachostand vom ' + datum(nachher.d) + ' (' + km(nachher.km) + '). Stimmt das Datum?';
    }
    if (vorher) {
      var diff = wert - vorher.km, t = Math.max(1, tage(vorher.d, d));
      if (diff > 2000 && diff / t > 800) {
        return km(diff) + ' seit dem ' + datum(vorher.d) + ' (' + (t === 1 ? 'an einem Tag' : 'in ' + t + ' Tagen') + '). Tippfehler?';
      }
    } else if (anschaffung !== null && wert < anschaffung) {
      return 'Niedriger als der Tachostand bei Anschaffung (' + km(anschaffung) + '). Tippfehler?';
    }
    return null;
  }

  function zeige() {
    var text = pruefe();
    hinweis.textContent = text ? '⚠ ' + text : '';
    hinweis.classList.toggle('d-none', !text);
    feld.classList.toggle('border-warning', !!text);
    return text;
  }

  // Während des Tippens keine neue Warnung einblenden (jede Zwischenzahl wäre "zu niedrig" und das Layout
  // würde springen, #90); eine angezeigte Warnung verschwindet aber sofort, sobald der Wert passt.
  feld.addEventListener('input', function () { if (!hinweis.classList.contains('d-none')) zeige(); });
  feld.addEventListener('change', zeige);
  datumFeld.addEventListener('change', zeige);
  feld.form.addEventListener('submit', function (e) {
    var text = zeige();
    if (text && !confirm('Der Tachostand wirkt unplausibel:\n\n' + text + '\n\nTrotzdem speichern?')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      feld.focus();
    }
  });
  zeige();
})();
</script>
