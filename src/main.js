import { startCamera }                             from './camera.js';
import { preprocessFrame }                          from './canvas.js';
import { initOCR, scheduleRecognition }             from './ocr.js';
import { sendOrQueue, flushQueue, getQueueLength }  from './send.js';
import { log, getLogs, clearLogs, exportLogs }      from './logger.js';
import {
  setStatus, setLoadingMessage, hideLoading,
  showResult, setSendState, updateQueueBadge,
  showProductBanner, showSupplierLinks,
  showLookupButton, setLookupModal, getLookupFormValues,
} from './ui.js';
import { checkRef, lookupProduct, addProduct, getProductSuppliers } from './prices.js';

const video   = document.getElementById('video');
const canvas  = document.getElementById('canvas');
const scanBtn        = document.getElementById('scan-btn');
const sendBtn        = document.getElementById('send-btn');
const lookupBtn      = document.getElementById('lookup-btn');
const lookupConfirm  = document.getElementById('lookup-confirm-btn');
const lookupCancel   = document.getElementById('lookup-cancel-btn');

// URL-Parameter auslesen
const params      = new URLSearchParams(location.search);
const productId   = params.get('id');    // numerische ID aus dem Sheet – Pflichtfeld für Write-Modus
const productName = params.get('name');  // Artikelname, nur für Anzeige
const mode        = params.get('mode');  // 'search' für späteren Such-Modus

let lastText       = '';
let lastConfidence = 0;
let cachedSuppliers = [];

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
    getProductSuppliers(productId).then(s => { cachedSuppliers = s; });
  }

  log.info('main', `App gestartet – mode=${mode ?? 'standalone'}, id=${productId ?? '–'}`);

  // Kamera starten
  setLoadingMessage('Kamera wird gestartet…', 10);
  try {
    await startCamera(video);
    log.info('main', 'Kamera gestartet');
  } catch (err) {
    log.error('main', 'Kamerazugriff fehlgeschlagen', err);
    setLoadingMessage(`Kamerazugriff verweigert: ${err.message}`);
    setStatus('Kamerafehler', 'error');
    return;
  }

  await initOCR();
  hideLoading();
  setStatus('Bereit', 'ready');
  updateQueueBadge(getQueueLength());

  // Canvas-Loop für Debug-Vorschau (kein Auto-Scan)
  function loop() {
    preprocessFrame(video, canvas);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Standalone-Modus: Modal-Handler registrieren
  if (!productId) {
    lookupBtn.addEventListener('click', async () => {
      if (!lastText) return;
      lookupBtn.disabled = true;
      setLookupModal('loading', lastText, null);
      const suggestion = await lookupProduct(lastText);
      setLookupModal('form', lastText, suggestion);
      lookupBtn.disabled = false;
    });
    lookupCancel.addEventListener('click', () => setLookupModal('hidden'));
    lookupConfirm.addEventListener('click', async () => {
      const vals = getLookupFormValues();
      if (!vals.name) { document.getElementById('lk-name').focus(); return; }
      lookupConfirm.disabled = true;
      lookupConfirm.textContent = 'Speichern…';
      try {
        await addProduct({ ref: lastText, ...vals });
        setLookupModal('hidden');
        setStatus('Produkt angelegt ✓', 'ready');
        showLookupButton(false);
      } catch (err) {
        log.error('main', 'addProduct fehlgeschlagen', err);
        setStatus(`Fehler: ${err.message}`, 'error');
      }
      lookupConfirm.disabled = false;
      lookupConfirm.textContent = 'Bestätigen';
    });
  }

  // Scan-Button
  scanBtn.addEventListener('click', async () => {
    if (!preprocessFrame(video, canvas)) return;
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scannt…';
    setStatus('Scannt…', 'working');
    // Panels zurücksetzen vor neuem Scan
    showSupplierLinks([], '');
    showLookupButton(false);
    setLookupModal('hidden');
    await scheduleRecognition(canvas, (text, confidence) => {
      lastText       = text;
      lastConfidence = confidence;
      showResult(text, confidence);
      setStatus('Erkannt', 'ready');
      if (text) {
        if (productId) {
          showSupplierLinks(cachedSuppliers, text);
        } else {
          checkRef(text).then(result => showLookupButton(result.status === 'not_found'));
        }
      }
    });
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scannen';
    if (!lastText) setStatus('Kein REF gefunden – erneut versuchen', 'error');
  });

  // Senden
  sendBtn.addEventListener('click', async () => {
    if (!lastText) return;
    setSendState('sending');
    setStatus('Sende…', 'working');
    try {
      const result = await sendOrQueue(
        {
          ref: lastText,
          confidence: Math.round(lastConfidence),
          timestamp: new Date().toISOString(),
          ...(productId ? { id: productId } : {}),
        },
        updateQueueBadge,
      );
      if (navigator.onLine && (result?.status === 'already_exists' || result?.status === 'conflict')) {
        setSendState('already_exists');
        setStatus('REF bereits vorhanden', 'ready');
      } else {
        setSendState(navigator.onLine ? 'sent' : 'queued');
        setStatus(navigator.onLine ? 'Hinzugefügt' : 'Offline – in Warteschlange', navigator.onLine ? 'ready' : 'offline');
      }
    } catch (err) {
      log.error('main', 'Senden fehlgeschlagen', err);
      setSendState('error');
      setStatus(`Fehler: ${err.message}`, 'error');
    }
  });

  // Offline → Online: Queue leeren
  window.addEventListener('online', async () => {
    log.info('main', 'Netzwerk wiederhergestellt – leere Queue');
    setStatus('Verbindung wiederhergestellt', 'working');
    try {
      await flushQueue(updateQueueBadge);
      setStatus('Bereit', 'ready');
    } catch (err) {
      log.error('main', 'Queue-Flush nach Reconnect fehlgeschlagen', err);
      setStatus('Bereit', 'ready');
    }
  });

  window.addEventListener('offline', () => {
    log.warn('main', 'Netzwerk getrennt');
    setStatus('Offline', 'offline');
    updateQueueBadge(getQueueLength());
  });
}

main().catch((err) => {
  log.error('main', `Kritischer Fehler: ${err.message}`, err);
  setLoadingMessage(`Kritischer Fehler: ${err.message}`);
  setStatus('Fehler', 'error');
});

// Debug-Overlay – aktiv wenn ?debug in der URL
if (new URLSearchParams(location.search).has('debug')) {
  document.body.classList.add('debug-mode');
  const overlay  = document.getElementById('debug-overlay');
  const logEl    = document.getElementById('debug-log');
  const countEl  = document.getElementById('debug-count');

  function renderLog() {
    const entries = getLogs();
    countEl.textContent = entries.length;
    logEl.innerHTML = entries.slice().reverse().map(e => `
      <div class="log-entry ${e.level}">
        <span class="log-ts">${e.ts.slice(11, 19)}</span>
        <span class="log-level">${e.level}</span>
        <span class="log-src">${e.source}</span>
        <span class="log-msg">${e.msg}${e.detail ? ` — ${e.detail}` : ''}</span>
      </div>`).join('');
  }

  overlay.classList.add('visible');
  renderLog();

  // Re-render every 2s so new entries appear automatically
  setInterval(renderLog, 2000);

  document.getElementById('debug-export').addEventListener('click', exportLogs);
  document.getElementById('debug-clear').addEventListener('click', () => { clearLogs(); renderLog(); });
  document.getElementById('debug-close').addEventListener('click', () => overlay.classList.remove('visible'));
}
