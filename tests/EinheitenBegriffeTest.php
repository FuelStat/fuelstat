<?php
// Anzeige-Helfer für Einheiten und Begriffe (Plug-in-Hybrid: Tanken und Laden getrennt benannt).
// Die Rechnung selbst (Verbrauch, CO₂) liegt in der API und ist dort getestet (backend/test, #82).
require __DIR__ . '/../includes/functions.php';

assert(getKategorieName('Tankfuellung', 'phev', 'kwh') === 'Ladevorgang');
assert(getKategorieName('Tankfuellung', 'phev', 'l') === 'Tankfüllung');
assert(einheitenFuerKraftstoff('phev') === ['l', 'kwh'] && einheitenFuerKraftstoff('hybrid') === ['l']);
assert(getEinheitFuerKraftstoff('electric') === 'kwh' && getEinheitFuerKraftstoff('cng') === 'kg' && getEinheitFuerKraftstoff('diesel') === 'l');

echo "All tests passed\n";
