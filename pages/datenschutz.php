<?php
// pages/datenschutz.php – Betreiberangaben kommen aus includes/betreiber.php
include '../includes/session.php';
include '../includes/header.php';

$b = require __DIR__ . '/../includes/betreiber.php';
$angabe = fn(string $k) => ($b[$k] ?? '') !== ''
    ? htmlspecialchars($b[$k])
    : '<span class="text-danger">[' . $k . ' fehlt in includes/betreiber.php]</span>';
// E-Mail wie auf caraggiu.com mit [at] statt @
$email = ($b['email'] ?? '') !== '' ? htmlspecialchars(str_replace('@', '[at]', $b['email'])) : $angabe('email');
?>

<div class="container mt-5 mb-5 rechtstext">
  <h1 class="mb-3">Datenschutzerklärung</h1>
  <p class="lead">Kurz gesagt: Fuelstat speichert nur, was du selbst einträgst und was für den Betrieb nötig ist. Es gibt kein Tracking, keine Werbung, keine Analyse-Tools und keine Weitergabe oder Verkauf deiner Daten.</p>

  <h2 class="h5 mt-4">1. Verantwortlicher</h2>
  <p><?= $angabe('name') ?><br><?= $angabe('strasse') ?><br><?= $angabe('plz_ort') ?><?= ($b['telefon'] ?? '') !== '' ? '<br>Telefon: ' . htmlspecialchars($b['telefon']) : '' ?><br>E-Mail: <?= $email ?></p>

  <h2 class="h5 mt-4">2. Hosting und Server-Logfiles</h2>
  <p>Fuelstat läuft auf einem Server des Betreibers<?= ($b['hoster'] ?? '') !== '' ? ' bei ' . htmlspecialchars($b['hoster']) . ', der die Daten als Auftragsverarbeiter verarbeitet' : '' ?>. Bei jedem Aufruf speichert der Webserver automatisch: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Statuscode, übertragene Datenmenge, Referrer und Browserkennung. Das ist nötig, um den Dienst sicher zu betreiben und Angriffe oder Fehler zu erkennen (Art. 6 Abs. 1 lit. f DSGVO). Die Logfiles werden nach <?= (int)($b['log_tage'] ?? 14) ?> Tagen gelöscht.</p>

  <h2 class="h5 mt-4">3. Benutzerkonto</h2>
  <p>Für dein Konto speichere ich deine E-Mail-Adresse, optional einen Benutzernamen und ein Profilbild sowie den Zeitpunkt der Registrierung. Rechtsgrundlage ist die Nutzung der App (Art. 6 Abs. 1 lit. b DSGVO).</p>
  <ul>
    <li><strong>Passwort:</strong> wird nie im Klartext gespeichert, sondern nur als bcrypt-Hash. Auch ich als Betreiber kann es nicht auslesen.</li>
    <li><strong>Passkeys (optional):</strong> richtest du einen Passkey ein, speichert Fuelstat nur dessen öffentlichen Schlüssel, eine Kennung, den Signaturzähler, den von dir gewählten Namen, ob er synchronisiert wird, und wann er eingerichtet und zuletzt genutzt wurde. Der private Schlüssel und deine biometrischen Daten (Face ID, Fingerabdruck) verlassen dein Gerät bzw. deinen Passwort-Manager nie. Ein externer Dienst ist nicht beteiligt. Entfernen kannst du Passkeys jederzeit im Profil; beim Löschen des Kontos werden alle gelöscht.</li>
    <li><strong>Zwei-Faktor-Authentifizierung (optional):</strong> der geheime Schlüssel für deine Authenticator-App wird verschlüsselt (AES-256) in der Datenbank gespeichert, um die Codes zu prüfen.</li>
    <li><strong>Anmeldung:</strong> nach dem Login erhält dein Browser ein Sitzungs-Cookie und ein Anmelde-Cookie; die Anmeldung (Token) läuft nach 7 Tagen ab. Beim Abmelden wird das Token in einer Sperrliste vermerkt, die mit deinem Konto gelöscht wird. Fehlgeschlagene Anmeldeversuche werden zum Schutz vor Angriffen kurzzeitig gezählt (nur im Arbeitsspeicher, höchstens 15 Minuten).</li>
    <li><strong>Aktivität:</strong> Zeitpunkt der letzten Anmeldung und der letzten Nutzung (höchstens stündlich aktualisiert), damit ich als Betreiber sehe, ob Konten noch genutzt werden.</li>
    <li><strong>Beta-Phase:</strong> während der Beta wird dein Konto als „Beta-Tester“ gekennzeichnet.</li>
    <li><strong>E-Mail-Bestätigung:</strong> nach der Registrierung und beim Ändern der Adresse schicke ich einen Bestätigungslink an die Adresse. Gespeichert werden nur ein Prüfwert (Hash) des Links, sein Ablauf (24 Stunden) und der Zeitpunkt der Bestätigung. Bis zur Bestätigung gilt eine neue Adresse noch nicht.</li>
    <li><strong>Passwort vergessen:</strong> forderst du einen Link zum Zurücksetzen an, speichere ich nur einen Prüfwert (Hash) des Links, seinen Ablauf (eine Stunde) und ob er benutzt wurde.</li>
    <li><strong>Nutzungsbedingungen:</strong> gespeichert werden die Fassung, der du zugestimmt hast, und der Zeitpunkt der Zustimmung, damit nachvollziehbar ist, welche Fassung gilt.</li>
    <li><strong>Bilder (Profil- und Fahrzeugbilder):</strong> werden beim Hochladen verkleinert und als WebP gespeichert; dabei werden alle eingebetteten Metadaten entfernt, insbesondere der <strong>Aufnahmeort (GPS)</strong>, Kameramodell und Aufnahmezeit. Das Original wird nicht aufbewahrt. Abrufbar sind die Bilder nur über zeitlich begrenzte, signierte Adressen, die nur du (angemeldet) erhältst.</li>
  </ul>

  <h2 class="h5 mt-4">4. Fahrzeug- und Fahrtdaten</h2>
  <p>Gespeichert wird, was du einträgst: Fahrzeuge (Name, Marke, Modell, Baujahr, Kraftstoff, Tank- bzw. Akkugröße, Fotos), Tankfüllungen und Ladevorgänge (Datum, Tachostand, Menge, Preis, Tankstelle bzw. Ort), Ausgaben und Fahrten. Daraus berechnet Fuelstat Verbrauch, Kosten, CO₂-Werte und Fälligkeiten. Die Daten sind nur in deinem Konto sichtbar – außer du teilst ein Fahrzeug (siehe unten). Als Betreiber habe ich technisch Zugriff auf die Datenbank, sehe mir deine Daten aber nur an, wenn du mich zur Fehlerbehebung darum bittest. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>

  <p><strong>Fahrtenbuch:</strong> erfasste Fahrten (Datum, Tachostände, Strecke, Von/Nach, Zweck, Notiz) dienen nur deiner eigenen Übersicht und Auswertung.</p>
  <p><strong>Fahrzeuge teilen:</strong> Lädst du jemanden zu einem Fahrzeug ein, speichere ich dessen E-Mail-Adresse und die gewählte Rolle (die Einladung gilt 14 Tage) und schicke eine Einladungsmail. Nimmt die Person an, sieht sie alle Daten dieses Fahrzeugs; Mitfahrer können außerdem Einträge ergänzen. Alle Beteiligten sehen den Benutzernamen bzw. die E-Mail-Adresse der anderen und bei jedem Eintrag, wer ihn erfasst hat. Mitglieder können ein Fahrzeug jederzeit verlassen, der Besitzer kann sie entfernen. Wird ein Konto gelöscht, bleiben dessen Einträge bei geteilten Fahrzeugen anderer erhalten und gehen an den Besitzer des Fahrzeugs über. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>

  <h2 class="h5 mt-4">5. Tankstellen- und Ladestationssuche</h2>
  <p>Nur wenn du beim Erfassen eines Eintrags die Suche nach Stationen in der Nähe startest, fragt dein Browser nach deinem Standort. Gibst du ihn frei (Art. 6 Abs. 1 lit. a DSGVO), werden die Koordinaten an den Fuelstat-Server und von dort weitergegeben:</p>
  <ul>
    <li>bei Verbrennern an die Tankerkönig-API (<a href="https://creativecommons.tankerkoenig.de" target="_blank" rel="noopener">creativecommons.tankerkoenig.de</a>), um Tankstellen und aktuelle Preise abzufragen,</li>
    <li>bei E-Autos an die API von Open Charge Map (<a href="https://openchargemap.org" target="_blank" rel="noopener">openchargemap.org</a>), um Ladestationen abzufragen.</li>
  </ul>
  <p>Die Dienste erhalten dabei nur die Koordinaten und die Adresse des Fuelstat-Servers, keine Konto- oder Fahrzeugdaten. Die Ergebnisse hält der Server für den gerundeten Standort kurz vor (Tankstellen einige Minuten, Ladestationen einige Stunden), ohne Bezug zu deinem Konto. Dein Standort selbst wird nicht gespeichert, nur die Station, die du auswählst.</p>
  <p>Gibst du deinen Standort nicht frei, kannst du stattdessen eine Postleitzahl oder einen Ort eingeben. Diese Eingabe sendet dein Browser direkt an den Ortssuchdienst Nominatim von OpenStreetMap (<a href="https://osmfoundation.org/wiki/Privacy_Policy" target="_blank" rel="noopener">OpenStreetMap Foundation</a>), um die Koordinaten zu ermitteln; dabei erhält OpenStreetMap deine IP-Adresse.</p>

  <h2 class="h5 mt-4">6. Benachrichtigungen per E-Mail und Push</h2>
  <p>Benachrichtigungen (Termine, fehlender Kilometerstand, Monatsbericht, lange kein Eintrag) schaltest nur du selbst ein, je Anlass per E-Mail, per Push oder beides.</p>
  <p><strong>E-Mail:</strong> Erinnerungen an Termine und den Monatsbericht schalten nur du selbst ein. Sie gehen an die E-Mail-Adresse deines Kontos und werden über den Mailserver des Betreibers verschickt oder, wenn du einen einträgst, über deinen eigenen Mailserver. Dessen Passwort wird verschlüsselt (AES-256) gespeichert. Damit keine Mail doppelt verschickt wird, merkt sich Fuelstat, welche Erinnerungen und Berichte bereits versandt wurden. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>
  <p><strong>Push-Benachrichtigungen:</strong> Erst wenn du sie auf einem Gerät aktivierst und dein Browser bzw. dein Gerät um Erlaubnis fragt, speichert Fuelstat die Push-Adresse dieses Geräts mit zwei Schlüsseln, einen Gerätenamen (z. B. „iPhone (App)“) und wann zuletzt etwas zugestellt wurde. Zugestellt werden die Nachrichten über den Push-Dienst des Herstellers deines Browsers bzw. Geräts: Google (Chrome, Android), Apple (Safari, iPhone, iPad, Mac), Mozilla (Firefox) oder Microsoft (Edge unter Windows). Der Inhalt ist Ende-zu-Ende verschlüsselt; der Push-Dienst sieht nur die Adresse, die Größe und den Zeitpunkt einer Nachricht. Die Texte sind knapp (z. B. „Mazda CX-60: HU – fällig in 12 Tagen“). Unter „Benachrichtigungen“ siehst du deine Geräte und kannst jedes abmelden; Geräte, die der Push-Dienst als abgemeldet meldet, löscht Fuelstat sofort, beim Löschen des Kontos alle. Rechtsgrundlage: Art. 6 Abs. 1 lit. a und b DSGVO.</p>

  <h2 class="h5 mt-4">7. Feedback</h2>
  <p>Wenn du über „Feedback senden“ eine Nachricht schickst, werden die Nachricht, die gewählte Art (z. B. Fehler oder Idee), die Seite, von der du kommst, deine Browserkennung und deine E-Mail-Adresse gespeichert und per E-Mail an mich geschickt, damit ich antworten kann. Feedback bleibt auch nach dem Löschen deines Kontos erhalten, bis es bearbeitet ist; auf Wunsch lösche ich es sofort. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (Verbesserung der App und Beantwortung deiner Anfrage).</p>

  <h2 class="h5 mt-4" id="cookies">8. Cookies und Speicher im Browser</h2>
  <ul>
    <li><strong>Sitzungs-Cookie (PHPSESSID):</strong> technisch notwendig für die Anmeldung und den Schutz der Formulare; es gilt höchstens 28 Tage und wird beim Abmelden gelöscht.</li>
    <li><strong>Anmelde-Cookie (fuelstat_auth):</strong> hält dich angemeldet, auch wenn der Server die Sitzung zwischendurch aufräumt. Es ist für Skripte nicht lesbar und wird beim Abmelden gelöscht. Es gilt 7 Tage; wer Fuelstat in dieser Zeit nutzt, bekommt höchstens einmal täglich ein neues, damit man nicht mitten in der Nutzung abgemeldet wird. Spätestens 90 Tage nach der letzten Anmeldung mit Passwort ist eine neue Anmeldung nötig.</li>
    <li><strong>Fahrzeug-Cookie (fuelstat_fahrzeug):</strong> merkt sich das zuletzt genutzte bzw. auf „Start“ gewählte Fahrzeug, damit Start und die Schnellerfassung über das App-Kürzel es zeigen. Es enthält nur die interne Kennung des Fahrzeugs, ist für Skripte nicht lesbar und gilt ein Jahr.</li>
    <li><strong>Lokaler Speicher (fuelstat-theme):</strong> merkt sich, ob du die helle oder dunkle Darstellung gewählt hast.</li>
    <li><strong>Lokaler Speicher (fuelstat-cookie-hinweis):</strong> merkt sich, dass du den Hinweis zu Cookies gesehen hast, damit er nicht bei jedem Aufruf erscheint. Über „Cookie-Hinweis“ unten auf jeder Seite kannst du ihn wieder anzeigen.</li>
    <li><strong>Lokaler Speicher (fuelstat-version-gesehen):</strong> zuletzt angesehene Version unter „Neuigkeiten“, damit neue Versionen markiert werden können.</li>
    <li><strong>Lokaler Speicher (fuelstat-geaendert):</strong> Zeitpunkt der letzten Änderung (Speichern, Abmelden), damit beim Zurückblättern keine veraltete Seite angezeigt wird.</li>
    <li><strong>Push-Abo (Service Worker):</strong> nur wenn du Push-Benachrichtigungen aktivierst; dein Browser hält dafür ein Abo beim Push-Dienst seines Herstellers (siehe Abschnitt 6). Abschalten unter „Benachrichtigungen“ oder in den Einstellungen des Browsers.</li>
    <li><strong>Service Worker:</strong> speichert Programmdateien und Grafiken der App (z. B. Stylesheets, Schriften, Symbole) im Browser, damit sie schneller laden.</li>
    <li><strong>Offline-Ansicht (Service Worker):</strong> die zuletzt geladene Übersicht und die zuletzt geöffneten Fahrzeugseiten (höchstens 20) sowie die darauf angezeigten eigenen Bilder (höchstens 60) werden auf deinem Gerät gespeichert, damit du sie ohne Internetverbindung lesen kannst. Andere Seiten werden nicht gespeichert. Die gespeicherten Seiten bleiben nur auf deinem Gerät, werden beim Abmelden und bei jeder Anmeldung gelöscht und nach 7 Tagen nicht mehr angezeigt.</li>
  </ul>
  <p>Diese Speicherungen sind für die angebotenen Funktionen unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG); es gibt keine Tracking- oder Werbe-Cookies. Deshalb fragt Fuelstat keine Einwilligung ab, sondern weist beim ersten Besuch nur darauf hin. Sollten später optionale Dienste hinzukommen, werden sie erst nach deiner ausdrücklichen Einwilligung geladen.</p>

  <h2 class="h5 mt-4">9. Keine Drittanbieter</h2>
  <p>Alle Bestandteile der App (Schriften, Symbole, Bibliotheken) werden vom Fuelstat-Server selbst ausgeliefert. Beim Aufruf werden keine Daten an Content-Delivery-Networks, Google oder andere Dritte übertragen. Einzige Ausnahme ist die Tankstellen- und Ladestationssuche (Abschnitt 5), und auch die nur auf deinen Wunsch.</p>

  <h2 class="h5 mt-4">10. Speicherdauer und Löschung</h2>
  <p>Deine Daten bleiben gespeichert, solange du dein Konto hast. Unter „Profil bearbeiten“ kannst du dein Konto jederzeit selbst löschen; dabei werden alle Fahrzeuge, Einträge, Einstellungen und hochgeladenen Bilder sofort entfernt<?= !empty($b['backup_tage']) ? '. Aus Datensicherungen verschwinden sie spätestens nach ' . (int)$b['backup_tage'] . ' Tagen' : '' ?>. Vorher kannst du deine Einträge als CSV exportieren.</p>

  <h2 class="h5 mt-4">11. Sicherheit</h2>
  <p>Die Verbindung ist durchgehend per HTTPS verschlüsselt. Passwörter werden nur als Hash gespeichert, Passwörter für eigene Mailserver und die Schlüssel der Zwei-Faktor-Authentifizierung verschlüsselt. Optional kannst du dein Konto mit einem zweiten Faktor (Authenticator-App) schützen.</p>

  <h2 class="h5 mt-4">12. Deine Rechte</h2>
  <p>Du hast das Recht auf Auskunft über deine gespeicherten Daten (Art. 15 DSGVO), auf Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21). Eine erteilte Einwilligung, etwa für den Standort, kannst du jederzeit in deinem Browser widerrufen. Schreib mir dazu einfach an <?= $email ?>.</p>
  <p>Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der für mich zuständigen Behörde: <?= htmlspecialchars($b['aufsicht'] ?? '') ?>.</p>

  <p class="text-body-secondary mt-4">Stand: <?= htmlspecialchars($b['stand'] ?? '') ?></p>
</div>

<?php include '../includes/footer.php'; ?>
