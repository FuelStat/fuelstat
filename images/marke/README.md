# Marke: Logo und App-Icon

Logo und App-Icon von **Biazu** (Umbenennung siehe #207). Beschrieben ist die Marke in
[`docs/design.md`](../../docs/design.md#2-marke). Diese Dateien sind die gemeinsame Quelle für Web/PWA, iOS und
Android; die Apps kopieren die Größen, die sie brauchen.

**Stand:** Die Dateien sind aus dem Screenshot des Entwurfs als Vektor nachgebaut (Geometrie und Farben
gemessen, Abweichung unter 1 % der Pixel). Liegt das Original als Vektor oder PDF vor, ersetzt es die
`.svg`-Dateien, die PNGs werden daraus neu erzeugt.

## Dateien

| Datei | Zweck |
|---|---|
| `biazu-icon.svg` | Master, quadratische Vollfläche ohne Rundung (Quelle für iOS und PWA) |
| `biazu-logo-rounded.svg` | Mit gerundeten Ecken, für README, Stores, Vorschau |
| `biazu-glyph.svg` | Nur das Zeichen (B mit Tachonadel), transparent |
| `icon-1024.png` | iOS (Xcode, App Store): 1024 × 1024, Vollfläche, ohne Alpha-Kanal |
| `icon-512.png`, `icon-192.png` | PWA `purpose: any` |
| `icon-maskable-512.png` | PWA `purpose: maskable`: Zeichen in der Sicherheitszone, Rand bleibt Navy |
| `icon-rounded-512.png` | Vorschau mit Rundung |
| `apple-touch-icon.png` | 180 × 180, Vollfläche (Safari/iOS-Startbildschirm) |
| `favicon.ico`, `favicon-16.png`, `favicon-32.png`, `favicon-48.png` | Browser-Tab |

## Farben

| Element | Wert |
|---|---|
| Hintergrund (Navy) | `#101C32` |
| Zeichen „B“ (Türkis) | `#7ED0CC` |
| Tachonadel (Orange) | `#F09166` |

Kontrast auf Navy: Türkis 9,5 : 1, Orange 7,2 : 1.

## Noch nicht eingebaut

Die Dateien liegen nur hier. `manifest.json`, `images/icon-*.png`, Favicon und die iOS-/Android-Icons werden
erst mit dem Namenswechsel getauscht (#207, Phase 1 Web, Phase 4 iOS, Phase 5 Android), damit das neue Icon
nicht unter dem alten Namen erscheint.
