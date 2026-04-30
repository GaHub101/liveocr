const MAX_ENTRIES = 300;
const STORAGE_KEY = 'ocr_log';

function write(level, source, message, detail) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    source,
    msg: String(message),
    ...(detail != null ? { detail: detail instanceof Error ? detail.stack || detail.message : String(detail) } : {}),
  };

  const entries = load();
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* storage full */ }

  const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.info;
  fn(`[${level}] ${source}: ${message}`, detail ?? '');
}

export const log = {
  info:  (source, message, detail) => write('INFO',  source, message, detail),
  warn:  (source, message, detail) => write('WARN',  source, message, detail),
  error: (source, message, detail) => write('ERROR', source, message, detail),
};

export function getLogs() {
  return load();
}

export function clearLogs() {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportLogs() {
  const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ocr-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
