// Kommunikation mit dem Apps-Script-Webhook.
//
// Beide Actions (getWorkList, pushPrices) werden serverseitig gegen
// SCRAPER_PUSH_SECRET geprüft – NICHT gegen das client-sichtbare WEBHOOK_SECRET.
//
// POST-Form wie im Client (src/send.js): Body = JSON.stringify({...payload,
// secret}). In Node gibt es kein CORS-Preflight-Thema, daher unkritisch.

import { log } from './log.js';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} nicht gesetzt (siehe .env.example)`);
  return v;
}

async function post(payload) {
  const url = requireEnv('APPS_SCRIPT_URL');
  const secret = requireEnv('SCRAPER_PUSH_SECRET');
  const resp = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ ...payload, secret }),
  });
  log.debug('appsScript', `${payload.action} → HTTP ${resp.status}`);
  if (!resp.ok) throw new Error(`Apps Script HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status === 'error') {
    throw new Error(`Apps Script Fehler: ${data.message || 'unbekannt'}`);
  }
  return data;
}

// Holt die Arbeitsliste. shop (optional) beschränkt auf einen Shop.
// → [{ shop, ref, searchTemplate, stand }]
export async function getWorkList(shop) {
  const payload = { action: 'getWorkList' };
  if (shop) payload.shop = shop;
  const data = await post(payload);
  const items = Array.isArray(data.items) ? data.items : [];
  log.info('appsScript', `getWorkList: ${items.length} Arbeitspakete`);
  return items;
}

// Schiebt Ergebnisse eines Shops zurück. results: [{ ref, status, price,
// currency, availability, productUrl, error }]. → Anzahl geschriebener Zeilen.
export async function pushPrices(shop, results) {
  const data = await post({ action: 'pushPrices', shop, results });
  const written = Number(data.written || 0);
  log.info('appsScript', `pushPrices shop="${shop}": ${results.length} gesendet, ${written} geschrieben`);
  return written;
}
