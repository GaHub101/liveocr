# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # install dependencies
npm run dev      # dev server at localhost (camera works without HTTPS on localhost)
npm run build    # Vite build → dist/
npm run preview  # preview the production build locally
```

There is no test suite.

## Environment setup

Copy `.env.example` to `.env.local` and set both env vars:
- `VITE_APPS_SCRIPT_URL` – deployed Apps Script URL
- `VITE_WEBHOOK_SECRET` – shared secret token (must match `WEBHOOK_SECRET` in Apps Script Script Properties)

For GitHub Pages both are stored as repository secrets (`APPS_SCRIPT_URL`, `WEBHOOK_SECRET`).

## Architecture

Single-page PWA (Vite + vite-plugin-pwa), no framework. `index.html` is the app shell; `src/main.js` is the entry point that wires everything together.

### Data flow

```
Camera (getUserMedia, rear-facing)
  → canvas.js  – crop to scan zone (80%×30%, centred), grayscale → P5/P95 contrast stretch → adaptive Otsu binarisation (32×32 tiles)
  → ocr.js     – Gemini 2.5 Flash via Apps Script webhook; canvas frame → base64-JPEG → POST
  → main.js    – user clicks Send
  → send.js    – fetch() POST → Apps Script webhook; offline: localStorage queue, flushed on reconnect
  → Apps Script (Code.gs) – writeRef (id present) or appendLog (standalone)
```

### Source modules

| File | Purpose |
|---|---|
| `src/camera.js` | `getUserMedia`, rear camera (`facingMode: environment`) |
| `src/canvas.js` | Crop to scan zone (80%×30%, centred) + preprocessing: greyscale → P5/P95 contrast stretch → adaptive Otsu binarisation (32×32 tiles) |
| `src/ocr.js` | Gemini 2.5 Flash via Apps Script webhook. Canvas frame → downscaled 50 % → JPEG (q0.7) → base64 → POST. Prompt is hardcoded server-side. |
| `src/send.js` | `fetch()` without `Content-Type` header (simple request, no CORS preflight). Offline queue in `localStorage` (`ocr_send_queue`), auto-flush on `online` event |
| `src/logger.js` | Ring-buffer log, max. 300 entries, `localStorage`. Debug overlay via `?debug` URL param |
| `src/ui.js` | DOM updates (status, result, banner, queue badge) |
| `src/main.js` | Entry point. URL params: `?id=` (write mode), `?name=` (banner), `?mode=search` (stub), `?debug` |
| `apps-script/Code.gs` | Google Apps Script webhook: `payload.id` → `writeRef()` (column E in "Bestellungen"); no `id` → `appendLog()` ("OCR_Results") |

### OCR configuration

Gemini 2.5 Flash (via Apps Script webhook `handleGeminiOcr`):
- Canvas frame → downscaled 50 % on offscreen canvas → JPEG (quality 0.7) → base64 → POST `{ action: 'ocr', image, secret }`
- Prompt is hardcoded in `Code.gs` (`handleGeminiOcr`), not sent from the client
- `GEMINI_API_KEY` must be set in Apps Script Script Properties
- `WEBHOOK_SECRET` must be set in Apps Script Script Properties (same value as `VITE_WEBHOOK_SECRET`)
- Scan zone: 80 % width × 60 % height, centred (matches the blue frame overlay)
- No character whitelist needed – Gemini reads any characters

### URL modes

| URL params | Behaviour |
|---|---|
| *(none)* | Standalone: recognised REF appended to `OCR_Results` sheet |
| `?id=N&name=...` | AppSheet mode: writes REF to column E of the row with matching ID in sheet `Bestellungen` |
| `?debug` | Adds a log overlay (ring-buffer from localStorage, 300 entries). Combinable with other params. |
| `?mode=search` | Stub only – not implemented yet (see TODO in `main.js` and commented-out `searchByRef` in `Code.gs`) |

### Google Apps Script (`apps-script/Code.gs`)

Sheet `Bestellungen` structure:

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| ID | Artikelname | Kategorie | Lieferant | REF-Nummer ← OCR | Artikelcode | Lagerort | Bestellstatus |

Populate column A with `=ROW()-1` from A2 downwards. IDs must not change. Deploy as Web App (Execute as: Me, Access: Anyone).

### CI/CD

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`. Two secrets are injected at build time: `APPS_SCRIPT_URL` → `VITE_APPS_SCRIPT_URL` and `WEBHOOK_SECRET` → `VITE_WEBHOOK_SECRET`.

### Key design constraints

- **No `Content-Type: application/json` header on POST.** Keeps the request a "simple request", avoiding a CORS preflight that Apps Script cannot answer. Apps Script reads the body via `JSON.parse(e.postData.contents)`.
- **No `applyConstraints` calls.** Explicit focus mode constraints interfere with Samsung's native AF stack. The Galaxy S24 focuses natively without intervention.
- **Shared secret on every request.** `VITE_WEBHOOK_SECRET` is embedded in the built JS and sent as `secret` in every POST body. Apps Script verifies it against `WEBHOOK_SECRET` in Script Properties. Deters automated abuse; not cryptographically strong (secret is visible in built JS).

### Debugging

The first `[INFO] canvas:` log entry confirms the crop is active:
```
[INFO] canvas: Scan-Zone: 1024×216px (Vollbild: 1280×720px)
```
If scan zone equals full frame, the crop is not working (likely a cache issue).

After a deployment users may still see the old version due to Workbox caching – use an incognito tab or Chrome → Site settings → Clear storage. `registerType: 'autoUpdate'` is active so the app self-updates on next launch.

See `ISSUE.md` for known bugs, root causes, and fix commits.
