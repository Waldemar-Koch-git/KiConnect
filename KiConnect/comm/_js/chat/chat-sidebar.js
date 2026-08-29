import { accountKey } from '../auth/accounts.js';
import { _storePut, save } from '../auth/storage.js';
import { renderMessages } from './chat-render.js';
import { isChatStreaming, syncComposerStreamingUI } from './chat-send.js';
import { wireFolderDragAndDrop } from '../core/dnd-utils.js';
import { t, tf } from '../core/i18n.js';
import { state } from '../core/state.js';
import { toast } from '../ui/misc-ui.js';

export let _selectedChatIds = new Set();

export function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  state.sidebarCollapsed = !state.sidebarCollapsed;
  sb.classList.toggle('collapsed', state.sidebarCollapsed);
  save();
}

export function newFolder() {
  const id = Date.now().toString();
  state.folders.push({id, name: t('js.newFolder'), collapsed:false});
  save(); renderSidebar(); setTimeout(()=>startRenamingFolder(id), 50);
}

export function deleteFolder(id) {
  const f = state.folders.find(x=>x.id===id);
  const inside = state.chats.filter(c=>c.folderId===id);
  if (inside.length && !confirm('\n🗂️ + 📝 → 🗑️ ❓') ) return;
  state.chats = state.chats.filter(c=>c.folderId!==id);
  state.folders = state.folders.filter(f=>f.id!==id);
  if (state.activeFolderId === id) state.activeFolderId = null;
  if (state.currentChatId && !state.chats.some(c=>c.id===state.currentChatId)) {
    state.currentChatId = state.chats[0]?.id || null;
    if (state.currentChatId) renderMessages(currentChat().messages);
    else { const c=document.getElementById('messages'); c.innerHTML=''; const e=document.getElementById('emptyState'); if(e){c.appendChild(e);e.style.display='';} syncComposerStreamingUI(); }
  }
  save(); renderSidebar();
}

export function toggleFolder(id) {
  const f = state.folders.find(x=>x.id===id);
  if (f) { f.collapsed=!f.collapsed; save(); renderSidebar(); }
}

export function startRenamingFolder(id) {
  const el = document.getElementById(`fname_${id}`); if(!el) return;
  const f = state.folders.find(x=>x.id===id);
  const input = document.createElement('input');
  input.className = 'folder-name-input'; input.value = f.name;
  input.addEventListener('blur', () => commitRenameFolder(id, input.value));
  input.addEventListener('keydown', e => { if(e.key==='Enter') input.blur(); });
  el.replaceWith(input); input.focus();
}

export function commitRenameFolder(id, newName) {
  const f = state.folders.find(x=>x.id===id);
  if (f) f.name = newName.trim() || f.name;
  save(); renderSidebar();
}

export function onFolderDragStart(e, id) {
  state.draggedFolderId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'folder:' + id);
}

export function onFolderDrop(e, targetId) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.folder-drag-over').forEach(el=>el.classList.remove('folder-drag-over'));
  if (!state.draggedFolderId || state.draggedFolderId === targetId) { state.draggedFolderId = null; return; }
  const fromIdx = state.folders.findIndex(f=>f.id===state.draggedFolderId);
  const toIdx   = state.folders.findIndex(f=>f.id===targetId);
  if (fromIdx === -1 || toIdx === -1) { state.draggedFolderId = null; return; }
  const [moved] = state.folders.splice(fromIdx, 1);
  state.folders.splice(toIdx, 0, moved);
  state.draggedFolderId = null;
  save(); renderSidebar();
}

export function currentChat() { return state.chats.find(c=>c.id===state.currentChatId); }

export function getSidebarTargetFolderId() {
  if (state.activeFolderId === null || state.folders.some(f=>f.id===state.activeFolderId)) return state.activeFolderId || null;
  const chat = currentChat();
  if (chat && (chat.folderId === null || state.folders.some(f=>f.id===chat.folderId))) return chat.folderId || null;
  return state.folders[0]?.id || null;
}

export function setActiveFolder(folderId) {
  state.activeFolderId = folderId || null;
  renderSidebar();
}

export function newChat(folderId) {
  if (folderId === undefined) folderId = getSidebarTargetFolderId();
  const id = Date.now().toString();
  state.chats.unshift({id, title:'Chat::', folderId, messages:[]});
  state.activeFolderId = folderId || null;
  state.currentChatId = id; save(); renderSidebar(); renderMessages([]);
}

export function switchChat(id) {
  state.currentChatId = id;
  const c = state.chats.find(x=>x.id===id);
  state.activeFolderId = c?.folderId || null;
  // Persist via server store (encrypted) – not raw localStorage
  _storePut(state._activeAccountId, 'current_chat', id).catch(() => {
    localStorage.setItem(accountKey('current_chat'), id);
  });
  renderSidebar();
  if (c) renderMessages(c.messages);
}

export function deleteChat(id) {
  state.chats = state.chats.filter(c=>c.id!==id);
  if (state.currentChatId === id) {
    state.currentChatId = state.chats[0]?.id||null;
    state.activeFolderId = currentChat()?.folderId || null;
    if (state.currentChatId) renderMessages(currentChat().messages);
    else { const c=document.getElementById('messages'); c.innerHTML=''; const e=document.getElementById('emptyState'); if(e){c.appendChild(e);e.style.display='';} syncComposerStreamingUI(); }
  }
  save(); renderSidebar();
}

export function startRenamingChat(id) {
  const titleEl = document.getElementById(`ctitle_${id}`); if(!titleEl) return;
  const chat = state.chats.find(c=>c.id===id); if(!chat) return;
  const input = document.createElement('input');
  input.className = 'chat-item-title-input'; input.value = chat.title;
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('blur', () => { chat.title = input.value.trim()||chat.title; save(); renderSidebar(); });
  input.addEventListener('keydown', e => { if(e.key==='Enter') input.blur(); });
  titleEl.replaceWith(input); input.focus(); input.select();
}

export function getMoveChatIds(chatId) {
  if (_selectedChatIds.has(chatId)) return [..._selectedChatIds].filter(id => state.chats.some(c => c.id === id));
  return [chatId];
}

export function reorderChatTo(draggedId, targetId) {
  const dragged = state.chats.find(c => c.id === draggedId);
  const target = state.chats.find(c => c.id === targetId);
  if (!dragged || !target) return;
  if (dragged.folderId !== target.folderId) {
    dragged.folderId = target.folderId;
  }
  const fromIdx = state.chats.indexOf(dragged);
  let toIdx = state.chats.indexOf(target);
  if (fromIdx === -1 || toIdx === -1) return;
  state.chats.splice(fromIdx, 1);
  toIdx = state.chats.indexOf(target); // recompute after removal
  state.chats.splice(toIdx + 1, 0, dragged);
  if (draggedId === state.currentChatId) state.activeFolderId = dragged.folderId || null;
  save(); renderSidebar();
}

export function moveChats(chatIds, folderId) {
  const ids = [...new Set(chatIds || [])];
  if (!ids.length) return;
  ids.forEach(id => {
    const c = state.chats.find(x => x.id === id);
    if (c) c.folderId = folderId;
  });
  if (ids.includes(state.currentChatId)) state.activeFolderId = folderId || null;
  save(); renderSidebar();
  toast(tf(ids.length > 1 ? 'js.chatsMoved' : 'js.chatMoved', { n: ids.length }));
}

export function showChatCtxMenu(e, chatId) {
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
  if (state.folders.length > 0) {
    const moveItem = document.createElement('div');
    moveItem.className = 'ctx-item ctx-item-submenu';
    moveItem.textContent = '📂 ' + (t('js.moveToFolder')) + ' ▶';
    const submenu = document.createElement('div');
    submenu.className = 'ctx-submenu';
    // "No folder" option
    const noFolderOpt = document.createElement('div');
    noFolderOpt.className = 'ctx-item';
    noFolderOpt.textContent = t('js.noFolder');
    noFolderOpt.addEventListener('click', () => { moveChats(targetIds, null); hideCtx(); });
    submenu.appendChild(noFolderOpt);
    state.folders.forEach(f => {
      const opt = document.createElement('div');
      opt.className = 'ctx-item';
      const allAlreadyThere = targetIds.every(id => state.chats.find(c => c.id === id)?.folderId === f.id);
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

export function hideCtx() { document.getElementById('ctxMenu').style.display='none'; }

document.addEventListener('click', hideCtx);

export function _buildFolderCtxMenu(e, folderId, list, { rename, moveUp, moveDown, del }) {
  e.preventDefault(); e.stopPropagation();
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';
  const idx = list.findIndex(f => f.id === folderId);

  const renameItem = document.createElement('div');
  renameItem.className = 'ctx-item'; renameItem.textContent = t('js.rename');
  renameItem.addEventListener('click', () => { rename(folderId); hideCtx(); });
  menu.appendChild(renameItem);

  // Move (purely symbolic, no dedicated translation needed) — submenu with ↑ / ↓
  const moveItem = document.createElement('div');
  moveItem.className = 'ctx-item ctx-item-submenu';
  moveItem.textContent = '↕️ ▶';
  const submenu = document.createElement('div');
  submenu.className = 'ctx-submenu';
  const upOpt = document.createElement('div');
  upOpt.className = 'ctx-item'; upOpt.textContent = '↑';
  if (idx <= 0) { upOpt.style.opacity = '0.5'; upOpt.style.pointerEvents = 'none'; }
  upOpt.addEventListener('click', () => { moveUp(folderId); hideCtx(); });
  submenu.appendChild(upOpt);
  const downOpt = document.createElement('div');
  downOpt.className = 'ctx-item'; downOpt.textContent = '↓';
  if (idx === -1 || idx >= list.length - 1) { downOpt.style.opacity = '0.5'; downOpt.style.pointerEvents = 'none'; }
  downOpt.addEventListener('click', () => { moveDown(folderId); hideCtx(); });
  submenu.appendChild(downOpt);
  moveItem.appendChild(submenu);
  moveItem.addEventListener('mouseenter', () => submenu.classList.add('open'));
  moveItem.addEventListener('mouseleave', () => submenu.classList.remove('open'));
  menu.appendChild(moveItem);

  const delItem = document.createElement('div');
  delItem.className = 'ctx-item danger'; delItem.textContent = t('js.delete');
  delItem.addEventListener('click', () => { del(folderId); hideCtx(); });
  menu.appendChild(delItem);

  menu.style.display = 'block';
  const x = Math.min(e.clientX, window.innerWidth-180);
  const y = Math.min(e.clientY, window.innerHeight-120);
  menu.style.left = x+'px';
  menu.style.top  = y+'px';
}

export function showFolderCtxMenu(e, folderId) {
  _buildFolderCtxMenu(e, folderId, state.folders, {
    rename: startRenamingFolder, moveUp: id => moveFolder(id, -1), moveDown: id => moveFolder(id, 1), del: deleteFolder,
  });
}

export function moveFolder(id, dir) {
  const idx = state.folders.findIndex(f => f.id === id);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.folders.length) return;
  const [moved] = state.folders.splice(idx, 1);
  state.folders.splice(newIdx, 0, moved);
  save(); renderSidebar();
}

export function toggleChatSelect(id) {
  if (_selectedChatIds.has(id)) _selectedChatIds.delete(id);
  else _selectedChatIds.add(id);
  if (_selectedChatIds.size === 0) state._multiSelectMode = false;
  renderSidebar();
}

export function enterMultiSelectMode() {
  state._multiSelectMode = true;
  _selectedChatIds.clear();
  document.body.classList.add('multiselect-active');
  renderSidebar();
}

export function exitMultiSelectMode() {
  state._multiSelectMode = false;
  _selectedChatIds.clear();
  document.body.classList.remove('multiselect-active');
  renderSidebar();
}

export function deleteSelectedChats() {
  if (_selectedChatIds.size === 0) return;
  const ids = [..._selectedChatIds];
  ids.forEach(id => {
    state.chats = state.chats.filter(c => c.id !== id);
  });
  if (ids.includes(state.currentChatId)) {
    state.currentChatId = state.chats[0]?.id || null;
    if (state.currentChatId) renderMessages(currentChat().messages);
    else {
      const cont = document.getElementById('messages');
      const empty = document.getElementById('emptyState');
      Array.from(cont.children).forEach(el => { if(el!==empty) el.remove(); });
      if (empty) empty.style.display = '';
      syncComposerStreamingUI();
    }
  }
  _selectedChatIds.clear();
  state._multiSelectMode = false;
  document.body.classList.remove('multiselect-active');
  save(); renderSidebar();
}

export function onDragStart(e, id) {
  state.draggedChatId = id;
  e.dataTransfer.effectAllowed = 'move';
  if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'chat:' + id);
}

export function onDropFolder(e, folderId) {
  e.preventDefault();
  document.querySelectorAll('.drag-target').forEach(el=>el.classList.remove('drag-target'));
  if (state.draggedChatId) {
    state.activeFolderId = folderId || null;
    moveChats(getMoveChatIds(state.draggedChatId), folderId);
    state.draggedChatId=null;
  }
}

export var _renderSidebarListeners;

export function onRenderSidebar(cb) { (_renderSidebarListeners || (_renderSidebarListeners = [])).push(cb); }

export function renderSidebar() {
  const container = document.getElementById('folderContainer');
  container.innerHTML = '';

  // Multi-select toolbar
  const actionsEl = document.querySelector('.sidebar-actions');
  let msBar = document.getElementById('multiSelectBar');
  if (actionsEl) {
    if (!msBar) {
      msBar = document.createElement('div');
      msBar.id = 'multiSelectBar';
      msBar.style.cssText = 'display:none;align-items:center;gap:6px;padding:8px 8px;background:var(--surface2);border-top:1px solid var(--border);flex-shrink:0;';
      actionsEl.parentNode.insertBefore(msBar, actionsEl);
    }
    if (state._multiSelectMode) {
      msBar.style.display = 'flex';
      msBar.innerHTML = '';
      // Cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'sidebar-action-btn';
      cancelBtn.title = t('js.cancelSelection');
      cancelBtn.textContent = '✕';
      cancelBtn.style.cssText = 'flex:0 0 auto;min-width:38px;font-size:17px;padding:9px;line-height:1;';
      cancelBtn.addEventListener('click', exitMultiSelectMode);
      // Count label
      const countLbl = document.createElement('span');
      countLbl.style.cssText = 'flex:1;font-size:12.5px;color:var(--muted);font-family:"IBM Plex Mono",monospace;';
      countLbl.textContent = _selectedChatIds.size > 0 ? tf('js.chosenChats', {n: _selectedChatIds.size}) : (t('js.selectedChats'));
      // Select all
      const selAllBtn = document.createElement('button');
      selAllBtn.className = 'sidebar-action-btn';
      selAllBtn.title = t('js.selectAll');
      selAllBtn.textContent = '☑';
      selAllBtn.style.cssText = 'flex:0 0 auto;min-width:38px;font-size:17px;padding:9px;line-height:1;';
      selAllBtn.addEventListener('click', () => {
        state.chats.forEach(c => _selectedChatIds.add(c.id));
        renderSidebar();
      });
      // Delete selected
      const delBtn = document.createElement('button');
      delBtn.className = 'sidebar-action-btn';
      delBtn.title = t('js.deleteSelectedItems');
      delBtn.textContent = '🗑';
      delBtn.style.cssText = 'flex:0 0 auto;min-width:38px;font-size:17px;padding:9px;line-height:1;color:var(--red);';
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
        existingMsBtn.title = t('js.multiSelect');
        existingMsBtn.textContent = '☐';
	}
    }
  }

  // Build every folder/chat node off-DOM in a fragment and attach it once,
  // instead of appendChild-ing onto the live container (avoids a reflow per append).
  const frag = document.createDocumentFragment();

  const unfiled = state.chats.filter(c=>!c.folderId||!state.folders.find(f=>f.id===c.folderId));
  const targetFolderId = getSidebarTargetFolderId();
  const newChatBtn = document.getElementById('newChatBtn');
  if (newChatBtn) {
    newChatBtn.classList.remove('primary');
    const targetName = targetFolderId === null
      ? (t('js.noFolder'))
      : (state.folders.find(f=>f.id===targetFolderId)?.name || '');
    newChatBtn.title = targetName ? tf('js.newChatIn', { name: targetName }) : '';
  }

  state.folders.forEach(f => {
    const fc = state.chats.filter(c=>c.folderId===f.id);
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder';
    // Folder-level drag for reordering
    wireFolderDragAndDrop(folderDiv, f.id, {
      isLeafDragActive: () => !!state.draggedChatId,
      draggedFolderId: () => state.draggedFolderId,
      startFolderDrag: onFolderDragStart,
      onFolderDrop,
      onItemDrop: onDropFolder,
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
    const countSpan = document.createElement('span');
    countSpan.className = 'folder-count'; countSpan.textContent = fc.length;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'folder-actions';
    const addBtn = document.createElement('button');
    addBtn.className = 'folder-btn'; addBtn.textContent = '＋';
    addBtn.dataset.id = f.id;
    addBtn.title = t('sidebar.newChat');
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
      if (state.draggedChatId) { e.preventDefault(); header.classList.add('drag-target'); }
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-target'));
    header.addEventListener('drop', e => { if(state.draggedChatId) onDropFolder(e, f.id); });
    header.addEventListener('click', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      state.activeFolderId = f.id;
      if (f.collapsed) { f.collapsed=false; save(); renderSidebar(); }
      else renderSidebar();
    });
    // Double-click = collapse the folder (renaming is only ever triggered via the context menu or the ✏️ button)
    header.addEventListener('dblclick', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      if (!f.collapsed) { f.collapsed = true; save(); renderSidebar(); }
    });
    // Right-click = context menu with folder options (Rename / Move / Delete)
    header.addEventListener('contextmenu', e => showFolderCtxMenu(e, f.id));
    const chatsDiv = document.createElement('div');
    chatsDiv.className = 'folder-chats' + (f.collapsed ? ' collapsed' : '');
    chatsDiv.id = `fc_${f.id}`;
    chatsDiv.addEventListener('dragover', e => { if(state.draggedChatId) e.preventDefault(); });
    chatsDiv.addEventListener('drop', e => { if(state.draggedChatId) onDropFolder(e, f.id); });
    fc.forEach(c => chatsDiv.appendChild(buildChatItem(c)));
    folderDiv.appendChild(header); folderDiv.appendChild(chatsDiv);
    frag.appendChild(folderDiv);
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
    header.addEventListener('dragover', e=>{if(state.draggedChatId){e.preventDefault();header.classList.add('drag-target');}});
    header.addEventListener('dragleave',()=>header.classList.remove('drag-target'));
    header.addEventListener('drop', e=>{ if(state.draggedChatId) onDropFolder(e,null); });
    header.addEventListener('click', e=>{ if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT') return; setActiveFolder(null); });
    const chatsDiv = document.createElement('div');
    chatsDiv.className = 'folder-chats';
    chatsDiv.addEventListener('dragover', e=>{if(state.draggedChatId)e.preventDefault();});
    chatsDiv.addEventListener('drop', e=>{if(state.draggedChatId)onDropFolder(e,null);});
    unfiled.forEach(c=>chatsDiv.appendChild(buildChatItem(c)));
    folderDiv.appendChild(header); folderDiv.appendChild(chatsDiv);
    frag.appendChild(folderDiv);
  }

  container.appendChild(frag);

  (_renderSidebarListeners || []).forEach(fn => fn());
}

export function buildChatItem(c) {
  const div = document.createElement('div');
  const isSelected = _selectedChatIds.has(c.id);
  div.className = 'chat-item'
    + (c.id === state.currentChatId ? ' active' : '')
    + (state._multiSelectMode && isSelected ? ' multi-selected' : '');
  div.draggable = !state._multiSelectMode || isSelected;
  div.dataset.id = c.id;

  // Checkbox for multi-select mode
  const cb = document.createElement('span');
  cb.className = 'chat-item-cb';
  cb.textContent = isSelected ? '☑' : '☐';
  cb.addEventListener('click', e => { e.stopPropagation(); toggleChatSelect(c.id); });

  div.addEventListener('dragstart', e => {
    if (state._multiSelectMode && !isSelected) { e.preventDefault(); return; }
    e.stopPropagation(); onDragStart(e, div.dataset.id);
  });
  // Dropping a chat directly onto another chat item reorders them within
  // the same folder, instead of just moving between folders.
  div.addEventListener('dragover', e => {
    if (!state.draggedChatId || state.draggedChatId === c.id) return;
    e.preventDefault(); e.stopPropagation();
    div.classList.add('chat-drag-over');
  });
  div.addEventListener('dragleave', () => div.classList.remove('chat-drag-over'));
  div.addEventListener('drop', e => {
    if (!state.draggedChatId) return;
    e.preventDefault(); e.stopPropagation();
    div.classList.remove('chat-drag-over');
    if (state.draggedChatId !== c.id) reorderChatTo(state.draggedChatId, c.id);
    state.draggedChatId = null;
  });
  div.addEventListener('click', () => {
    if (state._multiSelectMode) { toggleChatSelect(div.dataset.id); return; }
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
  // Live-indicator: a pulsing dot next to the title while this chat has an
  // in-flight run, most useful when it's NOT the one on screen.
  if (isChatStreaming(c.id)) {
    const liveDot = document.createElement('span');
    liveDot.className = 'chat-item-live-dot';
    liveDot.title = t('js.chatStreamingHint');
    titleSpan.insertAdjacentElement('afterend', liveDot);
  }
  div.appendChild(menuBtn);
  return div;
}

export function getActivePath(chat) {
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

export function getActiveContainer(chat) {
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

window.kicGetActivePath  = () => { const c = currentChat(); return c ? getActivePath(c) : []; };

window.kicGetMsgByIdx    = (idx) => { const path = window.kicGetActivePath(); const n = parseInt(idx, 10); return (Number.isFinite(n) && n >= 0) ? (path[n] || null) : null; };

window.kicCurrentChat    = () => currentChat();

export function handleDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='copy';}

export function handleDragEnter(e){e.preventDefault();state._dragCounter++;document.getElementById('dropOverlay').classList.add('active');}

export function handleDragLeave(){state._dragCounter--;if(state._dragCounter<=0){state._dragCounter=0;document.getElementById('dropOverlay').classList.remove('active');}}
