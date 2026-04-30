import { startCamera }                             from './camera.js';
import { preprocessFrame }                          from './canvas.js';
import { initOCR, scheduleRecognition }             from './ocr.js';
import { sendOrQueue, flushQueue, getQueueLength }  from './send.js';
import {
  setStatus, setLoadingMessage, hideLoading,
  showResult, setSendState, updateQueueBadge,
  showProductBanner,
} from './ui.js';

const video   = document.getElementById('video');
const canvas  = document.getElementById('canvas');
const sendBtn = document.getElementById('send-btn');

// URL-Parameter auslesen
const params      = new URLSearchParams(location.search);
const productId   = params.get('id');    // numerische ID aus dem Sheet – Pflichtfeld für Write-Modus
const productName = params.get('name');  // Artikelname, nur für Anzeige
const mode        = params.get('mode');  // 'search' für späteren Such-Modus

let lastText       = '';
let lastConfidence = 0;

async function main() {
  // Search-Modus: Schnittstelle vorbereitet, noch nicht aktiv
  if (mode === 'search') {
    // TODO: Search-Modus – OCR-Ergebnis gegen Sheet abfragen und Produkt anzeigen
    // Aktivierung: apps-script/Code.gs searchByRef() auskommentieren + hier aufrufen
    setStatus('Search-Modus noch nicht aktiv', 'error');
    hideLoading();
    return;
  }

  // Produkt-Banner anzeigen wenn aus AppSheet mit ?id= geöffnet
  if (productId) {
    showProductBanner(productName, productId);
  }

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
        {
          ref: lastText,
          confidence: Math.round(lastConfidence),
          timestamp: new Date().toISOString(),
          ...(productId ? { id: productId } : {}),
        },
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
