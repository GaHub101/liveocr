// mode: "browser" – echter Browser (Playwright Chromium) für Shops mit
// Bot-Schutz / JS-gerenderten Preisen.
//
// Ein Browser-Context + Login pro Shop; der Login bleibt über alle REFs erhalten.
//
// Shop-Config (browser):
//   login: {
//     userSelector, passSelector, submitSelector,  // Login-Formular
//     checkSelector,   // optional: nur eingeloggt sichtbar (z. B. "text=Mein Konto")
//   }
//   priceSelector,     // CSS-Selektor des Preis-Elements
//   notFoundSelector,  // optional: "keine Treffer"-Element
//   waitMs,            // optional: zusätzl. Wartezeit nach Navigation (Default 0)

import { chromium } from 'playwright';
import { parseGermanPrice } from './parsePrice.js';
import { log } from './log.js';
import { dumpPage, DUMP_STATUSES } from './debugDump.js';

async function doLogin(page, shop, config, creds) {
  const lc = config.login || {};
  log.debug('browser', `${shop}: öffne Login ${config.loginUrl}`);
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  await page.fill(lc.userSelector, creds.user);
  await page.fill(lc.passSelector, creds.pass);
  await Promise.all([
    page.waitForLoadState('domcontentloaded').catch(() => {}),
    page.click(lc.submitSelector),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});

  if (lc.checkSelector) {
    const ok = await page.locator(lc.checkSelector).first().isVisible().catch(() => false);
    log.debug('browser', `${shop}: Login-Check "${lc.checkSelector}" → ${ok ? 'eingeloggt' : 'NICHT eingeloggt'}`);
    return ok;
  }
  return true; // ohne Check: annehmen, dass Login geklappt hat
}

// workItems: [{ ref, searchTemplate }] → [{ ref, status, price, ... }]
export async function scrapeBrowser(shop, config, creds, workItems, opts = {}) {
  const results = [];
  const browser = await chromium.launch({ headless: !opts.headful });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    let loggedIn;
    try {
      loggedIn = await doLogin(page, shop, config, creds);
    } catch (err) {
      log.error('browser', `${shop}: Login-Fehler – ${err.message}`);
      loggedIn = false;
    }

    for (const item of workItems) {
      const url = String(item.searchTemplate || '').replace(/\{\{ref\}\}/g, encodeURIComponent(item.ref));
      const base = { ref: item.ref, currency: 'EUR', availability: '', productUrl: url, price: null, error: '' };

      if (!loggedIn) { results.push({ ...base, status: 'login_failed', error: 'Login fehlgeschlagen' }); continue; }
      if (!url) { results.push({ ...base, status: 'http_error', error: 'Keine Such-URL (searchTemplate fehlt)' }); continue; }

      let out;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
        const code = resp ? resp.status() : 0;
        if (config.waitMs) await page.waitForTimeout(config.waitMs);
        log.debug('browser', `${item.ref}: goto ${url} → HTTP ${code}`);

        if (code >= 400) {
          out = { ...base, status: 'http_error', error: 'HTTP ' + code };
        } else if (config.notFoundSelector &&
                   await page.locator(config.notFoundSelector).first().isVisible().catch(() => false)) {
          out = { ...base, status: 'not_found', error: 'notFoundSelector sichtbar' };
        } else {
          const loc = page.locator(config.priceSelector).first();
          const raw = await loc.textContent({ timeout: 5000 }).catch(() => null);
          if (raw == null) {
            out = { ...base, status: 'pattern_miss', error: 'priceSelector ohne Treffer' };
          } else {
            const price = parseGermanPrice(raw);
            log.debug('browser', `${item.ref}: Roh "${raw.trim()}" → ${price}`);
            out = price == null
              ? { ...base, status: 'pattern_miss', error: 'Preis nicht parsebar: ' + raw.trim() }
              : { ...base, status: 'ok', price };
          }
        }
      } catch (err) {
        log.warn('browser', `${item.ref}: ${err.message}`);
        out = { ...base, status: 'http_error', error: err.message };
      }

      if (opts.debug || DUMP_STATUSES.has(out.status)) {
        await dumpPage(page, shop, item.ref, out.status);
      }
      results.push(out);
    }
  } finally {
    await browser.close();
  }
  return results;
}
