// ================================================================
// kiconnect.js  –  KI Connect application logic
// Requires: kiconnect-languages-i18n.js (loaded before this file)
// ================================================================

// ── Theme ─────────────────────────────────────────────────────────
const THEMES = ['dark', 'oled', 'white', 'gold'];

function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'dark';
  document.documentElement.setAttribute('data-theme', name);
  // Update swatch active states
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.getAttribute('data-theme') === name);
  });
}

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

function t(key) {
  const lang = TRANSLATIONS[currentLang] || TRANSLATIONS['en'];
  return lang[key] ?? TRANSLATIONS['en'][key] ?? key;
}
function tf(key, vars) {
  let s = t(key);
  if (vars) Object.entries(vars).forEach(([k,v]) => { s = s.replaceAll(`{${k}}`, v); });
  return s;
}
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
  document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = currentLang;
  if (typeof syncCustomDropdown === 'function') {
    const hiddenSel = document.getElementById('modelSelector');
    if (hiddenSel && !hiddenSel.value) syncCustomDropdown();
  }
}
function setLang(code) {
  currentLang = code;
  localStorage.setItem('kic_lang', code);
  applyTranslations();
  retranslateBubbleButtons();
  retranslateSuggestionChips();
  if (typeof updateThinkingIntensityUI === 'function') updateThinkingIntensityUI();
  if (typeof configureThinkingSlider === 'function') {
    const { modelId } = (typeof splitModelId === 'function' && config?.model)
      ? splitModelId(config.model) : { modelId: '' };
    configureThinkingSlider(modelId);
  }
  if (typeof syncCustomDropdown === 'function') syncCustomDropdown();
  if (typeof window._kicVoiceRetranslate === 'function') window._kicVoiceRetranslate();
  renderLangDropdown();
  closeLangDropdown();
}
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
function toggleLangDropdown() {
  const dd = document.getElementById('langDropdown');
  if (!dd) return;
  renderLangDropdown();
  dd.classList.toggle('open');
}
function closeLangDropdown() {
  document.getElementById('langDropdown')?.classList.remove('open');
}

function retranslateBubbleButtons() {
  document.querySelectorAll('.bubble-act-btn[data-action]').forEach(btn => {
    const action = btn.getAttribute('data-action');
    const keyMap = {
      'copy': 'js.copy', 'edit': 'js.edit', 'branch': 'js.branch',
      'regenerate': 'js.regenerate', 'delete': 'js.delete'
    };
    if (keyMap[action]) btn.textContent = t(keyMap[action]);
  });
}
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
function getMaxImageStorageBytes() {
  const v = parseInt(localStorage.getItem('kic_max_img_bytes') || '0');
  return v > 0 ? v : DEFAULT_MAX_IMAGE_STORAGE_BYTES;
}
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
  return 4096;
}
function getModelMaxOutput(modelId) {
  if (!modelId) return 8096;
  const override = config.userModelMaxOverrides?.[modelId];
  if (override && override > 0) return override;
  return getModelDefaultMax(modelId);
}

// ── STATE ─────────────────────────────────────────────────────────
let config = {
  model: '', temperature: 0.7, maxTokens: null, systemPrompt: '',
  activeProfileId: null, userModelMaxOverrides: {}, chatMaxWidth: 880,
  thinkingEnabled: false, thinkingIntensity: 2, thinkingBudget: 8000,
};
let providers = [];
let profiles  = [];
let folders   = [];
let chats     = [];
let currentChatId   = null;
let attachments     = [];
let isStreaming      = false;
let abortController = null;
let editingProfileId  = null;
let editingProviderId = null;
let draggedChatId   = null;
let draggedFolderId = null;   // NEW: folder drag state
let sidebarCollapsed = false;
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
const BF_BASE_DELAY_MS = 30000; // 30 s nach 5 Fehlversuchen, dann exponentiell

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
function _resetLoginFailures(accountId) { delete _loginFailures[accountId]; }
function _loginLockRemaining(accountId) {
  const f = _loginFailures[accountId];
  if (!f || !f.lockedUntil) return 0;
  const rem = f.lockedUntil - Date.now();
  return rem > 0 ? rem : 0;
}

let _lockCountdownTimer = null;
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
function _stopLockCountdown() {
  if (_lockCountdownTimer) { clearInterval(_lockCountdownTimer); _lockCountdownTimer = null; }
}

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
// No seed anymore in localStorage. Der PBKDF2-Salt (16 Byte, randomly,
// per account) liegt im Account registry - er ist kein secret,
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
    // WICHTIG: await hier, damit der Salt garantiert persistiert ist
    // bevor wir ihn zum Verschluesseln verwenden. Ohne await koennte
    // ein Reload einen neuen Salt generieren -> falscher Key -> Datenverlust.
    await _registryPut(_accounts);
  }
  const saltBytes = Uint8Array.from(atob(encSalt), c => c.charCodeAt(0));
  const passphrase = 'kic-enc-v5|' + (_sessionPassphrase || '');
  _cryptoKey = await deriveKeyPBKDF2(passphrase, saltBytes);
  return _cryptoKey;
}

// == Session token: F5 reload without password storage ==============
// The password is NOT stored in sessionStorage.
// Stattdessen: nach erfolgreichem Login wird ein mit dem CryptoKey
// verschluesselter Token in sessionStorage abgelegt.
// Bei F5/Reload: Token entschluesseln -> wenn OK -> weiter eingeloggt.
// Ohne den RAM-CryptoKey (= anderer Tab, Browser-Neustart) kein Zugang.
const _SESSION_TOKEN_KEY = 'kic_st';

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

function setSessionPassphrase(pw) {
  _sessionPassphrase = pw || null;
  _cryptoKey = null; // Key-Cache invalidieren
  if (!pw) { try { sessionStorage.removeItem(_SESSION_TOKEN_KEY); } catch {} }
  // No password in sessionStorage anymore!
  // _writeSessionToken() wird nach getCryptoKey() aufgerufen.
}
function restoreSessionPassphrase() {
  // Prueft nur ob ein Token vorhanden ist; Validierung erfolgt async in checkLogin().
  return !!sessionStorage.getItem(_SESSION_TOKEN_KEY);
}

async function encryptStr(plaintext) {
  if (!plaintext) return '';
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + enc.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

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
async function decryptObj(b64, fallback) {
  if (!b64) return fallback;
  try {
    const json = await decryptStr(b64);
    if (!json) return fallback;
    return JSON.parse(json);
  } catch { return fallback; }
}

async function encryptProvider(p) {
  const out = {...p};
  if (p.apiKey) out.apiKey = await encryptStr(p.apiKey);
  return out;
}
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
function getAccount(id) { return _accounts.find(a => a.id === id) || null; }

// ═══════════════════════════════════════════════════════════════
// ======================================================================
// PERSIST v5 - Server-Storage (./datas/) + localStorage-Fallback
// ======================================================================
// Alle Account-Daten werden primaer auf dem lokalen Proxy-Server
// unter ./datas/<accountId>/<key>.json gespeichert.
// Dadurch sind sie browser-unabhaengig (Chrome, Firefox, Edge, ...).
// Fallback auf localStorage wenn der Proxy nicht erreichbar ist.
// ======================================================================

const _STORE_BASE = '/store';
let _storeAvailable = true; // false wenn Server nicht reagiert

async function _storeGet(accountId, key) {
  if (!_storeAvailable) return _lsGetRaw(accountId, key);
  try {
    const res = await fetch(`${_STORE_BASE}/${accountId}/${key}`, { method: 'GET' });
    if (!res.ok) { if (res.status === 404) return null; throw new Error(res.status); }
    const text = await res.text();
    if (!text || text === 'null') return null;
    return JSON.parse(text); // verschluesselter String oder Wert
  } catch (e) {
    console.warn('[store] GET failed, fallback to localStorage:', e.message);
    _storeAvailable = false;
    return _lsGetRaw(accountId, key);
  }
}

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

async function _storeDel(accountId, key) {
  if (_storeAvailable) {
    try { await fetch(`${_STORE_BASE}/${accountId}/${key}`, { method: 'DELETE' }); } catch {}
  }
  localStorage.removeItem(`kic_${accountId}_${key}`);
}

async function _registryGet() {
  if (_storeAvailable) {
    try {
      const res = await fetch(`${_STORE_BASE}/`, { method: 'GET' });
      if (res.ok) { const t = await res.text(); if (t && t !== 'null') return JSON.parse(t); }
    } catch (e) { console.warn('[store] registry GET failed:', e.message); _storeAvailable = false; }
  }
  try { return JSON.parse(localStorage.getItem('kic_accounts') || '[]'); } catch { return []; }
}

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

function _lsGetRaw(accountId, key) {
  const v = localStorage.getItem(`kic_${accountId}_${key}`);
  if (v === null) return null;
  try { return JSON.parse(v); } catch { return v; }
}
function _lsSetRaw(accountId, key, rawStr) {
  try { localStorage.setItem(`kic_${accountId}_${key}`, rawStr); } catch {}
}

// Account registry Helfer
function loadAccountRegistry() {
  try { _accounts = JSON.parse(localStorage.getItem('kic_accounts') || '[]'); } catch { _accounts = []; }
}
async function loadAccountRegistryAsync() {
  try { _accounts = await _registryGet() || []; } catch { _accounts = []; }
}
function saveAccountRegistry() {
  _registryPut(_accounts).catch(() => {});
}

function sanitizeMsgForStorage(msg) {
  if (!Array.isArray(msg.content)) return msg;
  const maxBytes = getMaxImageStorageBytes();
  const safeContent = msg.content.map(p => {
    if (p.type === 'image_url') {
      const url = p.image_url?.url || '';
      if (url.startsWith('data:') && url.length > maxBytes) {
        return { type: 'text', text: '[' + t('js.imageNotSaved') + ']' };
      }
    }
    return p;
  });
  return { ...msg, content: safeContent };
}

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
  try { config = {...config, ...await loadKey('config', {})}; } catch{}
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
function makeModelId(providerId, modelId) { return `${providerId}::${modelId}`; }
function providerForModel(fullModelId) {
  const { providerId } = splitModelId(fullModelId);
  return providers.find(p => p.id === providerId) || null;
}
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
  return null;
}
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
  'api.mistral.ai','generativelanguage.googleapis.com','api.x.ai','api.groq.com', 'api.deepseek.com',
];
function isSafeApiUrl(url) {
  try {
    const h = new URL(url).hostname;
    return ALLOWED_API_DOMAINS.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
}
function proxyUrl(url) {
  if (!isSafeApiUrl(url)) { console.error('[Security] Blocked:', url); throw new Error(t('js.apiDomainBlocked') || 'API domain not allowed.'); }
  return USE_PROXY ? '/proxy/' + url : url;
}

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
}

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
    let badgeCls, badgeTxt;
    if (!p.apiKey)        { badgeCls = 'warn'; badgeTxt = t('js.noKey'); }
    else if (st === 'ok') { badgeCls = 'ok';   badgeTxt = t('js.keyOk'); }
    else if (st === 'error') { badgeCls = 'warn'; badgeTxt = t('js.keyError'); }
    else                  { badgeCls = '';     badgeTxt = t('js.keyPending'); }

    const item = document.createElement('div');
    item.className = 'provider-item';
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
    item.appendChild(info); item.appendChild(badge); item.appendChild(actions);
    list.appendChild(item);
  });
}

function startNewProvider() {
  editingProviderId = null;
  document.getElementById('pvNameInput').value  = '';
  document.getElementById('pvServerUrl').value  = '';
  document.getElementById('pvApiKey').value     = '';
  selectProviderType('openai-compat');
  document.getElementById('providerEditorTitle').textContent = t('provider.new');
  document.getElementById('providerEditor').style.display = 'block';
}
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
function getSelectedProviderType() { return document.querySelector('.type-chip.selected')?.dataset.type || 'openai-compat'; }

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
}
function cancelProviderEditor() { document.getElementById('providerEditor').style.display = 'none'; }
function deleteProvider(id) {
  providers = providers.filter(p => p.id !== id);
  save(); renderProviderList(); fetchModels();
}

// ── Profiles ──────────────────────────────────────────────────────
function activeProfile() { return profiles.find(p => p.id === config.activeProfileId) || null; }
function applyProfile(p) {
  if (!p) return;
  config.activeProfileId = p.id;
  config.systemPrompt  = p.systemPrompt ?? '';
  config.temperature   = p.temperature  ?? 0.7;
  if (p.model) config.model = p.model;
  syncSettingsPanel(); updateProfileBadge();
  const sel = document.getElementById('modelSelector');
  if (sel && config.model) {
    sel.value = config.model;
    const inp = document.getElementById('modelInput');
    if (inp) inp.value = config.model;
  }
  save(); toast(`${t('js.profileActivated')}: „${p.name}"`);
}
function updateProfileBadge() {
  const p = activeProfile();
  const nameEl = document.getElementById('profileBadgeName');
  if (nameEl) {
    if (p) { nameEl.textContent = p.name; nameEl.removeAttribute('data-i18n'); }
    else   { nameEl.textContent = t('header.noProfile'); nameEl.setAttribute('data-i18n','header.noProfile'); }
  }
  document.getElementById('profileBadgeDot').style.background = p ? p.color : 'var(--muted)';
}

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
    descEl.textContent = (p.model ? p.model.split('/').pop().slice(0,24) : t('js.globalModel')) + ' · Temp ' + (p.temperature ?? 0.7);
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

function selectProfile(id) { const p = profiles.find(x=>x.id===id); if(p) { applyProfile(p); renderProfileList(); } }

function startNewProfile() {
  editingProfileId = null;
  document.getElementById('peNameInput').value  = '';
  document.getElementById('peSysPrompt').value  = '';
  document.getElementById('peTemp').value       = '0.7';
  document.getElementById('peTempVal').textContent = '0.7';
  document.getElementById('peUseModelMax').checked = true;
  document.getElementById('profileEditorTitle').textContent = t('profile.new');
  renderColorRow(PROFILE_COLORS[profiles.length % PROFILE_COLORS.length]);
  syncPeModelSelect('');
  document.getElementById('profileEditor').style.display = 'block';
}
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
  syncPeModelSelect(p.model||'');
  const { modelId } = splitModelId(p.model || config.model);
  const modelMax = getModelMaxOutput(modelId);
  const slider = document.getElementById('peMaxTokensSlider');
  const storedVal = p.maxTokens || modelMax;
  slider.max = modelMax; slider.value = Math.min(storedVal, modelMax);
  document.getElementById('peMaxTokensNum').textContent = parseInt(slider.value).toLocaleString();
  document.getElementById('profileEditor').style.display = 'block';
}
function syncPeModelSelect(selected) {
  const src = document.getElementById('modelSelector');
  const dst = document.getElementById('peModelInput');
  dst.innerHTML = `<option value="">${escHtml(t('js.globalModelOpt'))}</option>` +
    Array.from(src.querySelectorAll('optgroup, option')).map(el=>el.outerHTML).join('');
  dst.value = selected || '';
  updatePeMaxTokensUI();
}
function updatePeMaxTokensUI() {
  const fullId = document.getElementById('peModelInput').value || config.model;
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
function getSelectedColor() { return document.querySelector('.color-swatch.selected')?.dataset.color || PROFILE_COLORS[0]; }
function saveProfileEditor() {
  const name = document.getElementById('peNameInput').value.trim();
  if (!name) { toast(t('js.nameRequired')); return; }
  const sliderVal = parseInt(document.getElementById('peMaxTokensSlider').value);
  const useModelMax = document.getElementById('peUseModelMax').checked;
  const data = {
    name, model: document.getElementById('peModelInput').value, color: getSelectedColor(),
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
function cancelProfileEditor() { document.getElementById('profileEditor').style.display = 'none'; }
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
  // Populate account name field
  const accNameInput = document.getElementById('accountNameInput');
  if (accNameInput && _activeAccountId) {
    const acc = getAccount(_activeAccountId);
    if (acc) accNameInput.value = acc.name;
  }
  updateActiveProviderInfo(); updateModelMaxInfo();
}

function saveSettings() {
  config.temperature  = parseFloat(document.getElementById('temperature').value);
  config.systemPrompt = document.getElementById('systemPrompt').value;
  const sel = document.getElementById('modelInput').value;
  if (sel) config.model = sel;
  const p = activeProfile();
  if (p) { p.systemPrompt = config.systemPrompt; p.temperature = config.temperature; if(sel) p.model=sel; }
  // Save image size limit
  const imgSizeEl = document.getElementById('maxImgSizeInput');
  if (imgSizeEl) {
    const kb = parseInt(imgSizeEl.value);
    if (kb >= 100) setMaxImageStorageBytes(kb * 1024);
  }
  save(); fetchModels(); closePanels(); toast(t('js.settingsSaved'));
}
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

async function fetchModels() {
  if (!providers.length) { setStatus('yellow'); return; }
  let allGroups = [], anyOk = false, anyError = false;
  for (const provider of providers) {
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
    const p = activeProfile(); if(p) p.model = config.model;
    updateModelMaxInfo(); updateThinkingUI(); save(); renderAttachments();
    if (window.syncCustomDropdown) syncCustomDropdown();
  };
  updateModelMaxInfo(); syncAllModelSelects(); updateThinkingUI();
  if (window.buildCustomDropdownData) buildCustomDropdownData();
}
function updateModelMaxInfo() {
  const { modelId } = splitModelId(config.model);
  const max = getModelMaxOutput(modelId);
  const el = document.getElementById('modelMaxInfo');
  if (el) el.textContent = modelId ? tf('js.modelMax', {n: max.toLocaleString()}) : '';
}

// ── Thinking / Reasoning UI ───────────────────────────────────────
const OAI_EFFORT = { 1: 'low', 2: 'medium', 3: 'high' };
const CLAUDE_BUDGET = { 1: 2000, 2: 8000, 3: 20000 };

function isThinkingCapable(modelId) {
  if (!modelId) return false;
  const bare = modelId.split('/').pop().toLowerCase();
  return THINKING_MODELS.has(modelId) || THINKING_MODELS.has(bare) ||
    /^o\d/.test(bare) || /claude-(opus|sonnet)-4/.test(bare) || /claude-3-7/.test(bare) ||
    /thinking|reason/i.test(bare) || /deepseek-r|deepseek-v4|qwen.*think|qwq|llama.*reason/i.test(bare);
}
function isAnthropicThinkingModel(modelId) {
  return /^claude-(opus-4|sonnet-4|3-7-sonnet)/i.test(modelId);
}
function usesTokenBudget(modelId) { return isAnthropicThinkingModel(modelId || ''); }
function getThinkingBudget() { return config.thinkingBudget || 8000; }
function getThinkingEffortStr() { return OAI_EFFORT[config.thinkingIntensity || 2]; }

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
function toggleThinking() {
  const { modelId } = splitModelId(config.model);
  if (!isThinkingCapable(modelId)) return;
  config.thinkingEnabled = !config.thinkingEnabled;
  document.getElementById('thinkingToggle')?.classList.toggle('active', config.thinkingEnabled);
  document.getElementById('thinkingIntensity')?.classList.toggle('visible', config.thinkingEnabled);
  save();
  toast(config.thinkingEnabled ? t('js.thinkingEnabled') : t('js.thinkingDisabled'));
}
function syncAllModelSelects() {
  const src = document.getElementById('modelSelector');
  const dst = document.getElementById('peModelInput');
  if (!dst) return;
  dst.innerHTML = `<option value="">${escHtml(t('js.globalModelOpt'))}</option>` +
    Array.from(src.querySelectorAll('optgroup, option')).map(el=>el.outerHTML).join('');
  dst.value = '';
}
function setStatus(c) {
  const d = document.getElementById('statusDot');
  const colors = { green:'var(--green)', red:'var(--red)', yellow:'#f0c040', grey:'var(--muted)' };
  const col = colors[c] || colors.grey;
  d.style.background = col; d.style.boxShadow = `0 0 8px ${col}`;
}

// ══════════════════════════════════════════════════════════════════
// FOLDERS — with drag & drop reordering
// ══════════════════════════════════════════════════════════════════
function newFolder() {
  const id = Date.now().toString();
  folders.push({id, name: t('js.newFolder'), collapsed:false});
  save(); renderSidebar(); setTimeout(()=>startRenamingFolder(id), 50);
}
function deleteFolder(id) {
  chats.forEach(c=>{if(c.folderId===id)c.folderId=null;});
  folders = folders.filter(f=>f.id!==id);
  save(); renderSidebar();
}
function toggleFolder(id) {
  const f = folders.find(x=>x.id===id);
  if (f) { f.collapsed=!f.collapsed; save(); renderSidebar(); }
}
function startRenamingFolder(id) {
  const el = document.getElementById(`fname_${id}`); if(!el) return;
  const f = folders.find(x=>x.id===id);
  const input = document.createElement('input');
  input.className = 'folder-name-input'; input.value = f.name;
  input.addEventListener('blur', () => commitRenameFolder(id, input.value));
  input.addEventListener('keydown', e => { if(e.key==='Enter') input.blur(); });
  el.replaceWith(input); input.focus();
}
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
function onFolderDragOver(e, targetId) {
  if (!draggedFolderId || draggedFolderId === targetId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
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
function newChat(folderId=null) {
  if (folderId===null && folders.length>0) folderId = folders[0].id;
  const id = Date.now().toString();
  chats.unshift({id, title:'Chat::', folderId, messages:[]});
  currentChatId = id; save(); renderSidebar(); renderMessages([]);
}
function switchChat(id) {
  currentChatId = id;
  // Persist via server store (encrypted) – not raw localStorage
  _storePut(_activeAccountId, 'current_chat', id).catch(() => {
    localStorage.setItem(accountKey('current_chat'), id);
  });
  renderSidebar();
  const c = chats.find(x=>x.id===id);
  if (c) renderMessages(c.messages);
}
function deleteChat(id) {
  chats = chats.filter(c=>c.id!==id);
  if (currentChatId === id) {
    currentChatId = chats[0]?.id||null;
    if (currentChatId) renderMessages(currentChat().messages);
    else { const c=document.getElementById('messages'); c.innerHTML=''; const e=document.getElementById('emptyState'); if(e){c.appendChild(e);e.style.display='';} }
  }
  save(); renderSidebar();
}
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
function moveChat(chatId, folderId) {
  const c = chats.find(x=>x.id===chatId);
  if (c) { c.folderId = folderId; save(); renderSidebar(); }
}

function showChatCtxMenu(e, chatId) {
  e.preventDefault(); e.stopPropagation();
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';

  // Rename
  const renameItem = document.createElement('div');
  renameItem.className = 'ctx-item'; renameItem.textContent = t('js.rename');
  renameItem.dataset.id = chatId;
  renameItem.addEventListener('click', () => { startRenamingChat(renameItem.dataset.id); hideCtx(); });

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
    noFolderOpt.addEventListener('click', () => { moveChat(chatId, null); hideCtx(); });
    submenu.appendChild(noFolderOpt);
    folders.forEach(f => {
      const opt = document.createElement('div');
      opt.className = 'ctx-item';
      const chat = chats.find(c => c.id === chatId);
      if (chat && chat.folderId === f.id) opt.style.opacity = '0.5';
      opt.textContent = f.name;
      opt.dataset.fid = f.id;
      opt.addEventListener('click', () => { moveChat(chatId, opt.dataset.fid); hideCtx(); });
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
function hideCtx() { document.getElementById('ctxMenu').style.display='none'; }
document.addEventListener('click', hideCtx);

// ── Multi-select helpers ──────────────────────────────────────────
function toggleChatSelect(id) {
  if (_selectedChatIds.has(id)) _selectedChatIds.delete(id);
  else _selectedChatIds.add(id);
  if (_selectedChatIds.size === 0) _multiSelectMode = false;
  renderSidebar();
}
function enterMultiSelectMode() {
  _multiSelectMode = true;
  _selectedChatIds.clear();
  document.body.classList.add('multiselect-active');
  renderSidebar();
}
function exitMultiSelectMode() {
  _multiSelectMode = false;
  _selectedChatIds.clear();
  document.body.classList.remove('multiselect-active');
  renderSidebar();
}
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
function onDragStart(e, id) { draggedChatId=id; e.dataTransfer.effectAllowed='move'; }
function onDropFolder(e, folderId) {
  e.preventDefault();
  document.querySelectorAll('.drag-target').forEach(el=>el.classList.remove('drag-target'));
  if (draggedChatId) { moveChat(draggedChatId, folderId); draggedChatId=null; }
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
        msBtn.title = t('js.multiSelect') || 'Multi Select';
        msBtn.textContent = '☐';
        msBtn.addEventListener('click', enterMultiSelectMode);
        actionsEl.appendChild(msBtn);
      }
    }
  }

  const unfiled = chats.filter(c=>!c.folderId||!folders.find(f=>f.id===c.folderId));

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
    header.className = 'folder-header';
    header.id = `fh_${f.id}`;
    const arrow = document.createElement('span');
    arrow.className = 'folder-arrow ' + (f.collapsed ? '' : 'open');
    arrow.textContent = '▶';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-name';
    nameSpan.id = `fname_${f.id}`;
    nameSpan.textContent = f.name;
    nameSpan.addEventListener('dblclick', () => startRenamingFolder(f.id));
    const countSpan = document.createElement('span');
    countSpan.className = 'folder-count'; countSpan.textContent = fc.length;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'folder-actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-btn'; renameBtn.textContent = '✏️';
    renameBtn.dataset.id = f.id;
    renameBtn.addEventListener('click', e => { e.stopPropagation(); startRenamingFolder(renameBtn.dataset.id); });
    const delBtn = document.createElement('button');
    delBtn.className = 'folder-btn danger'; delBtn.textContent = '🗑';
    delBtn.dataset.id = f.id;
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteFolder(delBtn.dataset.id); });
    actionsDiv.appendChild(renameBtn); actionsDiv.appendChild(delBtn);
    header.appendChild(arrow); header.appendChild(nameSpan); header.appendChild(countSpan); header.appendChild(actionsDiv);
    header.addEventListener('dragover', e => {
      if (draggedChatId) { e.preventDefault(); header.classList.add('drag-target'); }
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-target'));
    header.addEventListener('drop', e => { if(draggedChatId) onDropFolder(e, f.id); });
    header.addEventListener('click', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      toggleFolder(f.id);
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
    folderDiv.className = 'folder';
    const header = document.createElement('div');
    header.className = 'folder-header';
    const arrow = document.createElement('span'); arrow.className='folder-arrow open'; arrow.textContent='▶';
    const nameSpan = document.createElement('span'); nameSpan.className='folder-name'; nameSpan.textContent=t('js.noFolder');
    const countSpan = document.createElement('span'); countSpan.className='folder-count'; countSpan.textContent=unfiled.length;
    header.appendChild(arrow); header.appendChild(nameSpan); header.appendChild(countSpan);
    header.addEventListener('dragover', e=>{if(draggedChatId){e.preventDefault();header.classList.add('drag-target');}});
    header.addEventListener('dragleave',()=>header.classList.remove('drag-target'));
    header.addEventListener('drop', e=>{ if(draggedChatId) onDropFolder(e,null); });
    const chatsDiv = document.createElement('div');
    chatsDiv.className = 'folder-chats';
    chatsDiv.addEventListener('dragover', e=>{if(draggedChatId)e.preventDefault();});
    chatsDiv.addEventListener('drop', e=>{if(draggedChatId)onDropFolder(e,null);});
    unfiled.forEach(c=>chatsDiv.appendChild(buildChatItem(c)));
    folderDiv.appendChild(header); folderDiv.appendChild(chatsDiv);
    container.appendChild(folderDiv);
  }
}

function buildChatItem(c) {
  const div = document.createElement('div');
  const isSelected = _selectedChatIds.has(c.id);
  div.className = 'chat-item'
    + (c.id === currentChatId ? ' active' : '')
    + (_multiSelectMode && isSelected ? ' multi-selected' : '');
  div.draggable = !_multiSelectMode;
  div.dataset.id = c.id;

  // Checkbox for multi-select mode
  const cb = document.createElement('span');
  cb.className = 'chat-item-cb';
  cb.textContent = isSelected ? '☑' : '☐';
  cb.addEventListener('click', e => { e.stopPropagation(); toggleChatSelect(c.id); });

  div.addEventListener('dragstart', e => {
    if (_multiSelectMode) { e.preventDefault(); return; }
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

// ── Message Rendering ─────────────────────────────────────────────
// BEGIN MODIFIED — Tree-branch helpers ─────────────────────────────

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

// END MODIFIED — Tree-branch helpers ───────────────────────────────

// BEGIN MODIFIED — renderMessages uses active branch path (tree-aware)
function renderMessages(messages, _unused) {
  const chat = currentChat();
  const container = document.getElementById('messages');
  const empty     = document.getElementById('emptyState');
  const path = chat ? getActivePath(chat) : (Array.isArray(messages) ? messages : []);
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
// END MODIFIED

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

  // BEGIN MODIFIED — sibling navigator (< 1/3 >) for AI messages with variants
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
    wrap.appendChild(nav);
  }
  // END MODIFIED

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

  if (!contentHtml && bubble.children.length === 0)
    bubble.innerHTML = `<em style="color:var(--muted)">${escHtml(t('js.empty'))}</em>`;

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
  actDiv.appendChild(makeActBtn(t('js.delete'),     'danger', deleteBubble, 'delete'));

  if (!isUser && msg._usage) {
    const badge = buildTokenBadge(msg._usage);
    wrap.appendChild(bubble); wrap.appendChild(actDiv); wrap.appendChild(badge);
  } else {
    wrap.appendChild(bubble); wrap.appendChild(actDiv);
  }
  row.appendChild(avatarCol); row.appendChild(wrap);

  row.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    btn.addEventListener('click', () => copyCodeFromBtn(btn));
  });
  return row;
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

function updateChatTokenTotal() {
  const chat=currentChat();
  let total=document.getElementById('chatTokenTotal');
  if (!chat) { if(total) total.remove(); return; }
  const sum=chat.messages.reduce((acc,m)=>{
    if(!m._usage) return acc;
    return acc+(m._usage.input_tokens||0)+(m._usage.output_tokens||0);
  },0);
  if (sum===0) { if(total) total.remove(); return; }
  if (!total) {
    total=document.createElement('div'); total.id='chatTokenTotal'; total.className='chat-token-total';
    document.getElementById('messages').appendChild(total);
  }
  total.textContent=tf('js.chatTotalTokens',{n:sum.toLocaleString()});
}

function safeIdx(idx) {
  const n=parseInt(idx,10);
  if(!Number.isFinite(n)||n<0) return null;
  return n;
}

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
    msg.content = active.content;
    msg._model  = active._model;
    msg._usage  = active._usage;
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

  // BEGIN MODIFIED — Bug 3 fix: derive pdfMode from structured storage types (pdf_base64 /
  // pdf_text) instead of fragile i18n-string matching. Language-independent.
  _editAttachments = (msg._files || []).map(name => {
    const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
    const isPdf = /\.pdf$/i.test(name);
    if (!isPdf) return { type: isImg ? 'image' : 'text-file', name, _storedOnly: true };
    let pdfMode = 'b64';
    if (Array.isArray(msg.content)) {
      if (msg.content.some(p => p.type === 'pdf_text' && p.name === name)) pdfMode = 'text';
      else if (msg.content.some(p => p.type === 'pdf_base64' && p.name === name)) pdfMode = 'b64';
    }
    return { type: 'pdf-b64', name, _storedOnly: true, pdfMode };
  });
  // END MODIFIED

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

  // BEGIN MODIFIED — Bug 2+3 fix: restore _storedOnly file content by typed lookup on
  // msg.content (pdf_base64, pdf_text) — language-independent, no fragile regex needed.
  _editAttachments.forEach(a => {
    newFileNames.push(a.name);
    if (a._storedOnly) {
      if (Array.isArray(msg.content)) {
        if (a.type === 'pdf-b64' && a.pdfMode === 'b64') {
          const block = msg.content.find(p => p.type === 'pdf_base64' && p.name === a.name);
          if (block) newContent.push(block);
        } else if (a.type === 'pdf-b64' && a.pdfMode === 'text') {
          const block = msg.content.find(p => p.type === 'pdf_text' && p.name === a.name);
          if (block) newContent.push(block);
        } else {
          // text-file: still stored as labelled text block (startsWith '--- ')
          msg.content.forEach(p => {
            if (p.type === 'text' && p.text?.startsWith('--- ')) {
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
  // END MODIFIED

  msg.content = newContent.length === 1 && newContent[0].type === 'text' ? newContent[0].text : newContent;
  if (newFileNames.length) msg._files = newFileNames; else delete msg._files;
  _editAttachments = []; _editMsgIdx = null;
  save(); renderMessages(chat.messages);
}

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

function handleEditImageAttach(e) {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    _editAttachments.push({ type:'image', name:file.name, data:ev.target.result });
    renderEditFileChips();
  };
  reader.readAsDataURL(file);
}

// BEGIN MODIFIED — Navigate between sibling variants; each has its own tail (sub-tree)
function navigateSibling(idx, delta) {
  const chat = currentChat(); if (!chat) return;
  const path = getActivePath(chat);
  const msg  = path[idx];
  if (!msg || !msg._siblings) return;

  const newIdx = (msg._siblingIdx ?? 0) + delta;
  if (newIdx < 0 || newIdx >= msg._siblings.length) return;

  msg._siblingIdx = newIdx;
  const variant   = msg._siblings[newIdx];
  // Sync live fields (used by rerunFromUserMsg context-building)
  msg.content = variant.content;
  msg._model  = variant._model;
  msg._usage  = variant._usage;

  save();
  renderMessages(chat.messages); // getActivePath will now follow new _siblingIdx
}
// END MODIFIED

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

// ── BEGIN MODIFIED: Shared AI-Streaming-Helpers ───────────────────
// _toAnthropicContent: Converts internal content array to Anthropic wire format.
// BEGIN MODIFIED — handles pdf_text (text-mode PDF, language-independent storage type)
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
    return p;
  });
}
// END MODIFIED

// _toOpenAIContent: Expands internal storage types (pdf_text, pdf_base64) to plain text/
// image_url for OpenAI-compat APIs that don't understand these internal block types.
// BEGIN MODIFIED
function _toOpenAIContent(content) {
  if (!Array.isArray(content)) return content;
  return content.map(p => {
    if (p.type === 'pdf_text')
      return { type: 'text', text: `${tf('js.fileContent',{name:p.name})}\n${p.text}\n${t('js.fileEnd')}` };
    if (p.type === 'pdf_base64')
      return { type: 'text', text: `[PDF: ${p.name}]` }; // b64 not supported in OpenAI text mode
    return p;
  });
}
// END MODIFIED

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

// _renderThinkingBubble: Returns combined thinking+text HTML for the live bubble.
function _renderThinkingBubble(thinkingText, assistantText) {
  const th = thinkingText
    ? `<details class="thinking-block" style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;font-family:'IBM Plex Mono',monospace;color:var(--accent2);opacity:0.8;">${tf('js.thinkingBlock', { n: thinkingText.length })}</summary><pre style="font-size:11px;color:var(--muted);white-space:pre-wrap;margin-top:6px;padding:8px;background:#0a0c10;border-radius:6px;">${escHtml(thinkingText)}</pre></details>`
    : '';
  return th + formatText(assistantText);
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
          if (ev.type === 'message_start' && ev.message?.usage) { usageData = { ...(usageData || {}), ...ev.message.usage }; }
          else if (ev.type === 'message_delta' && ev.usage) { usageData = { ...(usageData || {}), ...ev.usage }; }
          else if (ev.type === 'content_block_start') { inThinkingBlock = ev.content_block?.type === 'thinking'; }
          else if (ev.type === 'content_block_stop') { inThinkingBlock = false; }
          else if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'thinking_delta' && inThinkingBlock) {
              thinkingText += ev.delta.thinking || '';
              aiEl.querySelector('.bubble').innerHTML = _renderThinkingBubble(thinkingText, assistantText);
            } else if (ev.delta?.type === 'text_delta') {
              assistantText += ev.delta.text;
              aiEl.querySelector('.bubble').innerHTML = _renderThinkingBubble(thinkingText, assistantText);
              scrollToBottom();
            }
          }
        } catch {}
      }
    }
    if (thinkingText) assistantText = `<thinking>\n${thinkingText}\n</thinking>\n\n` + assistantText;
    typesetMath();

  } else {
    const endpoint = getProviderEndpoint(provider);
    const { modelId } = splitModelId(config.model);
    const apiMsgs = [];
    if (config.systemPrompt) apiMsgs.push({ role: 'system', content: config.systemPrompt });
    // BEGIN MODIFIED: messages are already expanded by caller (_toOpenAIContent) — pass through
    messages.forEach(m => { if (m.role === 'user' || m.role === 'assistant') apiMsgs.push({ role: m.role, content: m.content }); });
    // END MODIFIED
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
    reqBody.stream_options = { include_usage: true };
    const extraHeaders = {};
    if (provider.type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
    const res = await fetch(proxyUrl(`${endpoint}/chat/completions`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders },
      body: JSON.stringify(reqBody),
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    removeTyping(typingId);
    const aiEl = appendEmptyAI();
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
          if (delta) { aiEl.querySelector('.bubble').innerHTML = formatText(assistantText); scrollToBottom(); }
          if (chunk.usage) {
            const u = chunk.usage;
            usageData = { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens || 0 };
          }
        } catch {}
      }
    }
    typesetMath();
  }

  return { text: assistantText, usage: usageData };
}

/**
 * _attachAIActions: Appends action buttons and token badge to the last AI bubble.
 * Shared post-stream logic for both sendMessageCore and rerunFromUserMsg.
 */
// BEGIN MODIFIED — _attachAIActions: tree-aware, writes into active sibling tail
function _attachAIActions(chat, assistantText, usageData) {
  if (chat._pendingRegenMsg) {
    // Regeneration: push new sibling with empty tail onto the branch node
    const msg = chat._pendingRegenMsg;
    const newSibling = { content: assistantText, _model: config.model, _usage: usageData || undefined, tail: [] };
    msg._siblings.push(newSibling);
    msg._siblingIdx = msg._siblings.length - 1;
    // Sync live fields to the new active variant
    msg.content = newSibling.content;
    msg._model  = newSibling._model;
    msg._usage  = newSibling._usage;
    delete chat._pendingRegenMsg;
  } else {
    // Normal send: append to the active container (chat.messages or deepest active tail)
    const container = getActiveContainer(chat);
    const msgObj = { role: 'assistant', content: assistantText, _model: config.model };
    if (usageData) msgObj._usage = usageData;
    container.push(msgObj);
  }

  renderMessages(chat.messages);
  updateChatTokenTotal();
  save();
}
// END MODIFIED
// ── END MODIFIED: Shared AI-Streaming-Helpers ─────────────────────

// BEGIN MODIFIED — Tree-branch regenerate: old tail is preserved in the current sibling
async function regenerate(idx) {
  idx=safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  // idx is a path index — resolve to the actual message object
  const path=getActivePath(chat);
  const msg=path[idx];
  if(!msg||msg.role!=='assistant') return;
  if(isStreaming){toast(t('js.pleaseWait'));return;}

  const userMsg=path[idx-1];
  if(!userMsg||userMsg.role!=='user'){save();renderMessages(chat.messages);return;}

  // Initialise siblings: wrap current content as siblings[0] with its existing tail
  if(!msg._siblings) {
    // Collect everything after this node in the active path as the original tail
    const originalTail = path.slice(idx+1).map(m => JSON.parse(JSON.stringify(m)));
    msg._siblings=[{content:msg.content,_model:msg._model,_usage:msg._usage,tail:originalTail}];
    msg._siblingIdx=0;
    // Remove those messages from whichever container they live in — now owned by tail
    _pruneAfter(chat, msg);
  }

  // New sibling starts with an empty tail; _attachAIActions will write into it
  const newSibIdx = msg._siblings.length; // will be pushed by _attachAIActions
  chat._pendingRegenMsg = msg;

  save(); renderMessages(chat.messages);
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
// END MODIFIED

// Fires a new AI completion using the current chat.messages state (no user-msg rebuild).
// BEGIN MODIFIED: Uses _streamAIResponse + _attachAIActions (removed ~80 lines of duplicated stream code)
async function rerunFromUserMsg(userMsg) {
  if(!currentChatId) newChat();
  const chat=currentChat(); if(!chat) return;
  const provider=providerForModel(config.model)||providers[0];
  if(!provider||!provider.apiKey){toast(t('js.noProvider'));openProviderPanel();return;}

  const typingId=showTyping();
  isStreaming=true; setSendMode('stop'); abortController=new AbortController();
  let assistantText='', usageData=null;

  try {
    // BEGIN MODIFIED: build history from active path up to (including) userMsg
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
    // END MODIFIED
    const result = await _streamAIResponse(messages, provider, typingId, []);
    assistantText = result.text; usageData = result.usage;
  } catch(e) {
    removeTyping(typingId);
    if(e.name==='AbortError'){if(!assistantText)assistantText=t('js.generationStopped');}
    else{assistantText=tf('js.errorPrefix',{e:escHtml(e.message)});const errEl=buildMsgEl({role:'assistant',content:assistantText},undefined);appendToMessages(errEl);scrollToBottom();setStatus('red');}
  }

  if(assistantText) _attachAIActions(chat, assistantText, usageData);
  isStreaming=false; abortController=null; setSendMode('send'); setStatus('green');
}
// END MODIFIED

// ── Send / Stop ───────────────────────────────────────────────────
function handleSendStop() { isStreaming ? stopStreaming() : sendMessage(); }
function stopStreaming() { if(abortController){abortController.abort();abortController=null;} }
function setSendMode(mode) {
  const btn=document.getElementById('sendBtn');
  btn.classList.toggle('stop-mode', mode==='stop');
  document.getElementById('sendBtnLabel').textContent = mode==='stop' ? t('js.stop') : t('js.send');
  document.getElementById('sendIcon').style.display  = mode==='stop' ? 'none' : '';
  document.getElementById('stopIcon').style.display  = mode==='stop' ? '' : 'none';
}

async function sendMessage() {
  if(isStreaming) return;
  const input=document.getElementById('messageInput');
  const text=input.value.trim();
  if(!text&&!attachments.length) return;
  if(!config.model){toast(t('js.noModel'));return;}
  const provider=providerForModel(config.model)||providers[0];
  if(!provider){toast(t('js.noProvider'));openProviderPanel();return;}
  if(!provider.apiKey){toast(t('js.noApiKey'));openProviderPanel();return;}
  const att=[...attachments];
  input.value=''; autoResize(input); clearAttachments();
  await sendMessageCore(text, att);
}

async function sendMessageCore(text, att) {
  if(!currentChatId) newChat();
  const empty=document.getElementById('emptyState');
  if(empty) empty.style.display='none';
  const provider=providerForModel(config.model)||providers[0];
  const isKiConnect=provider?.type==='kiconnect-nrw'||(provider?.type==='openai-compat'&&(provider.serverUrl||'').includes('kiconnect.nrw'));
  const documentIds=[];

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
        else if(a.pdfMode==='text'){const txt=a.extractedText||t('js.noText');userContent.push({type:'pdf_text',name:a.name,text:txt});} // BEGIN MODIFIED Bug 2: structured pdf_text block instead of i18n-string
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

  const maxBytes=getMaxImageStorageBytes();
  // BEGIN MODIFIED — Bug 1 fix: preserve pdf_base64 blocks and store text-mode PDFs
  // as {type:'pdf_text'} with name+text, so rerun/edit can restore them language-independently.
  const userMsgForStorage={
    role:'user',
    content:Array.isArray(userContent)
      ?userContent.map(p=>{
        // pdf_base64: keep — _toAnthropicContent converts to {type:'document'} on send
        if(p.type==='pdf_base64') return p;
        // text-mode PDF content block: convert to structured {type:'pdf_text'} for storage
        if(p.type==='pdf_text') return p;
        if(p.type==='image_url'){const url=p.image_url?.url||'';if(url.startsWith('data:')&&url.length>maxBytes)return{type:'text',text:'['+t('js.imageNotSaved')+']'};}
        return p;
      })
      :userContent,
    _files:fileNames.length?fileNames:undefined
  };
  // END MODIFIED
  const chat=currentChat();
  // BEGIN MODIFIED: push into active tail (tree-aware), not always top-level chat.messages
  const activeContainer = getActiveContainer(chat);
  activeContainer.push(userMsgForStorage);
  if(chat.messages.length===1){chat.title='…';renderSidebar();autoGenerateChatTitle(chat,text);}
  // END MODIFIED

  // Build display message: only text + images visible, files as chips
  // Show only non-file-content text parts and images; file-content blocks ("--- ...") appear as chips
  // BEGIN MODIFIED: also filter out pdf_text blocks (file content, shown as chips)
  const displayContent = Array.isArray(userContent)
    ? userContent.filter(p => (p.type==='text' && !p.text?.startsWith('---')) || p.type==='image_url')
    : userContent;
  // END MODIFIED
  // Use active-path index so data-idx matches getActivePath(chat) — needed for edit/delete/copy
  const idx=getActivePath(chat).length-1;
  const msgEl=buildMsgEl({role:'user',content:displayContent||text||null,_files:fileNames},idx);
  appendToMessages(msgEl);
  scrollToBottom();

  const typingId=showTyping();
  isStreaming=true; setSendMode('stop'); abortController=new AbortController();
  let assistantText='';
  let usageData=null;

  // BEGIN MODIFIED: build wire-format message list, then delegate to shared _streamAIResponse
  try {
    let messages;
    if(provider.type==='anthropic'){
      messages=[];
      chat.messages.slice(0,-1).forEach(m=>{if(m.role==='user'||m.role==='assistant')messages.push({role:m.role,content:_toAnthropicContent(m.content)});});
      messages.push({role:'user',content:_toAnthropicContent(userContent)});
      _applyPromptCache(messages);
    } else {
      // OpenAI-compat: system prompt injected by _streamAIResponse; pass only history + new user msg
      // BEGIN MODIFIED: expand pdf_text/pdf_base64 for OpenAI-compat too
      const hist=chat.messages.slice(0,-1).filter(m=>m.role==='user'||m.role==='assistant')
        .map(m=>({role:m.role,content:_toOpenAIContent(m.content)}));
      messages=[...hist,{role:'user',content:_toOpenAIContent(userContent)}];
      // END MODIFIED
    }
    const result=await _streamAIResponse(messages, provider, typingId, documentIds);
    assistantText=result.text; usageData=result.usage;
  } catch(e) {
    removeTyping(typingId);
    if(e.name==='AbortError'){if(!assistantText)assistantText=t('js.generationStopped');}
    else{assistantText=tf('js.errorPrefix',{e:escHtml(e.message)});const errEl=buildMsgEl({role:'assistant',content:assistantText},undefined);appendToMessages(errEl);scrollToBottom();setStatus('red');}
  }
  // END MODIFIED

  if(assistantText) _attachAIActions(chat, assistantText, usageData);
  isStreaming=false; abortController=null; setSendMode('send'); setStatus('green');
}

// ── Auto-Title Generation ─────────────────────────────────────────
// Called immediately when the first user message is sent (parallel to the main stream).
// Uses userText as a fast seed; once the AI response arrives it will have updated already.
async function autoGenerateChatTitle(chat, userText) {
  if(!chat) return;
  try {
    const provider = providerForModel(config.model) || providers[0];
    if(!provider || !provider.apiKey) return;

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
  const bubble=document.createElement('div');bubble.className='bubble';
  wrap.appendChild(bubble);div.appendChild(avatarCol);div.appendChild(wrap);
  appendToMessages(div);scrollToBottom();return div;
}
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
function removeTyping(id){document.getElementById(id)?.remove();}
function scrollToBottom(){const c=document.getElementById('messages');c.scrollTop=c.scrollHeight;}
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
function copyCode(btn, b64){btn.dataset.b64=b64;copyCodeFromBtn(btn);}

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
function copyFullChat() {
  const chat=currentChat(); if(!chat||!chat.messages.length){toast(t('js.noChatToCopy'));return;}
  const text=chat.messages.map(m=>{
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

function unescHtml(s){return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function inlineMarkdown(escapedText) {
  let s=escapedText;
  s=s.replace(/`([^`]+)`/g,(_,c)=>`<code>${escHtml(c)}</code>`);
  // Bold+italic: ***text*** — content must not start/end with space
  s=s.replace(/\*\*\*(\S(?:[^*\n]*\S)?)\*\*\*/g,'<strong><em>$1</em></strong>');
  s=s.replace(/___(\S(?:[^_\n]*\S)?)___/g,'<strong><em>$1</em></strong>');
  // Bold: **text** — content must not start/end with space
  s=s.replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g,'<strong>$1</strong>');
  // Bold: __text__ — only between non-word characters (not inside identifiers)
  s=s.replace(/(?<![a-zA-Z0-9])__(\S(?:[^_\n]*\S)?)__(?![a-zA-Z0-9])/g,'<strong>$1</strong>');
  // Italic: *text* — opening * must not be preceded or followed by another *
  s=s.replace(/(?<!\*)\*(?!\*)(\S[^*\n]*?\S|\S)\*(?!\*)/g,'<em>$1</em>');
  // Italic: _text_ — only between non-word characters (avoids matching snake_case)
  s=s.replace(/(?<![a-zA-Z0-9])_(\S[^_\n]*?\S|\S)_(?![a-zA-Z0-9])/g,'<em>$1</em>');
  // Strikethrough
  s=s.replace(/~~(.+?)~~/g,'<del>$1</del>');
  // Images: ![alt](url) — must come before link regex
  s=s.replace(/!\[([^\]]*)\]\(((?:https?:|\/)[^\)"\s]+)(?:\s+"[^"]*")?\)/g,
    (_,alt,url)=>`<img src="${url}" alt="${escHtml(alt)}" style="max-width:100%;max-height:320px;border-radius:6px;vertical-align:middle;" loading="lazy">`);
  // Links: [text](url) — url must start with http/https/mailto or be relative
  s=s.replace(/\[([^\]]+)\]\(((?:https?:|mailto:|\/)[^\)]*)\)/g,
    (_,text,url)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  return s;
}

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
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
    return PH(i);
  });

  // 3-Backtick-Fences
  s = s.replace(/^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm, (_, lang, code) => {
    const i = blocks.length;
    const b64 = btoa(unescape(encodeURIComponent(code)));
    const ll = escHtml(lang || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
    return PH(i);
  });

  // Nicht-geschlossene Fences (Fallback)
  s = s.replace(/^(`{4,})([^\n]*)\n([\s\S]*)$/gm, (_, fence, lang, code) => {
    const i = blocks.length;
    const b64 = btoa(unescape(encodeURIComponent(code.replace(/\n$/, ''))));
    const ll = escHtml((lang || '').trim() || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
    return PH(i);
  });
  s = s.replace(/^```([^\n`]*)\n([\s\S]*)$/gm, (_, lang, code) => {
    const i = blocks.length;
    const b64 = btoa(unescape(encodeURIComponent(code.replace(/\n$/, ''))));
    const ll = escHtml(lang || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
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
      blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><pre><code>${escHtml(text)}</code></pre></div>`);
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


function wireCodeCopyButtons(container) {
  container.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    if(!btn._wired){btn._wired=true;btn.addEventListener('click',()=>copyCodeFromBtn(btn));}
  });
}

// ── Math ──────────────────────────────────────────────────────────
function typesetMath() {
  if(window.MathJax&&MathJax.typesetPromise){MathJax.typesetPromise([document.getElementById('messages')]).catch(()=>{});}
}

// ── PDF Helpers ───────────────────────────────────────────────────
async function extractPdfText(arrayBuffer) {
  const lib=window._pdfjsLib||window.pdfjsLib; if(!lib) throw new Error('PDF.js nicht geladen');
  const pdf=await lib.getDocument({data:arrayBuffer}).promise;
  let out='';
  for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();out+=`${tf('js.pdfPage',{n:i})}\n${content.items.map(it=>it.str).join(' ')}\n`;}
  return out;
}
function arrayBufferToBase64(buf){const bytes=new Uint8Array(buf);let bin='';for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);return btoa(bin);}
function modelSupportsPdfBase64(mid){return /claude|gemini|gpt-4o/i.test(mid||'');}

// ════════════════════════════════════════════════════════════════
// FILE / IMAGE HANDLING — including Ctrl+V paste
// ════════════════════════════════════════════════════════════════

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

function handleFileAttach(e){const file=e.target.files[0];if(!file)return;e.target.value='';processFile(file);}
function handleImageAttach(e){const file=e.target.files[0];if(!file)return;e.target.value='';processFile(file);}

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
function removeAttachment(i){attachments.splice(i,1);renderAttachments();}
function clearAttachments(){attachments=[];renderAttachments();}

// ── UI Helpers ────────────────────────────────────────────────────
function closePanels(){
  ['settingsPanel','providerPanel','profilePanel','modelMaxPanel'].forEach(id=>document.getElementById(id).classList.remove('open'));
  document.getElementById('overlay').classList.remove('show');
}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
function openSettings(){syncSettingsPanel();applyTheme(localStorage.getItem('kic_theme')||'dark');document.getElementById('settingsPanel').classList.add('open');document.getElementById('overlay').classList.add('show');}
function openProfilePanel(){renderProfileList();document.getElementById('profilePanel').classList.add('open');document.getElementById('overlay').classList.add('show');}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px';}

let _dragCounter=0;
function handleDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='copy';}
function handleDragEnter(e){e.preventDefault();_dragCounter++;document.getElementById('dropOverlay').classList.add('active');}
function handleDragLeave(){_dragCounter--;if(_dragCounter<=0){_dragCounter=0;document.getElementById('dropOverlay').classList.remove('active');}}
async function handleDrop(e){
  e.preventDefault();_dragCounter=0;document.getElementById('dropOverlay').classList.remove('active');
  // Only handle external file drops (not internal chat/folder drags)
  if(draggedChatId||draggedFolderId) return;
  const files=Array.from(e.dataTransfer.files);if(!files.length)return;
  for(const file of files)await processFile(file);
}

// ── Modell-Limits Panel ───────────────────────────────────────────
function openModelMaxPanel(){renderModelMaxList();document.getElementById('modelMaxPanel').classList.add('open');document.getElementById('overlay').classList.add('show');}

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

function setModelMax(modelId,inputEl){
  const val=parseInt(inputEl.value);const defaultMax=getModelDefaultMax(modelId);
  if(!val||val<256){inputEl.value=defaultMax;return;}
  if(!config.userModelMaxOverrides)config.userModelMaxOverrides={};
  if(val===defaultMax){delete config.userModelMaxOverrides[modelId];}else{config.userModelMaxOverrides[modelId]=val;}
  const safeId=modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row=document.getElementById('mmrow_'+safeId);if(row)row.classList.toggle('model-max-modified',val!==defaultMax);
  save();updateModelMaxInfo();toast(tf('js.limitSet',{id:modelId.split('/').pop().slice(0,20),n:val.toLocaleString()}));
}
function resetModelMax(modelId){
  if(!config.userModelMaxOverrides)return;delete config.userModelMaxOverrides[modelId];
  const defaultMax=getModelDefaultMax(modelId);const safeId=modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row=document.getElementById('mmrow_'+safeId);if(row){const inp=row.querySelector('.model-max-input');if(inp)inp.value=defaultMax;row.classList.remove('model-max-modified');}
  save();updateModelMaxInfo();toast(tf('js.resetTo',{id:modelId.split('/').pop().slice(0,20),n:defaultMax.toLocaleString()}));
}
function resetAllModelMax(){config.userModelMaxOverrides={};save();renderModelMaxList();updateModelMaxInfo();toast(t('js.allLimitsReset'));}

// ═══════════════════════════════════════════════════════════════
// LOGIN / MULTI-ACCOUNT / SESSION
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_COLORS = ['#3d7eff','#7c5cfc','#2ecc71','#e74c3c','#f39c12','#1abc9c','#e91e63','#ff6b35','#00bcd4','#9c27b0'];
let _selectedLoginAccountId = null; // account selected on grid before pw entry

async function showLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) { ls.style.display = 'flex'; ls.classList.add('visible'); }
  await loadAccountRegistryAsync();
  if (_accounts.length === 0) {
    renderNewAccountColorRow();
    showView('newAccountView');
    setTimeout(() => document.getElementById('newAccountName')?.focus(), 80);
  } else {
    showView('accountSelectView');
    renderAccountGrid();
  }
  applyTranslations();
}
function hideLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) { ls.style.display = 'none'; ls.classList.remove('visible'); }
}
function showView(viewId) {
  ['accountSelectView','accountLoginView','newAccountView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === viewId ? '' : 'none';
  });
}

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
  // CryptoKey build und Session token write
  await getCryptoKey();
  await _writeSessionToken();
  localStorage.setItem('kic_active_account', _activeAccountId);
  const durMs = getSessionDurationMs();
  if (durMs > 0) localStorage.setItem('kic_' + _activeAccountId + '_session_expiry', String(Date.now() + durMs));
  if (pwdEl) pwdEl.value = '';
  if (confEl) confEl.value = '';
  if (nameEl) nameEl.value = '';
  if (errorEl) errorEl.textContent = '';
  hideLoginScreen();
  await bootApp();
  toast(t('js.pwdSetupDone') || '🔐 Account created — welcome!');
}

function forgotPassword() {
  if (!_selectedLoginAccountId) {
    // Kein Account ausgewaehlt — einfach zur Account-Auswahl zurueck
    showView('accountSelectView');
    renderAccountGrid();
    return;
  }
  const acc = getAccount(_selectedLoginAccountId);
  if (!confirm(tf('account.deleteConfirm', { name: acc?.name || '' }))) return;
  deleteAccount(_selectedLoginAccountId);
  _selectedLoginAccountId = null;
  _stopLockCountdown();
  if (_accounts.length === 0) {
    renderNewAccountColorRow();
    showView('newAccountView');
    setTimeout(() => document.getElementById('newAccountName')?.focus(), 80);
  } else {
    showView('accountSelectView');
    renderAccountGrid();
  }
}

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
  config = { model:'', temperature:0.7, maxTokens:null, systemPrompt:'', activeProfileId:null, userModelMaxOverrides:{}, chatMaxWidth:880 };
  // Hide main UI
  document.querySelector('.main')?.style.setProperty('display','none');
  document.querySelector('header')?.style.setProperty('display','none');
  showLoginScreen();
}

function getSessionDurationMs() {
  const h = parseInt(document.getElementById('sessionHoursInput')?.value || '12');
  const m = parseInt(document.getElementById('sessionMinutesInput')?.value || '0');
  return (h * 60 + m) * 60 * 1000;
}
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
function applySessionDuration() {
  const durMs = getSessionDurationMs();
  localStorage.setItem('kic_session_duration_ms', String(durMs));
  if (durMs > 0 && _activeAccountId) localStorage.setItem(`kic_${_activeAccountId}_session_expiry`, String(Date.now() + durMs));
  startSessionCountdown(); toast(t('settings.sessionApply') || '⏱ Applied');
}
function resetSessionNow() {
  if (!_activeAccountId) { toast(t('js.noActiveAccount')); return; }
  localStorage.removeItem(`kic_${_activeAccountId}_session_expiry`);
  toast(t('js.sessionReset'));
  setTimeout(() => logoutNow(), 1200);
}

let _countdownTimer = null;
function startSessionCountdown() {
  if (_countdownTimer) clearInterval(_countdownTimer);
  _countdownTimer = setInterval(updateSessionCountdown, 1000);
  updateSessionCountdown();
}
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

async function checkLogin() {
  await loadAccountRegistryAsync();
  // No accounts at all → create first account
  if (_accounts.length === 0) {
    showLoginScreen();
    return;
  }
  // F5/Reload: Session token check (kein password in sessionStorage)
  // Der Token wurde mit dem CryptoKey verschluesselt - ohne password kein Entschluesseln.
  // Vorgehen: Account-ID aus localStorage lesen, Salt laden, Passphrase aus RAM check.
  // Da nach F5 der RAM leer ist, muss der User sich kurz erneut authentifizieren -
  // AUSSER der Token ist noch gueltig UND der CryptoKey ist noch im RAM (selbe Tab-Session).
  const lastAccountId = localStorage.getItem('kic_active_account');
  if (lastAccountId && getAccount(lastAccountId)) {
    // Pruefen ob Session token im sessionStorage liegt (nur dann lohnt Versuch)
    if (restoreSessionPassphrase()) {
      // Token validieren erfordert CryptoKey -> bei F5 ist _cryptoKey = null.
      // Wir koennen keinen neuen Key ableiten ohne password.
      // Daher: nur weiter eingeloggt bleiben wenn _cryptoKey noch im RAM ist
      // (d.h. kein echter Reload, nur interne Navigation / Hot-Reload).
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

function clearAllData() {
  if (!confirm(t('js.clearConfirm'))) return;
  // Delete only this account's data
  if (_activeAccountId) {
    deleteAccount(_activeAccountId);
  }
  providers = []; profiles = []; folders = []; chats = [];
  config = { model:'', temperature:0.7, maxTokens:null, systemPrompt:'', activeProfileId:null, userModelMaxOverrides:{}, chatMaxWidth:880 };
  closePanels(); renderSidebar(); renderMessages([]); updateProfileBadge();
  toast(t('js.cleared'));
  setTimeout(() => logoutNow(), 1500);
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENER SETUP
// ═══════════════════════════════════════════════════════════════
function setupEventListeners(){
  document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
  document.getElementById('openProviderHeaderBtn').addEventListener('click', openProviderPanel);
  document.getElementById('openSettingsBtn').addEventListener('click', openSettings);
  document.getElementById('profileBadge').addEventListener('click', openProfilePanel);
  document.getElementById('langToggleBtn').addEventListener('click', toggleLangDropdown);
  document.getElementById('overlay').addEventListener('click', closePanels);

  // Settings Panel
  document.getElementById('settingsPanelClose').addEventListener('click', closePanels);
  document.getElementById('goProviderFromSettings').addEventListener('click',()=>{closePanels();openProviderPanel();});
  document.getElementById('goModelLimits').addEventListener('click',()=>{closePanels();openModelMaxPanel();});
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
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
  document.getElementById('logoutBtn').addEventListener('click', logoutNow);
  document.getElementById('clearAllBtn').addEventListener('click', clearAllData);
  document.getElementById('temperature').addEventListener('input', e=>{document.getElementById('tempVal').textContent=e.target.value;});
  document.getElementById('chatWidthSlider').addEventListener('input', e=>applyChatWidth(e.target.value));

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
  document.getElementById('peModelInput').addEventListener('change', updatePeMaxTokensUI);
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
  document.getElementById('messageInput').addEventListener('input', e=>autoResize(e.target));
  document.getElementById('messageInput').addEventListener('paste', handlePaste);
  document.getElementById('attachFileBtn').addEventListener('click',()=>document.getElementById('fileInput').click());
  document.getElementById('attachImageBtn').addEventListener('click',()=>document.getElementById('imageInput').click());
  document.getElementById('clearAttachBtn').addEventListener('click', clearAttachments);
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

// _printSingleIdx: Index der Bubble die gerade gedruckt werden soll
let _printSingleIdx = null;

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

function closePrintSingleOverlay() {
  _printSingleIdx = null;
  document.getElementById('printSingleOverlay')?.classList.remove('show');
}

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
        startup: { typeset: true },
      };
    <\/script>
    <script src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js" crossorigin="anonymous"><\/script>
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
      @media print {
        body { margin: 20px; }
        .code-block-header { display: none !important; }
      }
    </style>
  </head><body>
    <div class="meta"><strong>${escHtml(role)}</strong> · ${escHtml(date)}</div>
    <div class="content">${formattedHtml}</div>
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
      // Hard fallback: falls MathJax nach 4s noch nicht fertig
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
  renderSidebar();
  if (!chats.length) { newChat(); }
  else {
    // Falls der gespeicherte currentChatId nicht existiert, nutze den ersten Chat
    if (!currentChatId || !chats.find(c => c.id === currentChatId)) {
      currentChatId = chats[0].id;
    }
    renderMessages(currentChat()?.messages || []);
  }
  if (providers.length && providers.some(p => p.apiKey)) fetchModels();
  else openProviderPanel();
  startSessionCountdown();
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
