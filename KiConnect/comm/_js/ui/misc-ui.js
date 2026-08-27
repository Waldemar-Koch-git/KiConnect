import { getAccount } from '../auth/accounts.js';
import { save } from '../auth/storage.js';
import { AGENTIC_TOOL_MAX_ITERS_CAP } from '../chat/chat-send.js';
import { escHtml, getBubbleRow, getFormulaData, nodeToPlainText, safeIdx, wireCodeCopyButtons } from '../chat/chat-render.js';
import { currentChat, getActivePath } from '../chat/chat-sidebar.js';
import { initSettingsSectionCollapse, initTuningSectionCollapse } from '../core/boot.js';
import { t } from '../core/i18n.js';
import { state } from '../core/state.js';
import { applyTheme } from '../core/theme.js';
import { updateActiveProviderInfo, updateAudioProviderKeyUI } from '../providers/provider-crud.js';
import { splitModelId, updateModelMaxInfo } from '../providers/provider-models.js';
import { PROFILE_COLORS } from './profiles.js';
import { kicVoiceGetSetting } from '../voice.js';
import { updateWebSearchButton, updateWebSearchKeyUI } from '../websearch/web-search.js';

export var _languageChangeListeners;

export function onLanguageChange(cb) { (_languageChangeListeners || (_languageChangeListeners = [])).push(cb); }

export const DEFAULT_MAX_IMAGE_STORAGE_BYTES = 500 * 1024;

export function getMaxImageStorageBytes() {
  const v = parseInt(localStorage.getItem('kic_max_img_bytes') || '0');
  return v > 0 ? v : DEFAULT_MAX_IMAGE_STORAGE_BYTES;
}

export function setMaxImageStorageBytes(bytes) {
  localStorage.setItem('kic_max_img_bytes', String(bytes));
}

export function renderColorRow(sel) {
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

export function getSelectedColor() { return document.querySelector('.color-swatch.selected')?.dataset.color || PROFILE_COLORS[0]; }

export function syncSettingsPanel() {
  document.getElementById('temperature').value   = state.config.temperature;
  document.getElementById('tempVal').textContent = state.config.temperature;
  document.getElementById('systemPrompt').value  = state.config.systemPrompt||'';
  const w = state.config.chatMaxWidth || 880;
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
  if (webModeEl) webModeEl.value = state.config.webSearchMode || 'manual';
  if (webEngineEl) webEngineEl.value = state.config.webSearchEngine || 'free';
  if (webKeyEl) webKeyEl.value = state.config.webSearchApiKey || '';
  updateWebSearchKeyUI(state.config.webSearchEngine || 'free');
  if (webCountEl) webCountEl.value = state.config.webSearchResultCount || 8;
  if (webCountVal) webCountVal.textContent = state.config.webSearchResultCount || 8;
  const webItersEl = document.getElementById('webSearchAgenticIters');
  const webItersVal = document.getElementById('webSearchAgenticItersVal');
  const webIters = state.config.webSearchAgenticMaxIters || 4;
  // Drive the slider's ceiling from the single shared constant instead of
  // trusting the static HTML `max` attribute, so the two can't drift apart.
  if (webItersEl) { webItersEl.max = AGENTIC_TOOL_MAX_ITERS_CAP; webItersEl.value = webIters; }
  if (webItersVal) webItersVal.textContent = webIters;
  updateWebSearchButton();
  // ttsProvider/sttProvider live in voice.js's own unencrypted settings
  // object, not `config` (only API keys live in config.audioProviders).
  // window.kicVoiceGetSetting/SetSetting bridges to that.
  const ttsProviderEl = document.getElementById('ttsProviderSelect');
  const sttProviderEl = document.getElementById('sttProviderSelect');
  if (ttsProviderEl) ttsProviderEl.value = (kicVoiceGetSetting?.('ttsProvider')) || 'browser';
  if (sttProviderEl) sttProviderEl.value = (kicVoiceGetSetting?.('sttProvider')) || 'browser';
  updateAudioProviderKeyUI();
  // Populate account name field
  const accNameInput = document.getElementById('accountNameInput');
  if (accNameInput && state._activeAccountId) {
    const acc = getAccount(state._activeAccountId);
    if (acc) accNameInput.value = acc.name;
  }
  updateActiveProviderInfo(); updateModelMaxInfo();
}

export function scheduleTuningSave() {
  clearTimeout(state._tuningSaveTimer);
  state._tuningSaveTimer = setTimeout(() => save(), 500);
}

export function applyChatWidth(val) {
  val = parseInt(val);
  document.documentElement.style.setProperty('--chat-max-w', val + 'px');
  const slider = document.getElementById('chatWidthSlider');
  const label  = document.getElementById('chatWidthVal');
  if (slider) slider.value = val;
  if (label)  label.textContent = val + 'px';
  state.config.chatMaxWidth = val;
}

export function setStatus(c) {
  const d = document.getElementById('statusDot');
  if (!d) return;
  const colors = { green:'var(--green)', red:'var(--red)', yellow:'#f0c040', grey:'var(--muted)' };
  const col = colors[c] || colors.grey;
  d.style.background = col;
  d.style.boxShadow = `0 0 8px ${col}`;
  // pulse only while pending/streaming (yellow)
  d.style.animation = (c === 'yellow') ? 'pulse 1s infinite' : 'pulse 2s infinite';
}

export function copyCodeFromBtn(btn) {
  const b64=btn.dataset.b64; if(!b64) return;
  let text;
  try{text=decodeURIComponent(escape(atob(b64)));}catch{text=atob(b64);}
  navigator.clipboard.writeText(text).then(()=>{
    btn.textContent=t('js.copied');btn.classList.add('done');
    setTimeout(()=>{btn.textContent=t('js.codeCopy');btn.classList.remove('done');},2000);
  }).catch(()=>toast(t('js.copyFailed')));
}

export function copyBubble(btn, idx) {
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

export async function copyBubbleFormatted(bubbleEl, btn) {
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

export function mathmlForClipboard(math, isBlock) {
  const clone = math.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/1998/Math/MathML');
  if (isBlock) clone.setAttribute('display', 'block');
  return clone.outerHTML;
}

export function formulaToClipboardHtml({latex, isBlock, mathml}) {
  const fallback = `<span>${escHtml(isBlock ? `$$${latex}$$` : `$${latex}$`)}</span>`;
  if (!mathml) return fallback;
  const word = `<!--[if gte mso 9]>${mathml}<![endif]-->`;
  const nonWord = `<!--[if !mso]><!-->${fallback}<!--<![endif]-->`;
  return isBlock ? `<p class="MsoNormal">${word}${nonWord}</p>` : word + nonWord;
}

export function fragmentToClipboardHtml(fragment) {
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

export function fragmentToClipboardText(fragment) {
  const container = document.createElement('div');
  container.appendChild(fragment.cloneNode(true));
  return nodeToPlainText(container).replace(/\n{3,}/g, '\n\n').trim();
}

export function copyFullChat() {
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

export function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}

export function openSettings(){syncSettingsPanel();applyTheme(localStorage.getItem('kic_theme')||'dark');document.getElementById('settingsPanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="settingsPanel"]')?.classList.add('active');initSettingsSectionCollapse();}

export function openTuningPanel(){syncSettingsPanel();applyTheme(localStorage.getItem('kic_theme')||'dark');document.getElementById('tuningPanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="tuningPanel"]')?.classList.add('active');initTuningSectionCollapse();}

export function resetMathJaxSettings() {
  try { localStorage.removeItem('MathJax-Menu-Settings'); } catch (e) {}
  toast(t('js.mathResetDone'));
  setTimeout(() => location.reload(), 700);
}

export function printFullChat() {
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

export function openPrintSingleOverlay(idx) {
  idx = safeIdx(idx); if (idx === null) return;
  const chat = currentChat(); if (!chat) return;
  const msg = getActivePath(chat)[idx]; if (!msg) return;
  const row = getBubbleRow(idx); if (!row) return;
  const liveBubble = row.querySelector('.bubble');
  const liveNote = row.querySelector('.note-print');
  if (!liveBubble) return;

  state._printSingleIdx = idx;

  // Meta line (role + date)
  const role = msg.role === 'user' ? 'Du' : (splitModelId(msg._model || state.config.model).modelId || 'KI');
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

export function closePrintSingleOverlay() {
  state._printSingleIdx = null;
  document.getElementById('printSingleOverlay')?.classList.remove('show');
}

export function printSingleBubble() {
  if (state._printSingleIdx === null) return;

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
