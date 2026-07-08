// Externer Preis-Scraper – Entry Point.
//
// Ablauf:
//   1. getWorkList vom Apps Script holen (alle aktiven "external"-Shops,
//      Status "Nachbestellen").
//   2. Nach Shop gruppieren, pro Shop dessen shops.config.js-Eintrag laden.
//   3. mode=http → httpScraper, mode=browser → browserScraper.
//   4. Ergebnisse je Shop per pushPrices zurückschieben (außer --dry-run).
//   5. Abschluss-Report + Exit-Code (≠0 bei login_failed/http_error).
//
// CLI-Flags: --dry-run  --debug  --headful  --shop "Name"  --ref "X"

import 'dotenv/config';
import { setLevel, isDebug, log } from './log.js';
import { getWorkList, pushPrices } from './appsScript.js';
import { getShopCredentials } from './credentials.js';
import { scrapeHttp } from './httpScraper.js';
import { scrapeBrowser } from './browserScraper.js';
import shopsConfig from '../shops.config.js';

const STATUS_KEYS = ['ok', 'not_found', 'pattern_miss', 'login_failed', 'http_error'];
const FAIL_STATUSES = new Set(['login_failed', 'http_error']); // treiben den Exit-Code

function parseArgs(argv) {
  const opts = { dryRun: false, debug: false, headful: false, shop: null, ref: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--debug') opts.debug = true;
    else if (a === '--headful') opts.headful = true;
    else if (a === '--shop') opts.shop = argv[++i];
    else if (a === '--ref') opts.ref = argv[++i];
  }
  return opts;
}

// Shop-Config case-insensitive nachschlagen.
function findShopConfig(shop) {
  if (shopsConfig[shop]) return shopsConfig[shop];
  const key = String(shop).toLowerCase();
  for (const name of Object.keys(shopsConfig)) {
    if (name.toLowerCase() === key) return shopsConfig[name];
  }
  return null;
}

function groupByShop(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.shop)) map.set(it.shop, []);
    map.get(it.shop).push(it);
  }
  return map;
}

function printReport(perShop) {
  const pad = (s, n) => String(s).padEnd(n);
  log.info('report', '──────── Zusammenfassung ────────');
  log.info('report', `${pad('Shop', 24)} ${STATUS_KEYS.map((k) => pad(k, 12)).join('')}`);
  const failures = [];
  for (const [shop, results] of perShop) {
    const counts = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
    for (const r of results) {
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.status !== 'ok') failures.push({ shop, ...r });
    }
    log.info('report', `${pad(shop, 24)} ${STATUS_KEYS.map((k) => pad(counts[k], 12)).join('')}`);
  }
  if (failures.length) {
    log.info('report', '──────── Fehlgeschlagene REFs ────────');
    for (const f of failures) {
      log.info('report', `  ${f.shop} / ${f.ref}: ${f.status}${f.error ? ' – ' + f.error : ''}`);
    }
    log.info('report', 'Debug-Artefakte (falls erzeugt): scraper/debug/');
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.debug || process.env.DEBUG === '1') setLevel('debug');
  log.info('main', `Start${opts.dryRun ? ' [DRY-RUN]' : ''}${isDebug() ? ' [DEBUG]' : ''}`
    + `${opts.shop ? ` shop="${opts.shop}"` : ''}${opts.ref ? ` ref="${opts.ref}"` : ''}`);

  let items = await getWorkList(opts.shop);
  if (opts.ref) items = items.filter((it) => it.ref === opts.ref);
  if (!items.length) {
    log.info('main', 'Keine Arbeitspakete – nichts zu tun.');
    return 0;
  }

  const perShop = new Map();
  let hadFailure = false;

  for (const [shop, workItems] of groupByShop(items)) {
    const config = findShopConfig(shop);
    if (!config) {
      log.error('main', `Kein Eintrag in shops.config.js für Shop "${shop}" – übersprungen.`);
      perShop.set(shop, workItems.map((it) => ({
        ref: it.ref, status: 'http_error', price: null, currency: 'EUR',
        availability: '', productUrl: '', error: 'Keine shops.config.js-Konfig',
      })));
      hadFailure = true;
      continue;
    }
    const creds = getShopCredentials(shop);
    if (!creds) {
      log.error('main', `Keine Credentials für Shop "${shop}" – übersprungen.`);
      perShop.set(shop, workItems.map((it) => ({
        ref: it.ref, status: 'login_failed', price: null, currency: 'EUR',
        availability: '', productUrl: '', error: 'Keine Credentials',
      })));
      hadFailure = true;
      continue;
    }

    log.info('main', `Shop "${shop}" (${config.mode}): ${workItems.length} REFs`);
    const scrape = config.mode === 'browser' ? scrapeBrowser : scrapeHttp;
    let results;
    try {
      results = await scrape(shop, config, creds, workItems, { debug: isDebug(), headful: opts.headful });
    } catch (err) {
      log.error('main', `Shop "${shop}" abgebrochen: ${err.message}`);
      results = workItems.map((it) => ({
        ref: it.ref, status: 'http_error', price: null, currency: 'EUR',
        availability: '', productUrl: '', error: err.message,
      }));
    }
    perShop.set(shop, results);

    if (results.some((r) => FAIL_STATUSES.has(r.status))) hadFailure = true;

    if (opts.dryRun) {
      log.info('main', `[DRY-RUN] ${shop}: ${results.filter((r) => r.status === 'ok').length}/${results.length} mit Preis – kein Push.`);
    } else {
      try {
        await pushPrices(shop, results);
      } catch (err) {
        log.error('main', `pushPrices für "${shop}" fehlgeschlagen: ${err.message}`);
        hadFailure = true;
      }
    }
  }

  printReport(perShop);
  return hadFailure ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log.error('main', `Abbruch: ${err.message}`);
    process.exit(2);
  });
