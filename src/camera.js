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
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (_) {
      // not supported on all devices – silently ignored
    }

    // Tap anywhere on video triggers a single-shot refocus
    videoEl.addEventListener('click', async () => {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
      } catch (_) { /* ignore */ }
    });
  }

  return stream;
}

export function stopCamera(stream) {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
}
