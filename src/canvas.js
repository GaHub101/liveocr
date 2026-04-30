import { log } from './logger.js';

let zoneSizeLogged = false;

const ZONE_W_RATIO = 0.8;
const ZONE_H_RATIO = 0.3;
const OCR_SCALE    = 3;    // upscale crop to ~225 DPI for Tesseract LSTM
const OCR_PAD      = 20;   // white padding around scaled image (px)
const TILE_SIZE    = 128;  // adaptive Otsu tile size on scaled image

export function preprocessFrame(video, canvas) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;

  // The #video element uses object-fit: cover with aspect-ratio: 4/3.
  // Only the visible (displayed) portion of the raw video matters for the crop.
  const displayAspect = 4 / 3;
  const videoAspect = vw / vh;

  let srcX, srcY, srcW, srcH;
  if (videoAspect < displayAspect) {
    // Portrait/square video in landscape box → top/bottom cropped
    srcW = vw;
    srcH = vw / displayAspect;
    srcX = 0;
    srcY = (vh - srcH) / 2;
  } else {
    // Landscape video in portrait box → left/right cropped
    srcH = vh;
    srcW = vh * displayAspect;
    srcX = (vw - srcW) / 2;
    srcY = 0;
  }

  // Crop to scan zone (80% × 30%, centred within the displayed region)
  const zoneW = Math.round(srcW * ZONE_W_RATIO);
  const zoneH = Math.round(srcH * ZONE_H_RATIO);
  const zoneX = Math.round(srcX + (srcW - zoneW) / 2);
  const zoneY = Math.round(srcY + (srcH - zoneH) / 2);

  if (!zoneSizeLogged) {
    const outW = zoneW * OCR_SCALE + OCR_PAD * 2;
    const outH = zoneH * OCR_SCALE + OCR_PAD * 2;
    log.info('canvas', `Scan-Zone: ${zoneW}×${zoneH}px → OCR-Input: ${outW}×${outH}px (${OCR_SCALE}x + ${OCR_PAD}px pad, angezeigt: ${Math.round(srcW)}×${Math.round(srcH)}px, Vollbild: ${vw}×${vh}px)`);
    zoneSizeLogged = true;
  }

  // Step 1: draw raw crop onto off-screen canvas A (native size)
  const canvasA = document.createElement('canvas');
  canvasA.width  = zoneW;
  canvasA.height = zoneH;
  canvasA.getContext('2d').drawImage(video, zoneX, zoneY, zoneW, zoneH, 0, 0, zoneW, zoneH);

  // Step 2: scale up onto off-screen canvas B (3x, bilinear via browser)
  const scaledW = zoneW * OCR_SCALE;
  const scaledH = zoneH * OCR_SCALE;
  const canvasB = document.createElement('canvas');
  canvasB.width  = scaledW;
  canvasB.height = scaledH;
  canvasB.getContext('2d').drawImage(canvasA, 0, 0, scaledW, scaledH);

  // Step 3: add white padding onto output canvas
  const outW = scaledW + OCR_PAD * 2;
  const outH = scaledH + OCR_PAD * 2;
  canvas.width  = outW;
  canvas.height = outH;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, outW, outH);
  c.drawImage(canvasB, OCR_PAD, OCR_PAD);

  // Step 4: pixel processing on the padded, scaled image
  const imageData = c.getImageData(0, 0, outW, outH);
  const data = imageData.data;

  // 4a. Grayscale (luminance formula)
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = lum;
  }

  // 4b. Contrast stretch [P5, P95] → [0, 255]
  const total = outW * outH;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) hist[data[i]]++;

  let cumul = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    cumul += hist[v];
    if (cumul / total < 0.05) lo = v;
    if (cumul / total < 0.95) hi = v;
  }
  if (lo >= hi) return true;

  const range = hi - lo;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.max(0, Math.min(255, Math.round(((data[i] - lo) / range) * 255)));
    data[i] = data[i + 1] = data[i + 2] = v;
  }

  // No binarization — feed grayscale to Tesseract LSTM (better than noisy binary)
  c.putImageData(imageData, 0, 0);
  return true;
}
