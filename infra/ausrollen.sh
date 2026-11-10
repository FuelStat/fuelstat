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
# Zwischenstand (neuester main, unveröffentlicht): sudo infra/ausrollen.sh main
#   Gleiche Reihenfolge, aber die API wird aus dem Code gebaut statt geladen; fragt nur nach, wenn Migrationen
#   oder geänderte Beispiel-Konfiguration anstehen. Zurück auf ein Release: sudo infra/ausrollen.sh X.Y.Z
#
# Git läuft als Besitzer des Projektordners (sudo -u <besitzer> git …), Docker und systemctl als root.
# Danach steht der Code auf dem Tag (detached HEAD) bzw. auf main.
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
zwischenstand=0
if [ "$version" = "main" ]; then
  zwischenstand=1
elif ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "Aufruf: sudo infra/ausrollen.sh X.Y.Z   bzw. für den neuesten Stand von main: sudo infra/ausrollen.sh main" >&2
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
if [ "$zwischenstand" = 1 ]; then
  ziel="origin/main"
  git_ fetch --quiet origin main
elif git_ rev-parse --quiet --verify "refs/tags/v$version" > /dev/null; then
  ziel="v$version"
else
  echo "Abbruch: Tag v$version gibt es nicht. Ist das Release veröffentlicht?" >&2
  exit 1
fi

alt="$(tr -d '[:space:]' < "$projekt/VERSION")"
# Zuletzt mit diesem Skript ausgerollter Commit (FUELSTAT_COMMIT in infra/.env). Nicht HEAD: Wer zwischendurch
# per "git pull" Code geholt hat, hat API und Datenbank damit noch nicht aktualisiert.
ausgerollt="$(grep -E '^FUELSTAT_COMMIT=' "$infra/.env" | cut -d= -f2 || true)"
if [ -n "$ausgerollt" ] && ! git_ cat-file -e "$ausgerollt^{commit}" 2> /dev/null; then ausgerollt=""; fi
if [ "$zwischenstand" = 1 ]; then
  stand="${ausgerollt:-HEAD}"
  echo "Bisher: $alt ($(git_ log -1 --format='%h %cs' "$stand"))  →  neu: main ($(git_ log -1 --format='%h %cs, %s' "$ziel"))"
  if [ "$(git_ rev-parse "$stand")" = "$(git_ rev-parse "$ziel")" ] && [ "$(git_ rev-parse HEAD)" = "$(git_ rev-parse "$ziel")" ]; then
    echo "Schon auf dem neuesten Stand von main – nichts zu tun."
    exit 0
  fi
  echo
  echo "== Neu seit dem bisherigen Stand"
  git_ log --oneline --no-merges "$stand..$ziel" | head -n 30 || true
  echo
  echo "== Hinweise zum Update (CHANGELOG.md, [Unreleased])"
  version_changelog="Unreleased"
else
  echo "Bisher: $alt  →  neu: $version"
  echo
  echo "== Hinweise zum Update (CHANGELOG.md, Version $version)"
  version_changelog="$version"
fi
git_ show "$ziel:CHANGELOG.md" | awk -v v="$version_changelog" '
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
# Ein Zwischenstand nach dem anderen: nur die Migrationen seit dem zuletzt ausgerollten Commit
if [ "$zwischenstand" = 1 ] && [ -n "$ausgerollt" ]; then basis="$ausgerollt"; fi
mapfile -t migrationen < <(git_ diff --name-only --diff-filter=A "$basis" "$ziel" -- 'backend/database/postgres_0*.sql' | sort)
mapfile -t beispiele < <(git_ diff --name-only "$basis" "$ziel" -- infra/.env.example infra/nginx-sicherheit.conf.example infra/nginx/fuelstat.conf.example infra/backup/backup.env.example)
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
if [ "$zwischenstand" = 0 ] || [ "${#migrationen[@]}" -gt 0 ] || [ "${#beispiele[@]}" -gt 0 ]; then
  frage "Weiter mit Version $version?" || { echo "Abgebrochen, nichts geändert."; exit 1; }
fi

if [ "$zwischenstand" = 1 ]; then
  echo "== Code auf main umstellen"
  if git_ rev-parse --quiet --verify refs/heads/main > /dev/null; then
    git_ checkout --quiet main
    git_ merge --quiet --ff-only "$ziel" || {
      echo "Abbruch: Der lokale Branch main weicht von origin/main ab. Erst klären (git log main...origin/main)." >&2; exit 1; }
  else
    git_ checkout --quiet -b main "$ziel"
  fi
  echo "== API-Image aus dem Code bauen (die laufende API bleibt bis Schritt 5 unverändert)"
  compose build api
else
  echo "== API-Image laden (die laufende API bleibt bis Schritt 5 unverändert)"
  compose pull api

  echo "== Code auf v$version umstellen"
  git_ -c advice.detachedHead=false checkout --quiet "v$version"
fi

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

setze_env() {
  if grep -q "^$1=" "$infra/.env"; then
    sed -i "s/^$1=.*/$1=$2/" "$infra/.env"
  else
    printf '\n# Gesetzt von infra/ausrollen.sh\n%s=%s\n' "$1" "$2" >> "$infra/.env"
  fi
}
commit="$(git_ rev-parse HEAD)"
echo "== Version in infra/.env festhalten (FUELSTAT_VERSION=$version, FUELSTAT_COMMIT=${commit:0:7})"
setze_env FUELSTAT_VERSION "$version"
setze_env FUELSTAT_COMMIT "$commit"

echo "== API starten"
compose up -d api

for dienst in $(systemctl list-units --type=service --state=running --no-legend 'php*-fpm.service' | awk '{print $1}'); do
  echo "== $dienst neu laden"
  systemctl reload "$dienst"
done

echo "== Health prüfen"
port="$(grep -E '^API_PORT=' "$infra/.env" | cut -d= -f2 || true)"
# Ein Zwischenstand meldet die Versionsnummer aus VERSION (das letzte Release bzw. die vorbereitete neue)
erwartet="$version"
if [ "$zwischenstand" = 1 ]; then erwartet="$(tr -d '[:space:]' < "$projekt/VERSION")"; fi
for _ in $(seq 1 30); do
  antwort="$(curl -fsS "http://127.0.0.1:${port:-3000}/api/v1/health" 2>/dev/null || true)"
  if [[ "$antwort" == *"\"version\":\"$erwartet\""* ]]; then
    echo "$antwort"
    if [ "$zwischenstand" = 1 ]; then
      echo "== Fertig: Zwischenstand main ($(git_ log -1 --format='%h' HEAD)) läuft. Zurück auf das Release: sudo $selbst $alt"
    else
      echo "== Fertig: Fuelstat $version läuft. Zurückrollen: sudo $selbst $alt"
    fi
    exit 0
  fi
  sleep 2
done
echo "Warnung: /api/v1/health meldet nach 60 s nicht Version $erwartet: ${antwort:-keine Antwort}" >&2
echo "Logs: cd infra && sudo docker compose logs --tail 50 api" >&2
exit 1
