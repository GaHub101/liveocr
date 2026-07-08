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

?id= mode (write + reorder):
  → main.js    – user clicks "REF-Nr. hinzufügen"
  → send.js    – fetch() POST → Apps Script writeRef(); offline: localStorage queue, flushed on reconnect
  → main.js    – on success: markReorder() sets column I (Bestellstatus) to "Nachbestellen"

Standalone mode (no ?id=):
  → main.js    – mode-selector ("Was möchten Sie tun?") with three options A / B / C
  → A) Produkt hinzufügen   – scan → lookupProduct() → modal with supplier dropdown → addProduct()
  → B) Produkt suchen       – scan → checkRef() → on hit: status modal (values from Bestellstatus tab) → setStatus()
                                                  on miss: "Neues Produkt anlegen" button (falls back to A)
  → C) Nachbestellen        – scan → checkRef() → supplier links + "Nachbestellen" button → markReorder()
  → send.js    – appendLog: every scan logged to OCR_Results
```

### Source modules

| File | Purpose |
|---|---|
| `src/camera.js` | `getUserMedia`, rear camera (`facingMode: environment`) |
| `src/canvas.js` | Crop to scan zone (80%×60%, centred) + 20 px white padding. Sends colour image directly to Gemini – no grayscale or binarisation. |
| `src/ocr.js` | Gemini 2.5 Flash via Apps Script webhook. Canvas frame → downscaled 50 % → JPEG (q0.7) → base64 → POST. Prompt is hardcoded server-side. |
| `src/send.js` | `fetch()` without `Content-Type` header (simple request, no CORS preflight). Offline queue in `localStorage` (`ocr_send_queue`), auto-flush on `online` event |
| `src/prices.js` | `checkRef`, `lookupProduct`, `addProduct`, `getProductSuppliers`, `markReorder`, `listSuppliers`, `listStatusValues`, `setOrderStatus` – all POST to Apps Script |
| `src/logger.js` | Ring-buffer log, max. 300 entries, `localStorage`. Debug overlay via `?debug` URL param |
| `src/ui.js` | DOM updates: status, result, banner, queue badge, supplier links (incl. cached prices + cheapest highlight + "Stand" footer), lookup modal, mode-selector, status modal, supplier dropdown |
| `src/main.js` | Entry point. URL params: `?id=` (write+reorder), `?name=` (banner), `?debug`. Standalone shows mode-selector first; selected mode (`add`/`search`/`reorder`) branches the post-scan flow. |
| `apps-script/Code.gs` | Google Apps Script webhook. Actions: `ocr`, `checkRef`/`search`, `lookupProduct`, `addProduct`, `getProductSuppliers` (enriched with cached prices), `markReorder`, `listSuppliers`, `listStatusValues`, `setStatus`, `getWorkList` + `pushPrices` (external scraper, `SCRAPER_PUSH_SECRET`), `writeRef` (id present), `appendLog` (standalone) |
| `apps-script/Preise.gs` | Price comparison: nightly trigger (`refreshPrices`) logs into supplier webshops via `UrlFetchApp` (form login + cookie jar), scrapes prices for `Nachbestellen` products, writes them to the `Preise` sheet. Setup helpers: `setupPriceSheets`, `installPriceTrigger`, `testShopScrape`. `handleGetWorkList` serves the external scraper its work list. |
| `scraper/` | Standalone Node.js service for `external` shops (out of the nightly trigger). Pulls `getWorkList`, scrapes prices per shop in `http` (fetch + cheerio/regex) or `browser` (Playwright) mode, pushes back via `pushPrices`. Runs locally / on a Raspberry Pi via cron. See `scraper/README.md`. |

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
| *(none)* | Standalone: shows mode-selector ("Was möchten Sie tun?") with three options — A) Produkt hinzufügen, B) Produkt suchen, C) Nachbestellen. Scan flow branches on the selected mode. `appendLog` sends to `OCR_Results` on every scan. |
| `?id=N&name=...` | AppSheet mode: skips mode-selector and runs Option C (Nachbestellen) automatically. Writes REF to column F of the matching row in `Bestellungen` AND sets column I (Bestellstatus) to "Nachbestellen". Shows supplier links after scan. |
| `?debug` | Adds a log overlay (ring-buffer from localStorage, 300 entries). Combinable with other params. |

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

Sheet `Bestellstatus` structure (values for Option B status dropdown):

| A |
|---|
| Status |

Column A from row 2 lists the allowed values for column I of `Bestellungen`. Header in row 1. The `setStatus` action validates incoming values against this list.

Populate column A of `Bestellungen` with `=ROW()-1` from A2 downwards. IDs must not change. Deploy as Web App (Execute as: Me, Access: Anyone).

### Price comparison (`apps-script/Preise.gs`)

A nightly time-driven trigger logs into each supplier webshop and scrapes the price (visible only after login) into a cache sheet. `getProductSuppliers` is enriched server-side with these cached prices, so both client call sites (Reorder mode, `?id=` mode) show them without an extra roundtrip — `showSupplierLinks` renders price, cheapest highlight (green) and a "Preise Stand: …" footer.

**Only products with `Bestellstatus == "Nachbestellen"` (column I) are scraped** — keeps request volume low (reduces rate-based bot detection) and limits work to relevant items.

Sheet `Preise` (cache, written by the trigger; upsert key = Lieferant+REF):

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| Lieferant | REF | Preis | Währung | Verfügbarkeit | Produkt-URL | Stand (ISO) | Status | Fehler |

`Status`: `ok` \| `not_found` \| `pattern_miss` \| `login_failed` \| `http_error`.

Sheet `PreisConfig` (maintained by owner, one shop per row):

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Lieferant | Modus | Login-Seite-URL | Login-URL | Login-Payload | Token-Regex | Such-URL-Template | Preis-Regex | Login-Check-Regex | Aktiv |

- `Lieferant` must match `Lieferanten` column A exactly. `Modus`: `apps_script` \| `external`.
- `Login-Payload`: form-encoded template, e.g. `email={{user}}&password={{pass}}&_csrf_token={{token}}`. `{{user}}`/`{{pass}}` come from Script Properties, `{{token}}` is captured from the login page via `Token-Regex` (capture group 1).
- `Such-URL-Template`: e.g. `https://shop.de/search?q={{ref}}`. `Preis-Regex`: capture group 1 = price string (parsed via `parseGermanPrice`).
- `Login-Check-Regex` (optional): a pattern only present when logged in (e.g. `Mein Konto`); a miss triggers one re-login + retry.

**Script Properties** (in addition to `WEBHOOK_SECRET`/`GEMINI_API_KEY`):
- `SHOP_CRED_<KEY>` = JSON `{"user":"…","pass":"…"}` per shop. `<KEY>` = supplier name uppercased, umlauts transliterated, non-alphanumerics → `_` (helper `shopCredKey`, e.g. "Henry Schein" → `SHOP_CRED_HENRY_SCHEIN`). Credentials are never sent to the client.
- `SCRAPER_PUSH_SECRET` = separate secret for the external scraper push interface (NOT the client-visible `WEBHOOK_SECRET`).

**Owner setup checklist**:
1. Copy `apps-script/Preise.gs` into the Apps Script project, update `Code.gs`, re-deploy the existing deployment (same URL).
2. Run `setupPriceSheets()` once → creates `Preise` + `PreisConfig`. Fill `PreisConfig` per shop (URLs/regex via the logged-in shop's browser DevTools).
3. Set Script Properties; run `testShopScrape('<Name>', '<known REF>')` per shop and check the execution log (HTTP codes, cookie names, regex match, parsed price).
4. Run `installPriceTrigger()` once and approve permissions.

**External scraper interface** (service lives in `scraper/`): shops with bot protection / JS-rendered prices set `Modus = external` (the nightly trigger skips them). Two scraper-only actions, both authenticated against `SCRAPER_PUSH_SECRET` (never the client-visible `WEBHOOK_SECRET`), POSTed with no `Content-Type` header / JSON body:
> - `getWorkList` `{ action: 'getWorkList', secret, shop? }` → `handleGetWorkList` returns `{ status:'ok', items:[{ shop, ref, searchTemplate, stand }] }` for all active `external` shops with status `Nachbestellen` (optional `shop` filter).
> - `pushPrices` `{ action:'pushPrices', secret, shop, results:[{ ref, status, price, currency, availability, productUrl }] }` → `handlePushPrices` validates the shop is `external`, checks each `ref` against `REF_PATTERN`, and upserts into `Preise`.
>
> The scraper (`scraper/`, standalone Node package) pulls the work list, scrapes each shop in `http` or `browser` (Playwright) mode per `scraper/shops.config.js`, and pushes results back. Credentials live in `scraper/.env` as `SHOP_CRED_<KEY>` (same key derivation as server-side). Runs locally / on a Pi via cron; `--debug` / `--dry-run` / per-REF debug dumps under `scraper/debug/`. See `scraper/README.md`.

> Hinweis: Automated scraping may conflict with a shop's terms of service. Use your own B2B accounts at a low frequency (1×/day).

### CI/CD

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`. Two secrets are injected at build time: `APPS_SCRIPT_URL` → `VITE_APPS_SCRIPT_URL` and `WEBHOOK_SECRET` → `VITE_WEBHOOK_SECRET`.

### Key design constraints

- **No `Content-Type: application/json` header on POST.** Keeps the request a "simple request", avoiding a CORS preflight that Apps Script cannot answer. Apps Script reads the body via `JSON.parse(e.postData.contents)`.
- **No `focusMode` `applyConstraints` calls.** Explicit focus-mode (and `focusDistance`/`pointsOfInterest`) constraints interfere with Samsung's native AF stack. The Galaxy S24 focuses natively without intervention. The **only** allowed `applyConstraints` use is **`zoom`** (`camera.js`): it is not a focus constraint, does not reactivate the S24 AF regression, and lets the user scan from a focusable distance instead of crossing the minimum focus distance. Camera lens selection is done via `enumerateDevices()` + `deviceId` (auto heuristic for an ultrawide/near lens, with a manual switcher and main-camera fallback).
- **Shared secret on every request.** `VITE_WEBHOOK_SECRET` is embedded in the built JS and sent as `secret` in every POST body. Apps Script verifies it against `WEBHOOK_SECRET` in Script Properties. Deters automated abuse; not cryptographically strong (secret is visible in built JS).

### Debugging

Activate with `?debug` in the URL. The overlay auto-refreshes every **500 ms** and shows entries newest-first. Three filter buttons: **ALL** / **WARN+** / **ERROR**.

Log sources:

| Source | What is logged |
|---|---|
| `main` | App start, scan triggered/aborted, OCR result, send payload, network changes |
| `camera` | Stream resolution, facingMode, track label; tap-to-focus trigger |
| `canvas` | Scan-zone dimensions on first frame (once only) |
| `ocr` | Gemini mode, ping HTTP status, image encode time, network time, recognised ref, no-ref, API errors |
| `send` | Online state + payload summary, HTTP response status, Apps Script error responses, queue enqueue/flush |
| `prices` | checkRef status, lookupProduct suggestion yes/no, addProduct call + success, supplier count, markReorder/setStatus result, listSuppliers/listStatusValues counts |

The first `[INFO] canvas:` entry confirms the crop is active:
```
[INFO] canvas: Scan-Zone: 808×472px → OCR-Input: 848×512px (Farbe, 20px pad, angezeigt: 1008×756px, Vollbild: 1280×720px)
```
If scan zone equals full frame, the crop is not working (likely a cache issue).

After a deployment users may still see the old version due to Workbox caching – use an incognito tab or Chrome → Site settings → Clear storage. `registerType: 'autoUpdate'` is active so the app self-updates on next launch.

See `ISSUE.md` for known bugs, root causes, and fix commits.
