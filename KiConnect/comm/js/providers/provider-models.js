// js/providers/provider-models.js — extracted from kiconnect.js (Phase 4 of the v3.5.1→v4.0.0 modularization)
import { _saveOrCache, save } from '../auth/storage.js';
import { renderAttachments } from '../chat/chat-attachments.js';
import { escHtml } from '../chat/chat-render.js';
import { t, tf } from '../core/i18n.js';
import { state } from '../core/state.js';
import { getProviderEndpoint, getSelectedProviderType, normalizeOpenAIBaseUrl, providerEditorProxyUrl, proxyUrl, renderProviderList, updateActiveProviderInfo } from './provider-crud.js';
import { setStatus, toast } from '../ui/misc-ui.js';
import { activeProfile } from '../ui/profiles.js';

export const THINKING_MODELS = new Set([
  'o1','o1-mini','o1-pro','o3','o3-mini','o4-mini','o4-mini-high',
  'gpt-4.5-preview','gpt-4.1','gpt-4.1-mini',
]);

export const KNOWN_MODELS = {
  // ── Anthropic ── retired models removed below (calls to those IDs now error).
  'claude-fable-5':             { label:'Claude Fable 5 (top capability)', maxOutput:128000, vision:true  },
  'claude-opus-4-8':            { label:'Claude Opus 4.8',           maxOutput:128000, vision:true  },
  'claude-sonnet-5':            { label:'Claude Sonnet 5',           maxOutput:128000, vision:true  },
  'claude-haiku-4-5-20251001':  { label:'Claude Haiku 4.5',          maxOutput:64000,  vision:true  },
  'claude-opus-4-6':            { label:'Claude Opus 4.6 (legacy)',  maxOutput:32000,  vision:true  },
  'claude-sonnet-4-6':          { label:'Claude Sonnet 4.6 (legacy)',maxOutput:64000,  vision:true  },

  // ── OpenAI ── o1/o3/o4-mini and GPT-4 lines retired; current line is GPT-5.3/5.4/5.5.
  'gpt-5.5':                    { label:'GPT-5.5',                   maxOutput:128000, vision:true  },
  'gpt-5.4':                    { label:'GPT-5.4 (Thinking)',        maxOutput:128000, vision:true  },
  'gpt-5.4-mini':                { label:'GPT-5.4 mini',              maxOutput:128000, vision:true  },
  'gpt-5.3-codex':              { label:'GPT-5.3 Codex',             maxOutput:128000, vision:true  },

  // ── Mistral ── '-latest' aliases auto-resolve to the current generation (no update needed here).
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

  // ── xAI ── Grok 4.5 is the current flagship; verify context size at console.x.ai.
  'grok-4.5':                   { label:'Grok 4.5',                  maxOutput:128000, vision:true  },
  'grok-4':                     { label:'Grok 4',                    maxOutput:128000, vision:true  },

  // ── Groq ── older models (mixtral-8x7b, llama3-70b-8192) deprecated; kept what's still served.
  'llama-3.3-70b-versatile':    { label:'Llama 3.3 70B',             maxOutput:32768,  vision:false },
  'llama-3.1-8b-instant':       { label:'Llama 3.1 8B',              maxOutput:8000,   vision:false },
  'openai/gpt-oss-120b':        { label:'GPT-OSS 120B (via Groq)',   maxOutput:32768,  vision:false },

  // ── DeepSeek ── deepseek-chat/-reasoner retire 2026-07-24, migrate configs to v4 IDs directly.
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

export const CLAUDE_MODELS  = Object.entries(KNOWN_MODELS).filter(([id])=>id.startsWith('claude')).map(([id,m])=>({id,...m}));

export const OPENAI_MODELS  = Object.entries(KNOWN_MODELS).filter(([id])=>id.startsWith('gpt')||id.startsWith('o')).map(([id,m])=>({id,...m}));

export function _saveAnthropicCaps() {
  try { localStorage.setItem('kic_anthropic_model_caps', JSON.stringify(state._anthropicModelCaps)); } catch(e) {}
}

export const CLAUDE_NO_THINKING_RE = /^claude-(instant|2(\.\d+)?(-|$)|3-(opus|sonnet|haiku)(-|$)|3-5-(sonnet|haiku))/i;

export const CLAUDE_LEGACY_THINKING_RE = /^claude-3-7-sonnet/i;

export function _isModernClaudeGen(bare) {
  return /^claude-/i.test(bare) && !CLAUDE_NO_THINKING_RE.test(bare) && !CLAUDE_LEGACY_THINKING_RE.test(bare);
}

export function isAdaptiveThinkingModel(modelId) {
  if (!modelId) return false;
  const bare = modelId.split('/').pop();
  if (state._anthropicModelCaps[bare]?.adaptiveThinking != null) return state._anthropicModelCaps[bare].adaptiveThinking;
  // Regex fallback: Claude 4+ (any family, any version number) uses adaptive;
  // Claude 3.7 Sonnet and earlier use the legacy budget_tokens format.
  return _isModernClaudeGen(bare);
}

export function isTemperatureSupported(modelId) {
  if (!modelId) return true;
  const bare = modelId.split('/').pop();
  if (state._anthropicModelCaps[bare]?.noTemperature != null) return !state._anthropicModelCaps[bare].noTemperature;
  // All current Claude 4+ models drop temperature support
  return !_isModernClaudeGen(bare);
}

export function getModelDefaultMax(modelId) {
  if (!modelId) return 8096;
  const known = KNOWN_MODELS[modelId];
  if (known) return known.maxOutput;
  const orMeta = state._orModelMeta[modelId];
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

export function getModelMaxOutput(modelId) {
  if (!modelId) return 8096;
  const override = state.config.userModelMaxOverrides?.[modelId];
  if (override && override > 0) return override;
  return getModelDefaultMax(modelId);
}

export function splitModelId(fullId) {
  if (!fullId) return { providerId: null, modelId: '' };
  const sep = fullId.indexOf('::');
  if (sep === -1) return { providerId: null, modelId: fullId };
  return { providerId: fullId.slice(0, sep), modelId: fullId.slice(sep + 2) };
}

export function makeModelId(providerId, modelId) { return `${providerId}::${modelId}`; }

export function providerForModel(fullModelId) {
  const { providerId } = splitModelId(fullModelId);
  return state.providers.find(p => p.id === providerId) || null;
}

export function effectiveMaxTokens() {
  const profile = activeProfile();
  const { modelId } = splitModelId(state.config.model);
  const modelMax = getModelMaxOutput(modelId);
  if (profile && !profile.useModelMax && profile.maxTokens) return Math.min(profile.maxTokens, modelMax);
  return modelMax;
}

export function resetEmbedModelPicker() {
  const select = document.getElementById('pvEmbedModelSelect');
  const input = document.getElementById('pvEmbedModel');
  if (select) { select.innerHTML = ''; select.style.display = 'none'; }
  if (input) input.style.display = '';
}

export async function loadEmbeddingModelCandidates() {
  const type = getSelectedProviderType();
  if (type === 'anthropic') { toast(t('js.noEmbeddingsForProvider')); return; }
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
      toast(t('js.noEmbeddingModelsFound'));
      return;
    }
    const select = document.getElementById('pvEmbedModelSelect');
    const input = document.getElementById('pvEmbedModel');
    const likely = candidates.filter(c => c.likelyEmbedding);
    const other = candidates.filter(c => !c.likelyEmbedding);
    const current = input.value.trim();
    // If we have at least one recognized embedding model, keep the picker to
    // just those by default; "Show other models" reveals the rest on demand.
    const showAllByDefault = likely.length === 0 || other.some(c => c.id === current);
    const renderOptions = includeOther => {
      select.innerHTML = '';
      const ph = document.createElement('option'); ph.value = ''; ph.textContent = t('js.selectModel');
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
      customOpt.textContent = t('js.enterManually');
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

export async function testEmbeddingModel() {
  const type = getSelectedProviderType();
  if (type === 'anthropic') { toast(t('js.noEmbeddingsForProvider')); return; }
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

export function onEmbedModelSelectChange() {
  const select = document.getElementById('pvEmbedModelSelect');
  const input = document.getElementById('pvEmbedModel');
  if (select.value === '__custom__') {
    select.style.display = 'none'; input.style.display = ''; input.value = ''; input.focus();
  } else if (select.value) {
    input.value = select.value;
  }
}

export function updatePeMaxTokensUI() {
  const fullId = state.config.model;
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

export let providerStatus = {};

export let _modelGroupsCache = {};

export async function fetchModels() {
  if (!state.providers.length) { setStatus('yellow'); return; }
  let allGroups = [], anyOk = false, anyError = false;
  for (const provider of state.providers) {
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

        // Populate capabilities cache from live API metadata
        let capsUpdated = false;
        liveModels.forEach(m => {
          if (!m.id) return;
          const caps = m.capabilities || {};
          const adaptiveThinking = caps.adaptive_thinking != null
            ? !!caps.adaptive_thinking
            : _isModernClaudeGen(m.id);
          const noTemperature = caps.temperature === false
            || (caps.temperature == null && adaptiveThinking);
          const prev = state._anthropicModelCaps[m.id];
          if (!prev || prev.adaptiveThinking !== adaptiveThinking || prev.noTemperature !== noTemperature) {
            state._anthropicModelCaps[m.id] = { adaptiveThinking, noTemperature };
            capsUpdated = true;
          }
        });
        if (capsUpdated) _saveAnthropicCaps();

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
                state._orModelMeta[m.id] = { maxOutput: maxOut || 0, contextLength: ctxLen };
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

export function applyModelGroupsToUI(allGroups) {
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
    el.value = state.config.model || '';
  });
  const sel = document.getElementById('modelSelector');
  if (sel && !sel.value && allGroups[0]?.models[0]) {
    // The previously selected model isn't in the list anymore (e.g. its
    // provider was just disabled/deleted) — fall back to the first
    // available one so normal chatting keeps working immediately.
    state.config.model = allGroups[0].models[0].fullId;
    sel.value = state.config.model;
    const mi = document.getElementById('modelInput'); if (mi) mi.value = state.config.model;
    save();
  }
  if (sel) {
    sel.onchange = () => {
      state.config.model = sel.value;
      const mi = document.getElementById('modelInput'); if (mi) mi.value = state.config.model;
      updateModelMaxInfo(); updateThinkingUI(); save(); renderAttachments();
      if (window.syncCustomDropdown) syncCustomDropdown();
    };
  }
  updateModelMaxInfo(); syncAllModelSelects(); updateThinkingUI();
  if (window.buildCustomDropdownData) buildCustomDropdownData();
}

export function rebuildModelDropdownFromCache() {
  const allGroups = [];
  state.providers.forEach(provider => {
    if (provider.enabled === false || !provider.apiKey) return;
    const cached = _modelGroupsCache[provider.id];
    if (cached && cached.models.length) {
      allGroups.push({ providerId: provider.id, providerName: provider.name, models: cached.models });
    }
  });
  applyModelGroupsToUI(allGroups);
}

export function updateModelMaxInfo() {
  const { modelId } = splitModelId(state.config.model);
  const max = getModelMaxOutput(modelId);
  const el = document.getElementById('modelMaxInfo');
  if (el) el.textContent = modelId ? tf('js.modelMax', {n: max.toLocaleString()}) : '';
}

export function isThinkingCapable(modelId) {
  if (!modelId) return false;
  const bare = modelId.split('/').pop().toLowerCase();
  return THINKING_MODELS.has(modelId) || THINKING_MODELS.has(bare) ||
    /^o\d/.test(bare) || /^(chatgpt-)?gpt-5/.test(bare) || isAnthropicThinkingModel(bare) ||
    isGeminiThinkingModel(bare) || isMiniMaxThinkingModel(bare) || isMistralThinkingModel(bare) ||
    /thinking|reason/i.test(bare) || /deepseek-r|deepseek-v4|qwen.*think|qwq|llama.*reason/i.test(bare) ||
    /^glm-(5|4\.[567])/i.test(bare);
}

export function isGeminiThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop().toLowerCase();
  if (/gemini.*thinking/.test(bare)) return true;
  const m = /^gemini-(\d+(?:\.\d+)?)/.exec(bare);
  if (!m) return false;
  return parseFloat(m[1]) >= 2.5; // 2.5+ generations ship with thinking on by default
}

export function isMiniMaxThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop().toLowerCase();
  return /^minimax-(m\d|text-)/.test(bare) || /^minimaxai\/minimax-m\d/.test(bare);
}

export function isMistralNativeThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop().toLowerCase();
  // magistral-small-latest now resolves to Mistral Small 4 (adjustable, see
  // below) rather than the original Magistral Small — only magistral-medium
  // and dated magistral-small-YYMM snapshots are still "always reasons".
  return /^magistral-medium(-latest)?$/.test(bare) || /^magistral-small-\d+$/.test(bare);
}

export function isMistralAdjustableThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop().toLowerCase();
  return /^mistral-small(-latest)?$/.test(bare) || /^mistral-medium(-3-5|-latest)?$/.test(bare) || /^magistral-small-latest$/.test(bare);
}

export function isMistralThinkingModel(modelId) {
  return isMistralNativeThinkingModel(modelId) || isMistralAdjustableThinkingModel(modelId);
}

export function isFixedThinkingModel(modelId) {
  return isMiniMaxThinkingModel(modelId) || isMistralNativeThinkingModel(modelId);
}

export function isAnthropicThinkingModel(modelId) {
  const bare = (modelId || '').split('/').pop();
  return /^claude-/i.test(bare) && !CLAUDE_NO_THINKING_RE.test(bare);
}

export function usesTokenBudget(modelId) {
  const bare = (modelId || '').split('/').pop();
  return CLAUDE_LEGACY_THINKING_RE.test(bare);
}

export function updateThinkingUI() {
  const { modelId } = splitModelId(state.config.model);
  const capable = isThinkingCapable(modelId);
  const group = document.getElementById('thinkingGroup');
  if (group) group.style.display = capable ? 'flex' : 'none';
  if (!capable && state.config.thinkingEnabled) {
    state.config.thinkingEnabled = false;
    document.getElementById('thinkingToggle')?.classList.remove('active');
    document.getElementById('thinkingIntensity')?.classList.remove('visible');
  }
  configureThinkingSlider(modelId);
  updateThinkingIntensityUI();
}

export function configureThinkingSlider(modelId) {
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
    slider.value = String(state.config.thinkingBudget || 8000);
    if (label) label.textContent = t('thinking.budget');
  } else {
    // Claude 4+ (adaptive) or non-Anthropic thinking models: 3-level effort slider
    slider.min='1'; slider.max='3'; slider.step='1';
    slider.value = String(state.config.thinkingIntensity || 2);
    if (label) label.textContent = t('thinking.intensity');
  }
}

export function updateThinkingIntensityUI() {
  const slider = document.getElementById('thinkingIntensitySlider');
  const label  = document.getElementById('thinkingIntensityVal');
  if (!slider || !label) return;
  const { modelId } = splitModelId(state.config.model);
  if (isFixedThinkingModel(modelId)) return;
  // Legacy Claude 3.7: show token budget (e.g. "8k tok")
  if (usesTokenBudget(modelId) && !isAdaptiveThinkingModel(modelId)) {
    const budget = state.config.thinkingBudget || 8000;
    label.textContent = budget >= 1000 ? (budget/1000).toFixed(1).replace('.0','')+'k tok' : budget+' tok';
  } else {
    // Claude 4+ adaptive and all other thinking models: show translated effort label
    const val = state.config.thinkingIntensity || 2;
    const ikeys = { 1:'thinking.low', 2:'thinking.medium', 3:'thinking.high' };
    label.textContent = t(ikeys[val]);
  }
}

export function toggleThinking() {
  const { modelId } = splitModelId(state.config.model);
  if (!isThinkingCapable(modelId)) return;
  state.config.thinkingEnabled = !state.config.thinkingEnabled;
  document.getElementById('thinkingToggle')?.classList.toggle('active', state.config.thinkingEnabled);
  document.getElementById('thinkingIntensity')?.classList.toggle('visible', state.config.thinkingEnabled);
  save();
  toast(state.config.thinkingEnabled ? t('js.thinkingEnabled') : t('js.thinkingDisabled'));
}

export function syncAllModelSelects() {}

export function _stripStoredThinking(storedText) {
  const m = /^<thinking>\n[\s\S]*?\n<\/thinking>\n\n([\s\S]*)$/.exec(storedText || '');
  return m ? m[1] : (storedText || '');
}

export const AGENTIC_WEB_TOOLS_ANTHROPIC = [
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

export const AGENTIC_WEB_TOOLS_OPENAI = AGENTIC_WEB_TOOLS_ANTHROPIC.map(tl => ({
  type: 'function', function: { name: tl.name, description: tl.description, parameters: tl.input_schema },
}));

export async function callModelForAgenticWebTurn(msgs, provider, modelId) {
  // modelId is optional so the two pre-existing single-model callers (which
  // only ever meant "whatever's selected in the composer") keep working
  // unchanged; Battle-Modus passes each variant's own model explicitly so
  // every model in the comparison actually searches with itself, not with
  // whatever happens to be selected in the composer.
  modelId = modelId || splitModelId(state.config.model).modelId;
  if (provider.type === 'anthropic') {
    const body = { model: modelId, max_tokens: effectiveMaxTokens(), messages: msgs, tools: AGENTIC_WEB_TOOLS_ANTHROPIC, tool_choice: { type: 'auto' } };
    if (isTemperatureSupported(modelId)) body.temperature = state.config.temperature;
    if (state.config.systemPrompt) body.system = state.config.systemPrompt;
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
  if (state.config.systemPrompt) apiMsgs.push({ role: 'system', content: state.config.systemPrompt });
  apiMsgs.push(...msgs);
  const isOSeries = /^o\d/.test(modelId) || /^(chatgpt-)?gpt-5/.test(modelId);
  const reqBody = { model: modelId, messages: apiMsgs, tools: AGENTIC_WEB_TOOLS_OPENAI, tool_choice: 'auto', stream: false };
  if (isOSeries) reqBody.max_completion_tokens = effectiveMaxTokens();
  else { reqBody.temperature = state.config.temperature; reqBody.max_tokens = effectiveMaxTokens(); }
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

export function modelSupportsPdfBase64(mid){return /claude|gemini|gpt-4o/i.test(mid||'');}

export function openModelMaxPanel(){renderModelMaxList();document.getElementById('modelMaxPanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="modelMaxPanel"]')?.classList.add('active');}

export function renderModelMaxList(){
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

export function setModelMax(modelId,inputEl){
  const val=parseInt(inputEl.value);const defaultMax=getModelDefaultMax(modelId);
  if(!val||val<256){inputEl.value=defaultMax;return;}
  if(!state.config.userModelMaxOverrides)state.config.userModelMaxOverrides={};
  if(val===defaultMax){delete state.config.userModelMaxOverrides[modelId];}else{state.config.userModelMaxOverrides[modelId]=val;}
  const safeId=modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row=document.getElementById('mmrow_'+safeId);if(row)row.classList.toggle('model-max-modified',val!==defaultMax);
  save();updateModelMaxInfo();toast(tf('js.limitSet',{id:modelId.split('/').pop().slice(0,20),n:val.toLocaleString()}));
}

export function resetModelMax(modelId){
  if(!state.config.userModelMaxOverrides)return;delete state.config.userModelMaxOverrides[modelId];
  const defaultMax=getModelDefaultMax(modelId);const safeId=modelId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row=document.getElementById('mmrow_'+safeId);if(row){const inp=row.querySelector('.model-max-input');if(inp)inp.value=defaultMax;row.classList.remove('model-max-modified');}
  save();updateModelMaxInfo();toast(tf('js.resetTo',{id:modelId.split('/').pop().slice(0,20),n:defaultMax.toLocaleString()}));
}

export function resetAllModelMax(){state.config.userModelMaxOverrides={};save();renderModelMaxList();updateModelMaxInfo();toast(t('js.allLimitsReset'));}
