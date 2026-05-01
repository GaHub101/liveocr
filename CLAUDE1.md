# Live OCR Scanner

Browser-PWA für Android: liest Herstellerreferenzen per Kamera (Gemini 2.5 Flash) und schreibt sie via Google Apps Script in ein Google Sheet (AppSheet-Datenquelle).

## Befehle

```bash
npm run dev      # lokaler Dev-Server (Kamera funktioniert auf localhost ohne HTTPS)
npm run build    # Vite-Build → dist/
npm run preview  # dist/ lokal vorschauen
```

Deployment läuft über GitHub Actions (`.github/workflows/deploy.yml`) auf Push zu `main`. GitHub Secrets `APPS_SCRIPT_URL` und `WEBHOOK_SECRET` müssen gesetzt sein.

## Architektur

| Datei | Zweck |
|---|---|
| `src/camera.js` | `getUserMedia`, Rückkamera (`facingMode: environment`) |
| `src/canvas.js` | Frame-Crop auf Scan-Zone (80 %×30 %, zentriert) + Preprocessing: Graustufen → Kontraststretch (P5/P95) → adaptives Otsu-Binarisieren (32×32-Kacheln) |
| `src/ocr.js` | Gemini 2.5 Flash via Apps Script Webhook. Frame → 50 % Downscale → JPEG (q0.7) → base64 → POST. Prompt ist serverseitig hardkodiert. |
| `src/send.js` | `fetch()` ohne `Content-Type`-Header (→ Simple Request, kein CORS-Preflight). Offline-Queue in `localStorage` (`ocr_send_queue`), auto-flush bei `online`-Event |
| `src/logger.js` | Ring-Buffer-Log, max. 300 Einträge, `localStorage`. Debug-Overlay via `?debug` URL-Param |
| `src/ui.js` | DOM-Updates (Status, Ergebnis, Banner, Queue-Badge) |
| `src/main.js` | Einstiegspunkt. URL-Params: `?id=` (Write-Modus), `?name=` (Banner), `?mode=search` (Stub), `?debug` |
| `apps-script/Code.gs` | Google Apps Script Webhook: `payload.id` → `writeRef()` (Spalte E im Sheet „Bestellungen"); kein `id` → `appendLog()` (Sheet „OCR_Results") |

## Aktuelle OCR-Konfiguration

Gemini 2.5 Flash via Apps Script Webhook (`handleGeminiOcr`):
- Frame → 50 % Downscale (Offscreen-Canvas) → JPEG (Qualität 0.7) → base64 → POST `{ action: 'ocr', image, secret }`
- Prompt ist in `Code.gs` hardkodiert, wird nicht vom Client gesendet
- `GEMINI_API_KEY` und `WEBHOOK_SECRET` müssen in den Apps Script Script Properties gesetzt sein
- Scan-Zone: 80 % Breite × 60 % Höhe, zentriert (entspricht blauem Rahmen-Overlay)
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
- Jeder POST enthält `secret: VITE_WEBHOOK_SECRET` – Apps Script prüft gegen Script Property `WEBHOOK_SECRET`
- PWA-Cache: bei Problemen Inkognito-Tab nutzen oder Chrome → Website-Einstellungen → Speicher löschen
- Log-Eintrag `[INFO] canvas: Scan-Zone: Xpx×Ypx` bestätigt dass der Crop aktiv ist
