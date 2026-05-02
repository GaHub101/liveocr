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
  showReorderButton, setReorderState,
  applyLookupSuggestion, setSuggestStatus,
} from './ui.js';
import { checkRef, lookupProduct, addProduct, getProductSuppliers, markReorder } from './prices.js';

const video   = document.getElementById('video');
const canvas  = document.getElementById('canvas');
const scanBtn        = document.getElementById('scan-btn');
const sendBtn        = document.getElementById('send-btn');
const lookupBtn      = document.getElementById('lookup-btn');
const reorderBtn     = document.getElementById('reorder-btn');
const lookupConfirm  = document.getElementById('lookup-confirm-btn');
const lookupCancel   = document.getElementById('lookup-cancel-btn');

// URL-Parameter auslesen
const params      = new URLSearchParams(location.search);
const productId   = params.get('id');    // numerische ID aus dem Sheet – Pflichtfeld für Write-Modus
const productName = params.get('name');  // Artikelname, nur für Anzeige
const mode        = params.get('mode');  // 'search' für späteren Such-Modus

let lastText            = '';
let lastConfidence      = 0;
let cachedSuppliers     = [];
let lastFoundProductId  = null;  // Standalone-Modus: ID der zuletzt im Sheet gefundenen REF

async function handleStandaloneScan(text, confidence) {
  // OCR_Results-Logging: bei jedem erfolgreichen Scan, unabhängig vom Treffer-Status
  sendOrQueue(
    {
      ref: text,
      confidence: Math.round(confidence),
      timestamp: new Date().toISOString(),
    },
    updateQueueBadge,
  ).catch((err) => log.warn('main', `Auto-Log fehlgeschlagen: ${err.message}`));

  const result = await checkRef(text);
  if (result.status === 'ok') {
    lastFoundProductId = result.id;
    const suppliers = await getProductSuppliers(result.id);
    showSupplierLinks(suppliers, text);   // Option 1.1
    showReorderButton(true);              // Option 1.2
    showLookupButton(false);
  } else {
    lastFoundProductId = null;
    showSupplierLinks([], text);
    showReorderButton(false);
    showLookupButton(result.status === 'not_found');  // Option 2.1
  }
}

async function main() {
  // Search-Modus: Schnittstelle vorbereitet, noch nicht aktiv
  if (mode === 'search') {
    // TODO: Search-Modus – OCR-Ergebnis gegen Sheet abfragen und Produkt anzeigen
    // Aktivierung: searchByRef() in Code.gs ist bereit; hier UI und Aufruf ergänzen
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
    // "REF-Nr. hinzufügen" entfällt im Standalone-Modus – OCR_Results wird automatisch geloggt
    sendBtn.style.display = 'none';

    lookupBtn.addEventListener('click', () => {
      if (!lastText) return;
      // Modal direkt als leeres Formular öffnen — Hersteller wird manuell eingegeben
      setLookupModal('form', lastText, null);
    });
    lookupCancel.addEventListener('click', () => setLookupModal('hidden'));

    // "Vorschlag laden": Hersteller + REF an Gemini, befüllt Artikelname/Kategorie/Alt-Lieferanten
    const suggestBtn      = document.getElementById('lk-suggest-btn');
    const herstellerInput = document.getElementById('lk-hersteller');
    async function loadSuggestion() {
      const hersteller = herstellerInput.value.trim();
      if (!hersteller) {
        setSuggestStatus('Bitte zuerst Hersteller eingeben');
        herstellerInput.focus();
        return;
      }
      setSuggestStatus('Lade Vorschlag…', 'loading');
      const suggestion = await lookupProduct(lastText, hersteller);
      applyLookupSuggestion(suggestion);
      const filled = [suggestion.artikelname, suggestion.kategorie].filter(Boolean).length;
      const altsN  = Array.isArray(suggestion.alt_lieferanten) ? suggestion.alt_lieferanten.length : 0;
      setSuggestStatus(
        filled > 0 || altsN > 0
          ? `Vorschlag geladen (${filled} Felder, ${altsN} Lieferanten)`
          : 'Kein Vorschlag — bitte manuell ausfüllen',
      );
    }
    suggestBtn.addEventListener('click', loadSuggestion);
    herstellerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); loadSuggestion(); }
    });
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

    reorderBtn.addEventListener('click', async () => {
      if (!lastFoundProductId) return;
      log.info('main', `Nachbestellen: id=${lastFoundProductId}, ref="${lastText}"`);
      setReorderState('sending');
      setStatus('Speichern…', 'working');
      const result = await markReorder(lastFoundProductId);
      if (result?.status === 'ok') {
        setReorderState('sent');
        setStatus('Nachbestellen ✓', 'ready');
      } else {
        setReorderState('error');
        setStatus(`Fehler: ${result?.message || 'Speichern fehlgeschlagen'}`, 'error');
      }
    });
  }

  // Scan-Button
  scanBtn.addEventListener('click', async () => {
    log.info('main', 'Scan ausgelöst');
    if (!preprocessFrame(video, canvas)) {
      log.warn('main', 'Scan abgebrochen – kein Video-Frame verfügbar');
      return;
    }
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scannt…';
    setStatus('Scannt…', 'working');
    // Panels zurücksetzen vor neuem Scan
    showSupplierLinks([], '');
    showLookupButton(false);
    showReorderButton(false);
    setReorderState('idle');
    lastFoundProductId = null;
    setLookupModal('hidden');
    await scheduleRecognition(canvas, (text, confidence) => {
      log.info('main', `OCR-Ergebnis: "${text || '–'}", Konfidenz=${confidence}%`);
      lastText       = text;
      lastConfidence = confidence;
      showResult(text, confidence);
      setStatus('Erkannt', 'ready');
      if (text) {
        if (productId) {
          showSupplierLinks(cachedSuppliers, text);
        } else {
          handleStandaloneScan(text, confidence);
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
    log.info('main', `Sende: ref="${lastText}", confidence=${Math.round(lastConfidence)}${productId ? `, id=${productId}` : ''}`);
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

  let debugFilter = 'ALL'; // 'ALL' | 'WARN' | 'ERROR'

  function renderLog() {
    let entries = getLogs();
    if (debugFilter === 'WARN')  entries = entries.filter(e => e.level === 'WARN' || e.level === 'ERROR');
    if (debugFilter === 'ERROR') entries = entries.filter(e => e.level === 'ERROR');
    countEl.textContent = entries.length;
    logEl.innerHTML = entries.slice().reverse().map(e => `
      <div class="log-entry ${e.level}">
        <span class="log-ts">${e.ts.slice(11, 19)}</span>
        <span class="log-level">${e.level}</span>
        <span class="log-src">${e.source}</span>
        <span class="log-msg">${e.msg}${e.detail ? ` — ${e.detail}` : ''}</span>
      </div>`).join('');
  }

  function setFilter(f) {
    debugFilter = f;
    document.getElementById('debug-filter-all').classList.toggle('dbf-active',   f === 'ALL');
    document.getElementById('debug-filter-warn').classList.toggle('dbf-active',  f === 'WARN');
    document.getElementById('debug-filter-error').classList.toggle('dbf-active', f === 'ERROR');
    renderLog();
  }

  overlay.classList.add('visible');
  renderLog();

  // Re-render every 500ms so new entries appear quickly
  setInterval(renderLog, 500);

  document.getElementById('debug-filter-all').addEventListener('click',   () => setFilter('ALL'));
  document.getElementById('debug-filter-warn').addEventListener('click',  () => setFilter('WARN'));
  document.getElementById('debug-filter-error').addEventListener('click', () => setFilter('ERROR'));
  document.getElementById('debug-export').addEventListener('click', exportLogs);
  document.getElementById('debug-clear').addEventListener('click', () => { clearLogs(); renderLog(); });
  document.getElementById('debug-close').addEventListener('click', () => overlay.classList.remove('visible'));
}
