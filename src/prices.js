import { log } from './logger.js';

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL;
const SECRET          = import.meta.env.VITE_WEBHOOK_SECRET;

export async function getProductSuppliers(productId) {
  try {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'getProductSuppliers', id: productId, secret: SECRET }),
    });
    const data = await resp.json();
    if (data.status === 'ok') return data.suppliers || [];
    log.warn('prices', 'getProductSuppliers: ' + data.message);
    return [];
  } catch (err) {
    log.warn('prices', 'getProductSuppliers fetch error: ' + err.message);
    return [];
  }
}
