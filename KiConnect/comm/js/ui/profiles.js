// js/ui/profiles.js — extracted from kiconnect.js (Phase 4 of the v3.5.1→v4.0.0 modularization)
import { save } from '../auth/storage.js';
import { _buildFolderCtxMenu } from '../chat/chat-sidebar.js';
import { t, tf } from '../core/i18n.js';
import { state } from '../core/state.js';
import { getModelMaxOutput, splitModelId } from '../providers/provider-models.js';
import { getSelectedColor, renderColorRow, syncSettingsPanel, toast } from './misc-ui.js';

export const PROFILE_COLORS = ['#3d7eff','#7c5cfc','#2ecc71','#e74c3c','#f39c12','#1abc9c','#e91e63','#ff6b35'];

export function activeProfile() { return state.profiles.find(p => p.id === state.config.activeProfileId) || null; }

export function applyProfile(p) {
  if (!p) return;
  state.config.activeProfileId = p.id;
  state.config.systemPrompt  = p.systemPrompt ?? '';
  state.config.temperature   = p.temperature  ?? 0.7;
  syncSettingsPanel(); updateProfileBadge();
  const sel = document.getElementById('modelSelector');
  if (sel && state.config.model) {
    sel.value = state.config.model;
    const inp = document.getElementById('modelInput');
    if (inp) inp.value = state.config.model;
  }
  save(); toast(`${t('js.profileActivated')}: „${p.name}"`);
}

export function updateProfileBadge() {
  const p = activeProfile();
  // Update legacy badge name (hidden via CSS but keep for safety)
  const nameEl = document.getElementById('profileBadgeName');
  if (nameEl) {
    if (p) { nameEl.textContent = p.name; nameEl.removeAttribute('data-i18n'); }
    else   { nameEl.textContent = t('header.noProfile'); nameEl.setAttribute('data-i18n','header.noProfile'); }
  }
  // Update profile color dot in toolbar button
  const dot = document.getElementById('profileBadgeDot');
  if (dot) {
    const col = p ? p.color : 'var(--muted)';
    dot.style.background = col;
    dot.style.boxShadow = p ? `0 0 6px ${col}` : 'none';
  }
  // Update Profil button label to show active profile name
  const profileBtn = document.getElementById('openProfileHeaderBtn');
  if (profileBtn) {
    const lbl = profileBtn.querySelector('.ptb-label');
    if (lbl) {
      if (p) {
        lbl.textContent = p.name;
        lbl.removeAttribute('data-i18n');
      } else {
        lbl.textContent = t('toolbar.profiles');
        lbl.setAttribute('data-i18n', 'toolbar.profiles');
      }
    }
  }
}

export function renderProfileList() {
  const list = document.getElementById('profileList');
  list.innerHTML = '';
  if (!state.profiles.length && !state.profileFolders.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;padding:12px;';
    msg.textContent = t('js.noProfileList');
    list.appendChild(msg);
    return;
  }

  const unfiled = state.profiles.filter(p => !p.folderId || !state.profileFolders.find(f => f.id === p.folderId));

  state.profileFolders.forEach(f => {
    const fp = state.profiles.filter(p => p.folderId === f.id);
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder';
    folderDiv.draggable = true;
    folderDiv.dataset.folderId = f.id;
    folderDiv.addEventListener('dragstart', e => {
      if (!state.draggedProfileId) {
        e.stopPropagation();
        onProfileFolderDragStart(e, f.id);
        folderDiv.classList.add('folder-dragging');
      }
    });
    folderDiv.addEventListener('dragend', () => {
      folderDiv.classList.remove('folder-dragging');
      document.querySelectorAll('.folder-drag-over').forEach(el => el.classList.remove('folder-drag-over'));
    });
    folderDiv.addEventListener('dragover', e => {
      if (state.draggedProfileFolderId && state.draggedProfileFolderId !== f.id) {
        e.preventDefault(); e.stopPropagation();
        folderDiv.classList.add('folder-drag-over');
      }
    });
    folderDiv.addEventListener('dragleave', e => {
      if (!folderDiv.contains(e.relatedTarget)) folderDiv.classList.remove('folder-drag-over');
    });
    folderDiv.addEventListener('drop', e => {
      if (state.draggedProfileFolderId) onProfileFolderDrop(e, f.id);
      else onDropProfileFolder(e, f.id);
    });

    const header = document.createElement('div');
    header.className = 'folder-header';
    header.id = `pfh_${f.id}`;
    const arrow = document.createElement('span');
    arrow.className = 'folder-arrow ' + (f.collapsed ? '' : 'open');
    arrow.textContent = '▶';
    arrow.addEventListener('click', e => { e.stopPropagation(); toggleProfileFolder(f.id); });
    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    icon.textContent = f.collapsed ? '📁' : '📂';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-name';
    nameSpan.id = `pfname_${f.id}`;
    nameSpan.textContent = f.name;
    const countSpan = document.createElement('span');
    countSpan.className = 'folder-count'; countSpan.textContent = fp.length;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'folder-actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-btn'; renameBtn.textContent = '✏️';
    renameBtn.title = t('js.edit');
    renameBtn.addEventListener('click', e => { e.stopPropagation(); startRenamingProfileFolder(f.id); });
    const delBtn = document.createElement('button');
    delBtn.className = 'folder-btn danger'; delBtn.textContent = '🗑';
    delBtn.title = t('js.delete');
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteProfileFolder(f.id); });
    actionsDiv.appendChild(renameBtn); actionsDiv.appendChild(delBtn);
    header.appendChild(arrow); header.appendChild(icon); header.appendChild(nameSpan); header.appendChild(countSpan); header.appendChild(actionsDiv);
    header.addEventListener('dragover', e => {
      if (state.draggedProfileId) { e.preventDefault(); header.classList.add('drag-target'); }
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-target'));
    header.addEventListener('drop', e => { if (state.draggedProfileId) onDropProfileFolder(e, f.id); });
    header.addEventListener('click', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      f.collapsed = !f.collapsed; save(); renderProfileList();
    });
    // Double-click = collapse the folder (renaming is only ever triggered via the context menu or the ✏️ button)
    header.addEventListener('dblclick', e => {
      if (e.target.closest('.folder-actions') || e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      if (!f.collapsed) { f.collapsed = true; save(); renderProfileList(); }
    });
    // Right-click = context menu with folder options (Rename / Move / Delete)
    header.addEventListener('contextmenu', e => showProfileFolderCtxMenu(e, f.id));


    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'folder-chats' + (f.collapsed ? ' collapsed' : '');
    itemsDiv.id = `pfc_${f.id}`;
    itemsDiv.addEventListener('dragover', e => { if (state.draggedProfileId) e.preventDefault(); });
    itemsDiv.addEventListener('drop', e => { if (state.draggedProfileId) onDropProfileFolder(e, f.id); });
    fp.forEach(p => itemsDiv.appendChild(buildProfileItem(p)));
    folderDiv.appendChild(header); folderDiv.appendChild(itemsDiv);
    list.appendChild(folderDiv);
  });

  if (state.profileFolders.length > 0) {
    // "No folder" group, only shown once at least one real folder exists —
    // now collapsible like a real folder (was previously always expanded
    // with no way to hide it, which got noisy once several unfiled
    // profiles piled up).
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder unfiled-group';
    const header = document.createElement('div');
    header.className = 'folder-header';
    const arrow = document.createElement('span');
    arrow.className = 'folder-arrow ' + (state.unfiledProfilesCollapsed ? '' : 'open');
    arrow.textContent = '▶';
    const icon = document.createElement('span');
    icon.className = 'folder-icon'; icon.textContent = state.unfiledProfilesCollapsed ? '📁' : '🗂️';
    const nameSpan = document.createElement('span'); nameSpan.className = 'folder-name'; nameSpan.textContent = t('js.noFolder');
    const countSpan = document.createElement('span'); countSpan.className = 'folder-count'; countSpan.textContent = unfiled.length;
    header.appendChild(arrow); header.appendChild(icon); header.appendChild(nameSpan); header.appendChild(countSpan);
    header.addEventListener('dragover', e => { if (state.draggedProfileId) { e.preventDefault(); header.classList.add('drag-target'); } });
    header.addEventListener('dragleave', () => header.classList.remove('drag-target'));
    header.addEventListener('drop', e => { if (state.draggedProfileId) onDropProfileFolder(e, null); });
    header.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      toggleUnfiledProfiles();
    });
    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'folder-chats' + (state.unfiledProfilesCollapsed ? ' collapsed' : '');
    itemsDiv.id = 'pfc_unfiled';
    itemsDiv.addEventListener('dragover', e => { if (state.draggedProfileId) e.preventDefault(); });
    itemsDiv.addEventListener('drop', e => { if (state.draggedProfileId) onDropProfileFolder(e, null); });
    unfiled.forEach(p => itemsDiv.appendChild(buildProfileItem(p)));
    folderDiv.appendChild(header); folderDiv.appendChild(itemsDiv);
    list.appendChild(folderDiv);
    return;
  }

  // No real folders exist yet — nothing to group against, so just list the
  // (necessarily unfiled) profiles plainly without a collapsible wrapper.
  const unfiledDiv = document.createElement('div');
  unfiledDiv.className = 'profile-list';
  unfiledDiv.addEventListener('dragover', e => { if (state.draggedProfileId) e.preventDefault(); });
  unfiledDiv.addEventListener('drop', e => { if (state.draggedProfileId) onDropProfileFolder(e, null); });
  unfiled.forEach(p => unfiledDiv.appendChild(buildProfileItem(p)));
  list.appendChild(unfiledDiv);
}

export function toggleUnfiledProfiles() {
  state.unfiledProfilesCollapsed = !state.unfiledProfilesCollapsed;
  localStorage.setItem('kic_unfiled_profiles_collapsed', state.unfiledProfilesCollapsed ? '1' : '');
  renderProfileList();
}

export function buildProfileItem(p) {
  const item = document.createElement('div');
  item.className = 'profile-item' + (p.id === state.config.activeProfileId ? ' active' : '');
  item.dataset.id = p.id;
  item.draggable = true;
  item.addEventListener('dragstart', e => { e.stopPropagation(); onProfileDragStart(e, p.id); });
  item.addEventListener('dragover', e => {
    if (!state.draggedProfileId || state.draggedProfileId === p.id) return;
    e.preventDefault(); e.stopPropagation();
    item.classList.add('profile-drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('profile-drag-over'));
  item.addEventListener('drop', e => {
    if (!state.draggedProfileId) return;
    e.preventDefault(); e.stopPropagation();
    item.classList.remove('profile-drag-over');
    if (state.draggedProfileId !== p.id) reorderProfileTo(state.draggedProfileId, p.id);
    state.draggedProfileId = null;
  });
  item.addEventListener('click', () => selectProfile(item.dataset.id));
  const dot = document.createElement('div');
  dot.className = 'profile-item-dot'; dot.style.background = p.color;
  const info = document.createElement('div');
  info.className = 'profile-item-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'profile-item-name'; nameEl.textContent = p.name;
  const descEl = document.createElement('div');
  descEl.className = 'profile-item-desc';
  descEl.textContent = 'Temp ' + (p.temperature ?? 0.7);
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
  return item;
}

export function newProfileFolder() {
  const id = Date.now().toString();
  state.profileFolders.push({ id, name: t('js.newFolder'), collapsed: false });
  save(); renderProfileList(); setTimeout(() => startRenamingProfileFolder(id), 50);
}

export function deleteProfileFolder(id) {
  const f = state.profileFolders.find(x => x.id === id);
  const inside = state.profiles.filter(p => p.folderId === id);
  if (inside.length && !confirm(tf('js.deleteProfileFolderConfirm', { name: f?.name || '', n: inside.length }))) return;
  inside.forEach(p => { p.folderId = null; });
  state.profileFolders = state.profileFolders.filter(f => f.id !== id);
  save(); renderProfileList();
}

export function toggleProfileFolder(id) {
  const f = state.profileFolders.find(x => x.id === id);
  if (f) { f.collapsed = !f.collapsed; save(); renderProfileList(); }
}

export function startRenamingProfileFolder(id) {
  const nameEl = document.getElementById(`pfname_${id}`);
  const f = state.profileFolders.find(x => x.id === id);
  if (!nameEl || !f) return;
  const input = document.createElement('input');
  input.className = 'folder-name-input'; input.value = f.name;
  input.addEventListener('blur', () => commitRenameProfileFolder(id, input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  nameEl.replaceWith(input); input.focus(); input.select();
}

export function commitRenameProfileFolder(id, newName) {
  const f = state.profileFolders.find(x => x.id === id);
  if (f) f.name = (newName || '').trim() || f.name;
  save(); renderProfileList();
}

export function onProfileFolderDragStart(e, id) {
  state.draggedProfileFolderId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'profileFolder:' + id);
}

export function onProfileFolderDrop(e, targetId) {
  e.preventDefault(); e.stopPropagation();
  document.querySelectorAll('.folder-drag-over').forEach(el => el.classList.remove('folder-drag-over'));
  if (!state.draggedProfileFolderId || state.draggedProfileFolderId === targetId) { state.draggedProfileFolderId = null; return; }
  const fromIdx = state.profileFolders.findIndex(f => f.id === state.draggedProfileFolderId);
  const toIdx = state.profileFolders.findIndex(f => f.id === targetId);
  if (fromIdx === -1 || toIdx === -1) { state.draggedProfileFolderId = null; return; }
  const [moved] = state.profileFolders.splice(fromIdx, 1);
  state.profileFolders.splice(toIdx, 0, moved);
  state.draggedProfileFolderId = null;
  save(); renderProfileList();
}

export function onProfileDragStart(e, id) {
  state.draggedProfileId = id;
  e.dataTransfer.effectAllowed = 'move';
  if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'profile:' + id);
}

export function onDropProfileFolder(e, folderId) {
  e.preventDefault();
  document.querySelectorAll('.drag-target').forEach(el => el.classList.remove('drag-target'));
  if (!state.draggedProfileId) return;
  const p = state.profiles.find(x => x.id === state.draggedProfileId);
  if (p) p.folderId = folderId || null;
  state.draggedProfileId = null;
  save(); renderProfileList();
}

export function reorderProfileTo(draggedId, targetId) {
  const dragged = state.profiles.find(p => p.id === draggedId);
  const target = state.profiles.find(p => p.id === targetId);
  if (!dragged || !target) return;
  if (dragged.folderId !== target.folderId) dragged.folderId = target.folderId || null;
  const fromIdx = state.profiles.indexOf(dragged);
  let toIdx = state.profiles.indexOf(target);
  if (fromIdx === -1 || toIdx === -1) return;
  state.profiles.splice(fromIdx, 1);
  toIdx = state.profiles.indexOf(target);
  state.profiles.splice(toIdx + 1, 0, dragged);
  save(); renderProfileList();
}

export function selectProfile(id) { const p = state.profiles.find(x=>x.id===id); if(p) { applyProfile(p); renderProfileList(); } }

export function startNewProfile() {
  state.editingProfileId = null;
  document.getElementById('peNameInput').value  = '';
  document.getElementById('peSysPrompt').value  = '';
  document.getElementById('peTemp').value       = '0.7';
  document.getElementById('peTempVal').textContent = '0.7';
  document.getElementById('peUseModelMax').checked = true;
  document.getElementById('profileEditorTitle').textContent = t('profile.new');
  renderColorRow(PROFILE_COLORS[state.profiles.length % PROFILE_COLORS.length]);
  document.getElementById('profileEditor').style.display = 'block';
}

export function editProfile(id) {
  const p = state.profiles.find(x=>x.id===id); if(!p) return;
  state.editingProfileId = id;
  document.getElementById('peNameInput').value     = p.name;
  document.getElementById('peSysPrompt').value     = p.systemPrompt||'';
  document.getElementById('peTemp').value          = p.temperature??0.7;
  document.getElementById('peTempVal').textContent = p.temperature??0.7;
  document.getElementById('peUseModelMax').checked = p.useModelMax !== false;
  document.getElementById('profileEditorTitle').textContent = t('profile.edit');
  renderColorRow(p.color);
  const { modelId } = splitModelId(state.config.model);
  const modelMax = getModelMaxOutput(modelId);
  const slider = document.getElementById('peMaxTokensSlider');
  const storedVal = p.maxTokens || modelMax;
  slider.max = modelMax; slider.value = Math.min(storedVal, modelMax);
  document.getElementById('peMaxTokensNum').textContent = parseInt(slider.value).toLocaleString();
  document.getElementById('profileEditor').style.display = 'block';
}

export function saveProfileEditor() {
  const name = document.getElementById('peNameInput').value.trim();
  if (!name) { toast(t('js.nameRequired')); return; }
  const sliderVal = parseInt(document.getElementById('peMaxTokensSlider').value);
  const useModelMax = document.getElementById('peUseModelMax').checked;
  const data = {
    name, color: getSelectedColor(),
    systemPrompt: document.getElementById('peSysPrompt').value,
    temperature: parseFloat(document.getElementById('peTemp').value),
    useModelMax, maxTokens: useModelMax ? null : sliderVal,
  };
  if (state.editingProfileId) {
    const idx = state.profiles.findIndex(p=>p.id===state.editingProfileId);
    if (idx !== -1) { state.profiles[idx] = {...state.profiles[idx], ...data}; if(state.config.activeProfileId===state.editingProfileId) applyProfile(state.profiles[idx]); }
  } else {
    const p = {id: Date.now().toString(), ...data}; state.profiles.push(p); applyProfile(p);
  }
  save(); renderProfileList(); document.getElementById('profileEditor').style.display = 'none'; toast(t('js.profileSaved'));
}

export function cancelProfileEditor() { document.getElementById('profileEditor').style.display = 'none'; }

export function deleteProfile(id) {
  state.profiles = state.profiles.filter(p=>p.id!==id);
  if (state.config.activeProfileId === id) {
    state.config.activeProfileId = null; state.config.systemPrompt = ''; state.config.temperature = 0.7; state.config.maxTokens = null;
    if (state.profiles[0]) applyProfile(state.profiles[0]); else { updateProfileBadge(); syncSettingsPanel(); }
  }
  save(); renderProfileList();
}

export function showProfileFolderCtxMenu(e, folderId) {
  _buildFolderCtxMenu(e, folderId, state.profileFolders, {
    rename: startRenamingProfileFolder, moveUp: id => moveProfileFolder(id, -1), moveDown: id => moveProfileFolder(id, 1), del: deleteProfileFolder,
  });
}

export function moveProfileFolder(id, dir) {
  const idx = state.profileFolders.findIndex(f => f.id === id);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.profileFolders.length) return;
  const [moved] = state.profileFolders.splice(idx, 1);
  state.profileFolders.splice(newIdx, 0, moved);
  save(); renderProfileList();
}

export function openProfilePanel(){renderProfileList();document.getElementById('profilePanel').classList.add('open');document.getElementById('overlay').classList.add('show');document.querySelector('[data-panel="profilePanel"]')?.classList.add('active');}
