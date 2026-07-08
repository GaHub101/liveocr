# TODO

## Offen

### Externen Preis-Scraper in Betrieb nehmen
Der Dienst (`scraper/`) und der `getWorkList`-Endpunkt sind fertig; folgende manuelle Schritte fehlen noch zur Inbetriebnahme:

- [ ] `apps-script/Code.gs` + `Preise.gs` ins Apps-Script-Projekt kopieren und das bestehende Deployment re-deployen (gleiche URL).
- [ ] `SCRAPER_PUSH_SECRET` in den Script Properties setzen (separat vom client-sichtbaren `WEBHOOK_SECRET`).
- [ ] Betroffene Shops in `PreisConfig` setzen: `Modus = external`, `Aktiv = ja`, `Such-URL-Template` ausfüllen.
- [ ] `getWorkList` testen: `curl -sX POST "$APPS_SCRIPT_URL" --data '{"action":"getWorkList","secret":"<SCRAPER_PUSH_SECRET>"}'` → erwartet `{"status":"ok","items":[…]}`.
- [ ] Auf Pi/Rechner: `cd scraper && npm install && npx playwright install chromium`; `.env` aus `.env.example` anlegen; `SHOP_CRED_<KEY>` je Shop setzen.
- [ ] `shops.config.js` je external-Shop mit echten Login-Selektoren/-Payload und Preis-Selektor/-Regex füllen.
- [ ] Testlauf: `node src/index.js --dry-run --debug --shop "<Name>"`; Debug-Dumps unter `scraper/debug/` prüfen.
- [ ] Echten Lauf verifizieren (`{status:'ok', written:N}`) und Cron einrichten (`0 5 * * *`, siehe `scraper/README.md`).
- [ ] Frequenz niedrig halten (1×/Tag), eigene B2B-Accounts nutzen (AGB beachten).

---

### Barcode / QR-Code-Unterstützung
Die App erkennt gedruckten Text per OCR (Gemini). Barcodes und QR-Codes werden nicht unterstützt. Eine Erweiterung wäre mit der [BarcodeDetector Web API](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) möglich (Android Chrome unterstützt sie).

---

### Rate Limiting im Apps Script Webhook
Der Webhook ist durch ein Shared Secret geschützt, hat aber kein serverseitiges Rate Limiting. Bei Missbrauch (Secret aus kompiliertem JS extrahiert) könnte die Gemini-Quota erschöpft werden.

**Mögliche Umsetzung:** PropertiesService-basierter Counter pro Minute – bei Überschreitung 429-Antwort zurückgeben.

---

## Erledigt

- [x] Tesseract durch Gemini 2.5 Flash ersetzt
- [x] Gemini-Payload optimiert (50 % Downscale, JPEG q0.7, ~−75 % Größe)
- [x] Prompt serverseitig hardkodiert (nicht mehr vom Client gesendet)
- [x] Shared Secret zum Schutz des Webhooks eingeführt
- [x] CI/CD via GitHub Actions auf GitHub Pages
- [x] Offline-Queue mit Auto-Flush bei Reconnect
- [x] Debug-Overlay (`?debug`) mit Log-Export
- [x] AppSheet-Integration via `?id=` URL-Parameter
- [x] Neue Sheet-Struktur: 17 Spalten A–Q (Hersteller, Hauptlieferant, Alt. Lieferanten 1–4)
- [x] Produktspezifische Lieferanten-Links nach Scan im `?id=`-Modus
- [x] Standalone-Modus: „Neues Produkt anlegen"-Button (nur wenn REF neu), Gemini-vorausgefülltes Formular, Apps Script `addProduct` mit LockService
- [x] Blauer animierter Scan-Strich entfernt (CSS `#scan-line` + `@keyframes scan` + HTML-Element)
- [x] Debug-Logging auf alle Module ausgeweitet (`camera`, `ocr`, `send`, `prices`, `main`); HTTP-Status, Timings, Payload-Details
- [x] Debug-Overlay: Level-Filter (ALL / WARN+ / ERROR), Refresh 2 s → 500 ms
- [x] Mode-Selector (Wishlist Pkt. 1): „Was möchten Sie tun?" mit Optionen A (Hinzufügen), B (Suchen + Bestellstatus-Dropdown), C (Nachbestellen). Hauptlieferant im „Neues Produkt"-Modal als Dropdown. `?id=` löst automatisch Option C aus und setzt zusätzlich Bestellstatus auf „Nachbestellen". Neue Apps-Script-Actions: `listSuppliers`, `listStatusValues`, `setStatus`. Neuer Sheet-Tab `Bestellstatus` (Spalte A = erlaubte Werte).
- [x] Preisvergleich mit Login: nächtlicher Apps-Script-Trigger (`Preise.gs`) scrapt Preise für `Nachbestellen`-Produkte ins `Preise`-Sheet; `getProductSuppliers` um Preise angereichert; Anzeige inkl. günstigstem Preis + „Stand".
- [x] Externer Preis-Scraper (`scraper/`) für `Modus=external`-Shops (Bot-Schutz / JS-Preise): Node-Dienst mit http- und browser-Modus (Playwright), Debug-Modus + Dumps, läuft lokal/Pi per Cron. Neuer geschützter `getWorkList`-Endpunkt liefert die Arbeitsliste.
