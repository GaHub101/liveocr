import { log } from './logger.js';

const THROTTLE_MS = 3000;
const WEBHOOK_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

const GEMINI_PROMPT =
  'You are reading a dental or medical product label. Find the REF number (product reference/article number). ' +
  'The REF number appears next to or below the text "REF" — often printed inside a small bordered box or next to a symbol. ' +
  'The code consists of digits, letters, hyphens or slashes (examples: "630-0032", "012345A", "4352/B"). ' +
  'Return ONLY the code itself — no extra words, no explanation. ' +
  'If the REF code is partially unclear, give your best reading. ' +
  'If there is truly no REF code visible, return exactly: NONE';

let lastRunAt = 0;
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
  const now = Date.now();
  if (now - lastRunAt < THROTTLE_MS) return;
  lastRunAt = now;
  busy = true;

  try {
    if (!WEBHOOK_URL) {
      log.error('ocr', 'VITE_APPS_SCRIPT_URL nicht konfiguriert');
      return;
    }

    const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    log.info('ocr', `Bild: ${Math.round(base64.length / 1024)}KB base64, ${canvas.width}×${canvas.height}px`);

    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'ocr', image: base64, prompt: GEMINI_PROMPT }),
    });

    const result = await resp.json();

    if (result.status === 'ok' && result.ref) {
      log.info('ocr', `Erkannt via Gemini: ${result.ref}`);
      onResult(result.ref, 100);
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
