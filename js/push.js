// Push auf diesem Gerät (#136): Erlaubnis nur nach Klick, Abo über pages/push.php an die API.
// Auf iPhone/iPad gibt es Web Push nur in der zum Home-Bildschirm hinzugefügten App (ab iOS 16.4).
(function () {
  var bereich = document.getElementById('pushBereich');
  if (!bereich) return;
  var status = document.getElementById('pushStatus');
  var an = document.getElementById('pushAn');
  var aus = document.getElementById('pushAus');
  var testKnopf = document.getElementById('pushTest');
  var iosHinweis = document.getElementById('pushIosHinweis');
  var zeige = function (el, ja) { el.classList.toggle('d-none', !ja); };
  var meldung = function (text) { status.textContent = text; };

  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var installiert = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var unterstuetzt = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // Name des Geräts für die Liste, z. B. „iPhone (Safari)“
  function geraetename() {
    var ua = navigator.userAgent;
    var system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (ios && !/iPhone/.test(ua)) ? 'iPad'
      : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Gerät';
    var browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return system + ' (' + (installiert ? 'App' : browser) + ')';
  }

  function schluessel(base64) {
    var pad = '='.repeat((4 - (base64.length % 4)) % 4);
    var roh = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(roh.length);
    for (var i = 0; i < roh.length; i++) out[i] = roh.charCodeAt(i);
    return out;
  }

  function senden(daten) {
    var form = new FormData();
    form.append('csrf_token', bereich.dataset.csrf);
    Object.keys(daten).forEach(function (k) { form.append(k, daten[k]); });
    return fetch('push.php', { method: 'POST', body: form, credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function anzeigen(abo) {
    var verweigert = Notification.permission === 'denied';
    zeige(an, !abo && !verweigert);
    zeige(aus, Boolean(abo));
    zeige(testKnopf, Boolean(abo));
    if (verweigert) meldung('Benachrichtigungen sind für Fuelstat im Browser blockiert. Erlaube sie in den Website- bzw. App-Einstellungen und lade die Seite neu.');
    else if (abo) meldung('Push ist auf diesem Gerät aktiv.');
    else meldung('Push ist auf diesem Gerät aus.');
  }

  if (ios && !installiert) {
    zeige(iosHinweis, true);
    meldung('Auf diesem Gerät noch nicht verfügbar.');
    return;
  }
  if (!unterstuetzt || !bereich.dataset.vapid) {
    meldung('Dieser Browser unterstützt keine Push-Benachrichtigungen.');
    return;
  }

  var registrierung = navigator.serviceWorker.ready;
  registrierung.then(function (reg) { return reg.pushManager.getSubscription(); }).then(anzeigen).catch(function () {
    meldung('Push konnte nicht geprüft werden. Bitte die Seite neu laden.');
  });

  an.addEventListener('click', function () {
    an.disabled = true;
    Notification.requestPermission().then(function (erlaubnis) {
      if (erlaubnis !== 'granted') { anzeigen(null); return null; }
      return registrierung.then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluessel(bereich.dataset.vapid) });
      }).then(function (abo) {
        return senden({ aktion: 'abonnieren', abo: JSON.stringify(abo), name: geraetename() }).then(function () {
          // Neu laden: Das Gerät erscheint in der Liste, die Schalter für Push sind nutzbar
          window.location.reload();
        });
      });
    }).catch(function (e) {
      meldung('Aktivieren hat nicht geklappt (' + e.message + '). Bitte noch einmal versuchen.');
    }).finally(function () { an.disabled = false; });
  });

  aus.addEventListener('click', function () {
    aus.disabled = true;
    registrierung.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (abo) {
      if (!abo) return null;
      var endpoint = abo.endpoint;
      return abo.unsubscribe().then(function () { return senden({ aktion: 'abmelden', endpoint: endpoint }); });
    }).then(function () { window.location.reload(); }).catch(function (e) {
      meldung('Abschalten hat nicht geklappt (' + e.message + ').');
      aus.disabled = false;
    });
  });

  testKnopf.addEventListener('click', function () {
    testKnopf.disabled = true;
    senden({ aktion: 'test' }).then(function (r) {
      meldung(r.sent ? 'Testnachricht verschickt – sie sollte gleich erscheinen.' : 'Kein Gerät erreicht. Push auf diesem Gerät einmal ab- und wieder anschalten.');
    }).catch(function (e) {
      meldung(e.message === 'too_many_attempts' ? 'Bitte ein paar Minuten warten, bevor du noch eine Testnachricht schickst.' : 'Senden hat nicht geklappt (' + e.message + ').');
    }).finally(function () { testKnopf.disabled = false; });
  });
})();
