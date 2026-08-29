import { _pullBackForOpenBlock } from '../auth/accounts.js';
import { save } from '../auth/storage.js';
import { _runStreamAndAttach, buildAttachmentContent, clearAttachments, renderAttachments } from './chat-attachments.js';
import { appendEmptyAI, appendToMessages, applySiblingVariant, buildMsgEl, buildWebSourcesRow, escHtml, formatText, parseMistralContent, removeTyping, renderMessages, safeIdx, scrollToBottom, showTyping, typesetMath, typesetMathThrottled } from './chat-render.js';
import { currentChat, getActiveContainer, getActivePath, newChat, renderSidebar } from './chat-sidebar.js';
import { autoResize } from '../core/boot.js';
import { bt, btf, t, tf } from '../core/i18n.js';
import { state } from '../core/state.js';
import { buildKbAugmentedContent, buildKbSourcesRow, kbClearActiveSelection, kbRetrieveForQuery } from '../db.js';
import { getProviderEndpoint, openProviderPanel, proxyUrl } from '../providers/provider-crud.js';
import { _stripStoredThinking, callModelForAgenticWebTurn, effectiveMaxTokens, isAdaptiveThinkingModel, isMistralAdjustableThinkingModel, isTemperatureSupported, isThinkingCapable, providerForModel, splitModelId, usesTokenBudget } from '../providers/provider-models.js';
import { getMaxImageStorageBytes, openSettings, setStatus, toast } from '../ui/misc-ui.js';
import { buildLinkedPageAugmentedContent, buildWebAugmentedContent, extractReadableHttpUrls, fetchLinkedPage, fetchLinkedPagesFromText, performWebSearch, renderDetectedLinks, shouldAutoWebSearch, shouldUseWebSearch, updateWebSearchButton, webEngineNeedsKey } from '../websearch/web-search.js';

export const activeRuns = new Map();

export function _makeRunId(chatId) {
  return `${chatId || state.currentChatId || 'x'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function _runBubbleEl(run) {
  return (run && run.bubbleEl && run.bubbleEl.isConnected) ? run.bubbleEl : null;
}

export function _updateRunText(runId, text, usageData, thinkingText) {
  const run = activeRuns.get(runId);
  if (!run) return;
  run.text = text || '';
  if (usageData !== undefined) run.usage = usageData || null;
  // Kept separate from `text` so a reattached bubble can use it directly.
  if (thinkingText !== undefined) run.thinkingText = thinkingText;
}

export function isChatStreaming(chatId) {
  if (!chatId) return false;
  for (const run of activeRuns.values()) {
    if (run.chatId === chatId && run.status === 'running') return true;
  }
  return false;
}

export function runsForChat(chatId) {
  return [...activeRuns.values()].filter(r => r.chatId === chatId && r.status === 'running');
}

export function syncComposerStreamingUI() {
  setSendMode(isChatStreaming(state.currentChatId) ? 'stop' : 'send');
}

export let AUTO_SCROLL_DURING_STREAM = false;

export const OAI_EFFORT = { 1: 'low', 2: 'medium', 3: 'high' };

export const CLAUDE_BUDGET = { 1: 2000, 2: 8000, 3: 20000 };

export function _buildLiveRunBubble(run) {
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

export function _buildBattleTileGridRow(msg, idx) {
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
    // A default winner is already active behind the scenes (see
    // _resolveBattleDefault) so the conversation can continue, but the grid
    // stays visible and this banner makes the default explicit.
    const defIdx = msg._siblingIdx ?? 0;
    const defModel = splitModelId(msg._siblings[defIdx]?._model || '').modelId || msg._siblings[defIdx]?._model || '';
    const banner = document.createElement('div');
    banner.className = 'battle-default-banner';
    banner.dataset.model = defModel;
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

export function chooseBattleWinner(idx, siblingIdx) {
  const chat = currentChat(); if (!chat) return;
  const path = getActivePath(chat);
  const msg = path[safeIdx(idx)]; if (!msg || !msg._siblings) return;
  const variant = msg._siblings[siblingIdx]; if (!variant) return;
  msg._siblingIdx = siblingIdx;
  msg._winnerChosen = true;
  applySiblingVariant(msg, variant);
  save();
  renderMessages(chat.messages);
}

export function _toAnthropicContent(content) {
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

export function _toOpenAIContent(content) {
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

export function _applyPromptCache(msgs) {
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

export function _splitStableTail(text) {
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

export const _streamStableCache = new WeakMap();

export function renderStreamingBubble(bubbleEl, thinkingText, assistantText) {
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
    // Append only the newly finished increment and typeset only the new
    // nodes — overwriting stableEl's full innerHTML would destroy every
    // already-typeset <mjx-container> and cause visible flicker.
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
    // Pass the container itself, not a snapshot of its child nodes: tailEl's
    // innerHTML is fully overwritten each chunk, so a captured node list
    // would likely already be detached by the time this fires.
    typesetMathThrottled(tailEl, 400);
  }
  // If still mid-formula, leave it as raw text rather than making MathJax
  // repeatedly choke on a half-written block; it typesets correctly once the
  // closing delimiter arrives, or at the latest at _finalizeStreamingBubble.
}

export function _finalizeStreamingBubble(bubbleEl, assistantText) {
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

export function _streamStoredText(thinkingText, assistantText) {
  return (thinkingText ? `<thinking>\n${thinkingText}\n</thinking>\n\n` : '') + (assistantText || '');
}

export function _finishLiveStreamUI() {
  document.querySelectorAll('.bubble.streaming').forEach(b => b.classList.remove('streaming'));
}

// ── Shared streaming helpers ────────────────────────────────────────────
// Parts byte-for-byte identical between _streamAIResponse (single-chat)
// and _streamBattleVariant (Battle-Modus): request-body builders, SSE
// line-chunking, fetch calls. Each caller still applies deltas to its own
// target (live bubble vs. battle-tile grid).

// Read SSE body -> yield lines, carrying partial lines across chunks.
async function* _sseLines(res) {
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) yield line;
  }
}

// Anthropic /v1/messages request body.
function _buildAnthropicBody(modelId, messages) {
  const body = { model: modelId, max_tokens: effectiveMaxTokens(), stream: true, messages };
  // temperature unsupported on Claude 4+ — omit entirely for those.
  if (isTemperatureSupported(modelId)) {
    body.temperature = state.config.temperature;
  }
  // profilesEnabled is the global Agent-Profiles/Persona master switch
  // (default off, see core/state.js). Off means the field is skipped
  // entirely rather than sent empty — saves the system-prompt tokens on
  // every single request while disabled.
  if (state.config.profilesEnabled && state.config.systemPrompt) body.system = [{ type: 'text', text: state.config.systemPrompt, cache_control: { type: 'ephemeral', ttl: '1h' } }];
  if (state.config.thinkingEnabled && isThinkingCapable(modelId)) {
    if (isAdaptiveThinkingModel(modelId)) {
      // Claude 4+: adaptive thinking via output_config.effort
      const effortMap = { 1: 'low', 2: 'medium', 3: 'high' };
      body.thinking = { type: 'adaptive' };
      body.output_config = { effort: effortMap[state.config.thinkingIntensity || 2] };
      delete body.temperature; // must not be sent for adaptive thinking
    } else {
      // Claude 3.7/3.5: enabled + budget_tokens
      const budget = usesTokenBudget(modelId) ? (state.config.thinkingBudget || 8000) : CLAUDE_BUDGET[state.config.thinkingIntensity || 2];
      body.thinking = { type: 'enabled', budget_tokens: budget };
      body.temperature = 1; // required to be exactly 1 for legacy thinking
      body.max_tokens = Math.max(body.max_tokens, budget + 2000);
    }
  }
  return body;
}

// Anthropic streaming fetch call.
function _fetchAnthropicStream(provider, body, signal) {
  return fetch(proxyUrl('https://api.anthropic.com/v1/messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      // No anthropic-beta header needed here: prompt caching is GA and
      // ttl:'1h' works without it. See kiconnect-agent.js for the agent
      // path, which still sends a beta header for context-management.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  });
}

// OpenAI-compatible `messages` array. `includeToolStuff` forwards
// tool_calls/role:'tool' entries for the agentic web-search round trip.
// Both callers need it (see CHANGELOG: "Battle-Modus agentic search 400").
function _buildOpenAiApiMessages(messages, includeToolStuff) {
  const apiMsgs = [];
  // See _buildAnthropicBody() above: same master switch, same reasoning.
  if (state.config.profilesEnabled && state.config.systemPrompt) apiMsgs.push({ role: 'system', content: state.config.systemPrompt });
  messages.forEach(m => {
    if (m.role === 'user' || m.role === 'assistant') {
      const msg = { role: m.role, content: m.content };
      if (includeToolStuff && m.tool_calls) msg.tool_calls = m.tool_calls;
      apiMsgs.push(msg);
    } else if (includeToolStuff && m.role === 'tool') {
      apiMsgs.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    }
  });
  return apiMsgs;
}

// o-series/GPT-5 use max_completion_tokens + reasoning_effort instead of
// max_tokens/temperature; identical branch in both callers.
function _applyOaiEffortAndTokens(reqBody, modelId) {
  const isOSeries = /^o\d/.test(modelId) || /^(chatgpt-)?gpt-5/.test(modelId);
  if (isOSeries) {
    reqBody.max_completion_tokens = effectiveMaxTokens();
    if (state.config.thinkingEnabled && isThinkingCapable(modelId)) reqBody.reasoning_effort = OAI_EFFORT[state.config.thinkingIntensity || 2];
  } else {
    reqBody.temperature = state.config.temperature;
    reqBody.max_tokens = effectiveMaxTokens();
    if (state.config.thinkingEnabled && isThinkingCapable(modelId)) reqBody.reasoning_effort = OAI_EFFORT[state.config.thinkingIntensity || 2];
  }
}

// zhipu Accept-Language is opt-in (single-chat only, GLM thinking support).
function _buildOpenAiExtraHeaders(provider, { zhipuAcceptLanguage = false } = {}) {
  const extraHeaders = {};
  if (provider.type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
  if (zhipuAcceptLanguage && provider.type === 'zhipu') { extraHeaders['Accept-Language'] = 'en-US,en'; }
  return extraHeaders;
}

// OpenAI-compatible streaming fetch call. Identical shape in both callers.
function _fetchOpenAiCompatStream(provider, endpoint, reqBody, extraHeaders, signal) {
  return fetch(proxyUrl(`${endpoint}/chat/completions`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders },
    body: JSON.stringify(reqBody),
    signal,
  });
}

export async function _streamAIResponse(messages, provider, typingId, documentIds, opts) {
  // opts.prefixText: pre-formed markdown/HTML (e.g. the agentic web-search
  // tool trace) seeded as already-"streamed" text before the model's own
  // live delta is appended — same trick used for the <thinking> block.
  let assistantText = (opts && opts.prefixText) ? (opts.prefixText + '\n\n') : '', usageData = null;
  // runId: caller generates and passes it via opts.runId so it's known
  // even if this function throws before returning; falls back to
  // self-generating otherwise.
  const runId = (opts && opts.runId) || _makeRunId(state.currentChatId);
  // Every run gets its own AbortController (not a shared global one), so
  // stopStreaming(chatId) cancels exactly one chat's request.
  const runAbortController = (opts && opts.abortController) || new AbortController();
  const run = {
    runId,
    chatId: state.currentChatId,      // which chat this run belongs to
    kind: 'chat',
    provider: provider && provider.type,
    model: state.config.model,        // frozen NOW, never re-read from config.model later —
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
  // Single choke point where a run becomes "visible" as in-flight — updates
  // the sidebar dot and (if on screen) the composer's send/stop button
  // before the first network await. Stays correct even if the user
  // switches chats mid-await, since syncComposerStreamingUI() reads
  // currentChatId itself.
  renderSidebar();
  syncComposerStreamingUI();

  if (provider.type === 'anthropic') {
    const { modelId } = splitModelId(state.config.model);
    const body = _buildAnthropicBody(modelId, messages);
    const res = await _fetchAnthropicStream(provider, body, run.abortController.signal);
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    removeTyping(typingId);
    const aiEl = appendEmptyAI(run.model, runId);
    run.bubbleEl = aiEl;
    let thinkingText = '', inThinkingBlock = false;
    for await (const line of _sseLines(res)) {
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
    { const liveBubble = _runBubbleEl(run); if (liveBubble) _finalizeStreamingBubble(liveBubble.querySelector('.bubble'), assistantText); }
    if (thinkingText) assistantText = `<thinking>\n${thinkingText}\n</thinking>\n\n` + assistantText;

  } else {
    const endpoint = getProviderEndpoint(provider);
    const { modelId } = splitModelId(state.config.model);
    // includeToolStuff=true: this path forwards tool_calls/role:'tool'
    // messages unchanged (agentic web-search round trip). Dropping them
    // left a dangling tool_calls message with no matching result, which
    // most OpenAI-compatible APIs reject with a 400.
    const apiMsgs = _buildOpenAiApiMessages(messages, true);
    const reqBody = { model: modelId, messages: apiMsgs, stream: true };
    // GPT-5 is a reasoning model like the o-series: rejects `temperature`
    // and `max_tokens`, requires `max_completion_tokens` — same branch as
    // o1/o3/o4.
    _applyOaiEffortAndTokens(reqBody, modelId);
    if (documentIds?.length) reqBody.documents = documentIds;
    if (provider.type !== 'zhipu') {
      reqBody.stream_options = { include_usage: true };
    }
    // GLM (z.ai) uses a different thinking shape than o-series/deepseek:
    // it sets `thinking: { type: 'enabled' }` instead of `reasoning_effort`,
    // and streams the reasoning trace via delta.reasoning_content.
    if (provider.type === 'zhipu' && isThinkingCapable(modelId)) {
      reqBody.thinking = { type: state.config.thinkingEnabled ? 'enabled' : 'disabled' };
      delete reqBody.reasoning_effort;
    }
    // MiniMax has no reasoning_effort levels (thinks by default, M2.x
    // can't disable) — send on/off `thinking.type` + `reasoning_split:
    // true`, trace returned via delta.reasoning_details.
    if (provider.type === 'minimax' && isThinkingCapable(modelId)) {
      reqBody.thinking = { type: state.config.thinkingEnabled ? 'adaptive' : 'disabled' };
      reqBody.reasoning_split = true;
      delete reqBody.reasoning_effort;
    }
    // Mistral only documents 'none'/'high' for reasoning_effort (root-level
    // field), so OAI_EFFORT's low/medium/high mapping doesn't apply. Native
    // Magistral always reasons, no parameter needed.
    if (provider.type === 'mistral') {
      if (isMistralAdjustableThinkingModel(modelId)) {
        reqBody.reasoning_effort = (state.config.thinkingEnabled && isThinkingCapable(modelId)) ? 'high' : 'none';
      } else {
        delete reqBody.reasoning_effort;
      }
    }
    const extraHeaders = _buildOpenAiExtraHeaders(provider, { zhipuAcceptLanguage: true });
    const res = await _fetchOpenAiCompatStream(provider, endpoint, reqBody, extraHeaders, run.abortController.signal);
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    removeTyping(typingId);
    const aiEl = appendEmptyAI(run.model, runId);
    run.bubbleEl = aiEl;
    let thinkingText = '';
    const isZhipu = provider.type === 'zhipu';
    const isMinimax = provider.type === 'minimax';
    const isMistral = provider.type === 'mistral' && isThinkingCapable(modelId);
    const showsThinking = isZhipu || isMinimax || isMistral;
    // MiniMax's delta.reasoning_details[].text arrives cumulative (each chunk
    // repeats everything so far), unlike GLM's incremental reasoning_content —
    // so track the previously-seen length to extract only the new suffix.
    let minimaxReasoningSeen = '';
    for await (const line of _sseLines(res)) {
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
          // of the standard field — fall back to it or savings read 0.
          usageData = { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0 };
          _updateRunText(runId, showsThinking ? _streamStoredText(thinkingText, assistantText) : assistantText, usageData, showsThinking ? thinkingText : '');
        }
      } catch {}
    }
    { const liveBubble = _runBubbleEl(run); if (liveBubble) _finalizeStreamingBubble(liveBubble.querySelector('.bubble'), assistantText); }
    if (showsThinking && thinkingText) {
      assistantText = `<thinking>\n${thinkingText}\n</thinking>\n\n` + assistantText;
    }
  }

  _finishLiveStreamUI();
  run.status = 'done';
  run.text = assistantText;
  // Return the run's CURRENT bubble (may be reattached or null if not on
  // screen), never the originally-captured node, which may be detached.
  return { text: assistantText, usage: usageData, el: run.bubbleEl, runId };
}

export function _findBattleTileBubble(battleId, siblingIdx) {
  if (!battleId) return null;
  const row = document.querySelector(`.battle-row[data-battle-id="${battleId}"]`);
  if (!row) return null;
  const tile = row.querySelector(`.battle-tile[data-sibling-idx="${siblingIdx}"]`);
  return tile ? tile.querySelector('.battle-tile-bubble') : null;
}

export function _resolveBattleDefault(chat, msg) {
  if (msg._winnerChosen) return; // user already picked explicitly
  const defIdx = (msg._battleDoneOrder && msg._battleDoneOrder.length) ? msg._battleDoneOrder[0] : 0;
  const variant = msg._siblings[defIdx] || msg._siblings[0];
  if (!variant) return;
  msg._siblingIdx = defIdx;
  msg.content   = variant.content;
  msg._model    = variant._model;
  msg._usage    = variant._usage;
}

export async function _streamBattleVariant(chat, msg, i, provider, modelId, messages, prefixText) {
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

  // Agentic web-search trace (if this variant ran one — see
  // _runBattleVariant) is seeded into the visible text up front, same as
  // the single-model path's opts.prefixText in _runStreamAndAttach.
  let assistantText = prefixText ? (prefixText + '\n\n') : '', usageData = null, thinkingText = '';
  run.text = assistantText;
  sibling.content = assistantText;
  try {
    if (provider.type === 'anthropic') {
      const body = _buildAnthropicBody(modelId, messages);
      const res = await _fetchAnthropicStream(provider, body, run.abortController.signal);
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
      let inThinkingBlock = false;
      for await (const line of _sseLines(res)) {
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
    } else {
      const endpoint = getProviderEndpoint(provider);
      // includeToolStuff=true: per-variant agentic web loop can end the
      // history on a 'tool' message the model still needs — dropping it
      // (old `false`) left providers like Mistral a 400 (msgs can't end
      // on `assistant`). No-op for non-agentic sends.
      const apiMsgs = _buildOpenAiApiMessages(messages, true);
      const reqBody = { model: modelId, messages: apiMsgs, stream: true };
      _applyOaiEffortAndTokens(reqBody, modelId);
      if (provider.type !== 'zhipu') reqBody.stream_options = { include_usage: true };
      const extraHeaders = _buildOpenAiExtraHeaders(provider);
      const res = await _fetchOpenAiCompatStream(provider, endpoint, reqBody, extraHeaders, run.abortController.signal);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      for await (const line of _sseLines(res)) {
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
    // Re-render the tile grid in place if the owning chat is still on
    // screen; otherwise it'll render correctly next time the chat is opened.
    if (chat === currentChat()) renderMessages(chat.messages);
    syncComposerStreamingUI();
  }
}

export async function _runBattleVariant(chat, msg, i, fullModelId, messages) {
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
  // Agentic web search: each model decides for itself whether/what to
  // search, so unlike manual search (shared once, see sendBattleMessage)
  // this runs per variant with that variant's own provider/modelId.
  let finalMessages = wireMessages;
  let traceHtml = '';
  if (isAgenticWebMode()) {
    try {
      const { msgs: augmented, traceHtml: trace } = await runAgenticWebToolLoop(wireMessages, provider, modelId);
      finalMessages = augmented;
      traceHtml = trace;
    } catch (err) {
      console.warn('[battle] agentic web loop failed for', modelId, err);
    }
  }
  await _streamBattleVariant(chat, msg, i, provider, modelId, finalMessages, traceHtml);
}

export async function sendBattleMessage(text, att, modelIds) {
  if (!state.currentChatId) newChat();
  const chat = currentChat(); if (!chat) return;
  if (isChatStreaming(chat.id)) return;
  if (!modelIds || modelIds.length < 2) { toast(bt('battle.needTwoModels')); return; }

  const empty = document.getElementById('emptyState');
  if (empty) empty.style.display = 'none';

  const { userContent: _uc, fileNames } = buildAttachmentContent(text, att);
  let userContent = _uc;

  // Manual web search — one shared lookup for the whole Battle-Modus
  // message (same idea as the KB block below). Agentic search is NOT
  // handled here since each model needs to decide for itself; it runs
  // per-model inside _runBattleVariant()/_streamBattleVariant().
  let webSearch = null;
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
      if ((state.config.webSearchMode || 'manual') === 'manual') state.config.webSearchEnabled = false;
      updateWebSearchButton(false);
      save();
    }
  }
  const webSourceChips = webSearch?.results || [];

  // Knowledge-base retrieval (RAG) — same hook as sendMessageCore(),
  // applied once since all Battle-Modus variants share one outgoing user
  // message. kbClearActiveSelection() at the end of this block resets the
  // composer's KB toggle afterwards.
  let kbResult = null;
  let kbWasRequested = false;
  if (text && typeof kbRetrieveForQuery === 'function') {
    kbWasRequested = true;
    try {
      kbResult = await kbRetrieveForQuery(text);
      if (kbResult?.sources?.length) {
        userContent = buildKbAugmentedContent(userContent, kbResult);
      }
    } catch (err) {
      toast(tf('kb.searchFailed', { e: err.message || err }));
      kbResult = null;
    }
  }
  const kbSourceChips = kbResult?.sources || [];

  const activeContainer = getActiveContainer(chat);
  const userMsg = {
    role: 'user', content: userContent,
    _files: fileNames.length ? fileNames : undefined,
    _webSources: webSourceChips.length ? webSourceChips : undefined,
    _kbSources: kbSourceChips.length ? kbSourceChips : undefined,
  };
  activeContainer.push(userMsg);
  if (chat.messages.length === 1) { chat.title = '…'; renderSidebar(); autoGenerateChatTitle(chat, text); }
  // A selected KB applies to the next prompt only — same contract as the
  // single-model path, and what actually clears the composer's KB toggle.
  if (kbWasRequested && typeof kbClearActiveSelection === 'function') {
    kbClearActiveSelection();
  }

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
  // still-empty battleMsg placeholder — built once, reused per-provider.
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

export var _regenerateOverride = null;

export function registerRegenerateOverride(fn) { _regenerateOverride = fn; }

export async function regenerate(...args) {
  if (_regenerateOverride) return _regenerateOverride(regenerateOriginal, ...args);
  return regenerateOriginal(...args);
}

export async function regenerateOriginal(idx) {
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
  // Render only up through the user message (idx nodes), not the assistant
  // bubble about to be regenerated — otherwise the stale old bubble stays
  // visible as a duplicate once the new one streams in. See _attachAIActions().
  renderMessages(chat.messages, idx);
  await rerunFromUserMsg(userMsg);
}

export function _pruneAfter(chat, targetMsg) {
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

export async function rerunFromUserMsg(userMsg) {
  if(!state.currentChatId) newChat();
  const chat=currentChat(); if(!chat) return;
  const provider=providerForModel(state.config.model)||state.providers[0];
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

export function handleSendStop() { isChatStreaming(state.currentChatId) ? stopStreaming(state.currentChatId) : sendMessage(); }

export function stopStreaming(chatId) {
  chatId = chatId || state.currentChatId;
  runsForChat(chatId).forEach(run => { if (run.abortController) run.abortController.abort(); });
}

export function setSendMode(mode) {
  const btn=document.getElementById('sendBtn');
  btn.classList.toggle('stop-mode', mode==='stop');
  document.getElementById('sendBtnLabel').textContent = mode==='stop' ? t('js.stop') : t('js.send');
  document.getElementById('sendIcon').style.display  = mode==='stop' ? 'none' : '';
  document.getElementById('stopIcon').style.display  = mode==='stop' ? '' : 'none';
}

export function setMiniToggle(btn, active) {
  if (!btn) return;
  btn.classList.toggle('active', !!active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

export function isAgenticWebMode() {
  return (state.config.webSearchMode || 'manual') === 'agentic';
}

// Default/fallback — actual cap is user-configurable (⚙ Settings → Web
// search → "Max. tool rounds"), stored in state.config.webSearchAgenticMaxIters.
export const AGENTIC_TOOL_MAX_ITERS = 4;

// Single source of truth for the upper bound of that setting. Drives the
// range input's `max`, the input-handler's clamp, and the runtime clamp
// below — change it here only, everything else reads from this constant.
export const AGENTIC_TOOL_MAX_ITERS_CAP = 50;

export function agenticMaxIters() {
  const v = parseInt(state.config.webSearchAgenticMaxIters, 10);
  return Number.isFinite(v) && v >= 1 ? Math.min(v, AGENTIC_TOOL_MAX_ITERS_CAP) : AGENTIC_TOOL_MAX_ITERS;
}

// Pulls the plain-text of the most recent user turn out of a wire-format
// message list (Anthropic content-block array or a plain OpenAI-style
// string), so the pre-filter below can look at it without caring which
// provider shape it's in.
function _lastUserText(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter(b => b && b.type === 'text').map(b => b.text).join(' ');
    return '';
  }
  return '';
}

// Cheap client-side pre-filter for agentic web mode: skip the extra
// tool-calling round-trip entirely (an extra model call + its tokens)
// for messages that obviously don't need a web lookup, using the same
// keyword heuristic already trusted for "auto" mode's single-shot search
// decision. Errs toward NOT skipping — no text to judge (e.g. an
// attachment-only message), or any hint of a time-/fact-sensitive
// question, and the model still gets the tools and decides for itself.
function _agenticLikelyNeedsSearch(msgs) {
  const text = _lastUserText(msgs);
  if (!text.trim()) return true;
  return shouldAutoWebSearch(text);
}

// Resets and re-applies a single cache_control breakpoint on the very last
// content block of the last message. Called before every iteration of the
// agentic tool loop (Anthropic only) since `msgs` grows by an
// assistant+tool_result pair each round — without this, only the very
// first call benefited from caching and every further iteration rebilled
// the whole (and growing) tool-result history at full price. Clearing old
// breakpoints first keeps the request under Anthropic's 4-breakpoint cap
// (this + tools + system = 3) no matter how many iterations have run.
function _applyAgenticLoopCache(msgs) {
  msgs.forEach(m => {
    if (Array.isArray(m.content)) m.content.forEach(b => { if (b && b.cache_control) delete b.cache_control; });
  });
  const last = msgs[msgs.length - 1];
  if (!last) return;
  if (typeof last.content === 'string' && last.content) {
    last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral', ttl: '1h' } }];
  } else if (Array.isArray(last.content) && last.content.length) {
    last.content[last.content.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
  }
}

export async function runAgenticWebTool(name, args) {
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

export function buildAgenticTraceHtml(calls) {
  if (!calls || !calls.length) return '';
  return calls.map(c => {
    const icon = c.name === 'fetch_url' ? '🔗' : '🌐';
    const label = c.name === 'fetch_url' ? t('agent.tool.fetchUrl') : t('agent.tool.webSearch');
    const subject = c.name === 'fetch_url' ? (c.args?.url || '') : (c.args?.query || '');
    const isError = !!(c.result && c.result.error);
    const status = isError ? `${t('agent.errorShort')}: ${c.result.error}` : t('agent.done');
    let body = '';
    if (c.name === 'web_search' && Array.isArray(c.result?.results) && c.result.results.length) {
      body = c.result.results.map(r => `- [${escHtml(r.title || r.url)}](${escHtml(r.url)})${r.snippet ? ' — ' + escHtml(r.snippet) : ''}`).join('\n');
    } else if (c.name === 'fetch_url' && c.result?.text) {
      body = escHtml(c.result.text.slice(0, 600)) + (c.result.text.length > 600 ? '…' : '');
    } else if (isError) {
      body = escHtml(c.result.error);
    }
    return `<details class="agent-trace" data-status="${isError ? 'error' : 'ok'}"><summary>${icon} <b>${escHtml(label)}</b>${subject ? ` <code>${escHtml(subject)}</code>` : ''} — <em>${escHtml(status)}</em></summary>\n\n${body || `_${t('js.empty')}_`}\n\n</details>`;
  }).join('\n\n');
}

export async function runAgenticWebToolLoop(initialMsgs, provider, modelId) {
  let msgs = initialMsgs.slice();
  const allCalls = [];
  // Skip the whole extra round-trip for messages that plainly don't need a
  // web lookup — see _agenticLikelyNeedsSearch() above.
  if (!_agenticLikelyNeedsSearch(msgs)) return { msgs, traceHtml: '' };
  const maxIters = agenticMaxIters();
  for (let iter = 0; iter < maxIters; iter++) {
    if (provider.type === 'anthropic') _applyAgenticLoopCache(msgs);
    let turn;
    try { turn = await callModelForAgenticWebTurn(msgs, provider, modelId); }
    catch (err) { break; } // give up on tool use for this reply; fall back to the plain streaming call below
    if (!turn.toolCalls.length) break;
    const results = [];
    for (const call of turn.toolCalls) {
      const subject = call.name === 'fetch_url' ? (call.arguments.url || '') : (call.arguments.query || '');
      toast(`🌐 ${call.name === 'fetch_url' ? t('agent.tool.fetchUrl') : t('agent.tool.webSearch')}: "${subject}"`);
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

export var _sendMessageOverride = null;

export function registerSendMessageOverride(fn) { _sendMessageOverride = fn; }

export async function sendMessage(...args) {
  if (_sendMessageOverride) return _sendMessageOverride(sendMessageOriginal, ...args);
  return sendMessageOriginal(...args);
}

export async function sendMessageOriginal() {
  // Only blocks sending in THIS chat while THIS chat already has a run
  // going — a different chat streaming in the background no longer blocks
  // sending here (that's the whole point of parallel streaming).
  if(isChatStreaming(state.currentChatId)) return;
  const input=document.getElementById('messageInput');
  const text=input.value.trim();
  if(!text&&!state.attachments.length) return;

  // Battle-Modus: if the composer's battle toggle is active with >=2
  // models picked, fan out to sendBattleMessage() instead of the normal
  // single-model path (which does its own KB/web-search hooks).
  if (state.battleModeActive && state.battleSelectedModels.length >= 2) {
    if ((shouldUseWebSearch(text) || isAgenticWebMode()) && webEngineNeedsKey(state.config.webSearchEngine || 'free') && !(state.config.webSearchApiKey || '').trim()) {
      toast(t('web.noKey'));
      openSettings();
      return;
    }
    const att0=[...state.attachments];
    input.value=''; autoResize(input); clearAttachments();
    await sendBattleMessage(text, att0, [...state.battleSelectedModels]);
    return;
  }

  if(!state.config.model){toast(t('js.noModel'));return;}
  const provider=providerForModel(state.config.model)||state.providers[0];
  if(!provider){toast(t('js.noProvider'));openProviderPanel();return;}
  if(!provider.apiKey){toast(t('js.noApiKey'));openProviderPanel();return;}
  if(provider.enabled===false){toast(t('js.providerDisabledToast'));openProviderPanel();return;}
  if ((shouldUseWebSearch(text) || isAgenticWebMode()) && webEngineNeedsKey(state.config.webSearchEngine || 'free') && !(state.config.webSearchApiKey || '').trim()) {
    toast(t('web.noKey'));
    openSettings();
    return;
  }
  const att=[...state.attachments];
  input.value=''; autoResize(input); clearAttachments();
  await sendMessageCore(text, att);
}

export async function sendMessageCore(text, att) {
  if(!state.currentChatId) newChat();
  const empty=document.getElementById('emptyState');
  if(empty) empty.style.display='none';
  const provider=providerForModel(state.config.model)||state.providers[0];
  const isKiConnect=provider?.type==='kiconnect-nrw'||(provider?.type==='openai-compat'&&(provider.serverUrl||'').includes('kiconnect.nrw'));
  const documentIds=[];
  let webSearch = null;
  let linkedPages = [];
  const fileNames0 = att.map(a=>a.name);

  // Instant render: show the user's bubble before any network round-trip
  // (upload/link fetch/web search), which can take a second or more. Push
  // a minimal preview (text + images, files as chips); full content is
  // written into the same message object afterwards without touching the
  // DOM again.
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
  const selectedReadableUrls = state.config.webLinkEnabled
    ? readableUrls.filter(url => state.selectedLinkUrls.has(url) || state.selectedLinkUrls.size === 0)
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
      if ((state.config.webSearchMode || 'manual') === 'manual') state.config.webSearchEnabled = false;
      updateWebSearchButton(false);
      save();
    }
  }

  // Knowledge-base retrieval (RAG) via db.js's kbRetrieveForQuery() (no-op
  // if no KB is toggled on). Circular import with db.js is safe since it's
  // only called at runtime, never at module-evaluation time.
  let kbResult = null;
  let kbWasRequested = false;
  if (text && typeof kbRetrieveForQuery === 'function') {
    kbWasRequested = true;
    try {
      kbResult = await kbRetrieveForQuery(text);
      if (kbResult?.sources?.length) {
        userContent = buildKbAugmentedContent(userContent, kbResult);
      }
    } catch (err) {
      toast(tf('kb.searchFailed', { e: err.message || err }));
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
  // The user's bubble is already on screen (instant preview above). Backfill
  // the same message object with the augmented content (web results, linked
  // pages, resolved files) without touching the DOM again.
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

  // Only the web-source chip row is new (depends on the just-finished
  // search) — patch it into the already-rendered bubble instead of
  // rebuilding the whole message.
  if (webSourceChips.length) {
    const bubbleEl = previewMsgEl.querySelector('.bubble');
    if (bubbleEl && !bubbleEl.querySelector('.web-sources')) {
      bubbleEl.appendChild(buildWebSourcesRow(webSourceChips));
    }
  }
  // Same idea for knowledge-base sources (see _js/db.js: buildKbSourcesRow).
  if (kbSourceChips.length && typeof buildKbSourcesRow === 'function') {
    const bubbleEl = previewMsgEl.querySelector('.bubble');
    if (bubbleEl && !bubbleEl.querySelector('.kb-sources')) {
      bubbleEl.appendChild(buildKbSourcesRow(kbSourceChips));
    }
  }
  state.selectedLinkUrls.clear();
  state.ignoredLinkUrls.clear();
  renderDetectedLinks();

  const typingId=showTyping();
  // No global isStreaming/abortController — the run _streamAIResponse
  // creates below IS this chat's streaming state (see isChatStreaming);
  // the composer/sidebar update themselves once that run registers.

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
  if (kbWasRequested && typeof kbClearActiveSelection === 'function') {
    kbClearActiveSelection();
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

export async function autoGenerateChatTitle(chat, userText) {
  if(!chat) return;
  try {
    const provider = providerForModel(state.config.model) || state.providers[0];
    if(!provider || !provider.apiKey || provider.enabled===false) return;

    const snippet = (userText||'').slice(0, 500);
    if(!snippet) return;

    const titlePrompt = 'Generate a concise chat title (max 6 words, no quotes, no trailing punctuation) for a conversation that starts with this user message:\n\n' + snippet;

    let titleText = '';

    if(provider.type === 'anthropic') {
      const { modelId } = splitModelId(state.config.model);
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
      const { modelId } = splitModelId(state.config.model);
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

export function sendSuggestion(txt){document.getElementById('messageInput').value=txt;sendMessage();}
