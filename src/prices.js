import { log } from './logger.js';

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL;
const SECRET          = import.meta.env.VITE_WEBHOOK_SECRET;

async function post(body) {
  const resp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ ...body, secret: SECRET }),
  });
  return resp.json();
}

export async function checkRef(ref) {
  try {
    const data = await post({ action: 'checkRef', ref });
    log.info('prices', `checkRef: ref="${ref}" → status=${data.status}`);
    return data;
  } catch (err) {
    log.warn('prices', `checkRef fehlgeschlagen: ref="${ref}" – ${err.message}`);
    return { status: 'error' };
  }
}

export async function markReorder(id) {
  try {
    const data = await post({ action: 'markReorder', id });
    log.info('prices', `markReorder: id=${id} → status=${data.status}`);
    return data;
  } catch (err) {
    log.warn('prices', `markReorder fehlgeschlagen: id=${id} – ${err.message}`);
    return { status: 'error', message: err.message };
  }
}

export async function lookupProduct(ref) {
  try {
    const data = await post({ action: 'lookupProduct', ref });
    log.info('prices', `lookupProduct: ref="${ref}" → ${data.suggestion ? 'Vorschlag gefunden' : 'kein Vorschlag'}`);
    return data.suggestion || {};
  } catch (err) {
    log.warn('prices', `lookupProduct fehlgeschlagen: ref="${ref}" – ${err.message}`);
    return {};
  }
}

export async function addProduct(payload) {
  log.info('prices', `addProduct: ref="${payload.ref}", name="${payload.name ?? '–'}"`);
  const data = await post({ action: 'addProduct', ...payload });
  if (data.status !== 'ok') throw new Error(data.message || 'Unbekannter Fehler');
  log.info('prices', `addProduct: Produkt angelegt – ref="${payload.ref}"`);
  return data;
}

export async function getProductSuppliers(productId) {
  try {
    const data = await post({ action: 'getProductSuppliers', id: productId });
    const count = data.suppliers?.length ?? 0;
    log.info('prices', `getProductSuppliers: id=${productId} → ${count} Lieferant${count !== 1 ? 'en' : ''}`);
    return data.suppliers || [];
  } catch (err) {
    log.warn('prices', `getProductSuppliers fehlgeschlagen: id=${productId} – ${err.message}`);
    return [];
  }
}
