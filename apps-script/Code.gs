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
var USAGE_LOG_SHEET    = 'Nutzungslog';
var REF_COL            = 5;  // Spalte E (1-based)
var ID_COL_INDEX       = 0;  // Spalte A (0-based für Array-Zugriff)

// [FIX] Konservativeres Limit: ~5 MB dekodiert → ~6.7 MB Base64
var MAX_BASE64_LENGTH  = 6.7 * 1024 * 1024;

// Erlaubte MIME-Typen für Gemini Vision
var ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// REF-Format: 1–50 Zeichen, nur Buchstaben/Ziffern/Bindestriche/Schrägstriche/Punkte
var REF_PATTERN = /^[A-Za-z0-9\-\/\.]{1,50}$/;

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
    if (!secret) {
      Logger.log('doPost: WEBHOOK_SECRET nicht konfiguriert – Zugriff verweigert');
      logUsage('auth', 'error', 'WEBHOOK_SECRET fehlt in Script Properties');
      return jsonResponse({ status: 'error', message: 'Server-Konfigurationsfehler: Secret nicht gesetzt' });
    }

    // [FIX] Timing-sicherer Vergleich
    if (!timingSafeEqual(String(payload.secret || ''), secret)) {
      Logger.log('doPost: Unauthorized – falsches Secret');
      logUsage('auth', 'error', 'Falsches Secret');
      return jsonResponse({ status: 'error', message: 'Unauthorized' });
    }

    Logger.log('doPost: payload action=' + (payload.action || 'none') + ' id=' + (payload.id || ''));

    if (payload.action === 'ping') {
      logUsage('ping', 'ok', '');
      return jsonResponse({ status: 'ok' });
    }

    if (payload.action === 'ocr') {
      return handleGeminiOcr(payload.image, payload.mimeType);
    }

    if (payload.action === 'search') {
      return searchByRef(payload.ref);
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

// [FIX] Kein Information-Leak mehr
function doGet() {
  return jsonResponse({ status: 'ok' });
}

// ---------------------------------------------------------------------------
// Timing-sicherer String-Vergleich
// ---------------------------------------------------------------------------

function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    var dummy = b || 'x';
    var result = 1;
    for (var i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ dummy.charCodeAt(i % dummy.length);
    }
    return false;
  }
  var diff = 0;
  for (var j = 0; j < a.length; j++) {
    diff |= a.charCodeAt(j) ^ b.charCodeAt(j);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Nutzungslog
// ---------------------------------------------------------------------------

function logUsage(action, status, details) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(USAGE_LOG_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(USAGE_LOG_SHEET);
      sheet.appendRow(['Timestamp', 'Aktion', 'Status', 'Details']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date().toISOString(), action, status, details || '']);
  } catch (err) {
    Logger.log('logUsage ERROR: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Write-Modus
// ---------------------------------------------------------------------------

function writeRef(payload) {
  // [FIX] REF-Format validieren
  var rawRef = String(payload.ref || '').trim();
  if (rawRef === '') {
    Logger.log('writeRef: ref fehlt oder leer für id=' + payload.id);
    logUsage('writeRef', 'error', 'ref fehlt – id=' + payload.id);
    return jsonResponse({ status: 'error', message: 'ref fehlt oder leer – nichts geschrieben' });
  }
  if (!REF_PATTERN.test(rawRef)) {
    Logger.log('writeRef: ungültiges REF-Format – ref=' + rawRef);
    logUsage('writeRef', 'error', 'Ungültiges REF-Format – ref=' + rawRef.substring(0, 60));
    return jsonResponse({ status: 'error', message: 'Ungültiges REF-Format (erlaubt: A-Z 0-9 - / . , max. 50 Zeichen)' });
  }
  var ref = rawRef;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BESTELLUNGEN_SHEET);
  if (!sheet) {
    Logger.log('writeRef: Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden');
    logUsage('writeRef', 'error', 'Sheet nicht gefunden');
    return jsonResponse({ status: 'error', message: 'Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden' });
  }

  // [FIX] LockService verhindert Race Conditions bei parallelen Requests
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    Logger.log('writeRef: Lock-Timeout – id=' + payload.id);
    logUsage('writeRef', 'error', 'Lock-Timeout – id=' + payload.id);
    return jsonResponse({ status: 'error', message: 'Server überlastet – bitte erneut versuchen' });
  }

  try {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ID_COL_INDEX]) === String(payload.id)) {
        var existingRef = String(data[i][REF_COL - 1]).trim();

        if (existingRef !== '' && existingRef !== ref) {
          Logger.log('writeRef: Konflikt – id=' + payload.id + ' existingRef=' + existingRef + ' newRef=' + ref);
          logUsage('writeRef', 'conflict', 'id=' + payload.id + ' existing=' + existingRef + ' new=' + ref);
          return jsonResponse({
            status: 'conflict',
            message: 'REF bereits befüllt',
            existingRef: existingRef,
            row: i + 1,
            id: payload.id
          });
        }

        if (existingRef === ref) {
          Logger.log('writeRef: idempotent – id=' + payload.id + ' ref=' + ref);
          logUsage('writeRef', 'skipped', 'id=' + payload.id + ' ref=' + ref + ' bereits vorhanden');
          return jsonResponse({ status: 'ok', row: i + 1, id: payload.id, skipped: true });
        }

        sheet.getRange(i + 1, REF_COL).setValue(ref);
        Logger.log('writeRef: OK – id=' + payload.id + ' row=' + (i + 1) + ' ref=' + ref);
        logUsage('writeRef', 'ok', 'id=' + payload.id + ' ref=' + ref);
        return jsonResponse({ status: 'ok', row: i + 1, id: payload.id });
      }
    }

    Logger.log('writeRef: ID nicht gefunden – id=' + payload.id);
    logUsage('writeRef', 'error', 'ID nicht gefunden – id=' + payload.id);
    return jsonResponse({ status: 'error', message: 'ID ' + payload.id + ' nicht gefunden' });

  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Standalone-Modus (kein id) – Log-Eintrag
// ---------------------------------------------------------------------------

function appendLog(payload) {
  // [FIX] REF-Format validieren
  var rawRef = String(payload.ref || '').trim();
  if (rawRef === '') {
    Logger.log('appendLog: ref fehlt – Eintrag abgelehnt');
    logUsage('appendLog', 'error', 'ref fehlt oder leer – kein Eintrag');
    return jsonResponse({ status: 'error', message: 'ref fehlt oder leer – kein Log-Eintrag erstellt' });
  }
  if (!REF_PATTERN.test(rawRef)) {
    Logger.log('appendLog: ungültiges REF-Format – ref=' + rawRef);
    logUsage('appendLog', 'error', 'Ungültiges REF-Format – ref=' + rawRef.substring(0, 60));
    return jsonResponse({ status: 'error', message: 'Ungültiges REF-Format' });
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(['Timestamp', 'REF', 'Konfidenz', 'Client-Timestamp', 'QueuedAt']);
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    new Date().toISOString(),
    rawRef,
    payload.confidence != null ? payload.confidence : '',
    payload.timestamp  || '',
    payload.queuedAt   || '',
  ]);

  Logger.log('appendLog: ref=' + rawRef + ' confidence=' + payload.confidence);
  logUsage('send', 'ok', 'ref=' + rawRef + ' confidence=' + (payload.confidence != null ? payload.confidence : ''));
  return jsonResponse({ status: 'ok' });
}

// ---------------------------------------------------------------------------
// Search-Modus – REF in Spalte E suchen, passendes Produkt zurückgeben
// Aktivierung: payload.action === 'search' + payload.ref setzen
// ---------------------------------------------------------------------------

function searchByRef(ref) {
  if (!ref || !REF_PATTERN.test(String(ref).trim())) {
    return jsonResponse({ status: 'error', message: 'Ungültige oder fehlende REF' });
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BESTELLUNGEN_SHEET);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Sheet nicht gefunden' });

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][REF_COL - 1]).trim() === String(ref).trim()) {
      return jsonResponse({
        status: 'ok',
        id:   data[i][0],
        name: data[i][1]
      });
    }
  }
  return jsonResponse({ status: 'not_found' });
}

// ---------------------------------------------------------------------------
// Gemini OCR
// ---------------------------------------------------------------------------

function handleGeminiOcr(base64Image, mimeType) {
  // [FIX] Image-Validierung
  if (!base64Image || typeof base64Image !== 'string' || base64Image.trim() === '') {
    Logger.log('handleGeminiOcr: kein Bild übermittelt');
    logUsage('ocr', 'error', 'base64Image fehlt oder leer');
    return jsonResponse({ status: 'error', message: 'Kein Bild übermittelt' });
  }
  if (base64Image.length > MAX_BASE64_LENGTH) {
    Logger.log('handleGeminiOcr: Bild zu groß – ' + base64Image.length + ' Zeichen (Max: ' + MAX_BASE64_LENGTH + ')');
    logUsage('ocr', 'error', 'Bild zu groß: ' + base64Image.length + ' Zeichen');
    return jsonResponse({
      status: 'error',
      message: 'Bild zu groß – max. ~5 MB (vor Base64-Encoding). Bitte komprimieren.'
    });
  }

  // [FIX] MIME-Typ clientseitig übergeben und serverseitig validieren
  var resolvedMime = 'image/jpeg';
  if (mimeType && ALLOWED_MIME_TYPES.indexOf(mimeType) !== -1) {
    resolvedMime = mimeType;
  } else if (mimeType) {
    Logger.log('handleGeminiOcr: unbekannter MIME-Typ "' + mimeType + '" – Fallback auf image/jpeg');
  }

  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('handleGeminiOcr: GEMINI_API_KEY fehlt in Script Properties');
    logUsage('ocr', 'error', 'GEMINI_API_KEY nicht konfiguriert');
    return jsonResponse({ status: 'error', message: 'GEMINI_API_KEY nicht konfiguriert' });
  }

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  var prompt = 'Find the REF code on this product label (digits, letters, hyphens or slashes — e.g. "630-0032", "012345A"). It appears next to or below "REF", often in a box. Return ONLY the code. If unclear, best guess. If none visible: NONE';

  var body = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: resolvedMime, data: base64Image } }
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
  var result;
  // [FIX] JSON-Parse abgesichert
  try {
    result = JSON.parse(responseText);
  } catch (parseErr) {
    Logger.log('handleGeminiOcr: JSON-Parse-Fehler – ' + responseText.substring(0, 300));
    logUsage('ocr', 'error', 'Gemini Antwort nicht parsebar');
    return jsonResponse({ status: 'error', message: 'Gemini-Antwort konnte nicht verarbeitet werden' });
  }

  if (result.error) {
    var errMsg = result.error.code + ': ' + result.error.message;
    Logger.log('handleGeminiOcr: Gemini API Fehler – ' + errMsg);
    logUsage('ocr', 'error', errMsg);
    return jsonResponse({ status: 'error', message: errMsg, raw: '' });
  }

  if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
    Logger.log('handleGeminiOcr: keine Candidates – ' + responseText.substring(0, 300));
    logUsage('ocr', 'error', 'Keine Candidates von Gemini');
    return jsonResponse({ status: 'error', message: 'Keine Antwort von Gemini', raw: responseText.substring(0, 200) });
  }

  // gemini-2.5-flash gibt Thinking-Parts zurück (thought:true) – herausfiltern
  var parts = result.candidates[0].content.parts || [];
  var textParts = parts.filter(function(p) { return !p.thought && p.text; });
  var raw = textParts.length > 0 ? textParts[textParts.length - 1].text.trim() : '';
  var ref = (raw === 'NONE' || raw === '') ? '' : raw;

  Logger.log('handleGeminiOcr: raw="' + raw + '" ref=' + (ref || '(leer)'));
  logUsage('ocr', ref ? 'ok' : 'not_found', ref ? 'ref=' + ref : 'kein REF erkannt');
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
