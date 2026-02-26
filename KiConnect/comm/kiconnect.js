// ================================================================
// kiconnect.js  –  KI Connect application logic
// Requires: kiconnect-languages-i18n.js (loaded before this file)
// ================================================================

// ═══════════════════════════════════════════════════════════════
// SECURITY FIXES v4.2
// ═══════════════════════════════════════════════════════════════
// FIX #1/#2: PBKDF2 mit zufälligem Salt ersetzt schwaches HKDF/SHA-256
// FIX #3:    addEventListener + data-* statt onclick-String-Interpolation
// FIX #4:    DOMPurify: 'onclick' aus ALLOWED_ATTR entfernt
// FIX #5:    unescapePassthroughTags() entfernt → DOMPurify übernimmt
// FIX #7:    Bilder in localStorage: Größenlimit + Fehlerbehandlung
// ═══════════════════════════════════════════════════════════════

// ── i18n ─────────────────────────────────────────────────────────
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
    if (el.getAttribute('data-i18n-attr') === 'placeholder') {
      el.placeholder = val;
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

// Retranslate all existing bubble action buttons when language changes
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
// Retranslate suggestion chips when language changes
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
  'openai-compat': { label:'OpenAI-kompatibel', needsUrl:true  },
  'anthropic':     { label:'Anthropic (Claude)', needsUrl:false },
  'openai-direct': { label:'OpenAI direkt',      needsUrl:false },
  'openrouter':    { label:'OpenRouter',          needsUrl:false },
  'mistral':       { label:'Mistral AI',          needsUrl:false },
  'gemini':        { label:'Google Gemini',       needsUrl:false },
  'xai':           { label:'xAI Grok',            needsUrl:false },
  'groq':          { label:'Groq',                needsUrl:false },
};
const PROVIDER_HINTS = {
  'openai-compat': '💡 Server-URL + opt. API Key · für KI Connect NRW, LM Studio, Ollama, …',
  'anthropic':     '💡 API Key von console.anthropic.com · 🧠 Extended Thinking für Claude 3.7+/4',
  'openai-direct': '💡 API Key von platform.openai.com · 🧠 Reasoning für o1/o3/o4',
  'openrouter':    '💡 API Key von openrouter.ai · 200+ Modelle live geladen · 🧠 Thinking für Reasoning-Modelle',
  'mistral':       '💡 API Key von console.mistral.ai · Modelle werden live geladen',
  'gemini':        '💡 API Key von aistudio.google.com (AI Studio) · Modelle werden live geladen',
  'xai':           '💡 API Key von console.x.ai · Grok 3 mit optionalem 🧠 Thinking',
  'groq':          '💡 API Key von console.groq.com · Ultra-schnelle Inferenz · Modelle live',
};
// thinking-capable models: claude (extended thinking), openai reasoning models (o-series + gpt-4.5/4.1)
const THINKING_MODELS = new Set([
  // Anthropic — Extended Thinking
  'claude-opus-4-6','claude-sonnet-4-6','claude-3-7-sonnet-20250219',
  // OpenAI — Reasoning / thinking effort
  'o1','o1-mini','o1-pro','o3','o3-mini','o4-mini','o4-mini-high',
  // gpt-4.5/4.1 preview with thinking support
  'gpt-4.5-preview','gpt-4.1','gpt-4.1-mini',
  // grok / qwen / deepseek on openrouter also support reasoning
]);

const KNOWN_MODELS = {
  // ── Anthropic ──────────────────────────────────────────────────
  'claude-opus-4-6':            { label:'Claude Opus 4.6',           maxOutput:32000,  vision:true  },
  'claude-sonnet-4-6':          { label:'Claude Sonnet 4.6',         maxOutput:16000,  vision:true  },
  'claude-haiku-4-5-20251001':  { label:'Claude Haiku 4.5',          maxOutput:8096,   vision:true  },
  'claude-3-7-sonnet-20250219': { label:'Claude 3.7 Sonnet',         maxOutput:16000,  vision:true  },
  'claude-3-5-sonnet-20241022': { label:'Claude 3.5 Sonnet',         maxOutput:8096,   vision:true  },
  'claude-3-5-haiku-20241022':  { label:'Claude 3.5 Haiku',          maxOutput:8096,   vision:true  },
  'claude-3-opus-20240229':     { label:'Claude 3 Opus',             maxOutput:4096,   vision:true  },
  // ── OpenAI — GPT series ────────────────────────────────────────
  'gpt-4.1':                    { label:'GPT-4.1',                   maxOutput:32768,  vision:true  },
  'gpt-4.1-mini':               { label:'GPT-4.1 mini',              maxOutput:32768,  vision:true  },
  'gpt-4.1-nano':               { label:'GPT-4.1 nano',              maxOutput:32768,  vision:true  },
  'gpt-4o':                     { label:'GPT-4o',                    maxOutput:16384,  vision:true  },
  'gpt-4o-mini':                { label:'GPT-4o mini',               maxOutput:16384,  vision:true  },
  'gpt-4o-search-preview':      { label:'GPT-4o Search Preview',     maxOutput:16384,  vision:true  },
  'gpt-4.5-preview':            { label:'GPT-4.5 Preview',           maxOutput:16384,  vision:true  },
  'gpt-4-turbo':                { label:'GPT-4 Turbo',               maxOutput:4096,   vision:true  },
  // ── OpenAI — o-series (Reasoning/Thinking) ────────────────────
  'o4-mini':                    { label:'o4-mini (Thinking)',         maxOutput:100000, vision:true  },
  'o4-mini-high':               { label:'o4-mini high (Thinking)',    maxOutput:100000, vision:true  },
  'o3':                         { label:'o3 (Thinking)',              maxOutput:100000, vision:true  },
  'o3-mini':                    { label:'o3-mini (Thinking)',         maxOutput:100000, vision:false },
  'o1':                         { label:'o1 (Thinking)',              maxOutput:32768,  vision:false },
  'o1-mini':                    { label:'o1-mini (Thinking)',         maxOutput:65536,  vision:false },
  'o1-pro':                     { label:'o1-pro (Thinking)',          maxOutput:32768,  vision:false },
};
const CLAUDE_MODELS  = Object.entries(KNOWN_MODELS).filter(([id])=>id.startsWith('claude')).map(([id,m])=>({id,...m}));
const OPENAI_MODELS  = Object.entries(KNOWN_MODELS).filter(([id])=>id.startsWith('gpt')||id.startsWith('o')).map(([id,m])=>({id,...m}));

// FIX #7: Maximale Bildgröße für localStorage (500 KB als data-URI ≈ ~375 KB Bild)
const MAX_IMAGE_STORAGE_BYTES = 500 * 1024;

function getModelDefaultMax(modelId) {
  if (!modelId) return 8096;
  const known = KNOWN_MODELS[modelId];
  if (known) return known.maxOutput;
  if (/70b|llama-3/i.test(modelId)) return 8192;
  if (/mixtral|mistral/i.test(modelId)) return 4096;
  if (/gpt-4/i.test(modelId)) return 8192;
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
let sidebarCollapsed = false;

// ═══════════════════════════════════════════════════════════════
// FIX #1 + #2: PBKDF2-basierte Kryptographie
// Ersetzt: schwaches HKDF mit Null-Salt + unsicheres SHA-256 Login-Hash
// ═══════════════════════════════════════════════════════════════

let _cryptoKey = null;
let _sessionPassphrase = null;

/**
 * Leitet AES-GCM-256 Key ab via PBKDF2 (600.000 Iterationen, zufälliger Salt).
 * Salt wird zusammen mit dem verschlüsselten Blob gespeichert.
 */
async function deriveKeyPBKDF2(passphrase, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase || 'kic-default-v2'),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes,
      iterations: 600000,   // OWASP-Empfehlung 2024
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function getCryptoKey() {
  if (_cryptoKey) return _cryptoKey;
  // Seed aus localStorage (für symmetrische Datenverschlüsselung)
  let seed = localStorage.getItem('kic_seed');
  if (!seed) {
    const buf = crypto.getRandomValues(new Uint8Array(32));
    seed = btoa(String.fromCharCode(...buf));
    localStorage.setItem('kic_seed', seed);
  }
  // Seed-Salt: zufällig, persistent (für denselben Seed immer derselbe Key)
  let seedSalt = localStorage.getItem('kic_seed_salt');
  if (!seedSalt) {
    const saltBuf = crypto.getRandomValues(new Uint8Array(16));
    seedSalt = btoa(String.fromCharCode(...saltBuf));
    localStorage.setItem('kic_seed_salt', seedSalt);
  }
  const saltBytes = Uint8Array.from(atob(seedSalt), c => c.charCodeAt(0));
  const passphrase = seed + '|' + (_sessionPassphrase || '');
  _cryptoKey = await deriveKeyPBKDF2(passphrase, saltBytes);
  return _cryptoKey;
}

function setSessionPassphrase(pw) {
  _sessionPassphrase = pw || null;
  _cryptoKey = null;
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

// ── FIX #2: Login-Passwort-Hash via PBKDF2 mit zufälligem Salt ──────
// Format gespeichert in kic_login_hash: JSON { salt: base64, hash: base64 }

async function hashPasswordPBKDF2(pw, saltBytes) {
  const key = await deriveKeyPBKDF2(pw + '|kic-login-v2', saltBytes);
  // Exportieren ist nicht erlaubt (extractable=false), daher verschlüsseln wir
  // einen bekannten Plaintext – das Ergebnis ist der "Hash"
  const iv = new Uint8Array(12); // für Login-Verifikation: fester IV ok (salt schützt)
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode('kic-login-verify-v2')
  );
  return btoa(String.fromCharCode(...new Uint8Array(enc)));
}

async function storePasswordHash(pw) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltB64   = btoa(String.fromCharCode(...saltBytes));
  const hashB64   = await hashPasswordPBKDF2(pw, saltBytes);
  localStorage.setItem('kic_login_hash', JSON.stringify({ salt: saltB64, hash: hashB64, v: 2 }));
}

async function verifyPassword(pw) {
  const stored = localStorage.getItem('kic_login_hash');
  if (!stored) return false;
  try {
    const obj = JSON.parse(stored);
    if (obj.v !== 2) {
      // Legacy v1 (SHA-256 ohne Salt) — Migration: alten Hash löschen
      // Wir können das alte Passwort nicht mehr verifizieren; Nutzer muss neu setzen
      return false;
    }
    const saltBytes = Uint8Array.from(atob(obj.salt), c => c.charCodeAt(0));
    const candidate = await hashPasswordPBKDF2(pw, saltBytes);
    return candidate === obj.hash;
  } catch { return false; }
}

function getStoredPwdHash() { return localStorage.getItem('kic_login_hash') || null; }

// ═══════════════════════════════════════════════════════════════
// PERSIST
// ═══════════════════════════════════════════════════════════════
// FIX #7: Begrenze Bildgröße in gespeicherten Nachrichten
function sanitizeMsgForStorage(msg) {
  if (!Array.isArray(msg.content)) return msg;
  const safeContent = msg.content.map(p => {
    if (p.type === 'image_url') {
      const url = p.image_url?.url || '';
      // Bild zu groß für localStorage → durch Platzhalter ersetzen
      if (url.startsWith('data:') && url.length > MAX_IMAGE_STORAGE_BYTES) {
        return { type: 'text', text: '[' + t('js.imageNotSaved') + ']' };
      }
    }
    return p;
  });
  return { ...msg, content: safeContent };
}

async function save() {
  try {
    const encProviders = await Promise.all(providers.map(encryptProvider));
    const chatsToStore = chats.slice(0, 200).map(c => ({
      ...c,
      messages: c.messages.map(sanitizeMsgForStorage),
    }));
    localStorage.setItem('kic_config',    JSON.stringify(config));
    localStorage.setItem('kic_providers', JSON.stringify(encProviders));
    localStorage.setItem('kic_profiles',  JSON.stringify(profiles));
    localStorage.setItem('kic_folders',   JSON.stringify(folders));
    localStorage.setItem('kic_chats',     JSON.stringify(chatsToStore));
    if (currentChatId) localStorage.setItem('kic_current_chat', currentChatId);
    localStorage.setItem('kic_sidebar_w', document.getElementById('sidebar').style.width || '');
    localStorage.setItem('kic_sidebar_collapsed', sidebarCollapsed ? '1' : '');
  } catch (e) {
    // localStorage voll (QuotaExceededError) — älteste Chats kürzen
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      toast(t('js.storageFull'));
      chats = chats.slice(0, Math.max(1, Math.floor(chats.length / 2)));
      try { localStorage.setItem('kic_chats', JSON.stringify(chats.slice(0,100).map(c=>({...c,messages:c.messages.map(sanitizeMsgForStorage)})))); } catch {}
    }
  }
}

async function load() {
  try { config = {...config, ...JSON.parse(localStorage.getItem('kic_config') || '{}')}; } catch{}
  try {
    const raw = JSON.parse(localStorage.getItem('kic_providers') || '[]');
    providers = await Promise.all(raw.map(decryptProvider));
  } catch{}
  try { profiles = JSON.parse(localStorage.getItem('kic_profiles') || '[]'); } catch{}
  try { folders  = JSON.parse(localStorage.getItem('kic_folders')  || '[]'); } catch{}
  try { chats    = JSON.parse(localStorage.getItem('kic_chats')    || '[]'); } catch{}
  const savedCurrentChat = localStorage.getItem('kic_current_chat');
  if (savedCurrentChat) currentChatId = savedCurrentChat;
  const savedW = localStorage.getItem('kic_sidebar_w');
  if (savedW) document.getElementById('sidebar').style.width = savedW;
  if (localStorage.getItem('kic_sidebar_collapsed') === '1') {
    sidebarCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
  }
}

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
  if (provider.type === 'anthropic')     return 'https://api.anthropic.com';
  if (provider.type === 'openai-direct') return 'https://api.openai.com/v1';
  if (provider.type === 'openrouter')    return 'https://openrouter.ai/api/v1';
  if (provider.type === 'mistral')       return 'https://api.mistral.ai/v1';
  if (provider.type === 'gemini')        return 'https://generativelanguage.googleapis.com/v1beta/openai';
  if (provider.type === 'xai')           return 'https://api.x.ai/v1';
  if (provider.type === 'groq')          return 'https://api.groq.com/openai/v1';
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
  'api.mistral.ai','generativelanguage.googleapis.com','api.x.ai','api.groq.com',
];
function isSafeApiUrl(url) {
  try {
    const h = new URL(url).hostname;
    return ALLOWED_API_DOMAINS.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
}
function proxyUrl(url) {
  if (!isSafeApiUrl(url)) { console.error('[Security] Blocked:', url); throw new Error('API-Domain nicht erlaubt.'); }
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

// ══════════════════════════════════════════════════════════════════
// FIX #3: PROVIDER PANEL — addEventListener statt onclick-Interpolation
// ══════════════════════════════════════════════════════════════════
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
    info.appendChild(nameEl);
    info.appendChild(descEl);

    const badge = document.createElement('span');
    badge.className = 'provider-badge ' + badgeCls;
    badge.textContent = badgeTxt;

    const actions = document.createElement('div');
    actions.className = 'provider-item-actions';

    // FIX #3: data-id statt onclick-String
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.textContent = '✏️';
    editBtn.title = t('js.edit');
    editBtn.dataset.id = p.id;
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); editProvider(editBtn.dataset.id); });

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.textContent = '🗑';
    delBtn.title = t('js.delete');
    delBtn.dataset.id = p.id;
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteProvider(delBtn.dataset.id); });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    item.appendChild(info);
    item.appendChild(badge);
    item.appendChild(actions);
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

// FIX #3: Profile-Liste ohne onclick-Interpolation
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
    dot.className = 'profile-item-dot';
    dot.style.background = p.color;

    const info = document.createElement('div');
    info.className = 'profile-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'profile-item-name';
    nameEl.textContent = p.name;
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
  updateActiveProviderInfo(); updateModelMaxInfo();
}
function saveSettings() {
  config.temperature  = parseFloat(document.getElementById('temperature').value);
  config.systemPrompt = document.getElementById('systemPrompt').value;
  const sel = document.getElementById('modelInput').value;
  if (sel) config.model = sel;
  const p = activeProfile();
  if (p) { p.systemPrompt = config.systemPrompt; p.temperature = config.temperature; if(sel) p.model=sel; }
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
      // ── Anthropic: live model list ──────────────────────────────
      try {
        const res = await fetch(proxyUrl('https://api.anthropic.com/v1/models'), {
          headers: { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01',
                     'anthropic-dangerous-direct-browser-access': 'true' }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        const liveIds = new Set((data.data || []).map(m => m.id));
        // Prefer live models; fall back to CLAUDE_MODELS list if API returns nothing
        const modelsToShow = liveIds.size > 0
          ? [...liveIds].sort().reverse().map(id => ({
              id, label: KNOWN_MODELS[id]?.label || id
            }))
          : CLAUDE_MODELS;
        modelsToShow.forEach(m => groupModels.push({
          fullId: makeModelId(provider.id, m.id || m),
          label: m.label || m.id || m,
          modelId: m.id || m
        }));
        provOk = true;
      } catch(e) {
        providerStatus[provider.id] = 'error'; anyError = true;
        renderProviderList(); updateActiveProviderInfo(); continue;
      }

    } else if (provider.type === 'openai-direct') {
      // ── OpenAI: live model list ─────────────────────────────────
      try {
        const res = await fetch(proxyUrl('https://api.openai.com/v1/models'), {
          headers: { 'Authorization': `Bearer ${provider.apiKey}` }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        // Filter: only chat-capable models (exclude embedding, tts, whisper, dall-e, etc.)
        const CHAT_PATTERN = /^(gpt-|o\d|chatgpt-)/;
        const EXCLUDE_PATTERN = /embed|whisper|tts|dall-e|realtime|audio|preview-\d{4}|transcribe|search$/;
        const PRIORITY_ORDER = ['gpt-4.1','gpt-4o','o4','o3','o1','gpt-4.5','gpt-4-turbo','gpt-3'];
        const liveModels = (data.data || [])
          .filter(m => CHAT_PATTERN.test(m.id) && !EXCLUDE_PATTERN.test(m.id))
          .sort((a, b) => {
            const pa = PRIORITY_ORDER.findIndex(p => a.id.startsWith(p));
            const pb = PRIORITY_ORDER.findIndex(p => b.id.startsWith(p));
            const ra = pa === -1 ? 999 : pa;
            const rb = pb === -1 ? 999 : pb;
            return ra !== rb ? ra - rb : b.id.localeCompare(a.id);
          });
        if (liveModels.length > 0) {
          liveModels.forEach(m => groupModels.push({
            fullId: makeModelId(provider.id, m.id),
            label: KNOWN_MODELS[m.id]?.label || m.id,
            modelId: m.id
          }));
        } else {
          // Fallback to static list
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
      // ── OpenAI-compat + OpenRouter + Mistral + Gemini + xAI + Groq ──
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
          // OpenRouter: use display name from API, mark thinking-capable models
          rawModels
            .filter(m => m.id && !m.id.includes(':free') === false || true) // show all including free
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
            .forEach(m => {
              const isThinking = THINKING_MODELS.has(m.id) || /thinking|reason|qwq|r1/i.test(m.id);
              const lbl = (m.name || m.id) + (isThinking ? ' 🧠' : '');
              groupModels.push({ fullId: makeModelId(provider.id, m.id), label: lbl, modelId: m.id });
            });
        } else {
          // Generic: use known labels where available
          rawModels.forEach(m => {
            const id = m.id || m.name || '';
            if (!id) return;
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
      const isThinking = THINKING_MODELS.has(m.modelId);
      const badge = isThinking ? ' 🧠' : '';
      optsHtml += `<option value="${escHtml(m.fullId)}">${escHtml(m.label)}${badge}</option>`;
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
// Intensity labels are now sourced from i18n via t()
// Keys: thinking.low / thinking.medium / thinking.high
// OpenAI reasoning_effort values
const OAI_EFFORT = { 1: 'low', 2: 'medium', 3: 'high' };
// Anthropic budget_tokens: stored directly in config.thinkingBudget (continuous)
const CLAUDE_BUDGET = { 1: 2000, 2: 8000, 3: 20000 };  // fallback for intensity→budget

function isThinkingCapable(modelId) {
  if (!modelId) return false;
  const bare = modelId.split('/').pop().toLowerCase();
  return THINKING_MODELS.has(modelId) || THINKING_MODELS.has(bare) ||
    /^o\d/.test(bare) || /claude-(opus|sonnet)-4/.test(bare) || /claude-3-7/.test(bare) ||
    /thinking|reason/i.test(bare) || /deepseek-r|qwen.*think|qwq|llama.*reason/i.test(bare);
}

function isAnthropicThinkingModel(modelId) {
  return /^claude-(opus-4|sonnet-4|3-7-sonnet)/i.test(modelId);
}

// Returns true if the model uses continuous token budget (Anthropic), false for discrete effort (OpenAI)
function usesTokenBudget(modelId) {
  return isAnthropicThinkingModel(modelId || '');
}

function getThinkingBudget() {
  // For Anthropic: return continuous token value
  return config.thinkingBudget || 8000;
}

function getThinkingEffortStr() {
  // For OpenAI: return low/medium/high
  return OAI_EFFORT[config.thinkingIntensity || 2];
}

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
  // Reconfigure slider mode based on model type
  configureThinkingSlider(modelId);
  updateThinkingIntensityUI();
}

function configureThinkingSlider(modelId) {
  const slider = document.getElementById('thinkingIntensitySlider');
  const label  = document.getElementById('thinkingIntensityLabel');
  if (!slider) return;
  if (usesTokenBudget(modelId)) {
    // Continuous: 1024 to 32000 tokens
    slider.min   = '1024';
    slider.max   = '32000';
    slider.step  = '256';
    slider.value = String(config.thinkingBudget || 8000);
    if (label) label.textContent = typeof t === 'function' ? t('thinking.budget') : 'Budget';
  } else {
    // Discrete: 1=low, 2=medium, 3=high
    slider.min   = '1';
    slider.max   = '3';
    slider.step  = '1';
    slider.value = String(config.thinkingIntensity || 2);
    if (label) label.textContent = t('thinking.intensity');
  }
}

function updateThinkingIntensityUI() {
  const slider = document.getElementById('thinkingIntensitySlider');
  const label  = document.getElementById('thinkingIntensityVal');
  if (!slider || !label) return;
  const { modelId } = splitModelId(config.model);
  if (usesTokenBudget(modelId)) {
    const budget = config.thinkingBudget || 8000;
    label.textContent = budget >= 1000 ? (budget / 1000).toFixed(1).replace('.0','') + 'k tok' : budget + ' tok';
  } else {
    const val = config.thinkingIntensity || 2;
    const ikeys = { 1: 'thinking.low', 2: 'thinking.medium', 3: 'thinking.high' };
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

// ── Folders ───────────────────────────────────────────────────────
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
  input.className = 'folder-name-input';
  input.value = f.name;
  input.addEventListener('blur', () => commitRenameFolder(id, input.value));
  input.addEventListener('keydown', e => { if(e.key==='Enter') input.blur(); });
  el.replaceWith(input);
  input.focus();
}
function commitRenameFolder(id, newName) {
  const f = folders.find(x=>x.id===id);
  if (f) f.name = newName.trim() || f.name;
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
  localStorage.setItem('kic_current_chat', id);
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
  input.className = 'chat-item-title-input';
  input.value = chat.title;
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('blur', () => { chat.title = input.value.trim()||chat.title; save(); renderSidebar(); });
  input.addEventListener('keydown', e => { if(e.key==='Enter') input.blur(); });
  titleEl.replaceWith(input);
  input.focus(); input.select();
}
function moveChat(chatId, folderId) {
  const c = chats.find(x=>x.id===chatId);
  if (c) { c.folderId = folderId; save(); renderSidebar(); }
}

// FIX #3: Context-Menu ohne onclick-Interpolation
function showChatCtxMenu(e, chatId) {
  e.preventDefault(); e.stopPropagation();
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';
  const renameItem = document.createElement('div');
  renameItem.className = 'ctx-item';
  renameItem.textContent = t('js.rename');
  renameItem.dataset.id = chatId;
  renameItem.addEventListener('click', () => { startRenamingChat(renameItem.dataset.id); hideCtx(); });
  const delItem = document.createElement('div');
  delItem.className = 'ctx-item danger';
  delItem.textContent = t('js.delete');
  delItem.dataset.id = chatId;
  delItem.addEventListener('click', () => { deleteChat(delItem.dataset.id); hideCtx(); });
  menu.appendChild(renameItem); menu.appendChild(delItem);
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth-170)+'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight-80)+'px';
}
function hideCtx() { document.getElementById('ctxMenu').style.display='none'; }
document.addEventListener('click', hideCtx);
function onDragStart(e, id) { draggedChatId=id; e.dataTransfer.effectAllowed='move'; }
function onDropFolder(e, folderId) {
  e.preventDefault();
  document.querySelectorAll('.drag-target').forEach(el=>el.classList.remove('drag-target'));
  if (draggedChatId) { moveChat(draggedChatId, folderId); draggedChatId=null; }
}

// ── Sidebar Render ────────────────────────────────────────────────
// FIX #3: Sidebar-Items via DOM-API statt innerHTML-Interpolation
function renderSidebar() {
  const container = document.getElementById('folderContainer');
  container.innerHTML = '';
  const unfiled = chats.filter(c=>!c.folderId||!folders.find(f=>f.id===c.folderId));

  folders.forEach(f => {
    const fc = chats.filter(c=>c.folderId===f.id);
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder';

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
    countSpan.className = 'folder-count';
    countSpan.textContent = fc.length;

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

    // Drag-Drop auf Folder-Header
    header.addEventListener('dragover',  e => { e.preventDefault(); header.classList.add('drag-target'); });
    header.addEventListener('dragleave', () => header.classList.remove('drag-target'));
    header.addEventListener('drop',      e => onDropFolder(e, f.id));
    header.addEventListener('click', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      toggleFolder(f.id);
    });

    const chatsDiv = document.createElement('div');
    chatsDiv.className = 'folder-chats' + (f.collapsed ? ' collapsed' : '');
    chatsDiv.id = `fc_${f.id}`;
    chatsDiv.addEventListener('dragover', e => e.preventDefault());
    chatsDiv.addEventListener('drop', e => onDropFolder(e, f.id));
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
    header.addEventListener('dragover', e=>{e.preventDefault();header.classList.add('drag-target');});
    header.addEventListener('dragleave',()=>header.classList.remove('drag-target'));
    header.addEventListener('drop', e=>onDropFolder(e,null));
    const chatsDiv = document.createElement('div');
    chatsDiv.className = 'folder-chats';
    chatsDiv.addEventListener('dragover', e=>e.preventDefault());
    chatsDiv.addEventListener('drop', e=>onDropFolder(e,null));
    unfiled.forEach(c=>chatsDiv.appendChild(buildChatItem(c)));
    folderDiv.appendChild(header); folderDiv.appendChild(chatsDiv);
    container.appendChild(folderDiv);
  }
}

function buildChatItem(c) {
  const div = document.createElement('div');
  div.className = 'chat-item' + (c.id === currentChatId ? ' active' : '');
  div.draggable = true;
  div.dataset.id = c.id;

  div.addEventListener('dragstart', e => onDragStart(e, div.dataset.id));
  div.addEventListener('click',     () => switchChat(div.dataset.id));
  div.addEventListener('contextmenu', e => showChatCtxMenu(e, div.dataset.id));

  const titleSpan = document.createElement('span');
  titleSpan.className = 'chat-item-title';
  titleSpan.id = `ctitle_${c.id}`;
  titleSpan.textContent = c.title;

  const menuBtn = document.createElement('button');
  menuBtn.className = 'chat-item-menu'; menuBtn.textContent = '⋯'; menuBtn.title = t('js.options');
  menuBtn.dataset.id = c.id;
  menuBtn.addEventListener('click', e => showChatCtxMenu(e, menuBtn.dataset.id));

  div.appendChild(titleSpan);
  if (c.branchOf) { const bb=document.createElement('span'); bb.className='branch-badge'; bb.textContent='↩'; div.appendChild(bb); }
  div.appendChild(menuBtn);
  return div;
}

// ── Message Rendering ─────────────────────────────────────────────
function renderMessages(messages) {
  const container = document.getElementById('messages');
  const empty     = document.getElementById('emptyState');
  if (!messages.length) {
    Array.from(container.children).forEach(el => { if(el!==empty) el.remove(); });
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  Array.from(container.children).forEach(el => { if(el!==empty) el.remove(); });
  messages.forEach((msg,idx) => container.appendChild(buildMsgEl(msg,idx)));
  container.scrollTop = container.scrollHeight;
  typesetMath();
  updateChatTokenTotal();
}

function buildMsgEl(msg, idx) {
  const isUser = msg.role === 'user';
  const cls = isUser ? 'user' : 'ai';

  const row = document.createElement('div');
  row.className = 'message-row ' + cls;
  if (idx !== undefined) row.dataset.idx = idx;

  // Avatar col
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
      ml.className = 'model-label';
      ml.title = mid;
      ml.textContent = mid.split('/').pop();
      avatarCol.appendChild(ml);
    }
  }

  // Bubble wrap
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // Content
  let contentHtml = '';
  if (typeof msg.content === 'string') contentHtml = formatText(msg.content);
  else if (Array.isArray(msg.content)) {
    msg.content.forEach(part => {
      if (part.type === 'text') {
        const isPdfContent = part.text && part.text.startsWith('--- ');
        if (!isPdfContent) contentHtml += formatText(part.text);
      } else if (part.type === 'image_url') {
        const url = part.image_url?.url || '';
        if (url.startsWith('data:image/') || url.startsWith('http')) {
          const img = document.createElement('img');
          img.src = url; img.alt = t('js.imageAlt');
          // Bild separat anhängen (nach DOMPurify-Verarbeitung)
          bubble.innerHTML = contentHtml || '';
          bubble.appendChild(img);
          contentHtml = '';
          return;
        }
      }
    });
  }
  if (!contentHtml && bubble.children.length === 0 && !msg._files) contentHtml = `<em style="color:var(--muted)">${escHtml(t('js.empty'))}</em>`;
  if (contentHtml) bubble.innerHTML = (bubble.innerHTML || '') + contentHtml;
  if (msg._files) msg._files.forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'file-chip'; chip.textContent = '📄 ' + f;
    bubble.appendChild(chip);
  });

  // Bubble actions (FIX #3: addEventListener)
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

  actDiv.appendChild(makeActBtn(t('js.copy'),       '',       (i) => copyBubble(actDiv.querySelector('.bubble-act-btn'), i), 'copy'));
  actDiv.appendChild(makeActBtn(t('js.edit'),       '',       startEditBubble, 'edit'));
  actDiv.appendChild(makeActBtn(t('js.branch'),     '',       branchFromHere, 'branch'));
  if (!isUser) actDiv.appendChild(makeActBtn(t('js.regenerate'), '', regenerate, 'regenerate'));
  actDiv.appendChild(makeActBtn(t('js.delete'),     'danger', deleteBubble, 'delete'));

  // Token badge for AI messages
  if (!isUser && msg._usage) {
    const badge = buildTokenBadge(msg._usage);
    wrap.appendChild(bubble); wrap.appendChild(actDiv); wrap.appendChild(badge);
  } else {
    wrap.appendChild(bubble); wrap.appendChild(actDiv);
  }
  row.appendChild(avatarCol); row.appendChild(wrap);

  // Code-Copy-Buttons per addEventListener verdrahten (NACH DOMPurify in formatText)
  row.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    btn.addEventListener('click', () => copyCodeFromBtn(btn));
  });

  return row;
}

// ── Bubble Edit / Delete / Branch ─────────────────────────────────
function getBubbleRow(idx) { return document.querySelector(`.message-row[data-idx="${parseInt(idx,10)}"]`); }

// ── Token Usage ────────────────────────────────────────────────────
function buildTokenBadge(usage) {
  const badge = document.createElement('div');
  badge.className = 'token-badge';
  if (usage.input_tokens != null) {
    const s = document.createElement('span');
    s.title = 'Input tokens';
    s.textContent = tf('js.tokensIn', {n: usage.input_tokens.toLocaleString()});
    badge.appendChild(s);
  }
  if (usage.output_tokens != null) {
    const s = document.createElement('span');
    s.title = 'Output tokens';
    s.textContent = tf('js.tokensOut', {n: usage.output_tokens.toLocaleString()});
    badge.appendChild(s);
  }
  if (usage.cache_read_input_tokens) {
    const s = document.createElement('span');
    s.className = 'cache';
    s.title = 'Cache read tokens';
    s.textContent = tf('js.tokensCacheRead', {n: usage.cache_read_input_tokens.toLocaleString()});
    badge.appendChild(s);
  }
  const total = (usage.input_tokens||0) + (usage.output_tokens||0);
  if (total > 0) {
    const s = document.createElement('span');
    s.title = 'Total tokens this message';
    s.style.color = 'var(--accent)';
    s.style.borderColor = 'rgba(61,126,255,0.3)';
    s.textContent = tf('js.tokensTotal', {n: total.toLocaleString()});
    badge.appendChild(s);
  }
  return badge;
}

function updateChatTokenTotal() {
  const chat = currentChat();
  let total = document.getElementById('chatTokenTotal');
  if (!chat) { if (total) total.remove(); return; }
  const sum = chat.messages.reduce((acc, m) => {
    if (!m._usage) return acc;
    return acc + (m._usage.input_tokens||0) + (m._usage.output_tokens||0);
  }, 0);
  if (sum === 0) { if (total) total.remove(); return; }
  if (!total) {
    total = document.createElement('div');
    total.id = 'chatTokenTotal';
    total.className = 'chat-token-total';
    const msgs = document.getElementById('messages');
    msgs.appendChild(total);
  }
  total.textContent = tf('js.chatTotalTokens', {n: sum.toLocaleString()});
}

function safeIdx(idx) {
  const n = parseInt(idx, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function deleteBubble(idx) {
  idx = safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  chat.messages.splice(idx,1);
  save(); renderMessages(chat.messages);
}

function startEditBubble(idx) {
  idx = safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  const msg=chat.messages[idx]; if(!msg) return;
  let text='';
  if (typeof msg.content==='string') text=msg.content;
  else if (Array.isArray(msg.content)) text=msg.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
  const row=getBubbleRow(idx); if(!row) return;
  const wrap=row.querySelector('.bubble-wrap');
  // DOM-sicher erstellen
  wrap.innerHTML='';
  const ta = document.createElement('textarea');
  ta.className='edit-box'; ta.rows=3; ta.value=text;
  ta.style.height='auto';
  const eActs = document.createElement('div'); eActs.className='edit-actions';
  const confirmBtn = document.createElement('button'); confirmBtn.className='edit-confirm-btn'; confirmBtn.textContent=t('js.saveBubble');
  confirmBtn.dataset.idx=idx; confirmBtn.addEventListener('click', () => confirmEditBubble(parseInt(confirmBtn.dataset.idx)));
  const cancelBtn = document.createElement('button'); cancelBtn.className='edit-cancel-btn'; cancelBtn.textContent=t('js.cancel');
  cancelBtn.addEventListener('click', () => renderMessages(currentChat().messages));
  eActs.appendChild(confirmBtn); eActs.appendChild(cancelBtn);
  wrap.appendChild(ta); wrap.appendChild(eActs);
  ta.style.height = ta.scrollHeight + 'px'; ta.focus();
}

function confirmEditBubble(idx) {
  idx = safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  const row=getBubbleRow(idx); if(!row) return;
  const ta=row.querySelector('.edit-box'); if(!ta) return;
  const newText=ta.value.trim(); if(!newText) return;
  const msg=chat.messages[idx];
  if (typeof msg.content==='string') msg.content=newText;
  else if (Array.isArray(msg.content)) {
    let replaced=false;
    msg.content=msg.content.map(p=>{ if(p.type==='text'&&!replaced){replaced=true;return{...p,text:newText};} return p; });
  } else msg.content=newText;
  save(); renderMessages(chat.messages);
}

function branchFromHere(idx) {
  idx = safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  const branchedMsgs=JSON.parse(JSON.stringify(chat.messages.slice(0,idx+1)));
  const branchId=Date.now().toString();
  chats.unshift({ id:branchId, title:`↩ ${chat.title.slice(0,32)} (ab #${idx+1})`, folderId:chat.folderId, branchOf:chat.id, messages:branchedMsgs });
  currentChatId=branchId; save(); renderSidebar(); renderMessages(branchedMsgs);
  toast(`↩ Branch ab Nachricht ${idx+1}`);
}

async function regenerate(idx) {
  idx = safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  const msg=chat.messages[idx];
  if (!msg||msg.role!=='assistant') return;
  if (isStreaming) { toast('Bitte warten…'); return; }
  chat.messages.splice(idx,1);
  const userMsg=chat.messages[idx-1];
  if (!userMsg||userMsg.role!=='user') { save(); renderMessages(chat.messages); return; }
  let userText='';
  if (typeof userMsg.content==='string') userText=userMsg.content;
  else if (Array.isArray(userMsg.content)) userText=userMsg.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
  chat.messages.splice(idx-1,1);
  save(); renderMessages(chat.messages);
  await sendMessageCore(userText,[]);
}

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
  if (isStreaming) return;
  const input = document.getElementById('messageInput');
  const text  = input.value.trim();
  if (!text && !attachments.length) return;
  if (!config.model) { toast(t('js.noModel')); return; }
  const provider = providerForModel(config.model) || providers[0];
  if (!provider) { toast(t('js.noProvider')); openProviderPanel(); return; }
  if (!provider.apiKey) { toast(t('js.noApiKey')); openProviderPanel(); return; }
  const att=[...attachments];
  input.value=''; autoResize(input); clearAttachments();
  await sendMessageCore(text, att);
}

async function sendMessageCore(text, att) {
  if (!currentChatId) newChat();
  const empty = document.getElementById('emptyState');
  if (empty) empty.style.display = 'none';
  const provider = providerForModel(config.model) || providers[0];
  const isKiConnect = provider?.type === 'openai-compat' && (provider.serverUrl||'').includes('kiconnect.nrw');
  const documentIds = [];

  for (const a of att) {
    if (a.type==='pdf-b64' && a.pdfMode==='b64' && isKiConnect && a.rawBuf) {
      try {
        toast(`⏳ ${a.name} ${t('js.uploading')}`);
        const form = new FormData();
        form.append('file', new Blob([a.rawBuf],{type:'application/pdf'}), a.name);
        const endpoint = getProviderEndpoint(provider).replace('/api/v1','');
        const res = await fetch(proxyUrl(`${endpoint}/app/documents`), {
          method:'POST', headers:{'Authorization':`Bearer ${provider.apiKey}`}, body:form
        });
        if (res.status === 409) {
          try { const doc=await res.json(); const docId=doc.id||doc.documentId||doc._id||doc.document_id; if(docId){documentIds.push(docId);a._uploadedId=docId;} } catch {}
          toast(tf('js.alreadyPresent', {name: a.name}));
        } else if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        else {
          const doc=await res.json(); const docId=doc.id||doc.documentId||doc._id||doc.document_id;
          if(docId){documentIds.push(docId);a._uploadedId=docId;} toast(`✅ ${a.name} ${t('js.uploaded')}`);
        }
      } catch(err) { toast(tf('js.uploadFailed',{e:err.message})); renderAttachments(); return; }
    }
  }

  let userContent;
  const fileNames=[];
  if (att.length) {
    userContent=[];
    if (text) userContent.push({type:'text',text});
    att.forEach(a => {
      if (a.type==='image') userContent.push({type:'image_url',image_url:{url:a.data}});
      else if (a.type==='pdf-b64') {
        fileNames.push(a.name);
        if (a._uploadedId) { /* via documentIds */ }
        else if (a.pdfMode==='text') { const txt=a.extractedText||t('js.noText'); userContent.push({type:'text',text:`${tf('js.fileContent',{name:a.name})}\n${txt}\n${t('js.fileEnd')}`}); }
        else { const b64=(a.data||'').split(',')[1]||a.data; userContent.push({type:'pdf_base64',name:a.name,data:b64}); }
      } else if (a.type==='text-file') { fileNames.push(a.name); userContent.push({type:'text',text:`${tf('js.fileContent',{name:a.name})}\n${a.content}\n${t('js.fileEnd')}`}); }
      else { fileNames.push(a.name); userContent.push({type:'text',text:`[${tf('js.unreadableFormat',{name:a.name})}]`}); }
    });
    if (userContent.length===0&&text) userContent=text;
  } else { userContent=text; }

  // FIX #7: Bilder + PDFs in Storage-Darstellung ersetzen
  const userMsgForStorage = {
    role:'user',
    content: Array.isArray(userContent)
      ? userContent.map(p => {
          if (p.type==='pdf_base64') return {type:'text',text:`[PDF: ${p.name}]`};
          if (p.type==='image_url') {
            const url=p.image_url?.url||'';
            if (url.startsWith('data:')&&url.length>MAX_IMAGE_STORAGE_BYTES) return {type:'text',text:'[' + t('js.imageNotSaved') + ']'};
          }
          return p;
        })
      : userContent,
    _files: fileNames.length ? fileNames : undefined
  };
  const chat=currentChat();
  chat.messages.push(userMsgForStorage);
  if (chat.messages.length===1) { chat.title=(text||t('js.imageFileTitle')).slice(0,40); renderSidebar(); }

  const idx=chat.messages.length-1;
  const msgEl=buildMsgEl({role:'user',content:text||null,_files:att.map(a=>a.name)},idx);
  appendToMessages(msgEl);
  scrollToBottom();

  const typingId=showTyping();
  isStreaming=true; setSendMode('stop'); abortController=new AbortController();
  let assistantText='';
  let usageData = null; // will be populated from API usage metrics

  try {
    if (provider.type === 'anthropic') {
      function toAnthropicContent(content) {
        if (!Array.isArray(content)) return content;
        return content.map(p => {
          if (p.type==='image_url') { const url=p.image_url?.url||''; if(url.startsWith('data:')){const[meta,b64]=url.split(',');return{type:'image',source:{type:'base64',media_type:meta.replace('data:','').replace(';base64',''),data:b64}};} return{type:'image',source:{type:'url',url}}; }
          if (p.type==='pdf_base64') return {type:'document',source:{type:'base64',media_type:'application/pdf',data:p.data}};
          return p;
        });
      }
      const anthropicMsgs=[];
      chat.messages.slice(0,-1).forEach(m=>{if(m.role==='user'||m.role==='assistant')anthropicMsgs.push({role:m.role,content:toAnthropicContent(m.content)});});
      anthropicMsgs.push({role:'user',content:toAnthropicContent(userContent)});
      const { modelId: _aModelId } = splitModelId(config.model);
      const body={model:_aModelId,max_tokens:effectiveMaxTokens(),temperature:config.temperature,stream:true,messages:anthropicMsgs};
      if(config.systemPrompt)body.system=config.systemPrompt;
      // Extended Thinking (claude-3.7+ / claude-4)
      if (config.thinkingEnabled && isThinkingCapable(_aModelId)) {
        const budget = usesTokenBudget(_aModelId)
          ? (config.thinkingBudget || 8000)
          : CLAUDE_BUDGET[config.thinkingIntensity || 2];
        body.thinking = { type: 'enabled', budget_tokens: budget };
        // Extended Thinking erfordert temperature=1
        body.temperature = 1;
        // max_tokens muss > budget_tokens sein
        body.max_tokens = Math.max(body.max_tokens, budget + 2000);
      }
      const res=await fetch(proxyUrl('https://api.anthropic.com/v1/messages'),{method:'POST',headers:{'Content-Type':'application/json','x-api-key':provider.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify(body),signal:abortController.signal});
      if(!res.ok)throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
      removeTyping(typingId);
      const aiEl=appendEmptyAI();
      const reader=res.body.getReader(),decoder=new TextDecoder();let buf='';
      let thinkingText=''; let inThinkingBlock=false;
      while(true){
        const{done,value}=await reader.read();if(done)break;
        buf+=decoder.decode(value,{stream:true});
        const lines=buf.split('\n');buf=lines.pop();
        for(const line of lines){
          if(!line.startsWith('data: '))continue;
          try{
            const ev=JSON.parse(line.slice(6).trim());
            if(ev.type==='message_start'&&ev.message?.usage){
              // initial usage from message_start
              usageData = {...(usageData||{}), ...ev.message.usage};
            } else if(ev.type==='message_delta'&&ev.usage){
              // output_tokens come in message_delta
              usageData = {...(usageData||{}), ...ev.usage};
            } else if(ev.type==='content_block_start'){
              if(ev.content_block?.type==='thinking') inThinkingBlock=true;
              else inThinkingBlock=false;
            } else if(ev.type==='content_block_stop'){
              inThinkingBlock=false;
            } else if(ev.type==='content_block_delta'){
              if(ev.delta?.type==='thinking_delta'&&inThinkingBlock){
                thinkingText+=ev.delta.thinking||'';
                // Show thinking block collapsed above response
                const bubble=aiEl.querySelector('.bubble');
                const thinkHtml = thinkingText ? `<details class="thinking-block" style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;font-family:'IBM Plex Mono',monospace;color:var(--accent2);opacity:0.8;">${tf('js.thinkingBlock',{n:thinkingText.length})}</summary><pre style="font-size:11px;color:var(--muted);white-space:pre-wrap;margin-top:6px;padding:8px;background:#0a0c10;border-radius:6px;">${escHtml(thinkingText)}</pre></details>` : '';
                bubble.innerHTML=thinkHtml+formatText(assistantText);
              } else if(ev.delta?.type==='text_delta'){
                assistantText+=ev.delta.text;
                const bubble=aiEl.querySelector('.bubble');
                const thinkHtml = thinkingText ? `<details class="thinking-block" style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;font-family:'IBM Plex Mono',monospace;color:var(--accent2);opacity:0.8;">${tf('js.thinkingBlock',{n:thinkingText.length})}</summary><pre style="font-size:11px;color:var(--muted);white-space:pre-wrap;margin-top:6px;padding:8px;background:#0a0c10;border-radius:6px;">${escHtml(thinkingText)}</pre></details>` : '';
                bubble.innerHTML=thinkHtml+formatText(assistantText);
                scrollToBottom();
              }
            }
          }catch{}
        }
      }
      // Prepend thinking to stored assistant message
      if (thinkingText) assistantText = `<thinking>\n${thinkingText}\n</thinking>\n\n` + assistantText;
      typesetMath();
    } else {
      const endpoint=getProviderEndpoint(provider);
      const apiMsgs=[];
      if(config.systemPrompt)apiMsgs.push({role:'system',content:config.systemPrompt});
      chat.messages.slice(0,-1).forEach(m=>{if(m.role==='user'||m.role==='assistant')apiMsgs.push({role:m.role,content:m.content});});
      apiMsgs.push({role:'user',content:userContent});
      const {modelId:_oModelId}=splitModelId(config.model);
      const reqBody={model:_oModelId,messages:apiMsgs,stream:true};

      // o-series reasoning models: NO temperature, use max_completion_tokens
      const isOSeries = /^o\d/.test(_oModelId);
      if (isOSeries) {
        reqBody.max_completion_tokens = effectiveMaxTokens();
        if (config.thinkingEnabled && isThinkingCapable(_oModelId)) {
          reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
        }
        // reasoning_effort alone defaults to 'medium' if not specified — that's fine
      } else {
        // Standard GPT / Mistral / Gemini / xAI / Groq / OpenRouter
        reqBody.temperature = config.temperature;
        reqBody.max_tokens  = effectiveMaxTokens();
        // GPT-4.1 / 4.5 series also support reasoning_effort
        if (config.thinkingEnabled && isThinkingCapable(_oModelId)) {
          reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
        }
      }
      if(documentIds.length>0)reqBody.documents=documentIds;
      // Request usage in stream (OpenAI-compatible providers)
      reqBody.stream_options = { include_usage: true };

      // OpenRouter extra headers
      const extraHeaders = {};
      if (provider.type === 'openrouter') {
        extraHeaders['HTTP-Referer'] = window.location.origin;
        extraHeaders['X-Title'] = 'KI Connect NRW';
      }

      const res=await fetch(proxyUrl(`${endpoint}/chat/completions`),{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${provider.apiKey}`,...extraHeaders},
        body:JSON.stringify(reqBody),
        signal:abortController.signal
      });
      if(!res.ok)throw new Error(`${res.status}: ${await res.text()}`);
      removeTyping(typingId);
      const aiEl=appendEmptyAI();
      const reader=res.body.getReader(),decoder=new TextDecoder();let buf='';
      while(true){const{done,value}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.startsWith('data: '))continue;const payload=line.slice(6).trim();if(payload==='[DONE]')continue;try{const chunk=JSON.parse(payload);const delta=chunk.choices?.[0]?.delta?.content||'';assistantText+=delta;if(delta){aiEl.querySelector('.bubble').innerHTML=formatText(assistantText);scrollToBottom();}if(chunk.usage){const u=chunk.usage;usageData={input_tokens:u.prompt_tokens,output_tokens:u.completion_tokens,cache_read_input_tokens:u.prompt_tokens_details?.cached_tokens||0};}}catch{}}}
      typesetMath();
    }
  } catch(e) {
    removeTyping(typingId);
    if(e.name==='AbortError'){if(!assistantText)assistantText=t('js.generationStopped');}
    else{assistantText=tf('js.errorPrefix',{e:escHtml(e.message)});const errEl=buildMsgEl({role:'assistant',content:assistantText},undefined);appendToMessages(errEl);scrollToBottom();setStatus('red');}
  }

  if(assistantText){
    const msgObj = {role:'assistant', content:assistantText, _model:config.model};
    if (usageData) msgObj._usage = usageData;
    chat.messages.push(msgObj);
    const aiIdx=chat.messages.length-1;
    const c=document.getElementById('messages');
    const _aiEls=c.querySelectorAll('.message-row.ai');const lastAiEl=_aiEls.length?_aiEls[_aiEls.length-1]:null;
    if(lastAiEl&&!lastAiEl.dataset.idx){
      lastAiEl.dataset.idx=aiIdx;
      const wrap=lastAiEl.querySelector('.bubble-wrap');
      if(wrap&&!wrap.querySelector('.bubble-actions')){
        const actDiv=document.createElement('div');actDiv.className='bubble-actions';
        const makeBtn=(lbl,cls2,handler,action)=>{const b=document.createElement('button');b.className='bubble-act-btn'+(cls2?' '+cls2:'');b.textContent=lbl;if(action)b.setAttribute('data-action',action);b.dataset.idx=aiIdx;b.addEventListener('click',()=>handler(parseInt(b.dataset.idx)));return b;};
        actDiv.appendChild(makeBtn(t('js.copy'),'',i=>{const firstBtn=actDiv.querySelector('.bubble-act-btn');copyBubble(firstBtn,i);},'copy'));
        actDiv.appendChild(makeBtn(t('js.edit'),'',startEditBubble,'edit'));
        actDiv.appendChild(makeBtn(t('js.branch'),'',branchFromHere,'branch'));
        actDiv.appendChild(makeBtn(t('js.regenerate'),'',regenerate,'regenerate'));
        actDiv.appendChild(makeBtn(t('js.delete'),'danger',deleteBubble,'delete'));
        wrap.appendChild(actDiv);
        // Token badge
        if (usageData) wrap.appendChild(buildTokenBadge(usageData));
      }
    }
    updateChatTokenTotal();
    save();
  }
  isStreaming=false; abortController=null; setSendMode('send'); setStatus('green');
}

// ── Message UI ─────────────────────────────────────────────────────

// Helper: Elemente immer VOR #chatTokenTotal einfügen
function appendToMessages(el) {
  const c = document.getElementById('messages');
  const total = c.querySelector('#chatTokenTotal');
  if (total) { c.insertBefore(el, total); } else { c.appendChild(el); }
}

function appendEmptyAI() {
  const c=document.getElementById('messages');
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
// FIX #4/#5: Code-Copy ohne onclick, mit data-b64
function copyCodeFromBtn(btn) {
  const b64 = btn.dataset.b64;
  if (!b64) return;
  let text;
  try { text=decodeURIComponent(escape(atob(b64))); } catch { text=atob(b64); }
  navigator.clipboard.writeText(text).then(()=>{
    btn.textContent=t('js.copied'); btn.classList.add('done');
    setTimeout(()=>{ btn.textContent=t('js.codeCopy'); btn.classList.remove('done'); },2000);
  }).catch(()=>toast(t('js.copyFailed')));
}
// Legacy-Alias für Abwärtskompatibilität
function copyCode(btn, b64) { btn.dataset.b64=b64; copyCodeFromBtn(btn); }

function copyBubble(btn, idx) {
  idx = safeIdx(idx); if(idx===null) return;
  const chat=currentChat(); if(!chat) return;
  const msg=chat.messages[idx]; if(!msg) return;
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
    return `[${role}]\n${content}`;
  }).join('\n\n---\n\n');
  navigator.clipboard.writeText(text).then(()=>toast(t('js.chatCopied'))).catch(()=>toast(t('js.copyFailed')));
}

// ═══════════════════════════════════════════════════════════════
// FIX #4 + #5: TEXT FORMATTING
// - 'onclick' aus DOMPurify ALLOWED_ATTR entfernt
// - unescapePassthroughTags() entfernt (war XSS-Vektor)
// - Code-Copy-Buttons nutzen data-b64 + addEventListener
// ═══════════════════════════════════════════════════════════════
function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function inlineMarkdown(escapedText) {
  let s = escapedText;
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<!_)_(?!_)([^_\n]+?)(?<!_)_(?!_)/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  return s;
}

function formatText(raw) {
  if (!raw) return '';
  const blocks = [];

  // Fenced Code-Blöcke — Code-Copy via data-b64 (KEIN onclick)
  let s = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = blocks.length;
    const b64  = btoa(unescape(encodeURIComponent(code)));
    const langLabel = escHtml(lang || 'code');
    // FIX #4: data-b64 statt onclick="copyCode(...)"
    blocks.push(
      `<div class="code-block">` +
      `<div class="code-block-header">` +
      `<span class="code-lang">${langLabel}</span>` +
      `<button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button>` +
      `</div><pre><code>${escHtml(code)}</code></pre></div>`
    );
    return `\x00BLK${idx}\x00`;
  });

  // Inline-Code
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = blocks.length;
    blocks.push(`<code>${escHtml(code)}</code>`);
    return `\x00BLK${idx}\x00`;
  });

  // Display-Math \[...\]
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    const idx = blocks.length;
    blocks.push(`<span class="math-block">\\[${math}\\]</span>`);
    return `\x00BLK${idx}\x00`;
  });
  // $$...$$
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const idx = blocks.length;
    blocks.push(`<span class="math-block">$$${math}$$</span>`);
    return `\x00BLK${idx}\x00`;
  });
  // Inline-Math \(...\)
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
    const idx = blocks.length;
    blocks.push(`\\(${math}\\)`);
    return `\x00BLK${idx}\x00`;
  });

  // HTML escapen
  s = escHtml(s);

  // FIX #5: unescapePassthroughTags() ENTFERNT
  // DOMPurify erlaubt <u>, <sup>, <sub> etc. bereits sicher über ALLOWED_TAGS

  // Block-Elemente
  s = s.replace(/^### (.+)$/gm, (_, t) => `<h3 style="margin:8px 0 4px;font-size:15px;">${inlineMarkdown(t)}</h3>`);
  s = s.replace(/^## (.+)$/gm,  (_, t) => `<h2 style="margin:10px 0 4px;font-size:17px;">${inlineMarkdown(t)}</h2>`);
  s = s.replace(/^# (.+)$/gm,   (_, t) => `<h1 style="margin:12px 0 4px;font-size:20px;">${inlineMarkdown(t)}</h1>`);

  s = s.replace(/((?:^[^\n]*\|[^\n]*\n)+)/gm, (tableBlock) => {
    const lines = tableBlock.trim().split('\n');
    if (lines.length < 2) return tableBlock;
    const isSepRow = (line) => /^[\|\-\s:]+$/.test(line);
    if (!isSepRow(lines[1])) return tableBlock;
    const parseRow = (line) => line.replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
    const headers = parseRow(lines[0]);
    const aligns  = parseRow(lines[1]).map(c=>{if(/^:-+:$/.test(c))return'center';if(/^-+:$/.test(c))return'right';return'left';});
    const ths = headers.map((h,i)=>`<th style="text-align:${aligns[i]||'left'};padding:6px 12px;border-bottom:2px solid var(--border);white-space:nowrap;">${inlineMarkdown(h)}</th>`).join('');
    const trs = lines.slice(2).map(line=>{if(!line.trim()||isSepRow(line))return'';const tds=parseRow(line).map((c,i)=>`<td style="text-align:${aligns[i]||'left'};padding:5px 12px;border-bottom:1px solid var(--border);">${inlineMarkdown(c)}</td>`).join('');return`<tr>${tds}</tr>`;}).filter(Boolean).join('');
    return `<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;width:100%;font-size:14px;"><thead><tr style="background:var(--surface2);">${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
  });

  s = s.replace(/^[\-\*] (.+)$/gm, (_, item) => `<li>${inlineMarkdown(item)}</li>`);
  s = s.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul style="margin:6px 0 6px 18px;">${m}</ul>`);
  s = s.replace(/^\d+\. (.+)$/gm, (_, item) => `<li>${inlineMarkdown(item)}</li>`);
  s = s.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">');

  s = s.split(/\n{2,}/).map(p => {
    p = p.trim(); if(!p) return '';
    if (p.startsWith('<')) return p;
    return `<p>${inlineMarkdown(p).replace(/\n/g,'<br>')}</p>`;
  }).filter(Boolean).join('');

  // Platzhalter einsetzen
  s = s.replace(/\x00BLK(\d+)\x00/g, (_, idx) => blocks[+idx] || '');

  // FIX #4: 'onclick' aus ALLOWED_ATTR entfernt — verhindert XSS via KI-Ausgaben
  if (typeof DOMPurify !== 'undefined') {
    s = DOMPurify.sanitize(s, {
      ALLOWED_TAGS: [
        'p','br','strong','em','del','h1','h2','h3','ul','ol','li',
        'code','pre','hr','table','thead','tbody','tr','th','td',
        'div','span','button','a',
        'u','sup','sub','mark','small','s','ins','abbr','cite','kbd'
      ],
      ALLOWED_ATTR: [
        'style','class',
        // 'onclick' ENTFERNT — Code-Copy nutzt jetzt data-b64 + addEventListener
        'href','target','rel','title',
        'data-b64',   // für Code-Copy-Buttons
      ],
      FORBID_ATTR:  ['onerror','onload','onmouseover','onfocus','onblur','onclick'],
      ALLOW_DATA_ATTR: false,
    });
  }

  return s;
}

// Nach formatText: Code-Copy-Buttons per addEventListener verdrahten
function wireCodeCopyButtons(container) {
  container.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    if (!btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', () => copyCodeFromBtn(btn));
    }
  });
}

// ── Math ──────────────────────────────────────────────────────────
function typesetMath() {
  if(window.MathJax&&MathJax.typesetPromise) {
    MathJax.typesetPromise([document.getElementById('messages')]).catch(()=>{});
  }
}

// ── PDF Helpers ───────────────────────────────────────────────────
async function extractPdfText(arrayBuffer) {
  const lib=window._pdfjsLib||window.pdfjsLib; if(!lib) throw new Error('PDF.js nicht geladen');
  const pdf=await lib.getDocument({data:arrayBuffer}).promise;
  let out='';
  for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();out+=`${tf('js.pdfPage',{n:i})}\n${content.items.map(it=>it.str).join(' ')}\n`;}
  return out;
}
function arrayBufferToBase64(buf) {
  const bytes=new Uint8Array(buf);let bin='';
  for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function modelSupportsPdfBase64(mid) { return /claude|gemini|gpt-4o/i.test(mid||''); }

// ── File Handling ─────────────────────────────────────────────────
async function processFile(file) {
  const isImage = file.type.startsWith('image/');
  const isPdf   = file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  const reader  = new FileReader();
  reader.onload = async ev => {
    if (isImage) { attachments.push({type:'image',name:file.name,data:ev.target.result}); }
    else if (isPdf) {
      const b64data=ev.target.result;const b64=b64data.split(',')[1]||b64data;
      const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k);
      attachments.push({type:'pdf-b64',name:file.name,data:b64data,rawBuf:arr.buffer,pdfMode:'b64'});
    } else { attachments.push({type:'text-file',name:file.name,content:ev.target.result}); }
    renderAttachments();
  };
  isPdf||isImage ? reader.readAsDataURL(file) : reader.readAsText(file,'UTF-8');
}
function handleFileAttach(e)  { const file=e.target.files[0];if(!file)return;e.target.value='';processFile(file); }
function handleImageAttach(e) { const file=e.target.files[0];if(!file)return;e.target.value='';processFile(file); }

function renderAttachments() {
  const row = document.getElementById('attachmentRow');
  row.innerHTML = '';
  attachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'preview-chip';
    if (a.type==='image') {
      const img=document.createElement('img'); img.src=a.data; img.alt=a.name; chip.appendChild(img);
      chip.appendChild(document.createTextNode(a.name));
    } else if (/\.pdf$/i.test(a.name)||a.type==='pdf-b64') {
      const mode=a.pdfMode||'b64';
      chip.appendChild(document.createTextNode((mode==='b64'?'📄':'🔤')+' '+a.name));
      if (mode==='b64'&&!modelSupportsPdfBase64(config.model)) {
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

async function togglePdfMode(i, mode) {
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
function closePanels() {
  ['settingsPanel','providerPanel','profilePanel','modelMaxPanel'].forEach(id=>document.getElementById(id).classList.remove('open'));
  document.getElementById('overlay').classList.remove('show');
}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
function openSettings(){syncSettingsPanel();document.getElementById('settingsPanel').classList.add('open');document.getElementById('overlay').classList.add('show');}
function openProfilePanel(){renderProfileList();document.getElementById('profilePanel').classList.add('open');document.getElementById('overlay').classList.add('show');}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px';}

// Drag & Drop
let _dragCounter=0;
function handleDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='copy';}
function handleDragEnter(e){e.preventDefault();_dragCounter++;document.getElementById('dropOverlay').classList.add('active');}
function handleDragLeave(){_dragCounter--;if(_dragCounter<=0){_dragCounter=0;document.getElementById('dropOverlay').classList.remove('active');}}
async function handleDrop(e){e.preventDefault();_dragCounter=0;document.getElementById('dropOverlay').classList.remove('active');const files=Array.from(e.dataTransfer.files);if(!files.length)return;for(const file of files)await processFile(file);}

// ── Modell-Limits Panel ───────────────────────────────────────────
function openModelMaxPanel(){renderModelMaxList();document.getElementById('modelMaxPanel').classList.add('open');document.getElementById('overlay').classList.add('show');}

function renderModelMaxList() {
  const list = document.getElementById('modelMaxList');
  list.innerHTML = '';
  const selector=document.getElementById('modelSelector');
  const seenModels=new Set();const rows=[];
  Array.from(selector.options).forEach(opt=>{if(!opt.value)return;const{modelId}=splitModelId(opt.value);if(!modelId||seenModels.has(modelId))return;seenModels.add(modelId);rows.push({modelId,label:opt.textContent.trim()});});
  Object.entries(KNOWN_MODELS).forEach(([id,m])=>{if(!seenModels.has(id)){seenModels.add(id);rows.push({modelId:id,label:m.label});}});
  if (!rows.length) { const msg=document.createElement('div');msg.style.cssText='color:var(--muted);font-size:13px;padding:8px;';msg.textContent=t('js.noModelsInPanel');list.appendChild(msg);return; }
  rows.forEach(({modelId, label}) => {
    const defaultMax=getModelDefaultMax(modelId);const currentMax=getModelMaxOutput(modelId);const isModified=currentMax!==defaultMax;
    const row=document.createElement('div');row.className='model-max-row'+(isModified?' model-max-modified':'');row.id='mmrow_'+modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
    const info=document.createElement('div');info.style.cssText='flex:1;min-width:0;';
    const nameEl=document.createElement('div');nameEl.className='model-max-name';nameEl.textContent=label.replace(/^[▲●]\s*/,'');
    const subEl=document.createElement('div');subEl.className='model-max-sub';subEl.textContent=modelId;
    info.appendChild(nameEl);info.appendChild(subEl);
    const inp=document.createElement('input');inp.className='model-max-input';inp.type='number';inp.value=currentMax;inp.min=256;inp.max=200000;inp.step=256;inp.title='Max Output-Tokens';inp.dataset.modelId=modelId;
    inp.addEventListener('change',()=>setModelMax(inp.dataset.modelId,inp));
    const resetBtn=document.createElement('button');resetBtn.className='reset-btn';resetBtn.title=tf('js.resetTitle',{n:defaultMax.toLocaleString()});resetBtn.textContent='↺';resetBtn.dataset.modelId=modelId;
    resetBtn.addEventListener('click',()=>resetModelMax(resetBtn.dataset.modelId));
    row.appendChild(info);row.appendChild(inp);row.appendChild(resetBtn);
    list.appendChild(row);
  });
}

function setModelMax(modelId, inputEl) {
  const val=parseInt(inputEl.value);const defaultMax=getModelDefaultMax(modelId);
  if(!val||val<256){inputEl.value=defaultMax;return;}
  if(!config.userModelMaxOverrides)config.userModelMaxOverrides={};
  if(val===defaultMax){delete config.userModelMaxOverrides[modelId];}else{config.userModelMaxOverrides[modelId]=val;}
  const safeId=modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row=document.getElementById('mmrow_'+safeId);if(row)row.classList.toggle('model-max-modified',val!==defaultMax);
  save();updateModelMaxInfo();toast(tf('js.limitSet',{id:modelId.split('/').pop().slice(0,20),n:val.toLocaleString()}));
}
function resetModelMax(modelId) {
  if(!config.userModelMaxOverrides)return;delete config.userModelMaxOverrides[modelId];
  const defaultMax=getModelDefaultMax(modelId);const safeId=modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row=document.getElementById('mmrow_'+safeId);if(row){const inp=row.querySelector('.model-max-input');if(inp)inp.value=defaultMax;row.classList.remove('model-max-modified');}
  save();updateModelMaxInfo();toast(tf('js.resetTo',{id:modelId.split('/').pop().slice(0,20),n:defaultMax.toLocaleString()}));
}
function resetAllModelMax(){config.userModelMaxOverrides={};save();renderModelMaxList();updateModelMaxInfo();toast(t('js.allLimitsReset'));}

// ═══════════════════════════════════════════════════════════════
// LOGIN / PASSWORD / SESSION — FIX #1 + #2
// ═══════════════════════════════════════════════════════════════

async function checkLogin() {
  const hash = getStoredPwdHash();
  if (!hash) { showLoginScreen('setup'); return; }
  const sessionExpiry = parseInt(localStorage.getItem('kic_session_expiry') || '0');
  if (sessionExpiry && Date.now() < sessionExpiry) return;
  showLoginScreen('login');
}

function showLoginScreen(mode) {
  const ls = document.getElementById('loginScreen');
  if (!ls) return;
  ls.style.display = 'flex';
  const isSetup = (mode === 'setup') || !getStoredPwdHash();
  document.getElementById('loginModeFields').style.display = isSetup ? 'none' : '';
  document.getElementById('setupModeFields').style.display = isSetup ? '' : 'none';
  const subtitle = document.getElementById('loginSubtitle');
  if (isSetup) subtitle.textContent = t('login.setupSubtitle') || 'Create a password to protect your data';
  else subtitle.textContent = t('login.subtitle') || 'Enter your password to continue';
  applyTranslations();
  setTimeout(() => {
    const focusEl = isSetup ? document.getElementById('setupPwdInput') : document.getElementById('loginInput');
    if (focusEl) focusEl.focus();
  }, 80);
}
function hideLoginScreen() { const ls=document.getElementById('loginScreen');if(ls)ls.style.display='none'; }

async function doLogin() {
  const input=document.getElementById('loginInput');const errorEl=document.getElementById('loginError');const pw=input.value;if(!pw)return;
  const ok = await verifyPassword(pw);   // FIX #2: PBKDF2-Verifikation
  if (ok) {
    const durMs=getSessionDurationMs();if(durMs>0)localStorage.setItem('kic_session_expiry',String(Date.now()+durMs));
    input.value='';errorEl.textContent='';hideLoginScreen();startSessionCountdown();
  } else {
    errorEl.textContent=t('login.error');input.value='';input.focus();
  }
}

function updatePwdStrength(pw) {
  const bar=document.getElementById('pwdStrengthBar');if(!bar)return;
  let score=0;if(pw.length>=8)score++;if(pw.length>=12)score++;if(/[A-Z]/.test(pw))score++;if(/[0-9]/.test(pw))score++;if(/[^A-Za-z0-9]/.test(pw))score++;
  const pct=(score/5)*100;const cols=['#e74c3c','#e74c3c','#f39c12','#f0c040','#2ecc71','#2ecc71'];
  bar.style.width=pct+'%';bar.style.background=cols[score]||'#e74c3c';
}

async function doSetupPassword() {
  const pwdEl=document.getElementById('setupPwdInput');const confEl=document.getElementById('setupPwdConfirm');const errorEl=document.getElementById('setupError');
  const pw=pwdEl.value;const conf=confEl.value;
  if(pw.length<8){errorEl.textContent=t('js.pwdSetupTooShort')||'⚠️ Minimum 8 characters';return;}
  if(pw!==conf){errorEl.textContent=t('js.pwdMismatch');return;}
  await storePasswordHash(pw);   // FIX #2: PBKDF2 mit zufälligem Salt
  const durMs=getSessionDurationMs();if(durMs>0)localStorage.setItem('kic_session_expiry',String(Date.now()+durMs));
  pwdEl.value='';confEl.value='';errorEl.textContent='';hideLoginScreen();startSessionCountdown();
  toast(t('js.pwdSetupDone')||'🔐 Password set — welcome!');
}

function forgotPassword() {
  if(!confirm(t('login.resetConfirm')))return;
  localStorage.clear();sessionStorage.clear();
  toast(t('login.resetDone'));setTimeout(()=>location.reload(),1200);
}

async function changeLoginPassword() {
  const currentPw=document.getElementById('currentPwdInput').value;
  const newPw=document.getElementById('newPwdInput').value;
  const confirmPw=document.getElementById('confirmPwdInput').value;
  const stored=getStoredPwdHash();
  if(stored){
    if(!currentPw){toast(t('js.pwdCurrentRequired'));return;}
    const ok=await verifyPassword(currentPw);
    if(!ok){toast(t('js.pwdCurrentWrong'));return;}
  }
  if(newPw.length<4){toast(t('js.pwdTooShort'));return;}
  if(newPw!==confirmPw){toast(t('js.pwdMismatch'));return;}
  await storePasswordHash(newPw);   // FIX #2
  const durMs=getSessionDurationMs();if(durMs>0)localStorage.setItem('kic_session_expiry',String(Date.now()+durMs));
  document.getElementById('currentPwdInput').value='';document.getElementById('newPwdInput').value='';document.getElementById('confirmPwdInput').value='';
  toast(t('js.pwdChanged'));
}

function logoutNow(){closePanels();localStorage.removeItem('kic_session_expiry');showLoginScreen('login');}

function getSessionDurationMs(){const h=parseInt(document.getElementById('sessionHoursInput')?.value||'12');const m=parseInt(document.getElementById('sessionMinutesInput')?.value||'0');return(h*60+m)*60*1000;}
function loadSessionSettings(){
  const saved=localStorage.getItem('kic_session_duration_ms');
  if(saved){const ms=parseInt(saved);const totalMin=Math.round(ms/60000);const h=Math.floor(totalMin/60);const m2=totalMin%60;const hi=document.getElementById('sessionHoursInput');const mi=document.getElementById('sessionMinutesInput');if(hi)hi.value=h;if(mi)mi.value=m2;}
}
function applySessionDuration(){
  const durMs=getSessionDurationMs();localStorage.setItem('kic_session_duration_ms',String(durMs));
  if(durMs>0)localStorage.setItem('kic_session_expiry',String(Date.now()+durMs));
  startSessionCountdown();toast(t('settings.sessionApply')||'⏱ Applied');
}
function resetSessionNow(){const hash=getStoredPwdHash();if(!hash){toast('No password set');return;}localStorage.removeItem('kic_session_expiry');toast(t('js.sessionReset'));setTimeout(()=>showLoginScreen('login'),1200);}

let _countdownTimer=null;
function startSessionCountdown(){if(_countdownTimer)clearInterval(_countdownTimer);_countdownTimer=setInterval(updateSessionCountdown,1000);updateSessionCountdown();}
function updateSessionCountdown(){
  const el=document.getElementById('sessionCountdown');if(!el)return;
  const expiry=parseInt(localStorage.getItem('kic_session_expiry')||'0');
  const hash=getStoredPwdHash();
  if(!hash){el.textContent='—';el.style.color='var(--muted)';return;}
  if(!expiry){el.textContent='∞';el.style.color='var(--accent)';return;}
  const remaining=expiry-Date.now();
  if(remaining<=0){el.textContent='0:00:00';el.style.color='var(--red)';clearInterval(_countdownTimer);setTimeout(()=>showLoginScreen('login'),500);return;}
  const h=Math.floor(remaining/3600000);const m=Math.floor((remaining%3600000)/60000);const s2=Math.floor((remaining%60000)/1000);
  el.textContent=`${h}:${String(m).padStart(2,'0')}:${String(s2).padStart(2,'0')}`;
  el.style.color=remaining<5*60*1000?'var(--red)':'var(--accent)';
}

function clearAllData(){
  if(!confirm(t('js.clearConfirm')))return;
  localStorage.clear();sessionStorage.clear();_cryptoKey=null;_sessionPassphrase=null;
  providers=[];profiles=[];folders=[];chats=[];
  config={model:'',temperature:0.7,maxTokens:null,systemPrompt:'',activeProfileId:null,userModelMaxOverrides:{},chatMaxWidth:880};
  closePanels();renderSidebar();renderMessages([]);updateProfileBadge();
  toast(t('js.cleared'));setTimeout(()=>location.reload(),1500);
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENER SETUP (zentralisiert, kein onclick im HTML)
// ═══════════════════════════════════════════════════════════════
function setupEventListeners() {
  // Header
  document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
  document.getElementById('openProviderHeaderBtn').addEventListener('click', openProviderPanel);
  document.getElementById('openSettingsBtn').addEventListener('click', openSettings);
  document.getElementById('profileBadge').addEventListener('click', openProfilePanel);
  document.getElementById('langToggleBtn').addEventListener('click', toggleLangDropdown);

  // Overlay
  document.getElementById('overlay').addEventListener('click', closePanels);

  // Settings Panel
  document.getElementById('settingsPanelClose').addEventListener('click', closePanels);
  document.getElementById('goProviderFromSettings').addEventListener('click', () => { closePanels(); openProviderPanel(); });
  document.getElementById('goModelLimits').addEventListener('click', () => { closePanels(); openModelMaxPanel(); });
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('changePwdBtn').addEventListener('click', changeLoginPassword);
  document.getElementById('applySessionBtn').addEventListener('click', applySessionDuration);
  document.getElementById('resetSessionBtn').addEventListener('click', resetSessionNow);
  document.getElementById('logoutBtn').addEventListener('click', logoutNow);
  document.getElementById('clearAllBtn').addEventListener('click', clearAllData);
  document.getElementById('temperature').addEventListener('input', e => { document.getElementById('tempVal').textContent = e.target.value; });
  document.getElementById('chatWidthSlider').addEventListener('input', e => applyChatWidth(e.target.value));

  // Thinking Toggle
  document.getElementById('thinkingToggle').addEventListener('click', toggleThinking);
  document.getElementById('thinkingIntensitySlider').addEventListener('input', e => {
    const { modelId } = splitModelId(config.model);
    if (usesTokenBudget(modelId)) {
      config.thinkingBudget = parseInt(e.target.value);
    } else {
      config.thinkingIntensity = parseInt(e.target.value);
    }
    updateThinkingIntensityUI();
    save();
  });

  // Provider Panel
  document.getElementById('providerPanelClose').addEventListener('click', closePanels);
  document.getElementById('addProviderBtn').addEventListener('click', startNewProvider);
  document.getElementById('saveProviderBtn').addEventListener('click', saveProviderEditor);
  document.getElementById('cancelProviderBtn').addEventListener('click', cancelProviderEditor);
  document.querySelectorAll('.type-chip').forEach(chip => {
    chip.addEventListener('click', () => selectProviderType(chip.dataset.type));
  });

  // Profile Panel
  document.getElementById('profilePanelClose').addEventListener('click', closePanels);
  document.getElementById('addProfileBtn').addEventListener('click', startNewProfile);
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfileEditor);
  document.getElementById('cancelProfileBtn').addEventListener('click', cancelProfileEditor);
  document.getElementById('peTemp').addEventListener('input', e => { document.getElementById('peTempVal').textContent = e.target.value; });
  document.getElementById('peUseModelMax').addEventListener('change', updatePeMaxTokensUI);
  document.getElementById('peModelInput').addEventListener('change', updatePeMaxTokensUI);
  document.getElementById('peMaxTokensSlider').addEventListener('input', e => { document.getElementById('peMaxTokensNum').textContent = parseInt(e.target.value).toLocaleString(); });

  // Modell-Limits Panel
  document.getElementById('modelMaxPanelClose').addEventListener('click', closePanels);
  document.getElementById('resetAllModelMaxBtn').addEventListener('click', resetAllModelMax);

  // Sidebar
  document.getElementById('newChatBtn').addEventListener('click', () => newChat());
  document.getElementById('newFolderBtn').addEventListener('click', newFolder);
  document.getElementById('copyFullChatBtn').addEventListener('click', copyFullChat);

  // Chat Area
  const chatArea = document.getElementById('chatArea');
  chatArea.addEventListener('dragenter', handleDragEnter);
  chatArea.addEventListener('dragover', handleDragOver);
  chatArea.addEventListener('dragleave', handleDragLeave);
  chatArea.addEventListener('drop', handleDrop);

  // Input
  document.getElementById('sendBtn').addEventListener('click', handleSendStop);
  document.getElementById('messageInput').addEventListener('keydown', handleKey);
  document.getElementById('messageInput').addEventListener('input', e => autoResize(e.target));
  document.getElementById('attachFileBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('attachImageBtn').addEventListener('click', () => document.getElementById('imageInput').click());
  document.getElementById('clearAttachBtn').addEventListener('click', clearAttachments);
  document.getElementById('fileInput').addEventListener('change', handleFileAttach);
  document.getElementById('imageInput').addEventListener('change', handleImageAttach);

  // Login
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginInput').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('forgotPwdBtn').addEventListener('click', forgotPassword);
  document.getElementById('setupBtn').addEventListener('click', doSetupPassword);
  document.getElementById('setupPwdInput').addEventListener('input', e => updatePwdStrength(e.target.value));
  document.getElementById('setupPwdInput').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('setupPwdConfirm').focus(); });
  document.getElementById('setupPwdConfirm').addEventListener('keydown', e => { if(e.key==='Enter') doSetupPassword(); });

  // Suggestion Chips — via DOM
  const suggestions = [
    { i18n: 'empty.quantum', msgKey: 'empty.quantumMsg' },
    { i18n: 'empty.python',  msgKey: 'empty.pythonMsg' },
    { i18n: 'empty.mlvsdl',  msgKey: 'empty.mlvsdlMsg' },
    { i18n: 'empty.integral',msgKey: 'empty.integralMsg' },
  ];
  const chipsContainer = document.getElementById('suggestionChips');
  suggestions.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'suggestion-chip';
    chip.textContent = t(s.i18n);
    chip.dataset.msgKey = s.msgKey;
    chip.addEventListener('click', () => sendSuggestion(t(chip.dataset.msgKey)));
    chipsContainer.appendChild(chip);
  });

  // Observer: Code-Copy-Buttons in neuen Nachrichten verdrahten
  const messagesContainer = document.getElementById('messages');
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => m.addedNodes.forEach(node => {
      if (node.nodeType === 1) wireCodeCopyButtons(node);
    }));
  });
  observer.observe(messagesContainer, { childList: true, subtree: true });
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
(async () => {
  await load();
  setupEventListeners();
  applyTranslations();
  updateProfileBadge();
  syncSettingsPanel();
  loadSessionSettings();
  if (config.chatMaxWidth) applyChatWidth(config.chatMaxWidth);
  // Restore thinking state
  if (config.thinkingEnabled) {
    document.getElementById('thinkingToggle')?.classList.add('active');
    document.getElementById('thinkingIntensity')?.classList.add('visible');
  }
  if (config.thinkingIntensity) {
    const slider = document.getElementById('thinkingIntensitySlider');
    if (slider) slider.value = config.thinkingIntensity;
  }
  if (!folders.length) { folders.push({id:'default',name:'Default',collapsed:false}); save(); }
  renderSidebar();
  if (!chats.length) { newChat(); }
  else {
    if (!currentChatId || !chats.find(c=>c.id===currentChatId)) currentChatId = chats[0].id;
    renderSidebar();
    renderMessages(currentChat()?.messages || []);
  }
  if (providers.length && providers.some(p=>p.apiKey)) fetchModels();
  else openProviderPanel();
  await checkLogin();
  startSessionCountdown();
})();

// ── Custom Model Dropdown ─────────────────────────────────────────
(function() {
  const trigger  = document.getElementById('cmTrigger');
  const panel    = document.getElementById('cmPanel');
  const list     = document.getElementById('cmList');
  const search   = document.getElementById('cmSearch');
  const label    = document.getElementById('cmLabel');
  const hiddenSel = document.getElementById('modelSelector');
  let open = false;

  // Modell-Daten (wird von populateModelSelector befüllt)
  window._cmData = []; // [{group, label, value}]

  function positionPanel() {
    const rect = trigger.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const maxH = Math.min(380, Math.max(spaceBelow, spaceAbove) - 8);
    panel.style.maxHeight = maxH + 'px';
    panel.style.left = rect.left + 'px';
    panel.style.width = Math.max(rect.width, 260) + 'px';
    if (spaceBelow >= 180 || spaceBelow >= spaceAbove) {
      panel.style.top  = (rect.bottom + 4) + 'px';
      panel.style.bottom = 'auto';
    } else {
      panel.style.bottom = (vh - rect.top + 4) + 'px';
      panel.style.top = 'auto';
    }
  }

  function renderList(filter) {
    const q = (filter || '').toLowerCase();
    list.innerHTML = '';
    let count = 0;
    window._cmData.forEach(group => {
      const items = group.items.filter(m => !q || m.label.toLowerCase().includes(q));
      if (!items.length) return;
      const gl = document.createElement('div');
      gl.className = 'cm-group-label';
      gl.textContent = group.group;
      list.appendChild(gl);
      items.forEach(m => {
        const opt = document.createElement('div');
        opt.className = 'cm-option' + (m.value === hiddenSel.value ? ' selected' : '');
        opt.textContent = m.label;
        opt.title = m.label;
        opt.addEventListener('click', () => {
          hiddenSel.value = m.value;
          hiddenSel.dispatchEvent(new Event('change'));
          closePanel();
        });
        list.appendChild(opt);
        count++;
      });
    });
    if (!count) {
      const em = document.createElement('div');
      em.className = 'cm-empty';
      em.textContent = typeof t === 'function' ? t('js.noModelFound') : 'No model found';
      list.appendChild(em);
    }
  }

  function openPanel() {
    if (open) return;
    open = true;
    trigger.classList.add('open');
    panel.classList.add('open');
    positionPanel();
    renderList('');
    search.value = '';
    search.focus();
    // Scroll selected into view
    const sel = list.querySelector('.selected');
    if (sel) setTimeout(() => sel.scrollIntoView({ block: 'nearest' }), 30);
  }

  function closePanel() {
    if (!open) return;
    open = false;
    trigger.classList.remove('open');
    panel.classList.remove('open');
  }

  trigger.addEventListener('click', (e) => { e.stopPropagation(); open ? closePanel() : openPanel(); });
  search.addEventListener('input', () => renderList(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanel(); trigger.focus(); }
    if (e.key === 'ArrowDown') { const first = list.querySelector('.cm-option'); if (first) { first.focus(); e.preventDefault(); } }
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanel(); trigger.focus(); }
  });
  document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== trigger) closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  window.addEventListener('resize', () => { if (open) positionPanel(); });
  window.addEventListener('scroll', () => { if (open) positionPanel(); }, true);

  // Sync label + selected state from hidden select
  window.syncCustomDropdown = function() {
    const val = hiddenSel.value;
    const opt = hiddenSel.options[hiddenSel.selectedIndex];
    label.textContent = opt ? opt.textContent : (typeof t === 'function' ? t('js.selectModel') : '— Select model —');
    if (!val) label.textContent = (typeof t === 'function' ? t('js.selectModel') : '— Open settings —');
    if (open) renderList(search.value);
  };

  // Befülle _cmData aus dem hidden select (optgroups)
  window.buildCustomDropdownData = function() {
    const data = [];
    Array.from(hiddenSel.children).forEach(child => {
      if (child.tagName === 'OPTGROUP') {
        const group = { group: child.label, items: [] };
        Array.from(child.children).forEach(opt => {
          group.items.push({ value: opt.value, label: opt.textContent });
        });
        data.push(group);
      } else if (child.tagName === 'OPTION' && child.value) {
        let last = data[data.length - 1];
        if (!last || last.group !== '') { last = { group: '', items: [] }; data.push(last); }
        last.items.push({ value: child.value, label: child.textContent });
      }
    });
    window._cmData = data;
    window.syncCustomDropdown();
  };
})();
