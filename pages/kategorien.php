<?php
// Kategorien verwalten (#95): feste Kategorien ansehen, eigene anlegen, ändern und löschen (Plus)
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';
if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}

$api = getApiClient();
// Zurück zur aufrufenden Seite (nur Pfade dieser Seite, keine fremden Adressen)
$zurueck = (string)($_GET['zurueck'] ?? $_POST['zurueck'] ?? '');
if (!preg_match('#^/[^/\\\\]#', $zurueck)) {
    $zurueck = '';
}
$selbst = 'kategorien.php' . ($zurueck !== '' ? '?zurueck=' . urlencode($zurueck) : '');

$fehlertexte = [
    'name_taken' => 'Diesen Namen gibt es schon.',
    'missing_name' => 'Bitte einen Namen eingeben.',
    'name_too_long' => 'Der Name darf höchstens 40 Zeichen lang sein.',
    'invalid_name' => 'Dieser Name ist nicht erlaubt.',
    'invalid_icon' => 'Bitte ein Symbol aus der Liste wählen.',
    'invalid_color' => 'Bitte eine Farbe aus der Liste wählen.',
    'invalid_group' => 'Bitte eine Gruppe wählen.',
    'category_limit_reached' => 'Du hast schon die höchste Zahl eigener Kategorien angelegt.',
    'invalid_moveTo' => 'Bitte eine andere Kategorie wählen, in die die Einträge wandern.',
    'category_not_found' => 'Diese Kategorie gibt es nicht mehr.',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $aktion = $_POST['aktion'] ?? '';
    $daten = [
        'name' => trim($_POST['name'] ?? ''),
        'icon' => $_POST['icon'] ?? '',
        'color' => $_POST['color'] ?? '',
        'group' => $_POST['group'] ?? '',
    ];
    try {
        if ($aktion === 'anlegen') {
            $neu = $api->postCategory($daten);
            $_SESSION['success_message'] = 'Kategorie „' . $neu['name'] . '“ angelegt.';
        } elseif ($aktion === 'aendern') {
            $api->patchCategory((string)($_POST['id'] ?? ''), $daten);
            $_SESSION['success_message'] = 'Kategorie gespeichert.';
        } elseif ($aktion === 'loeschen') {
            $r = $api->deleteCategory((string)($_POST['id'] ?? ''), (string)($_POST['move_to'] ?? 'Sonstiges'));
            kategorienLeeren();
            $_SESSION['success_message'] = 'Kategorie gelöscht.' . (($r['moved'] ?? 0) > 0
                ? ' ' . $r['moved'] . ' Einträge gehören jetzt zu „' . getKategorieName($r['moveTo']) . '“.' : '');
        }
    } catch (Throwable $e) {
        $_SESSION['error_message'] = tarifHinweis($e) ?? ($fehlertexte[$e->getMessage()] ?? $e->getMessage());
    }
    kategorienLeeren();
    header('Location: ' . $selbst);
    exit;
}

include '../includes/header.php';
$katalog = kategorienKatalog();
$custom = $katalog['custom'] ?? [];
$eigene = array_values(array_filter($katalog['categories'], fn($k) => !empty($k['custom'])));
$gruppen = array_filter(kategorieGruppen(), fn($g) => $g['key'] !== 'kraftstoff');
$darfEigene = ($custom['max'] ?? 0) > 0;
// Ziele beim Löschen: wählbare Ausgaben-Kategorien außer der zu löschenden
$ziele = fn(string $ohne) => array_filter($katalog['categories'], fn($k) => !empty($k['available']) && ($k['form'] ?? '') === 'expense' && $k['key'] !== $ohne);

// Formularfelder für Name, Symbol, Farbe und Gruppe (Anlegen und Ändern)
$felder = function (string $praefix, array $werte = []) use ($custom, $gruppen) {
    $icon = $werte['icon'] ?? 'fa-tag';
    $farbe = $werte['color'] ?? '#6c757d';
    $gruppe = $werte['group'] ?? 'sonstiges';
    ob_start(); ?>
    <div class="mb-3">
        <label class="form-label" for="<?= $praefix ?>name">Name</label>
        <input type="text" class="form-control" id="<?= $praefix ?>name" name="name" maxlength="<?= (int)($custom['nameMaxLength'] ?? 40) ?>" required value="<?= htmlspecialchars($werte['name'] ?? '') ?>" placeholder="z. B. Fähre oder Autoradio">
    </div>
    <div class="mb-3">
        <span class="form-label d-block">Symbol</span>
        <div class="kategorie-auswahl" role="radiogroup" aria-label="Symbol">
            <?php foreach ($custom['icons'] ?? [] as $i): ?>
                <input type="radio" class="btn-check" name="icon" id="<?= $praefix . $i ?>" value="<?= htmlspecialchars($i) ?>" <?= $i === $icon ? 'checked' : '' ?>>
                <label class="btn btn-outline-secondary kategorie-symbol" for="<?= $praefix . $i ?>" title="<?= htmlspecialchars($i) ?>"><i class="fas <?= htmlspecialchars($i) ?>"></i></label>
            <?php endforeach; ?>
        </div>
    </div>
    <div class="row g-3 mb-3">
        <div class="col-sm-7">
            <span class="form-label d-block">Farbe</span>
            <div class="kategorie-auswahl" role="radiogroup" aria-label="Farbe">
                <?php foreach ($custom['colors'] ?? [] as $c): ?>
                    <input type="radio" class="btn-check" name="color" id="<?= $praefix . ltrim($c, '#') ?>" value="<?= htmlspecialchars($c) ?>" <?= $c === $farbe ? 'checked' : '' ?>>
                    <label class="kategorie-farbe" for="<?= $praefix . ltrim($c, '#') ?>" style="background-color: <?= htmlspecialchars($c) ?>" title="<?= htmlspecialchars($c) ?>"></label>
                <?php endforeach; ?>
            </div>
        </div>
        <div class="col-sm-5">
            <label class="form-label" for="<?= $praefix ?>group">Gruppe in der Auswertung</label>
            <select class="form-select" id="<?= $praefix ?>group" name="group">
                <?php foreach ($gruppen as $g): ?>
                    <option value="<?= htmlspecialchars($g['key']) ?>" <?= $g['key'] === $gruppe ? 'selected' : '' ?>><?= htmlspecialchars($g['name']) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
    </div>
    <?php return ob_get_clean();
};
?>
<div class="container mt-3 mt-lg-5 mb-5" style="max-width: 860px;">
    <div class="d-flex align-items-center gap-2 mb-3">
        <?php if ($zurueck !== ''): ?>
            <a href="<?= htmlspecialchars($zurueck) ?>" class="btn btn-sm btn-outline-secondary"><i class="fas fa-arrow-left me-1"></i>Zurück</a>
        <?php endif; ?>
        <h1 class="h3 mb-0 d-none d-lg-block">Kategorien</h1>
    </div>
    <p class="text-body-secondary">Kategorien ordnen deine Ausgaben in der Liste und in der Auswertung. Eigene Kategorien gelten für alle deine Fahrzeuge.</p>

    <!-- Eigene Kategorien -->
    <div class="card border-0 shadow-sm mb-4">
        <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3">
            <h2 class="h6 mb-0"><i class="fas fa-tags me-2 text-primary"></i>Eigene Kategorien</h2>
            <?php if ($darfEigene): ?>
                <span class="small text-body-secondary"><?= (int)$custom['used'] ?> von <?= (int)$custom['max'] ?></span>
            <?php endif; ?>
        </div>
        <div class="card-body">
            <?php if (!$darfEigene && !$eigene): ?>
                <p class="mb-0"><i class="fas fa-lock me-1 text-body-secondary"></i>Eigene Kategorien gibt es mit <strong>Plus</strong>, zusammen mit Parken, Maut, Pflege, Leasing und Zubehör.</p>
            <?php else: ?>
                <?php if (!$darfEigene): ?>
                    <div class="alert alert-secondary small"><i class="fas fa-lock me-1"></i>Dein Tarif enthält keine eigenen Kategorien mehr. Bestehende Einträge bleiben erhalten; für neue Einträge sind sie gesperrt.</div>
                <?php endif; ?>
                <?php if (!$eigene): ?>
                    <p class="text-body-secondary">Noch keine eigenen Kategorien.</p>
                <?php endif; ?>
                <div class="list-group list-group-flush mb-3">
                    <?php foreach ($eigene as $k): $fid = 'k' . preg_replace('/[^a-z0-9]/', '', $k['id']); ?>
                    <div class="list-group-item px-0">
                        <div class="d-flex align-items-center gap-3">
                            <span class="statistik-icon flex-shrink-0" style="background-color: <?= htmlspecialchars($k['color']) ?>26; color: <?= htmlspecialchars($k['color']) ?>"><i class="fas <?= htmlspecialchars($k['icon']) ?>"></i></span>
                            <div class="flex-grow-1 min-w-0">
                                <div class="fw-semibold text-truncate"><?= htmlspecialchars($k['name']) ?></div>
                                <div class="small text-body-secondary"><?= htmlspecialchars($gruppen[$k['group']]['name'] ?? 'Sonstiges') ?></div>
                            </div>
                            <button class="btn btn-sm btn-outline-primary" type="button" data-bs-toggle="collapse" data-bs-target="#<?= $fid ?>" aria-expanded="false" aria-controls="<?= $fid ?>"><i class="fas fa-pen"></i><span class="visually-hidden">Bearbeiten</span></button>
                        </div>
                        <div class="collapse" id="<?= $fid ?>">
                            <form method="post" class="mt-3">
                                <input type="hidden" name="aktion" value="aendern">
                                <input type="hidden" name="id" value="<?= htmlspecialchars($k['id']) ?>">
                                <input type="hidden" name="zurueck" value="<?= htmlspecialchars($zurueck) ?>">
                                <?= $felder($fid . '_', $k) ?>
                                <button type="submit" class="btn btn-primary"><i class="fas fa-check me-1"></i>Speichern</button>
                            </form>
                            <form method="post" class="mt-3 pt-3 border-top d-flex flex-wrap align-items-end gap-2"
                                  onsubmit="return confirm(<?= htmlspecialchars(json_encode('Kategorie „' . $k['name'] . '“ löschen? Vorhandene Einträge wandern in die gewählte Kategorie.', JSON_UNESCAPED_UNICODE), ENT_QUOTES) ?>);">
                                <input type="hidden" name="aktion" value="loeschen">
                                <input type="hidden" name="id" value="<?= htmlspecialchars($k['id']) ?>">
                                <input type="hidden" name="zurueck" value="<?= htmlspecialchars($zurueck) ?>">
                                <div>
                                    <label class="form-label small mb-1" for="<?= $fid ?>_ziel">Vorhandene Einträge verschieben nach</label>
                                    <select class="form-select form-select-sm" id="<?= $fid ?>_ziel" name="move_to">
                                        <?php foreach ($ziele($k['key']) as $z): ?>
                                            <option value="<?= htmlspecialchars($z['key']) ?>" <?= $z['key'] === 'Sonstiges' ? 'selected' : '' ?>><?= htmlspecialchars($z['name']) ?></option>
                                        <?php endforeach; ?>
                                    </select>
                                </div>
                                <button type="submit" class="btn btn-sm btn-outline-danger"><i class="fas fa-trash me-1"></i>Löschen</button>
                            </form>
                        </div>
                    </div>
                    <?php endforeach; ?>
                </div>
                <?php if (!empty($custom['canCreate'])): ?>
                    <button class="btn btn-outline-primary" type="button" data-bs-toggle="collapse" data-bs-target="#neueKategorie" aria-expanded="<?= $eigene ? 'false' : 'true' ?>">
                        <i class="fas fa-plus me-1"></i>Neue Kategorie
                    </button>
                    <div class="collapse <?= $eigene ? '' : 'show' ?>" id="neueKategorie">
                        <form method="post" class="mt-3">
                            <input type="hidden" name="aktion" value="anlegen">
                            <input type="hidden" name="zurueck" value="<?= htmlspecialchars($zurueck) ?>">
                            <?= $felder('neu_') ?>
                            <button type="submit" class="btn btn-primary"><i class="fas fa-plus me-1"></i>Anlegen</button>
                        </form>
                    </div>
                <?php elseif ($darfEigene): ?>
                    <p class="small text-body-secondary mb-0">Du hast alle <?= (int)$custom['max'] ?> eigenen Kategorien angelegt. Lösche eine, um eine neue anzulegen.</p>
                <?php endif; ?>
            <?php endif; ?>
        </div>
    </div>

    <!-- Feste Kategorien -->
    <div class="card border-0 shadow-sm">
        <div class="card-header bg-transparent py-3">
            <h2 class="h6 mb-0"><i class="fas fa-list me-2 text-primary"></i>Feste Kategorien</h2>
        </div>
        <div class="card-body">
            <?php foreach (kategorienFuerAuswahl() as $gruppe => $liste):
                $liste = array_filter($liste, fn($k) => empty($k['custom']));
                if (!$liste) { continue; } ?>
                <h3 class="fs-label fw-semibold mt-3 mb-2"><?= htmlspecialchars($gruppe) ?></h3>
                <div class="d-flex flex-wrap gap-2 mb-3">
                    <?php foreach ($liste as $k): ?>
                        <span class="badge rounded-pill kategorie-chip <?= empty($k['available']) ? 'gesperrt' : '' ?>">
                            <i class="fas <?= htmlspecialchars($k['icon']) ?> me-1" style="color: <?= htmlspecialchars($k['color']) ?>"></i><?= htmlspecialchars($k['name']) ?>
                            <?php if (empty($k['available'])): ?><i class="fas fa-lock ms-1" title="mit Plus"></i><?php endif; ?>
                        </span>
                    <?php endforeach; ?>
                </div>
            <?php endforeach; ?>
            <?php if (kategorienHatGesperrte()): ?>
                <p class="small text-body-secondary mb-0"><i class="fas fa-lock me-1"></i>Gesperrte Kategorien gibt es mit Plus.</p>
            <?php endif; ?>
        </div>
    </div>
</div>
<?php include '../includes/footer.php'; ?>
