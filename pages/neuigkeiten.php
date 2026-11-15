<?php
// pages/neuigkeiten.php – Release Notes (#111): aus CHANGELOG.md, aktuelle Version aus VERSION
include '../includes/session.php';
include '../includes/header.php';
require_once __DIR__ . '/../includes/version.php';

$version = fuelstatVersion();
$releases = fuelstatReleases();
$istAdmin = !empty($currentUser['is_admin']);

// Für Admins: läuft die API in derselben Version? (sonst wurde z. B. das API-Image nicht neu gebaut)
$apiVersion = null;
if ($istAdmin) {
    try {
        $apiVersion = (string)(getApiClient(null)->getHealth()['version'] ?? '');
    } catch (Throwable $e) {
        $apiVersion = '';
    }
}

// Abschnitte mit Symbol; Technik richtet sich an Betreiber, daher nur für Admins (Update-Hinweise stehen in docs/update-hinweise.md)
$symbole = [
    'Neu' => ['fa-star', 'text-primary'],
    'Verbessert' => ['fa-arrow-trend-up', 'text-success'],
    'Behoben' => ['fa-screwdriver-wrench', 'text-warning'],
    'Sicherheit' => ['fa-shield-halved', 'text-danger'],
    'Technik' => ['fa-gears', 'text-body-secondary'],
];
$nurAdmins = ['Technik'];
$monate = [1 => 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
$datumText = fn(?string $d) => $d ? (int)substr($d, 8, 2) . '. ' . $monate[(int)substr($d, 5, 2)] . ' ' . substr($d, 0, 4) : '';
?>
<div class="container mt-3 mt-lg-5 mb-5" style="max-width: 860px;">
    <h1 class="h3 d-none d-lg-block mb-3">Neuigkeiten</h1>
    <p class="text-body-secondary">
        Du nutzt <strong>Fuelstat <?= htmlspecialchars($version) ?></strong><?= str_starts_with($version, '0.') ? ' (Beta)' : '' ?>.
        Hier steht, was sich mit jeder Version geändert hat.
    </p>

    <?php if ($istAdmin && $apiVersion !== $version): ?>
        <div class="alert alert-warning small">
            <i class="fas fa-triangle-exclamation me-1"></i>
            Die API meldet <?= $apiVersion !== '' ? 'Version <strong>' . htmlspecialchars($apiVersion) . '</strong>' : 'keine Version' ?>, das Frontend ist auf <strong><?= htmlspecialchars($version) ?></strong>.
            Nach einem Update das API-Image neu bauen: <code>sudo docker compose up -d --build api</code>.
        </div>
    <?php endif; ?>

    <?php foreach ($releases as $i => $r): ?>
    <section class="card border-0 shadow-sm mb-3" id="v<?= htmlspecialchars($r['version']) ?>">
        <div class="card-body">
            <h2 class="h5 mb-1 d-flex flex-wrap align-items-center gap-2">
                Version <?= htmlspecialchars($r['version']) ?>
                <?php if ($i === 0): ?><span class="badge text-bg-primary">aktuell</span><?php endif; ?>
            </h2>
            <div class="small text-body-secondary mb-2"><?= htmlspecialchars($datumText($r['datum'])) ?></div>
            <?php if ($r['einleitung'] !== ''): ?>
                <p class="mb-2"><?= fuelstatMarkdownZeile($r['einleitung']) ?></p>
            <?php endif; ?>
            <?php foreach ($r['abschnitte'] as $titel => $eintraege):
                if (!$eintraege || (in_array($titel, $nurAdmins, true) && !$istAdmin)) { continue; }
                [$icon, $farbe] = $symbole[$titel] ?? ['fa-circle', 'text-body-secondary']; ?>
                <h3 class="h6 mt-3 mb-1"><i class="fas <?= $icon ?> <?= $farbe ?> fa-fw me-1"></i><?= htmlspecialchars($titel) ?></h3>
                <ul class="mb-0 neuigkeiten-liste">
                    <?php foreach ($eintraege as $e): ?><li><?= fuelstatMarkdownZeile($e) ?></li><?php endforeach; ?>
                </ul>
            <?php endforeach; ?>
        </div>
    </section>
    <?php endforeach; ?>

    <p class="small text-body-secondary mt-4">
        Alle Versionen mit Quellcode: <a href="https://github.com/FuelStat/fuelstat/releases" target="_blank" rel="noopener">GitHub-Releases</a>.
        Fehler gefunden oder eine Idee? <a href="feedback.php">Feedback senden</a>.
    </p>
</div>
<script>
  // Gesehen merken: der Hinweis "neu" bei Neuigkeiten verschwindet bis zur nächsten Version
  try { localStorage.setItem('fuelstat-version-gesehen', <?= json_encode($version) ?>); } catch (e) {}
</script>
<?php include '../includes/footer.php'; ?>
