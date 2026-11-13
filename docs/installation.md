# Installation

Vollständige Anleitung für eine eigene Fuelstat-Installation auf einem Linux-Server. Kurzfassung und Überblick: [README](../README.md). Updates, Migrationen und Datensicherung: [Betrieb](betrieb.md).

Getestet ab frischem Clone: Docker (API, PostgreSQL, Adminer), nginx mit der Beispielkonfiguration, PHP-FPM.

## Voraussetzungen

- Docker mit Compose (für API und Datenbank)
- PHP 8.1 oder neuer (getestet mit 8.4) als PHP-FPM, mit den Erweiterungen `curl`, `mbstring` und `fileinfo`
- nginx (oder ein anderer Webserver mit Reverse Proxy) mit HTTPS

## 1. API und Datenbank (Docker)

Das Repository wird direkt in den späteren Webroot geklont (hier `/srv/www/fuelstat/public`, wie in den nginx-Beispielen):

```bash
sudo mkdir -p /srv/www/fuelstat && sudo chown "$USER" /srv/www/fuelstat
git clone https://github.com/FuelStat/fuelstat.git /srv/www/fuelstat/public
cd /srv/www/fuelstat/public/infra
cp .env.example .env    # Datenbank-Passwort, JWT_SECRET, MAIL_ENCRYPTION_KEY eintragen, alle Optionen sind dort beschrieben
openssl rand -base64 48 # je einmal für JWT_SECRET und MAIL_ENCRYPTION_KEY
mkdir -p ../uploads && sudo chown 1000:1000 ../uploads   # die API läuft als Benutzer "node" (UID 1000)
sudo docker compose up -d --build
curl -s http://127.0.0.1:3000/api/v1/health              # {"status":"healthy",…}
```

Die API läuft danach auf `127.0.0.1:3000`, Adminer auf `127.0.0.1:8080` (beides nur lokal erreichbar). Die API läuft im `prod`-Container: Code und Pakete stecken im Image, ohne Root-Rechte. Beim allerersten Start legt Postgres das komplette Schema aus `backend/database/postgres_init.sql` automatisch an.

Wird `JWT_SECRET` später ohne eigenen `MAIL_ENCRYPTION_KEY` geändert, lassen sich gespeicherte SMTP-Passwörter und 2FA-Schlüssel nicht mehr entschlüsseln: Benutzer müssen ihr SMTP-Passwort neu eingeben, und 2FA muss für betroffene Konten zurückgesetzt werden. Deshalb `MAIL_ENCRYPTION_KEY` am besten von Anfang an fest setzen.

## 2. Frontend (PHP)

- Das Repository-Wurzelverzeichnis ist der Webroot des Frontends.
- Eine Datenbankverbindung braucht das Frontend nicht: Es liest und schreibt ausschließlich über die API. Eine alte `includes/db_connect.php` aus der MySQL-Zeit kann gelöscht werden.
- API-Adresse: Das Frontend ruft die API serverseitig auf, standardmäßig direkt unter `http://127.0.0.1:3000/api/v1`. Das nginx-Beispiel setzt `FUELSTAT_API_BASE_URL` ausdrücklich; bei anderem Port oder Server dort bzw. im PHP-FPM-Pool (`env[FUELSTAT_API_BASE_URL] = …`) anpassen. **Nicht die öffentliche Adresse eintragen:** Dann geht jeder API-Aufruf über das Internet (bzw. Cloudflare) und kostet je ca. 0,2 s – bei 6–7 Aufrufen pro Seite deutlich spürbar.
- Tankstellensuche: Tankerkönig-API-Key (kostenlos auf creativecommons.tankerkoenig.de) als `TANKERKOENIG_API_KEY` in `infra/.env` eintragen.
- Ladestationssuche für E-Autos und Plug-in-Hybride: Open-Charge-Map-API-Key (kostenlos, openchargemap.org → Mein Profil → API-Schlüssel) als `OCM_API_KEY` in `infra/.env` eintragen.
- Beide Suchen laufen für Web-App und Apps über die API (`/api/v1/stations`, `/api/v1/charging-stations`); die Keys liegen nur in `infra/.env`. Nach Änderungen die API neu starten (`docker compose up -d`).
- Betreiberangaben für Impressum und Datenschutzerklärung in `includes/betreiber.php` eintragen.
- Bootstrap, Chart.js, QRCode.js und Font Awesome liegen in `vendor/` bzw. `css/` und `webfonts/`. Es werden keine CDNs geladen (siehe `vendor/README.md`).

## 3. Webserver (nginx)

Eine vollständige Konfiguration liegt in `infra/nginx/fuelstat.conf.example`. Platzhalter ersetzen: Domain `fuelstat.example.de`, Webroot `/srv/www/fuelstat/public`, FPM-Socket `/run/php/php8.4-fpm.sock`. Vorher das Zertifikat holen, solange nginx noch mit der Standardseite läuft: `sudo certbot certonly --nginx -d fuelstat.example.de` (Verlängerungen laufen danach automatisch).

```bash
sudo cp infra/nginx-sicherheit.conf.example /etc/nginx/snippets/fuelstat-sicherheit.conf
sudo cp infra/nginx/fuelstat.conf.example /etc/nginx/sites-available/fuelstat.conf   # danach Platzhalter ersetzen
sudo ln -s /etc/nginx/sites-available/fuelstat.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Was die Beispielkonfiguration erledigt:

| Bereich | Einstellung |
|---|---|
| HTTPS | Weiterleitung von HTTP, Let's Encrypt über `/.well-known/acme-challenge/`, HSTS und weitere Sicherheits-Header |
| API | `/api/v1/` → Node-API auf `127.0.0.1:3000` (auch die signierten Bilder unter `/api/v1/files/`) |
| PHP | PHP-FPM mit `FUELSTAT_API_BASE_URL=http://127.0.0.1:3000/api/v1` (API direkt, nicht über das Internet) |
| Uploads | Upload-Grenze 20 MB (`client_max_body_size`); `/uploads/` ist gesperrt, Bilder gibt nur die API heraus |
| Caching | CSS/JS mit `?v=` ein Jahr `immutable` (`map $arg_v $asset_cache` ganz oben), ohne Version `no-cache`; Bilder und Schriften 30 Tage; `service-worker.js` immer `no-cache`. PHP-Seiten setzen selbst `private, no-cache` |
| Sperren | Snippet `fuelstat-sicherheit.conf`, siehe unten |

- Wer eine eigene Konfiguration hat, übernimmt mindestens: das Snippet **ganz oben** im `server`-Block (`include snippets/fuelstat-sicherheit.conf;`), den `/api/v1/`-Proxy, `FUELSTAT_API_BASE_URL` im PHP-Block, `client_max_body_size 20m;` und die `map` für die Cache-Dauer samt `add_header Cache-Control $asset_cache;` im CSS/JS-Block. **Wichtig:** `$asset_cache` gehört nur in den CSS/JS-Block, Bilder und Schriften behalten `expires 30d;`.
- Das Snippet sperrt interne Verzeichnisse (`backend/`, `infra/`, `tests/`, `docs/` …), versteckte Dateien wie `.env` und `.git`, alle `*.key`-Dateien, Doku-/Konfigurationsdateien (`*.md`, `*.yml`, `*.sql`, `*.sh` …) und `/uploads/`, und liefert `/.well-known/security.txt` als Text aus. **Ohne diese Regeln sind `.env`-Dateien und API-Schlüssel abrufbar.**
- Nach Updates prüfen, ob sich die Beispiele geändert haben (`git diff ORIG_HEAD -- infra/nginx-sicherheit.conf.example infra/nginx/fuelstat.conf.example`), und die Änderungen übernehmen.
- Bei OPcache mit `opcache.validate_timestamps=0` nach jedem Deploy PHP-FPM neu laden (z. B. `systemctl reload php8.4-fpm`).

**Prüfen** (Domain einsetzen; `--resolve` fragt am Server direkt nginx, an einem CDN vorbei):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://fuelstat.example.de/README.md          # 404
curl -s -o /dev/null -w '%{http_code}\n' https://fuelstat.example.de/api/key.key        # 404 (alte Key-Datei, falls noch vorhanden)
curl -s -o /dev/null -w '%{http_code}\n' https://fuelstat.example.de/uploads/x.jpg      # 404
curl -s https://fuelstat.example.de/api/v1/health                                       # {"status":"healthy",…}
curl -sk -D - -o /dev/null --resolve fuelstat.example.de:443:127.0.0.1 "https://fuelstat.example.de/css/style.css?v=1" | grep -i cache-control   # public, max-age=31536000, immutable
```

**Hinter Cloudflare (optional):**
- SSL/TLS-Modus „Full (strict)“ (nginx hat ein eigenes Zertifikat).
- Caching → Configuration → Browser Cache TTL: „Respect Existing Headers“, sonst ersetzt Cloudflare die Cache-Dauer der Dateien.
- HTML und `/api/` nicht über Cache-Regeln zwischenspeichern; Seiten und Bilder senden ohnehin `private`.
- **Echte Besucher-IP in nginx herstellen** (`real_ip`), sonst sehen PHP-Frontend und API nur Cloudflare-Adressen: Login-Sperren und Rate-Limits je IP träfen dann viele Nutzer gemeinsam. In den `server`-Block bzw. eine eingebundene Datei:

  ```nginx
  # Aktuelle Liste: https://www.cloudflare.com/ips/ (IPv4 und IPv6, regelmäßig prüfen)
  set_real_ip_from 173.245.48.0/20;
  # … alle weiteren Bereiche von cloudflare.com/ips …
  real_ip_header CF-Connecting-IP;
  ```

## 4. Erstes Konto und Admin

1. Auf der Seite registrieren.
2. Die eigene User-ID nachsehen und in `infra/.env` bei `ADMIN_USER_IDS` eintragen:

   ```bash
   sudo docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id, email from users"'
   ```

3. Die API neu starten: `sudo docker compose up -d`. Danach erscheinen Benutzerverwaltung und Feedback-Eingang im Profilmenü. Der SMTP-Zugang des ersten Admins dient als Standard-Mailserver für alle Benutzer ohne eigenen.

## 5. Push-Benachrichtigungen (optional)

Erinnerungen und Monatsbericht kommen auf Wunsch auch als Push-Benachrichtigung der installierten Web-App: auf
Android, am Computer und auf dem iPhone/iPad ab iOS 16.4 (dort erst nach „Zum Home-Bildschirm“). Dafür braucht der
Server ein VAPID-Schlüsselpaar, das nur in `infra/.env` liegt:

```bash
cd infra
sudo docker compose exec api node scripts/vapid-schluessel.js
```

Die drei Zeilen (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` mit deiner Kontaktadresse) in `infra/.env`
eintragen und die API neu starten (`sudo docker compose up -d`). Danach zeigt die Seite „Benachrichtigungen“ den Knopf
„Benachrichtigungen aktivieren“. Die Schlüssel nicht wechseln: Ein neues Paar macht alle Push-Abos ungültig.
Die API muss die Push-Dienste von Google, Apple, Mozilla und Microsoft per HTTPS erreichen können.
