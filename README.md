# Live OCR Scanner

Browser-App für Android: liest Herstellerreferenzen per Kamera und schreibt sie via Google Apps Script in ein Google Sheet (AppSheet-Datenquelle).

## Setup

### 1. Apps Script deployen

1. Google Sheet öffnen → **Extensions → Apps Script**
2. Inhalt von `apps-script/Code.gs` einfügen und speichern
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Deployment-URL kopieren

### 2. Lokal testen

```bash
npm install
cp .env.example .env.local
# .env.local: VITE_APPS_SCRIPT_URL=<deine Deployment-URL>
npm run dev
```

Kamera-Zugriff funktioniert auf `localhost` ohne HTTPS.

### 3. GitHub Pages deployen

1. Repo auf GitHub pushen (Branch `main`)
2. **Settings → Secrets and variables → Actions → New secret**
   - Name: `APPS_SCRIPT_URL`
   - Value: Deployment-URL aus Schritt 1
3. **Settings → Pages → Source: GitHub Actions**
4. Push auf `main` → GitHub Actions baut und deployed automatisch

### 4. Auf Android installieren

1. `https://USERNAME.github.io/liveocr` in Chrome öffnen
2. Kamerazugriff erlauben
3. Chrome-Menü → **"Zum Startbildschirm hinzufügen"** → wie eine native App

### 5. AppSheet-Action einrichten

Damit der Scanner aus AppSheet heraus einem bestimmten Produkt zugewiesen werden kann:

1. Google Sheet: neue Spalte **A** einfügen, Header `ID`, Werte `1…N` per `=ROW()-1` in A2 und runterziehen
2. In AppSheet eine **Action** anlegen:
   - Typ: **Open a URL**
   - Formel:
     ```
     CONCATENATE("https://USERNAME.github.io/liveocr?id=", [ID], "&name=", ENCODEURL([Artikelname]))
     ```
3. Action auf dem gewünschten View hinzufügen

Der Scanner zeigt dann ein blaues Banner „Produkt: [Artikelname]" und schreibt die erkannte REF-Nummer direkt in die Spalte **E (REF-Nummer)** der entsprechenden Zeile.

---

## Debug / Fehlerdiagnose

### Browser-Log (Android ohne DevTools)

Alle Ereignisse werden persistent in `localStorage` gespeichert (max. 300 Einträge, älteste werden verdrängt).

**Debug-Overlay öffnen:**
```
https://USERNAME.github.io/liveocr?debug
```

Das Overlay zeigt alle Log-Einträge live (aktualisiert alle 2 s), farbcodiert nach Schwere:

| Farbe | Level | Bedeutung |
|---|---|---|
| Grau | INFO | Normaler Ablauf (Kamera start, OCR-Ergebnis, Senden OK) |
| Gelb | WARN | Hinweise (niedrige Konfidenz, offline, Queue-Einträge) |
| Rot | ERROR | Fehler (Kamerafehler, OCR-Fehler, HTTP-Fehler, Apps Script Fehler) |

**Buttons im Overlay:**
- **Export JSON** – lädt eine `.json`-Datei mit dem vollständigen Log herunter (per WhatsApp/Mail weiterschicken)
- **Leeren** – löscht den Log-Speicher
- **✕** – schließt das Overlay (Log bleibt erhalten)

**Debug-Overlay kombinierbar mit AppSheet-Modus:**
```
https://USERNAME.github.io/liveocr?id=42&name=Damon%20Brackets&debug
```

### Apps Script Logs (serverseitig)

Fehler auf der Google-Seite sind in Apps Script sichtbar:

1. Google Sheet öffnen → **Extensions → Apps Script**
2. Linke Leiste → **Execution log** (Uhr-Symbol)
3. Jeder `doPost`-Aufruf schreibt Payload, Ergebnis und Fehler ins Log

### Was wird geloggt

| Quelle | Ereignisse |
|---|---|
| `main` | App-Start, Kamera OK/Fehler, OCR-Engine OK/Fehler, Senden OK/Fehler, Netzwerkwechsel |
| `ocr` | Worker bereit, erkannter Text + Konfidenz, verworfene Low-Confidence-Ergebnisse, Worker-Fehler |
| `send` | POST gesendet, HTTP-Fehler, Apps Script Fehlerantworten, Queue enqueue/flush |
| Apps Script | Jeder Request mit Payload, Schreibergebnis (Zeile + ID), alle Fehler |

---

## Whitelist anpassen

Falls Herstellerreferenzen andere Zeichen enthalten (`.`, `+`, Kleinbuchstaben):

```js
// src/ocr-worker.js
tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/.'
```

## Architektur

```
Browser (Android Chrome)
  └── index.html
      ├── src/camera.js       – getUserMedia, facingMode: environment
      ├── src/canvas.js       – Preprocessing: Graustufen → Kontrast → Otsu-Binarisierung
      ├── src/ocr-worker.js   – Tesseract.js im Web Worker (OEM 1, PSM 11)
      ├── src/ocr.js          – 500ms-Throttle, Konfidenzfilter ≥ 60 %
      ├── src/send.js         – fetch() + localStorage Offline-Queue
      ├── src/logger.js       – Ring-Buffer-Log (localStorage, 300 Einträge, ?debug-Overlay)
      ├── src/ui.js           – DOM-Updates
      └── src/main.js         – Einstiegspunkt

Apps Script (Google)
  └── apps-script/Code.gs     – doPost → appendRow im Sheet OCR_Results
```

## CORS-Hinweis

Der Webhook nutzt keinen `Content-Type: application/json` Header → Simple Request, kein CORS-Preflight. Apps Script liest den Body mit `JSON.parse(e.postData.contents)`.
