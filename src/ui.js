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

export function showAvailability(results) {
  const panel = document.getElementById('avail-panel');
  const list  = document.getElementById('avail-list');
  if (!panel || !list) return;

  list.innerHTML = '';

  if (!results || results.length === 0) {
    panel.style.display = 'none';
    return;
  }

  results.forEach(r => {
    const row = document.createElement('div');
    row.className = 'avail-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'avail-name';
    nameEl.textContent = r.name;
    row.appendChild(nameEl);

    if (r.availability === 'not_found') {
      const span = document.createElement('span');
      span.className = 'avail-none';
      span.textContent = 'Nicht verfügbar';
      row.appendChild(span);
    } else {
      const a = document.createElement('a');
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener';
      if (r.availability === 'unknown') {
        a.className = 'avail-link unknown';
        a.textContent = 'Öffnen (nicht geprüft)';
      } else {
        a.className = 'avail-link';
        a.textContent = 'Im Browser öffnen →';
      }
      row.appendChild(a);
    }

    list.appendChild(row);
  });

  panel.style.display = 'block';
}

export function showAvailabilityLoading() {
  const panel = document.getElementById('avail-panel');
  const list  = document.getElementById('avail-list');
  if (!panel || !list) return;
  list.innerHTML = '<div class="avail-loading">Verfügbarkeit wird geprüft…</div>';
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
