import { startCamera, captureSharpest }            from './camera.js';
import { preprocessFrame, preprocessBitmap }        from './canvas.js';
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
  showModeSelector, populateSupplierDropdown, populateLocationDropdown,
  populateStatusDropdown, showSearchRefInput,
  showStatusModal, getStatusModalValue, setStatusModalState,
  showModeSwitcher, setActiveModeSwitch,
  showSearchSuggestionInput, getSearchSuggestionValue,
  showReviewControls, showCameraSwitch, showZoomControl, getZoomValue,
} from './ui.js';
import {
  checkRef, lookupProduct, addProduct, getProductSuppliers, markReorder,
  listSuppliers, listLocations, listStatusValues, setOrderStatus,
} from './prices.js';

const video   = document.getElementById('video');
const canvas  = document.getElementById('canvas');
const scanBtn        = document.getElementById('scan-btn');
const reviewSendBtn   = document.getElementById('review-send-btn');
const reviewRetakeBtn = document.getElementById('review-retake-btn');
const sendBtn        = document.getElementById('send-btn');
const lookupBtn      = document.getElementById('lookup-btn');
const reorderBtn     = document.getElementById('reorder-btn');
const lookupConfirm  = document.getElementById('lookup-confirm-btn');
const lookupCancel   = document.getElementById('lookup-cancel-btn');
const statusConfirm  = document.getElementById('status-confirm-btn');
const statusCancel   = document.getElementById('status-cancel-btn');
const modeAddBtn     = document.getElementById('mode-add');
const modeSearchBtn  = document.getElementById('mode-search');
const modeReorderBtn = document.getElementById('mode-reorder');

// URL-Parameter auslesen
const params      = new URLSearchParams(location.search);
const productId   = params.get('id');    // numerische ID aus dem Sheet – Pflichtfeld für Write-Modus
const productName = params.get('name');  // Artikelname, nur für Anzeige

// userMode: 'add' | 'search' | 'reorder' | null
// ?id= setzt automatisch Reorder-Modus (Wishlist Pkt. 1, Z. 9)
let userMode = productId ? 'reorder' : null;

let lastText            = '';
let lastConfidence      = 0;
let lastSuggestion      = '';   // OCR-Suchvorschlag aus dem Etikett (Wishlist Pkt. 4)
let cachedSuppliers     = [];
let lastFoundProductId  = null;  // ID der zuletzt im Sheet gefundenen REF
let cachedStatusValues  = [];

const modeBtnLabels = { add: 'Weiter', search: 'Suchen', reorder: 'Bestellen' };

async function handleAddMode(text) {
  document.getElementById('search-ref-input').value = text;
  showSearchSuggestionInput(true, lastSuggestion);
  setStatus('REF prüfen und "Weiter" klicken', 'ready');
}

async function handleSearchMode(text) {
  document.getElementById('search-ref-input').value = text;
  setStatus('REF prüfen und "Suchen" klicken', 'ready');
}

async function handleReorderMode(text) {
  document.getElementById('search-ref-input').value = text;
  setStatus('REF prüfen und "Bestellen" klicken', 'ready');
}


async function main() {
  // Produkt-Banner anzeigen wenn aus AppSheet mit ?id= geöffnet
  if (productId) {
    showProductBanner(productName, productId);
    showModeSwitcher(false);
    getProductSuppliers(productId).then(s => { cachedSuppliers = s; });
  }

  log.info('main', `App gestartet – id=${productId ?? '–'}, userMode=${userMode ?? 'pending'}`);

  // Standalone: Mode-Selector anzeigen, Auswahl abwarten
  if (!productId) {
    showModeSelector(true);
    modeAddBtn.addEventListener('click',     () => selectMode('add'));
    modeSearchBtn.addEventListener('click',  () => selectMode('search'));
    modeReorderBtn.addEventListener('click', () => selectMode('reorder'));

    // Mode-Switcher in der Scan-Ansicht (Wishlist Pkt. 4)
    document.querySelectorAll('.mode-switch-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode;
        if (!newMode || newMode === userMode) return;
        switchMode(newMode);
      });
    });
  }

  // Lieferanten + Bestellstatus-Werte parallel laden (für Dropdowns)
  listSuppliers().then(names => populateSupplierDropdown(names));
  listLocations().then(locs => populateLocationDropdown(locs));
  listStatusValues().then(values => { cachedStatusValues = values; populateStatusDropdown(values); });

  // Kamera starten
  setLoadingMessage('Kamera wird gestartet…', 10);
  let imageCapture = null;
  let switchToNext = null;
  let setZoom = null;
  let cameras = [];
  let zoomCaps = null;
  try {
    ({ imageCapture, switchToNext, setZoom, cameras, zoomCaps } = await startCamera(video));
    log.info('main', 'Kamera gestartet');
  } catch (err) {
    log.error('main', 'Kamerazugriff fehlgeschlagen', err);
    setLoadingMessage(`Kamerazugriff verweigert: ${err.message}`);
    setStatus('Kamerafehler', 'error');
    return;
  }

  // Kamera-Umschalter (nur bei >1 Rückkamera) + Zoom-Slider
  const camSwitchBtn = document.getElementById('cam-switch-btn');
  const zoomRange    = document.getElementById('zoom-range');
  showCameraSwitch(cameras.length > 1);
  if (zoomCaps) showZoomControl(true, { ...zoomCaps, value: zoomCaps.min });

  camSwitchBtn?.addEventListener('click', async () => {
    camSwitchBtn.disabled = true;
    previewFrozen = false;
    showReviewControls(false);
    const ctx = await switchToNext();
    imageCapture = ctx.imageCapture;
    zoomCaps     = ctx.zoomCaps;
    if (zoomCaps) showZoomControl(true, { ...zoomCaps, value: getZoomValue() ?? zoomCaps.min });
    else          showZoomControl(false);
    camSwitchBtn.disabled = false;
  });

  zoomRange?.addEventListener('input', () => {
    if (setZoom) setZoom(getZoomValue());
  });

  await initOCR();
  hideLoading();
  setStatus('Bereit', 'ready');
  updateQueueBadge(getQueueLength());

  // Canvas-Loop für Debug-Vorschau (kein Auto-Scan)
  let previewFrozen = false;
  function loop() {
    if (!previewFrozen) preprocessFrame(video, canvas);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Beim Scan den schärfsten aus mehreren Frames holen (gegen
  // Sofort-Abgriff während der Autofokus noch „pumpt"). Fallback auf
  // den Video-Frame, wo kein scharfer Kandidat verfügbar ist.
  async function captureToCanvas() {
    try {
      const bmp = await captureSharpest({ video, imageCapture });
      if (bmp) {
        const ok = preprocessBitmap(bmp, canvas);
        bmp.close();
        return ok;
      }
    } catch (err) {
      log.warn('main', `Schärfster-Frame fehlgeschlagen [${err.name}] – Video-Frame Fallback`);
    }
    return preprocessFrame(video, canvas);
  }

  // Standalone-Modus: Modal- und Status-Handler registrieren
  if (!productId) {
    // "REF-Nr. hinzufügen" entfällt im Standalone-Modus – OCR_Results wird automatisch geloggt
    sendBtn.style.display = 'none';

    const searchRefInput   = document.getElementById('search-ref-input');
    const searchConfirmBtn = document.getElementById('search-confirm-btn');

    function resetToEditField() {
      showSearchRefInput(true, '', modeBtnLabels[userMode] || 'Weiter');
      // Add-Modus: Suchvorschlag-Feld leer einblenden, sonst verbergen (Wishlist Pkt. 4)
      if (userMode === 'add') showSearchSuggestionInput(true, '');
      else                    showSearchSuggestionInput(false);
    }

    searchConfirmBtn.addEventListener('click', async () => {
      const ref = searchRefInput.value.trim();
      if (!ref) return;

      if (userMode === 'add') {
        const sugg = getSearchSuggestionValue();
        showSearchRefInput(false);
        showSearchSuggestionInput(false);
        setLookupModal('form', ref, null);
        if (sugg) document.getElementById('lk-hersteller').value = sugg;
        return;
      }

      // Such- und Nachbestell-Modus: checkRef
      const originalLabel = searchConfirmBtn.textContent;
      searchConfirmBtn.disabled = true;
      searchConfirmBtn.textContent = 'Suche…';
      sendOrQueue(
        { ref, confidence: Math.round(lastConfidence), timestamp: new Date().toISOString() },
        updateQueueBadge,
      ).catch((err) => log.warn('main', `Auto-Log fehlgeschlagen: ${err.message}`));
      const result = await checkRef(ref);
      searchConfirmBtn.disabled = false;
      searchConfirmBtn.textContent = originalLabel;

      if (userMode === 'reorder') {
        if (result.status === 'ok') {
          lastFoundProductId = result.id;
          showSearchRefInput(false);
          showSearchSuggestionInput(false);
          const suppliers = await getProductSuppliers(result.id);
          showSupplierLinks(suppliers, ref);
          showReorderButton(true);
          showLookupButton(false);
        } else {
          lastFoundProductId = null;
          showSupplierLinks([], ref);
          showReorderButton(false);
          showLookupButton(true);
          // REF nicht in DB → Suchvorschlag-Feld einblenden für ggf. "Neues Produkt anlegen" (Wishlist Pkt. 4)
          showSearchSuggestionInput(true, lastSuggestion);
          setStatus('REF nicht gefunden – als neues Produkt anlegen?', 'ready');
        }
        return;
      }

      // Such-Modus
      if (result.status === 'ok') {
        lastFoundProductId = result.id;
        showSearchRefInput(false);
        showSearchSuggestionInput(false);
        showStatusModal(true, cachedStatusValues);
      } else {
        lastFoundProductId = null;
        showLookupButton(true);
        showSearchSuggestionInput(true, lastSuggestion);
        setStatus('REF nicht gefunden – als neues Produkt anlegen?', 'ready');
      }
    });

    lookupBtn.addEventListener('click', () => {
      const ref = (searchRefInput && searchRefInput.value.trim()) || lastText;
      if (!ref) return;
      const sugg = getSearchSuggestionValue() || lastSuggestion;
      showSearchRefInput(false);
      showSearchSuggestionInput(false);
      showLookupButton(false);
      setLookupModal('form', ref, null);
      if (sugg) document.getElementById('lk-hersteller').value = sugg;
    });
    lookupCancel.addEventListener('click', () => { setLookupModal('hidden'); resetToEditField(); });

    // "Vorschlag laden": Hersteller + REF an Gemini, befüllt Artikelname/Alt-Lieferanten
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
      const refForLookup = document.getElementById('lk-ref')?.value.trim() || lastText;
      const suggestion = await lookupProduct(refForLookup, hersteller);
      applyLookupSuggestion(suggestion);
      const filled = [suggestion.hersteller, suggestion.artikelname].filter(Boolean).length;
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
      // Herstellername aus Artikelname entfernen (Sicherheitsnetz falls manuell eingefügt)
      if (vals.hersteller) {
        const re = new RegExp(vals.hersteller.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        vals.name = vals.name.replace(re, '').replace(/\s+/g, ' ').trim();
      }
      lookupConfirm.disabled = true;
      lookupConfirm.textContent = 'Speichern…';
      try {
        await addProduct(vals);
        setLookupModal('hidden');
        setStatus('Produkt angelegt ✓', 'ready');
        showLookupButton(false);
        resetToEditField();
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
      resetToEditField();
    });

    // Status-Modal (Option B – Produkt gefunden)
    statusCancel.addEventListener('click', () => { showStatusModal(false); resetToEditField(); });
    statusConfirm.addEventListener('click', async () => {
      if (!lastFoundProductId) return;
      const value = getStatusModalValue();
      if (!value) return;
      setStatusModalState('sending');
      setStatus('Speichern…', 'working');
      const result = await setOrderStatus(lastFoundProductId, value);
      if (result?.status === 'ok') {
        setStatusModalState('sent');
        setStatus(`Status gesetzt: ${value} ✓`, 'ready');
        setTimeout(() => { showStatusModal(false); resetToEditField(); }, 800);
      } else {
        setStatusModalState('error');
        setStatus(`Fehler: ${result?.message || 'Speichern fehlgeschlagen'}`, 'error');
      }
    });
  }

  // Scan-Button → Stufe 1: scharfes Standbild aufnehmen, dann
  // Prüf-Vorschau zeigen (NICHT automatisch senden).
  scanBtn.addEventListener('click', async () => {
    if (!productId && !userMode) {
      setStatus('Bitte zuerst eine Aktion wählen', 'error');
      return;
    }
    log.info('main', `Aufnahme ausgelöst – mode=${userMode ?? 'id'}`);
    scanBtn.disabled = true;
    scanBtn.textContent = 'Nehme auf…';
    setStatus('Nehme auf…', 'working');
    previewFrozen = true;
    const captured = await captureToCanvas();
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scannen';
    if (!captured) {
      log.warn('main', 'Aufnahme abgebrochen – kein Bild verfügbar');
      previewFrozen = false;
      setStatus('Kein Bild – erneut versuchen', 'error');
      return;
    }
    showReviewControls(true);
    setStatus('Bitte prüfen: scharf? Dann „Senden"', 'ready');
  });

  // Stufe 2a: „Neu aufnehmen" – verwerfen, zurück zum Live-Sucher
  reviewRetakeBtn.addEventListener('click', () => {
    showReviewControls(false);
    previewFrozen = false;
    setStatus('Bereit', 'ready');
  });

  // Stufe 2b: „Senden" – erst jetzt OCR an Gemini
  reviewSendBtn.addEventListener('click', async () => {
    reviewSendBtn.disabled = true;
    reviewSendBtn.textContent = 'Sende…';
    setStatus('Scannt…', 'working');
    // Panels zurücksetzen vor neuem Scan
    showSupplierLinks([], '');
    showLookupButton(false);
    showReorderButton(false);
    setReorderState('idle');
    lastFoundProductId = null;
    setLookupModal('hidden');
    showStatusModal(false);
    await scheduleRecognition(canvas, (text, confidence, suggestion = '') => {
      log.info('main', `OCR-Ergebnis: "${text || '–'}", Konfidenz=${confidence}%, Vorschlag="${suggestion || '–'}"`);
      lastText       = text;
      lastConfidence = confidence;
      lastSuggestion = suggestion || '';
      showResult(text, confidence);
      setStatus('Erkannt', 'ready');
      // Add-Modus: Suchvorschlag immer aktualisieren – auch wenn keine REF erkannt wurde
      if (!productId && userMode === 'add') {
        showSearchSuggestionInput(true, lastSuggestion);
      }
      if (text) {
        if (productId) {
          // ?id= → Lieferantenliste anzeigen, Reorder erfolgt nach Send-Klick
          showSupplierLinks(cachedSuppliers, text);
        } else if (userMode === 'add') {
          handleAddMode(text);
        } else if (userMode === 'search') {
          handleSearchMode(text);
        } else if (userMode === 'reorder') {
          handleReorderMode(text);
        }
      }
    });
    showReviewControls(false);
    previewFrozen = false;
    reviewSendBtn.disabled = false;
    reviewSendBtn.textContent = 'Senden';
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
      // Wishlist Pkt. 1 Z. 9: ?id= → automatisch Bestellstatus auf "Nachbestellen" setzen
      if (productId && navigator.onLine && result?.status === 'ok') {
        markReorder(productId).then(r => {
          if (r?.status === 'ok') log.info('main', `?id=-Modus: Bestellstatus auf Nachbestellen gesetzt für id=${productId}`);
          else                    log.warn('main', `?id=-Modus: markReorder fehlgeschlagen – ${r?.message || 'unbekannt'}`);
        });
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

function selectMode(mode) {
  userMode = mode;
  log.info('main', `Mode gewählt: ${mode}`);
  showModeSelector(false);
  showModeSwitcher(true);
  setActiveModeSwitch(mode);
  showSearchRefInput(true, '', modeBtnLabels[mode] || 'Weiter');
  // Add-Modus: Suchvorschlag-Feld direkt einblenden (Wishlist Pkt. 4)
  if (mode === 'add') showSearchSuggestionInput(true, '');
  else                showSearchSuggestionInput(false);
  setStatus(`Modus: ${modeLabel(mode)} – scannen oder REF eingeben`, 'ready');
}

// Mode-Wechsel aus der Scan-Ansicht heraus (Wishlist Pkt. 4)
// REF + Suggestion bleiben erhalten, transiente UI-States werden zurückgesetzt.
function switchMode(mode) {
  userMode = mode;
  log.info('main', `Mode gewechselt: ${mode}`);
  setActiveModeSwitch(mode);
  // Modals + Sekundär-Buttons schließen
  setLookupModal('hidden');
  showStatusModal(false);
  showSupplierLinks([], '');
  showLookupButton(false);
  showReorderButton(false);
  setReorderState('idle');
  lastFoundProductId = null;
  // REF-Eingabefeld wieder anzeigen, Inhalt erhalten, Button-Label umbenennen
  const inp = document.getElementById('search-ref-input');
  const currentRef = inp ? inp.value : '';
  showSearchRefInput(true, currentRef, modeBtnLabels[mode] || 'Weiter');
  // Suchvorschlag-Feld nach Mode-Regel: Add zeigt es immer; sonst verbergen
  if (mode === 'add') showSearchSuggestionInput(true, lastSuggestion);
  else                showSearchSuggestionInput(false);
  setStatus(`Modus: ${modeLabel(mode)}`, 'ready');
}

function modeLabel(m) {
  if (m === 'add')     return 'Produkt hinzufügen';
  if (m === 'search')  return 'Produkt suchen';
  if (m === 'reorder') return 'Nachbestellen';
  return m;
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
