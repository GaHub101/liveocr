/**
 * Google Apps Script – Preisvergleich Lieferanten-Webshops
 *
 * Diese Datei gehört zum selben Apps-Script-Projekt wie `Code.gs`
 * (globale Konstanten/Funktionen wie BESTELLUNGEN_SHEET, REF_COL, STATUS_COL,
 *  HAUPTLIEFERANT_COL_IDX, ALT_LIEFERANT_COL_IDXS, SUPPLIERS_SHEET, ID_COL_INDEX,
 *  REF_PATTERN, logUsage, jsonResponse werden von dort mitbenutzt).
 *
 * Ablauf:
 *   - Ein zeitgesteuerter Trigger (refreshPrices) loggt sich pro Shop ein,
 *     ruft für jede REF die Suchseite ab, extrahiert den Preis per Regex und
 *     schreibt ihn in das Sheet "Preise" (Cache).
 *   - Die Action getProductSuppliers (Code.gs) reichert die Lieferanten-Liste
 *     um diese gecachten Preise an – der Client zeigt sie ohne weiteren Roundtrip.
 *
 * Einrichtung (siehe CLAUDE.md):
 *   1. setupPriceSheets()      – legt "Preise" + "PreisConfig" an
 *   2. PreisConfig befüllen, Script Properties SHOP_CRED_<KEY> setzen
 *   3. testShopScrape(name,ref) – pro Shop einmal prüfen
 *   4. installPriceTrigger()    – täglichen Trigger installieren
 *
 * WICHTIG: Niemals Credentials oder Cookie-WERTE loggen – nur Cookie-Namen
 *          und HTTP-Statuscodes.
 */

var PREISE_SHEET       = 'Preise';
var PREISCONFIG_SHEET  = 'PreisConfig';

// Spalten "Preise" (0-based)
var PR_COL_LIEFERANT   = 0;  // A
var PR_COL_REF         = 1;  // B
var PR_COL_PREIS       = 2;  // C
var PR_COL_WAEHRUNG    = 3;  // D
var PR_COL_VERFUEG     = 4;  // E
var PR_COL_URL         = 5;  // F
var PR_COL_STAND       = 6;  // G
var PR_COL_STATUS      = 7;  // H
var PR_COL_FEHLER      = 8;  // I

// Status, der einen Abruf auslöst (Spalte I "Bestellungen")
var REORDER_STATUS     = 'Nachbestellen';

// Zeitbudget pro Trigger-Lauf (ms) – Puffer vor dem 6-Minuten-Limit
var PRICE_RUN_BUDGET_MS = 270000;   // 4,5 min
// Maximale Anzahl Einmal-Fortsetzungs-Trigger pro Tag
var PRICE_MAX_CONTINUATIONS = 3;
// Session-Cache-Dauer (s)
var PRICE_SESSION_TTL = 1500;

// ---------------------------------------------------------------------------
// Konfiguration laden
// ---------------------------------------------------------------------------

// Liest das "PreisConfig"-Sheet → Liste von Config-Objekten.
function getShopConfigs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PREISCONFIG_SHEET);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var configs = [];
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0] || '').trim();
    if (!name) continue;
    configs.push({
      name:           name,
      mode:           String(data[i][1] || 'apps_script').trim() || 'apps_script',
      loginPageUrl:   String(data[i][2] || '').trim(),
      loginUrl:       String(data[i][3] || '').trim(),
      loginPayload:   String(data[i][4] || '').trim(),
      tokenRegex:     String(data[i][5] || '').trim(),
      searchTemplate: String(data[i][6] || '').trim(),
      priceRegex:     String(data[i][7] || '').trim(),
      loginCheckRegex: String(data[i][8] || '').trim(),
      active:         isTruthy(data[i][9])
    });
  }
  return configs;
}

function getShopConfig(name) {
  var configs = getShopConfigs();
  var key = String(name || '').trim().toLowerCase();
  for (var i = 0; i < configs.length; i++) {
    if (configs[i].name.toLowerCase() === key) return configs[i];
  }
  return null;
}

function isTruthy(v) {
  if (v === true) return true;
  var s = String(v || '').trim().toLowerCase();
  return s === 'ja' || s === 'true' || s === 'x' || s === '1' || s === 'yes';
}

// Script-Property-Schlüssel aus Lieferantenname ableiten:
// "Henry Schein" → "SHOP_CRED_HENRY_SCHEIN"
function shopCredKey(name) {
  var s = String(name || '').toUpperCase();
  s = s.replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS');
  s = s.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return 'SHOP_CRED_' + s;
}

// Liefert {user, pass} oder null.
function getShopCredentials(name) {
  var raw = PropertiesService.getScriptProperties().getProperty(shopCredKey(name));
  if (!raw) return null;
  try {
    var obj = JSON.parse(raw);
    if (obj && obj.user != null && obj.pass != null) {
      return { user: String(obj.user), pass: String(obj.pass) };
    }
  } catch (err) {
    Logger.log('getShopCredentials: JSON-Parse-Fehler für ' + shopCredKey(name));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cookie-Jar (einfaches Objekt {name: value})
// ---------------------------------------------------------------------------

// Übernimmt Set-Cookie-Header in den Jar. getAllHeaders()['Set-Cookie'] ist
// je nach Anzahl Cookies ein String ODER ein Array (Apps-Script-Eigenheit).
function mergeSetCookies(jar, response) {
  var headers = response.getAllHeaders();
  var raw = headers['Set-Cookie'];
  if (!raw) return jar;
  var arr = (typeof raw === 'string') ? [raw] : raw;
  for (var i = 0; i < arr.length; i++) {
    var first = String(arr[i]).split(';')[0];          // nur "name=value"
    var eq = first.indexOf('=');
    if (eq <= 0) continue;
    var cName = first.substring(0, eq).trim();
    var cVal  = first.substring(eq + 1).trim();
    if (cName) jar[cName] = cVal;
  }
  return jar;
}

function cookieHeader(jar) {
  var parts = [];
  for (var k in jar) {
    if (jar.hasOwnProperty(k)) parts.push(k + '=' + jar[k]);
  }
  return parts.join('; ');
}

// Nur die Cookie-NAMEN (fürs Logging, ohne Werte preiszugeben).
function cookieNames(jar) {
  var names = [];
  for (var k in jar) {
    if (jar.hasOwnProperty(k)) names.push(k);
  }
  return names.join(',');
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

// Führt den Formular-Login durch. Gibt {ok:true, jar} oder {ok:false, error}.
function shopLogin(config, creds) {
  var jar = {};
  var token = '';

  // 1) Optional: Login-Seite laden (Session-Cookie + CSRF-Token holen)
  if (config.loginPageUrl) {
    try {
      var pageResp = UrlFetchApp.fetch(config.loginPageUrl, {
        method: 'get',
        followRedirects: false,
        muteHttpExceptions: true
      });
      mergeSetCookies(jar, pageResp);
      if (config.tokenRegex) {
        var m = new RegExp(config.tokenRegex).exec(pageResp.getContentText());
        if (m && m[1]) token = m[1];
      }
    } catch (err) {
      return { ok: false, error: 'Login-Seite nicht erreichbar: ' + err.message };
    }
  }

  // 2) Login-Payload füllen
  var payload = config.loginPayload
    .replace(/\{\{user\}\}/g, encodeURIComponent(creds.user))
    .replace(/\{\{pass\}\}/g, encodeURIComponent(creds.pass))
    .replace(/\{\{token\}\}/g, encodeURIComponent(token));

  // 3) Login-POST
  try {
    var resp = UrlFetchApp.fetch(config.loginUrl, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: payload,
      headers: jar && cookieHeader(jar) ? { 'Cookie': cookieHeader(jar) } : {},
      followRedirects: false,
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    mergeSetCookies(jar, resp);

    // Erfolgsheuristik: 302/303 = Redirect nach Login = ok.
    // 200 ohne neue Cookies = vermutlich fehlgeschlagen.
    if (code === 302 || code === 303 || code === 301) {
      return { ok: true, jar: jar };
    }
    if (code === 200 && cookieNames(jar)) {
      return { ok: true, jar: jar };
    }
    return { ok: false, error: 'Login HTTP ' + code, jar: jar };
  } catch (err) {
    return { ok: false, error: 'Login-POST fehlgeschlagen: ' + err.message };
  }
}

// ---------------------------------------------------------------------------
// Session-Reuse via CacheService
// ---------------------------------------------------------------------------

function sessionCacheKey(name) {
  return 'shop_session_' + shopCredKey(name);
}

// Liefert einen Cookie-Jar (aus Cache oder frischem Login) oder null bei Fehler.
function getSession(config) {
  var cache = CacheService.getScriptCache();
  var key = sessionCacheKey(config.name);
  var cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fällt durch zum Login */ }
  }
  var creds = getShopCredentials(config.name);
  if (!creds) return null;
  var res = shopLogin(config, creds);
  if (!res.ok) return null;
  cache.put(key, JSON.stringify(res.jar), PRICE_SESSION_TTL);
  return res.jar;
}

function invalidateSession(name) {
  CacheService.getScriptCache().remove(sessionCacheKey(name));
}

// ---------------------------------------------------------------------------
// Preisabruf
// ---------------------------------------------------------------------------

// Holt die Suchseite, folgt Redirects manuell (Cookies mitführen) und gibt den
// finalen Response zurück.
function fetchWithCookies(url, jar, maxRedirects) {
  var current = url;
  for (var hop = 0; hop <= maxRedirects; hop++) {
    var resp = UrlFetchApp.fetch(current, {
      method: 'get',
      headers: cookieHeader(jar) ? { 'Cookie': cookieHeader(jar) } : {},
      followRedirects: false,
      muteHttpExceptions: true
    });
    mergeSetCookies(jar, resp);
    var code = resp.getResponseCode();
    if (code === 301 || code === 302 || code === 303 || code === 307 || code === 308) {
      var loc = resp.getAllHeaders()['Location'];
      if (!loc) return resp;
      if (Array.isArray(loc)) loc = loc[0];
      current = absoluteUrl(current, loc);
      continue;
    }
    return resp;
  }
  // Zu viele Redirects – letzten Response besorgen
  return UrlFetchApp.fetch(current, {
    method: 'get',
    headers: cookieHeader(jar) ? { 'Cookie': cookieHeader(jar) } : {},
    followRedirects: false,
    muteHttpExceptions: true
  });
}

// Relative Location in absolute URL auflösen (einfacher Fall).
function absoluteUrl(base, loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  var m = /^(https?:\/\/[^\/]+)/i.exec(base);
  var origin = m ? m[1] : '';
  if (loc.charAt(0) === '/') return origin + loc;
  // relativ zum Pfad
  var path = base.replace(/[^\/]*$/, '');
  return path + loc;
}

// Ruft Preis für eine REF ab. Gibt {status, price, currency, productUrl, error}.
function fetchPriceFromShop(config, jar, ref) {
  var url = config.searchTemplate.replace(/\{\{ref\}\}/g, encodeURIComponent(ref));
  var resp;
  try {
    resp = fetchWithCookies(url, jar, 3);
  } catch (err) {
    return { status: 'http_error', price: null, currency: 'EUR', productUrl: url, error: err.message };
  }

  var code = resp.getResponseCode();
  if (code >= 400) {
    return { status: 'http_error', price: null, currency: 'EUR', productUrl: url, error: 'HTTP ' + code };
  }

  var body = resp.getContentText();

  // Login-Check: Sind wir noch eingeloggt?
  if (config.loginCheckRegex && !new RegExp(config.loginCheckRegex).test(body)) {
    invalidateSession(config.name);
    var creds = getShopCredentials(config.name);
    if (creds) {
      var relog = shopLogin(config, creds);
      if (relog.ok) {
        for (var k in relog.jar) { if (relog.jar.hasOwnProperty(k)) jar[k] = relog.jar[k]; }
        CacheService.getScriptCache().put(sessionCacheKey(config.name), JSON.stringify(jar), PRICE_SESSION_TTL);
        try {
          resp = fetchWithCookies(url, jar, 3);
          body = resp.getContentText();
        } catch (err2) {
          return { status: 'http_error', price: null, currency: 'EUR', productUrl: url, error: err2.message };
        }
        if (config.loginCheckRegex && !new RegExp(config.loginCheckRegex).test(body)) {
          return { status: 'login_failed', price: null, currency: 'EUR', productUrl: url, error: 'Re-Login ohne Erfolg' };
        }
      } else {
        return { status: 'login_failed', price: null, currency: 'EUR', productUrl: url, error: relog.error };
      }
    } else {
      return { status: 'login_failed', price: null, currency: 'EUR', productUrl: url, error: 'Keine Credentials' };
    }
  }

  // Preis extrahieren
  if (!config.priceRegex) {
    return { status: 'pattern_miss', price: null, currency: 'EUR', productUrl: url, error: 'Kein Preis-Regex konfiguriert' };
  }
  var pm = new RegExp(config.priceRegex).exec(body);
  if (!pm || !pm[1]) {
    // Heuristik: "nicht gefunden"-Seiten von echten Pattern-Misses trennen
    var status = /keine?\s+(treffer|ergebnisse|artikel)|nicht\s+gefunden|0\s+treffer/i.test(body)
      ? 'not_found' : 'pattern_miss';
    return { status: status, price: null, currency: 'EUR', productUrl: url, error: 'Preis-Regex ohne Treffer' };
  }

  var price = parseGermanPrice(pm[1]);
  if (price == null) {
    return { status: 'pattern_miss', price: null, currency: 'EUR', productUrl: url, error: 'Preis nicht parsebar: ' + pm[1] };
  }
  return { status: 'ok', price: price, currency: 'EUR', productUrl: url, error: '' };
}

// Deutschen Preis-String in Zahl wandeln: '1.234,56' → 1234.56; '42,90 €' → 42.9.
function parseGermanPrice(str) {
  if (str == null) return null;
  var s = String(str).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.indexOf(',') >= 0) {
    // Komma = Dezimaltrennzeichen, Punkt = Tausender
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    // mehrere Punkte → Tausenderpunkte
    s = s.replace(/\./g, '');
  }
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Cache-Sheet schreiben (Upsert per Lieferant+REF)
// ---------------------------------------------------------------------------

function upsertPriceRow(supplier, ref, result) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PREISE_SHEET);
  if (!sheet) sheet = createPriceSheet_(ss);

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    Logger.log('upsertPriceRow: Lock-Timeout');
    return;
  }
  try {
    var data = sheet.getDataRange().getValues();
    var rowValues = [
      supplier,
      ref,
      (result.price == null ? '' : result.price),
      result.currency || 'EUR',
      result.availability || '',
      result.productUrl || '',
      new Date().toISOString(),
      result.status || '',
      result.error || ''
    ];

    var supLower = String(supplier).toLowerCase();
    var refStr = String(ref);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][PR_COL_LIEFERANT]).toLowerCase() === supLower &&
          String(data[i][PR_COL_REF]) === refStr) {
        sheet.getRange(i + 1, 1, 1, rowValues.length).setValues([rowValues]);
        return;
      }
    }
    sheet.appendRow(rowValues);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Trigger-Job
// ---------------------------------------------------------------------------

// Haupt-Trigger: aktualisiert Preise für alle "Nachbestellen"-Produkte.
function refreshPrices() {
  var start = Date.now();
  var props = PropertiesService.getScriptProperties();

  // Verbrauchte Einmal-Trigger aufräumen
  cleanupContinuationTriggers_();

  // Aktive apps_script-Shops
  var configs = getShopConfigs();
  var activeByName = {};
  for (var ci = 0; ci < configs.length; ci++) {
    if (configs[ci].active && configs[ci].mode === 'apps_script') {
      activeByName[configs[ci].name.toLowerCase()] = configs[ci];
    }
  }
  if (!Object.keys(activeByName).length) {
    logUsage('priceRefresh', 'ok', 'Keine aktiven apps_script-Shops');
    return;
  }

  var work = buildWorkList_(activeByName);   // [{shop, config, ref}]
  if (!work.length) {
    logUsage('priceRefresh', 'ok', '0 Arbeitspakete (keine Nachbestellen-Produkte)');
    props.deleteProperty('PRICE_CURSOR');
    return;
  }

  var cursor = parseInt(props.getProperty('PRICE_CURSOR') || '0', 10);
  if (cursor >= work.length || isNaN(cursor)) cursor = 0;

  // Session-Jar pro Shop genau einmal pro Lauf
  var sessions = {};       // name → jar
  var loginFailed = {};    // name → true (für Rest des Laufs überspringen)
  var processed = 0;

  var i = cursor;
  for (; i < work.length; i++) {
    if (Date.now() - start > PRICE_RUN_BUDGET_MS) break;

    var item = work[i];
    var nameLower = item.config.name.toLowerCase();

    if (loginFailed[nameLower]) {
      upsertPriceRow(item.config.name, item.ref, { status: 'login_failed', price: null, currency: 'EUR', error: 'Login fehlgeschlagen' });
      processed++;
      continue;
    }

    if (!sessions[nameLower]) {
      var jar = getSession(item.config);
      if (!jar) {
        loginFailed[nameLower] = true;
        logUsage('priceRefresh', 'error', 'Login fehlgeschlagen: ' + item.config.name);
        upsertPriceRow(item.config.name, item.ref, { status: 'login_failed', price: null, currency: 'EUR', error: 'Login fehlgeschlagen' });
        processed++;
        continue;
      }
      sessions[nameLower] = jar;
    }

    try {
      var res = fetchPriceFromShop(item.config, sessions[nameLower], item.ref);
      upsertPriceRow(item.config.name, item.ref, res);
      if (res.status === 'login_failed') {
        loginFailed[nameLower] = true;
        invalidateSession(item.config.name);
        logUsage('priceRefresh', 'error', 'shop=' + item.config.name + ' ref=' + item.ref + ' status=login_failed');
      } else if (res.status !== 'ok') {
        logUsage('priceRefresh', res.status, 'shop=' + item.config.name + ' ref=' + item.ref);
      }
    } catch (err) {
      upsertPriceRow(item.config.name, item.ref, { status: 'http_error', price: null, currency: 'EUR', error: err.message });
      logUsage('priceRefresh', 'error', 'shop=' + item.config.name + ' ref=' + item.ref + ' – ' + err.message);
    }
    processed++;
  }

  if (i >= work.length) {
    // Durchlauf komplett
    props.deleteProperty('PRICE_CURSOR');
    logUsage('priceRefresh', 'ok', 'Komplett – ' + processed + ' Pakete verarbeitet');
  } else {
    // Abbruch wegen Zeitbudget → Cursor speichern + Fortsetzung planen
    props.setProperty('PRICE_CURSOR', String(i));
    logUsage('priceRefresh', 'ok', 'Teil – ' + processed + ' Pakete, Cursor=' + i + '/' + work.length);
    scheduleContinuation_();
  }
}

// Baut [{shop, config, ref}] aus Bestellungen (nur Status "Nachbestellen"),
// sortiert nach ältestem Cache-Stand (stalest first).
function buildWorkList_(activeByName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Such-URL-Map aus Lieferanten (nur Namen, die auch eine Such-URL haben)
  var bSheet = ss.getSheetByName(BESTELLUNGEN_SHEET);
  if (!bSheet) return [];
  var bData = bSheet.getDataRange().getValues();

  // Bekannten Stand pro (shop|ref) für Sortierung
  var standMap = buildStandMap_(ss);

  var colIdxs = [HAUPTLIEFERANT_COL_IDX].concat(ALT_LIEFERANT_COL_IDXS);
  var work = [];
  for (var r = 1; r < bData.length; r++) {
    var status = String(bData[r][STATUS_COL - 1] || '').trim();
    if (status !== REORDER_STATUS) continue;

    var ref = String(bData[r][REF_COL - 1] || '').trim();
    if (!ref || !REF_PATTERN.test(ref)) continue;

    var seen = {};
    for (var c = 0; c < colIdxs.length; c++) {
      var supName = String(bData[r][colIdxs[c]] || '').trim();
      if (!supName) continue;
      var cfg = activeByName[supName.toLowerCase()];
      if (!cfg) continue;
      var dedupKey = supName.toLowerCase() + '|' + ref;
      if (seen[dedupKey]) continue;
      seen[dedupKey] = true;
      work.push({
        config: cfg,
        ref: ref,
        stand: standMap[supName.toLowerCase() + '|' + ref] || ''
      });
    }
  }

  // Stalest first: leerer Stand (= nie abgerufen) zuerst
  work.sort(function (a, b) {
    if (a.stand === b.stand) return 0;
    if (!a.stand) return -1;
    if (!b.stand) return 1;
    return a.stand < b.stand ? -1 : 1;
  });
  return work;
}

// Map (shop|ref → Stand-ISO) aus dem Preise-Sheet.
function buildStandMap_(ss) {
  var map = {};
  var sheet = ss.getSheetByName(PREISE_SHEET);
  if (!sheet) return map;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][PR_COL_LIEFERANT]).toLowerCase() + '|' + String(data[i][PR_COL_REF]);
    map[key] = String(data[i][PR_COL_STAND] || '');
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fortsetzungs-Trigger (max. N pro Tag)
// ---------------------------------------------------------------------------

function scheduleContinuation_() {
  var props = PropertiesService.getScriptProperties();
  var today = new Date().toISOString().substring(0, 10);
  var counterDay = props.getProperty('PRICE_CONT_DAY');
  var count = parseInt(props.getProperty('PRICE_CONT_COUNT') || '0', 10);
  if (counterDay !== today) { count = 0; props.setProperty('PRICE_CONT_DAY', today); }
  if (count >= PRICE_MAX_CONTINUATIONS) {
    logUsage('priceRefresh', 'ok', 'Fortsetzungs-Limit erreicht (' + PRICE_MAX_CONTINUATIONS + '/Tag)');
    return;
  }
  var trigger = ScriptApp.newTrigger('refreshPrices').timeBased().after(60 * 1000).create();
  // Trigger-ID merken, damit der nächste Lauf den verbrauchten Einmal-Trigger
  // gezielt löschen kann (Einmal- vs. Tages-Trigger sind via API nicht
  // unterscheidbar, daher Löschung per gespeicherter ID).
  props.setProperty('PRICE_CONT_TRIGGER_ID', trigger.getUniqueId());
  props.setProperty('PRICE_CONT_COUNT', String(count + 1));
}

// Verbrauchten Einmal-Fortsetzungs-Trigger des vorigen Laufs entfernen.
function cleanupContinuationTriggers_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PRICE_CONT_TRIGGER_ID');
  if (!id) return;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getUniqueId() === id) {
      ScriptApp.deleteTrigger(triggers[i]);
      break;
    }
  }
  props.deleteProperty('PRICE_CONT_TRIGGER_ID');
}

// ---------------------------------------------------------------------------
// Setup / Installation (manuell im Editor ausführen)
// ---------------------------------------------------------------------------

function createPriceSheet_(ss) {
  var sheet = ss.insertSheet(PREISE_SHEET);
  sheet.appendRow(['Lieferant', 'REF', 'Preis', 'Währung', 'Verfügbarkeit', 'Produkt-URL', 'Stand', 'Status', 'Fehler']);
  sheet.setFrozenRows(1);
  return sheet;
}

// Legt "Preise" + "PreisConfig" an, falls nicht vorhanden.
function setupPriceSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(PREISE_SHEET)) createPriceSheet_(ss);

  if (!ss.getSheetByName(PREISCONFIG_SHEET)) {
    var cfg = ss.insertSheet(PREISCONFIG_SHEET);
    cfg.appendRow(['Lieferant', 'Modus', 'Login-Seite-URL', 'Login-URL', 'Login-Payload',
                   'Token-Regex', 'Such-URL-Template', 'Preis-Regex', 'Login-Check-Regex', 'Aktiv']);
    cfg.setFrozenRows(1);
    // Beispielzeile als Hilfestellung (inaktiv)
    cfg.appendRow(['Beispiel Shop', 'apps_script',
                   'https://shop.example.de/login',
                   'https://shop.example.de/login/check',
                   'email={{user}}&password={{pass}}&_csrf_token={{token}}',
                   'name="_csrf_token"\\s+value="([^"]+)"',
                   'https://shop.example.de/search?q={{ref}}',
                   '"price"\\s*:\\s*"([\\d.,]+)"',
                   'Mein Konto',
                   'nein']);
  }
  Logger.log('setupPriceSheets: fertig.');
}

// Installiert den täglichen Trigger (löscht alte refreshPrices-Trigger zuvor).
function installPriceTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'refreshPrices') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('refreshPrices').timeBased().everyDays(1).atHour(5).create();
  Logger.log('installPriceTrigger: täglicher Trigger um ~05:00 installiert.');
}

// ---------------------------------------------------------------------------
// Test-Helfer (manuell im Editor ausführen, Execution-Log prüfen)
// ---------------------------------------------------------------------------

function testShopScrape(name, ref) {
  var config = getShopConfig(name);
  if (!config) { Logger.log('testShopScrape: Shop "' + name + '" nicht in PreisConfig'); return; }
  var creds = getShopCredentials(name);
  Logger.log('Credentials vorhanden: ' + (creds ? 'ja' : 'NEIN'));
  if (!creds) return;

  var login = shopLogin(config, creds);
  Logger.log('Login ok: ' + login.ok + (login.error ? (' – ' + login.error) : ''));
  Logger.log('Cookie-Namen nach Login: ' + (login.jar ? cookieNames(login.jar) : '(keine)'));
  if (!login.ok) return;

  var res = fetchPriceFromShop(config, login.jar, ref);
  Logger.log('Ergebnis: status=' + res.status + ' preis=' + res.price + ' fehler=' + res.error);
  Logger.log('Produkt-URL: ' + res.productUrl);
}
