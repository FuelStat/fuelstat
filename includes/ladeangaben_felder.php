<?php
// Eingabefelder für Ladeangaben (#25), nur beim Laden sichtbar. Alles optional.
// Erwartet optional $ladeWerte (Zeile eines Ladevorgangs aus der API) zum Vorbelegen beim Bearbeiten.
$ladeWerte = $ladeWerte ?? [];
$ladeSichtbar = $ladeSichtbar ?? false;
?>
<div id="ladeAngaben" class="mb-3"<?= $ladeSichtbar ? '' : ' hidden' ?>>
    <div class="row g-2">
        <div class="col-12 col-md-6">
            <label class="form-label" for="ladeart">Ladeart</label>
            <select class="form-select" id="ladeart" name="ladeart">
                <option value="">Keine Angabe</option>
                <?php foreach (ladearten() as $schluessel => $name): ?>
                    <option value="<?= htmlspecialchars($schluessel) ?>" <?= ($ladeWerte['charge_type'] ?? null) === $schluessel ? 'selected' : '' ?>><?= htmlspecialchars($name) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="col-6 col-md-3">
            <label class="form-label" for="soc_vorher">Ladestand vorher</label>
            <div class="input-group">
                <input type="number" inputmode="numeric" class="form-control" id="soc_vorher" name="soc_vorher" min="0" max="100" step="1" value="<?= htmlspecialchars((string)($ladeWerte['soc_before_pct'] ?? '')) ?>">
                <span class="input-group-text">%</span>
            </div>
        </div>
        <div class="col-6 col-md-3">
            <label class="form-label" for="soc_nachher">Ladestand nachher</label>
            <div class="input-group">
                <input type="number" inputmode="numeric" class="form-control" id="soc_nachher" name="soc_nachher" min="0" max="100" step="1" value="<?= htmlspecialchars((string)($ladeWerte['soc_after_pct'] ?? '')) ?>">
                <span class="input-group-text">%</span>
            </div>
        </div>
        <div class="col-12 col-md-6">
            <label class="form-label" for="ladedauer">Ladedauer</label>
            <div class="input-group">
                <input type="number" inputmode="numeric" class="form-control" id="ladedauer" name="ladedauer" min="1" max="4320" step="1" value="<?= htmlspecialchars((string)($ladeWerte['charge_minutes'] ?? '')) ?>">
                <span class="input-group-text">Minuten</span>
            </div>
        </div>
    </div>
    <div class="form-text">Optional. Mit dem Ladestand nachher rechnet Fuelstat den Verbrauch auch ohne „voll geladen“ aus.</div>
</div>
