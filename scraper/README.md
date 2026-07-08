# Externer Preis-Scraper (`external`-Shops)

Eigenständiger Node.js-Dienst für Shops, die im Sheet `PreisConfig` auf
**`Modus = external`** stehen (Bot-Schutz / JS-gerenderte Preise). Der
nächtliche Apps-Script-Trigger überspringt diese Shops – dieser Dienst
übernimmt sie:

1. holt die Arbeitsliste vom Apps Script (`getWorkList`: alle aktiven
   `external`-Shops mit Status `Nachbestellen`),
2. loggt sich pro Shop ein und scrapt die Preise – **HTTP** (ohne Browser) oder
   **Playwright** (echter Browser), pro Shop wählbar,
3. schiebt die Ergebnisse per `pushPrices` zurück ins `Preise`-Sheet.

Läuft getrennt von der PWA (eigene `package.json`), gedacht für **lokal / Raspberry
Pi per Cron** – eine Wohn-IP ist gegenüber Bot-Schutz unauffälliger als ein
Datacenter-Runner.

## Setup

```bash
cd scraper
npm install
npx playwright install chromium      # nur für mode:browser nötig
cp .env.example .env                 # dann APPS_SCRIPT_URL, SCRAPER_PUSH_SECRET, SHOP_CRED_* setzen
```

**Raspberry Pi / ARM:** Falls `npx playwright install chromium` auf ARM keinen
Build findet, System-Chromium installieren (`sudo apt-get install chromium`) und
in `.env` den Pfad setzen:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` (Playwright respektiert
`executablePath` via diese Env). Für reine `http`-Shops ist kein Browser nötig.

## Konfiguration

- **`.env`** – Secrets (nie committen). `APPS_SCRIPT_URL`, `SCRAPER_PUSH_SECRET`
  (muss dem gleichnamigen Script Property entsprechen) und pro Shop
  `SHOP_CRED_<KEY>` als JSON `{"user":"…","pass":"…"}`.
- **`shops.config.js`** – pro Shop `mode` (`http`/`browser`), Login-URL,
  Login-Selektoren bzw. -Payload und Preis-Selektor/-Regex. Die Such-URL kommt
  aus `PreisConfig` (Worklist), muss hier also nicht dupliziert werden.

Voraussetzung serverseitig: der Shop steht in `PreisConfig` mit `Modus = external`
und `Aktiv = ja`; sein Name stimmt exakt mit dem Objekt-Schlüssel in
`shops.config.js` und dem `SHOP_CRED_<KEY>` überein.

## Bedienung

```bash
# Trockenlauf mit voller Diagnose (kein Push):
node src/index.js --dry-run --debug --shop "Henry Schein"

# Einzelne REF testen, Browser sichtbar:
node src/index.js --dry-run --debug --headful --shop "Henry Schein" --ref "630-0032"

# Echter Lauf (schreibt ins Preise-Sheet):
node src/index.js
```

**Flags:** `--dry-run` (kein Push), `--debug` (Schritt-für-Schritt-Log +
Debug-Dumps), `--headful` (Browser sichtbar), `--shop "Name"`, `--ref "X"`.

### Debug / „was läuft nicht?"

- `--debug` (oder `DEBUG=1` in `.env`) loggt jeden Schritt: Login-Redirects,
  Cookie-**Namen** (nie Werte), aufgelöste Such-URL, HTTP-Codes, Selektor-/
  Regex-Treffer, Roh-Preis → geparster Preis.
- Bei Fehlern (`pattern_miss` / `not_found` / `login_failed` / `http_error`)
  landen **Screenshot + HTML** (browser) bzw. der **HTML-Body** (http) in
  `scraper/debug/` (gitignored). Mit `--debug` bei **jeder** REF.
- Am Ende erscheint ein **Report** mit Zählern je Shop und einer Liste der
  fehlgeschlagenen REFs samt Grund.
- **Exit-Code:** `0` = kein `login_failed`/`http_error`, sonst `≠0` – damit Cron
  Fehler meldet.

## Cron (täglich ~05:00)

```cron
0 5 * * * cd /home/pi/liveocr/scraper && /usr/bin/node src/index.js >> scrape.log 2>&1
```

## Hinweis

Automatisiertes Scraping kann den AGB eines Shops widersprechen. Eigene
B2B-Accounts, niedrige Frequenz (1×/Tag).
