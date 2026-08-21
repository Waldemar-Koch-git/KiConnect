// ================================================================
// kiconnect.js – KI Connect application logic
// Requires: kiconnect-languages-i18n.js (loaded before this file)
// ================================================================

// ── PDF.js worker wiring ─────────────────────────────────────────
// workerSrc must be set before the first getDocument() call (happens lazily
// inside extractPdfText()); merged here from the former kiconnect-pdf-init.js.
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '_render/pdf.worker.js';
  window._pdfjsLib = pdfjsLib;
}

// ── Theme ─────────────────────────────────────────────────────────
const THEMES = ['dark', 'white', 'nord', 'dracula', 'forest', 'mocha', 'rose', 'solarized', 'dark_oled', 'gold_oled', 'emerald_oled', 'red_oled'];

// Swatch data: [theme, label, tooltip]. The 12 near-identical HTML blocks
// these replace are now built by buildThemeSwatches().
const THEME_SWATCHES = [
  ['dark', 'Dark', 'Dark'], ['white', 'White', 'White'], ['nord', 'Nord', 'Nord'],
  ['dracula', 'Dracula', 'Dracula'], ['forest', 'Forest', 'Forest'],
  ['mocha', 'Mocha', 'Mocha'], ['rose', 'Rose', 'Rose'], ['solarized', 'Solar', 'Solarized'],
];
const THEME_SWATCHES_OLED = [
  ['dark_oled', 'Dark', 'Dark (OLED)'], ['gold_oled', 'Gold', 'Gold (OLED)'],
  ['emerald_oled', 'Emerald', 'Emerald (OLED)'], ['red_oled', 'Red', 'Red (OLED)'],
];

function buildThemeSwatches() {
  const saved = localStorage.getItem('kic_theme') || 'dark';
  [[THEME_SWATCHES, 'themeSwitcher'], [THEME_SWATCHES_OLED, 'themeSwitcherOled']].forEach(([list, id]) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.innerHTML = list.map(([theme, label, title]) =>
      '<div>' +
        `<div class="theme-swatch${theme === saved ? ' active' : ''}" data-theme="${theme}" title="${title}">` +
          '<div class="theme-swatch-inner"><div class="theme-swatch-top"></div>' +
          '<div class="theme-swatch-bottom"><span></span><span></span><span></span></div></div>' +
        '</div>' +
        `<div class="theme-swatch-label">${label}</div>` +
      '</div>').join('');
  });
}
buildThemeSwatches();

// Applies a theme to the document root, falls back to 'dark' if unknown.
function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'dark';
  document.documentElement.setAttribute('data-theme', name);
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.getAttribute('data-theme') === name);
  });
}

// Applies and persists the chosen theme.
function setTheme(name) {
  applyTheme(name);
  localStorage.setItem('kic_theme', name);
}

// Apply saved theme immediately (before DOMContentLoaded to avoid a flash).
(function() {
  const saved = localStorage.getItem('kic_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

// One delegated click listener on <body> handles both theme switchers. Bound here
// (not inline onclick) because the CSP blocks inline event-handler attributes.
document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', (e) => {
    const swatch = e.target.closest('.theme-swatch');
    if (swatch) setTheme(swatch.getAttribute('data-theme'));
  });
});


let currentLang = localStorage.getItem('kic_lang') || 'en';

// Translation lookup with English → raw-key fallback.
function t(key) {
  const lang = TRANSLATIONS[currentLang] || TRANSLATIONS['en'];
  return lang[key] ?? TRANSLATIONS['en'][key] ?? key;
}
// Like t(), but substitutes {placeholder} vars.
function tf(key, vars) {
  let s = t(key);
  if (vars) Object.entries(vars).forEach(([k,v]) => { s = s.replaceAll(`{${k}}`, v); });
  return s;
}

// ── Battle-Modus i18n ──────────────────────────────────────────────
// Same pattern as kiconnect-agent.js's TF_FALLBACKS: new strings go through
// the normal TRANSLATIONS table when a key exists there, but never show a
// raw key to the user if kiconnect-languages-i18n.js hasn't been touched —
// bt()/btf() fall back to this inline English text instead.
const BATTLE_FALLBACKS = {
  'battle.toggleTitle': 'Battle mode: let several models answer the same message at once',
  'battle.toggleLabel': 'Battle',
  'battle.pickModels': 'Pick 2–4 models to compare',
  'battle.needTwoModels': 'Pick at least 2 models for a battle.',
  'battle.tooManyModels': 'Pick at most 4 models — more gets cramped and expensive.',
  'battle.start': 'Start battle',
  'battle.cancel': 'Cancel',
  'battle.chooseWinner': '✓ Use this one',
  'battle.winnerChosen': 'In use',
  'battle.defaultBanner': 'No winner chosen yet — "{model}" will be used by default until you pick one.',
  'battle.pending': 'Waiting…',
  'battle.generating': 'Generating…',
  'battle.aborted': '[Generation stopped]',
  'battle.errorPrefix': 'Error: {e}',
  'battle.noProviderForModel': 'No working provider/API key configured for this model.',
  'battle.noModelsSelected': 'No models selected for the battle.',
  'battle.searchPlaceholder': 'Search models…',
  'battle.noModelFound': 'No model found',
};
function bt(key) { return t(key) === key ? (BATTLE_FALLBACKS[key] || key) : t(key); }
function btf(key, vars) {
  let s = bt(key);
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, v); });
  return s;
}
// Applies all data-i18n attributes for the current language.
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    const attr = el.getAttribute('data-i18n-attr');
    if (attr === 'placeholder') {
      el.placeholder = val;
    } else if (attr === 'title') {
      el.title = val;
    } else if (el.getAttribute('data-i18n-html')) {
      el.innerHTML = val;
    } else {
      el.textContent = val;
    }
  });
  const btn = document.getElementById('langBtnLabel');
  if (btn) btn.textContent = LANGUAGES[currentLang]?.code || currentLang.toUpperCase();
  document.documentElement.dir = (typeof RTL_LANGS !== 'undefined' ? RTL_LANGS : ['ar', 'ur']).includes(currentLang) ? 'rtl' : 'ltr';
  document.documentElement.lang = currentLang;
  if (typeof syncCustomDropdown === 'function') {
    const hiddenSel = document.getElementById('modelSelector');
    if (hiddenSel && !hiddenSel.value) syncCustomDropdown();
  }
}
// Switches the UI language, persists it, refreshes all language-dependent UI.
function setLang(code) {
  currentLang = code;
  localStorage.setItem('kic_lang', code);
  applyTranslations();
  if (typeof updateProfileBadge === 'function') updateProfileBadge();
  
  retranslateBubbleButtons();
  retranslateSuggestionChips();
  retranslateCodeBlockButtons();
  
  if (typeof updateThinkingIntensityUI === 'function') updateThinkingIntensityUI();
  if (typeof configureThinkingSlider === 'function') {
    const { modelId } = (typeof splitModelId === 'function' && config?.model)
      ? splitModelId(config.model) : { modelId: '' };
    configureThinkingSlider(modelId);
  }
  if (typeof syncCustomDropdown === 'function') syncCustomDropdown();
  if (typeof window._kicVoiceRetranslate === 'function') window._kicVoiceRetranslate();
  if (typeof window._kicAgentRetranslate === 'function') window._kicAgentRetranslate();
  if (typeof window._kicDbRetranslate === 'function') window._kicDbRetranslate();
  if (typeof renderSidebar === 'function') renderSidebar();
  // These panels build their content with t() at render time instead of
  // static data-i18n markup, so re-render them if open.
  if (document.getElementById('providerPanel')?.classList.contains('open') && typeof renderProviderList === 'function') renderProviderList();
  if (document.getElementById('profilePanel')?.classList.contains('open') && typeof renderProfileList === 'function') renderProfileList();
  if (document.getElementById('modelMaxPanel')?.classList.contains('open') && typeof renderModelMaxList === 'function') renderModelMaxList();
  if (document.getElementById('accountSelectView') && document.getElementById('accountSelectView').style.display !== 'none' && typeof renderAccountGrid === 'function') renderAccountGrid();
  renderLangDropdown();
  // During the tour language step: re-render the tour card in the new language,
  // keep the dropdown open so the checkmark is visible, and unlock the Next button.
  // The user then clicks Next themselves to continue the tour in their chosen language.
  if (_tourActive && TOUR_STEPS[_tourStepIndex]?.prep === 'language') {
    document.getElementById('langDropdown')?.classList.add('open');
    // Re-render tour card title + text in the newly chosen language
    const step = TOUR_STEPS[_tourStepIndex];
    const titleEl = document.getElementById('tourTitle');
    const textEl  = document.getElementById('tourText');
    if (titleEl) titleEl.textContent = t(step.title);
    if (textEl)  textEl.textContent  = t(step.text);
    // Enable the Next button now that a language has been selected
    const nextBtn = document.getElementById('tourNextBtn');
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.title = '';
    }
  } else {
    closeLangDropdown();
  }
}
// (Re)builds the language dropdown list, marking the currently active language.
function renderLangDropdown() {
  const dd = document.getElementById('langDropdown');
  if (!dd) return;
  dd.innerHTML = '';
  Object.entries(LANGUAGES).forEach(([code, info]) => {
    const div = document.createElement('div');
    div.className = 'lang-option' + (code === currentLang ? ' active' : '');
    div.textContent = info.label + (code === currentLang ? ' ✓' : '');
    div.addEventListener('click', () => setLang(code));
    dd.appendChild(div);
  });
}
// Opens/closes the language dropdown.
function toggleLangDropdown() {
  const dd = document.getElementById('langDropdown');
  if (!dd) return;
  renderLangDropdown();
  dd.classList.toggle('open');
}
// Closes the language dropdown.
function closeLangDropdown() {
  document.getElementById('langDropdown')?.classList.remove('open');
}

// Updates the text of existing bubble action buttons and personal-note UI in place after a language change, without a full re-render.
function retranslateBubbleButtons() {
  document.querySelectorAll('.bubble-act-btn[data-action]').forEach(btn => {
    const action = btn.getAttribute('data-action');
    const keyMap = {
      'copy': 'js.copy', 'copy-formatted': 'js.copyFormatted', 'edit': 'js.edit', 'branch': 'js.branch',
      'regenerate': 'js.regenerate', 'delete': 'js.delete'
    };
    if (keyMap[action]) btn.textContent = t(keyMap[action]);
    if (action === 'copy-formatted') btn.title = t('js.copyFormattedTitle');
  });
  // retranslate personal notes in place (cheap DOM walk, no full re-render,
  // preserves scroll position, open/closed state and any text currently being typed)
  document.querySelectorAll('.note-holder').forEach(holder => {
    const toggleBtn = holder.querySelector('.note-toggle-btn');
    const noteBox    = holder.querySelector('.note-box');
    const textarea   = holder.querySelector('.note-textarea');
    const deleteBtn  = holder.querySelector('.note-delete-btn');
    const headerLbl  = holder.querySelector('.note-box-header span');
    const preview    = holder.querySelector('.note-render');
    const printCopy  = holder.querySelector('.note-print');
    if (!toggleBtn) return;
    const hasNote = toggleBtn.classList.contains('has-note');
    const isOpen  = !!(noteBox && noteBox.style.display !== 'none');
    toggleBtn.innerHTML = hasNote
      ? `🗒️ ${escHtml(t('js.noteLabel'))} <span class="note-caret">${isOpen ? '▴' : '▾'}</span>`
      : `<span class="note-plus">+</span> ${escHtml(t('js.noteAdd'))}`;
    if (headerLbl) headerLbl.textContent = '🗒️ ' + t('js.noteLabel');
    if (deleteBtn) deleteBtn.title = t('js.noteDelete');
    if (textarea)  textarea.placeholder = t('js.notePlaceholder');
    if (preview)   preview.title = t('js.noteEditHint');
    if (printCopy) printCopy.dataset.label = t('js.noteLabel');
  });
}

// Re-translate buttons above quoted code ``` x ``` into selected language
function retranslateCodeBlockButtons(root = document) {
  root.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    const isDone = btn.classList.contains('done');
    btn.textContent = isDone ? t('js.copied') : t('js.codeCopy');
  });

  root.querySelectorAll('.code-collapse-btn').forEach(btn => {
    const block = btn.closest('.code-block');
    const collapsed = !!block?.classList.contains('collapsed');
    const label = collapsed
      ? (t('js.codeExpand') || 'Expand')
      : (t('js.codeCollapse') || 'Collapse');

    btn.title = label;
    //btn.setAttribute('aria-label', label);
  });
}


// Re-applies translated labels to the starter suggestion chips shown on an empty chat.
function retranslateSuggestionChips() {
  const suggestions = [
    { i18n: 'empty.quantum', msgKey: 'empty.quantumMsg' },
    { i18n: 'empty.python',  msgKey: 'empty.pythonMsg' },
    { i18n: 'empty.mlvsdl',  msgKey: 'empty.mlvsdlMsg' },
    { i18n: 'empty.integral',msgKey: 'empty.integralMsg' },
  ];
  const chipsContainer = document.getElementById('suggestionChips');
  if (!chipsContainer) return;
  const chips = chipsContainer.querySelectorAll('.suggestion-chip');
  chips.forEach((chip, i) => {
    if (suggestions[i]) chip.textContent = t(suggestions[i].i18n);
  });
}

document.addEventListener('click', e => {
  // Don't close the language dropdown when the tour is showing it for selection
  if (_tourActive && TOUR_STEPS[_tourStepIndex]?.prep === 'language') return;
  const switcher = document.getElementById('langSwitcher');
  if (switcher && !switcher.contains(e.target)) closeLangDropdown();
});

// ─── Konstanten ───────────────────────────────────────────────────
const PROFILE_COLORS = ['#3d7eff','#7c5cfc','#2ecc71','#e74c3c','#f39c12','#1abc9c','#e91e63','#ff6b35'];
// Labels = the company operating the API, not the model name. 'google' was 'gemini'
// and 'zhipu' was 'glm' (see LEGACY_PROVIDER_TYPE_MAP in decryptProvider()).
const PROVIDER_TYPES = {
  'openai-compat':   { label:'OpenAI-kompatibel (...)',	           needsUrl:true  },
  'kiconnect-nrw':   { label:'KI Connect NRW (Gateway)',           needsUrl:false },
  'anthropic':       { label:'Anthropic (Claude)',                 needsUrl:false },
  'openai-direct':   { label:'OpenAI (GPT, o-Serie)',              needsUrl:false },
  'openrouter':      { label:'OpenRouter (Model-Broker, 200+)',    needsUrl:false },
  'mistral':         { label:'Mistral AI (Large, Small, Nemo)',    needsUrl:false },
  'google':          { label:'Google (Gemini)',                    needsUrl:false },
  'xai':             { label:'xAI (Grok)',                         needsUrl:false },
  'groq':            { label:'Groq (Llama, Model-Broker)',         needsUrl:false },
  'deepseek':        { label:'DeepSeek (v4)',                      needsUrl:false },
  'minimax':         { label:'MiniMax AI (MiniMax)',               needsUrl:false },
  'zhipu':           { label:'Zhipu AI / Z.ai (GLM)',              needsUrl:false },
  'kimi':            { label:'Moonshot AI (Kimi)',                 needsUrl:false },
};
const PROVIDER_HINTS = {
  'openai-compat':  '💡 Server URL + opt. API Key · for LM Studio, Ollama, custom instances … · non-localhost addresses need a one-time double confirmation',
  'kiconnect-nrw':  '💡 API Key : chat.kiconnect.nrw · KI Connect NRW · OpenAI-compatible',
  'anthropic':      '💡 API Key : console.anthropic.com · 🧠 Extended Thinking Claude 3/4/5+',
  'openai-direct': '💡 API Key : platform.openai.com · 🧠 with Reasoning',
  'openrouter':    '💡 API Key : openrouter.ai · 200+ models loaded live · 🧠 with Reasoning models',
  'mistral':       '💡 API Key : console.mistral.ai · Models are loaded live',
  'google':        '💡 API Key : aistudio.google.com (AI Studio) · Models are loaded live',
  'xai':           '💡 API Key : console.x.ai · Grok with optional 🧠 Thinking',
  'groq':          '💡 API Key : console.groq.com · Ultra-fast inference · Models live',
  'deepseek':      '💡 API Key : platform.deepseek.com · Models loaded live, reasoning for v4',
  'minimax':       '💡 API Key : platform.minimax.io · OpenAI-compatible · Models loaded live',
  'zhipu':         '💡 API Key : z.ai · OpenAI-compatible · 🧠 Thinking for GLM models',
  'kimi':          '💡 API Key : platform.moonshot.ai · OpenAI-compatible · lange Kontexte · 🧠 Thinking bei K2-Thinking/K3',
};
// Static entries for providers without live model metadata (Anthropic/Claude are
// handled by regex in isThinkingCapable()).
const THINKING_MODELS = new Set([
  'o1','o1-mini','o1-pro','o3','o3-mini','o4-mini','o4-mini-high',
  'gpt-4.5-preview','gpt-4.1','gpt-4.1-mini',
]);

// KNOWN_MODELS: used only as metadata fallback (maxOutput, vision) when the live API
// doesn't provide these values. The display list is always built dynamically from fetchModels().
// Last reviewed 2026-07-23 against each provider's live docs. See chat notes for sources/rationale.
const KNOWN_MODELS = {
  // ── Anthropic ── Opus 4.1 (legacy) retiring 2026-08-05; Sonnet 4/Opus 4 retired 2026-06-15;
  // Claude 3.7 Sonnet + 3.5 Haiku retired 2026-02-19; Claude 3 Opus retired 2026-01-05;
  // Claude 3.5 Sonnet (both snapshots) retired 2025-10-28. All removed below — calls to those
  // IDs now error out on the API. Fable 5 / Mythos 5 launched 2026-06-09 (briefly export-controlled
  // 2026-06-12 to 2026-07-01, now restored).
  'claude-fable-5':             { label:'Claude Fable 5 (top capability)', maxOutput:128000, vision:true  },
  'claude-opus-4-8':            { label:'Claude Opus 4.8',           maxOutput:128000, vision:true  },
  'claude-sonnet-5':            { label:'Claude Sonnet 5',           maxOutput:128000, vision:true  },
  'claude-haiku-4-5-20251001':  { label:'Claude Haiku 4.5',          maxOutput:64000,  vision:true  },
  'claude-opus-4-6':            { label:'Claude Opus 4.6 (legacy)',  maxOutput:32000,  vision:true  },
  'claude-sonnet-4-6':          { label:'Claude Sonnet 4.6 (legacy)',maxOutput:64000,  vision:true  },

  // ── OpenAI ── the o1/o3/o4-mini and GPT-4o/4.1/4.5/4-turbo lines were pulled from ChatGPT on
  // 2026-02-13 / 2026-06-27 and the API deprecation wave already removed 18 snapshots on
  // 2026-07-23 (today), with o3, o4-mini, gpt-4-turbo scheduled for 2026-10-23 and the last GPT-5/
  // o3 snapshots for 2026-12-11. Current line is GPT-5.3/5.4/5.5 (all 1M-ish context, 128k output).
  'gpt-5.5':                    { label:'GPT-5.5',                   maxOutput:128000, vision:true  },
  'gpt-5.4':                    { label:'GPT-5.4 (Thinking)',        maxOutput:128000, vision:true  },
  'gpt-5.4-mini':                { label:'GPT-5.4 mini',              maxOutput:128000, vision:true  },
  'gpt-5.3-codex':              { label:'GPT-5.3 Codex',             maxOutput:128000, vision:true  },

  // ── Mistral ── these three are '-latest' aliases, so they auto-resolve to the current
  // generation (Large 3 / Medium 3.5 / Small 4) without needing an update here; context grew to
  // ~256k in the process. codestral-latest / mistral-nemo are older but still served.
  'mistral-large-latest':       { label:'Mistral Large (3)',         maxOutput:131072, vision:true  },
  'mistral-medium-latest':      { label:'Mistral Medium (3.5)',      maxOutput:131072, vision:false },
  'mistral-small-latest':       { label:'Mistral Small (4)',         maxOutput:131072, vision:true  },
  'codestral-latest':           { label:'Codestral',                 maxOutput:131072, vision:false },
  'mistral-nemo':               { label:'Mistral Nemo',              maxOutput:131072, vision:false },

  // ── Google ── the entire 2.0/1.5 generation is shut down; Gemini moved to the 3.x family.
  'gemini-3-pro':               { label:'Gemini 3 Pro',              maxOutput:65536,  vision:true  },
  'gemini-3-flash':             { label:'Gemini 3 Flash',            maxOutput:65536,  vision:true  },
  'gemini-3.5-flash':           { label:'Gemini 3.5 Flash',          maxOutput:65536,  vision:true  },
  'gemini-3.5-flash-lite':      { label:'Gemini 3.5 Flash Lite',     maxOutput:65536,  vision:true  },

  // ── xAI ── Grok 3/2 are gone; Grok 4.5 (2026-07-08) is the current flagship. xAI's own docs
  // give it a 500k context window (third-party trackers disagree, so treat context figures for
  // Grok with some caution and check console.x.ai before relying on an exact number).
  'grok-4.5':                   { label:'Grok 4.5',                  maxOutput:128000, vision:true  },
  'grok-4':                     { label:'Grok 4',                    maxOutput:128000, vision:true  },

  // ── Groq ── Groq deprecated llama-4-maverick, kimi-k2-instruct-0905 and gemma2-9b-it during
  // 2026 in favor of gpt-oss-120b; mixtral-8x7b and the un-versioned llama3-70b-8192 are long gone
  // from Groq's console. Kept llama-3.3-70b / llama-3.1-8b since Groq still serves them.
  'llama-3.3-70b-versatile':    { label:'Llama 3.3 70B',             maxOutput:32768,  vision:false },
  'llama-3.1-8b-instant':       { label:'Llama 3.1 8B',              maxOutput:8000,   vision:false },
  'openai/gpt-oss-120b':        { label:'GPT-OSS 120B (via Groq)',   maxOutput:32768,  vision:false },

  // ── DeepSeek ── ⚠️ deepseek-chat / deepseek-reasoner retire 2026-07-24 15:59 UTC (i.e. tomorrow
  // relative to today) and currently just alias to deepseek-v4-flash. Migrate configs to the v4
  // IDs directly. V4 context is 1M, max output is 384k for both Pro and Flash.
  'deepseek-v4-pro':            { label:'DeepSeek V4 Pro',           maxOutput:384000, vision:false },
  'deepseek-v4-flash':          { label:'DeepSeek V4 Flash',         maxOutput:384000, vision:false },

  // ── Moonshot AI (Kimi) / Zhipu (GLM) ── kimi-k3 (2026-07-16) is the current flagship, k2.6 /
  // k2.7-code / k2.5 remain available as cheaper predecessors.
  'kimi-k3':                    { label:'Kimi K3',                   maxOutput:262144, vision:false },
  'kimi-k2.6':                  { label:'Kimi K2.6',                 maxOutput:131072, vision:false },
  'kimi-k2.7-code':             { label:'Kimi K2.7 Code',             maxOutput:131072, vision:false },
  'kimi-k2.5':                  { label:'Kimi K2.5',                 maxOutput:131072, vision:true  },
  'moonshot-v1-128k':           { label:'Moonshot v1 128k',          maxOutput:131072, vision:false },
  'glm-5.2':                    { label:'GLM-5.2',                   maxOutput:131072, vision:false },
};
const CLAUDE_MODELS  = Object.entries(KNOWN_MODELS).filter(([id])=>id.startsWith('claude')).map(([id,m])=>({id,...m}));
const OPENAI_MODELS  = Object.entries(KNOWN_MODELS).filter(([id])=>id.startsWith('gpt')||id.startsWith('o')).map(([id,m])=>({id,...m}));

// ── Image storage limit (user-configurable, default 500 KB) ──────
// Kept in localStorage as 'kic_max_img_bytes' (plain, not sensitive).
const DEFAULT_MAX_IMAGE_STORAGE_BYTES = 500 * 1024;
// Returns the configured max image size in bytes (default if unset).
function getMaxImageStorageBytes() {
  const v = parseInt(localStorage.getItem('kic_max_img_bytes') || '0');
  return v > 0 ? v : DEFAULT_MAX_IMAGE_STORAGE_BYTES;
}
function setMaxImageStorageBytes(bytes) {
  localStorage.setItem('kic_max_img_bytes', String(bytes));
}

// ── OpenRouter model-meta cache (localStorage) ───────────────────
let _orModelMeta = {};
(function _loadOrCache() {
  try {
    const raw = localStorage.getItem('kic_or_model_meta');
    if (raw) _orModelMeta = JSON.parse(raw);
  } catch(e) { _orModelMeta = {}; }
})();
function _saveOrCache() {
  try { localStorage.setItem('kic_or_model_meta', JSON.stringify(_orModelMeta)); } catch(e) {}
}

// ── Anthropic model-capabilities cache (localStorage) ────────────
// Filled from the live /v1/models API in fetchModels(); per-model flags
// (adaptiveThinking, noTemperature) avoid hard-coded model-name checks.
let _anthropicModelCaps = {};
(function _loadAnthropicCaps() {
  try {
    const raw = localStorage.getItem('kic_anthropic_model_caps');
    if (raw) _anthropicModelCaps = JSON.parse(raw);
  } catch(e) { _anthropicModelCaps = {}; }
})();
function _saveAnthropicCaps() {
  try { localStorage.setItem('kic_anthropic_model_caps', JSON.stringify(_anthropicModelCaps)); } catch(e) {}
}

// Claude generations that PREDATE extended-thinking support. Opt-out list
// (not opt-in) so new releases are auto-recognized as thinking-capable —
// "unknown new model" defaults to modern, the safer default.
const CLAUDE_NO_THINKING_RE = /^claude-(instant|2(\.\d+)?(-|$)|3-(opus|sonnet|haiku)(-|$)|3-5-(sonnet|haiku))/i;
// Claude 3.7 Sonnet: has extended thinking, but via the legacy
// type:"enabled" + budget_tokens format rather than adaptive effort.
const CLAUDE_LEGACY_THINKING_RE = /^claude-3-7-sonnet/i;

// True for modern (Claude 4+) models — i.e. not in the legacy opt-out lists.
function _isModernClaudeGen(bare) {
  return /^claude-/i.test(bare) && !CLAUDE_NO_THINKING_RE.test(bare) && !CLAUDE_LEGACY_THINKING_RE.test(bare);
}

// True when a Claude model uses adaptive thinking (type:"adaptive" + output_config.effort)
// instead of the legacy type:"enabled" + budget_tokens format; regex fallback for unseen models.
function isAdaptiveThinkingModel(modelId) {
  if (!modelId) return false;
  const bare = modelId.split('/').pop();
  if (_anthropicModelCaps[bare]?.adaptiveThinking != null) return _anthropicModelCaps[bare].adaptiveThinking;
  // Regex fallback: Claude 4+ (any family, any version number) uses adaptive;
  // Claude 3.7 Sonnet and earlier use the legacy budget_tokens format.
  return _isModernClaudeGen(bare);
}

// True when a Claude model accepts temperature (extended-thinking models reject
// it); regex fallback for models not yet fetched from the live API.
function isTemperatureSupported(modelId) {
  if (!modelId) return true;
  const bare = modelId.split('/').pop();
  if (_anthropicModelCaps[bare]?.noTemperature != null) return !_anthropicModelCaps[bare].noTemperature;
  // All current Claude 4+ models drop temperature support
  return !_isModernClaudeGen(bare);
}

// Default max-output-tokens: known model → cached OpenRouter meta → name heuristics.
function getModelDefaultMax(modelId) {
  if (!modelId) return 8096;
  const known = KNOWN_MODELS[modelId];
  if (known) return known.maxOutput;
  const orMeta = _orModelMeta[modelId];
  if (orMeta?.maxOutput && orMeta.maxOutput > 0) return orMeta.maxOutput;
  if (/llama-?3.*70b|llama-?3.*8b|llama-?3\.3/i.test(modelId)) return 32768;
  if (/llama-?3/i.test(modelId)) return 8192;
  if (/gpt-oss/i.test(modelId)) return 32768;
  if (/mixtral/i.test(modelId)) return 32768;
  if (/mistral/i.test(modelId)) return 32768;
  if (/gemma/i.test(modelId)) return 8192;
  if (/deepseek-v4/i.test(modelId)) return 384000;
  if (/deepseek-r|reasoner/i.test(modelId)) return 8192;
  if (/^gpt-5/i.test(modelId)) return 128000;
  if (/gpt-4/i.test(modelId)) return 8192;
  if (/gemini-3/i.test(modelId)) return 65536;
  if (/gemini/i.test(modelId)) return 8192;
  if (/^kimi-k3/i.test(modelId)) return 262144;
  if (/^kimi-|^moonshot-/i.test(modelId)) return 131072;
  if (/grok-4/i.test(modelId)) return 128000;
  if (/grok/i.test(modelId)) return 131072;
  if (/^glm-(5|4\.[67])/i.test(modelId)) return 131072;
  if (/^glm-4\.5/i.test(modelId)) return 98304;
  if (/^glm-4-32b/i.test(modelId)) return 16384;
  return 4096;
}
// Effective max-output-tokens: user override if set, otherwise the default.
function getModelMaxOutput(modelId) {
  if (!modelId) return 8096;
  const override = config.userModelMaxOverrides?.[modelId];
  if (override && override > 0) return override;
  return getModelDefaultMax(modelId);
}

// ── STATE ─────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  model: '', temperature: 0.7, maxTokens: null, systemPrompt: '',
  activeProfileId: null, userModelMaxOverrides: {}, chatMaxWidth: 880,
  thinkingEnabled: false, thinkingIntensity: 2, thinkingBudget: 8000,
  webSearchMode: 'manual', webSearchEngine: 'free', webSearchApiKey: '', webSearchResultCount: 8,
  webSearchEnabled: false, webLinkEnabled: false,
  // TTS/STT provider API keys (OpenAI, ElevenLabs, Groq). Lives inside `config` (not
  // localStorage) so it goes through the same AES-GCM-256 encrypt/decrypt cycle as
  // everything else in save()/load(). Read (read-only) by kiconnect-voice.js.
  audioProviders: { openai: { apiKey: '' }, elevenlabs: { apiKey: '', voiceId: '' }, groq: { apiKey: '' }, gemini: { apiKey: '' }, gcloud: { apiKey: '' } },
};
// Returns a deep copy of DEFAULT_CONFIG, used to initialize or reset app configuration.
function freshConfig() { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
let config = freshConfig();
let providers = [];
let profiles  = [];
let folders   = [];
let profileFolders = [];   // NEW: folders for organizing agent profiles (separate from chat folders)
// Collapsed state of the "No Folder" group (pure UI state → localStorage).
let unfiledProfilesCollapsed = localStorage.getItem('kic_unfiled_profiles_collapsed') === '1';
let chats     = [];
let currentChatId   = null;
let activeFolderId  = undefined;
let attachments     = [];

// ── Run registry (one RunState per in-flight generation) ──
// Every in-flight generation (chat stream, and — mirrored in
// kiconnect-agent.js — agent run) gets its own RunState, keyed by a unique
// runId, instead of a single shared global. This is what lets a streaming
// answer survive a chat switch: the registry is the source of truth, the
// DOM bubble is just a projection of it that renderMessages() can
// rebuild/reattach at any time.
//
// RunState shape: { runId, chatId, kind, provider, model, abortController,
//   text, thinkingText, usage, status, bubbleEl, targetContainer, onDone }
// `bubbleEl` is the CURRENT live DOM node for this run, or null when the
// owning chat isn't the one on screen right now — always re-read from the
// registry, never captured in a closure, so a stale/detached node is never
// written into.
const activeRuns = new Map();

// Pure UI state for the composer's model multi-select (Battle-Modus) — not
// persisted, resets to "off" on reload same as e.g. selectedLinkUrls. When
// active and >=2 models are picked, sendMessage() calls sendBattleMessage()
// instead of the normal single-model sendMessageCore().
let battleModeActive = false;
let battleSelectedModels = [];

// Builds a reasonably-unique run id. Prefixed with the chat id purely to
// make runIds readable in the DOM (data-run-id) / devtools; uniqueness comes
// from the timestamp + random suffix, not the prefix.
function _makeRunId(chatId) {
  return `${chatId || currentChatId || 'x'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
// Returns this run's live bubble element, but only if it's actually still
// attached to the document — i.e. the chat it belongs to is the one
// currently rendered. Every DOM write during streaming must go through this
// (never through a captured `aiEl`/`streamEl` local), so that switching away
// from a chat mid-stream simply stops touching the DOM instead of throwing
// or writing into a detached node.
function _runBubbleEl(run) {
  return (run && run.bubbleEl && run.bubbleEl.isConnected) ? run.bubbleEl : null;
}
// Records the latest streamed text/usage for a run so an aborted/backgrounded
// stream can still be saved (or reattached) with whatever was generated so
// far, even while its chat isn't on screen. Replaces `_rememberStreamSnapshot`.
function _updateRunText(runId, text, usageData, thinkingText) {
  const run = activeRuns.get(runId);
  if (!run) return;
  run.text = text || '';
  if (usageData !== undefined) run.usage = usageData || null;
  // thinkingText kept separately (not just embedded in `text`'s stored
  // <thinking> block) so a reattached live bubble can hand it straight to
  // renderStreamingBubble() without having to re-parse the stored format.
  if (thinkingText !== undefined) run.thinkingText = thinkingText;
}

// ── Per-chat streaming state ───────────────────────────────
// A chat can only ever have one turn running at a time (Battle-Modus's
// several-variants-for-one-turn is the exception), but DIFFERENT chats can
// each have their own in-flight run, fully independent of one another.
// `kind` covers both chat streams and agent runs (kiconnect-agent.js shares
// this same registry), so this one check works for both without either
// module needing to know about the other's flag.
function isChatStreaming(chatId) {
  if (!chatId) return false;
  for (const run of activeRuns.values()) {
    if (run.chatId === chatId && run.status === 'running') return true;
  }
  return false;
}
// The actual running run(s) for a chat, not just yes/no — used wherever the
// run itself (its abortController, kind, ...) is needed, e.g. stopStreaming().
// Normally 0 or 1 entries (see isChatStreaming above); returns an array
// rather than a single value since Battle-Modus can have several concurrent
// runs for the SAME chat.
function runsForChat(chatId) {
  return [...activeRuns.values()].filter(r => r.chatId === chatId && r.status === 'running');
}
// Reflects the composer's send/stop button to whichever chat is CURRENTLY
// ON SCREEN — never "is anything streaming anywhere in the app", which is
// what the old single global `isStreaming` amounted to. Call this after
// anything that can change either: switchChat/newChat/deleteChat, and
// whenever a run starts or finishes (paralleling the old inline
// `setSendMode('stop'/'send')` calls, which used to be safe to do
// unconditionally because there was only ever one stream in the whole app).
function syncComposerStreamingUI() {
  setSendMode(isChatStreaming(currentChatId) ? 'stop' : 'send');
}

// ── Auto-scroll behaviour ───────────────────────────────────────────
// The list stays pinned to the bottom while streaming unless the user scrolls
// up (unpin → position kept when the stream ends); scrolling down re-pins.
let AUTO_SCROLL_DURING_STREAM = false;
let pinnedToBottom = true;
// True when the message list is within `threshold` px of the bottom.
function isMessagesNearBottom(threshold) {
  const c = document.getElementById('messages');
  if (!c) return true;
  return c.scrollHeight - c.scrollTop - c.clientHeight < (threshold || 80);
}
let editingProfileId  = null;
let editingProviderId = null;
let draggedChatId   = null;
let draggedFolderId = null;   // NEW: folder drag state
let draggedProfileId = null;         // NEW: profile drag state (moving/reordering profiles)
let draggedProfileFolderId = null;   // NEW: profile-folder drag state (reordering folders)
let sidebarCollapsed = false;
let webSearchCache = new Map();
let selectedLinkUrls = new Set();
let ignoredLinkUrls = new Set();
const WEB_SEARCH_RESULT_MAX = 30;
// Multi-select state
let _selectedChatIds = new Set();
let _multiSelectMode = false;

// ── CRYPTO — PBKDF2 + full storage encryption ──────────────────

let _cryptoKey = null;
let _sessionPassphrase = null;

// Brute-force lockout (RAM only, no storage — prevents cache-based bypass).
const _loginFailures = {}; // { accountId: { count, lockedUntil } }
const BF_MAX_ATTEMPTS = 5;
const BF_BASE_DELAY_MS = 30000; // 30 s after 5 failed attempts, then exponential

// Records a failed login attempt for an account and locks it out with exponential backoff once the attempt limit is reached.
function _recordLoginFailure(accountId) {
  if (!_loginFailures[accountId]) _loginFailures[accountId] = { count: 0, lockedUntil: 0 };
  _loginFailures[accountId].count++;
  const n = _loginFailures[accountId].count;
  if (n >= BF_MAX_ATTEMPTS) {
    // Exponential backoff: 30s, 60s, 120s ...
    const delay = BF_BASE_DELAY_MS * Math.pow(2, n - BF_MAX_ATTEMPTS);
    _loginFailures[accountId].lockedUntil = Date.now() + Math.min(delay, 3600000);
  }
}
// Clears the recorded failed-login count/lock for an account (called after a successful login).
function _resetLoginFailures(accountId) { delete _loginFailures[accountId]; }
// Returns the remaining lockout time in ms for an account, or 0 if it isn't locked.
function _loginLockRemaining(accountId) {
  const f = _loginFailures[accountId];
  if (!f || !f.lockedUntil) return 0;
  const rem = f.lockedUntil - Date.now();
  return rem > 0 ? rem : 0;
}

let _lockCountdownTimer = null;
// Starts a 1s-interval UI countdown that disables the login form while an account is locked out, re-enabling it once the lock expires.
function _startLockCountdown(accountId, errorEl, btn, input) {
  if (_lockCountdownTimer) clearInterval(_lockCountdownTimer);
  _lockCountdownTimer = setInterval(() => {
    const rem = _loginLockRemaining(accountId);
    if (rem <= 0) {
      clearInterval(_lockCountdownTimer);
      _lockCountdownTimer = null;
      errorEl.textContent = '';
      if (btn) btn.disabled = false;
      if (input) { input.disabled = false; input.focus(); }
    } else {
      const secs = Math.ceil(rem / 1000);
      errorEl.textContent = '⏳ ' + tf('login.lockedFor', { s: secs });
      if (btn) btn.disabled = true;
      if (input) input.disabled = true;
    }
  }, 1000);
}
// Stops the login lockout countdown timer, if one is running.
function _stopLockCountdown() {
  if (_lockCountdownTimer) { clearInterval(_lockCountdownTimer); _lockCountdownTimer = null; }
}

// Derives an AES-GCM CryptoKey from a passphrase and salt using PBKDF2 (600k iterations, SHA-256).
async function deriveKeyPBKDF2(passphrase, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase || 'kic-default-v2'),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 600000 },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// == CryptoKey derived only from password + account salt ========================
// No seed anymore in localStorage. The PBKDF2 salt (16 bytes, randomly,
// per account) lives in the account registry - it isn't a secret,
// but prevents rainbow table attacks.
// The password itself remains exclusively in RAM (_sessionPassphrase).
async function getCryptoKey() {
  if (_cryptoKey) return _cryptoKey;
  const acc = getAccount(_activeAccountId);
  if (!acc) throw new Error('No active account');
  // Salt from account registry (created on first password set)
  let encSalt = acc.encSalt;
  if (!encSalt) {
    const saltBuf = crypto.getRandomValues(new Uint8Array(16));
    encSalt = btoa(String.fromCharCode(...saltBuf));
    acc.encSalt = encSalt;
    // IMPORTANT: await here, to guarantee the salt is persisted
    // before we use it for encryption. Without await, a reload could
    // generate a new salt -> wrong key -> data loss.
    await _registryPut(_accounts);
  }
  const saltBytes = Uint8Array.from(atob(encSalt), c => c.charCodeAt(0));
  const passphrase = 'kic-enc-v5|' + (_sessionPassphrase || '');
  _cryptoKey = await deriveKeyPBKDF2(passphrase, saltBytes);
  // A (re)derived key invalidates save()'s dirty-tracking cache: unchanged
  // plaintext must still be re-encrypted under the new key (e.g. after a
  // password change / rekey), otherwise it would wrongly be skipped.
  resetSaveCache();
  return _cryptoKey;
}

// == Session token: F5 reload without password storage ==============
// Password is never stored; instead a token encrypted with the in-RAM
// CryptoKey is kept in sessionStorage so a reload can restore the session.
const _SESSION_TOKEN_KEY = 'kic_st';

// Encrypts a short-lived session marker with the current CryptoKey and stores it in sessionStorage, so a page reload can restore the session without re-entering the password.
async function _writeSessionToken() {
  if (!_cryptoKey || !_activeAccountId) return;
  try {
    const payload = JSON.stringify({ accountId: _activeAccountId, ts: Date.now() });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, _cryptoKey,
      new TextEncoder().encode(payload)
    );
    const combined = new Uint8Array(iv.byteLength + enc.byteLength);
    combined.set(iv, 0); combined.set(new Uint8Array(enc), iv.byteLength);
    sessionStorage.setItem(_SESSION_TOKEN_KEY, btoa(String.fromCharCode(...combined)));
  } catch {}
}

// Decrypts and validates the sessionStorage session token for an account; returns true only if it matches and is less than 24h old.
async function _validateSessionToken(accountId) {
  if (!_cryptoKey) return false;
  try {
    const raw = sessionStorage.getItem(_SESSION_TOKEN_KEY);
    if (!raw) return false;
    const data = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    const iv = data.slice(0, 12); const ct = data.slice(12);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _cryptoKey, ct);
    const payload = JSON.parse(new TextDecoder().decode(dec));
    return payload.accountId === accountId && (Date.now() - payload.ts) < 86400000;
  } catch { return false; }
}

// Sets (or clears) the in-memory session passphrase and invalidates the cached CryptoKey.
function setSessionPassphrase(pw) {
  _sessionPassphrase = pw || null;
  _cryptoKey = null; // invalidate key cache
  if (!pw) { try { sessionStorage.removeItem(_SESSION_TOKEN_KEY); } catch {} }
  // No password in sessionStorage anymore!
  // _writeSessionToken() is called after getCryptoKey().
}
// Returns whether a session token is present in sessionStorage (does not itself validate it).
function restoreSessionPassphrase() {
  // Only checks whether a token is present; validation happens async in checkLogin().
  return !!sessionStorage.getItem(_SESSION_TOKEN_KEY);
}

// Encrypts a plaintext string with AES-GCM using the account's CryptoKey and returns it base64-encoded.
async function encryptStr(plaintext) {
  if (!plaintext) return '';
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + enc.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.byteLength);
  // Use chunked btoa to avoid "Maximum call stack size exceeded"
  // when spread-applying large Uint8Arrays (>~500 KB).
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < combined.length; i += CHUNK) {
    bin += String.fromCharCode(...combined.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Decrypts a base64-encoded AES-GCM string previously produced by encryptStr().
async function decryptStr(b64) {
  if (!b64) return '';
  try {
    const key  = await getCryptoKey();
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv   = data.slice(0, 12);
    const ct   = data.slice(12);
    const dec  = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(dec);
  } catch { return ''; }
}

// Encrypt/decrypt a JS value (serialized as JSON)
async function encryptObj(obj) {
  return encryptStr(JSON.stringify(obj));
}
// Decrypts and JSON-parses an object previously encrypted with encryptObj(); returns the fallback on failure.
async function decryptObj(b64, fallback) {
  if (!b64) return fallback;
  try {
    const json = await decryptStr(b64);
    if (!json) return fallback;
    return JSON.parse(json);
  } catch { return fallback; }
}

// Returns a copy of a provider object with its apiKey field encrypted, for storage.
async function encryptProvider(p) {
  const out = {...p};
  if (p.apiKey) out.apiKey = await encryptStr(p.apiKey);
  return out;
}
// Older versions stored the model name instead of the actual company as
// provider type ('gemini' instead of 'google', 'glm' instead of 'zhipu').
// Migrate on load so already-saved providers keep working.
const LEGACY_PROVIDER_TYPE_MAP = { 'gemini': 'google', 'glm': 'zhipu' };
// Returns a copy of a provider object with its apiKey field decrypted, after loading from storage.
async function decryptProvider(p) {
  const out = {...p};
  if (p.apiKey) out.apiKey = await decryptStr(p.apiKey);
  if (LEGACY_PROVIDER_TYPE_MAP[out.type]) out.type = LEGACY_PROVIDER_TYPE_MAP[out.type];
  return out;
}

// ── AGENT SESSION ─────────────────────────────────────────────────
// Second, independent PBKDF2+AES-256 key so the local proxy can decrypt this
// account's project registry (id → folder path) during a login. Kept in proxy
// RAM only, never on disk (see /agent/session/unlock in kiconnect-proxy.py);
// a leak of one key never exposes the other (config/chats vs. projects).
let _agentSessionToken = null;
let _agentProjects = [];

// Derives raw AES-256 key bytes (not a CryptoKey) via PBKDF2, so they can
// be base64-encoded and sent to the proxy once at unlock time.
async function deriveRawBitsPBKDF2(passphrase, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 600000 },
    keyMaterial, 256
  );
  return new Uint8Array(bits);
}

// Unlocks the agent (project-registry) session for the active account.
// Call right after getCryptoKey()/_writeSessionToken() on login, account
// creation, and password change. Silently no-ops the agent feature if it
// fails (e.g. proxy unreachable) — the rest of the app keeps working.
async function unlockAgentSession() {
  const acc = getAccount(_activeAccountId);
  if (!acc || !_sessionPassphrase) return;
  let agentSalt = acc.agentSalt;
  if (!agentSalt) {
    const saltBuf = crypto.getRandomValues(new Uint8Array(16));
    agentSalt = btoa(String.fromCharCode(...saltBuf));
    acc.agentSalt = agentSalt;
    await _registryPut(_accounts); // persist before first use, same reasoning as encSalt
  }
  const saltBytes = Uint8Array.from(atob(agentSalt), c => c.charCodeAt(0));
  const passphrase = 'kic-agent-v1|' + _sessionPassphrase;
  try {
    const rawKey = await deriveRawBitsPBKDF2(passphrase, saltBytes);
    const keyB64 = btoa(String.fromCharCode(...rawKey));
    const res = await fetch('/agent/session/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: _activeAccountId, key: keyB64 }),
    });
    await _applyAgentSessionResponse(res);
  } catch {
    _agentSessionToken = null; _agentProjects = [];
  }
}

// Shared by unlockAgentSession/rekeyAgentSession: applies the /agent/session/*
// response to the module-level session state, or clears it on any failure.
async function _applyAgentSessionResponse(res) {
  if (!res.ok) { _agentSessionToken = null; _agentProjects = []; return; }
  const data = await res.json();
  _agentSessionToken = data.token || null;
  _agentProjects = Array.isArray(data.projects) ? data.projects : [];
}

// Re-encrypts the agent registry under a new key after a password change.
// Uses the still-valid OLD session token to authorize the swap — never
// re-derives from scratch (which would fail to decrypt the old ciphertext).
// Falls back to a fresh unlockAgentSession() if there was no old session
// to rekey (e.g. agent feature was never unlocked this session).
async function rekeyAgentSession() {
  const acc = getAccount(_activeAccountId);
  if (!_agentSessionToken || !acc?.agentSalt || !_sessionPassphrase) {
    return unlockAgentSession();
  }
  try {
    const saltBytes = Uint8Array.from(atob(acc.agentSalt), c => c.charCodeAt(0));
    const newRawKey = await deriveRawBitsPBKDF2('kic-agent-v1|' + _sessionPassphrase, saltBytes);
    const newKeyB64 = btoa(String.fromCharCode(...newRawKey));
    const res = await fetch('/agent/session/rekey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...agentSessionHeader() },
      body: JSON.stringify({ newKey: newKeyB64 }),
    });
    await _applyAgentSessionResponse(res);
  } catch {
    _agentSessionToken = null; _agentProjects = [];
  }
}

// Tells the proxy to drop the in-RAM agent session (best-effort — the
// server-side TTL would clean it up anyway, this just makes logout tidy).
function lockAgentSession() {
  if (_agentSessionToken) {
    fetch('/agent/session/lock', { method: 'POST', headers: { 'X-Agent-Session': _agentSessionToken } }).catch(() => {});
  }
  _agentSessionToken = null;
  _agentProjects = [];
}

// Header to attach to every /agent/* request (see kiconnect-agent.js agentFetch()).
function agentSessionHeader() {
  return _agentSessionToken ? { 'X-Agent-Session': _agentSessionToken } : {};
}

// ── Login password hash (PBKDF2 v2, per-account) ─────────────────
async function hashPasswordPBKDF2(pw, saltBytes) {
  const key = await deriveKeyPBKDF2(pw + '|kic-login-v2', saltBytes);
  const iv = new Uint8Array(12);
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key,
    new TextEncoder().encode('kic-login-verify-v2')
  );
  return btoa(String.fromCharCode(...new Uint8Array(enc)));
}

// Per-account password storage (in account registry)
async function storeAccountPasswordHash(accountId, pw) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltB64   = btoa(String.fromCharCode(...saltBytes));
  const hashB64   = await hashPasswordPBKDF2(pw, saltBytes);
  const acc = _accounts.find(a => a.id === accountId);
  if (acc) { acc.pwHash = hashB64; acc.pwSalt = saltB64; acc.pwVersion = 2; saveAccountRegistry(); }
}
// Verifies a password against an account's stored PBKDF2 hash.
async function verifyAccountPassword(accountId, pw) {
  const acc = getAccount(accountId);
  if (!acc || !acc.pwHash || acc.pwVersion !== 2) return false;
  try {
    const saltBytes = Uint8Array.from(atob(acc.pwSalt), c => c.charCodeAt(0));
    const candidate = await hashPasswordPBKDF2(pw, saltBytes);
    return candidate === acc.pwHash;
  } catch { return false; }
}

// ── Multi-Account Registry ────────────────────────────────────────
let _accounts = [];
let _activeAccountId = null;
// Looks up an account by ID in the in-memory account list.
function getAccount(id) { return _accounts.find(a => a.id === id) || null; }

// ── PERSIST v5 — server storage (./datas/) + localStorage fallback ─
// Account data lives in ./datas/<accountId>/<key>.json (browser-independent);
// localStorage is the fallback when the proxy is unreachable.

const _STORE_BASE = '/store';
let _storeAvailable = true; // false if the server doesn't respond

// Reads a single key's value for an account from the server-side storage backend.
async function _storeGet(accountId, key) {
  if (!_storeAvailable) return _lsGetRaw(accountId, key);
  try {
    const res = await fetch(`${_STORE_BASE}/${accountId}/${key}`, { method: 'GET' });
    if (!res.ok) { if (res.status === 404) return null; throw new Error(res.status); }
    const text = await res.text();
    if (!text || text === 'null') return null;
    return JSON.parse(text); // encrypted string or value
  } catch (e) {
    console.warn('[store] GET failed, fallback to localStorage:', e.message);
    _storeAvailable = false;
    return _lsGetRaw(accountId, key);
  }
}

// Writes a single key's value for an account to the server-side storage backend.
async function _storePut(accountId, key, value) {
  const payload = JSON.stringify(value);
  if (_storeAvailable) {
    try {
      const res = await fetch(`${_STORE_BASE}/${accountId}/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (!res.ok) throw new Error(res.status);
      _lsSetRaw(accountId, key, payload); // Mirror in localStorage
      return;
    } catch (e) {
      console.warn('[store] PUT failed, fallback to localStorage:', e.message);
      _storeAvailable = false;
    }
  }
  _lsSetRaw(accountId, key, payload);
}

// Deletes a single key's value for an account from the server-side storage backend.
async function _storeDel(accountId, key) {
  if (_storeAvailable) {
    try { await fetch(`${_STORE_BASE}/${accountId}/${key}`, { method: 'DELETE' }); } catch {}
  }
  localStorage.removeItem(`kic_${accountId}_${key}`);
}

// Lists the keys actually present on the server for an account (GET /store/<accountId>).
// Used by deleteAccount() so it deletes everything that's really there instead of
// relying on a hardcoded key list that's easy to forget to update (e.g. a new
// section added to save() later) and would otherwise leave orphaned data behind.
// Returns null (not []) on any failure, so callers can fall back to a hardcoded list.
async function _storeListKeys(accountId) {
  if (!_storeAvailable) return null;
  try {
    const res = await fetch(`${_STORE_BASE}/${accountId}`, { method: 'GET' });
    if (!res.ok) return null;
    const keys = await res.json();
    return Array.isArray(keys) ? keys : null;
  } catch {
    return null;
  }
}

// Deletes an account's entire server-side data directory in one request, so no
// empty folder is left after "delete account". Best-effort; a failure here just
// leaves a harmless empty directory since deleteAccount() already deletes the keys.
async function _storeDeleteAccountDir(accountId) {
  if (!_storeAvailable) return;
  try { await fetch(`${_STORE_BASE}/${accountId}`, { method: 'DELETE' }); } catch {}
}

// Reads the shared account registry (list of accounts) from the storage backend.
async function _registryGet() {
  if (_storeAvailable) {
    try {
      const res = await fetch(`${_STORE_BASE}/`, { method: 'GET' });
      if (res.ok) { const t = await res.text(); if (t && t !== 'null') return JSON.parse(t); }
    } catch (e) { console.warn('[store] registry GET failed:', e.message); _storeAvailable = false; }
  }
  try { return JSON.parse(localStorage.getItem('kic_accounts') || '[]'); } catch { return []; }
}

// Writes the account registry (list of accounts) to the storage backend.
async function _registryPut(data) {
  const payload = JSON.stringify(data);
  if (_storeAvailable) {
    try {
      const res = await fetch(`${_STORE_BASE}/`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload,
      });
      if (!res.ok) throw new Error(res.status);
    } catch (e) { console.warn('[store] registry PUT failed:', e.message); _storeAvailable = false; }
  }
  localStorage.setItem('kic_accounts', payload);
}

// Reads and JSON-parses a per-account localStorage entry (legacy fallback storage).
function _lsGetRaw(accountId, key) {
  const v = localStorage.getItem(`kic_${accountId}_${key}`);
  if (v === null) return null;
  try { return JSON.parse(v); } catch { return v; }
}
// Writes a per-account localStorage entry (legacy fallback storage).
function _lsSetRaw(accountId, key, rawStr) {
  try { localStorage.setItem(`kic_${accountId}_${key}`, rawStr); } catch {}
}

// Account registry Helfer
async function loadAccountRegistryAsync() {
  try { _accounts = await _registryGet() || []; } catch { _accounts = []; }
}
// Persists the current in-memory account list to the registry (fire-and-forget).
function saveAccountRegistry() {
  _registryPut(_accounts).catch(() => {});
}

// Returns a storage-safe copy of a message: strips large binary payloads (images over the size limit, PDFs, extracted text files) and replaces them with lightweight reference stubs plus file-name chips.
function sanitizeMsgForStorage(msg) {
  if (!Array.isArray(msg.content)) return msg;
  const maxBytes = getMaxImageStorageBytes();

  // Collect names of file content blocks that are stripped, so _files stays intact
  // and the chips are still shown after reload (as _storedOnly stubs).
  const strippedFileNames = new Set();

  const safeContent = msg.content.map(p => {
    // ── Images ────────────────────────────────────────────────────
    if (p.type === 'image_url') {
      const url = p.image_url?.url || '';
      if (url.startsWith('data:') && url.length > maxBytes) {
        return { type: 'text', text: '[' + t('js.imageNotSaved') + ']' };
      }
      return p;
    }
    // ── PDF (base64) ──────────────────────────────────────────────
    // Binary PDFs can be very large; strip the data, keep a sentinel so
    // the message is re-sendable after a "re-attach" by the user.
    if (p.type === 'pdf_base64') {
      if (p.name) strippedFileNames.add(p.name);
      // Keep the block but without the binary payload to avoid RangeError.
      return { type: 'pdf_base64_ref', name: p.name };
    }
    // ── PDF (extracted text) ──────────────────────────────────────
    if (p.type === 'pdf_text') {
      if (p.name) strippedFileNames.add(p.name);
      return { type: 'pdf_text_ref', name: p.name };
    }
    // ── Plain text-file content ───────────────────────────────────
    // These are stored as a text block starting with '--- Content of "…" ---'
    if (p.type === 'text' && typeof p.text === 'string' && p.text.startsWith('--- ')) {
      const fname = p.text.match(/^--- Content of "(.+?)" ---/)?.[1];
      if (fname) strippedFileNames.add(fname);
      return { type: 'text_file_ref', name: fname || '?' };
    }
    return p;
  });

  // Ensure every stripped file is listed in _files so the chip renders on reload.
  const existingFiles = new Set(msg._files || []);
  strippedFileNames.forEach(n => existingFiles.add(n));
  const newFiles = existingFiles.size > 0 ? [...existingFiles] : undefined;

  const result = { ...msg, content: safeContent };
  if (newFiles) result._files = newFiles;
  return result;
}

// ── save() dirty-tracking cache ─────────────────────────────────────
// Caches last-saved plaintext per section and skips encrypt+PUT for
// unchanged sections, avoiding a full re-encrypt on every trivial change.
// Must be reset on key change (password change, login, account switch);
// see getCryptoKey()/load().
let _saveCache = null;
function resetSaveCache() { _saveCache = null; }

// Encrypts and persists the full app state for the active account.
// Concurrent calls are coalesced into one in-flight run.
let _saveInFlight = null;
let _savePending = false;
async function save() {
  if (_saveInFlight) {
    _savePending = true;
    return _saveInFlight;
  }
  _saveInFlight = _performSave();
  try {
    return await _saveInFlight;
  } finally {
    _saveInFlight = null;
    if (_savePending) {
      _savePending = false;
      save(); // fire-and-forget: capture whatever changed while we were saving
    }
  }
}

async function _performSave() {
  if (!_activeAccountId) return;
  if (!_saveCache) _saveCache = {};
  const cache = _saveCache;
  try {
    // Compute plaintext JSON for each section up front (cheap) so we can
    // diff against the last-saved version and skip untouched sections.
    const chatsToStore = chats.slice(0, 200).map(c => ({
      ...c,
      messages: c.messages.map(sanitizeMsgForStorage),
    }));
    const sections = {
      config: JSON.stringify(config),
      providers: JSON.stringify(providers),
      profiles: JSON.stringify(profiles),
      profileFolders: JSON.stringify(profileFolders),
      folders: JSON.stringify(folders),
      chats: JSON.stringify(chatsToStore),
    };

    const dirtyKeys = Object.keys(sections).filter(k => cache[k] !== sections[k]);

    if (dirtyKeys.length) {
      const encryptedEntries = await Promise.all(dirtyKeys.map(async key => {
        if (key === 'providers') {
          const encProviders = await Promise.all(providers.map(encryptProvider));
          return [key, await encryptObj(encProviders)];
        }
        const plainByKey = { config, profiles, profileFolders, folders, chats: chatsToStore };
        return [key, await encryptObj(plainByKey[key])];
      }));
      await Promise.all(encryptedEntries.map(([key, encVal]) => _storePut(_activeAccountId, key, encVal)));
      // Only update the cache after a successful write for each section.
      dirtyKeys.forEach(k => { cache[k] = sections[k]; });
    }

    // These are cheap already (no encryption, tiny payloads) but still cost
    // a network round-trip each — skip the PUT when unchanged too.
    if (currentChatId && cache._currentChatId !== currentChatId) {
      await _storePut(_activeAccountId, 'current_chat', currentChatId);
      cache._currentChatId = currentChatId;
    }
    const sidebarW = document.getElementById('sidebar')?.style.width || '';
    if (cache._sidebarW !== sidebarW) {
      await _storePut(_activeAccountId, 'sidebar_w', sidebarW);
      cache._sidebarW = sidebarW;
    }
    const sidebarCollapsedVal = sidebarCollapsed ? '1' : '';
    if (cache._sidebarCollapsed !== sidebarCollapsedVal) {
      await _storePut(_activeAccountId, 'sidebar_collapsed', sidebarCollapsedVal);
      cache._sidebarCollapsed = sidebarCollapsedVal;
    }
  } catch (e) {
    console.error('[save] error:', e);
    // Only show storageFull toast for genuine quota errors — not for network/server errors.
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      toast(t('js.storageFull'));
    } else if (e?.message && /quota/i.test(e.message)) {
      toast(t('js.storageFull'));
    }
    // Other errors (fetch failures, missing DOM elements, etc.) are silent — already logged above.
  }
}

// Loads and decrypts the full app state for the active account, migrating from legacy localStorage entries where needed.
async function load() {
  if (!_activeAccountId) return;
  // Fresh account/session -> save()'s dirty-tracking cache must not carry
  // over stale plaintext snapshots from a previously loaded account.
  resetSaveCache();
  async function loadKey(key, fallback) {
    let raw = await _storeGet(_activeAccountId, key);
    if (raw === null || raw === undefined) {
      // Migration: old localStorage entry
      const ls = localStorage.getItem(`kic_${_activeAccountId}_${key}`);
      if (!ls) return fallback;
      raw = ls;
    }
    const dec = await decryptObj(raw, null);
    if (dec !== null) return dec;
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  try { config = {...freshConfig(), ...config, ...await loadKey('config', {})}; } catch{}
  if (!['manual','auto','always','off','agentic'].includes(config.webSearchMode)) config.webSearchMode = 'manual';
  if (!['free','duckduckgo','searxng','qwant','yahoo','startpage','brave','google','bing','mojeek','yandex','langsearch'].includes(config.webSearchEngine)) config.webSearchEngine = 'free';
  config.webSearchResultCount = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(config.webSearchResultCount) || 8));
  config.webLinkEnabled = !!config.webLinkEnabled;
  try {
    const rawProviders = await loadKey('providers', []);
    providers = await Promise.all(rawProviders.map(decryptProvider));
  } catch{}
  try { profiles = await loadKey('profiles', []); } catch{}
  try { profileFolders = await loadKey('profileFolders', []); } catch{}
  try { folders  = await loadKey('folders',  []); } catch{}
  try { chats    = await loadKey('chats',    []); } catch{}

  let savedCurrentChat = await _storeGet(_activeAccountId, 'current_chat');
  if (!savedCurrentChat) savedCurrentChat = localStorage.getItem(`kic_${_activeAccountId}_current_chat`);
  if (savedCurrentChat) {
    const v = typeof savedCurrentChat === 'string' ? savedCurrentChat.replace(/^"|"$/g, '') : String(savedCurrentChat);
    if (v) currentChatId = v;
  }

  let savedW = await _storeGet(_activeAccountId, 'sidebar_w');
  if (!savedW) savedW = localStorage.getItem(`kic_${_activeAccountId}_sidebar_w`);
  if (savedW) {
    const w = typeof savedW === 'string' ? savedW.replace(/^"|"$/g,'') : '';
    if (w) document.getElementById('sidebar').style.width = w;
  }

  let collapsed = await _storeGet(_activeAccountId, 'sidebar_collapsed');
  if (!collapsed) collapsed = localStorage.getItem(`kic_${_activeAccountId}_sidebar_collapsed`);
  if (collapsed === '1' || collapsed === '"1"') {
    sidebarCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
  }
}

// accountKey() bleibt fuer localStorage (kein Storage-Server: kic_lang, session-token usw.)
function accountKey(key) { return `kic_${_activeAccountId}_${key}`; }

// ── Sidebar Resize ────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sidebarCollapsed = !sidebarCollapsed;
  sb.classList.toggle('collapsed', sidebarCollapsed);
  save();
}

(function initResize() {
  const resizer = document.getElementById('sidebarResizer');
  const sidebar = document.getElementById('sidebar');
  let startX, startW;
  resizer.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX; startW = sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(e) {
      const newW = Math.max(160, Math.min(480, startW + e.clientX - startX));
      sidebar.style.width = newW + 'px';
      document.documentElement.style.setProperty('--sidebar-w', newW + 'px');
    }
    function onUp() {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      save();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ── Provider Helpers ──────────────────────────────────────────────
function splitModelId(fullId) {
  if (!fullId) return { providerId: null, modelId: '' };
  const sep = fullId.indexOf('::');
  if (sep === -1) return { providerId: null, modelId: fullId };
  return { providerId: fullId.slice(0, sep), modelId: fullId.slice(sep + 2) };
}
// Combines a provider ID and a bare model ID into the app's internal 'providerId::modelId' identifier.
function makeModelId(providerId, modelId) { return `${providerId}::${modelId}`; }
// Resolves the provider object that a full (provider-prefixed) model ID belongs to.
function providerForModel(fullModelId) {
  const { providerId } = splitModelId(fullModelId);
  return providers.find(p => p.id === providerId) || null;
}
// Converts a copied OpenAI-compatible endpoint back to the API base URL.
// The provider field is a *base* URL; all callers append /models,
// /chat/completions, or /embeddings themselves.  Being tolerant here avoids
// paths such as /v1/embeddings/models when users paste the endpoint from API
// documentation or a curl example.
function normalizeOpenAIBaseUrl(url) {
  return (url || '').trim().replace(/\/+$/, '').replace(/\/(?:models|embeddings|chat\/completions)$/i, '');
}
// Returns the base API URL for a provider, either its configured custom server URL (openai-compat) or the well-known endpoint for its type.
function getProviderEndpoint(provider) {
  if (!provider) return null;
  if (provider.type === 'openai-compat') return normalizeOpenAIBaseUrl(provider.serverUrl);
  if (provider.type === 'kiconnect-nrw') return 'https://chat.kiconnect.nrw/api/v1';
  if (provider.type === 'anthropic')     return 'https://api.anthropic.com';
  if (provider.type === 'openai-direct') return 'https://api.openai.com/v1';
  if (provider.type === 'openrouter')    return 'https://openrouter.ai/api/v1';
  if (provider.type === 'mistral')       return 'https://api.mistral.ai/v1';
  if (provider.type === 'google')        return 'https://generativelanguage.googleapis.com/v1beta/openai';
  if (provider.type === 'xai')           return 'https://api.x.ai/v1';
  if (provider.type === 'groq')          return 'https://api.groq.com/openai/v1';
  if (provider.type === 'deepseek')      return 'https://api.deepseek.com/v1';
  if (provider.type === 'minimax')       return 'https://api.minimax.io/v1';
  if (provider.type === 'zhipu')         return 'https://api.z.ai/api/paas/v4';
  if (provider.type === 'kimi')          return 'https://api.moonshot.ai/v1';
  return null;
}
// Returns every enabled provider that has an embedding model configured
// (Settings ▸ APIs ▸ "Embedding model") - lets the knowledge-base UI
// (kiconnect-db.js) offer these as one-click embedding sources instead of
// requiring a manually re-entered server URL + model + key every time.
function listEmbeddingProviders() {
  return providers
    .filter(p => p.enabled !== false && (p.embeddingModel || '').trim())
    .map(p => ({ id: p.id, name: p.name, embeddingModel: p.embeddingModel.trim() }));
}
// Returns the max-output-tokens to send with a request: the active profile's override if set, capped at the model's max.
function effectiveMaxTokens() {
  const profile = activeProfile();
  const { modelId } = splitModelId(config.model);
  const modelMax = getModelMaxOutput(modelId);
  if (profile && !profile.useModelMax && profile.maxTokens) return Math.min(profile.maxTokens, modelMax);
  return modelMax;
}

// ── Proxy ─────────────────────────────────────────────────────────
const USE_PROXY = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const ALLOWED_API_DOMAINS = [
  'api.anthropic.com','api.openai.com','chat.kiconnect.nrw','openrouter.ai',
  'api.mistral.ai','generativelanguage.googleapis.com','texttospeech.googleapis.com','api.x.ai','api.groq.com', 'api.deepseek.com', 'api.minimax.io', 'api.z.ai', 'api.moonshot.ai',
  'api.elevenlabs.io',
  'api.search.brave.com','html.duckduckgo.com','lite.duckduckgo.com',
  'api.qwant.com','search.yahoo.com','www.startpage.com',
  'www.googleapis.com','api.bing.microsoft.com','api.mojeek.com','yandex.com',
  'api.langsearch.com',
  'searx.be','searxng.world','search.bus-hit.me','searx.tiekoetter.com',
  'search.sapti.me','searx.prvcy.eu','searx.fmac.xyz','search.ononoki.org',
];
// A request is "safe" if its host is a well-known built-in provider domain,
// or a custom server URL the user entered in the Provider editor (type
// "openai-compat" / "kiconnect-nrw"), making self-hosted endpoints
// (Ollama, LM Studio, vLLM, ...) reachable.
function isSafeApiUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (ALLOWED_API_DOMAINS.some(d => h === d || h.endsWith('.' + d))) return true;
    return providers.some(p => {
      if (p.type !== 'openai-compat' || !p.serverUrl) return false;
      try { return new URL(p.serverUrl).hostname === h; } catch { return false; }
    });
  } catch { return false; }
}
// True if `url`'s host was explicitly double-confirmed in the Provider
// editor (see confirmLanAddress()), unlocking it past the proxy's SSRF
// protection for private/LAN addresses.
function _isLanConfirmedUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return providers.some(p => p.type === 'openai-compat' && p.netConfirmed && p.netConfirmedHost === h);
  } catch { return false; }
}
// Routes a request URL through the local dev proxy (if active) after checking it against isSafeApiUrl(); throws if the domain isn't allowed.
function proxyUrl(url, allowProviderEditorUrl = false, lanConfirmed = false) {
  // While a provider is being created it is not in `providers` yet, so the
  // normal allow-list cannot know its host.  The local proxy still performs
  // the actual URL/IP/SSRF validation; this exception merely lets the two
  // "discover/test embedding" controls validate a server *before* saving it.
  const validEditorUrl = allowProviderEditorUrl && (() => {
    try { return /^https?:$/i.test(new URL(url).protocol); } catch { return false; }
  })();
  if (!isSafeApiUrl(url) && !validEditorUrl) { console.error('[Security] Blocked:', url); throw new Error(t('js.apiDomainBlocked') || 'API domain not allowed.'); }
  if (!USE_PROXY) return url;
  let out = '/proxy/' + url;
  // Marker lives on the *outer* proxy request's query string, not on the
  // upstream target URL - the proxy strips it again before forwarding
  // (see _proxy_request() / kic_lan_confirm in kiconnect-proxy.py).
  if (_isLanConfirmedUrl(url) || lanConfirmed) out += (url.includes('?') ? '&' : '?') + 'kic_lan_confirm=1';
  return out;
}
// A newly entered custom provider has not been saved yet, so it cannot have
// the normal stored LAN confirmation.  Ask for the same explicit consent as
// saving the provider, then pass the one-request confirmation marker to the
// local proxy.  This makes discovery/testing useful before the first save
// without weakening the proxy's DNS/IP checks.
function providerEditorProxyUrl(url, type) {
  if (type !== 'openai-compat' || _isLanConfirmedUrl(url)) return proxyUrl(url, true);
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return proxyUrl(url, true);
    return confirmLanAddress(host) ? proxyUrl(url, true, true) : null;
  } catch { throw new Error(t('js.invalidUrl') || 'Invalid server URL.'); }
}
// Routes a public (non-API-key) fetch such as page/search fetching through the local dev proxy; only checks the URL scheme, not a domain whitelist.
function proxyPublicUrl(url) {
  const u = new URL(url);
  if (!/^https?:$/i.test(u.protocol)) throw new Error(t('js.apiDomainBlocked') || 'URL not allowed.');
  return USE_PROXY ? '/proxy/' + url : url;
}

// Refreshes the settings panel's provider status summary (name, type, key-present/valid state) for every configured provider.
function updateActiveProviderInfo() {
  const hint = document.getElementById('proxyHint');
  if (hint) hint.style.display = USE_PROXY ? 'none' : 'block';
  const el = document.getElementById('activeProviderInfo');
  if (!providers.length) { el.textContent = t('js.noProviderConfigured'); return; }
  el.innerHTML = '';
  providers.forEach(p => {
    const tp = PROVIDER_TYPES[p.type] || {};
    const st = providerStatus[p.id];
    let icon = '…', color = 'var(--muted)';
    if (!p.apiKey) { icon = '○'; }
    else if (st === 'ok') { icon = '✓'; color = 'var(--green)'; }
    else if (st === 'error') { icon = '✗'; color = 'var(--red)'; }
    const line = document.createElement('span');
    line.style.color = color;
    line.textContent = `${icon} `;
    const bold = document.createElement('strong');
    bold.textContent = p.name;
    const sub = document.createElement('span');
    sub.style.cssText = 'color:var(--muted);font-size:11px;';
    sub.textContent = ` ${tp.label || p.type}`;
    if (st === 'error') {
      const err = document.createElement('span');
      err.style.cssText = 'color:var(--red);font-size:11px;';
      err.textContent = ` (${t('js.keyError')})`;
      sub.appendChild(err);
    }
    el.appendChild(line); el.appendChild(bold); el.appendChild(sub);
    el.appendChild(document.createElement('br'));
  });
}

// ── Provider Panel ────────────────────────────────────────────────
function openProviderPanel() {
  renderProviderList();
  document.getElementById('providerPanel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  document.querySelector('[data-panel="providerPanel"]')?.classList.add('active');
}
// (Re)builds the list of configured providers in the Provider panel, with enable/disable, edit and delete controls.
// Parks the (single, shared) editor form right after a given element - used
// so editing happens next to the row you clicked instead of always at the
// bottom of the panel. `null` means "home position" (right after the
// add-new-provider button, its original static spot in the HTML).
function _placeProviderEditor(afterEl) {
  const editor = document.getElementById('providerEditor');
  const anchor = afterEl || document.getElementById('addProviderBtn');
  if (editor && anchor) anchor.insertAdjacentElement('afterend', editor);
}

function renderProviderList() {
  const list = document.getElementById('providerList');
  const editor = document.getElementById('providerEditor');
  // The editor can currently be parked inside this list (next to whichever
  // provider is being edited - see editProvider()). Detach it before
  // wiping the list with innerHTML='', or a re-render triggered by an
  // unrelated action (toggling another provider, a background model
  // fetch...) while editing would delete the open editor from the DOM.
  const wasInList = editor && list.contains(editor);
  if (wasInList) editor.remove();
  list.innerHTML = '';
  if (!providers.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;padding:12px;';
    msg.textContent = t('js.noProviderList');
    list.appendChild(msg);
    return;
  }
  providers.forEach((p, idx) => {
    const ptype = PROVIDER_TYPES[p.type] || {};
    const st = providerStatus[p.id];
    const enabled = p.enabled !== false;
    let badgeCls, badgeTxt;
    if (!enabled)          { badgeCls = '';     badgeTxt = t('js.providerDisabled'); }
    else if (!p.apiKey)    { badgeCls = 'warn'; badgeTxt = t('js.noKey'); }
    else if (st === 'ok')  { badgeCls = 'ok';   badgeTxt = t('js.keyOk'); }
    else if (st === 'error') { badgeCls = 'warn'; badgeTxt = t('js.keyError'); }
    else                   { badgeCls = '';     badgeTxt = t('js.keyPending'); }

    const item = document.createElement('div');
    item.className = 'provider-item' + (enabled ? '' : ' disabled');
    item.draggable = true;
    item.dataset.id = p.id;
    item.addEventListener('dragstart', e => {
      e.stopPropagation();
      _draggedProviderId = p.id;
      item.classList.add('provider-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('provider-dragging');
      document.querySelectorAll('.provider-drag-over').forEach(el => el.classList.remove('provider-drag-over'));
      _draggedProviderId = null;
    });
    item.addEventListener('dragover', e => {
      if (!_draggedProviderId || _draggedProviderId === p.id) return;
      e.preventDefault();
      item.classList.add('provider-drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('provider-drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('provider-drag-over');
      if (_draggedProviderId && _draggedProviderId !== p.id) reorderProviderTo(_draggedProviderId, p.id);
      _draggedProviderId = null;
    });

    const reorderCol = document.createElement('div');
    reorderCol.className = 'provider-reorder-col';
    const upBtn = document.createElement('button');
    upBtn.className = 'icon-btn provider-reorder-btn'; upBtn.textContent = '▲'; upBtn.title = t('js.moveUp') || 'Move up';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveProvider(p.id, -1); });
    const downBtn = document.createElement('button');
    downBtn.className = 'icon-btn provider-reorder-btn'; downBtn.textContent = '▼'; downBtn.title = t('js.moveDown') || 'Move down';
    downBtn.disabled = idx === providers.length - 1;
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveProvider(p.id, 1); });
    reorderCol.appendChild(upBtn); reorderCol.appendChild(downBtn);

    const dragHandle = document.createElement('span');
    dragHandle.className = 'provider-drag-handle';
    dragHandle.textContent = '⠿';
    dragHandle.title = t('js.dragToReorder') || 'Drag to reorder';

    const info = document.createElement('div');
    info.className = 'provider-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'provider-item-name';
    nameEl.textContent = p.name;
    const descEl = document.createElement('div');
    descEl.className = 'provider-item-desc';
    descEl.textContent = (ptype.label || p.type)
      + (p.serverUrl ? ' · ' + p.serverUrl.replace(/^https?:\/\//, '').slice(0, 30) : '')
      + ((p.embeddingModel || '').trim() ? ' · 🧬 ' + p.embeddingModel.trim() : '');
    info.appendChild(nameEl); info.appendChild(descEl);
    const badge = document.createElement('span');
    badge.className = 'provider-badge ' + badgeCls;
    badge.textContent = badgeTxt;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'provider-toggle' + (enabled ? ' on' : '');
    toggle.title = enabled ? t('js.disableProvider') : t('js.enableProvider');
    toggle.addEventListener('click', (e) => { e.stopPropagation(); toggleProviderEnabled(p.id); });
    const actions = document.createElement('div');
    actions.className = 'provider-item-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn'; editBtn.textContent = '✏️'; editBtn.title = t('js.edit');
    editBtn.dataset.id = p.id;
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); editProvider(editBtn.dataset.id); });
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger'; delBtn.textContent = '🗑'; delBtn.title = t('js.delete');
    delBtn.dataset.id = p.id;
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteProvider(delBtn.dataset.id); });
    actions.appendChild(editBtn); actions.appendChild(delBtn);
    item.appendChild(dragHandle); item.appendChild(reorderCol); item.appendChild(info); item.appendChild(badge); item.appendChild(toggle); item.appendChild(actions);
    list.appendChild(item);
  });
  if (wasInList) {
    const row = editingProviderId && list.querySelector(`.provider-item[data-id="${CSS.escape(editingProviderId)}"]`);
    // Row still exists (normal re-render while editing) -> put the editor
    // right back next to it. Row is gone (e.g. it got deleted elsewhere) ->
    // fall back to the editor's home position instead of leaving it orphaned.
    _placeProviderEditor(row || null);
  }
}
let _draggedProviderId = null;

// Toggling a provider off skips it in fetchModels() and blocks sending with its models,
// without deleting the stored API key/config.
function toggleProviderEnabled(id) {
  const p = providers.find(x => x.id === id); if (!p) return;
  p.enabled = p.enabled === false ? true : false;
  save(); renderProviderList(); fetchModels();
}

// Resets and opens the provider editor for creating a new provider.
function startNewProvider() {
  editingProviderId = null;
  document.getElementById('pvNameInput').value  = '';
  document.getElementById('pvServerUrl').value  = '';
  document.getElementById('pvApiKey').value     = '';
  document.getElementById('pvEmbedModel').value = '';
  resetEmbedModelPicker();
  selectProviderType('openai-compat');
  document.getElementById('providerEditorTitle').textContent = t('provider.new');
  _placeProviderEditor(null);
  _showProviderEditor();
}
// Reveals the (already positioned/filled) provider editor and scrolls it
// into view - shared tail of addProvider()/editProvider().
function _showProviderEditor() {
  const editor = document.getElementById('providerEditor');
  editor.style.display = 'block';
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// Opens the provider editor pre-filled with an existing provider's data,
// right below the row that was clicked (see _placeProviderEditor()) instead
// of always at the bottom of the panel.
function editProvider(id) {
  const p = providers.find(x => x.id === id); if (!p) return;
  editingProviderId = id;
  document.getElementById('pvNameInput').value  = p.name || '';
  document.getElementById('pvServerUrl').value  = p.serverUrl || '';
  document.getElementById('pvApiKey').value     = p.apiKey || '';
  document.getElementById('pvEmbedModel').value = p.embeddingModel || '';
  resetEmbedModelPicker();
  selectProviderType(p.type || 'openai-compat');
  document.getElementById('providerEditorTitle').textContent = t('provider.edit');
  const row = document.querySelector(`#providerList .provider-item[data-id="${CSS.escape(id)}"]`);
  _placeProviderEditor(row);
  _showProviderEditor();
}
// Back to the plain text field (hides the fetched-models <select>, if shown) -
// called whenever the editor opens fresh, since a previous fetch's option
// list belongs to whatever provider/server was entered at the time.
function resetEmbedModelPicker() {
  const select = document.getElementById('pvEmbedModelSelect');
  const input = document.getElementById('pvEmbedModel');
  if (select) { select.innerHTML = ''; select.style.display = 'none'; }
  if (input) input.style.display = '';
}
// Fetches this server's /models list the same way fetchModels() does for the
// chat-model dropdown, but keeps only entries that look like embedding
// models (fetchModels() does the mirror-image filter to keep them OUT of
// the chat list) - so picking an embedding model works exactly like picking
// a chat model, instead of requiring the exact name typed from memory.
async function loadEmbeddingModelCandidates() {
  const type = getSelectedProviderType();
  if (type === 'anthropic') { toast(t('js.noEmbeddingsForProvider') || 'Anthropic has no embedding models.'); return; }
  const apiKey = document.getElementById('pvApiKey').value.trim();
  const serverUrl = normalizeOpenAIBaseUrl(document.getElementById('pvServerUrl').value);
  if (type === 'openai-compat' && !serverUrl) { toast(t('js.urlRequired')); return; }
  const endpoint = getProviderEndpoint({ type, serverUrl });
  if (!endpoint) { toast(t('js.urlRequired')); return; }

  const btn = document.getElementById('pvEmbedModelLoadBtn');
  const prevLabel = btn.textContent; btn.textContent = '…'; btn.disabled = true;
  try {
    const extraHeaders = {};
    if (type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
    if (type === 'zhipu') extraHeaders['Accept-Language'] = 'en-US,en';
    const headers = { ...extraHeaders };
    // Local OpenAI-compatible servers commonly have no authentication.  Do
    // not send an empty Bearer header: several servers reject it outright.
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const requestUrl = providerEditorProxyUrl(`${endpoint}/models`, type);
    if (!requestUrl) return;
    const res = await fetch(requestUrl, {
      headers
    });
    let data = null;
    try { data = await res.json(); } catch { /* retain the HTTP status below */ }
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    if (!data) throw new Error(t('js.embedModelLoadInvalidResponse'));
    const rawModels = Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []);
    // APIs do not have a reliable capability flag.  Put likely embedding
    // models first, but retain every advertised model so unfamiliar names
    // (or provider-specific names) can be selected and tested without
    // needing to know or type the exact identifier in advance.
    const EMBED_MATCH = /embed(?:ding)?|e5[-_]|bge[-_]|gte[-_]|nomic|mxbai|jina|voyage|arctic|instructor|multilingual|qwen.*embed|granite.*embed|snowflake/i;
    const seen = new Set(); const candidates = [];
    rawModels.forEach(m => {
      const id = (typeof m === 'string' ? m : (m?.id || m?.name || '')).replace(/^models\//, '');
      if (!id || seen.has(id)) return;
      seen.add(id); candidates.push({ id, likelyEmbedding: EMBED_MATCH.test(id) });
    });
    candidates.sort((a, b) => Number(b.likelyEmbedding) - Number(a.likelyEmbedding) || a.id.localeCompare(b.id));
    if (!candidates.length) {
      toast(t('js.noEmbeddingModelsFound') || 'No embedding models found on this server — enter one manually.');
      return;
    }
    const select = document.getElementById('pvEmbedModelSelect');
    const input = document.getElementById('pvEmbedModel');
    const likely = candidates.filter(c => c.likelyEmbedding);
    const other = candidates.filter(c => !c.likelyEmbedding);
    const current = input.value.trim();
    // Only the unverified list is ever this noisy (regular /models responses
    // mix in every chat/vision/audio model the server hosts) - if we have at
    // least one recognized embedding model, keep the picker to just those by
    // default and let "Show other models" reveal the rest on demand instead
    // of dumping the whole catalog in every time.
    const showAllByDefault = likely.length === 0 || other.some(c => c.id === current);
    const renderOptions = includeOther => {
      select.innerHTML = '';
      const ph = document.createElement('option'); ph.value = ''; ph.textContent = t('js.selectModel') || '– select –';
      select.appendChild(ph);
      likely.forEach(({ id }) => {
        const o = document.createElement('option'); o.value = id; o.textContent = id;
        select.appendChild(o);
      });
      if (includeOther) {
        other.forEach(({ id }) => {
          const o = document.createElement('option'); o.value = id;
          o.textContent = `${id} (${t('js.embeddingModelUnverified')})`;
          select.appendChild(o);
        });
      } else if (other.length) {
        const showMore = document.createElement('option'); showMore.value = '__show_other__';
        showMore.textContent = tf('js.showOtherModels', { n: other.length }) || `Show ${other.length} other models (unverified)…`;
        select.appendChild(showMore);
      }
      const customOpt = document.createElement('option'); customOpt.value = '__custom__';
      customOpt.textContent = t('js.enterManually') || '✎ Enter manually…';
      select.appendChild(customOpt);
      select.value = candidates.some(x => x.id === current) ? current : '';
    };
    select.onchange = () => {
      if (select.value === '__show_other__') { renderOptions(true); return; }
      onEmbedModelSelectChange();
    };
    renderOptions(showAllByDefault);
    select.style.display = ''; input.style.display = 'none';
  } catch (e) {
    toast(tf('js.embedModelLoadFailed', { e: e.message || e }) || `Could not load model list: ${e.message || e}`);
  } finally {
    btn.textContent = prevLabel; btn.disabled = false;
  }
}
// Complements loadEmbeddingModelCandidates(): many self-hosted/gateway
// OpenAI-compatible servers don't list embedding models under /models
// even though /embeddings works fine. This sends one minimal request
// straight to /embeddings with the typed model name and reports back
// the real vector size or error - works regardless of what /models says.
async function testEmbeddingModel() {
  const type = getSelectedProviderType();
  if (type === 'anthropic') { toast(t('js.noEmbeddingsForProvider') || 'Anthropic has no embedding models.'); return; }
  const apiKey = document.getElementById('pvApiKey').value.trim();
  const serverUrl = normalizeOpenAIBaseUrl(document.getElementById('pvServerUrl').value);
  if (type === 'openai-compat' && !serverUrl) { toast(t('js.urlRequired')); return; }
  const endpoint = getProviderEndpoint({ type, serverUrl });
  if (!endpoint) { toast(t('js.urlRequired')); return; }
  const model = document.getElementById('pvEmbedModel').value.trim();
  if (!model) { toast(t('js.embedModelNameRequired')); return; }

  const btn = document.getElementById('pvEmbedModelTestBtn');
  // Captured as innerHTML (not textContent) so the label's data-i18n <span>
  // survives the round trip - a plain textContent save/restore here would
  // silently strip that span the first time this button is used, leaving
  // the label unable to pick up future language switches.
  const prevLabel = btn.innerHTML; btn.textContent = '…'; btn.disabled = true;
  try {
    const extraHeaders = { 'Content-Type': 'application/json' };
    if (type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
    if (type === 'zhipu') extraHeaders['Accept-Language'] = 'en-US,en';
    if (apiKey) extraHeaders.Authorization = `Bearer ${apiKey}`;
    const requestUrl = providerEditorProxyUrl(`${endpoint}/embeddings`, type);
    if (!requestUrl) return;
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ model, input: 'test' })
    });
    // Error bodies aren't guaranteed to be JSON (some gateways return an
    // HTML error page or plain text for a 404/502) - don't let a failed
    // .json() parse mask the real HTTP status in the toast below.
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body, ignore */ }
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    // Standard OpenAI shape is {data:[{embedding:[...]}]}; some self-hosted
    // servers return the flatter {embedding:[...]} instead - accept both.
    const vec = data?.data?.[0]?.embedding || data?.embedding || data?.data?.[0]?.embeddings;
    if (!Array.isArray(vec) || !vec.length) {
      throw new Error(t('js.embedTestNoVector'));
    }
    toast(tf('js.embedTestOk', { model, dims: vec.length }));
  } catch (e) {
    toast(tf('js.embedTestFailed', { e: e.message || e }));
  } finally {
    btn.innerHTML = prevLabel; btn.disabled = false;
  }
}
// pvEmbedModel (the plain text input) stays the single source of truth that
// saveProviderEditor() reads - the <select> just writes into it, so nothing
// downstream needs to know the picker exists. "Enter manually…" swaps back
// to the text field instead of trying to represent free text as a <select>.
function onEmbedModelSelectChange() {
  const select = document.getElementById('pvEmbedModelSelect');
  const input = document.getElementById('pvEmbedModel');
  if (select.value === '__custom__') {
    select.style.display = 'none'; input.style.display = ''; input.value = ''; input.focus();
  } else if (select.value) {
    input.value = select.value;
  }
}
// Marks a provider-type chip as selected and shows/hides the server-URL field and hint text accordingly.
function selectProviderType(type) {
  document.querySelectorAll('.type-chip').forEach(el => el.classList.toggle('selected', el.dataset.type === type));
  document.getElementById('pvServerUrlGroup').style.display = (type === 'openai-compat') ? 'block' : 'none';
  // kiconnect-nrw uses a fixed URL – no manual input needed
  const hint = document.getElementById('pvProviderHint');
  if (hint) {
    const hintText = PROVIDER_HINTS[type];
    if (hintText) { hint.textContent = hintText; hint.style.display = 'block'; }
    else hint.style.display = 'none';
  }
}
// Returns the currently selected provider type chip's value.
function getSelectedProviderType() { return document.querySelector('.type-chip.selected')?.dataset.type || 'openai-compat'; }

// Shows two sequential confirmations before a non-localhost server URL can
// be saved to a Provider, since the proxy blocks LAN/private addresses
// (SSRF protection) unless explicitly unlocked here.
function confirmLanAddress(hostname) {
  const msg1 = tf('js.lanConfirm1', { host: hostname }) ||
    `⚠️ "${hostname}" is not localhost - it looks like an address on your local network (or beyond).\n\nThis app will be allowed to send requests to that address. Only continue if you set this up yourself and trust it.\n\nContinue?`;
  if (!confirm(msg1)) return false;
  const msg2 = tf('js.lanConfirm2', { host: hostname }) ||
    `Please confirm once more: allow network access to "${hostname}"?\n\nYou can revoke this later by editing or deleting the provider.`;
  if (!confirm(msg2)) return false;
  return true;
}
// Validates and saves the provider editor form, creating or updating a provider, then refreshes the model list.
async function saveProviderEditor() {
  const name = document.getElementById('pvNameInput').value.trim();
  if (!name) { toast(t('js.nameRequired')); return; }
  const type = getSelectedProviderType();
  const serverUrl = normalizeOpenAIBaseUrl(document.getElementById('pvServerUrl').value);
  if (type === 'openai-compat' && !serverUrl) { toast(t('js.urlRequired')); return; }
  const apiKey = document.getElementById('pvApiKey').value.trim();

  // Non-localhost server URLs need an explicit, double-confirmed opt-in -
  // the proxy won't forward requests to them otherwise. Re-confirming is
  // skipped only if this exact host was already confirmed for this same
  // provider (so re-saving unrelated fields doesn't re-prompt).
  let netConfirmed = false, netConfirmedHost = '';
  if (type === 'openai-compat' && serverUrl) {
    let hostname = '';
    try { hostname = new URL(serverUrl).hostname.toLowerCase(); }
    catch { toast(t('js.invalidUrl') || 'Invalid server URL.'); return; }
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (!isLocal) {
      const existing = editingProviderId ? providers.find(p => p.id === editingProviderId) : null;
      const alreadyConfirmed = !!(existing && existing.netConfirmed && existing.netConfirmedHost === hostname);
      if (!alreadyConfirmed && !confirmLanAddress(hostname)) {
        toast(t('js.lanConfirmCancelled') || 'Cancelled - network address was not confirmed.');
        return;
      }
      netConfirmed = true; netConfirmedHost = hostname;
    }
  }

  const embeddingModel = document.getElementById('pvEmbedModel').value.trim();
  const data = { name, type, serverUrl: type==='openai-compat'?serverUrl:'', apiKey, embeddingModel, netConfirmed, netConfirmedHost };
  if (editingProviderId) {
    const idx = providers.findIndex(p => p.id === editingProviderId);
    if (idx !== -1) providers[idx] = {...providers[idx], ...data};
  } else {
    providers.push({ id: Date.now().toString(), ...data });
  }
  await save(); renderProviderList(); updateActiveProviderInfo();
  document.getElementById('providerEditor').style.display = 'none';
  fetchModels(); toast(t('js.providerSaved'));
  if (_tourActive && TOUR_STEPS[_tourStepIndex]?.target === '#saveProviderBtn') {
    setTimeout(nextTourStep, 250);
  }
}
// Closes the provider editor without saving.
function cancelProviderEditor() { document.getElementById('providerEditor').style.display = 'none'; }
// Removes a provider and refreshes the provider list and available models.
function deleteProvider(id) {
  providers = providers.filter(p => p.id !== id);
  delete _modelGroupsCache[id];
  save(); renderProviderList(); fetchModels();
}
// Reorders the providers array (used by both the ▲/▼ buttons and drag &
// drop in the Provider panel) — providers only ever had their creation
// order, with no way to permute that afterwards. `dir` is -1 (up) or +1
// (down) for button moves; drag & drop instead passes an explicit
// `toIndex`.
function moveProvider(id, dir) {
  const idx = providers.findIndex(p => p.id === id);
  if (idx === -1) return;
  const target = idx + dir;
  if (target < 0 || target >= providers.length) return;
  const [item] = providers.splice(idx, 1);
  providers.splice(target, 0, item);
  save(); renderProviderList();
}
function reorderProviderTo(draggedId, targetId) {
  if (draggedId === targetId) return;
  const fromIdx = providers.findIndex(p => p.id === draggedId);
  const toIdx = providers.findIndex(p => p.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [item] = providers.splice(fromIdx, 1);
  providers.splice(toIdx, 0, item);
  save(); renderProviderList();
}

// ── Profiles ──────────────────────────────────────────────────────
function activeProfile() { return profiles.find(p => p.id === config.activeProfileId) || null; }
// Applies a profile's system prompt, temperature and token settings to the active config and refreshes the badge/UI.
function applyProfile(p) {
  if (!p) return;
  config.activeProfileId = p.id;
  config.systemPrompt  = p.systemPrompt ?? '';
  config.temperature   = p.temperature  ?? 0.7;
  syncSettingsPanel(); updateProfileBadge();
  const sel = document.getElementById('modelSelector');
  if (sel && config.model) {
    sel.value = config.model;
    const inp = document.getElementById('modelInput');
    if (inp) inp.value = config.model;
  }
  save(); toast(`${t('js.profileActivated')}: „${p.name}"`);
}
// Updates the small profile-name/color badge shown near the model selector.
function updateProfileBadge() {
  const p = activeProfile();
  // Update legacy badge name (hidden via CSS but keep for safety)
  const nameEl = document.getElementById('profileBadgeName');
  if (nameEl) {
    if (p) { nameEl.textContent = p.name; nameEl.removeAttribute('data-i18n'); }
    else   { nameEl.textContent = t('header.noProfile'); nameEl.setAttribute('data-i18n','header.noProfile'); }
  }
  // Update profile color dot in toolbar button
  const dot = document.getElementById('profileBadgeDot');
  if (dot) {
    const col = p ? p.color : 'var(--muted)';
    dot.style.background = col;
    dot.style.boxShadow = p ? `0 0 6px ${col}` : 'none';
  }
  // Update Profil button label to show active profile name
  const profileBtn = document.getElementById('openProfileHeaderBtn');
  if (profileBtn) {
    const lbl = profileBtn.querySelector('.ptb-label');
    if (lbl) {
      if (p) {
        lbl.textContent = p.name;
        lbl.removeAttribute('data-i18n');
      } else {
        lbl.textContent = t('toolbar.profiles');
        lbl.setAttribute('data-i18n', 'toolbar.profiles');
      }
    }
  }
}

// (Re)builds the list of saved profiles in the Profile panel, grouped into
// user-defined folders (with select/edit/delete controls), mirroring the
// chat sidebar's folder system. Profiles and folders are both drag-and-drop
// reorderable / movable.
function renderProfileList() {
  const list = document.getElementById('profileList');
  list.innerHTML = '';
  if (!profiles.length && !profileFolders.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;padding:12px;';
    msg.textContent = t('js.noProfileList');
    list.appendChild(msg);
    return;
  }

  const unfiled = profiles.filter(p => !p.folderId || !profileFolders.find(f => f.id === p.folderId));

  profileFolders.forEach(f => {
    const fp = profiles.filter(p => p.folderId === f.id);
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder';
    folderDiv.draggable = true;
    folderDiv.dataset.folderId = f.id;
    folderDiv.addEventListener('dragstart', e => {
      if (!draggedProfileId) {
        e.stopPropagation();
        onProfileFolderDragStart(e, f.id);
        folderDiv.classList.add('folder-dragging');
      }
    });
    folderDiv.addEventListener('dragend', () => {
      folderDiv.classList.remove('folder-dragging');
      document.querySelectorAll('.folder-drag-over').forEach(el => el.classList.remove('folder-drag-over'));
    });
    folderDiv.addEventListener('dragover', e => {
      if (draggedProfileFolderId && draggedProfileFolderId !== f.id) {
        e.preventDefault(); e.stopPropagation();
        folderDiv.classList.add('folder-drag-over');
      }
    });
    folderDiv.addEventListener('dragleave', e => {
      if (!folderDiv.contains(e.relatedTarget)) folderDiv.classList.remove('folder-drag-over');
    });
    folderDiv.addEventListener('drop', e => {
      if (draggedProfileFolderId) onProfileFolderDrop(e, f.id);
      else onDropProfileFolder(e, f.id);
    });

    const header = document.createElement('div');
    header.className = 'folder-header';
    header.id = `pfh_${f.id}`;
    const arrow = document.createElement('span');
    arrow.className = 'folder-arrow ' + (f.collapsed ? '' : 'open');
    arrow.textContent = '▶';
    arrow.addEventListener('click', e => { e.stopPropagation(); toggleProfileFolder(f.id); });
    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    icon.textContent = f.collapsed ? '📁' : '📂';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-name';
    nameSpan.id = `pfname_${f.id}`;
    nameSpan.textContent = f.name;
    const countSpan = document.createElement('span');
    countSpan.className = 'folder-count'; countSpan.textContent = fp.length;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'folder-actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-btn'; renameBtn.textContent = '✏️';
    renameBtn.title = t('js.edit');
    renameBtn.addEventListener('click', e => { e.stopPropagation(); startRenamingProfileFolder(f.id); });
    const delBtn = document.createElement('button');
    delBtn.className = 'folder-btn danger'; delBtn.textContent = '🗑';
    delBtn.title = t('js.delete');
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteProfileFolder(f.id); });
    actionsDiv.appendChild(renameBtn); actionsDiv.appendChild(delBtn);
    header.appendChild(arrow); header.appendChild(icon); header.appendChild(nameSpan); header.appendChild(countSpan); header.appendChild(actionsDiv);
    header.addEventListener('dragover', e => {
      if (draggedProfileId) { e.preventDefault(); header.classList.add('drag-target'); }
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-target'));
    header.addEventListener('drop', e => { if (draggedProfileId) onDropProfileFolder(e, f.id); });
    header.addEventListener('click', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      f.collapsed = !f.collapsed; save(); renderProfileList();
    });
    // Double-click = collapse the folder (renaming is only ever triggered via the context menu or the ✏️ button)
    header.addEventListener('dblclick', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      if (!f.collapsed) { f.collapsed = true; save(); renderProfileList(); }
    });
    // Right-click = context menu with folder options (Rename / Move / Delete)
    header.addEventListener('contextmenu', e => showProfileFolderCtxMenu(e, f.id));


    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'folder-chats' + (f.collapsed ? ' collapsed' : '');
    itemsDiv.id = `pfc_${f.id}`;
    itemsDiv.addEventListener('dragover', e => { if (draggedProfileId) e.preventDefault(); });
    itemsDiv.addEventListener('drop', e => { if (draggedProfileId) onDropProfileFolder(e, f.id); });
    fp.forEach(p => itemsDiv.appendChild(buildProfileItem(p)));
    folderDiv.appendChild(header); folderDiv.appendChild(itemsDiv);
    list.appendChild(folderDiv);
  });

  if (profileFolders.length > 0) {
    // "No folder" group, only shown once at least one real folder exists —
    // now collapsible like a real folder (was previously always expanded
    // with no way to hide it, which got noisy once several unfiled
    // profiles piled up).
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder unfiled-group';
    const header = document.createElement('div');
    header.className = 'folder-header';
    const arrow = document.createElement('span');
    arrow.className = 'folder-arrow ' + (unfiledProfilesCollapsed ? '' : 'open');
    arrow.textContent = '▶';
    const icon = document.createElement('span');
    icon.className = 'folder-icon'; icon.textContent = unfiledProfilesCollapsed ? '📁' : '🗂️';
    const nameSpan = document.createElement('span'); nameSpan.className = 'folder-name'; nameSpan.textContent = t('js.noFolder');
    const countSpan = document.createElement('span'); countSpan.className = 'folder-count'; countSpan.textContent = unfiled.length;
    header.appendChild(arrow); header.appendChild(icon); header.appendChild(nameSpan); header.appendChild(countSpan);
    header.addEventListener('dragover', e => { if (draggedProfileId) { e.preventDefault(); header.classList.add('drag-target'); } });
    header.addEventListener('dragleave', () => header.classList.remove('drag-target'));
    header.addEventListener('drop', e => { if (draggedProfileId) onDropProfileFolder(e, null); });
    header.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      toggleUnfiledProfiles();
    });
    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'folder-chats' + (unfiledProfilesCollapsed ? ' collapsed' : '');
    itemsDiv.id = 'pfc_unfiled';
    itemsDiv.addEventListener('dragover', e => { if (draggedProfileId) e.preventDefault(); });
    itemsDiv.addEventListener('drop', e => { if (draggedProfileId) onDropProfileFolder(e, null); });
    unfiled.forEach(p => itemsDiv.appendChild(buildProfileItem(p)));
    folderDiv.appendChild(header); folderDiv.appendChild(itemsDiv);
    list.appendChild(folderDiv);
    return;
  }

  // No real folders exist yet — nothing to group against, so just list the
  // (necessarily unfiled) profiles plainly without a collapsible wrapper.
  const unfiledDiv = document.createElement('div');
  unfiledDiv.className = 'profile-list';
  unfiledDiv.addEventListener('dragover', e => { if (draggedProfileId) e.preventDefault(); });
  unfiledDiv.addEventListener('drop', e => { if (draggedProfileId) onDropProfileFolder(e, null); });
  unfiled.forEach(p => unfiledDiv.appendChild(buildProfileItem(p)));
  list.appendChild(unfiledDiv);
}
// Toggles (and persists) whether the "No Folder" group in the Agent
// Profiles list is collapsed. Kept in localStorage (like the theme) rather
// than the encrypted profileFolders store, since it's pure UI state, not
// account data.
function toggleUnfiledProfiles() {
  unfiledProfilesCollapsed = !unfiledProfilesCollapsed;
  localStorage.setItem('kic_unfiled_profiles_collapsed', unfiledProfilesCollapsed ? '1' : '');
  renderProfileList();
}

// Builds the DOM element for a single profile entry (select/edit/delete
// controls, drag handlers for both reordering and moving between folders).
function buildProfileItem(p) {
  const item = document.createElement('div');
  item.className = 'profile-item' + (p.id === config.activeProfileId ? ' active' : '');
  item.dataset.id = p.id;
  item.draggable = true;
  item.addEventListener('dragstart', e => { e.stopPropagation(); onProfileDragStart(e, p.id); });
  item.addEventListener('dragover', e => {
    if (!draggedProfileId || draggedProfileId === p.id) return;
    e.preventDefault(); e.stopPropagation();
    item.classList.add('profile-drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('profile-drag-over'));
  item.addEventListener('drop', e => {
    if (!draggedProfileId) return;
    e.preventDefault(); e.stopPropagation();
    item.classList.remove('profile-drag-over');
    if (draggedProfileId !== p.id) reorderProfileTo(draggedProfileId, p.id);
    draggedProfileId = null;
  });
  item.addEventListener('click', () => selectProfile(item.dataset.id));
  const dot = document.createElement('div');
  dot.className = 'profile-item-dot'; dot.style.background = p.color;
  const info = document.createElement('div');
  info.className = 'profile-item-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'profile-item-name'; nameEl.textContent = p.name;
  const descEl = document.createElement('div');
  descEl.className = 'profile-item-desc';
  descEl.textContent = 'Temp ' + (p.temperature ?? 0.7);
  info.appendChild(nameEl); info.appendChild(descEl);
  const actions = document.createElement('div');
  actions.className = 'profile-item-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn'; editBtn.textContent = '✏️'; editBtn.title = t('js.edit');
  editBtn.dataset.id = p.id;
  editBtn.addEventListener('click', e => { e.stopPropagation(); editProfile(editBtn.dataset.id); });
  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn danger'; delBtn.textContent = '🗑'; delBtn.title = t('js.delete');
  delBtn.dataset.id = p.id;
  delBtn.addEventListener('click', e => { e.stopPropagation(); deleteProfile(delBtn.dataset.id); });
  actions.appendChild(editBtn); actions.appendChild(delBtn);
  item.appendChild(dot); item.appendChild(info); item.appendChild(actions);
  return item;
}

// ── Profile folders — with drag & drop, mirrors the chat-folder system ──
function newProfileFolder() {
  const id = Date.now().toString();
  profileFolders.push({ id, name: t('js.newFolder'), collapsed: false });
  save(); renderProfileList(); setTimeout(() => startRenamingProfileFolder(id), 50);
}
// Deletes a profile folder; unlike chat folders, the profiles inside are
// NOT deleted — they're just moved back out to the unfiled list, since a
// profile (system prompt etc.) is much more costly to recreate than a chat.
function deleteProfileFolder(id) {
  const f = profileFolders.find(x => x.id === id);
  const inside = profiles.filter(p => p.folderId === id);
  if (inside.length && !confirm(tf('js.deleteProfileFolderConfirm', { name: f?.name || '', n: inside.length }))) return;
  inside.forEach(p => { p.folderId = null; });
  profileFolders = profileFolders.filter(f => f.id !== id);
  save(); renderProfileList();
}
function toggleProfileFolder(id) {
  const f = profileFolders.find(x => x.id === id);
  if (f) { f.collapsed = !f.collapsed; save(); renderProfileList(); }
}
function startRenamingProfileFolder(id) {
  const nameEl = document.getElementById(`pfname_${id}`);
  const f = profileFolders.find(x => x.id === id);
  if (!nameEl || !f) return;
  const input = document.createElement('input');
  input.className = 'folder-name-input'; input.value = f.name;
  input.addEventListener('blur', () => commitRenameProfileFolder(id, input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  nameEl.replaceWith(input); input.focus(); input.select();
}
function commitRenameProfileFolder(id, newName) {
  const f = profileFolders.find(x => x.id === id);
  if (f) f.name = (newName || '').trim() || f.name;
  save(); renderProfileList();
}
function onProfileFolderDragStart(e, id) {
  draggedProfileFolderId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'profileFolder:' + id);
}
function onProfileFolderDrop(e, targetId) {
  e.preventDefault(); e.stopPropagation();
  document.querySelectorAll('.folder-drag-over').forEach(el => el.classList.remove('folder-drag-over'));
  if (!draggedProfileFolderId || draggedProfileFolderId === targetId) { draggedProfileFolderId = null; return; }
  const fromIdx = profileFolders.findIndex(f => f.id === draggedProfileFolderId);
  const toIdx = profileFolders.findIndex(f => f.id === targetId);
  if (fromIdx === -1 || toIdx === -1) { draggedProfileFolderId = null; return; }
  const [moved] = profileFolders.splice(fromIdx, 1);
  profileFolders.splice(toIdx, 0, moved);
  draggedProfileFolderId = null;
  save(); renderProfileList();
}
// Marks a profile as the one currently being dragged in the profile panel.
function onProfileDragStart(e, id) {
  draggedProfileId = id;
  e.dataTransfer.effectAllowed = 'move';
  if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'profile:' + id);
}
// Handles a profile being dropped onto a folder (or the "no folder" zone).
function onDropProfileFolder(e, folderId) {
  e.preventDefault();
  document.querySelectorAll('.drag-target').forEach(el => el.classList.remove('drag-target'));
  if (!draggedProfileId) return;
  const p = profiles.find(x => x.id === draggedProfileId);
  if (p) p.folderId = folderId || null;
  draggedProfileId = null;
  save(); renderProfileList();
}
// Reorders `profiles` so draggedId sits right next to targetId — used when
// a profile is dropped directly on another profile item, so profiles can
// be freely reordered within (or moved between) folders.
function reorderProfileTo(draggedId, targetId) {
  const dragged = profiles.find(p => p.id === draggedId);
  const target = profiles.find(p => p.id === targetId);
  if (!dragged || !target) return;
  if (dragged.folderId !== target.folderId) dragged.folderId = target.folderId || null;
  const fromIdx = profiles.indexOf(dragged);
  let toIdx = profiles.indexOf(target);
  if (fromIdx === -1 || toIdx === -1) return;
  profiles.splice(fromIdx, 1);
  toIdx = profiles.indexOf(target);
  profiles.splice(toIdx + 1, 0, dragged);
  save(); renderProfileList();
}

// Applies the chosen profile and re-renders the profile list to reflect the new selection.
function selectProfile(id) { const p = profiles.find(x=>x.id===id); if(p) { applyProfile(p); renderProfileList(); } }

// Resets and opens the profile editor for creating a new profile.
function startNewProfile() {
  editingProfileId = null;
  document.getElementById('peNameInput').value  = '';
  document.getElementById('peSysPrompt').value  = '';
  document.getElementById('peTemp').value       = '0.7';
  document.getElementById('peTempVal').textContent = '0.7';
  document.getElementById('peUseModelMax').checked = true;
  document.getElementById('profileEditorTitle').textContent = t('profile.new');
  renderColorRow(PROFILE_COLORS[profiles.length % PROFILE_COLORS.length]);
  document.getElementById('profileEditor').style.display = 'block';
}
// Opens the profile editor pre-filled with an existing profile's data.
function editProfile(id) {
  const p = profiles.find(x=>x.id===id); if(!p) return;
  editingProfileId = id;
  document.getElementById('peNameInput').value     = p.name;
  document.getElementById('peSysPrompt').value     = p.systemPrompt||'';
  document.getElementById('peTemp').value          = p.temperature??0.7;
  document.getElementById('peTempVal').textContent = p.temperature??0.7;
  document.getElementById('peUseModelMax').checked = p.useModelMax !== false;
  document.getElementById('profileEditorTitle').textContent = t('profile.edit');
  renderColorRow(p.color);
  const { modelId } = splitModelId(config.model);
  const modelMax = getModelMaxOutput(modelId);
  const slider = document.getElementById('peMaxTokensSlider');
  const storedVal = p.maxTokens || modelMax;
  slider.max = modelMax; slider.value = Math.min(storedVal, modelMax);
  document.getElementById('peMaxTokensNum').textContent = parseInt(slider.value).toLocaleString();
  document.getElementById('profileEditor').style.display = 'block';
}
// Syncs the profile editor's max-tokens slider/label with the currently selected model's limits.
function updatePeMaxTokensUI() {
  const fullId = config.model;
  const { modelId } = splitModelId(fullId);
  const max = getModelMaxOutput(modelId);
  const useMax = document.getElementById('peUseModelMax').checked;
  const label = document.getElementById('peModelMaxLabel');
  const group = document.getElementById('peMaxTokensGroup');
  const slider = document.getElementById('peMaxTokensSlider');
  const numEl = document.getElementById('peMaxTokensNum');
  if (label) label.textContent = modelId ? `Max: ${max.toLocaleString()}` : '';
  if (group) group.style.display = useMax ? 'none' : 'block';
  if (slider) {
    slider.max = max;
    if (parseInt(slider.value) > max) { slider.value = max; if(numEl) numEl.textContent = max.toLocaleString(); }
    if (numEl) numEl.textContent = parseInt(slider.value).toLocaleString();
  }
}
// (Re)builds the color-swatch picker, marking the given color as selected.
function renderColorRow(sel) {
  const row = document.getElementById('colorRow');
  row.innerHTML = '';
  PROFILE_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (c === sel ? ' selected' : '');
    sw.style.background = c;
    sw.dataset.color = c;
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
      sw.classList.add('selected');
    });
    row.appendChild(sw);
  });
}
// Returns the currently selected color swatch's value, or the first palette color as fallback.
function getSelectedColor() { return document.querySelector('.color-swatch.selected')?.dataset.color || PROFILE_COLORS[0]; }
// Validates and saves the profile editor form, creating or updating a profile.
function saveProfileEditor() {
  const name = document.getElementById('peNameInput').value.trim();
  if (!name) { toast(t('js.nameRequired')); return; }
  const sliderVal = parseInt(document.getElementById('peMaxTokensSlider').value);
  const useModelMax = document.getElementById('peUseModelMax').checked;
  const data = {
    name, color: getSelectedColor(),
    systemPrompt: document.getElementById('peSysPrompt').value,
    temperature: parseFloat(document.getElementById('peTemp').value),
    useModelMax, maxTokens: useModelMax ? null : sliderVal,
  };
  if (editingProfileId) {
    const idx = profiles.findIndex(p=>p.id===editingProfileId);
    if (idx !== -1) { profiles[idx] = {...profiles[idx], ...data}; if(config.activeProfileId===editingProfileId) applyProfile(profiles[idx]); }
  } else {
    const p = {id: Date.now().toString(), ...data}; profiles.push(p); applyProfile(p);
  }
  save(); renderProfileList(); document.getElementById('profileEditor').style.display = 'none'; toast(t('js.profileSaved'));
}
// Closes the profile editor without saving.
function cancelProfileEditor() { document.getElementById('profileEditor').style.display = 'none'; }
// Removes a profile; if it was active, resets to defaults or falls back to another profile.
function deleteProfile(id) {
  profiles = profiles.filter(p=>p.id!==id);
  if (config.activeProfileId === id) {
    config.activeProfileId = null; config.systemPrompt = ''; config.temperature = 0.7; config.maxTokens = null;
    if (profiles[0]) applyProfile(profiles[0]); else { updateProfileBadge(); syncSettingsPanel(); }
  }
  save(); renderProfileList();
}

// ── Settings ──────────────────────────────────────────────────────
function syncSettingsPanel() {
  document.getElementById('temperature').value   = config.temperature;
  document.getElementById('tempVal').textContent = config.temperature;
  document.getElementById('systemPrompt').value  = config.systemPrompt||'';
  const w = config.chatMaxWidth || 880;
  const slider = document.getElementById('chatWidthSlider');
  const label  = document.getElementById('chatWidthVal');
  if (slider) slider.value = w;
  if (label)  label.textContent = w + 'px';
  const imgSizeEl = document.getElementById('maxImgSizeInput');
  if (imgSizeEl) imgSizeEl.value = Math.round(getMaxImageStorageBytes() / 1024);
  const webModeEl = document.getElementById('webSearchMode');
  const webEngineEl = document.getElementById('webSearchEngine');
  const webKeyEl = document.getElementById('webSearchApiKey');
  const webKeyGroup = document.getElementById('webSearchApiKeyGroup');
  const webCountEl = document.getElementById('webSearchCount');
  const webCountVal = document.getElementById('webSearchCountVal');
  if (webModeEl) webModeEl.value = config.webSearchMode || 'manual';
  if (webEngineEl) webEngineEl.value = config.webSearchEngine || 'free';
  if (webKeyEl) webKeyEl.value = config.webSearchApiKey || '';
  updateWebSearchKeyUI(config.webSearchEngine || 'free');
  if (webCountEl) webCountEl.value = config.webSearchResultCount || 8;
  if (webCountVal) webCountVal.textContent = config.webSearchResultCount || 8;
  updateWebSearchButton();
  // ttsProvider/sttProvider are chosen values that live in kiconnect-voice.js's own
  // (unencrypted, non-sensitive) settings object, not in `config` — only the API
  // keys themselves live in config.audioProviders. window.kicVoiceGetSetting/
  // SetSetting is the small bridge kiconnect-voice.js exposes for that.
  const ttsProviderEl = document.getElementById('ttsProviderSelect');
  const sttProviderEl = document.getElementById('sttProviderSelect');
  if (ttsProviderEl) ttsProviderEl.value = (window.kicVoiceGetSetting?.('ttsProvider')) || 'browser';
  if (sttProviderEl) sttProviderEl.value = (window.kicVoiceGetSetting?.('sttProvider')) || 'browser';
  updateAudioProviderKeyUI();
  // Populate account name field
  const accNameInput = document.getElementById('accountNameInput');
  if (accNameInput && _activeAccountId) {
    const acc = getAccount(_activeAccountId);
    if (acc) accNameInput.value = acc.name;
  }
  updateActiveProviderInfo(); updateModelMaxInfo();
}

// Tuning panel now auto-saves every field as you change it, so the
// old "Save & load models" button is gone. Text/number/range fields debounce (500ms
// after the last change) so we don't hammer storage on every keystroke; selects/buttons
// save right away since a click is already a discrete, deliberate action.
let _tuningSaveTimer = null;
// Debounces save() calls from the tuning panel's text/number/range inputs (fires 500ms after the last change).
function scheduleTuningSave() {
  clearTimeout(_tuningSaveTimer);
  _tuningSaveTimer = setTimeout(() => save(), 500);
}
// Applies a chat max-width value (px) to the layout and syncs the tuning-panel slider/label.
function applyChatWidth(val) {
  val = parseInt(val);
  document.documentElement.style.setProperty('--chat-max-w', val + 'px');
  const slider = document.getElementById('chatWidthSlider');
  const label  = document.getElementById('chatWidthVal');
  if (slider) slider.value = val;
  if (label)  label.textContent = val + 'px';
  config.chatMaxWidth = val;
}

// ── Models ────────────────────────────────────────────────────────
let providerStatus = {};
// Caches the last successfully fetched model list per provider (populated by
// fetchModels()). Lets toggleProviderEnabled() rebuild the model dropdown
// instantly from memory instead of waiting on a fresh network round trip —
// see rebuildModelDropdownFromCache().
let _modelGroupsCache = {};

// Queries every enabled provider's /models endpoint (or uses static lists for fixed providers), merges the results into the model selector, and updates each provider's status indicator.
async function fetchModels() {
  if (!providers.length) { setStatus('yellow'); return; }
  let allGroups = [], anyOk = false, anyError = false;
  for (const provider of providers) {
    if (provider.enabled === false) { providerStatus[provider.id] = 'disabled'; continue; }
    if (!provider.apiKey) { providerStatus[provider.id] = 'nokey'; continue; }
    const groupModels = []; let provOk = false;

    if (provider.type === 'anthropic') {
      try {
        const res = await fetch(proxyUrl('https://api.anthropic.com/v1/models'), {
          headers: { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01',
                     'anthropic-dangerous-direct-browser-access': 'true' }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        const liveModels = data.data || [];
        const liveIds = new Set(liveModels.map(m => m.id));

        // ── Populate capabilities cache from live API metadata ────────
        let capsUpdated = false;
        liveModels.forEach(m => {
          if (!m.id) return;
          const caps = m.capabilities || {};
          const adaptiveThinking = caps.adaptive_thinking != null
            ? !!caps.adaptive_thinking
            : _isModernClaudeGen(m.id);
          const noTemperature = caps.temperature === false
            || (caps.temperature == null && adaptiveThinking);
          const prev = _anthropicModelCaps[m.id];
          if (!prev || prev.adaptiveThinking !== adaptiveThinking || prev.noTemperature !== noTemperature) {
            _anthropicModelCaps[m.id] = { adaptiveThinking, noTemperature };
            capsUpdated = true;
          }
        });
        if (capsUpdated) _saveAnthropicCaps();
        // ─────────────────────────────────────────────────────────────

        const modelsToShow = liveIds.size > 0
          ? [...liveIds].sort().reverse().map(id => ({ id, label: KNOWN_MODELS[id]?.label || id }))
          : CLAUDE_MODELS;
        modelsToShow.forEach(m => groupModels.push({
          fullId: makeModelId(provider.id, m.id || m),
          label: m.label || m.id || m, modelId: m.id || m
        }));
        provOk = true;
      } catch(e) {
        providerStatus[provider.id] = 'error'; anyError = true;
        renderProviderList(); updateActiveProviderInfo(); continue;
      }
    } else if (provider.type === 'openai-direct') {
      try {
        const res = await fetch(proxyUrl('https://api.openai.com/v1/models'), {
          headers: { 'Authorization': `Bearer ${provider.apiKey}` }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        const CHAT_PATTERN = /^(gpt-|o\d|chatgpt-)/;
        const EXCLUDE_PATTERN = /embed|whisper|tts|dall-e|realtime|audio|preview-\d{4}|transcribe|search$/;
        const PRIORITY_ORDER = ['gpt-4.1','gpt-4o','o4','o3','o1','gpt-4.5','gpt-4-turbo','gpt-3'];
        const liveModels = (data.data || [])
          .filter(m => CHAT_PATTERN.test(m.id) && !EXCLUDE_PATTERN.test(m.id))
          .sort((a, b) => {
            const pa = PRIORITY_ORDER.findIndex(p => a.id.startsWith(p));
            const pb = PRIORITY_ORDER.findIndex(p => b.id.startsWith(p));
            const ra = pa === -1 ? 999 : pa; const rb = pb === -1 ? 999 : pb;
            return ra !== rb ? ra - rb : b.id.localeCompare(a.id);
          });
        if (liveModels.length > 0) {
          const seenIds = new Set();
          liveModels.forEach(m => {
            if (seenIds.has(m.id)) return;
            seenIds.add(m.id);
            groupModels.push({
              fullId: makeModelId(provider.id, m.id), label: KNOWN_MODELS[m.id]?.label || m.id, modelId: m.id
            });
          });
        } else {
          OPENAI_MODELS.forEach(m => groupModels.push({
            fullId: makeModelId(provider.id, m.id), label: m.label, modelId: m.id
          }));
        }
        provOk = true;
      } catch(e) {
        providerStatus[provider.id] = 'error'; anyError = true;
        renderProviderList(); updateActiveProviderInfo(); continue;
      }
    } else {
      const endpoint = getProviderEndpoint(provider);
      if (!endpoint) { providerStatus[provider.id] = 'error'; anyError = true; continue; }
      try {
        const extraHeaders = {};
        if (provider.type === 'openrouter') {
          extraHeaders['HTTP-Referer'] = window.location.origin;
          extraHeaders['X-Title'] = 'KI Connect NRW';
        }
        if (provider.type === 'zhipu') {
          extraHeaders['Accept-Language'] = 'en-US,en';
        }
        const res = await fetch(proxyUrl(`${endpoint}/models`), {
          headers: { 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        const rawModels = data.data || data.models || [];
        if (provider.type === 'openrouter') {
          let orCacheUpdated = false;
          const seenIds = new Set();
          rawModels
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
            .forEach(m => {
              if (seenIds.has(m.id)) return;
              seenIds.add(m.id);
              const isThinking = THINKING_MODELS.has(m.id) || /thinking|reason|qwq|r1/i.test(m.id);
              const lbl = (m.name || m.id) + (isThinking ? ' 🧠' : '');
              groupModels.push({ fullId: makeModelId(provider.id, m.id), label: lbl, modelId: m.id });
              const maxOut = m.top_provider?.max_completion_tokens || m.per_request_limits?.max_completion_tokens || 0;
              const ctxLen = m.context_length || 0;
              if ((maxOut > 0 || ctxLen > 0) && !KNOWN_MODELS[m.id]) {
                _orModelMeta[m.id] = { maxOutput: maxOut || 0, contextLength: ctxLen };
                orCacheUpdated = true;
              }
            });
          if (orCacheUpdated) _saveOrCache();
        } else {
		  const EMBED_FILTER = /embed|e5-|bge-|rerank|whisper|tts|dall-e/i;
          const seenIds = new Set();
          rawModels.forEach(m => {
            // Google's /v1beta/openai/models endpoint returns native Gemini-style
            // IDs like "models/gemini-2.5-pro" even though this is the
            // OpenAI-compatible route, which expects (and the UI should show)
            // the bare "gemini-2.5-pro" form — strip the prefix if present.
            const id = (m.id || m.name || '').replace(/^models\//, ''); if (!id) return;
			if (EMBED_FILTER.test(id)) return;
            // Some providers' /models endpoints return the same id more than once
            // (duplicate catalog entries) — keep only the first occurrence.
            if (seenIds.has(id)) return;
            seenIds.add(id);
            const knownLabel = KNOWN_MODELS[id]?.label;
            const isThinking = THINKING_MODELS.has(id) || isThinkingCapable(id);
            const lbl = (knownLabel || id) + (isThinking ? ' 🧠' : '');
            groupModels.push({ fullId: makeModelId(provider.id, id), label: lbl, modelId: id });
          });
        }
        provOk = true;
      } catch(e) {
        providerStatus[provider.id] = 'error'; anyError = true;
        renderProviderList(); updateActiveProviderInfo(); continue;
      }
    }
    if (provOk) { providerStatus[provider.id] = 'ok'; anyOk = true; }
    if (groupModels.length) {
      allGroups.push({ providerId: provider.id, providerName: provider.name, models: groupModels });
      _modelGroupsCache[provider.id] = { providerName: provider.name, models: groupModels };
    }
  }
  if (!anyOk && anyError) setStatus('red'); else if (anyError) setStatus('red'); else if (anyOk) setStatus('green');
  renderProviderList(); updateActiveProviderInfo();
  if (!allGroups.length && anyError) toast(t('js.noModelLoaded'));
  applyModelGroupsToUI(allGroups);
}

// Rebuilds the model dropdown from {providerId, providerName, models} groups,
// falling back to the first available model if the current one is gone.
// Shared by fetchModels() and rebuildModelDropdownFromCache().
function applyModelGroupsToUI(allGroups) {
  const ph = `<option value="">${escHtml(t('js.selectModel'))}</option>`;
  if (!allGroups.length) {
    ['modelSelector','modelInput'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=ph; });
    if (window.buildCustomDropdownData) buildCustomDropdownData();
    return;
  }
  let optsHtml = ph;
  allGroups.forEach(g => {
    optsHtml += `<optgroup label="${escHtml(g.providerName)}">`;
    g.models.forEach(m => {
      optsHtml += `<option value="${escHtml(m.fullId)}">${escHtml(m.label)}</option>`;
    });
    optsHtml += '</optgroup>';
  });
  ['modelSelector','modelInput'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = optsHtml;
    el.value = config.model || '';
  });
  const sel = document.getElementById('modelSelector');
  if (sel && !sel.value && allGroups[0]?.models[0]) {
    // The previously selected model isn't in the list anymore (e.g. its
    // provider was just disabled/deleted) — fall back to the first
    // available one so normal chatting keeps working immediately.
    config.model = allGroups[0].models[0].fullId;
    sel.value = config.model;
    const mi = document.getElementById('modelInput'); if (mi) mi.value = config.model;
    save();
  }
  if (sel) {
    sel.onchange = () => {
      config.model = sel.value;
      const mi = document.getElementById('modelInput'); if (mi) mi.value = config.model;
      updateModelMaxInfo(); updateThinkingUI(); save(); renderAttachments();
      if (window.syncCustomDropdown) syncCustomDropdown();
    };
  }
  updateModelMaxInfo(); syncAllModelSelects(); updateThinkingUI();
  if (window.buildCustomDropdownData) buildCustomDropdownData();
}

// Rebuilds the model dropdown from the in-memory cache only — no network
// calls. Used right after enabling/disabling a provider so the change is
// reflected for normal chatting instantly, instead of waiting on fetchModels()
// to finish its (potentially slow) round trip to every enabled provider.
function rebuildModelDropdownFromCache() {
  const allGroups = [];
  providers.forEach(provider => {
    if (provider.enabled === false || !provider.apiKey) return;
    const cached = _modelGroupsCache[provider.id];
    if (cached && cached.models.length) {
      allGroups.push({ providerId: provider.id, providerName: provider.name, models: cached.models });
    }
  });
  applyModelGroupsToUI(allGroups);
}
// Refreshes the 'max output tokens' hint shown near the model selector for the currently selected model.
function updateModelMaxInfo() {
  const { modelId } = splitModelId(config.model);
  const max = getModelMaxOutput(modelId);
  const el = document.getElementById('modelMaxInfo');
  if (el) el.textContent = modelId ? tf('js.modelMax', {n: max.toLocaleString()}) : '';
}

// ── Thinking / Reasoning UI ───────────────────────────────────────
const OAI_EFFORT = { 1: 'low', 2: 'medium', 3: 'high' };
const CLAUDE_BUDGET = { 1: 2000, 2: 8000, 3: 20000 };

// Returns whether a model ID supports the extended-thinking / reasoning-effort feature.
function isThinkingCapable(modelId) {
  if (!modelId) return false;
  const bare = modelId.split('/').pop().toLowerCase();
  return THINKING_MODELS.has(modelId) || THINKING_MODELS.has(bare) ||
    /^o\d/.test(bare) || /^(chatgpt-)?gpt-5/.test(bare) || isAnthropicThinkingModel(bare) ||
    isGeminiThinkingModel(bare) || isMiniMaxThinkingModel(bare) || isMistralThinkingModel(bare) ||
    /thinking|reason/i.test(bare) || /deepseek-r|deepseek-v4|qwen.*think|qwq|llama.*reason/i.test(bare) ||
    /^glm-(5|4\.[567])/i.test(bare);
}
// Returns whether a model ID is a Gemini model that supports the `thinking`/
// reasoning_effort controls. Gemini 2.5+ ships with thinking enabled by
// default; older 1.x/2.0 (non-"thinking") generations don't support it.
function isGeminiThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop().toLowerCase();
  if (/gemini.*thinking/.test(bare)) return true;
  const m = /^gemini-(\d+(?:\.\d+)?)/.exec(bare);
  if (!m) return false;
  return parseFloat(m[1]) >= 2.5; // 2.5+ generations ship with thinking on by default
}
// Returns whether a model ID is a MiniMax reasoning model (M-series). These
// always think (M2.x can't even be turned off) and have no effort/intensity
// levels — only an on/off toggle, handled separately via isFixedThinkingModel().
function isMiniMaxThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop().toLowerCase();
  return /^minimax-(m\d|text-)/.test(bare) || /^minimaxai\/minimax-m\d/.test(bare);
}
// Returns whether a model ID is a Mistral "native" reasoning model (Magistral
// family): these always reason, take no reasoning_effort parameter, and
// return content as an array of {type:'thinking'|'text'} chunks — same as
// the adjustable models below when reasoning_effort:'high' is used.
// See https://docs.mistral.ai/studio-api/conversations/reasoning/native
function isMistralNativeThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop().toLowerCase();
  // magistral-small-latest now resolves to Mistral Small 4 (adjustable, see
  // below) rather than the original Magistral Small — only magistral-medium
  // and dated magistral-small-YYMM snapshots are still "always reasons".
  return /^magistral-medium(-latest)?$/.test(bare) || /^magistral-small-\d+$/.test(bare);
}
// Returns whether a model ID is a Mistral "adjustable" reasoning model
// (mistral-small-latest / mistral-medium-3-5 and its -latest alias): these
// think only when reasoning_effort is explicitly set to 'high' (root-level
// field), and are otherwise plain chat models.
// See https://docs.mistral.ai/studio-api/conversations/reasoning/adjustable
function isMistralAdjustableThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop().toLowerCase();
  return /^mistral-small(-latest)?$/.test(bare) || /^mistral-medium(-3-5|-latest)?$/.test(bare) || /^magistral-small-latest$/.test(bare);
}
function isMistralThinkingModel(modelId) {
  return isMistralNativeThinkingModel(modelId) || isMistralAdjustableThinkingModel(modelId);
}
// Mistral reasoning models return `content` as a list of chunks instead of a
// plain string: {type:'text', text} and {type:'thinking', thinking}. Plain
// string content is handled too, so callers need only one code path.
// See https://docs.mistral.ai/studio-api/conversations/reasoning/native
function parseMistralContent(content) {
  if (typeof content === 'string') return { text: content, reasoning: '' };
  if (!Array.isArray(content)) return { text: '', reasoning: '' };
  let text = '', reasoning = '';
  for (const part of content) {
    if (!part) continue;
    if (part.type === 'text' && typeof part.text === 'string') text += part.text;
    else if (part.type === 'thinking') {
      if (typeof part.thinking === 'string') reasoning += part.thinking;
      else if (Array.isArray(part.thinking)) reasoning += part.thinking.map(t => (t && t.text) || '').join('');
    }
  }
  return { text, reasoning };
}
// Returns whether a model has thinking permanently on/off-only, with no
// low/medium/high effort levels to expose in the UI (MiniMax, and Mistral's
// native Magistral models which always reason regardless of any parameter).
function isFixedThinkingModel(modelId) {
  return isMiniMaxThinkingModel(modelId) || isMistralNativeThinkingModel(modelId);
}
// Returns whether a model ID is an Anthropic Claude model with thinking support at all
// (either the legacy budget_tokens format or the newer adaptive-effort format).
// Built on the same opt-out list as isAdaptiveThinkingModel/isTemperatureSupported
// above, so a new Claude release only needs to be handled in one place.
function isAnthropicThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop();
  return /^claude-/i.test(bare) && !CLAUDE_NO_THINKING_RE.test(bare);
}
// Returns whether a model uses the legacy budget_tokens thinking format rather than adaptive effort.
function usesTokenBudget(modelId) {
  const bare = (modelId || '').split('/').pop();
  return CLAUDE_LEGACY_THINKING_RE.test(bare);
}
// Shows/hides the thinking-mode controls depending on whether the selected model supports it.
function updateThinkingUI() {
  const { modelId } = splitModelId(config.model);
  const capable = isThinkingCapable(modelId);
  const group = document.getElementById('thinkingGroup');
  if (group) group.style.display = capable ? 'flex' : 'none';
  if (!capable && config.thinkingEnabled) {
    config.thinkingEnabled = false;
    document.getElementById('thinkingToggle')?.classList.remove('active');
    document.getElementById('thinkingIntensity')?.classList.remove('visible');
  }
  configureThinkingSlider(modelId);
  updateThinkingIntensityUI();
}
// Configures the thinking-intensity slider's range/labels for the given model (adaptive effort levels vs legacy token budget).
function configureThinkingSlider(modelId) {
  const slider = document.getElementById('thinkingIntensitySlider');
  const label  = document.getElementById('thinkingIntensityLabel');
  const wrap   = document.getElementById('thinkingIntensity');
  if (!slider) return;
  // Fixed-thinking models (currently MiniMax) have no low/medium/high effort
  // level to pick — thinking is just on or off, so hide the slider entirely.
  if (wrap) wrap.classList.toggle('fixed-hidden', isFixedThinkingModel(modelId));
  if (isFixedThinkingModel(modelId)) return;
  if (usesTokenBudget(modelId) && !isAdaptiveThinkingModel(modelId)) {
    // Legacy Claude 3.7: budget slider in tokens
    slider.min='1024'; slider.max='32000'; slider.step='256';
    slider.value = String(config.thinkingBudget || 8000);
    if (label) label.textContent = t('thinking.budget');
  } else {
    // Claude 4+ (adaptive) or non-Anthropic thinking models: 3-level effort slider
    slider.min='1'; slider.max='3'; slider.step='1';
    slider.value = String(config.thinkingIntensity || 2);
    if (label) label.textContent = t('thinking.intensity');
  }
}
// Refreshes the thinking-intensity slider's displayed label/value.
function updateThinkingIntensityUI() {
  const slider = document.getElementById('thinkingIntensitySlider');
  const label  = document.getElementById('thinkingIntensityVal');
  if (!slider || !label) return;
  const { modelId } = splitModelId(config.model);
  if (isFixedThinkingModel(modelId)) return;
  // Legacy Claude 3.7: show token budget (e.g. "8k tok")
  if (usesTokenBudget(modelId) && !isAdaptiveThinkingModel(modelId)) {
    const budget = config.thinkingBudget || 8000;
    label.textContent = budget >= 1000 ? (budget/1000).toFixed(1).replace('.0','')+'k tok' : budget+' tok';
  } else {
    // Claude 4+ adaptive and all other thinking models: show translated effort label
    const val = config.thinkingIntensity || 2;
    const ikeys = { 1:'thinking.low', 2:'thinking.medium', 3:'thinking.high' };
    label.textContent = t(ikeys[val]);
  }
}
// Toggles extended-thinking mode on/off for the current chat and persists the setting.
function toggleThinking() {
  const { modelId } = splitModelId(config.model);
  if (!isThinkingCapable(modelId)) return;
  config.thinkingEnabled = !config.thinkingEnabled;
  document.getElementById('thinkingToggle')?.classList.toggle('active', config.thinkingEnabled);
  document.getElementById('thinkingIntensity')?.classList.toggle('visible', config.thinkingEnabled);
  save();
  toast(config.thinkingEnabled ? t('js.thinkingEnabled') : t('js.thinkingDisabled'));
}
// No-op kept for backward compatibility; model selects are now synced individually where needed.
function syncAllModelSelects() {}
// Sets the connection-status indicator color (green/yellow/red).
function setStatus(c) {
  const d = document.getElementById('statusDot');
  if (!d) return;
  const colors = { green:'var(--green)', red:'var(--red)', yellow:'#f0c040', grey:'var(--muted)' };
  const col = colors[c] || colors.grey;
  d.style.background = col;
  d.style.boxShadow = `0 0 8px ${col}`;
  // pulse only while pending/streaming (yellow)
  d.style.animation = (c === 'yellow') ? 'pulse 1s infinite' : 'pulse 2s infinite';
}

// ── FOLDERS — drag & drop reordering ──────────────────────────────
function newFolder() {
  const id = Date.now().toString();
  folders.push({id, name: t('js.newFolder'), collapsed:false});
  save(); renderSidebar(); setTimeout(()=>startRenamingFolder(id), 50);
}
// Deletes a folder together with every chat inside it (after confirmation
// if it isn't empty), then switches away from the active chat if it was
// one of the deleted ones.
function deleteFolder(id) {
  const f = folders.find(x=>x.id===id);
  const inside = chats.filter(c=>c.folderId===id);
  if (inside.length && !confirm('\n🗂️ + 📝 → 🗑️ ❓') ) return;
  chats = chats.filter(c=>c.folderId!==id);
  folders = folders.filter(f=>f.id!==id);
  if (activeFolderId === id) activeFolderId = null;
  if (currentChatId && !chats.some(c=>c.id===currentChatId)) {
    currentChatId = chats[0]?.id || null;
    if (currentChatId) renderMessages(currentChat().messages);
    else { const c=document.getElementById('messages'); c.innerHTML=''; const e=document.getElementById('emptyState'); if(e){c.appendChild(e);e.style.display='';} syncComposerStreamingUI(); }
  }
  save(); renderSidebar();
}
// Expands/collapses a sidebar folder.
function toggleFolder(id) {
  const f = folders.find(x=>x.id===id);
  if (f) { f.collapsed=!f.collapsed; save(); renderSidebar(); }
}
// Puts a folder's sidebar entry into inline rename-edit mode.
function startRenamingFolder(id) {
  const el = document.getElementById(`fname_${id}`); if(!el) return;
  const f = folders.find(x=>x.id===id);
  const input = document.createElement('input');
  input.className = 'folder-name-input'; input.value = f.name;
  input.addEventListener('blur', () => commitRenameFolder(id, input.value));
  input.addEventListener('keydown', e => { if(e.key==='Enter') input.blur(); });
  el.replaceWith(input); input.focus();
}
// Applies a new folder name from the inline rename input and saves it.
function commitRenameFolder(id, newName) {
  const f = folders.find(x=>x.id===id);
  if (f) f.name = newName.trim() || f.name;
  save(); renderSidebar();
}

// Folder drag-and-drop reorder helpers
function onFolderDragStart(e, id) {
  draggedFolderId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'folder:' + id);
}
// Handles a chat (or folder) being dropped onto a folder in the sidebar, moving it there.
function onFolderDrop(e, targetId) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.folder-drag-over').forEach(el=>el.classList.remove('folder-drag-over'));
  if (!draggedFolderId || draggedFolderId === targetId) { draggedFolderId = null; return; }
  const fromIdx = folders.findIndex(f=>f.id===draggedFolderId);
  const toIdx   = folders.findIndex(f=>f.id===targetId);
  if (fromIdx === -1 || toIdx === -1) { draggedFolderId = null; return; }
  const [moved] = folders.splice(fromIdx, 1);
  folders.splice(toIdx, 0, moved);
  draggedFolderId = null;
  save(); renderSidebar();
}

// ── Chats ─────────────────────────────────────────────────────────
function currentChat() { return chats.find(c=>c.id===currentChatId); }
// Returns the folder ID a newly created chat should be placed in, based on the currently active sidebar folder.
function getSidebarTargetFolderId() {
  if (activeFolderId === null || folders.some(f=>f.id===activeFolderId)) return activeFolderId || null;
  const chat = currentChat();
  if (chat && (chat.folderId === null || folders.some(f=>f.id===chat.folderId))) return chat.folderId || null;
  return folders[0]?.id || null;
}
// Sets which sidebar folder is currently active/expanded for filtering the chat list.
function setActiveFolder(folderId) {
  activeFolderId = folderId || null;
  renderSidebar();
}
// Creates and switches to a new empty chat, optionally inside a given folder.
function newChat(folderId) {
  if (folderId === undefined) folderId = getSidebarTargetFolderId();
  const id = Date.now().toString();
  chats.unshift({id, title:'Chat::', folderId, messages:[]});
  activeFolderId = folderId || null;
  currentChatId = id; save(); renderSidebar(); renderMessages([]);
}
// Switches the active chat and re-renders the message list.
function switchChat(id) {
  currentChatId = id;
  const c = chats.find(x=>x.id===id);
  activeFolderId = c?.folderId || null;
  // Persist via server store (encrypted) – not raw localStorage
  _storePut(_activeAccountId, 'current_chat', id).catch(() => {
    localStorage.setItem(accountKey('current_chat'), id);
  });
  renderSidebar();
  if (c) renderMessages(c.messages);
}
// Deletes a chat after confirmation and switches to another chat if the deleted one was active.
function deleteChat(id) {
  chats = chats.filter(c=>c.id!==id);
  if (currentChatId === id) {
    currentChatId = chats[0]?.id||null;
    activeFolderId = currentChat()?.folderId || null;
    if (currentChatId) renderMessages(currentChat().messages);
    else { const c=document.getElementById('messages'); c.innerHTML=''; const e=document.getElementById('emptyState'); if(e){c.appendChild(e);e.style.display='';} syncComposerStreamingUI(); }
  }
  save(); renderSidebar();
}
// Puts a chat's sidebar entry into inline rename-edit mode.
function startRenamingChat(id) {
  const titleEl = document.getElementById(`ctitle_${id}`); if(!titleEl) return;
  const chat = chats.find(c=>c.id===id); if(!chat) return;
  const input = document.createElement('input');
  input.className = 'chat-item-title-input'; input.value = chat.title;
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('blur', () => { chat.title = input.value.trim()||chat.title; save(); renderSidebar(); });
  input.addEventListener('keydown', e => { if(e.key==='Enter') input.blur(); });
  titleEl.replaceWith(input); input.focus(); input.select();
}
// Returns the set of chat IDs a drag/move/delete action should apply to (the multi-selection if active, otherwise just the given chat).
function getMoveChatIds(chatId) {
  if (_selectedChatIds.has(chatId)) return [..._selectedChatIds].filter(id => chats.some(c => c.id === id));
  return [chatId];
}
// Moves one or more chats into a different folder (or out of all folders).
// Reorders `chats` so draggedId sits right next to targetId — used when a
// chat is dropped directly on another chat item in the sidebar. Only
// actually changes visual order (folder membership already matches; if it
// doesn't — dropped on a chat in a different folder — fall back to a plain
// move so the chat lands in the right folder instead of just appearing
// misplaced next to an unrelated chat).
function reorderChatTo(draggedId, targetId) {
  const dragged = chats.find(c => c.id === draggedId);
  const target = chats.find(c => c.id === targetId);
  if (!dragged || !target) return;
  if (dragged.folderId !== target.folderId) {
    dragged.folderId = target.folderId;
  }
  const fromIdx = chats.indexOf(dragged);
  let toIdx = chats.indexOf(target);
  if (fromIdx === -1 || toIdx === -1) return;
  chats.splice(fromIdx, 1);
  toIdx = chats.indexOf(target); // recompute after removal
  chats.splice(toIdx + 1, 0, dragged);
  if (draggedId === currentChatId) activeFolderId = dragged.folderId || null;
  save(); renderSidebar();
}
function moveChats(chatIds, folderId) {
  const ids = [...new Set(chatIds || [])];
  if (!ids.length) return;
  ids.forEach(id => {
    const c = chats.find(x => x.id === id);
    if (c) c.folderId = folderId;
  });
  if (ids.includes(currentChatId)) activeFolderId = folderId || null;
  save(); renderSidebar();
  toast(tf(ids.length > 1 ? 'js.chatsMoved' : 'js.chatMoved', { n: ids.length }));
}

// Opens the right-click context menu for a chat sidebar item at the cursor position.
function showChatCtxMenu(e, chatId) {
  e.preventDefault(); e.stopPropagation();
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';
  const targetIds = getMoveChatIds(chatId);
  const isMultiTarget = targetIds.length > 1;

  // Rename
  const renameItem = document.createElement('div');
  renameItem.className = 'ctx-item'; renameItem.textContent = t('js.rename');
  renameItem.dataset.id = chatId;
  renameItem.addEventListener('click', () => { startRenamingChat(renameItem.dataset.id); hideCtx(); });
  if (isMultiTarget) {
    renameItem.style.opacity = '0.5';
    renameItem.style.pointerEvents = 'none';
  }

  // Move to folder submenu
  if (folders.length > 0) {
    const moveItem = document.createElement('div');
    moveItem.className = 'ctx-item ctx-item-submenu';
    moveItem.textContent = '📂 ' + (t('js.moveToFolder') || 'Move to Folder') + ' ▶';
    const submenu = document.createElement('div');
    submenu.className = 'ctx-submenu';
    // "No folder" option
    const noFolderOpt = document.createElement('div');
    noFolderOpt.className = 'ctx-item';
    noFolderOpt.textContent = t('js.noFolder') || '— No Folder —';
    noFolderOpt.addEventListener('click', () => { moveChats(targetIds, null); hideCtx(); });
    submenu.appendChild(noFolderOpt);
    folders.forEach(f => {
      const opt = document.createElement('div');
      opt.className = 'ctx-item';
      const allAlreadyThere = targetIds.every(id => chats.find(c => c.id === id)?.folderId === f.id);
      if (allAlreadyThere) opt.style.opacity = '0.5';
      opt.textContent = f.name;
      opt.dataset.fid = f.id;
      opt.addEventListener('click', () => { moveChats(targetIds, opt.dataset.fid); hideCtx(); });
      submenu.appendChild(opt);
    });
    moveItem.appendChild(submenu);
    moveItem.addEventListener('mouseenter', () => submenu.classList.add('open'));
    moveItem.addEventListener('mouseleave', () => submenu.classList.remove('open'));
    menu.appendChild(renameItem);
    menu.appendChild(moveItem);
  } else {
    menu.appendChild(renameItem);
  }

  const delItem = document.createElement('div');
  delItem.className = 'ctx-item danger'; delItem.textContent = t('js.delete');
  delItem.dataset.id = chatId;
  delItem.addEventListener('click', () => { deleteChat(delItem.dataset.id); hideCtx(); });
  menu.appendChild(delItem);

  menu.style.display = 'block';
  const x = Math.min(e.clientX, window.innerWidth-180);
  const y = Math.min(e.clientY, window.innerHeight-120);
  menu.style.left = x+'px';
  menu.style.top  = y+'px';
}
// Hides the chat context menu.
function hideCtx() { document.getElementById('ctxMenu').style.display='none'; }
document.addEventListener('click', hideCtx);

// Shared builder behind showFolderCtxMenu/showProfileFolderCtxMenu (chat
// folders and profile folders use an identical Rename/Move/Delete menu,
// just against different arrays and callbacks).
function _buildFolderCtxMenu(e, folderId, list, { rename, moveUp, moveDown, del }) {
  e.preventDefault(); e.stopPropagation();
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';
  const idx = list.findIndex(f => f.id === folderId);

  const renameItem = document.createElement('div');
  renameItem.className = 'ctx-item'; renameItem.textContent = t('js.rename');
  renameItem.addEventListener('click', () => { rename(folderId); hideCtx(); });
  menu.appendChild(renameItem);

  // Move (purely symbolic, no dedicated translation needed) — submenu with ↑ / ↓
  const moveItem = document.createElement('div');
  moveItem.className = 'ctx-item ctx-item-submenu';
  moveItem.textContent = '↕️ ▶';
  const submenu = document.createElement('div');
  submenu.className = 'ctx-submenu';
  const upOpt = document.createElement('div');
  upOpt.className = 'ctx-item'; upOpt.textContent = '↑';
  if (idx <= 0) { upOpt.style.opacity = '0.5'; upOpt.style.pointerEvents = 'none'; }
  upOpt.addEventListener('click', () => { moveUp(folderId); hideCtx(); });
  submenu.appendChild(upOpt);
  const downOpt = document.createElement('div');
  downOpt.className = 'ctx-item'; downOpt.textContent = '↓';
  if (idx === -1 || idx >= list.length - 1) { downOpt.style.opacity = '0.5'; downOpt.style.pointerEvents = 'none'; }
  downOpt.addEventListener('click', () => { moveDown(folderId); hideCtx(); });
  submenu.appendChild(downOpt);
  moveItem.appendChild(submenu);
  moveItem.addEventListener('mouseenter', () => submenu.classList.add('open'));
  moveItem.addEventListener('mouseleave', () => submenu.classList.remove('open'));
  menu.appendChild(moveItem);

  const delItem = document.createElement('div');
  delItem.className = 'ctx-item danger'; delItem.textContent = t('js.delete');
  delItem.addEventListener('click', () => { del(folderId); hideCtx(); });
  menu.appendChild(delItem);

  menu.style.display = 'block';
  const x = Math.min(e.clientX, window.innerWidth-180);
  const y = Math.min(e.clientY, window.innerHeight-120);
  menu.style.left = x+'px';
  menu.style.top  = y+'px';
}
// Opens the right-click context menu for a folder sidebar entry (Rename / Move / Delete).
function showFolderCtxMenu(e, folderId) {
  _buildFolderCtxMenu(e, folderId, folders, {
    rename: startRenamingFolder, moveUp: id => moveFolder(id, -1), moveDown: id => moveFolder(id, 1), del: deleteFolder,
  });
}
// Moves a folder within the array up (-1) or down (+1) by one position.
function moveFolder(id, dir) {
  const idx = folders.findIndex(f => f.id === id);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= folders.length) return;
  const [moved] = folders.splice(idx, 1);
  folders.splice(newIdx, 0, moved);
  save(); renderSidebar();
}

// Opens the right-click context menu for a profile-folder entry (Rename / Move / Delete),
// mirroring showFolderCtxMenu for the chat sidebar.
function showProfileFolderCtxMenu(e, folderId) {
  _buildFolderCtxMenu(e, folderId, profileFolders, {
    rename: startRenamingProfileFolder, moveUp: id => moveProfileFolder(id, -1), moveDown: id => moveProfileFolder(id, 1), del: deleteProfileFolder,
  });
}
// Moves a profile folder within the array up (-1) or down (+1) by one position.
function moveProfileFolder(id, dir) {
  const idx = profileFolders.findIndex(f => f.id === id);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= profileFolders.length) return;
  const [moved] = profileFolders.splice(idx, 1);
  profileFolders.splice(newIdx, 0, moved);
  save(); renderProfileList();
}

// ── Multi-select helpers ──────────────────────────────────────────
function toggleChatSelect(id) {
  if (_selectedChatIds.has(id)) _selectedChatIds.delete(id);
  else _selectedChatIds.add(id);
  if (_selectedChatIds.size === 0) _multiSelectMode = false;
  renderSidebar();
}
// Switches the sidebar into multi-select mode for bulk chat actions.
function enterMultiSelectMode() {
  _multiSelectMode = true;
  _selectedChatIds.clear();
  document.body.classList.add('multiselect-active');
  renderSidebar();
}
// Leaves multi-select mode and clears the current chat selection.
function exitMultiSelectMode() {
  _multiSelectMode = false;
  _selectedChatIds.clear();
  document.body.classList.remove('multiselect-active');
  renderSidebar();
}
// Deletes all currently multi-selected chats after confirmation.
function deleteSelectedChats() {
  if (_selectedChatIds.size === 0) return;
  const ids = [..._selectedChatIds];
  ids.forEach(id => {
    chats = chats.filter(c => c.id !== id);
  });
  if (ids.includes(currentChatId)) {
    currentChatId = chats[0]?.id || null;
    if (currentChatId) renderMessages(currentChat().messages);
    else {
      const cont = document.getElementById('messages');
      const empty = document.getElementById('emptyState');
      Array.from(cont.children).forEach(el => { if(el!==empty) el.remove(); });
      if (empty) empty.style.display = '';
      syncComposerStreamingUI();
    }
  }
  _selectedChatIds.clear();
  _multiSelectMode = false;
  document.body.classList.remove('multiselect-active');
  save(); renderSidebar();
}
// Marks a chat as the one currently being dragged in the sidebar.
function onDragStart(e, id) {
  draggedChatId = id;
  e.dataTransfer.effectAllowed = 'move';
  if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'chat:' + id);
}
// Handles a chat being dropped directly onto (or out of) a folder target.
function onDropFolder(e, folderId) {
  e.preventDefault();
  document.querySelectorAll('.drag-target').forEach(el=>el.classList.remove('drag-target'));
  if (draggedChatId) {
    activeFolderId = folderId || null;
    moveChats(getMoveChatIds(draggedChatId), folderId);
    draggedChatId=null;
  }
}

// ── Sidebar Render ────────────────────────────────────────────────
function renderSidebar() {
  const container = document.getElementById('folderContainer');
  container.innerHTML = '';

  // Multi-select toolbar
  const actionsEl = document.querySelector('.sidebar-actions');
  let msBar = document.getElementById('multiSelectBar');
  if (actionsEl) {
    if (!msBar) {
      msBar = document.createElement('div');
      msBar.id = 'multiSelectBar';
      msBar.style.cssText = 'display:none;align-items:center;gap:6px;padding:8px 8px;background:var(--surface2);border-top:1px solid var(--border);flex-shrink:0;';
      actionsEl.parentNode.insertBefore(msBar, actionsEl);
    }
    if (_multiSelectMode) {
      msBar.style.display = 'flex';
      msBar.innerHTML = '';
      // Cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'sidebar-action-btn';
      cancelBtn.title = t('js.cancelSelection') || 'Cancel selection';
      cancelBtn.textContent = '✕';
      cancelBtn.style.cssText = 'flex:0 0 auto;min-width:38px;font-size:17px;padding:9px;line-height:1;';
      cancelBtn.addEventListener('click', exitMultiSelectMode);
      // Count label
      const countLbl = document.createElement('span');
      countLbl.style.cssText = 'flex:1;font-size:12.5px;color:var(--muted);font-family:"IBM Plex Mono",monospace;';
      countLbl.textContent = _selectedChatIds.size > 0 ? tf('js.chosenChats', {n: _selectedChatIds.size}) : (t('js.selectedChats') || 'Selected chats');
      // Select all
      const selAllBtn = document.createElement('button');
      selAllBtn.className = 'sidebar-action-btn';
      selAllBtn.title = t('js.selectAll') || 'Select all';
      selAllBtn.textContent = '☑';
      selAllBtn.style.cssText = 'flex:0 0 auto;min-width:38px;font-size:17px;padding:9px;line-height:1;';
      selAllBtn.addEventListener('click', () => {
        chats.forEach(c => _selectedChatIds.add(c.id));
        renderSidebar();
      });
      // Delete selected
      const delBtn = document.createElement('button');
      delBtn.className = 'sidebar-action-btn';
      delBtn.title = t('js.deleteSelectedItems') || 'Delete selected items';
      delBtn.textContent = '🗑';
      delBtn.style.cssText = 'flex:0 0 auto;min-width:38px;font-size:17px;padding:9px;line-height:1;color:var(--red);';
      delBtn.disabled = _selectedChatIds.size === 0;
      delBtn.addEventListener('click', () => {
        if (_selectedChatIds.size === 0) return;
        if (confirm(tf('js.deleteChatsConfirm', {n: _selectedChatIds.size}))) deleteSelectedChats();
      });
      msBar.appendChild(cancelBtn);
      msBar.appendChild(countLbl);
      msBar.appendChild(selAllBtn);
      msBar.appendChild(delBtn);
      // Add multi-select toggle to normal actions bar (hide it)
      actionsEl.style.display = 'none';
    } else {
      msBar.style.display = 'none';
      actionsEl.style.display = '';
      // Ensure the multi-select enter button exists in sidebar-actions
      if (!document.getElementById('multiSelectEnterBtn')) {
        const msBtn = document.createElement('button');
        msBtn.className = 'sidebar-action-btn';
        msBtn.id = 'multiSelectEnterBtn';
        msBtn.addEventListener('click', enterMultiSelectMode);
        actionsEl.appendChild(msBtn);
	}
      const existingMsBtn = document.getElementById('multiSelectEnterBtn');
      if (existingMsBtn) {
        existingMsBtn.title = t('js.multiSelect') || 'Multi Select';
        existingMsBtn.textContent = '☐';
	}
    }
  }

  // Build every folder/chat node off-DOM in a fragment and attach it once
  // at the end, instead of appendChild-ing each folder directly onto the
  // live (attached) container. With many folders/chats, appending one at a
  // time onto a connected node can force a layout/reflow per append; a
  // single fragment append triggers just one.
  const frag = document.createDocumentFragment();

  const unfiled = chats.filter(c=>!c.folderId||!folders.find(f=>f.id===c.folderId));
  const targetFolderId = getSidebarTargetFolderId();
  const newChatBtn = document.getElementById('newChatBtn');
  if (newChatBtn) {
    newChatBtn.classList.remove('primary');
    const targetName = targetFolderId === null
      ? (t('js.noFolder') || 'No folder')
      : (folders.find(f=>f.id===targetFolderId)?.name || '');
    newChatBtn.title = targetName ? tf('js.newChatIn', { name: targetName }) : '';
  }

  folders.forEach(f => {
    const fc = chats.filter(c=>c.folderId===f.id);
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder';
    // Folder-level drag for reordering
    folderDiv.draggable = true;
    folderDiv.dataset.folderId = f.id;
    folderDiv.addEventListener('dragstart', e => {
      // Only start folder drag if not dragging a chat item
      if (!draggedChatId) {
        e.stopPropagation();
        onFolderDragStart(e, f.id);
        folderDiv.classList.add('folder-dragging');
      }
    });
    folderDiv.addEventListener('dragend', () => {
      folderDiv.classList.remove('folder-dragging');
      document.querySelectorAll('.folder-drag-over').forEach(el=>el.classList.remove('folder-drag-over'));
    });
    folderDiv.addEventListener('dragover', e => {
      if (draggedFolderId && draggedFolderId !== f.id) {
        e.preventDefault(); e.stopPropagation();
        folderDiv.classList.add('folder-drag-over');
      }
    });
    folderDiv.addEventListener('dragleave', e => {
      if (!folderDiv.contains(e.relatedTarget)) folderDiv.classList.remove('folder-drag-over');
    });
    folderDiv.addEventListener('drop', e => {
      if (draggedFolderId) { onFolderDrop(e, f.id); }
      else { onDropFolder(e, f.id); }
    });

    const header = document.createElement('div');
    header.className = 'folder-header' + (targetFolderId === f.id ? ' active-folder' : '');
    header.id = `fh_${f.id}`;
    const arrow = document.createElement('span');
    arrow.className = 'folder-arrow ' + (f.collapsed ? '' : 'open');
    arrow.textContent = '▶';
    arrow.addEventListener('click', e => { e.stopPropagation(); toggleFolder(f.id); });
    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    icon.textContent = f.collapsed ? '📁' : '📂';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-name';
    nameSpan.id = `fname_${f.id}`;
    nameSpan.textContent = f.name;
    const countSpan = document.createElement('span');
    countSpan.className = 'folder-count'; countSpan.textContent = fc.length;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'folder-actions';
    const addBtn = document.createElement('button');
    addBtn.className = 'folder-btn'; addBtn.textContent = '＋';
    addBtn.dataset.id = f.id;
    addBtn.title = t('sidebar.newChat') || 'New chat';
    addBtn.addEventListener('click', e => { e.stopPropagation(); newChat(addBtn.dataset.id); });
    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-btn'; renameBtn.textContent = '✏️';
    renameBtn.dataset.id = f.id;
    renameBtn.addEventListener('click', e => { e.stopPropagation(); startRenamingFolder(renameBtn.dataset.id); });
    const delBtn = document.createElement('button');
    delBtn.className = 'folder-btn danger'; delBtn.textContent = '🗑';
    delBtn.dataset.id = f.id;
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteFolder(delBtn.dataset.id); });
    actionsDiv.appendChild(addBtn); actionsDiv.appendChild(renameBtn); actionsDiv.appendChild(delBtn);
    header.appendChild(arrow); header.appendChild(icon); header.appendChild(nameSpan); header.appendChild(countSpan); header.appendChild(actionsDiv);
    header.addEventListener('dragover', e => {
      if (draggedChatId) { e.preventDefault(); header.classList.add('drag-target'); }
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-target'));
    header.addEventListener('drop', e => { if(draggedChatId) onDropFolder(e, f.id); });
    header.addEventListener('click', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      activeFolderId = f.id;
      if (f.collapsed) { f.collapsed=false; save(); renderSidebar(); }
      else renderSidebar();
    });
    // Double-click = collapse the folder (renaming is only ever triggered via the context menu or the ✏️ button)
    header.addEventListener('dblclick', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      if (!f.collapsed) { f.collapsed = true; save(); renderSidebar(); }
    });
    // Right-click = context menu with folder options (Rename / Move / Delete)
    header.addEventListener('contextmenu', e => showFolderCtxMenu(e, f.id));
    const chatsDiv = document.createElement('div');
    chatsDiv.className = 'folder-chats' + (f.collapsed ? ' collapsed' : '');
    chatsDiv.id = `fc_${f.id}`;
    chatsDiv.addEventListener('dragover', e => { if(draggedChatId) e.preventDefault(); });
    chatsDiv.addEventListener('drop', e => { if(draggedChatId) onDropFolder(e, f.id); });
    fc.forEach(c => chatsDiv.appendChild(buildChatItem(c)));
    folderDiv.appendChild(header); folderDiv.appendChild(chatsDiv);
    frag.appendChild(folderDiv);
  });

  if (unfiled.length > 0) {
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder unfiled-group';
    const header = document.createElement('div');
    header.className = 'folder-header' + (targetFolderId === null ? ' active-folder' : '');
    const arrow = document.createElement('span'); arrow.className='folder-arrow open'; arrow.textContent='▶';
    const icon = document.createElement('span'); icon.className='folder-icon'; icon.textContent='🗂️';
    const nameSpan = document.createElement('span'); nameSpan.className='folder-name'; nameSpan.textContent=t('js.noFolder');
    const countSpan = document.createElement('span'); countSpan.className='folder-count'; countSpan.textContent=unfiled.length;
    header.appendChild(arrow); header.appendChild(icon); header.appendChild(nameSpan); header.appendChild(countSpan);
    header.addEventListener('dragover', e=>{if(draggedChatId){e.preventDefault();header.classList.add('drag-target');}});
    header.addEventListener('dragleave',()=>header.classList.remove('drag-target'));
    header.addEventListener('drop', e=>{ if(draggedChatId) onDropFolder(e,null); });
    header.addEventListener('click', e=>{ if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT') return; setActiveFolder(null); });
    const chatsDiv = document.createElement('div');
    chatsDiv.className = 'folder-chats';
    chatsDiv.addEventListener('dragover', e=>{if(draggedChatId)e.preventDefault();});
    chatsDiv.addEventListener('drop', e=>{if(draggedChatId)onDropFolder(e,null);});
    unfiled.forEach(c=>chatsDiv.appendChild(buildChatItem(c)));
    folderDiv.appendChild(header); folderDiv.appendChild(chatsDiv);
    frag.appendChild(folderDiv);
  }

  container.appendChild(frag);
}

// Builds the DOM element for a single chat entry in the sidebar (title, menu, drag handlers, selection checkbox).
function buildChatItem(c) {
  const div = document.createElement('div');
  const isSelected = _selectedChatIds.has(c.id);
  div.className = 'chat-item'
    + (c.id === currentChatId ? ' active' : '')
    + (_multiSelectMode && isSelected ? ' multi-selected' : '');
  div.draggable = !_multiSelectMode || isSelected;
  div.dataset.id = c.id;

  // Checkbox for multi-select mode
  const cb = document.createElement('span');
  cb.className = 'chat-item-cb';
  cb.textContent = isSelected ? '☑' : '☐';
  cb.addEventListener('click', e => { e.stopPropagation(); toggleChatSelect(c.id); });

  div.addEventListener('dragstart', e => {
    if (_multiSelectMode && !isSelected) { e.preventDefault(); return; }
    e.stopPropagation(); onDragStart(e, div.dataset.id);
  });
  // Dropping a chat directly onto another chat item reorders them (if
  // they're in the same folder) instead of just moving between folders —
  // previously chats could only be filed into a different folder; their
  // order within a folder was fixed to array/creation order with no way
  // to permute it.
  div.addEventListener('dragover', e => {
    if (!draggedChatId || draggedChatId === c.id) return;
    e.preventDefault(); e.stopPropagation();
    div.classList.add('chat-drag-over');
  });
  div.addEventListener('dragleave', () => div.classList.remove('chat-drag-over'));
  div.addEventListener('drop', e => {
    if (!draggedChatId) return;
    e.preventDefault(); e.stopPropagation();
    div.classList.remove('chat-drag-over');
    if (draggedChatId !== c.id) reorderChatTo(draggedChatId, c.id);
    draggedChatId = null;
  });
  div.addEventListener('click', () => {
    if (_multiSelectMode) { toggleChatSelect(div.dataset.id); return; }
    switchChat(div.dataset.id);
  });
  div.addEventListener('contextmenu', e => showChatCtxMenu(e, div.dataset.id));

  const titleSpan = document.createElement('span');
  titleSpan.className = 'chat-item-title';
  titleSpan.id = `ctitle_${c.id}`;
  titleSpan.textContent = c.title;

  const menuBtn = document.createElement('button');
  menuBtn.className = 'chat-item-menu'; menuBtn.textContent = '⋯'; menuBtn.title = t('js.options');
  menuBtn.dataset.id = c.id;
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showChatCtxMenu(e, menuBtn.dataset.id); });

  div.appendChild(cb);
  div.appendChild(titleSpan);
  if (c.branchOf) { const bb=document.createElement('span'); bb.className='branch-badge'; bb.textContent='↩'; div.appendChild(bb); }
  // Live-indicator: a small pulsing dot next to the title while this chat
  // has an in-flight run (chat stream or agent turn) somewhere — most
  // useful while it's NOT the one on screen, so a background stream stays
  // visible without switching into it.
  if (isChatStreaming(c.id)) {
    const liveDot = document.createElement('span');
    liveDot.className = 'chat-item-live-dot';
    liveDot.title = t('js.chatStreamingHint') || 'This chat is still generating a reply…';
    titleSpan.insertAdjacentElement('afterend', liveDot);
  }
  div.appendChild(menuBtn);
  return div;
}

// ── Message Rendering: Tree-branch helpers ──────────────────────────

/**
 * getActivePath: Returns the flat message list for the currently active branch.
 * Walks chat.messages and at each sibling-node appends the active tail recursively.
 */
function getActivePath(chat) {
  const result = [];
  const walk = (msgs) => {
    for (const m of msgs) {
      result.push(m);
      if (m._siblings && m._siblingIdx != null) {
        const tail = m._siblings[m._siblingIdx]?.tail;
        if (tail && tail.length) { walk(tail); return; }
      }
    }
  };
  walk(chat.messages);
  return result;
}

/**
 * getActiveContainer: Returns the array that new messages should be pushed into.
 * If we're inside a sibling's tail, returns that tail; otherwise chat.messages.
 */
function getActiveContainer(chat) {
  let container = chat.messages;
  const walk = (msgs) => {
    for (const m of msgs) {
      if (m._siblings && m._siblingIdx != null) {
        const tail = m._siblings[m._siblingIdx]?.tail;
        if (tail) { container = tail; if (tail.length) walk(tail); return; }
      }
    }
  };
  walk(chat.messages);
  return container;
}

/**
 * getSiblingNodeAt: Finds the sibling-node message at a given index in the active path.
 */
function getSiblingNodeAt(chat, pathIdx) {
  return getActivePath(chat)[pathIdx] || null;
}


// ── Public API for external modules (e.g. kiconnect-voice.js) ────────
// The voice module (and any other add-on) must NEVER access chat.messages[idx]
// directly — that is the raw sibling-tree, not the rendered flat path.
// It must call window.kicGetMsgByIdx(idx) instead, which honours the active branch.
window.kicGetActivePath  = () => { const c = currentChat(); return c ? getActivePath(c) : []; };
window.kicGetMsgByIdx    = (idx) => { const path = window.kicGetActivePath(); const n = parseInt(idx, 10); return (Number.isFinite(n) && n >= 0) ? (path[n] || null) : null; };
window.kicCurrentChat    = () => currentChat();
// END public API ──────────────────────────────────────────────────────

// renderMessages uses active branch path (tree-aware)
function renderMessages(messages, limitCount) {
  const chat = currentChat();
  const container = document.getElementById('messages');
  const empty     = document.getElementById('emptyState');

  // Any run belonging to a DIFFERENT chat than the one about to be rendered
  // is about to lose its DOM node (we wipe #messages below) — null out its
  // bubbleEl so nothing keeps trying to write into a detached node. (The
  // isConnected check in _runBubbleEl() would catch this too, but doing it
  // explicitly here is cleaner, and covers switchChat/newChat/deleteChat all
  // in one place without touching each of them individually.)
  for (const run of activeRuns.values()) {
    if (!chat || run.chatId !== chat.id) run.bubbleEl = null;
  }

  let path = chat ? getActivePath(chat) : (Array.isArray(messages) ? messages : []);
  // limitCount: optionally render only the first N nodes of the active path.
  // Used by regenerate() to render up to (and including) the user message only,
  // leaving the about-to-be-replaced assistant bubble out of the DOM entirely
  // instead of rendering it and relying on a later swap (which used to leave
  // a stale duplicate bubble behind — see regenerate()).
  if (typeof limitCount === 'number') path = path.slice(0, limitCount);

  // Reattach mechanism (bugfix for "bubble disappears on chat switch"): any
  // still-running run (chat stream OR agent turn — see kiconnect-agent.js)
  // that belongs to THIS chat gets a fresh live bubble appended below,
  // pre-filled with whatever the registry has accumulated so far — not an
  // empty one. The registry (activeRuns) is the source of truth for an
  // in-flight answer; the DOM is only ever a rebuildable projection of it.
  // A run can supply its own `buildLiveEl()` (agent runs do, to render tool
  // trace cards + token counter instead of plain streamed text) — falls
  // back to the generic chat-bubble builder when it doesn't.
  const liveRuns = chat
    ? [...activeRuns.values()].filter(r => r.chatId === chat.id && r.status === 'running')
    : [];

  if (!path.length && !liveRuns.length) {
    Array.from(container.children).forEach(el => { if(el!==empty) el.remove(); });
    if (empty) empty.style.display = '';
    syncComposerStreamingUI();
    return;
  }
  if (empty) empty.style.display = 'none';
  Array.from(container.children).forEach(el => { if(el!==empty) el.remove(); });
  path.forEach((msg, i) => container.appendChild(buildMsgEl(msg, i)));
  liveRuns.forEach(run => {
    const liveRow = (typeof run.buildLiveEl === 'function') ? run.buildLiveEl() : _buildLiveRunBubble(run);
    container.appendChild(liveRow);
    run.bubbleEl = liveRow;
  });
  container.scrollTop = container.scrollHeight;
  typesetMath();
  updateChatTokenTotal();
  // The send/stop button must always reflect whichever chat this render
  // just put on screen, not "is anything streaming anywhere" — this covers
  // switchChat/newChat/deleteChat in one place, same as the bubbleEl-nulling
  // loop above covers those for the run registry.
  syncComposerStreamingUI();
}

// Builds a DOM row for a still-running run being reattached after a chat
// switch — same shape as appendEmptyAI()'s row (so it's visually identical
// to a bubble that never lost its DOM node), but pre-filled with the run's
// accumulated text/thinking instead of starting empty.
function _buildLiveRunBubble(run) {
  const pureModelId = splitModelId(run.model || '').modelId || run.model || '';
  const div = document.createElement('div');
  div.className = 'message-row ai';
  div.dataset.runId = run.runId;
  const avatarCol = document.createElement('div'); avatarCol.className = 'avatar-col';
  const avatar = document.createElement('div'); avatar.className = 'avatar ai';
  avatar.title = pureModelId; avatar.textContent = t('js.aiAvatar');
  avatarCol.appendChild(avatar);
  if (pureModelId) {
    const ml = document.createElement('div'); ml.className = 'model-label';
    ml.title = pureModelId; ml.textContent = pureModelId.split('/').pop();
    avatarCol.appendChild(ml);
  }
  const wrap = document.createElement('div'); wrap.className = 'bubble-wrap';
  const bubble = document.createElement('div'); bubble.className = 'bubble streaming';
  wrap.appendChild(bubble);
  div.appendChild(avatarCol); div.appendChild(wrap);
  renderStreamingBubble(bubble, run.thinkingText || '', run.text ? _stripStoredThinking(run.text) : '');
  return div;
}

// run.text is stored in the combined "<thinking>...</thinking>\n\nanswer"
// format (see _streamStoredText) so it can be saved as-is if the stream
// aborts — but renderStreamingBubble() wants the answer text and thinking
// text as two separate arguments. Strip the stored <thinking> block back out
// (run.thinkingText already holds it separately) before handing the answer
// portion to renderStreamingBubble().
function _stripStoredThinking(storedText) {
  const m = /^<thinking>\n[\s\S]*?\n<\/thinking>\n\n([\s\S]*)$/.exec(storedText || '');
  return m ? m[1] : (storedText || '');
}

// Builds the full DOM row for a single chat message: avatar, bubble content (text/images/files/web sources), and surrounding chrome.
/**
 * _buildBattleTileGridRow: renders an in-progress (or resolved-but-not-yet-
 * winner-picked) Battle-Modus message as a row of side-by-side tiles, one
 * per model in msg._siblings. Mirrors _buildLiveRunBubble()'s reattach
 * trick: every RUNNING battle-variant run for this exact message+sibling
 * gets its `bubbleEl` pointed at the freshly built tile bubble, so a chat
 * switch away and back (this whole row is just rebuilt again by
 * renderMessages()) picks the live stream back up mid-flight instead of
 * losing it — the registry (activeRuns), not the DOM, is the source of
 * truth for what's actually been generated so far.
 */
function _buildBattleTileGridRow(msg, idx) {
  const row = document.createElement('div');
  row.className = 'message-row ai battle-row';
  if (idx !== undefined) row.dataset.idx = idx;
  if (msg._battleId) row.dataset.battleId = msg._battleId;

  const avatarCol = document.createElement('div');
  avatarCol.className = 'avatar-col';
  const avatar = document.createElement('div');
  avatar.className = 'avatar ai';
  avatar.textContent = '⚔️';
  avatar.title = bt('battle.toggleLabel');
  avatarCol.appendChild(avatar);
  row.appendChild(avatarCol);

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap battle-wrap';

  const allDone = msg._siblings.every(s => !s._pending);
  if (allDone && !msg._winnerChosen) {
    // While no explicit winner has been picked, a default is already
    // active behind the scenes (see _resolveBattleDefault) so the
    // conversation can continue — but the grid stays visible and this
    // banner makes the default explicit rather than silently swapping the
    // view to a single bubble the user never chose.
    const defIdx = msg._siblingIdx ?? 0;
    const defModel = splitModelId(msg._siblings[defIdx]?._model || '').modelId || msg._siblings[defIdx]?._model || '';
    const banner = document.createElement('div');
    banner.className = 'battle-default-banner';
    banner.textContent = btf('battle.defaultBanner', { model: defModel });
    wrap.appendChild(banner);
  }

  const grid = document.createElement('div');
  grid.className = 'battle-tile-grid';
  grid.style.setProperty('--battle-n', msg._siblings.length);

  const chat = currentChat();
  msg._siblings.forEach((sibling, i) => {
    const tile = document.createElement('div');
    tile.className = 'battle-tile';
    tile.dataset.siblingIdx = i;

    const run = chat ? [...activeRuns.values()].find(r =>
      r.kind === 'battle-variant' && r.chatId === chat.id &&
      r.battleMsg === msg && r.battleSiblingIdx === i && r.status === 'running') : null;

    const header = document.createElement('div');
    header.className = 'battle-tile-header';
    const pureModelId = splitModelId(sibling._model || '').modelId || sibling._model || '';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'battle-tile-model';
    nameSpan.textContent = pureModelId.split('/').pop();
    nameSpan.title = pureModelId;
    header.appendChild(nameSpan);
    const statusSpan = document.createElement('span');
    statusSpan.className = 'battle-tile-status';
    if (run) { statusSpan.textContent = bt('battle.generating'); statusSpan.classList.add('live'); }
    else if (sibling._pending) { statusSpan.textContent = bt('battle.pending'); }
    else if (sibling.error) { statusSpan.textContent = '⚠️'; statusSpan.classList.add('error'); }
    else { statusSpan.textContent = '✓'; statusSpan.classList.add('done'); }
    header.appendChild(statusSpan);
    tile.appendChild(header);

    const bubble = document.createElement('div');
    bubble.className = 'bubble battle-tile-bubble' + (run ? ' streaming' : '');
    if (sibling.error) {
      bubble.innerHTML = `<em style="color:var(--red)">${escHtml(sibling.error)}</em>`;
    } else if (run) {
      // Reconnect this run to its (freshly rebuilt) tile bubble and
      // pre-fill with whatever the registry has accumulated so far —
      // same reattach pattern as _buildLiveRunBubble(), scoped to one tile.
      run.bubbleEl = bubble;
      renderStreamingBubble(bubble, run.thinkingText || '', run.text ? _stripStoredThinking(run.text) : '');
    } else if (sibling.content) {
      bubble.innerHTML = formatText(sibling.content);
    } else {
      bubble.innerHTML = `<em style="color:var(--muted)">${escHtml(bt('battle.pending'))}</em>`;
    }
    tile.appendChild(bubble);

    const footer = document.createElement('div');
    footer.className = 'battle-tile-footer';
    const winBtn = document.createElement('button');
    winBtn.className = 'battle-winner-btn';
    winBtn.textContent = bt('battle.chooseWinner');
    winBtn.addEventListener('click', () => chooseBattleWinner(idx, i));
    footer.appendChild(winBtn);
    tile.appendChild(footer);

    grid.appendChild(tile);
  });
  wrap.appendChild(grid);
  row.appendChild(wrap);
  return row;
}

/**
 * chooseBattleWinner: explicit "✓ Diese verwenden" pick.
 * Sets msg._siblingIdx to the chosen variant and msg._winnerChosen = true —
 * the next renderMessages()/buildMsgEl() pass then falls through to the
 * normal single-bubble + sibling-nav rendering (the other variants remain
 * reachable via the nav arrows, nothing is discarded, same guarantee
 * regenerate() already gives).
 */
function chooseBattleWinner(idx, siblingIdx) {
  const chat = currentChat(); if (!chat) return;
  const path = getActivePath(chat);
  const msg = path[safeIdx(idx)]; if (!msg || !msg._siblings) return;
  const variant = msg._siblings[siblingIdx]; if (!variant) return;
  msg._siblingIdx = siblingIdx;
  msg._winnerChosen = true;
  msg.content   = variant.content;
  msg._model    = variant._model;
  msg._usage    = variant._usage;
  msg._note     = variant._note;
  msg._noteOpen = variant._noteOpen;
  save();
  renderMessages(chat.messages);
}

function buildMsgEl(msg, idx) {
  // Battle-Modus: an assistant message started via sendBattleMessage()
  // renders as a side-by-side tile grid — one tile per model — for as long
  // as no winner has been explicitly chosen (msg._winnerChosen). Once a
  // winner IS chosen, msg._siblingIdx points at it and this falls through
  // to the normal single-bubble path below (which already renders a
  // sibling-nav since msg._siblings.length > 1 — Battle-Modus deliberately
  // reuses that existing regenerate()/sibling infrastructure instead of
  // inventing a second message shape).
  if (msg.role === 'assistant' && msg._battle && !msg._winnerChosen) {
    return _buildBattleTileGridRow(msg, idx);
  }
  const isUser = msg.role === 'user';
  const cls = isUser ? 'user' : 'ai';
  const row = document.createElement('div');
  row.className = 'message-row ' + cls;
  if (idx !== undefined) row.dataset.idx = idx;

  const avatarCol = document.createElement('div');
  avatarCol.className = 'avatar-col';
  const avatar = document.createElement('div');
  avatar.className = 'avatar ' + cls;
  avatar.textContent = isUser ? (t('js.userAvatar')||'Me') : t('js.aiAvatar');
  avatarCol.appendChild(avatar);

  if (!isUser) {
    const rawMid = msg._model || config.model || '';
    const mid = splitModelId(rawMid).modelId || rawMid;
    if (mid) {
      const ml = document.createElement('div');
      ml.className = 'model-label'; ml.title = mid;
      ml.textContent = mid.split('/').pop();
      avatarCol.appendChild(ml);
    }
  }

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';

  // Sibling navigator, bubble-actions, token badge and note section are all
  // built later by _buildBubbleChrome() — shared with _finalizeAIRowInPlace().

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // ── Build bubble content ──
  // For user messages: show text parts only, then file chips.
  // Files (text-file, pdf, images) are never expanded inline in the bubble.
  let contentHtml = '';
  if (typeof msg.content === 'string') {
    contentHtml = formatText(msg.content);
  } else if (Array.isArray(msg.content)) {
    msg.content.forEach(part => {
      if (part._webSearch || part._kbAugment) return;
      if (part.type === 'text') {
        // Skip file-content blocks (they start with the file marker)
        const isFContent = part.text && part.text.startsWith('--- ');
        if (!isFContent) contentHtml += formatText(part.text);
      } else if (part.type === 'image_url') {
        const url = part.image_url?.url || '';
        if (url.startsWith('data:image/') || url.startsWith('http')) {
          // Append text so far, then the image
          if (contentHtml) { bubble.innerHTML = contentHtml; contentHtml = ''; }
          const img = document.createElement('img');
          img.src = url; img.alt = t('js.imageAlt');
          img.style.cssText = 'max-width:100%;max-height:320px;border-radius:8px;cursor:pointer;margin-top:6px;';
          img.addEventListener('click', () => openImageLightbox(url));
          bubble.appendChild(img);
        }
      }
      // pdf_base64 and text-file parts: NOT rendered inline — shown as chips below
    });
  }
  if (contentHtml) bubble.innerHTML = (bubble.innerHTML || '') + contentHtml;

  // File chips — always shown for _files list (stored file names)
  if (msg._files && msg._files.length) {
    const chipWrap = document.createElement('div');
    chipWrap.className = 'msg-file-chips';
    msg._files.forEach(name => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
      chip.textContent = (isImg ? '🖼️ ' : '📄 ') + name;
      chipWrap.appendChild(chip);
    });
    bubble.appendChild(chipWrap);
  }

  if (msg._webSources && msg._webSources.length) {
    bubble.appendChild(buildWebSourcesRow(msg._webSources));
  }

  // Knowledge-base sources ("Wissensbasis") — populated by kiconnect-db.js's
  // sendMessageCore hook (see installKbHooks() there). Same rendering idea
  // as _webSources above, kept as its own list/renderer since KB citations
  // carry a source file + page instead of a URL.
  if (msg._kbSources && msg._kbSources.length && typeof buildKbSourcesRow === 'function') {
    bubble.appendChild(buildKbSourcesRow(msg._kbSources));
  }

  if (!contentHtml && bubble.children.length === 0)
    bubble.innerHTML = `<em style="color:var(--muted)">${escHtml(t('js.empty'))}</em>`;

  wrap.appendChild(bubble);
  row.appendChild(avatarCol); row.appendChild(wrap);

  _buildBubbleChrome(row, wrap, bubble, msg, idx);
  return row;
}

/**
 * _buildBubbleChrome: builds/attaches everything AROUND a bubble's already-
 * rendered content — sibling navigator, action buttons (copy/edit/branch/
 * regenerate/print/voice/delete), token badge, and the personal-note section
 * — then wires up any code-copy/collapse buttons found inside `row`.
 *
 * Shared by buildMsgEl() (fresh row, `bubble` is empty-then-filled) and
 * _finalizeAIRowInPlace() (existing streamed row, `bubble` already contains
 * the fully rendered/typeset answer — this function must NOT touch its
 * content or re-typeset it).
 *
 * Assumes `bubble` is already appended to `wrap`; inserts the nav before it
 * and everything else after it, so the DOM order matches buildMsgEl's
 * original wrap.appendChild() sequence exactly.
 */
function _buildBubbleChrome(row, wrap, bubble, msg, idx) {
  const isUser = msg.role === 'user';

  // sibling navigator (< 1/3 >) for AI messages with variants
  if (!isUser && msg._siblings && msg._siblings.length > 1) {
    const nav = document.createElement('div');
    nav.className = 'sibling-nav';
    const total = msg._siblings.length;
    const current = (msg._siblingIdx ?? 0) + 1;

    const btnPrev = document.createElement('button');
    btnPrev.className = 'sibling-btn';
    btnPrev.textContent = '<';
    btnPrev.disabled = current === 1;
    btnPrev.addEventListener('click', () => navigateSibling(idx, -1));

    const counter = document.createElement('span');
    counter.className = 'sibling-counter';
    counter.textContent = `${current} / ${total}`;

    const btnNext = document.createElement('button');
    btnNext.className = 'sibling-btn';
    btnNext.textContent = '>';
    btnNext.disabled = current === total;
    btnNext.addEventListener('click', () => navigateSibling(idx, +1));

    nav.appendChild(btnPrev);
    nav.appendChild(counter);
    nav.appendChild(btnNext);
    wrap.insertBefore(nav, bubble);
  }

  // Bubble actions
  const actDiv = document.createElement('div');
  actDiv.className = 'bubble-actions';
  function makeActBtn(label, cls2, handler, action) {
    const btn = document.createElement('button');
    btn.className = 'bubble-act-btn' + (cls2 ? ' ' + cls2 : '');
    btn.textContent = label;
    if (action) btn.setAttribute('data-action', action);
    if (idx !== undefined) btn.dataset.idx = idx;
    btn.addEventListener('click', () => handler(parseInt(btn.dataset.idx)));
    return btn;
  }
  actDiv.appendChild(makeActBtn(t('js.copy'),       '', (i) => copyBubble(actDiv.querySelector('.bubble-act-btn'), i), 'copy'));
  // Copy rich content for Word and Markdown/LaTeX text for note apps.
  const copyFormattedBtn = document.createElement('button');
  copyFormattedBtn.className = 'bubble-act-btn';
  copyFormattedBtn.textContent = t('js.copyFormatted');
  copyFormattedBtn.title = t('js.copyFormattedTitle');
  copyFormattedBtn.setAttribute('data-action', 'copy-formatted');
  copyFormattedBtn.addEventListener('click', () => copyBubbleFormatted(bubble, copyFormattedBtn));
  actDiv.appendChild(copyFormattedBtn);
  actDiv.appendChild(makeActBtn(t('js.edit'),       '', startEditBubble, 'edit'));
  actDiv.appendChild(makeActBtn(t('js.branch'),     '', branchFromHere, 'branch'));
  if (!isUser) actDiv.appendChild(makeActBtn(t('js.regenerate'), '', regenerate, 'regenerate'));
  actDiv.appendChild(makeActBtn('🖨️',               '', openPrintSingleOverlay, 'print'));
  // speaker moved into the shared bubble-actions row (same hover group as copy/edit/etc.)
  if (!isUser) {
    const vc = document.createElement('div');
    vc.className = 'bubble-voice-controls';
    vc.innerHTML = '<button class="bubble-voice-btn" type="button" title="Read aloud">🔊</button>'
      + '<button class="bubble-voice-pause-btn" type="button" style="display:none"></button>';
    actDiv.appendChild(vc);
  }
  actDiv.appendChild(makeActBtn(t('js.delete'),     'danger', deleteBubble, 'delete'));
  bubble.insertAdjacentElement('afterend', actDiv);

  if (!isUser && msg._usage) {
    const badge = buildTokenBadge(msg._usage);
    actDiv.insertAdjacentElement('afterend', badge);
  }

  // Personal note per bubble (account-specific, encrypted with the rest of the chat)
  wrap.appendChild(buildNoteSection(msg));

  row.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    if (!btn._wired) { btn._wired = true; btn.addEventListener('click', () => copyCodeFromBtn(btn)); }
  });
  row.querySelectorAll('.code-collapse-btn').forEach(btn => {
    if (!btn._wired) { btn._wired = true; btn.addEventListener('click', () => toggleCodeBlockCollapse(btn)); }
  });
}

/**
 * _finalizeAIRowInPlace: upgrades an already-streamed AI row (created by
 * appendEmptyAI + filled incrementally by renderStreamingBubble/
 * _finalizeStreamingBubble) into its final interactive form, WITHOUT
 * discarding and rebuilding the bubble content.
 *
 * Everything buildMsgEl() would parse out of msg.content is already sitting
 * on screen, correctly formatted and typeset. All that's actually missing on
 * a freshly-streamed row is the chrome around it (action buttons, sibling
 * nav, token badge, note section) and event wiring for any code-block
 * buttons — so this attaches only that, leaving the rendered content itself
 * untouched (no redundant formatText()/typesetMath() pass).
 *
 * Returns true if it successfully upgraded `rowEl` in place; false if
 * `rowEl` isn't usable (e.g. got removed from the DOM in the meantime, or
 * doesn't have the expected .bubble), in which case the caller should fall
 * back to a full buildMsgEl() render.
 */
function _finalizeAIRowInPlace(rowEl, msg, idx) {
  if (!rowEl || !rowEl.isConnected) return false;
  const wrap = rowEl.querySelector('.bubble-wrap');
  const bubble = wrap && wrap.querySelector('.bubble');
  if (!wrap || !bubble) return false;

  rowEl.dataset.idx = idx;
  bubble.classList.remove('streaming');

  _buildBubbleChrome(rowEl, wrap, bubble, msg, idx);
  return true;
}

// Personal per-bubble notes (account-specific)
// A private note attached to a single message. Stored directly on the message
// object as msg._note / msg._noteOpen, so it rides along with the normal
// chat-save cycle (encrypted, per-account, per-device via the server store).
// Never sent to any AI provider — these are custom fields the API request
// builder never reads.
const _noteSaveTimers = new WeakMap();

// Builds the collapsible personal-note UI attached to a message bubble (edit/preview toggle, autosave, delete).
function buildNoteSection(msg) {
  const holder = document.createElement('div');
  holder.className = 'note-holder';

  const noteToggleBtn = document.createElement('button');
  noteToggleBtn.type = 'button';
  noteToggleBtn.className = 'note-toggle-btn';

  const noteBox = document.createElement('div');
  noteBox.className = 'note-box';

  const noteHeader = document.createElement('div');
  noteHeader.className = 'note-box-header';
  const noteHeaderLabel = document.createElement('span');
  noteHeaderLabel.textContent = '🗒️ ' + t('js.noteLabel');
  const noteDeleteBtn = document.createElement('button');
  noteDeleteBtn.type = 'button';
  noteDeleteBtn.className = 'note-delete-btn';
  noteDeleteBtn.title = t('js.noteDelete');
  noteDeleteBtn.textContent = '✕';
  noteHeader.appendChild(noteHeaderLabel);
  noteHeader.appendChild(noteDeleteBtn);

  const noteTextarea = document.createElement('textarea');
  noteTextarea.className = 'note-textarea';
  noteTextarea.placeholder = t('js.notePlaceholder');
  noteTextarea.value = msg._note || '';
  noteTextarea.rows = 2;

  // Rendered markdown preview, shown instead of the textarea when not editing (Obsidian-style)
  const notePreview = document.createElement('div');
  notePreview.className = 'note-render';
  notePreview.title = t('js.noteEditHint');

  // Always-rendered copy used only for printing, so a collapsed note still prints its content
  const notePrint = document.createElement('div');
  notePrint.className = 'note-print';
  notePrint.dataset.label = t('js.noteLabel');

  noteBox.appendChild(noteHeader);
  noteBox.appendChild(noteTextarea);
  noteBox.appendChild(notePreview);
  holder.appendChild(notePrint);

  function autoGrow() {
    noteTextarea.style.height = 'auto';
    noteTextarea.style.height = noteTextarea.scrollHeight + 'px';
  }

  function refreshToggleLabel() {
    const hasNote = !!(msg._note && msg._note.trim());
    const isOpen = !!msg._noteOpen;
    noteToggleBtn.classList.toggle('has-note', hasNote);
    holder.classList.toggle('has-note', hasNote);
    holder.classList.toggle('note-open', isOpen);
    noteToggleBtn.innerHTML = hasNote
      ? `🗒️ ${escHtml(t('js.noteLabel'))} <span class="note-caret">${isOpen ? '▴' : '▾'}</span>`
      : `<span class="note-plus">+</span> ${escHtml(t('js.noteAdd'))}`;
  }

  // Preview mode renders markdown and is read-only; edit mode shows the raw-text textarea.
  // Empty notes always start in edit mode since there is nothing to preview yet.
  function showPreview() {
    const hasNote = !!(msg._note && msg._note.trim());
    if (!hasNote) { showEdit(); return; }
    notePreview.innerHTML = formatText(msg._note);
    notePreview.style.display = 'block';
    noteTextarea.style.display = 'none';
    typesetMath(notePreview);
  }

  function showEdit() {
    notePreview.style.display = 'none';
    noteTextarea.style.display = 'block';
    autoGrow();
    noteTextarea.focus();
  }

  function refreshPrintCopy() {
    const hasNote = !!(msg._note && msg._note.trim());
    notePrint.innerHTML = hasNote ? formatText(msg._note) : '';
  }

  function setOpen(open) {
    msg._noteOpen = open;
    noteBox.style.display = open ? 'block' : 'none';
    if (open) showPreview();
    refreshToggleLabel();
  }

  noteToggleBtn.addEventListener('click', () => {
    setOpen(!msg._noteOpen);
    save();
  });

  notePreview.addEventListener('click', showEdit);

  noteTextarea.addEventListener('input', () => {
    msg._note = noteTextarea.value;
    autoGrow();
    const hasNote = !!noteTextarea.value.trim();
    noteToggleBtn.classList.toggle('has-note', hasNote);
    holder.classList.toggle('has-note', hasNote);
    refreshPrintCopy();
    clearTimeout(_noteSaveTimers.get(msg));
    _noteSaveTimers.set(msg, setTimeout(() => save(), 500));
  });
  noteTextarea.addEventListener('blur', () => {
    clearTimeout(_noteSaveTimers.get(msg));
    save();
    showPreview();
    // Defensive re-assert: if something else re-rendered the message list
    // right around this blur (e.g. a concurrent save/stream update touching
    // the same message), make sure the preview still wins on the next frame
    // instead of leaving the raw textarea visible until the next full render.
    requestAnimationFrame(() => {
      if (document.body.contains(notePreview) && msg._noteOpen) showPreview();
    });
  });

  noteDeleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    msg._note = '';
    noteTextarea.value = '';
    refreshPrintCopy();
    setOpen(false);
    save();
  });

  noteBox.style.display = msg._noteOpen ? 'block' : 'none';
  refreshToggleLabel();
  refreshPrintCopy();

  holder.appendChild(noteToggleBtn);
  holder.appendChild(noteBox);
  if (msg._noteOpen) showPreview();
  return holder;
}

// ── Simple image lightbox ─────────────────────────────────────────
function openImageLightbox(url) {
  const lb = document.createElement('div');
  lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 40px #000;';
  lb.appendChild(img);
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

// Builds the row of clickable "[1] title" source chips shown under a message
// that used web search. Shared by buildMsgEl (full render) and
// sendMessageCore (patching a live preview bubble after search completes) —
// previously duplicated verbatim in both places.
function buildWebSourcesRow(webSources) {
  const sourceWrap = document.createElement('div');
  sourceWrap.className = 'web-sources';
  webSources.slice(0, WEB_SEARCH_RESULT_MAX).forEach(src => {
    const a = document.createElement('a');
    a.className = 'web-source-chip';
    a.href = src.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = src.snippet ? `${src.url}\n\n${src.snippet}` : src.url;
    a.textContent = `[${src.index}] ${src.title || src.url}`;
    sourceWrap.appendChild(a);
  });
  return sourceWrap;
}

// ── Bubble Edit / Delete / Branch ─────────────────────────────────
function getBubbleRow(idx) { return document.querySelector(`.message-row[data-idx="${parseInt(idx,10)}"]`); }

// ── Token Usage ────────────────────────────────────────────────────
function buildTokenBadge(usage) {
  const badge = document.createElement('div');
  badge.className = 'token-badge';
  if (usage.input_tokens != null) {
    const s=document.createElement('span'); s.title='Input tokens';
    s.textContent=tf('js.tokensIn',{n:usage.input_tokens.toLocaleString()}); badge.appendChild(s);
  }
  if (usage.output_tokens != null) {
    const s=document.createElement('span'); s.title='Output tokens';
    s.textContent=tf('js.tokensOut',{n:usage.output_tokens.toLocaleString()}); badge.appendChild(s);
  }
  if (usage.cache_read_input_tokens) {
    const s=document.createElement('span'); s.className='cache'; s.title='Cache read';
    s.textContent=tf('js.tokensCacheRead',{n:usage.cache_read_input_tokens.toLocaleString()}); badge.appendChild(s);
  }
  if (usage.cache_creation_input_tokens) {
    const s=document.createElement('span'); s.className='cache'; s.title='Cache write';
    s.style.opacity='0.75';
    s.textContent='💾 '+usage.cache_creation_input_tokens.toLocaleString(); badge.appendChild(s);
  }
  const total=(usage.input_tokens||0)+(usage.output_tokens||0);
  if (total>0) {
    const s=document.createElement('span');
    s.title='Total'; s.style.color='var(--accent)'; s.style.borderColor='rgba(61,126,255,0.3)';
    s.textContent=tf('js.tokensTotal',{n:total.toLocaleString()}); badge.appendChild(s);
  }
  return badge;
}

// Recomputes and displays the running token-usage total for the active chat.
function updateChatTokenTotal() {
  const chat=currentChat();
  let total=document.getElementById('chatTokenTotal');
  if (!chat) { if(total) total.remove(); return; }
  // Sum tokens along the currently active path only — getActivePath() follows
  // the active sibling branch at every fork, so the total matches exactly what
  // the user sees on screen. Iterating chat.messages directly would miss tail
  // messages inside non-root sibling branches.
  const activePath = getActivePath(chat);
  const sum=activePath.reduce((acc,m)=>{
    if(!m._usage) return acc;
    // For sibling nodes, _usage is kept in sync with the active sibling variant
    // (updated in _attachAIActions, navigateSibling, deleteBubble).
    // For regular nodes, _usage is set directly on the message object.
    const u = m._siblings
      ? (m._siblings[m._siblingIdx ?? 0]?._usage || m._usage)
      : m._usage;
    if (!u) return acc;
    return acc+(u.input_tokens||0)+(u.output_tokens||0);
  },0);
  if (sum===0) { if(total) total.remove(); return; }
  if (!total) {
    total=document.createElement('div'); total.id='chatTokenTotal'; total.className='chat-token-total';
    document.getElementById('messages').appendChild(total);
  }
  total.textContent=tf('js.chatTotalTokens',{n:sum.toLocaleString()});
}

// Parses and validates a message index, returning null if it isn't a valid non-negative integer.
function safeIdx(idx) {
  const n=parseInt(idx,10);
  if(!Number.isFinite(n)||n<0) return null;
  return n;
}

// Deletes a single message bubble from the active chat branch after confirmation.
function deleteBubble(idx) {
  idx=safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  const path=getActivePath(chat);
  const msg=path[idx]; if(!msg) return;

  // If this node has siblings, only remove the currently active sibling variant —
  // leaving all other variants (and their tails) intact.
  if (msg._siblings && msg._siblings.length > 1) {
    const activeIdx = msg._siblingIdx ?? 0;
    msg._siblings.splice(activeIdx, 1);
    // Clamp _siblingIdx so it stays in range
    msg._siblingIdx = Math.min(activeIdx, msg._siblings.length - 1);
    // Sync live fields from the newly active variant
    const active = msg._siblings[msg._siblingIdx];
    msg.content   = active.content;
    msg._model    = active._model;
    msg._usage    = active._usage;
    msg._note     = active._note;
    msg._noteOpen = active._noteOpen;
    save(); renderMessages(chat.messages);
    return;
  }

  // Single variant (no siblings, or last remaining sibling): remove the whole node.
  const pruneMsg = (arr) => {
    const i=arr.indexOf(msg); if(i>=0){arr.splice(i,1);return true;}
    for(const m of arr){if(m._siblings)for(const s of m._siblings)if(s.tail&&pruneMsg(s.tail))return true;}
    return false;
  };
  pruneMsg(chat.messages);
  save(); renderMessages(chat.messages);
}

// Edit-state for bubble editing with file chips
let _editAttachments = [];
let _editMsgIdx = null;

// Switches a message bubble into inline edit mode, loading its current text/attachments into the editor.
function startEditBubble(idx) {
  idx = safeIdx(idx); if (idx === null) return;
  const chat = currentChat(); if (!chat) return;
  const msg = getActivePath(chat)[idx]; if (!msg) return;
  _editMsgIdx = idx;

  // Plain text only — skip file-content blocks
  let text = '';
  if (typeof msg.content === 'string') text = msg.content;
  else if (Array.isArray(msg.content))
    text = msg.content.filter(p => p.type === 'text' && !p.text?.startsWith('--- ')).map(p => p.text).join('\n');

  // derive pdfMode from structured storage types (pdf_base64 /
  // pdf_text) instead of fragile i18n-string matching. Language-independent.
  _editAttachments = (msg._files || []).map(name => {
    const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
    const isPdf = /\.pdf$/i.test(name);
    if (!isPdf) return { type: isImg ? 'image' : 'text-file', name, _storedOnly: true };
    let pdfMode = 'b64';
    if (Array.isArray(msg.content)) {
      if (msg.content.some(p => (p.type === 'pdf_text' || p.type === 'pdf_text_ref') && p.name === name)) pdfMode = 'text';
      else if (msg.content.some(p => (p.type === 'pdf_base64' || p.type === 'pdf_base64_ref') && p.name === name)) pdfMode = 'b64';
    }
    return { type: 'pdf-b64', name, _storedOnly: true, pdfMode };
  });

  const row = getBubbleRow(idx); if (!row) return;
  const wrap = row.querySelector('.bubble-wrap');
  wrap.innerHTML = '';

  const ta = document.createElement('textarea');
  ta.className = 'edit-box'; ta.rows = 3; ta.value = text; ta.style.height = 'auto';

  // File area
  const fileArea = document.createElement('div');
  fileArea.style.cssText = 'margin-top:8px;';
  const fileLabel = document.createElement('div');
  fileLabel.style.cssText = 'font-size:11px;font-family:"IBM Plex Mono",monospace;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;';
  fileLabel.textContent = t('js.editFiles') || 'Attached files';
  const chipsRow = document.createElement('div');
  chipsRow.id = 'editFileChips';
  chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;';
  const addBtns = document.createElement('div');
  addBtns.style.cssText = 'display:flex;gap:6px;';
  const addFileBtn = document.createElement('button');
  addFileBtn.className = 'bubble-act-btn';
  addFileBtn.textContent = t('js.editAddFile') || '📎 File';
  addFileBtn.addEventListener('click', () => document.getElementById('editFileInput')?.click());
  const addImgBtn = document.createElement('button');
  addImgBtn.className = 'bubble-act-btn';
  addImgBtn.textContent = t('js.editAddImage') || '🖼 Image';
  addImgBtn.addEventListener('click', () => document.getElementById('editImageInput')?.click());
  addBtns.appendChild(addFileBtn); addBtns.appendChild(addImgBtn);
  fileArea.appendChild(fileLabel); fileArea.appendChild(chipsRow); fileArea.appendChild(addBtns);

  const eActs = document.createElement('div'); eActs.className = 'edit-actions';
  const confirmBtn = document.createElement('button'); confirmBtn.className = 'edit-confirm-btn';
  confirmBtn.textContent = t('js.saveBubble');
  confirmBtn.addEventListener('click', () => confirmEditBubble());
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.textContent = t('js.cancel');
  cancelBtn.addEventListener('click', () => { _editAttachments = []; _editMsgIdx = null; renderMessages(currentChat().messages); });
  eActs.appendChild(confirmBtn); eActs.appendChild(cancelBtn);

  wrap.appendChild(ta); wrap.appendChild(fileArea); wrap.appendChild(eActs);
  ta.style.height = ta.scrollHeight + 'px'; ta.focus();
  renderEditFileChips();
}

// (Re)renders the attachment chips shown while editing a message.
function renderEditFileChips() {
  const chipsRow = document.getElementById('editFileChips'); if (!chipsRow) return;
  chipsRow.innerHTML = '';
  _editAttachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 10px;cursor:default;';
    const icon = a.type === 'image' ? '🖼️' : '📄';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = icon + ' ' + a.name;
    if (a._storedOnly) { nameSpan.style.opacity = '0.6'; nameSpan.title = t('js.originalReattach') || 'Original — re-attach to replace'; }
    const rem = document.createElement('button');
    rem.style.cssText = 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;';
    rem.textContent = '\u2715';
    const capturedIdx = i;
    rem.addEventListener('click', () => { _editAttachments.splice(capturedIdx, 1); renderEditFileChips(); });
    chip.appendChild(nameSpan); chip.appendChild(rem);
    chipsRow.appendChild(chip);
  });
}

// Applies the edited text/attachments back onto the message and saves.
function confirmEditBubble() {
  const idx = _editMsgIdx; if (idx === null) return;
  const chat = currentChat(); if (!chat) return;
  const row = getBubbleRow(idx); if (!row) return;
  const ta = row.querySelector('.edit-box'); if (!ta) return;
  const newText = ta.value.trim();
  const msg = getActivePath(chat)[idx];

  const newContent = [];
  if (newText) newContent.push({ type: 'text', text: newText });
  const newFileNames = [];

  // restore _storedOnly file content by typed lookup on
  // msg.content (pdf_base64, pdf_text) — language-independent, no fragile regex needed.
  _editAttachments.forEach(a => {
    newFileNames.push(a.name);
    if (a._storedOnly) {
      if (Array.isArray(msg.content)) {
        if (a.type === 'pdf-b64' && a.pdfMode === 'b64') {
          // Accept both full block and stripped _ref sentinel
          const block = msg.content.find(p => (p.type === 'pdf_base64' || p.type === 'pdf_base64_ref') && p.name === a.name);
          if (block) newContent.push(block);
        } else if (a.type === 'pdf-b64' && a.pdfMode === 'text') {
          const block = msg.content.find(p => (p.type === 'pdf_text' || p.type === 'pdf_text_ref') && p.name === a.name);
          if (block) newContent.push(block);
        } else {
          // text-file: stored as labelled text block OR as text_file_ref sentinel
          let found = false;
          msg.content.forEach(p => {
            if (p.type === 'text_file_ref' && p.name === a.name) { newContent.push(p); found = true; }
            else if (!found && p.type === 'text' && p.text?.startsWith('--- ')) {
              const fname = p.text.match(/^--- Content of "(.+?)" ---/)?.[1];
              if (fname === a.name) newContent.push(p);
            }
          });
        }
      }
      return;
    }
    if (a.type === 'image') {
      newContent.push({ type: 'image_url', image_url: { url: a.data } });
    } else if (a.type === 'pdf-b64' && a.pdfMode === 'text' && a.extractedText) {
      newContent.push({ type: 'pdf_text', name: a.name, text: a.extractedText });
    } else if (a.type === 'pdf-b64' && a.pdfMode === 'b64' && a.data) {
      const b64 = (a.data || '').split(',')[1] || a.data;
      newContent.push({ type: 'pdf_base64', name: a.name, data: b64 });
    } else if (a.type === 'text-file' && a.content) {
      newContent.push({ type: 'text', text: tf('js.fileContent',{name:a.name}) + '\n' + a.content + '\n' + t('js.fileEnd') });
    }
  });

  msg.content = newContent.length === 1 && newContent[0].type === 'text' ? newContent[0].text : newContent;
  if (newFileNames.length) msg._files = newFileNames; else delete msg._files;
  _editAttachments = []; _editMsgIdx = null;
  save(); renderMessages(chat.messages);
}

// Reads a file chosen while editing a message and adds it to the edit-attachment list.
function handleEditFileAttach(e) {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = ev => {
    if (isPdf) {
      const b64 = ev.target.result;
      const bin = atob(b64.split(',')[1] || b64);
      const arr = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      _editAttachments.push({ type:'pdf-b64', name:file.name, data:b64, rawBuf:arr.buffer, pdfMode:'b64' });
    } else {
      _editAttachments.push({ type:'text-file', name:file.name, content:ev.target.result });
    }
    renderEditFileChips();
  };
  isPdf ? reader.readAsDataURL(file) : reader.readAsText(file, 'UTF-8');
}

// Reads an image chosen while editing a message and adds it to the edit-attachment list.
function handleEditImageAttach(e) {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    _editAttachments.push({ type:'image', name:file.name, data:ev.target.result });
    renderEditFileChips();
  };
  reader.readAsDataURL(file);
}

// Navigate between sibling variants; each has its own tail (sub-tree)
function navigateSibling(idx, delta) {
  const chat = currentChat(); if (!chat) return;
  const path = getActivePath(chat);
  const msg  = path[idx];
  if (!msg || !msg._siblings) return;

  const newIdx = (msg._siblingIdx ?? 0) + delta;
  if (newIdx < 0 || newIdx >= msg._siblings.length) return;

  // Notes are edited in place on msg._note (no explicit "commit" step), so before
  // switching away from the currently active variant we must write its live note
  // back into its own record — otherwise an edit made just before navigating
  // away would be lost, and would then also incorrectly show up on the target
  // variant since msg._note would still hold the old variant's value.
  const oldVariant = msg._siblings[msg._siblingIdx ?? 0];
  if (oldVariant) { oldVariant._note = msg._note; oldVariant._noteOpen = msg._noteOpen; }

  msg._siblingIdx = newIdx;
  const variant   = msg._siblings[newIdx];
  // Sync live fields (used by rerunFromUserMsg context-building)
  msg.content   = variant.content;
  msg._model    = variant._model;
  msg._usage    = variant._usage;
  msg._note     = variant._note;
  msg._noteOpen = variant._noteOpen;

  save();
  renderMessages(chat.messages); // getActivePath will now follow new _siblingIdx
}

// Creates a new chat containing a copy of the conversation up to (and including) the given message, then switches to it.
function branchFromHere(idx) {
  idx=safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  // Clone the active path up to idx (tree-aware: follows siblings correctly)
  const activePath=getActivePath(chat);
  const branchedMsgs=JSON.parse(JSON.stringify(activePath.slice(0,idx+1).map(m=>{
    // Flatten sibling nodes: keep only the currently active variant, no siblings meta
    const {_siblings, _siblingIdx, ...rest}=m;
    return rest;
  })));
  const branchId=Date.now().toString();
  chats.unshift({id:branchId,title:`↩ ${chat.title.slice(0,32)} (ab #${idx+1})`,folderId:chat.folderId,branchOf:chat.id,messages:branchedMsgs});
  currentChatId=branchId; save(); renderSidebar(); renderMessages(branchedMsgs);
  toast(tf('js.branchFrom', {n: idx+1}));
}

// ── Shared AI-Streaming-Helpers ──
// _toAnthropicContent: Converts internal content array to Anthropic wire format.
// handles pdf_text (text-mode PDF, language-independent storage type)
function _toAnthropicContent(content) {
  if (!Array.isArray(content)) return content;
  return content.map(p => {
    if (p.type === 'image_url') {
      const url = p.image_url?.url || '';
      if (url.startsWith('data:')) {
        const [meta, b64] = url.split(',');
        return { type: 'image', source: { type: 'base64', media_type: meta.replace('data:', '').replace(';base64', ''), data: b64 } };
      }
      return { type: 'image', source: { type: 'url', url } };
    }
    if (p.type === 'pdf_base64') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } };
    // pdf_text: text-mode PDF stored structurally — expand to labelled text block for the API
    if (p.type === 'pdf_text') return { type: 'text', text: `${tf('js.fileContent',{name:p.name})}\n${p.text}\n${t('js.fileEnd')}` };
    if (p.type === 'text') return { type: 'text', text: p.text || '' };
    return p;
  });
}

// _toOpenAIContent: Expands internal storage types (pdf_text, pdf_base64) to plain text/
// image_url for OpenAI-compat APIs that don't understand these internal block types.
function _toOpenAIContent(content) {
  if (!Array.isArray(content)) return content;
  return content.map(p => {
    if (p.type === 'pdf_text')
      return { type: 'text', text: `${tf('js.fileContent',{name:p.name})}\n${p.text}\n${t('js.fileEnd')}` };
    if (p.type === 'pdf_base64')
      return { type: 'text', text: `[PDF: ${p.name}]` }; // b64 not supported in OpenAI text mode
    if (p.type === 'text')
      return { type: 'text', text: p.text || '' };
    return p;
  });
}

// _applyPromptCache: Marks the second-to-last message for Anthropic prompt caching.
function _applyPromptCache(msgs) {
  if (msgs.length < 2) return;
  const prev = msgs[msgs.length - 2];
  if (!prev) return;
  const c = prev.content;
  if (typeof c === 'string') {
    prev.content = [{ type: 'text', text: c, cache_control: { type: 'ephemeral', ttl: '1h' } }];
  } else if (Array.isArray(c) && c.length) {
    const lp = c[c.length - 1];
    if (lp && !lp.cache_control) lp.cache_control = { type: 'ephemeral', ttl: '1h' };
  }
}

// _splitStableTail: splits streamed text at the last line break that is NOT
// inside an open ``` fence or an open $$...$$ / \[...\] display-math block.
// Everything before that point is "stable" (a finished line/row — safe to
// render once and never touch again). Everything after is "tail" (still
// being written, gets re-rendered frequently). This is what lets already
// -typeset formulas in e.g. a growing table stay put instead of flickering.
function _splitStableTail(text) {
  let fence = false, dollarBlock = false, bracketBlock = false, parenBlock = false, lastSafe = -1;
  const envStack = [];
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('```', i)) fence = !fence;
    else if (!fence && text.startsWith('$$', i)) dollarBlock = !dollarBlock;
    else if (!fence && text.startsWith('\\[', i)) bracketBlock = true;
    else if (!fence && text.startsWith('\\]', i)) bracketBlock = false;
    else if (!fence && text.startsWith('\\(', i)) parenBlock = true;
    else if (!fence && text.startsWith('\\)', i)) parenBlock = false;
    else if (!fence && text.startsWith('\\begin{', i)) {
      const end = text.indexOf('}', i);
      if (end !== -1) envStack.push(text.slice(i + 7, end));
    } else if (!fence && text.startsWith('\\end{', i)) {
      const end = text.indexOf('}', i);
      if (end !== -1) envStack.pop();
    }

    if (text[i] === '\n' && !fence && !dollarBlock && !bracketBlock && !parenBlock && envStack.length === 0) lastSafe = i;
  }
  if (lastSafe === -1) return { stable: '', tail: text };

  // Pull the boundary back before any still-open GFM table/list so we never
  // commit a partial one to "stable" — marked.js needs the whole block in a
  // single parse. See _pullBackForOpenBlock.
  lastSafe = _pullBackForOpenBlock(text, lastSafe);
  if (lastSafe === -1) return { stable: '', tail: text };

  return { stable: text.slice(0, lastSafe + 1), tail: text.slice(lastSafe + 1) };
}

// _pullBackForOpenBlock: given a candidate split point `safeEnd` (index of
// a \n that's already safe w.r.t. fences/math), checks whether the line
// right before it belongs to a table or list. If the block hasn't been
// closed off by a blank line yet, moves the split point back to just
// before that block started, so the *entire* still-growing block stays in
// "tail" (re-rendered each tick, same as any other in-progress line) until
// it's actually finished — at which point it gets committed to "stable" in
// one piece and is never touched again.
function _pullBackForOpenBlock(text, safeEnd) {
  const candidate = text.slice(0, safeEnd + 1);
  const lines = candidate.split('\n');
  lines.pop(); // candidate always ends in '\n' -> drop the trailing '' entry
  if (!lines.length) return safeEnd;

  const isBlank = (l) => l.trim() === '';
  // Only lines that actually start/end with a pipe count as table rows.
  // (Previously: "2+ pipe characters anywhere in the line" — which
  // false-positived on ordinary prose containing pipes, e.g. bra-ket
  // notation like "|0⟩ und |1⟩", misclassifying a list item as a table row
  // and cutting the walk-back short at the wrong place.)
  const isTableLine = (l) => {
    const t = l.trim();
    if (!t.includes('|')) return false;
    return t.startsWith('|') || t.endsWith('|');
  };
  const isListLine = (l) => /^[ \t]*([-*+]|\d+[.)])[ \t]+/.test(l);
  const isListContinuation = (l) => isListLine(l) || (!isBlank(l) && /^[ \t]+\S/.test(l));

  // Blank lines alone never close a list or table in CommonMark — a "loose"
  // list (items separated by blank lines, which models commonly produce)
  // still parses as one single list. So skip past any trailing blank lines
  // and look at the last actual content line to decide whether we're still
  // inside an open block. (Previously a single blank line after a finished
  // item was treated as "block closed", so each item of a loose list got
  // committed to "stable" as its own separate <ol start="N">, and marked's
  // start attribute was then stripped by DOMPurify below — producing a
  // "1., 1., 1." list until the message was fully re-rendered from scratch.)
  let lastNonBlank = lines.length - 1;
  while (lastNonBlank >= 0 && isBlank(lines[lastNonBlank])) lastNonBlank--;
  if (lastNonBlank < 0) return safeEnd; // candidate is all blank lines

  const lastLine = lines[lastNonBlank];
  let blockType = null;
  // Check list markers before the table heuristic — an unambiguous "1. "/
  // "- " prefix should never be overridden by a loose "contains a pipe"
  // match (see isTableLine note above).
  if (isListContinuation(lastLine)) blockType = 'list';
  else if (isTableLine(lastLine)) blockType = 'table';
  else return safeEnd; // plain prose line -> any earlier block is already closed

  // Walk backward while lines keep belonging to the same open block,
  // skipping over blank lines (they don't end a loose list/table either).
  let start = lastNonBlank;
  while (start > 0) {
    const prev = lines[start - 1];
    if (isBlank(prev)) { start--; continue; }
    if (blockType === 'table' && !isTableLine(prev)) break;
    if (blockType === 'list' && !isListContinuation(prev)) break;
    start--;
  }
  if (start === 0) return -1; // the whole candidate is one still-open block

  const before = lines.slice(0, start).join('\n');
  return before.length; // index of the \n right before the open block starts
}

// _hasOpenMathBlock: true while `text` contains a math delimiter or LaTeX
// environment that hasn't been closed yet (open \(, \[, $$, or \begin{..}
// without a matching \end{..} — this is exactly the "\begin{vmatrix}...\\..."
// case that renders as raw LaTeX mid-stream). While something is open,
// MathJax can't render the formula anyway — repeatedly asking it to try
// just produces flicker between raw text and a failed/partial attempt. We
// skip the throttled typeset call until the closing delimiter has actually
// arrived, then it renders once, cleanly, in a single pass.
function _hasOpenMathBlock(text) {
  let dollar = false, bracket = false, paren = false, envDepth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('$$', i)) dollar = !dollar;
    else if (text.startsWith('\\[', i)) bracket = true;
    else if (text.startsWith('\\]', i)) bracket = false;
    else if (text.startsWith('\\(', i)) paren = true;
    else if (text.startsWith('\\)', i)) paren = false;
    else if (text.startsWith('\\begin{', i)) envDepth++;
    else if (text.startsWith('\\end{', i)) envDepth--;
  }
  return dollar || bracket || paren || envDepth > 0;
}

// Tracks, per bubble element, how much of its content is already frozen —
// so we only touch .msg-stable when there's genuinely new finished content.
const _streamStableCache = new WeakMap();

// Live-updates a message bubble during streaming. Splits into a frozen
// "stable" container and a small "tail" for the in-progress line.
function renderStreamingBubble(bubbleEl, thinkingText, assistantText) {
  let stableEl = bubbleEl.querySelector('.msg-stable');
  let tailEl = bubbleEl.querySelector('.msg-tail');
  if (!stableEl) {
    bubbleEl.innerHTML =
      '<div class="msg-thinking" style="display:contents"></div>' +
      '<div class="msg-stable" style="display:contents"></div>' +
      '<div class="msg-tail" style="display:contents"></div>';
    stableEl = bubbleEl.querySelector('.msg-stable');
    tailEl = bubbleEl.querySelector('.msg-tail');
    _streamStableCache.set(bubbleEl, { len: 0 });
  }

  const thinkEl = bubbleEl.querySelector('.msg-thinking');
  if (thinkEl) {
    thinkEl.innerHTML = thinkingText
      ? `<details class="thinking-block" style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;font-family:'IBM Plex Mono',monospace;color:var(--accent2);opacity:0.8;">${tf('js.thinkingBlock', { n: thinkingText.length })}</summary><pre style="font-size:11px;color:var(--muted);white-space:pre-wrap;margin-top:6px;padding:8px;background:#0a0c10;border-radius:6px;">${escHtml(thinkingText)}</pre></details>`
      : '';
  }

  const { stable, tail } = _splitStableTail(assistantText || '');
  const cached = _streamStableCache.get(bubbleEl) || { len: 0 };

  if (stable.length > cached.len) {
    // Append only the newly finished increment and typeset only the newly
    // inserted nodes — never overwrite stableEl's full innerHTML, or every
    // already-typeset <mjx-container> in it would be destroyed and MathJax
    // would have to redo them, causing visible flicker.
    const newStable = stable.slice(cached.len);
    const prevLast = stableEl.lastChild;
    stableEl.insertAdjacentHTML('beforeend', formatText(newStable));
    _streamStableCache.set(bubbleEl, { len: stable.length });
    const newNodes = [];
    for (let n = prevLast ? prevLast.nextSibling : stableEl.firstChild; n; n = n.nextSibling) newNodes.push(n);
    if (newNodes.length) typesetMath(newNodes);
  }
  tailEl.innerHTML = formatText(tail);
  const mathNodes = tailEl.querySelectorAll('.math-inline, .math-block');
  if (mathNodes.length) {
    // Pass the container itself, not a snapshot of its current child nodes:
    // tailEl's innerHTML is fully overwritten on every subsequent chunk, so a
    // captured node list would likely be detached by the time this fires.
    // Re-scanning the live container instead always typesets current content.
    typesetMathThrottled(tailEl, 400);
  }
  // If still mid-formula (e.g. inside \begin{vmatrix}...\end{vmatrix}) —
  // leave it as raw text for now rather than making MathJax repeatedly choke
  // on a half-written block. It gets typeset correctly as soon as the
  // closing delimiter arrives (next call above), or at the latest by
  // _finalizeStreamingBubble once the whole response is done.
}

// _finalizeStreamingBubble: called once the stream is done. Formats and
// appends only the still-open tail (e.g. the last line/formula that just
// closed) — .msg-stable's already-rendered content is left untouched — then
// runs one final typeset pass so MathJax settles on a consistent result.
function _finalizeStreamingBubble(bubbleEl, assistantText) {
  const stableEl = bubbleEl.querySelector('.msg-stable');
  const tailEl = bubbleEl.querySelector('.msg-tail');
  const full = assistantText || '';
  if (stableEl && tailEl) {
    const cached = _streamStableCache.get(bubbleEl) || { len: 0 };
    const remaining = full.slice(cached.len);
    if (remaining) stableEl.insertAdjacentHTML('beforeend', formatText(remaining));
    tailEl.innerHTML = '';
    _streamStableCache.set(bubbleEl, { len: full.length });
  }
  typesetMath(bubbleEl);
}



// Combines a thinking trace and the assistant answer into the single string format used for storage/history.
function _streamStoredText(thinkingText, assistantText) {
  return (thinkingText ? `<thinking>\n${thinkingText}\n</thinking>\n\n` : '') + (assistantText || '');
}

// Removes the 'streaming' animation class from any bubble still marked as live.
function _finishLiveStreamUI() {
  document.querySelectorAll('.bubble.streaming').forEach(b => b.classList.remove('streaming'));
}

/**
 * _streamAIResponse: Core streaming function used by sendMessageCore and rerunFromUserMsg.
 * Sends `messages` to the provider, streams the response into a new AI bubble,
 * and returns { text, usage }.
 * @param {Array}  messages    — final wire-format message array
 * @param {object} provider    — provider object with .type, .apiKey, etc.
 * @param {string} typingId    — ID of the typing indicator element to remove on first chunk
 * @param {Array}  [documentIds] — optional KiConnect document IDs (OpenAI-compat only)
 * @returns {Promise<{text: string, usage: object|null}>}
 */
async function _streamAIResponse(messages, provider, typingId, documentIds, opts) {
  // opts.prefixText: pre-formed markdown/HTML (currently only the agentic
  // web-search tool trace, see runAgenticWebToolLoop) seeded as already-
  // "streamed" text before the model's own live delta text is appended —
  // same trick already used below for the <thinking> block.
  let assistantText = (opts && opts.prefixText) ? (opts.prefixText + '\n\n') : '', usageData = null;
  // runId: caller (_runStreamAndAttach) generates and passes one via
  // opts.runId so it's known even if this function throws before returning
  // (registration below happens synchronously, before any await, so the
  // run is always in the registry by the time an AbortError/network error
  // can occur). Falls back to self-generating for any other caller.
  const runId = (opts && opts.runId) || _makeRunId(currentChatId);
  // Every run gets its OWN AbortController instead of sharing a single
  // global one — this is what lets stopStreaming(chatId) cancel exactly
  // one chat's in-flight request while a different chat's stream keeps
  // running untouched.
  const runAbortController = (opts && opts.abortController) || new AbortController();
  const run = {
    runId,
    chatId: currentChatId,      // which chat this run belongs to
    kind: 'chat',
    provider: provider && provider.type,
    model: config.model,        // frozen NOW, never re-read from config.model later —
                                 // fixes the "wrong model label if header is changed
                                 // mid-stream" bug
    abortController: runAbortController,
    text: '',
    thinkingText: '',
    usage: null,
    status: 'running',
    bubbleEl: null,              // set right after appendEmptyAI() below
    targetContainer: null,       // unused outside Battle-Modus
  };
  activeRuns.set(runId, run);
  // This is the single choke point where a chat-stream run becomes
  // "visible" as in-flight — update the sidebar's live-indicator dot and
  // (if this run's chat happens to be the one on screen) the composer's
  // send/stop button right away, before the first network await below.
  // syncComposerStreamingUI() reads currentChatId itself, so this is always
  // correct even if the user switched chats during sendMessageCore's
  // earlier awaits (upload/link-fetch/web-search/KB) and is now looking at
  // a completely different chat than the one this run belongs to.
  renderSidebar();
  syncComposerStreamingUI();

  if (provider.type === 'anthropic') {
    const { modelId } = splitModelId(config.model);
    const body = {
      model: modelId,
      max_tokens: effectiveMaxTokens(),
      stream: true,
      messages,
    };
    // temperature is deprecated / unsupported on Claude 4+ models — omit entirely for those.
    if (isTemperatureSupported(modelId)) {
      body.temperature = config.temperature;
    }
    if (config.systemPrompt) body.system = [{ type: 'text', text: config.systemPrompt, cache_control: { type: 'ephemeral', ttl: '1h' } }];
    if (config.thinkingEnabled && isThinkingCapable(modelId)) {
      if (isAdaptiveThinkingModel(modelId)) {
        // New API (Claude 4+): adaptive thinking via output_config.effort
        const effortMap = { 1: 'low', 2: 'medium', 3: 'high' };
        body.thinking = { type: 'adaptive' };
        body.output_config = { effort: effortMap[config.thinkingIntensity || 2] };
        // temperature must NOT be sent for adaptive thinking models
        delete body.temperature;
      } else {
        // Legacy API (Claude 3.7 / 3.5): enabled + budget_tokens
        const budget = usesTokenBudget(modelId) ? (config.thinkingBudget || 8000) : CLAUDE_BUDGET[config.thinkingIntensity || 2];
        body.thinking = { type: 'enabled', budget_tokens: budget };
        body.temperature = 1; // required to be exactly 1 for legacy thinking
        body.max_tokens = Math.max(body.max_tokens, budget + 2000);
      }
    }
    const res = await fetch(proxyUrl('https://api.anthropic.com/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        // No anthropic-beta header needed here anymore: prompt caching is
        // GA and ttl:'1h' works without it (was prompt-caching-2024-07-31,
        // now redundant). See kiconnect-agent.js for the agent path, which
        // does still send a beta header — for the separate, newer
        // context-management feature, not for caching.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: run.abortController.signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    removeTyping(typingId);
    const aiEl = appendEmptyAI(run.model, runId);
    run.bubbleEl = aiEl;
    const reader = res.body.getReader(), decoder = new TextDecoder(); let buf = '';
    let thinkingText = '', inThinkingBlock = false;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6).trim());
          if (ev.type === 'message_start' && ev.message?.usage) {
            usageData = { ...(usageData || {}), ...ev.message.usage };
            _updateRunText(runId, _streamStoredText(thinkingText, assistantText), usageData, thinkingText);
          }
          else if (ev.type === 'message_delta' && ev.usage) {
            usageData = { ...(usageData || {}), ...ev.usage };
            _updateRunText(runId, _streamStoredText(thinkingText, assistantText), usageData, thinkingText);
          }
          else if (ev.type === 'content_block_start') { inThinkingBlock = ev.content_block?.type === 'thinking'; }
          else if (ev.type === 'content_block_stop') { inThinkingBlock = false; }
          else if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'thinking_delta' && inThinkingBlock) {
              thinkingText += ev.delta.thinking || '';
              { const liveBubble = _runBubbleEl(run); if (liveBubble) renderStreamingBubble(liveBubble.querySelector('.bubble'), thinkingText, assistantText); }
              _updateRunText(runId, _streamStoredText(thinkingText, assistantText), usageData, thinkingText);
            } else if (ev.delta?.type === 'text_delta') {
              assistantText += ev.delta.text;
              { const liveBubble = _runBubbleEl(run); if (liveBubble) renderStreamingBubble(liveBubble.querySelector('.bubble'), thinkingText, assistantText); }
              _updateRunText(runId, _streamStoredText(thinkingText, assistantText), usageData, thinkingText);
              if (AUTO_SCROLL_DURING_STREAM) scrollToBottom();
            }
          }
        } catch {}
      }
    }
    { const liveBubble = _runBubbleEl(run); if (liveBubble) _finalizeStreamingBubble(liveBubble.querySelector('.bubble'), assistantText); }
    if (thinkingText) assistantText = `<thinking>\n${thinkingText}\n</thinking>\n\n` + assistantText;

  } else {
    const endpoint = getProviderEndpoint(provider);
    const { modelId } = splitModelId(config.model);
    const apiMsgs = [];
    if (config.systemPrompt) apiMsgs.push({ role: 'system', content: config.systemPrompt });
    // messages are already expanded by caller (_toOpenAIContent) — pass through.
    // Also forward tool_calls (on assistant messages) and role:'tool' messages
    // unchanged — these appear here whenever 'agentic' web-search mode ran a
    // web_search/fetch_url round trip first (see runAgenticWebToolLoop):
    // dropping them left a dangling assistant tool_calls message with no
    // matching tool results, which most OpenAI-compatible APIs reject with a
    // 400 ("messages with role 'tool' must be a response to a preceding
    // message with 'tool_calls'"), breaking every non-Anthropic provider in
    // that mode. The Anthropic branch above never hit this since it sends
    // `messages` straight through instead of rebuilding it.
    messages.forEach(m => {
      if (m.role === 'user' || m.role === 'assistant') {
        const msg = { role: m.role, content: m.content };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        apiMsgs.push(msg);
      } else if (m.role === 'tool') {
        apiMsgs.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
      }
    });
    const reqBody = { model: modelId, messages: apiMsgs, stream: true };
    // GPT-5 is a reasoning model just like the o-series: it rejects
    // `temperature` and `max_tokens` outright and requires
    // `max_completion_tokens` instead — so it needs to take the same
    // request-shape branch as o1/o3/o4.
    const isOSeries = /^o\d/.test(modelId) || /^(chatgpt-)?gpt-5/.test(modelId);
    if (isOSeries) {
      reqBody.max_completion_tokens = effectiveMaxTokens();
      if (config.thinkingEnabled && isThinkingCapable(modelId)) reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
    } else {
      reqBody.temperature = config.temperature;
      reqBody.max_tokens = effectiveMaxTokens();
      if (config.thinkingEnabled && isThinkingCapable(modelId)) reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
    }
    if (documentIds?.length) reqBody.documents = documentIds;
    if (provider.type !== 'zhipu') {
      reqBody.stream_options = { include_usage: true };
    }
    // GLM (z.ai) uses a different thinking shape than o-series/deepseek:
    // it sets `thinking: { type: 'enabled' }` instead of `reasoning_effort`,
    // and streams the reasoning trace via delta.reasoning_content.
    if (provider.type === 'zhipu' && isThinkingCapable(modelId)) {
      reqBody.thinking = { type: config.thinkingEnabled ? 'enabled' : 'disabled' };
      delete reqBody.reasoning_effort;
    }
    // MiniMax (M-series) has no reasoning_effort levels — it thinks by default
    // (M2.x can't even be turned off) — so instead of an effort value we send
    // an on/off `thinking.type` plus `reasoning_split: true`, which asks the
    // API to return the trace via delta.reasoning_details instead of inline
    // <think>...</think> tags in the content field.
    if (provider.type === 'minimax' && isThinkingCapable(modelId)) {
      reqBody.thinking = { type: config.thinkingEnabled ? 'adaptive' : 'disabled' };
      reqBody.reasoning_split = true;
      delete reqBody.reasoning_effort;
    }
    // Mistral: only 'none'/'high' are documented values for reasoning_effort
    // (no low/medium), and it's a root-level field, not nested — the
    // OAI_EFFORT low/medium/high mapping above doesn't apply here. Native
    // Magistral models always reason and take no parameter at all.
    if (provider.type === 'mistral') {
      if (isMistralAdjustableThinkingModel(modelId)) {
        reqBody.reasoning_effort = (config.thinkingEnabled && isThinkingCapable(modelId)) ? 'high' : 'none';
      } else {
        delete reqBody.reasoning_effort;
      }
    }
    const extraHeaders = {};
    if (provider.type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
    if (provider.type === 'zhipu') { extraHeaders['Accept-Language'] = 'en-US,en'; }
    const res = await fetch(proxyUrl(`${endpoint}/chat/completions`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders },
      body: JSON.stringify(reqBody),
      signal: run.abortController.signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    removeTyping(typingId);
    const aiEl = appendEmptyAI(run.model, runId);
    run.bubbleEl = aiEl;
    const reader = res.body.getReader(), decoder = new TextDecoder(); let buf = '';
    let thinkingText = '';
    const isZhipu = provider.type === 'zhipu';
    const isMinimax = provider.type === 'minimax';
    const isMistral = provider.type === 'mistral' && isThinkingCapable(modelId);
    const showsThinking = isZhipu || isMinimax || isMistral;
    // MiniMax's delta.reasoning_details[].text arrives cumulative (each chunk
    // repeats everything so far), unlike GLM's incremental reasoning_content —
    // so track the previously-seen length to extract only the new suffix.
    let minimaxReasoningSeen = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim(); if (payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload);
          const rawContent = chunk.choices?.[0]?.delta?.content;
          let delta = '', reasoningDelta = '';
          if (isMistral) {
            const parsed = parseMistralContent(rawContent);
            delta = parsed.text;
            // Fall back to a reasoning_content field in case the streaming
            // shape follows the same convention as GLM/DeepSeek instead of
            // (or in addition to) chunked content — harmless either way.
            reasoningDelta = parsed.reasoning || chunk.choices?.[0]?.delta?.reasoning_content || '';
          } else {
            delta = rawContent || '';
            if (isZhipu) {
              reasoningDelta = chunk.choices?.[0]?.delta?.reasoning_content || '';
            } else if (isMinimax) {
              const details = chunk.choices?.[0]?.delta?.reasoning_details;
              if (details && details.length) {
                const full = details.map(d => d.text || '').join('');
                if (full.length > minimaxReasoningSeen.length) {
                  reasoningDelta = full.slice(minimaxReasoningSeen.length);
                  minimaxReasoningSeen = full;
                }
              }
            }
          }
          if (reasoningDelta) {
            thinkingText += reasoningDelta;
          }
          assistantText += delta;
          if (showsThinking) {
            // GLM / MiniMax: render live bubble with thinking block + assistant text
            if (reasoningDelta || delta) {
              { const liveBubble = _runBubbleEl(run); if (liveBubble) renderStreamingBubble(liveBubble.querySelector('.bubble'), thinkingText, assistantText); }
              _updateRunText(runId, _streamStoredText(thinkingText, assistantText), usageData, thinkingText);
              if (AUTO_SCROLL_DURING_STREAM) scrollToBottom();
            }
          } else if (delta) {
            { const liveBubble = _runBubbleEl(run); if (liveBubble) renderStreamingBubble(liveBubble.querySelector('.bubble'), '', assistantText); }
            _updateRunText(runId, assistantText, usageData, '');
            if (AUTO_SCROLL_DURING_STREAM) scrollToBottom();
          }
          if (chunk.usage) {
            const u = chunk.usage;
            // DeepSeek reports cache hits as prompt_cache_hit_tokens instead
            // of the OpenAI-standard prompt_tokens_details.cached_tokens —
            // fall back to it so DeepSeek's cache savings actually show up
            // in the token badge instead of always reading 0.
            usageData = { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0 };
            _updateRunText(runId, showsThinking ? _streamStoredText(thinkingText, assistantText) : assistantText, usageData, showsThinking ? thinkingText : '');
          }
        } catch {}
      }
    }
    { const liveBubble = _runBubbleEl(run); if (liveBubble) _finalizeStreamingBubble(liveBubble.querySelector('.bubble'), assistantText); }
    if (showsThinking && thinkingText) {
      assistantText = `<thinking>\n${thinkingText}\n</thinking>\n\n` + assistantText;
    }
  }

  _finishLiveStreamUI();
  run.status = 'done';
  run.text = assistantText;
  // Return the run's CURRENT bubble (may have been reattached to a fresh
  // node by renderMessages() if the chat was switched away and back mid-
  // stream, or be null if the chat isn't on screen right now) — never the
  // originally-captured node, which may be long detached from the DOM.
  return { text: assistantText, usage: usageData, el: run.bubbleEl, runId };
}

/**
 * _runStreamAndAttach: shared "call _streamAIResponse, handle abort/errors,
 * then attach the finished bubble's chrome" logic used by both
 * sendMessageCore (new message) and rerunFromUserMsg (regenerate from an
 * earlier point).
 * There's no global isStreaming/abortController to set up beforehand or
 * reset afterwards — the run this call creates IS the per-chat streaming
 * state (see isChatStreaming/runsForChat), and it carries its own
 * AbortController (see _streamAIResponse). At the end this only updates the
 * send/stop button (via syncComposerStreamingUI) if `chat` happens to be the
 * one currently on screen — a background chat finishing must never flip the
 * button for whatever chat the user is actually looking at right now.
 */
async function _runStreamAndAttach(chat, messages, provider, typingId, documentIds, opts) {
  let assistantText = '', usageData = null, streamEl = null;
  // Generated here (not inside _streamAIResponse) so it's known even if that
  // call throws before returning — _streamAIResponse registers the run in
  // activeRuns synchronously before its first await, so by the time an
  // AbortError/network error can happen the run is already in the registry
  // and reachable via this runId.
  const runId = _makeRunId(chat && chat.id);
  try {
    const result = await _streamAIResponse(messages, provider, typingId, documentIds, { ...(opts || {}), runId });
    assistantText = result.text; usageData = result.usage; streamEl = result.el;
  } catch (e) {
    removeTyping(typingId);
    if (e.name === 'AbortError') {
      const run = activeRuns.get(runId);
      const partialText = run?.text || assistantText;
      assistantText = partialText || t('js.generationStopped');
      usageData = run?.usage || usageData;
      streamEl = _runBubbleEl(run);
      _finishLiveStreamUI();
    } else {
      assistantText = tf('js.errorPrefix', { e: escHtml(e.message) });
      const errEl = buildMsgEl({ role: 'assistant', content: assistantText }, undefined);
      appendToMessages(errEl); scrollToBottom(); setStatus('red');
    }
  }

  // Model actually used to generate this answer, frozen at run start — read
  // from the registry (not live config.model), so a header model-switch
  // mid-stream can never mislabel a finished answer (see TODO.md, Abschnitt 0).
  const modelUsed = activeRuns.get(runId)?.model ?? config.model;
  if (assistantText) _attachAIActions(chat, assistantText, usageData, streamEl, modelUsed);
  activeRuns.delete(runId);
  // Sidebar's live-indicator dot for `chat` needs to disappear now that its
  // run is gone from the registry; the composer button only changes if
  // `chat` is the one on screen (syncComposerStreamingUI reads currentChatId
  // itself, so this is a no-op for a background chat finishing).
  renderSidebar();
  syncComposerStreamingUI();
  if (chat === currentChat()) setStatus('green');
}

// ── Battle-Modus ────────────────────────────────────────────
// Battle-Modus reuses the existing sibling/tail tree (see getActivePath/
// getActiveContainer/regenerate above) instead of inventing a new message
// shape: one assistant message node is created with msg._siblings already
// populated (one entry per chosen model) and msg._siblingIdx left unset
// until a winner is picked. Each variant streams via its own activeRuns
// entry (kind: 'battle-variant'), fully independent — this reuses the same
// per-chat parallel-run infrastructure, just for several concurrent runs on
// the SAME chat/message instead of different chats.

// Finds the live tile bubble element for one battle variant in the DOM (if
// the owning chat happens to be the one on screen right now) — same idea as
// _runBubbleEl(), just addressed by battleId+siblingIdx instead of a
// captured closure reference, since a battle tile grid can be torn down and
// rebuilt by renderMessages() (chat switch, regular re-render) at any time.
function _findBattleTileBubble(battleId, siblingIdx) {
  if (!battleId) return null;
  const row = document.querySelector(`.battle-row[data-battle-id="${battleId}"]`);
  if (!row) return null;
  const tile = row.querySelector(`.battle-tile[data-sibling-idx="${siblingIdx}"]`);
  return tile ? tile.querySelector('.battle-tile-bubble') : null;
}

// Resolves a not-yet-explicitly-chosen battle message to a sensible default
// once every variant has finished — picks whichever variant finished FIRST
// (msg._battleDoneOrder, appended to by _runBattleVariant as each one
// completes), falling back to index 0 if that's somehow empty. Does NOT set
// _winnerChosen, so the tile grid keeps rendering (with the "default in
// use" banner) until the user explicitly picks one via chooseBattleWinner().
function _resolveBattleDefault(chat, msg) {
  if (msg._winnerChosen) return; // user already picked explicitly
  const defIdx = (msg._battleDoneOrder && msg._battleDoneOrder.length) ? msg._battleDoneOrder[0] : 0;
  const variant = msg._siblings[defIdx] || msg._siblings[0];
  if (!variant) return;
  msg._siblingIdx = defIdx;
  msg.content   = variant.content;
  msg._model    = variant._model;
  msg._usage    = variant._usage;
}

// Streams a single model's variant into msg._siblings[i], writing chunks
// into both the RunState (registry — survives a chat switch) and, when
// connected, straight into the tile bubble via renderStreamingBubble(),
// mirroring _streamAIResponse's Anthropic/OpenAI-compat branches but scoped
// to one tile instead of the single main bubble, and parameterized by
// `provider`/`modelId` explicitly (never reads the shared global
// config.model) so N variants can run concurrently without racing each
// other over which model's request is "currently" being built.
async function _streamBattleVariant(chat, msg, i, provider, modelId, messages) {
  const sibling = msg._siblings[i];
  const runId = _makeRunId(chat.id);
  const run = {
    runId, chatId: chat.id, kind: 'battle-variant',
    provider: provider.type, model: modelId,
    abortController: new AbortController(),
    text: '', thinkingText: '', usage: null, status: 'running',
    bubbleEl: _findBattleTileBubble(msg._battleId, i),
    battleMsg: msg, battleSiblingIdx: i,
  };
  activeRuns.set(runId, run);
  renderSidebar(); syncComposerStreamingUI();

  let assistantText = '', usageData = null, thinkingText = '';
  try {
    if (provider.type === 'anthropic') {
      const body = { model: modelId, max_tokens: effectiveMaxTokens(), stream: true, messages };
      if (isTemperatureSupported(modelId)) body.temperature = config.temperature;
      if (config.systemPrompt) body.system = [{ type: 'text', text: config.systemPrompt, cache_control: { type: 'ephemeral', ttl: '1h' } }];
      if (config.thinkingEnabled && isThinkingCapable(modelId)) {
        if (isAdaptiveThinkingModel(modelId)) {
          const effortMap = { 1: 'low', 2: 'medium', 3: 'high' };
          body.thinking = { type: 'adaptive' };
          body.output_config = { effort: effortMap[config.thinkingIntensity || 2] };
          delete body.temperature;
        } else {
          const budget = usesTokenBudget(modelId) ? (config.thinkingBudget || 8000) : CLAUDE_BUDGET[config.thinkingIntensity || 2];
          body.thinking = { type: 'enabled', budget_tokens: budget };
          body.temperature = 1;
          body.max_tokens = Math.max(body.max_tokens, budget + 2000);
        }
      }
      const res = await fetch(proxyUrl('https://api.anthropic.com/v1/messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify(body),
        signal: run.abortController.signal,
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buf = '';
      let inThinkingBlock = false;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim());
            if (ev.type === 'message_start' && ev.message?.usage) usageData = { ...(usageData || {}), ...ev.message.usage };
            else if (ev.type === 'message_delta' && ev.usage) usageData = { ...(usageData || {}), ...ev.usage };
            else if (ev.type === 'content_block_start') inThinkingBlock = ev.content_block?.type === 'thinking';
            else if (ev.type === 'content_block_stop') inThinkingBlock = false;
            else if (ev.type === 'content_block_delta') {
              if (ev.delta?.type === 'thinking_delta' && inThinkingBlock) thinkingText += ev.delta.thinking || '';
              else if (ev.delta?.type === 'text_delta') assistantText += ev.delta.text;
            }
          } catch {}
          run.text = assistantText; run.thinkingText = thinkingText; run.usage = usageData;
          sibling.content = assistantText;
          const bubbleEl = _runBubbleEl(run);
          if (bubbleEl) renderStreamingBubble(bubbleEl, thinkingText, assistantText);
        }
      }
    } else {
      const endpoint = getProviderEndpoint(provider);
      const apiMsgs = [];
      if (config.systemPrompt) apiMsgs.push({ role: 'system', content: config.systemPrompt });
      messages.forEach(m => { if (m.role === 'user' || m.role === 'assistant') apiMsgs.push({ role: m.role, content: m.content }); });
      const reqBody = { model: modelId, messages: apiMsgs, stream: true };
      const isOSeries = /^o\d/.test(modelId) || /^(chatgpt-)?gpt-5/.test(modelId);
      if (isOSeries) {
        reqBody.max_completion_tokens = effectiveMaxTokens();
        if (config.thinkingEnabled && isThinkingCapable(modelId)) reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
      } else {
        reqBody.temperature = config.temperature;
        reqBody.max_tokens = effectiveMaxTokens();
        if (config.thinkingEnabled && isThinkingCapable(modelId)) reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
      }
      if (provider.type !== 'zhipu') reqBody.stream_options = { include_usage: true };
      const extraHeaders = {};
      if (provider.type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
      const res = await fetch(proxyUrl(`${endpoint}/chat/completions`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders },
        body: JSON.stringify(reqBody),
        signal: run.abortController.signal,
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim(); if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta?.content || '';
            assistantText += delta;
            if (chunk.usage) {
              const u = chunk.usage;
              usageData = { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0 };
            }
          } catch {}
          run.text = assistantText; run.usage = usageData;
          sibling.content = assistantText;
          const bubbleEl = _runBubbleEl(run);
          if (bubbleEl) renderStreamingBubble(bubbleEl, '', assistantText);
        }
      }
    }
    { const bubbleEl = _runBubbleEl(run); if (bubbleEl) _finalizeStreamingBubble(bubbleEl, assistantText); }
    sibling.content = assistantText || bt('battle.pending');
    sibling._model = modelId;
    sibling._usage = usageData || undefined;
  } catch (e) {
    if (e.name === 'AbortError') {
      sibling.content = assistantText || bt('battle.aborted');
      sibling._model = modelId;
    } else {
      sibling.error = btf('battle.errorPrefix', { e: e.message || String(e) });
    }
  } finally {
    sibling._pending = false;
    run.status = 'done';
    if (!msg._battleDoneOrder) msg._battleDoneOrder = [];
    msg._battleDoneOrder.push(i);
    activeRuns.delete(runId);
    renderSidebar();
    // Re-render the tile grid in place (this variant's status dot / final
    // content) if the owning chat is still the one on screen — a variant
    // finishing while the user is elsewhere doesn't need to touch the DOM;
    // it'll render correctly (as a normal, non-running tile) the next time
    // this chat is opened.
    if (chat === currentChat()) renderMessages(chat.messages);
    syncComposerStreamingUI();
  }
}

// Resolves the provider/model for one battle variant and either runs it or
// (no provider/key configured) records that as this tile's error — a
// mis-configured model must not abort the other, working variants.
async function _runBattleVariant(chat, msg, i, fullModelId, messages) {
  const provider = providerForModel(fullModelId);
  const { modelId } = splitModelId(fullModelId);
  if (!provider || !provider.apiKey || provider.enabled === false) {
    msg._siblings[i].error = bt('battle.noProviderForModel');
    msg._siblings[i]._pending = false;
    if (!msg._battleDoneOrder) msg._battleDoneOrder = [];
    msg._battleDoneOrder.push(i);
    if (chat === currentChat()) renderMessages(chat.messages);
    return;
  }
  // Build the wire-format history in THIS variant's provider's shape —
  // provider type can differ per model, exactly like the normal single-send
  // path branches on provider.type (see sendMessageCore).
  let wireMessages;
  if (provider.type === 'anthropic') {
    wireMessages = messages.map(m => ({ role: m.role, content: _toAnthropicContent(m.content) }));
    _applyPromptCache(wireMessages);
  } else {
    wireMessages = messages.map(m => ({ role: m.role, content: _toOpenAIContent(m.content) }));
  }
  await _streamBattleVariant(chat, msg, i, provider, modelId, wireMessages);
}

/**
 * sendBattleMessage: Battle-Modus entry point, analogous to
 * sendMessageCore() but fans one user message out to N models at once
 * instead of the single currently-selected one. Web search / knowledge-base
 * augmentation are intentionally out of scope here (kept for the normal
 * single-model send path only) to keep N-way concurrent requests simple —
 * plain text + attachments only.
 */
async function sendBattleMessage(text, att, modelIds) {
  if (!currentChatId) newChat();
  const chat = currentChat(); if (!chat) return;
  if (isChatStreaming(chat.id)) return;
  if (!modelIds || modelIds.length < 2) { toast(bt('battle.needTwoModels')); return; }

  const empty = document.getElementById('emptyState');
  if (empty) empty.style.display = 'none';

  const { userContent, fileNames } = buildAttachmentContent(text, att);
  const activeContainer = getActiveContainer(chat);
  const userMsg = { role: 'user', content: userContent, _files: fileNames.length ? fileNames : undefined };
  activeContainer.push(userMsg);
  if (chat.messages.length === 1) { chat.title = '…'; renderSidebar(); autoGenerateChatTitle(chat, text); }

  const battleMsg = {
    role: 'assistant', content: '', _battle: true, _winnerChosen: false,
    _battleId: _makeRunId(chat.id) + '_battle',
    _siblings: modelIds.map(id => ({ content: '', _model: id, tail: [], _pending: true })),
    _siblingIdx: null,
  };
  getActiveContainer(chat).push(battleMsg);
  save();
  renderMessages(chat.messages);
  scrollToBottom();

  // History for the API call: active path up to (but not including) the
  // still-empty battleMsg placeholder just pushed — same idea as
  // sendMessageCore's activePath.slice(0,-1), just built once and reused
  // per-provider inside _runBattleVariant.
  const activePath = getActivePath(chat);
  const historyMsgs = activePath.slice(0, -1)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  const results = await Promise.allSettled(
    modelIds.map((id, i) => _runBattleVariant(chat, battleMsg, i, id, historyMsgs))
  );
  results.forEach(r => { if (r.status === 'rejected') console.warn('[battle] variant failed:', r.reason); });

  _resolveBattleDefault(chat, battleMsg);
  save();
  renderSidebar();
  syncComposerStreamingUI();
  if (chat === currentChat()) { renderMessages(chat.messages); setStatus('green'); }
}

/**
 * _attachAIActions: Appends action buttons and token badge to the last AI bubble.
 * Shared post-stream logic for both sendMessageCore and rerunFromUserMsg.
 */
// _attachAIActions: tree-aware, writes into active sibling tail
function _attachAIActions(chat, assistantText, usageData, streamEl, modelUsed) {
  if (modelUsed === undefined) modelUsed = config.model; // fallback for any other caller
  if (chat._pendingRegenMsg) {
    // Regeneration: push new sibling with empty tail onto the branch node.
    // _note/_noteOpen start fresh (undefined/false) — a regenerated answer
    // is new content and must not inherit the note from the previous variant.
    const msg = chat._pendingRegenMsg;
    const newSibling = { content: assistantText, _model: modelUsed, _usage: usageData || undefined, _note: undefined, _noteOpen: false, tail: [] };
    msg._siblings.push(newSibling);
    msg._siblingIdx = msg._siblings.length - 1;
    // Sync live fields to the new active variant
    msg.content   = newSibling.content;
    msg._model    = newSibling._model;
    msg._usage    = newSibling._usage;
    msg._note     = newSibling._note;
    msg._noteOpen = newSibling._noteOpen;
    delete chat._pendingRegenMsg;
  } else {
    // Normal send: append to the active container (chat.messages or deepest active tail)
    const container = getActiveContainer(chat);
    const msgObj = { role: 'assistant', content: assistantText, _model: modelUsed };
    if (usageData) msgObj._usage = usageData;
    container.push(msgObj);
  }

  // Upgrade the just-finished bubble in place (action buttons, sibling nav,
  // token badge, ...) instead of tearing down and rebuilding the whole chat
  // history via renderMessages() or re-running formatText()/typesetMath()
  // on content that renderStreamingBubble() already rendered and typeset
  // incrementally during streaming. _finalizeAIRowInPlace() reuses `streamEl`
  // as-is and only attaches what's missing — the chrome around it
  // (actions/badge/nav/note) — leaving the rendered answer itself untouched.
  const path = getActivePath(chat);
  const idx = path.length - 1;
  const messagesEl = document.getElementById('messages');
  const emptyState = document.getElementById('emptyState');

  // Only touch #messages at all if `chat` is actually the chat on screen
  // right now — if the stream finished while the user was on a DIFFERENT
  // chat, #messages holds THAT chat's rows, and neither finalizing in place
  // nor the "build a fresh row" fallback below may write into it. The
  // finished answer is already saved into chat.messages/container above, so
  // it'll render correctly (as a normal, non-streaming bubble) the next time
  // this chat is opened via renderMessages() — nothing further to do here.
  if (chat === currentChat()) {
    if (!_finalizeAIRowInPlace(streamEl, path[idx], idx)) {
      // Fallback: streamEl is missing/detached (e.g. reattach never
      // happened, or the row was otherwise lost) — build a fresh row the
      // old way. We still avoid replacing an unrelated node: fall back to
      // the last message row, never the #chatTokenTotal footer div
      // appendToMessages() always keeps last.
      const newRow = buildMsgEl(path[idx], idx);
      const oldRow = (streamEl && streamEl.parentNode === messagesEl) ? streamEl : messagesEl.lastElementChild;
      if (oldRow && oldRow !== emptyState) oldRow.replaceWith(newRow);
      else messagesEl.appendChild(newRow);
      typesetMath(newRow);
    }
    if (pinnedToBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  updateChatTokenTotal();
  save();
}

// Tree-branch regenerate: old tail is preserved in the current sibling
async function regenerate(idx) {
  idx=safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  // idx is a path index — resolve to the actual message object
  const path=getActivePath(chat);
  const msg=path[idx];
  if(!msg||msg.role!=='assistant') return;
  if(isChatStreaming(chat.id)){stopStreaming(chat.id);return;}

  const userMsg=path[idx-1];
  if(!userMsg||userMsg.role!=='user'){save();renderMessages(chat.messages);return;}

  // Initialise siblings: wrap current content as siblings[0] with its existing tail
  if(!msg._siblings) {
    // Collect everything after this node in the active path as the original tail
    const originalTail = path.slice(idx+1).map(m => JSON.parse(JSON.stringify(m)));
    // Note (_note/_noteOpen) is per-variant, just like content/_model/_usage —
    // otherwise a note stays "stuck" to the node and shows up again on every
    // regenerated version instead of only on the version it was written for.
    msg._siblings=[{content:msg.content,_model:msg._model,_usage:msg._usage,_note:msg._note,_noteOpen:msg._noteOpen,tail:originalTail}];
    msg._siblingIdx=0;
    // Remove those messages from whichever container they live in — now owned by tail
    _pruneAfter(chat, msg);
  } else {
    // Persist any note edits made on the currently active variant before we
    // move on to a brand-new (note-less) variant.
    const activeVariant = msg._siblings[msg._siblingIdx ?? 0];
    if (activeVariant) { activeVariant._note = msg._note; activeVariant._noteOpen = msg._noteOpen; }
  }

  // New sibling starts with an empty tail; _attachAIActions will write into it
  const newSibIdx = msg._siblings.length; // will be pushed by _attachAIActions
  chat._pendingRegenMsg = msg;

  save();
  // Render only up through the user message (idx nodes), NOT the assistant
  // bubble we're about to regenerate. Previously this rendered the full path
  // (including the old assistant bubble), and after the stream finished only
  // the newly streamed bubble got swapped in — leaving the stale old bubble
  // behind as a visible duplicate. See _attachAIActions() below.
  renderMessages(chat.messages, idx);
  await rerunFromUserMsg(userMsg);
}

/**
 * _pruneAfter: Remove messages that come after `targetMsg` in the active container.
 * Used when first creating siblings to move the existing tail into the sibling object.
 */
function _pruneAfter(chat, targetMsg) {
  const pruneFrom = (arr) => {
    const i = arr.indexOf(targetMsg);
    if (i >= 0) { arr.splice(i+1); return true; }
    for (const m of arr) {
      if (m._siblings) {
        for (const s of m._siblings) {
          if (s.tail && pruneFrom(s.tail)) return true;
        }
      }
    }
    return false;
  };
  pruneFrom(chat.messages);
}

// Fires a new AI completion using the current chat.messages state (no user-msg rebuild).
// Shares its streaming/error-handling logic with sendMessageCore via _runStreamAndAttach.
async function rerunFromUserMsg(userMsg) {
  if(!currentChatId) newChat();
  const chat=currentChat(); if(!chat) return;
  const provider=providerForModel(config.model)||providers[0];
  if(!provider||!provider.apiKey){toast(t('js.noProvider'));openProviderPanel();return;}
  if(provider.enabled===false){toast(t('js.providerDisabledToast'));openProviderPanel();return;}

  const typingId=showTyping();
  // See the matching comment in sendMessageCore — no global
  // isStreaming/abortController to set up here anymore; the composer
  // button updates itself once the run registers inside _streamAIResponse.

  // build history from active path up to (including) userMsg
  const activePath = getActivePath(chat);
  const userMsgIdx = activePath.indexOf(userMsg);
  const histSlice  = userMsgIdx >= 0 ? activePath.slice(0, userMsgIdx + 1) : activePath;

  let messages;
  if(provider.type==='anthropic'){
    messages=[];
    histSlice.forEach(m=>{if(m.role==='user'||m.role==='assistant')messages.push({role:m.role,content:_toAnthropicContent(m.content)});});
    _applyPromptCache(messages);
  } else {
    messages=histSlice.filter(m=>m.role==='user'||m.role==='assistant')
      .map(m=>({role:m.role,content:_toOpenAIContent(m.content)}));
  }
  if (isAgenticWebMode()) {
    const { msgs: augmentedMessages, traceHtml } = await runAgenticWebToolLoop(messages, provider);
    await _runStreamAndAttach(chat, augmentedMessages, provider, typingId, [], { prefixText: traceHtml });
  } else {
    await _runStreamAndAttach(chat, messages, provider, typingId, []);
  }
}


// ── Send / Stop ───────────────────────────────────────────────────
// Reflects the chat CURRENTLY ON SCREEN (see isChatStreaming) — pressing
// the button always acts on what the user is looking at, never on whatever
// other chat might also happen to be streaming in the background.
function handleSendStop() { isChatStreaming(currentChatId) ? stopStreaming(currentChatId) : sendMessage(); }
// Aborts the in-progress AI response stream(s) for one chat (defaults to
// whichever chat is on screen). Each run carries its own AbortController
// (see _streamAIResponse), so this only ever cancels runs belonging to
// `chatId` — a stream running for a different chat in the background is
// completely unaffected. Accepts an explicit chatId so a future per-chat
// stop control in the sidebar (see the live-indicator dot) can target a
// background chat without switching to it first.
function stopStreaming(chatId) {
  chatId = chatId || currentChatId;
  runsForChat(chatId).forEach(run => { if (run.abortController) run.abortController.abort(); });
}
// Switches the send button between its 'send' and 'stop' (streaming) appearance/behaviour.
function setSendMode(mode) {
  const btn=document.getElementById('sendBtn');
  btn.classList.toggle('stop-mode', mode==='stop');
  document.getElementById('sendBtnLabel').textContent = mode==='stop' ? t('js.stop') : t('js.send');
  document.getElementById('sendIcon').style.display  = mode==='stop' ? 'none' : '';
  document.getElementById('stopIcon').style.display  = mode==='stop' ? '' : 'none';
}

// Updates the web-search toggle button's active/searching visual state.
function updateWebSearchButton(searching=false) {
  const btn = document.getElementById('webSearchBtn');
  if (!btn) return;
  const mode = config.webSearchMode || 'manual';
  const active = mode === 'always' || mode === 'agentic' || config.webSearchEnabled;
  btn.classList.toggle('active', active && mode !== 'off');
  btn.classList.toggle('link-active', !!config.webLinkEnabled && getSelectedReadableUrls().length > 0);
  btn.classList.toggle('searching', searching);
  btn.disabled = mode === 'off' || searching;
  btn.textContent = searching ? '...' : (mode === 'agentic' ? 'Web 🕵🏻🌐' : 'Web ▾');
  syncWebContextPopover();
}

// Toggles manual web search on/off for the next message.
function toggleWebSearch() {
  if ((config.webSearchMode || 'manual') === 'off') {
    toast(t('web.offToast'));
    return;
  }
  if (isAgenticWebMode()) config.webSearchMode = 'manual';
  config.webSearchEnabled = !config.webSearchEnabled;
  updateWebSearchButton();
  save();
  toast(config.webSearchEnabled ? t('web.enabledToast') : t('web.disabledToast'));
}

// Opens/closes the popover listing detected links and web-search options for the current draft message.
function toggleWebContextPopover(force) {
  const pop = document.getElementById('webContextPopover');
  if (!pop) return;
  pop.hidden = force === undefined ? !pop.hidden : !force;
  if (!pop.hidden) syncWebContextPopover();
}

// Sets the active/inactive visual state of a small toggle button.
function setMiniToggle(btn, active) {
  if (!btn) return;
  btn.classList.toggle('active', !!active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

// Refreshes the web-context popover's toggles to match the current config.
function syncWebContextPopover() {
  setMiniToggle(document.getElementById('webSearchToggle'), shouldUseWebSearch(document.getElementById('messageInput')?.value || ''));
  setMiniToggle(document.getElementById('webAgenticToggle'), isAgenticWebMode());
  setMiniToggle(document.getElementById('webLinkToggle'), !!config.webLinkEnabled);
  const count = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(config.webSearchResultCount) || 8));
  const countEl = document.getElementById('webContextCount');
  const countVal = document.getElementById('webContextCountVal');
  if (countEl && `${countEl.value}` !== `${count}`) countEl.value = count;
  if (countVal) countVal.textContent = count;
  renderDetectedLinks();
}

// Returns a short, human-readable hostname label for a URL (used on detected-link chips).
function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// (Re)renders the chips for HTTP(S) links detected in the current draft message, so the user can include/exclude each from the request.
function renderDetectedLinks() {
  const wrap = document.getElementById('webDetectedLinks');
  const input = document.getElementById('messageInput');
  if (!wrap || !input) return;
  const urls = extractReadableHttpUrls(input.value);
  selectedLinkUrls = new Set([...selectedLinkUrls].filter(url => urls.includes(url)));
  ignoredLinkUrls = new Set([...ignoredLinkUrls].filter(url => urls.includes(url)));
  if (config.webLinkEnabled) urls.forEach(url => {
    if (!ignoredLinkUrls.has(url)) selectedLinkUrls.add(url);
  });
  wrap.innerHTML = '';
  urls.forEach(url => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'web-link-chip';
    chip.classList.toggle('active', selectedLinkUrls.has(url));
    chip.title = url;
    chip.innerHTML = `<b>${selectedLinkUrls.has(url) ? '✓' : '○'}</b><span>${escHtml(hostLabel(url))}</span>`;
    chip.addEventListener('click', () => {
      if (selectedLinkUrls.has(url)) {
        selectedLinkUrls.delete(url);
        ignoredLinkUrls.add(url);
      } else {
        selectedLinkUrls.add(url);
        ignoredLinkUrls.delete(url);
      }
      config.webLinkEnabled = selectedLinkUrls.size > 0;
      save();
      updateWebSearchButton();
    });
    wrap.appendChild(chip);
  });
}

// Returns whether the draft text looks like it warrants an automatic web search (when auto mode is enabled).
function shouldAutoWebSearch(text) {
  const s = (text || '').toLowerCase();
  if (!s.trim()) return false;
  if (/\b(zusammenfassung|zusammenfassen|quelle|quellen|summarize|summary|source|sources)\b/.test(s)) return true;
  if (/^(mach mir eine zusammenfassung|fass .* zusammen|finde|pruefe|prüfe|look up|check)\b/.test(s)) return true;
  return /\b(heute|gestern|morgen|aktuell|aktuelle|aktueller|news|neueste|letzte|letzten|wetter|kurs|preis|preise|kosten|kostet|teuer|günstig|guenstig|stand|release|version|öffnungszeit|oeffnungszeit|verfügbar|verfuegbar|202[4-9]|203\d)\b/.test(s)
    || /\b(today|yesterday|tomorrow|current|latest|recent|news|weather|price|prices|cost|costs|cheap|available|availability|opening hours|stock|release|version|202[4-9]|203\d)\b/.test(s)
    || /\b(vps|server|tarif|tarife|angebot|angebote|deal|deals|provider|hosting|domain|cloud)\b/.test(s)
    || /^(was kostet|wie teuer|wie viel kostet|welcher preis|wann ist|wo finde|wer ist aktuell)\b/.test(s)
    || /^(how much|what does .* cost|what is the current|when is|where can i find|who is currently)\b/.test(s)
    || /^(suche|recherchiere|search|research)\b/.test(s);
}

// Returns whether web search should run for the given message, combining the manual toggle and auto-detection.
// 'agentic' mode is handled separately (see isAgenticWebMode()/runAgenticWebToolLoop) — it never
// pre-fetches results before the model even sees the message, so it's excluded here.
function shouldUseWebSearch(text) {
  const mode = config.webSearchMode || 'manual';
  if (mode === 'off' || mode === 'agentic') return false;
  if (mode === 'always') return true;
  if (config.webSearchEnabled) return true;
  return mode === 'auto' && shouldAutoWebSearch(text);
}

// 'agentic' mode: instead of guessing from the message text and pre-fetching
// results (like manual/auto/always above), the model itself gets web_search
// and fetch_url as real tools on the request and decides mid-conversation
// whether it needs them — the same way the coding agent (kiconnect-agent.js)
// decides for itself whether to search. See runAgenticWebToolLoop() below.
function isAgenticWebMode() {
  return (config.webSearchMode || 'manual') === 'agentic';
}

// ── Agentic web search: tool definitions, execution, and the tool loop ──
// Same two tools kiconnect-agent.js offers its coding agent (web_search,
// fetch_url), just offered on the NORMAL chat request too when 'agentic'
// mode is on, so the model can decide for itself whether to look something
// up — instead of the manual/auto/always modes above, which decide BEFORE
// the model ever sees the message (a regex guess or a manual toggle).
const AGENTIC_WEB_TOOLS_ANTHROPIC = [
  {
    name: 'web_search',
    description: 'Searches the web via the search engine configured in KI Connect and returns title, URL, and a short snippet for each result. Use this whenever the answer may depend on information that could have changed after your training data, or that you are not fully certain about (current events, prices, versions, opening hours, someone\'s current role, etc.). Only search when it is actually needed — most questions do not need it.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'A short, specific search query.' } }, required: ['query'] },
  },
  {
    name: 'fetch_url',
    description: 'Fetches a single webpage (e.g. a URL the user pasted, or one returned by web_search) and returns its readable text content, so you can read it in more detail than a search snippet allows.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
];
const AGENTIC_WEB_TOOLS_OPENAI = AGENTIC_WEB_TOOLS_ANTHROPIC.map(tl => ({
  type: 'function', function: { name: tl.name, description: tl.description, parameters: tl.input_schema },
}));
// Hard cap on how many search/fetch round-trips a single reply may trigger —
// keeps a confused or looping model from stalling the chat indefinitely.
const AGENTIC_TOOL_MAX_ITERS = 4;

// Executes one agentic tool call and returns a tool_result object, reusing
// the same search/fetch functions as manual/auto modes and the coding agent.
async function runAgenticWebTool(name, args) {
  try {
    if (name === 'web_search') {
      const query = ((args && args.query) || '').toString();
      if (!query.trim()) return { error: 'missing query' };
      const data = await performWebSearch(query);
      if (!data || !data.results || !data.results.length) return { query, results: [], note: 'No results found.' };
      return { query: data.query, results: data.results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet || '' })) };
    }
    if (name === 'fetch_url') {
      const url = ((args && args.url) || '').toString();
      if (!/^https?:\/\//i.test(url)) return { error: 'invalid url' };
      const page = await fetchLinkedPage(url);
      return { title: page.title, url: page.url, text: (page.text || '').slice(0, 8000) };
    }
    return { error: `unknown tool: ${name}` };
  } catch (err) {
    return { error: (err && err.message) || String(err) };
  }
}

// Renders the tool calls made for one reply as collapsed <details> cards,
// prepended to the assistant's answer — reuses the "agent-trace" CSS class
// kiconnect-agent.js already injects, so this needs no styling of its own.
function buildAgenticTraceHtml(calls) {
  if (!calls || !calls.length) return '';
  return calls.map(c => {
    const icon = c.name === 'fetch_url' ? '🔗' : '🌐';
    const label = c.name === 'fetch_url' ? t('agent.tool.fetchUrl', 'Fetch webpage') : t('agent.tool.webSearch', 'Web search');
    const subject = c.name === 'fetch_url' ? (c.args?.url || '') : (c.args?.query || '');
    const isError = !!(c.result && c.result.error);
    const status = isError ? `${t('agent.errorShort', 'error')}: ${c.result.error}` : t('agent.done', 'done.');
    let body = '';
    if (c.name === 'web_search' && Array.isArray(c.result?.results) && c.result.results.length) {
      body = c.result.results.map(r => `- [${escHtml(r.title || r.url)}](${escHtml(r.url)})${r.snippet ? ' — ' + escHtml(r.snippet) : ''}`).join('\n');
    } else if (c.name === 'fetch_url' && c.result?.text) {
      body = escHtml(c.result.text.slice(0, 600)) + (c.result.text.length > 600 ? '…' : '');
    } else if (isError) {
      body = escHtml(c.result.error);
    }
    return `<details class="agent-trace" data-status="${isError ? 'error' : 'ok'}"><summary>${icon} <b>${escHtml(label)}</b>${subject ? ` <code>${escHtml(subject)}</code>` : ''} — <em>${escHtml(status)}</em></summary>\n\n${body || `_${t('js.empty', '(empty)')}_`}\n\n</details>`;
  }).join('\n\n');
}

// One non-streaming model turn with only the two web tools attached — a
// trimmed-down twin of kiconnect-agent.js's callModel(): same request
// shapes, but no file/shell tools and no confirmation UI, since this only
// ever runs the brief "does it need to search? / here are the results"
// back-and-forth. The reply the person actually sees is produced afterwards
// by the ordinary streaming call, once no more tool calls come back.
async function callModelForAgenticWebTurn(msgs, provider) {
  const { modelId } = splitModelId(config.model);
  if (provider.type === 'anthropic') {
    const body = { model: modelId, max_tokens: effectiveMaxTokens(), messages: msgs, tools: AGENTIC_WEB_TOOLS_ANTHROPIC, tool_choice: { type: 'auto' } };
    if (isTemperatureSupported(modelId)) body.temperature = config.temperature;
    if (config.systemPrompt) body.system = config.systemPrompt;
    const res = await fetch(proxyUrl('https://api.anthropic.com/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const content = data.content || [];
    const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const toolCalls = content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, arguments: b.input || {} }));
    return { text, toolCalls, rawContent: content };
  }
  // Every other provider speaks the OpenAI-compatible /chat/completions shape.
  const endpoint = getProviderEndpoint(provider);
  const apiMsgs = [];
  if (config.systemPrompt) apiMsgs.push({ role: 'system', content: config.systemPrompt });
  apiMsgs.push(...msgs);
  const isOSeries = /^o\d/.test(modelId) || /^(chatgpt-)?gpt-5/.test(modelId);
  const reqBody = { model: modelId, messages: apiMsgs, tools: AGENTIC_WEB_TOOLS_OPENAI, tool_choice: 'auto', stream: false };
  if (isOSeries) reqBody.max_completion_tokens = effectiveMaxTokens();
  else { reqBody.temperature = config.temperature; reqBody.max_tokens = effectiveMaxTokens(); }
  const extraHeaders = {};
  if (provider.type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
  if (provider.type === 'zhipu') extraHeaders['Accept-Language'] = 'en-US,en';
  const res = await fetch(proxyUrl(`${endpoint}/chat/completions`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) throw new Error('Invalid response from the model.');
  const toolCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map(tc => {
        let a = {}; try { a = JSON.parse(tc.function?.arguments || '{}'); } catch {}
        // See runAgenticWebToolLoop() below for why this is captured/echoed
        // — same Gemini thought_signature round-trip as the agent-mode fix.
        return { id: tc.id, name: tc.function?.name, arguments: a, _thoughtSig: tc.extra_content?.google?.thought_signature };
      })
    : [];
  const text = typeof msg.content === 'string' ? msg.content : '';
  return { text, toolCalls };
}

// Resolves the model↔tool back-and-forth for 'agentic' web-search mode
// before the visible reply is generated: repeatedly asks the model (non-
// streaming, silently) whether it wants to call web_search/fetch_url,
// executes whatever it calls, feeds the result back, and stops as soon as
// it answers with plain text instead of a tool call (or the iteration cap
// is hit). Returns the tool-augmented message history — ready to hand to
// the normal streaming call for the actual reply — plus an HTML trace of
// what was looked up, to prepend to that reply.
async function runAgenticWebToolLoop(initialMsgs, provider) {
  let msgs = initialMsgs.slice();
  const allCalls = [];
  for (let iter = 0; iter < AGENTIC_TOOL_MAX_ITERS; iter++) {
    let turn;
    try { turn = await callModelForAgenticWebTurn(msgs, provider); }
    catch (err) { break; } // give up on tool use for this reply; fall back to the plain streaming call below
    if (!turn.toolCalls.length) break;
    const results = [];
    for (const call of turn.toolCalls) {
      const subject = call.name === 'fetch_url' ? (call.arguments.url || '') : (call.arguments.query || '');
      toast(`🌐 ${call.name === 'fetch_url' ? t('agent.tool.fetchUrl', 'Fetch webpage') : t('agent.tool.webSearch', 'Web search')}: "${subject}"`);
      const result = await runAgenticWebTool(call.name, call.arguments);
      results.push(result);
      allCalls.push({ name: call.name, args: call.arguments, result });
    }
    if (provider.type === 'anthropic') {
      msgs.push({ role: 'assistant', content: turn.rawContent });
      msgs.push({ role: 'user', content: turn.toolCalls.map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(results[i]) })) });
    } else {
      msgs.push({
        role: 'assistant', content: turn.text || null,
        tool_calls: turn.toolCalls.map(c => ({
          id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          // Gemini 2.5+/3.x needs the thought_signature echoed back or the
          // next turn 400s. Same fix as kiconnect-agent.js's toOpenAIHistory().
          ...(c._thoughtSig ? { extra_content: { google: { thought_signature: c._thoughtSig } } } : {}),
        })),
      });
      turn.toolCalls.forEach((c, i) => msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(results[i]) }));
    }
  }
  return { msgs, traceHtml: buildAgenticTraceHtml(allCalls) };
}

// Strips formatting/noise from a message so it can be used as a plain web-search query.
function cleanSearchQuery(text) {
  return (text || '')
    .replace(/^(suche|recherchiere|search|research)\s+(nach|zu|for|about)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

const ENGINES_NEEDING_KEY = new Set(['brave','google','bing','mojeek','yandex','langsearch']);
// Returns whether the given search engine requires an API key.
function webEngineNeedsKey(engine) { return ENGINES_NEEDING_KEY.has(engine); }

// Shows/hides the web-search API key field depending on the selected engine.
function updateWebSearchKeyUI(engine) {
  const group  = document.getElementById('webSearchApiKeyGroup');
  const label  = document.getElementById('webSearchApiKeyLabel');
  const hint   = document.getElementById('webSearchApiKeyHint');
  const input  = document.getElementById('webSearchApiKey');
  if (!group) return;
  const noKey = !webEngineNeedsKey(engine) && engine !== 'searxng';
  group.style.display = noKey ? 'none' : 'block';
  const info = {
    brave:   { label: t('web.braveKey'),   hint: t('web.hintBrave'),   ph: 'BSA...' },
    google:  { label: t('web.googleKey'),  hint: t('web.hintGoogle'),  ph: 'AIza...::cx_...' },
    bing:    { label: t('web.bingKey'),    hint: t('web.hintBing'),    ph: 'Azure Cognitive Services key' },
    mojeek:  { label: t('web.mojeekKey'),  hint: t('web.hintMojeek'),  ph: 'Mojeek API key' },
    yandex:  { label: t('web.yandexKey'),  hint: t('web.hintYandex'),  ph: 'folderId::apiKey' },
    langsearch: { label: t('web.langsearchKey'), hint: t('web.hintLangsearch'), ph: 'LangSearch API key' },
    searxng: { label: t('web.searxngKey'), hint: t('web.hintSearxng'), ph: 'https://searx.be' },
  };
  const i = info[engine] || info.brave;
  if (label) label.textContent = i.label;
  if (hint)  hint.textContent  = i.hint;
  if (input) input.placeholder = i.ph;
}

// TTS providers that require an API key (everything except the free browser voice).
function ttsProviderNeedsKey(p) { return p === 'openai' || p === 'elevenlabs' || p === 'groq' || p === 'gemini' || p === 'gcloud'; }
// STT providers that require an API key (everything except the free browser STT).
function sttProviderNeedsKey(p) { return p === 'groq' || p === 'gemini'; }

// t() falls back to the raw key when a translation is missing, which isn't
// presentable UI text. ta() falls back to a real string instead — used for
// the new Audio keys, since kiconnect-languages-i18n.js is deliberately not
// touched in this change (real translations to be added separately later).
function ta(key, fallback) { const v = t(key); return v === key ? fallback : v; }

const AUDIO_PROVIDER_KEY_INFO = {
  openai:     { label: () => ta('audio.ttsKeyLabelOpenAI', 'OpenAI API key'),     hint: () => ta('audio.ttsHintOpenAI', 'tts-1 / tts-1-hd / gpt-4o-mini-tts. Usage-based pricing. Stored encrypted with your account data.'),     ph: 'sk-...' },
  elevenlabs: { label: () => ta('audio.ttsKeyLabelElevenLabs', 'ElevenLabs API key'), hint: () => ta('audio.ttsHintElevenLabs', 'Very natural voices, more expensive. Requires your own ElevenLabs account. Stored encrypted with your account data.'), ph: 'el_...' },
  groq:       { label: () => ta('audio.ttsKeyLabelGroq', 'Groq API key'),       hint: () => ta('audio.ttsHintGroq', 'Cheap, OpenAI-compatible. Stored encrypted with your account data.'),       ph: 'gsk_...' },
  gemini:     { label: () => ta('audio.ttsKeyLabelGemini', 'Google Gemini API key'), hint: () => ta('audio.ttsHintGemini', 'Free tier via Google AI Studio (rate-limited). Same key type as a Gemini chat provider. Stored encrypted with your account data.'), ph: 'AIza...' },
  gcloud:     { label: () => ta('audio.ttsKeyLabelGcloud', 'Google Cloud API key (Text-to-Speech)'), hint: () => ta('audio.ttsHintGcloud', 'Chirp 3: HD voices. Different from the Gemini key above — needs a Google Cloud project with the Text-to-Speech API enabled and a billing account attached (usage still free within the monthly quota). Stored encrypted with your account data.'), ph: 'AIza...' },
};

// STT-side equivalent of AUDIO_PROVIDER_KEY_INFO — kept separate because the
// STT key field previously had Groq's label/hint hardcoded inline; this map
// lets updateAudioProviderKeyUI() below treat STT providers generically too.
const AUDIO_STT_PROVIDER_KEY_INFO = {
  groq:   { label: () => ta('audio.sttKeyLabelGroq', 'Groq API key'),   hint: () => ta('audio.sttHintGroq', 'Cheap, good with dialects. No live interim text (no streaming) — a spinner is shown while recognizing instead. Stored encrypted with your account data.'),   ph: 'gsk_...' },
  gemini: { label: () => ta('audio.sttKeyLabelGemini', 'Google Gemini API key'), hint: () => ta('audio.sttHintGemini', 'Free tier via Google AI Studio (rate-limited). No live interim text (no streaming) — a spinner is shown while recognizing instead. Stored encrypted with your account data.'), ph: 'AIza...' },
};

// Shows/hides + relabels the TTS and STT API-key fields in the Audio tuning-panel
// section depending on the selected provider, and fills them with the (decrypted)
// value already stored in config.audioProviders. Same pattern as updateWebSearchKeyUI().
function updateAudioProviderKeyUI() {
  config.audioProviders = config.audioProviders || {};

  // ── TTS ──
  const ttsProvider  = document.getElementById('ttsProviderSelect')?.value || 'browser';
  const ttsGroup      = document.getElementById('ttsApiKeyGroup');
  const ttsLabel      = document.getElementById('ttsApiKeyLabel');
  const ttsHint       = document.getElementById('ttsApiKeyHint');
  const ttsInput      = document.getElementById('ttsApiKey');
  const voiceIdGroup  = document.getElementById('ttsVoiceIdGroup');
  const voiceIdInput  = document.getElementById('ttsVoiceId');
  if (ttsGroup) {
    const needsKey = ttsProviderNeedsKey(ttsProvider);
    ttsGroup.style.display = needsKey ? 'block' : 'none';
    if (needsKey) {
      const info = AUDIO_PROVIDER_KEY_INFO[ttsProvider];
      if (ttsLabel) ttsLabel.textContent = info.label();
      if (ttsHint)  ttsHint.textContent  = info.hint();
      if (ttsInput) ttsInput.placeholder = info.ph;
      if (ttsInput) ttsInput.value = config.audioProviders[ttsProvider]?.apiKey || '';
    }
  }
  if (voiceIdGroup) {
    voiceIdGroup.style.display = ttsProvider === 'elevenlabs' ? 'block' : 'none';
    if (voiceIdInput && ttsProvider === 'elevenlabs') voiceIdInput.value = config.audioProviders.elevenlabs?.voiceId || '';
  }

  // ── STT ──
  const sttProvider = document.getElementById('sttProviderSelect')?.value || 'browser';
  const sttGroup     = document.getElementById('sttApiKeyGroup');
  const sttLabel     = document.getElementById('sttApiKeyLabel');
  const sttHint      = document.getElementById('sttApiKeyHint');
  const sttInput     = document.getElementById('sttApiKey');
  if (sttGroup) {
    const needsKey = sttProviderNeedsKey(sttProvider);
    sttGroup.style.display = needsKey ? 'block' : 'none';
    if (needsKey) {
      const info = AUDIO_STT_PROVIDER_KEY_INFO[sttProvider];
      if (sttLabel) sttLabel.textContent = info.label();
      if (sttHint)  sttHint.textContent  = info.hint();
      if (sttInput) sttInput.placeholder = info.ph;
      if (sttInput) sttInput.value = config.audioProviders[sttProvider]?.apiKey || '';
    }
  }
}

// ── Tuning panel: generic collapse/expand for every top-level section ──
// Wraps each section (from .section-header to the next header or <hr
// class="divider">, divider left outside so it stays visible) into a
// .tuning-section div, adds a clickable arrow, and persists open/closed
// state in localStorage. Idempotent per panel. Works on any panel with
// this "section-header + hr.divider" structure via panelId+storagePrefix.
function initPanelSectionCollapse(panelId, storagePrefix) {
  const panel = document.getElementById(panelId);
  if (!panel || panel.dataset.collapseInit) return;
  panel.dataset.collapseInit = '1';

  const headers = Array.from(panel.querySelectorAll(':scope > .section-header'));
  headers.forEach(header => {
    const sectionId = (header.getAttribute('data-i18n') || header.textContent || '')
      .trim().replace(/\s+/g, '-').toLowerCase() || 'section';

    header.classList.add('tuning-collapsible');
    const arrow = document.createElement('span');
    arrow.className = 'tuning-section-arrow';
    arrow.textContent = '▸';
    header.insertBefore(arrow, header.firstChild);

    const wrapper = document.createElement('div');
    wrapper.className = 'tuning-section';
    wrapper.dataset.sectionId = sectionId;
    let node = header.nextSibling;
    const toMove = [];
    while (node && !(node.nodeType === 1 && (node.classList.contains('section-header') || (node.tagName === 'HR' && node.classList.contains('divider'))))) {
      toMove.push(node);
      node = node.nextSibling;
    }
    toMove.forEach(n => wrapper.appendChild(n));
    header.insertAdjacentElement('afterend', wrapper);

    const storeKey = storagePrefix + sectionId;
    const collapsed = localStorage.getItem(storeKey) === '1';
    if (collapsed) { wrapper.classList.add('collapsed'); header.classList.add('collapsed'); }

    header.addEventListener('click', () => {
      const nowCollapsed = wrapper.classList.toggle('collapsed');
      header.classList.toggle('collapsed', nowCollapsed);
      try { localStorage.setItem(storeKey, nowCollapsed ? '1' : '0'); } catch {}
    });
  });
}

function initTuningSectionCollapse() {
  initPanelSectionCollapse('tuningPanel', 'kic_tuning_collapsed_');
}

function initSettingsSectionCollapse() {
  initPanelSectionCollapse('settingsPanel', 'kic_settings_collapsed_');
}

const SEARXNG_PUBLIC_INSTANCES = [
  'https://searx.be','https://searxng.world','https://search.bus-hit.me',
  'https://searx.tiekoetter.com','https://search.sapti.me',
  'https://searx.prvcy.eu','https://searx.fmac.xyz','https://search.ononoki.org',
];

const WEB_SEARCH_LOCALES = {
  en: { ddg:'us-en', searx:'en-US', qwant:'en_US', startpage:'english', bing:'en-US', braveCountry:'US', braveLang:'en', googleLr:'lang_en', yandex:'en' },
  de: { ddg:'de-de', searx:'de-DE', qwant:'de_DE', startpage:'deutsch', bing:'de-DE', braveCountry:'DE', braveLang:'de', googleLr:'lang_de', yandex:'de' },
  fr: { ddg:'fr-fr', searx:'fr-FR', qwant:'fr_FR', startpage:'francais', bing:'fr-FR', braveCountry:'FR', braveLang:'fr', googleLr:'lang_fr', yandex:'fr' },
  es: { ddg:'es-es', searx:'es-ES', qwant:'es_ES', startpage:'espanol', bing:'es-ES', braveCountry:'ES', braveLang:'es', googleLr:'lang_es', yandex:'es' },
  it: { ddg:'it-it', searx:'it-IT', qwant:'it_IT', startpage:'italiano', bing:'it-IT', braveCountry:'IT', braveLang:'it', googleLr:'lang_it', yandex:'it' },
  tr: { ddg:'tr-tr', searx:'tr-TR', qwant:'en_US', startpage:'turkce', bing:'tr-TR', braveCountry:'TR', braveLang:'tr', googleLr:'lang_tr', yandex:'tr' },
  ru: { ddg:'ru-ru', searx:'ru-RU', qwant:'en_US', startpage:'russian', bing:'ru-RU', braveCountry:'RU', braveLang:'ru', googleLr:'lang_ru', yandex:'ru' },
  el: { ddg:'gr-el', searx:'el-GR', qwant:'en_US', startpage:'greek', bing:'el-GR', braveCountry:'GR', braveLang:'el', googleLr:'lang_el', yandex:'el' },
  zh: { ddg:'cn-zh', searx:'zh-CN', qwant:'en_US', startpage:'chinese', bing:'zh-CN', braveCountry:'CN', braveLang:'zh-hans', googleLr:'lang_zh-CN', yandex:'zh' },
  ar: { ddg:'xa-ar', searx:'ar-SA', qwant:'en_US', startpage:'arabic', bing:'ar-SA', braveCountry:'SA', braveLang:'ar', googleLr:'lang_ar', yandex:'ar' },
  hi: { ddg:'in-hi', searx:'hi-IN', qwant:'en_US', startpage:'hindi', bing:'hi-IN', braveCountry:'IN', braveLang:'hi', googleLr:'lang_hi', yandex:'hi' },
  ta: { ddg:'in-ta', searx:'ta-IN', qwant:'en_US', startpage:'tamil', bing:'ta-IN', braveCountry:'IN', braveLang:'ta', googleLr:'lang_ta', yandex:'en' },
  bn: { ddg:'in-bn', searx:'bn-IN', qwant:'en_US', startpage:'bengali', bing:'bn-IN', braveCountry:'IN', braveLang:'bn', googleLr:'lang_bn', yandex:'en' },
  pa: { ddg:'in-pa', searx:'pa-IN', qwant:'en_US', startpage:'punjabi', bing:'pa-IN', braveCountry:'IN', braveLang:'pa', googleLr:'lang_pa', yandex:'en' },
  ur: { ddg:'pk-ur', searx:'ur-PK', qwant:'en_US', startpage:'urdu', bing:'ur-PK', braveCountry:'PK', braveLang:'ur', googleLr:'lang_ur', yandex:'en' },
};

// Returns the locale string to bias web-search results with, derived from the current UI language.
function getWebSearchLocale() {
  return WEB_SEARCH_LOCALES[currentLang] || WEB_SEARCH_LOCALES.en;
}

// Builds an Accept-Language header value from the current UI language.
function getAcceptLanguage() {
  const primary = getWebSearchLocale().searx || 'en-US';
  const short = primary.split('-')[0];
  return `${primary},${short};q=0.9,en;q=0.7`;
}

// Returns a headers object with Accept-Language added, merged with any extra headers passed in.
function localizedHeaders(extra = {}) {
  return { 'Accept-Language': getAcceptLanguage(), ...extra };
}

// Performs a proxied (API-key) fetch with an abort timeout.
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(proxyUrl(url), { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Performs a proxied public (no API key) fetch with an abort timeout, used for search/page fetching.
async function fetchPublicWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(proxyPublicUrl(url), { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Resolves a search-result link (which may be relative or a redirect wrapper) to a clean absolute URL.
function normalizeSearchUrl(href, base) {
  if (!href) return '';
  try {
    let u = new URL(href, base);
    let raw = u.searchParams.get('uddg') || u.searchParams.get('u') || u.searchParams.get('url');
    if (!raw && /\/RU=/.test(u.pathname)) {
      raw = decodeURIComponent((u.pathname.match(/\/RU=([^/]+)/) || [])[1] || '');
    }
    if (raw) u = new URL(raw);
    if (!/^https?:$/i.test(u.protocol)) return '';
    return u.href;
  } catch {
    return '';
  }
}

// Deduplicates a list of search results by URL and caps it at the requested count.
function uniqueSearchResults(results, count) {
  const seen = new Set();
  return (results || []).filter(r => {
    const url = normalizeSearchUrl(r.url);
    if (!r.title || !url || seen.has(url)) return false;
    seen.add(url);
    r.url = url;
    r.title = r.title.replace(/\s+/g, ' ').trim();
    r.snippet = (r.snippet || '').replace(/\s+/g, ' ').trim();
    return true;
  }).slice(0, count).map((r, i) => ({ ...r, index: i + 1 }));
}

// Extracts title/url/snippet search results from DuckDuckGo's HTML results page.
function parseDuckDuckGoHtml(html, count, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let results = [...doc.querySelectorAll('a.result-link')].map(a => {
    const row = a.closest('tr');
    const snippet = row?.nextElementSibling?.querySelector('.result-snippet') ||
                    row?.parentElement?.querySelector('.result-snippet');
    return {
      title: a.textContent || '',
      url: normalizeSearchUrl(a.getAttribute('href') || a.href, base),
      snippet: snippet?.textContent || '',
    };
  });
  if (!results.length) {
    results = [...doc.querySelectorAll('.result')].map(el => {
      const link = el.querySelector('.result__a');
      const snip = el.querySelector('.result__snippet');
      return {
        title: link?.textContent || '',
        url: normalizeSearchUrl(link?.getAttribute('href') || link?.href || '', base),
        snippet: snip?.textContent || '',
      };
    });
  }
  return uniqueSearchResults(results, count);
}

// Runs a web search against DuckDuckGo's HTML endpoint (no API key required).
async function searchDuckDuckGo(q, count) {
  const locale = getWebSearchLocale();
  const headers = localizedHeaders({ 'Accept': 'text/html', 'HTTP-Referer': 'https://duckduckgo.com/' });
  const urls = [
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}&kl=${encodeURIComponent(locale.ddg)}`,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=${encodeURIComponent(locale.ddg)}`,
  ];
  for (const url of urls) {
    const res = await fetchWithTimeout(url, { headers }, 10000);
    if (!res.ok) throw new Error(`DuckDuckGo ${res.status}: ${await res.text()}`);
    const results = parseDuckDuckGoHtml(await res.text(), count, url);
    if (results.length) return results;
  }
  return [];
}

// Runs a web search against a SearXNG instance. Uses fetchPublicWithTimeout (scheme-only
// check) rather than fetchWithTimeout (fixed ALLOWED_API_DOMAINS check), since this is the
// one engine where the "key" field is actually a free-form self-hosted instance URL - a
// fixed domain allowlist would silently block any instance that isn't one of the built-in
// public ones below.
async function searchSearxng(q, count, instanceUrl = '') {
  const locale = getWebSearchLocale();
  const instances = instanceUrl ? [instanceUrl.replace(/\/$/, '')] : SEARXNG_PUBLIC_INSTANCES;
  let lastError = null;
  for (const instance of instances.sort(() => Math.random() - 0.5)) {
    try {
      for (const language of [locale.searx, 'all']) {
        const collected = [];
        for (let page = 1; page <= Math.ceil(count / 10) && collected.length < count; page++) {
          const url = `${instance}/search?q=${encodeURIComponent(q)}&format=json&categories=general&pageno=${page}&language=${encodeURIComponent(language)}`;
          const res = await fetchPublicWithTimeout(url, { headers: localizedHeaders({ 'Accept': 'application/json' }) }, 10000);
          if (!res.ok) throw new Error(`SearXNG ${res.status}: ${await res.text()}`);
          const data = await res.json();
          collected.push(...(data.results || []).map(r => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.content || r.description || '',
          })));
        }
        const results = uniqueSearchResults(collected, count);
        if (results.length) return results;
      }
    } catch (e) {
      lastError = e;
      console.warn('[web-search] SearXNG failed:', instance, e.message || e);
    }
  }
  if (lastError) throw lastError;
  return [];
}

// Runs a web search against Qwant.
async function searchQwant(q, count) {
  const locale = getWebSearchLocale();
  const url = `https://api.qwant.com/v3/search/web?q=${encodeURIComponent(q)}&count=${count}&locale=${encodeURIComponent(locale.qwant)}&offset=0&device=desktop&safesearch=1`;
  const res = await fetchWithTimeout(url, { headers: localizedHeaders({ 'Accept': 'application/json', 'HTTP-Referer': 'https://www.qwant.com/', 'Origin': 'https://www.qwant.com' }) }, 10000);
  if (!res.ok) throw new Error(`Qwant ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const items = data?.data?.result?.items || data?.data?.items || [];
  const flat = [];
  const walk = value => {
    if (!value || flat.length >= count * 3) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === 'object') {
      if ((value.url || value.link) && (value.title || value.name)) flat.push(value);
      Object.keys(value).forEach(k => {
        if (['items','mainline','webPages'].includes(k)) walk(value[k]);
      });
    }
  };
  walk(items);
  return uniqueSearchResults(flat.map(r => ({
    title: r.title || r.name || '',
    url: r.url || r.link || '',
    snippet: r.desc || r.description || r.snippet || '',
  })), count);
}

// Runs a web search against Yahoo.
async function searchYahoo(q, count) {
  const url = `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, { headers: localizedHeaders({ 'Accept': 'text/html', 'HTTP-Referer': 'https://search.yahoo.com/' }) }, 10000);
  if (!res.ok) throw new Error(`Yahoo ${res.status}: ${await res.text()}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const results = [...doc.querySelectorAll('a')].map(a => {
    const title = (a.querySelector('h3')?.textContent || a.textContent || '').trim();
    return {
      title,
      url: normalizeSearchUrl(a.getAttribute('href') || a.href, url),
      snippet: a.closest('div')?.querySelector('.compText, .fc-falcon, p')?.textContent || '',
    };
  }).filter(r => r.title.length > 8);
  return uniqueSearchResults(results, count);
}

// Runs a web search against Startpage.
async function searchStartpage(q, count) {
  const locale = getWebSearchLocale();
  const url = `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}&language=${encodeURIComponent(locale.startpage)}`;
  const res = await fetchWithTimeout(url, { headers: localizedHeaders({ 'Accept': 'text/html', 'HTTP-Referer': 'https://www.startpage.com/' }) }, 10000);
  if (!res.ok) throw new Error(`Startpage ${res.status}: ${await res.text()}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const results = [...doc.querySelectorAll('a[href]')].map(a => ({
    title: a.textContent || '',
    url: normalizeSearchUrl(a.getAttribute('href') || a.href, url),
    snippet: a.closest('article, .w-gl__result, .result')?.textContent || '',
  })).filter(r => r.title.trim().length > 12);
  return uniqueSearchResults(results, count);
}

// Tries the free (no-API-key) search engines in order until one returns results.
async function searchFreeFallback(q, count) {
  const engines = [
    ['DuckDuckGo', () => searchDuckDuckGo(q, count)],
    ['Startpage', () => searchStartpage(q, count)],
    ['SearXNG', () => searchSearxng(q, count)],
  ];
  const errors = [];
  const combined = [];
  for (const [name, run] of engines) {
    try {
      const results = await run();
      combined.push(...results);
      const unique = uniqueSearchResults(combined, count);
      if (unique.length >= count) return unique;
    } catch (e) {
      errors.push(`${name}: ${e.message || e}`);
      console.warn('[web-search] free engine failed:', name, e.message || e);
    }
  }
  const unique = uniqueSearchResults(combined, count);
  if (unique.length) return unique;
  if (errors.length) throw new Error(errors.join(' | '));
  return [];
}

// Tops up a partial search-result list with results from the free fallback engines, skipping an already-tried engine.
async function fillWithFreeFallback(q, count, initialResults, excludedEngine = '') {
  let combined = [...(initialResults || [])];
  if (uniqueSearchResults(combined, count).length >= count) return uniqueSearchResults(combined, count);
  const engines = [
    ['duckduckgo', () => searchDuckDuckGo(q, count)],
    ['startpage', () => searchStartpage(q, count)],
    ['searxng', () => searchSearxng(q, count)],
  ].filter(([name]) => name !== excludedEngine);
  for (const [, run] of engines) {
    try {
      combined.push(...await run());
      const unique = uniqueSearchResults(combined, count);
      if (unique.length >= count) return unique;
    } catch (e) {
      console.warn('[web-search] fill fallback failed:', e.message || e);
    }
  }
  return uniqueSearchResults(combined, count);
}

// Runs a web search with the configured engine (falling back to free engines on failure/empty results) and returns formatted results.
async function performWebSearch(query) {
  const engine = config.webSearchEngine || 'free';
  const key = (config.webSearchApiKey || '').trim();
  if (webEngineNeedsKey(engine) && !key) {
    openSettings();
    throw new Error(t('web.noKey'));
  }
  const locale = getWebSearchLocale();
  const count = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(config.webSearchResultCount) || 8));
  const q = cleanSearchQuery(query);
  if (!q) return null;
  const cacheKey = `${engine}:${count}:${q.toLowerCase()}`;
  const cached = webSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 30 * 60 * 1000) return cached.value;

  // The button's "searching…" state is reset here, in a finally around the
  // ENTIRE search (not just by whichever caller happens to await this) —
  // previously only the normal chat send path reset it after catching an
  // error; the agent mode's web_search tool calls performWebSearch()
  // directly with no equivalent reset, so an agent web search (or any
  // engine throwing before returning) left the Web button stuck showing
  // "..." until the next unrelated call happened to reset it.
  updateWebSearchButton(true);
  try {
    return await performWebSearchInner(engine, key, locale, count, q, cacheKey);
  } finally {
    updateWebSearchButton(false);
  }
}
async function performWebSearchInner(engine, key, locale, count, q, cacheKey) {
  let results = [];

  if (engine === 'brave') {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}&text_decorations=false&safesearch=moderate&country=${encodeURIComponent(locale.braveCountry)}&search_lang=${encodeURIComponent(locale.braveLang)}&ui_lang=${encodeURIComponent(locale.searx)}`;
    const res = await fetch(proxyUrl(url), {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': key },
    });
    if (!res.ok) throw new Error(`Brave Search ${res.status}: ${await res.text()}`);
    const data = await res.json();
    results = (data.web?.results || []).slice(0, count).map((r, i) => ({
      index: i + 1,
      title: (r.title || r.url || '').replace(/\s+/g, ' ').trim(),
      url: r.url || '',
      snippet: (r.description || '').replace(/\s+/g, ' ').trim(),
    })).filter(r => r.title && r.url);

  } else if (engine === 'google') {
    const [gkey, cx] = key.split('::');
    if (!gkey || !cx) throw new Error(t('web.googleKeyFormat'));
    const googleItems = [];
    for (let start = 1; start <= count && googleItems.length < count; start += 10) {
      const googleCount = Math.min(10, count - googleItems.length);
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(gkey.trim())}&cx=${encodeURIComponent(cx.trim())}&q=${encodeURIComponent(q)}&num=${googleCount}&start=${start}&lr=${encodeURIComponent(locale.googleLr)}`;
      const res = await fetch(proxyUrl(url));
      if (!res.ok) throw new Error(`Google ${res.status}: ${await res.text()}`);
      const data = await res.json();
      googleItems.push(...(data.items || []));
      if (!data.items?.length) break;
    }
    results = googleItems.slice(0, count).map((r, i) => ({
      index: i + 1,
      title: (r.title || '').replace(/\s+/g, ' ').trim(),
      url: r.link || '',
      snippet: (r.snippet || '').replace(/\s+/g, ' ').trim(),
    })).filter(r => r.title && r.url);

  } else if (engine === 'bing') {
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&count=${count}&mkt=${encodeURIComponent(locale.bing)}&safeSearch=Moderate`;
    const res = await fetch(proxyUrl(url), {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Bing ${res.status}: ${await res.text()}`);
    const data = await res.json();
    results = (data.webPages?.value || []).slice(0, count).map((r, i) => ({
      index: i + 1,
      title: (r.name || '').replace(/\s+/g, ' ').trim(),
      url: r.url || '',
      snippet: (r.snippet || '').replace(/\s+/g, ' ').trim(),
    })).filter(r => r.title && r.url);

  } else if (engine === 'mojeek') {
    const url = `https://api.mojeek.com/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&t=${count}&fmt=json`;
    const res = await fetch(proxyUrl(url), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Mojeek ${res.status}: ${await res.text()}`);
    const data = await res.json();
    results = (data.results || []).slice(0, count).map((r, i) => ({
      index: i + 1,
      title: (r.title || '').replace(/\s+/g, ' ').trim(),
      url: r.url || '',
      snippet: (r.desc || '').replace(/\s+/g, ' ').trim(),
    })).filter(r => r.title && r.url);

  } else if (engine === 'yandex') {
    const parts = key.split('::');
    const folderId = parts[0]?.trim();
    const ykey = parts[1]?.trim();
    if (!folderId || !ykey) throw new Error(t('web.yandexKeyFormat'));
    const url = `https://yandex.com/search/xml?folderid=${encodeURIComponent(folderId)}&apikey=${encodeURIComponent(ykey)}&query=${encodeURIComponent(q)}&results=${count}&lang=${encodeURIComponent(locale.yandex)}`;
    const res = await fetch(proxyUrl(url), { headers: { 'Accept': 'application/xml' } });
    if (!res.ok) throw new Error(`Yandex ${res.status}: ${await res.text()}`);
    const xml = await res.text();
    const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
    results = [...xmlDoc.querySelectorAll('doc')].slice(0, count).map((d, i) => ({
      index: i + 1,
      title: (d.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim(),
      url: (d.querySelector('url')?.textContent || '').trim(),
      snippet: (d.querySelector('headline, passage')?.textContent || '').replace(/\s+/g, ' ').trim(),
    })).filter(r => r.title && /^https?:\/\//i.test(r.url));

  } else if (engine === 'langsearch') {
    const url = 'https://api.langsearch.com/v1/web-search';
    const res = await fetch(proxyUrl(url), {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ query: q, freshness: 'noLimit', summary: false, count: Math.min(count, 10) }),
    });
    if (!res.ok) throw new Error(`LangSearch ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const items = data.data?.webPages?.value || [];
    results = items.slice(0, count).map((r, i) => ({
      index: i + 1,
      title: (r.name || '').replace(/\s+/g, ' ').trim(),
      url: r.url || '',
      snippet: (r.snippet || r.summary || '').replace(/\s+/g, ' ').trim(),
    })).filter(r => r.title && r.url);

  } else if (engine === 'qwant') {
    try {
      results = await searchQwant(q, count);
    } catch (e) {
      console.warn('[web-search] Qwant failed, falling back:', e.message || e);
      results = await searchFreeFallback(q, count);
    }

  } else if (engine === 'yahoo') {
    try {
      results = await searchYahoo(q, count);
    } catch (e) {
      console.warn('[web-search] Yahoo failed, falling back:', e.message || e);
      results = await searchFreeFallback(q, count);
    }

  } else if (engine === 'startpage') {
    results = await searchStartpage(q, count);

  } else if (engine === 'searxng') {
    results = await searchSearxng(q, count, (key && /^https?:\/\//i.test(key)) ? key : '');

  } else if (engine === 'duckduckgo') {
    results = await searchDuckDuckGo(q, count);

  } else {
    results = await searchFreeFallback(q, count);
  }

  if (!results.length && ['searxng','qwant','yahoo'].includes(engine)) {
    console.warn('[web-search] selected engine returned no results, trying free fallback:', engine);
    results = await searchFreeFallback(q, count);
  }
  if (results.length < count && ['free','duckduckgo','startpage','searxng','qwant','yahoo'].includes(engine)) {
    results = await fillWithFreeFallback(q, count, results, engine === 'free' ? '' : engine);
  }

  const value = { query: q, results };
  webSearchCache.set(cacheKey, { time: Date.now(), value });
  return value;
}

// Formats web-search results into the text block appended to the model's context.
function formatWebSearchBlock(search) {
  if (!search?.results?.length) return '';
  const lines = [
    `[Web search results for: "${search.query}"]`,
    t('web.modelInstruction'),
    '',
  ];
  search.results.forEach(r => {
    lines.push(`[${r.index}] ${r.title}`);
    lines.push(`URL: ${r.url}`);
    if (r.snippet) lines.push(`Snippet: ${r.snippet}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

// Prepends a formatted web-search block to a message's content before sending it to the model.
function buildWebAugmentedContent(originalContent, search) {
  const block = formatWebSearchBlock(search);
  if (!block) return originalContent;
  const webPart = { type: 'text', text: `${block}\n\n---\n\nUser question:`, _webSearch: true };
  if (Array.isArray(originalContent)) return [webPart, ...originalContent];
  return [webPart, { type: 'text', text: originalContent || '' }];
}

// Extracts all http(s) URLs found in a text string.
function extractHttpUrls(text) {
  const matches = (text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return [...new Set(matches.map(u => u.replace(/[.,;:!?]+$/g, '')))].slice(0, 3);
}

// Removes quoted (>) lines and fenced code blocks from text before scanning it for links (avoids picking up example/quoted URLs).
function stripQuotedAndCodeBlocks(text) {
  let inFence = false;
  return (text || '').split(/\r?\n/).map(line => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return ''; }
    if (inFence || /^\s*>/.test(line)) return '';
    return line;
  }).join('\n');
}

// Extracts http(s) URLs from the readable (non-quoted, non-code) parts of a text.
function extractReadableHttpUrls(text) {
  return extractHttpUrls(stripQuotedAndCodeBlocks(text));
}

// Returns the URLs the user has selected (not ignored) from the detected-links popover.
function getSelectedReadableUrls() {
  const input = document.getElementById('messageInput');
  const urls = extractReadableHttpUrls(input?.value || '');
  return urls.filter(url => selectedLinkUrls.has(url));
}

// Extracts a cleaned, readable text approximation from a fetched HTML document.
function readablePageText(doc) {
  doc.querySelectorAll('script,style,noscript,svg,nav,footer,header,form,aside').forEach(el => el.remove());
  const main = doc.querySelector('main, article, [role="main"]') || doc.body || doc;
  return (main.textContent || '').replace(/\s+/g, ' ').trim();
}

// Fetches a URL and extracts readable text from it, for inclusion in the model's context.
async function fetchLinkedPage(url) {
  const res = await fetchPublicWithTimeout(url, {
    headers: localizedHeaders({ 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' }),
  }, 12000);
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  const len = parseInt(res.headers.get('content-length') || '0');
  if (len > 2 * 1024 * 1024) throw new Error(`${new URL(url).hostname} response too large`);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const raw = await res.text();
  let title = url, text = raw;
  if (contentType.includes('html') || /^\s*<!doctype html|<html[\s>]/i.test(raw)) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    title = doc.querySelector('meta[property="og:title"]')?.content || doc.querySelector('title')?.textContent || url;
    text = readablePageText(doc);
  }
  return { title: title.replace(/\s+/g, ' ').trim().slice(0, 240), url, text: text.slice(0, 12000) };
}

// Fetches and extracts readable text for every (selected) link found in a text.
async function fetchLinkedPagesFromText(text, urls = null) {
  const pages = [];
  for (const url of (urls || extractReadableHttpUrls(text))) {
    try {
      const page = await fetchLinkedPage(url);
      if (page.text) pages.push(page);
    } catch (e) {
      console.warn('[web-link] fetch failed:', url, e.message || e);
    }
  }
  return pages;
}

// Formats fetched page contents into the text block appended to the model's context.
function formatLinkedPagesBlock(pages) {
  if (!pages?.length) return '';
  const lines = [
    '[Linked page content]',
    'The user included URL(s). Use the fetched page text as external context. Cite linked pages with [L1], [L2], etc. when relevant, and say when the fetched text is insufficient.',
    '',
  ];
  pages.forEach((p, i) => {
    lines.push(`[L${i + 1}] ${p.title || p.url}`);
    lines.push(`URL: ${p.url}`);
    lines.push(`Content excerpt: ${p.text}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

// Prepends a formatted linked-pages block to a message's content before sending it to the model.
function buildLinkedPageAugmentedContent(originalContent, pages) {
  const block = formatLinkedPagesBlock(pages);
  if (!block) return originalContent;
  const linkPart = { type: 'text', text: `${block}\n\n---\n\nUser question:`, _webSearch: true };
  if (Array.isArray(originalContent)) return [linkPart, ...originalContent];
  return [linkPart, { type: 'text', text: originalContent || '' }];
}

// Entry point for sending the current draft message: validates state and delegates to sendMessageCore.
async function sendMessage() {
  // Only blocks sending in THIS chat while THIS chat already has a run
  // going — a different chat streaming in the background no longer blocks
  // sending here (that's the whole point of parallel streaming).
  if(isChatStreaming(currentChatId)) return;
  const input=document.getElementById('messageInput');
  const text=input.value.trim();
  if(!text&&!attachments.length) return;

  // Battle-Modus: if the composer's battle toggle is active with >=2
  // models picked, fan out to sendBattleMessage() instead of the normal
  // single-model path. Deliberately skips the web-search/KB checks below
  // (out of scope for Battle-Modus, see sendBattleMessage's doc comment).
  if (battleModeActive && battleSelectedModels.length >= 2) {
    const att0=[...attachments];
    input.value=''; autoResize(input); clearAttachments();
    await sendBattleMessage(text, att0, [...battleSelectedModels]);
    return;
  }

  if(!config.model){toast(t('js.noModel'));return;}
  const provider=providerForModel(config.model)||providers[0];
  if(!provider){toast(t('js.noProvider'));openProviderPanel();return;}
  if(!provider.apiKey){toast(t('js.noApiKey'));openProviderPanel();return;}
  if(provider.enabled===false){toast(t('js.providerDisabledToast'));openProviderPanel();return;}
  if ((shouldUseWebSearch(text) || isAgenticWebMode()) && webEngineNeedsKey(config.webSearchEngine || 'free') && !(config.webSearchApiKey || '').trim()) {
    toast(t('web.noKey'));
    openSettings();
    return;
  }
  const att=[...attachments];
  input.value=''; autoResize(input); clearAttachments();
  await sendMessageCore(text, att);
}

// Turns pending attachments (+ typed text) into the internal storage/wire content-block
// format (image_url / pdf_base64 / pdf_text / text-file text blocks), and the flat list of
// file names shown as chips. Shared by normal chat (sendMessageCore) and the project/agent
// module (kiconnect-agent.js's runAgentChatTurn) so attaching files works identically in both —
// see buildAttachmentContent() call sites for the two places this feeds into.
function buildAttachmentContent(text, att) {
  let userContent;
  const fileNames = [];
  if (att.length) {
    userContent = [];
    if (text) userContent.push({ type: 'text', text });
    att.forEach(a => {
      if (a.type === 'image') userContent.push({ type: 'image_url', image_url: { url: a.data } });
      else if (a.type === 'pdf-b64') {
        fileNames.push(a.name);
        if (a._uploadedId) {}
        else if (a.pdfMode === 'text') { const txt = a.extractedText || t('js.noText'); userContent.push({ type: 'pdf_text', name: a.name, text: txt }); }
        else { const b64 = (a.data || '').split(',')[1] || a.data; userContent.push({ type: 'pdf_base64', name: a.name, data: b64 }); }
      } else if (a.type === 'text-file') {
        fileNames.push(a.name);
        // _fromHistory: content already in AI context, skip re-injection to avoid duplication
        if (!a._fromHistory) userContent.push({ type: 'text', text: `${tf('js.fileContent', { name: a.name })}\n${a.content}\n${t('js.fileEnd')}` });
      } else if (a.type === '_chip_only') {
        // Chip-only placeholder (e.g. PDF from history whose binary is gone): show chip, no content
        fileNames.push(a.name);
      } else {
        fileNames.push(a.name);
        userContent.push({ type: 'text', text: `[${tf('js.unreadableFormat', { name: a.name })}]` });
      }
    });
    if (userContent.length === 0 && text) userContent = text;
  } else { userContent = text; }
  return { userContent, fileNames };
}

// Builds the outgoing message (with attachments, web search and linked-page augmentation), renders the user bubble, and starts the AI response stream.
async function sendMessageCore(text, att) {
  if(!currentChatId) newChat();
  const empty=document.getElementById('emptyState');
  if(empty) empty.style.display='none';
  const provider=providerForModel(config.model)||providers[0];
  const isKiConnect=provider?.type==='kiconnect-nrw'||(provider?.type==='openai-compat'&&(provider.serverUrl||'').includes('kiconnect.nrw'));
  const documentIds=[];
  let webSearch = null;
  let linkedPages = [];
  const fileNames0 = att.map(a=>a.name);

  // ── Instant render: show the user's bubble immediately, before any
  // network round-trip (uploads / link fetch / web search). Those steps
  // can take a second or more and used to leave the chat looking "stuck"
  // until they finished. We build a minimal preview (text + images, files
  // as chips) and push it into the chat tree right away; the full, possibly
  // web-augmented content is written into this same message object afterwards
  // — it never needs to touch the DOM again, since the bubble only ever
  // displayed the text/image parts anyway.
  const previewContent = (() => {
    if (att.length) {
      const arr=[];
      if(text) arr.push({type:'text',text});
      att.forEach(a=>{ if(a.type==='image') arr.push({type:'image_url',image_url:{url:a.data}}); });
      return arr.length ? arr : (text || null);
    }
    return text;
  })();
  const chatEarly=currentChat();
  const activeContainerEarly = getActiveContainer(chatEarly);
  const userMsgForStorage={ role:'user', content: previewContent, _files: fileNames0.length?fileNames0:undefined };
  activeContainerEarly.push(userMsgForStorage);
  if(chatEarly.messages.length===1){chatEarly.title='…';renderSidebar();autoGenerateChatTitle(chatEarly,text);}
  const previewIdx=getActivePath(chatEarly).length-1;
  const previewMsgEl=buildMsgEl({role:'user',content:previewContent,_files:fileNames0},previewIdx);
  appendToMessages(previewMsgEl);
  typesetMath(previewMsgEl);
  scrollToBottom();

  for(const a of att){
    if(a.type==='pdf-b64'&&a.pdfMode==='b64'&&isKiConnect&&a.rawBuf){
      try{
        toast(`⏳ ${a.name} ${t('js.uploading')}`);
        const form=new FormData();
        form.append('file',new Blob([a.rawBuf],{type:'application/pdf'}),a.name);
        const endpoint=getProviderEndpoint(provider).replace('/api/v1','');
        const res=await fetch(proxyUrl(`${endpoint}/app/documents`),{method:'POST',headers:{'Authorization':`Bearer ${provider.apiKey}`},body:form});
        if(res.status===409){try{const doc=await res.json();const docId=doc.id||doc.documentId||doc._id||doc.document_id;if(docId){documentIds.push(docId);a._uploadedId=docId;}}catch{}toast(tf('js.alreadyPresent',{name:a.name}));}
        else if(!res.ok)throw new Error(`HTTP ${res.status}`);
        else{const doc=await res.json();const docId=doc.id||doc.documentId||doc._id||doc.document_id;if(docId){documentIds.push(docId);a._uploadedId=docId;}toast(`✅ ${a.name} ${t('js.uploaded')}`);}
      }catch(err){toast(tf('js.uploadFailed',{e:err.message}));renderAttachments();return;}
    }
  }

  // Build userContent: text first, then non-file attachments (images)
  // Text-files and PDFs go as file chips only — their content is injected separately
  const {userContent:_uc,fileNames:_fn}=buildAttachmentContent(text,att);
  let userContent=_uc;
  const fileNames=_fn;

  const readableUrls = extractReadableHttpUrls(text);
  const selectedReadableUrls = config.webLinkEnabled
    ? readableUrls.filter(url => selectedLinkUrls.has(url) || selectedLinkUrls.size === 0)
    : [];
  linkedPages = selectedReadableUrls.length ? await fetchLinkedPagesFromText(text, selectedReadableUrls) : [];
  if (linkedPages.length) {
    userContent = buildLinkedPageAugmentedContent(userContent, linkedPages);
  }

  if (!isAgenticWebMode() && shouldUseWebSearch(text)) {
    try {
      toast(t('web.searching'));
      webSearch = await performWebSearch(text);
      if (webSearch?.results?.length) {
        userContent = buildWebAugmentedContent(userContent, webSearch);
        toast(tf('web.resultsFound', { n: webSearch.results.length }));
      } else {
        toast(t('web.noResults'));
      }
    } catch (err) {
      toast(tf('web.failed', { e: err.message || err }));
      webSearch = null;
    } finally {
      if ((config.webSearchMode || 'manual') === 'manual') config.webSearchEnabled = false;
      updateWebSearchButton(false);
      save();
    }
  }

  // Knowledge-base retrieval ("Wissensbasis" / RAG) — kiconnect-db.js
  // exposes window.kbRetrieveForQuery() only when at least one knowledge
  // base is toggled on in the composer; everything else here is a no-op
  // for chats that don't use it, same defer-to-optional-global pattern as
  // the agent module. See kiconnect-rag-spec.md section 5.4.
  let kbResult = null;
  let kbWasRequested = false;
  if (text && typeof window.kbRetrieveForQuery === 'function') {
    kbWasRequested = true;
    try {
      kbResult = await window.kbRetrieveForQuery(text);
      if (kbResult?.sources?.length) {
        userContent = window.buildKbAugmentedContent(userContent, kbResult);
      }
    } catch (err) {
      toast(tf('js.kbSearchFailed', { e: err.message || err }) || `⚠️ Wissensbasis-Suche fehlgeschlagen: ${err.message || err}`);
      kbResult = null;
    }
  }

  const maxBytes=getMaxImageStorageBytes();
  // preserve pdf_base64 blocks and store text-mode PDFs
  // as {type:'pdf_text'} with name+text, so rerun/edit can restore them language-independently.
  const webSourceChips = [
    ...(linkedPages || []).map((p, i) => ({ index:`L${i + 1}`, title:p.title || p.url, url:p.url, snippet:p.text?.slice(0, 280) || '' })),
    ...(webSearch?.results || [])
  ];
  // The user's bubble is already on screen (instant preview from above).
  // Now backfill the SAME message object with the fully augmented content
  // (web search results, linked pages, resolved file blocks) — this is what
  // actually gets sent to the model and saved, but it doesn't need to touch
  // the DOM again for the text/image parts, since those already rendered.
  userMsgForStorage.content = Array.isArray(userContent)
    ? userContent.map(p=>{
        if(p._webSearch) return p;
        // pdf_base64: keep — _toAnthropicContent converts to {type:'document'} on send
        if(p.type==='pdf_base64') return p;
        // text-mode PDF content block: convert to structured {type:'pdf_text'} for storage
        if(p.type==='pdf_text') return p;
        if(p.type==='image_url'){const url=p.image_url?.url||'';if(url.startsWith('data:')&&url.length>maxBytes)return{type:'text',text:'['+t('js.imageNotSaved')+']'};}
        return p;
      })
    : userContent;
  userMsgForStorage._files = fileNames.length?fileNames:undefined;
  userMsgForStorage._webSources = webSourceChips.length?webSourceChips:undefined;
  const kbSourceChips = kbResult?.sources || [];
  userMsgForStorage._kbSources = kbSourceChips.length?kbSourceChips:undefined;
  const chat=currentChat();

  // Only the web-source chip row is new visual info the preview couldn't have
  // shown yet (it depends on the search that just finished) — patch just that
  // one row into the already-rendered bubble instead of rebuilding the whole
  // message (which would re-typeset text/math that's already on screen).
  if (webSourceChips.length) {
    const bubbleEl = previewMsgEl.querySelector('.bubble');
    if (bubbleEl && !bubbleEl.querySelector('.web-sources')) {
      bubbleEl.appendChild(buildWebSourcesRow(webSourceChips));
    }
  }
  // Same idea for knowledge-base sources (see kiconnect-db.js: buildKbSourcesRow).
  if (kbSourceChips.length && typeof buildKbSourcesRow === 'function') {
    const bubbleEl = previewMsgEl.querySelector('.bubble');
    if (bubbleEl && !bubbleEl.querySelector('.kb-sources')) {
      bubbleEl.appendChild(buildKbSourcesRow(kbSourceChips));
    }
  }
  selectedLinkUrls.clear();
  ignoredLinkUrls.clear();
  renderDetectedLinks();

  const typingId=showTyping();
  // No global isStreaming/abortController to set here. The run
  // _streamAIResponse creates below (via _runStreamAndAttach) IS this chat's
  // streaming state (see isChatStreaming/runsForChat); the composer
  // button/sidebar dot update themselves the moment that run registers
  // (_streamAIResponse calls syncComposerStreamingUI()+renderSidebar() right
  // after adding itself to activeRuns) — correctly reflecting whichever chat
  // is actually on screen at that point, even if the user switched away
  // during one of the awaits above (attachment upload, link fetch, web
  // search, KB retrieval).

  // build wire-format message list, then delegate to shared _streamAIResponse
  let messages;
  // Use getActivePath so the API receives the correct branch history, not the raw tree array.
  // chat.messages is a tree (sibling nodes with tails); only getActivePath() flattens it
  // along the currently selected branch — essential for regenerate / sibling navigation.
  const activePath = getActivePath(chat);
  if(provider.type==='anthropic'){
    messages=[];
    activePath.slice(0,-1).forEach(m=>{if(m.role==='user'||m.role==='assistant')messages.push({role:m.role,content:_toAnthropicContent(m.content)});});
    messages.push({role:'user',content:_toAnthropicContent(userContent)});
    _applyPromptCache(messages);
  } else {
    // OpenAI-compat: system prompt injected by _streamAIResponse; pass only history + new user msg
    // expand pdf_text/pdf_base64 for OpenAI-compat too
    const hist=activePath.slice(0,-1).filter(m=>m.role==='user'||m.role==='assistant')
      .map(m=>({role:m.role,content:_toOpenAIContent(m.content)}));
    messages=[...hist,{role:'user',content:_toOpenAIContent(userContent)}];
  }
  // The retrieved context is now part of this outgoing message. Clear the
  // selected KBs so they are not used again for the next prompt.
  if (kbWasRequested && typeof window.kbClearActiveSelection === 'function') {
    window.kbClearActiveSelection();
  }
  if (isAgenticWebMode()) {
    // Let the model decide for itself (via web_search/fetch_url tools)
    // whether this message needs a lookup, before generating the reply
    // the person actually sees — see runAgenticWebToolLoop() above.
    const { msgs: augmentedMessages, traceHtml } = await runAgenticWebToolLoop(messages, provider);
    await _runStreamAndAttach(chat, augmentedMessages, provider, typingId, documentIds, { prefixText: traceHtml });
  } else {
    await _runStreamAndAttach(chat, messages, provider, typingId, documentIds);
  }
}

// ── Auto-Title Generation ─────────────────────────────────────────
// Called immediately when the first user message is sent (parallel to the main stream).
// Uses userText as a fast seed; once the AI response arrives it will have updated already.
async function autoGenerateChatTitle(chat, userText) {
  if(!chat) return;
  try {
    const provider = providerForModel(config.model) || providers[0];
    if(!provider || !provider.apiKey || provider.enabled===false) return;

    const snippet = (userText||'').slice(0, 500);
    if(!snippet) return;

    const titlePrompt = 'Generate a concise chat title (max 6 words, no quotes, no trailing punctuation) for a conversation that starts with this user message:\n\n' + snippet;

    let titleText = '';

    if(provider.type === 'anthropic') {
      const { modelId } = splitModelId(config.model);
      const res = await fetch(proxyUrl('https://api.anthropic.com/v1/messages'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: modelId || 'claude-haiku-4-5-20251001',
          max_tokens: 20,
          messages: [{ role: 'user', content: titlePrompt }]
        })
      });
      if(res.ok) { const d = await res.json(); titleText = d.content?.[0]?.text || ''; }
    } else {
      // OpenAI-compatible (OpenAI, OpenRouter, KiConnect NRW, Mistral, Groq, DeepSeek …)
      const endpoint = getProviderEndpoint(provider);
      const { modelId } = splitModelId(config.model);
      const extraHeaders = {};
      if(provider.type === 'openrouter') {
        extraHeaders['HTTP-Referer'] = window.location.origin;
        extraHeaders['X-Title'] = 'KI Connect NRW';
      }
      const res = await fetch(proxyUrl(`${endpoint}/chat/completions`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
          ...extraHeaders
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 20,
          temperature: 0.3,
          messages: [{ role: 'user', content: titlePrompt }]
        })
      });
      if(res.ok) { const d = await res.json(); titleText = d.choices?.[0]?.message?.content || ''; }
    }

    titleText = titleText.trim().replace(/^["']+|["']+$/g, '').replace(/[.!?]+$/, '').trim();
    if(titleText && titleText.length > 1) {
      chat.title = titleText.slice(0, 60);
      save();
      renderSidebar();
    }
  } catch(e) {
    console.warn('[autoTitle] failed:', e.message);
    // Leave the '…' placeholder — user can rename manually
  }
}

// ── Message UI ─────────────────────────────────────────────────────
function appendToMessages(el) {
  const c=document.getElementById('messages');
  const total=c.querySelector('#chatTokenTotal');
  if(total){c.insertBefore(el,total);}else{c.appendChild(el);}
}
// Appends a new, empty assistant bubble to the message list (filled in as the stream arrives).
function appendEmptyAI(modelOverride, runId) {
  const mid=modelOverride||config.model||'';
  const pureModelId=splitModelId(mid).modelId||mid;
  const div=document.createElement('div');
  div.className='message-row ai';
  if (runId) div.dataset.runId = runId;
  const avatarCol=document.createElement('div');avatarCol.className='avatar-col';
  const avatar=document.createElement('div');avatar.className='avatar ai';avatar.title=pureModelId;avatar.textContent=t('js.aiAvatar');
  avatarCol.appendChild(avatar);
  if(pureModelId){const ml=document.createElement('div');ml.className='model-label';ml.title=pureModelId;ml.textContent=pureModelId.split('/').pop();avatarCol.appendChild(ml);}
  const wrap=document.createElement('div');wrap.className='bubble-wrap';
  const bubble=document.createElement('div');bubble.className='bubble streaming';
  wrap.appendChild(bubble);div.appendChild(avatarCol);div.appendChild(wrap);
  appendToMessages(div);scrollToBottom();return div;
}
// Shows the 'typing...' indicator while waiting for the first response chunk.
function showTyping() {
  const id='typing_'+Date.now();
  const div=document.createElement('div');div.className='message-row ai typing';div.id=id;
  const ac=document.createElement('div');ac.className='avatar-col';
  const av=document.createElement('div');av.className='avatar ai';av.textContent='…';ac.appendChild(av);
  const bw=document.createElement('div');bw.className='bubble-wrap';
  const bl=document.createElement('div');bl.className='bubble';
  const dots=document.createElement('div');dots.className='dots';
  for(let i=0;i<3;i++){const s=document.createElement('span');dots.appendChild(s);}
  bl.appendChild(dots);bw.appendChild(bl);div.appendChild(ac);div.appendChild(bw);
  appendToMessages(div);scrollToBottom();return id;
}
// Removes a previously shown typing indicator by its element ID.
function removeTyping(id){document.getElementById(id)?.remove();}
// Scrolls the message list to the bottom.
function scrollToBottom(){const c=document.getElementById('messages');c.scrollTop=c.scrollHeight;pinnedToBottom=true;}
// Keep pinnedToBottom in sync with whatever the user actually does with
// the scrollbar (mouse wheel, drag, keyboard, ...) — independent of which
// chat's run (chat stream or agent turn, tracked per-chat in activeRuns —
// see isChatStreaming) is currently active, so both share the same "did
// the user scroll away from the bottom?" signal.
document.addEventListener('DOMContentLoaded', () => {
  const messagesEl = document.getElementById('messages');
  if (messagesEl) messagesEl.addEventListener('scroll', () => { pinnedToBottom = isMessagesNearBottom(); });
});
// Fills the message input with a suggestion chip's text and sends it immediately.
function sendSuggestion(txt){document.getElementById('messageInput').value=txt;sendMessage();}

// ── Copy ──────────────────────────────────────────────────────────
function copyCodeFromBtn(btn) {
  const b64=btn.dataset.b64; if(!b64) return;
  let text;
  try{text=decodeURIComponent(escape(atob(b64)));}catch{text=atob(b64);}
  navigator.clipboard.writeText(text).then(()=>{
    btn.textContent=t('js.copied');btn.classList.add('done');
    setTimeout(()=>{btn.textContent=t('js.codeCopy');btn.classList.remove('done');},2000);
  }).catch(()=>toast(t('js.copyFailed')));
}

// Collapses/expands a fenced code block's body (keeps the header with
// language label + copy button visible so it can be re-expanded).
function toggleCodeBlockCollapse(btn) {
  const block = btn.closest('.code-block'); if (!block) return;
  const collapsed = block.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▶' : '▼';
  btn.title = collapsed ? (t('js.codeExpand')||'Expand') : (t('js.codeCollapse')||'Collapse');
}

// Copies a message bubble's plain-text content to the clipboard.
function copyBubble(btn, idx) {
  idx=safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  const msg=getActivePath(chat)[idx]; if(!msg) return;
  let text='';
  if(typeof msg.content==='string') text=msg.content;
  else if(Array.isArray(msg.content)) text=msg.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
  navigator.clipboard.writeText(text).then(()=>{
    if(btn){btn.textContent=t('js.copied');btn.classList.add('copy-done');setTimeout(()=>{btn.textContent=t('js.copy');btn.classList.remove('copy-done');},2000);}
  }).catch(()=>toast(t('js.copyFailed')));
}
// Copy rich HTML for Word and Markdown/LaTeX text for note apps.
async function copyBubbleFormatted(bubbleEl, btn) {
  if (!bubbleEl) return;
  const fragment = document.createDocumentFragment();
  fragment.appendChild(bubbleEl.cloneNode(true));
  const text = fragmentToClipboardText(fragment);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([fragmentToClipboardHtml(fragment)], {type: 'text/html'}),
        'text/plain': new Blob([text], {type: 'text/plain'}),
      }),
    ]);
    if (!btn) return;
    const original = t('js.copyFormatted');
    btn.textContent = t('js.copied'); btn.classList.add('copy-done');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copy-done'); }, 2000);
  } catch (_) {
    try {
      await navigator.clipboard.writeText(text);
      if (!btn) return;
      btn.textContent = t('js.copied'); btn.classList.add('copy-done');
      setTimeout(() => { btn.textContent = t('js.copyFormatted'); btn.classList.remove('copy-done'); }, 2000);
    } catch (_) {
      toast(t('js.copyFailed'));
    }
  }
}

// Formula selections preserve MathML for Word and LaTeX for Markdown apps.
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('messages')?.addEventListener('copy', handleFormulaCopy);
});

function handleFormulaCopy(event) {
  const messagesEl = document.getElementById('messages');
  const selection = window.getSelection();
  if (!messagesEl || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!messagesEl.contains(range.commonAncestorContainer) || !rangeTouchesFormula(range, messagesEl)) return;
  expandRangeToFullFormulas(range, messagesEl);
  event.preventDefault();
  finishFormulaCopy(range);
}

async function finishFormulaCopy(range) {
  try {
    const fragment = range.cloneContents();
    const html = fragmentToClipboardHtml(fragment);
    const text = fragmentToClipboardText(fragment);
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], {type: 'text/html'}),
        'text/plain': new Blob([text], {type: 'text/plain'}),
      }),
    ]);
  } catch (error) {
    try {
      const text = fragmentToClipboardText(range.cloneContents());
      await navigator.clipboard.writeText(text);
    } catch (_) {
      console.error('[KIC] Formula copy failed', error);
      toast(t('js.copyFailed'));
    }
  }
}

function rangeTouchesFormula(range, root) {
  return Array.from(root.querySelectorAll('.math-inline, .math-block')).some(el => range.intersectsNode(el));
}

function expandRangeToFullFormulas(range, root) {
  root.querySelectorAll('.math-inline, .math-block').forEach(wrapper => {
    if (!range.intersectsNode(wrapper)) return;
    const formulaRange = document.createRange();
    formulaRange.selectNode(wrapper);
    if (range.compareBoundaryPoints(Range.START_TO_START, formulaRange) > 0) range.setStartBefore(wrapper);
    if (range.compareBoundaryPoints(Range.END_TO_END, formulaRange) < 0) range.setEndAfter(wrapper);
  });
}

function getFormulaData(wrapper) {
  const isBlock = wrapper.classList.contains('math-block');
  let latex = '';
  const encoded = wrapper.getAttribute('data-latex');
  if (encoded) {
    try { latex = decodeURIComponent(escape(atob(encoded))); } catch (_) {}
  }
  if (!latex) latex = (wrapper.textContent || '').replace(/^\\\[|\\\]$|^\\\(|\\\)$|^\$\$?|\$\$?$/g, '').trim();
  const math = wrapper.querySelector('mjx-assistive-mml math');
  return {isBlock, latex, mathml: math ? mathmlForClipboard(math, isBlock) : ''};
}

function mathmlForClipboard(math, isBlock) {
  const clone = math.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/1998/Math/MathML');
  if (isBlock) clone.setAttribute('display', 'block');
  return clone.outerHTML;
}

function formulaToClipboardHtml({latex, isBlock, mathml}) {
  const fallback = `<span>${escHtml(isBlock ? `$$${latex}$$` : `$${latex}$`)}</span>`;
  if (!mathml) return fallback;
  const word = `<!--[if gte mso 9]>${mathml}<![endif]-->`;
  const nonWord = `<!--[if !mso]><!-->${fallback}<!--<![endif]-->`;
  return isBlock ? `<p class="MsoNormal">${word}${nonWord}</p>` : word + nonWord;
}

function fragmentToClipboardHtml(fragment) {
  const container = document.createElement('div');
  container.appendChild(fragment.cloneNode(true));
  const replacements = [];
  container.querySelectorAll('.math-inline, .math-block').forEach((wrapper, i) => {
    replacements.push(formulaToClipboardHtml(getFormulaData(wrapper)));
    wrapper.replaceWith(document.createComment(`KICMATH${i}`));
  });
  let html = container.innerHTML;
  replacements.forEach((replacement, i) => { html = html.replace(`<!--KICMATH${i}-->`, () => replacement); });
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"></head><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`;
}

function fragmentToClipboardText(fragment) {
  const container = document.createElement('div');
  container.appendChild(fragment.cloneNode(true));
  return nodeToPlainText(container).replace(/\n{3,}/g, '\n\n').trim();
}

const _KIC_BLOCK_TAGS = new Set(['P','DIV','LI','TR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE']);
function nodeToPlainText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.classList?.contains('math-inline') || node.classList?.contains('math-block')) {
    const {latex, isBlock} = getFormulaData(node);
    return isBlock ? `$$${latex}$$` : `$${latex}$`;
  }
  if (node.tagName === 'BR') return '\n';
  let text = '';
  node.childNodes.forEach(child => { text += nodeToPlainText(child); });
  return _KIC_BLOCK_TAGS.has(node.tagName) ? text + '\n' : text;
}

// Copies the entire active chat's conversation as plain text to the clipboard.
function copyFullChat() {
  const chat=currentChat(); if(!chat||!chat.messages.length){toast(t('js.noChatToCopy'));return;}
  // Use getActivePath so only the currently visible branch is copied, not the raw sibling tree.
  const text=getActivePath(chat).map(m=>{
    const role=m.role==='user'?t('js.userAvatar'):(m._model?m._model.split('/').pop():t('js.aiAvatar'));
    let content='';
    if(typeof m.content==='string')content=m.content;
    else if(Array.isArray(m.content))content=m.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
    return`[${role}]\n${content}`;
  }).join('\n\n---\n\n');
  navigator.clipboard.writeText(text).then(()=>toast(t('js.chatCopied'))).catch(()=>toast(t('js.copyFailed')));
}

// ── Text Formatting ────────────────────────────────────────────────
// Safe UTF-8 -> base64 encoder. Replaces the classic
// btoa(unescape(encodeURIComponent(str))) trick, which throws
// "URIError: malformed URI sequence" if str contains an unpaired
// TextEncoder replaces invalid surrogates with U+FFFD instead of throwing,
// so a stray bad character (e.g. a truncated emoji) degrades gracefully.
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function escHtml(s) {
  if(s===null||s===undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Security: force rel="noopener noreferrer" on target="_blank" links to
// prevent reverse tabnabbing. Installed lazily so it still works if
// DOMPurify loads after this script runs.
let _dompurifyNoopenerHookInstalled = false;
function ensureDompurifyNoopenerHook() {
  if (_dompurifyNoopenerHookInstalled || typeof DOMPurify === 'undefined') return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  _dompurifyNoopenerHookInstalled = true;
}


// Converts raw model/markdown text into sanitized, syntax-highlighted, math-aware HTML for display.
function formatText(raw) {
  if (!raw) return '';
  const blocks = [];
  // Placeholder: HTML comments that marked passes through unchanged
  const PH = (i) => `<!--KICBLK${i}-->`;
  const PH_RE = /<!--KICBLK(\d+)-->/g;
  let s = raw;

  // Builds one collapsible code-block's HTML, pushes it onto `blocks`, and
  // returns its index. Shared by all four fence patterns below (4+/3
  // backticks, closed/unclosed) — they differ only in which regex matched.
  function pushCodeBlock(lang, code) {
    const i = blocks.length;
    const b64 = toBase64Utf8(code.replace(/\n$/, ''));
    const ll = escHtml((lang || '').trim() || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-collapse-btn" type="button" title="${escHtml(t('js.codeCollapse')||'Collapse')}" aria-label="Collapse code block">▼</button><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><div class="code-block-body"><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div></div>`);
    return i;
  }

  // ── Step 1: Code and LaTeX blocks VOR protect from marked ────────

  // 4+-Backtick-Fences
  s = s.replace(/^(`{4,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm, (_, fence, lang, code) => PH(pushCodeBlock(lang, code)));

  // 3-Backtick-Fences
  s = s.replace(/^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm, (_, lang, code) => PH(pushCodeBlock(lang, code)));

  // Not-closed Fences (Fallback)
  s = s.replace(/^(`{4,})([^\n]*)\n([\s\S]*)$/gm, (_, fence, lang, code) => PH(pushCodeBlock(lang, code)));
  s = s.replace(/^```([^\n`]*)\n([\s\S]*)$/gm, (_, lang, code) => PH(pushCodeBlock(lang, code)));

  // Inline-Code
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = blocks.length;
    blocks.push(`<code>${escHtml(code)}</code>`);
    return PH(i);
  });

  // Pushes one captured LaTeX block/inline match into `blocks` and returns
  // its placeholder - shared by the four regex.replace() calls below.
  function pushMathBlock(html) {
    const i = blocks.length;
    blocks.push(html);
    return PH(i);
  }

  // LaTeX Display: \[ ... \]
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    const latexB64 = toBase64Utf8(math);
    return pushMathBlock(`<div class="math-block" data-latex="${latexB64}">\\[${escHtml(math)}\\]</div>`);
  });

  // LaTeX Display: $$ ... $$
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const latexB64 = toBase64Utf8(math);
    return pushMathBlock(`<div class="math-block" data-latex="${latexB64}">$$${escHtml(math)}$$</div>`);
  });

  // LaTeX Inline: \( ... \)
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
    const latexB64 = toBase64Utf8(math);
    return pushMathBlock(`<span class="math-inline" data-latex="${latexB64}">\\(${escHtml(math)}\\)</span>`);
  });

  // LaTeX Inline: $...$ (kein Leerzeichen am Rand, kein Zeilenumbruch)
  s = s.replace(/\$([^\s$\n][^$\n]*?[^\s$\n]|\S)\$/g, (_, math) => {
    const latexB64 = toBase64Utf8(math);
    return pushMathBlock(`<span class="math-inline" data-latex="${latexB64}">\\(${escHtml(math)}\\)</span>`);
  });

  // ── Step 1b: ensure a blank line precedes list blocks ──────────
  // CommonMark/marked (with breaks:false) only starts a list at the
  // beginning of the text or after a blank line. Without that blank
  // line, "-"/"*"/"1." lines typed right after a text line get pulled
  // into the previous paragraph as literal characters instead of
  // becoming an indented <ul>/<ol> — this is what caused notes (which
  // are usually typed without blank lines) to render list markers as
  // flat, non-indented text while the same markdown worked fine in the
  // chat composer where paragraph breaks are more commonly used.
  {
    const isListLine = (line) => /^[ \t]*([-*+]|\d+[.)])[ \t]+/.test(line);
    const lines = s.split('\n');
    const fixed = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isListLine(line)) {
        const prev = fixed[fixed.length - 1];
        if (prev !== undefined && prev.trim() !== '' && !isListLine(prev)) {
          fixed.push('');
        }
      }
      fixed.push(line);
    }
    s = fixed.join('\n');
  }

  // ── Step 2: marked.js rendern ─────────────────────────────────
  if (typeof marked !== 'undefined') {
    // Custom renderer for code blocks (in case marked does encounter one)
    const renderer = new marked.Renderer();
    renderer.code = function(token) {
      const text = (token && typeof token === 'object') ? (token.text || '') : String(token || '');
      const lang = (token && typeof token === 'object') ? (token.lang || 'code') : 'code';
      const i = blocks.length;
      const b64 = toBase64Utf8(text);
      const ll = escHtml(lang || 'code');
      blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-collapse-btn" type="button" title="${escHtml(t('js.codeCollapse')||'Collapse')}" aria-label="Collapse code block">▾</button><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><div class="code-block-body"><pre><code>${escHtml(text)}</code></pre></div></div>`);
      return PH(i);
    };
    try {
      s = marked.parse(s, { renderer, gfm: true, breaks: false });
    } catch(e) {
      // Fallback falls marked fails
      s = escHtml(s).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
      s = '<p>' + s + '</p>';
    }
  } else {
    // Fallback ohne marked
    s = escHtml(s);
    s = s.split(/\n{2,}/).map(p => {
      p = p.trim(); if (!p) return '';
      if (p.startsWith('<') || p.startsWith('<!--')) return p;
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).filter(Boolean).join('');
  }

  // ── Step 3: Platzhalter wiederherstellen ───────────────────────
  s = s.replace(PH_RE, (_, i) => blocks[+i] || '');

  // ── Step 4: DOMPurify ─────────────────────────────────────────
  if (typeof DOMPurify !== 'undefined') {
    ensureDompurifyNoopenerHook();
    s = DOMPurify.sanitize(s, {
      ALLOWED_TAGS: ['p','br','strong','em','del','h1','h2','h3','h4','h5','h6',
                     'ul','ol','li','code','pre','hr','table','thead','tbody','tr','th','td',
                     'div','span','button','a','u','sup','sub','mark','small','s','ins',
                     'abbr','cite','kbd','details','summary','blockquote','input','img'],
      ALLOWED_ATTR: ['style','class','href','target','rel','title','data-b64','data-latex',
                     'type','checked','disabled','src','alt','loading','start'],
      FORBID_ATTR:  ['onerror','onload','onmouseover','onfocus','onblur','onclick',
                     'onmouseout','onkeydown','onkeyup','onkeypress','onchange','oninput'],
      ALLOW_DATA_ATTR: false,
      FORCE_BODY: false,
    });
  } else {
    console.warn('[KIC] DOMPurify not loaded - HTML strip fallback');
    /* DOMPurify fallback - strip unknown tags */ s = s.replace(/<[^>]+>/g, '');
  }
  return s;
}

// Translation for quote - window - button
function wireCodeCopyButtons(container) {
  container.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    if(!btn._wired){btn._wired=true;btn.addEventListener('click',()=>copyCodeFromBtn(btn));}
  });
  container.querySelectorAll('.code-collapse-btn').forEach(btn => {
    if(!btn._wired){btn._wired=true;btn.addEventListener('click',()=>toggleCodeBlockCollapse(btn));}
  });
  retranslateCodeBlockButtons(container);
}

// ── Math ──────────────────────────────────────────────────────────
// `el` can be a single element (typeset everything inside it) or an array
// of nodes (typeset exactly those, e.g. only the nodes just appended to a
// stable container — lets a caller avoid re-scanning content that's
// already settled).
function typesetMath(el) {
  const target = el || document.getElementById('messages');
  const targets = Array.isArray(target) ? target : [target];
  if (!targets.length) return;
  if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetPromise(targets).then(() => stripMathFocusability(targets))
      .catch(err => console.error('[MathJax typeset error]', err));
  }
}

// MathJax's assistive MathML makes every <mjx-container> focusable
// (tabindex="0"), and focusing one interrupts an in-progress speechSynthesis
// utterance (kiconnect-voice.js). Screen readers can still reach the MathML
// via browse-mode without Tab focusability, so it's safe to strip.
function stripMathFocusability(targets) {
  targets.forEach(t => {
    if (!t || !t.querySelectorAll) return;
    if (t.matches && t.matches('mjx-container[tabindex]')) t.removeAttribute('tabindex');
    t.querySelectorAll('mjx-container[tabindex]').forEach(mjx => mjx.removeAttribute('tabindex'));
  });
}

// Belt-and-suspenders: prevent mouse-focus on any <mjx-container> we didn't
// catch via stripMathFocusability(), without blocking the click itself.
document.addEventListener('mousedown', e => {
  if (e.target.closest && e.target.closest('mjx-container')) e.preventDefault();
}, true);


// Throttled variant: used during streaming so LaTeX renders progressively
// instead of only once at the very end. Per-element throttle state (not one
// shared timer) so concurrent typesets on different elements don't delay
// each other.
const _mjThrottleState = new WeakMap();
// Schedules a MathJax typeset pass for an element, throttled per-element so rapid successive calls collapse into one.
function typesetMathThrottled(el, delay = 400) {
  const target = el || document.getElementById('messages');
  let state = _mjThrottleState.get(target);
  if (!state) {
    state = { timer: null, last: 0 };
    _mjThrottleState.set(target, state);
  }

  clearTimeout(state.timer);

  const now = Date.now();
  const wait = Math.max(0, delay - (now - state.last));

  state.timer = setTimeout(() => {
    state.last = Date.now();
    // Re-target `target` itself (not a pre-captured node list) so this always
    // typesets whatever is currently inside it, even if its innerHTML was
    // rewritten one or more times while this call was pending.
    typesetMath(target);
  }, wait);
}

// ── PDF Helpers ───────────────────────────────────────────────────
async function extractPdfText(arrayBuffer) {
  const lib=window._pdfjsLib||window.pdfjsLib; if(!lib) throw new Error('PDF.js not loaded');
  const pdf=await lib.getDocument({data:arrayBuffer}).promise;
  let out='';
  for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();out+=`${tf('js.pdfPage',{n:i})}\n${content.items.map(it=>it.str).join(' ')}\n`;}
  return out;
}
// Converts an ArrayBuffer to a base64 string.
function arrayBufferToBase64(buf){const bytes=new Uint8Array(buf);let bin='';for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);return btoa(bin);}
// Returns whether a model ID supports receiving raw PDF bytes (as opposed to extracted text only).
function modelSupportsPdfBase64(mid){return /claude|gemini|gpt-4o/i.test(mid||'');}

// ── FILE / IMAGE HANDLING (incl. Ctrl+V paste) ──────────────────

// Reads a dropped/selected file (image, PDF, or text) and adds it to the pending attachments.
async function processFile(file) {
  const isImage=file.type.startsWith('image/');
  const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  const reader=new FileReader();
  reader.onload=async ev=>{
    if(isImage){attachments.push({type:'image',name:file.name,data:ev.target.result});}
    else if(isPdf){
      const b64data=ev.target.result;const b64=b64data.split(',')[1]||b64data;
      const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k);
      attachments.push({type:'pdf-b64',name:file.name,data:b64data,rawBuf:arr.buffer,pdfMode:'b64'});
    } else{attachments.push({type:'text-file',name:file.name,content:ev.target.result});}
    renderAttachments();
  };
  isPdf||isImage?reader.readAsDataURL(file):reader.readAsText(file,'UTF-8');
}

// Reads an image blob (e.g. from clipboard paste), warns and offers to raise the storage limit if it's too large, then adds it as an attachment.
async function processImageBlob(blob, name) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      const maxBytes = getMaxImageStorageBytes();
      // If image exceeds limit, ask user if they want to raise the limit
      if (dataUrl.length > maxBytes) {
        const newLimitKB = Math.ceil(dataUrl.length / 1024 / 100) * 100; // round up to next 100 KB
        const msg = tf('js.imageTooBigDialog', { size: Math.round(dataUrl.length/1024), limit: Math.round(maxBytes/1024), newLimit: newLimitKB });
        if (confirm(msg)) {
          setMaxImageStorageBytes(newLimitKB * 1024);
          toast(tf('js.limitRaised', {kb: newLimitKB}));
        }
      }
      attachments.push({type:'image', name: name || 'clipboard-image.png', data: dataUrl});
      renderAttachments();
      resolve();
    };
    reader.readAsDataURL(blob);
  });
}

// Clipboard paste handler (Ctrl+V image)
async function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) await processImageBlob(blob, `pasted-image-${Date.now()}.png`);
      return; // only handle first image
    }
  }
  // No image found — let default paste behavior happen (text)
}

// Handles the file-input 'change' event for the generic file-attach button.
function handleFileAttach(e){const file=e.target.files[0];if(!file)return;e.target.value='';processFile(file);}
// Handles the file-input 'change' event for the image-attach button.
function handleImageAttach(e){const file=e.target.files[0];if(!file)return;e.target.value='';processFile(file);}

// (Re)renders the row of pending attachment chips above the message input, including the PDF mode toggle.
function renderAttachments() {
  const row=document.getElementById('attachmentRow');
  row.innerHTML='';
  attachments.forEach((a,i)=>{
    const chip=document.createElement('div');
    chip.className='preview-chip';
    if(a.type==='image'){
      const img=document.createElement('img');img.src=a.data;img.alt=a.name;
      img.style.cssText='max-height:48px;max-width:80px;border-radius:4px;cursor:pointer;';
      img.addEventListener('click',()=>openImageLightbox(a.data));
      chip.appendChild(img);
      chip.appendChild(document.createTextNode(a.name));
    } else if(/\.pdf$/i.test(a.name)||a.type==='pdf-b64'){
      const mode=a.pdfMode||'b64';
      chip.appendChild(document.createTextNode((mode==='b64'?'📄':'🔤')+' '+a.name));
      if(mode==='b64'&&!modelSupportsPdfBase64(config.model)){
        const warn=document.createElement('span');warn.title=t('js.pdfWarn');warn.style.cssText='color:var(--red);cursor:help;';warn.textContent='⚠️';chip.appendChild(warn);
      }
      const toggle=document.createElement('div');toggle.className='pdf-mode-toggle';
      const b1=document.createElement('button');b1.className='pdf-mode-btn'+(mode==='b64'?' active':'');b1.textContent=t('js.pdfDoc');b1.dataset.idx=i;b1.addEventListener('click',()=>togglePdfMode(parseInt(b1.dataset.idx),'b64'));
      const b2=document.createElement('button');b2.className='pdf-mode-btn'+(mode==='text'?' active':'');b2.textContent=t('js.pdfText');b2.dataset.idx=i;b2.addEventListener('click',()=>togglePdfMode(parseInt(b2.dataset.idx),'text'));
      toggle.appendChild(b1);toggle.appendChild(b2);chip.appendChild(toggle);
    } else {
      chip.appendChild(document.createTextNode('📄 '+a.name));
    }
    const rem=document.createElement('button');rem.className='remove';rem.textContent='✕';rem.dataset.idx=i;
    rem.addEventListener('click',()=>removeAttachment(parseInt(rem.dataset.idx)));
    chip.appendChild(rem);
    row.appendChild(chip);
  });
}

// Switches a pending PDF attachment between 'document' (base64) and 'extracted text' mode, extracting text on demand.
async function togglePdfMode(i,mode){
  const a=attachments[i];if(!a||a.pdfMode===mode)return;
  a.pdfMode=mode;
  if(mode==='text'&&!a.extractedText){
    renderAttachments();toast(t('js.extracting'));
    try{const buf=a.rawBuf||(()=>{const b64=(a.data||'').split(',')[1]||a.data;const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k);return arr.buffer;})();a.rawBuf=buf;a.extractedText=await extractPdfText(buf);toast(tf('js.extracted',{n:a.extractedText.length}));}
    catch(err){toast(tf('js.extractFailed',{e:err.message}));a.pdfMode='b64';}
  }
  if(mode==='b64'&&!a.data&&a.rawBuf){try{a.data=`data:application/pdf;base64,${arrayBufferToBase64(a.rawBuf)}`;}catch(err){toast(tf('js.b64Failed',{e:err.message}));a.pdfMode='text';}}
  renderAttachments();
}
// Removes a pending attachment by index.
function removeAttachment(i){attachments.splice(i,1);renderAttachments();}
// Clears all pending attachments.
function clearAttachments(){attachments=[];renderAttachments();}

// ── UI Helpers ────────────────────────────────────────────────────
function closePanels(){
  ['settingsPanel','tuningPanel','providerPanel','profilePanel','modelMaxPanel'].forEach(id=>document.getElementById(id).classList.remove('open'));
  document.querySelectorAll('.panel-toolbar-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('overlay').classList.remove('show');
  // Don't leave the "delete account" password prompt open/filled in the background.
  const delBox = document.getElementById('deleteAccountConfirm');
  if (delBox && delBox.style.display !== 'none') {
    delBox.style.display = 'none';
    const pwInput = document.getElementById('deleteAccountPwdInput');
    if (pwInput) pwInput.value = '';
  }
}
// Shows a temporary toast notification with the given message.
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
// Opens the Settings panel.
function openSettings(){syncSettingsPanel();applyTheme(localStorage.getItem('kic_theme')||'dark');document.getElementById('settingsPanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="settingsPanel"]')?.classList.add('active');initSettingsSectionCollapse();}
// Opens the Tuning panel.
function openTuningPanel(){syncSettingsPanel();applyTheme(localStorage.getItem('kic_theme')||'dark');document.getElementById('tuningPanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="tuningPanel"]')?.classList.add('active');initTuningSectionCollapse();}
// Opens the Profiles panel.
function openProfilePanel(){renderProfileList();document.getElementById('profilePanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="profilePanel"]')?.classList.add('active');}
let _tourActive = false;
let _tourStepIndex = 0;
let _tourTargetEl = null;
let _tourPlacementTimer = null;
const TOUR_STEPS = [
  { target: '#langToggleBtn', title: 'tour.languageTitle', text: 'tour.languageText', prep: 'language' },
  { target: '#openIntroBtn', title: 'tour.welcomeTitle', text: 'tour.welcomeText', prep: 'home' },
  { target: '#openProviderHeaderBtn', title: 'tour.apiButtonTitle', text: 'tour.apiButtonText', prep: 'home' },
  { target: '#addProviderBtn', title: 'tour.addProviderTitle', text: 'tour.addProviderText', prep: 'providerPanel' },
  { target: '#pvNameInput', title: 'tour.providerNameTitle', text: 'tour.providerNameText', prep: 'providerEditor', focus: true },
  { target: '#providerTypeRow', title: 'tour.providerTypeTitle', text: 'tour.providerTypeText', prep: 'providerEditor' },
  { target: '#pvServerUrlGroup', title: 'tour.serverUrlTitle', text: 'tour.serverUrlText', prep: 'providerEditor', focus: '#pvServerUrl' },
  { target: '#pvApiKey', title: 'tour.apiKeyTitle', text: 'tour.apiKeyText', prep: 'providerEditor', focus: true },
  { target: '#saveProviderBtn', title: 'tour.saveProviderTitle', text: 'tour.saveProviderText', prep: 'providerEditor' },
  { target: '#cmTrigger', title: 'tour.modelTitle', text: 'tour.modelText', prep: 'chat' },
  { target: '#messageInput', title: 'tour.firstChatTitle', text: 'tour.firstChatText', prep: 'chat', focus: true },
];
// Marks the guided intro/tour as completed so it won't auto-start again.
function markGuidedIntroDone() {
  if (!_activeAccountId) return;
  localStorage.setItem(accountKey('guided_intro_done'), '1');
  localStorage.removeItem(accountKey('guided_intro_pending'));
}
// Returns whether the guided tour should start automatically (first visit, not yet completed).
function shouldAutoStartGuidedIntro() {
  if (!_activeAccountId) return false;
  return localStorage.getItem(accountKey('guided_intro_pending')) === '1' &&
         localStorage.getItem(accountKey('guided_intro_done')) !== '1';
}
// Starts (or resumes) the guided product tour at the given step.
function startGuidedIntro(stepIndex = 0) {
  _tourActive = true;
  _tourStepIndex = Math.max(0, Math.min(stepIndex, TOUR_STEPS.length - 1));
  document.body.classList.add('tour-active');
  const layer = document.getElementById('tourLayer');
  layer?.classList.add('active');
  layer?.setAttribute('aria-hidden', 'false');
  showTourStep();
}
// Ends the guided tour and cleans up its highlight/overlay UI.
function endGuidedIntro() {
  _tourActive = false;
  markGuidedIntroDone();
  document.body.classList.remove('tour-active');
  const layer = document.getElementById('tourLayer');
  layer?.classList.remove('active');
  layer?.setAttribute('aria-hidden', 'true');
  clearTourHighlight();
}
// Removes the tour's spotlight/highlight overlay from the page.
function clearTourHighlight() {
  if (_tourTargetEl) _tourTargetEl.classList.remove('tour-highlight');
  _tourTargetEl = null;
  if (_tourPlacementTimer) {
    clearTimeout(_tourPlacementTimer);
    _tourPlacementTimer = null;
  }
}
// Performs any setup a tour step needs before it can be shown (e.g. opening the panel it points at).
function prepareTourStep(step) {
  if (step.prep === 'language') {
    closePanels();
    renderLangDropdown();
    document.getElementById('langDropdown')?.classList.add('open');
  }
  if (step.prep === 'home') closePanels();
  if (step.prep === 'providerPanel') {
    closePanels();
    openProviderPanel();
  }
  if (step.prep === 'providerEditor') {
    closePanels();
    openProviderPanel();
    if (document.getElementById('providerEditor')?.style.display === 'none') startNewProvider();
  }
  if (step.prep === 'chat') closePanels();
}
// Resolves a tour step's DOM target element.
function getTourTarget(step) {
  let el = document.querySelector(step.target);
  if (step.prep === 'language') {
    el = document.getElementById('langSwitcher') || el;
  }
  if (step.target === '#pvServerUrlGroup' && el && getComputedStyle(el).display === 'none') {
    el = document.getElementById('pvApiKey');
  }
  return el;
}
// Returns the bounding rect of a tour step's target element, accounting for scroll/visibility.
function getTourTargetRect(target) {
  if (!target) return null;
  const rects = [target.getBoundingClientRect()];
  if (target.id === 'langSwitcher') {
    const dd = document.getElementById('langDropdown');
    if (dd && dd.classList.contains('open')) rects.push(dd.getBoundingClientRect());
  }
  const left = Math.min(...rects.map(r => r.left));
  const top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}
// Renders the current tour step's card, spotlight and target highlight.
function showTourStep() {
  if (!_tourActive) return;
  const step = TOUR_STEPS[_tourStepIndex];
  if (!step) { endGuidedIntro(); return; }
  prepareTourStep(step);
  clearTourHighlight();
  const target = getTourTarget(step);
  _tourTargetEl = target;
  if (target) {
    target.classList.add('tour-highlight');
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }
  const progress = document.getElementById('tourProgress');
  const title = document.getElementById('tourTitle');
  const text = document.getElementById('tourText');
  const back = document.getElementById('tourBackBtn');
  const next = document.getElementById('tourNextBtn');
  if (progress) progress.textContent = tf('tour.progress', { n: _tourStepIndex + 1, total: TOUR_STEPS.length });
  if (title) title.textContent = t(step.title);
  if (text) text.textContent = t(step.text);
  if (back) back.disabled = _tourStepIndex === 0;
  if (next) {
    const isLangStep = step.prep === 'language';
    next.disabled = isLangStep;
    next.textContent = _tourStepIndex === TOUR_STEPS.length - 1 ? t('tour.finish') : t('tour.next');
    if (isLangStep) next.title = t('tour.languageTitle');
  }
  scheduleTourPlacement(target, step);
}
// Defers positioning the tour card/spotlight until the target element has settled (e.g. after a panel-open animation).
function scheduleTourPlacement(target, step) {
  if (_tourPlacementTimer) clearTimeout(_tourPlacementTimer);
  const focusTarget = step.focus === true ? target : (step.focus ? document.querySelector(step.focus) : null);
  const delays = [80, 220, 380, 520];
  const run = (idx = 0) => {
    if (!_tourActive || TOUR_STEPS[_tourStepIndex] !== step) return;
    positionTourCard(target);
    if (idx === delays.length - 1 && focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus({ preventScroll: true });
    }
    if (idx + 1 < delays.length) {
      _tourPlacementTimer = setTimeout(() => run(idx + 1), delays[idx + 1] - delays[idx]);
    }
  };
  _tourPlacementTimer = setTimeout(() => run(0), delays[0]);
}
// Positions the tour card near its target, choosing among candidate placements to minimize overlap and stay on-screen.
function positionTourCard(target) {
  const card = document.getElementById('tourCard');
  if (!card) return;
  positionTourSpotlight(target);
  const inPanel = !!target?.closest?.('.panel');
  const margin = inPanel ? 28 : 14;
  const targetGap = inPanel ? 28 : 14;
  const cw = card.offsetWidth || 340;
  const ch = card.offsetHeight || 180;
  const maxLeft = Math.max(margin, window.innerWidth - cw - margin);
  const maxTop = Math.max(margin, window.innerHeight - ch - margin);
  let left = Math.min(maxLeft, Math.max(margin, (window.innerWidth - cw) / 2));
  let top = Math.min(maxTop, Math.max(margin, (window.innerHeight - ch) / 2));
  if (target) {
    const r = getTourTargetRect(target) || target.getBoundingClientRect();
    const clampX = x => Math.min(maxLeft, Math.max(margin, x));
    const clampY = y => Math.min(maxTop, Math.max(margin, y));
    const candidates = [
      { left: r.left - cw - targetGap, top: r.top, pref: inPanel ? 0 : 1 },
      { left: r.right + targetGap, top: r.top, pref: inPanel ? 1 : 0 },
      { left: r.left, top: r.bottom + targetGap, pref: 2 },
      { left: r.left, top: r.top - ch - targetGap, pref: 3 },
      { left: (window.innerWidth - cw) / 2, top: window.innerHeight - ch - margin, pref: 4 },
      { left: (window.innerWidth - cw) / 2, top: margin, pref: 5 },
    ].map(c => ({ ...c, left: clampX(c.left), top: clampY(c.top) }));
    const overlapArea = c => {
      const x = Math.max(0, Math.min(c.left + cw, r.right) - Math.max(c.left, r.left));
      const y = Math.max(0, Math.min(c.top + ch, r.bottom) - Math.max(c.top, r.top));
      return x * y;
    };
    const distance = c => Math.abs((c.left + cw / 2) - (r.left + r.width / 2)) + Math.abs((c.top + ch / 2) - (r.top + r.height / 2));
    candidates.sort((a, b) => (overlapArea(a) - overlapArea(b)) || (a.pref - b.pref) || (distance(a) - distance(b)));
    left = candidates[0].left;
    top = candidates[0].top;
  }
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}
// Positions the tour's highlight/spotlight rectangle over its target element.
function positionTourSpotlight(target) {
  const spot = document.getElementById('tourSpotlight');
  if (!spot) return;
  const pad = target?.closest?.('.panel') ? 10 : 8;
  let left = window.innerWidth / 2 - 60;
  let top = window.innerHeight / 2 - 24;
  let width = 120;
  let height = 48;
  if (target) {
    const r = getTourTargetRect(target) || target.getBoundingClientRect();
    left = Math.max(8, r.left - pad);
    top = Math.max(8, r.top - pad);
    width = Math.min(window.innerWidth - left - 8, r.width + pad * 2);
    height = Math.min(window.innerHeight - top - 8, r.height + pad * 2);
  }
  spot.style.left = `${left}px`;
  spot.style.top = `${top}px`;
  spot.style.width = `${width}px`;
  spot.style.height = `${height}px`;
}
// Advances the guided tour to the next step, skipping steps whose target is currently hidden.
function nextTourStep() {
  if (_tourStepIndex >= TOUR_STEPS.length - 1) { endGuidedIntro(); return; }
  _tourStepIndex++;
  // Skip the server-URL step if it is hidden (i.e. provider type != openai-compat)
  const step = TOUR_STEPS[_tourStepIndex];
  if (step?.target === '#pvServerUrlGroup') {
    const el = document.getElementById('pvServerUrlGroup');
    if (!el || getComputedStyle(el).display === 'none') {
      _tourStepIndex++;
    }
  }
  showTourStep();
}
// Moves the guided tour back to the previous step, skipping steps whose target is currently hidden.
function prevTourStep() {
  if (_tourStepIndex <= 0) return;
  _tourStepIndex--;
  // Skip the server-URL step backwards too if it is hidden
  const step = TOUR_STEPS[_tourStepIndex];
  if (step?.target === '#pvServerUrlGroup') {
    const el = document.getElementById('pvServerUrlGroup');
    if ((!el || getComputedStyle(el).display === 'none') && _tourStepIndex > 0) {
      _tourStepIndex--;
    }
  }
  showTourStep();
}
// Intercepts clicks on links inside rendered content and opens external http(s) links in a new tab.
function handleExternalLinkClick(e) {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  let url;
  try { url = new URL(a.getAttribute('href'), location.href); } catch { return; }
  if (!/^https?:$/i.test(url.protocol)) return;
  e.preventDefault();
  window.open(url.href, '_blank', 'noopener,noreferrer');
}
// Sends the message on Enter (without Shift) in the message input.
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}
// Grows/shrinks a textarea's height to fit its content, up to a max height.
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px';}

let _dragCounter=0;
// Allows dropping files onto the drop zone by preventing the default dragover behaviour.
function handleDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='copy';}
// Shows the file-drop overlay when a drag enters the window.
function handleDragEnter(e){e.preventDefault();_dragCounter++;document.getElementById('dropOverlay').classList.add('active');}
// Hides the file-drop overlay once the drag leaves the window.
function handleDragLeave(){_dragCounter--;if(_dragCounter<=0){_dragCounter=0;document.getElementById('dropOverlay').classList.remove('active');}}
// Handles files dropped onto the window by attaching each of them, ignoring internal chat/folder drag operations.
async function handleDrop(e){
  e.preventDefault();_dragCounter=0;document.getElementById('dropOverlay').classList.remove('active');
  // Only handle external file drops (not internal chat/folder drags)
  if(draggedChatId||draggedFolderId) return;
  const files=Array.from(e.dataTransfer.files);if(!files.length)return;
  for(const file of files)await processFile(file);
}

// ── Modell-Limits Panel ───────────────────────────────────────────
function openModelMaxPanel(){renderModelMaxList();document.getElementById('modelMaxPanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="modelMaxPanel"]')?.classList.add('active');}

// (Re)builds the list of models with editable max-output-token limits.
function renderModelMaxList(){
  const list=document.getElementById('modelMaxList');
  list.innerHTML='';
  const selector=document.getElementById('modelSelector');
  const seenModels=new Set();const rows=[];
  Array.from(selector.options).forEach(opt=>{if(!opt.value)return;const{modelId}=splitModelId(opt.value);if(!modelId||seenModels.has(modelId))return;seenModels.add(modelId);rows.push({modelId,label:opt.textContent.trim()});});
  Object.entries(KNOWN_MODELS).forEach(([id,m])=>{if(!seenModels.has(id)){seenModels.add(id);rows.push({modelId:id,label:m.label});}});
  if(!rows.length){const msg=document.createElement('div');msg.style.cssText='color:var(--muted);font-size:13px;padding:8px;';msg.textContent=t('js.noModelsInPanel');list.appendChild(msg);return;}
  rows.forEach(({modelId,label})=>{
    const defaultMax=getModelDefaultMax(modelId);const currentMax=getModelMaxOutput(modelId);const isModified=currentMax!==defaultMax;
    const row=document.createElement('div');row.className='model-max-row'+(isModified?' model-max-modified':'');row.id='mmrow_'+modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
    const info=document.createElement('div');info.style.cssText='flex:1;min-width:0;';
    const nameEl=document.createElement('div');nameEl.className='model-max-name';nameEl.textContent=label.replace(/^[▲●]\s*/,'');
    const subEl=document.createElement('div');subEl.className='model-max-sub';subEl.textContent=modelId;
    info.appendChild(nameEl);info.appendChild(subEl);
    const inp=document.createElement('input');inp.className='model-max-input';inp.type='number';inp.value=currentMax;inp.min=256;inp.max=1000000;inp.step=256;inp.dataset.modelId=modelId;
    inp.addEventListener('change',()=>setModelMax(inp.dataset.modelId,inp));
    const resetBtn=document.createElement('button');resetBtn.className='reset-btn';resetBtn.title=tf('js.resetTitle',{n:defaultMax.toLocaleString()});resetBtn.textContent='↺';resetBtn.dataset.modelId=modelId;
    resetBtn.addEventListener('click',()=>resetModelMax(resetBtn.dataset.modelId));
    row.appendChild(info);row.appendChild(inp);row.appendChild(resetBtn);
    list.appendChild(row);
  });
}

// Validates and saves a user override for a model's max-output-tokens.
function setModelMax(modelId,inputEl){
  const val=parseInt(inputEl.value);const defaultMax=getModelDefaultMax(modelId);
  if(!val||val<256){inputEl.value=defaultMax;return;}
  if(!config.userModelMaxOverrides)config.userModelMaxOverrides={};
  if(val===defaultMax){delete config.userModelMaxOverrides[modelId];}else{config.userModelMaxOverrides[modelId]=val;}
  const safeId=modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row=document.getElementById('mmrow_'+safeId);if(row)row.classList.toggle('model-max-modified',val!==defaultMax);
  save();updateModelMaxInfo();toast(tf('js.limitSet',{id:modelId.split('/').pop().slice(0,20),n:val.toLocaleString()}));
}
// Clears a user override for a model's max-output-tokens, reverting to the default.
function resetModelMax(modelId){
  if(!config.userModelMaxOverrides)return;delete config.userModelMaxOverrides[modelId];
  const defaultMax=getModelDefaultMax(modelId);const safeId=modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row=document.getElementById('mmrow_'+safeId);if(row){const inp=row.querySelector('.model-max-input');if(inp)inp.value=defaultMax;row.classList.remove('model-max-modified');}
  save();updateModelMaxInfo();toast(tf('js.resetTo',{id:modelId.split('/').pop().slice(0,20),n:defaultMax.toLocaleString()}));
}
// Clears all user max-output-token overrides.
function resetAllModelMax(){config.userModelMaxOverrides={};save();renderModelMaxList();updateModelMaxInfo();toast(t('js.allLimitsReset'));}

// ── LOGIN / MULTI-ACCOUNT / SESSION ─────────────────────────────

const ACCOUNT_COLORS = ['#3d7eff','#7c5cfc','#2ecc71','#e74c3c','#f39c12','#1abc9c','#e91e63','#ff6b35','#00bcd4','#9c27b0'];
let _selectedLoginAccountId = null; // account selected on grid before pw entry

// Shows the "create first account" view if there are no accounts left,
// otherwise the account-selection grid. Shared by showLoginScreen() and
// deleteAccount() (deleting the last account should fall back to signup).
function _showAccountViewAfterChange() {
  if (_accounts.length === 0) {
    renderNewAccountColorRow();
    showView('newAccountView');
    setTimeout(() => document.getElementById('newAccountName')?.focus(), 80);
  } else {
    showView('accountSelectView');
    renderAccountGrid();
  }
}

// Shows the login/account screen, loading the account registry first.
async function showLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) { ls.style.display = 'flex'; ls.classList.add('visible'); }
  await loadAccountRegistryAsync();
  _showAccountViewAfterChange();
  applyTranslations();
}
// Hides the login/account screen.
function hideLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) { ls.style.display = 'none'; ls.classList.remove('visible'); }
}
// Switches which login-flow sub-view (account grid, password entry, new-account form, ...) is visible.
function showView(viewId) {
  ['accountSelectView','accountLoginView','newAccountView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === viewId ? '' : 'none';
  });
}

// (Re)builds the grid of selectable accounts on the login screen.
function renderAccountGrid() {
  const grid = document.getElementById('accountGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!_accounts.length) {
    const msg = document.createElement('p');
    msg.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;width:100%;';
    msg.textContent = t('account.noAccounts');
    grid.appendChild(msg);
    return;
  }
  _accounts.forEach(acc => {
    const tile = document.createElement('div');
    tile.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;padding:12px 10px;border-radius:14px;transition:background 0.15s;min-width:90px;';
    tile.addEventListener('mouseenter', () => tile.style.background = 'rgba(255,255,255,0.06)');
    tile.addEventListener('mouseleave', () => tile.style.background = '');
    tile.addEventListener('click', () => selectAccountForLogin(acc.id));

    const avatar = document.createElement('div');
    avatar.style.cssText = `width:64px;height:64px;border-radius:16px;background:${acc.color};display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 4px 16px ${acc.color}55;`;
    avatar.textContent = '🪪';

    const name = document.createElement('div');
    name.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);text-align:center;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.textContent = acc.name;

    tile.appendChild(avatar);
    tile.appendChild(name);
    grid.appendChild(tile);
  });
}

// Selects an account on the login grid and shows its password-entry view.
function selectAccountForLogin(accountId) {
  _stopLockCountdown();
  _selectedLoginAccountId = accountId;
  const acc = getAccount(accountId);
  if (!acc) return;
  // Show avatar + name in login view
  const avatarEl = document.getElementById('loginAvatarDisplay');
  const nameEl   = document.getElementById('loginAccountName');
  if (avatarEl) { avatarEl.style.background = acc.color; avatarEl.textContent = '🪪'; }
  if (nameEl)   nameEl.textContent = acc.name;
  document.getElementById('loginInput').value = '';
  document.getElementById('loginError').textContent = '';
  showView('accountLoginView');
  setTimeout(() => document.getElementById('loginInput')?.focus(), 80);
}

// Verifies the entered password, derives the session key, and logs into the selected account.
async function doLogin() {
  const input = document.getElementById('loginInput');
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  const pw = input.value;
  if (!pw || !_selectedLoginAccountId) return;

  // Check brute-force lockout
  const lockRemCheck = _loginLockRemaining(_selectedLoginAccountId);
  if (lockRemCheck > 0) {
    const secs = Math.ceil(lockRemCheck / 1000);
    errorEl.textContent = '⏳ ' + tf('login.lockedFor', { s: secs });
    _startLockCountdown(_selectedLoginAccountId, errorEl, btn, input);
    return;
  }

  // UI blockieren waehrend PBKDF2 laeuft (verhindert parallele Klicks)
  if (btn) btn.disabled = true;
  input.disabled = true;

  try {
    const ok = await verifyAccountPassword(_selectedLoginAccountId, pw);
    if (ok) {
      _stopLockCountdown();
      _resetLoginFailures(_selectedLoginAccountId);
      _activeAccountId = _selectedLoginAccountId;
      setSessionPassphrase(pw);
      // CryptoKey build + Session token write (kein password in sessionStorage)
      await getCryptoKey();
      await _writeSessionToken();
      await unlockAgentSession();
      localStorage.setItem('kic_active_account', _activeAccountId);
      const durMs = getSessionDurationMs();
      if (durMs > 0) localStorage.setItem('kic_' + _activeAccountId + '_session_expiry', String(Date.now() + durMs));
      input.value = ''; errorEl.textContent = '';
      hideLoginScreen();
      await bootApp();
      toast('\ud83d\udc4b ' + (getAccount(_activeAccountId)?.name || ''));
    } else {
      _recordLoginFailure(_selectedLoginAccountId);
      const failures = _loginFailures[_selectedLoginAccountId]?.count || 0;
      const remaining = BF_MAX_ATTEMPTS - failures;
      if (remaining > 0) {
        errorEl.textContent = t('login.error') + ' (' + tf('login.attemptsLeft', { n: remaining }) + ')';
        input.value = ''; input.focus();
      } else {
        const secs = Math.ceil(_loginLockRemaining(_selectedLoginAccountId) / 1000);
        errorEl.textContent = '🔒 ' + tf('login.lockedFor', { s: secs });
        input.value = '';
        _startLockCountdown(_selectedLoginAccountId, errorEl, btn, input);
      }
    }
  } finally {
    // Only unlock if no countdown is running
    if (!_lockCountdownTimer) {
      if (btn) btn.disabled = false;
      input.disabled = false;
    }
  }
}

// Updates the password-strength indicator shown while setting a new account password.
function updatePwdStrength(pw) {
  const bar = document.getElementById('pwdStrengthBar'); if (!bar) return;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const pct = (score / 5) * 100;
  const cols = ['#e74c3c','#e74c3c','#f39c12','#f0c040','#2ecc71','#2ecc71'];
  bar.style.width = pct + '%'; bar.style.background = cols[score] || '#e74c3c';
}

// (Re)builds the color picker shown when creating a new account.
function renderNewAccountColorRow() {
  const row = document.getElementById('accountColorRow'); if (!row) return;
  row.innerHTML = '';
  const used = _accounts.map(a => a.color);
  const defaultColor = ACCOUNT_COLORS.find(c => !used.includes(c)) || ACCOUNT_COLORS[_accounts.length % ACCOUNT_COLORS.length];
  ACCOUNT_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.dataset.color = c;
    sw.style.cssText = `width:28px;height:28px;border-radius:8px;background:${c};cursor:pointer;transition:transform 0.1s,box-shadow 0.1s;flex-shrink:0;`;
    if (c === defaultColor) {
      sw.style.outline = '3px solid white';
      sw.style.outlineOffset = '2px';
      sw.dataset.selected = '1';
    }
    sw.addEventListener('click', () => {
      row.querySelectorAll('div').forEach(s => {
        s.style.outline = '';
        s.style.outlineOffset = '';
        delete s.dataset.selected;
      });
      sw.style.outline = '3px solid white';
      sw.style.outlineOffset = '2px';
      sw.dataset.selected = '1';
    });
    row.appendChild(sw);
  });
}

// Creates a new account with the entered name/color/password and logs into it.
async function doSetupPassword() {
  const nameEl   = document.getElementById('newAccountName');
  const pwdEl    = document.getElementById('setupPwdInput');
  const confEl   = document.getElementById('setupPwdConfirm');
  const errorEl  = document.getElementById('setupError');
  const name = nameEl?.value?.trim() || '';
  const pw   = pwdEl?.value || '';
  const conf = confEl?.value || '';
  if (!name) { if (errorEl) errorEl.textContent = t('js.nameRequired'); return; }
  // password length: kein Minimum enforced - strength indicator informiert den Benutzer
  if (pw !== conf) { if (errorEl) errorEl.textContent = t('js.pwdMismatch'); return; }
  // Pick selected color
  const colorRow = document.getElementById('accountColorRow');
  const selSw = colorRow?.querySelector('[data-selected]');
  const color = selSw?.dataset.color || ACCOUNT_COLORS[_accounts.length % ACCOUNT_COLORS.length];
  // Create account
  // Random part uses crypto.getRandomValues (not Math.random(), which is
  // neither cryptographically strong nor high-entropy) — 16 random bytes,
  // hex-encoded. Matters because /store/<accountId>/... on the local
  // server has no separate password check of its own (see kiconnect-proxy.py);
  // the account ID itself is the only thing standing between "just this
  // account's encrypted blob" and "any account's encrypted blob" for
  // anyone/anything else reaching localhost:5000 (e.g. another OS user on
  // a shared machine). Content stays confidential either way (it's
  // encrypted with a password-derived key), but a guessable ID would still
  // let someone overwrite/delete another account's data.
  const _idBytes = new Uint8Array(16);
  crypto.getRandomValues(_idBytes);
  const accountId = Date.now().toString() + '_' + Array.from(_idBytes, b => b.toString(16).padStart(2, '0')).join('');
  _accounts.push({ id: accountId, name, color, pwVersion: 2 });
  saveAccountRegistry();
  await storeAccountPasswordHash(accountId, pw);
  // Activate
  _activeAccountId = accountId;
  setSessionPassphrase(pw);
  // Build CryptoKey and write session token
  await getCryptoKey();
  await _writeSessionToken();
  await unlockAgentSession();
  localStorage.setItem('kic_active_account', _activeAccountId);
  const durMs = getSessionDurationMs();
  if (durMs > 0) localStorage.setItem('kic_' + _activeAccountId + '_session_expiry', String(Date.now() + durMs));
  if (pwdEl) pwdEl.value = '';
  if (confEl) confEl.value = '';
  if (nameEl) nameEl.value = '';
  if (errorEl) errorEl.textContent = '';
  localStorage.setItem(accountKey('guided_intro_pending'), '1');
  hideLoginScreen();
  await bootApp();
  toast(t('js.pwdSetupDone') || '🔐 Account created — welcome!');
}

// Explains (or triggers) the recovery flow for a forgotten account password.
async function forgotPassword() {
  if (!_selectedLoginAccountId) {
    // No account selected — just go back to account selection
    showView('accountSelectView');
    renderAccountGrid();
    return;
  }
  const acc = getAccount(_selectedLoginAccountId);
  if (!confirm(tf('account.deleteConfirm', { name: acc?.name || '' }))) return;
  // Must await: _showAccountViewAfterChange() below renders the account grid
  // from the in-memory _accounts array, which deleteAccount() only updates
  // partway through its own (async) run — without awaiting, the just-deleted
  // account would still show up until the next reload.
  await deleteAccount(_selectedLoginAccountId);
  _selectedLoginAccountId = null;
  _stopLockCountdown();
  _showAccountViewAfterChange();
}

// Permanently deletes an account and its stored data after confirmation.
async function deleteAccount(accountId) {
  // Remove all data from server store and localStorage.
  // Ask the server which keys actually exist for this account rather than
  // deleting a hardcoded list — a previous hardcoded list here was missing
  // 'profileFolders' (added later as its own save() section), which meant
  // "delete account" silently left that key's encrypted data behind on the
  // server. Falls back to a hardcoded list only if the listing call fails.
  if (_storeAvailable) {
    const serverKeys = await _storeListKeys(accountId);
    const keysToDelete = (serverKeys && serverKeys.length) ? serverKeys : [
      'config','providers','profiles','profileFolders','folders','chats',
      'current_chat','sidebar_w','sidebar_collapsed',
    ];
    await Promise.allSettled(
      keysToDelete.map(k => _storeDel(accountId, k))
    );
    // Individual key deletes above leave an empty directory behind — remove
    // the account's whole data directory too (see _storeDeleteAccountDir).
    await _storeDeleteAccountDir(accountId);
  }
  const prefix = `kic_${accountId}_`;
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
  keys.forEach(k => localStorage.removeItem(k));
  _accounts = _accounts.filter(a => a.id !== accountId);
  // Must AWAIT the registry write here (not the usual fire-and-forget
  // saveAccountRegistry()) — the caller calls logoutNow() right after this
  // returns, which re-fetches the account registry from the server for the
  // login screen. Without awaiting, that re-fetch could race the pending
  // PUT and still see the deleted account until the next reload/F5.
  await _registryPut(_accounts);
  if (_activeAccountId === accountId) {
    _activeAccountId = null;
    _cryptoKey = null;
    _sessionPassphrase = null;
    resetSaveCache(); // don't let a stale cache survive into the next account
    localStorage.removeItem('kic_active_account');
  }
  toast(t('account.deleted'));
}

// Updates the active account's display name.
function changeAccountName() {
  const input = document.getElementById('accountNameInput');
  if (!input) return;
  const newName = input.value.trim();
  if (!newName) { toast(t('js.nameRequired')); return; }
  const acc = getAccount(_activeAccountId);
  if (!acc) return;
  acc.name = newName;
  saveAccountRegistry();
  toast('✅ ' + newName);
}

// Changes the active account's login password, re-deriving and re-encrypting stored data under the new key.
async function changeLoginPassword() {
  const currentPw  = document.getElementById('currentPwdInput')?.value || '';
  const newPw      = document.getElementById('newPwdInput')?.value || '';
  const confirmPw  = document.getElementById('confirmPwdInput')?.value || '';
  if (!_activeAccountId) { toast(t('js.noActiveAccount')); return; }
  const acc = getAccount(_activeAccountId);
  if (acc?.pwHash) {
    if (!currentPw) { toast(t('js.pwdCurrentRequired')); return; }
    const ok = await verifyAccountPassword(_activeAccountId, currentPw);
    if (!ok) { toast(t('js.pwdCurrentWrong')); return; }
  }
  // password length: kein Minimum enforced - strength indicator informiert den Benutzer
  if (newPw !== confirmPw) { toast(t('js.pwdMismatch')); return; }
  await storeAccountPasswordHash(_activeAccountId, newPw);
  setSessionPassphrase(newPw);
  // Neuen CryptoKey build + Session token neu write
  await getCryptoKey();
  await _writeSessionToken();
  await rekeyAgentSession();
  await save();
  const durMs = getSessionDurationMs();
  if (durMs > 0) localStorage.setItem(`kic_${_activeAccountId}_session_expiry`, String(Date.now() + durMs));
  if (document.getElementById('currentPwdInput')) document.getElementById('currentPwdInput').value = '';
  if (document.getElementById('newPwdInput'))     document.getElementById('newPwdInput').value = '';
  if (document.getElementById('confirmPwdInput')) document.getElementById('confirmPwdInput').value = '';
  toast(t('js.pwdChanged'));
}

// Logs out of the current account, clearing the in-memory session key and returning to the login screen.
function logoutNow() {
  closePanels();
  lockAgentSession();
  if (_activeAccountId) localStorage.removeItem(`kic_${_activeAccountId}_session_expiry`);
  _activeAccountId = null;
  _cryptoKey = null;
  _sessionPassphrase = null;
  try { sessionStorage.removeItem(_SESSION_TOKEN_KEY); } catch {}
  localStorage.removeItem('kic_active_account');
  // Reset app state
  providers = []; profiles = []; profileFolders = []; folders = []; chats = []; currentChatId = null;
  config = freshConfig();
  // Hide main UI
  document.querySelector('.main')?.style.setProperty('display','none');
  document.querySelector('header')?.style.setProperty('display','none');
  showLoginScreen();
}

// Returns the configured auto-logout session duration in milliseconds.
function getSessionDurationMs() {
  const h = parseInt(document.getElementById('sessionHoursInput')?.value || '12');
  const m = parseInt(document.getElementById('sessionMinutesInput')?.value || '0');
  return (h * 60 + m) * 60 * 1000;
}
// Loads the saved session-timeout setting into the UI.
function loadSessionSettings() {
  const saved = localStorage.getItem('kic_session_duration_ms');
  if (saved) {
    const ms = parseInt(saved);
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60), m2 = totalMin % 60;
    const hi = document.getElementById('sessionHoursInput');
    const mi = document.getElementById('sessionMinutesInput');
    if (hi) hi.value = h; if (mi) mi.value = m2;
  }
}
// Persists a new auto-logout session duration.
function applySessionDuration() {
  const durMs = getSessionDurationMs();
  localStorage.setItem('kic_session_duration_ms', String(durMs));
  if (durMs > 0 && _activeAccountId) localStorage.setItem(`kic_${_activeAccountId}_session_expiry`, String(Date.now() + durMs));
  startSessionCountdown(); toast(t('settings.sessionApply') || '⏱ Applied');
}
// Resets the session inactivity timer, postponing auto-logout.
function resetSessionNow() {
  if (!_activeAccountId) { toast(t('js.noActiveAccount')); return; }
  localStorage.removeItem(`kic_${_activeAccountId}_session_expiry`);
  toast(t('js.sessionReset'));
  setTimeout(() => logoutNow(), 1200);
}

// Reset MathJax's own right-click menu settings (renderer, zoom, font
// size, accessibility options, …) back to the app defaults. MathJax stores these itself,
// separately from anything KiConnect controls, under a fixed localStorage key that is the
// same across MathJax versions. A reload is required because the output renderer is only
// picked up at startup.
function resetMathJaxSettings() {
  try { localStorage.removeItem('MathJax-Menu-Settings'); } catch (e) {}
  toast(t('js.mathResetDone'));
  setTimeout(() => location.reload(), 700);
}

let _countdownTimer = null;
// Starts the UI countdown showing time remaining before auto-logout.
function startSessionCountdown() {
  if (_countdownTimer) clearInterval(_countdownTimer);
  _countdownTimer = setInterval(updateSessionCountdown, 1000);
  updateSessionCountdown();
}
// Updates the displayed auto-logout countdown, styling it as urgent once time is running low.
function updateSessionCountdown() {
  const el = document.getElementById('sessionCountdown'); if (!el) return;
  if (!_activeAccountId) { el.textContent = '—'; el.style.color = 'var(--muted)'; return; }
  const expiry = parseInt(localStorage.getItem(`kic_${_activeAccountId}_session_expiry`) || '0');
  if (!expiry) { el.textContent = '∞'; el.style.color = 'var(--accent)'; return; }
  const remaining = expiry - Date.now();
  if (remaining <= 0) {
    el.textContent = '0:00:00'; el.style.color = 'var(--red)';
    clearInterval(_countdownTimer);
    setTimeout(() => logoutNow(), 500);
    return;
  }
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s2 = Math.floor((remaining % 60000) / 1000);
  el.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s2).padStart(2,'0')}`;
  el.style.color = remaining < 5 * 60 * 1000 ? 'var(--red)' : 'var(--accent)';
}

// Runs on startup: shows the login screen if there are no accounts, otherwise tries to restore the session from a valid token.
async function checkLogin() {
  await loadAccountRegistryAsync();
  // No accounts at all → create first account
  if (_accounts.length === 0) {
    showLoginScreen();
    return;
  }
  // F5/reload: session token check (no password in sessionStorage)
  // The token was encrypted with the CryptoKey - no decrypting without the password.
  // Approach: read account ID from localStorage, load salt, check passphrase in RAM.
  // Since RAM is empty after F5, the user must briefly re-authenticate -
  // UNLESS the token is still valid AND the CryptoKey is still in RAM (same tab session).
  const lastAccountId = localStorage.getItem('kic_active_account');
  if (lastAccountId && getAccount(lastAccountId)) {
    // Check whether a session token is present in sessionStorage (only then is it worth trying)
    if (restoreSessionPassphrase()) {
      // Validating the token requires the CryptoKey -> on F5, _cryptoKey is null.
      // We can't derive a new key without the password.
      // So: stay logged in only if _cryptoKey is still in RAM
      // (i.e. not a real reload, just internal navigation / hot-reload).
      if (_cryptoKey) {
        const tokenOk = await _validateSessionToken(lastAccountId);
        if (tokenOk) {
          const expiry = parseInt(localStorage.getItem('kic_' + lastAccountId + '_session_expiry') || '0');
          if (!expiry || Date.now() < expiry) {
            _activeAccountId = lastAccountId;
            await bootApp();
            return;
          }
        }
      }
    }
  }
  // Must log in
  showLoginScreen();
}

// ── EVENT LISTENER SETUP ────────────────────────────────────────
function setupEventListeners(){
  document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
  document.getElementById('openProviderHeaderBtn').addEventListener('click', ()=>{closePanels();openProviderPanel();});
  document.getElementById('openSettingsBtn').addEventListener('click', ()=>{closePanels();openSettings();});
  document.getElementById('openIntroBtn').addEventListener('click', ()=>startGuidedIntro(0));
  document.getElementById('openTuningBtn').addEventListener('click', ()=>{closePanels();openTuningPanel();});
  document.getElementById('openProfileHeaderBtn').addEventListener('click', ()=>{closePanels();openProfilePanel();});
  document.getElementById('openModelMaxHeaderBtn').addEventListener('click', ()=>{closePanels();openModelMaxPanel();});
  document.getElementById('langToggleBtn').addEventListener('click', toggleLangDropdown);
  document.getElementById('overlay').addEventListener('click', closePanels);

  // Tuning Panel
  document.getElementById('tuningPanelClose').addEventListener('click', closePanels);

  // Settings Panel
  document.getElementById('settingsPanelClose').addEventListener('click', closePanels);
  document.getElementById('tourSkipBtn')?.addEventListener('click', endGuidedIntro);
  document.getElementById('tourBackBtn')?.addEventListener('click', prevTourStep);
  document.getElementById('tourNextBtn')?.addEventListener('click', nextTourStep);
  window.addEventListener('resize', () => { if (_tourActive) positionTourCard(_tourTargetEl); });
  document.getElementById('goProviderFromSettings').addEventListener('click',()=>{closePanels();openProviderPanel();});
  document.getElementById('goModelLimits').addEventListener('click',()=>{closePanels();openModelMaxPanel();});
  document.getElementById('changePwdBtn').addEventListener('click', changeLoginPassword);
  document.getElementById('changeAccountNameBtn')?.addEventListener('click', changeAccountName);
  document.getElementById('accountNameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') changeAccountName(); });
  document.getElementById('deleteAccountBtn')?.addEventListener('click', async () => {
    const acc = getAccount(_activeAccountId);
    if (!confirm(tf('account.deleteConfirm', { name: acc?.name || '' }))) return;
    const box = document.getElementById('deleteAccountConfirm');
    const pwInput = document.getElementById('deleteAccountPwdInput');
    if (!box || !pwInput) { await deleteAccount(_activeAccountId); logoutNow(); return; }
    box.style.display = '';
    pwInput.value = '';
    pwInput.focus();
  });
  document.getElementById('deleteAccountCancelBtn')?.addEventListener('click', () => {
    const box = document.getElementById('deleteAccountConfirm');
    const pwInput = document.getElementById('deleteAccountPwdInput');
    if (box) box.style.display = 'none';
    if (pwInput) pwInput.value = '';
  });
  // Final, permanent step — requires the account's own password (unlike the
  // plain confirm() above, which only guards against accidental clicks).
  async function _confirmDeleteAccount() {
    const acc = getAccount(_activeAccountId);
    if (!acc) return;
    const pwInput = document.getElementById('deleteAccountPwdInput');
    const pw = pwInput?.value || '';
    if (acc.pwHash) {
      const ok = await verifyAccountPassword(_activeAccountId, pw);
      if (!ok) { toast(t('js.pwdCurrentWrong')); return; }
    }
    const box = document.getElementById('deleteAccountConfirm');
    if (box) box.style.display = 'none';
    if (pwInput) pwInput.value = '';
    await deleteAccount(_activeAccountId);
    logoutNow();
  }
  document.getElementById('deleteAccountConfirmBtn')?.addEventListener('click', _confirmDeleteAccount);
  document.getElementById('deleteAccountPwdInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _confirmDeleteAccount();
  });
  document.getElementById('applySessionBtn').addEventListener('click', applySessionDuration);
  document.getElementById('resetSessionBtn').addEventListener('click', resetSessionNow);
  document.getElementById('resetMathJaxBtn')?.addEventListener('click', resetMathJaxSettings);
  document.getElementById('logoutBtn').addEventListener('click', logoutNow);

  // auto-save every tuning field on change, no explicit Save button needed
  document.getElementById('temperature').addEventListener('input', e=>{
    document.getElementById('tempVal').textContent=e.target.value;
    config.temperature = parseFloat(e.target.value);
    const p = activeProfile();
    if (p) p.temperature = config.temperature;
    scheduleTuningSave();
  });
  document.getElementById('systemPrompt')?.addEventListener('input', e=>{
    config.systemPrompt = e.target.value;
    const p = activeProfile();
    if (p) p.systemPrompt = config.systemPrompt;
    scheduleTuningSave();
  });
  document.getElementById('modelInput')?.addEventListener('change', e=>{
    if (e.target.value) { config.model = e.target.value; scheduleTuningSave(); }
  });
  document.getElementById('maxImgSizeInput')?.addEventListener('input', e=>{
    const kb = parseInt(e.target.value);
    if (kb >= 100) setMaxImageStorageBytes(kb * 1024);
  });
  document.getElementById('webSearchApiKey')?.addEventListener('input', e=>{
    config.webSearchApiKey = e.target.value.trim();
    scheduleTuningSave();
  });
  document.getElementById('chatWidthSlider').addEventListener('input', e=>{ applyChatWidth(e.target.value); scheduleTuningSave(); });
  document.getElementById('webSearchCount')?.addEventListener('input', e=>{
    document.getElementById('webSearchCountVal').textContent=e.target.value;
    config.webSearchResultCount = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(e.target.value) || 8));
    syncWebContextPopover();
    scheduleTuningSave();
  });
  document.getElementById('webSearchMode')?.addEventListener('change', e=>{
    config.webSearchMode = e.target.value || 'manual';
    if(config.webSearchMode==='off') config.webSearchEnabled=false;
    updateWebSearchButton();
    save();
  });
  document.getElementById('webSearchEngine')?.addEventListener('change', e=>{
    config.webSearchEngine = e.target.value || 'free';
    updateWebSearchKeyUI(config.webSearchEngine);
    save();
  });

  // Audio (TTS/STT providers)
  document.getElementById('ttsProviderSelect')?.addEventListener('change', e=>{
    const provider = e.target.value || 'browser';
    window.kicVoiceSetSetting?.('ttsProvider', provider);
    updateAudioProviderKeyUI();
    save();
  });
  // Shared body for the TTS/STT API-key inputs below: saves the typed key
  // under audioProviders[<selected provider>].apiKey.
  function _bindAudioApiKeyInput(inputId, selectId, defaultProvider) {
    document.getElementById(inputId)?.addEventListener('input', e => {
      const provider = document.getElementById(selectId)?.value || defaultProvider;
      config.audioProviders = config.audioProviders || {};
      config.audioProviders[provider] = config.audioProviders[provider] || {};
      config.audioProviders[provider].apiKey = e.target.value.trim();
      scheduleTuningSave();
    });
  }
  _bindAudioApiKeyInput('ttsApiKey', 'ttsProviderSelect', 'openai');
  document.getElementById('ttsVoiceId')?.addEventListener('input', e=>{
    config.audioProviders = config.audioProviders || {};
    config.audioProviders.elevenlabs = config.audioProviders.elevenlabs || {};
    config.audioProviders.elevenlabs.voiceId = e.target.value.trim();
    scheduleTuningSave();
  });
  document.getElementById('sttProviderSelect')?.addEventListener('change', e=>{
    const provider = e.target.value || 'browser';
    window.kicVoiceSetSetting?.('sttProvider', provider);
    updateAudioProviderKeyUI();
    save();
  });
  _bindAudioApiKeyInput('sttApiKey', 'sttProviderSelect', 'groq');

  // Thinking Toggle
  document.getElementById('thinkingToggle').addEventListener('click', toggleThinking);
  document.getElementById('thinkingIntensitySlider').addEventListener('input', e=>{
    const{modelId}=splitModelId(config.model);
    // Legacy Claude 3.7 uses a token-budget slider; adaptive Claude 4+ and all other
    // thinking models use a 3-step effort slider writing to thinkingIntensity.
    if(usesTokenBudget(modelId) && !isAdaptiveThinkingModel(modelId)){
      config.thinkingBudget=parseInt(e.target.value);
    } else {
      config.thinkingIntensity=parseInt(e.target.value);
    }
    updateThinkingIntensityUI(); save();
  });

  // Provider Panel
  document.getElementById('providerPanelClose').addEventListener('click', closePanels);
  document.getElementById('addProviderBtn').addEventListener('click', startNewProvider);
  document.getElementById('saveProviderBtn').addEventListener('click', saveProviderEditor);
  document.getElementById('cancelProviderBtn').addEventListener('click', cancelProviderEditor);
  // CSP deliberately disallows inline event handlers; bind embedding editor
  // controls here together with the rest of the provider panel controls.
  document.getElementById('pvEmbedModelLoadBtn').addEventListener('click', loadEmbeddingModelCandidates);
  document.getElementById('pvEmbedModelTestBtn').addEventListener('click', testEmbeddingModel);
  document.querySelectorAll('.type-chip').forEach(chip=>{chip.addEventListener('click',()=>selectProviderType(chip.dataset.type));});

  // Profile Panel
  document.getElementById('profilePanelClose').addEventListener('click', closePanels);
  document.getElementById('addProfileBtn').addEventListener('click', startNewProfile);
  document.getElementById('addProfileFolderBtn')?.addEventListener('click', newProfileFolder);
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfileEditor);
  document.getElementById('cancelProfileBtn').addEventListener('click', cancelProfileEditor);
  document.getElementById('peTemp').addEventListener('input', e=>{document.getElementById('peTempVal').textContent=e.target.value;});
  document.getElementById('peUseModelMax').addEventListener('change', updatePeMaxTokensUI);
  document.getElementById('peMaxTokensSlider').addEventListener('input', e=>{document.getElementById('peMaxTokensNum').textContent=parseInt(e.target.value).toLocaleString();});

  // Model Limits Panel
  document.getElementById('modelMaxPanelClose').addEventListener('click', closePanels);
  document.getElementById('resetAllModelMaxBtn').addEventListener('click', resetAllModelMax);

  // Sidebar
  document.getElementById('newChatBtn').addEventListener('click',()=>newChat());
  document.getElementById('newFolderBtn').addEventListener('click', newFolder);
  document.getElementById('copyFullChatBtn').addEventListener('click', copyFullChat);
  document.getElementById('printFullChatBtn').addEventListener('click', printFullChat);

  // Print-Single-Bubble Overlay
  document.getElementById('printSingleConfirm')?.addEventListener('click', printSingleBubble);
  document.getElementById('printSingleClose')?.addEventListener('click', closePrintSingleOverlay);
  document.getElementById('printSingleOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('printSingleOverlay')) closePrintSingleOverlay();
  });

  // Chat Area
  const chatArea=document.getElementById('chatArea');
  chatArea.addEventListener('dragenter', handleDragEnter);
  chatArea.addEventListener('dragover', handleDragOver);
  chatArea.addEventListener('dragleave', handleDragLeave);
  chatArea.addEventListener('drop', handleDrop);

  // Input
  document.getElementById('sendBtn').addEventListener('click', handleSendStop);
  document.getElementById('messageInput').addEventListener('keydown', handleKey);
  document.getElementById('messageInput').addEventListener('input', e=>{ autoResize(e.target); renderDetectedLinks(); updateWebSearchButton(); });
  document.addEventListener('click', handleExternalLinkClick);
  document.getElementById('messageInput').addEventListener('paste', handlePaste);
  document.getElementById('attachFileBtn').addEventListener('click',()=>document.getElementById('fileInput').click());
  document.getElementById('attachImageBtn').addEventListener('click',()=>document.getElementById('imageInput').click());
  document.getElementById('clearAttachBtn').addEventListener('click', clearAttachments);
  document.getElementById('webSearchBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleWebContextPopover();
  });
  document.getElementById('webContextPopover')?.addEventListener('click', e => e.stopPropagation());
  document.getElementById('webSearchToggle')?.addEventListener('click', toggleWebSearch);
  document.getElementById('webAgenticToggle')?.addEventListener('click', () => {
    if (isAgenticWebMode()) {
      config.webSearchMode = 'manual';
    } else {
      config.webSearchMode = 'agentic';
      config.webSearchEnabled = false; // agentic mode replaces the manual per-message toggle
    }
    save();
    updateWebSearchButton();
    toast(isAgenticWebMode() ? '🕵🏻🌐 (✔️)' : '🕵🏻⛔');
  });
  document.getElementById('webLinkToggle')?.addEventListener('click', () => {
    config.webLinkEnabled = !config.webLinkEnabled;
    if (!config.webLinkEnabled) {
      selectedLinkUrls.clear();
      ignoredLinkUrls.clear();
    }
    save();
    updateWebSearchButton();
    toast(tf('web.linkReadingToast', { state: config.webLinkEnabled ? t('web.on') : t('web.off') }));
  });
  document.getElementById('webContextCount')?.addEventListener('input', e => {
    config.webSearchResultCount = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(e.target.value) || 8));
    const settingsCount = document.getElementById('webSearchCount');
    if (settingsCount) settingsCount.value = config.webSearchResultCount;
    const settingsVal = document.getElementById('webSearchCountVal');
    if (settingsVal) settingsVal.textContent = config.webSearchResultCount;
    save();
    syncWebContextPopover();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest?.('#webContextWrap')) toggleWebContextPopover(false);
  });
  document.getElementById('fileInput').addEventListener('change', handleFileAttach);
  document.getElementById('imageInput').addEventListener('change', handleImageAttach);
  // Edit-mode file inputs (hidden inputs for adding files while editing a bubble)
  const editFileInput = document.getElementById('editFileInput');
  const editImageInput = document.getElementById('editImageInput');
  if (editFileInput)  editFileInput.addEventListener('change',  handleEditFileAttach);
  if (editImageInput) editImageInput.addEventListener('change', handleEditImageAttach);

  // Global paste (outside textarea)
  document.addEventListener('paste', e=>{
    if(document.activeElement!==document.getElementById('messageInput')){
      handlePaste(e);
    }
  });

  // Login / Account system
  document.getElementById('loginBtn')?.addEventListener('click', doLogin);
  document.getElementById('loginInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('forgotPwdBtn')?.addEventListener('click', forgotPassword);
  document.getElementById('setupBtn')?.addEventListener('click', doSetupPassword);
  document.getElementById('setupPwdInput')?.addEventListener('input', e => updatePwdStrength(e.target.value));
  document.getElementById('setupPwdInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('setupPwdConfirm')?.focus(); });
  document.getElementById('setupPwdConfirm')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSetupPassword(); });
  document.getElementById('showNewAccountBtn')?.addEventListener('click', () => {
    // Clear form
    const nameEl = document.getElementById('newAccountName');
    const pwdEl  = document.getElementById('setupPwdInput');
    const confEl = document.getElementById('setupPwdConfirm');
    const errEl  = document.getElementById('setupError');
    if (nameEl) nameEl.value = '';
    if (pwdEl)  pwdEl.value  = '';
    if (confEl) confEl.value = '';
    if (errEl)  errEl.textContent = '';
    const bar = document.getElementById('pwdStrengthBar');
    if (bar) { bar.style.width = '0%'; }
    renderNewAccountColorRow();
    showView('newAccountView');
    setTimeout(() => nameEl?.focus(), 80);
  });
  document.getElementById('backToAccountsBtn')?.addEventListener('click', () => { _selectedLoginAccountId = null; showView('accountSelectView'); renderAccountGrid(); });
  document.getElementById('backFromNewAccountBtn')?.addEventListener('click', () => {
    if (_accounts.length > 0) { showView('accountSelectView'); renderAccountGrid(); }
    // else: can't go back — no accounts yet, stay on create view
  });
  document.getElementById('newAccountName')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('setupPwdInput')?.focus(); });

  // Suggestion Chips
  const suggestions=[
    {i18n:'empty.quantum',msgKey:'empty.quantumMsg'},
    {i18n:'empty.python',msgKey:'empty.pythonMsg'},
    {i18n:'empty.mlvsdl',msgKey:'empty.mlvsdlMsg'},
    {i18n:'empty.integral',msgKey:'empty.integralMsg'},
  ];
  const chipsContainer=document.getElementById('suggestionChips');
  suggestions.forEach(s=>{
    const chip=document.createElement('div');chip.className='suggestion-chip';chip.textContent=t(s.i18n);chip.dataset.msgKey=s.msgKey;
    chip.addEventListener('click',()=>sendSuggestion(t(chip.dataset.msgKey)));
    chipsContainer.appendChild(chip);
  });

  // Observer: Code-Copy-Buttons in neuen Nachrichten verdrahten
  const messagesContainer=document.getElementById('messages');
  const observer=new MutationObserver(mutations=>{
    mutations.forEach(m=>m.addedNodes.forEach(node=>{if(node.nodeType===1)wireCodeCopyButtons(node);}));
  });
  observer.observe(messagesContainer,{childList:true,subtree:true});
}

// ── PRINT — Full chat & single bubble ───────────────────────────

// Opens the browser print dialog for the entire active chat.
function printFullChat() {
  const chat = currentChat();
  if (!chat || !chat.messages.length) { toast(t('js.noChatToPrint')); return; }
  const titleEl = document.getElementById('printChatTitle');
  if (titleEl) {
    const date = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
    titleEl.textContent = `${chat.title}  —  ${date}`;
  }
  // Wait for typeset THEN fonts.ready (sequential, not parallel - typeset
  // discovers font chunks it needs as it goes, so fonts.ready must wait
  // until that's fully done, or a late chunk can print as a fallback glyph).
  const doPrint = () => window.print();
  if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetPromise()
      .then(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve())
      .then(doPrint)
      .catch(doPrint);
  } else {
    doPrint();
  }
}

let _printSingleIdx = null; // index of the bubble currently being printed

// Opens the single-message print preview overlay by cloning the message's
// already-rendered .bubble (and its .note-print) live out of the chat,
// instead of re-formatting msg.content from scratch. Keeps preview/print in
// sync with current collapse/expand state, needs no MathJax re-typeset, and
// keeps note styling consistent with the full-chat print.
function openPrintSingleOverlay(idx) {
  idx = safeIdx(idx); if (idx === null) return;
  const chat = currentChat(); if (!chat) return;
  const msg = getActivePath(chat)[idx]; if (!msg) return;
  const row = getBubbleRow(idx); if (!row) return;
  const liveBubble = row.querySelector('.bubble');
  const liveNote = row.querySelector('.note-print');
  if (!liveBubble) return;

  _printSingleIdx = idx;

  // Meta line (role + date)
  const role = msg.role === 'user' ? 'Du' : (splitModelId(msg._model || config.model).modelId || 'KI');
  const date = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const metaEl = document.getElementById('printSingleMeta');
  if (metaEl) metaEl.textContent = `${role} · ${date}`;

  // Live clone so collapse/expand state carries over; re-wire buttons
  // since cloneNode() doesn't copy event listeners.
  const contentEl = document.getElementById('printSingleContent');
  if (contentEl) {
    contentEl.innerHTML = '';
    const clone = liveBubble.cloneNode(true);
    clone.classList.remove('streaming');
    while (clone.firstChild) contentEl.appendChild(clone.firstChild);
    wireCodeCopyButtons(contentEl);
  }

  const noteEl = document.getElementById('printSingleNote');
  if (noteEl) {
    noteEl.innerHTML = liveNote ? liveNote.innerHTML : '';
    noteEl.dataset.label = (liveNote && liveNote.dataset.label) || t('js.noteLabel');
  }

  document.getElementById('printSingleOverlay')?.classList.add('show');
}

// Closes the single-message print preview overlay.
function closePrintSingleOverlay() {
  _printSingleIdx = null;
  document.getElementById('printSingleOverlay')?.classList.remove('show');
}

// Opens the browser print dialog for a single message.
// Prints the MAIN window (via body.printing-single-bubble - see
// kiconnect.css @media print), not a popup with its own MathJax instance
// like before - that had to re-typeset/re-fetch fonts from scratch, and if
// a chunk wasn't ready in time, printed a wrong-but-plausible-looking
// glyph instead of a tofu box (e.g. "ox" -> "ax", "2" -> "m"). Printing the
// main window reuses fonts already loaded and typeset, same as
// printFullChat() above.
function printSingleBubble() {
  if (_printSingleIdx === null) return;

  document.body.classList.add('printing-single-bubble');
  const doPrint = () => {
    window.print();
    document.body.classList.remove('printing-single-bubble');
    closePrintSingleOverlay();
  };
  // Content is already-typeset (cloned live bubble), so no typesetPromise()
  // needed - just wait for fonts.ready defensively before printing.
  ((document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve())
    .then(doPrint)
    .catch(doPrint);
}

// ── INIT ────────────────────────────────────────────────────────
(async()=>{
  // Hide main UI immediately — show only after successful login
  document.querySelector('.main')?.style.setProperty('display','none');
  document.querySelector('header')?.style.setProperty('display','none');
  setupEventListeners();
  applyTranslations();
  loadSessionSettings();
  await checkLogin();
})();

// bootApp: called after successful login to initialize the full UI
async function bootApp() {
  // Show the main UI now that we're authenticated
  const mainEl = document.querySelector('.main');
  const headerEl = document.querySelector('header');
  if (mainEl) mainEl.style.display = '';
  if (headerEl) headerEl.style.display = '';

  await load();
  applyTranslations();
  updateProfileBadge();
  syncSettingsPanel();
  loadSessionSettings();
  if (config.chatMaxWidth) applyChatWidth(config.chatMaxWidth);
  applyTheme(localStorage.getItem('kic_theme') || 'dark');
  if (config.thinkingEnabled) {
    document.getElementById('thinkingToggle')?.classList.add('active');
    document.getElementById('thinkingIntensity')?.classList.add('visible');
  }
  if (config.thinkingIntensity) {
    const slider = document.getElementById('thinkingIntensitySlider');
    if (slider) slider.value = config.thinkingIntensity;
  }
  if (!folders.length) { folders.push({ id:'default', name:'Default', collapsed:false }); save(); }
  if (!chats.length) { newChat(); }
  else {
    // If the saved currentChatId doesn't exist, use the first chat
    if (!currentChatId || !chats.find(c => c.id === currentChatId)) {
      currentChatId = chats[0].id;
    }
    activeFolderId = currentChat()?.folderId || null;
    renderSidebar();
    renderMessages(currentChat()?.messages || []);
  }
  if (providers.length && providers.some(p => p.apiKey)) fetchModels();
  else openProviderPanel();
  startSessionCountdown();
  if (shouldAutoStartGuidedIntro()) {
    setTimeout(() => startGuidedIntro(), 350);
  }
}

// ── Custom Model Dropdown ─────────────────────────────────────────
(function(){
  const trigger=document.getElementById('cmTrigger');
  const panel=document.getElementById('cmPanel');
  const list=document.getElementById('cmList');
  const search=document.getElementById('cmSearch');
  const label=document.getElementById('cmLabel');
  const hiddenSel=document.getElementById('modelSelector');
  let open=false;
  window._cmData=[];

  function positionPanel(){
    // Use rAF so Firefox completes its reflow before measuring getBoundingClientRect
    requestAnimationFrame(()=>{
      const rect=trigger.getBoundingClientRect();
      const vh=window.innerHeight;
      const spaceBelow=vh-rect.bottom-8;const spaceAbove=rect.top-8;
      const maxH=Math.min(380,Math.max(spaceBelow,spaceAbove)-8);
      panel.style.maxHeight=maxH+'px';panel.style.left=rect.left+'px';
      panel.style.width=Math.max(rect.width,260)+'px';
      if(spaceBelow>=180||spaceBelow>=spaceAbove){panel.style.top=(rect.bottom+4)+'px';panel.style.bottom='auto';}
      else{panel.style.bottom=(vh-rect.top+4)+'px';panel.style.top='auto';}
    });
  }

  function renderList(filter){
    const q=(filter||'').toLowerCase();
    list.innerHTML='';let count=0;
    window._cmData.forEach(group=>{
      const items=group.items.filter(m=>!q||m.label.toLowerCase().includes(q));
      if(!items.length)return;
      const gl=document.createElement('div');gl.className='cm-group-label';gl.textContent=group.group;list.appendChild(gl);
      items.forEach(m=>{
        const opt=document.createElement('div');
        opt.className='cm-option'+(m.value===hiddenSel.value?' selected':'');
        opt.textContent=m.label;opt.title=m.label;
        opt.addEventListener('click',()=>{hiddenSel.value=m.value;hiddenSel.dispatchEvent(new Event('change'));closePanel();});
        list.appendChild(opt);count++;
      });
    });
    if(!count){const em=document.createElement('div');em.className='cm-empty';em.textContent=typeof t==='function'?t('js.noModelFound'):'No model found';list.appendChild(em);}
  }

  function openPanel(){
    if(open)return;open=true;trigger.classList.add('open');panel.classList.add('open');
    positionPanel();renderList('');search.value='';search.focus();
    const sel=list.querySelector('.selected');if(sel)setTimeout(()=>sel.scrollIntoView({block:'nearest'}),30);
  }
  function closePanel(){
    if(!open)return;open=false;trigger.classList.remove('open');panel.classList.remove('open');
  }

  trigger.addEventListener('click',e=>{e.stopPropagation();open?closePanel():openPanel();});
  search.addEventListener('input',()=>renderList(search.value));
  search.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closePanel();trigger.focus();}
    if(e.key==='ArrowDown'){const first=list.querySelector('.cm-option');if(first){first.focus();e.preventDefault();}}
  });
  list.addEventListener('keydown',e=>{if(e.key==='Escape'){closePanel();trigger.focus();}});
  document.addEventListener('click',e=>{if(!panel.contains(e.target)&&e.target!==trigger)closePanel();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closePanel();});
  window.addEventListener('resize',()=>{if(open)positionPanel();});
  window.addEventListener('scroll',()=>{if(open)positionPanel();},true);

  window.syncCustomDropdown=function(){
    const val=hiddenSel.value;
    const opt=hiddenSel.options[hiddenSel.selectedIndex];
    label.textContent=opt?opt.textContent:(typeof t==='function'?t('js.selectModel'):'— Select model —');
    if(!val)label.textContent=(typeof t==='function'?t('js.selectModel'):'— Open settings —');
    if(open)renderList(search.value);
  };
  window.buildCustomDropdownData=function(){
    const data=[];
    Array.from(hiddenSel.children).forEach(child=>{
      if(child.tagName==='OPTGROUP'){
        const group={group:child.label,items:[]};
        Array.from(child.children).forEach(opt=>{group.items.push({value:opt.value,label:opt.textContent});});
        data.push(group);
      } else if(child.tagName==='OPTION'&&child.value){
        let last=data[data.length-1];
        if(!last||last.group!==''){last={group:'',items:[]};data.push(last);}
        last.items.push({value:child.value,label:child.textContent});
      }
    });
    window._cmData=data;window.syncCustomDropdown();
  };
})();

// ── Battle-Modus composer popover ──────────────────────────
// Multi-select checkbox list for picking the 2-4 models a battle runs
// against, built from the same window._cmData the custom model dropdown
// above already maintains — no separate data source to keep in sync.
(function () {
  const toggleBtn = document.getElementById('battleToggleBtn');
  const popover = document.getElementById('battlePopover');
  const titleEl = document.getElementById('battlePopoverTitle');
  const searchEl = document.getElementById('battleSearch');
  const listEl = document.getElementById('battleModelList');
  if (!toggleBtn || !popover || !listEl) return;
  const MAX_BATTLE_MODELS = 4;
  let open = false;

  function refreshToggleUI() {
    toggleBtn.classList.toggle('active', battleModeActive && battleSelectedModels.length >= 2);
    toggleBtn.title = bt('battle.toggleTitle');
  }

  // filter: lowercase search string, matched against each model's label —
  // useful once a provider list is large enough to scroll (see chat
  // feedback). Already-checked models stay checked while filtered out of
  // view (state lives in battleSelectedModels, not in the filtered DOM).
  function renderList(filter) {
    const q = (filter || '').trim().toLowerCase();
    titleEl.textContent = bt('battle.pickModels');
    if (searchEl) searchEl.placeholder = bt('battle.searchPlaceholder');
    listEl.innerHTML = '';
    const groups = window._cmData || [];
    let shown = 0;
    groups.forEach(group => {
      const items = group.items.filter(m => !q || m.label.toLowerCase().includes(q));
      if (!items.length) return;
      if (group.group) {
        const gl = document.createElement('div');
        gl.className = 'battle-model-group-label';
        gl.textContent = group.group;
        listEl.appendChild(gl);
      }
      items.forEach(m => {
        const row = document.createElement('label');
        row.className = 'battle-model-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = m.value;
        cb.checked = battleSelectedModels.includes(m.value);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            if (battleSelectedModels.length >= MAX_BATTLE_MODELS) {
              cb.checked = false;
              toast(bt('battle.tooManyModels'));
              return;
            }
            battleSelectedModels.push(m.value);
          } else {
            battleSelectedModels = battleSelectedModels.filter(v => v !== m.value);
          }
          battleModeActive = battleSelectedModels.length >= 2;
          refreshToggleUI();
        });
        const span = document.createElement('span');
        span.textContent = m.label;
        row.appendChild(cb); row.appendChild(span);
        listEl.appendChild(row);
        shown++;
      });
    });
    if (!shown) {
      const em = document.createElement('div');
      em.className = 'battle-model-empty';
      em.textContent = bt('battle.noModelFound');
      listEl.appendChild(em);
    }
  }

  function openPopover() {
    open = true; popover.hidden = false;
    if (searchEl) searchEl.value = '';
    renderList('');
    if (searchEl) searchEl.focus();
  }
  function closePopover() { open = false; popover.hidden = true; }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    open ? closePopover() : openPopover();
  });
  if (searchEl) {
    searchEl.addEventListener('input', () => renderList(searchEl.value));
    searchEl.addEventListener('click', (e) => e.stopPropagation());
    searchEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { closePopover(); toggleBtn.focus(); }
    });
  }
  document.addEventListener('click', (e) => { if (open && !popover.contains(e.target) && e.target !== toggleBtn) closePopover(); });
  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') closePopover(); });

  refreshToggleUI();
})();
