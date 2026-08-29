import { toggleCodeBlockCollapse } from '../auth/accounts.js';
import { save } from '../auth/storage.js';
import { renderEditFileChips } from './chat-attachments.js';
import { _buildBattleTileGridRow, _buildLiveRunBubble, activeRuns, regenerate, syncComposerStreamingUI } from './chat-send.js';
import { currentChat, getActivePath, renderSidebar } from './chat-sidebar.js';
import { escHtml } from '../core/html-utils.js';
import { retranslateCodeBlockButtons, t, tf } from '../core/i18n.js';
import { state } from '../core/state.js';
import { buildKbSourcesRow } from '../db.js';
import { splitModelId } from '../providers/provider-models.js';
import { copyBubble, copyBubbleFormatted, copyCodeFromBtn, fragmentToClipboardHtml, fragmentToClipboardText, mathmlForClipboard, openPrintSingleOverlay, toast } from '../ui/misc-ui.js';
import { WEB_SEARCH_RESULT_MAX } from '../websearch/web-search.js';

export function isMessagesNearBottom(threshold) {
  const c = document.getElementById('messages');
  if (!c) return true;
  return c.scrollHeight - c.scrollTop - c.clientHeight < (threshold || 80);
}

export function parseMistralContent(content) {
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

export function getSiblingNodeAt(chat, pathIdx) {
  return getActivePath(chat)[pathIdx] || null;
}

export function renderMessages(messages, limitCount) {
  const chat = currentChat();
  const container = document.getElementById('messages');
  const empty     = document.getElementById('emptyState');

  // Any run belonging to a DIFFERENT chat is about to lose its DOM node (we
  // wipe #messages below) — null out its bubbleEl so nothing writes into a
  // detached node. Covers switchChat/newChat/deleteChat in one place.
  for (const run of activeRuns.values()) {
    if (!chat || run.chatId !== chat.id) run.bubbleEl = null;
  }

  let path = chat ? getActivePath(chat) : (Array.isArray(messages) ? messages : []);
  // limitCount: optionally render only the first N nodes of the active path.
  // Used by regenerate() to stop at the user message, keeping the
  // about-to-be-replaced assistant bubble out of the DOM entirely.
  if (typeof limitCount === 'number') path = path.slice(0, limitCount);

  // Reattach mechanism: any still-running run for THIS chat gets a fresh
  // live bubble, pre-filled from the registry (source of truth; DOM is a
  // rebuildable projection). A run can supply buildLiveEl() (agent runs do,
  // for tool-trace cards), else falls back to the generic builder.
  // Battle-variant runs are EXCLUDED — they're already reattached to their
  // own tile bubble inside _buildBattleTileGridRow(); including them here
  // too used to double-append a stray bubble under the tile grid.
  const liveRuns = chat
    ? [...activeRuns.values()].filter(r => r.chatId === chat.id && r.status === 'running' && r.kind !== 'battle-variant')
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
  // The send/stop button must reflect whichever chat this render just put
  // on screen, not "is anything streaming anywhere" — covers
  // switchChat/newChat/deleteChat in one place.
  syncComposerStreamingUI();
}

export function buildMsgEl(msg, idx) {
  // Battle-Modus: a sendBattleMessage() message renders as a side-by-side
  // tile grid until a winner is chosen (msg._winnerChosen), then falls
  // through to the normal single-bubble sibling-nav path.
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
  avatar.textContent = isUser ? (t('js.userAvatar')) : t('js.aiAvatar');
  avatarCol.appendChild(avatar);

  if (!isUser) {
    const rawMid = msg._model || state.config.model || '';
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

  // Build bubble content
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

  // Knowledge-base sources — populated by db.js's sendMessageCore hook.
  // Same idea as _webSources above, kept separate since KB citations carry
  // a source file + page instead of a URL.
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

export function _buildBubbleChrome(row, wrap, bubble, msg, idx) {
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

export function _finalizeAIRowInPlace(rowEl, msg, idx) {
  if (!rowEl || !rowEl.isConnected) return false;
  const wrap = rowEl.querySelector('.bubble-wrap');
  const bubble = wrap && wrap.querySelector('.bubble');
  if (!wrap || !bubble) return false;

  rowEl.dataset.idx = idx;
  bubble.classList.remove('streaming');

  _buildBubbleChrome(rowEl, wrap, bubble, msg, idx);
  return true;
}

export const _noteSaveTimers = new WeakMap();

export function buildNoteSection(msg) {
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
    // around this blur (concurrent save/stream update), make sure the
    // preview still wins next frame.
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

export function openImageLightbox(url) {
  const lb = document.createElement('div');
  lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 40px #000;';
  lb.appendChild(img);
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

export function buildWebSourcesRow(webSources) {
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

export function getBubbleRow(idx) { return document.querySelector(`.message-row[data-idx="${parseInt(idx,10)}"]`); }

export function buildTokenBadge(usage) {
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

export function updateChatTokenTotal() {
  const chat=currentChat();
  let total=document.getElementById('chatTokenTotal');
  if (!chat) { if(total) total.remove(); return; }
  // Sum tokens along the active path only (getActivePath() follows the
  // active sibling at every fork), matching what's on screen — iterating
  // chat.messages directly would miss non-root sibling branches.
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

export function safeIdx(idx) {
  const n=parseInt(idx,10);
  if(!Number.isFinite(n)||n<0) return null;
  return n;
}

export function deleteBubble(idx) {
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

export function startEditBubble(idx) {
  idx = safeIdx(idx); if (idx === null) return;
  const chat = currentChat(); if (!chat) return;
  const msg = getActivePath(chat)[idx]; if (!msg) return;
  state._editMsgIdx = idx;

  // Plain text only — skip file-content blocks
  let text = '';
  if (typeof msg.content === 'string') text = msg.content;
  else if (Array.isArray(msg.content))
    text = msg.content.filter(p => p.type === 'text' && !p.text?.startsWith('--- ')).map(p => p.text).join('\n');

  // derive pdfMode from structured storage types (pdf_base64 /
  // pdf_text) instead of fragile i18n-string matching. Language-independent.
  state._editAttachments = (msg._files || []).map(name => {
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
  fileLabel.textContent = t('js.editFiles');
  const chipsRow = document.createElement('div');
  chipsRow.id = 'editFileChips';
  chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;';
  const addBtns = document.createElement('div');
  addBtns.style.cssText = 'display:flex;gap:6px;';
  const addFileBtn = document.createElement('button');
  addFileBtn.className = 'bubble-act-btn';
  addFileBtn.textContent = t('js.editAddFile');
  addFileBtn.addEventListener('click', () => document.getElementById('editFileInput')?.click());
  const addImgBtn = document.createElement('button');
  addImgBtn.className = 'bubble-act-btn';
  addImgBtn.textContent = t('js.editAddImage');
  addImgBtn.addEventListener('click', () => document.getElementById('editImageInput')?.click());
  addBtns.appendChild(addFileBtn); addBtns.appendChild(addImgBtn);
  fileArea.appendChild(fileLabel); fileArea.appendChild(chipsRow); fileArea.appendChild(addBtns);

  const eActs = document.createElement('div'); eActs.className = 'edit-actions';
  const confirmBtn = document.createElement('button'); confirmBtn.className = 'edit-confirm-btn';
  confirmBtn.textContent = t('js.saveBubble');
  confirmBtn.addEventListener('click', () => confirmEditBubble());
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.textContent = t('js.cancel');
  cancelBtn.addEventListener('click', () => { state._editAttachments = []; state._editMsgIdx = null; renderMessages(currentChat().messages); });
  eActs.appendChild(confirmBtn); eActs.appendChild(cancelBtn);

  wrap.appendChild(ta); wrap.appendChild(fileArea); wrap.appendChild(eActs);
  ta.style.height = ta.scrollHeight + 'px'; ta.focus();
  renderEditFileChips();
}

export function confirmEditBubble() {
  const idx = state._editMsgIdx; if (idx === null) return;
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
  state._editAttachments.forEach(a => {
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
  state._editAttachments = []; state._editMsgIdx = null;
  save(); renderMessages(chat.messages);
}

// Copies a chosen sibling variant's live fields onto its parent message —
// shared invariant between navigateSibling() (below) and Battle-Modus's
// chooseBattleWinner() (chat-send.js): both need msg's own fields to
// mirror whichever variant is now "active" so rerunFromUserMsg's
// context-building (which reads msg directly, not msg._siblings) picks up
// the right one.
export function applySiblingVariant(msg, variant) {
  msg.content   = variant.content;
  msg._model    = variant._model;
  msg._usage    = variant._usage;
  msg._note     = variant._note;
  msg._noteOpen = variant._noteOpen;
}

export function navigateSibling(idx, delta) {
  const chat = currentChat(); if (!chat) return;
  const path = getActivePath(chat);
  const msg  = path[idx];
  if (!msg || !msg._siblings) return;

  const newIdx = (msg._siblingIdx ?? 0) + delta;
  if (newIdx < 0 || newIdx >= msg._siblings.length) return;

  // Notes are edited in place on msg._note with no explicit commit step, so
  // before switching variants we must write the live note back into its own
  // record — otherwise an edit would be lost or leak onto the target variant.
  const oldVariant = msg._siblings[msg._siblingIdx ?? 0];
  if (oldVariant) { oldVariant._note = msg._note; oldVariant._noteOpen = msg._noteOpen; }

  msg._siblingIdx = newIdx;
  applySiblingVariant(msg, msg._siblings[newIdx]);

  save();
  renderMessages(chat.messages); // getActivePath will now follow new _siblingIdx
}

export function branchFromHere(idx) {
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
  state.chats.unshift({id:branchId,title:`↩ ${chat.title.slice(0,32)} (ab #${idx+1})`,folderId:chat.folderId,branchOf:chat.id,messages:branchedMsgs});
  state.currentChatId=branchId; save(); renderSidebar(); renderMessages(branchedMsgs);
  toast(tf('js.branchFrom', {n: idx+1}));
}

export function appendToMessages(el) {
  const c=document.getElementById('messages');
  const total=c.querySelector('#chatTokenTotal');
  if(total){c.insertBefore(el,total);}else{c.appendChild(el);}
}

export function appendEmptyAI(modelOverride, runId) {
  const mid=modelOverride||state.config.model||'';
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

export function showTyping() {
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

export function removeTyping(id){document.getElementById(id)?.remove();}

export function scrollToBottom(){const c=document.getElementById('messages');c.scrollTop=c.scrollHeight;state.pinnedToBottom=true;}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('messages')?.addEventListener('copy', handleFormulaCopy);
});

export function handleFormulaCopy(event) {
  const messagesEl = document.getElementById('messages');
  const selection = window.getSelection();
  if (!messagesEl || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!messagesEl.contains(range.commonAncestorContainer) || !rangeTouchesFormula(range, messagesEl)) return;
  expandRangeToFullFormulas(range, messagesEl);
  event.preventDefault();
  finishFormulaCopy(range);
}

export async function finishFormulaCopy(range) {
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

export function rangeTouchesFormula(range, root) {
  return Array.from(root.querySelectorAll('.math-inline, .math-block')).some(el => range.intersectsNode(el));
}

export function expandRangeToFullFormulas(range, root) {
  root.querySelectorAll('.math-inline, .math-block').forEach(wrapper => {
    if (!range.intersectsNode(wrapper)) return;
    const formulaRange = document.createRange();
    formulaRange.selectNode(wrapper);
    if (range.compareBoundaryPoints(Range.START_TO_START, formulaRange) > 0) range.setStartBefore(wrapper);
    if (range.compareBoundaryPoints(Range.END_TO_END, formulaRange) < 0) range.setEndAfter(wrapper);
  });
}

export function getFormulaData(wrapper) {
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

export const _KIC_BLOCK_TAGS = new Set(['P','DIV','LI','TR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE']);

export function nodeToPlainText(node) {
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

export function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// escHtml itself now lives in core/html-utils.js (was duplicated there as
// agent.js's/db.js's esc()) — re-exported here (as a real local binding,
// not a bare `export {x} from` re-export, since this file also calls
// escHtml() directly throughout) so every existing
// `import { escHtml } from '.../chat-render.js'` call site keeps working
// unchanged.
export { escHtml };

export function ensureDompurifyNoopenerHook() {
  if (state._dompurifyNoopenerHookInstalled || typeof DOMPurify === 'undefined') return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  state._dompurifyNoopenerHookInstalled = true;
}

export function formatText(raw) {
  if (!raw) return '';
  const blocks = [];
  // Placeholder: plain alnum sentinel (NOT HTML), since an HTML-comment
  // token would get mangled by a fallback escHtml() call, no longer match
  // PH_RE in Step 3, and leak into the rendered message as visible text.
  const PH_TOKEN = 'KICBLK' + Math.random().toString(36).slice(2, 10);
  const PH = (i) => `${PH_TOKEN}${i}x`;
  const PH_RE = new RegExp(`${PH_TOKEN}(\\d+)x`, 'g');
  let s = raw;

  // Builds one collapsible code-block's HTML, pushes it onto `blocks`, and
  // returns its index. Shared by all four fence patterns below (4+/3
  // backticks, closed/unclosed) — they differ only in which regex matched.
  function pushCodeBlock(lang, code) {
    const i = blocks.length;
    const b64 = toBase64Utf8(code.replace(/\n$/, ''));
    const ll = escHtml((lang || '').trim() || 'code');
    blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-collapse-btn" type="button" title="${escHtml(t('js.codeCollapse'))}" aria-label="Collapse code block">▼</button><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><div class="code-block-body"><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div></div>`);
    return i;
  }

  // Strips up to `indent`'s worth of leading whitespace from each line of a
  // fenced code block — fences nested in list items/blockquotes are
  // indented to match their container, which isn't part of the code itself.
  function _stripFenceIndent(code, indent) {
    if (!indent) return code;
    const re = new RegExp('^' + indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return code.split('\n').map(line => line.replace(re, '')).join('\n');
  }

  // Step 1: Code and LaTeX blocks VOR protect from marked

  // 4+-Backtick fences: leading [ \t]* tolerates fences indented under a
  // list item/blockquote (common). Without it, an indented fence isn't
  // recognized HERE and falls through to the inline-code regex, but
  // marked.js DOES recognize it per CommonMark and wraps the already-
  // placeholder-corrupted text in a new code block the Step-3 restore
  // can't reach. Matching the fence here first avoids the nesting problem.
  s = s.replace(/^([ \t]*)(`{4,})([^\n]*)\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm, (_, indent, fence, lang, code) => PH(pushCodeBlock(lang, _stripFenceIndent(code, indent))));

  // 3-Backtick-Fences
  s = s.replace(/^([ \t]*)```([^\n`]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, (_, indent, lang, code) => PH(pushCodeBlock(lang, _stripFenceIndent(code, indent))));

  // Not-closed Fences (Fallback)
  s = s.replace(/^([ \t]*)(`{4,})([^\n]*)\n([\s\S]*)$/gm, (_, indent, fence, lang, code) => PH(pushCodeBlock(lang, _stripFenceIndent(code, indent))));
  s = s.replace(/^([ \t]*)```([^\n`]*)\n([\s\S]*)$/gm, (_, indent, lang, code) => PH(pushCodeBlock(lang, _stripFenceIndent(code, indent))));

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

  // Step 1a: cap pathological blockquote/list nesting depth. marked's
  // block parser recurses once per nesting level — deep leading ">" or
  // list-marker chains can recurse thousands of levels deep, throwing
  // "Maximum call stack size exceeded" or crashing the tab before any
  // catch() runs (reproduced with ~2000 lines of nesting). A try/catch
  // can't protect against that, so depth is capped before marked sees the
  // text: markers beyond MAX_NEST_DEPTH on a line are escaped to literal
  // characters, leaving realistic nesting untouched.
  {
    const MAX_NEST_DEPTH = 20;
    // Lists can also nest purely via indentation (one marker per line,
    // each indented further) — capped too via a ceiling on leading
    // whitespace, since indentation drives CommonMark list nesting depth.
    const MAX_INDENT = MAX_NEST_DEPTH * 4;
    const markerRe = /^(>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/;
    const indentRe = /^[ \t]+/;
    s = s.split('\n').map(line => {
      const im = indentRe.exec(line);
      if (im && im[0].length > MAX_INDENT) {
        line = line.slice(0, MAX_INDENT) + line.slice(im[0].length);
      }
      let rest = line, prefix = '', depth = 0;
      while (depth < MAX_NEST_DEPTH) {
        const m = markerRe.exec(rest);
        if (!m) return line; // never hit the cap - leave line untouched
        prefix += m[0];
        rest = rest.slice(m[0].length);
        depth++;
      }
      // One more marker would push us past the cap: escape it to literal
      // text so marked stops treating the rest of the line as nested
      // block structure (CommonMark backslash-escapes `\>`/`\-`/`\*`/`\+`).
      if (markerRe.test(rest)) rest = rest.replace(/^([>\-*+])/, '\\$1');
      return prefix + rest;
    }).join('\n');
  }

  // Step 1b: ensure a blank line precedes list blocks. CommonMark/marked
  // only starts a list at text-start or after a blank line — without it,
  // "-"/"*"/"1." lines get pulled into the previous paragraph as text.
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

  // Step 2: marked.js rendern
  if (typeof marked !== 'undefined') {
    // Custom renderer for code blocks (in case marked does encounter one)
    const renderer = new marked.Renderer();
    renderer.code = function(token) {
      const text = (token && typeof token === 'object') ? (token.text || '') : String(token || '');
      const lang = (token && typeof token === 'object') ? (token.lang || 'code') : 'code';
      const i = blocks.length;
      const b64 = toBase64Utf8(text);
      const ll = escHtml(lang || 'code');
      blocks.push(`<div class="code-block"><div class="code-block-header"><span class="code-lang">${ll}</span><button class="code-collapse-btn" type="button" title="${escHtml(t('js.codeCollapse'))}" aria-label="Collapse code block">▾</button><button class="code-copy-btn" data-b64="${escHtml(b64)}">${escHtml(t('js.codeCopy'))}</button></div><div class="code-block-body"><pre><code>${escHtml(text)}</code></pre></div></div>`);
      return PH(i);
    };
    try {
      s = marked.parse(s, { renderer, gfm: true, breaks: false });
    } catch(e) {
      // Fallback falls marked fails (e.g. "Maximum call stack size exceeded"
      // from pathologically deep blockquote/list nesting). Logged so the
      // underlying malformed input is diagnosable instead of silently eaten.
      console.error('[KIC] marked.parse failed, using plain-text fallback', e);
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

  // Step 3: Platzhalter wiederherstellen
  s = s.replace(PH_RE, (_, i) => blocks[+i] || '');

  // Step 4: DOMPurify
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

export function wireCodeCopyButtons(container) {
  container.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    if(!btn._wired){btn._wired=true;btn.addEventListener('click',()=>copyCodeFromBtn(btn));}
  });
  container.querySelectorAll('.code-collapse-btn').forEach(btn => {
    if(!btn._wired){btn._wired=true;btn.addEventListener('click',()=>toggleCodeBlockCollapse(btn));}
  });
  retranslateCodeBlockButtons(container);
}

export function typesetMath(el) {
  const target = el || document.getElementById('messages');
  const targets = Array.isArray(target) ? target : [target];
  if (!targets.length) return;
  if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetPromise(targets).then(() => stripMathFocusability(targets))
      .catch(err => console.error('[MathJax typeset error]', err));
  }
}

export function stripMathFocusability(targets) {
  targets.forEach(t => {
    if (!t || !t.querySelectorAll) return;
    if (t.matches && t.matches('mjx-container[tabindex]')) t.removeAttribute('tabindex');
    t.querySelectorAll('mjx-container[tabindex]').forEach(mjx => mjx.removeAttribute('tabindex'));
  });
}

document.addEventListener('mousedown', e => {
  if (e.target.closest && e.target.closest('mjx-container')) e.preventDefault();
}, true);

export const _mjThrottleState = new WeakMap();

export function typesetMathThrottled(el, delay = 400) {
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

export function handleExternalLinkClick(e) {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  let url;
  try { url = new URL(a.getAttribute('href'), location.href); } catch { return; }
  if (!/^https?:$/i.test(url.protocol)) return;
  e.preventDefault();
  window.open(url.href, '_blank', 'noopener,noreferrer');
}
