const dot        = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const resultText = document.getElementById('result-text');
const confBar    = document.getElementById('confidence-bar');
const confLabel  = document.getElementById('confidence-label');
const sendBtn    = document.getElementById('send-btn');
const queueInfo  = document.getElementById('queue-info');
const loadScreen = document.getElementById('loading-screen');
const loadMsg    = document.getElementById('loading-msg');
const loadBar    = document.getElementById('loading-progress-bar');

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
    sendBtn.textContent = 'Sende…';
  } else if (state === 'sent') {
    sendBtn.textContent = 'Gesendet ✓';
    setTimeout(() => {
      sendBtn.textContent = 'An AppSheet senden';
      sendBtn.disabled = false;
    }, 2000);
  } else if (state === 'error') {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Fehler – Erneut versuchen';
    setTimeout(() => { sendBtn.textContent = 'An AppSheet senden'; }, 3000);
  } else if (state === 'queued') {
    sendBtn.textContent = 'In Warteschlange ✓';
    setTimeout(() => {
      sendBtn.textContent = 'An AppSheet senden';
      sendBtn.disabled = false;
    }, 2000);
  }
}

export function updateQueueBadge(count) {
  if (count > 0) {
    queueInfo.textContent = `${count} Einträge offline in Warteschlange – werden gesendet sobald Netzwerk verfügbar`;
    queueInfo.classList.add('visible');
  } else {
    queueInfo.classList.remove('visible');
  }
}
