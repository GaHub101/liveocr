import { log } from './logger.js';

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL;
const SECRET          = import.meta.env.VITE_WEBHOOK_SECRET;

export async function checkAvailability(ref) {
  try {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'checkAvailability', ref, secret: SECRET }),
    });
    const data = await resp.json();
    if (data.status === 'ok') return { results: data.results || [] };
    log.warn('prices', 'checkAvailability error: ' + data.message);
    return { results: [] };
  } catch (err) {
    log.warn('prices', 'checkAvailability fetch error: ' + err.message);
    return { results: [] };
  }
}
