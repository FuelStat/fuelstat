<?php
include '../includes/session.php';
include '../includes/functions.php';
include '../includes/header.php';

if (!isset($_GET['id'], $_GET['fahrzeug_id'])) {
    die("Eintrag-ID oder Fahrzeug-ID fehlt.");
}
$eintrag_id = trim($_GET['id']);
$fahrzeug_id = trim($_GET['fahrzeug_id']);
$type = $_GET['type'] ?? 'fillup';

if ($type === 'entry') {
    try {
        $eintrag = $api->getEntry($eintrag_id);
    } catch (Throwable $e) {
        die("Eintrag nicht gefunden.");
    }
    $kategorie = (string)($eintrag['category'] ?? '');
    // Formular je Art (#95): normale Ausgabe, Fahrt oder notierter Kilometerstand
    $art = kategorieFormular($kategorie);
    $artTitel = ['trip' => 'Fahrt', 'odometer' => 'Kilometerstand'][$art] ?? 'Ausgabe';
    $datum = isset($eintrag['occurred_at']) ? date('Y-m-d', strtotime($eintrag['occurred_at'])) : '';
    $tachostand = $eintrag['odometer_km'] ?? null;
    $fahrt = $art === 'trip' ? fahrtAusBeschreibung($eintrag['description'] ?? '') : null;
    $katalog = kategorienKatalog();
    $zurueck = 'fahrzeug_detail.php?id=' . urlencode($fahrzeug_id) . '#eintraege';
    ?>
<div class="container eintrag-formular mt-3 mt-lg-5">
    <h1 class="h3 d-none d-lg-block mb-3"><?= $artTitel ?> bearbeiten</h1>
    <form method="post" action="eintrag_update.php" id="eintragFormular">
        <input type="hidden" name="id" value="<?= htmlspecialchars($eintrag_id) ?>">
        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
        <input type="hidden" name="type" value="entry">
        <?php if ($art !== 'expense'): ?>
            <input type="hidden" name="kategorie" value="<?= htmlspecialchars($kategorie) ?>">
        <?php endif; ?>

        <div class="row g-3 mb-3">
            <div class="col-7">
                <label class="form-label fw-semibold" for="tachostand">Tachostand (km)</label>
                <input type="number" class="form-control form-control-lg" id="tachostand" name="tachostand" min="0" step="1" inputmode="numeric" pattern="[0-9]*"
                       value="<?= $tachostand !== null ? (int)$tachostand : '' ?>" <?= $art === 'odometer' ? 'required' : 'placeholder="optional"' ?>>
            </div>
            <div class="col-5">
                <label class="form-label fw-semibold" for="datum">Datum</label>
                <input type="date" class="form-control form-control-lg" id="datum" name="datum" value="<?= htmlspecialchars($datum) ?>" required>
            </div>
        </div>

        <?php if ($art === 'expense'): ?>
        <div class="row g-2 mb-1">
            <div class="col-7">
                <label class="form-label" for="kategorie">Kategorie</label>
                <select class="form-select" id="kategorie" name="kategorie" required>
                    <?= kategorieOptionen($kategorie, false) ?>
                </select>
            </div>
            <div class="col-5">
                <label class="form-label" for="kosten">Kosten (€)</label>
                <input type="number" inputmode="decimal" step="0.01" class="form-control" id="kosten" name="kosten" value="<?= htmlspecialchars((string)(float)($eintrag['amount_eur'] ?? 0)) ?>" min="0" required>
            </div>
        </div>
        <div class="form-text mb-3">
            <?php if (($katalog['custom']['max'] ?? 0) > 0): ?>
                <a href="kategorien.php?zurueck=<?= urlencode($_SERVER['REQUEST_URI'] ?? '') ?>"><i class="fas fa-tags me-1"></i>Eigene Kategorien verwalten</a>
            <?php elseif (kategorienHatGesperrte()): ?>
                <i class="fas fa-lock me-1"></i>Weitere Kategorien und eigene Kategorien gibt es mit Plus.
            <?php endif; ?>
        </div>
        <div class="mb-3">
            <label class="form-label" for="standort">Anbieter / Ort</label>
            <input type="text" class="form-control" id="standort" name="standort" value="<?= htmlspecialchars($eintrag['vendor'] ?? '') ?>" placeholder="optional">
        </div>
        <div class="mb-3">
            <label class="form-label" for="beschreibung">Beschreibung</label>
            <textarea class="form-control" id="beschreibung" name="beschreibung" rows="2" placeholder="optional"><?= htmlspecialchars($eintrag['description'] ?? '') ?></textarea>
        </div>
        <?php elseif ($art === 'trip'): ?>
        <div class="row g-2 mb-3">
            <div class="col-6"><label for="startort" class="form-label">Von</label><input type="text" id="startort" name="startort" class="form-control" value="<?= htmlspecialchars($fahrt['startort']) ?>"></div>
            <div class="col-6"><label for="zielort" class="form-label">Nach</label><input type="text" id="zielort" name="zielort" class="form-control" value="<?= htmlspecialchars($fahrt['zielort']) ?>"></div>
            <div class="col-7"><label for="zweck" class="form-label">Zweck</label><input type="text" id="zweck" name="zweck" class="form-control" value="<?= htmlspecialchars($fahrt['zweck']) ?>"></div>
            <div class="col-5"><label for="gefahrene_km" class="form-label">km</label><input type="number" inputmode="decimal" id="gefahrene_km" name="gefahrene_km" class="form-control" min="0" step="0.1" value="<?= htmlspecialchars($fahrt['gefahrene_km']) ?>"></div>
        </div>
        <?php else: ?>
        <div class="mb-3">
            <label for="beschreibung" class="form-label">Notiz (optional)</label>
            <input type="text" id="beschreibung" name="beschreibung" class="form-control" value="<?= htmlspecialchars($eintrag['description'] ?? '') ?>" placeholder="z. B. Parkhaus Bahnhof">
        </div>
        <?php endif; ?>

        <!-- Mobil unten fest über der App-Leiste -->
        <div class="formular-aktionen">
            <button type="submit" class="btn btn-primary btn-lg flex-grow-1"><i class="fas fa-check me-1"></i>Speichern</button>
            <a href="<?= htmlspecialchars($zurueck) ?>" class="btn btn-outline-secondary btn-lg">Abbrechen</a>
        </div>
    </form>
    <form method="post" action="eintrag_loeschen.php" onsubmit="return confirm(<?= htmlspecialchars(json_encode('Möchtest du diesen Eintrag (' . $artTitel . ') wirklich löschen?', JSON_UNESCAPED_UNICODE), ENT_QUOTES) ?>);" class="mt-4 mb-4">
        <input type="hidden" name="id" value="<?= htmlspecialchars($eintrag_id) ?>">
        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
        <input type="hidden" name="type" value="entry">
        <button type="submit" class="btn btn-link text-danger px-0"><i class="fas fa-trash me-1"></i><?= $artTitel ?> löschen</button>
    </form>
</div>
    <?php
    $tachoAusnahmeId = $eintrag_id;
    include '../includes/tacho_pruefung.php';
    include '../includes/footer.php';
    exit;
}

try {
    $eintrag = $api->getFillup($eintrag_id);
} catch (Throwable $e) {
    die("Eintrag nicht gefunden.");
}

$datum = isset($eintrag['filled_at']) ? date('Y-m-d', strtotime($eintrag['filled_at'])) : '';
$fahrzeugFuerSorten = [];
try {
    $fahrzeugFuerSorten = $api->getVehicle($fahrzeug_id);
    $fuelType = $fahrzeugFuerSorten['fuel_type'] ?? 'other';
} catch (Throwable $e) {
    $fuelType = null;
}
// Sorten zur Auswahl (#140): die des Fahrzeugs und die bisherige Sorte des Eintrags
$katalogSorten = sortenKatalog()['sorten'];
$sortenAuswahl = array_values(array_filter(
    array_unique(array_merge($fahrzeugFuerSorten ? sortenDesFahrzeugs($fahrzeugFuerSorten) : [], array_filter([$eintrag['fuel'] ?? null]))),
    fn($k) => isset($katalogSorten[$k])
));
// Plug-in-Hybrid: Begriffe nach der Einheit dieses Eintrags (Tankfüllung oder Ladevorgang)
$begriffe = begriffeFuerEinheit($fuelType, $eintrag['unit'] ?? null);
$istPhev = $fuelType === 'phev';
$tachostand = $eintrag['odometer_km'] ?? null; // null = fehlt (#41)
$tachoGeschaetzt = !empty($eintrag['odometer_estimated']);
$menge = $eintrag['amount'] ?? 0;
$kosten = $eintrag['total_cost_eur'] ?? 0;
$preis_pro_einheit = $eintrag['price_per_unit'] ?? ($menge > 0 ? $kosten / $menge : 0);
$vollgetankt = !empty($eintrag['is_full']);
$skip_previous = !empty($eintrag['skip_previous']);
$standort = $eintrag['station'] ?? '';
$einheit = $eintrag['unit'] ?? 'l';
$bearbeitbar = isset($eintrag['filled_at']) && strtotime($eintrag['filled_at']) >= time() - 14 * 24 * 3600;
?>

<div class="container eintrag-formular mt-3 mt-lg-5">
    <h1 class="h3 d-none d-lg-block mb-3" id="titel"><?= $begriffe['vorgang'] ?> bearbeiten</h1>
    <?php if (!$bearbeitbar): ?>
        <div class="alert alert-info">
            Dieser Eintrag ist älter als 14 Tage und kann nicht mehr geändert werden.
            Bei Bedarf kannst du ihn löschen und neu anlegen.
            <?php if ($tachostand === null || $tachoGeschaetzt): ?>
                Den Tachostand kannst du trotzdem <a href="tachostand_nachtragen.php?id=<?= urlencode($eintrag_id) ?>&amp;fahrzeug_id=<?= urlencode($fahrzeug_id) ?>">nachtragen</a>.
            <?php endif; ?>
        </div>
    <?php endif; ?>
    <form method="post" action="eintrag_update.php" id="eintragFormular">
        <input type="hidden" name="id" value="<?= htmlspecialchars($eintrag_id) ?>">
        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
        <input type="hidden" name="type" value="fillup">
        <fieldset <?= $bearbeitbar ? '' : 'disabled' ?>>
        <?php if ($istPhev): ?>
        <!-- Plug-in-Hybrid: falsch zugeordneten Eintrag (Tanken statt Laden) korrigieren; Texte wechseln live -->
        <div class="art-kacheln mb-4" role="radiogroup" aria-label="Getankt oder geladen">
            <?php foreach (['l' => 'Tanken', 'kwh' => 'Laden'] as $u => $name): ?>
                <input type="radio" class="btn-check" name="einheit" id="einheit_<?= $u ?>" value="<?= $u ?>" <?= ($einheit === 'kwh') === ($u === 'kwh') ? 'checked' : '' ?>>
                <label class="art-kachel" for="einheit_<?= $u ?>"><i class="fas <?= begriffeFuerEinheit('phev', $u)['icon'] ?>"></i><span><?= $name ?></span></label>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>

        <div class="row g-3 mb-3">
            <div class="col-12 col-sm-7">
                <label class="form-label fw-semibold" for="tachostand">Tachostand (km)</label>
                <input type="number" class="form-control form-control-lg" id="tachostand" name="tachostand" min="0" step="1" inputmode="numeric" pattern="[0-9]*"
                       value="<?= $tachostand !== null ? (int)$tachostand : '' ?>" placeholder="fehlt – kann leer bleiben">
                <?php if ($tachoGeschaetzt): ?>
                    <!-- Bleibt der Wert unverändert, bleibt er als Schätzung markiert -->
                    <input type="hidden" name="tachostand_geschaetzt_wert" value="<?= (int)$tachostand ?>">
                    <div class="form-text text-warning-emphasis">Geschätzter Wert – bitte durch den echten Tachostand ersetzen.</div>
                <?php endif; ?>
            </div>
            <div class="col-12 col-sm-5">
                <label class="form-label fw-semibold" for="datum">Datum</label>
                <input type="date" class="form-control form-control-lg" id="datum" name="datum" value="<?= htmlspecialchars($datum) ?>" required>
            </div>
        </div>

        <?php if ($sortenAuswahl): ?>
        <!-- Sorte (#140): nur passend zu Tanken bzw. Laden, ab zwei Sorten sichtbar -->
        <div class="mb-3" id="sorteFeld" hidden>
            <label class="form-label" for="sorteAuswahl">Sorte</label>
            <select name="sorte" id="sorteAuswahl" class="form-select">
                <?php foreach ($sortenAuswahl as $key): ?>
                    <option value="<?= htmlspecialchars($key) ?>" data-einheit="<?= htmlspecialchars($katalogSorten[$key]['unit']) ?>" <?= $key === ($eintrag['fuel'] ?? null) ? 'selected' : '' ?>><?= htmlspecialchars($katalogSorten[$key]['name']) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <?php endif; ?>

        <div class="row g-2 mb-3">
            <div class="col-6 col-md-4">
                <label class="form-label" for="menge" id="mengeLabel"><?= einheitLang($einheit) ?></label>
                <div class="input-group">
                    <input type="number" inputmode="decimal" step="0.01" id="menge" name="menge" class="form-control" value="<?= (float)$menge ?>" min="0">
                    <button type="button" class="btn btn-outline-secondary" id="info_menge" aria-label="Herkunft des Werts anzeigen"><i class="fas fa-circle-info"></i></button>
                </div>
            </div>
            <div class="col-6 col-md-4">
                <label class="form-label" for="preis_pro_einheit" id="preisLabel">€/<?= einheitKurz($einheit) ?></label>
                <div class="input-group">
                    <input type="number" inputmode="decimal" step="0.001" id="preis_pro_einheit" name="preis_pro_einheit" class="form-control" value="<?= round((float)$preis_pro_einheit, 3) ?>" min="0">
                    <button type="button" class="btn btn-outline-secondary" id="info_preis_pro_einheit" aria-label="Herkunft des Werts anzeigen"><i class="fas fa-circle-info"></i></button>
                </div>
            </div>
            <div class="col-12 col-md-4">
                <label class="form-label" for="kosten" id="kostenLabel">Gesamt (€)</label>
                <div class="input-group">
                    <input type="number" inputmode="decimal" step="0.01" id="kosten" name="kosten" class="form-control" value="<?= (float)$kosten ?>" min="0">
                    <button type="button" class="btn btn-outline-secondary" id="info_kosten" aria-label="Herkunft des Werts anzeigen"><i class="fas fa-circle-info"></i></button>
                </div>
            </div>
        </div>

        <div class="form-text text-warning-emphasis mb-3" id="rechenHinweis" aria-live="polite"></div>

        <div class="mb-3">
            <label class="form-label" for="standort" id="standortLabel"><?= $begriffe['station'] ?></label>
            <input type="text" class="form-control" id="standort" name="standort" value="<?= htmlspecialchars($standort) ?>">
        </div>
        <div class="form-check form-switch mb-2">
            <input type="checkbox" class="form-check-input" role="switch" id="vollgetankt" name="vollgetankt" value="1" <?= $vollgetankt ? 'checked' : '' ?>>
            <label class="form-check-label" for="vollgetankt" id="vollLabel"><?= $begriffe['voll'] ?></label>
        </div>
        <div class="form-check form-switch mb-3">
            <input type="checkbox" class="form-check-input" role="switch" id="skip_previous" name="skip_previous" value="1" <?= $skip_previous ? 'checked' : '' ?>>
            <label class="form-check-label" for="skip_previous" id="lueckeLabel"><?= $begriffe['luecke'] ?></label>
        </div>
        </fieldset>

        <div class="formular-aktionen">
            <button type="submit" class="btn btn-primary btn-lg flex-grow-1" <?= $bearbeitbar ? '' : 'disabled' ?>><i class="fas fa-check me-1"></i>Speichern</button>
            <a href="fahrzeug_detail.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>#eintraege" class="btn btn-outline-secondary btn-lg">Abbrechen</a>
        </div>
    </form>
    <form method="post" action="eintrag_loeschen.php" onsubmit="return confirm('Möchtest du diesen Eintrag wirklich löschen?');" class="mt-4 mb-4">
        <input type="hidden" name="id" value="<?= htmlspecialchars($eintrag_id) ?>">
        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
        <input type="hidden" name="type" value="fillup">
        <button type="submit" class="btn btn-link text-danger px-0"><i class="fas fa-trash me-1"></i><span id="loeschenText"><?= $begriffe['vorgang'] ?> löschen</span></button>
    </form>
</div>

<script src="<?= htmlspecialchars(assetUrl($baseUrl, 'js/mengen-rechner.js')) ?>"></script>
<script>
// Menge × Preis = Gesamtpreis: beim Bearbeiten gelten Menge und Gesamtpreis als eingetragen, der Preis pro Einheit
// als daraus berechnet. Ändert man den Preis selbst, bleibt er stehen; passt dann etwas nicht zusammen, gibt es einen Hinweis (#94).
window.addEventListener('DOMContentLoaded', () => {
    // Texte je Einheit (Plug-in-Hybrid: Tanken oder Laden), wie beim Erfassen
    const texte = <?= json_encode(array_map(fn($u) => (function ($b) use ($u) {
        return ['lang' => einheitLang($u), 'kurz' => einheitKurz($u), 'station' => $b['station'], 'voll' => $b['voll'], 'luecke' => $b['luecke'], 'vorgang' => $b['vorgang']];
    })(begriffeFuerEinheit($fuelType, $u)), array_combine(einheitenFuerKraftstoff($fuelType), einheitenFuerKraftstoff($fuelType))), JSON_UNESCAPED_UNICODE) ?>;
    let kurz = <?= json_encode(einheitKurz($einheit)) ?>;
    const rechner = mengenRechner({ einheit: () => kurz, eingetragen: ['kosten', 'menge'], hinweis: 'rechenHinweis' });
    // Sorte (#140): beim Tanken nur Kraftstoffe, beim Laden nur Strom
    const sorteAuswahl = document.getElementById('sorteAuswahl');
    const sortenFuerEinheit = (u) => {
        if (!sorteAuswahl) return;
        const laden = u === 'kwh';
        let sichtbar = 0;
        let passt = false;
        for (const o of sorteAuswahl.options) {
            const ok = (o.dataset.einheit === 'kwh') === laden;
            o.hidden = !ok;
            o.disabled = !ok;
            if (ok) { sichtbar++; if (o.selected) passt = true; }
        }
        if (!passt) { const erste = [...sorteAuswahl.options].find(o => !o.disabled); if (erste) erste.selected = true; }
        document.getElementById('sorteFeld').hidden = sichtbar < 2;
    };
    sortenFuerEinheit(<?= json_encode($einheit) ?>);
    document.querySelectorAll('input[name="einheit"]').forEach(radio => radio.addEventListener('change', () => {
        const t = texte[radio.value];
        if (!radio.checked || !t) return;
        kurz = t.kurz;
        document.getElementById('mengeLabel').textContent = t.lang;
        document.getElementById('preisLabel').textContent = '€/' + t.kurz;
        document.getElementById('standortLabel').textContent = t.station;
        document.getElementById('vollLabel').textContent = t.voll;
        document.getElementById('lueckeLabel').textContent = t.luecke;
        document.getElementById('titel').textContent = t.vorgang + ' bearbeiten';
        document.getElementById('loeschenText').textContent = t.vorgang + ' löschen';
        sortenFuerEinheit(radio.value);
        rechner.aktualisiere();
    }));
});
</script>
<?php
$tachoAusnahmeId = $eintrag_id;
include '../includes/tacho_pruefung.php';
include '../includes/footer.php'; ?>
