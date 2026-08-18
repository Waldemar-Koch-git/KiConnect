// KI Connect i18n loader. Strings live per-language in _lang/<code>.js
// (each calls registerLanguage()); this file just builds the registry
// and loads them in order. Load before kiconnect.html's main <script>.
//
// New language: copy _lang/en.js, translate values (keep keys - missing
// ones fall back to English), add its code to LANG_MANIFEST, and to
// RTL_LANGS if right-to-left. Everything else picks it up automatically.

// Populated by each _lang/*.js file calling registerLanguage() below.
const LANGUAGES = {};
const TRANSLATIONS = {};

// Language codes considered right-to-left (drives <html dir="rtl">
// in kiconnect.js). Add new RTL languages here.
const RTL_LANGS = ['ar', 'ur', 'fa'];

// Called once by every _lang/<code>.js file to register its strings.
function registerLanguage(code, meta, strings) {
  LANGUAGES[code] = meta;
  TRANSLATIONS[code] = strings;
}

// ── Manifest: which _lang/*.js files to load, and in which order ───
// Keep 'en' first: it's the fallback language, so it should always be
// present even if a later file fails to load for some reason.
const LANG_MANIFEST = [
  'en', 'de', 'fr', 'es', 'it', 'tr', 'ru', 'el', 'zh',
  'ar', 'hi', 'ta', 'bn', 'pa', 'ur', 'fa',
];

// document.write keeps loads synchronous and in order, like a normal
// blocking <script src> - required since kiconnect.js reads
// LANGUAGES/TRANSLATIONS as soon as it starts running.
LANG_MANIFEST.forEach(function(code) {
  document.write('<script src="_lang/' + code + '.js"><\/script>');
});
