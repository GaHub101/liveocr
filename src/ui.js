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

export function updateQueueBadge(count) {
  if (count > 0) {
    queueInfo.textContent = `${count} Einträge offline in Warteschlange – werden gesendet sobald Netzwerk verfügbar`;
    queueInfo.classList.add('visible');
  } else {
    queueInfo.classList.remove('visible');
  }
}
