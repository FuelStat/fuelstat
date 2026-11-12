<?php
// Basis-URL (mit http/https) und Basis-Pfad (unterhalb Document-Root) ermitteln
// So funktionieren Links und Assets auch in Unterordnern (z.B. /fuelstat)
$isHttps = (
    (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] && $_SERVER['HTTPS'] !== 'off')
    || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443)
    || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https')
);
$scheme  = $isHttps ? 'https' : 'http';
$host    = $_SERVER['HTTP_HOST'] ?? 'localhost';

// Pfade auflösen und in URL-Pfad umwandeln
$docRoot    = rtrim(str_replace('\\', '/', $_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
$appRootFs  = str_replace('\\', '/', realpath(__DIR__ . '/..'));
$basePath   = rtrim(str_replace($docRoot, '', $appRootFs), '/');
if ($basePath === '' || $basePath[0] !== '/') {
    $basePath = '/' . ltrim($basePath, '/');
}
$baseUrl = $scheme . '://' . $host . ($basePath === '/' ? '' : $basePath) . '/';
