<?php
// Status des Fahrzeugs (#79): aktiv, verkauft oder stillgelegt. Verkaufte und stillgelegte Fahrzeuge sind archiviert
// und nur lesbar. Erwartet: $fahrzeug (aus der API), $fahrzeug_id
$st = (string)($fahrzeug['status'] ?? 'active');
$feldWert = fn(string $k) => htmlspecialchars((string)($fahrzeug[$k] ?? ''));
$heute = date('Y-m-d');
?>
<div class="card mt-4" id="status">
    <div class="card-body">
        <h2 class="h5 card-title"><i class="fas fa-box-archive text-primary me-2" aria-hidden="true"></i>Status</h2>
        <?php if ($st !== 'active'): ?>
        <p class="fs-label"><?= htmlspecialchars(fahrzeugStatusText($fahrzeug)) ?>. Das Fahrzeug ist archiviert und nur lesbar: alle Daten bleiben erhalten, Erinnerungen und der Monatsbericht entfallen.</p>
        <?php else: ?>
        <p class="fs-label">Beim Verkauf oder bei einer Stilllegung wandert das Fahrzeug ins Archiv. Alle Daten bleiben lesbar.</p>
        <?php endif; ?>
        <form method="post" action="fahrzeug_status.php" id="statusForm" novalidate>
            <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
            <div class="mb-3">
                <label for="fzStatus" class="form-label">Status</label>
                <select id="fzStatus" name="status" class="form-select">
                    <option value="active"<?= $st === 'active' ? ' selected' : '' ?>>Aktiv</option>
                    <option value="sold"<?= $st === 'sold' ? ' selected' : '' ?>>Verkauft</option>
                    <option value="decommissioned"<?= $st === 'decommissioned' ? ' selected' : '' ?>>Stillgelegt</option>
                </select>
            </div>
            <div class="row g-3 mb-3" data-status="sold"<?= $st === 'sold' ? '' : ' hidden' ?>>
                <div class="col-md-4"><label for="saleDate" class="form-label">Verkauft am</label><input type="date" id="saleDate" name="saleDate" class="form-control" max="<?= $heute ?>" value="<?= $feldWert('sale_date') ?>"></div>
                <div class="col-6 col-md-4"><label for="saleOdometerKm" class="form-label">Tachostand (km)</label><input type="number" id="saleOdometerKm" name="saleOdometerKm" class="form-control" min="0" inputmode="numeric" value="<?= $feldWert('sale_odometer_km') ?>"></div>
                <div class="col-6 col-md-4"><label for="salePrice" class="form-label">Verkaufserlös (€)</label><input type="number" id="salePrice" name="salePrice" class="form-control" min="0" step="0.01" inputmode="decimal" value="<?= isset($fahrzeug['sale_price']) ? htmlspecialchars((string)(float)$fahrzeug['sale_price']) : '' ?>"></div>
            </div>
            <div class="row g-3 mb-3" data-status="decommissioned"<?= $st === 'decommissioned' ? '' : ' hidden' ?>>
                <div class="col-6"><label for="decommissionedFrom" class="form-label">Stillgelegt ab</label><input type="date" id="decommissionedFrom" name="decommissionedFrom" class="form-control" value="<?= $feldWert('decommissioned_from') ?>"></div>
                <div class="col-6"><label for="decommissionedUntil" class="form-label">Abgemeldet bis (optional)</label><input type="date" id="decommissionedUntil" name="decommissionedUntil" class="form-control" value="<?= $feldWert('decommissioned_until') ?>"></div>
                <div class="form-text">Das Fahrzeug wird nicht von selbst wieder aktiv, auch nicht nach diesem Datum.</div>
            </div>
            <button type="submit" class="btn btn-secondary"><i class="fas fa-check me-1" aria-hidden="true"></i>Status speichern</button>
        </form>
    </div>
</div>
<script>
(function () {
  var auswahl = document.getElementById('fzStatus');
  function zeige() {
    document.querySelectorAll('#statusForm [data-status]').forEach(function (b) { b.hidden = b.dataset.status !== auswahl.value; });
  }
  auswahl.addEventListener('change', zeige);
})();
</script>
