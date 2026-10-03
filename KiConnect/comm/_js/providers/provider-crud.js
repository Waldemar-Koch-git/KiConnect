import { save } from '../auth/storage.js';
import { t, ta, tf } from '../core/i18n.js';
import { state } from '../core/state.js';
import { _modelGroupsCache, fetchModels, providerStatus, resetEmbedModelPicker, updateThinkingUI, updateModelMaxInfo } from './provider-models.js';
import { toast, onLanguageChange } from '../ui/misc-ui.js';
import { TOUR_STEPS, nextTourStep } from '../ui/tour.js';
import { providerReady, chatgptRequest, clearProviderPdfConsent, setChatgptMessage, chatgptToast, createChatgptError } from './chatgpt-auth.js';
import { onSessionLock } from '../auth/accounts.js';
import { activeRuns } from '../chat/chat-send.js';

export const PROVIDER_TYPES = {
  'chatgpt': { get label() { return t('chatgpt.type'); }, needsUrl:false },
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

export const PROVIDER_HINTS = {
  'chatgpt': 'chatgpt.hint',
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

export function normalizeOpenAIBaseUrl(url) {
  return (url || '').trim().replace(/\/+$/, '').replace(/\/(?:models|embeddings|chat\/completions)$/i, '');
}

export function getProviderEndpoint(provider) {
  if (!provider) return null;
  if (provider.type === 'chatgpt') return '/chatgpt/' + encodeURIComponent(provider.id);
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

export function listEmbeddingProviders() {
  return state.providers
    .filter(p => p.enabled !== false && (p.embeddingModel || '').trim())
    .map(p => ({ id: p.id, name: p.name, embeddingModel: p.embeddingModel.trim() }));
}

export const USE_PROXY = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const ALLOWED_API_DOMAINS = [
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

export function isSafeApiUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (ALLOWED_API_DOMAINS.some(d => h === d || h.endsWith('.' + d))) return true;
    return state.providers.some(p => {
      if (p.type !== 'openai-compat' || !p.serverUrl) return false;
      try { return new URL(p.serverUrl).hostname === h; } catch { return false; }
    });
  } catch { return false; }
}

export function _isLanConfirmedUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return state.providers.some(p => p.type === 'openai-compat' && p.netConfirmed && p.netConfirmedHost === h);
  } catch { return false; }
}

export function proxyUrl(url, allowProviderEditorUrl = false, lanConfirmed = false) {
  if (/^\/chatgpt\/[A-Za-z0-9_-]+\/(?:models|chat\/completions)$/.test(url)) return url;
  // A provider being created isn't in `providers` yet, so the allow-list
  // can't know its host; this lets "discover/test" validate before saving.
  const validEditorUrl = allowProviderEditorUrl && (() => {
    try { return /^https?:$/i.test(new URL(url).protocol); } catch { return false; }
  })();
  if (!isSafeApiUrl(url) && !validEditorUrl) { console.error('[Security] Blocked:', url); throw new Error(t('js.apiDomainBlocked')); }
  if (!USE_PROXY) return url;
  let out = '/proxy/' + url;
  // Marker lives on the *outer* proxy request's query string, not on the
  // upstream target URL - the proxy strips it again before forwarding
  // (see _proxy_request() / kic_lan_confirm in kiconnect-proxy.py).
  if (_isLanConfirmedUrl(url) || lanConfirmed) out += (url.includes('?') ? '&' : '?') + 'kic_lan_confirm=1';
  return out;
}

export function providerEditorProxyUrl(url, type) {
  if (type !== 'openai-compat' || _isLanConfirmedUrl(url)) return proxyUrl(url, true);
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return proxyUrl(url, true);
    return confirmLanAddress(host) ? proxyUrl(url, true, true) : null;
  } catch { throw new Error(t('js.invalidUrl')); }
}

export function proxyPublicUrl(url) {
  const u = new URL(url);
  if (!/^https?:$/i.test(u.protocol)) throw new Error(t('js.apiDomainBlocked'));
  return USE_PROXY ? '/proxy/' + url : url;
}

export function updateActiveProviderInfo() {
  const hint = document.getElementById('proxyHint');
  if (hint) hint.style.display = USE_PROXY ? 'none' : 'block';
  const el = document.getElementById('activeProviderInfo');
  if (!state.providers.length) { el.textContent = t('js.noProviderConfigured'); return; }
  el.innerHTML = '';
  state.providers.forEach(p => {
    const tp = PROVIDER_TYPES[p.type] || {};
    const st = providerStatus[p.id];
    let icon = '…', color = 'var(--muted)';
    if (!providerReady(p)) { icon = '○'; }
    else if (st === 'ok') { icon = '✓'; color = 'var(--green)'; }
    else if (st === 'error') { icon = '✗'; color = 'var(--red)'; }
    const line = document.createElement('span');
    line.style.color = color;
    line.textContent = `${icon} `;
    const bold = document.createElement('strong');
    bold.textContent = p.name;
    const sub = document.createElement('span');
    sub.style.cssText = 'color:var(--muted);font-size:11px;';
    sub.textContent = ` ${p.type === 'chatgpt' ? t('chatgpt.type') : (tp.label || p.type)}`;
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

export function openProviderPanel() {
  renderProviderList();
  document.getElementById('providerPanel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  document.querySelector('[data-panel="providerPanel"]')?.classList.add('active');
}

export function _placeProviderEditor(afterEl) {
  const editor = document.getElementById('providerEditor');
  const anchor = afterEl || document.getElementById('addProviderBtn');
  if (editor && anchor) anchor.insertAdjacentElement('afterend', editor);
}

export function renderProviderList() {
  const list = document.getElementById('providerList');
  const editor = document.getElementById('providerEditor');
  // The editor may currently be parked inside this list (see editProvider()).
  // Park it at its home position before clearing the list. Removing it from
  // the document makes getElementById('providerEditor') lose it, so the later
  // placement cannot restore it and every editor action fails until reload.
  const wasInList = editor && list.contains(editor);
  if (wasInList) _placeProviderEditor(null);
  list.innerHTML = '';
  if (!state.providers.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;padding:12px;';
    msg.textContent = t('js.noProviderList');
    list.appendChild(msg);
    return;
  }
  state.providers.forEach((p, idx) => {
    const ptype = PROVIDER_TYPES[p.type] || {};
    const st = providerStatus[p.id];
    const enabled = p.enabled !== false;
    let badgeCls, badgeTxt;
    if (!enabled)          { badgeCls = '';     badgeTxt = t('js.providerDisabled'); }
    else if (!providerReady(p)) { badgeCls = 'warn'; badgeTxt = p.type === 'chatgpt' ? t('chatgpt.notConnected') : t('js.noKey'); }
    else if (st === 'ok')  { badgeCls = 'ok';   badgeTxt = p.type === 'chatgpt' ? t('chatgpt.connected') : t('js.keyOk'); }
    else if (st === 'error') { badgeCls = 'warn'; badgeTxt = t('js.keyError'); }
    else                   { badgeCls = '';     badgeTxt = t('js.keyPending'); }

    const item = document.createElement('div');
    item.className = 'provider-item' + (p.type === 'chatgpt' ? ' provider-item-chatgpt' : '') + (enabled ? '' : ' disabled');
    item.draggable = true;
    item.dataset.id = p.id;
    item.addEventListener('dragstart', e => {
      e.stopPropagation();
      state._draggedProviderId = p.id;
      item.classList.add('provider-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('provider-dragging');
      document.querySelectorAll('.provider-drag-over').forEach(el => el.classList.remove('provider-drag-over'));
      state._draggedProviderId = null;
    });
    item.addEventListener('dragover', e => {
      if (!state._draggedProviderId || state._draggedProviderId === p.id) return;
      e.preventDefault();
      item.classList.add('provider-drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('provider-drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('provider-drag-over');
      if (state._draggedProviderId && state._draggedProviderId !== p.id) reorderProviderTo(state._draggedProviderId, p.id);
      state._draggedProviderId = null;
    });

    const reorderCol = document.createElement('div');
    reorderCol.className = 'provider-reorder-col';
    const upBtn = document.createElement('button');
    upBtn.className = 'icon-btn provider-reorder-btn'; upBtn.textContent = '▲'; upBtn.title = t('js.moveUp');
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveProvider(p.id, -1); });
    const downBtn = document.createElement('button');
    downBtn.className = 'icon-btn provider-reorder-btn'; downBtn.textContent = '▼'; downBtn.title = t('js.moveDown');
    downBtn.disabled = idx === state.providers.length - 1;
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveProvider(p.id, 1); });
    reorderCol.appendChild(upBtn); reorderCol.appendChild(downBtn);

    const dragHandle = document.createElement('span');
    dragHandle.className = 'provider-drag-handle';
    dragHandle.textContent = '⠿';
    dragHandle.title = t('js.dragToReorder');

    const info = document.createElement('div');
    info.className = 'provider-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'provider-item-name';
    nameEl.textContent = p.name;
    const descEl = document.createElement('div');
    descEl.className = 'provider-item-desc';
    descEl.textContent = (p.type === 'chatgpt' ? t('chatgpt.type') : (ptype.label || p.type))
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
    const row = state.editingProviderId && list.querySelector(`.provider-item[data-id="${CSS.escape(state.editingProviderId)}"]`);
    // Row still exists (normal re-render while editing) -> put the editor
    // right back next to it. Row is gone (e.g. it got deleted elsewhere) ->
    // fall back to the editor's home position instead of leaving it orphaned.
    _placeProviderEditor(row || null);
  }
}

export function toggleProviderEnabled(id) {
  const p = state.providers.find(x => x.id === id); if (!p) return;
  p.enabled = p.enabled === false ? true : false;
  save(); renderProviderList(); fetchModels();
}

export function startNewProvider() {
  stopChatgptPolling();
  state.editingProviderId = null;
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

export function _showProviderEditor() {
  const editor = document.getElementById('providerEditor');
  editor.style.display = 'block';
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function editProvider(id) {
  stopChatgptPolling();
  const p = state.providers.find(x => x.id === id); if (!p) return;
  state.editingProviderId = id;
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

export function selectProviderType(type) {
  stopChatgptPolling();
  document.getElementById('pvApiKeyGroup').style.display = type === 'chatgpt' ? 'none' : 'block';
  document.getElementById('pvEmbedGroup').style.display = type === 'chatgpt' ? 'none' : 'block';
  document.getElementById('pvChatgptGroup').style.display = type === 'chatgpt' ? 'block' : 'none';
  if (type === 'chatgpt') {
    const provider = state.providers.find(p => p.id === state.editingProviderId);
    setChatgptMessage(document.getElementById('pvChatgptStatus'), provider?.chatgptConnected ? { key: 'chatgpt.connectedAs', vars: { name: provider.chatgptEmail || provider.name } } : 'chatgpt.saveFirst');
    document.getElementById('pvChatgptLogin').onclick = loginChatgpt;
    document.getElementById('pvChatgptLogout').onclick = logoutChatgpt;
    document.getElementById('pvChatgptLogout').disabled = !provider?.chatgptConnected;
    document.getElementById('pvChatgptModels').onclick = inspectChatgptModels;
    chatgptCatalogReport = null;
    document.getElementById('pvChatgptModelReport').hidden = true;
    document.getElementById('pvChatgptModelReport').textContent = '';
    delete document.getElementById('pvChatgptModelReport').dataset.i18n;
    delete document.getElementById('pvChatgptModelReport').dataset.i18nVars;
  }
  document.querySelectorAll('.type-chip').forEach(el => el.classList.toggle('selected', el.dataset.type === type));
  document.getElementById('pvServerUrlGroup').style.display = (type === 'openai-compat') ? 'block' : 'none';
  // kiconnect-nrw uses a fixed URL – no manual input needed
  const hint = document.getElementById('pvProviderHint');
  if (hint) {
    const hintText = PROVIDER_HINTS[type];
    if (hintText) { if (type === 'chatgpt') setChatgptMessage(hint, 'chatgpt.hint'); else { delete hint.dataset.i18n; delete hint.dataset.i18nVars; hint.textContent = hintText; } hint.style.display = 'block'; }
    else hint.style.display = 'none';
  }
}

export function getSelectedProviderType() { return document.querySelector('.type-chip.selected')?.dataset.type || 'openai-compat'; }

export function confirmLanAddress(hostname) {
  const msg1 = tf('js.lanConfirm1', { host: hostname }) ||
    `⚠️ "${hostname}" is not localhost - it looks like an address on your local network (or beyond).\n\nThis app will be allowed to send requests to that address. Only continue if you set this up yourself and trust it.\n\nContinue?`;
  if (!confirm(msg1)) return false;
  const msg2 = tf('js.lanConfirm2', { host: hostname }) ||
    `Please confirm once more: allow network access to "${hostname}"?\n\nYou can revoke this later by editing or deleting the provider.`;
  if (!confirm(msg2)) return false;
  return true;
}

export async function saveProviderEditor() {
  const name = document.getElementById('pvNameInput').value.trim();
  if (!name) { toast(t('js.nameRequired')); return; }
  const type = getSelectedProviderType();
  const serverUrl = normalizeOpenAIBaseUrl(document.getElementById('pvServerUrl').value);
  if (type === 'openai-compat' && !serverUrl) { toast(t('js.urlRequired')); return; }
  const apiKey = type === 'chatgpt' ? '' : document.getElementById('pvApiKey').value.trim();

  // Non-localhost server URLs need an explicit, double-confirmed opt-in,
  // or the proxy won't forward requests. Skipped only if this exact host
  // was already confirmed for this provider.
  let netConfirmed = false, netConfirmedHost = '';
  if (type === 'openai-compat' && serverUrl) {
    let hostname = '';
    try { hostname = new URL(serverUrl).hostname.toLowerCase(); }
    catch { toast(t('js.invalidUrl')); return; }
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (!isLocal) {
      const existing = state.editingProviderId ? state.providers.find(p => p.id === state.editingProviderId) : null;
      const alreadyConfirmed = !!(existing && existing.netConfirmed && existing.netConfirmedHost === hostname);
      if (!alreadyConfirmed && !confirmLanAddress(hostname)) {
        toast(t('js.lanConfirmCancelled'));
        return;
      }
      netConfirmed = true; netConfirmedHost = hostname;
    }
  }

  const embeddingModel = type === 'chatgpt' ? '' : document.getElementById('pvEmbedModel').value.trim();
  const data = { name, type, serverUrl: type==='openai-compat'?serverUrl:'', apiKey, embeddingModel, netConfirmed, netConfirmedHost };
  if (state.editingProviderId) {
    const idx = state.providers.findIndex(p => p.id === state.editingProviderId);
    if (idx !== -1) state.providers[idx] = {...state.providers[idx], ...data};
  } else {
    state.providers.push({ id: Date.now().toString(), ...data });
  }
  await save(); renderProviderList(); updateActiveProviderInfo();
  document.getElementById('providerEditor').style.display = 'none';
  fetchModels(); toast(t('js.providerSaved'));
  if (state._tourActive && TOUR_STEPS[state._tourStepIndex]?.target === '#saveProviderBtn') {
    setTimeout(nextTourStep, 250);
  }
}

export function cancelProviderEditor() { stopChatgptPolling(); document.getElementById('providerEditor').style.display = 'none'; }

export async function deleteProvider(id) {
  const provider = state.providers.find(p => p.id === id);
  if (provider?.type === 'chatgpt') {
    abortChatgptRuns(id);
    try {
      const data = await chatgptRequest(id, 'logout', 'POST');
      if (!data.revocation_confirmed) chatgptToast('chatgpt.revoke');
    } catch (error) { chatgptToast(error); return; }
  }
  stopChatgptPolling();
  state.providers = state.providers.filter(p => p.id !== id);
  delete _modelGroupsCache[id];
  save(); renderProviderList(); fetchModels();
}

let chatgptPollTimer = null;
let chatgptPollGeneration = 0;
let chatgptCatalogReport = null;

function renderChatgptCatalogReport() {
  const report = document.getElementById('pvChatgptModelReport');
  const result = chatgptCatalogReport;
  if (!report || report.hidden || !result) return;
  delete report.dataset.i18n; delete report.dataset.i18nVars;
  const listed = result.catalog.filter(model => model.visibility === 'list').length;
  report.textContent = [
    tf('chatgpt.catalog', { date: new Date(result.fetched_at * 1000).toLocaleString(state.currentLang) }),
    tf('chatgpt.counts', { total: result.catalog.length, listed, hidden: result.catalog.length - listed }),
    '',
    ...result.catalog.map(model => `${model.label} (${model.id}) — ${model.visibility === 'list' ? t('chatgpt.listed') : tf('chatgpt.hidden', { visibility: model.visibility || t('chatgpt.unspecified') })}`),
  ].join('\n');
}

onLanguageChange(() => {
  renderChatgptCatalogReport();
  updateThinkingUI();
  updateModelMaxInfo();
  if (state._agentSessionToken) {
    state.providers.filter(provider => provider.type === 'chatgpt').forEach(provider => {
      // Also update standalone OAuth windows opened on the other loopback origin.
      chatgptRequest(provider.id, 'status').catch(() => {});
    });
  }
});
function stopChatgptPolling() {
  chatgptPollGeneration++;
  if (chatgptPollTimer) clearTimeout(chatgptPollTimer);
  chatgptPollTimer = null;
}
onSessionLock(stopChatgptPolling);

function abortChatgptRuns(id) {
  clearProviderPdfConsent(id);
  activeRuns.forEach(run => {
    if (run.provider === 'chatgpt' && (run.model || '').startsWith(id + '::')) run.abortController?.abort();
  });
}

async function loginChatgpt() {
  const status = document.getElementById('pvChatgptStatus');
  const button = document.getElementById('pvChatgptLogin');
  if (button.disabled) return;
  button.disabled = true;
  setChatgptMessage(status, 'chatgpt.preparing');
  try {
    if (!document.getElementById('pvNameInput').value.trim()) document.getElementById('pvNameInput').value = 'ChatGPT';
    if (state.editingProviderId) {
      const id = state.editingProviderId;
      await saveProviderEditor();
      editProvider(id);
    } else {
      // Save a real provider first, so the OAuth registration has a stable owner.
      const before = new Set(state.providers.map(p => p.id));
      await saveProviderEditor();
      const created = state.providers.find(p => !before.has(p.id));
      if (!created) throw createChatgptError('chatgpt.saveFailed');
      editProvider(created.id);
    }
    const id = state.editingProviderId;
    stopChatgptPolling();
    const generation = chatgptPollGeneration;
    setChatgptMessage(status, 'chatgpt.preparing');
    const data = await chatgptRequest(id, 'login', 'POST');
    if (generation !== chatgptPollGeneration) return;
    const url = new URL(data.url);
    if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize') {
      throw createChatgptError('chatgpt.loginUrl');
    }
    // Open only a real authorization URL. Keep a clickable fallback because
    // browsers may block a new tab after asynchronous preparation.
    const link = document.createElement('a');
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.dataset.i18n = 'chatgpt.openLogin';
    link.textContent = t('chatgpt.openLogin');
    delete status.dataset.i18n; delete status.dataset.i18nVars;
    const browserHint = document.createElement('span');
    browserHint.dataset.i18n = 'chatgpt.browserFinish'; browserHint.textContent = t('chatgpt.browserFinish');
    status.replaceChildren(link, document.createTextNode(' · '), browserHint);
    window.open(url.href, '_blank', 'noopener,noreferrer');
    const deadline = Date.now() + 600000;
    async function poll() {
      if (generation !== chatgptPollGeneration) return;
      if (Date.now() > deadline) { setChatgptMessage(status, 'chatgpt.expired'); return; }
      try {
        const result = await chatgptRequest(id, 'status');
        if (generation !== chatgptPollGeneration) return;
        if (result.error) { setChatgptMessage(status, result.error); return; }
        if (!result.pending && result.connection?.connected && result.connection.plan_enabled) {
          const provider = state.providers.find(p => p.id === id);
          if (!provider) return;
          provider.chatgptConnected = true;
          provider.chatgptEmail = result.connection.email || '';
          await save();
          setChatgptMessage(status, { key: 'chatgpt.connectedAs', vars: { name: provider.chatgptEmail || provider.name } });
          document.getElementById('pvChatgptLogout').disabled = false;
          await fetchModels();
          return;
        }
        if (!result.pending) { setChatgptMessage(status, 'chatgpt.ended'); return; }
      } catch (error) { setChatgptMessage(status, error); return; }
      chatgptPollTimer = setTimeout(poll, 1500);
    }
    chatgptPollTimer = setTimeout(poll, 1000);
  } catch (error) { setChatgptMessage(status, error); chatgptToast(error); }
  finally { button.disabled = false; }
}

async function inspectChatgptModels() {
  const id = state.editingProviderId;
  const report = document.getElementById('pvChatgptModelReport');
  const button = document.getElementById('pvChatgptModels');
  chatgptCatalogReport = null;
  report.hidden = false;
  if (!id) { setChatgptMessage(report, 'chatgpt.saveFirst'); return; }
  button.disabled = true;
  setChatgptMessage(report, 'chatgpt.loadingModels');
  try {
    const result = await chatgptRequest(id, 'models');
    if (!Array.isArray(result.catalog)) {
      setChatgptMessage(report, 'chatgpt.restartModels');
      return;
    }
    chatgptCatalogReport = result;
    renderChatgptCatalogReport();
    await fetchModels();
  } catch (error) { chatgptCatalogReport = null; setChatgptMessage(report, error); }
  finally { button.disabled = false; }
}

async function logoutChatgpt() {
  const id = state.editingProviderId;
  if (!id) {
    setChatgptMessage(document.getElementById('pvChatgptStatus'), 'chatgpt.noConnection');
    return;
  }
  stopChatgptPolling();
  abortChatgptRuns(id);
  try {
    const data = await chatgptRequest(id, 'logout', 'POST');
    const provider = state.providers.find(p => p.id === id);
    if (provider) { provider.chatgptConnected = false; provider.chatgptEmail = ''; }
    delete _modelGroupsCache[id];
    await save(); await fetchModels();
    setChatgptMessage(document.getElementById('pvChatgptStatus'), data.revocation_confirmed ? 'chatgpt.loggedOut' : 'chatgpt.revoke');
    document.getElementById('pvChatgptLogout').disabled = true;
  } catch (error) { chatgptToast(error); }
}

export function moveProvider(id, dir) {
  const idx = state.providers.findIndex(p => p.id === id);
  if (idx === -1) return;
  const target = idx + dir;
  if (target < 0 || target >= state.providers.length) return;
  const [item] = state.providers.splice(idx, 1);
  state.providers.splice(target, 0, item);
  save(); renderProviderList();
}

export function reorderProviderTo(draggedId, targetId) {
  if (draggedId === targetId) return;
  const fromIdx = state.providers.findIndex(p => p.id === draggedId);
  const toIdx = state.providers.findIndex(p => p.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [item] = state.providers.splice(fromIdx, 1);
  state.providers.splice(toIdx, 0, item);
  save(); renderProviderList();
}

export function ttsProviderNeedsKey(p) { return p === 'openai' || p === 'elevenlabs' || p === 'groq' || p === 'gemini' || p === 'gcloud'; }

export function sttProviderNeedsKey(p) { return p === 'groq' || p === 'gemini'; }

export const AUDIO_PROVIDER_KEY_INFO = {
  openai:     { label: () => ta('audio.ttsKeyLabelOpenAI'),     hint: () => ta('audio.ttsHintOpenAI'),     ph: 'sk-...' },
  elevenlabs: { label: () => ta('audio.ttsKeyLabelElevenLabs'), hint: () => ta('audio.ttsHintElevenLabs'), ph: 'el_...' },
  groq:       { label: () => ta('audio.ttsKeyLabelGroq'),       hint: () => ta('audio.ttsHintGroq'),       ph: 'gsk_...' },
  gemini:     { label: () => ta('audio.ttsKeyLabelGemini'), hint: () => ta('audio.ttsHintGemini'), ph: 'AIza...' },
  gcloud:     { label: () => ta('audio.ttsKeyLabelGcloud'), hint: () => ta('audio.ttsHintGcloud'), ph: 'AIza...' },
};

export const AUDIO_STT_PROVIDER_KEY_INFO = {
  groq:   { label: () => ta('audio.sttKeyLabelGroq'),   hint: () => ta('audio.sttHintGroq'),   ph: 'gsk_...' },
  gemini: { label: () => ta('audio.sttKeyLabelGemini'), hint: () => ta('audio.sttHintGemini'), ph: 'AIza...' },
};

export function updateAudioProviderKeyUI() {
  state.config.audioProviders = state.config.audioProviders || {};

  // TTS
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
      if (ttsInput) ttsInput.value = state.config.audioProviders[ttsProvider]?.apiKey || '';
    }
  }
  if (voiceIdGroup) {
    voiceIdGroup.style.display = ttsProvider === 'elevenlabs' ? 'block' : 'none';
    if (voiceIdInput && ttsProvider === 'elevenlabs') voiceIdInput.value = state.config.audioProviders.elevenlabs?.voiceId || '';
  }

  // STT
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
      if (sttInput) sttInput.value = state.config.audioProviders[sttProvider]?.apiKey || '';
    }
  }
}
