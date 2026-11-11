<?php
// Startseite für nicht angemeldete Besucher (eingebunden von index.php nach header.php)

// Registrierung kann in der API abgeschaltet sein (REGISTRATION_ENABLED=false)
$registrierungOffen = true;
try {
    $registrierungOffen = (getApiClient(null)->getHealth()['registration_enabled'] ?? true) !== false;
} catch (Throwable $e) {
    // API nicht erreichbar: Links trotzdem anzeigen, die Seiten melden den Fehler selbst
}

$beta = istBetaPhase();

$funktionen = [
    ['fa-gas-pump', 'Tanken & Laden', 'Tankfüllungen und Ladevorgänge in Sekunden erfassen – beim Tanken mit Tankstellen in der Nähe und aktuellen Spritpreisen.'],
    ['fa-chart-line', 'Verbrauch & Statistiken', 'Verbrauch pro Tank- oder Ladevorgang, Monat und Jahr, Trends und Diagramme für jedes Fahrzeug.'],
    ['fa-euro-sign', 'Alle Kosten im Blick', 'Versicherung, Werkstatt, Steuer, Reifen: alle Ausgaben, Kosten pro Kilometer und Fixkosten.'],
    ['fa-bell', 'Erinnerungen', 'Rechtzeitig an TÜV, Wartung, Versicherung und Steuer denken – auf Wunsch per E-Mail.'],
    ['fa-leaf', 'CO₂-Bilanz', 'Wie viel CO₂ dein Fahrzeug ausstößt, insgesamt, pro Kilometer und pro Jahr.'],
    ['fa-file-import', 'Import & Export', 'Daten aus Excel oder anderen Apps übernehmen und jederzeit als CSV oder PDF-Bericht mitnehmen.'],
];
?>

<!-- Willkommensfläche: Navy wie das App-Icon in beiden Modi, weiße Schrift, Teal-Akzente (docs/design.md 2) -->
<section class="willkommen-hero mb-5 text-center">
    <img src="<?= htmlspecialchars($baseUrl) ?>images/new-icon-512x512.png" alt="" class="willkommen-logo mb-4" width="96" height="96">
    <?php if ($beta): ?>
        <div class="mb-3"><span class="willkommen-beta"><i class="fas fa-flask" aria-hidden="true"></i>Offene Beta · kostenlos</span></div>
    <?php endif; ?>
    <h1 class="mb-3">Willkommen bei Fuelstat</h1>
    <p class="willkommen-text mx-auto mb-4">
        Behalte Verbrauch, Kosten und Termine deiner Fahrzeuge im Blick – für Benzin, Diesel, Gas und Elektro.
    </p>
    <div class="d-flex flex-column flex-sm-row justify-content-center gap-2">
        <?php if ($registrierungOffen): ?>
            <a href="<?= htmlspecialchars($baseUrl) ?>pages/register.php" class="btn btn-lg px-4 willkommen-knopf">
                <i class="fas fa-user-plus" aria-hidden="true"></i><?= $beta ? 'Beta-Tester werden' : 'Kostenlos registrieren' ?>
            </a>
        <?php endif; ?>
        <a href="<?= htmlspecialchars($baseUrl) ?>pages/login.php" class="btn btn-lg px-4 <?= $registrierungOffen ? 'willkommen-knopf-rahmen' : 'willkommen-knopf' ?>">
            <i class="fas fa-sign-in-alt" aria-hidden="true"></i>Anmelden
        </a>
    </div>
    <?php if (!$registrierungOffen): ?>
        <p class="willkommen-text small mt-3 mb-0">Neue Konten werden auf dieser Installation vom Betreiber angelegt.</p>
    <?php endif; ?>
</section>

<section class="mb-5">
    <h2 class="text-center mb-3">Was Fuelstat für dich erledigt</h2>
    <div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
        <?php foreach ($funktionen as [$icon, $titel, $text]): ?>
        <div class="col">
            <div class="card h-100">
                <div class="card-body">
                    <span class="symbol-kreis symbol-kreis-token mb-3" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas <?= $icon ?>"></i></span>
                    <h3><?= htmlspecialchars($titel) ?></h3>
                    <p class="text-body-secondary mb-0"><?= htmlspecialchars($text) ?></p>
                </div>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
</section>

<section class="mb-5">
    <h2 class="text-center mb-3">In drei Schritten startklar</h2>
    <div class="row g-4 justify-content-center">
        <?php foreach ([
            $registrierungOffen
                ? ['Konto anlegen', 'Mit E-Mail und Passwort, auf Wunsch zusätzlich mit Zwei-Faktor-Schutz.']
                : ['Zugang erhalten', 'Mit den Zugangsdaten anmelden, die du vom Betreiber bekommen hast.'],
            ['Fahrzeug hinzufügen', 'Name, Antriebsart und gern ein Foto – bisherige Daten lassen sich per CSV übernehmen.'],
            ['Losfahren & erfassen', 'Nach jedem Tank- oder Ladestopp kurz eintragen, den Rest rechnet Fuelstat für dich aus.'],
        ] as $nr => [$titel, $text]): ?>
        <div class="col-md-4">
            <div class="d-flex gap-3">
                <div class="willkommen-schritt"><?= $nr + 1 ?></div>
                <div>
                    <h3 class="h6 mb-1"><?= htmlspecialchars($titel) ?></h3>
                    <p class="text-body-secondary small mb-0"><?= htmlspecialchars($text) ?></p>
                </div>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
</section>

<?php if ($beta): ?>
<section class="mb-5">
    <div class="card">
        <div class="card-body p-4">
            <div class="d-flex flex-column flex-md-row gap-3 align-items-md-center">
                <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-flask"></i></span>
                <div>
                    <h2 class="h4 mb-2">Fuelstat ist in der Beta-Phase</h2>
                    <p class="text-body-secondary mb-3">Alle Funktionen sind schon nutzbar, und du kannst mitbestimmen, wie es weitergeht. Als Beta-Tester hilfst du, Fuelstat besser zu machen.</p>
                    <ul class="list-unstyled mb-0 small">
                        <li class="mb-2"><i class="fas fa-check text-success me-2"></i>Kostenlos während der gesamten Beta</li>
                        <li class="mb-2"><i class="fas fa-check text-success me-2"></i>Feedback direkt aus der App senden – Fehler, Ideen, Lob</li>
                        <li class="mb-2"><i class="fas fa-check text-success me-2"></i>Deine Daten kannst du jederzeit als CSV exportieren</li>
                        <li><i class="fas fa-info-circle text-body-secondary me-2"></i>Einzelne Funktionen können sich noch ändern</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</section>
<?php endif; ?>

<section class="text-center bg-body-tertiary rounded-4 px-4 py-5 mb-4">
    <h2 class="h4 mb-3">Bereit für den ersten Tank- oder Ladestopp?</h2>
    <p class="text-body-secondary mb-4">Fuelstat läuft im Browser und lässt sich auf dem Handy wie eine App installieren.</p>
    <div class="d-flex flex-column flex-sm-row justify-content-center gap-2">
        <?php if ($registrierungOffen): ?>
            <a href="<?= htmlspecialchars($baseUrl) ?>pages/register.php" class="btn btn-primary px-4">Jetzt registrieren</a>
        <?php endif; ?>
        <a href="<?= htmlspecialchars($baseUrl) ?>pages/login.php" class="btn btn-<?= $registrierungOffen ? 'outline-secondary' : 'primary' ?> px-4"><?= $registrierungOffen ? 'Ich habe schon ein Konto' : 'Anmelden' ?></a>
    </div>
</section>
