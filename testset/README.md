# OCR-Testset

Echte Etikettenfotos mit bekannter REF. Damit wird gemessen, ob eine Änderung
an Bildgrösse, Prompt oder Modell die Erkennung wirklich verbessert.

## Fotos sammeln

1. 30–50 Etiketten fotografieren – bewusst auch schwierige: kleine Schrift,
   glänzende Folie, schräg, schlechtes Licht, mehrere Nummern (LOT, GTIN) neben der REF.
2. So zuschneiden, dass das Etikett das Bild füllt (wie im Scan-Rahmen der App).
3. Nach `testset/images/` kopieren (`.jpg`, `.png` oder `.webp`).
4. Pro Foto eine Zeile in `testset/labels.csv`: `Datei;REF`

Keine Fotos mit Patientendaten oder Namen verwenden.

## Auswerten

```bash
APPS_SCRIPT_URL=… WEBHOOK_SECRET=… npm run eval:ocr
```

Ohne Variablen werden `VITE_APPS_SCRIPT_URL` / `VITE_WEBHOOK_SECRET` aus
`.env.local` gelesen. Ausgabe: Treffer pro Foto, Trefferquote, Median- und
P90-Antwortzeit; Details in `testset/last-run.json` (nicht eingecheckt).

Jeder Lauf ruft pro Foto einmal das OCR-Modell auf (Kosten/Quota beachten).
