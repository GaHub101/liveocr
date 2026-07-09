# Live OCR Scanner – Bedienungsanleitung

## Was dieses Projekt macht

### Kurz zusammengefasst
Eine Web-App, die auf Android-Geräten läuft, per Kamera Herstellerreferenzen von Etiketten liest und diese in ein Google Sheet schreibt – aus dem AppSheet die Daten bezieht.

---

### Der konkrete Ablauf

**Szenario A: Du hast ein Paket in der Hand und willst die REF-Nummer einem bestehenden Produkt in AppSheet zuweisen.**

1. Du öffnest das Produkt in AppSheet (z.B. „Damon Brackets")
2. Du tippst auf den Button **„REF scannen"** → dein Browser öffnet `https://deinname.github.io/liveocr?id=42&name=Damon%20Brackets`
3. Die App zeigt oben: **„Produkt: Damon Brackets"** und startet die Kamera
4. Du hältst die Kamera auf das Etikett des Pakets – das Etikett in den **blauen Rahmen** positionieren
5. Tippe auf **„Scannen"** – das Kamerabild wird an Gemini 2.5 Flash gesendet, das die REF-Nummer erkennt
6. Du siehst den erkannten Text, z.B. `OW-2241-A`
7. Wenn der Text stimmt, tippe auf **„REF-Nr. hinzufügen"**
8. Die App schickt `{ id: 42, ref: "OW-2241-A" }` per HTTP-POST an ein Google Apps Script
9. Das Apps Script sucht im Sheet „Bestellungen" die Zeile mit ID=42 und schreibt `OW-2241-A` in **Spalte F (REF-Nummer)**
10. AppSheet liest das Sheet und zeigt die REF-Nummer sofort beim Produkt an
11. Nach dem Scan erscheinen außerdem **„Öffnen →"-Links** zu allen Lieferanten, die für dieses Produkt eingetragen sind

**Szenario B: Standalone-Modus – Auswahldialog mit drei Optionen.**

1. Du öffnest die App direkt unter `https://deinname.github.io/liveocr` (ohne `?id=`)
2. Statt der Kamera erscheint zuerst der Auswahldialog **„Was möchten Sie tun?"** mit drei Buttons:

   - **A) Produkt hinzufügen** – Du willst ein neues Produkt anlegen. Klick → Kamera startet, Scan öffnet direkt das „Neues Produkt"-Formular mit Hauptlieferant-Dropdown (Werte aus dem `Lieferanten`-Tab).
   - **B) Produkt suchen** – Du willst den Bestellstatus eines bestehenden Produkts ändern. Klick → Kamera startet, Scan gleicht REF gegen Spalte F (`REF-Nummer`) ab:
     - **Treffer:** Es erscheint ein Auswahlfenster „Bestellstatus setzen" mit Dropdown der erlaubten Werte (aus dem `Bestellstatus`-Tab) – wähle einen Wert und bestätige, der Status wird in Spalte I geschrieben.
     - **Kein Treffer:** Es erscheint der Button „Neues Produkt anlegen" → führt in Option A.
   - **C) Produkt nachbestellen** – Du willst nachbestellen. Klick → Kamera startet, Scan zeigt alle Lieferanten des Produkts (Hauptlieferant gelb hervorgehoben mit Stern) und einen Button „Nachbestellen", der `Nachbestellen` in Spalte I schreibt.

3. Jeder Scan wird unabhängig vom gewählten Modus im Sheet `OCR_Results` protokolliert.

---

### Was die einzelnen Teile tun

| Teil | Was es tut |
|---|---|
| **GitHub Pages** | Hostet die Web-App statisch – kein eigener Server nötig |
| **`src/camera.js`** | Öffnet die Rückkamera des Geräts |
| **`src/canvas.js`** | Schneidet den Scan-Rahmen (80 % × 60 %, zentriert) aus dem Kamerabild aus und sendet das **Farbbild** direkt an Gemini – keine Graustufen- oder Schwellwert-Verarbeitung |
| **`src/ocr.js`** | Sendet das Kamerabild (50 % skaliert, JPEG q0.7) per POST an den Apps Script Webhook; Gemini 2.5 Flash erkennt die REF-Nummer serverseitig |
| **`src/send.js`** | Sendet das Ergebnis per POST an Apps Script; wenn offline → speichert in `localStorage` und sendet automatisch wenn Netzwerk zurückkommt |
| **`src/prices.js`** | `checkRef`, `lookupProduct`, `addProduct`, `getProductSuppliers`, `markReorder`, `listSuppliers`, `listStatusValues`, `setOrderStatus` (alle als POST an Apps Script) |
| **`src/logger.js`** | Ring-Buffer-Log (max. 300 Einträge, `localStorage`). Wird von allen Modulen genutzt. Debug-Overlay via `?debug` in der URL |
| **`src/main.js`** | Liest URL-Parameter (`?id=`, `?name=`, `?debug`); im Standalone zeigt zuerst den Auswahldialog (A/B/C) und verzweigt danach den Scan-Flow |
| **`apps-script/Code.gs`** | Empfängt alle POSTs (Actions: `ocr`, `checkRef`, `lookupProduct`, `addProduct`, `getProductSuppliers`, `markReorder`, `listSuppliers`, `listStatusValues`, `setStatus`, `writeRef`, `appendLog`), führt je nach Action die entsprechende Sheet-Operation durch |
| **PWA** | App ist auf Android installierbar (Homescreen-Icon, läuft wie eine native App) |

---

## Einrichtung (einmalig)

### 1. Google Sheet vorbereiten

Das Sheet „Bestellungen" muss folgende Spaltenstruktur haben:

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ID | Artikelname | Hersteller | Kategorie | Hauptlieferant | REF-Nummer | Artikelcode | Lagerort | Bestellstatus | Notiz | Artikelbild | Bestellmenge | Einheit | Alt. Lieferant 1 | Alt. Lieferant 2 | Alt. Lieferant 3 | Alt. Lieferant 4 |

Befülle **Spalte A** mit fortlaufenden Zahlen: Schreibe in Zelle **A2** die Formel `=ROW()-1` und ziehe sie bis zur letzten Datenzeile runter. Dadurch bekommt jedes Produkt eine stabile, unveränderliche ID.

> **Wichtig:** Die ID darf sich nicht ändern. Verschiebe oder lösche keine Zeilen nachdem IDs vergeben wurden.

---

### 2. „Lieferanten"-Tab anlegen (für Lieferanten-Links)

Damit nach dem Scan „Öffnen →"-Links zu Lieferanten-Webseiten erscheinen, muss im selben Google Sheet ein Tab namens **„Lieferanten"** existieren.

**Struktur:**

| A | B |
|---|---|
| Name | Such-URL |
| Orthowalker | `https://www.orthowalker.de/search?q=` |
| Orthodepot | `https://www.orthodepot.de/suche?term=` |
| … | … |

- **Spalte A (Name):** muss **exakt** mit dem Lieferantennamen in Spalte E oder N–Q von „Bestellungen" übereinstimmen (Groß-/Kleinschreibung beachten)
- **Spalte B (Such-URL):** die Such-URL des Lieferanten; die erkannte REF-Nummer wird URL-kodiert angehängt
- Erste Zeile = Headerzeile (wird übersprungen)

> Falls der Tab noch nicht existiert, legt Apps Script ihn beim ersten `getProductSuppliers`-Aufruf automatisch an – du kannst die URLs dann direkt im Sheet eintragen.

---

### 3. Lieferanten den Produkten zuweisen

Trage in „Bestellungen" für jedes Produkt ein:
- **Spalte E (Hauptlieferant):** Name des primären Lieferanten, z.B. `Orthowalker`
- **Spalten N–Q (Alt. Lieferant 1–4):** weitere Lieferanten, bei denen das Produkt erhältlich ist

Der Name muss exakt mit dem entsprechenden Eintrag im „Lieferanten"-Tab übereinstimmen.

---

### 4. Apps Script deployen

1. Öffne dein Google Sheet
2. Klicke oben auf **Extensions → Apps Script**
3. Lösche den vorhandenen Code und füge den gesamten Inhalt aus `apps-script/Code.gs` ein
4. Klicke auf **Speichern** (Disketten-Symbol)
5. Gehe zu **Projekteinstellungen → Script Properties** und lege zwei Einträge an:
   - `GEMINI_API_KEY` = dein Google AI Studio API-Key
   - `WEBHOOK_SECRET` = ein zufälliger langer String (z.B. via `openssl rand -hex 32`)
6. Klicke auf **Deploy → New deployment**
7. Wähle als Type: **Web app**
8. Stelle ein:
   - Execute as: **Me**
   - Who has access: **Anyone**
9. Klicke **Deploy** und kopiere die angezeigte **Deployment-URL** (sieht aus wie `https://script.google.com/macros/s/ABC.../exec`)

> **Achtung:** Wenn du den Code später änderst, musst du immer eine **neue Deployment-Version** erstellen (Deploy → Manage deployments → New version). Die URL bleibt dabei gleich.

---

### 5. GitHub Repository einrichten

1. Erstelle ein neues Repository auf GitHub (z.B. `liveocr`)
2. Lade alle Dateien aus diesem Projekt hoch oder push den Branch
3. Gehe zu **Settings → Secrets and variables → Actions → New repository secret** und lege zwei Secrets an:
   - `APPS_SCRIPT_URL` = die Deployment-URL aus Schritt 4
   - `WEBHOOK_SECRET` = dasselbe Token wie in Apps Script Script Properties
4. Gehe zu **Settings → Pages → Source** und wähle **GitHub Actions**
5. Pushe auf den Branch `main` – GitHub Actions baut die App automatisch und stellt sie unter `https://USERNAME.github.io/liveocr` bereit

---

### 6. App auf Android installieren

1. Öffne `https://USERNAME.github.io/liveocr` in **Chrome** auf deinem Android-Gerät
2. Erlaube den Kamerazugriff wenn der Browser danach fragt
3. Tippe auf die drei Punkte oben rechts → **„Zum Startbildschirm hinzufügen"**
4. Die App erscheint jetzt als Icon auf deinem Homescreen und öffnet sich ohne Browser-Adressleiste – wie eine native App

---

### 7. AppSheet-Action anlegen

1. Öffne deinen AppSheet-Editor
2. Gehe zu **Actions → New Action**
3. Wähle als Action-Typ: **Open a URL**
4. Trage als URL-Formel ein:
   ```
   CONCATENATE("https://USERNAME.github.io/liveocr?id=", [ID], "&name=", ENCODEURL([Artikelname]))
   ```
   *(USERNAME durch deinen GitHub-Benutzernamen ersetzen)*
5. Weise die Action einer Schaltfläche in der Detailansicht eines Produkts zu

---

## Bedienung

### Normaler Scan-Vorgang (?id=-Modus aus AppSheet)

1. Öffne ein Produkt in AppSheet und tippe auf **„REF scannen"**
2. Der Scanner öffnet sich mit dem blauen Banner oben: **„Produkt: [Artikelname]"** – so siehst du immer, für welches Produkt du gerade scannst
3. Positioniere das Etikett **im blauen Rahmen**. Achte auf:
   - **Gute Beleuchtung** – Lager-Neonlicht ist meistens ausreichend
   - **Ruhige Hand** – halte das Gerät kurz still
   - **Abstand ca. 20–30 cm** vom Etikett
   - Bei unscharfem Bild: **einmal auf das Kamerabild tippen** um den Fokus neu auszulösen
4. Tippe auf **„Scannen"** – das Bild wird an Gemini gesendet (dauert ca. 1–3 Sekunden)
5. Der erkannte REF-Code erscheint in der Ergebnisbox, z.B. `OW-2241-A`
6. Direkt darunter erscheinen **„Öffnen →"-Links** zu den Lieferanten des Produkts (sofern im Sheet eingetragen und im „Lieferanten"-Tab mit URL hinterlegt)
7. Wenn der angezeigte Code korrekt ist, tippe auf **„REF-Nr. hinzufügen"**
8. Der Code wird in **Spalte F (REF-Nummer)** des Produkts im Sheet gespeichert; zusätzlich wird **Spalte I (Bestellstatus)** automatisch auf `Nachbestellen` gesetzt

---

### Standalone-Modus (Auswahldialog mit drei Optionen)

Du kannst den Scanner auch direkt unter `https://USERNAME.github.io/liveocr` öffnen – ohne `?id=` Parameter.

1. Statt der Kamera erscheint zuerst der Auswahldialog **„Was möchten Sie tun?"** mit drei Buttons. Erst nach deiner Auswahl wird die Kamera-Vorschau eingeblendet.
2. Jeder erkannte Scan wird automatisch im Sheet `OCR_Results` protokolliert (Timestamp, REF, Konfidenz) – unabhängig vom gewählten Modus.

#### Option A – Produkt hinzufügen

> 📖 Ausführliche Schritt-für-Schritt-Anleitung mit Hintergrund-Erklärungen: [ANLEITUNG-PRODUKT-HINZUFUEGEN.md](ANLEITUNG-PRODUKT-HINZUFUEGEN.md)

- Tipp auf **„Produkt hinzufügen"** → Kamera erscheint, Scan ausführen
- Direkt nach dem Scan öffnet sich das Formular „Neues Produkt"
- Felder:
  - **Suchbegriff *** (z.B. Hersteller oder Produktbeschreibung) – auf **„Vorschlag laden"** tippen, Gemini füllt Artikelname, Hersteller, Kategorie und Alternativ-Lieferanten vor
  - **Artikelname *** (Pflicht)
  - Kategorie
  - **Hauptlieferant** (Dropdown – Werte aus dem „Lieferanten"-Tab)
  - Alt. Lieferant 1–4 (Freitext, Namen exakt wie im „Lieferanten"-Tab)
  - Artikelcode, Lagerort
- Tipp auf **„Bestätigen"** – eine neue Zeile wird in `Bestellungen` angelegt (Spalte I bekommt automatisch `Nachbestellen`)

#### Option B – Produkt suchen

- Tipp auf **„Produkt suchen"** → Kamera erscheint, Scan ausführen
- Die App gleicht die REF mit Spalte F im Sheet `Bestellungen` ab:
  - **Treffer:** Es erscheint das Modal **„Bestellstatus setzen"** mit einem Dropdown der erlaubten Werte (aus dem `Bestellstatus`-Tab). Wähle einen Wert und tipp **„Speichern"** – der Status wird in Spalte I des gefundenen Produkts geschrieben.
  - **Kein Treffer:** Es erscheint der grüne Button **„Neues Produkt anlegen"** → führt in den gleichen Ablauf wie Option A.

#### Option C – Produkt nachbestellen

- Tipp auf **„Produkt nachbestellen"** → Kamera erscheint, Scan ausführen
- Bei Treffer:
  - Es erscheinen **„Öffnen →"-Links** zu allen Lieferanten des Produkts; der Hauptlieferant ist mit einem Stern (★) und gelber Markierung hervorgehoben.
  - Button **„Nachbestellen"** – schreibt `Nachbestellen` in Spalte I (`Bestellstatus`) der entsprechenden Zeile. Bestätigung erscheint als grüner Status (`Nachbestellen ✓`).
- Bei keinem Treffer: Hinweis und „Neues Produkt anlegen"-Button (wie in Option B).

---

### Offline-Betrieb

Im AppSheet-Modus (`?id=`) funktioniert der **„REF-Nr. hinzufügen"**-Button auch ohne Netzwerk; im Standalone-Modus werden OCR-Logs offline gepuffert:

- Schreiboperationen (REF hinzufügen / OCR-Log) werden bei fehlendem Netz lokal gespeichert; du bekommst die Meldung **„In Warteschlange"**
- Sobald das Gerät wieder online ist, werden alle gepufferten Einträge **automatisch** in der richtigen Reihenfolge gesendet
- Die Anzahl der wartenden Einträge wird unter den Buttons angezeigt

> **Hinweis:** „Nachbestellen" und „Neues Produkt anlegen" erfordern eine aktive Internetverbindung (Sheet-Zugriff bzw. Gemini-Aufruf).

---

## Statusanzeigen

| Farbe des Punkts | Bedeutung |
|---|---|
| Grün | Bereit / Erkennung erfolgreich |
| Gelb (blinkend) | Lädt / sendet gerade |
| Orange | Gerät ist offline – Einträge werden gepuffert |
| Rot | Fehler aufgetreten |

---

## Häufige Probleme

**Diagnose mit dem Debug-Overlay**
- Hänge `?debug` an die URL (z.B. `https://USERNAME.github.io/liveocr?debug`) – ein Overlay zeigt alle App-Ereignisse live in Echtzeit
- Mit den Buttons **ALL / WARN+ / ERROR** kannst du direkt auf Fehler filtern
- **Export JSON** lädt das vollständige Log als Datei – ideal um Fehler weiterzuschicken
- Kombinierbar mit allen anderen Parametern: `?id=42&name=Damon%20Brackets&debug`

---

**Kamera startet nicht**
- Stelle sicher, dass die Seite über HTTPS geöffnet wird (GitHub Pages ist immer HTTPS)
- Prüfe in den Chrome-Einstellungen ob die Kamera-Berechtigung für die Seite erteilt ist: Chrome-Menü → Einstellungen → Website-Einstellungen → Kamera

**OCR erkennt nichts oder falschen Text**
- Etikett genau in den **blauen Rahmen** halten – außerhalb des Rahmens wird nicht gescannt
- Einmal auf das Kamerabild **tippen** um den Fokus auszulösen
- Mehr Licht auf das Etikett – Schattenwurf durch die Hand vermeiden
- Gerät ruhig halten und ca. 20–30 cm Abstand einhalten

**PWA zeigt alte Version**
- Die PWA cached Ressourcen lokal. Bei Problemen nach einem Update:
  1. Chrome-Menü → Einstellungen → Website-Einstellungen → Gespeicherte Daten → Löschen
  2. Oder im **Inkognito-Tab** öffnen – dieser umgeht den PWA-Cache vollständig

**„Fehler" beim Senden**
- Prüfe ob `APPS_SCRIPT_URL` und `WEBHOOK_SECRET` korrekt als GitHub Secrets hinterlegt sind
- Prüfe ob `GEMINI_API_KEY` und `WEBHOOK_SECRET` in den Apps Script Script Properties gesetzt sind
- Stelle sicher, dass das Apps Script als **„Anyone"** zugänglich deployed ist (nicht nur „Anyone with Google Account")

**REF-Nummer erscheint nicht in AppSheet**
- AppSheet synchronisiert sich alle paar Minuten automatisch
- Manuell synchronisieren: in AppSheet oben rechts auf das Sync-Symbol tippen
- Prüfe im Google Sheet direkt ob **Spalte F** der richtigen Zeile beschrieben wurde

**Lieferanten-Links erscheinen nicht**
- Prüfe ob der Tab **„Lieferanten"** im Sheet existiert (Spalten: Name, Such-URL)
- Prüfe ob der Lieferantenname in Spalte E oder N–Q des Produkts **exakt** mit dem Namen im „Lieferanten"-Tab übereinstimmt (Groß-/Kleinschreibung)
- Wenn der Tab noch leer ist: öffne die App mit `?id=`, scanne etwas – Apps Script legt den leeren Tab an, dann URLs eintragen

**„Neues Produkt anlegen" erscheint nicht**
- Der Button erscheint nur, wenn die erkannte REF noch nicht in Spalte F eines Produkts steht
- Bei Fehler „Ungültige REF": das Format muss 1–50 Zeichen, nur Buchstaben/Ziffern/`-`/`/`/`.` enthalten

---

## Webhook manuell testen

Bevor du die App das erste Mal benutzt, kannst du das Apps Script direkt testen:

**Verbindung testen** (ping – prüft ob Webhook erreichbar und Secret korrekt ist):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"action":"ping","secret":"DEIN_WEBHOOK_SECRET"}'
```
→ Antwort sollte `{"status":"ok"}` sein.

**Write-Modus testen** (schreibt REF in die Zeile mit ID=1, Spalte F):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"id":"1","ref":"TEST-001","confidence":95,"secret":"DEIN_WEBHOOK_SECRET"}'
```
→ Öffne danach das Sheet und prüfe ob in der Zeile mit ID=1 in **Spalte F** der Wert `TEST-001` steht.

**Standalone-Modus testen** (schreibt in OCR_Results):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"ref":"TEST-002","confidence":80,"timestamp":"2026-01-01T10:00:00Z","secret":"DEIN_WEBHOOK_SECRET"}'
```
→ Prüfe ob im Sheet „OCR_Results" eine neue Zeile erschienen ist.

**REF-Check testen** (prüft ob TEST-001 im Sheet vorhanden ist):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"action":"checkRef","ref":"TEST-001","secret":"DEIN_WEBHOOK_SECRET"}'
```
→ Antwort sollte `{"status":"ok","id":1,"name":"..."}` sein.

**Lieferanten-Links testen** (liest Lieferanten für Produkt ID=1):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"action":"getProductSuppliers","id":"1","secret":"DEIN_WEBHOOK_SECRET"}'
```
→ Antwort: `{"status":"ok","suppliers":[{"name":"Orthowalker","baseUrl":"https://..."}]}`

**Gemini-Produktvorschlag testen** (fragt Gemini nach Artikeldetails für eine REF):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"action":"lookupProduct","ref":"OW-2241-A","secret":"DEIN_WEBHOOK_SECRET"}'
```
→ Antwort: `{"status":"ok","suggestion":{"artikelname":"...","hersteller":"...","kategorie":"..."}}`

**Neues Produkt anlegen testen** (legt eine neue Zeile in „Bestellungen" an):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"action":"addProduct","ref":"TEST-NEU","name":"Testprodukt","hersteller":"Hersteller GmbH","category":"Kategorie","secret":"DEIN_WEBHOOK_SECRET"}'
```
→ Antwort: `{"status":"ok"}`

---

## Was noch nicht möglich ist

- **Barcode / QR-Code:** Die App erkennt gedruckten Text per OCR – keine Barcodes oder QR-Codes.
