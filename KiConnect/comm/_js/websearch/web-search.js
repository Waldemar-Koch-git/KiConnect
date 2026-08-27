import { formatLinkedPagesBlock, formatWebSearchBlock, stripQuotedAndCodeBlocks } from '../auth/accounts.js';
import { save } from '../auth/storage.js';
import { escHtml } from '../chat/chat-render.js';
import { currentChat } from '../chat/chat-sidebar.js';
import { isAgenticWebMode, setMiniToggle } from '../chat/chat-send.js';
import { getAcceptLanguage, t } from '../core/i18n.js';
import { state } from '../core/state.js';
import { proxyPublicUrl, proxyUrl } from '../providers/provider-crud.js';
import { onLanguageChange, openSettings, toast } from '../ui/misc-ui.js';

export let webSearchCache = new Map();

export const WEB_SEARCH_RESULT_MAX = 30;

// Lets agent.js hand us a way to jump straight to its ⚙ Agent Settings
// panel (set via registerAgentSettingsOpener() at boot, if the coding-agent
// module is present at all). Kept as an optional callback — rather than a
// direct import of agent.js — so this module has no hard dependency on the
// agent feature and there's no import cycle (agent.js already imports THIS
// module for performWebSearch/fetchLinkedPage).
let _openAgentSettings = null;
export function registerAgentSettingsOpener(fn) { _openAgentSettings = typeof fn === 'function' ? fn : null; }

// The project (if any) the composer is currently filed into. Returns null
// for a plain chat, so every call site below can treat "focused project"
// and "normal chat" as the two branches of one flag instead of re-deriving
// this from state.folders/currentChat() in three different places.
function focusedAgentProject() {
  const chat = currentChat();
  const folder = chat && state.folders.find(f => f.id === chat.folderId);
  return (folder && folder.agentProject) ? folder : null;
}

export function updateWebSearchButton(searching=false) {
  const btn = document.getElementById('webSearchBtn');
  if (!btn) return;
  const project = focusedAgentProject();
  const mode = state.config.webSearchMode || 'manual';
  const active = mode === 'agentic' || state.config.webSearchEnabled;
  btn.classList.toggle('active', active && mode !== 'off' && !project);
  // Distinct visual state in project/agent mode: this button's own setting
  // has no effect there (the agent has its own web_search/fetch_url tools,
  // gated separately in ⚙ Agent Settings — see agent.js toolSchema()), so it
  // must not look "on"/"off" as if it did.
  btn.classList.toggle('agent-scope', !!project);
  btn.classList.toggle('link-active', !!state.config.webLinkEnabled && getSelectedReadableUrls().length > 0);
  btn.classList.toggle('searching', searching);
  // Never fully disabled in project mode — it stays clickable so the
  // popover's clarification banner (see syncWebContextPopover) is reachable.
  btn.disabled = (mode === 'off' && !project) || searching;
  btn.textContent = searching ? '...' : (project ? '🤖 Web' : (mode === 'agentic' ? 'Web 🕵🏻🌐' : 'Web ▾'));
  btn.title = project ? t('web.agentModeTitle') : t('web.buttonTitle');
  syncWebContextPopover();
}

export function toggleWebSearch() {
  // In project/agent mode this toggle doesn't govern anything the agent
  // reads (see updateWebSearchButton) — redirect to the real control
  // instead of silently flipping a setting with no effect.
  if (focusedAgentProject()) {
    toast(t('web.agentModeToast'));
    return;
  }
  if ((state.config.webSearchMode || 'manual') === 'off') {
    toast(t('web.offToast'));
    return;
  }
  if (isAgenticWebMode()) state.config.webSearchMode = 'manual';
  state.config.webSearchEnabled = !state.config.webSearchEnabled;
  updateWebSearchButton();
  save();
  toast(state.config.webSearchEnabled ? t('web.enabledToast') : t('web.disabledToast'));
}

export function toggleWebContextPopover(force) {
  const pop = document.getElementById('webContextPopover');
  if (!pop) return;
  pop.hidden = force === undefined ? !pop.hidden : !force;
  if (!pop.hidden) syncWebContextPopover();
}

export function syncWebContextPopover() {
  const project = focusedAgentProject();
  const notice = document.getElementById('webContextAgentNotice');
  const controls = document.getElementById('webContextControls');
  if (notice) {
    notice.hidden = !project;
    const label = document.getElementById('webContextAgentNoticeText');
    if (label) label.textContent = project ? t('web.agentModeNotice') : '';
  }
  // Hide the manual/agentic/link controls entirely while a project is
  // focused instead of leaving them visible-but-inert — they read/write
  // state.config.webSearch*, none of which the agent's tool loop consults.
  if (controls) controls.hidden = !!project;
  setMiniToggle(document.getElementById('webSearchToggle'), shouldUseWebSearch(document.getElementById('messageInput')?.value || ''));
  setMiniToggle(document.getElementById('webAgenticToggle'), isAgenticWebMode());
  setMiniToggle(document.getElementById('webLinkToggle'), !!state.config.webLinkEnabled);
  const count = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(state.config.webSearchResultCount) || 8));
  const countEl = document.getElementById('webContextCount');
  const countVal = document.getElementById('webContextCountVal');
  if (countEl && `${countEl.value}` !== `${count}`) countEl.value = count;
  if (countVal) countVal.textContent = count;
  renderDetectedLinks();
}

// Wired to #webContextAgentNoticeBtn's click in boot.js. Closes the popover
// and hands off to agent.js's own settings panel — a no-op (button hidden
// via CSS, see kiconnect.css) if the agent module never registered itself.
export function openAgentSettingsFromWebNotice() {
  if (!_openAgentSettings) return;
  toggleWebContextPopover(false);
  _openAgentSettings();
}

export function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function renderDetectedLinks() {
  const wrap = document.getElementById('webDetectedLinks');
  const input = document.getElementById('messageInput');
  if (!wrap || !input) return;
  const urls = extractReadableHttpUrls(input.value);
  state.selectedLinkUrls = new Set([...state.selectedLinkUrls].filter(url => urls.includes(url)));
  state.ignoredLinkUrls = new Set([...state.ignoredLinkUrls].filter(url => urls.includes(url)));
  if (state.config.webLinkEnabled) urls.forEach(url => {
    if (!state.ignoredLinkUrls.has(url)) state.selectedLinkUrls.add(url);
  });
  wrap.innerHTML = '';
  urls.forEach(url => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'web-link-chip';
    chip.classList.toggle('active', state.selectedLinkUrls.has(url));
    chip.title = url;
    chip.innerHTML = `<b>${state.selectedLinkUrls.has(url) ? '✓' : '○'}</b><span>${escHtml(hostLabel(url))}</span>`;
    chip.addEventListener('click', () => {
      if (state.selectedLinkUrls.has(url)) {
        state.selectedLinkUrls.delete(url);
        state.ignoredLinkUrls.add(url);
      } else {
        state.selectedLinkUrls.add(url);
        state.ignoredLinkUrls.delete(url);
      }
      state.config.webLinkEnabled = state.selectedLinkUrls.size > 0;
      save();
      updateWebSearchButton();
    });
    wrap.appendChild(chip);
  });
}

export function shouldAutoWebSearch(text) {
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

export function shouldUseWebSearch(text) {
  const mode = state.config.webSearchMode || 'manual';
  if (mode === 'off' || mode === 'agentic') return false;
  return !!state.config.webSearchEnabled;
}

export function cleanSearchQuery(text) {
  return (text || '')
    .replace(/^(suche|recherchiere|search|research)\s+(nach|zu|for|about)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export const ENGINES_NEEDING_KEY = new Set(['brave','google','bing','mojeek','yandex','langsearch']);

export function webEngineNeedsKey(engine) { return ENGINES_NEEDING_KEY.has(engine); }

export function updateWebSearchKeyUI(engine) {
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

export const SEARXNG_PUBLIC_INSTANCES = [
  'https://searx.be','https://searxng.world','https://search.bus-hit.me',
  'https://searx.tiekoetter.com','https://search.sapti.me',
  'https://searx.prvcy.eu','https://searx.fmac.xyz','https://search.ononoki.org',
];

export const WEB_SEARCH_LOCALES = {
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

export function getWebSearchLocale() {
  return WEB_SEARCH_LOCALES[state.currentLang] || WEB_SEARCH_LOCALES.en;
}

export function localizedHeaders(extra = {}) {
  return { 'Accept-Language': getAcceptLanguage(), ...extra };
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(proxyUrl(url), { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPublicWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(proxyPublicUrl(url), { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeSearchUrl(href, base) {
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

export function uniqueSearchResults(results, count) {
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

export function parseDuckDuckGoHtml(html, count, base) {
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

export async function searchDuckDuckGo(q, count) {
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

export async function searchSearxng(q, count, instanceUrl = '') {
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

export async function searchQwant(q, count) {
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

export async function searchYahoo(q, count) {
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

export async function searchStartpage(q, count) {
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

export async function searchFreeFallback(q, count) {
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

export async function fillWithFreeFallback(q, count, initialResults, excludedEngine = '') {
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

export async function performWebSearch(query) {
  const engine = state.config.webSearchEngine || 'free';
  const key = (state.config.webSearchApiKey || '').trim();
  if (webEngineNeedsKey(engine) && !key) {
    openSettings();
    throw new Error(t('web.noKey'));
  }
  const locale = getWebSearchLocale();
  const count = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(state.config.webSearchResultCount) || 8));
  const q = cleanSearchQuery(query);
  if (!q) return null;
  const cacheKey = `${engine}:${count}:${q.toLowerCase()}`;
  const cached = webSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 30 * 60 * 1000) return cached.value;

  // Reset "searching…" in a finally around the ENTIRE search, not just per
  // caller — agent mode's web_search tool calls performWebSearch() directly
  // with no reset, previously leaving the Web button stuck on "...".
  updateWebSearchButton(true);
  try {
    return await performWebSearchInner(engine, key, locale, count, q, cacheKey);
  } finally {
    updateWebSearchButton(false);
  }
}

export async function performWebSearchInner(engine, key, locale, count, q, cacheKey) {
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

export function buildWebAugmentedContent(originalContent, search) {
  const block = formatWebSearchBlock(search);
  if (!block) return originalContent;
  const webPart = { type: 'text', text: `${block}\n\n---\n\nUser question:`, _webSearch: true };
  if (Array.isArray(originalContent)) return [webPart, ...originalContent];
  return [webPart, { type: 'text', text: originalContent || '' }];
}

export function extractHttpUrls(text) {
  const matches = (text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return [...new Set(matches.map(u => u.replace(/[.,;:!?]+$/g, '')))].slice(0, 3);
}

export function extractReadableHttpUrls(text) {
  return extractHttpUrls(stripQuotedAndCodeBlocks(text));
}

export function getSelectedReadableUrls() {
  const input = document.getElementById('messageInput');
  const urls = extractReadableHttpUrls(input?.value || '');
  return urls.filter(url => state.selectedLinkUrls.has(url));
}

export function readablePageText(doc) {
  doc.querySelectorAll('script,style,noscript,svg,nav,footer,header,form,aside').forEach(el => el.remove());
  const main = doc.querySelector('main, article, [role="main"]') || doc.body || doc;
  return (main.textContent || '').replace(/\s+/g, ' ').trim();
}

export async function fetchLinkedPage(url) {
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

export async function fetchLinkedPagesFromText(text, urls = null) {
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

export function buildLinkedPageAugmentedContent(originalContent, pages) {
  const block = formatLinkedPagesBlock(pages);
  if (!block) return originalContent;
  const linkPart = { type: 'text', text: `${block}\n\n---\n\nUser question:`, _webSearch: true };
  if (Array.isArray(originalContent)) return [linkPart, ...originalContent];
  return [linkPart, { type: 'text', text: originalContent || '' }];
}

// The button's label/title and the popover's notice text are set in JS
// (they depend on whether a project is focused, not just the language), so
// the generic data-i18n pass in setLang() can't retranslate them on its
// own — re-derive both after it runs. See i18n.js: this listener list is
// invoked after applyTranslations(), so this correctly wins over any stale
// data-i18n markup for #webSearchBtn's title.
onLanguageChange(() => {
  updateWebSearchButton();
  const popover = document.getElementById('webContextPopover');
  if (popover && !popover.hidden) syncWebContextPopover();
});
