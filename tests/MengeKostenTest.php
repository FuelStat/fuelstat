<?php
// Menge und Gesamtpreis aus dem Eintragsformular (#84): fehlende Werte berechnen, leer ist nicht 0
require __DIR__ . '/../includes/api_helpers.php';

$f = fn(array $post) => mengeUndKostenAusFormular($post);

// Menge + Preis → Gesamtpreis (der Fall aus dem Beta-Feedback: Gesamtpreis nur als Vorschlag sichtbar)
$r = $f(['menge' => '41,2', 'preis_pro_einheit' => '1.749', 'kosten' => '']);
assert($r['fehler'] === null && $r['menge'] === 41.2 && $r['kosten'] === 72.06, 'Gesamtpreis berechnet');

// Gesamtpreis + Preis → Menge
$r = $f(['menge' => '', 'preis_pro_einheit' => '0,28', 'kosten' => '4.65']);
assert($r['fehler'] === null && $r['menge'] === 16.61 && $r['kosten'] === 4.65, 'Menge berechnet');

// Alles angegeben: Werte bleiben, wie sie sind
$r = $f(['menge' => '40', 'preis_pro_einheit' => '1.8', 'kosten' => '70']);
assert($r['menge'] === 40.0 && $r['kosten'] === 70.0);

// Bewusst 0 € (kostenloses Laden) bleibt erlaubt
$r = $f(['menge' => '16.59', 'preis_pro_einheit' => '', 'kosten' => '0']);
assert($r['fehler'] === null && $r['kosten'] === 0.0, 'kostenlos erlaubt');

// Leer ist nicht 0: Fehlermeldung statt stiller 0
$r = $f(['menge' => '40', 'preis_pro_einheit' => '', 'kosten' => '']);
assert($r['fehler'] !== null && $r['kosten'] === null, 'ohne Gesamtpreis und Preis: Fehler');
$r = $f(['menge' => '', 'preis_pro_einheit' => '', 'kosten' => '70']);
assert($r['fehler'] !== null, 'ohne Menge: Fehler');
$r = $f(['menge' => '0', 'preis_pro_einheit' => '1.8', 'kosten' => '']);
assert($r['fehler'] !== null, 'Menge 0: Fehler');
$r = $f(['menge' => 'abc', 'preis_pro_einheit' => '', 'kosten' => '5']);
assert($r['fehler'] !== null, 'keine Zahl: Fehler');

// Fahrt: gefahrene km landen in der Beschreibung (#43)
assert(fahrtBeschreibung(['startort' => 'Bolbingen', 'zielort' => 'Aalen', 'zweck' => 'Arbeit', 'gefahrene_km' => '42']) === 'Bolbingen → Aalen · Arbeit (42 km)');
// Ältere Einträge mit Gedankenstrich als Trenner lassen sich weiter bearbeiten
assert(fahrtAusBeschreibung('Bolbingen → Aalen – Arbeit (42 km)') === ['startort' => 'Bolbingen', 'zielort' => 'Aalen', 'zweck' => 'Arbeit', 'gefahrene_km' => '42']);
assert(fahrtBeschreibung(['startort' => '', 'zielort' => 'Ulm', 'zweck' => '', 'gefahrene_km' => '12,5']) === 'Ulm (12,5 km)');
assert(fahrtBeschreibung(['startort' => 'A', 'zielort' => 'B', 'zweck' => '', 'gefahrene_km' => '']) === 'A → B');
assert(fahrtBeschreibung([]) === 'Fahrt');
// Rückweg zum Bearbeiten (#95): Beschreibung wieder in Felder zerlegen
foreach ([
    ['startort' => 'Bolbingen', 'zielort' => 'Aalen', 'zweck' => 'Arbeit', 'gefahrene_km' => '42'],
    ['startort' => '', 'zielort' => 'Ulm', 'zweck' => '', 'gefahrene_km' => '12.5'],
    ['startort' => 'A', 'zielort' => 'B', 'zweck' => '', 'gefahrene_km' => ''],
    ['startort' => 'A', 'zielort' => 'B', 'zweck' => 'Einkauf', 'gefahrene_km' => '1234'],
] as $f) {
    assert(fahrtAusBeschreibung(fahrtBeschreibung($f)) === $f, json_encode([$f, fahrtAusBeschreibung(fahrtBeschreibung($f))]));
}
assert(fahrtAusBeschreibung('Urlaubsfahrt mit Oma')['zweck'] === 'Urlaubsfahrt mit Oma');
assert(fahrtAusBeschreibung('Fahrt') === ['startort' => '', 'zielort' => '', 'zweck' => '', 'gefahrene_km' => '']);

echo "All tests passed\n";
