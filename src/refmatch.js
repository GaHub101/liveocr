// Abgleich einer per OCR gelesenen REF mit den bereits bekannten REFs aus dem
// Sheet (bootstrap-refMap). Reine Funktionen ohne DOM/Netzwerk → testbar mit
// `npm test`.
//
// Idee: OCR-Fehler bei REF-Nummern sind fast immer (a) optisch verwechselbare
// Zeichen (0/O, 1/I/l, 8/B, 5/S, 2/Z), (b) verlorene/erfundene Trennzeichen
// oder (c) genau ein falsches, fehlendes oder zusätzliches Zeichen. Liegt die
// gelesene REF so nah an genau einer bekannten REF, ist das mit hoher
// Wahrscheinlichkeit die gemeinte.

const CONFUSABLE = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', B: '8', S: '5', Z: '2', G: '6' };

// Kanonische Form: Grossbuchstaben, ohne Trennzeichen, verwechselbare Zeichen
// auf einen Vertreter gefaltet. Nur für den Vergleich, nie zur Anzeige.
export function canonicalRef(ref) {
  const up = String(ref ?? '').toUpperCase().replace(/[\s\-_./\\]+/g, '');
  let out = '';
  for (const ch of up) out += CONFUSABLE[ch] ?? ch;
  return out;
}

// Levenshtein-Distanz mit frühem Abbruch, sobald `max` überschritten ist.
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const MIN_LEN_FOR_EDIT = 5;  // kürzere REFs: ein Zeichen Abweichung ist zu oft eine andere REF
const MAX_CANDIDATES   = 3;

// knownRefs: Array von REF-Strings.
// Rückgabe:
//   { type: 'exact', ref }            – REF steht (bis auf Gross/Klein/Leerzeichen) so im Sheet
//   { type: 'near',  candidates: [] } – nicht exakt, aber 1–3 sehr ähnliche bekannte REFs (beste zuerst)
//   { type: 'none' }                  – nichts Ähnliches bekannt (vermutlich neues Produkt)
export function matchRef(ref, knownRefs) {
  const raw = String(ref ?? '').trim();
  if (!raw || !Array.isArray(knownRefs) || !knownRefs.length) return { type: 'none' };

  const plain = raw.toUpperCase().replace(/\s+/g, '');
  const canon = canonicalRef(raw);
  const scored = new Map();  // bekannte REF → Score (kleiner = ähnlicher)

  for (const k of knownRefs) {
    const known = String(k ?? '').trim();
    if (!known) continue;
    if (known.toUpperCase().replace(/\s+/g, '') === plain) return { type: 'exact', ref: known };

    const kc = canonicalRef(known);
    let score = null;
    if (kc === canon) {
      score = 0;  // nur Trennzeichen/verwechselbare Zeichen verschieden
    } else if (Math.min(kc.length, canon.length) >= MIN_LEN_FOR_EDIT && editDistance(kc, canon, 1) === 1) {
      score = 1;  // genau ein Zeichen falsch, zu viel oder zu wenig
    }
    if (score !== null && (!scored.has(known) || scored.get(known) > score)) scored.set(known, score);
  }

  if (!scored.size) return { type: 'none' };
  const candidates = [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_CANDIDATES)
    .map(([known]) => known);
  return { type: 'near', candidates };
}
