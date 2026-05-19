import { log } from './logger.js';
import { sharpnessScore } from './canvas.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Aus mehreren Frames den schärfsten wählen. Gegen Sofort-Abgriff
// während der Autofokus noch „pumpt" – ohne Fokus-applyConstraints
// (CLAUDE.md / Commit 7b2dfc9). Liefert ein ImageBitmap oder null
// (dann soll der Aufrufer den Video-Frame direkt nehmen).
export async function captureSharpest({ video, imageCapture }, n = 6, spanMs = 700) {
  const step = Math.max(60, Math.round(spanMs / n));
  let best = null;
  let bestScore = -1;
  let bestKind = '';

  const consider = (bitmap, kind) => {
    if (!bitmap) return;
    const score = sharpnessScore(bitmap, bitmap.width, bitmap.height);
    if (score > bestScore) {
      if (best) best.close();
      best = bitmap;
      bestScore = score;
      bestKind = kind;
    } else {
      bitmap.close();
    }
  };

  for (let i = 0; i < n; i++) {
    try {
      let bmp = null;
      if (imageCapture && typeof imageCapture.grabFrame === 'function') {
        bmp = await imageCapture.grabFrame();
      } else if (video.videoWidth) {
        bmp = await createImageBitmap(video);
      }
      consider(bmp, 'frame');
    } catch (err) {
      log.warn('camera', `Frame-Capture übersprungen [${err.name}]`);
    }
    if (i < n - 1) await sleep(step);
  }

  // Ein takePhoto()-Kandidat (auf manchen Geräten schärfer)
  if (imageCapture && typeof imageCapture.takePhoto === 'function') {
    try {
      const blob = await imageCapture.takePhoto();
      consider(await createImageBitmap(blob), 'photo');
    } catch (err) {
      log.warn('camera', `takePhoto übersprungen [${err.name}]`);
    }
  }

  if (best) {
    log.info('camera', `Schärfster Frame: Quelle=${bestKind}, Score=${Math.round(bestScore)}`);
  }
  return best;
}

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  const track = stream.getVideoTracks()[0];
  let imageCapture = null;
  if (track) {
    const s = track.getSettings?.() ?? {};
    log.info('camera', `Stream: ${s.width ?? '?'}×${s.height ?? '?'}px, facing=${s.facingMode ?? '?'}, label="${track.label}"`);

    // Tap-to-focus: single-shot applyConstraints on user tap
    videoEl.addEventListener('click', () => {
      const caps = track.getCapabilities?.();
      if (caps?.focusMode?.includes('single-shot')) {
        log.info('camera', 'Tap-to-focus ausgelöst');
        track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }).catch(() => {});
      }
    });

    // Foto-Pipeline: takePhoto() löst einen vollständigen AF-Zyklus aus
    // → scharfes Standbild auch bei Nahaufnahme (Video-Frame ist es nicht).
    if ('ImageCapture' in window) {
      try {
        imageCapture = new ImageCapture(track);
        log.info('camera', 'Foto-Modus aktiv (ImageCapture.takePhoto)');
      } catch (err) {
        imageCapture = null;
        log.warn('camera', `ImageCapture nicht nutzbar [${err.name}] – Video-Frame Fallback`);
      }
    } else {
      log.warn('camera', 'ImageCapture nicht unterstützt – Video-Frame Fallback');
    }
  }

  return { stream, track, imageCapture };
}

export function stopCamera(stream) {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
}
