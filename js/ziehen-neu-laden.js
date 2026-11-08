/*
 * Zum Aktualisieren nach unten ziehen (#1), nur in der installierten App (PWA).
 * Im Browser gibt es das schon; als App vom Home-Bildschirm fehlt es unter iOS und Android.
 *
 * Damit nichts verloren geht und Scrollen ungestört bleibt:
 * - nur ganz oben auf der Seite, mit einem Finger und eindeutig nach unten (nicht seitlich: Reiter-Wischen, #88)
 * - nicht in Eingabefeldern, Diagrammen, offenen Menüs, Dialogen und Blättern
 * - nicht, wenn in einem Formular schon etwas eingegeben wurde (Neuladen würde es verwerfen)
 * - erst ab SCHWELLE px (mit Widerstand) wird neu geladen; vorher zurückschnellen lassen
 * Offline zeigt das Neuladen den gespeicherten Stand bzw. die Offline-Seite (service-worker.js).
 */
(function () {
    'use strict';

    var istApp = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
    if (!istApp || !('ontouchstart' in window)) return;

    var SCHWELLE = 70;        // px Zugweg (nach Widerstand), ab dem losgelassen neu geladen wird
    var MAX_WEG = 110;        // px, weiter folgt die Anzeige nicht
    var RICHTUNG_AB = 8;      // px, ab denen die Richtung feststeht
    var AUSNAHMEN = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], canvas, .dropdown-menu, .modal, .offcanvas, .no-pull';

    var geaendert = false;
    document.addEventListener('input', function (e) {
        if (e.target && e.target.closest && e.target.closest('form')) geaendert = true;
    }, true);

    var anzeige = document.createElement('div');
    anzeige.className = 'ziehen-anzeige';
    anzeige.setAttribute('aria-hidden', 'true');
    anzeige.innerHTML = '<i class="fas fa-arrow-down"></i>';
    document.body.appendChild(anzeige);
    var symbol = anzeige.firstChild;

    var start = null;

    function oben() {
        return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    }

    function gesperrt(ziel) {
        return geaendert
            || document.body.classList.contains('modal-open')
            || document.body.classList.contains('seite-laedt')
            || document.querySelector('.offcanvas.show, .offcanvas.showing')
            || (ziel && ziel.closest && ziel.closest(AUSNAHMEN));
    }

    function zeigen(weg) {
        anzeige.style.transition = 'none';
        anzeige.style.opacity = String(Math.min(1, weg / SCHWELLE));
        anzeige.style.transform = 'translate(-50%, ' + weg + 'px)';
        symbol.style.transform = 'rotate(' + (weg >= SCHWELLE ? 180 : Math.round(weg / SCHWELLE * 180)) + 'deg)';
        anzeige.classList.toggle('bereit', weg >= SCHWELLE);
    }

    function zuruecksetzen() {
        anzeige.style.transition = '';
        anzeige.style.opacity = '0';
        anzeige.style.transform = 'translate(-50%, 0)';
        anzeige.classList.remove('bereit');
    }

    document.addEventListener('touchstart', function (e) {
        start = null;
        if (e.touches.length !== 1 || !oben() || gesperrt(e.target)) return;
        start = { x: e.touches[0].clientX, y: e.touches[0].clientY, richtung: null, weg: 0 };
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
        if (!start) return;
        if (e.touches.length !== 1) { start = null; zuruecksetzen(); return; }
        var dx = e.touches[0].clientX - start.x;
        var dy = e.touches[0].clientY - start.y;
        if (!start.richtung) {
            if (Math.abs(dx) < RICHTUNG_AB && Math.abs(dy) < RICHTUNG_AB) return;
            start.richtung = dy > 0 && dy > Math.abs(dx) * 1.5 ? 'runter' : 'anderes';
            if (start.richtung !== 'runter') { start = null; return; }
        }
        if (!oben() || dy <= 0) { start.weg = 0; zuruecksetzen(); return; }
        // Eigene Anzeige statt des Gummiband-Effekts von iOS
        if (e.cancelable) e.preventDefault();
        start.weg = Math.min(MAX_WEG, dy * 0.5);
        zeigen(start.weg);
    }, { passive: false });

    function ende() {
        var s = start;
        start = null;
        if (!s || s.weg < SCHWELLE) { zuruecksetzen(); return; }
        anzeige.style.transition = '';
        anzeige.style.transform = 'translate(-50%, ' + SCHWELLE + 'px)';
        anzeige.classList.add('laedt');
        symbol.className = 'fas fa-rotate';
        symbol.style.transform = '';
        window.location.reload();
    }

    document.addEventListener('touchend', ende, { passive: true });
    document.addEventListener('touchcancel', function () { start = null; zuruecksetzen(); }, { passive: true });

    // Zurück aus dem Cache (bfcache): Anzeige nicht drehend stehen lassen
    window.addEventListener('pageshow', function () {
        anzeige.classList.remove('laedt');
        symbol.className = 'fas fa-arrow-down';
        zuruecksetzen();
    });
})();
