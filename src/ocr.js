import { log } from './logger.js';

const WEBHOOK_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

let busy = false;

export async function initOCR() {
  log.info('ocr', 'Gemini-Modus aktiv');
  if (!WEBHOOK_URL) return;
  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'ping' }),
    });
    const result = await resp.json();
    log.info('ocr', `Verbindungstest OK: status=${result.status}`);
  } catch (err) {
    log.error('ocr', `Verbindungstest fehlgeschlagen [${err.name}]`, err.message);
  }
}

export async function scheduleRecognition(canvas, onResult) {
  if (busy) return;
  busy = true;

  try {
    if (!WEBHOOK_URL) {
      log.error('ocr', 'VITE_APPS_SCRIPT_URL nicht konfiguriert');
      return;
    }

    const scale = 0.5;
    const offscreen = document.createElement('canvas');
    offscreen.width  = Math.round(canvas.width  * scale);
    offscreen.height = Math.round(canvas.height * scale);
    offscreen.getContext('2d').drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
    const base64 = offscreen.toDataURL('image/jpeg', 0.7).split(',')[1];
    log.info('ocr', `Bild: ${Math.round(base64.length / 1024)}KB base64, ${offscreen.width}×${offscreen.height}px`);

    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'ocr', image: base64 }),
    });

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
