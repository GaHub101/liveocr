import { log } from './logger.js';

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
  }

  return stream;
}

export function stopCamera(stream) {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
}
