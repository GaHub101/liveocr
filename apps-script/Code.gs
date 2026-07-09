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
 *   A: ID | B: Artikelname | C: Hersteller | D: Kategorie | E: Hauptlieferant
 *   F: REF-Nummer ← OCR | G: Artikelcode | H: Lagerort | I: Bestellstatus
 *   J: Notiz | K: Artikelbild | L: Bestellmenge | M: Einheit
 *   N: Alt. Lieferant 1 | O: Alt. Lieferant 2 | P: Alt. Lieferant 3 | Q: Alt. Lieferant 4
 *
 * Sheet-Struktur "Bestellstatus" (Spalte A ab Zeile 2 = mögliche Werte für
 *   Spalte I in "Bestellungen"; Header in Zeile 1).
 */

var BESTELLUNGEN_SHEET       = 'Bestellungen';
var LOG_SHEET                = 'OCR_Results';
var USAGE_LOG_SHEET          = 'Nutzungslog';
var SUPPLIERS_SHEET          = 'Lieferanten';
var STATUS_SHEET             = 'Bestellstatus';
var LAGERORT_SHEET           = 'Lagerort';
var REF_COL                  = 6;   // Spalte F (1-based)
var STATUS_COL               = 9;   // Spalte I, Bestellstatus (1-based)
var ID_COL_INDEX             = 0;   // Spalte A (0-based)
var HAUPTLIEFERANT_COL_IDX   = 4;   // Spalte E (0-based)
var ALT_LIEFERANT_COL_IDXS   = [13, 14, 15, 16];  // Spalten N–Q (0-based)

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

    if (payload.action === 'search' || payload.action === 'checkRef') {
      return searchByRef(payload.ref);
    }

    if (payload.action === 'lookupProduct') {
      return handleLookupProduct(payload);
    }

    if (payload.action === 'bootstrap') {
      return handleBootstrap();
    }

    if (payload.action === 'addProduct') {
      return handleAddProduct(payload);
    }

    if (payload.action === 'getProductSuppliers') {
      return handleGetProductSuppliers(payload);
    }

    if (payload.action === 'markReorder') {
      return handleMarkReorder(payload);
    }

    if (payload.action === 'listSuppliers') {
      return handleListSuppliers();
    }

    if (payload.action === 'listStatusValues') {
      return handleListStatusValues();
    }

    if (payload.action === 'listLocations') {
      return handleListLocations();
    }

    if (payload.action === 'setStatus') {
      return handleSetStatus(payload);
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

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey;
  var prompt = 'Read this product label and return ONLY a JSON object with one key:'
    + ' "ref" = the catalog/reference number: the code printed next to, below or inside the box'
    + ' marked "REF" (also written "Ref"/"ref" or as the REF symbol; digits, letters, hyphens'
    + ' or slashes — e.g. "630-0032", "012345A").'
    + ' Labels often contain many other numbers — do NOT return the LOT/batch number,'
    + ' GTIN/UDI or barcode digits, expiry or manufacturing dates, or quantities.'
    + ' If there is no REF marking but the label shows exactly one obvious catalog number, return that.'
    + ' If the REF is ambiguous or not clearly readable, return an empty string "" instead of guessing.'
    + ' Return ONLY the JSON object, no markdown code fences, no commentary.';

  var body = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: resolvedMime, data: base64Image } }
    ]}],
    generationConfig: { maxOutputTokens: 100, temperature: 0, thinkingConfig: { thinkingBudget: 0 } }
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

  // Gemini kann Thinking-Parts zurückgeben (thought:true) – herausfiltern
  var parts = result.candidates[0].content.parts || [];
  var textParts = parts.filter(function(p) { return !p.thought && p.text; });
  var raw = textParts.length > 0 ? textParts[textParts.length - 1].text.trim() : '';

  // JSON aus raw extrahieren (robust gegen Markdown-Fences)
  var ref = '';
  var jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      var parsed = JSON.parse(jsonMatch[0]);
      ref = String(parsed.ref || '').trim();
    } catch (parseErr) {
      Logger.log('handleGeminiOcr: JSON-Parse fehlgeschlagen, raw="' + raw + '"');
    }
  }
  // Fallback: rohe Antwort als REF interpretieren (alte Antwortform / falls Modell JSON-Format ignoriert)
  if (!ref && raw && raw !== 'NONE' && REF_PATTERN.test(raw)) {
    ref = raw;
  }

  Logger.log('handleGeminiOcr: raw="' + raw + '" ref=' + (ref || '(leer)'));
  logUsage('ocr', ref ? 'ok' : 'not_found', 'ref=' + (ref || '-'));
  return jsonResponse({
    status: ref ? 'ok' : 'not_found',
    ref: ref,
    raw: raw.substring(0, 200)
  });
}

// ---------------------------------------------------------------------------
// Gemini-Produktvorschlag (Standalone-Modus: neues Produkt anlegen)
// ---------------------------------------------------------------------------

function handleLookupProduct(payload) {
  var ref         = String(payload.ref        || '').trim();
  var suchbegriff = String(payload.hersteller || '').trim();  // Feld heisst im UI "Suchbegriff", JSON-Key bleibt "hersteller"
  if (!ref) return jsonResponse({ status: 'error', message: 'ref fehlt' });

  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return jsonResponse({ status: 'ok', suggestion: {} });

  var prompt = 'Du bist Experte für medizinische/zahnmedizinische Produkte. '
    + 'Gegeben: Hersteller "' + suchbegriff + '" und REF-Nummer "' + ref + '". '
    + 'Hersteller und REF-Nummer identifizieren das Produkt eindeutig. '
    + 'Suche im Web nach "' + suchbegriff + ' ' + ref + '" (auch Herstellerkatalog und Händler-Shops) und bestimme: '
    + 'hersteller (gängiger Markenname OHNE Rechtsform-Suffixe wie Inc., AG, GmbH, Corporation, Corp., Ltd., Co., SA, NV — z.B. "Ormco" statt "Ormco Inc.", "3M" statt "3M Company"), '
    + 'artikelname (die exakte offizielle Produktbezeichnung für genau diese REF, inklusive aller Spezifikationen '
    + 'wie Größe, Variante, Slot, Durchmesser, Farbe, Packungsinhalt — so präzise wie im Herstellerkatalog).'
    + ' Antworte NUR als JSON: {"hersteller":"","artikelname":""}. '
    + 'Unbekannte Felder = leerer String. Keine Spekulation.';

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  var body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 300, temperature: 0, thinkingConfig: { thinkingBudget: 0 } }
  };

  try {
    var resp     = UrlFetchApp.fetch(url, {
      method: 'POST', contentType: 'application/json',
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    var result   = JSON.parse(resp.getContentText());
    var grounded = !!(result.candidates && result.candidates[0] && result.candidates[0].groundingMetadata);
    var rParts   = (result.candidates && result.candidates[0] &&
                    result.candidates[0].content && result.candidates[0].content.parts) || [];
    var textParts = rParts.filter(function(p) { return !p.thought && p.text; });
    var raw       = textParts.length > 0 ? textParts[textParts.length - 1].text.trim() : '{}';
    var jsonMatch = raw.match(/\{[\s\S]*\}/);
    var suggestion = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    logUsage('lookupProduct', 'ok',
      'ref=' + ref + ' suchbegriff=' + suchbegriff + ' grounded=' + grounded);
    return jsonResponse({ status: 'ok', suggestion: suggestion });
  } catch (err) {
    Logger.log('handleLookupProduct ERROR: ' + err.message);
    logUsage('lookupProduct', 'error', err.message);
    return jsonResponse({ status: 'ok', suggestion: {} });
  }
}

// ---------------------------------------------------------------------------
// Bootstrap – alle Dropdown-Daten in einem einzigen Request (Startup-Beschleunigung)
// ---------------------------------------------------------------------------

function handleBootstrap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function columnA(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    var vals = [];
    for (var i = 1; i < data.length; i++) {
      var v = String(data[i][0] || '').trim();
      if (v) vals.push(v);
    }
    return vals;
  }

  var suppliers    = columnA(SUPPLIERS_SHEET);
  var locations    = columnA(LAGERORT_SHEET);
  var statusValues = columnA(STATUS_SHEET);

  // Hersteller (Spalte C, unique) + Kategorien (Spalte D, unique) sowie
  // REF→[Hersteller, Kategorie]-Tripel (F→C/D) aus "Bestellungen"
  // für Dropdown-Vorschläge und die Vorauswahl anhand ähnlicher REFs
  var herstellerSeen = {};
  var hersteller = [];
  var kategorienSeen = {};
  var kategorien = [];
  var refMap = [];
  var bSheet = ss.getSheetByName(BESTELLUNGEN_SHEET);
  if (bSheet) {
    var lastRow = bSheet.getLastRow();
    if (lastRow > 1) {
      var rows = bSheet.getRange(2, 3, lastRow - 1, 4).getValues();  // Spalten C–F
      for (var j = 0; j < rows.length; j++) {
        var h = String(rows[j][0] || '').trim();  // C: Hersteller
        var k = String(rows[j][1] || '').trim();  // D: Kategorie
        var r = String(rows[j][3] || '').trim();  // F: REF-Nummer
        if (h && !herstellerSeen[h]) { herstellerSeen[h] = true; hersteller.push(h); }
        if (k && !kategorienSeen[k]) { kategorienSeen[k] = true; kategorien.push(k); }
        if (r && (h || k)) refMap.push([r, h, k]);
      }
      hersteller.sort(function(a, b) { return a.localeCompare(b); });
      kategorien.sort(function(a, b) { return a.localeCompare(b); });
    }
  }

  logUsage('bootstrap', 'ok',
    'suppliers=' + suppliers.length + ' locations=' + locations.length
    + ' status=' + statusValues.length + ' hersteller=' + hersteller.length
    + ' kategorien=' + kategorien.length + ' refMap=' + refMap.length);
  return jsonResponse({
    status: 'ok',
    suppliers: suppliers,
    locations: locations,
    statusValues: statusValues,
    hersteller: hersteller,
    kategorien: kategorien,
    refMap: refMap
  });
}

// ---------------------------------------------------------------------------
// Neues Produkt in "Bestellungen" anlegen (Standalone-Modus)
// ---------------------------------------------------------------------------

function handleAddProduct(payload) {
  var ref = String(payload.ref || '').trim();
  if (!ref || !REF_PATTERN.test(ref)) {
    return jsonResponse({ status: 'error', message: 'Ungültige REF' });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BESTELLUNGEN_SHEET);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden' });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (lockErr) {
    return jsonResponse({ status: 'error', message: 'Server überlastet – bitte erneut versuchen' });
  }

  try {
    // Duplikat-Check per TextFinder nur auf Spalte F – schneller als das ganze Sheet zu lesen
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var dup = sheet.getRange(2, REF_COL, lastRow - 1, 1)
        .createTextFinder(ref).matchEntireCell(true).findNext();
      if (dup) {
        return jsonResponse({ status: 'already_exists', message: 'REF bereits vorhanden' });
      }
    }

    var newId = lastRow;  // neue Zeile = lastRow+1, ID = lastRow (ROW()-1 Formel)
    var row = [
      newId,
      String(payload.name           || ''),  // B: Artikelname
      String(payload.hersteller     || ''),  // C: Hersteller
      String(payload.category       || ''),  // D: Kategorie
      String(payload.hauptlieferant || ''),  // E: Hauptlieferant
      ref,                                   // F: REF-Nummer
      String(payload.articleCode    || ''),  // G: Artikelcode
      String(payload.location       || ''),  // H: Lagerort
      String(payload.orderStatus || 'Nachbestellen'),  // I: Bestellstatus
      '', '', '', '',                         // J–M: leer
      String(payload.alt1 || ''),            // N: Alt. Lieferant 1
      String(payload.alt2 || ''),            // O: Alt. Lieferant 2
      String(payload.alt3 || ''),            // P: Alt. Lieferant 3
      String(payload.alt4 || ''),            // Q: Alt. Lieferant 4
    ];
    sheet.appendRow(row);

    Logger.log('addProduct: ref=' + ref + ' id=' + newId);
    logUsage('addProduct', 'ok', 'ref=' + ref + ' id=' + newId);
    return jsonResponse({ status: 'ok', id: newId });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Produktspezifische Lieferanten lesen
// ---------------------------------------------------------------------------

function handleGetProductSuppliers(payload) {
  var id = String(payload.id || '').trim();
  if (!id) return jsonResponse({ status: 'error', message: 'id fehlt' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Such-URL-Map aus "Lieferanten"-Tab aufbauen
  var urlMap = {};
  var lSheet = ss.getSheetByName(SUPPLIERS_SHEET);
  if (lSheet) {
    var lData = lSheet.getDataRange().getValues();
    for (var i = 1; i < lData.length; i++) {
      var sName = String(lData[i][0]).trim();
      var sUrl  = String(lData[i][1]).trim();
      if (sName && sUrl) urlMap[sName] = sUrl;
    }
  }

  // Produkt-Zeile in "Bestellungen" suchen
  var bSheet = ss.getSheetByName(BESTELLUNGEN_SHEET);
  if (!bSheet) return jsonResponse({ status: 'error', message: 'Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden' });

  var bData = bSheet.getDataRange().getValues();
  for (var r = 1; r < bData.length; r++) {
    if (String(bData[r][ID_COL_INDEX]) !== id) continue;

    // Hauptlieferant (Spalte E) + Alternativen (Spalten N–Q) sammeln, mit Dedup
    var colIdxs = [HAUPTLIEFERANT_COL_IDX].concat(ALT_LIEFERANT_COL_IDXS);
    var suppliers = [];
    var seen = {};
    for (var c = 0; c < colIdxs.length; c++) {
      var name = String(bData[r][colIdxs[c]] || '').trim();
      if (!name || !urlMap[name]) continue;
      var key = name.toLowerCase();
      if (seen[key]) continue;   // bereits gelistet — Hauptlieferant wins (zuerst iteriert)
      seen[key] = true;
      suppliers.push({ name: name, baseUrl: urlMap[name], primary: c === 0 });
    }

    logUsage('getProductSuppliers', 'ok', 'id=' + id + ' count=' + suppliers.length);
    return jsonResponse({ status: 'ok', suppliers: suppliers });
  }

  logUsage('getProductSuppliers', 'not_found', 'id=' + id);
  return jsonResponse({ status: 'not_found', suppliers: [] });
}

// ---------------------------------------------------------------------------
// Bestellstatus auf "Nachbestellen" setzen (Standalone-Modus, REF gefunden)
// ---------------------------------------------------------------------------

function handleMarkReorder(payload) {
  var id = String(payload.id || '').trim();
  if (!id) {
    logUsage('markReorder', 'error', 'id fehlt');
    return jsonResponse({ status: 'error', message: 'id fehlt' });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BESTELLUNGEN_SHEET);
  if (!sheet) {
    logUsage('markReorder', 'error', 'Sheet nicht gefunden');
    return jsonResponse({ status: 'error', message: 'Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden' });
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (lockErr) {
    logUsage('markReorder', 'error', 'Lock-Timeout – id=' + id);
    return jsonResponse({ status: 'error', message: 'Server überlastet – bitte erneut versuchen' });
  }

  try {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ID_COL_INDEX]) === id) {
        sheet.getRange(i + 1, STATUS_COL).setValue('Nachbestellen');
        Logger.log('markReorder: id=' + id + ' row=' + (i + 1));
        logUsage('markReorder', 'ok', 'id=' + id);
        return jsonResponse({ status: 'ok', row: i + 1, id: id });
      }
    }
    logUsage('markReorder', 'not_found', 'id=' + id);
    return jsonResponse({ status: 'not_found', message: 'ID ' + id + ' nicht gefunden' });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Lieferantenliste – Spalte A des "Lieferanten"-Tabs
// ---------------------------------------------------------------------------

function handleListSuppliers() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUPPLIERS_SHEET);
  if (!sheet) {
    logUsage('listSuppliers', 'error', 'Sheet "' + SUPPLIERS_SHEET + '" nicht gefunden');
    return jsonResponse({ status: 'ok', suppliers: [] });
  }
  var data = sheet.getDataRange().getValues();
  var names = [];
  for (var i = 1; i < data.length; i++) {
    var n = String(data[i][0] || '').trim();
    if (n) names.push(n);
  }
  logUsage('listSuppliers', 'ok', 'count=' + names.length);
  return jsonResponse({ status: 'ok', suppliers: names });
}

// ---------------------------------------------------------------------------
// Bestellstatus-Werte – Spalte A des "Bestellstatus"-Tabs
// ---------------------------------------------------------------------------

function handleListStatusValues() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATUS_SHEET);
  if (!sheet) {
    logUsage('listStatusValues', 'error', 'Sheet "' + STATUS_SHEET + '" nicht gefunden');
    return jsonResponse({ status: 'ok', values: [] });
  }
  var data = sheet.getDataRange().getValues();
  var values = [];
  for (var i = 1; i < data.length; i++) {
    var v = String(data[i][0] || '').trim();
    if (v) values.push(v);
  }
  logUsage('listStatusValues', 'ok', 'count=' + values.length);
  return jsonResponse({ status: 'ok', values: values });
}

// ---------------------------------------------------------------------------
// Lagerorte – Spalte A des "Lagerort"-Tabs
// ---------------------------------------------------------------------------

function handleListLocations() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LAGERORT_SHEET);
  if (!sheet) {
    logUsage('listLocations', 'error', 'Sheet "' + LAGERORT_SHEET + '" nicht gefunden');
    return jsonResponse({ status: 'ok', locations: [] });
  }
  var data = sheet.getDataRange().getValues();
  var locations = [];
  for (var i = 1; i < data.length; i++) {
    var loc = String(data[i][0] || '').trim();
    if (loc) locations.push(loc);
  }
  logUsage('listLocations', 'ok', 'count=' + locations.length);
  return jsonResponse({ status: 'ok', locations: locations });
}

// ---------------------------------------------------------------------------
// Bestellstatus für Produkt-ID setzen (Option B – Produkt gefunden)
// ---------------------------------------------------------------------------

function handleSetStatus(payload) {
  var id     = String(payload.id     || '').trim();
  var status = String(payload.status || '').trim();
  if (!id || !status) {
    logUsage('setStatus', 'error', 'id oder status fehlt');
    return jsonResponse({ status: 'error', message: 'id und status erforderlich' });
  }

  // Status gegen die Werte aus dem Bestellstatus-Tab validieren (Sheet-Vergiftung verhindern)
  var statusSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATUS_SHEET);
  if (statusSheet) {
    var sData = statusSheet.getDataRange().getValues();
    var allowed = {};
    for (var k = 1; k < sData.length; k++) {
      var v = String(sData[k][0] || '').trim();
      if (v) allowed[v] = true;
    }
    if (Object.keys(allowed).length > 0 && !allowed[status]) {
      logUsage('setStatus', 'error', 'Ungültiger Status="' + status + '"');
      return jsonResponse({ status: 'error', message: 'Ungültiger Bestellstatus' });
    }
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BESTELLUNGEN_SHEET);
  if (!sheet) {
    logUsage('setStatus', 'error', 'Sheet nicht gefunden');
    return jsonResponse({ status: 'error', message: 'Sheet "' + BESTELLUNGEN_SHEET + '" nicht gefunden' });
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (lockErr) {
    logUsage('setStatus', 'error', 'Lock-Timeout – id=' + id);
    return jsonResponse({ status: 'error', message: 'Server überlastet – bitte erneut versuchen' });
  }

  try {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ID_COL_INDEX]) === id) {
        sheet.getRange(i + 1, STATUS_COL).setValue(status);
        Logger.log('setStatus: id=' + id + ' status=' + status + ' row=' + (i + 1));
        logUsage('setStatus', 'ok', 'id=' + id + ' status=' + status);
        return jsonResponse({ status: 'ok', row: i + 1, id: id });
      }
    }
    logUsage('setStatus', 'not_found', 'id=' + id);
    return jsonResponse({ status: 'not_found', message: 'ID ' + id + ' nicht gefunden' });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Hilfsfunktion
// ---------------------------------------------------------------------------

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
