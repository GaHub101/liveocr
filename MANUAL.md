# Live OCR Scanner – Bedienungsanleitung

## Was dieses Projekt macht

### Kurz zusammengefasst
Eine Web-App, die auf Android-Geräten läuft, per Kamera Text von Etiketten liest und diesen Text in ein Google Sheet schreibt – aus dem AppSheet die Daten bezieht.

---

### Der konkrete Ablauf

**Szenario: Du hast ein Paket mit einem Etikett in der Hand und willst die Hersteller-Referenznummer (z.B. `OW-2241-A`) einem Produkt in AppSheet zuweisen.**

1. Du öffnest das Produkt in AppSheet (z.B. „Damon Brackets")
2. Du tippst auf einen Button „REF scannen" → dein Browser öffnet `https://deinname.github.io/liveocr?id=42&name=Damon%20Brackets`
3. Die App zeigt oben: **„Produkt: Damon Brackets"** und startet die Kamera
4. Du hältst die Kamera auf das Etikett des Pakets – das Etikett in den **blauen Rahmen** positionieren
5. Die App verarbeitet nur den Bereich im Rahmen: Graustufen → Kontrastverstärkung → Binarisierung (Schwarz/Weiß) – damit Tesseract.js den Text besser erkennt
6. Tesseract.js läuft im Hintergrund und erkennt laufend Text – gefiltert auf Zeichen die in Refs vorkommen (`A-Z`, `0-9`, `-`, `/`)
7. Du siehst den erkannten Text in Echtzeit, z.B. `OW-2241-A`, mit einem farbigen Konfidenz-Balken
8. Du tippst **„An AppSheet senden"**
9. Die App schickt `{ id: 42, ref: "OW-2241-A" }` per HTTP-POST an ein Google Apps Script
10. Das Apps Script sucht im Sheet „Bestellungen" die Zeile mit ID=42 und schreibt `OW-2241-A` in Spalte E (REF-Nummer)
11. AppSheet liest das Sheet und zeigt die REF-Nummer sofort beim Produkt an

---

### Was die einzelnen Teile tun

| Teil | Was es tut |
|---|---|
| **GitHub Pages** | Hostet die Web-App statisch – kein eigener Server nötig |
| **`src/camera.js`** | Öffnet die Rückkamera des Geräts |
| **`src/canvas.js`** | Schneidet den Scan-Rahmen (80 % × 30 %, zentriert) aus dem Kamerabild aus und verarbeitet nur diesen Bereich: Graustufen, Kontrast, adaptives Schwellwertverfahren (Otsu) pro 32×32-Kachel |
| **`src/ocr.js`** | Verwaltet den Tesseract-Worker (OEM 1, PSM 7), 500 ms-Throttle, Konfidenzfilter ≥ 60 %; lädt Tesseract-Ressourcen von CDN |
| **`src/send.js`** | Sendet das Ergebnis per POST an Apps Script; wenn offline → speichert in `localStorage` und sendet automatisch wenn Netzwerk zurückkommt |
| **`src/main.js`** | Liest URL-Parameter (`?id=`, `?name=`, `?mode=`), steuert den gesamten Ablauf |
| **`apps-script/Code.gs`** | Empfängt den POST, sucht die Zeile per ID, schreibt die REF in Spalte E des Sheets |
| **PWA** | App ist auf Android installierbar (Homescreen-Icon, läuft wie eine native App) |

---

## Einrichtung (einmalig)

### 1. Google Sheet vorbereiten

Öffne dein Bestellungen-Sheet und füge ganz links eine neue Spalte **A** mit dem Header `ID` ein. Die bestehenden Spalten rücken automatisch eine Stelle nach rechts:

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| ID | Artikelname | Kategorie | Lieferant | REF-Nummer | Artikelcode | Lagerort | Bestellstatus |

Befülle Spalte A mit fortlaufenden Zahlen. Schreibe in Zelle **A2** die Formel `=ROW()-1` und ziehe sie bis zur letzten Zeile runter. Dadurch bekommt jedes Produkt eine stabile, unveränderliche ID.

> **Wichtig:** Die ID darf sich nicht ändern. Verschiebe oder lösche keine Zeilen nachdem IDs vergeben wurden. Neue Produkte bekommen einfach die nächste freie Nummer am Ende der Liste.

---

### 2. Apps Script deployen

1. Öffne dein Google Sheet
2. Klicke oben auf **Extensions → Apps Script**
3. Lösche den vorhandenen Code und füge den gesamten Inhalt aus `apps-script/Code.gs` ein
4. Klicke auf **Speichern** (Disketten-Symbol)
5. Klicke auf **Deploy → New deployment**
6. Wähle als Type: **Web app**
7. Stelle ein:
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Klicke **Deploy** und kopiere die angezeigte **Deployment-URL** (sieht aus wie `https://script.google.com/macros/s/ABC.../exec`)

> **Achtung:** Wenn du den Code später änderst, musst du immer eine **neue Deployment-Version** erstellen (Deploy → Manage deployments → New version). Die URL bleibt dabei gleich.

---

### 3. GitHub Repository einrichten

1. Erstelle ein neues Repository auf GitHub (z.B. `liveocr`)
2. Lade alle Dateien aus diesem Projekt hoch oder push den Branch
3. Gehe zu **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `APPS_SCRIPT_URL`
   - Value: die Deployment-URL aus Schritt 2
4. Gehe zu **Settings → Pages → Source** und wähle **GitHub Actions**
5. Pushe auf den Branch `main` – GitHub Actions baut die App automatisch und stellt sie unter `https://USERNAME.github.io/liveocr` bereit

---

### 4. App auf Android installieren

1. Öffne `https://USERNAME.github.io/liveocr` in **Chrome** auf deinem Android-Gerät
2. Erlaube den Kamerazugriff wenn der Browser danach fragt
3. Tippe auf die drei Punkte oben rechts → **„Zum Startbildschirm hinzufügen"**
4. Die App erscheint jetzt als Icon auf deinem Homescreen und öffnet sich ohne Browser-Adressleiste – wie eine native App

---

### 5. AppSheet Action anlegen

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

### Normaler Scan-Vorgang

1. Öffne ein Produkt in AppSheet und tippe auf **„REF scannen"**
2. Der Scanner öffnet sich mit dem blauen Banner oben: **„Produkt: [Artikelname]"** – so siehst du immer, für welches Produkt du gerade scannst
3. Positioniere das Etikett **im blauen Rahmen**. Achte auf:
   - **Gute Beleuchtung** – Lager-Neonlicht ist meistens ausreichend
   - **Ruhige Hand** – halte das Gerät kurz still
   - **Abstand ca. 20–30 cm** vom Etikett
   - Bei unscharfem Bild: **einmal auf das Kamerabild tippen** um den Fokus neu auszulösen
4. Sobald der Scanner einen Text mit ausreichender Sicherheit erkennt, erscheint er in der Ergebnisbox
5. Der **Konfidenz-Balken** zeigt wie sicher die Erkennung ist:
   - Grün (≥80%): zuverlässig
   - Gelb (60–79%): akzeptabel, aber prüfen
   - Rot (<60%): wird nicht angezeigt, Scanner versucht es erneut
6. Wenn der angezeigte Text korrekt ist, tippe auf **„An AppSheet senden"**
7. Der Text wird in Spalte E (REF-Nummer) des Produkts im Sheet gespeichert

### Standalone-Modus (ohne AppSheet)

Du kannst den Scanner auch direkt unter `https://USERNAME.github.io/liveocr` öffnen – ohne `?id=` Parameter. In diesem Fall wird kein Produkt-Banner angezeigt und der erkannte Text wird als neuer Eintrag im Sheet **OCR_Results** gespeichert (Zeitstempel, REF, Konfidenz).

---

## Statusanzeigen

| Farbe des Punkts | Bedeutung |
|---|---|
| Grün | Bereit / Erkennung erfolgreich |
| Gelb (blinkend) | Lädt / sendet gerade |
| Orange | Gerät ist offline – Einträge werden gepuffert |
| Rot | Fehler aufgetreten |

---

## Offline-Betrieb

Der Scanner funktioniert auch ohne Netzwerkverbindung (z.B. in einem Lager mit schlechtem WLAN):

- Tippst du auf **„An AppSheet senden"** während du offline bist, wird der Eintrag lokal auf dem Gerät gespeichert und du bekommst die Meldung **„In Warteschlange"**
- Sobald das Gerät wieder online ist, werden alle gepufferten Einträge **automatisch** in der richtigen Reihenfolge gesendet
- Die Anzahl der wartenden Einträge wird unter dem Sende-Button angezeigt

---

## Zeichensatz anpassen

Der Scanner ist standardmäßig auf folgende Zeichen eingestellt:

```
A–Z  0–9  -  /
```

Falls deine Hersteller-Referenzen andere Zeichen enthalten (z.B. Punkte oder Kleinbuchstaben), passe die Whitelist in `src/ocr.js` an:

```js
// in tesseractWorker.setParameters(...)
tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/.'
```

Nach der Änderung: `npm run build` ausführen und auf GitHub pushen.

---

## Häufige Probleme

**Kamera startet nicht**
- Stelle sicher, dass die Seite über HTTPS geöffnet wird (GitHub Pages ist immer HTTPS)
- Prüfe in den Chrome-Einstellungen ob die Kamera-Berechtigung für die Seite erteilt ist: Chrome-Menü → Einstellungen → Website-Einstellungen → Kamera

**OCR erkennt nichts oder falschen Text**
- Etikett genau in den **blauen Rahmen** halten – außerhalb des Rahmens wird nicht gescannt
- Einmal auf das Kamerabild **tippen** um den Fokus auszulösen
- Mehr Licht auf das Etikett – Schattenwurf durch die Hand vermeiden
- Gerät ruhig halten und ca. 20–30 cm Abstand einhalten
- Falls das Bild trotzdem unscharf bleibt: alte Version aus dem PWA-Cache löschen (Chrome → Einstellungen → Website-Einstellungen → Speicher löschen) und Seite neu laden

**PWA zeigt alte Version**
- Die PWA cached Ressourcen lokal. Bei Problemen nach einem Update:
  1. Chrome-Menü → Einstellungen → Website-Einstellungen → Gespeicherte Daten → Löschen
  2. Oder im **Inkognito-Tab** öffnen – dieser umgeht den PWA-Cache vollständig

**„Fehler" beim Senden**
- Prüfe ob die Apps Script URL korrekt als GitHub Secret hinterlegt ist
- Teste den Webhook manuell (siehe unten)
- Stelle sicher, dass das Apps Script als **„Anyone"** zugänglich deployed ist

**REF-Nummer erscheint nicht in AppSheet**
- AppSheet synchronisiert sich alle paar Minuten automatisch
- Manuell synchronisieren: in AppSheet oben rechts auf das Sync-Symbol tippen
- Prüfe im Google Sheet direkt ob Spalte E der richtigen Zeile beschrieben wurde

---

## Webhook manuell testen

Bevor du die App das erste Mal benutzt, kannst du das Apps Script direkt testen:

**Write-Modus testen** (schreibt REF in Zeile mit ID=1):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"id":"1","ref":"TEST-001","confidence":95}'
```
→ Öffne danach das Sheet und prüfe ob in der Zeile mit ID=1 in Spalte E der Wert `TEST-001` steht.

**Standalone-Modus testen** (schreibt in OCR_Results):
```bash
curl -L -X POST "DEINE_APPS_SCRIPT_URL" \
  -d '{"ref":"TEST-002","confidence":80,"timestamp":"2026-01-01T10:00:00Z"}'
```
→ Prüfe ob im Sheet „OCR_Results" eine neue Zeile erschienen ist.

---

## Was noch nicht möglich ist

- **Suchen:** Man kann noch kein unbekanntes Etikett scannen und herausfinden, welchem Produkt es gehört. Diese Funktion ist technisch vorbereitet (Search-Modus) und kann in einem nächsten Schritt aktiviert werden.
- **Authentifizierung:** Wer die URL kennt, kann Daten ins Sheet schreiben. Für internen Gebrauch im eigenen Netzwerk ist das in der Regel unkritisch.
- **Barcode / QR-Code:** Die App erkennt gedruckten Text per OCR – keine Barcodes oder QR-Codes.
