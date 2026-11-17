<?php
// Service eines Fahrzeugs (#206, docs/design.md 7.2): alle Termine (Fristen und Bauteile) und die Bauteile mit
// Intervallen und Wechseln. Start zeigt davon höchstens drei Termine.
$ansichtTitel = 'Service';
include __DIR__ . '/../includes/fahrzeug_seite.php';
include __DIR__ . '/../includes/termine_karte.php';
include __DIR__ . '/../tabs/service.php';
include __DIR__ . '/../includes/fahrzeug_seite_ende.php';
