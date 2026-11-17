<?php
// Gemeinsame Angaben für die Ansichten eines Fahrzeugs (includes/fahrzeug_seite.php, pages/reiter.php).
// Erwartet: $fahrzeug (aus der API)
// Für Tabs: API-Fahrzeug in altes Format abbilden (marke/modell wo erwartet)
$fahrzeug['marke'] = '';
$fahrzeug['modell'] = $fahrzeug['name'] ?? '';

// Mengeneinheit für alle Tabs (l, kWh oder kg)
$einheitKurz = einheitKurz(getEinheitFuerKraftstoff($fahrzeug['fuel_type'] ?? null));
// Begriffe für alle Reiter: Tankfüllung/Ladevorgang, Tankstelle/Ladestation usw.
$fuelType = (string)($fahrzeug['fuel_type'] ?? 'other');
$begriffe = verbrauchsBegriffe($fuelType);
// Geteilte Fahrzeuge (#53): owner, editor (Mitfahrer) oder viewer (nur ansehen); die API setzt die Rechte durch
$rolle = (string)($fahrzeug['role'] ?? 'owner');
$istBesitzer = $rolle === 'owner';
// Verkaufte und stillgelegte Fahrzeuge (#79) sind archiviert und nur lesbar; die API lehnt Änderungen mit 409 ab
$archiviert = ($fahrzeug['status'] ?? 'active') !== 'active';
$darfErfassen = in_array($rolle, ['owner', 'editor'], true) && !$archiviert;
// Fahrzeugdaten, Intervalle, Import und Teilen ändern: nur der Besitzer, und nur solange das Fahrzeug aktiv ist
$darfAendern = $istBesitzer && !$archiviert;
$ichId = (string)($_SESSION['user_id'] ?? '');
