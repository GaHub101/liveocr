# Produkt hinzufügen – Anleitung für Einsteiger

Diese Anleitung erklärt Schritt für Schritt, wie du mit dem Scanner ein **neues Produkt** in die Bestellliste aufnimmst – und was dabei im Hintergrund passiert.

**Kurz gesagt:** Du scannst die REF-Nummer auf dem Etikett, die App füllt so viel wie möglich automatisch aus, du prüfst kurz und tippst auf „Bestätigen". Fertig – das Produkt steht als neue Zeile im Google Sheet „Bestellungen".

---

## Schritt 1: App öffnen und Modus wählen

1. Öffne die Scanner-App (Homescreen-Icon oder direkt im Browser – **ohne** `?id=` in der Adresse).
2. Es erscheint die Frage **„Was möchten Sie tun?"** mit drei Buttons.
3. Tippe auf den grünen Button **„Produkt hinzufügen"**.
4. Die Kamera startet und du siehst das Live-Bild mit einem **blauen Rahmen** in der Mitte.

> 💡 **Hintergrund – was passiert hier?**
> Beim Start lädt die App einmalig alle Auswahllisten aus dem Google Sheet (Lieferanten, Lagerorte, Bestellstatus-Werte, bekannte Hersteller). Diese Daten werden auf dem Gerät zwischengespeichert, damit die App beim nächsten Mal sofort startklar ist. Der blaue Rahmen zeigt den Bereich, der später wirklich gescannt wird – alles außerhalb wird ignoriert.

---

## Schritt 2: Etikett scannen (oder REF eintippen)

### Variante A: Scannen (der Normalfall)

1. Halte die Kamera so, dass die **REF-Nummer auf dem Etikett komplett im blauen Rahmen** liegt.
   - Abstand ca. 20–30 cm, ruhige Hand, gutes Licht.
   - Bei unscharfem Bild: Zoom-Regler benutzen oder kurz warten, bis die Kamera scharfstellt.
2. Tippe auf **„Scannen"**. Das Bild friert ein – die App hat automatisch den **schärfsten** von mehreren Kamera-Frames ausgewählt.
3. Jetzt kommt der **Prüfschritt**: Schau auf das eingefrorene Bild.
   - Ist die REF-Nummer **scharf und lesbar**? → Tippe auf **„Senden"**.
   - Verwackelt oder unscharf? → Tippe auf **„Neu aufnehmen"** und versuche es noch einmal.
4. Nach „Senden" dauert es 1–3 Sekunden, dann zeigt die App die erkannte REF-Nummer an (z.B. `OW-2241-A`) und öffnet **direkt das Formular „Neues Produkt bestätigen"**.

### Variante B: REF von Hand eintippen

Wenn das Etikett nicht lesbar ist oder du die Nummer schon kennst:

1. Tippe die REF-Nummer in das Feld **„REF prüfen/korrigieren"** ein.
2. Optional: Trage im Feld darunter schon den **Hersteller** ein (z.B. „Ormco").
3. Tippe auf **„Weiter"** – das Formular öffnet sich genauso wie nach einem Scan.

> 💡 **Hintergrund – was passiert beim Scannen?**
> Beim Tippen auf „Senden" schneidet die App nur den Bereich im blauen Rahmen aus dem Foto aus, verkleinert ihn und schickt ihn als JPEG an den Server (Google Apps Script). Dort liest die KI **Gemini** den Text auf dem Bild und schickt die erkannte REF-Nummer zurück. Das Bild wird nur für diese eine Erkennung verwendet und nirgendwo dauerhaft gespeichert. Dafür ist eine **Internetverbindung nötig**.

> ⚠️ Erscheint „Kein REF gefunden – erneut versuchen", hat die KI keine Nummer erkennen können. Dann einfach neu scannen (näher ran, mehr Licht) oder die Nummer von Hand eintippen.

---

## Schritt 3: Das Formular ausfüllen

Es öffnet sich das Fenster **„Neues Produkt bestätigen"**. Der Cursor steht schon im richtigen Feld. Die Felder von oben nach unten:

| Feld | Was du tun musst |
|---|---|
| **REF-Nr. \*** | Ist schon ausgefüllt (die gescannte Nummer). Kurz prüfen, bei Tippfehlern korrigieren. |
| **Suchbegriff \*** | Hersteller eintippen oder aus der Vorschlagsliste wählen (z.B. „Ormco"). Oft ist er **schon vorausgefüllt** – siehe Hintergrund-Kasten unten. |
| **„Vorschlag laden"** (Button) | Antippen! Die App sucht im Internet nach dem Produkt und füllt **Hersteller** und **Artikelname** automatisch aus (dauert ein paar Sekunden). |
| **Hersteller** | Wird vom Vorschlag befüllt – prüfen, ggf. korrigieren. |
| **Artikelname \*** | **Pflichtfeld.** Wird vom Vorschlag befüllt – prüfen. Ohne Artikelname lässt sich das Produkt nicht speichern. |
| **Kategorie** | Optional, von Hand eintragen (z.B. „Brackets"). |
| **Hauptlieferant** | Aus dem Dropdown wählen (Werte kommen aus dem „Lieferanten"-Tab im Sheet). |
| **Lagerort** | Aus dem Dropdown wählen. |
| **Bestellstatus** | Steht automatisch auf **„vorhanden"** – nur ändern, wenn das Produkt z.B. direkt nachbestellt werden soll. |

> 💡 **Hintergrund – warum ist der Hersteller oft schon ausgefüllt?**
> Die App kennt alle REF-Nummern, die schon im Sheet stehen, samt Hersteller. Wenn deine neue REF-Nummer **ähnlich anfängt** wie eine bekannte (mindestens die ersten 3 Zeichen gleich), rät die App: „Das ist wahrscheinlich derselbe Hersteller" und trägt ihn schon mal ein. Du siehst dann den Hinweis *„Hersteller … vorausgewählt – bitte prüfen"*. Das ist nur eine Vermutung – **immer kurz prüfen!** Je mehr Produkte angelegt sind, desto besser funktioniert das Raten.

> 💡 **Hintergrund – was macht „Vorschlag laden"?**
> Die App schickt Hersteller + REF-Nummer an die KI Gemini, die damit eine **echte Google-Suche** macht (Herstellerkataloge, Händler-Shops) und die offizielle Produktbezeichnung ermittelt – inklusive Größe, Variante, Farbe usw. Das Ergebnis wird in die Felder „Hersteller" und „Artikelname" eingetragen. Kommt *„Kein Vorschlag"* zurück, hat die Suche nichts Eindeutiges gefunden – dann trägst du den Artikelnamen einfach selbst ein. Der Vorschlag ist eine Hilfe, keine Garantie: **Immer gegenlesen.**

---

## Schritt 4: Speichern

1. Tippe unten auf **„Bestätigen"**.
2. Der Button zeigt kurz „Speichern…", dann erscheint oben die Meldung **„Produkt angelegt ✓"**.
3. Das Formular schließt sich und du kannst direkt das nächste Etikett scannen.

Mit **„Abbrechen"** verwirfst du das Formular, ohne etwas zu speichern.

> 💡 **Hintergrund – was passiert beim Bestätigen?**
> Die App schickt alle Formularwerte an das Google Apps Script. Das Script:
> 1. **Prüft die REF-Nummer** auf ein gültiges Format (Buchstaben, Ziffern, `-`, `/`, `.`).
> 2. **Prüft auf Duplikate:** Steht die REF schon in Spalte F einer Zeile, wird **nichts** angelegt und du bekommst die Meldung „REF bereits vorhanden". So entstehen keine doppelten Produkte.
> 3. **Hängt eine neue Zeile** ans Sheet „Bestellungen" an und vergibt automatisch die nächste freie **ID** (Spalte A). Deine Eingaben landen in den Spalten B (Artikelname), C (Hersteller), D (Kategorie), E (Hauptlieferant), F (REF-Nummer), H (Lagerort) und I (Bestellstatus).
>
> Kleines Extra: Falls der Herstellername versehentlich auch im Artikelnamen steht, entfernt die App ihn dort automatisch – so bleibt der Artikelname sauber ("Damon Q2 Bracket" statt "Ormco Damon Q2 Bracket").

---

## Der ganze Ablauf auf einen Blick

```
„Produkt hinzufügen" wählen
        │
        ▼
Etikett in den blauen Rahmen → „Scannen"
        │
        ▼
Standbild prüfen: scharf? ──nein──► „Neu aufnehmen"
        │ ja
        ▼
„Senden" → KI liest die REF-Nummer (1–3 Sek.)
        │
        ▼
Formular öffnet sich (REF ausgefüllt, Hersteller oft vorgeraten)
        │
        ▼
„Vorschlag laden" → KI sucht Hersteller + Artikelname im Web
        │
        ▼
Felder prüfen/ergänzen → „Bestätigen"
        │
        ▼
Neue Zeile im Sheet „Bestellungen" ✓  (Status: „Produkt angelegt ✓")
```

---

## Wenn etwas schiefgeht

| Problem | Lösung |
|---|---|
| **„Kein REF gefunden"** | Näher ran, mehr Licht, neu scannen – oder REF von Hand ins Eingabefeld tippen. |
| **„REF bereits vorhanden"** | Das Produkt existiert schon im Sheet. Nichts weiter nötig – ggf. in den Modus „Produkt suchen" wechseln, um den Status zu ändern. |
| **„Kein Vorschlag — bitte manuell ausfüllen"** | Die Web-Suche hat nichts gefunden. Artikelname selbst eintragen. |
| **„Bitte zuerst Hersteller eingeben"** | „Vorschlag laden" braucht einen Suchbegriff – erst Hersteller ins Feld tippen. |
| **Speichern klappt nicht / Fehlermeldung** | Internetverbindung prüfen – „Produkt hinzufügen" funktioniert **nicht offline** (die App braucht die KI und das Google Sheet). |
| **Falscher Modus gewählt** | Oben in der Leiste einfach auf einen anderen Modus tippen – die eingetippte REF bleibt dabei erhalten. |

> Für tiefergehende Fehlersuche: `?debug` an die Web-Adresse anhängen – dann zeigt ein Overlay alle Ereignisse live an. Mehr dazu in [MANUAL.md](MANUAL.md).
