// mode: "http" – leichter Scraper ohne Browser (kein JavaScript).
// Formular-Login mit eigenem Cookie-Jar + Regex-Preisextraktion.
// Entspricht funktional dem apps_script-Pfad (Preise.gs), läuft aber off-Google
// mit Wohn-IP.
//
// Shop-Config (http):
//   login: {
//     loginPageUrl,      // optional: GET für Session-Cookie + CSRF-Token
//     tokenRegex,        // optional: Capture-Gruppe 1 = Token
//     payload,           // 'email={{user}}&password={{pass}}&_csrf_token={{token}}'
//     loginCheckRegex,   // optional: Muster, das nur eingeloggt erscheint
//   }
//   priceSelector,       // optional: Cheerio-CSS-Selektor (Vorrang vor priceRegex)
//   priceRegex,          // Capture-Gruppe 1 = Preis-String (Fallback)
//   notFoundSelector,    // optional: Cheerio-CSS-Selektor für "keine Treffer"
//   notFoundRegex,       // optional: erkennt "keine Treffer"-Seiten (Fallback)

import * as cheerio from 'cheerio';
import { parseGermanPrice } from './parsePrice.js';
import { log } from './log.js';
import { dumpHtml, DUMP_STATUSES } from './debugDump.js';

// --- Cookie-Jar ------------------------------------------------------------

function setCookies(jar, resp) {
  let list = [];
  if (typeof resp.headers.getSetCookie === 'function') {
    list = resp.headers.getSetCookie();
  } else {
    const raw = resp.headers.get('set-cookie');
    if (raw) list = [raw];
  }
  for (const c of list) {
    const first = String(c).split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
}

function cookieHeader(jar) {
  return Object.keys(jar).map((k) => `${k}=${jar[k]}`).join('; ');
}

function cookieNames(jar) {
  return Object.keys(jar).join(',');
}

function absoluteUrl(base, loc) {
  try { return new URL(loc, base).toString(); } catch { return loc; }
}

// GET/POST mit manueller Redirect-Verfolgung (Cookies mitführen).
async function fetchManual(url, { method = 'GET', headers = {}, body, jar, maxRedirects = 4 }) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const h = { ...headers };
    const cookie = cookieHeader(jar);
    if (cookie) h.Cookie = cookie;
    const resp = await fetch(current, {
      method: hop === 0 ? method : 'GET', // nach Redirect immer GET
      headers: h,
      body: hop === 0 ? body : undefined,
      redirect: 'manual',
    });
    setCookies(jar, resp);
    const code = resp.status;
    if ([301, 302, 303, 307, 308].includes(code)) {
      const loc = resp.headers.get('location');
      if (!loc) return resp;
      current = absoluteUrl(current, loc);
      continue;
    }
    return resp;
  }
  return fetch(current, { headers: { Cookie: cookieHeader(jar) }, redirect: 'manual' });
}

// --- Login -----------------------------------------------------------------

async function login(shop, config, creds) {
  const jar = {};
  const lc = config.login || {};
  let token = '';

  if (lc.loginPageUrl) {
    const pageResp = await fetchManual(lc.loginPageUrl, { jar });
    const pageText = await pageResp.text();
    log.debug('http', `Login-Seite ${lc.loginPageUrl} → HTTP ${pageResp.status}`);
    if (lc.tokenRegex) {
      const m = new RegExp(lc.tokenRegex).exec(pageText);
      if (m && m[1]) token = m[1];
      log.debug('http', `CSRF-Token ${m && m[1] ? 'gefunden' : 'NICHT gefunden'}`);
    }
  }

  const payload = String(lc.payload || '')
    .replace(/\{\{user\}\}/g, encodeURIComponent(creds.user))
    .replace(/\{\{pass\}\}/g, encodeURIComponent(creds.pass))
    .replace(/\{\{token\}\}/g, encodeURIComponent(token));

  const resp = await fetchManual(config.loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload,
    jar,
  });
  const text = await resp.text();
  log.debug('http', `Login-POST ${config.loginUrl} → HTTP ${resp.status}, Cookies: ${cookieNames(jar) || '(keine)'}`);

  // Erfolgsheuristik: Cookies gesetzt und (falls konfiguriert) Login-Check trifft.
  let ok = !!cookieNames(jar);
  if (ok && lc.loginCheckRegex) {
    ok = new RegExp(lc.loginCheckRegex).test(text);
    log.debug('http', `Login-Check-Regex: ${ok ? 'eingeloggt' : 'NICHT eingeloggt'}`);
  }
  return { ok, jar };
}

// --- Preisabruf ------------------------------------------------------------

function looksNotFound(config, body, $) {
  if (config.notFoundSelector && $) return $(config.notFoundSelector).length > 0;
  if (config.notFoundRegex) return new RegExp(config.notFoundRegex).test(body);
  return /keine?\s+(treffer|ergebnisse|artikel)|nicht\s+gefunden|0\s+treffer/i.test(body);
}

function extract(shop, ref, config, body) {
  let raw = null;

  // Bevorzugt CSS-Selektor (Cheerio), sonst Regex.
  if (config.priceSelector) {
    const $ = cheerio.load(body);
    const el = $(config.priceSelector).first();
    if (!el.length) {
      return { status: looksNotFound(config, body, $) ? 'not_found' : 'pattern_miss', error: 'priceSelector ohne Treffer' };
    }
    raw = el.text();
  } else if (config.priceRegex) {
    const pm = new RegExp(config.priceRegex).exec(body);
    if (!pm || !pm[1]) {
      return { status: looksNotFound(config, body) ? 'not_found' : 'pattern_miss', error: 'priceRegex ohne Treffer' };
    }
    raw = pm[1];
  } else {
    return { status: 'pattern_miss', error: 'Weder priceSelector noch priceRegex konfiguriert' };
  }

  const price = parseGermanPrice(raw);
  if (price == null) return { status: 'pattern_miss', error: 'Preis nicht parsebar: ' + String(raw).trim() };
  log.debug('http', `${ref}: Roh "${String(raw).trim()}" → ${price}`);
  return { status: 'ok', price };
}

// Öffentliche API: scrape alle workItems eines Shops.
// workItems: [{ ref, searchTemplate }]
export async function scrapeHttp(shop, config, creds, workItems, opts = {}) {
  const results = [];
  let session;
  try {
    session = await login(shop, config, creds);
  } catch (err) {
    log.error('http', `${shop}: Login-Fehler – ${err.message}`);
    session = { ok: false, jar: {} };
  }

  for (const item of workItems) {
    const url = String(item.searchTemplate || '').replace(/\{\{ref\}\}/g, encodeURIComponent(item.ref));
    const base = { ref: item.ref, currency: 'EUR', availability: '', productUrl: url, price: null, error: '' };

    if (!session.ok) {
      results.push({ ...base, status: 'login_failed', error: 'Login fehlgeschlagen' });
      continue;
    }
    if (!url) {
      results.push({ ...base, status: 'http_error', error: 'Keine Such-URL (searchTemplate fehlt)' });
      continue;
    }

    try {
      const resp = await fetchManual(url, { jar: session.jar });
      const body = await resp.text();
      log.debug('http', `${item.ref}: GET ${url} → HTTP ${resp.status}`);
      let out;
      if (resp.status >= 400) {
        out = { ...base, status: 'http_error', error: 'HTTP ' + resp.status };
      } else {
        out = { ...base, ...extract(shop, item.ref, config, body) };
      }
      if (opts.debug || DUMP_STATUSES.has(out.status)) {
        dumpHtml(shop, item.ref, out.status, body);
      }
      results.push(out);
    } catch (err) {
      log.warn('http', `${item.ref}: ${err.message}`);
      results.push({ ...base, status: 'http_error', error: err.message });
    }
  }
  return results;
}
