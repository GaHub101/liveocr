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
      ├── src/ui.js           – DOM-Updates
      └── src/main.js         – Einstiegspunkt

Apps Script (Google)
  └── apps-script/Code.gs     – doPost → appendRow im Sheet OCR_Results
```

## CORS-Hinweis

Der Webhook nutzt keinen `Content-Type: application/json` Header → Simple Request, kein CORS-Preflight. Apps Script liest den Body mit `JSON.parse(e.postData.contents)`.
