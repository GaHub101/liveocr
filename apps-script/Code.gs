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
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('doPost: leerer Request-Body');
      return jsonResponse({ status: 'error', message: 'Leerer Request-Body' });
    }

    var payload = JSON.parse(e.postData.contents);

    var secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (secret && payload.secret !== secret) {
      Logger.log('doPost: Unauthorized – falsches oder fehlendes Secret');
      return jsonResponse({ status: 'error', message: 'Unauthorized' });
    }

    if (checkRateLimit()) {
      return jsonResponse({ status: 'error', message: 'Rate limit exceeded. Try again in a minute.' });
    }

    Logger.log('doPost: payload action=' + (payload.action || 'none') + ' id=' + (payload.id || ''));

    if (payload.action === 'ocr') {
      return handleGeminiOcr(payload.image);
    }

    if (payload.id) {
      return writeRef(payload);
    }

    return appendLog(payload);

  } catch (err) {
    Logger.log('doPost ERROR: ' + err.message + '\nStack: ' + err.stack);
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', message: 'Live OCR Webhook aktiv' });
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

function checkRateLimit() {
  var props = PropertiesService.getScriptProperties();
  var limit = parseInt(props.getProperty('RATE_LIMIT_PER_MINUTE') || '30');

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(2000);
  } catch (e) {
    // Lock-Timeout bei hoher Last – fail open damit legitime Requests nicht blockiert werden
    Logger.log('checkRateLimit: Lock-Timeout – Request durchgelassen');
    return false;
  }

  try {
    var nowMinute = Math.floor(Date.now() / 60000);
    var storedMinute = parseInt(props.getProperty('rl_minute') || '0');
    var count = (storedMinute === nowMinute) ? parseInt(props.getProperty('rl_count') || '0') : 0;

    if (count >= limit) {
      Logger.log('checkRateLimit: Limit ' + limit + '/min überschritten (aktuell: ' + count + ')');
      return true;
    }

    props.setProperties({ rl_minute: String(nowMinute), rl_count: String(count + 1) });
    return false;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Write-Modus
// ---------------------------------------------------------------------------

function writeRef(payload) {
  if (!payload.ref || String(payload.ref).trim() === '') {
    Logger.log('writeRef: ref fehlt oder leer für id=' + payload.id);
    return jsonResponse({ status: 'error', message: 'ref fehlt oder leer – nichts geschrieben' });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BESTELLUNGEN_SHEET);
  if (!sheet) {
    Logger.log('writeRef: Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden');
    return jsonResponse({ status: 'error', message: 'Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden' });
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][ID_COL_INDEX]) === String(payload.id)) {
      var ref = String(payload.ref).trim();
      sheet.getRange(i + 1, REF_COL).setValue(ref);
      Logger.log('writeRef: OK – id=' + payload.id + ' row=' + (i + 1) + ' ref=' + ref);
      return jsonResponse({ status: 'ok', row: i + 1, id: payload.id });
    }
  }

  Logger.log('writeRef: ID nicht gefunden – id=' + payload.id);
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

  Logger.log('appendLog: ref=' + (payload.ref || '(leer)') + ' confidence=' + payload.confidence);
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
// Gemini OCR
// ---------------------------------------------------------------------------

function handleGeminiOcr(base64Image) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('handleGeminiOcr: GEMINI_API_KEY fehlt in Script Properties');
    return jsonResponse({ status: 'error', message: 'GEMINI_API_KEY nicht konfiguriert' });
  }

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  var prompt = 'Find the REF code on this product label (digits, letters, hyphens or slashes — e.g. "630-0032", "012345A"). It appears next to or below "REF", often in a box. Return ONLY the code. If unclear, best guess. If none visible: NONE';

  var body = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
    ]}],
    generationConfig: { maxOutputTokens: 50, temperature: 0, thinkingConfig: { thinkingBudget: 0 } }
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var responseText = resp.getContentText();
  var result = JSON.parse(responseText);

  // Surface Gemini API errors (rate limit, invalid key, quota, etc.)
  if (result.error) {
    var errMsg = result.error.code + ': ' + result.error.message;
    Logger.log('handleGeminiOcr: Gemini API Fehler – ' + errMsg);
    return jsonResponse({ status: 'error', message: errMsg, raw: '' });
  }

  if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
    Logger.log('handleGeminiOcr: keine Candidates – ' + responseText.substring(0, 300));
    return jsonResponse({ status: 'error', message: 'Keine Antwort von Gemini', raw: responseText.substring(0, 200) });
  }

  // gemini-2.5-flash returns thinking parts (thought:true) — filter them out
  var parts = result.candidates[0].content.parts || [];
  var textParts = parts.filter(function(p) { return !p.thought && p.text; });
  var raw = textParts.length > 0 ? textParts[textParts.length - 1].text.trim() : '';
  var ref = (raw === 'NONE' || raw === '') ? '' : raw;
  Logger.log('handleGeminiOcr: raw="' + raw + '" ref=' + (ref || '(leer)'));
  return jsonResponse({ status: ref ? 'ok' : 'not_found', ref: ref, raw: raw.substring(0, 200) });
}

// ---------------------------------------------------------------------------
// Hilfsfunktion
// ---------------------------------------------------------------------------

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
