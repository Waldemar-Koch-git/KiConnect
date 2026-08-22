// i18n loader: builds LANGUAGES/TRANSLATIONS from _lang/<code>.js files.
// New language: copy _lang/en.js, translate, add code to LANG_MANIFEST
// (and RTL_LANGS if right-to-left).

const LANGUAGES = {};
const TRANSLATIONS = {};

// RTL language codes (drives <html dir="rtl">)
const RTL_LANGS = ['ar', 'ur', 'fa'];

function registerLanguage(code, meta, strings) {
  LANGUAGES[code] = meta;
  TRANSLATIONS[code] = strings;
}

// 'en' must stay first - it's the fallback language.
const LANG_MANIFEST = [
  'en', 'de', 'fr', 'es', 'it', 'tr', 'ru', 'el', 'zh',
  'ar', 'hi', 'ta', 'bn', 'pa', 'ur', 'fa',
];

// document.write for synchronous, ordered loading (kiconnect.js needs
// LANGUAGES/TRANSLATIONS populated immediately on startup).
LANG_MANIFEST.forEach(function(code) {
  document.write('<script src="_lang/' + code + '.js"><\/script>');
});
