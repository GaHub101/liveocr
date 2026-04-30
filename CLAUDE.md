# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run dev          # dev server at localhost (camera works without HTTPS on localhost)
npm run build        # build to dist/
npm run preview      # preview the production build locally
```

There is no test suite.

## Environment setup

Copy `.env.example` to `.env.local` and set `VITE_APPS_SCRIPT_URL` to your deployed Apps Script URL. Without this the app will show an error when trying to send. For GitHub Pages the URL is stored as a repository secret `APPS_SCRIPT_URL`.

## Architecture

This is a single-page PWA (Vite + vite-plugin-pwa) with no framework. All source lives in `src/`, one module per concern. `index.html` is the app shell; `src/main.js` is the entry point that wires everything together.

### Data flow

```
Camera (getUserMedia, rear-facing)
  → canvas.js  – crop to scan zone (80%×30%, centred), grayscale → contrast → Otsu binarisation
  → ocr.js     – Tesseract.createWorker (OEM 1, PSM 7), 500 ms throttle, ≥60 % confidence filter
  → main.js    – user clicks Send
  → send.js    – fetch() POST → Apps Script webhook; offline: localStorage queue, flushed on reconnect
  → Apps Script (Code.gs) – writeRef (id present) or appendLog (standalone)
```

### URL modes

| URL params | Behaviour |
|---|---|
| *(none)* | Standalone: recognised REF appended to `OCR_Results` sheet |
| `?id=N&name=...` | AppSheet mode: writes REF to column E of the row with matching ID in sheet `Bestellungen` |
| `?debug` | Adds a log overlay (ring-buffer from localStorage, 300 entries). Combinable with other params. |
| `?mode=search` | Stub only – not implemented yet (see TODO in `main.js` and commented-out `searchByRef` in `Code.gs`) |

### Key design constraints

- **Tesseract runs in the main thread.** `Tesseract.createWorker()` is called directly – never wrap it in a custom Web Worker. Tesseract manages its own internal threading; a wrapper Worker-in-Worker fails silently in production builds.
- **Tesseract loaded via CDN.** Tesseract.js 5.1.1 is CommonJS-only; Vite breaks its internal relative paths to WASM and worker scripts. Explicit CDN URLs in `ocr.js` (`cdn.jsdelivr.net`, `tessdata.projectnaptha.com`) are the fix – don't switch to local bundling without solving this.
- **No `Content-Type: application/json` header on POST.** This keeps the request a "simple request", avoiding a CORS preflight that Apps Script cannot answer. Apps Script reads the body via `JSON.parse(e.postData.contents)`.

### Google Apps Script (`apps-script/Code.gs`)

Sheet `Bestellungen` structure: `A=ID, B=Artikelname, C=Kategorie, D=Lieferant, E=REF-Nummer (OCR target), F=Artikelcode, G=Lagerort, H=Bestellstatus`. The script must be deployed as a Web App (Execute as: Me, Access: Anyone).

### CI/CD

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`. The secret `APPS_SCRIPT_URL` is injected as the Vite env variable `VITE_APPS_SCRIPT_URL` at build time.

### Whitelist

The OCR character whitelist (`src/ocr.js` → `tessedit_char_whitelist`) is currently uppercase letters, digits, `-` and `/`. Extend it if reference codes contain other characters (e.g. lowercase, `.`, `+`).
