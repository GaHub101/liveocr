import Tesseract from 'tesseract.js';

let worker = null;

async function init(onProgress) {
  worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'loading tesseract core' || m.status === 'loading language traineddata') {
        onProgress(m.status, Math.round((m.progress || 0) * 100));
      }
    },
  });

  await worker.setParameters({
    // OEM 1: LSTM only – schneller und genauer für gedruckten Text
    // PSM 11: sparse text – gut für Etiketten mit gemischtem Inhalt
    tessedit_ocr_engine_mode: 1,
    tessedit_pageseg_mode: 11,
    // Whitelist: Zeichen, die in Herstellerreferenzen vorkommen
    // Anpassen falls Punkt oder Plus gebraucht wird: 'ABCDE...9-/.'
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/',
  });
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'init') {
    try {
      await init((status, progress) => {
        self.postMessage({ type: 'progress', status, progress });
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (type === 'recognize') {
    try {
      const { data } = await worker.recognize(e.data.blob);
      self.postMessage({
        type: 'result',
        text: data.text.trim(),
        confidence: data.confidence,
      });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (type === 'terminate') {
    await worker?.terminate();
    self.close();
  }
};
