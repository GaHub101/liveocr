# Live OCR Scanner

Browser-PWA für Android: liest Herstellerreferenzen per Kamera (Gemini 2.5 Flash) und schreibt sie via Google Apps Script in ein Google Sheet (AppSheet-Datenquelle).

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
| `src/ocr.js` | Gemini 2.5 Flash via Apps Script Webhook. Frame → JPEG (q0.9) → base64 → POST mit Prompt |
| `src/send.js` | `fetch()` ohne `Content-Type`-Header (→ Simple Request, kein CORS-Preflight). Offline-Queue in `localStorage` (`ocr_send_queue`), auto-flush bei `online`-Event |
| `src/logger.js` | Ring-Buffer-Log, max. 300 Einträge, `localStorage`. Debug-Overlay via `?debug` URL-Param |
| `src/ui.js` | DOM-Updates (Status, Ergebnis, Banner, Queue-Badge) |
| `src/main.js` | Einstiegspunkt. URL-Params: `?id=` (Write-Modus), `?name=` (Banner), `?mode=search` (Stub), `?debug` |
| `apps-script/Code.gs` | Google Apps Script Webhook: `payload.id` → `writeRef()` (Spalte E im Sheet „Bestellungen"); kein `id` → `appendLog()` (Sheet „OCR_Results") |

## Aktuelle OCR-Konfiguration

Gemini 2.5 Flash via Apps Script Webhook (`handleGeminiOcr`):
- Frame → JPEG (Qualität 0.9) → base64 → POST `{ action: 'ocr', image, prompt }`
- `GEMINI_API_KEY` muss in den Apps Script Script Properties gesetzt sein
- Scan-Zone: 80 % Breite × 30 % Höhe, zentriert (entspricht blauem Rahmen-Overlay)
- Keine Zeichen-Whitelist nötig – Gemini erkennt alle Zeichen

## Google Sheet-Struktur („Bestellungen")

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| ID | Artikelname | Kategorie | Lieferant | REF-Nummer ← OCR | Artikelcode | Lagerort | Bestellstatus |

Spalte A (`ID`) mit `=ROW()-1` ab A2 befüllen. IDs dürfen sich nicht ändern.

## Bekannte Issues / Offene Punkte

Siehe `ISSUE.md` für vollständige Liste mit Root Cause und Fix-Commits.

**Offen:** Kamera fokussiert auf Galaxy S24 nativ – kein `applyConstraints`-Aufruf nötig.

## Wichtige Konventionen

- Kein `Content-Type: application/json` beim POST → Simple Request, kein CORS-Preflight
- PWA-Cache: bei Problemen Inkognito-Tab nutzen oder Chrome → Website-Einstellungen → Speicher löschen
- Log-Eintrag `[INFO] canvas: Scan-Zone: Xpx×Ypx` bestätigt dass der Crop aktiv ist
