const QUEUE_KEY = 'ocr_send_queue';

// URL wird zur Build-Zeit von Vite injiziert (aus .env.local / GitHub Secret)
// Fallback: leerer String – App zeigt Fehlermeldung
const WEBHOOK_URL = import.meta.env.VITE_APPS_SCRIPT_URL || '';

export function getQueueLength() {
  return loadQueue().length;
}

// payload: { ref, confidence, timestamp, id? }
// id is optional – only present in write mode (opened from AppSheet with ?id=)
export async function sendOrQueue(payload, onQueueChange) {
  if (!WEBHOOK_URL) {
    throw new Error('VITE_APPS_SCRIPT_URL nicht konfiguriert. Siehe README.');
  }

  if (navigator.onLine) {
    await flushQueue(onQueueChange);
    await postToSheet(payload);
  } else {
    enqueue(payload);
    onQueueChange?.(getQueueLength());
  }
}

export async function flushQueue(onQueueChange) {
  const queue = loadQueue();
  if (queue.length === 0) return;

  const failed = [];
  for (const item of queue) {
    try {
      await postToSheet(item);
    } catch {
      failed.push(item);
    }
  }

  if (failed.length > 0) {
    saveQueue(failed);
  } else {
    localStorage.removeItem(QUEUE_KEY);
  }
  onQueueChange?.(failed.length);
}

async function postToSheet(payload) {
  // Kein Content-Type: application/json Header → "simple request" → kein CORS-Preflight
  // Apps Script empfängt Body als text/plain und parst ihn mit JSON.parse(e.postData.contents)
  const resp = await fetch(WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  // Antwort lesen (funktioniert nur wenn CORS korrekt konfiguriert)
  // Schlägt die JSON-Auswertung fehl, ignorieren – der POST wurde trotzdem gesendet
  try {
    return await resp.json();
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
