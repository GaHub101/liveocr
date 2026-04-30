import { log } from './logger.js';

const THROTTLE_MS = 3000;
const WEBHOOK_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

let lastRunAt = 0;
let busy = false;

export function initOCR() {
  log.info('ocr', 'Gemini-Modus aktiv');
  return Promise.resolve();
}

export async function scheduleRecognition(canvas, onResult) {
  if (busy) return;
  const now = Date.now();
  if (now - lastRunAt < THROTTLE_MS) return;
  lastRunAt = now;
  busy = true;

  try {
    if (!WEBHOOK_URL) {
      log.error('ocr', 'VITE_APPS_SCRIPT_URL nicht konfiguriert');
      return;
    }

    const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'ocr', image: base64 }),
    });

    const result = await resp.json();

    if (result.status === 'ok' && result.ref) {
      log.info('ocr', `Erkannt via Gemini: ${result.ref}`);
      onResult(result.ref, 100);
    } else {
      log.warn('ocr', `Kein REF gefunden (status: ${result.status})`);
    }
  } catch (err) {
    log.error('ocr', 'Gemini-Aufruf fehlgeschlagen', err.message);
  } finally {
    busy = false;
  }
}

export function terminateOCR() {}
