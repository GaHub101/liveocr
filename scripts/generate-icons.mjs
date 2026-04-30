/**
 * Erzeugt einfache PNG-Icons für die PWA.
 * Ausführen mit: node scripts/generate-icons.mjs
 * Benötigt: npm install canvas  (nur lokal, nicht im Prod-Build)
 */
import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Hintergrund
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, size, size);

  // Abgerundetes QR-Icon
  const pad = size * 0.15;
  const r = size * 0.12;

  function roundRect(x, y, w, h, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  ctx.fillStyle = '#3b82f6';

  // 3 Ecken-Quadrate
  const sq = size * 0.25;
  roundRect(pad, pad, sq, sq, r); ctx.fill();
  roundRect(size - pad - sq, pad, sq, sq, r); ctx.fill();
  roundRect(pad, size - pad - sq, sq, sq, r); ctx.fill();

  // Innen-Punkte
  ctx.fillStyle = '#0f172a';
  const inner = sq * 0.55;
  const off = (sq - inner) / 2;
  ctx.fillRect(pad + off, pad + off, inner, inner);
  ctx.fillRect(size - pad - sq + off, pad + off, inner, inner);
  ctx.fillRect(pad + off, size - pad - sq + off, inner, inner);

  // Daten-Punkte (Mitte)
  ctx.fillStyle = '#3b82f6';
  const dot = size * 0.07;
  const cx = size / 2;
  const cy = size / 2;
  [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [0, 1]].forEach(([dx, dy]) => {
    ctx.beginPath();
    ctx.arc(cx + dx * dot * 1.4, cy + dy * dot * 1.4, dot * 0.5, 0, Math.PI * 2);
    ctx.fill();
  });

  return canvas.toBuffer('image/png');
}

writeFileSync(join(outDir, 'icon-192.png'), drawIcon(192));
writeFileSync(join(outDir, 'icon-512.png'), drawIcon(512));
console.log('Icons generiert: public/icons/icon-192.png, public/icons/icon-512.png');
