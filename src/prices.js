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

export async function lookupProduct(ref, hersteller = '') {
  try {
    const data = await post({ action: 'lookupProduct', ref, hersteller });
    log.info('prices', `lookupProduct: ref="${ref}", hersteller="${hersteller}" → ${data.suggestion ? 'Vorschlag' : 'leer'}`);
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
    const suppliers = data.suppliers || [];
    const count = suppliers.length;
    const withPrice = suppliers.filter(s => typeof s.price === 'number').length;
    log.info('prices', `getProductSuppliers: id=${productId} → ${count} Lieferant${count !== 1 ? 'en' : ''}, ${withPrice} mit Preis`);
    return suppliers;
  } catch (err) {
    log.warn('prices', `getProductSuppliers fehlgeschlagen: id=${productId} – ${err.message}`);
    return [];
  }
}

export async function listSuppliers() {
  try {
    const data = await post({ action: 'listSuppliers' });
    const names = data.suppliers || [];
    log.info('prices', `listSuppliers: ${names.length} Lieferanten`);
    return names;
  } catch (err) {
    log.warn('prices', `listSuppliers fehlgeschlagen: ${err.message}`);
    return [];
  }
}

export async function listLocations() {
  try {
    const data = await post({ action: 'listLocations' });
    const locs = data.locations || [];
    log.info('prices', `listLocations: ${locs.length} Lagerorte`);
    return locs;
  } catch (err) {
    log.warn('prices', `listLocations fehlgeschlagen: ${err.message}`);
    return [];
  }
}

export async function listStatusValues() {
  try {
    const data = await post({ action: 'listStatusValues' });
    const values = data.values || [];
    log.info('prices', `listStatusValues: ${values.length} Werte`);
    return values;
  } catch (err) {
    log.warn('prices', `listStatusValues fehlgeschlagen: ${err.message}`);
    return [];
  }
}

export async function setOrderStatus(id, status) {
  try {
    const data = await post({ action: 'setStatus', id, status });
    log.info('prices', `setStatus: id=${id} status="${status}" → ${data.status}`);
    return data;
  } catch (err) {
    log.warn('prices', `setStatus fehlgeschlagen: id=${id} – ${err.message}`);
    return { status: 'error', message: err.message };
  }
}
