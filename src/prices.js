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

// Alle Dropdown-Daten in einem Request; null bei Fehler (Aufrufer nutzt Fallback)
export async function bootstrap() {
  try {
    const data = await post({ action: 'bootstrap' });
    if (data.status !== 'ok') return null;
    log.info('prices', `bootstrap: ${data.suppliers?.length ?? 0} Lieferanten, ${data.locations?.length ?? 0} Lagerorte, ${data.statusValues?.length ?? 0} Statuswerte, ${data.hersteller?.length ?? 0} Hersteller, ${data.categories?.length ?? 0} Kategorien, ${data.refMap?.length ?? 0} REF-Einträge`);
    return {
      suppliers:    data.suppliers    || [],
      locations:    data.locations    || [],
      statusValues: data.statusValues || [],
      hersteller:   data.hersteller   || [],
      categories:   data.categories   || [],
      refMap:       data.refMap       || [],
    };
  } catch (err) {
    log.warn('prices', `bootstrap fehlgeschlagen: ${err.message}`);
    return null;
  }
}

export async function addProduct(payload) {
  log.info('prices', `addProduct: ref="${payload.ref}", name="${payload.name ?? '–'}"`);
  const data = await post({ action: 'addProduct', ...payload });
  if (data.status !== 'ok') throw new Error(data.message || 'Unbekannter Fehler');
  log.info('prices', `addProduct: Produkt angelegt – ref="${payload.ref}"`);
  return data;
}

export async function updateProduct(payload) {
  log.info('prices', `updateProduct: id=${payload.id}, ref="${payload.ref}", name="${payload.name ?? '–'}"`);
  const data = await post({ action: 'updateProduct', ...payload });
  if (data.status !== 'ok') throw new Error(data.message || 'Unbekannter Fehler');
  log.info('prices', `updateProduct: Produkt aktualisiert – id=${payload.id}`);
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

export async function listCategories() {
  try {
    const data = await post({ action: 'listCategories' });
    const cats = data.categories || [];
    log.info('prices', `listCategories: ${cats.length} Kategorien`);
    return cats;
  } catch (err) {
    log.warn('prices', `listCategories fehlgeschlagen: ${err.message}`);
    return [];
  }
}

// Neuen Wert in Kategorie-/Lagerort-/Lieferanten-Sheet anlegen ("+ Neu…" in den
// jeweiligen Dropdowns). type: 'category' | 'location' | 'supplier'
async function addListValue(type, value) {
  try {
    const data = await post({ action: 'addListValue', type, value });
    log.info('prices', `addListValue: type=${type} value="${value}" → status=${data.status}`);
    return data;
  } catch (err) {
    log.warn('prices', `addListValue fehlgeschlagen: type=${type} value="${value}" – ${err.message}`);
    return { status: 'error', message: err.message };
  }
}

export const addCategory = (value) => addListValue('category', value);
export const addLocation = (value) => addListValue('location', value);
export const addSupplier = (value) => addListValue('supplier', value);

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
