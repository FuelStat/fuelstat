<?php
// Angaben zum Betreiber für Impressum und Datenschutzerklärung – an einer Stelle pflegen.
// Leere Pflichtangaben werden auf den Seiten deutlich als fehlend markiert.
return [
    'name' => 'Mario Caraggiu',
    'strasse' => 'Seitengasse 6',
    'plz_ort' => '78600 Kolbingen',
    'email' => 'mario@caraggiu.eu',  // wird wie auf caraggiu.com als mario[at]caraggiu.eu angezeigt
    'telefon' => '+49 172 / 30 76 371',

    // Hosting (Datenschutzerklärung)
    'hoster' => 'Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen',
    'log_tage' => 14,             // nach wie vielen Tagen die Server-Logfiles gelöscht werden
    'backup_tage' => 90,          // nach wie vielen Tagen Datensicherungen gelöscht sind (14 Tage täglich + 12 Wochen wöchentlich, siehe infra/backup)

    // Zuständige Datenschutz-Aufsichtsbehörde (Sitz des Betreibers)
    'aufsicht' => 'Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg, Lautenschlagerstraße 20, 70173 Stuttgart, www.baden-wuerttemberg.datenschutz.de',

    'stand' => 'November 2026',
];
