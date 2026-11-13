// Textalternative für Diagramme (docs/design.md, Barrierefreiheit; #158): Jedes Chart.js-Diagramm bekommt eine
// Beschreibung für Screenreader (role="img", aria-label) und darunter die Werte als aufklappbare Tabelle.
// Wird nach chart.umd.min.js eingebunden und registriert sich nur einmal, auch wenn mehrere Reiter es laden.
(function () {
  // Merker am Chart-Objekt: lädt ein Reiter chart.umd.min.js erneut, entsteht ein neues Chart ohne das Plugin
  if (!window.Chart || window.Chart.fuelstatTextalternative) return;
  window.Chart.fuelstatTextalternative = true;

  var zahl = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
  var text = function (v) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '–';
    if (typeof v === 'object' && v !== null) v = v.y !== undefined ? v.y : v.x;
    return typeof v === 'number' ? zahl.format(v) : String(v);
  };
  var element = function (tag, inhalt, klasse) {
    var el = document.createElement(tag);
    if (inhalt !== undefined) el.textContent = inhalt;
    if (klasse) el.className = klasse;
    return el;
  };

  function titelVon(canvas) {
    var karte = canvas.closest('.card');
    var h = karte && karte.querySelector('h2, h3, h4');
    if (!h) return 'Diagramm';
    // Ohne den kleinen Zusatz (Einheit) hinter der Überschrift
    var kopie = h.cloneNode(true);
    kopie.querySelectorAll('small').forEach(function (s) { s.remove(); });
    return kopie.textContent.replace(/\s+/g, ' ').trim();
  }

  function aufbauen(chart) {
    var canvas = chart.canvas;
    var labels = (chart.data.labels || []).map(text);
    var reihen = (chart.data.datasets || []).filter(function (d) { return !d.hidden; });
    if (!labels.length || !reihen.length) return;
    var titel = titelVon(canvas);

    // Zusammenfassung in einem Satz (docs/design.md 10): Spanne, Höchst- und Tiefstwert der ersten Reihe
    var werte = (reihen[0].data || []).map(function (v, i) {
      if (v !== null && typeof v === 'object') v = v.y;
      return typeof v === 'number' && !isNaN(v) ? { v: v, label: labels[i] } : null;
    }).filter(Boolean);
    var satz = titel + ': ' + labels.length + ' Werte' + (labels.length > 1 ? ' von ' + labels[0] + ' bis ' + labels[labels.length - 1] : '');
    if (werte.length > 1) {
      var hoch = werte.reduce(function (a, b) { return b.v > a.v ? b : a; });
      var tief = werte.reduce(function (a, b) { return b.v < a.v ? b : a; });
      satz += ', ' + (reihen[0].label ? reihen[0].label + ' ' : '') + 'höchstens ' + zahl.format(hoch.v) + ' (' + hoch.label + '), mindestens ' + zahl.format(tief.v) + ' (' + tief.label + ')';
    }
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', satz + '. Die Werte stehen in der Tabelle darunter.');

    var huelle = canvas.parentElement;
    var alt = huelle.nextElementSibling;
    var offen = false;
    if (alt && alt.classList.contains('diagramm-tabelle')) {
      offen = alt.open;
      alt.remove();
    }

    var tabelle = element('table', undefined, 'table table-sm mb-0');
    tabelle.appendChild(element('caption', titel, 'visually-hidden'));
    var kopf = tabelle.createTHead().insertRow();
    kopf.appendChild(element('th', '', '')).setAttribute('scope', 'col');
    reihen.forEach(function (r) {
      var th = element('th', r.label || 'Wert', 'text-end');
      th.setAttribute('scope', 'col');
      kopf.appendChild(th);
    });
    var rumpf = tabelle.createTBody();
    labels.forEach(function (label, i) {
      var zeile = rumpf.insertRow();
      var th = element('th', label, 'fw-normal');
      th.setAttribute('scope', 'row');
      zeile.appendChild(th);
      reihen.forEach(function (r) { zeile.appendChild(element('td', text((r.data || [])[i]), 'text-end zahl')); });
    });

    var details = element('details', undefined, 'diagramm-tabelle mt-2');
    details.open = offen;
    details.appendChild(element('summary', 'Werte als Tabelle', 'fs-label'));
    var rahmen = element('div', undefined, 'table-responsive mt-2');
    rahmen.appendChild(tabelle);
    details.appendChild(rahmen);
    huelle.insertAdjacentElement('afterend', details);
  }

  Chart.register({
    id: 'fuelstatTextalternative',
    afterUpdate: function (chart) {
      try { aufbauen(chart); } catch (e) { /* Diagramm bleibt auch ohne Tabelle nutzbar */ }
    }
  });
})();
