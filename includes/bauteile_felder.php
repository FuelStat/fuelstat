<?php
// Eingabefelder für Bauteile (#78) an Werkstatt-, Wartungs-, Reparatur- und Reifen-Einträgen.
// Erwartet $bauteilKatalog (Antwort von GET /vehicles/:id/parts) und optional $bauteilGewaehlt (parts eines Eintrags
// zum Vorbelegen), $bauteilSichtbar (bool). Das Skript am Ende zeigt den Block nur bei Kategorien mit data-bauteile.
$bauteilKatalog = $bauteilKatalog ?? ['parts' => [], 'groups' => []];
$bauteilGewaehlt = $bauteilGewaehlt ?? [];
$bauteilSichtbar = $bauteilSichtbar ?? false;
$gewaehlt = [];
foreach ($bauteilGewaehlt as $g) {
    $gewaehlt[$g['key']] = $g['cost_share'] ?? null;
}
$nachGruppe = [];
foreach ($bauteilKatalog['parts'] ?? [] as $p) {
    $nachGruppe[$p['group']][] = $p;
}
$gruppenNamen = array_column($bauteilKatalog['groups'] ?? [], 'name', 'key') + ['eigene' => 'Eigene'];
?>
<fieldset id="bauteileFeld" class="mb-3"<?= $bauteilSichtbar ? '' : ' hidden' ?>>
    <legend class="form-label fs-6">Bauteile <span class="fw-normal text-body-secondary">(optional)</span></legend>
    <p class="form-text mt-0">Was wurde gewechselt? Daraus entsteht die Service-Historie mit Lebensdauer und nächstem Wechsel. Bei mehreren Bauteilen kannst du den Anteil am Betrag angeben; ohne Anteil bleibt er unbekannt.</p>
    <?php foreach ($nachGruppe as $gruppe => $teile): ?>
        <div class="fs-label mt-2"><?= htmlspecialchars($gruppenNamen[$gruppe] ?? $gruppe) ?></div>
        <?php foreach ($teile as $p): $an = array_key_exists($p['key'], $gewaehlt); $id = 'bt_' . md5($p['key']); ?>
        <div class="d-flex align-items-center gap-2 bauteil-zeile" data-key="<?= htmlspecialchars($p['key']) ?>">
            <div class="form-check flex-grow-1 mb-0">
                <input class="form-check-input" type="checkbox" name="bauteil[]" id="<?= $id ?>" value="<?= htmlspecialchars($p['key']) ?>" <?= $an ? 'checked' : '' ?>>
                <label class="form-check-label" for="<?= $id ?>"><?= htmlspecialchars($p['name']) ?></label>
            </div>
            <div class="input-group input-group-sm bauteil-anteil" style="max-width: 9rem"<?= $an ? '' : ' hidden' ?>>
                <input type="number" inputmode="decimal" class="form-control" name="anteil[<?= htmlspecialchars($p['key']) ?>]" min="0" step="0.01" placeholder="Anteil" aria-label="<?= htmlspecialchars('Anteil für ' . $p['name'] . ' in Euro') ?>" value="<?= $an && $gewaehlt[$p['key']] !== null ? htmlspecialchars((string)$gewaehlt[$p['key']]) : '' ?>">
                <span class="input-group-text">€</span>
            </div>
        </div>
        <?php endforeach; ?>
    <?php endforeach; ?>
    <div class="mt-3">
        <label class="form-label" for="bauteil_neu">Anderes Bauteil</label>
        <input type="text" class="form-control" id="bauteil_neu" name="bauteil_neu" maxlength="40" placeholder="z. B. Dachträger, Wischerblätter">
    </div>
</fieldset>
<script>
(function () {
    var feld = document.getElementById('bauteileFeld');
    // Anteil-Feld nur bei angehaktem Bauteil
    feld.querySelectorAll('.bauteil-zeile input[type=checkbox]').forEach(function (box) {
        box.addEventListener('change', function () {
            var anteil = box.closest('.bauteil-zeile').querySelector('.bauteil-anteil');
            anteil.hidden = !box.checked;
            if (!box.checked) anteil.querySelector('input').value = '';
        });
    });
    // Block nur bei Kategorien mit Bauteilen (data-bauteile an der Option); die Felder der anderen Kategorien nicht mitschicken
    var wahl = document.getElementById('kategorie');
    if (!wahl) return;
    var umschalten = function () {
        var o = wahl.options[wahl.selectedIndex];
        var ja = Boolean(o && o.dataset.bauteile);
        feld.hidden = !ja;
        feld.querySelectorAll('input').forEach(function (f) { f.disabled = !ja; });
    };
    wahl.addEventListener('change', umschalten);
    umschalten();
})();
</script>
