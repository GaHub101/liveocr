import { log } from './logger.js';
import Tesseract from 'tesseract.js';

const THROTTLE_MS = 500;
const CONFIDENCE_THRESHOLD = 80;

let tesseractWorker = null;
let lastRunAt = 0;
let busy = false;

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

    // R\s*E\s*F handles OCR artifacts from the bordered "REF" label (e.g. "R E F", "[REF]")
    const refMatch = rawText.match(/R\s*E\s*F[^A-Z0-9]*([A-Z0-9][\d\s\-\/A-Z]{2,})/i);
    if (refMatch) {
      const text = refMatch[1].trim().replace(/\s+/g, ' ');
      if (data.confidence >= CONFIDENCE_THRESHOLD) {
        log.info('ocr', `Erkannt via REF-Match (${Math.round(data.confidence)}%): ${text}`);
        onResult(text, data.confidence);
      } else {
        log.warn('ocr', `REF gefunden, Konfidenz zu niedrig (${Math.round(data.confidence)}%): ${text}`);
      }
      return;
    }

    if (data.confidence >= CONFIDENCE_THRESHOLD && rawText.length > 0) {
      log.info('ocr', `Erkannt (${Math.round(data.confidence)}%): ${rawText}`);
      onResult(rawText, data.confidence);
    } else if (rawText.length > 0) {
      log.warn('ocr', `Konfidenz zu niedrig (${Math.round(data.confidence)}%): ${rawText}`);
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
