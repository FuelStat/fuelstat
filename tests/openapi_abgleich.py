#!/usr/bin/env python3
"""Prüft, dass jede Route der API in docs/openapi.1.0.0.yaml steht und umgekehrt.

Liest die Routen aus backend/src/routes/*.js (router.get('/pfad', …) usw.) und vergleicht Methode und Pfad
mit den Pfaden der OpenAPI. Pfad-Parameter werden gleichgesetzt (:vehicleId ↔ {vehicleId}).
Aufruf: python3 tests/openapi_abgleich.py  (läuft in der CI im Job „YAML“)
"""
import glob
import os
import re
import sys

import yaml

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
METHODEN = ('get', 'post', 'put', 'patch', 'delete')


def normal(pfad):
    return re.sub(r'\{[^}]+\}', '{}', re.sub(r':[A-Za-z_]+', '{}', pfad))


def routen_im_code():
    gefunden = set()
    for datei in sorted(glob.glob(os.path.join(WURZEL, 'backend/src/routes/*.js'))):
        quelle = open(datei, encoding='utf-8').read()
        for methode, pfad in re.findall(r"router\.(get|post|put|patch|delete)\(\s*'([^']+)'", quelle):
            gefunden.add((methode.upper(), normal('/api/v1' + pfad)))
    return gefunden


def routen_in_openapi():
    spec = yaml.safe_load(open(os.path.join(WURZEL, 'docs/openapi.1.0.0.yaml'), encoding='utf-8'))
    gefunden = set()
    for pfad, eintrag in spec['paths'].items():
        for methode in eintrag:
            if methode in METHODEN:
                gefunden.add((methode.upper(), normal(pfad)))
    return gefunden


def main():
    code, doku = routen_im_code(), routen_in_openapi()
    if not code:
        print('FEHLER: keine Routen in backend/src/routes gefunden – hat sich die Schreibweise geändert?')
        return 1
    fehlt = sorted(code - doku, key=lambda r: (r[1], r[0]))
    zuviel = sorted(doku - code, key=lambda r: (r[1], r[0]))
    for methode, pfad in fehlt:
        print(f'FEHLT in der OpenAPI: {methode} {pfad}')
    for methode, pfad in zuviel:
        print(f'NUR in der OpenAPI (Route gibt es nicht): {methode} {pfad}')
    if fehlt or zuviel:
        print('docs/openapi.1.0.0.yaml und docs/api.md anpassen (siehe CLAUDE.md, Checkliste).')
        return 1
    print(f'ok   {len(code)} Routen, alle in der OpenAPI dokumentiert')
    return 0


if __name__ == '__main__':
    sys.exit(main())
