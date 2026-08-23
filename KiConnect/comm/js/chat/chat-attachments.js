// js/chat/chat-attachments.js — extracted from kiconnect.js (Phase 4 of the v3.5.1→v4.0.0 modularization)
import { save } from '../auth/storage.js';
import { _finalizeAIRowInPlace, appendToMessages, buildMsgEl, escHtml, openImageLightbox, removeTyping, scrollToBottom, typesetMath, updateChatTokenTotal } from './chat-render.js';
import { _finishLiveStreamUI, _makeRunId, _runBubbleEl, _streamAIResponse, activeRuns, syncComposerStreamingUI } from './chat-send.js';
import { currentChat, getActiveContainer, getActivePath, renderSidebar } from './chat-sidebar.js';
import { t, tf } from '../core/i18n.js';
import { state } from '../core/state.js';
import { modelSupportsPdfBase64 } from '../providers/provider-models.js';
import { getMaxImageStorageBytes, setMaxImageStorageBytes, setStatus, toast } from '../ui/misc-ui.js';

export function renderEditFileChips() {
  const chipsRow = document.getElementById('editFileChips'); if (!chipsRow) return;
  chipsRow.innerHTML = '';
  state._editAttachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 10px;cursor:default;';
    const icon = a.type === 'image' ? '🖼️' : '📄';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = icon + ' ' + a.name;
    if (a._storedOnly) { nameSpan.style.opacity = '0.6'; nameSpan.title = t('js.originalReattach'); }
    const rem = document.createElement('button');
    rem.style.cssText = 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;';
    rem.textContent = '\u2715';
    const capturedIdx = i;
    rem.addEventListener('click', () => { state._editAttachments.splice(capturedIdx, 1); renderEditFileChips(); });
    chip.appendChild(nameSpan); chip.appendChild(rem);
    chipsRow.appendChild(chip);
  });
}

export function handleEditFileAttach(e) {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = ev => {
    if (isPdf) {
      const b64 = ev.target.result;
      const bin = atob(b64.split(',')[1] || b64);
      const arr = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      state._editAttachments.push({ type:'pdf-b64', name:file.name, data:b64, rawBuf:arr.buffer, pdfMode:'b64' });
    } else {
      state._editAttachments.push({ type:'text-file', name:file.name, content:ev.target.result });
    }
    renderEditFileChips();
  };
  isPdf ? reader.readAsDataURL(file) : reader.readAsText(file, 'UTF-8');
}

export function handleEditImageAttach(e) {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    state._editAttachments.push({ type:'image', name:file.name, data:ev.target.result });
    renderEditFileChips();
  };
  reader.readAsDataURL(file);
}

export async function _runStreamAndAttach(chat, messages, provider, typingId, documentIds, opts) {
  let assistantText = '', usageData = null, streamEl = null;
  // Generated here (not inside _streamAIResponse) so it's known even if that
  // call throws before returning — _streamAIResponse registers the run in
  // activeRuns synchronously before its first await.
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
  // mid-stream can never mislabel a finished answer.
  const modelUsed = activeRuns.get(runId)?.model ?? state.config.model;
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

export function _attachAIActions(chat, assistantText, usageData, streamEl, modelUsed) {
  if (modelUsed === undefined) modelUsed = state.config.model; // fallback for any other caller
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
  // token badge, ...) instead of rebuilding the whole chat history or
  // re-running formatText()/typesetMath() on content already rendered
  // incrementally during streaming. Reuses `streamEl` as-is, only attaches
  // the missing chrome around it.
  const path = getActivePath(chat);
  const idx = path.length - 1;
  const messagesEl = document.getElementById('messages');
  const emptyState = document.getElementById('emptyState');

  // Only touch #messages if `chat` is the one on screen right now — if the
  // stream finished while the user was elsewhere, #messages holds that other
  // chat's rows. The finished answer is already saved into chat.messages, so
  // it renders correctly next time this chat is opened via renderMessages().
  if (chat === currentChat()) {
    if (!_finalizeAIRowInPlace(streamEl, path[idx], idx)) {
      // Fallback: streamEl is missing/detached — build a fresh row the old
      // way. Still avoid replacing an unrelated node: fall back to the last
      // message row, never the #chatTokenTotal footer div.
      const newRow = buildMsgEl(path[idx], idx);
      const oldRow = (streamEl && streamEl.parentNode === messagesEl) ? streamEl : messagesEl.lastElementChild;
      if (oldRow && oldRow !== emptyState) oldRow.replaceWith(newRow);
      else messagesEl.appendChild(newRow);
      typesetMath(newRow);
    }
    if (state.pinnedToBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  updateChatTokenTotal();
  save();
}

export function buildAttachmentContent(text, att) {
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

export async function extractPdfText(arrayBuffer) {
  const lib=window._pdfjsLib||window.pdfjsLib; if(!lib) throw new Error('PDF.js not loaded');
  const pdf=await lib.getDocument({data:arrayBuffer}).promise;
  let out='';
  for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();out+=`${tf('js.pdfPage',{n:i})}\n${content.items.map(it=>it.str).join(' ')}\n`;}
  return out;
}

export function arrayBufferToBase64(buf){const bytes=new Uint8Array(buf);let bin='';for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);return btoa(bin);}

export async function processFile(file) {
  const isImage=file.type.startsWith('image/');
  const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  const reader=new FileReader();
  reader.onload=async ev=>{
    if(isImage){state.attachments.push({type:'image',name:file.name,data:ev.target.result});}
    else if(isPdf){
      const b64data=ev.target.result;const b64=b64data.split(',')[1]||b64data;
      const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k);
      state.attachments.push({type:'pdf-b64',name:file.name,data:b64data,rawBuf:arr.buffer,pdfMode:'b64'});
    } else{state.attachments.push({type:'text-file',name:file.name,content:ev.target.result});}
    renderAttachments();
  };
  isPdf||isImage?reader.readAsDataURL(file):reader.readAsText(file,'UTF-8');
}

export async function processImageBlob(blob, name) {
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
      state.attachments.push({type:'image', name: name || 'clipboard-image.png', data: dataUrl});
      renderAttachments();
      resolve();
    };
    reader.readAsDataURL(blob);
  });
}

export async function handlePaste(e) {
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

export function handleFileAttach(e){const file=e.target.files[0];if(!file)return;e.target.value='';processFile(file);}

export function handleImageAttach(e){const file=e.target.files[0];if(!file)return;e.target.value='';processFile(file);}

export function renderAttachments() {
  const row=document.getElementById('attachmentRow');
  row.innerHTML='';
  state.attachments.forEach((a,i)=>{
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
      if(mode==='b64'&&!modelSupportsPdfBase64(state.config.model)){
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

export async function togglePdfMode(i,mode){
  const a=state.attachments[i];if(!a||a.pdfMode===mode)return;
  a.pdfMode=mode;
  if(mode==='text'&&!a.extractedText){
    renderAttachments();toast(t('js.extracting'));
    try{const buf=a.rawBuf||(()=>{const b64=(a.data||'').split(',')[1]||a.data;const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k);return arr.buffer;})();a.rawBuf=buf;a.extractedText=await extractPdfText(buf);toast(tf('js.extracted',{n:a.extractedText.length}));}
    catch(err){toast(tf('js.extractFailed',{e:err.message}));a.pdfMode='b64';}
  }
  if(mode==='b64'&&!a.data&&a.rawBuf){try{a.data=`data:application/pdf;base64,${arrayBufferToBase64(a.rawBuf)}`;}catch(err){toast(tf('js.b64Failed',{e:err.message}));a.pdfMode='text';}}
  renderAttachments();
}

export function removeAttachment(i){state.attachments.splice(i,1);renderAttachments();}

export function clearAttachments(){state.attachments=[];renderAttachments();}

export async function handleDrop(e){
  e.preventDefault();state._dragCounter=0;document.getElementById('dropOverlay').classList.remove('active');
  // Only handle external file drops (not internal chat/folder drags)
  if(state.draggedChatId||state.draggedFolderId) return;
  const files=Array.from(e.dataTransfer.files);if(!files.length)return;
  for(const file of files)await processFile(file);
}
