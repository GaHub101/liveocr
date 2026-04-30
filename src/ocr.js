import { log } from './logger.js';
import Tesseract from 'tesseract.js';

const THROTTLE_MS = 500;
const CONFIDENCE_THRESHOLD = 60;

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
    tessedit_pageseg_mode: 11,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/',
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
    const text = data.text.trim();

    if (data.confidence >= CONFIDENCE_THRESHOLD && text.length > 0) {
      log.info('ocr', `Erkannt (${Math.round(data.confidence)}%): ${text}`);
      onResult(text, data.confidence);
      return;
    }

    // Fall back to high-confidence individual words (handles blurry images where
    // surrounding noise drags down overall confidence but the target word is clear)
    const goodWords = (data.words ?? []).filter(
      w => w.confidence >= CONFIDENCE_THRESHOLD && w.text.trim().length >= 2,
    );
    if (goodWords.length > 0) {
      const bestText = goodWords.map(w => w.text.trim()).join(' ');
      const bestConf = Math.max(...goodWords.map(w => w.confidence));
      log.info('ocr', `Erkannt via Wortfilter (${Math.round(bestConf)}%): ${bestText}`);
      onResult(bestText, bestConf);
    } else if (text.length > 0) {
      log.warn('ocr', `Konfidenz zu niedrig (${Math.round(data.confidence)}%): ${text}`);
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
