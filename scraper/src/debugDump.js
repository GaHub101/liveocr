// Debug-Artefakte (Screenshot / HTML-Dump) nach scraper/debug/ schreiben.
// Verzeichnis ist gitignored. Dateiname enthält Shop, REF, Status, Zeitstempel.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

const DEBUG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'debug');

// Fehlerstatus, die (auch ohne --debug) ein Artefakt auslösen.
export const DUMP_STATUSES = new Set(['pattern_miss', 'not_found', 'login_failed', 'http_error']);

function slug(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
}

function baseName(shop, ref, status) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${slug(shop)}__${slug(ref)}__${slug(status)}__${stamp}`;
}

// HTML-Body (http-Modus). Gibt den geschriebenen Pfad zurück oder null.
export function dumpHtml(shop, ref, status, html) {
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    const path = join(DEBUG_DIR, baseName(shop, ref, status) + '.html');
    writeFileSync(path, String(html || ''));
    log.debug('debug', `HTML-Dump: ${path}`);
    return path;
  } catch (err) {
    log.warn('debug', `HTML-Dump fehlgeschlagen: ${err.message}`);
    return null;
  }
}

// Screenshot + HTML (browser-Modus). page = Playwright-Page. → Pfad oder null.
export async function dumpPage(page, shop, ref, status) {
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    const base = join(DEBUG_DIR, baseName(shop, ref, status));
    await page.screenshot({ path: base + '.png', fullPage: true });
    writeFileSync(base + '.html', await page.content());
    log.debug('debug', `Screenshot+HTML: ${base}.{png,html}`);
    return base + '.png';
  } catch (err) {
    log.warn('debug', `Page-Dump fehlgeschlagen: ${err.message}`);
    return null;
  }
}
