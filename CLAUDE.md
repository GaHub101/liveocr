# Live OCR Scanner

Browser-PWA für Android: liest Herstellerreferenzen per Kamera (Tesseract.js) und schreibt sie via Google Apps Script in ein Google Sheet (AppSheet-Datenquelle).

## Befehle

```bash
npm run dev      # lokaler Dev-Server (Kamera funktioniert auf localhost ohne HTTPS)
npm run build    # Vite-Build → dist/
npm run preview  # dist/ lokal vorschauen
```

Deployment läuft über GitHub Actions (`.github/workflows/deploy.yml`) auf Push zu `main` oder `claude/live-ocr-planner-W2hDV`. GitHub Secret `APPS_SCRIPT_URL` muss gesetzt sein.

## Architektur

| Datei | Zweck |
|---|---|
| `src/camera.js` | `getUserMedia`, Rückkamera (`facingMode: environment`) |
| `src/canvas.js` | Frame-Crop auf Scan-Zone (80 %×30 %, zentriert) + Preprocessing: Graustufen → Kontraststretch (P5/P95) → adaptives Otsu-Binarisieren (32×32-Kacheln) |
| `src/ocr.js` | `Tesseract.createWorker()` direkt im Main Thread (Tesseract managed sein eigenes Threading). 500 ms-Throttle, Konfidenzfilter ≥ 60 % |
| `src/send.js` | `fetch()` ohne `Content-Type`-Header (→ Simple Request, kein CORS-Preflight). Offline-Queue in `localStorage` (`ocr_send_queue`), auto-flush bei `online`-Event |
| `src/logger.js` | Ring-Buffer-Log, max. 300 Einträge, `localStorage`. Debug-Overlay via `?debug` URL-Param |
| `src/ui.js` | DOM-Updates (Status, Ergebnis, Banner, Queue-Badge) |
| `src/main.js` | Einstiegspunkt. URL-Params: `?id=` (Write-Modus), `?name=` (Banner), `?mode=search` (Stub), `?debug` |
| `apps-script/Code.gs` | Google Apps Script Webhook: `payload.id` → `writeRef()` (Spalte E im Sheet „Bestellungen"); kein `id` → `appendLog()` (Sheet „OCR_Results") |

## Aktuelle OCR-Konfiguration

```
OEM 1   – LSTM-only (schneller als OEM 3)
PSM 7   – Single uniform text line (besser für kurze REF-Codes als PSM 11)
Whitelist: ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/
Schwellwert: ≥ 60 % Konfidenz
Scan-Zone: 80 % Breite × 30 % Höhe, zentriert (entspricht blauem Rahmen-Overlay)
```

Tesseract-Ressourcen werden von CDN geladen (Vite-Bundle-Kompatibilität):
- `https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js`
- `https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1`
- `https://tessdata.projectnaptha.com/4.0.0`

## Google Sheet-Struktur („Bestellungen")

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| ID | Artikelname | Kategorie | Lieferant | REF-Nummer ← OCR | Artikelcode | Lagerort | Bestellstatus |

Spalte A (`ID`) mit `=ROW()-1` ab A2 befüllen. IDs dürfen sich nicht ändern.

## Bekannte Issues / Offene Punkte

Siehe `ISSUE.md` für vollständige Liste mit Root Cause und Fix-Commits.

**Offen:** OCR-Konfidenz bei unscharfem Kamerabild noch zu niedrig. Kamera fokussiert auf Galaxy S24 nativ – kein `applyConstraints`-Aufruf nötig.

## Wichtige Konventionen

- Kein `Content-Type: application/json` beim POST → Simple Request, kein CORS-Preflight
- `ocr-worker.js` existiert nicht mehr (gelöscht) – Tesseract direkt im Main Thread
- PWA-Cache: bei Problemen Inkognito-Tab nutzen oder Chrome → Website-Einstellungen → Speicher löschen
- Log-Eintrag `[INFO] canvas: Scan-Zone: Xpx×Ypx` bestätigt dass der Crop aktiv ist
