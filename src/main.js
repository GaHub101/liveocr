import { startCamera, captureSharpest }            from './camera.js';
import { preprocessFrame, preprocessBitmap }        from './canvas.js';
import { initOCR, scheduleRecognition }             from './ocr.js';
import { sendOrQueue, flushQueue, getQueueLength }  from './send.js';
import { log, getLogs, clearLogs, exportLogs }      from './logger.js';
import {
  setStatus, setLoadingMessage, hideLoading,
  showResult, setSendState, updateQueueBadge,
  showProductBanner, showSupplierLinks,
  showLookupButton, setLookupModal, getLookupFormValues, fillLookupFormValues,
  showReorderButton, setReorderState,
  applyLookupSuggestion, setSuggestStatus,
  showModeSelector, populateSupplierDropdown, populateLocationDropdown,
  populateCategoryDropdown, populateStatusDropdown, showSearchRefInput,
  showStatusModal, getStatusModalValue, setStatusModalState,
  showModeSwitcher, setActiveModeSwitch,
  showReviewControls, showCameraSwitch, showZoomControl, getZoomValue,
  showRefExistsModal, ADD_NEW_VALUE,
} from './ui.js';
import {
  checkRef, lookupProduct, addProduct, updateProduct, getProductSuppliers, markReorder,
  bootstrap, listSuppliers, listLocations, listCategories, listStatusValues, setOrderStatus,
  addCategory, addLocation, addSupplier,
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
let cachedSuppliers     = [];
let lastFoundProductId  = null;  // ID der zuletzt im Sheet gefundenen REF
let cachedStatusValues  = [];
let cachedRefMap        = [];    // [REF, Hersteller, Kategorie, Hauptlieferant, Lagerort]-Tupel aus dem Sheet für die Vorauswahl
let suggestRequestId    = 0;     // entwertet veraltete Vorschlag-Antworten nach erneutem Klick/Modal-Wechsel
let duplicateRef        = '';    // REF, die aktuell im "Bereits vorhanden"-Dialog angezeigt wird
let duplicateExisting   = null;  // Sheet-Daten des Duplikats (für "Produkteigenschaften überprüfen")
let editingProductId    = null;  // gesetzt, solange das Lookup-Formular ein bestehendes Produkt bearbeitet (statt anzulegen)

const modeBtnLabels = { add: 'Weiter', search: 'Suchen', reorder: 'Bestellen' };

// Bestes refMap-Tripel anhand ähnlicher REF-Codes aus dem Sheet finden (längster gemeinsamer Präfix).
// Wird mit jedem hinzugefügten Produkt besser – kein API-Call nötig.
function bestRefMapMatch(ref) {
  const R = String(ref).toUpperCase();
  if (R.length < 3) return null;
  let best = null;
  let bestLen = 0;
  for (const entry of cachedRefMap) {
    const r = String(entry[0]).toUpperCase();
    const max = Math.min(r.length, R.length);
    let l = 0;
    while (l < max && r[l] === R[l]) l++;
    if (l > bestLen) { bestLen = l; best = entry; }
  }
  return bestLen >= 3 ? best : null;
}

function guessHersteller(ref) {
  const match = bestRefMapMatch(ref);
  return (match && match[1]) || '';
}

// Alte Cache-Einträge sind noch [REF, Hersteller]-Paare – dann leerer String
function guessKategorie(ref) {
  const match = bestRefMapMatch(ref);
  return (match && match[2]) || '';
}

function guessHauptlieferant(ref) {
  const match = bestRefMapMatch(ref);
  return (match && match[3]) || '';
}

function guessLagerort(ref) {
  const match = bestRefMapMatch(ref);
  return (match && match[4]) || '';
}

// "A", "A und B" bzw. "A, B und C" statt "A und B und C"
function joinNatural(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`;
}

// Suchbegriff-, Kategorie-, Hauptlieferant- und Lagerort-Feld im Modal vorbelegen,
// sofern jeweils leer und eine ähnliche REF bekannt ist
function prefillGuesses(ref) {
  const filled = [];
  // Beim Text-Feld (Hersteller) wird der Vorschlag komplett markiert, damit er
  // sich durch einfaches Weitertippen sofort überschreiben lässt. Kein .select(),
  // da das den Fokus stiehlt – setSelectionRange markiert stumm, ohne den Cursor
  // aktiv zu setzen (kein Auto-Fokus beim Öffnen des Formulars)
  const herstellerInp = document.getElementById('lk-hersteller');
  if (herstellerInp && !herstellerInp.value.trim()) {
    const guess = guessHersteller(ref);
    if (guess) { herstellerInp.value = guess; herstellerInp.setSelectionRange(0, guess.length); filled.push(`Hersteller "${guess}"`); }
  }
  // lk-cat/lk-sup/lk-loc sind geschlossene <select>-Listen: Wert wird nur
  // übernommen, wenn er als <option> existiert (sonst bleibt die Selektion stumm leer)
  const katSel = document.getElementById('lk-cat');
  if (katSel && !katSel.value) {
    const guess = guessKategorie(ref);
    if (guess) {
      katSel.value = guess;
      if (katSel.value === guess) filled.push(`Kategorie "${guess}"`);
    }
  }
  const supSel = document.getElementById('lk-sup');
  if (supSel && !supSel.value) {
    const guess = guessHauptlieferant(ref);
    if (guess) {
      supSel.value = guess;
      if (supSel.value === guess) filled.push(`Hauptlieferant "${guess}"`);
    }
  }
  const locSel = document.getElementById('lk-loc');
  if (locSel && !locSel.value) {
    const guess = guessLagerort(ref);
    if (guess) {
      locSel.value = guess;
      if (locSel.value === guess) filled.push(`Lagerort "${guess}"`);
    }
  }
  if (!filled.length) return;
  setSuggestStatus(`${joinNatural(filled)} vorausgewählt – bitte prüfen`);
  log.info('main', `Vorauswahl: ${filled.join(', ')} (ähnliche REF im Sheet)`);
}

// REF gegen das Sheet prüfen, bevor das Add-Formular geöffnet wird – bei
// Treffer Duplikat-Meldung statt Formular (Wunsch: Abbruch oder REF bearbeiten)
async function openAddForm(ref) {
  editingProductId = null;
  const existing = await checkRef(ref);
  if (existing.status === 'ok') {
    duplicateRef = ref;
    duplicateExisting = existing;
    log.warn('main', `REF "${ref}" bereits vorhanden (Produkt: "${existing.name || '–'}") – Duplikat-Meldung`);
    showRefExistsModal(true, ref, existing.name);
    return;
  }
  showSearchRefInput(false);
  showLookupButton(false);
  suggestRequestId++;
  setLookupModal('form', ref, null);
  prefillGuesses(ref);
}

// Formular zum Prüfen/Ändern eines bestehenden Produkts öffnen (Duplikat-Dialog
// → "Produkteigenschaften überprüfen"). Werte kommen direkt aus dem Sheet.
function openEditForm(ref, existing) {
  editingProductId = existing.id;
  showSearchRefInput(false);
  showLookupButton(false);
  suggestRequestId++;
  setLookupModal('form', ref, null, 'edit');
  fillLookupFormValues(existing);
}

async function handleAddMode(text) {
  // Direkt ins Formular springen – REF ist dort editierbar, Cursor steht im Hersteller-Feld
  await openAddForm(text);
}

async function handleSearchMode(text) {
  document.getElementById('search-ref-input').value = text;
}

async function handleReorderMode(text) {
  document.getElementById('search-ref-input').value = text;
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

  // Dropdown-Daten: sofort aus dem localStorage-Cache, dann ein einziger
  // bootstrap-Request im Hintergrund (statt drei einzelner Roundtrips)
  const BOOTSTRAP_CACHE_KEY = 'ocr_bootstrap_cache';
  function applyBootstrapData(data) {
    populateSupplierDropdown(data.suppliers || []);
    populateLocationDropdown(data.locations || []);
    populateCategoryDropdown(data.categories || []);
    cachedStatusValues = data.statusValues || [];
    populateStatusDropdown(cachedStatusValues);
    cachedRefMap = data.refMap || [];
  }
  function refreshBootstrap() {
    return bootstrap().then((data) => {
      if (data) {
        applyBootstrapData(data);
        localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(data));
      }
      return data;
    });
  }
  // Nach "+ Neu…" (Kategorie/Hauptlieferant/Lagerort) den lokalen Cache
  // aktualisieren, damit der neue Wert auch offline sofort verfügbar bleibt
  const BOOTSTRAP_CACHE_KEYS = { category: 'categories', location: 'locations', supplier: 'suppliers' };
  function persistBootstrapListValue(type, list) {
    const key = BOOTSTRAP_CACHE_KEYS[type];
    if (!key) return;
    try {
      const cached = JSON.parse(localStorage.getItem(BOOTSTRAP_CACHE_KEY) || 'null') || {};
      cached[key] = list;
      localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(cached));
    } catch { /* defekter Cache – ignorieren */ }
  }
  try {
    const cached = JSON.parse(localStorage.getItem(BOOTSTRAP_CACHE_KEY) || 'null');
    if (cached) applyBootstrapData(cached);
  } catch { /* defekter Cache – ignorieren */ }
  refreshBootstrap().then((data) => {
    if (!data) {
      // Fallback: Apps Script ohne bootstrap-Action deployed
      listSuppliers().then(names => populateSupplierDropdown(names));
      listLocations().then(locs => populateLocationDropdown(locs));
      listCategories().then(cats => populateCategoryDropdown(cats));
      listStatusValues().then(values => { cachedStatusValues = values; populateStatusDropdown(values); });
    }
  });

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
    }

    searchConfirmBtn.addEventListener('click', async () => {
      const ref = searchRefInput.value.trim();
      if (!ref) return;

      if (userMode === 'add') {
        await openAddForm(ref);
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
          const suppliers = await getProductSuppliers(result.id);
          showSupplierLinks(suppliers, ref);
          showReorderButton(true);
          showLookupButton(false);
        } else {
          lastFoundProductId = null;
          showSupplierLinks([], ref);
          showReorderButton(false);
          showLookupButton(true);
          setStatus('REF nicht gefunden – als neues Produkt anlegen?', 'ready');
        }
        return;
      }

      // Such-Modus
      if (result.status === 'ok') {
        lastFoundProductId = result.id;
        showSearchRefInput(false);
        showStatusModal(true, cachedStatusValues);
      } else {
        lastFoundProductId = null;
        showLookupButton(true);
        setStatus('REF nicht gefunden – als neues Produkt anlegen?', 'ready');
      }
    });

    lookupBtn.addEventListener('click', async () => {
      const ref = (searchRefInput && searchRefInput.value.trim()) || lastText;
      if (!ref) return;
      await openAddForm(ref);
    });
    lookupCancel.addEventListener('click', () => { editingProductId = null; setLookupModal('hidden'); resetToEditField(); });

    // Duplikat-Meldung (Option A): Abbruch zurück zum Scannen, REF direkt bearbeiten
    // oder bestehende Produkteigenschaften prüfen/ändern
    const refExistsBackBtn  = document.getElementById('ref-exists-back-btn');
    const refExistsEditBtn  = document.getElementById('ref-exists-edit-btn');
    const refExistsCheckBtn = document.getElementById('ref-exists-check-btn');
    refExistsBackBtn.addEventListener('click', () => {
      showRefExistsModal(false);
      resetToEditField();
    });
    refExistsEditBtn.addEventListener('click', () => {
      showRefExistsModal(false);
      showSearchRefInput(true, duplicateRef, modeBtnLabels[userMode] || 'Weiter');
      // Verzögert fokussieren – direkt nach display:none→block greift der
      // Fokus auf manchen Mobilbrowsern nicht zuverlässig
      setTimeout(() => searchRefInput.focus(), 0);
    });
    refExistsCheckBtn.addEventListener('click', () => {
      showRefExistsModal(false);
      openEditForm(duplicateRef, duplicateExisting || {});
    });

    // "Vorschlag laden": Hersteller + REF an Gemini, befüllt Hersteller/Artikelname
    const suggestBtn      = document.getElementById('lk-suggest-btn');
    const herstellerInput = document.getElementById('lk-hersteller');
    async function loadSuggestion() {
      const hersteller = herstellerInput.value.trim();
      if (!hersteller) {
        setSuggestStatus('Bitte zuerst Hersteller eingeben');
        herstellerInput.focus();
        return;
      }
      const reqId = ++suggestRequestId;
      setSuggestStatus('Lade Vorschlag…', 'loading');
      const refForLookup = document.getElementById('lk-ref')?.value.trim() || lastText;
      const suggestion = await lookupProduct(refForLookup, hersteller);
      if (reqId !== suggestRequestId) return;
      applyLookupSuggestion(suggestion);
      const filled = [suggestion.hersteller, suggestion.artikelname].filter(Boolean).length;
      setSuggestStatus(
        filled > 0
          ? `Vorschlag geladen (${filled} Felder)`
          : 'Kein Vorschlag — bitte manuell ausfüllen',
      );
    }
    suggestBtn.addEventListener('click', loadSuggestion);
    herstellerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); loadSuggestion(); }
    });

    // "+ Neu…"-Option in Kategorie/Hauptlieferant/Lagerort: fragt einen neuen
    // Wert ab, legt ihn im jeweiligen Sheet an und übernimmt ihn ins Dropdown –
    // ohne den restlichen Formularinhalt zu verlieren
    const addNewLabels = { category: 'Kategorie', supplier: 'Lieferant', location: 'Lagerort' };
    const addNewPrompts = {
      category: 'Neue Kategorie eingeben:',
      supplier: 'Neuen Lieferanten eingeben:',
      location: 'Neuen Lagerort eingeben:',
    };
    function wireAddNewOption(selectEl, type, addFn, populateFn) {
      let prevValue = selectEl.value;
      selectEl.addEventListener('change', async () => {
        if (selectEl.value !== ADD_NEW_VALUE) { prevValue = selectEl.value; return; }
        const raw = window.prompt(addNewPrompts[type]);
        const value = (raw || '').trim();
        if (!value) { selectEl.value = prevValue; return; }

        selectEl.disabled = true;
        const result = await addFn(value);
        selectEl.disabled = false;

        if (result.status === 'ok' || result.status === 'already_exists') {
          const existing = Array.from(selectEl.options)
            .map((o) => o.value)
            .filter((v) => v && v !== ADD_NEW_VALUE);
          const match = existing.find((v) => v.toLowerCase() === value.toLowerCase());
          const updated = match ? existing : [...existing, value].sort((a, b) => a.localeCompare(b));
          const finalValue = match || value;
          populateFn(updated);
          selectEl.value = finalValue;
          prevValue = finalValue;
          persistBootstrapListValue(type, updated);
          log.info('main', `${addNewLabels[type]} "${finalValue}" hinzugefügt`);
        } else {
          setStatus(result.message || `${addNewLabels[type]} konnte nicht angelegt werden`, 'error');
          selectEl.value = prevValue;
        }
      });
    }
    wireAddNewOption(document.getElementById('lk-cat'), 'category', addCategory, populateCategoryDropdown);
    wireAddNewOption(document.getElementById('lk-sup'), 'supplier', addSupplier, populateSupplierDropdown);
    wireAddNewOption(document.getElementById('lk-loc'), 'location', addLocation, populateLocationDropdown);

    lookupConfirm.addEventListener('click', async () => {
      const vals = getLookupFormValues();
      if (!vals.name) { document.getElementById('lk-name').focus(); return; }
      // Herstellername aus Artikelname entfernen (Sicherheitsnetz falls manuell eingefügt)
      if (vals.hersteller) {
        const re = new RegExp(vals.hersteller.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        vals.name = vals.name.replace(re, '').replace(/\s+/g, ' ').trim();
      }
      const isEdit = !!editingProductId;
      lookupConfirm.disabled = true;
      lookupConfirm.textContent = 'Speichern…';
      try {
        if (isEdit) {
          await updateProduct({ id: editingProductId, ...vals });
          editingProductId = null;
          setLookupModal('hidden');
          setStatus('Produkteigenschaften aktualisiert ✓', 'ready');
          resetToEditField();
        } else {
          await addProduct(vals);
          // Neues Tupel sofort für die Vorauswahl verfügbar machen
          if (vals.ref && (vals.hersteller || vals.category || vals.hauptlieferant || vals.location)) {
            cachedRefMap.push([vals.ref, vals.hersteller, vals.category, vals.hauptlieferant, vals.location]);
          }
          // Dropdowns + refMap im Hintergrund neu laden, damit die neue
          // Kategorie/der Hersteller beim nächsten Produkt in Liste und Vorauswahl stehen
          refreshBootstrap().catch((err) => log.warn('main', `Bootstrap-Refresh fehlgeschlagen: ${err.message}`));
          setLookupModal('hidden');
          setStatus('Produkt angelegt ✓', 'ready');
          showLookupButton(false);
          resetToEditField();
        }
      } catch (err) {
        log.error('main', isEdit ? 'updateProduct fehlgeschlagen' : 'addProduct fehlgeschlagen', err);
        setStatus(`Fehler: ${err.message}`, 'error');
      }
      lookupConfirm.disabled = false;
      lookupConfirm.textContent = isEdit ? 'Speichern' : 'Bestätigen';
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
    setStatus('', 'working');  // nur der pulsierende orange Punkt während der OCR
    // Panels zurücksetzen vor neuem Scan
    showSupplierLinks([], '');
    showLookupButton(false);
    showReorderButton(false);
    setReorderState('idle');
    lastFoundProductId = null;
    setLookupModal('hidden');
    showStatusModal(false);
    await scheduleRecognition(canvas, (text, confidence) => {
      log.info('main', `OCR-Ergebnis: "${text || '–'}", Konfidenz=${confidence}%`);
      lastText       = text;
      lastConfidence = confidence;
      showResult(text, confidence);
      setStatus('', 'ready');  // REF erkannt: nur der grüne Punkt
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
  setStatus(`Modus: ${modeLabel(mode)} – scannen oder REF eingeben`, 'ready');
}

// Mode-Wechsel aus der Scan-Ansicht heraus (Wishlist Pkt. 4)
// Eingetippte REF bleibt erhalten, transiente UI-States werden zurückgesetzt.
function switchMode(mode) {
  userMode = mode;
  log.info('main', `Mode gewechselt: ${mode}`);
  setActiveModeSwitch(mode);
  // Modals + Sekundär-Buttons schließen
  editingProductId = null;
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
