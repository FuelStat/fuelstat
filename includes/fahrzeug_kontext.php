<?php
// Gemeinsame Angaben für die Reiter der Fahrzeugseite (pages/fahrzeug_detail.php, pages/reiter.php).
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
$darfErfassen = in_array($rolle, ['owner', 'editor'], true);
$ichId = (string)($_SESSION['user_id'] ?? '');
