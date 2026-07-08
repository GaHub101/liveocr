// Deutschen Preis-String in Zahl wandeln: '1.234,56' → 1234.56; '42,90 €' → 42.9.
// Port aus apps-script/Preise.gs (parseGermanPrice) – identische Semantik.
export function parseGermanPrice(str) {
  if (str == null) return null;
  let s = String(str).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.indexOf(',') >= 0) {
    // Komma = Dezimaltrennzeichen, Punkt = Tausender
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    // mehrere Punkte → Tausenderpunkte
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
