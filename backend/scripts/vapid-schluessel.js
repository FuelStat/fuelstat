#!/usr/bin/env node
// VAPID-Schlüssel für Push-Benachrichtigungen erzeugen (#136). Einmal pro Installation; die Zeilen in infra/.env
// eintragen und die API neu starten. Der private Schlüssel bleibt nur dort (nie ins Repository, nie in die Apps).
// Ein neuer Schlüssel macht alle bestehenden Push-Abos ungültig: Die Geräte müssen Push neu aktivieren.
//
// Aufruf im API-Container:
//   docker compose exec api node scripts/vapid-schluessel.js
const webpush = require('web-push');

const k = webpush.generateVAPIDKeys();
console.log('# Push-Benachrichtigungen (#136) – in infra/.env eintragen, dann: sudo docker compose up -d');
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('# Kontakt für die Push-Dienste (mailto: oder https-Adresse), sonst gilt APP_URL');
console.log('VAPID_SUBJECT=mailto:betreiber@example.de');
