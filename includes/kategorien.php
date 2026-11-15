<?php
// includes/kategorien.php – Kategorien für Ausgaben kommen vom API (GET /categories, #95).
// Die Liste wird pro Seitenaufruf einmal und in der Sitzung für 5 Minuten zwischengespeichert.
// Nach Änderungen an eigenen Kategorien kategorienLeeren() aufrufen.

const KATEGORIEN_CACHE_SEKUNDEN = 300;

// Feste Arten, die das Frontend selbst kennt (eigene Formulare); greift nur, wenn das API nicht erreichbar ist
const KATEGORIEN_STRUKTUR = [
    'Tankfuellung' => ['key' => 'Tankfuellung', 'name' => 'Tankfüllung', 'icon' => 'fa-gas-pump', 'color' => '#0d6efd', 'group' => 'kraftstoff', 'form' => 'fillup', 'countsAsCost' => true],
    'Fahrt' => ['key' => 'Fahrt', 'name' => 'Fahrt', 'icon' => 'fa-route', 'color' => '#198754', 'group' => 'sonstiges', 'form' => 'trip', 'countsAsCost' => false],
    'Kilometerstand' => ['key' => 'Kilometerstand', 'name' => 'Kilometerstand', 'icon' => 'fa-gauge-high', 'color' => '#6c757d', 'group' => 'sonstiges', 'form' => 'odometer', 'countsAsCost' => false],
];

/**
 * Katalog vom API: ['groups' => [...], 'categories' => [...], 'custom' => [...], 'nachKey' => [key => Kategorie]]
 * Ohne Anmeldung oder bei Fehlern nur die festen Arten.
 */
function kategorienKatalog(): array
{
    if (isset($GLOBALS['fuelstatKategorien'])) {
        return $GLOBALS['fuelstatKategorien'];
    }
    $daten = null;
    $benutzer = $_SESSION['user_id'] ?? null;
    $cache = $_SESSION['kategorien_cache'] ?? null;
    if (is_array($cache) && ($cache['benutzer'] ?? null) === $benutzer && ($cache['zeit'] ?? 0) > time() - KATEGORIEN_CACHE_SEKUNDEN) {
        $daten = $cache['daten'];
    } elseif (function_exists('getApiClient') && function_exists('getApiToken') && getApiToken()) {
        try {
            $daten = getApiClient()->getCategories();
            if (session_status() === PHP_SESSION_ACTIVE) {
                $_SESSION['kategorien_cache'] = ['benutzer' => $benutzer, 'zeit' => time(), 'daten' => $daten];
            }
        } catch (Throwable $e) {
            error_log('[kategorien] ' . $e->getMessage());
        }
    }
    $daten = is_array($daten) ? $daten : ['groups' => [], 'categories' => array_values(KATEGORIEN_STRUKTUR), 'custom' => ['max' => 0, 'used' => 0, 'canCreate' => false, 'icons' => [], 'colors' => []]];
    $daten['nachKey'] = KATEGORIEN_STRUKTUR;
    foreach ($daten['categories'] as $k) {
        $daten['nachKey'][$k['key']] = $k;
    }
    return $GLOBALS['fuelstatKategorien'] = $daten;
}

/** Nach dem Anlegen, Ändern oder Löschen eigener Kategorien */
function kategorienLeeren(): void
{
    unset($GLOBALS['fuelstatKategorien'], $_SESSION['kategorien_cache']);
}

function kategorieInfo(?string $key): ?array
{
    return kategorienKatalog()['nachKey'][(string)$key] ?? null;
}

/** Gruppen für Auswertungen: key => Gruppe */
function kategorieGruppen(): array
{
    $gruppen = [];
    foreach (kategorienKatalog()['groups'] as $g) {
        $gruppen[$g['key']] = $g;
    }
    return $gruppen + ['sonstiges' => ['key' => 'sonstiges', 'name' => 'Sonstiges', 'icon' => 'fa-ellipsis', 'color' => '#20c997']];
}

function getKategorieFarbe(?string $key): string
{
    return kategorieInfo($key)['color'] ?? '#adb5bd';
}

function getKategorieGruppe(?string $key): string
{
    return kategorieInfo($key)['group'] ?? 'sonstiges';
}

/** Fahrtenbuch und Kilometerstand zählen in keiner Kostensumme */
function istEintragOhneKosten(?string $kategorie): bool
{
    $info = kategorieInfo($kategorie);
    return $info !== null && empty($info['countsAsCost']);
}

/** Formular-Art einer Ausgabe: expense, trip oder odometer */
function kategorieFormular(?string $kategorie): string
{
    return kategorieInfo($kategorie)['form'] ?? 'expense';
}

/** Lassen sich an Einträgen dieser Kategorie Bauteile angeben (#78)? Die API legt das fest (allowsParts). */
function kategorieErlaubtBauteile(?string $kategorie): bool
{
    return !empty(kategorieInfo($kategorie)['allowsParts']);
}

/**
 * Kategorien für die Auswahl einer Ausgabe, nach Gruppen sortiert.
 * Gesperrte (Tarif) sind enthalten und als nicht verfügbar markiert; $aktuell bleibt immer wählbar.
 * @return array [gruppenName => [Kategorie, ...]]
 */
function kategorienFuerAuswahl(?string $aktuell = null): array
{
    $gruppen = kategorieGruppen();
    $liste = [];
    foreach (kategorienKatalog()['categories'] as $k) {
        $istAktuell = $aktuell !== null && $k['key'] === $aktuell;
        if (empty($k['selectable']) && !$istAktuell) {
            continue;
        }
        if ($istAktuell) {
            $k['available'] = true;
        }
        $titel = !empty($k['custom']) ? 'Eigene Kategorien' : ($gruppen[$k['group']]['name'] ?? 'Sonstiges');
        $liste[$titel][] = $k;
    }
    return $liste;
}

/** <option>-Liste für ein Kategorie-Select (gesperrte mit Schloss und deaktiviert) */
function kategorieOptionen(?string $aktuell = null, bool $mitLeer = true): string
{
    $html = $mitLeer ? '<option value="">Bitte wählen</option>' : '';
    foreach (kategorienFuerAuswahl($aktuell) as $gruppe => $kategorien) {
        $html .= '<optgroup label="' . htmlspecialchars($gruppe) . '">';
        foreach ($kategorien as $k) {
            $gesperrt = empty($k['available']);
            $html .= '<option value="' . htmlspecialchars($k['key']) . '"'
                . ($k['key'] === $aktuell ? ' selected' : '')
                . ($gesperrt ? ' disabled' : '')
                . ' data-icon="' . htmlspecialchars($k['icon']) . '"' . (!empty($k['allowsParts']) ? ' data-bauteile="1"' : '') . '>'
                . htmlspecialchars($k['name']) . ($gesperrt ? ' 🔒 Plus' : '')
                . '</option>';
        }
        $html .= '</optgroup>';
    }
    return $html;
}

/** Gibt es gesperrte Kategorien (für den Hinweis „mit Plus mehr Kategorien“)? */
function kategorienHatGesperrte(): bool
{
    foreach (kategorienKatalog()['categories'] as $k) {
        if (!empty($k['selectable']) && empty($k['available'])) {
            return true;
        }
    }
    return false;
}
