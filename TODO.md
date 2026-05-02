# TODO

## Offen

### Search-Modus implementieren
Der Scanner kann aktuell nur schreiben (REF einem bekannten Produkt zuweisen). Ein Such-Modus, der ein unbekanntes Etikett scannt und das passende Produkt findet, ist technisch vorbereitet aber nicht aktiv.

**Was fehlt:**
- `?mode=search` in `src/main.js` aktivieren (TODO-Kommentar vorhanden)
- `searchByRef()` in `apps-script/Code.gs` auskommentieren und in `doPost` verkabeln
- UI für Suchergebnis (Produktname + ID anzeigen)

---

### Barcode / QR-Code-Unterstützung
Die App erkennt gedruckten Text per OCR (Gemini). Barcodes und QR-Codes werden nicht unterstützt. Eine Erweiterung wäre mit der [BarcodeDetector Web API](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) möglich (Android Chrome unterstützt sie).

---

## Erledigt

- [x] Tesseract durch Gemini 2.5 Flash ersetzt
- [x] Gemini-Payload optimiert (50 % Downscale, JPEG q0.7, ~−75 % Größe)
- [x] Prompt serverseitig hardkodiert (nicht mehr vom Client gesendet)
- [x] Shared Secret zum Schutz des Webhooks eingeführt
- [x] Rate Limiting im Apps Script Webhook (LockService + PropertiesService, Standard: 30/min)
- [x] CI/CD via GitHub Actions auf GitHub Pages
- [x] Offline-Queue mit Auto-Flush bei Reconnect
- [x] Debug-Overlay (`?debug`) mit Log-Export
- [x] AppSheet-Integration via `?id=` URL-Parameter
