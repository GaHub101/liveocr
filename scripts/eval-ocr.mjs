// OCR-Testset auswerten: schickt jedes Foto aus testset/images/ an den
// OCR-Endpunkt und vergleicht die Antwort mit der erwarteten REF aus
// testset/labels.csv. Damit lässt sich jede Änderung an Prompt, Modell oder
// Bildgrösse messen statt schätzen.
//
//   APPS_SCRIPT_URL=… WEBHOOK_SECRET=… npm run eval:ocr
//   (liest ersatzweise VITE_APPS_SCRIPT_URL / VITE_WEBHOOK_SECRET aus .env.local)
//
// Hinweis: Die Fotos werden unverändert gesendet. Sie sollten deshalb etwa so
// zugeschnitten sein wie der Scan-Rahmen der App (Etikett füllt das Bild).
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setDir = path.join(root, 'testset');

async function envLocal() {
  const file = path.join(root, '.env.local');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, '').toUpperCase();
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const local  = await envLocal();
const url    = process.env.APPS_SCRIPT_URL || local.VITE_APPS_SCRIPT_URL;
const secret = process.env.WEBHOOK_SECRET  || local.VITE_WEBHOOK_SECRET;
if (!url || !secret) {
  console.error('APPS_SCRIPT_URL und WEBHOOK_SECRET setzen (oder .env.local anlegen).');
  process.exit(2);
}

const csvPath = path.join(setDir, 'labels.csv');
if (!existsSync(csvPath)) {
  console.error('testset/labels.csv fehlt – siehe testset/README.md.');
  process.exit(2);
}
const rows = (await readFile(csvPath, 'utf8'))
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split(/[;,]/).map((c) => c.trim()))
  .filter((c) => c[0].toLowerCase() !== 'datei');
if (!rows.length) {
  console.error('testset/labels.csv enthält keine Einträge.');
  process.exit(2);
}

const results = [];
for (const [file, expected] of rows) {
  const imgPath = path.join(setDir, 'images', file);
  if (!existsSync(imgPath)) { results.push({ file, expected, got: '', ok: false, ms: 0, note: 'Datei fehlt' }); continue; }
  const image    = (await readFile(imgPath)).toString('base64');
  const mimeType = MIME[path.extname(file).toLowerCase()] || 'image/jpeg';
  const t0 = performance.now();
  let got = '', note = '';
  try {
    const resp = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'ocr', image, mimeType, secret }) });
    const data = await resp.json();
    got = data.ref || '';
    if (data.status === 'error') note = data.message || 'Fehler';
  } catch (err) {
    note = err.message;
  }
  const ms = Math.round(performance.now() - t0);
  const ok = norm(got) === norm(expected);
  results.push({ file, expected, got, ok, ms, note });
  console.log(`${ok ? '✓' : '✗'} ${file.padEnd(28)} erwartet=${expected.padEnd(14)} gelesen=${(got || '–').padEnd(14)} ${ms} ms ${note}`);
}

const measured = results.filter((r) => r.ms > 0);
const hits   = results.filter((r) => r.ok).length;
const times  = measured.map((r) => r.ms).sort((a, b) => a - b);
const median = times.length ? times[Math.floor(times.length / 2)] : 0;
const p90    = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.9))] : 0;
console.log(`\nTreffer: ${hits}/${results.length} (${(100 * hits / results.length).toFixed(1)} %) · Median ${median} ms · P90 ${p90} ms`);

const outPath = path.join(setDir, 'last-run.json');
await writeFile(outPath, JSON.stringify({ date: new Date().toISOString(), hits, total: results.length, median, p90, results }, null, 2));
console.log(`Details: ${path.relative(root, outPath)}`);
process.exit(hits === results.length ? 0 : 1);
