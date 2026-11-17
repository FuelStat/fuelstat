#!/usr/bin/env bash
# Eine Version veröffentlichen und ausrollen, in einem Zug (nach dem gemergten Release-PR, docs/betrieb.md):
#   1. Prüfen: main enthält den Release-PR (VERSION, backend/package.json, CHANGELOG.md mit ## [X.Y.Z]),
#      Tag frei oder schon richtig gesetzt, Mindest-App-Version anzeigen
#   2. Auf die CI von main warten (alle Checks grün)
#   3. Tag vX.Y.Z auf genau diesen Commit setzen und pushen
#   4. Auf den Workflow „Release“ warten (GitHub-Release und API-Image ghcr.io/fuelstat/fuelstat-api:X.Y.Z)
#   5. Sichern (fuelstat-backup.service)
#   6. infra/ausrollen.sh X.Y.Z (Image laden, Code aufs Tag, Migrationen, API starten, /health)
#
# Aufruf auf dem Server, im Projektordner:   sudo infra/veroeffentlichen.sh 0.13.2
# Nur prüfen, nichts ändern:                 sudo infra/veroeffentlichen.sh 0.13.2 --pruefen
#
# Git läuft als Besitzer des Projektordners (sudo -u <besitzer> git …); er braucht Push-Rechte für Tags.
# GitHub wird ohne Anmeldung abgefragt (öffentliches Repository, 60 Anfragen je Stunde); mit GITHUB_TOKEN in der
# Umgebung (sudo --preserve-env=GITHUB_TOKEN …) gilt das höhere Limit. Braucht curl und python3.
# shellcheck disable=SC1111  # deutsche Anführungszeichen in Meldungen sind gewollt
set -euo pipefail

version="${1:-}"
version="${version#v}"
nur_pruefen=0
[ "${2:-}" = "--pruefen" ] && nur_pruefen=1
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "Aufruf: sudo infra/veroeffentlichen.sh X.Y.Z [--pruefen]" >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo aufrufen (Sicherung und Ausrollen brauchen root)." >&2
  exit 2
fi
befehle=(curl python3 git)
[ "$nur_pruefen" = 1 ] || befehle+=(docker systemctl)
for befehl in "${befehle[@]}"; do
  command -v "$befehl" > /dev/null || { echo "Abbruch: $befehl fehlt." >&2; exit 1; }
done

projekt="$(cd "$(dirname "$0")/.." && pwd)"
besitzer="$(stat -c %U "$projekt")"
repo="FuelStat/fuelstat"
image="ghcr.io/fuelstat/fuelstat-api:$version"
git_() { sudo -u "$besitzer" -H git -C "$projekt" "$@"; }
frage() { local a; read -r -p "$1 [j/N] " a; [[ "$a" =~ ^[jJyY] ]]; }
abbruch() { echo; echo "Abbruch: $*" >&2; exit 1; }
# GitHub-API (öffentlich); Ausgabe ist JSON
gh_api() {
  local kopf=(-H "Accept: application/vnd.github+json")
  [ -n "${GITHUB_TOKEN:-}" ] && kopf+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsSL "${kopf[@]}" "https://api.github.com/repos/$repo/$1"
}
# Kleiner JSON-Ausschnitt mit Python: json_feld '<Ausdruck über d>' liest JSON von stdin
json_feld() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "== Fuelstat $version veröffentlichen (Projekt $projekt, Git als $besitzer)"
[ "$nur_pruefen" = 1 ] && echo "   (nur prüfen: kein Tag, keine Sicherung, kein Ausrollen)"

# --- 1. Prüfen --------------------------------------------------------------------------------------------------
git_ fetch --quiet origin main
commit="$(git_ rev-parse origin/main)"
kurz="${commit:0:7}"
datei_version="$(git_ show origin/main:VERSION | tr -d '[:space:]')"
paket_version="$(git_ show origin/main:backend/package.json | json_feld "d['version']")"
echo "main steht auf $kurz ($(git_ log -1 --format='%cs, %s' origin/main))"
if [ "$datei_version" != "$version" ] || [ "$paket_version" != "$version" ]; then
  abbruch "main hat VERSION $datei_version und backend/package.json $paket_version, nicht $version.
Ist der Release-PR (node backend/scripts/neue-version.js $version) schon gemergt?"
fi
git_ show origin/main:CHANGELOG.md | grep -q "^## \[$version\] - " \
  || abbruch "CHANGELOG.md auf main hat keinen Abschnitt „## [$version] - JJJJ-MM-TT“."
git_ show origin/main:docs/update-hinweise.md 2> /dev/null | grep -q "^## \[$version\]" \
  || echo "Hinweis: docs/update-hinweise.md hat keinen Abschnitt [$version] (ausrollen.sh zeigt dann keine Hinweise)."
echo "VERSION, backend/package.json und CHANGELOG.md passen zu $version."

# Tag: auf GitHub frei oder schon auf genau diesem Commit. Ein vorhandenes Tag auf einem anderen Commit wird nie
# verschoben (siehe docs/betrieb.md); ein liegengebliebenes lokales Tag ohne Gegenstück auf GitHub wird ersetzt.
tag_entfernt="$(git_ ls-remote --tags origin "refs/tags/v$version^{}" | cut -f1)"
[ -z "$tag_entfernt" ] && tag_entfernt="$(git_ ls-remote --tags origin "refs/tags/v$version" | cut -f1)"
tag_setzen=1
if [ -n "$tag_entfernt" ]; then
  [ "$tag_entfernt" = "$commit" ] || abbruch "Tag v$version gibt es auf GitHub schon, aber auf ${tag_entfernt:0:7} statt $kurz.
Ein veröffentlichtes Tag wird nicht verschoben. Ist kein GitHub-Release dazu entstanden, kann es von Hand gelöscht
und dieses Skript erneut gestartet werden:  sudo -u $besitzer -H git push origin :refs/tags/v$version"
  echo "Tag v$version steht auf GitHub schon auf $kurz, wird nicht neu gesetzt."
  tag_setzen=0
fi

# Mindest-App-Version: die Entscheidung steht im Release-PR; hier nur zur Kontrolle
ios_app="$(git ls-remote --tags https://github.com/FuelStat/fuelstat-ios.git 2> /dev/null | grep -o 'refs/tags/v[0-9.]*$' \
  | sed 's#refs/tags/v##' | sort -V | tail -1 || true)"
echo "Mindest-App-Version laut backend/src/lib/appVersions.js:"
git_ show origin/main:backend/src/lib/appVersions.js | grep -E "^\s*(ios|android):" | sed 's/^/   /'
echo "   neueste veröffentlichte iOS-App: ${ios_app:-unbekannt}"

# --- 2. CI von main ---------------------------------------------------------------------------------------------
# Wartet, bis alle Checks des Commits fertig sind (höchstens 20 Minuten); jeder nicht erfolgreiche Check bricht ab
echo
echo "== CI von main ($kurz)"
for versuch in $(seq 1 60); do
  stand="$(gh_api "commits/$commit/check-runs?per_page=100" | json_feld "
' '.join(['offen' if r['status']!='completed' else ('ok' if r['conclusion'] in ('success','skipped','neutral') else 'fehler:'+r['name'].replace(' ','_')) for r in d['check_runs']]) or 'keine'")" \
    || abbruch "GitHub-API nicht erreichbar (Limit? Dann mit GITHUB_TOKEN, siehe Kopf des Skripts)."
  case " $stand " in
    *" fehler:"*) abbruch "CI von main ist rot: $(tr ' ' '\n' <<< "$stand" | grep '^fehler:' | sed 's/^fehler://' | tr '_\n' ' ,')
https://github.com/$repo/commit/$commit" ;;
    *" offen "*) [ "$versuch" = 1 ] && echo -n "Checks laufen noch, warte "; echo -n "."; sleep 20 ;;
    " keine ") echo "Keine Checks gefunden."; frage "Trotzdem weiter?" || exit 1; break ;;
    *) echo; echo "Alle Checks grün ($(wc -w <<< "$stand"))."; break ;;
  esac
  [ "$versuch" = 60 ] && { echo; frage "Checks laufen nach 20 Minuten noch. Trotzdem weiter?" || exit 1; }
done

if [ "$nur_pruefen" = 1 ]; then
  echo
  echo "== Prüfung bestanden. Veröffentlichen mit: sudo infra/veroeffentlichen.sh $version"
  exit 0
fi

echo
if [ "$tag_setzen" = 1 ]; then
  frage "Tag v$version auf $kurz setzen, veröffentlichen und danach ausrollen?" || exit 1
else
  frage "Release v$version abwarten und ausrollen?" || exit 1
fi

# --- 3. Tag -----------------------------------------------------------------------------------------------------
if [ "$tag_setzen" = 1 ]; then
  echo "== Tag v$version setzen und pushen"
  if git_ rev-parse --quiet --verify "refs/tags/v$version" > /dev/null; then
    echo "Lokales Tag v$version ohne Gegenstück auf GitHub wird ersetzt (war $(git_ rev-parse --short "v$version^{}"))."
    git_ tag -d "v$version" > /dev/null
  fi
  git_ tag -a "v$version" -m "Fuelstat $version" "$commit"
  git_ push --quiet origin "v$version"
  # Andere lokale Tags auf den Stand von GitHub bringen, damit ausrollen.sh nicht an einem veralteten Tag hängt
  git_ fetch --quiet --tags origin
fi

# --- 4. Workflow „Release“ --------------------------------------------------------------------------------------
echo "== Workflow „Release“ abwarten (GitHub-Release und $image)"
run_url=""
for versuch in $(seq 1 90); do
  ergebnis="$(gh_api "actions/runs?event=push&head_sha=$commit&per_page=20" | json_feld "
next((r['status']+' '+(r['conclusion'] or '-')+' '+r['html_url'] for r in d['workflow_runs'] if r['name']=='Release'), 'fehlt')")" \
    || ergebnis="fehlt"
  if [ "$ergebnis" != "fehlt" ]; then
    read -r status schluss run_url <<< "$ergebnis"
    if [ "$status" = "completed" ]; then
      echo
      [ "$schluss" = "success" ] || abbruch "Workflow „Release“ ist mit „$schluss“ beendet: $run_url
Das Tag steht; nach der Korrektur auf main kann ein Patch-Release folgen (ein Tag wird nicht verschoben)."
      echo "Release fertig: $run_url"
      break
    fi
  fi
  [ "$versuch" = 1 ] && echo -n "warte "
  echo -n "."
  sleep 20
  [ "$versuch" = 90 ] && abbruch "Workflow „Release“ ist nach 30 Minuten nicht fertig${run_url:+: $run_url}"
done
docker manifest inspect "$image" > /dev/null 2>&1 \
  || abbruch "Das Image $image ist nicht abrufbar, obwohl der Workflow durchlief. Bitte $run_url prüfen."
echo "Image $image ist abrufbar."

# --- 5. Sichern -------------------------------------------------------------------------------------------------
echo "== Sichern"
if systemctl cat fuelstat-backup.service > /dev/null 2>&1; then
  systemctl start fuelstat-backup.service || abbruch "Sicherung fehlgeschlagen (journalctl -u fuelstat-backup.service)."
  echo "Sicherung fertig."
else
  echo "fuelstat-backup.service ist nicht eingerichtet (docs/betrieb.md, „Datensicherung“)."
  frage "Ohne Sicherung ausrollen?" || exit 1
fi

# --- 6. Ausrollen -----------------------------------------------------------------------------------------------
echo "== Ausrollen"
exec "$projekt/infra/ausrollen.sh" "$version"
