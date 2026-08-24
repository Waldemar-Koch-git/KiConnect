import { decryptObj, decryptProvider, encryptObj, encryptProvider } from './crypto.js';
import { t } from '../core/i18n.js';
import { freshConfig, state } from '../core/state.js';
import { getMaxImageStorageBytes, toast } from '../ui/misc-ui.js';
import { WEB_SEARCH_RESULT_MAX } from '../websearch/web-search.js';

export function _saveOrCache() {
  try { localStorage.setItem('kic_or_model_meta', JSON.stringify(state._orModelMeta)); } catch(e) {}
}

export const _STORE_BASE = '/store';

export async function _storeGet(accountId, key) {
  if (!state._storeAvailable) return _lsGetRaw(accountId, key);
  try {
    const res = await fetch(`${_STORE_BASE}/${accountId}/${key}`, { method: 'GET' });
    if (!res.ok) { if (res.status === 404) return null; throw new Error(res.status); }
    const text = await res.text();
    if (!text || text === 'null') return null;
    return JSON.parse(text); // encrypted string or value
  } catch (e) {
    console.warn('[store] GET failed, fallback to localStorage:', e.message);
    state._storeAvailable = false;
    return _lsGetRaw(accountId, key);
  }
}

export async function _storePut(accountId, key, value) {
  const payload = JSON.stringify(value);
  if (state._storeAvailable) {
    try {
      const res = await fetch(`${_STORE_BASE}/${accountId}/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (!res.ok) throw new Error(res.status);
      _lsSetRaw(accountId, key, payload); // Mirror in localStorage
      return;
    } catch (e) {
      console.warn('[store] PUT failed, fallback to localStorage:', e.message);
      state._storeAvailable = false;
    }
  }
  _lsSetRaw(accountId, key, payload);
}

export async function _storeDel(accountId, key) {
  if (state._storeAvailable) {
    try { await fetch(`${_STORE_BASE}/${accountId}/${key}`, { method: 'DELETE' }); } catch {}
  }
  localStorage.removeItem(`kic_${accountId}_${key}`);
}

export async function _storeListKeys(accountId) {
  if (!state._storeAvailable) return null;
  try {
    const res = await fetch(`${_STORE_BASE}/${accountId}`, { method: 'GET' });
    if (!res.ok) return null;
    const keys = await res.json();
    return Array.isArray(keys) ? keys : null;
  } catch {
    return null;
  }
}

export async function _storeDeleteAccountDir(accountId) {
  if (!state._storeAvailable) return;
  try { await fetch(`${_STORE_BASE}/${accountId}`, { method: 'DELETE' }); } catch {}
}

export async function _registryGet() {
  if (state._storeAvailable) {
    try {
      const res = await fetch(`${_STORE_BASE}/`, { method: 'GET' });
      if (res.ok) { const t = await res.text(); if (t && t !== 'null') return JSON.parse(t); }
    } catch (e) { console.warn('[store] registry GET failed:', e.message); state._storeAvailable = false; }
  }
  try { return JSON.parse(localStorage.getItem('kic_accounts') || '[]'); } catch { return []; }
}

export async function _registryPut(data) {
  const payload = JSON.stringify(data);
  if (state._storeAvailable) {
    try {
      const res = await fetch(`${_STORE_BASE}/`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload,
      });
      if (!res.ok) throw new Error(res.status);
    } catch (e) { console.warn('[store] registry PUT failed:', e.message); state._storeAvailable = false; }
  }
  localStorage.setItem('kic_accounts', payload);
}

export function _lsGetRaw(accountId, key) {
  const v = localStorage.getItem(`kic_${accountId}_${key}`);
  if (v === null) return null;
  try { return JSON.parse(v); } catch { return v; }
}

export function _lsSetRaw(accountId, key, rawStr) {
  try { localStorage.setItem(`kic_${accountId}_${key}`, rawStr); } catch {}
}

export async function loadAccountRegistryAsync() {
  try { state._accounts = await _registryGet() || []; } catch { state._accounts = []; }
}

export function saveAccountRegistry() {
  _registryPut(state._accounts).catch(() => {});
}

export function sanitizeMsgForStorage(msg) {
  if (!Array.isArray(msg.content)) return msg;
  const maxBytes = getMaxImageStorageBytes();

  // Collect names of file content blocks that are stripped, so _files stays intact
  // and the chips are still shown after reload (as _storedOnly stubs).
  const strippedFileNames = new Set();

  const safeContent = msg.content.map(p => {
    // Images
    if (p.type === 'image_url') {
      const url = p.image_url?.url || '';
      if (url.startsWith('data:') && url.length > maxBytes) {
        return { type: 'text', text: '[' + t('js.imageNotSaved') + ']' };
      }
      return p;
    }
    // PDF (base64)
    // Binary PDFs can be very large; strip the data, keep a sentinel so
    // the message is re-sendable after a "re-attach" by the user.
    if (p.type === 'pdf_base64') {
      if (p.name) strippedFileNames.add(p.name);
      // Keep the block but without the binary payload to avoid RangeError.
      return { type: 'pdf_base64_ref', name: p.name };
    }
    // PDF (extracted text)
    if (p.type === 'pdf_text') {
      if (p.name) strippedFileNames.add(p.name);
      return { type: 'pdf_text_ref', name: p.name };
    }
    // Plain text-file content
    // These are stored as a text block starting with '--- Content of "…" ---'
    if (p.type === 'text' && typeof p.text === 'string' && p.text.startsWith('--- ')) {
      const fname = p.text.match(/^--- Content of "(.+?)" ---/)?.[1];
      if (fname) strippedFileNames.add(fname);
      return { type: 'text_file_ref', name: fname || '?' };
    }
    return p;
  });

  // Ensure every stripped file is listed in _files so the chip renders on reload.
  const existingFiles = new Set(msg._files || []);
  strippedFileNames.forEach(n => existingFiles.add(n));
  const newFiles = existingFiles.size > 0 ? [...existingFiles] : undefined;

  const result = { ...msg, content: safeContent };
  if (newFiles) result._files = newFiles;
  return result;
}

export function resetSaveCache() { state._saveCache = null; }

export async function save() {
  if (state._saveInFlight) {
    state._savePending = true;
    return state._saveInFlight;
  }
  state._saveInFlight = _performSave();
  try {
    return await state._saveInFlight;
  } finally {
    state._saveInFlight = null;
    if (state._savePending) {
      state._savePending = false;
      save(); // fire-and-forget: capture whatever changed while we were saving
    }
  }
}

export async function _performSave() {
  if (!state._activeAccountId) return;
  if (!state._saveCache) state._saveCache = {};
  const cache = state._saveCache;
  try {
    // Compute plaintext JSON for each section up front (cheap) so we can
    // diff against the last-saved version and skip untouched sections.
    const chatsToStore = state.chats.slice(0, 200).map(c => ({
      ...c,
      messages: c.messages.map(sanitizeMsgForStorage),
    }));
    const sections = {
      config: JSON.stringify(state.config),
      providers: JSON.stringify(state.providers),
      profiles: JSON.stringify(state.profiles),
      profileFolders: JSON.stringify(state.profileFolders),
      folders: JSON.stringify(state.folders),
      chats: JSON.stringify(chatsToStore),
    };

    const dirtyKeys = Object.keys(sections).filter(k => cache[k] !== sections[k]);

    if (dirtyKeys.length) {
      const encryptedEntries = await Promise.all(dirtyKeys.map(async key => {
        if (key === 'providers') {
          const encProviders = await Promise.all(state.providers.map(encryptProvider));
          return [key, await encryptObj(encProviders)];
        }
        const plainByKey = { config: state.config, profiles: state.profiles, profileFolders: state.profileFolders, folders: state.folders, chats: chatsToStore };
        return [key, await encryptObj(plainByKey[key])];
      }));
      await Promise.all(encryptedEntries.map(([key, encVal]) => _storePut(state._activeAccountId, key, encVal)));
      // Only update the cache after a successful write for each section.
      dirtyKeys.forEach(k => { cache[k] = sections[k]; });
    }

    // These are cheap already (no encryption, tiny payloads) but still cost
    // a network round-trip each — skip the PUT when unchanged too.
    if (state.currentChatId && cache._currentChatId !== state.currentChatId) {
      await _storePut(state._activeAccountId, 'current_chat', state.currentChatId);
      cache._currentChatId = state.currentChatId;
    }
    const sidebarW = document.getElementById('sidebar')?.style.width || '';
    if (cache._sidebarW !== sidebarW) {
      await _storePut(state._activeAccountId, 'sidebar_w', sidebarW);
      cache._sidebarW = sidebarW;
    }
    const sidebarCollapsedVal = state.sidebarCollapsed ? '1' : '';
    if (cache._sidebarCollapsed !== sidebarCollapsedVal) {
      await _storePut(state._activeAccountId, 'sidebar_collapsed', sidebarCollapsedVal);
      cache._sidebarCollapsed = sidebarCollapsedVal;
    }
  } catch (e) {
    console.error('[save] error:', e);
    // Only show storageFull toast for genuine quota errors — not for network/server errors.
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      toast(t('js.storageFull'));
    } else if (e?.message && /quota/i.test(e.message)) {
      toast(t('js.storageFull'));
    }
    // Other errors (fetch failures, missing DOM elements, etc.) are silent — already logged above.
  }
}

export async function load() {
  if (!state._activeAccountId) return;
  // Fresh account/session -> save()'s dirty-tracking cache must not carry
  // over stale plaintext snapshots from a previously loaded account.
  resetSaveCache();
  async function loadKey(key, fallback) {
    let raw = await _storeGet(state._activeAccountId, key);
    if (raw === null || raw === undefined) {
      // Migration: old localStorage entry
      const ls = localStorage.getItem(`kic_${state._activeAccountId}_${key}`);
      if (!ls) return fallback;
      raw = ls;
    }
    const dec = await decryptObj(raw, null);
    if (dec !== null) return dec;
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  try { state.config = {...freshConfig(), ...state.config, ...await loadKey('config', {})}; } catch{}
  if (!['manual','auto','always','off','agentic'].includes(state.config.webSearchMode)) state.config.webSearchMode = 'manual';
  if (!['free','duckduckgo','searxng','qwant','yahoo','startpage','brave','google','bing','mojeek','yandex','langsearch'].includes(state.config.webSearchEngine)) state.config.webSearchEngine = 'free';
  state.config.webSearchResultCount = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(state.config.webSearchResultCount) || 8));
  state.config.webLinkEnabled = !!state.config.webLinkEnabled;
  try {
    const rawProviders = await loadKey('providers', []);
    state.providers = await Promise.all(rawProviders.map(decryptProvider));
  } catch{}
  try { state.profiles = await loadKey('profiles', []); } catch{}
  try { state.profileFolders = await loadKey('profileFolders', []); } catch{}
  try { state.folders  = await loadKey('folders',  []); } catch{}
  try { state.chats    = await loadKey('chats',    []); } catch{}

  let savedCurrentChat = await _storeGet(state._activeAccountId, 'current_chat');
  if (!savedCurrentChat) savedCurrentChat = localStorage.getItem(`kic_${state._activeAccountId}_current_chat`);
  if (savedCurrentChat) {
    const v = typeof savedCurrentChat === 'string' ? savedCurrentChat.replace(/^"|"$/g, '') : String(savedCurrentChat);
    if (v) state.currentChatId = v;
  }

  let savedW = await _storeGet(state._activeAccountId, 'sidebar_w');
  if (!savedW) savedW = localStorage.getItem(`kic_${state._activeAccountId}_sidebar_w`);
  if (savedW) {
    const w = typeof savedW === 'string' ? savedW.replace(/^"|"$/g,'') : '';
    if (w) document.getElementById('sidebar').style.width = w;
  }

  let collapsed = await _storeGet(state._activeAccountId, 'sidebar_collapsed');
  if (!collapsed) collapsed = localStorage.getItem(`kic_${state._activeAccountId}_sidebar_collapsed`);
  if (collapsed === '1' || collapsed === '"1"') {
    state.sidebarCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
  }
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
