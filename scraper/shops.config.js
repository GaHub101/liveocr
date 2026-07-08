// Scraper-Konfiguration pro external-Shop.
//
// Der Schlüssel (Objekt-Name) muss exakt dem "Lieferant" in PreisConfig /
// Lieferanten entsprechen (Groß/Klein egal). Die Such-URL kommt aus der
// Worklist (PreisConfig "Such-URL-Template"), hier nur Login + Preis-Extraktion.
//
// Zwei Modi:
//   mode: "http"     – ohne Browser, schnell. Kein JavaScript. Login per
//                      Formular-POST, Preis per CSS-Selektor (Cheerio) ODER Regex.
//   mode: "browser"  – Playwright Chromium. Führt JS aus, überwindet
//                      JS-gerenderte Preise / einfachen Bot-Schutz. Login per
//                      Formular-Selektoren, Preis per CSS-Selektor.
//
// Credentials NICHT hier, sondern in .env als SHOP_CRED_<KEY> (siehe .env.example).

export default {
  // ---- Beispiel: browser-Modus (JS-gerenderter Preis) --------------------
  'Beispiel Browser Shop': {
    mode: 'browser',
    loginUrl: 'https://shop.example.de/login',
    login: {
      userSelector: '#email',
      passSelector: '#password',
      submitSelector: 'button[type=submit]',
      checkSelector: 'text=Mein Konto', // optional: bestätigt erfolgreichen Login
    },
    priceSelector: '.product-detail-price', // CSS-Selektor des Preis-Elements
    notFoundSelector: '.search-no-results', // optional
    waitMs: 0, // optional: zusätzliche Wartezeit nach Navigation (ms)
  },

  // ---- Beispiel: http-Modus (Preis im HTML, Formular-Login) --------------
  'Beispiel HTTP Shop': {
    mode: 'http',
    loginUrl: 'https://shop.example.de/login/check',
    login: {
      loginPageUrl: 'https://shop.example.de/login', // optional: Cookie + CSRF
      tokenRegex: 'name="_csrf_token"\\s+value="([^"]+)"', // optional
      payload: 'email={{user}}&password={{pass}}&_csrf_token={{token}}',
      loginCheckRegex: 'Mein Konto', // optional
    },
    // Entweder Selektor (Vorrang) ODER Regex:
    priceSelector: '.price--content',
    priceRegex: '"price"\\s*:\\s*"([\\d.,]+)"',
    notFoundRegex: 'keine\\s+Artikel\\s+gefunden', // optional
  },
};
