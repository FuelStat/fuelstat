<?php
// Text der Nutzungsbedingungen (#135), Entwurf des Betreibers aus FuelStat/fuelstat#135.
// Angaben zum Betreiber kommen aus includes/betreiber.php. Ändert sich der Text inhaltlich, in infra/.env eine neue
// TERMS_VERSION setzen (z. B. das Datum): Dann stimmen alle Konten beim nächsten Aufruf der neuen Fassung zu.
// Erwartet: $b (betreiber.php), $baseUrl, $terminStand (Text "Stand: …").
$e = fn(string $k) => htmlspecialchars((string)($b[$k] ?? ''));
$mail = htmlspecialchars(str_replace('@', '[at]', (string)($b['email'] ?? '')));
$dienst = htmlspecialchars(rtrim($baseUrl, '/') . '/');
?>
<p class="text-body-secondary">Stand: <?= htmlspecialchars($terminStand) ?></p>

<h2 class="h5 mt-4">1. Anbieter und Geltungsbereich</h2>
<p>(1) Diese Nutzungsbedingungen gelten für die Nutzung des Online-Dienstes FuelStat unter <?= $dienst ?> einschließlich der zugehörigen Webanwendung und der angebundenen mobilen Anwendungen, soweit diese auf den Online-Dienst zugreifen.</p>
<p>(2) Anbieter und Betreiber von FuelStat ist:<br>
<strong><?= $e('name') ?></strong><br><?= $e('strasse') ?><br><?= $e('plz_ort') ?><br><?= $mail ?><br>
<a href="<?= htmlspecialchars($baseUrl) ?>pages/impressum.php">Impressum</a><br>
Nachfolgend „Betreiber“ genannt.</p>
<p>(3) Diese Nutzungsbedingungen regeln ausschließlich die Nutzung des vom Betreiber bereitgestellten Online-Dienstes. Für eigenständig installierte und betriebene Versionen von FuelStat (Self-Hosting) gelten diese Bedingungen nicht. Hierfür sind insbesondere die jeweils geltenden Open-Source-Lizenzbedingungen maßgeblich.</p>

<h2 class="h5 mt-4">2. Leistungsbeschreibung</h2>
<p>(1) FuelStat ist eine Anwendung zur Verwaltung von Fahrzeugen, Tank- und Ladevorgängen, Ausgaben, Wartungsinformationen und damit verbundenen Statistiken.</p>
<p>(2) Der Funktionsumfang kann insbesondere folgende Bereiche umfassen:</p>
<ul>
  <li>Verwaltung mehrerer Fahrzeuge, auch gemeinsam mit anderen Konten,</li>
  <li>Erfassung von Tank- und Ladevorgängen,</li>
  <li>Erfassung von Ausgaben und Wartungskosten,</li>
  <li>ein Fahrtenbuch zur eigenen Übersicht,</li>
  <li>Verbrauchs-, Kosten- und CO₂-Auswertungen,</li>
  <li>Erinnerungen und Benachrichtigungen,</li>
  <li>Datenexport und weitere ergänzende Funktionen.</li>
</ul>
<p>(3) Der konkrete Funktionsumfang richtet sich nach der jeweils verfügbaren Version und dem gegebenenfalls gebuchten Tarif.</p>
<p>(4) Der Betreiber entwickelt FuelStat fortlaufend weiter. Funktionen können ergänzt, verändert oder eingestellt werden, sofern dadurch keine zwingenden gesetzlichen Rechte der Nutzer beeinträchtigt werden.</p>
<p>(5) FuelStat ist ein unterstützendes Verwaltungs- und Auswertungssystem. Die Anwendung ersetzt weder ein amtlich anerkanntes Fahrtenbuch noch eine professionelle Buchhaltungs-, Steuer-, Finanz- oder Fahrzeugdiagnosesoftware.</p>

<h2 class="h5 mt-4">3. Registrierung und Benutzerkonto</h2>
<p>(1) Für die Nutzung bestimmter Funktionen ist ein Benutzerkonto erforderlich.</p>
<p>(2) Bei der Registrierung sind wahrheitsgemäße Angaben zu machen. Nutzer sind verpflichtet, ihre Kontaktdaten aktuell zu halten und eine E-Mail-Adresse anzugeben, über die sie erreichbar sind. Die E-Mail-Adresse ist zu bestätigen; bis dahin stehen nur einzelne Funktionen zur Verfügung.</p>
<p>(3) Zugangsdaten sind vertraulich zu behandeln und vor dem Zugriff unbefugter Dritter zu schützen. Nutzer müssen den Betreiber unverzüglich informieren, wenn sie einen unbefugten Zugriff auf ihr Konto vermuten.</p>
<p>(4) Ein Benutzerkonto ist grundsätzlich persönlich und darf nicht ohne Zustimmung des Betreibers an Dritte übertragen werden. Funktionen zur gemeinsamen Nutzung von Fahrzeugen bleiben hiervon unberührt.</p>
<p>(5) Der Betreiber kann Konten vorübergehend einschränken oder sperren, wenn konkrete Anhaltspunkte für einen Missbrauch, einen Sicherheitsvorfall oder einen Verstoß gegen diese Nutzungsbedingungen bestehen. Dabei werden die berechtigten Interessen der betroffenen Nutzer berücksichtigt.</p>

<h2 class="h5 mt-4">4. Pflichten der Nutzer</h2>
<p>(1) Nutzer dürfen FuelStat ausschließlich im Rahmen der geltenden Gesetze und dieser Nutzungsbedingungen verwenden.</p>
<p>(2) Insbesondere ist es untersagt:</p>
<ul>
  <li>den Dienst für rechtswidrige Zwecke zu verwenden,</li>
  <li>Sicherheitsmechanismen zu umgehen oder unbefugten Zugriff auf Systeme, Konten oder Daten anderer Nutzer zu erlangen,</li>
  <li>die technische Infrastruktur durch automatisierte Anfragen, Angriffe oder sonstige übermäßige Belastung zu beeinträchtigen,</li>
  <li>Schadsoftware oder sonstige schädliche Inhalte einzubringen,</li>
  <li>falsche oder irreführende Angaben zu machen, soweit dadurch Rechte Dritter oder der Betrieb des Dienstes beeinträchtigt werden.</li>
</ul>
<p>(3) Nutzer sind für die von ihnen eingegebenen, hochgeladenen und übermittelten Inhalte und Daten verantwortlich. Sie müssen sicherstellen, dass sie zur Nutzung und Speicherung dieser Daten berechtigt sind. Wer ein Fahrzeug mit anderen teilt, entscheidet selbst, wer die Daten dieses Fahrzeugs sehen und ergänzen kann.</p>
<p>(4) Nutzer sind selbst dafür verantwortlich, ihre Fahrzeugdaten, Tank- und Ladevorgänge, Kilometerstände und Ausgaben korrekt und vollständig zu erfassen.</p>

<h2 class="h5 mt-4">5. Richtigkeit von Berechnungen und Auswertungen</h2>
<p>(1) FuelStat stellt Berechnungen, Statistiken, Prognosen und grafische Auswertungen auf Grundlage der vom Nutzer eingegebenen Daten sowie gegebenenfalls verfügbarer externer Datenquellen bereit.</p>
<p>(2) Die Ergebnisse dienen ausschließlich der persönlichen Information und Orientierung. Sie stellen insbesondere keine verbindliche Auskunft dar über:</p>
<ul>
  <li>den tatsächlichen technischen Zustand eines Fahrzeugs,</li>
  <li>den tatsächlichen Kraftstoff- oder Stromverbrauch,</li>
  <li>die steuerliche Absetzbarkeit von Ausgaben,</li>
  <li>die Wirtschaftlichkeit eines Fahrzeugs,</li>
  <li>die tatsächliche Höhe von CO₂-Emissionen,</li>
  <li>die Verfügbarkeit oder den Preis von Kraftstoffen oder Ladestationen.</li>
</ul>
<p>(3) Berechnungen können aufgrund unvollständiger, fehlerhafter oder verspäteter Eingaben sowie durch technische Einschränkungen oder Änderungen externer Datenquellen von tatsächlichen Werten abweichen.</p>
<p>(4) Nutzer sind verpflichtet, wichtige Ergebnisse eigenständig zu überprüfen. Insbesondere dürfen sicherheitsrelevante Fahrzeugentscheidungen, Wartungsentscheidungen oder steuerliche Erklärungen nicht ausschließlich auf Grundlage der von FuelStat bereitgestellten Auswertungen getroffen werden.</p>

<h2 class="h5 mt-4">6. Betrieb, Verfügbarkeit und Wartung</h2>
<p>(1) Der Betreiber stellt FuelStat über eine angemietete Serverinfrastruktur eines externen Hosting-Dienstleisters bereit. Die technische Infrastruktur wird vom Betreiber eigenständig verwaltet und betrieben.</p>
<p>(2) Der Betreiber bemüht sich um einen möglichst sicheren und zuverlässigen Betrieb des Dienstes. Eine jederzeitige, unterbrechungsfreie oder fehlerfreie Verfügbarkeit kann jedoch nicht zugesichert werden.</p>
<p>(3) Einschränkungen oder Unterbrechungen können insbesondere entstehen durch:</p>
<ul>
  <li>notwendige Wartungs- und Aktualisierungsarbeiten,</li>
  <li>technische Störungen oder Ausfälle der Serverinfrastruktur,</li>
  <li>Netzwerk- und Internetstörungen,</li>
  <li>Sicherheitsmaßnahmen oder die Abwehr von Angriffen,</li>
  <li>Ausfälle oder Änderungen externer Dienste und Schnittstellen,</li>
  <li>Ereignisse außerhalb des Einflussbereichs des Betreibers.</li>
</ul>
<p>(4) Geplante Wartungsarbeiten werden nach Möglichkeit so durchgeführt, dass Beeinträchtigungen möglichst gering bleiben. Bei dringenden Sicherheits- oder Fehlerbehebungsmaßnahmen kann eine vorherige Ankündigung entfallen.</p>
<p>(5) Der Betreiber ist berechtigt, den Dienst vorübergehend einzuschränken, wenn dies aus Sicherheitsgründen oder zur Aufrechterhaltung des Betriebs erforderlich ist.</p>

<h2 class="h5 mt-4">7. Datensicherung und Datenverlust</h2>
<p>(1) Der Betreiber trifft im Rahmen seiner technischen und wirtschaftlichen Möglichkeiten angemessene Maßnahmen zur Sicherung der gespeicherten Daten.</p>
<p>(2) Eine vollständige Vermeidung von Datenverlusten kann trotz geeigneter Sicherungsmaßnahmen nicht garantiert werden.</p>
<p>(3) Nutzer werden daher ausdrücklich dazu angehalten, wichtige Daten regelmäßig über die bereitgestellten Exportfunktionen zu sichern und eigene Sicherungskopien aufzubewahren.</p>
<p>(4) Der Betreiber haftet für Datenverluste nach Maßgabe der Haftungsregelungen in Abschnitt 9. Insbesondere bleiben gesetzliche Ansprüche bei einer Verletzung vertraglicher Sicherungspflichten unberührt.</p>

<h2 class="h5 mt-4">8. Externe Dienste und Schnittstellen</h2>
<p>(1) FuelStat kann Informationen und Funktionen externer Anbieter einbinden. Dazu können beispielsweise Tankstelleninformationen, Kraftstoffpreise, Ladestationen, Kartenmaterial oder Benachrichtigungsdienste gehören.</p>
<p>(2) Diese Informationen werden teilweise von externen Anbietern bereitgestellt. Der Betreiber hat auf deren Verfügbarkeit, Aktualität, Vollständigkeit und Richtigkeit nur begrenzten Einfluss.</p>
<p>(3) Für Störungen, Änderungen oder die Einstellung externer Dienste ist der Betreiber nicht verantwortlich, soweit er diese nicht selbst zu vertreten hat und keine eigenen gesetzlichen oder vertraglichen Pflichten verletzt.</p>
<p>(4) Die Nutzung externer Dienste kann zusätzlichen Nutzungsbedingungen der jeweiligen Anbieter unterliegen.</p>

<h2 class="h5 mt-4">9. Haftung</h2>
<p>(1) Der Betreiber haftet unbeschränkt:</p>
<ul>
  <li>bei Vorsatz und grober Fahrlässigkeit,</li>
  <li>für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit,</li>
  <li>nach den Vorschriften des Produkthaftungsgesetzes,</li>
  <li>im Umfang einer ausdrücklich übernommenen Garantie,</li>
  <li>soweit eine Haftung gesetzlich zwingend vorgeschrieben ist.</li>
</ul>
<p>(2) Bei leicht fahrlässiger Verletzung einer wesentlichen Vertragspflicht haftet der Betreiber nur für den vertragstypischen, vorhersehbaren Schaden. Wesentliche Vertragspflichten sind solche Pflichten, deren Erfüllung die ordnungsgemäße Durchführung des Vertrags überhaupt erst ermöglicht und auf deren Einhaltung Nutzer regelmäßig vertrauen dürfen.</p>
<p>(3) Im Übrigen ist die Haftung des Betreibers für leicht fahrlässig verursachte Schäden ausgeschlossen, soweit dies gesetzlich zulässig ist.</p>
<p>(4) Die vorstehenden Haftungsregelungen gelten auch zugunsten der gesetzlichen Vertreter und Erfüllungsgehilfen des Betreibers.</p>
<p>(5) Eine Haftung für Schäden, die ausschließlich auf fehlerhaften oder unvollständigen Angaben der Nutzer, auf einer unsachgemäßen Nutzung oder auf nicht vom Betreiber zu vertretenden Störungen externer Dienste beruhen, besteht nicht, soweit gesetzlich zulässig.</p>
<p>(6) Die Haftungsbeschränkungen gelten nicht, soweit zwingende gesetzliche Vorschriften entgegenstehen.</p>

<h2 class="h5 mt-4">10. Datenschutz und technische Dienstleister</h2>
<p>(1) Der Betreiber verarbeitet personenbezogene Daten im Zusammenhang mit der Bereitstellung und Nutzung von FuelStat gemäß den geltenden Datenschutzbestimmungen.</p>
<p>(2) Die Einzelheiten der Datenverarbeitung, insbesondere die verarbeiteten Daten, Zwecke, Rechtsgrundlagen, Speicherdauer und Rechte der betroffenen Personen, ergeben sich aus der gesonderten <a href="<?= htmlspecialchars($baseUrl) ?>pages/datenschutz.php">Datenschutzerklärung</a>.</p>
<p>(3) Für den technischen Betrieb setzt der Betreiber externe Dienstleister ein. Hierzu gehört insbesondere ein Hosting-Dienstleister, bei dem die Serverinfrastruktur angemietet wird.</p>
<p>(4) Soweit externe Dienstleister personenbezogene Daten im Auftrag des Betreibers verarbeiten, erfolgt dies auf Grundlage der jeweils erforderlichen datenschutzrechtlichen Vereinbarungen.</p>
<p>(5) Diese Nutzungsbedingungen ersetzen nicht die Datenschutzerklärung und stellen keine Einwilligung in eine Datenverarbeitung dar.</p>

<h2 class="h5 mt-4">11. Laufzeit, Kündigung und Löschung des Kontos</h2>
<p>(1) Soweit nicht für einzelne Tarife etwas anderes vereinbart ist, wird das Nutzungsverhältnis auf unbestimmte Zeit geschlossen.</p>
<p>(2) Nutzer können ihr Konto jederzeit über die dafür vorgesehene Funktion oder durch eine entsprechende Nachricht an den Betreiber kündigen, soweit keine abweichenden zwingenden gesetzlichen Regelungen gelten.</p>
<p>(3) Mit der Löschung des Kontos werden die diesem Konto zugeordneten Daten grundsätzlich gelöscht, soweit keine gesetzlichen Aufbewahrungspflichten oder sonstigen rechtlich zulässigen Gründe für eine weitere Speicherung bestehen. Einträge, die ein Nutzer bei einem mit ihm geteilten Fahrzeug eines anderen Kontos erfasst hat, verbleiben beim Fahrzeug und gehen an dessen Besitzer über.</p>
<p>(4) Der Betreiber kann das Nutzungsverhältnis aus wichtigem Grund kündigen. Ein wichtiger Grund liegt insbesondere bei erheblichen oder wiederholten Verstößen gegen diese Nutzungsbedingungen vor. Gesetzliche Rechte bleiben unberührt.</p>
<p>(5) Vor einer außerordentlichen Kündigung soll dem Nutzer grundsätzlich Gelegenheit zur Beseitigung eines behebbaren Verstoßes gegeben werden, sofern dies unter Berücksichtigung der Umstände zumutbar ist und keine unmittelbare Gefährdung besteht.</p>

<h2 class="h5 mt-4">12. Änderungen dieser Nutzungsbedingungen</h2>
<p>(1) Der Betreiber kann diese Nutzungsbedingungen anpassen, wenn hierfür ein sachlicher Grund besteht, beispielsweise aufgrund gesetzlicher Änderungen, technischer Weiterentwicklungen oder Änderungen des Leistungsumfangs.</p>
<p>(2) Änderungen werden den Nutzern in geeigneter Weise mitgeteilt, insbesondere beim nächsten Aufruf von FuelStat. Soweit eine ausdrückliche Zustimmung gesetzlich erforderlich ist, werden die Änderungen erst nach dieser Zustimmung Vertragsbestandteil.</p>
<p>(3) Gesetzliche Rechte der Nutzer bleiben unberührt.</p>

<h2 class="h5 mt-4">13. Schlussbestimmungen</h2>
<p>(1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts, soweit eine solche Rechtswahl zulässig ist.</p>
<p>(2) Gegenüber Verbrauchern gelten die gesetzlichen Gerichtsstände. Eine ausschließliche Gerichtsstandsvereinbarung wird nur getroffen, soweit dies gesetzlich zulässig ist.</p>
<p>(3) Sollten einzelne Bestimmungen dieser Nutzungsbedingungen unwirksam sein oder werden, bleiben die übrigen Bestimmungen davon unberührt. An die Stelle der unwirksamen Bestimmung treten die gesetzlichen Vorschriften.</p>
<p>(4) Zwingende gesetzliche Verbraucherrechte bleiben von diesen Nutzungsbedingungen unberührt.</p>
