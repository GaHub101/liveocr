/**
 * Google Apps Script – Live OCR Webhook
 *
 * Deploy als Web App:
 *   Extensions → Apps Script → Deploy → New deployment
 *   Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Die Deployment-URL als GitHub Secret APPS_SCRIPT_URL speichern.
 *
 * Sheet-Struktur "Bestellungen":
 *   A: ID          ← numerischer Identifier (neu, manuell angelegt)
 *   B: Artikelname
 *   C: Kategorie
 *   D: Lieferant
 *   E: REF-Nummer  ← wird per OCR befüllt
 *   F: Artikelcode
 *   G: Lagerort
 *   H: Bestellstatus
 */

var BESTELLUNGEN_SHEET = 'Bestellungen';
var LOG_SHEET          = 'OCR_Results';
var REF_COL            = 5; // Spalte E (1-based)
var ID_COL_INDEX       = 0; // Spalte A (0-based für Array-Zugriff)

// ---------------------------------------------------------------------------
// HTTP-Endpunkte
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (payload.id) {
      // Write-Modus: aus AppSheet geöffnet mit ?id= → REF in Bestellungen schreiben
      return writeRef(payload);
    }

    // Standalone-Modus: kein id → OCR-Ergebnis in Log-Sheet schreiben
    return appendLog(payload);

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', message: 'Live OCR Webhook aktiv' });
}

// ---------------------------------------------------------------------------
// Write-Modus
// ---------------------------------------------------------------------------

function writeRef(payload) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BESTELLUNGEN_SHEET);
  if (!sheet) {
    return jsonResponse({ status: 'error', message: 'Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden' });
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][ID_COL_INDEX]) === String(payload.id)) {
      sheet.getRange(i + 1, REF_COL).setValue(payload.ref);
      return jsonResponse({ status: 'ok', row: i + 1, id: payload.id });
    }
  }

  return jsonResponse({ status: 'error', message: 'ID ' + payload.id + ' nicht gefunden' });
}

// ---------------------------------------------------------------------------
// Standalone-Modus (kein id) – Log-Eintrag
// ---------------------------------------------------------------------------

function appendLog(payload) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(['Timestamp', 'REF', 'Konfidenz', 'Client-Timestamp', 'QueuedAt']);
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    new Date().toISOString(),
    payload.ref        || '',
    payload.confidence != null ? payload.confidence : '',
    payload.timestamp  || '',
    payload.queuedAt   || '',
  ]);

  return jsonResponse({ status: 'ok' });
}

// ---------------------------------------------------------------------------
// TODO: Search-Modus – REF in Spalte E suchen, passendes Produkt zurückgeben
// Aktivierung: payload.mode === 'search' in doPost() prüfen + diese Funktion aufrufen
//
// function searchByRef(ref) {
//   var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BESTELLUNGEN_SHEET);
//   if (!sheet) return jsonResponse({ status: 'error', message: 'Sheet nicht gefunden' });
//   var data = sheet.getDataRange().getValues();
//   for (var i = 1; i < data.length; i++) {
//     if (String(data[i][REF_COL - 1]) === String(ref)) { // REF_COL ist 1-based, Array 0-based
//       return jsonResponse({ status: 'ok', id: data[i][0], name: data[i][1] });
//     }
//   }
//   return jsonResponse({ status: 'not_found' });
// }
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hilfsfunktion
// ---------------------------------------------------------------------------

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
