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
  const refLine    = document.getElementById('lookup-ref-line');

  if (state === 'hidden') { backdrop.style.display = 'none'; return; }
  backdrop.style.display = 'flex';
  if (ref) refLine.textContent = 'REF: ' + ref;
  loading.style.display    = state === 'loading' ? 'block' : 'none';
  form.style.display       = state === 'form'    ? 'block' : 'none';
  confirmBtn.style.display = state === 'form'    ? 'inline-block' : 'none';

  if (state === 'form') {
    const s = suggestion || {};
    document.getElementById('lk-name').value       = s.artikelname || '';
    document.getElementById('lk-hersteller').value = s.hersteller  || '';
    document.getElementById('lk-cat').value        = s.kategorie   || '';
    ['lk-sup','lk-alt1','lk-alt2','lk-alt3','lk-alt4','lk-code','lk-loc']
      .forEach(id => { document.getElementById(id).value = ''; });
  }
}

export function getLookupFormValues() {
  return {
    name:           document.getElementById('lk-name').value.trim(),
    hersteller:     document.getElementById('lk-hersteller').value.trim(),
    category:       document.getElementById('lk-cat').value.trim(),
    hauptlieferant: document.getElementById('lk-sup').value.trim(),
    alt1:           document.getElementById('lk-alt1').value.trim(),
    alt2:           document.getElementById('lk-alt2').value.trim(),
    alt3:           document.getElementById('lk-alt3').value.trim(),
    alt4:           document.getElementById('lk-alt4').value.trim(),
    articleCode:    document.getElementById('lk-code').value.trim(),
    location:       document.getElementById('lk-loc').value.trim(),
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
