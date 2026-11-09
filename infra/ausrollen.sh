#!/usr/bin/env bash
# Eine veröffentlichte Version ausrollen (#134), in der Reihenfolge aus docs/betrieb.md („Aktualisieren“):
#   1. Tag holen, Hinweise zum Update und neue Migrationen anzeigen
#   2. API-Image der Version laden (die alte API läuft dabei weiter)
#   3. Code auf das Tag umstellen
#   4. neue Migrationen einspielen – vor dem Neustart der API
#   5. API mit dem neuen Image starten, PHP-FPM neu laden, /health prüfen
#
# Aufruf auf dem Server, im Projektordner:   sudo infra/ausrollen.sh 0.11.0
# Zurückrollen auf die vorige Version:       sudo infra/ausrollen.sh 0.10.0   (Migrationen bleiben, sie sind abwärtsverträglich)
#
# Git läuft als Besitzer des Projektordners (sudo -u <besitzer> git …), Docker und systemctl als root.
# Danach steht der Code auf dem Tag (detached HEAD); zurück auf main: git checkout main
set -euo pipefail

# Das Skript stellt den Code um und würde sich dabei selbst ändern, während Bash es noch liest: als Kopie ausführen
if [ -z "${FUELSTAT_AUSROLLEN_PROJEKT:-}" ]; then
  FUELSTAT_AUSROLLEN_PROJEKT="$(cd "$(dirname "$0")/.." && pwd)"
  kopie="$(mktemp)"
  cp "$0" "$kopie"
  export FUELSTAT_AUSROLLEN_PROJEKT
  exec bash "$kopie" "$@"
fi
projekt="$FUELSTAT_AUSROLLEN_PROJEKT"
case "$0" in "${TMPDIR:-/tmp}"/*) rm -f "$0" ;; esac   # nur die temporäre Kopie löschen; Bash hat sie geöffnet
selbst="$projekt/infra/ausrollen.sh"

version="${1:-}"
version="${version#v}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "Aufruf: sudo infra/ausrollen.sh X.Y.Z" >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo aufrufen (Docker und PHP-FPM brauchen root)." >&2
  exit 2
fi

infra="$projekt/infra"
besitzer="$(stat -c %U "$projekt")"
git_() { sudo -u "$besitzer" -H git -C "$projekt" "$@"; }
compose() { (cd "$infra" && FUELSTAT_VERSION="$version" docker compose "$@"); }
frage() { local a; read -r -p "$1 [j/N] " a; [[ "$a" =~ ^[jJyY] ]]; }

echo "== Fuelstat $version ausrollen (Projekt $projekt, Git als $besitzer)"

if [ -n "$(git_ status --porcelain --untracked-files=no)" ]; then
  echo "Abbruch: Im Projektordner gibt es geänderte Dateien (git status). Erst klären, dann erneut starten." >&2
  exit 1
fi

git_ fetch --quiet --tags origin
if ! git_ rev-parse --quiet --verify "refs/tags/v$version" > /dev/null; then
  echo "Abbruch: Tag v$version gibt es nicht. Ist das Release veröffentlicht?" >&2
  exit 1
fi

alt="$(tr -d '[:space:]' < "$projekt/VERSION")"
echo "Bisher: $alt  →  neu: $version"

echo
echo "== Hinweise zum Update (CHANGELOG.md, Version $version)"
git_ show "v$version:CHANGELOG.md" | awk -v v="$version" '
  /^## \[/ { drin = (index($0, "## [" v "]") == 1); next }
  drin && /^### Hinweise zum Update/ { h = 1; print; next }
  drin && /^### / { h = 0 }
  drin && h { print }
' || true
echo "(Bei mehreren übersprungenen Versionen auch deren Hinweise lesen: CHANGELOG.md)"

# Vergleich mit dem Tag der bisherigen Version (nicht mit dem ausgecheckten Stand): Auch wer vorher per
# "git pull" auf main stand, bekommt so alle Migrationen seit dem letzten Release. Sie sind mehrfach ausführbar.
basis="HEAD"
if git_ rev-parse --quiet --verify "refs/tags/v$alt" > /dev/null; then basis="v$alt"; fi
mapfile -t migrationen < <(git_ diff --name-only --diff-filter=A "$basis" "v$version" -- 'backend/database/postgres_0*.sql' | sort)
mapfile -t beispiele < <(git_ diff --name-only "$basis" "v$version" -- infra/.env.example infra/nginx-sicherheit.conf.example infra/nginx/fuelstat.conf.example infra/backup/backup.env.example)
echo
if [ "${#migrationen[@]}" -gt 0 ]; then
  echo "== Neue Migrationen: ${migrationen[*]}"
else
  echo "== Keine neuen Migrationen"
fi
if [ "${#beispiele[@]}" -gt 0 ]; then
  echo "== Geänderte Beispiel-Konfiguration (ggf. in .env bzw. nginx übernehmen): ${beispiele[*]}"
fi
echo
frage "Weiter mit Version $version?" || { echo "Abgebrochen, nichts geändert."; exit 1; }

echo "== API-Image laden (die laufende API bleibt bis Schritt 5 unverändert)"
compose pull api

echo "== Code auf v$version umstellen"
git_ -c advice.detachedHead=false checkout --quiet "v$version"

if [ "${#migrationen[@]}" -gt 0 ]; then
  echo "== Migrationen einspielen"
  for datei in "${migrationen[@]}"; do
    echo "-- $datei"
    compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$projekt/$datei"
  done
fi

if [ "${#beispiele[@]}" -gt 0 ]; then
  frage "Ist die Konfiguration (.env, nginx) laut Hinweisen nachgezogen?" || {
    echo "Code und Datenbank sind auf $version, die API läuft noch mit $alt. Nach dem Nachziehen erneut aufrufen."; exit 1; }
fi

echo "== Version in infra/.env festhalten (FUELSTAT_VERSION=$version)"
if grep -q '^FUELSTAT_VERSION=' "$infra/.env"; then
  sed -i "s/^FUELSTAT_VERSION=.*/FUELSTAT_VERSION=$version/" "$infra/.env"
else
  printf '\n# Gesetzt von infra/ausrollen.sh\nFUELSTAT_VERSION=%s\n' "$version" >> "$infra/.env"
fi

echo "== API starten"
compose up -d api

for dienst in $(systemctl list-units --type=service --state=running --no-legend 'php*-fpm.service' | awk '{print $1}'); do
  echo "== $dienst neu laden"
  systemctl reload "$dienst"
done

echo "== Health prüfen"
port="$(grep -E '^API_PORT=' "$infra/.env" | cut -d= -f2 || true)"
for _ in $(seq 1 30); do
  antwort="$(curl -fsS "http://127.0.0.1:${port:-3000}/api/v1/health" 2>/dev/null || true)"
  if [[ "$antwort" == *"\"version\":\"$version\""* ]]; then
    echo "$antwort"
    echo "== Fertig: Fuelstat $version läuft. Zurückrollen: sudo $selbst $alt"
    exit 0
  fi
  sleep 2
done
echo "Warnung: /api/v1/health meldet nach 60 s nicht Version $version: ${antwort:-keine Antwort}" >&2
echo "Logs: cd infra && sudo docker compose logs --tail 50 api" >&2
exit 1
