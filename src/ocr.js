import { log } from './logger.js';
import Tesseract from 'tesseract.js';

const THROTTLE_MS = 500;
const CONFIDENCE_THRESHOLD = 60;
const STABILITY_REQUIRED = 3;

let tesseractWorker = null;
let lastRunAt = 0;
let busy = false;

let lastNormalized = '';
let stableCount = 0;

// Strips OCR border artifacts (e.g. "[#er]", "(nF)") by keeping only
// alphanumeric runs of 3+ chars, sorted so order differences don't matter.
function normalize(text) {
  return (text.match(/[A-Z0-9]{3,}/gi) || []).sort().join(' ').toLowerCase();
}

export async function initOCR(onProgress) {
  tesseractWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath:   'https://tessdata.projectnaptha.com/4.0.0',
    logger: (m) => {
      if (m.status === 'loading tesseract core' || m.status === 'loading language traineddata') {
        onProgress?.(m.status, Math.round((m.progress || 0) * 100));
      }
    },
  });

  await tesseractWorker.setParameters({
    tessedit_ocr_engine_mode: 1,
    tessedit_pageseg_mode: 7,
    tessedit_char_whitelist: '',
  });

  log.info('ocr', 'Tesseract worker bereit');
}

export async function scheduleRecognition(canvas, onResult) {
  if (!tesseractWorker || busy) return;

  const now = Date.now();
  if (now - lastRunAt < THROTTLE_MS) return;
  lastRunAt = now;
  busy = true;

  try {
    const { data } = await tesseractWorker.recognize(canvas);
    const rawText = data.text.trim();

    if (data.confidence >= CONFIDENCE_THRESHOLD && rawText.length > 0) {
      const normalized = normalize(rawText);
      if (normalized && normalized === lastNormalized) {
        stableCount++;
      } else {
        lastNormalized = normalized;
        stableCount = 1;
      }

      if (stableCount >= STABILITY_REQUIRED) {
        log.info('ocr', `Erkannt (${Math.round(data.confidence)}%, ${stableCount}× stabil): ${rawText}`);
        onResult(rawText, data.confidence);
      } else {
        log.warn('ocr', `Warte auf Stabilität (${stableCount}/${STABILITY_REQUIRED}, ${Math.round(data.confidence)}%): ${rawText}`);
      }
    } else {
      lastNormalized = '';
      stableCount = 0;
      if (rawText.length > 0) {
        log.warn('ocr', `Konfidenz zu niedrig (${Math.round(data.confidence)}%): ${rawText}`);
      }
    }
  } catch (err) {
    log.error('ocr', 'Erkennungsfehler', err);
  } finally {
    busy = false;
  }
}

export async function terminateOCR() {
  await tesseractWorker?.terminate();
  tesseractWorker = null;
}
