import { log } from './logger.js';

const WEBHOOK_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';
const WEBHOOK_SECRET = import.meta.env.VITE_WEBHOOK_SECRET || '';

// OCR-Bildgrösse: lange Kante max. 1568 px, JPEG q0.85. Bei Full-HD-Kamera
// ergibt die Scan-Zone ca. 1192×688 px und wird unverändert gesendet.
const MAX_EDGE     = 1568;
const JPEG_QUALITY = 0.85;

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
    // Nur verkleinern, wenn die lange Kante MAX_EDGE übersteigt – nie pauschal
    // halbieren: kleine Etikettenschrift braucht die Pixel (siehe ISSUE.md).
    const scale = Math.min(1, MAX_EDGE / Math.max(canvas.width, canvas.height));
    let source = canvas;
    if (scale < 1) {
      source = document.createElement('canvas');
      source.width  = Math.round(canvas.width  * scale);
      source.height = Math.round(canvas.height * scale);
      const ctx = source.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, source.width, source.height);
    }
    const offscreen = source;
    const base64 = source.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
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
      log.warn('ocr', `Kein REF gefunden – Gemini: "${result.raw ?? ''}"`);
      onResult('', 0);
    }
  } catch (err) {
    log.error('ocr', `Gemini-Aufruf fehlgeschlagen [${err.name}]`, err.message);
  } finally {
    busy = false;
  }
}

export function terminateOCR() {}
