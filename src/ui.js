const dot           = document.getElementById('status-dot');
const statusText    = document.getElementById('status-text');
const resultText    = document.getElementById('result-text');
const confBar       = document.getElementById('confidence-bar');
const confLabel     = document.getElementById('confidence-label');
const sendBtn       = document.getElementById('send-btn');
const queueInfo     = document.getElementById('queue-info');
const loadScreen    = document.getElementById('loading-screen');
const loadMsg       = document.getElementById('loading-msg');
const loadBar       = document.getElementById('loading-progress-bar');
const productBanner = document.getElementById('product-banner');
const productName   = document.getElementById('product-banner-name');

export function setStatus(msg, state = 'working') {
  statusText.textContent = msg;
  dot.className = state; // ready | working | error | offline
}

export function setLoadingMessage(msg, progress = null) {
  loadMsg.textContent = msg;
  if (progress !== null) loadBar.style.width = `${progress}%`;
}

export function hideLoading() {
  loadScreen.classList.add('hidden');
}

export function showResult(text, confidence) {
  resultText.textContent = text || '–';
  const pct = Math.round(confidence);
  confBar.style.width  = `${pct}%`;
  confBar.style.background = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
  confLabel.textContent = text ? `Konfidenz: ${pct}%` : '';
  sendBtn.disabled = !text;
}

export function setSendState(state) {
  if (state === 'sending') {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Füge hinzu…';
  } else if (state === 'sent') {
    sendBtn.textContent = 'Hinzugefügt ✓';
    setTimeout(() => {
      sendBtn.textContent = 'REF-Nr. hinzufügen';
      sendBtn.disabled = false;
    }, 2000);
  } else if (state === 'error') {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Fehler – Erneut versuchen';
    setTimeout(() => { sendBtn.textContent = 'REF-Nr. hinzufügen'; }, 3000);
  } else if (state === 'queued') {
    sendBtn.textContent = 'In Warteschlange ✓';
    setTimeout(() => {
      sendBtn.textContent = 'REF-Nr. hinzufügen';
      sendBtn.disabled = false;
    }, 2000);
  } else if (state === 'already_exists') {
    sendBtn.disabled = false;
    sendBtn.textContent = 'REF bereits vorhanden';
    setTimeout(() => { sendBtn.textContent = 'REF-Nr. hinzufügen'; }, 3000);
  }
}

export function showProductBanner(name, id) {
  productName.textContent = name ? `${name} (ID ${id})` : `ID ${id}`;
  productBanner.classList.add('visible');
}

export function hideProductBanner() {
  productBanner.classList.remove('visible');
}

export function showSupplierLinks(suppliers, ref) {
  const panel = document.getElementById('avail-panel');
  const list  = document.getElementById('avail-list');
  if (!panel || !list) return;

  list.innerHTML = '';

  if (!suppliers || suppliers.length === 0 || !ref) {
    panel.style.display = 'none';
    return;
  }

  suppliers.forEach(s => {
    const row = document.createElement('div');
    row.className = 'avail-row';
    if (s.primary) row.classList.add('avail-row--primary');

    const name = document.createElement('span');
    name.className   = 'avail-name';
    name.textContent = s.name;

    const a = document.createElement('a');
    a.className   = 'avail-link';
    a.href        = s.baseUrl + encodeURIComponent(ref);
    a.target      = '_blank';
    a.rel         = 'noopener';
    a.textContent = 'Öffnen →';

    row.appendChild(name);
    row.appendChild(a);
    list.appendChild(row);
  });

  panel.style.display = 'block';
}

// Prüf-Vorschau: aufgenommenes Standbild groß zeigen +
// „Senden" / „Neu aufnehmen"; Scan-Button solange ausblenden.
export function showReviewControls(visible) {
  const canvas = document.getElementById('canvas');
  const sendB  = document.getElementById('review-send-btn');
  const retake = document.getElementById('review-retake-btn');
  const scanB  = document.getElementById('scan-btn');
  if (canvas) canvas.classList.toggle('review', visible);
  if (sendB)  sendB.style.display  = visible ? 'block' : 'none';
  if (retake) retake.style.display = visible ? 'block' : 'none';
  if (scanB)  scanB.style.display  = visible ? 'none'  : 'block';
}

// Kamera-Umschalter (nur bei >1 Rückkamera)
export function showCameraSwitch(visible) {
  const btn = document.getElementById('cam-switch-btn');
  if (btn) btn.style.display = visible ? 'block' : 'none';
}

// Zoom-Regler (nur wenn die Kamera Zoom unterstützt)
export function showZoomControl(visible, caps) {
  const wrap = document.getElementById('zoom-wrap');
  const inp  = document.getElementById('zoom-range');
  if (wrap) wrap.style.display = visible ? 'flex' : 'none';
  if (visible && inp && caps) {
    inp.min   = caps.min;
    inp.max   = caps.max;
    inp.step  = caps.step || 0.1;
    inp.value = caps.value ?? caps.min;
  }
}

export function getZoomValue() {
  const inp = document.getElementById('zoom-range');
  return inp ? Number(inp.value) : null;
}

export function showLookupButton(show) {
  document.getElementById('lookup-btn').style.display = show ? 'block' : 'none';
}

export function showReorderButton(show) {
  document.getElementById('reorder-btn').style.display = show ? 'block' : 'none';
}

export function setReorderState(state) {
  const btn = document.getElementById('reorder-btn');
  if (!btn) return;
  if (state === 'idle') {
    btn.disabled = false;
    btn.textContent = 'Nachbestellen';
  } else if (state === 'sending') {
    btn.disabled = true;
    btn.textContent = 'Speichern…';
  } else if (state === 'sent') {
    btn.disabled = true;
    btn.textContent = 'Nachbestellen ✓';
  } else if (state === 'error') {
    btn.disabled = false;
    btn.textContent = 'Fehler – Erneut versuchen';
  }
}

export function setLookupModal(state, ref, suggestion) {
  const backdrop   = document.getElementById('lookup-backdrop');
  const loading    = document.getElementById('lookup-loading');
  const form       = document.getElementById('lookup-form');
  const confirmBtn = document.getElementById('lookup-confirm-btn');

  if (state === 'hidden') { backdrop.style.display = 'none'; return; }
  backdrop.style.display = 'flex';
  const refInput = document.getElementById('lk-ref');
  if (refInput) refInput.value = ref || '';
  loading.style.display    = state === 'loading' ? 'block' : 'none';
  form.style.display       = state === 'form'    ? 'block' : 'none';
  confirmBtn.style.display = state === 'form'    ? 'inline-block' : 'none';

  if (state === 'form') {
    ['lk-name','lk-hersteller','lk-manu','lk-cat','lk-sup','lk-loc','lk-status']
      .forEach(id => { document.getElementById(id).value = ''; });
    selectDefaultStatus();
    const status = document.getElementById('lk-suggest-status');
    if (status) status.textContent = '';
    const sBtn = document.getElementById('lk-suggest-btn');
    if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'Vorschlag laden'; }
  }
}

export function applyLookupSuggestion(suggestion) {
  const s = suggestion || {};
  if (s.hersteller)  document.getElementById('lk-manu').value = s.hersteller;
  if (s.artikelname) document.getElementById('lk-name').value = s.artikelname;
  // Herstellername aus Artikelname entfernen
  const nameEl = document.getElementById('lk-name');
  const manuEl = document.getElementById('lk-manu');
  if (nameEl && manuEl && manuEl.value) {
    const re = new RegExp(manuEl.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    nameEl.value = nameEl.value.replace(re, '').replace(/\s+/g, ' ').trim();
  }
}

export function setSuggestStatus(msg, state = 'idle') {
  const el  = document.getElementById('lk-suggest-status');
  const btn = document.getElementById('lk-suggest-btn');
  if (el)  el.textContent = msg;
  if (btn) {
    btn.disabled    = state === 'loading';
    btn.textContent = state === 'loading' ? 'Lade…' : 'Vorschlag laden';
  }
}

export function getLookupFormValues() {
  return {
    ref:            document.getElementById('lk-ref').value.trim(),
    name:           document.getElementById('lk-name').value.trim(),
    hersteller:     document.getElementById('lk-manu').value.trim(),
    category:       document.getElementById('lk-cat').value.trim(),
    hauptlieferant: document.getElementById('lk-sup').value.trim(),
    location:       document.getElementById('lk-loc').value.trim(),
    orderStatus:    document.getElementById('lk-status').value.trim(),
  };
}

export function updateQueueBadge(count) {
  if (count > 0) {
    queueInfo.textContent = `${count} Einträge offline in Warteschlange – werden gesendet sobald Netzwerk verfügbar`;
    queueInfo.classList.add('visible');
  } else {
    queueInfo.classList.remove('visible');
  }
}

// Mode-Selector (Wishlist Pkt. 1) – zeigt drei Optionen vor dem Scanmodus
export function showModeSelector(visible) {
  const sel = document.getElementById('mode-selector');
  if (!sel) return;
  sel.style.display = visible ? 'flex' : 'none';

  // Kamera + Ergebnis-Panel ausblenden, solange noch keine Aktion gewählt ist
  const cam   = document.getElementById('camera-container');
  const panel = document.getElementById('result-panel');
  if (cam)   cam.style.display   = visible ? 'none' : '';
  if (panel) panel.style.display = visible ? 'none' : '';
}

export function populateStatusDropdown(values) {
  const sel = document.getElementById('lk-status');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">– bitte wählen –</option>'
    + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (current && values.includes(current)) sel.value = current;
  else selectDefaultStatus();
}

// Vorauswahl "vorhanden" (Schreibweise aus dem Bestellstatus-Tab, case-insensitiv)
export function selectDefaultStatus() {
  const sel = document.getElementById('lk-status');
  if (!sel) return;
  for (const opt of sel.options) {
    if (opt.value.toLowerCase() === 'vorhanden') { sel.value = opt.value; return; }
  }
}

export function showSearchRefInput(show, prefillText = '', btnLabel = 'Suchen') {
  const inp    = document.getElementById('search-ref-input');
  const btn    = document.getElementById('search-confirm-btn');
  const resBox = document.getElementById('result-box');
  if (inp)    { inp.style.display = show ? 'block' : 'none'; if (show) inp.value = prefillText; }
  if (btn)    { btn.style.display = show ? 'block' : 'none'; if (show) btn.textContent = btnLabel; }
  if (resBox) resBox.style.display = show ? 'none' : '';
}

// Mode-Switcher (Wishlist Pkt. 4) – sichtbar in den drei Standalone-Modi
export function showModeSwitcher(visible) {
  const sw = document.getElementById('mode-switcher');
  if (sw) sw.style.display = visible ? 'flex' : 'none';
}

export function setActiveModeSwitch(mode) {
  document.querySelectorAll('.mode-switch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

export function populateLocationDropdown(locations) {
  const sel = document.getElementById('lk-loc');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">– bitte wählen –</option>'
    + locations.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  if (current && locations.includes(current)) sel.value = current;
}

// Hauptlieferant-Dropdown im "Neues Produkt"-Modal mit Lieferantennamen befüllen
export function populateSupplierDropdown(suppliers) {
  const sel = document.getElementById('lk-sup');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">– bitte wählen –</option>'
    + suppliers.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  if (current && suppliers.includes(current)) sel.value = current;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Bestellstatus-Modal (Option B – Produkt gefunden)
export function showStatusModal(visible, statusValues) {
  const backdrop = document.getElementById('status-backdrop');
  if (!backdrop) return;
  if (!visible) { backdrop.style.display = 'none'; return; }
  const sel = document.getElementById('status-select');
  if (sel && Array.isArray(statusValues)) {
    sel.innerHTML = statusValues.length === 0
      ? '<option value="">Keine Werte verfügbar</option>'
      : statusValues.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  }
  backdrop.style.display = 'flex';
  setStatusModalState('idle');
}

export function getStatusModalValue() {
  const sel = document.getElementById('status-select');
  return sel ? sel.value : '';
}

export function setStatusModalState(state) {
  const btn = document.getElementById('status-confirm-btn');
  if (!btn) return;
  if (state === 'idle')        { btn.disabled = false; btn.textContent = 'Speichern'; }
  else if (state === 'sending') { btn.disabled = true;  btn.textContent = 'Speichern…'; }
  else if (state === 'sent')    { btn.disabled = true;  btn.textContent = 'Gespeichert ✓'; }
  else if (state === 'error')   { btn.disabled = false; btn.textContent = 'Fehler – Erneut versuchen'; }
}

// Meldung "REF bereits vorhanden" (Option A) – Abbruch zurück zum Scannen oder REF bearbeiten
export function showRefExistsModal(show, ref, name) {
  const backdrop = document.getElementById('ref-exists-backdrop');
  if (!backdrop) return;
  backdrop.style.display = show ? 'flex' : 'none';
  if (show) {
    const text = document.getElementById('ref-exists-text');
    if (text) {
      text.textContent = `Die REF-Nr. "${ref}" ist bereits vorhanden`
        + (name ? ` (Produkt: "${name}")` : '') + '.';
    }
  }
}
