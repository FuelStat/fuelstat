<?php
include '../includes/session.php';
include '../includes/functions.php';
include '../includes/header.php';

if (!isset($_GET['fahrzeug_id'])) {
    die("Fahrzeug-ID fehlt.");
}
$fahrzeug_id = trim($_GET['fahrzeug_id']);

$aktuellerTacho = null;
$schnittVerbrauch = null;
$letztePreise = [];
$letzteOrte = [];
$fahrzeugKraftstoff = 'diesel';
$einheit = 'l';
$standortOptionen = [];
try {
    $vehicle = $api->getVehicle($fahrzeug_id);
    $fahrzeugKraftstoff = $vehicle['fuel_type'] ?? 'diesel';
    $einheit = getEinheitFuerKraftstoff($fahrzeugKraftstoff);
    $stats = $api->getVehicleStats($fahrzeug_id);
    $aktuellerTacho = $stats['currentOdo'] ?? null;
    // Für die Schätzung des Tachostands (#41): Ø Verbrauch, beim Plug-in-Hybrid zu ungenau
    $schnittVerbrauch = ($vehicle['fuel_type'] ?? '') !== 'phev' ? ($stats['avgConsumption'] ?? null) : null;
    // Bisherige Orte (neueste zuerst) als Vorschläge, beim E-Auto mit dem zuletzt bezahlten kWh-Preis je Ort
    // Die neuesten 100 reichen für zuletzt genutzte Orte und Preise (#160)
    $fillups = $api->getVehicleFillups($fahrzeug_id, 100);
    usort($fillups, fn($a, $b) => strcmp((string)($b['filled_at'] ?? ''), (string)($a['filled_at'] ?? '')));
    foreach ($fillups as $f) {
        $ort = trim((string)($f['station'] ?? ''));
        if ($ort === '' || array_key_exists($ort, $letztePreise)) {
            continue;
        }
        if (count($standortOptionen) < 15) {
            $standortOptionen[] = $ort;
        }
        // Plug-in-Hybrid: nur Strompreise merken, Spritpreise ändern sich täglich
        if ($fahrzeugKraftstoff === 'phev' && ($f['unit'] ?? 'l') !== 'kwh') {
            $letztePreise[$ort] = null;
            continue;
        }
        $preis = (float)($f['price_per_unit'] ?? 0) ?: ((float)($f['amount'] ?? 0) > 0 ? (float)($f['total_cost_eur'] ?? 0) / (float)$f['amount'] : 0);
        $letztePreise[$ort] = $preis > 0 ? round($preis, 3) : null;
    }
    // Zuletzt genutzte Orte als Chips (Einheit je Ort, damit der Plug-in-Hybrid passende Orte zeigt)
    foreach ($fillups as $f) {
        $ort = trim((string)($f['station'] ?? ''));
        $u = $f['unit'] ?? $einheit;
        if ($ort !== '' && !isset($letzteOrte[$u][$ort]) && count($letzteOrte[$u] ?? []) < 5) {
            $letzteOrte[$u][$ort] = true;
        }
    }
} catch (Throwable $e) {
}
$letzteOrte = array_map('array_keys', $letzteOrte);
// Begriffe passend zum Fahrzeug (Tankfüllung/Ladevorgang, Tankstelle/Ladestation …)
$begriffe = verbrauchsBegriffe($vehicle['fuel_type'] ?? 'other');
$istPhev = $fahrzeugKraftstoff === 'phev';
// Kraftstoffsorten des Fahrzeugs (#140): Einheiten und Kacheln ergeben sich aus den Sorten (Standard zuerst)
$katalogSorten = sortenKatalog()['sorten'];
$fahrzeugSorten = array_values(array_filter(sortenDesFahrzeugs($vehicle ?? []), fn($k) => isset($katalogSorten[$k])));
$standardSorteFahrzeug = standardSorte($vehicle ?? [], $fahrzeugSorten);
$einheitenDesFahrzeugs = array_values(array_unique(array_map(fn($k) => $katalogSorten[$k]['unit'], $fahrzeugSorten)));
if (!$einheitenDesFahrzeugs) {
    $einheitenDesFahrzeugs = einheitenFuerKraftstoff($fahrzeugKraftstoff);
}
$texteJeEinheit = [];
foreach ($einheitenDesFahrzeugs as $u) {
    $b = begriffeFuerEinheit($fahrzeugKraftstoff, $u);
    $texteJeEinheit[$u] = [
        'menge' => einheitLang($u),
        'preis' => '€/' . einheitKurz($u),
        'kurz' => einheitKurz($u),
        'voll' => $b['voll'],
        'luecke' => $b['luecke'],
        'beispiel' => $b['beispiel_ort'],
        'station' => $b['station'],
        'stationen' => $b['stationen'] . ' in der Nähe suchen',
        'stationsArt' => $u === 'kwh' ? 'lade' : 'tank',
    ];
}

// Eintragsarten als Kacheln (#46). Plug-in-Hybrid: Tanken und Laden getrennt, sonst eine Kachel passend zum Antrieb.
// Wert => [Beschriftung, Icon, Eintragstyp fürs Speichern, Einheit (nur Tanken/Laden)]
$arten = [];
foreach ($einheitenDesFahrzeugs as $u) {
    // Eine Kachel „Tanken“ auch bei mehreren Einheiten (z. B. Autogas in l und Erdgas in kg): die Sorte wählt die Einheit
    if ($u !== 'kwh' && isset($arten['tanken'])) {
        continue;
    }
    $b = begriffeFuerEinheit($fahrzeugKraftstoff, $u);
    $arten[$u === 'kwh' ? 'laden' : 'tanken'] = [$u === 'kwh' ? 'Laden' : 'Tanken', $b['icon'], 'Tankfuellung', $u];
}
$arten += [
    'ausgabe' => ['Ausgabe', 'fa-receipt', 'Andere Ausgabe', null],
    'fahrt' => ['Fahrt', 'fa-route', 'Fahrt', null],
    'km' => ['km notieren', 'fa-gauge-high', 'Kilometerstand', null],
];
// Start-Art: ?art=… (App-Kürzel), ?kategorie=… (Ausgabe vorgeben), ?einheit=kwh (Plug-in-Hybrid laden)
$startArt = $_GET['art'] ?? '';
if ($startArt === 'tanken' && !isset($arten['tanken'])) $startArt = 'laden';
if (!isset($arten[$startArt])) {
    $startArt = isset($_GET['kategorie']) ? 'ausgabe' : (($_GET['einheit'] ?? '') === 'kwh' && isset($arten['laden']) ? 'laden' : array_key_first($arten));
}
$startEinheit = $arten[$startArt][3] ?? $einheit;
$einheit = $startEinheit;
$t = $texteJeEinheit[$einheit] ?? reset($texteJeEinheit);
$stationsArt = $t['stationsArt'];

$vorgegebeneKategorie = $_GET['kategorie'] ?? null;
// Kategorien kommen vom API (#95); vorgegebene nur, wenn sie wählbar ist
$kategorienKatalog = kategorienKatalog();
if ($vorgegebeneKategorie !== null && empty(kategorieInfo($vorgegebeneKategorie)['available'])) {
    $vorgegebeneKategorie = null;
}
$heute = (new DateTimeImmutable('now', new DateTimeZone('Europe/Berlin')))->format('Y-m-d');
?>

<div class="container eintrag-formular mt-3 mt-lg-5">
    <h1 class="h3 d-none d-lg-block mb-3">Neuer Eintrag <small class="text-body-secondary fw-normal">· <?= htmlspecialchars($vehicle['name'] ?? '') ?></small></h1>
    <form method="post" action="eintrag_speichern.php" id="eintragFormular">
        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
        <input type="hidden" name="eintragstyp" id="eintragstyp" value="<?= htmlspecialchars($arten[$startArt][2]) ?>">
        <input type="hidden" name="einheit" id="einheit" value="<?= htmlspecialchars($startEinheit) ?>">

        <!-- Was wird erfasst? Große Kacheln statt Dropdown -->
        <div class="art-kacheln mb-4" role="radiogroup" aria-label="Art des Eintrags">
            <?php foreach ($arten as $wert => [$name, $icon, $typ, $u]): ?>
                <input type="radio" class="btn-check" name="art" id="art_<?= $wert ?>" value="<?= $wert ?>"
                       data-typ="<?= htmlspecialchars($typ) ?>" data-einheit="<?= htmlspecialchars((string)$u) ?>" <?= $wert === $startArt ? 'checked' : '' ?>>
                <label class="art-kachel" for="art_<?= $wert ?>"><i class="fas <?= $icon ?>"></i><span><?= $name ?></span></label>
            <?php endforeach; ?>
        </div>

        <!-- Tachostand zuerst (#41/#42), dann Datum -->
        <div class="row g-3 mb-3" id="fields_common">
            <div class="col-12 col-sm-7">
                <label for="tachostand" class="form-label fw-semibold">Tachostand (km)</label>
                <input type="number" id="tachostand" name="tachostand" class="form-control form-control-lg"
                       min="0" step="1" inputmode="numeric" pattern="[0-9]*" autofocus enterkeyhint="next"
                       placeholder="<?= $aktuellerTacho !== null ? 'zuletzt ' . number_format($aktuellerTacho, 0, ',', '.') : '' ?>">
                <input type="hidden" name="tachostand_geschaetzt" id="tachostand_geschaetzt" value="">
                <!-- Tankfüllung: Tachostand darf fehlen und wird später nachgetragen (#41) -->
                <div class="form-text d-none" id="tachoHinweis">
                    <span id="tachoHinweisText">Vergessen? Leer lassen und später nachtragen.</span>
                    <button type="button" class="btn btn-link btn-sm p-0 align-baseline d-none" id="btnTachoSchaetzung"></button>
                </div>
            </div>
            <div class="col-12 col-sm-5">
                <label for="datum" class="form-label fw-semibold">Datum</label>
                <input type="date" id="datum" name="datum" class="form-control form-control-lg" value="<?= $heute ?>" max="<?= $heute ?>" required>
                <div class="d-flex gap-1 mt-1">
                    <button type="button" class="btn btn-sm btn-outline-secondary datum-chip" data-tage="0">Heute</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary datum-chip" data-tage="1">Gestern</button>
                </div>
            </div>
        </div>

        <!-- Tanken / Laden -->
        <div id="fields_tank" class="eintrag-abschnitt">
            <?php if ($fahrzeugSorten): ?>
            <!-- Sorte (#140): nur die Sorten des Fahrzeugs, die zur Kachel passen (Tanken bzw. Laden); bei nur einer
                 Sorte unsichtbar. Bestimmt auch den Preis in der Tankstellensuche. -->
            <div class="mb-3" id="sorteFeld" hidden>
                <label class="form-label" for="sorteAuswahl">Sorte</label>
                <select name="sorte" id="sorteAuswahl" class="form-select">
                    <?php foreach ($fahrzeugSorten as $key): $s = $katalogSorten[$key]; ?>
                        <option value="<?= htmlspecialchars($key) ?>" data-einheit="<?= htmlspecialchars($s['unit']) ?>" data-tk="<?= htmlspecialchars((string)($s['tankerkoenig'] ?? '')) ?>" <?= $key === $standardSorteFahrzeug ? 'selected' : '' ?>><?= htmlspecialchars($s['name']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <?php endif; ?>

            <!-- Ort zuerst (#94): die Suche in der Nähe liefert den aktuellen Preis pro Liter; zuletzt genutzte Orte als Chips -->
            <div class="mb-3">
                <label for="standort" class="form-label" id="standortLabel"><?= htmlspecialchars($t['station']) ?></label>
                <div class="input-group">
                    <input type="text" list="stationen" placeholder="<?= htmlspecialchars($t['beispiel']) ?>" autocomplete="off" autocapitalize="words" enterkeyhint="done" id="standort" name="standort" class="form-control">
                    <button type="button" class="btn btn-outline-primary" id="btnTankstellenSuche" title="<?= htmlspecialchars($t['stationen']) ?>" aria-label="<?= htmlspecialchars($t['stationen']) ?>">
                        <i class="fas fa-map-marker-alt"></i>
                    </button>
                </div>
                <datalist id="stationen">
                    <?php foreach ($standortOptionen as $opt): ?><option value="<?= htmlspecialchars($opt) ?>"><?php endforeach; ?>
                </datalist>
                <div class="d-flex flex-wrap gap-1 mt-2" id="ortChips"></div>
                <div id="tankstellenVorschlaege" class="mt-2"></div>
            </div>

            <!-- Menge × Preis = Gesamt nebeneinander; das dritte Feld wird berechnet (js/mengen-rechner.js) -->
            <div class="row g-2 mb-1">
                <div class="col-6 col-md-4">
                    <label for="menge" class="form-label" id="mengeLabel"><?= htmlspecialchars($t['menge']) ?></label>
                    <div class="input-group">
                        <input type="number" inputmode="decimal" id="menge" name="menge" class="form-control" min="0" step="0.01">
                        <button type="button" class="btn btn-outline-secondary" id="info_menge" aria-label="Herkunft des Werts anzeigen"><i class="fas fa-circle-info"></i></button>
                    </div>
                </div>
                <div class="col-6 col-md-4">
                    <label for="preis_pro_einheit" class="form-label" id="preisLabel"><?= htmlspecialchars($t['preis']) ?></label>
                    <div class="input-group">
                        <input type="number" inputmode="decimal" id="preis_pro_einheit" name="preis_pro_einheit" class="form-control" min="0" step="0.001">
                        <button type="button" class="btn btn-outline-secondary" id="info_preis_pro_einheit" aria-label="Herkunft des Werts anzeigen"><i class="fas fa-circle-info"></i></button>
                    </div>
                </div>
                <div class="col-12 col-md-4">
                    <label for="kosten" class="form-label">Gesamt (€)</label>
                    <div class="input-group">
                        <input type="number" inputmode="decimal" id="kosten" name="kosten" class="form-control" min="0" step="0.01">
                        <button type="button" class="btn btn-outline-secondary" id="info_kosten" aria-label="Herkunft des Werts anzeigen"><i class="fas fa-circle-info"></i></button>
                    </div>
                </div>
            </div>
            <small class="form-text text-muted d-block" id="calcHint"></small>
            <div class="form-text text-warning-emphasis mb-3" id="rechenHinweis" aria-live="polite"></div>

            <div class="form-check form-switch mb-2">
                <input type="checkbox" id="vollgetankt" name="vollgetankt" class="form-check-input" role="switch" value="1" checked>
                <label for="vollgetankt" class="form-check-label" id="vollLabel"><?= htmlspecialchars($t['voll']) ?></label>
            </div>
            <div class="form-check form-switch mb-3">
                <input type="checkbox" id="skip_previous" name="skip_previous" class="form-check-input" role="switch" value="1">
                <label for="skip_previous" class="form-check-label" id="lueckeLabel"><?= htmlspecialchars($t['luecke']) ?></label>
            </div>
        </div>

        <!-- Andere Ausgabe -->
        <div id="fields_other" class="eintrag-abschnitt" hidden>
            <div class="row g-2 mb-3">
                <div class="col-7">
                    <label for="kategorie" class="form-label">Kategorie</label>
                    <select id="kategorie" name="kategorie" class="form-select" required>
                        <?= kategorieOptionen($vorgegebeneKategorie) ?>
                    </select>
                </div>
                <div class="col-5">
                    <label for="kosten_other" class="form-label">Kosten (€)</label>
                    <input type="number" inputmode="decimal" id="kosten_other" name="kosten" class="form-control" min="0" step="0.01" required>
                </div>
            </div>
            <div class="form-text mt-n2 mb-3">
                <?php if (($kategorienKatalog['custom']['max'] ?? 0) > 0): ?>
                    <a href="kategorien.php?zurueck=<?= urlencode($_SERVER['REQUEST_URI'] ?? '') ?>"><i class="fas fa-tags me-1"></i>Eigene Kategorien verwalten</a>
                <?php elseif (kategorienHatGesperrte()): ?>
                    <i class="fas fa-lock me-1"></i>Weitere Kategorien und eigene Kategorien gibt es mit Plus.
                <?php endif; ?>
            </div>
            <div class="mb-3">
                <label for="beschreibung" class="form-label">Beschreibung</label>
                <textarea id="beschreibung" name="beschreibung" class="form-control" rows="2"></textarea>
            </div>
        </div>

        <!-- Fahrt -->
        <div id="fields_trip" class="eintrag-abschnitt" hidden>
            <div class="row g-2 mb-3">
                <div class="col-6"><label for="startort" class="form-label">Von</label><input type="text" id="startort" name="startort" class="form-control"></div>
                <div class="col-6"><label for="zielort" class="form-label">Nach</label><input type="text" id="zielort" name="zielort" class="form-control"></div>
                <div class="col-7">
                    <label for="fahrt_zweck" class="form-label">Zweck</label>
                    <select id="fahrt_zweck" name="fahrt_zweck" class="form-select">
                        <?php foreach (fahrtZwecke() as $wert => $name): ?><option value="<?= $wert ?>"><?= $name ?></option><?php endforeach; ?>
                    </select>
                </div>
                <div class="col-5"><label for="gefahrene_km" class="form-label">km</label><input type="number" inputmode="decimal" id="gefahrene_km" name="gefahrene_km" class="form-control" min="0" step="0.1"></div>
                <div class="col-12"><label for="zweck" class="form-label">Notiz (optional)</label><input type="text" id="zweck" name="zweck" class="form-control" placeholder="z. B. Kundentermin Müller"></div>
                <div class="col-12 form-text">Der Tachostand oben ist der Stand am Ende der Fahrt. Die Fahrt landet im Fahrtenbuch (Reiter „Fahrten“).</div>
            </div>
        </div>

        <!-- Nur Kilometerstand notieren (#42) -->
        <div id="fields_km" class="eintrag-abschnitt" hidden>
            <p class="text-body-secondary small mb-3">
                <i class="fas fa-circle-info me-1"></i>Notiert nur den Tachostand, z. B. beim Parken. Er hilft beim Schätzen fehlender Kilometerstände,
                bei der Plausibilitätsprüfung und bei der Fahrleistung – ohne Kosten.
            </p>
            <div class="mb-3">
                <label for="km_notiz" class="form-label">Notiz (optional)</label>
                <input type="text" id="km_notiz" name="beschreibung" class="form-control" placeholder="z. B. Parkhaus Bahnhof">
            </div>
        </div>

        <!-- Mobil unten fest über der App-Leiste -->
        <div class="formular-aktionen">
            <button type="submit" class="btn btn-primary btn-lg flex-grow-1" id="btnSpeichern"><i class="fas fa-check me-1"></i>Speichern</button>
            <a href="fahrzeug_detail.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>#eintraege" class="btn btn-outline-secondary btn-lg">Abbrechen</a>
        </div>
    </form>
</div>

<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'js/mengen-rechner.js')) ?>"></script>
<script>
const fahrzeugKraftstoff = <?= json_encode($fahrzeugKraftstoff) ?>;
let stationsArt = <?= json_encode($stationsArt) ?>;
// Zuletzt bezahlter Strompreis je Ort (E-Auto und Plug-in-Hybrid: ändert sich selten, an der Wallbox praktisch nie)
const letztePreise = <?= json_encode($letztePreise ?: new stdClass(), JSON_UNESCAPED_UNICODE) ?>;
const letzteOrte = <?= json_encode($letzteOrte ?: new stdClass(), JSON_UNESCAPED_UNICODE) ?>;
const texteJeEinheit = <?= json_encode($texteJeEinheit, JSON_UNESCAPED_UNICODE) ?>;
const abschnitte = {
    'Tankfuellung': document.getElementById('fields_tank'),
    'Andere Ausgabe': document.getElementById('fields_other'),
    'Fahrt': document.getElementById('fields_trip'),
    'Kilometerstand': document.getElementById('fields_km')
};
const eintragstyp = document.getElementById('eintragstyp');
const einheitFeld = document.getElementById('einheit');
const tachoFeld = document.getElementById('tachostand');
let mengenEinheit = <?= json_encode(einheitKurz($einheit)) ?>;
let rechner = null;

// Nur der sichtbare Abschnitt wird mitgeschickt und geprüft (gleiche Feldnamen wie "kosten" kommen mehrfach vor)
function zeigeAbschnitt(typ) {
    Object.entries(abschnitte).forEach(([name, el]) => {
        const aktiv = name === typ;
        el.hidden = !aktiv;
        el.querySelectorAll('input, select, textarea, button').forEach(f => { f.disabled = !aktiv; });
    });
}

// Texte und Stationssuche je Einheit (Plug-in-Hybrid: Tanken oder Laden)
function setzeEinheit(u) {
    const t = texteJeEinheit[u];
    if (!t) return;
    einheitFeld.value = u;
    document.getElementById('mengeLabel').textContent = t.menge;
    document.getElementById('preisLabel').textContent = t.preis;
    document.getElementById('vollLabel').textContent = t.voll;
    document.getElementById('lueckeLabel').textContent = t.luecke;
    document.getElementById('standortLabel').textContent = t.station;
    document.getElementById('standort').placeholder = t.beispiel;
    mengenEinheit = t.kurz;
    if (rechner) rechner.aktualisiere();
    stationsArt = t.stationsArt;
    const suche = document.getElementById('btnTankstellenSuche');
    suche.title = t.stationen;
    suche.setAttribute('aria-label', t.stationen);
    sortenFuerArt(u);
    zeigeOrtChips(u);
    document.getElementById('tankstellenVorschlaege').replaceChildren();
}

// Vorschlags-Chips nur bei leerem Ort zeigen (#106): entscheidend ist allein der Inhalt des Feldes, egal ob er
// getippt, aus der Liste, per Chip oder aus der Suche kommt. Ausblenden per Klasse "d-none", denn "d-flex" am
// Container setzt display mit !important und würde das hidden-Attribut überstimmen.
function ortVorschlaegeAktualisieren() {
    const leer = document.getElementById('standort').value.trim() === '';
    document.getElementById('ortChips').classList.toggle('d-none', !leer);
}
// Ort gewählt (Chip oder Treffer der Suche): Trefferliste schließen, Chips nach Feldinhalt
function vorschlaegeAusblenden() {
    document.getElementById('tankstellenVorschlaege').replaceChildren();
    ortVorschlaegeAktualisieren();
}
['input', 'change'].forEach(ereignis => document.getElementById('standort').addEventListener(ereignis, ortVorschlaegeAktualisieren));

// Zuletzt genutzte Orte als Chips; Antippen übernimmt den Ort (und beim Laden den letzten Preis)
function zeigeOrtChips(u) {
    const box = document.getElementById('ortChips');
    box.replaceChildren();
    (letzteOrte[u] || []).forEach(ort => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'btn btn-sm btn-outline-secondary rounded-pill ort-chip';
        chip.textContent = ort;
        chip.addEventListener('click', () => {
            const feld = document.getElementById('standort');
            feld.value = ort;
            preisAusHistorie(ort);
            vorschlaegeAusblenden();
        });
        box.append(chip);
    });
    ortVorschlaegeAktualisieren();
}

// Kachel gewählt: Abschnitt, Pflichtfelder und Texte umschalten
function waehleArt(radio, fokus) {
    const typ = radio.dataset.typ;
    eintragstyp.value = typ;
    zeigeAbschnitt(typ);
    if (radio.dataset.einheit) setzeEinheit(radio.dataset.einheit);
    tachoPflicht();
    if (fokus) tachoFeld.focus();
}
document.querySelectorAll('input[name="art"]').forEach(radio => radio.addEventListener('change', () => { if (radio.checked) waehleArt(radio, true); }));

// Datum: Heute / Gestern
document.querySelectorAll('.datum-chip').forEach(chip => chip.addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() - Number(chip.dataset.tage));
    document.getElementById('datum').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}));

// Tachostand (#41): beim Tanken/Laden und bei Ausgaben optional, bei Fahrt und "km notieren" Pflicht.
// Schätzung: letzter Tachostand + Menge ÷ Ø Verbrauch × 100; übernommene Schätzungen werden markiert.
const tachoGeschaetzt = document.getElementById('tachostand_geschaetzt');
const tachoHinweis = document.getElementById('tachoHinweis');
const btnSchaetzung = document.getElementById('btnTachoSchaetzung');
const letzterTacho = <?= json_encode($aktuellerTacho !== null ? (int)$aktuellerTacho : null) ?>;
const schnittVerbrauch = <?= json_encode($schnittVerbrauch !== null ? (float)$schnittVerbrauch : null) ?>;
let schaetzung = null;
function tachoPflicht() {
    const typ = eintragstyp.value;
    tachoFeld.required = typ === 'Fahrt' || typ === 'Kilometerstand';
    tachoHinweis.classList.toggle('d-none', typ !== 'Tankfuellung');
    aktualisiereSchaetzung();
}
function aktualisiereSchaetzung() {
    const mengeFeld = document.getElementById('menge');
    const menge = parseFloat(String(mengeFeld.value).replace(',', '.'));
    schaetzung = eintragstyp.value === 'Tankfuellung' && letzterTacho !== null && schnittVerbrauch > 0 && menge > 0
        ? Math.round(letzterTacho + menge / schnittVerbrauch * 100) : null;
    btnSchaetzung.classList.toggle('d-none', schaetzung === null || tachoFeld.value !== '');
    if (schaetzung !== null) btnSchaetzung.textContent = 'Schätzung übernehmen: ca. ' + schaetzung.toLocaleString('de-DE') + ' km';
}
btnSchaetzung.addEventListener('click', () => {
    if (schaetzung === null) return;
    tachoFeld.value = schaetzung;
    tachoGeschaetzt.value = '1';
    document.getElementById('tachoHinweisText').textContent = 'Geschätzt – bitte später durch den echten Tachostand ersetzen.';
    aktualisiereSchaetzung();
});
tachoFeld.addEventListener('input', () => { tachoGeschaetzt.value = ''; aktualisiereSchaetzung(); });
document.getElementById('menge').addEventListener('input', aktualisiereSchaetzung);

window.addEventListener('DOMContentLoaded', () => {
    // Bootstrap (Erklärung am Info-Knopf) wird erst im Footer geladen
    rechner = mengenRechner({ einheit: () => mengenEinheit, hinweis: 'rechenHinweis' });
    waehleArt(document.querySelector('input[name="art"]:checked'), false);
});

// Sorte (#140): beim Tanken nur Kraftstoffe, beim Laden nur Strom; Auswahl erst ab zwei passenden Sorten sichtbar
const sorteAuswahl = document.getElementById('sorteAuswahl');
function sortenFuerArt(u) {
    if (!sorteAuswahl) return;
    const laden = u === 'kwh';
    let sichtbar = 0;
    let gewaehltPasst = false;
    for (const o of sorteAuswahl.options) {
        const passt = (o.dataset.einheit === 'kwh') === laden;
        o.hidden = !passt;
        o.disabled = !passt;
        if (passt) {
            sichtbar++;
            if (o.selected) gewaehltPasst = true;
        }
    }
    if (!gewaehltPasst) {
        const erste = [...sorteAuswahl.options].find(o => !o.disabled);
        if (erste) erste.selected = true;
    }
    document.getElementById('sorteFeld').hidden = sichtbar < 2;
}
if (sorteAuswahl) {
    sorteAuswahl.addEventListener('change', () => {
        // Andere Einheit (z. B. Erdgas in kg statt Autogas in l): Texte umstellen
        const u = sorteAuswahl.selectedOptions[0]?.dataset.einheit;
        if (u && u !== einheitFeld.value) setzeEinheit(u);
        document.getElementById('tankstellenVorschlaege').replaceChildren();
    });
}

// Tankerkönig-Sorte für die Preise in der Tankstellensuche: aus der gewählten Sorte, ohne Sortenliste aus dem Antrieb
function getSelectedKraftstoff() {
    const o = sorteAuswahl ? sorteAuswahl.selectedOptions[0] : null;
    if (o) return o.dataset.tk || 'all';
    return fahrzeugKraftstoff;
}

// Hilfsfunktion: Erlaubte Typen für Preisabfrage
function isPreisTyp(type) {
    return ['e5', 'e10', 'diesel'].includes(type);
}

// Stationssuche: Standort per GPS, sonst PLZ/Ort über OpenStreetMap; Treffer als Liste zum Anklicken.
// Alle Texte (auch die von Tankerkönig und Open Charge Map) werden mit textContent gesetzt, nie als HTML.
const btnSuche = document.getElementById('btnTankstellenSuche');
const vorschlaege = document.getElementById('tankstellenVorschlaege');

function zeigeHinweis(art, text, zusatz) {
    vorschlaege.replaceChildren();
    const box = document.createElement('div');
    box.className = 'alert alert-' + art;
    box.textContent = text;
    if (zusatz) {
        box.append(document.createElement('br'));
        const klein = document.createElement('small');
        klein.textContent = zusatz;
        box.append(klein);
    }
    vorschlaege.append(box);
}

function zeigeLaden(text) {
    vorschlaege.replaceChildren();
    const spinner = document.createElement('span');
    spinner.className = 'spinner-border spinner-border-sm me-1';
    vorschlaege.append(spinner, document.createTextNode(text));
}

function sucheBeenden() {
    btnSuche.disabled = false;
    btnSuche.innerHTML = '<i class="fas fa-map-marker-alt"></i>';
}

function zeigeTankstellen(stations, mitPreis, sorte, ortHinweis) {
    vorschlaege.replaceChildren();
    if (!stations || stations.length === 0) {
        zeigeHinweis('warning', 'Keine Tankstellen gefunden.', ortHinweis);
        return;
    }
    const liste = document.createElement('ul');
    liste.className = 'list-group';
    stations.forEach(station => {
        const name = String(station.name || '').trim();
        const marke = String(station.brand || '').trim();
        const ort = station.place ? ' (' + station.place + ')' : '';
        const eintrag = (marke && marke === name ? marke + ort : (marke + ort + ' ' + name)).trim();
        // API (#123): Preise je Sorte, z. B. { e10: 1.759 }; null, wenn die Sorte fehlt
        const wert = mitPreis && station.prices ? station.prices[sorte] : null;
        const preis = typeof wert === 'number' ? wert.toFixed(3) : null;

        const li = document.createElement('li');
        li.className = 'list-group-item list-group-item-action';
        li.style.cursor = 'pointer';
        li.textContent = (marke ? marke + ' – ' : '') + name + ' – ' + (preis ? preis + ' €/L' : 'Preis n/a');
        li.addEventListener('click', () => {
            document.getElementById('standort').value = eintrag;
            if (preis) {
                // Tankstellenpreis gilt als eingetragen und wird nicht mehr überschrieben (#94)
                if (rechner) rechner.setze('preis', preis);
            }
            // Weiter mit der Menge
            document.getElementById('menge').focus();
            vorschlaegeAusblenden();
        });
        liste.append(li);
    });
    vorschlaege.append(liste);
}

function sucheTankstellen(lat, lng, radius, ortHinweis) {
    let type = getSelectedKraftstoff();
    const mitPreis = isPreisTyp(type);
    if (!mitPreis) type = 'all';
    zeigeLaden('Tankstellen werden gesucht …');
    const params = new URLSearchParams({ lat, lng, radius, type });
    fetch('../api/tankstellen.php?' + params)
        .then(response => response.json().catch(() => ({})).then(data => {
            if (!response.ok) throw new Error(data.error || ('Status ' + response.status));
            return data;
        }))
        .then(data => zeigeTankstellen(data.stations, mitPreis, type, ortHinweis))
        .catch(err => zeigeHinweis('danger', 'Fehler bei der Tankstellenabfrage.', err.message))
        .finally(sucheBeenden);
}


// Preis vom letzten Ladevorgang an diesem Ort übernehmen, wenn noch keiner eingetragen ist
function preisAusHistorie(ort) {
    if (stationsArt !== 'lade') return;
    const preis = letztePreise[String(ort || '').trim()];
    const feld = document.getElementById('preis_pro_einheit');
    if (!preis || !feld || feld.value !== '') return;
    feld.value = preis.toFixed(3);
    feld.dispatchEvent(new Event('input', { bubbles: true }));
    const hinweis = document.getElementById('calcHint');
    hinweis.textContent = (hinweis.textContent ? hinweis.textContent + ' ' : '') + 'Preis vom letzten Laden hier übernommen.';
}
document.getElementById('standort').addEventListener('change', e => preisAusHistorie(e.target.value));

function zeigeLadestationen(stations, ortHinweis) {
    vorschlaege.replaceChildren();
    if (!stations || stations.length === 0) {
        zeigeHinweis('warning', 'Keine Ladestationen gefunden.', ortHinweis);
        return;
    }
    const liste = document.createElement('ul');
    liste.className = 'list-group';
    stations.forEach(station => {
        const li = document.createElement('li');
        li.className = 'list-group-item list-group-item-action' + (station.isOperational ? '' : ' text-body-secondary');
        li.style.cursor = 'pointer';
        const titel = document.createElement('div');
        titel.className = 'fw-semibold';
        // Betreiber nur nennen, wenn er nicht schon im Namen steckt ("Aldi Süd Bopfingen")
        const betreiber = station.operator && !station.name.toLowerCase().includes(station.operator.toLowerCase()) ? station.operator : '';
        titel.textContent = station.name + (betreiber ? ' – ' + betreiber : '');
        const details = document.createElement('div');
        details.className = 'small text-body-secondary';
        details.textContent = [
            station.distanceKm !== null ? String(station.distanceKm).replace('.', ',') + ' km' : '',
            station.maxKw ? 'bis ' + String(station.maxKw).replace('.', ',') + ' kW' : '',
            (station.connectors || []).join(', '),
            station.points ? station.points + ' Ladepunkte' : '',
            station.isOperational ? '' : 'außer Betrieb',
        ].filter(Boolean).join(' · ');
        li.append(titel, details);
        if (station.usageCost) {
            const kosten = document.createElement('div');
            kosten.className = 'small';
            kosten.textContent = 'Kosten laut Betreiber: ' + station.usageCost;
            li.append(kosten);
        }
        li.addEventListener('click', () => {
            const ort = station.place && !station.name.includes(station.place) ? station.name + ' (' + station.place + ')' : station.name;
            document.getElementById('standort').value = ort;
            preisAusHistorie(ort);
            vorschlaegeAusblenden();
        });
        liste.append(li);
    });
    const quelle = document.createElement('div');
    quelle.className = 'small text-body-secondary mt-1';
    quelle.textContent = 'Daten: Open Charge Map (CC BY 4.0)';
    vorschlaege.append(liste, quelle);
}

function sucheLadestationen(lat, lng, radius, ortHinweis) {
    zeigeLaden('Ladestationen werden gesucht …');
    const params = new URLSearchParams({ lat, lng, radius });
    fetch('../api/ladestationen.php?' + params)
        .then(response => response.json().catch(() => ({})).then(data => {
            if (!response.ok) throw new Error(data.error || ('Status ' + response.status));
            return data;
        }))
        .then(data => zeigeLadestationen(data.stations, ortHinweis))
        .catch(err => zeigeHinweis('danger', 'Fehler bei der Ladestationssuche.', err.message))
        .finally(sucheBeenden);
}

// Je nach Antriebsart Tankstellen (Tankerkönig) oder Ladestationen (Open Charge Map) suchen
function sucheStationen(lat, lng, radius, ortHinweis) {
    return stationsArt === 'lade' ? sucheLadestationen(lat, lng, radius, ortHinweis) : sucheTankstellen(lat, lng, radius, ortHinweis);
}

function sucheUeberOrt(frage) {
    const ort = prompt(frage);
    if (!ort) {
        sucheBeenden();
        return;
    }
    zeigeLaden('Standort wird gesucht …');
    fetch('https://nominatim.openstreetmap.org/search?format=json&countrycodes=de&addressdetails=1&q=' + encodeURIComponent(ort))
        .then(res => res.json())
        .then(geo => {
            if (!geo.length) {
                zeigeHinweis('warning', 'Ort nicht gefunden.', 'PLZ/Ort: ' + ort);
                sucheBeenden();
                return;
            }
            sucheStationen(geo[0].lat, geo[0].lon, 15, 'PLZ/Ort: ' + ort);
        })
        .catch(() => {
            zeigeHinweis('danger', 'Ort konnte nicht gesucht werden.');
            sucheBeenden();
        });
}

if (btnSuche) btnSuche.addEventListener('click', function () {
    this.disabled = true;
    this.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    if (!navigator.geolocation) {
        sucheUeberOrt('Standortermittlung nicht möglich. Bitte Postleitzahl (PLZ) oder Ort eingeben:');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        position => sucheStationen(position.coords.latitude, position.coords.longitude, 5, null),
        () => sucheUeberOrt('Standort konnte nicht ermittelt werden. Bitte Postleitzahl (PLZ) oder Ort eingeben:')
    );
});
</script>

<?php
$tachoAnschaffung = $vehicle['odometer_km'] ?? null;
include '../includes/tacho_pruefung.php';
include '../includes/footer.php'; ?>