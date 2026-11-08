<?php
// api/ladestationen.php – Ladestationen in der Nähe für das Erfassungsformular (#123).
// Dünne Weiterleitung an die Fuelstat-API (GET /charging-stations) mit dem Token der Sitzung: Open Charge Map
// fragt ausschließlich die API (Key, Cache, Rate-Limit an einer Stelle).
include __DIR__ . '/../includes/session.php';
require_once __DIR__ . '/../includes/fuelstat_api.php';
require_once __DIR__ . '/../includes/stationssuche.php';

stationssucheWeiterleiten(
    fn(FuelstatApi $api, array $query) => $api->getChargingStations($query),
    ['lat', 'lng', 'radius'],
    'Die Ladestationssuche'
);
