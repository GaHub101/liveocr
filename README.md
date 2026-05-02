# Live OCR Scanner

Browser-App für Android: liest Herstellerreferenzen per Kamera und schreibt sie via Google Apps Script in ein Google Sheet (AppSheet-Datenquelle).

## Setup

### 1. Apps Script deployen

1. Google Sheet öffnen → **Extensions → Apps Script**
2. Inhalt von `apps-script/Code.gs` einfügen und speichern
3. **Projekteinstellungen → Script Properties** – zwei Einträge anlegen:
   - `GEMINI_API_KEY` = dein Google AI Studio API-Key
   - `WEBHOOK_SECRET` = ein zufälliger langer String (z.B. `openssl rand -hex 32`)
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Deployment-URL kopieren

### 2. Lokal testen

```bash
npm install
cp .env.example .env.local
# .env.local:
#   VITE_APPS_SCRIPT_URL=<deine Deployment-URL>
#   VITE_WEBHOOK_SECRET=<dasselbe Token wie in Apps Script Script Properties>
npm run dev
```

Kamera-Zugriff funktioniert auf `localhost` ohne HTTPS.

### 3. GitHub Pages deployen

1. Repo auf GitHub pushen (Branch `main`)
2. **Settings → Secrets and variables → Actions → New secret** – zwei Secrets anlegen:
   - `APPS_SCRIPT_URL` = Deployment-URL aus Schritt 1
   - `WEBHOOK_SECRET` = dasselbe Token wie in Apps Script Script Properties
3. **Settings → Pages → Source: GitHub Actions**
4. Push auf `main` → GitHub Actions baut und deployed automatisch

### 4. Auf Android installieren

1. `https://USERNAME.github.io/liveocr` in Chrome öffnen
2. Kamerazugriff erlauben
3. Chrome-Menü → **"Zum Startbildschirm hinzufügen"** → wie eine native App

### 5. AppSheet-Action einrichten

Damit der Scanner aus AppSheet heraus einem bestimmten Produkt zugewiesen werden kann:

1. Google Sheet: Spaltenstruktur sicherstellen (A: ID, F: REF-Nummer – siehe `MANUAL.md` für vollständige Struktur)
2. Spalte A mit `=ROW()-1` ab A2 befüllen und runterziehen
3. In AppSheet eine **Action** anlegen:
   - Typ: **Open a URL**
   - Formel:
     ```
     CONCATENATE("https://USERNAME.github.io/liveocr?id=", [ID], "&name=", ENCODEURL([Artikelname]))
     ```
4. Action auf dem gewünschten View hinzufügen

Der Scanner zeigt dann ein blaues Banner „Produkt: [Artikelname]" und schreibt die erkannte REF-Nummer direkt in **Spalte F (REF-Nummer)** der entsprechenden Zeile. Nach dem Scan erscheinen außerdem „Öffnen →"-Links zu allen zugewiesenen Lieferanten des Produkts.

---

## Debug / Fehlerdiagnose

### Browser-Log (Android ohne DevTools)

Alle Ereignisse werden persistent in `localStorage` gespeichert (max. 300 Einträge, älteste werden verdrängt).

**Debug-Overlay öffnen:**
```
https://USERNAME.github.io/liveocr?debug
```

Das Overlay zeigt alle Log-Einträge live (aktualisiert alle 500 ms), farbcodiert nach Schwere:

| Farbe | Level | Bedeutung |
|---|---|---|
| Grau | INFO | Normaler Ablauf (Kamera start, OCR-Ergebnis, Senden OK) |
| Gelb | WARN | Hinweise (niedrige Konfidenz, offline, Queue-Einträge) |
| Rot | ERROR | Fehler (Kamerafehler, OCR-Fehler, HTTP-Fehler, Apps Script Fehler) |

**Buttons im Overlay:**
- **ALL** / **WARN+** / **ERROR** – filtert nach Log-Level (ALL zeigt alles, WARN+ nur Warnungen und Fehler, ERROR nur Fehler)
- **Export JSON** – lädt eine `.json`-Datei mit dem vollständigen Log herunter (per WhatsApp/Mail weiterschicken)
- **Leeren** – löscht den Log-Speicher
- **✕** – schließt das Overlay (Log bleibt erhalten)

**Debug-Overlay kombinierbar mit AppSheet-Modus:**
```
https://USERNAME.github.io/liveocr?id=42&name=Damon%20Brackets&debug
```

**Scan-Zone im Log prüfen:**
Der erste `[INFO] canvas:`-Eintrag zeigt die tatsächlich verarbeitete Bildgröße:
```
[INFO] canvas: Scan-Zone: 808×472px → OCR-Input: 848×512px (Farbe, 20px pad, angezeigt: 1008×756px, Vollbild: 1280×720px)
```
Stimmt Scan-Zone mit Vollbild überein, ist der Crop nicht aktiv (Cache-Problem).

### Apps Script Logs (serverseitig)

Fehler auf der Google-Seite sind in Apps Script sichtbar:

1. Google Sheet öffnen → **Extensions → Apps Script**
2. Linke Leiste → **Execution log** (Uhr-Symbol)
3. Jeder `doPost`-Aufruf schreibt Payload, Ergebnis und Fehler ins Log

### Was wird geloggt

| Quelle | Ereignisse |
|---|---|
| `main` | App-Start, Scan ausgelöst/abgebrochen, OCR-Ergebnis, Send-Payload, Netzwerkwechsel |
| `camera` | Stream-Auflösung, FacingMode, Track-Label; Tap-to-Focus-Trigger |
| `canvas` | Scan-Zone-Größe beim ersten Frame (einmalig) |
| `ocr` | Gemini-Modus aktiv, Verbindungstest (HTTP-Status), Bild-Kodierzeit, Netzwerkzeit, erkannter Text, kein REF, API-Fehler |
| `send` | Online-Status + Payload-Zusammenfassung, HTTP-Antwort-Status, Apps Script Fehlerantworten, Queue enqueue/flush |
| `prices` | checkRef-Status, lookupProduct Vorschlag ja/nein, addProduct Aufruf + Erfolg, Lieferantenanzahl |
| Apps Script | Jeder Request mit Payload, Schreibergebnis (Zeile + ID), alle Fehler |

---

## Architektur

```
Browser (Android Chrome)
  └── index.html
      ├── src/camera.js   – getUserMedia, facingMode: environment
      ├── src/canvas.js   – Crop: Scan-Rahmen (80 % × 60 %, zentriert) + 20 px weißer Rand
      │                     Farbbild direkt an Gemini – kein Graustufen-/Binarisierungs-Schritt
      ├── src/ocr.js      – Gemini 2.5 Flash via Apps Script Webhook; Frame als base64-JPEG
      ├── src/send.js     – fetch() + localStorage Offline-Queue (OCR_Results / writeRef)
      ├── src/prices.js   – checkRef, lookupProduct, addProduct, getProductSuppliers
      ├── src/logger.js   – Ring-Buffer-Log (localStorage, 300 Einträge, ?debug-Overlay)
      ├── src/ui.js       – DOM-Updates (Status, Ergebnis, Banner, Lieferanten-Links, Modal)
      └── src/main.js     – Einstiegspunkt

Apps Script (Google)
  └── apps-script/Code.gs – doPost → ocr / checkRef / lookupProduct / addProduct /
                             getProductSuppliers / writeRef (id) / appendLog (standalone)
```

## CORS-Hinweis

Der Webhook nutzt keinen `Content-Type: application/json` Header → Simple Request, kein CORS-Preflight. Apps Script liest den Body mit `JSON.parse(e.postData.contents)`.
