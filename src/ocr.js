const THROTTLE_MS = 500;
const CONFIDENCE_THRESHOLD = 60;

let ocrWorker = null;
let lastRunAt = 0;
let busy = false;
let pendingResultHandler = null;

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
        resolve(ocrWorker);
        return;
      }
      if (type === 'error') {
        reject(new Error(e.data.message));
        return;
      }
      if (type === 'result') {
        busy = false;
        if (pendingResultHandler) {
          const { text, confidence } = e.data;
          if (confidence >= CONFIDENCE_THRESHOLD && text.length > 0) {
            pendingResultHandler(text, confidence);
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
