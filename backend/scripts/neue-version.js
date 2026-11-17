#!/usr/bin/env node
// Neue Version vorbereiten (#111): trägt die Versionsnummer überall gleich ein und schließt den
// Abschnitt "Unreleased" im CHANGELOG und in docs/update-hinweise.md (Hinweise für Betreiber) ab. Danach committen, mergen und das Tag setzen (siehe docs/betrieb.md).
//
//   node backend/scripts/neue-version.js 0.10.0            # Datum: heute
//   node backend/scripts/neue-version.js 0.10.0 2026-11-20
//
// Einzige Quelle der Versionsnummer ist die Datei VERSION. package.json/package-lock.json (für die API im
// Docker-Image) werden hier mitgezogen; tests/VersionTest.php prüft in der CI, dass alles übereinstimmt.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const [version, datumArg] = process.argv.slice(2);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

function fehler(text) { console.error(text); process.exit(1); }

if (!version || !SEMVER.test(version)) fehler('Aufruf: node backend/scripts/neue-version.js <MAJOR.MINOR.PATCH[-vorab]> [JJJJ-MM-TT]');
const datum = datumArg || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) fehler('Datum im Format JJJJ-MM-TT angeben');

const alt = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
if (alt === version) fehler(`VERSION ist bereits ${version}`);

// CHANGELOG: Inhalt von [Unreleased] wird zur neuen Version, darüber ein leerer [Unreleased]-Abschnitt
const clPfad = path.join(ROOT, 'CHANGELOG.md');
let cl = fs.readFileSync(clPfad, 'utf8');
// Nur die Überschrift am Zeilenanfang zählt, nicht ein Vorkommen im Fließtext (z. B. in Backticks in der Einleitung)
const UNRELEASED = /^## \[Unreleased\][ \t]*$/m;
if (!UNRELEASED.test(cl)) fehler('CHANGELOG.md: Abschnitt "## [Unreleased]" fehlt');
const nachUnreleased = cl.slice(cl.search(UNRELEASED) + '## [Unreleased]'.length).split(/\n## \[/)[0];
if (!/^\s*- /m.test(nachUnreleased)) fehler('CHANGELOG.md: unter [Unreleased] steht noch nichts – erst die Änderungen eintragen');
cl = cl.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}] - ${datum}`);
cl = cl.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: https://github.com/FuelStat/fuelstat/compare/v${version}...HEAD\n[${version}]: https://github.com/FuelStat/fuelstat/compare/v${alt}...v${version}`);
fs.writeFileSync(clPfad, cl);

// Update-Hinweise für Betreiber (nicht Teil der Release-Notes): [Unreleased] wird zur neuen Version, auch wenn er leer ist
const uhPfad = path.join(ROOT, 'docs', 'update-hinweise.md');
let uh = null;
try {
  uh = fs.readFileSync(uhPfad, 'utf8'); // ohne vorherige Existenzprüfung (Dateisystem-Race): fehlt die Datei, ist uh null
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (uh !== null) {
  if (!UNRELEASED.test(uh)) fehler('docs/update-hinweise.md: Abschnitt "## [Unreleased]" fehlt');
  fs.writeFileSync(uhPfad, uh.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}] - ${datum}`));
}

fs.writeFileSync(path.join(ROOT, 'VERSION'), version + '\n');
for (const datei of ['backend/package.json', 'backend/package-lock.json']) {
  const p = path.join(ROOT, datei);
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  json.version = version;
  if (json.packages && json.packages['']) json.packages[''].version = version;
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n');
}

console.log(`Version ${alt} -> ${version} (${datum}) eingetragen: VERSION, CHANGELOG.md, docs/update-hinweise.md, backend/package.json, backend/package-lock.json`);
console.log(`Weiter: committen, PR mergen, dann auf main: git tag -a v${version} -m "Fuelstat ${version}" && git push origin v${version}`);
