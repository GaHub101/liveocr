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

const LS_DEVICE = 'cam_device_id';
const LS_ZOOM   = 'cam_zoom';
const REAR_RE   = /\b(back|rear|environment|rück)\b/i;
const NEAR_RE   = /(ultra|wide|weit|macro|makro)/i;

function makeImageCapture(track) {
  if (!('ImageCapture' in window)) {
    log.warn('camera', 'ImageCapture nicht unterstützt – Video-Frame Fallback');
    return null;
  }
  try {
    return new ImageCapture(track);
  } catch (err) {
    log.warn('camera', `ImageCapture nicht nutzbar [${err.name}] – Video-Frame Fallback`);
    return null;
  }
}

function readZoomCaps(track) {
  const caps = track.getCapabilities?.();
  if (caps && caps.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > (caps.zoom.min ?? 0)) {
    return { min: caps.zoom.min ?? 0, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
  }
  return null;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

async function applyZoom(track, zoomCaps, value) {
  if (!zoomCaps) return;
  const v = clamp(Number(value), zoomCaps.min, zoomCaps.max);
  try {
    await track.applyConstraints({ advanced: [{ zoom: v }] });
  } catch (err) {
    log.warn('camera', `Zoom nicht anwendbar [${err.name}]`);
  }
}

async function openStream(videoConstraint) {
  return navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
}

export async function startCamera(videoEl) {
  // Erst-Stream (Hauptkamera) – erteilt die Berechtigung, danach
  // liefert enumerateDevices() Labels.
  let stream = await openStream({
    facingMode: { ideal: 'environment' },
    width:  { ideal: 1280 },
    height: { ideal: 720 },
  });
  let track = stream.getVideoTracks()[0];
  const mainDeviceId = track?.getSettings?.().deviceId || '';

  // Rückkamera-Kandidaten auflisten
  let cameras = [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const vids = devices.filter(d => d.kind === 'videoinput' && d.deviceId);
    const rear = vids.filter(d => REAR_RE.test(d.label));
    const pool = rear.length ? rear : vids;
    const seen = new Set();
    cameras = pool
      .filter(d => (seen.has(d.deviceId) ? false : seen.add(d.deviceId)))
      .map(d => ({ deviceId: d.deviceId, label: d.label || 'Kamera' }));
    log.info('camera', `Rückkameras: ${cameras.length} (${cameras.map(c => c.label).join(' | ') || '–'})`);
  } catch (err) {
    log.warn('camera', `enumerateDevices fehlgeschlagen [${err.name}]`);
  }
  if (!cameras.length && mainDeviceId) {
    cameras = [{ deviceId: mainDeviceId, label: track?.label || 'Hauptkamera' }];
  }

  // Zielkamera wählen: gespeichert → Heuristik (Ultraweit/Nah) → Haupt
  const saved = localStorage.getItem(LS_DEVICE);
  let targetId = '';
  if (saved && cameras.some(c => c.deviceId === saved)) {
    targetId = saved;
  } else {
    const near = cameras.find(c => NEAR_RE.test(c.label) && c.deviceId !== mainDeviceId);
    targetId = near ? near.deviceId : mainDeviceId;
  }

  // Falls Ziel ≠ aktueller Stream: gezielt neu öffnen (mit Fallback)
  if (targetId && targetId !== mainDeviceId) {
    try {
      stream.getTracks().forEach(t => t.stop());
      stream = await openStream({ deviceId: { exact: targetId } });
      track  = stream.getVideoTracks()[0];
    } catch (err) {
      log.warn('camera', `Kamera ${targetId.slice(0, 6)}… nicht öffenbar [${err.name}] – Hauptkamera`);
      stream = await openStream({ facingMode: { ideal: 'environment' } });
      track  = stream.getVideoTracks()[0];
    }
  }

  videoEl.srcObject = stream;
  await videoEl.play();

  let imageCapture = makeImageCapture(track);
  let zoomCaps     = readZoomCaps(track);
  let currentDeviceId = track?.getSettings?.().deviceId || targetId || mainDeviceId;
  let idx = Math.max(0, cameras.findIndex(c => c.deviceId === currentDeviceId));

  const s = track?.getSettings?.() ?? {};
  log.info('camera', `Stream: ${s.width ?? '?'}×${s.height ?? '?'}px, facing=${s.facingMode ?? '?'}, zoom=${zoomCaps ? `${zoomCaps.min}–${zoomCaps.max}` : 'n/a'}, label="${track?.label ?? ''}"`);

  // Gespeicherten Zoom (sonst Minimum) anwenden
  if (zoomCaps) {
    const z = Number(localStorage.getItem(LS_ZOOM));
    await applyZoom(track, zoomCaps, Number.isFinite(z) && z ? z : zoomCaps.min);
  }

  function setZoom(value) {
    if (!zoomCaps) return;
    const v = clamp(Number(value), zoomCaps.min, zoomCaps.max);
    localStorage.setItem(LS_ZOOM, String(v));
    return applyZoom(track, zoomCaps, v);
  }

  function context() {
    return { stream, track, imageCapture, cameras, currentDeviceId, zoomCaps, switchToNext, setZoom };
  }

  async function switchToNext() {
    if (cameras.length < 2) return context();
    idx = (idx + 1) % cameras.length;
    const next = cameras[idx];
    stream.getTracks().forEach(t => t.stop());
    try {
      stream = await openStream({ deviceId: { exact: next.deviceId } });
    } catch (err) {
      log.warn('camera', `Wechsel zu "${next.label}" fehlgeschlagen [${err.name}] – Hauptkamera`);
      stream = await openStream({ facingMode: { ideal: 'environment' } });
    }
    track = stream.getVideoTracks()[0];
    videoEl.srcObject = stream;
    await videoEl.play();
    imageCapture = makeImageCapture(track);
    zoomCaps = readZoomCaps(track);
    currentDeviceId = track?.getSettings?.().deviceId || next.deviceId;
    localStorage.setItem(LS_DEVICE, currentDeviceId);
    if (zoomCaps) {
      const z = Number(localStorage.getItem(LS_ZOOM));
      await applyZoom(track, zoomCaps, Number.isFinite(z) && z ? z : zoomCaps.min);
    }
    log.info('camera', `Kamera gewechselt → "${next.label}"`);
    return context();
  }

  return context();
}

export function stopCamera(stream) {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
}
