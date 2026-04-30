import { startCamera }                          from './camera.js';
import { preprocessFrame }                       from './canvas.js';
import { initOCR, scheduleRecognition }          from './ocr.js';
import { sendOrQueue, flushQueue, getQueueLength } from './send.js';
import {
  setStatus, setLoadingMessage, hideLoading,
  showResult, setSendState, updateQueueBadge,
} from './ui.js';

const video   = document.getElementById('video');
const canvas  = document.getElementById('canvas');
const sendBtn = document.getElementById('send-btn');

let lastText       = '';
let lastConfidence = 0;

async function main() {
  // Kamera starten
  setLoadingMessage('Kamera wird gestartet…', 10);
  try {
    await startCamera(video);
  } catch (err) {
    setLoadingMessage(`Kamerazugriff verweigert: ${err.message}`);
    setStatus('Kamerafehler', 'error');
    return;
  }

  // OCR-Engine laden
  setLoadingMessage('OCR-Engine wird geladen…', 30);
  try {
    await initOCR((status, progress) => {
      setLoadingMessage(`${status} (${progress}%)`, 30 + Math.round(progress * 0.6));
    });
  } catch (err) {
    setLoadingMessage(`OCR-Fehler: ${err.message}`);
    setStatus('OCR-Fehler', 'error');
    return;
  }

  hideLoading();
  setStatus('Bereit', 'ready');
  updateQueueBadge(getQueueLength());

  // Erkennungsschleife
  function loop() {
    const ok = preprocessFrame(video, canvas);
    if (ok) {
      scheduleRecognition(canvas, (text, confidence) => {
        lastText       = text;
        lastConfidence = confidence;
        showResult(text, confidence);
        setStatus('Erkannt', 'ready');
      });
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Senden
  sendBtn.addEventListener('click', async () => {
    if (!lastText) return;
    setSendState('sending');
    setStatus('Sende…', 'working');
    try {
      await sendOrQueue(
        { ref: lastText, confidence: Math.round(lastConfidence), timestamp: new Date().toISOString() },
        updateQueueBadge,
      );
      setSendState(navigator.onLine ? 'sent' : 'queued');
      setStatus(navigator.onLine ? 'Gesendet' : 'Offline – in Warteschlange', navigator.onLine ? 'ready' : 'offline');
    } catch (err) {
      setSendState('error');
      setStatus(`Fehler: ${err.message}`, 'error');
    }
  });

  // Offline → Online: Queue leeren
  window.addEventListener('online', async () => {
    setStatus('Verbindung wiederhergestellt', 'working');
    try {
      await flushQueue(updateQueueBadge);
      setStatus('Bereit', 'ready');
    } catch {
      setStatus('Bereit', 'ready');
    }
  });

  window.addEventListener('offline', () => {
    setStatus('Offline', 'offline');
    updateQueueBadge(getQueueLength());
  });
}

main().catch((err) => {
  setLoadingMessage(`Kritischer Fehler: ${err.message}`);
  setStatus('Fehler', 'error');
  console.error(err);
});
