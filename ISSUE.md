# Known Issues & Changelog

## Offene Issues

---

### PWA cached alte Version
**Status:** bekannt / kein Fix nötig  
**Symptom:** Nach einem Deploy sieht der Nutzer noch die alte Version, obwohl neue Commits gepusht wurden.  
**Ursache:** Vite PWA-Plugin (Workbox) cached JS/CSS lokal auf dem Gerät.  
**Workaround:** Inkognito-Tab verwenden, oder Chrome → Website-Einstellungen → Speicher löschen.  
**Langfristig:** `registerType: 'autoUpdate'` ist aktiv – App aktualisiert sich beim nächsten Start automatisch.

---

## Erledigte Issues

---

### OCR funktionierte gar nicht (Worker-in-Worker)
**Status:** behoben in Commit `85d21a7`  
**Symptom:** Kamera lief, aber kein einziger OCR-Versuch im Log.  
**Ursache:** `ocr-worker.js` versuchte Tesseract.js innerhalb eines Web Workers zu laden. Tesseract spawnt intern selbst einen Worker → verschachtelter Worker schlägt in Produktions-Builds lautlos fehl.  
**Fix:** `ocr-worker.js` gelöscht. `Tesseract.createWorker()` wird jetzt direkt im Main Thread aufgerufen – Tesseract verwaltet sein eigenes Threading intern.

---

### Tesseract lädt WASM/Worker nach Vite-Build nicht
**Status:** behoben in Commit `96b08a8`  
**Symptom:** `Tesseract worker bereit` erschien nicht im Log nach Deployment auf GitHub Pages.  
**Ursache:** Tesseract.js 5.1.1 ist CommonJS-only (`"main": "src/index.js"`). Beim Vite-Bundle gehen die internen relativen Pfade zu `worker.min.js` und den WASM-Dateien verloren.  
**Fix:** Explizite CDN-URLs in `Tesseract.createWorker()`:
```js
workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js'
corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1'
langPath:   'https://tessdata.projectnaptha.com/4.0.0'
```

---

### OCR scannte komplettes Kamerabild statt nur Scan-Rahmen
**Status:** behoben in Commit `942c491`  
**Symptom:** OCR-Text enthielt 30+ Zeilen Rauschen aus dem gesamten Hintergrund. Konfidenz konstant unter 15 %.  
**Ursache:** `canvas.js` zeichnete den kompletten Video-Frame (`1280×720 px`) auf den Canvas und verarbeitete alles.  
**Fix:** Canvas wird auf die Scan-Zone zugeschnitten (`zoneW × zoneH`, 80 % × 30 %, zentriert) – entspricht exakt dem blauen Rahmen-Overlay. Verarbeitete Pixel reduziert von ~921.000 auf ~88.000 (~10×).

---

### CI schlägt fehl – „Dependencies lock file not found"
**Status:** behoben in Commit `875771`  
**Symptom:** GitHub Actions Build bricht ab mit `Dependencies lock file is not found`.  
**Ursache:** `cache: 'npm'` in `actions/setup-node` erfordert `package-lock.json` vor dem Checkout. Außerdem fehlte die Lock-Datei im Repo.  
**Fix:** `cache: 'npm'` entfernt, `npm ci` → `npm install`, `package-lock.json` committet.

---

### `applyConstraints` für Fokus stört Samsungs nativen AF
**Status:** behoben in Commit `7b2dfc9`  
**Symptom:** Kamera fokussierte nicht automatisch auf Galaxy S24.  
**Ursache:** Explizite `applyConstraints({ focusMode: 'continuous' })` Aufrufe nach Stream-Start interferierten mit Samsungs eigenem AF-Stack.  
**Fix:** Alle `applyConstraints`-Aufrufe entfernt. Galaxy S24 fokussiert nativ über Chrome/Android-Kamera-Stack ohne Eingriff.

---

## Technische Entscheidungen

| Entscheidung | Begründung |
|---|---|
| Kein `Content-Type: application/json` Header | Vermeidet CORS-Preflight – Apps Script akzeptiert den Body via `e.postData.contents` |
| Scan-Zone 80 % × 60 % | Breites Querformat deckt typische Label-Breite ab; 60 % Höhe erfasst auch mehrzeilige Labels |
| Gemini statt lokalem OCR | Gemini 2.5 Flash erkennt REF-Codes auch bei schlechter Bildqualität zuverlässiger als lokales Tesseract (kein Konfidenzproblem bei Unschärfe) |
| Bild-Downscale 50 % + JPEG q0.7 | Payload-Reduktion von ~750 KB auf ~150 KB (−75 %); 404×236 px reichen Gemini für REF-Codes; Latenzgewinn ~500–1000 ms |
| Shared Secret im Request | `WEBHOOK_SECRET` in Script Properties schützt den Webhook vor unbefugtem Zugriff ohne echtes Auth-System; Secret ist im kompilierten JS sichtbar (kein kryptografischer Schutz) |
