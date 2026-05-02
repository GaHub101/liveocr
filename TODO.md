# TODO

## Offen

### Search-Modus implementieren
Der Scanner kann aktuell nur schreiben (REF einem bekannten Produkt zuweisen) oder ein neues Produkt anlegen. Ein Such-Modus, der ein unbekanntes Etikett scannt und das passende **bestehende** Produkt findet, ist technisch vorbereitet aber nicht aktiv.

**Was fehlt:**
- `?mode=search` in `src/main.js` aktivieren (TODO-Kommentar vorhanden)
- `searchByRef()` in `apps-script/Code.gs` ist bereits aktiv; hier UI und Aufruf in `main.js` ergänzen
- UI für Suchergebnis (Produktname + ID anzeigen)

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
