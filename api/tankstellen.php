<?php
// api/tankstellen.php – Tankstellen in der Nähe für das Erfassungsformular (#123).
// Dünne Weiterleitung an die Fuelstat-API (GET /stations) mit dem Token der Sitzung: Der Browser kennt den Token
// nicht, und Tankerkönig fragt ausschließlich die API (Key, Cache, Rate-Limit an einer Stelle).
include __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/fuelstat_api.php';
require_once __DIR__ . '/../includes/stationssuche.php';

stationssucheWeiterleiten(
    fn(FuelstatApi $api, array $query) => $api->getStations($query),
    ['lat', 'lng', 'radius', 'type'],
    'Die Tankstellensuche'
);
