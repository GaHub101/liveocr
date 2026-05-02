import { log } from './logger.js';

const QUEUE_KEY = 'ocr_send_queue';

// URL wird zur Build-Zeit von Vite injiziert (aus .env.local / GitHub Secret)
// Fallback: leerer String – App zeigt Fehlermeldung
const WEBHOOK_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';
const WEBHOOK_SECRET = import.meta.env.VITE_WEBHOOK_SECRET || '';

export function getQueueLength() {
  return loadQueue().length;
}

// payload: { ref, confidence, timestamp, id? }
// id is optional – only present in write mode (opened from AppSheet with ?id=)
export async function sendOrQueue(payload, onQueueChange) {
  if (!WEBHOOK_URL) {
    log.error('send', 'VITE_APPS_SCRIPT_URL nicht konfiguriert');
    throw new Error('VITE_APPS_SCRIPT_URL nicht konfiguriert. Siehe README.');
  }

  if (navigator.onLine) {
    await flushQueue(onQueueChange);
    const result = await postToSheet(payload);
    log.info('send', `Gesendet: ref="${payload.ref}"${payload.id ? ` id=${payload.id}` : ''}`, result);
  } else {
    enqueue(payload);
    log.warn('send', `Offline – in Queue gespeichert: ref="${payload.ref}"`, `Queue: ${getQueueLength()}`);
    onQueueChange?.(getQueueLength());
  }
}

export async function flushQueue(onQueueChange) {
  const queue = loadQueue();
  if (queue.length === 0) return;

  log.info('send', `Queue leeren: ${queue.length} Einträge`);
  const failed = [];
  for (const item of queue) {
    try {
      await postToSheet(item);
      log.info('send', `Queue-Eintrag gesendet: ref="${item.ref}"${item.id ? ` id=${item.id}` : ''}`);
    } catch (err) {
      log.error('send', `Queue-Eintrag fehlgeschlagen: ref="${item.ref}"`, err);
      failed.push(item);
    }
  }

  if (failed.length > 0) {
    saveQueue(failed);
    log.warn('send', `${failed.length} Queue-Einträge weiterhin fehlgeschlagen`);
  } else {
    localStorage.removeItem(QUEUE_KEY);
    log.info('send', 'Queue vollständig geleert');
  }
  onQueueChange?.(failed.length);
}

async function postToSheet(payload) {
  // Kein Content-Type: application/json Header → "simple request" → kein CORS-Preflight
  // Apps Script empfängt Body als text/plain und parst ihn mit JSON.parse(e.postData.contents)
  const resp = await fetch(WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify({ ...payload, secret: WEBHOOK_SECRET }),
  });

  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    log.error('send', `POST fehlgeschlagen: ${resp.status} ${resp.statusText}`);
    throw err;
  }

  // Schlägt die JSON-Auswertung fehl, ignorieren – der POST wurde trotzdem gesendet
  try {
    const result = await resp.json();
    if (result.status === 'error') {
      log.error('send', `Apps Script Fehler: ${result.message}`);
    }
    return result;
  } catch {
    return { status: 'ok' };
  }
}

function enqueue(payload) {
  const queue = loadQueue();
  queue.push({ ...payload, queuedAt: new Date().toISOString() });
  saveQueue(queue);
}

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}
