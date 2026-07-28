// ================================================================
// KI Connect – Internationalization (i18n) loader
// ================================================================
// The actual translated strings used to live in this one file and grew
// far too large (8000+ lines). They now live one file per language under
// _lang/<code>.js. This file only:
//   1. sets up the LANGUAGES/TRANSLATIONS registry that kiconnect.js reads,
//   2. lists which _lang/*.js files to load (LANG_MANIFEST below), and
//   3. loads them, in order, via document.write.
//
// To add a new language:
//   1. Copy _lang/en.js to _lang/<code>.js and translate every value.
//      Keep every key identical to _lang/en.js - kiconnect.js falls back
//      to English for any key that's missing.
//   2. Add one line to LANG_MANIFEST below (language code + its own
//      display meta lives in the _lang/<code>.js file itself, so nothing
//      else needs to change).
//   3. If the language is written right-to-left, add its code to
//      RTL_LANGS below too.
// That's it - kiconnect.js, the language dropdown, RTL handling etc. all
// pick the new language up automatically.
//
// Load this file BEFORE kiconnect.html's main <script> block (unchanged).
// ================================================================

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

// document.write here (while this very <script> tag is still being
// parsed) keeps every _lang/<code>.js load fully synchronous and in
// manifest order - exactly like a normal parser-blocking <script src>
// tag. That matters because kiconnect.js (the next <script> tag in
// kiconnect.html) reads LANGUAGES/TRANSLATIONS as soon as it starts
// running, so they must already be fully populated by then.
LANG_MANIFEST.forEach(function(code) {
  document.write('<script src="_lang/' + code + '.js"><\/script>');
});
