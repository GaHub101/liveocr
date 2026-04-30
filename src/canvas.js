import { log } from './logger.js';

let ctx = null;
let zoneSizeLogged = false;

function getCtx(canvas) {
  if (!ctx) ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx;
}

// Matches the CSS scan-frame dimensions (80% × 30%, centred)
const ZONE_W_RATIO = 0.8;
const ZONE_H_RATIO = 0.3;

export function preprocessFrame(video, canvas) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return false;

  // Crop to scan zone only – reduces noise and speeds up OCR
  const zoneW = Math.round(w * ZONE_W_RATIO);
  const zoneH = Math.round(h * ZONE_H_RATIO);
  const zoneX = Math.round((w - zoneW) / 2);
  const zoneY = Math.round((h - zoneH) / 2);

  canvas.width  = zoneW;
  canvas.height = zoneH;

  if (!zoneSizeLogged) {
    log.info('canvas', `Scan-Zone: ${zoneW}×${zoneH}px (Vollbild: ${w}×${h}px)`);
    zoneSizeLogged = true;
  }

  const c = getCtx(canvas);
  c.drawImage(video, zoneX, zoneY, zoneW, zoneH, 0, 0, zoneW, zoneH);

  const imageData = c.getImageData(0, 0, zoneW, zoneH);
  const data = imageData.data;

  // 1. Graustufen (in-place, Luminanz-Formel)
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = lum;
  }

  // 2. Kontraststretch: [P5, P95] → [0, 255]
  const total = zoneW * zoneH;
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
  // Uniform image (e.g. blank wall): skip contrast stretch and binarization
  if (lo >= hi) return true;

  const range = hi - lo;

  for (let i = 0; i < data.length; i += 4) {
    const v = Math.max(0, Math.min(255, Math.round(((data[i] - lo) / range) * 255)));
    data[i] = data[i + 1] = data[i + 2] = v;
  }

  // 3. Adaptives Otsu-Binarisieren (Kacheln 32×32)
  const tileSize = 32;
  const cols = Math.ceil(zoneW / tileSize);
  const rows = Math.ceil(zoneH / tileSize);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * tileSize;
      const y0 = row * tileSize;
      const x1 = Math.min(x0 + tileSize, zoneW);
      const y1 = Math.min(y0 + tileSize, zoneH);

      const tileHist = new Uint32Array(256);
      let tileN = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          tileHist[data[(y * zoneW + x) * 4]]++;
          tileN++;
        }
      }

      const threshold = otsuThreshold(tileHist, tileN);

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * zoneW + x) * 4;
          const bin = data[idx] >= threshold ? 255 : 0;
          data[idx] = data[idx + 1] = data[idx + 2] = bin;
        }
      }
    }
  }

  c.putImageData(imageData, 0, 0);
  return true;
}

function otsuThreshold(hist, total) {
  if (total === 0) return 128;

  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVar) {
      maxVar = variance;
      threshold = t;
    }
  }
  return threshold;
}
