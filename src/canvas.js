import { log } from './logger.js';

let zoneSizeLogged = false;

const ZONE_W_RATIO = 0.80;
const ZONE_H_RATIO = 0.60;
const OCR_PAD      = 20;

export function preprocessFrame(video, canvas) {
  return cropToCanvas(video, video.videoWidth, video.videoHeight, canvas);
}

export function preprocessBitmap(bitmap, canvas) {
  return cropToCanvas(bitmap, bitmap.width, bitmap.height, canvas);
}

// Schärfe-Schätzung: Quelle klein/grau zeichnen, Gradient-Energie
// (Tenengrad-Variante) aufsummieren. Höher = schärfer.
const _sharpCanvas = document.createElement('canvas');

export function sharpnessScore(source, w, h) {
  if (!w || !h) return 0;
  const sw = 160;
  const sh = Math.max(1, Math.round((h / w) * sw));
  _sharpCanvas.width  = sw;
  _sharpCanvas.height = sh;
  const ctx = _sharpCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, sw, sh);
  const px = ctx.getImageData(0, 0, sw, sh).data;

  const gray = new Float64Array(sw * sh);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }

  let sum = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const idx = y * sw + x;
      const gx = gray[idx + 1] - gray[idx - 1];
      const gy = gray[idx + sw] - gray[idx - sw];
      sum += gx * gx + gy * gy;
    }
  }
  return sum / ((sw - 2) * (sh - 2));
}

function cropToCanvas(source, vw, vh, canvas) {
  if (!vw || !vh) return false;

  // The #video element uses object-fit: cover with aspect-ratio: 4/3.
  // Only the visible (displayed) portion of the raw video matters for the crop.
  const displayAspect = 4 / 3;
  const videoAspect = vw / vh;

  let srcX, srcY, srcW, srcH;
  if (videoAspect < displayAspect) {
    srcW = vw;
    srcH = vw / displayAspect;
    srcX = 0;
    srcY = (vh - srcH) / 2;
  } else {
    srcH = vh;
    srcW = vh * displayAspect;
    srcX = (vw - srcW) / 2;
    srcY = 0;
  }

  // Crop to scan zone (80% × 60%, centred within the displayed region)
  const zoneW = Math.round(srcW * ZONE_W_RATIO);
  const zoneH = Math.round(srcH * ZONE_H_RATIO);
  const zoneX = Math.round(srcX + (srcW - zoneW) / 2);
  const zoneY = Math.round(srcY + (srcH - zoneH) / 2);

  if (!zoneSizeLogged) {
    const outW = zoneW + OCR_PAD * 2;
    const outH = zoneH + OCR_PAD * 2;
    log.info('canvas', `Scan-Zone: ${zoneW}×${zoneH}px → OCR-Input: ${outW}×${outH}px (Farbe, ${OCR_PAD}px pad, angezeigt: ${Math.round(srcW)}×${Math.round(srcH)}px, Vollbild: ${vw}×${vh}px)`);
    zoneSizeLogged = true;
  }

  // Draw cropped zone with white padding — send colour image directly to Gemini
  const outW = zoneW + OCR_PAD * 2;
  const outH = zoneH + OCR_PAD * 2;
  canvas.width  = outW;
  canvas.height = outH;
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, outW, outH);
  c.drawImage(source, zoneX, zoneY, zoneW, zoneH, OCR_PAD, OCR_PAD, zoneW, zoneH);

  return true;
}
