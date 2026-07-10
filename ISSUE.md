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

### Unscharfe Nahaufnahme auf Samsung S24
**Status:** behoben (Iterationen 1–3)
**Symptom:** Bei Nahaufnahme verschwommenes Bild, am Tablet ok. Auto-Senden ohne Kontrolle.
**Ursache:** Sofort-Abgriff eines Video-Frames während der AF noch „pumpt"; `takePhoto()` allein liefert auf Android-Chromium keinen scharfen AF-Zyklus; Hauptkamera hat eine zu große Naheinstellgrenze; ein wieder eingebauter Tap-to-Focus-`applyConstraints({focusMode})` störte zusätzlich Samsungs nativen AF (Regress von `7b2dfc9`).
**Fix:**
1. `captureSharpest` – schärfster aus mehreren Frames statt Sofort-Abgriff.
2. Prüf-Vorschau vor dem Senden („Senden" / „Neu aufnehmen").
3. Tap-to-Focus-`applyConstraints` erneut entfernt; Auto-Wahl einer Ultraweit-/Nah-Kamera (`enumerateDevices`/`deviceId`) + manueller Umschalter + Hauptkamera-Fallback; **Zoom** als einziger erlaubter `applyConstraints`-Hebel (kein Fokus-Constraint → kein S24-AF-Regress).

**Update (Geschwindigkeit):** Die Aufnahme fühlte sich trotz Sicherheitsnetz träge an. `takePhoto()` wurde als Kandidat entfernt (war laut obiger Ursachenanalyse ohnehin unzuverlässig für Schärfe, aber der mit Abstand langsamste Schritt – volle Foto-Pipeline mit AE/AF-Konvergenz). Die Frame-Stichprobe wurde von 4 Frames/400 ms auf 3 Frames/240 ms verkürzt. Die Anti-Blur-Logik (mehrere Frames vergleichen statt Sofort-Abgriff) und die Prüf-Vorschau vor dem Senden bleiben unverändert als Sicherheitsnetz bestehen.

---

### Gemini-2.5-Modelle von Google abgeschaltet – OCR und Produktvorschlag komplett ausgefallen
**Status:** behoben
**Symptom:** Jeder Scan schlug fehl mit `404: This model models/gemini-2.5-flash-lite is no longer available`. Kurz danach lieferte auch der Produktvorschlag ("Vorschlag laden") leere Ergebnisse trotz eindeutiger REF+Hersteller.
**Ursache:** Google hat `gemini-2.5-flash-lite` (OCR-Modell) ersatzlos abgeschaltet. Der direkt migrierte Ersatz `gemini-3.5-flash` (Produktvorschlag) brachte zwei neue Probleme mit: (1) `temperature: 0` ist bei Gemini-3-Modellen kontraproduktiv – Google empfiehlt den Default 1.0, niedrigere Werte verursachen laut Doku Schleifen/degradiertes Verhalten; (2) Default-Thinking + Websuche konnten das `maxOutputTokens`-Budget aufbrauchen, bevor die JSON-Antwort geschrieben war (`finishReason: MAX_TOKENS`), was still als leerer Vorschlag ankam. Zusätzlich liefern Gemini-3-Modelle in der `generateContent`-Antwort oft kein `groundingMetadata` zurück, obwohl die Websuche nachweislich lief (bekannter, von Google dokumentierter API-Bug) – macht `grounded=false` im Log irreführend. On top kam es zu echten, temporären Überlastungsfehlern ("high demand") auf dem neu gelaunchten `gemini-3.5-flash`.
**Fix:**
1. OCR läuft auf `gemini-3.1-flash-lite` (stabiler Nachfolger für einfache Extraktion).
2. Produktvorschlag nutzt eine Ausweich-Kette statt eines Einzelmodells: `gemini-2.5-flash` (noch aktiv bis Google-Abschaltung am 16.10.2026, liefert zuverlässig `groundingMetadata`) → `gemini-3.1-pro` → `gemini-3.5-flash` → `gemini-3.1-flash-lite` ohne Websuche als letzte Reserve. Bei Überlastung (503/„high demand") wird auf derselben Stufe bis zu zweimal mit Backoff erneut versucht, bei jedem anderen Fehler sofort zur nächsten Stufe gewechselt.
3. `temperature` bei den Gemini-3-Aufrufen entfernt (Default 1.0 gilt), `maxOutputTokens` deutlich angehoben (OCR 100→500, Vorschlag bis 8000 bei den Websuche-Stufen).
4. Diagnose-Logging erweitert: Jeder `lookupProduct`-Aufruf protokolliert im `Nutzungslog` `model=`, `attempts=` und bei durchgefallenen Zwischenstufen `trace=[...]` mit der jeweiligen Fehlermeldung – künftige Modell-Ausfälle sind damit sofort sichtbar statt stumm.

**Wichtig:** Nach jeder `Code.gs`-Änderung ist ein manuelles Neu-Deployment im Apps-Script-Projekt nötig (Bereitstellungen verwalten → bestehende Bereitstellung → neue Version) – das GitHub-Pages-Deployment betrifft nur den Client.

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
**Fix:** Canvas wird auf die Scan-Zone zugeschnitten (`zoneW × zoneH`, 80 % × 60 %, zentriert) – entspricht exakt dem blauen Rahmen-Overlay. Verarbeitete Pixel reduziert von ~921.000 auf ~88.000 (~10×).

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
| Gemini statt lokalem OCR | Gemini erkennt REF-Codes auch bei schlechter Bildqualität zuverlässiger als lokales Tesseract (kein Konfidenzproblem bei Unschärfe). Modell folgt Googles Lebenszyklus (aktuell `gemini-3.1-flash-lite`, siehe CLAUDE.md/„Gemini-2.5-Modelle abgeschaltet"-Eintrag oben) |
| Ausweich-Kette statt Einzelmodell beim Produktvorschlag | Google schaltet Modelle mit Vorlauf ab und neue Modelle haben zeitweise Kapazitätsengpässe – eine mehrstufige Kette (aktuell aktives Modell → neuere Modelle → Fallback ohne Websuche) liefert auch bei Ausfall einer Stufe einen Vorschlag statt eines leeren Formulars |
| Bild-Downscale 50 % + JPEG q0.7 | Payload-Reduktion von ~750 KB auf ~150 KB (−75 %); 404×236 px reichen Gemini für REF-Codes; Latenzgewinn ~500–1000 ms |
| Shared Secret im Request | `WEBHOOK_SECRET` in Script Properties schützt den Webhook vor unbefugtem Zugriff ohne echtes Auth-System; Secret ist im kompilierten JS sichtbar (kein kryptografischer Schutz) |
