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
  → canvas.js  – crop to scan zone (80%×60%, centred), 20 px white padding, colour image
  → ocr.js     – Gemini 2.5 Flash via Apps Script webhook; canvas frame → base64-JPEG → POST

?id= mode (write):
  → main.js    – user clicks "REF-Nr. hinzufügen"
  → send.js    – fetch() POST → Apps Script writeRef(); offline: localStorage queue, flushed on reconnect

Standalone mode (no ?id=):
  → main.js    – after scan: checkRef() → shows "Neues Produkt anlegen" button only if REF not in sheet
  → main.js    – user clicks button → lookupProduct() (Gemini suggestion) → modal form
  → main.js    – user confirms → addProduct() → Apps Script writes new row to Bestellungen
  → send.js    – "REF-Nr. hinzufügen" still available: appends to OCR_Results log
```

### Source modules

| File | Purpose |
|---|---|
| `src/camera.js` | `getUserMedia`, rear camera (`facingMode: environment`) |
| `src/canvas.js` | Crop to scan zone (80%×60%, centred) + 20 px white padding. Sends colour image directly to Gemini – no grayscale or binarisation. |
| `src/ocr.js` | Gemini 2.5 Flash via Apps Script webhook. Canvas frame → downscaled 50 % → JPEG (q0.7) → base64 → POST. Prompt is hardcoded server-side. |
| `src/send.js` | `fetch()` without `Content-Type` header (simple request, no CORS preflight). Offline queue in `localStorage` (`ocr_send_queue`), auto-flush on `online` event |
| `src/prices.js` | `checkRef`, `lookupProduct`, `addProduct`, `getProductSuppliers` – all POST to Apps Script |
| `src/logger.js` | Ring-buffer log, max. 300 entries, `localStorage`. Debug overlay via `?debug` URL param |
| `src/ui.js` | DOM updates: status, result, banner, queue badge, supplier links, lookup modal |
| `src/main.js` | Entry point. URL params: `?id=` (write mode), `?name=` (banner), `?mode=search` (stub), `?debug` |
| `apps-script/Code.gs` | Google Apps Script webhook. Actions: `ocr`, `checkRef`/`search`, `lookupProduct`, `addProduct`, `getProductSuppliers`, `writeRef` (id present), `appendLog` (standalone) |

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
| *(none)* | Standalone: `checkRef` after scan; button shown only for new REFs; `appendLog` sends to `OCR_Results` |
| `?id=N&name=...` | AppSheet mode: writes REF to column F of the row with matching ID in sheet `Bestellungen`; shows supplier links after scan |
| `?debug` | Adds a log overlay (ring-buffer from localStorage, 300 entries). Combinable with other params. |
| `?mode=search` | Stub only – not implemented yet (see TODO in `main.js`) |

### Google Apps Script (`apps-script/Code.gs`)

Sheet `Bestellungen` structure:

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ID | Artikelname | Hersteller | Kategorie | Hauptlieferant | REF-Nummer ← OCR | Artikelcode | Lagerort | Bestellstatus | Notiz | Artikelbild | Bestellmenge | Einheit | Alt. Lieferant 1 | Alt. Lieferant 2 | Alt. Lieferant 3 | Alt. Lieferant 4 |

Sheet `Lieferanten` structure (URL lookup for supplier links):

| A | B |
|---|---|
| Name | Such-URL |

The `Such-URL` is a search base URL; the REF is appended URL-encoded. The `Name` must match exactly the text in columns E or N–Q of `Bestellungen`.

Populate column A of `Bestellungen` with `=ROW()-1` from A2 downwards. IDs must not change. Deploy as Web App (Execute as: Me, Access: Anyone).

### CI/CD

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`. Two secrets are injected at build time: `APPS_SCRIPT_URL` → `VITE_APPS_SCRIPT_URL` and `WEBHOOK_SECRET` → `VITE_WEBHOOK_SECRET`.

### Key design constraints

- **No `Content-Type: application/json` header on POST.** Keeps the request a "simple request", avoiding a CORS preflight that Apps Script cannot answer. Apps Script reads the body via `JSON.parse(e.postData.contents)`.
- **No `applyConstraints` calls.** Explicit focus mode constraints interfere with Samsung's native AF stack. The Galaxy S24 focuses natively without intervention.
- **Shared secret on every request.** `VITE_WEBHOOK_SECRET` is embedded in the built JS and sent as `secret` in every POST body. Apps Script verifies it against `WEBHOOK_SECRET` in Script Properties. Deters automated abuse; not cryptographically strong (secret is visible in built JS).

### Debugging

The first `[INFO] canvas:` log entry confirms the crop is active:
```
[INFO] canvas: Scan-Zone: 808×472px → OCR-Input: 848×512px (Farbe, 20px pad, angezeigt: 1008×756px, Vollbild: 1280×720px)
```
If scan zone equals full frame, the crop is not working (likely a cache issue).

After a deployment users may still see the old version due to Workbox caching – use an incognito tab or Chrome → Site settings → Clear storage. `registerType: 'autoUpdate'` is active so the app self-updates on next launch.

See `ISSUE.md` for known bugs, root causes, and fix commits.
