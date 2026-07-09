// ================================================================
// kiconnect.js  –  KI Connect application logic
// Requires: kiconnect-languages-i18n.js (loaded before this file)
// ================================================================

// ── Theme ─────────────────────────────────────────────────────────
const THEMES = ['dark', 'white', 'nord', 'dracula', 'forest', 'mocha', 'rose', 'solarized', 'dark_oled', 'gold_oled', 'emerald_oled', 'red_oled'];

// Applies a theme by name to the document root and updates the active theme swatch; falls back to 'dark' if the name is unknown.
function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'dark';
  document.documentElement.setAttribute('data-theme', name);
  // Update swatch active states
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.getAttribute('data-theme') === name);
  });
}

// Applies a theme and persists the choice to localStorage.
function setTheme(name) {
  applyTheme(name);
  localStorage.setItem('kic_theme', name);
}

// Apply saved theme immediately (before DOMContentLoaded to avoid flash)
(function() {
  const saved = localStorage.getItem('kic_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();


let currentLang = localStorage.getItem('kic_lang') || 'en';

// Looks up a translation string for the current language, falling back to English then to the raw key.
function t(key) {
  const lang = TRANSLATIONS[currentLang] || TRANSLATIONS['en'];
  return lang[key] ?? TRANSLATIONS['en'][key] ?? key;
}
// Like t(), but also substitutes {placeholder} variables in the translated string.
function tf(key, vars) {
  let s = t(key);
  if (vars) Object.entries(vars).forEach(([k,v]) => { s = s.replaceAll(`{${k}}`, v); });
  return s;
}
// Re-applies all data-i18n text/placeholder/title attributes on the page for the current language.
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
  document.documentElement.dir = ['ar', 'ur'].includes(currentLang) ? 'rtl' : 'ltr';
  document.documentElement.lang = currentLang;
  if (typeof syncCustomDropdown === 'function') {
    const hiddenSel = document.getElementById('modelSelector');
    if (hiddenSel && !hiddenSel.value) syncCustomDropdown();
  }
}
// Switches the active UI language, persists it, and refreshes every language-dependent UI part (bubbles, chips, tour, dropdown, sidebar).
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
  if (typeof renderSidebar === 'function') renderSidebar();
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
      'copy': 'js.copy', 'edit': 'js.edit', 'branch': 'js.branch',
      'regenerate': 'js.regenerate', 'delete': 'js.delete'
    };
    if (keyMap[action]) btn.textContent = t(keyMap[action]);
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
const PROVIDER_TYPES = {
  'openai-compat':   { label:'OpenAI-kompatibel',    needsUrl:true  },
  'kiconnect-nrw':   { label:'KiConnect NRW',         needsUrl:false },
  'anthropic':       { label:'Anthropic (Claude)',    needsUrl:false },
  'openai-direct':   { label:'OpenAI direkt',         needsUrl:false },
  'openrouter':    { label:'OpenRouter',         needsUrl:false },
  'mistral':       { label:'Mistral AI',         needsUrl:false },
  'gemini':        { label:'Google Gemini',      needsUrl:false },
  'xai':           { label:'xAI Grok',           needsUrl:false },
  'groq':          { label:'Groq',               needsUrl:false },
  'deepseek':      { label:'DeepSeek',           needsUrl:false },
  'minimax':       { label:'MiniMax',            needsUrl:false },
  'glm':           { label:'GLM (z.ai)',         needsUrl:false },
};
const PROVIDER_HINTS = {
  'openai-compat':  '💡 Server URL + opt. API Key · for LM Studio, Ollama, custom instances …',
  'kiconnect-nrw':  '💡 API Key : chat.kiconnect.nrw · KI Connect NRW · OpenAI-compatible',
  'anthropic':      '💡 API Key : console.anthropic.com · 🧠 Extended Thinking Claude 3.7+/4',
  'openai-direct': '💡 API Key : platform.openai.com · 🧠 Reasoning  o1/o3/o4',
  'openrouter':    '💡 API Key : openrouter.ai · 200+ models loaded live · 🧠 Thinking for reasoning models',
  'mistral':       '💡 API Key : console.mistral.ai · Models are loaded live',
  'gemini':        '💡 API Key : aistudio.google.com (AI Studio) · Models are loaded live',
  'xai':           '💡 API Key : console.x.ai · Grok 3 with optional 🧠 Thinking',
  'groq':          '💡 API Key : console.groq.com · Ultra-fast inference · Models live',
  'deepseek':      '💡 API Key : platform.deepseek.com · Models loaded live, reasoning for R1',
  'minimax':       '💡 API Key : platform.minimax.io · OpenAI-compatible · Models loaded live',
  'glm':           '💡 API Key : z.ai · OpenAI-compatible · 🧠 Thinking for GLM models',
};
// Static entries only needed for providers that don't expose live model metadata
// (e.g. OpenRouter labels). Anthropic + Claude patterns are handled by regex in isThinkingCapable().
const THINKING_MODELS = new Set([
  'o1','o1-mini','o1-pro','o3','o3-mini','o4-mini','o4-mini-high',
  'gpt-4.5-preview','gpt-4.1','gpt-4.1-mini',
]);

// KNOWN_MODELS: used only as metadata fallback (maxOutput, vision) when the live API
// doesn't provide these values. The display list is always built dynamically from fetchModels().
const KNOWN_MODELS = {
  'claude-opus-4-6':            { label:'Claude Opus 4.6',           maxOutput:32000,  vision:true  },
  'claude-sonnet-4-6':          { label:'Claude Sonnet 4.6',         maxOutput:64000,  vision:true  },
  'claude-haiku-4-5-20251001':  { label:'Claude Haiku 4.5',          maxOutput:16000,  vision:true  },
  'claude-3-7-sonnet-20250219': { label:'Claude 3.7 Sonnet',         maxOutput:64000,  vision:true  },
  'claude-3-5-sonnet-20241022': { label:'Claude 3.5 Sonnet',         maxOutput:8096,   vision:true  },
  'claude-3-5-haiku-20241022':  { label:'Claude 3.5 Haiku',          maxOutput:8096,   vision:true  },
  'claude-3-opus-20240229':     { label:'Claude 3 Opus',             maxOutput:4096,   vision:true  },
  'gpt-4.1':                    { label:'GPT-4.1',                   maxOutput:32768,  vision:true  },
  'gpt-4.1-mini':               { label:'GPT-4.1 mini',              maxOutput:32768,  vision:true  },
  'gpt-4.1-nano':               { label:'GPT-4.1 nano',              maxOutput:32768,  vision:true  },
  'gpt-4o':                     { label:'GPT-4o',                    maxOutput:16384,  vision:true  },
  'gpt-4o-mini':                { label:'GPT-4o mini',               maxOutput:16384,  vision:true  },
  'gpt-4o-search-preview':      { label:'GPT-4o Search Preview',     maxOutput:16384,  vision:true  },
  'gpt-4.5-preview':            { label:'GPT-4.5 Preview',           maxOutput:16384,  vision:true  },
  'gpt-4-turbo':                { label:'GPT-4 Turbo',               maxOutput:4096,   vision:true  },
  'o4-mini':                    { label:'o4-mini (Thinking)',         maxOutput:100000, vision:true  },
  'o4-mini-high':               { label:'o4-mini high (Thinking)',    maxOutput:100000, vision:true  },
  'o3':                         { label:'o3 (Thinking)',              maxOutput:100000, vision:true  },
  'o3-mini':                    { label:'o3-mini (Thinking)',         maxOutput:100000, vision:false },
  'o1':                         { label:'o1 (Thinking)',              maxOutput:32768,  vision:false },
  'o1-mini':                    { label:'o1-mini (Thinking)',         maxOutput:65536,  vision:false },
  'o1-pro':                     { label:'o1-pro (Thinking)',          maxOutput:32768,  vision:false },
  'mistral-large-latest':       { label:'Mistral Large',             maxOutput:131072, vision:true  },
  'mistral-medium-latest':      { label:'Mistral Medium',            maxOutput:131072, vision:false },
  'mistral-small-latest':       { label:'Mistral Small',             maxOutput:131072, vision:true  },
  'codestral-latest':           { label:'Codestral',                 maxOutput:131072, vision:false },
  'mistral-nemo':               { label:'Mistral Nemo',              maxOutput:131072, vision:false },
  'gemini-2.0-flash':           { label:'Gemini 2.0 Flash',          maxOutput:8192,   vision:true  },
  'gemini-2.0-flash-lite':      { label:'Gemini 2.0 Flash Lite',     maxOutput:8192,   vision:true  },
  'gemini-2.5-pro-preview-05-06':{ label:'Gemini 2.5 Pro',           maxOutput:65536,  vision:true  },
  'gemini-1.5-pro':             { label:'Gemini 1.5 Pro',            maxOutput:8192,   vision:true  },
  'gemini-1.5-flash':           { label:'Gemini 1.5 Flash',          maxOutput:8192,   vision:true  },
  'grok-3':                     { label:'Grok 3',                    maxOutput:131072, vision:true  },
  'grok-3-mini':                { label:'Grok 3 Mini',               maxOutput:131072, vision:false },
  'grok-2-1212':                { label:'Grok 2',                    maxOutput:131072, vision:true  },
  'llama-3.3-70b-versatile':    { label:'Llama 3.3 70B',             maxOutput:32768,  vision:false },
  'llama-3.1-8b-instant':       { label:'Llama 3.1 8B',              maxOutput:8000,   vision:false },
  'llama3-70b-8192':            { label:'Llama 3 70B',               maxOutput:8192,   vision:false },
  'mixtral-8x7b-32768':         { label:'Mixtral 8x7B',              maxOutput:32768,  vision:false },
  'gemma2-9b-it':               { label:'Gemma 2 9B',                maxOutput:8192,   vision:false },
  'deepseek-r1-distill-llama-70b':{ label:'DeepSeek R1 Distill 70B 🧠', maxOutput:8000, vision:false },
  'deepseek-chat':              { label:'DeepSeek V3',               maxOutput:8192,   vision:false },
  'deepseek-reasoner':          { label:'DeepSeek R1 🧠',            maxOutput:8192,   vision:false },
  'deepseek-v4-pro':            { label: 'DeepSeek V4 Pro',      maxOutput: 393216, vision:false },
  'deepseek-v4-flash':          { label: 'DeepSeek V4 Flash',        maxOutput: 393216, vision:false },
};
const CLAUDE_MODELS  = Object.entries(KNOWN_MODELS).filter(([id])=>id.startsWith('claude')).map(([id,m])=>({id,...m}));
const OPENAI_MODELS  = Object.entries(KNOWN_MODELS).filter(([id])=>id.startsWith('gpt')||id.startsWith('o')).map(([id,m])=>({id,...m}));

// ── Image storage limit (user-configurable, default 500 KB) ──────
// Stored in localStorage as 'kic_max_img_bytes' (plain — not sensitive)
const DEFAULT_MAX_IMAGE_STORAGE_BYTES = 500 * 1024;
// Returns the user-configured max size (bytes) an image may have to be kept in storage, or the default.
function getMaxImageStorageBytes() {
  const v = parseInt(localStorage.getItem('kic_max_img_bytes') || '0');
  return v > 0 ? v : DEFAULT_MAX_IMAGE_STORAGE_BYTES;
}
// Persists the max image storage size (bytes) to localStorage.
function setMaxImageStorageBytes(bytes) {
  localStorage.setItem('kic_max_img_bytes', String(bytes));
}
// Alias for legacy references inside this file
const MAX_IMAGE_STORAGE_BYTES = 0; // not used directly — always call getMaxImageStorageBytes()

// ── OpenRouter model-meta cache ───────────────────────────────────
let _orModelMeta = {};
(function _loadOrCache() {
  try {
    const raw = localStorage.getItem('kic_or_model_meta');
    if (raw) _orModelMeta = JSON.parse(raw);
  } catch(e) { _orModelMeta = {}; }
})();
// Persists the cached OpenRouter model metadata to localStorage.
function _saveOrCache() {
  try { localStorage.setItem('kic_or_model_meta', JSON.stringify(_orModelMeta)); } catch(e) {}
}

// ── Anthropic model-capabilities cache ────────────────────────────
// Populated dynamically in fetchModels() from the live /v1/models API.
// Stores per-model flags so the API call logic never needs hard-coded model-name checks.
// Schema: { [modelId]: { adaptiveThinking: bool, noTemperature: bool } }
let _anthropicModelCaps = {};
(function _loadAnthropicCaps() {
  try {
    const raw = localStorage.getItem('kic_anthropic_model_caps');
    if (raw) _anthropicModelCaps = JSON.parse(raw);
  } catch(e) { _anthropicModelCaps = {}; }
})();
// Persists the cached Anthropic model capability flags to localStorage.
function _saveAnthropicCaps() {
  try { localStorage.setItem('kic_anthropic_model_caps', JSON.stringify(_anthropicModelCaps)); } catch(e) {}
}

/**
 * Returns true when a Claude model uses the new adaptive thinking API
 * (type:"adaptive" + output_config.effort) instead of the legacy
 * type:"enabled" + budget_tokens format.
 * Falls back to a regex for models not yet seen in the live API.
 */
function isAdaptiveThinkingModel(modelId) {
  if (!modelId) return false;
  const bare = modelId.split('/').pop();
  if (_anthropicModelCaps[bare]?.adaptiveThinking != null) return _anthropicModelCaps[bare].adaptiveThinking;
  // Regex fallback: claude-opus-4.x / claude-sonnet-4.x and later use adaptive
  // claude-3-7-sonnet and earlier use the legacy budget_tokens format.
  return /^claude-(opus|sonnet|haiku)-4[-_]\d|^claude-[5-9]/i.test(bare);
}

/**
 * Returns true when a Claude model accepts the temperature parameter.
 * Extended-thinking models (both legacy and adaptive) reject temperature.
 * Falls back to regex if the model hasn't been fetched from the live API yet.
 */
function isTemperatureSupported(modelId) {
  if (!modelId) return true;
  const bare = modelId.split('/').pop();
  if (_anthropicModelCaps[bare]?.noTemperature != null) return !_anthropicModelCaps[bare].noTemperature;
  // All current Claude 4+ models drop temperature support
  return !/^claude-(opus|sonnet|haiku)-4[-_]\d|^claude-[5-9]/i.test(bare);
}

// Returns the built-in default max-output-tokens for a model ID, using known models, cached OpenRouter metadata, or name-based heuristics as fallback.
function getModelDefaultMax(modelId) {
  if (!modelId) return 8096;
  const known = KNOWN_MODELS[modelId];
  if (known) return known.maxOutput;
  const orMeta = _orModelMeta[modelId];
  if (orMeta?.maxOutput && orMeta.maxOutput > 0) return orMeta.maxOutput;
  if (/llama-?3.*70b|llama-?3.*8b|llama-?3\.3/i.test(modelId)) return 32768;
  if (/llama-?3/i.test(modelId)) return 8192;
  if (/mixtral/i.test(modelId)) return 32768;
  if (/mistral/i.test(modelId)) return 32768;
  if (/gemma.*27b|gemma.*9b/i.test(modelId)) return 8192;
  if (/deepseek-r|reasoner/i.test(modelId)) return 8192;
  if (/gpt-4/i.test(modelId)) return 8192;
  if (/gemini-2\.5/i.test(modelId)) return 65536;
  if (/gemini/i.test(modelId)) return 8192;
  if (/grok-3/i.test(modelId)) return 131072;
  if (/^glm-(5|4\.[67])/i.test(modelId)) return 131072;
  if (/^glm-4\.5/i.test(modelId)) return 98304;
  if (/^glm-4-32b/i.test(modelId)) return 16384;
  return 4096;
}
// Returns the effective max-output-tokens for a model: a user override if set, otherwise the default.
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
};
// Returns a deep copy of DEFAULT_CONFIG, used to initialize or reset app configuration.
function freshConfig() { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
let config = freshConfig();
let providers = [];
let profiles  = [];
let folders   = [];
let chats     = [];
let currentChatId   = null;
let activeFolderId  = undefined;
let attachments     = [];
let isStreaming      = false;
let abortController = null;
let activeStreamSnapshot = null;

// ── Auto-scroll behaviour ───────────────────────────────────────────
// While a response is streaming in, the message list normally auto-scrolls
// to the bottom on every chunk. Set this to false to keep your scroll
// position (e.g. if you scrolled up to re-read something while a long
// answer is still generating). This only affects the "keep pinned to
// bottom while streaming" behaviour — sending a new message or opening a
// chat always still scrolls to the bottom once.
let AUTO_SCROLL_DURING_STREAM = false;
let editingProfileId  = null;
let editingProviderId = null;
let draggedChatId   = null;
let draggedFolderId = null;   // NEW: folder drag state
let sidebarCollapsed = false;
let webSearchCache = new Map();
let selectedLinkUrls = new Set();
let ignoredLinkUrls = new Set();
const WEB_SEARCH_RESULT_MAX = 30;
// Multi-select state
let _selectedChatIds = new Set();
let _multiSelectMode = false;

// ═══════════════════════════════════════════════════════════════
// CRYPTO — PBKDF2 + Full Storage Encryption
// ═══════════════════════════════════════════════════════════════

let _cryptoKey = null;
let _sessionPassphrase = null;

// == Brute-force lockout (UI-side, RAM only) ========================
// Counts failed login attempts per account in memory.
// NO localStorage/sessionStorage -> no bypass by clearing cache.
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
  return _cryptoKey;
}

// == Session token: F5 reload without password storage ==============
// The password is NOT stored in sessionStorage.
// Instead: after a successful login, a token encrypted with the
// CryptoKey is stored in sessionStorage.
// On F5/reload: decrypt token -> if OK -> still logged in.
// Without the in-RAM CryptoKey (= different tab, browser restart) no access.
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
// Returns a copy of a provider object with its apiKey field decrypted, after loading from storage.
async function decryptProvider(p) {
  const out = {...p};
  if (p.apiKey) out.apiKey = await decryptStr(p.apiKey);
  return out;
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

// ═══════════════════════════════════════════════════════════════
// ======================================================================
// PERSIST v5 - server storage (./datas/) + localStorage fallback
// ======================================================================
// All account data is primarily stored on the local proxy server
// under ./datas/<accountId>/<key>.json.
// This makes it browser-independent (Chrome, Firefox, Edge, ...).
// Falls back to localStorage if the proxy is unreachable.
// ======================================================================

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

// Encrypts and persists the full app state (config, providers, profiles, folders, chats, UI prefs) for the active account.
async function save() {
  if (!_activeAccountId) return;
  try {
    const encProviders = await Promise.all(providers.map(encryptProvider));
    const chatsToStore = chats.slice(0, 200).map(c => ({
      ...c,
      messages: c.messages.map(sanitizeMsgForStorage),
    }));
    const [encConfig, encProvidersStr, encProfiles, encFolders, encChats] = await Promise.all([
      encryptObj(config),
      encryptObj(encProviders),
      encryptObj(profiles),
      encryptObj(folders),
      encryptObj(chatsToStore),
    ]);
    await Promise.all([
      _storePut(_activeAccountId, 'config',    encConfig),
      _storePut(_activeAccountId, 'providers', encProvidersStr),
      _storePut(_activeAccountId, 'profiles',  encProfiles),
      _storePut(_activeAccountId, 'folders',   encFolders),
      _storePut(_activeAccountId, 'chats',     encChats),
    ]);
    if (currentChatId) await _storePut(_activeAccountId, 'current_chat', currentChatId);
    await _storePut(_activeAccountId, 'sidebar_w', document.getElementById('sidebar')?.style.width || '');
    await _storePut(_activeAccountId, 'sidebar_collapsed', sidebarCollapsed ? '1' : '');
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
  if (!['manual','auto','always','off'].includes(config.webSearchMode)) config.webSearchMode = 'manual';
  if (!['free','duckduckgo','searxng','qwant','yahoo','startpage','brave','google','bing','mojeek','yandex'].includes(config.webSearchEngine)) config.webSearchEngine = 'free';
  config.webSearchResultCount = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(config.webSearchResultCount) || 8));
  config.webLinkEnabled = !!config.webLinkEnabled;
  try {
    const rawProviders = await loadKey('providers', []);
    providers = await Promise.all(rawProviders.map(decryptProvider));
  } catch{}
  try { profiles = await loadKey('profiles', []); } catch{}
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
// Returns the base API URL for a provider, either its configured custom server URL (openai-compat) or the well-known endpoint for its type.
function getProviderEndpoint(provider) {
  if (!provider) return null;
  if (provider.type === 'openai-compat') return (provider.serverUrl || '').replace(/\/+$/, '');
  if (provider.type === 'kiconnect-nrw') return 'https://chat.kiconnect.nrw/api/v1';
  if (provider.type === 'anthropic')     return 'https://api.anthropic.com';
  if (provider.type === 'openai-direct') return 'https://api.openai.com/v1';
  if (provider.type === 'openrouter')    return 'https://openrouter.ai/api/v1';
  if (provider.type === 'mistral')       return 'https://api.mistral.ai/v1';
  if (provider.type === 'gemini')        return 'https://generativelanguage.googleapis.com/v1beta/openai';
  if (provider.type === 'xai')           return 'https://api.x.ai/v1';
  if (provider.type === 'groq')          return 'https://api.groq.com/openai/v1';
  if (provider.type === 'deepseek')      return 'https://api.deepseek.com/v1';
  if (provider.type === 'minimax')       return 'https://api.minimax.io/v1';
  if (provider.type === 'glm')           return 'https://api.z.ai/api/paas/v4';
  return null;
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
  'api.mistral.ai','generativelanguage.googleapis.com','api.x.ai','api.groq.com', 'api.deepseek.com', 'api.minimax.io', 'api.z.ai',
  'api.search.brave.com','html.duckduckgo.com','lite.duckduckgo.com',
  'api.qwant.com','search.yahoo.com','www.startpage.com',
  'www.googleapis.com','api.bing.microsoft.com','api.mojeek.com','yandex.com',
  'searx.be','searxng.world','search.bus-hit.me','searx.tiekoetter.com',
  'search.sapti.me','searx.prvcy.eu','searx.fmac.xyz','search.ononoki.org',
];
// A request is "safe" if its host is either one of the well-known,
// built-in provider domains, OR the host of a custom server URL the user
// themselves entered in the Provider editor (type "openai-compat" /
// "kiconnect-nrw"). The latter is what makes self-hosted / third-party
// OpenAI-compatible endpoints (Ollama, LM Studio, vLLM, a company's own
// gateway, ...) actually reachable — without it, any serverUrl outside the
// fixed list below was silently rejected by proxyUrl(), even though the
// Provider editor happily lets you save one.
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
// Routes a request URL through the local dev proxy (if active) after checking it against isSafeApiUrl(); throws if the domain isn't allowed.
function proxyUrl(url) {
  if (!isSafeApiUrl(url)) { console.error('[Security] Blocked:', url); throw new Error(t('js.apiDomainBlocked') || 'API domain not allowed.'); }
  return USE_PROXY ? '/proxy/' + url : url;
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
function renderProviderList() {
  const list = document.getElementById('providerList');
  list.innerHTML = '';
  if (!providers.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;padding:12px;';
    msg.textContent = t('js.noProviderList');
    list.appendChild(msg);
    return;
  }
  providers.forEach(p => {
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
    const info = document.createElement('div');
    info.className = 'provider-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'provider-item-name';
    nameEl.textContent = p.name;
    const descEl = document.createElement('div');
    descEl.className = 'provider-item-desc';
    descEl.textContent = (ptype.label || p.type) + (p.serverUrl ? ' · ' + p.serverUrl.replace(/^https?:\/\//, '').slice(0, 30) : '');
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
    item.appendChild(info); item.appendChild(badge); item.appendChild(toggle); item.appendChild(actions);
    list.appendChild(item);
  });
}

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
  selectProviderType('openai-compat');
  document.getElementById('providerEditorTitle').textContent = t('provider.new');
  document.getElementById('providerEditor').style.display = 'block';
}
// Opens the provider editor pre-filled with an existing provider's data.
function editProvider(id) {
  const p = providers.find(x => x.id === id); if (!p) return;
  editingProviderId = id;
  document.getElementById('pvNameInput').value  = p.name || '';
  document.getElementById('pvServerUrl').value  = p.serverUrl || '';
  document.getElementById('pvApiKey').value     = p.apiKey || '';
  selectProviderType(p.type || 'openai-compat');
  document.getElementById('providerEditorTitle').textContent = t('provider.edit');
  document.getElementById('providerEditor').style.display = 'block';
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

// Validates and saves the provider editor form, creating or updating a provider, then refreshes the model list.
async function saveProviderEditor() {
  const name = document.getElementById('pvNameInput').value.trim();
  if (!name) { toast(t('js.nameRequired')); return; }
  const type = getSelectedProviderType();
  const serverUrl = document.getElementById('pvServerUrl').value.trim().replace(/\/$/,'');
  if (type === 'openai-compat' && !serverUrl) { toast(t('js.urlRequired')); return; }
  const apiKey = document.getElementById('pvApiKey').value.trim();
  const data = { name, type, serverUrl: type==='openai-compat'?serverUrl:'', apiKey };
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
  save(); renderProviderList(); fetchModels();
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

// (Re)builds the list of saved profiles in the Profile panel, with select/edit/delete controls.
function renderProfileList() {
  const list = document.getElementById('profileList');
  list.innerHTML = '';
  if (!profiles.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;padding:12px;';
    msg.textContent = t('js.noProfileList');
    list.appendChild(msg);
    return;
  }
  profiles.forEach(p => {
    const item = document.createElement('div');
    item.className = 'profile-item' + (p.id === config.activeProfileId ? ' active' : '');
    item.dataset.id = p.id;
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
    list.appendChild(item);
  });
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
            : /^claude-(opus|sonnet|haiku)-4[-_]\d|^claude-[5-9]/i.test(m.id);
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
          liveModels.forEach(m => groupModels.push({
            fullId: makeModelId(provider.id, m.id), label: KNOWN_MODELS[m.id]?.label || m.id, modelId: m.id
          }));
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
        if (provider.type === 'glm') {
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
          rawModels
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
            .forEach(m => {
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
          rawModels.forEach(m => {
            const id = m.id || m.name || ''; if (!id) return;
			if (EMBED_FILTER.test(id)) return;
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
    if (groupModels.length) allGroups.push({ providerId: provider.id, providerName: provider.name, models: groupModels });
  }
  if (!anyOk && anyError) setStatus('red'); else if (anyError) setStatus('red'); else if (anyOk) setStatus('green');
  renderProviderList(); updateActiveProviderInfo();
  if (!allGroups.length) {
    if (anyError) toast(t('js.noModelLoaded'));
    const ph = `<option value="">${escHtml(t('js.selectModel'))}</option>`;
    ['modelSelector','modelInput'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=ph; });
    return;
  }
  const ph = `<option value="">${escHtml(t('js.selectModel'))}</option>`;
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
    el.innerHTML = optsHtml;
    el.value = config.model || '';
  });
  const sel = document.getElementById('modelSelector');
  if (!sel.value && allGroups[0]?.models[0]) {
    config.model = allGroups[0].models[0].fullId;
    sel.value = config.model;
    document.getElementById('modelInput').value = config.model;
  }
  sel.onchange = () => {
    config.model = sel.value;
    document.getElementById('modelInput').value = config.model;
    updateModelMaxInfo(); updateThinkingUI(); save(); renderAttachments();
    if (window.syncCustomDropdown) syncCustomDropdown();
  };
  updateModelMaxInfo(); syncAllModelSelects(); updateThinkingUI();
  if (window.buildCustomDropdownData) buildCustomDropdownData();
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
    /^o\d/.test(bare) || /claude-(opus|sonnet)-4/.test(bare) || /claude-3-7/.test(bare) ||
    /thinking|reason/i.test(bare) || /deepseek-r|deepseek-v4|qwen.*think|qwq|llama.*reason/i.test(bare) ||
    /^glm-(5|4\.[567])/i.test(bare);
}
// Returns whether a model ID is an Anthropic Claude model with thinking support (legacy or adaptive).
function isAnthropicThinkingModel(modelId) {
  return /^claude-(opus-4|sonnet-4|3-7-sonnet)/i.test(modelId);
}
// Returns whether a model uses the legacy budget_tokens thinking format rather than adaptive effort.
function usesTokenBudget(modelId) { return isAnthropicThinkingModel(modelId || ''); }
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
  if (!slider) return;
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

// ══════════════════════════════════════════════════════════════════
// FOLDERS — with drag & drop reordering
// ══════════════════════════════════════════════════════════════════
function newFolder() {
  const id = Date.now().toString();
  folders.push({id, name: t('js.newFolder'), collapsed:false});
  save(); renderSidebar(); setTimeout(()=>startRenamingFolder(id), 50);
}
// Deletes a folder; chats inside it are moved out (not deleted) before removal.
function deleteFolder(id) {
  chats.forEach(c=>{if(c.folderId===id)c.folderId=null;});
  folders = folders.filter(f=>f.id!==id);
  if (activeFolderId === id) activeFolderId = null;
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
    else { const c=document.getElementById('messages'); c.innerHTML=''; const e=document.getElementById('emptyState'); if(e){c.appendChild(e);e.style.display='';} }
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
      msBar.style.cssText = 'display:none;align-items:center;gap:4px;padding:4px 6px;background:var(--surface2);border-top:1px solid var(--border);flex-shrink:0;';
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
      cancelBtn.style.cssText = 'flex:0 0 auto;min-width:28px;';
      cancelBtn.addEventListener('click', exitMultiSelectMode);
      // Count label
      const countLbl = document.createElement('span');
      countLbl.style.cssText = 'flex:1;font-size:11px;color:var(--muted);font-family:"IBM Plex Mono",monospace;';
      countLbl.textContent = _selectedChatIds.size > 0 ? tf('js.chosenChats', {n: _selectedChatIds.size}) : (t('js.selectedChats') || 'Selected chats');
      // Select all
      const selAllBtn = document.createElement('button');
      selAllBtn.className = 'sidebar-action-btn';
      selAllBtn.title = t('js.selectAll') || 'Select all';
      selAllBtn.textContent = '☑';
      selAllBtn.style.cssText = 'flex:0 0 auto;min-width:28px;';
      selAllBtn.addEventListener('click', () => {
        chats.forEach(c => _selectedChatIds.add(c.id));
        renderSidebar();
      });
      // Delete selected
      const delBtn = document.createElement('button');
      delBtn.className = 'sidebar-action-btn';
      delBtn.title = t('js.deleteSelectedItems') || 'Delete selected items';
      delBtn.textContent = '🗑';
      delBtn.style.cssText = 'flex:0 0 auto;min-width:28px;color:var(--red);';
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
    nameSpan.addEventListener('dblclick', () => startRenamingFolder(f.id));
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
    const chatsDiv = document.createElement('div');
    chatsDiv.className = 'folder-chats' + (f.collapsed ? ' collapsed' : '');
    chatsDiv.id = `fc_${f.id}`;
    chatsDiv.addEventListener('dragover', e => { if(draggedChatId) e.preventDefault(); });
    chatsDiv.addEventListener('drop', e => { if(draggedChatId) onDropFolder(e, f.id); });
    fc.forEach(c => chatsDiv.appendChild(buildChatItem(c)));
    folderDiv.appendChild(header); folderDiv.appendChild(chatsDiv);
    container.appendChild(folderDiv);
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
    container.appendChild(folderDiv);
  }
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
  let path = chat ? getActivePath(chat) : (Array.isArray(messages) ? messages : []);
  // limitCount: optionally render only the first N nodes of the active path.
  // Used by regenerate() to render up to (and including) the user message only,
  // leaving the about-to-be-replaced assistant bubble out of the DOM entirely
  // instead of rendering it and relying on a later swap (which used to leave
  // a stale duplicate bubble behind — see regenerate()).
  if (typeof limitCount === 'number') path = path.slice(0, limitCount);
  if (!path.length) {
    Array.from(container.children).forEach(el => { if(el!==empty) el.remove(); });
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  Array.from(container.children).forEach(el => { if(el!==empty) el.remove(); });
  path.forEach((msg, i) => container.appendChild(buildMsgEl(msg, i)));
  container.scrollTop = container.scrollHeight;
  typesetMath();
  updateChatTokenTotal();
}

// Builds the full DOM row for a single chat message: avatar, bubble content (text/images/files/web sources), and surrounding chrome.
function buildMsgEl(msg, idx) {
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
      if (part._webSearch) return;
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
  actDiv.appendChild(makeActBtn(t('js.edit'),       '', startEditBubble, 'edit'));
  actDiv.appendChild(makeActBtn(t('js.branch'),     '', branchFromHere, 'branch'));
  if (!isUser) actDiv.appendChild(makeActBtn(t('js.regenerate'), '', regenerate, 'regenerate'));
  actDiv.appendChild(makeActBtn('🖨️',               '', openPrintSingleOverlay, 'print'));
  // speaker moved into the shared bubble-actions row (same hover group as copy/edit/etc.)
  if (!isUser) {
    const vc = document.createElement('div');
    vc.className = 'bubble-voice-controls';
    vc.innerHTML = '<button class="bubble-voice-btn" type="button" title="Read aloud">🔊</button>';
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
    prev.content = [{ type: 'text', text: c, cache_control: { type: 'ephemeral' } }];
  } else if (Array.isArray(c) && c.length) {
    const lp = c[c.length - 1];
    if (lp && !lp.cache_control) lp.cache_control = { type: 'ephemeral' };
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

  // Pull the boundary back to before any still-open multi-line block (GFM
  // table or list) so we never commit a *partial* table/list to "stable".
  // marked.js needs the whole block (e.g. the table header + separator
  // row) in a single parse to render new rows/items correctly — splitting
  // a growing table across several "stable" flushes turns later rows into
  // orphaned plain text instead of appending them to the table, and
  // splitting an ordered list resets the numbering. See _pullBackForOpenBlock.
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
  const isTableLine = (l) => {
    if (!l.includes('|')) return false;
    const t = l.trim();
    return t.startsWith('|') || t.endsWith('|') || (l.match(/\|/g) || []).length >= 2;
  };
  const isListLine = (l) => /^[ \t]*([-*+]|\d+[.)])[ \t]+/.test(l);
  const isListContinuation = (l) => isListLine(l) || (!isBlank(l) && /^[ \t]+\S/.test(l));

  const lastLine = lines[lines.length - 1];
  let blockType = null;
  if (isTableLine(lastLine)) blockType = 'table';
  else if (isListLine(lastLine)) blockType = 'list';
  else return safeEnd; // plain prose line, or block already closed by a blank line

  // Walk backward while lines keep belonging to the same open block.
  let start = lines.length - 1;
  while (start > 0) {
    const prev = lines[start - 1];
    if (isBlank(prev)) break;
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

// renderStreamingBubble: live-updates a message bubble during streaming
// while preserving already-rendered (typeset) content. Splits into a frozen
// "stable" container (rendered once per finished line, then left alone) and
// a small "tail" container (the current in-progress line, re-rendered often).
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

// Records the latest streamed text/usage so an aborted stream can still be saved with whatever was generated so far.
function _rememberStreamSnapshot(text, usageData) {
  if (!activeStreamSnapshot) activeStreamSnapshot = { text: '', usage: null };
  activeStreamSnapshot.text = text || '';
  activeStreamSnapshot.usage = usageData || null;
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
async function _streamAIResponse(messages, provider, typingId, documentIds) {
  let assistantText = '', usageData = null;
  let aiRowEl = null; // the actual DOM row created for this streamed answer (see appendEmptyAI() below)
  activeStreamSnapshot = { text: '', usage: null };

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
    if (config.systemPrompt) body.system = [{ type: 'text', text: config.systemPrompt, cache_control: { type: 'ephemeral' } }];
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
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    removeTyping(typingId);
    const aiEl = appendEmptyAI();
    aiRowEl = aiEl;
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
            _rememberStreamSnapshot(_streamStoredText(thinkingText, assistantText), usageData);
          }
          else if (ev.type === 'message_delta' && ev.usage) {
            usageData = { ...(usageData || {}), ...ev.usage };
            _rememberStreamSnapshot(_streamStoredText(thinkingText, assistantText), usageData);
          }
          else if (ev.type === 'content_block_start') { inThinkingBlock = ev.content_block?.type === 'thinking'; }
          else if (ev.type === 'content_block_stop') { inThinkingBlock = false; }
          else if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'thinking_delta' && inThinkingBlock) {
              thinkingText += ev.delta.thinking || '';
              renderStreamingBubble(aiEl.querySelector('.bubble'), thinkingText, assistantText);
              _rememberStreamSnapshot(_streamStoredText(thinkingText, assistantText), usageData);
            } else if (ev.delta?.type === 'text_delta') {
              assistantText += ev.delta.text;
              renderStreamingBubble(aiEl.querySelector('.bubble'), thinkingText, assistantText);
              _rememberStreamSnapshot(_streamStoredText(thinkingText, assistantText), usageData);
              if (AUTO_SCROLL_DURING_STREAM) scrollToBottom();
            }
          }
        } catch {}
      }
    }
    _finalizeStreamingBubble(aiEl.querySelector('.bubble'), assistantText);
    if (thinkingText) assistantText = `<thinking>\n${thinkingText}\n</thinking>\n\n` + assistantText;

  } else {
    const endpoint = getProviderEndpoint(provider);
    const { modelId } = splitModelId(config.model);
    const apiMsgs = [];
    if (config.systemPrompt) apiMsgs.push({ role: 'system', content: config.systemPrompt });
    // messages are already expanded by caller (_toOpenAIContent) — pass through
    messages.forEach(m => { if (m.role === 'user' || m.role === 'assistant') apiMsgs.push({ role: m.role, content: m.content }); });
    const reqBody = { model: modelId, messages: apiMsgs, stream: true };
    const isOSeries = /^o\d/.test(modelId);
    if (isOSeries) {
      reqBody.max_completion_tokens = effectiveMaxTokens();
      if (config.thinkingEnabled && isThinkingCapable(modelId)) reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
    } else {
      reqBody.temperature = config.temperature;
      reqBody.max_tokens = effectiveMaxTokens();
      if (config.thinkingEnabled && isThinkingCapable(modelId)) reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
    }
    if (documentIds?.length) reqBody.documents = documentIds;
    if (provider.type !== 'glm') {
      reqBody.stream_options = { include_usage: true };
    }
    // GLM (z.ai) uses a different thinking shape than o-series/deepseek:
    // it sets `thinking: { type: 'enabled' }` instead of `reasoning_effort`,
    // and streams the reasoning trace via delta.reasoning_content.
    if (provider.type === 'glm' && isThinkingCapable(modelId)) {
      reqBody.thinking = { type: config.thinkingEnabled ? 'enabled' : 'disabled' };
      delete reqBody.reasoning_effort;
    }
    const extraHeaders = {};
    if (provider.type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
    if (provider.type === 'glm') { extraHeaders['Accept-Language'] = 'en-US,en'; }
    const res = await fetch(proxyUrl(`${endpoint}/chat/completions`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders },
      body: JSON.stringify(reqBody),
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    removeTyping(typingId);
    const aiEl = appendEmptyAI();
    aiRowEl = aiEl;
    const reader = res.body.getReader(), decoder = new TextDecoder(); let buf = '';
    let thinkingText = '';
    const isGlm = provider.type === 'glm';
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
          const reasoningDelta = isGlm ? (chunk.choices?.[0]?.delta?.reasoning_content || '') : '';
          if (reasoningDelta) {
            thinkingText += reasoningDelta;
          }
          assistantText += delta;
          if (isGlm) {
            // GLM: render live bubble with thinking block + assistant text
            if (reasoningDelta || delta) {
              renderStreamingBubble(aiEl.querySelector('.bubble'), thinkingText, assistantText);
              _rememberStreamSnapshot(_streamStoredText(thinkingText, assistantText), usageData);
              if (AUTO_SCROLL_DURING_STREAM) scrollToBottom();
            }
          } else if (delta) {
            renderStreamingBubble(aiEl.querySelector('.bubble'), '', assistantText);
            _rememberStreamSnapshot(assistantText, usageData);
            if (AUTO_SCROLL_DURING_STREAM) scrollToBottom();
          }
          if (chunk.usage) {
            const u = chunk.usage;
            usageData = { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens || 0 };
            _rememberStreamSnapshot(isGlm ? _streamStoredText(thinkingText, assistantText) : assistantText, usageData);
          }
        } catch {}
      }
    }
    _finalizeStreamingBubble(aiEl.querySelector('.bubble'), assistantText);
    if (isGlm && thinkingText) {
      assistantText = `<thinking>\n${thinkingText}\n</thinking>\n\n` + assistantText;
    }
  }

  _finishLiveStreamUI();
  return { text: assistantText, usage: usageData, el: aiRowEl };
}

/**
 * _runStreamAndAttach: shared "call _streamAIResponse, handle abort/errors,
 * then attach the finished bubble's chrome" logic used by both
 * sendMessageCore (new message) and rerunFromUserMsg (regenerate from an
 * earlier point). Assumes the caller has already set isStreaming=true,
 * setSendMode('stop') and created abortController.
 * Resets isStreaming/abortController/send-mode/status when done.
 */
async function _runStreamAndAttach(chat, messages, provider, typingId, documentIds) {
  let assistantText = '', usageData = null, streamEl = null;
  try {
    const result = await _streamAIResponse(messages, provider, typingId, documentIds);
    assistantText = result.text; usageData = result.usage; streamEl = result.el;
  } catch (e) {
    removeTyping(typingId);
    if (e.name === 'AbortError') {
      const partialText = activeStreamSnapshot?.text || assistantText;
      assistantText = partialText || t('js.generationStopped');
      usageData = activeStreamSnapshot?.usage || usageData;
      _finishLiveStreamUI();
    } else {
      assistantText = tf('js.errorPrefix', { e: escHtml(e.message) });
      const errEl = buildMsgEl({ role: 'assistant', content: assistantText }, undefined);
      appendToMessages(errEl); scrollToBottom(); setStatus('red');
    }
  }

  if (assistantText) _attachAIActions(chat, assistantText, usageData, streamEl);
  activeStreamSnapshot = null;
  isStreaming = false; abortController = null; setSendMode('send'); setStatus('green');
}

/**
 * _attachAIActions: Appends action buttons and token badge to the last AI bubble.
 * Shared post-stream logic for both sendMessageCore and rerunFromUserMsg.
 */
// _attachAIActions: tree-aware, writes into active sibling tail
function _attachAIActions(chat, assistantText, usageData, streamEl) {
  if (chat._pendingRegenMsg) {
    // Regeneration: push new sibling with empty tail onto the branch node.
    // _note/_noteOpen start fresh (undefined/false) — a regenerated answer
    // is new content and must not inherit the note from the previous variant.
    const msg = chat._pendingRegenMsg;
    const newSibling = { content: assistantText, _model: config.model, _usage: usageData || undefined, _note: undefined, _noteOpen: false, tail: [] };
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
    const msgObj = { role: 'assistant', content: assistantText, _model: config.model };
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

  if (!_finalizeAIRowInPlace(streamEl, path[idx], idx)) {
    // Fallback: streamEl is missing/detached (e.g. chat was switched away
    // from mid-stream) — build a fresh row the old way. We still avoid
    // replacing an unrelated node: fall back to the last message row, never
    // the #chatTokenTotal footer div appendToMessages() always keeps last.
    const newRow = buildMsgEl(path[idx], idx);
    const oldRow = (streamEl && streamEl.parentNode === messagesEl) ? streamEl : messagesEl.lastElementChild;
    if (oldRow && oldRow !== emptyState) oldRow.replaceWith(newRow);
    else messagesEl.appendChild(newRow);
    typesetMath(newRow);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
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
  if(isStreaming){stopStreaming();return;}

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
  isStreaming=true; setSendMode('stop'); abortController=new AbortController();

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
  await _runStreamAndAttach(chat, messages, provider, typingId, []);
}


// ── Send / Stop ───────────────────────────────────────────────────
function handleSendStop() { isStreaming ? stopStreaming() : sendMessage(); }
// Aborts the in-progress AI response stream, if any.
function stopStreaming() { if(abortController){abortController.abort();abortController=null;} }
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
  const active = mode === 'always' || config.webSearchEnabled;
  btn.classList.toggle('active', active && mode !== 'off');
  btn.classList.toggle('link-active', !!config.webLinkEnabled && getSelectedReadableUrls().length > 0);
  btn.classList.toggle('searching', searching);
  btn.disabled = mode === 'off' || searching;
  btn.textContent = searching ? '...' : 'Web ▾';
  syncWebContextPopover();
}

// Toggles manual web search on/off for the next message.
function toggleWebSearch() {
  if ((config.webSearchMode || 'manual') === 'off') {
    toast(t('web.offToast'));
    return;
  }
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
function shouldUseWebSearch(text) {
  const mode = config.webSearchMode || 'manual';
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  if (config.webSearchEnabled) return true;
  return mode === 'auto' && shouldAutoWebSearch(text);
}

// Strips formatting/noise from a message so it can be used as a plain web-search query.
function cleanSearchQuery(text) {
  return (text || '')
    .replace(/^(suche|recherchiere|search|research)\s+(nach|zu|for|about)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

const ENGINES_NEEDING_KEY = new Set(['brave','google','bing','mojeek','yandex']);
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
    searxng: { label: t('web.searxngKey'), hint: t('web.hintSearxng'), ph: 'https://searx.be' },
  };
  const i = info[engine] || info.brave;
  if (label) label.textContent = i.label;
  if (hint)  hint.textContent  = i.hint;
  if (input) input.placeholder = i.ph;
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

// Runs a web search against a SearXNG instance.
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
          const res = await fetchWithTimeout(url, { headers: localizedHeaders({ 'Accept': 'application/json' }) }, 10000);
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

  updateWebSearchButton(true);
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
  if(isStreaming) return;
  const input=document.getElementById('messageInput');
  const text=input.value.trim();
  if(!text&&!attachments.length) return;
  if(!config.model){toast(t('js.noModel'));return;}
  const provider=providerForModel(config.model)||providers[0];
  if(!provider){toast(t('js.noProvider'));openProviderPanel();return;}
  if(!provider.apiKey){toast(t('js.noApiKey'));openProviderPanel();return;}
  if(provider.enabled===false){toast(t('js.providerDisabledToast'));openProviderPanel();return;}
  if (shouldUseWebSearch(text) && webEngineNeedsKey(config.webSearchEngine || 'free') && !(config.webSearchApiKey || '').trim()) {
    toast(t('web.noKey'));
    openSettings();
    return;
  }
  const att=[...attachments];
  input.value=''; autoResize(input); clearAttachments();
  await sendMessageCore(text, att);
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
  let userContent;
  const fileNames=[];
  if(att.length){
    userContent=[];
    if(text) userContent.push({type:'text',text});
    att.forEach(a=>{
      if(a.type==='image') userContent.push({type:'image_url',image_url:{url:a.data}});
      else if(a.type==='pdf-b64'){
        fileNames.push(a.name);
        if(a._uploadedId){}
        else if(a.pdfMode==='text'){const txt=a.extractedText||t('js.noText');userContent.push({type:'pdf_text',name:a.name,text:txt});} //  Bug 2: structured pdf_text block instead of i18n-string
        else{const b64=(a.data||'').split(',')[1]||a.data;userContent.push({type:'pdf_base64',name:a.name,data:b64});}
      } else if(a.type==='text-file'){
        fileNames.push(a.name);
        // _fromHistory: content already in AI context, skip re-injection to avoid duplication
        if(!a._fromHistory) userContent.push({type:'text',text:`${tf('js.fileContent',{name:a.name})}\n${a.content}\n${t('js.fileEnd')}`});
      } else if(a.type==='_chip_only'){
        // Chip-only placeholder (e.g. PDF from history whose binary is gone): show chip, no content
        fileNames.push(a.name);
      } else{
        fileNames.push(a.name);
        userContent.push({type:'text',text:`[${tf('js.unreadableFormat',{name:a.name})}]`});
      }
    });
    if(userContent.length===0&&text) userContent=text;
  } else { userContent=text; }

  const readableUrls = extractReadableHttpUrls(text);
  const selectedReadableUrls = config.webLinkEnabled
    ? readableUrls.filter(url => selectedLinkUrls.has(url) || selectedLinkUrls.size === 0)
    : [];
  linkedPages = selectedReadableUrls.length ? await fetchLinkedPagesFromText(text, selectedReadableUrls) : [];
  if (linkedPages.length) {
    userContent = buildLinkedPageAugmentedContent(userContent, linkedPages);
  }

  if (shouldUseWebSearch(text)) {
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
      updateWebSearchButton(false);
      if ((config.webSearchMode || 'manual') === 'manual') config.webSearchEnabled = false;
      updateWebSearchButton(false);
      save();
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
  selectedLinkUrls.clear();
  ignoredLinkUrls.clear();
  renderDetectedLinks();

  const typingId=showTyping();
  isStreaming=true; setSendMode('stop'); abortController=new AbortController();

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
  await _runStreamAndAttach(chat, messages, provider, typingId, documentIds);
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
function appendEmptyAI() {
  const mid=config.model||'';
  const pureModelId=splitModelId(mid).modelId||mid;
  const div=document.createElement('div');
  div.className='message-row ai';
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
function scrollToBottom(){const c=document.getElementById('messages');c.scrollTop=c.scrollHeight;}
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
function escHtml(s) {
  if(s===null||s===undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}


// Converts raw model/markdown text into sanitized, syntax-highlighted, math-aware HTML for display.
function formatText(raw) {
  if (!raw) return '';
  const blocks = [];
  // Placeholder: HTML comments that marked passes through unchanged
  const PH = (i) => `<!--KICBLK${i}-->`;
  const PH_RE = /<!--KICBLK(\d+)-->/g;
  let s = raw;

  // ── Step 1: Code and LaTeX blocks VOR protect from marked ────────

  // 4+-Backtick-Fences
  s = s.replace(/^(`{4,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm, (_, fence, lang, code) => {
    const i = blocks.length;
    const b64 = btoa(unescape(encodeURIComponent(code.replace(/\n$/, ''))));
    const ll = escHtml((lang || '').trim() || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-collapse-btn" type="button" title="${escHtml(t('js.codeCollapse')||'Collapse')}" aria-label="Collapse code block">▼</button><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><div class="code-block-body"><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div></div>`);
    return PH(i);
  });

  // 3-Backtick-Fences
  s = s.replace(/^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm, (_, lang, code) => {
    const i = blocks.length;
    const b64 = btoa(unescape(encodeURIComponent(code)));
    const ll = escHtml(lang || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-collapse-btn" type="button" title="${escHtml(t('js.codeCollapse')||'Collapse')}" aria-label="Collapse code block">▼</button><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><div class="code-block-body"><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div></div>`);
    return PH(i);
  });

  // Not-closed Fences (Fallback)
  s = s.replace(/^(`{4,})([^\n]*)\n([\s\S]*)$/gm, (_, fence, lang, code) => {
    const i = blocks.length;
    const b64 = btoa(unescape(encodeURIComponent(code.replace(/\n$/, ''))));
    const ll = escHtml((lang || '').trim() || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-collapse-btn" type="button" title="${escHtml(t('js.codeCollapse')||'Collapse')}" aria-label="Collapse code block">▼</button><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><div class="code-block-body"><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div></div>`);
    return PH(i);
  });
  s = s.replace(/^```([^\n`]*)\n([\s\S]*)$/gm, (_, lang, code) => {
    const i = blocks.length;
    const b64 = btoa(unescape(encodeURIComponent(code.replace(/\n$/, ''))));
    const ll = escHtml(lang || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-collapse-btn" type="button" title="${escHtml(t('js.codeCollapse')||'Collapse')}" aria-label="Collapse code block">▼</button><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><div class="code-block-body"><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div></div>`);
    return PH(i);
  });

  // Inline-Code
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = blocks.length;
    blocks.push(`<code>${escHtml(code)}</code>`);
    return PH(i);
  });

  // LaTeX Display: \[ ... \]
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<div class="math-block">\\[${math}\\]</div>`);
    return PH(i);
  });

  // LaTeX Display: $$ ... $$
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<div class="math-block">$$${math}$$</div>`);
    return PH(i);
  });

  // LaTeX Inline: \( ... \)
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<span class="math-inline">\\(${math}\\)</span>`);
    return PH(i);
  });

  // LaTeX Inline: $...$ (kein Leerzeichen am Rand, kein Zeilenumbruch)
  s = s.replace(/\$([^\s$\n][^$\n]*?[^\s$\n]|\S)\$/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<span class="math-inline">\\(${math}\\)</span>`);
    return PH(i);
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
      const b64 = btoa(unescape(encodeURIComponent(text)));
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
    s = DOMPurify.sanitize(s, {
      ALLOWED_TAGS: ['p','br','strong','em','del','h1','h2','h3','h4','h5','h6',
                     'ul','ol','li','code','pre','hr','table','thead','tbody','tr','th','td',
                     'div','span','button','a','u','sup','sub','mark','small','s','ins',
                     'abbr','cite','kbd','details','summary','blockquote','input','img'],
      ALLOWED_ATTR: ['style','class','href','target','rel','title','data-b64',
                     'type','checked','disabled','src','alt','loading'],
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
    MathJax.typesetPromise(targets).catch(err => console.error('[MathJax typeset error]', err));
  }
}

// Throttled variant: used during streaming so LaTeX renders progressively
// instead of only once at the very end.
// Per-element throttle state (WeakMap keyed by the target element) rather
// than one shared global timer/timestamp. A single global timer meant any
// two elements sharing typesetMathThrottled would cancel/delay each
// other's pending typeset — harmless today since only one bubble streams
// at a time, but wrong in principle and would misbehave the moment
// anything else (e.g. a second concurrent stream, or a tail + stable call
// racing) starts using it. Each element now gets its own independent timer.
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

// ════════════════════════════════════════════════════════════════
// FILE / IMAGE HANDLING — including Ctrl+V paste
// ════════════════════════════════════════════════════════════════

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
  ['settingsPanel','tuningPanel','providerPanel','profilePanel','modelMaxPanel','introPanel'].forEach(id=>document.getElementById(id).classList.remove('open'));
  document.querySelectorAll('.panel-toolbar-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('overlay').classList.remove('show');
}
// Shows a temporary toast notification with the given message.
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
// Opens the Settings panel.
function openSettings(){syncSettingsPanel();applyTheme(localStorage.getItem('kic_theme')||'dark');document.getElementById('settingsPanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="settingsPanel"]')?.classList.add('active');}
// Opens the Tuning panel.
function openTuningPanel(){syncSettingsPanel();applyTheme(localStorage.getItem('kic_theme')||'dark');document.getElementById('tuningPanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="tuningPanel"]')?.classList.add('active');}
// Opens the Profiles panel.
function openProfilePanel(){renderProfileList();document.getElementById('profilePanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="profilePanel"]')?.classList.add('active');}
// Updates the intro/welcome panel's provider-status summary text.
function renderIntroPanel() {
  const status = document.getElementById('introProviderStatus');
  if (!status) return;
  if (!providers.length) {
    status.textContent = t('intro.noProvider');
    return;
  }
  const withKeys = providers.filter(p => p.apiKey).length;
  const names = providers.map(p => p.name).join(', ');
  status.textContent = tf('intro.configuredProviders', { n: providers.length, keys: withKeys, names });
}
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

// ═══════════════════════════════════════════════════════════════
// LOGIN / MULTI-ACCOUNT / SESSION
// ═══════════════════════════════════════════════════════════════

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
    avatar.style.cssText = `width:64px;height:64px;border-radius:16px;background:${acc.color};display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:white;box-shadow:0 4px 16px ${acc.color}55;`;
    avatar.textContent = (acc.name || '?').slice(0, 1).toUpperCase();

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
  if (avatarEl) { avatarEl.style.background = acc.color; avatarEl.textContent = acc.name.slice(0,1).toUpperCase(); }
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
  const accountId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7);
  _accounts.push({ id: accountId, name, color, pwVersion: 2 });
  saveAccountRegistry();
  await storeAccountPasswordHash(accountId, pw);
  // Activate
  _activeAccountId = accountId;
  setSessionPassphrase(pw);
  // Build CryptoKey and write session token
  await getCryptoKey();
  await _writeSessionToken();
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
function forgotPassword() {
  if (!_selectedLoginAccountId) {
    // No account selected — just go back to account selection
    showView('accountSelectView');
    renderAccountGrid();
    return;
  }
  const acc = getAccount(_selectedLoginAccountId);
  if (!confirm(tf('account.deleteConfirm', { name: acc?.name || '' }))) return;
  deleteAccount(_selectedLoginAccountId);
  _selectedLoginAccountId = null;
  _stopLockCountdown();
  _showAccountViewAfterChange();
}

// Permanently deletes an account and its stored data after confirmation.
async function deleteAccount(accountId) {
  // Remove all data from server store and localStorage
  if (_storeAvailable) {
    const keysToDelete = ['config','providers','profiles','folders','chats',
      'current_chat','sidebar_w','sidebar_collapsed'];
    await Promise.allSettled(
      keysToDelete.map(k => _storeDel(accountId, k))
    );
  }
  const prefix = `kic_${accountId}_`;
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
  keys.forEach(k => localStorage.removeItem(k));
  _accounts = _accounts.filter(a => a.id !== accountId);
  saveAccountRegistry();
  if (_activeAccountId === accountId) {
    _activeAccountId = null;
    _cryptoKey = null;
    _sessionPassphrase = null;
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
  if (_activeAccountId) localStorage.removeItem(`kic_${_activeAccountId}_session_expiry`);
  _activeAccountId = null;
  _cryptoKey = null;
  _sessionPassphrase = null;
  try { sessionStorage.removeItem(_SESSION_TOKEN_KEY); } catch {}
  localStorage.removeItem('kic_active_account');
  // Reset app state
  providers = []; profiles = []; folders = []; chats = []; currentChatId = null;
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

// Deletes all locally stored app data after confirmation (used for a full reset).
function clearAllData() {
  if (!confirm(t('js.clearConfirm'))) return;
  // Delete only this account's data
  if (_activeAccountId) {
    deleteAccount(_activeAccountId);
  }
  providers = []; profiles = []; folders = []; chats = [];
  config = freshConfig();
  closePanels(); renderSidebar(); renderMessages([]); updateProfileBadge();
  toast(t('js.cleared'));
  setTimeout(() => logoutNow(), 1500);
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENER SETUP
// ═══════════════════════════════════════════════════════════════
function setupEventListeners(){
  document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
  document.getElementById('openProviderHeaderBtn').addEventListener('click', ()=>{closePanels();openProviderPanel();});
  document.getElementById('openSettingsBtn').addEventListener('click', ()=>{closePanels();openSettings();});
  document.getElementById('openIntroBtn').addEventListener('click', ()=>startGuidedIntro());
  document.getElementById('openTuningBtn').addEventListener('click', ()=>{closePanels();openTuningPanel();});
  document.getElementById('openProfileHeaderBtn').addEventListener('click', ()=>{closePanels();openProfilePanel();});
  document.getElementById('openModelMaxHeaderBtn').addEventListener('click', ()=>{closePanels();openModelMaxPanel();});
  document.getElementById('langToggleBtn').addEventListener('click', toggleLangDropdown);
  document.getElementById('overlay').addEventListener('click', closePanels);

  // Tuning Panel
  document.getElementById('tuningPanelClose').addEventListener('click', closePanels);

  // Settings Panel
  document.getElementById('settingsPanelClose').addEventListener('click', closePanels);
  document.getElementById('introPanelClose').addEventListener('click', closePanels);
  document.getElementById('introCloseBtn').addEventListener('click', closePanels);
  document.getElementById('introGoProviderBtn').addEventListener('click',()=>startGuidedIntro(1));
  document.getElementById('tourSkipBtn')?.addEventListener('click', endGuidedIntro);
  document.getElementById('tourBackBtn')?.addEventListener('click', prevTourStep);
  document.getElementById('tourNextBtn')?.addEventListener('click', nextTourStep);
  window.addEventListener('resize', () => { if (_tourActive) positionTourCard(_tourTargetEl); });
  document.getElementById('goProviderFromSettings').addEventListener('click',()=>{closePanels();openProviderPanel();});
  document.getElementById('goModelLimits').addEventListener('click',()=>{closePanels();openModelMaxPanel();});
  document.getElementById('changePwdBtn').addEventListener('click', changeLoginPassword);
  document.getElementById('changeAccountNameBtn')?.addEventListener('click', changeAccountName);
  document.getElementById('accountNameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') changeAccountName(); });
  document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
    const acc = getAccount(_activeAccountId);
    if (!confirm(tf('account.deleteConfirm', { name: acc?.name || '' }))) return;
    deleteAccount(_activeAccountId);
    logoutNow();
  });
  document.getElementById('applySessionBtn').addEventListener('click', applySessionDuration);
  document.getElementById('resetSessionBtn').addEventListener('click', resetSessionNow);
  document.getElementById('resetMathJaxBtn')?.addEventListener('click', resetMathJaxSettings);
  document.getElementById('logoutBtn').addEventListener('click', logoutNow);
  document.getElementById('clearAllBtn').addEventListener('click', clearAllData);

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
  document.querySelectorAll('.type-chip').forEach(chip=>{chip.addEventListener('click',()=>selectProviderType(chip.dataset.type));});

  // Profile Panel
  document.getElementById('profilePanelClose').addEventListener('click', closePanels);
  document.getElementById('addProfileBtn').addEventListener('click', startNewProfile);
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

// ═══════════════════════════════════════════════════════════════
// PRINT — Full chat & single bubble
// ═══════════════════════════════════════════════════════════════

// Opens the browser print dialog for the entire active chat.
function printFullChat() {
  const chat = currentChat();
  if (!chat || !chat.messages.length) { toast(t('js.noChatToPrint')); return; }
  // Titel setzen (nur bei @media print sichtbar)
  const titleEl = document.getElementById('printChatTitle');
  if (titleEl) {
    const date = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
    titleEl.textContent = `${chat.title}  —  ${date}`;
  }
  // Re-typeset MathJax if needed, then print
  if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetPromise().then(() => { window.print(); }).catch(() => { window.print(); });
  } else {
    window.print();
  }
}

// _printSingleIdx: index of the bubble currently being printed
let _printSingleIdx = null;

// Opens the single-message print preview overlay for one bubble.
function openPrintSingleOverlay(idx) {
  idx = safeIdx(idx); if (idx === null) return;
  const chat = currentChat(); if (!chat) return;
  const msg = getActivePath(chat)[idx]; if (!msg) return;

  let text = '';
  if (typeof msg.content === 'string') text = msg.content;
  else if (Array.isArray(msg.content))
    text = msg.content.filter(p => p.type === 'text' && !p.text?.startsWith('--- ')).map(p => p.text).join('\n');

  _printSingleIdx = idx;
  const contentEl = document.getElementById('printSingleContent');
  // Show formatted preview (same as chat rendering)
  if (contentEl) {
    contentEl.innerHTML = formatText(text);
    // Trigger MathJax typesetting for the overlay content
    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([contentEl]).catch(() => {});
    }
  }
  document.getElementById('printSingleOverlay')?.classList.add('show');
}

// Closes the single-message print preview overlay.
function closePrintSingleOverlay() {
  _printSingleIdx = null;
  document.getElementById('printSingleOverlay')?.classList.remove('show');
}

// Opens the browser print dialog for a single message.
function printSingleBubble() {
  if (_printSingleIdx === null) return;
  const chat = currentChat(); if (!chat) return;
  const msg = getActivePath(chat)[_printSingleIdx]; if (!msg) return;

  let text = '';
  if (typeof msg.content === 'string') text = msg.content;
  else if (Array.isArray(msg.content))
    text = msg.content.filter(p => p.type === 'text' && !p.text?.startsWith('--- ')).map(p => p.text).join('\n');

  // Formatted HTML via formatText (same rendering as in chat)
  const formattedHtml = formatText(text);
  const noteHtml = (msg._note && msg._note.trim()) ? formatText(msg._note) : '';
  const role = msg.role === 'user' ? 'Du' : (splitModelId(msg._model || config.model).modelId || 'KI');
  const date = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const win = window.open('', '_blank', 'width=820,height=700');
  if (!win) { toast(t('js.popupBlocked')); return; }
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${tf('js.printMessageFrom', {role: escHtml(role)})}</title>
    <script>
      window.MathJax = {
        tex: { inlineMath:[['$','$'],['\\\\(','\\\\)']], displayMath:[['$$','$$'],['\\\\[','\\\\]']], processEscapes:true },
        options: { skipHtmlTags:['script','noscript','style','textarea','pre','code'] },
        chtml: {
          fontURL: '${new URL('_render/newcm-font/chtml/woff2', document.baseURI).href}',
          dynamicPrefix: '${new URL('_render/newcm-font/chtml/dynamic', document.baseURI).href}'
        },
        startup: { typeset: true },
      };
    <\/script>
    <script src="${new URL('_render/latex/tex-chtml.js', document.baseURI).href}"><\/script>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body { font-family: Georgia, 'Times New Roman', serif; max-width: 740px; margin: 40px auto; color: #111; font-size: 12pt; line-height: 1.65; }
      .meta { font-size: 10pt; color: #555; margin-bottom: 16px; border-bottom: 1px solid #ccc; padding-bottom: 8px; }
      p  { margin: 0 0 10px; }
      p:last-child { margin-bottom: 0; }
      strong { font-weight: 700; }
      em     { font-style: italic; }
      del    { text-decoration: line-through; }
      h1 { font-size: 18pt; margin: 14px 0 6px; }
      h2 { font-size: 15pt; margin: 12px 0 4px; }
      h3 { font-size: 13pt; margin: 10px 0 4px; }
      ul, ol { margin: 6px 0 6px 22px; }
      li { margin-bottom: 3px; }
      code { font-family: 'Courier New', monospace; font-size: 10pt; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
      pre  { font-family: 'Courier New', monospace; font-size: 9.5pt; background: #f4f4f4; border: 1px solid #ddd; padding: 10px 14px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; margin: 8px 0; }
      pre code { background: none; padding: 0; }
      .code-block { margin: 8px 0; }
      .code-block-header { display: none; }
      .math-block { display: block; margin: 10px 0; }
      table { border-collapse: collapse; width: 100%; font-size: 11pt; margin: 8px 0; }
      th, td { border: 1px solid #bbb; padding: 5px 10px; }
      th { background: #eef; }
      hr { border: none; border-top: 1px solid #ccc; margin: 10px 0; }
      .note-block { margin-top: 18px; padding: 8px 12px; background: #fff9e0; border: 1px solid #d6b23f; border-left: 3px solid #cf9a1a; border-radius: 4px; font-size: 10.5pt; }
      .note-block .note-block-label { display: block; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #a9821f; margin-bottom: 4px; }
      @media print {
        body { margin: 20px; }
        .code-block-header { display: none !important; }
      }
    </style>
  </head><body>
    <div class="meta"><strong>${escHtml(role)}</strong> · ${escHtml(date)}</div>
    <div class="content">${formattedHtml}</div>
    ${noteHtml ? `<div class="note-block"><span class="note-block-label">🗒️ ${escHtml(t('js.noteLabel'))}</span>${noteHtml}</div>` : ''}
    <script>
      var _printed = false;
      function doPrint() {
        if (_printed) return;
        _printed = true;
        if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
          MathJax.startup.promise.then(() => {
            MathJax.typesetPromise().then(() => { window.print(); }).catch(() => { window.print(); });
          }).catch(() => { window.print(); });
        } else {
          window.print();
        }
      }
      if (document.readyState === 'complete') {
        setTimeout(doPrint, 300);
      } else {
        window.addEventListener('load', function() { setTimeout(doPrint, 300); });
      }
      // Hard fallback: in case MathJax isn't done after 4s
      setTimeout(function() { if (!_printed) doPrint(); }, 4000);
    <\/script>
  </body></html>`);
  win.document.close();
  win.focus();
  closePrintSingleOverlay();
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
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
