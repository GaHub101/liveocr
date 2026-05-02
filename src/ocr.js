import { log } from './logger.js';

const WEBHOOK_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';
const WEBHOOK_SECRET = import.meta.env.VITE_WEBHOOK_SECRET || '';

let busy = false;

export async function initOCR() {
  log.info('ocr', 'Gemini-Modus aktiv');
  if (!WEBHOOK_URL) {
    log.warn('ocr', 'VITE_APPS_SCRIPT_URL nicht gesetzt – kein Ping-Test');
    return;
  }
  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'ping', secret: WEBHOOK_SECRET }),
    });
    log.info('ocr', `Ping: HTTP ${resp.status} ${resp.statusText}`);
    const result = await resp.json();
    log.info('ocr', `Verbindungstest OK: status=${result.status}`);
  } catch (err) {
    log.error('ocr', `Verbindungstest fehlgeschlagen [${err.name}]`, err.message);
  }
}

export async function scheduleRecognition(canvas, onResult) {
  if (busy) {
    log.warn('ocr', 'Scan übersprungen – Anfrage bereits aktiv');
    return;
  }
  busy = true;

  try {
    if (!WEBHOOK_URL) {
      log.error('ocr', 'VITE_APPS_SCRIPT_URL nicht konfiguriert');
      return;
    }

    const t0 = performance.now();
    const scale = 0.5;
    const offscreen = document.createElement('canvas');
    offscreen.width  = Math.round(canvas.width  * scale);
    offscreen.height = Math.round(canvas.height * scale);
    offscreen.getContext('2d').drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
    const base64 = offscreen.toDataURL('image/jpeg', 0.7).split(',')[1];
    const encMs = Math.round(performance.now() - t0);
    log.info('ocr', `Bild kodiert: ${Math.round(base64.length / 1024)}KB, ${offscreen.width}×${offscreen.height}px (${encMs}ms)`);

    const fetchStart = performance.now();
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'ocr', image: base64, secret: WEBHOOK_SECRET }),
    });
    log.info('ocr', `HTTP ${resp.status} ${resp.statusText} (${Math.round(performance.now() - fetchStart)}ms)`);

    if (!resp.ok) {
      log.error('ocr', `HTTP-Fehler: ${resp.status} ${resp.statusText}`);
      return;
    }

    const result = await resp.json();

    if (result.status === 'ok' && result.ref) {
      log.info('ocr', `Erkannt via Gemini: ${result.ref}`);
      onResult(result.ref, 100);
    } else if (result.status === 'error') {
      log.error('ocr', `Gemini API Fehler: ${result.message}`, result.raw ?? '');
    } else {
      log.warn('ocr', `Kein REF gefunden – Gemini: "${result.raw ?? ''}" (status: ${result.status})`);
    }
  } catch (err) {
    log.error('ocr', `Gemini-Aufruf fehlgeschlagen [${err.name}]`, err.message);
  } finally {
    busy = false;
  }
}

export function terminateOCR() {}
