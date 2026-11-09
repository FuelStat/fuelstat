<?php
// CSV-Import für ein Fahrzeug: 1. Datei hochladen, 2. Spalten zuordnen + Vorschau, 3. importieren
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/csv_import.php';

if (!isApiAuthenticated()) {
    header('Location: login.php');
    exit;
}
$fahrzeug_id = trim($_GET['id'] ?? $_POST['id'] ?? '');
$api = getApiClient();

try {
    $fahrzeug = $api->getVehicle($fahrzeug_id);
} catch (Throwable $e) {
    die('Fahrzeug nicht gefunden.');
}
$einheit = einheitKurz(getEinheitFuerKraftstoff($fahrzeug['fuel_type'] ?? null));
$fuelType = (string)($fahrzeug['fuel_type'] ?? 'other');
$begriffe = verbrauchsBegriffe($fuelType);

// Vorlage zum Herunterladen (gleiches Format wie der Export), passend zur Antriebsart
if (isset($_GET['vorlage'])) {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="fuelstat_import_vorlage.csv"');
    if ($fuelType === 'phev') {
        // Plug-in-Hybrid: Tanken und Laden in einer Datei, die Spalte "Einheit" unterscheidet sie
        echo "\xEF\xBB\xBF" . "Datum;Kategorie;Tachostand (km);Menge;Einheit;Kosten (EUR);Voll;Ort/Anbieter;Beschreibung\r\n"
            . "05.01.2026;Laden;38302;14,80;kWh;4,14;ja;Zuhause (Wallbox);\r\n"
            . "05.01.2026;Tanken;38337;41,20;l;72,10;ja;Aral Musterstadt;\r\n"
            . "06.01.2026;Laden;38390;9,60;kWh;2,69;ja;Zuhause (Wallbox);\r\n"
            . "02.01.2026;Versicherung;;;;420,00;;HUK;Jahresbeitrag\r\n"
            . "15.03.2026;Werkstatt;39100;;;189,00;;ATU;Bremsbeläge vorne\r\n";
        exit;
    }
    $beispiele = $begriffe['art'] === 'strom'
        ? ["05.01.2026;Laden;38337;24,50;6,13;ja;Zuhause (Wallbox);", "20.01.2026;Laden;38700;18,00;12,42;ja;EnBW Schnelllader;"]
        : ["05.01.2026;Tankfüllung;38337;33,50;61,20;ja;Aral Musterstadt;", "20.01.2026;Tankfüllung;38700;15,00;27,90;nein;Shell;"];
    echo "\xEF\xBB\xBF" . "Datum;Kategorie;Tachostand (km);Menge (" . $einheit . ");Kosten (EUR);" . $begriffe['voll'] . ";Ort/Anbieter;Beschreibung\r\n"
        . implode("\r\n", $beispiele) . "\r\n"
        . "02.01.2026;Versicherung;;;420,00;;HUK;Jahresbeitrag\r\n"
        . "15.03.2026;Werkstatt;39100;;189,00;;ATU;Bremsbeläge vorne\r\n";
    exit;
}
$sitzungsKey = 'csv_import_' . $fahrzeug_id;
$daten = $_SESSION[$sitzungsKey] ?? null;
$schritt = $_POST['schritt'] ?? ($daten ? 'zuordnen' : 'upload');
$error = '';
$standardKategorie = $_POST['standard_kategorie'] ?? 'Werkstatt';
// Unbekannte Kategorien als eigene anlegen (#95, nur wenn der Tarif eigene Kategorien erlaubt)
$eigeneAnlegen = !empty($_POST['eigene_anlegen']);
$zuordnung = $daten['zuordnung'] ?? [];

if (isset($_GET['neu'])) {
    unset($_SESSION[$sitzungsKey]);
    $daten = null;
    $schritt = 'upload';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $schritt === 'upload') {
    $datei = $_FILES['csv'] ?? null;
    if (!$datei || $datei['error'] !== UPLOAD_ERR_OK) {
        $error = 'Bitte eine CSV-Datei auswählen.';
    } elseif ($datei['size'] > 5 * 1024 * 1024) {
        $error = 'Die Datei ist größer als 5 MB.';
    } else {
        $gelesen = importLeseCsv((string)file_get_contents($datei['tmp_name']));
        if (!$gelesen['kopf'] || !$gelesen['zeilen']) {
            $error = 'Die Datei enthält keine Datenzeilen. Erwartet wird eine Kopfzeile und darunter die Einträge.';
        } elseif (count($gelesen['zeilen']) > 10000) {
            $error = 'Maximal 10.000 Zeilen pro Import.';
        } else {
            $daten = $gelesen + ['zuordnung' => importErkenneZuordnung($gelesen['kopf']), 'dateiname' => basename((string)$datei['name'])];
            $_SESSION[$sitzungsKey] = $daten;
            $zuordnung = $daten['zuordnung'];
            $schritt = 'zuordnen';
        }
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST' && $daten) {
    // Zuordnung aus dem Formular übernehmen
    $zuordnung = [];
    foreach (array_keys(importFelder()) as $feld) {
        $wert = $_POST['spalte'][$feld] ?? '';
        if ($wert !== '') {
            $zuordnung[$feld] = (int)$wert;
        }
    }
    $daten['zuordnung'] = $zuordnung;
    $_SESSION[$sitzungsKey] = $daten;
}

$umgewandelt = $daten ? importWandleUm($daten['zeilen'], $zuordnung, $standardKategorie) : null;
$kategorienKatalog = kategorienKatalog();
if ($umgewandelt) {
    $umgewandelt = importKategorienZuordnen($umgewandelt, $kategorienKatalog, $eigeneAnlegen);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $schritt === 'importieren' && $umgewandelt) {
    if (!isset($zuordnung['datum'])) {
        $error = 'Bitte mindestens die Spalte für das Datum zuordnen.';
    } elseif ($umgewandelt['fehler'] && empty($_POST['fehler_ueberspringen'])) {
        $error = 'Einige Zeilen sind fehlerhaft. Korrigiere die Datei oder setze den Haken „Fehlerhafte Zeilen überspringen“.';
    } else {
        $summe = ['imported' => ['fillups' => 0, 'entries' => 0], 'skipped' => ['fillups' => 0, 'entries' => 0]];
        try {
            // In Paketen zu je 500 Zeilen senden; jedes Paket wird in der API als Transaktion gespeichert
            foreach (array_chunk($umgewandelt['fillups'], 500) as $paket) {
                $r = $api->postVehicleImport($fahrzeug_id, $paket, []);
                foreach (['imported', 'skipped'] as $k) { $summe[$k]['fillups'] += $r[$k]['fillups']; }
            }
            // Neue eigene Kategorien zuerst anlegen, dann die Platzhalter ersetzen
            $neueSchluessel = [];
            foreach ($umgewandelt['kategorien']['neu'] as $name) {
                try {
                    $neueSchluessel[mb_strtolower($name)] = $api->postCategory(['name' => $name])['key'];
                } catch (FuelstatApiException $e) {
                    // z. B. Name schon vergeben oder Grenze erreicht: diese Zeilen landen bei "Sonstiges"
                }
            }
            if ($umgewandelt['kategorien']['neu']) {
                kategorienLeeren();
            }
            foreach (array_chunk(importKategorienErsetzen($umgewandelt['entries'], $neueSchluessel), 500) as $paket) {
                $r = $api->postVehicleImport($fahrzeug_id, [], $paket);
                foreach (['imported', 'skipped'] as $k) { $summe[$k]['entries'] += $r[$k]['entries']; }
            }
            unset($_SESSION[$sitzungsKey]);
            $meldung = sprintf('Import abgeschlossen: %d ' . $begriffe['vorgaenge'] . ' und %d Ausgaben übernommen.', $summe['imported']['fillups'], $summe['imported']['entries']);
            $doppelt = $summe['skipped']['fillups'] + $summe['skipped']['entries'];
            if ($doppelt > 0) {
                $meldung .= ' ' . $doppelt . ' bereits vorhandene Einträge wurden übersprungen.';
            }
            if ($umgewandelt['fehler']) {
                $meldung .= ' ' . count($umgewandelt['fehler']) . ' fehlerhafte Zeilen wurden ausgelassen.';
            }
            $_SESSION['success_message'] = $meldung;
            header('Location: fahrzeug_detail.php?id=' . rawurlencode($fahrzeug_id) . '#eintraege');
            exit;
        } catch (Throwable $e) {
            $error = tarifHinweis($e) ?? 'Import fehlgeschlagen: ' . $e->getMessage() . '. Bereits übertragene Pakete bleiben gespeichert; ein erneuter Import überspringt sie.';
        }
    }
}

// Vorschau: Probelauf in der API zeigt doppelte Zeilen und unplausible Tachostände (#51)
$hinweise = [];
if ($umgewandelt && isset($zuordnung['datum']) && ($umgewandelt['fillups'] || $umgewandelt['entries'])) {
    try {
        $hinweise = importPruefeVorab($api, $fahrzeug_id, ['entries' => importKategorienErsetzen($umgewandelt['entries'], [])] + $umgewandelt);
    } catch (Throwable $e) {
        // Vorschau ohne Hinweise; der eigentliche Import meldet Fehler selbst
    }
}
$warnAnzahl = count(array_filter($hinweise, fn($h) => $h['art'] === 'warnung'));
$doppeltAnzahl = count(array_filter($hinweise, fn($h) => $h['art'] === 'doppelt'));

include '../includes/header.php';
$f2 = fn($v) => $v === null ? '' : number_format((float)$v, 2, ',', '.');
?>
<div class="container mt-5">
    <h2><i class="fas fa-file-import me-2"></i>Import für <?= htmlspecialchars($fahrzeug['name'] ?? 'Fahrzeug') ?></h2>
    <?php if ($error): ?>
        <div class="alert alert-danger"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>

    <?php if (!$daten): ?>
        <p>Übernimm <?= $begriffe['vorgaenge'] ?> und Ausgaben aus einer CSV-Datei, z. B. aus einer Excel-Liste, einer anderen App oder einem Fuelstat-Export.</p>
        <ul>
            <li>Erste Zeile: Spaltenüberschriften. Trennzeichen Semikolon, Komma oder Tab.</li>
            <?php if ($fuelType === 'phev'): ?>
            <li>Pflicht ist ein Datum; Tank- und Ladevorgänge brauchen außerdem Tachostand und Menge.</li>
            <li>Zeilen mit Menge gelten als Tank- oder Ladevorgang, sonst als Ausgabe. Ob getankt (Liter) oder geladen (kWh) wurde, steht in einer Spalte „Einheit“ (l oder kWh) oder in der Kategorie („Tanken“ bzw. „Laden“). Ohne beides gilt die Zeile als Tankfüllung.</li>
            <?php else: ?>
            <li>Pflicht ist ein Datum; <?= $begriffe['vorgaenge'] ?> brauchen außerdem Tachostand und Menge (<?= $einheit ?>).</li>
            <li>Zeilen mit Menge gelten als <?= $begriffe['vorgang'] ?>, sonst als Ausgabe. Eine Spalte „Kategorie“ (z. B. <?= $begriffe['art'] === 'strom' ? 'Laden' : 'Tankfüllung' ?>, Versicherung, TÜV) legt die Art fest.</li>
            <?php endif; ?>
            <li>Bereits vorhandene Einträge (gleiches Datum und gleicher Tachostand bzw. gleiche Kategorie und Betrag) werden übersprungen.</li>
        </ul>
        <p><a href="import.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>&vorlage=1" download><i class="fas fa-download me-1"></i>Vorlage herunterladen</a></p>
        <form method="post" enctype="multipart/form-data" class="card card-body">
            <input type="hidden" name="id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
            <input type="hidden" name="schritt" value="upload">
            <label for="csv" class="form-label">CSV-Datei (max. 5 MB)</label>
            <input type="file" class="form-control mb-3" id="csv" name="csv" accept=".csv,text/csv,text/plain" required>
            <div>
                <button type="submit" class="btn btn-primary">Weiter zur Zuordnung</button>
                <a href="fahrzeug_detail.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>#eintraege" class="btn btn-outline-secondary ms-2">Abbrechen</a>
            </div>
        </form>
    <?php else: ?>
        <p class="text-muted">Datei: <?= htmlspecialchars($daten['dateiname'] ?? '') ?> · <?= count($daten['zeilen']) ?> Zeilen ·
            <a href="import.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>&neu=1">andere Datei wählen</a></p>

        <form method="post">
            <input type="hidden" name="id" value="<?= htmlspecialchars($fahrzeug_id) ?>">
            <h5>1. Spalten zuordnen</h5>
            <div class="row g-2 mb-3">
                <?php foreach (importFelder() as $feld => $label): ?>
                <div class="col-sm-6 col-lg-4">
                    <label class="form-label small mb-0" for="spalte_<?= $feld ?>"><?= htmlspecialchars($label) ?></label>
                    <select class="form-select form-select-sm" id="spalte_<?= $feld ?>" name="spalte[<?= $feld ?>]">
                        <option value="">– nicht vorhanden –</option>
                        <?php foreach ($daten['kopf'] as $index => $kopf): ?>
                            <option value="<?= $index ?>" <?= isset($zuordnung[$feld]) && $zuordnung[$feld] === $index ? 'selected' : '' ?>><?= htmlspecialchars($kopf !== '' ? $kopf : 'Spalte ' . ($index + 1)) ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <?php endforeach; ?>
                <div class="col-sm-6 col-lg-4">
                    <label class="form-label small mb-0" for="standard_kategorie">Kategorie für Ausgaben ohne Angabe</label>
                    <select class="form-select form-select-sm" id="standard_kategorie" name="standard_kategorie">
                        <?= kategorieOptionen($standardKategorie, false) ?>
                    </select>
                </div>
                <?php if (!empty($kategorienKatalog['custom']['max'])): ?>
                <div class="col-sm-6 col-lg-4 d-flex align-items-end">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="eigene_anlegen" name="eigene_anlegen" value="1" <?= $eigeneAnlegen ? 'checked' : '' ?>>
                        <label class="form-check-label small" for="eigene_anlegen">Unbekannte Kategorien als eigene Kategorien anlegen
                            (noch <?= max(0, (int)$kategorienKatalog['custom']['max'] - (int)$kategorienKatalog['custom']['used']) ?> frei)</label>
                    </div>
                </div>
                <?php endif; ?>
            </div>
            <button type="submit" name="schritt" value="zuordnen" class="btn btn-outline-primary btn-sm mb-4">Vorschau aktualisieren</button>

            <h5>2. Vorschau</h5>
            <p>
                <span class="badge text-bg-primary"><?= count($umgewandelt['fillups']) ?> <?= $begriffe['vorgaenge'] ?></span>
                <span class="badge text-bg-success"><?= count($umgewandelt['entries']) ?> Ausgaben</span>
                <?php if ($umgewandelt['fehler']): ?><span class="badge text-bg-danger"><?= count($umgewandelt['fehler']) ?> fehlerhafte Zeilen</span><?php endif; ?>
                <?php if ($warnAnzahl): ?><span class="badge text-bg-warning"><?= $warnAnzahl ?> mit unplausiblem Tachostand</span><?php endif; ?>
                <?php if ($doppeltAnzahl): ?><span class="badge text-bg-secondary"><?= $doppeltAnzahl ?> bereits vorhanden</span><?php endif; ?>
            </p>
            <?php if ($umgewandelt['kategorien']['sonstiges']): ?>
                <div class="alert alert-info small py-2">
                    <i class="fas fa-circle-info me-1"></i>Unbekannte oder nicht im Tarif enthaltene Kategorien werden als „Sonstiges“ übernommen, der Name bleibt in der Beschreibung:
                    <?= htmlspecialchars(implode(', ', array_map(fn($n, $a) => $n . ' (' . $a . '×)', array_keys($umgewandelt['kategorien']['sonstiges']), $umgewandelt['kategorien']['sonstiges']))) ?>
                </div>
            <?php endif; ?>
            <?php if ($umgewandelt['kategorien']['neu']): ?>
                <div class="alert alert-success small py-2"><i class="fas fa-tags me-1"></i>Neue eigene Kategorien: <?= htmlspecialchars(implode(', ', $umgewandelt['kategorien']['neu'])) ?></div>
            <?php endif; ?>
            <div class="table-responsive mb-3" style="max-height: 420px;">
                <table class="table table-sm table-striped align-middle">
                    <thead class="sticky-top"><tr><th>Zeile</th><th>Datum</th><th>Art</th><th>km</th><th>Menge<?= $fuelType === 'phev' ? '' : ' (' . $einheit . ')' ?></th><th>Kosten</th><th>Voll</th><th>Ort</th><th>Beschreibung</th></tr></thead>
                    <tbody>
                    <?php
                    // Fehler zuerst, dann Warnungen (Tachostand), dann die übrigen Zeilen
                    $vorschau = $umgewandelt['vorschau'];
                    $rang = fn($z) => $z['fehler'] !== null ? 0 : (($hinweise[$z['nr']]['art'] ?? '') === 'warnung' ? 1 : 2);
                    usort($vorschau, fn($a, $b) => [$rang($a), $a['nr']] <=> [$rang($b), $b['nr']]);
                    foreach (array_slice($vorschau, 0, 100) as $z):
                        $hinweis = $z['fehler'] === null ? ($hinweise[$z['nr']] ?? null) : null; ?>
                        <tr class="<?= $z['fehler'] ? 'table-danger' : ($hinweis ? ($hinweis['art'] === 'warnung' ? 'table-warning' : 'table-secondary text-body-secondary') : '') ?>">
                            <td><?= $z['nr'] ?></td>
                            <td><?= $z['datum'] ? date('d.m.Y', strtotime($z['datum'])) : '' ?></td>
                            <td><?= $z['fehler'] ? '<strong>' . htmlspecialchars($z['fehler']) . '</strong>' : htmlspecialchars($z['kategorie_text'] ?? getKategorieName($z['kategorie'], $fuelType, $fuelType === 'phev' ? ($z['einheit'] ?? 'l') : null)) ?><?= $hinweis ? '<div class="small">' . htmlspecialchars($hinweis['text']) . '</div>' : '' ?></td>
                            <td><?= $z['tachostand'] !== null ? number_format($z['tachostand'], 0, ',', '.') : '' ?></td>
                            <td><?= $f2($z['menge']) ?><?= $fuelType === 'phev' && $z['menge'] !== null ? ' ' . einheitKurz($z['einheit'] ?? 'l') : '' ?></td>
                            <td><?= $z['kosten'] !== null ? $f2($z['kosten']) . ' €' : '' ?></td>
                            <td><?= $z['vollgetankt'] === null ? '' : ($z['vollgetankt'] ? 'ja' : 'nein') ?></td>
                            <td><?= htmlspecialchars($z['ort']) ?></td>
                            <td><?= htmlspecialchars($z['beschreibung']) ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
            <?php if (count($vorschau) > 100): ?><p class="small text-muted">Es werden die ersten 100 Zeilen angezeigt.</p><?php endif; ?>

            <h5>3. Importieren</h5>
            <?php if ($umgewandelt['fehler']): ?>
            <div class="form-check mb-2">
                <input class="form-check-input" type="checkbox" id="fehler_ueberspringen" name="fehler_ueberspringen" value="1">
                <label class="form-check-label" for="fehler_ueberspringen">Fehlerhafte Zeilen überspringen</label>
            </div>
            <?php endif; ?>
            <button type="submit" name="schritt" value="importieren" class="btn btn-primary" <?= count($umgewandelt['fillups']) + count($umgewandelt['entries']) === 0 ? 'disabled' : '' ?>>
                <i class="fas fa-file-import me-1"></i> <?= count($umgewandelt['fillups']) + count($umgewandelt['entries']) ?> Einträge importieren
            </button>
            <a href="fahrzeug_detail.php?id=<?= htmlspecialchars(urlencode($fahrzeug_id)) ?>#eintraege" class="btn btn-outline-secondary ms-2">Abbrechen</a>
        </form>
    <?php endif; ?>
</div>
<?php include '../includes/footer.php'; ?>
