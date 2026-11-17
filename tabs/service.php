<?php
// Reiter "Service" (#78): Service-Historie je Bauteil – letzter Wechsel, Lebensdauer, nächster Wechsel, Historie und
// Wechselintervall. Alle Zahlen rechnet die API (/vehicles/:id/service); hier wird nur angezeigt.
include_once __DIR__ . '/../includes/api_helpers.php';

$service = ['parts' => []];
$katalog = ['parts' => []];
$serviceFehler = false;
try {
    $service = $api->getVehicleService($fahrzeug_id);
    $katalog = $api->getVehicleParts($fahrzeug_id);
} catch (Throwable $e) {
    $serviceFehler = true;
    error_log('[Service] ' . $e->getMessage());
}
$teile = $service['parts'] ?? [];
$eigene = array_values(array_filter($katalog['parts'] ?? [], fn($p) => empty($p['builtin'])));
$zahl = fn($wert, int $stellen = 0) => number_format((float)$wert, $stellen, ',', '.');
$tag = fn(?string $d) => $d ? date('d.m.Y', strtotime($d)) : '–';
$euroText = fn($v) => $v === null ? 'Kosten unbekannt' : $zahl($v, 2) . ' €';
$serviceUrl = '../pages/service_speichern.php';
?>
<div class="mt-3 mt-lg-4">
    <?php if ($serviceFehler): ?>
        <div class="alert alert-danger">Die Service-Historie konnte gerade nicht geladen werden. Bitte versuche es gleich noch einmal.</div>
    <?php endif; ?>

    <?php if (!$teile): ?>
    <div class="card leer-zustand">
        <div class="card-body">
            <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-screwdriver-wrench"></i></span>
            <h2 class="h4">Noch keine Bauteile erfasst</h2>
            <p class="text-body-secondary mb-3">Trag bei einer Wartung ein, was gewechselt wurde, dann siehst du hier Lebensdauer und nächsten Wechsel.</p>
            <?php if ($darfErfassen): ?><a class="btn btn-primary" href="../pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= urlencode($fahrzeug_id) ?>&kategorie=Wartung"><i class="fas fa-plus" aria-hidden="true"></i>Wartung erfassen</a><?php endif; ?>
        </div>
    </div>
    <?php else: ?>
    <div class="card">
        <div class="card-header d-flex justify-content-between align-items-center">
            <h2 class="mb-0">Service je Bauteil</h2>
            <?php if ($darfErfassen): ?><a href="../pages/eintrag_hinzufuegen.php?fahrzeug_id=<?= urlencode($fahrzeug_id) ?>&kategorie=Wartung" class="btn btn-secondary btn-sm">Wechsel erfassen</a><?php endif; ?>
        </div>
        <ul class="list-group list-group-flush">
            <?php foreach ($teile as $t):
                $letzter = $t['last'] ?? null;
                $naechster = $t['next'] ?? null;
                $lebensdauer = $t['lifetime'] ?? null;
                $intervall = $t['interval'] ?? null;
                $idKey = 'teil_' . md5($t['key']);
            ?>
            <li class="list-group-item">
                <div class="d-flex align-items-center gap-3">
                    <?= symbolKreis($t['icon'] ?? 'fa-screwdriver-wrench', 'var(--fs-brand)') ?>
                    <div class="flex-grow-1 min-w-0">
                        <div class="fs-headline"><?= htmlspecialchars($t['name']) ?></div>
                        <div class="fs-label">
                            <?php if ($letzter): ?>
                                zuletzt <?= $tag($letzter['date']) ?><?= $letzter['odometer_km'] !== null ? ' · ' . $zahl($letzter['odometer_km']) . ' km' : '' ?>
                            <?php else: ?>
                                noch kein Wechsel erfasst
                            <?php endif; ?>
                        </div>
                    </div>
                    <?php if ($naechster):
                        $text = $naechster['source'] === 'lifetime'
                            ? 'ca. ' . ($naechster['due_date'] ? $tag($naechster['due_date']) : ($naechster['due_km'] !== null ? 'bei ' . $zahl($naechster['due_km']) . ' km' : '–'))
                            : ($naechster['days'] !== null ? terminAbstand((int)$naechster['days']) : 'bei ' . $zahl($naechster['due_km']) . ' km');
                        echo statusBadge($naechster['status'], $text, 'text-nowrap');
                    endif; ?>
                </div>
                <details class="mt-2" id="<?= $idKey ?>">
                    <summary class="fs-label">Lebensdauer, Historie<?= $darfErfassen ? ' und Intervall' : '' ?></summary>
                    <div class="row g-2 mt-1">
                        <div class="col-6 col-md-3"><div class="fs-label">Wechsel</div><div class="zahl"><?= (int)$t['changes'] ?>×</div></div>
                        <div class="col-6 col-md-3"><div class="fs-label">Kosten bekannt</div><div class="zahl"><?= $zahl($t['total_cost'] ?? 0, 2) ?> €</div></div>
                        <div class="col-6 col-md-3"><div class="fs-label">Ø Lebensdauer</div><div class="zahl"><?= $lebensdauer && $lebensdauer['avgKm'] !== null ? $zahl($lebensdauer['avgKm']) . ' km' : '–' ?></div></div>
                        <div class="col-6 col-md-3"><div class="fs-label">Ø Monate</div><div class="zahl"><?= $lebensdauer && $lebensdauer['avgMonths'] !== null ? $zahl($lebensdauer['avgMonths'], 1) : '–' ?></div></div>
                    </div>
                    <?php if ($naechster): ?>
                    <p class="fs-label mt-2 mb-0">
                        Nächster Wechsel <?= $naechster['source'] === 'lifetime' ? 'geschätzt aus der bisherigen Lebensdauer' : 'nach deinem Intervall' ?>:
                        <?= $naechster['due_date'] ? $tag($naechster['due_date']) : '' ?><?= $naechster['due_date'] && $naechster['due_km'] !== null ? ' oder ' : '' ?><?= $naechster['due_km'] !== null ? 'bei ' . $zahl($naechster['due_km']) . ' km' : '' ?>.
                    </p>
                    <?php elseif ($letzter && !$lebensdauer): ?>
                    <p class="fs-label mt-2 mb-0">Ein nächster Wechsel lässt sich nach dem zweiten Wechsel schätzen, oder du legst ein Intervall fest.</p>
                    <?php endif; ?>

                    <?php if (!empty($t['history'])): ?>
                    <ul class="list-unstyled mt-2 mb-0">
                        <?php foreach ($t['history'] as $h): ?>
                        <li class="d-flex justify-content-between gap-2 py-1 border-top">
                            <span class="min-w-0">
                                <a class="tipp-link" href="../pages/eintrag_bearbeiten.php?id=<?= urlencode($h['entry_id']) ?>&fahrzeug_id=<?= urlencode($fahrzeug_id) ?>&type=entry"><?= $tag($h['date']) ?></a>
                                <span class="fs-label"><?= $h['odometer_km'] !== null ? ' · ' . $zahl($h['odometer_km']) . ' km' : '' ?><?= !empty($h['vendor']) ? ' · ' . htmlspecialchars($h['vendor']) : '' ?></span>
                            </span>
                            <span class="zahl text-nowrap"><?= $h['cost'] !== null ? $zahl($h['cost'], 2) . ' €' : '<span class="fs-label">Kosten unbekannt</span>' ?></span>
                        </li>
                        <?php endforeach; ?>
                    </ul>
                    <?php if ((int)$t['changes'] > count($t['history'])): ?><p class="fs-label mb-0">Die letzten <?= count($t['history']) ?> von <?= (int)$t['changes'] ?> Wechseln.</p><?php endif; ?>
                    <?php endif; ?>

                    <?php if ($darfAendern): ?>
                    <form method="post" action="<?= htmlspecialchars($serviceUrl) ?>" class="row g-2 align-items-end mt-2">
                        <input type="hidden" name="aktion" value="intervall">
                        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                        <input type="hidden" name="teil" value="<?= htmlspecialchars($t['key']) ?>">
                        <div class="col-6 col-md-3">
                            <label class="form-label" for="<?= $idKey ?>_m">Intervall (Monate)</label>
                            <input type="number" class="form-control" id="<?= $idKey ?>_m" name="monate" min="1" max="240" inputmode="numeric" value="<?= htmlspecialchars((string)($intervall['months'] ?? '')) ?>">
                        </div>
                        <div class="col-6 col-md-3">
                            <label class="form-label" for="<?= $idKey ?>_k">Intervall (km)</label>
                            <input type="number" class="form-control" id="<?= $idKey ?>_k" name="km" min="1000" max="1000000" step="1000" inputmode="numeric" value="<?= htmlspecialchars((string)($intervall['km'] ?? '')) ?>">
                        </div>
                        <div class="col-12 col-md-auto"><button type="submit" class="btn btn-secondary">Intervall speichern</button></div>
                        <div class="form-text">Was zuerst kommt, gilt. Leer lassen, um das Intervall zu entfernen<?= $t['key'] === 'oil' ? ' (gilt auch in den Fahrzeugdaten)' : '' ?>.</div>
                    </form>
                    <?php endif; ?>
                </details>
            </li>
            <?php endforeach; ?>
        </ul>
    </div>
    <?php endif; ?>

    <?php if ($darfErfassen): ?>
    <!-- Eigene Bauteile des Fahrzeugs: anlegen und entfernen; zum Auswählen beim Erfassen -->
    <div class="card mt-3">
        <div class="card-body">
            <h3 class="h6 mb-2">Eigene Bauteile</h3>
            <?php if ($eigene): ?>
            <ul class="list-unstyled mb-3">
                <?php foreach ($eigene as $p): ?>
                <li class="d-flex align-items-center justify-content-between gap-2 py-1">
                    <span><?= htmlspecialchars($p['name']) ?></span>
                    <form method="post" action="<?= htmlspecialchars($serviceUrl) ?>" class="m-0" onsubmit="return confirm(<?= htmlspecialchars(json_encode('„' . $p['name'] . '“ entfernen? Es verschwindet von allen Einträgen, die Einträge bleiben.', JSON_UNESCAPED_UNICODE), ENT_QUOTES) ?>);">
                        <input type="hidden" name="aktion" value="bauteil_loeschen">
                        <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                        <input type="hidden" name="teil_id" value="<?= htmlspecialchars((string)$p['id']) ?>">
                        <button type="submit" class="btn btn-sm btn-secondary" aria-label="<?= htmlspecialchars('„' . $p['name'] . '“ entfernen') ?>">Entfernen</button>
                    </form>
                </li>
                <?php endforeach; ?>
            </ul>
            <?php endif; ?>
            <form method="post" action="<?= htmlspecialchars($serviceUrl) ?>" class="d-flex gap-2">
                <input type="hidden" name="aktion" value="bauteil_neu">
                <input type="hidden" name="fahrzeug_id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
                <label class="visually-hidden" for="eigenesBauteil">Name des neuen Bauteils</label>
                <input type="text" class="form-control" id="eigenesBauteil" name="name" maxlength="40" placeholder="z. B. Dachträger, Wischerblätter" required>
                <button type="submit" class="btn btn-secondary text-nowrap">Hinzufügen</button>
            </form>
        </div>
    </div>
    <?php endif; ?>
</div>
