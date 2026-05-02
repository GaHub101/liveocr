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
    return await post({ action: 'checkRef', ref });
  } catch (err) {
    log.warn('prices', 'checkRef: ' + err.message);
    return { status: 'error' };
  }
}

export async function lookupProduct(ref) {
  try {
    const data = await post({ action: 'lookupProduct', ref });
    return data.suggestion || {};
  } catch (err) {
    log.warn('prices', 'lookupProduct: ' + err.message);
    return {};
  }
}

export async function addProduct(payload) {
  const data = await post({ action: 'addProduct', ...payload });
  if (data.status !== 'ok') throw new Error(data.message || 'Unbekannter Fehler');
  return data;
}

export async function getProductSuppliers(productId) {
  try {
    const data = await post({ action: 'getProductSuppliers', id: productId });
    return data.suppliers || [];
  } catch (err) {
    log.warn('prices', 'getProductSuppliers: ' + err.message);
    return [];
  }
}
