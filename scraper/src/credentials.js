// Zugangsdaten pro Shop aus Umgebungsvariablen lesen.
//
// Env-Schlüssel: SHOP_CRED_<KEY> = JSON {"user":"…","pass":"…"}
// <KEY> wird per shopCredKey() aus dem Lieferantennamen abgeleitet – GLEICHE
// Transliteration wie serverseitig (apps-script/Preise.gs shopCredKey), damit
// dieselbe Namenskonvention gilt (z. B. "Henry Schein" → SHOP_CRED_HENRY_SCHEIN).

import { log } from './log.js';

export function shopCredKey(name) {
  let s = String(name || '').toUpperCase();
  s = s.replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS');
  s = s.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return 'SHOP_CRED_' + s;
}

// Liefert {user, pass} oder null. Werte werden NIE geloggt.
export function getShopCredentials(name) {
  const key = shopCredKey(name);
  const raw = process.env[key];
  if (!raw) {
    log.warn('creds', `${key} nicht gesetzt für Shop "${name}"`);
    return null;
  }
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.user != null && obj.pass != null) {
      return { user: String(obj.user), pass: String(obj.pass) };
    }
    log.warn('creds', `${key}: JSON ohne user/pass`);
  } catch {
    log.warn('creds', `${key}: JSON-Parse-Fehler`);
  }
  return null;
}
