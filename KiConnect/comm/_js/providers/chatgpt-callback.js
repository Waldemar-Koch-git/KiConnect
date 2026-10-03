import { identifyChatgptMessage } from './chatgpt-strings.js';
import { resolveTranslation } from '../core/translation-utils.js';

// This standalone page deliberately does not import the KiConnect app.
let selectedLang = document.documentElement.lang || 'en';
function translateCallback() {
  const lang = selectedLang;
  const element = document.getElementById('chatgptCallbackMessage');
  let metadata;
  try { metadata = JSON.parse(element.dataset.message); } catch { return; }
  const info = identifyChatgptMessage(metadata);
  if (info) {
    element.textContent = resolveTranslation(TRANSLATIONS, lang, info.key, info.vars);
  }
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
}

translateCallback();
window.addEventListener('storage', event => {
  if (event.key === 'kic_lang' && TRANSLATIONS[event.newValue]) {
    selectedLang = event.newValue;
    translateCallback();
  }
});

const state = new URL(location.href).searchParams.get('state');
async function syncLanguage() {
  if (!state) return;
  try {
    const response = await fetch('/auth/callback-language?state=' + encodeURIComponent(state), { cache: 'no-store' });
    if (response.status === 404) return;
    if (response.ok) {
      const result = await response.json();
      if (TRANSLATIONS[result.language] && result.language !== selectedLang) {
        selectedLang = result.language;
        translateCallback();
      }
    }
  } catch { /* Keep the last selected language if the proxy is stopped. */ }
  setTimeout(syncLanguage, 2000);
}
syncLanguage();
