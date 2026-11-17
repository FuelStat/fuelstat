<?php
// Eigene Fehlerseite (#211, docs/design.md 8.1 „Web: Seite nicht gefunden“) statt der Standardseite des Servers.
// nginx zeigt sie bei 403 und 404 (error_page, infra/nginx/fuelstat.conf.example) unter der angefragten Adresse; für
// 5xx gibt es die statische fehler.html, weil dann PHP selbst ausgefallen sein kann.
// Ein Text für „gibt es nicht“ und „kein Zugriff“, damit nichts über fremde Daten verraten wird. Die angefragte Adresse
// wird nicht ausgegeben.
$fehlerCode = (int)($_GET['code'] ?? 404) === 403 ? 403 : 404;
http_response_code($fehlerCode);
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

// Fehlende Bilder, Skripte und Scanner: kurze Antwort ohne Sitzung und API
if (!str_contains((string)($_SERVER['HTTP_ACCEPT'] ?? ''), 'text/html')) {
    header('Content-Type: text/plain; charset=utf-8');
    echo "Seite nicht gefunden\n";
    exit;
}

include __DIR__ . '/../includes/session.php';
include __DIR__ . '/../includes/functions.php';
include __DIR__ . '/../includes/header.php';
?>
<div class="container mt-4 mt-lg-5">
    <div class="card leer-zustand mx-auto">
        <div class="card-body">
            <span class="symbol-kreis symbol-kreis-token symbol-kreis-gross" style="--farbe: var(--fs-brand)" aria-hidden="true"><i class="fas fa-map-signs"></i></span>
            <h1 class="h2">Seite nicht gefunden</h1>
            <p class="text-body-secondary mb-4">Das gibt es nicht oder du hast keinen Zugriff darauf.</p>
            <a href="<?= htmlspecialchars($baseUrl) ?>index.php" class="btn btn-primary">Zur Startseite</a>
        </div>
    </div>
</div>
<?php include __DIR__ . '/../includes/footer.php'; ?>
