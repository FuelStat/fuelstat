// Passkeys (#2): Anmelden (Knopf und Autofill im E-Mail-Feld) und Passkey anlegen. Nutzt SimpleWebAuthnBrowser
// (vendor/simplewebauthn) und spricht über pages/passkey.php mit der API.
(function () {
  var W = window.SimpleWebAuthnBrowser;
  if (!W || !W.browserSupportsWebAuthn()) return;

  function senden(csrf, daten) {
    var form = new FormData();
    form.append('csrf_token', csrf);
    Object.keys(daten).forEach(function (k) { form.append(k, daten[k]); });
    return fetch('passkey.php', { method: 'POST', body: form, credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.code = j.error; throw e; }
        return j;
      });
    });
  }

  var TEXTE = {
    NotAllowedError: 'Abgebrochen oder nicht erlaubt. Versuche es noch einmal.',
    unknown_passkey: 'Diesen Passkey kennt Fuelstat nicht (mehr). Melde dich mit Passwort an und richte ihn neu ein.',
    invalid_passkey_response: 'Der Passkey konnte nicht geprüft werden. Versuche es noch einmal.',
    invalid_challenge: 'Die Anfrage ist abgelaufen. Versuche es noch einmal.',
    invalid_current_password: 'Das Passwort stimmt nicht.',
    too_many_attempts: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.',
    too_many_passkeys: 'Du hast schon 20 Passkeys. Entferne zuerst einen.',
    passkey_exists: 'Dieser Passkey ist schon eingerichtet.',
    passkeys_not_configured: 'Passkeys sind auf diesem Server nicht eingerichtet.',
    ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: 'Auf diesem Gerät ist schon ein Passkey für dein Konto eingerichtet.'
  };
  var text = function (e) { return TEXTE[e && (e.code || e.name)] || TEXTE[e && e.cause && e.cause.name] || 'Das hat nicht geklappt. Versuche es noch einmal.'; };
  var abgebrochen = function (e) { return e && (e.name === 'AbortError' || e.code === 'ERROR_CEREMONY_ABORTED'); };

  // --- Anmelden (login.php) ---
  var login = document.getElementById('passkeyLogin');
  if (login) {
    var knopf = document.getElementById('passkeyAnmelden');
    var meldung = document.getElementById('passkeyMeldung');
    var csrf = login.dataset.csrf;
    login.classList.remove('d-none');

    var anmelden = function (autofill) {
      return senden(csrf, { aktion: 'anmelden_optionen' })
        .then(function (o) {
          return W.startAuthentication({ optionsJSON: o.options, useBrowserAutofill: autofill }).then(function (antwort) {
            knopf.disabled = true;
            return senden(csrf, { aktion: 'anmelden', challengeId: o.challengeId, antwort: JSON.stringify(antwort) });
          });
        })
        .then(function (r) { window.location.href = r.ziel || '../index.php'; });
    };
    var fehler = function (e) {
      knopf.disabled = false;
      if (abgebrochen(e)) return;
      meldung.textContent = text(e);
      meldung.classList.remove('d-none');
    };
    // Autofill: Passkeys erscheinen in der Vorschlagsliste des E-Mail-Feldes (autocomplete="username webauthn")
    var autofill = function () {
      W.browserSupportsWebAuthnAutofill().then(function (ja) {
        if (!ja) return;
        anmelden(true).catch(function (e) {
          if (abgebrochen(e)) return;
          // Abgelaufene Anfrage (nach 5 Minuten): still neu starten, sonst Fehler zeigen
          if (e.code === 'invalid_challenge') autofill(); else fehler(e);
        });
      });
    };
    knopf.addEventListener('click', function () {
      meldung.classList.add('d-none');
      knopf.disabled = true;
      anmelden(false).catch(function (e) { fehler(e); autofill(); });
    });
    autofill();
  }

  // --- Passkey anlegen (passkeys.php) ---
  var anlegen = document.getElementById('passkeyAnlegen');
  if (anlegen) {
    var hinweis = document.getElementById('passkeyAnlegenMeldung');
    document.querySelectorAll('[data-passkey-unterstuetzt]').forEach(function (el) { el.classList.remove('d-none'); });
    document.querySelectorAll('[data-passkey-nicht-unterstuetzt]').forEach(function (el) { el.classList.add('d-none'); });
    anlegen.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var los = anlegen.querySelector('button[type=submit]');
      los.disabled = true;
      hinweis.classList.add('d-none');
      var csrfAnlegen = anlegen.dataset.csrf;
      senden(csrfAnlegen, { aktion: 'anlegen_optionen', passwort: anlegen.elements.passwort.value })
        .then(function (o) {
          return W.startRegistration({ optionsJSON: o.options }).then(function (antwort) {
            return senden(csrfAnlegen, { aktion: 'anlegen', challengeId: o.challengeId, antwort: JSON.stringify(antwort), name: anlegen.elements.name.value });
          });
        })
        .then(function () { window.location.reload(); })
        .catch(function (e) {
          los.disabled = false;
          if (abgebrochen(e)) return;
          hinweis.textContent = text(e);
          hinweis.classList.remove('d-none');
        });
    });
  }
})();
