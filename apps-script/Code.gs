/**
 * Google Apps Script – doPost Webhook
 *
 * Deploy als Web App:
 *   Extensions → Apps Script → Deploy → New deployment
 *   Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Die Deployment-URL als GitHub Secret APPS_SCRIPT_URL speichern.
 */

const SHEET_NAME = 'OCR_Results';

function doPost(e) {
  try {
    var payload = parsePayload(e);
    var sheet = getOrCreateSheet();

    sheet.appendRow([
      new Date().toISOString(),           // A: Timestamp (Serverzeit)
      payload.ref        || '',           // B: Hersteller-Ref (OCR-Ergebnis)
      payload.confidence != null ? payload.confidence : '', // C: Konfidenz %
      payload.timestamp  || '',           // D: Client-Timestamp
      payload.queuedAt   || '',           // E: Offline-Queue-Zeitpunkt (falls vorhanden)
    ]);

    return jsonResponse({ status: 'ok' });

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', message: 'Live OCR Webhook aktiv' });
}

function parsePayload(e) {
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  if (e && e.parameter) {
    return e.parameter;
  }
  throw new Error('Kein Payload empfangen');
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Timestamp', 'Hersteller-Ref', 'Konfidenz', 'Client-Timestamp', 'QueuedAt']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(obj, code) {
  var output = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
