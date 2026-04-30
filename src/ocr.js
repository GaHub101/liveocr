import { log } from './logger.js';

const THROTTLE_MS = 500;
const CONFIDENCE_THRESHOLD = 60;

let ocrWorker = null;
let lastRunAt = 0;
let busy = false;
let pendingResultHandler = null;
let initResolved = false;

export function initOCR(onProgress) {
  return new Promise((resolve, reject) => {
    ocrWorker = new Worker(new URL('./ocr-worker.js', import.meta.url), { type: 'module' });

    ocrWorker.onmessage = (e) => {
      const { type } = e.data;

      if (type === 'progress') {
        onProgress?.(e.data.status, e.data.progress);
        return;
      }
      if (type === 'ready') {
        initResolved = true;
        log.info('ocr', 'Tesseract worker bereit');
        resolve(ocrWorker);
        return;
      }
      if (type === 'error') {
        busy = false;
        pendingResultHandler = null;
        log.error('ocr', e.data.message);
        if (!initResolved) reject(new Error(e.data.message));
        return;
      }
      if (type === 'result') {
        busy = false;
        if (pendingResultHandler) {
          const { text, confidence } = e.data;
          if (confidence >= CONFIDENCE_THRESHOLD && text.length > 0) {
            log.info('ocr', `Erkannt (${Math.round(confidence)}%): ${text}`);
            pendingResultHandler(text, confidence);
          } else if (text.length > 0) {
            log.warn('ocr', `Konfidenz zu niedrig (${Math.round(confidence)}%): ${text}`);
          }
          pendingResultHandler = null;
        }
      }
    };

    ocrWorker.postMessage({ type: 'init' });
  });
}

export function scheduleRecognition(canvas, onResult) {
  if (!ocrWorker || busy) return;

  const now = Date.now();
  if (now - lastRunAt < THROTTLE_MS) return;
  lastRunAt = now;
  busy = true;

  pendingResultHandler = onResult;

  canvas.toBlob((blob) => {
    if (!blob) { busy = false; return; }
    ocrWorker.postMessage({ type: 'recognize', blob });
  }, 'image/png');
}

export function terminateOCR() {
  ocrWorker?.postMessage({ type: 'terminate' });
  ocrWorker = null;
}
