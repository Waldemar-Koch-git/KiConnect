// js/auth/accounts.js — extracted from kiconnect.js (Phase 4 of the v3.5.1→v4.0.0 modularization)
import { deriveRawBitsPBKDF2, getCryptoKey, hashPasswordPBKDF2 } from './crypto.js';
import { _registryPut, _storeDel, _storeDeleteAccountDir, _storeListKeys, loadAccountRegistryAsync, resetSaveCache, save, saveAccountRegistry } from './storage.js';
import { bootApp, closePanels, setupEventListeners, showView } from '../core/boot.js';
import { applyTranslations, t, tf } from '../core/i18n.js';
import { freshConfig, state } from '../core/state.js';
import { toast } from '../ui/misc-ui.js';

export const _loginFailures = {};

export const BF_MAX_ATTEMPTS = 5;

export const BF_BASE_DELAY_MS = 30000;

export function _recordLoginFailure(accountId) {
  if (!_loginFailures[accountId]) _loginFailures[accountId] = { count: 0, lockedUntil: 0 };
  _loginFailures[accountId].count++;
  const n = _loginFailures[accountId].count;
  if (n >= BF_MAX_ATTEMPTS) {
    // Exponential backoff: 30s, 60s, 120s ...
    const delay = BF_BASE_DELAY_MS * Math.pow(2, n - BF_MAX_ATTEMPTS);
    _loginFailures[accountId].lockedUntil = Date.now() + Math.min(delay, 3600000);
  }
}

export function _resetLoginFailures(accountId) { delete _loginFailures[accountId]; }

export function _loginLockRemaining(accountId) {
  const f = _loginFailures[accountId];
  if (!f || !f.lockedUntil) return 0;
  const rem = f.lockedUntil - Date.now();
  return rem > 0 ? rem : 0;
}

export function _startLockCountdown(accountId, errorEl, btn, input) {
  if (state._lockCountdownTimer) clearInterval(state._lockCountdownTimer);
  state._lockCountdownTimer = setInterval(() => {
    const rem = _loginLockRemaining(accountId);
    if (rem <= 0) {
      clearInterval(state._lockCountdownTimer);
      state._lockCountdownTimer = null;
      errorEl.textContent = '';
      if (btn) btn.disabled = false;
      if (input) { input.disabled = false; input.focus(); }
    } else {
      const secs = Math.ceil(rem / 1000);
      errorEl.textContent = '⏳ ' + tf('login.lockedFor', { s: secs });
      if (btn) btn.disabled = true;
      if (input) input.disabled = true;
    }
  }, 1000);
}

export function _stopLockCountdown() {
  if (state._lockCountdownTimer) { clearInterval(state._lockCountdownTimer); state._lockCountdownTimer = null; }
}

export const _SESSION_TOKEN_KEY = 'kic_st';

export async function _writeSessionToken() {
  if (!state._cryptoKey || !state._activeAccountId) return;
  try {
    const payload = JSON.stringify({ accountId: state._activeAccountId, ts: Date.now() });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, state._cryptoKey,
      new TextEncoder().encode(payload)
    );
    const combined = new Uint8Array(iv.byteLength + enc.byteLength);
    combined.set(iv, 0); combined.set(new Uint8Array(enc), iv.byteLength);
    sessionStorage.setItem(_SESSION_TOKEN_KEY, btoa(String.fromCharCode(...combined)));
  } catch {}
}

export async function _validateSessionToken(accountId) {
  if (!state._cryptoKey) return false;
  try {
    const raw = sessionStorage.getItem(_SESSION_TOKEN_KEY);
    if (!raw) return false;
    const data = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    const iv = data.slice(0, 12); const ct = data.slice(12);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, state._cryptoKey, ct);
    const payload = JSON.parse(new TextDecoder().decode(dec));
    return payload.accountId === accountId && (Date.now() - payload.ts) < 86400000;
  } catch { return false; }
}

export function setSessionPassphrase(pw) {
  state._sessionPassphrase = pw || null;
  state._cryptoKey = null; // invalidate key cache
  if (!pw) { try { sessionStorage.removeItem(_SESSION_TOKEN_KEY); } catch {} }
  // No password in sessionStorage anymore!
  // _writeSessionToken() is called after getCryptoKey().
}

export function restoreSessionPassphrase() {
  // Only checks whether a token is present; validation happens async in checkLogin().
  return !!sessionStorage.getItem(_SESSION_TOKEN_KEY);
}

export var _sessionUnlockListeners, _sessionRekeyListeners, _sessionLockListeners;

export function onSessionUnlock(cb) { (_sessionUnlockListeners || (_sessionUnlockListeners = [])).push(cb); }

export function onSessionRekey(cb) { (_sessionRekeyListeners || (_sessionRekeyListeners = [])).push(cb); }

export function onSessionLock(cb) { (_sessionLockListeners || (_sessionLockListeners = [])).push(cb); }

export async function unlockAgentSession(...args) {
  const r = await unlockAgentSessionOriginal(...args);
  (_sessionUnlockListeners || []).forEach(fn => fn());
  return r;
}

export async function unlockAgentSessionOriginal() {
  const acc = getAccount(state._activeAccountId);
  if (!acc || !state._sessionPassphrase) return;
  let agentSalt = acc.agentSalt;
  if (!agentSalt) {
    const saltBuf = crypto.getRandomValues(new Uint8Array(16));
    agentSalt = btoa(String.fromCharCode(...saltBuf));
    acc.agentSalt = agentSalt;
    await _registryPut(state._accounts); // persist before first use, same reasoning as encSalt
  }
  const saltBytes = Uint8Array.from(atob(agentSalt), c => c.charCodeAt(0));
  const passphrase = 'kic-agent-v1|' + state._sessionPassphrase;
  try {
    const rawKey = await deriveRawBitsPBKDF2(passphrase, saltBytes);
    const keyB64 = btoa(String.fromCharCode(...rawKey));
    const res = await fetch('/agent/session/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: state._activeAccountId, key: keyB64 }),
    });
    await _applyAgentSessionResponse(res);
  } catch {
    state._agentSessionToken = null; state._agentProjects = [];
  }
}

export async function _applyAgentSessionResponse(res) {
  if (!res.ok) { state._agentSessionToken = null; state._agentProjects = []; return; }
  const data = await res.json();
  state._agentSessionToken = data.token || null;
  state._agentProjects = Array.isArray(data.projects) ? data.projects : [];
}

export async function rekeyAgentSession(...args) {
  const r = await rekeyAgentSessionOriginal(...args);
  (_sessionRekeyListeners || []).forEach(fn => fn());
  return r;
}

export async function rekeyAgentSessionOriginal() {
  const acc = getAccount(state._activeAccountId);
  if (!state._agentSessionToken || !acc?.agentSalt || !state._sessionPassphrase) {
    return unlockAgentSession();
  }
  try {
    const saltBytes = Uint8Array.from(atob(acc.agentSalt), c => c.charCodeAt(0));
    const newRawKey = await deriveRawBitsPBKDF2('kic-agent-v1|' + state._sessionPassphrase, saltBytes);
    const newKeyB64 = btoa(String.fromCharCode(...newRawKey));
    const res = await fetch('/agent/session/rekey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...agentSessionHeader() },
      body: JSON.stringify({ newKey: newKeyB64 }),
    });
    await _applyAgentSessionResponse(res);
  } catch {
    state._agentSessionToken = null; state._agentProjects = [];
  }
}

export function lockAgentSession(...args) {
  (_sessionLockListeners || []).forEach(fn => fn());
  return lockAgentSessionOriginal(...args);
}

export function lockAgentSessionOriginal() {
  if (state._agentSessionToken) {
    fetch('/agent/session/lock', { method: 'POST', headers: { 'X-Agent-Session': state._agentSessionToken } }).catch(() => {});
  }
  state._agentSessionToken = null;
  state._agentProjects = [];
}

export function agentSessionHeader() {
  return state._agentSessionToken ? { 'X-Agent-Session': state._agentSessionToken } : {};
}

export async function storeAccountPasswordHash(accountId, pw) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltB64   = btoa(String.fromCharCode(...saltBytes));
  const hashB64   = await hashPasswordPBKDF2(pw, saltBytes);
  const acc = state._accounts.find(a => a.id === accountId);
  if (acc) { acc.pwHash = hashB64; acc.pwSalt = saltB64; acc.pwVersion = 2; saveAccountRegistry(); }
}

export async function verifyAccountPassword(accountId, pw) {
  const acc = getAccount(accountId);
  if (!acc || !acc.pwHash || acc.pwVersion !== 2) return false;
  try {
    const saltBytes = Uint8Array.from(atob(acc.pwSalt), c => c.charCodeAt(0));
    const candidate = await hashPasswordPBKDF2(pw, saltBytes);
    return candidate === acc.pwHash;
  } catch { return false; }
}

export function getAccount(id) { return state._accounts.find(a => a.id === id) || null; }

export function accountKey(key) { return `kic_${state._activeAccountId}_${key}`; }

export function _pullBackForOpenBlock(text, safeEnd) {
  const candidate = text.slice(0, safeEnd + 1);
  const lines = candidate.split('\n');
  lines.pop(); // candidate always ends in '\n' -> drop the trailing '' entry
  if (!lines.length) return safeEnd;

  const isBlank = (l) => l.trim() === '';
  // Only lines that actually start/end with a pipe count as table rows —
  // "2+ pipes anywhere" false-positived on prose like bra-ket notation "|0⟩".
  const isTableLine = (l) => {
    const t = l.trim();
    if (!t.includes('|')) return false;
    return t.startsWith('|') || t.endsWith('|');
  };
  const isListLine = (l) => /^[ \t]*([-*+]|\d+[.)])[ \t]+/.test(l);
  const isListContinuation = (l) => isListLine(l) || (!isBlank(l) && /^[ \t]+\S/.test(l));

  // Blank lines alone never close a list/table in CommonMark — a "loose"
  // list still parses as one list. Skip trailing blank lines and check the
  // last actual content line to decide whether we're still inside an open
  // block (otherwise each loose-list item got committed separately, producing
  // a broken "1., 1., 1." numbering once DOMPurify stripped the start attr).
  let lastNonBlank = lines.length - 1;
  while (lastNonBlank >= 0 && isBlank(lines[lastNonBlank])) lastNonBlank--;
  if (lastNonBlank < 0) return safeEnd; // candidate is all blank lines

  const lastLine = lines[lastNonBlank];
  let blockType = null;
  // Check list markers before the table heuristic — an unambiguous "1. "/
  // "- " prefix should never be overridden by a loose "contains a pipe"
  // match (see isTableLine note above).
  if (isListContinuation(lastLine)) blockType = 'list';
  else if (isTableLine(lastLine)) blockType = 'table';
  else return safeEnd; // plain prose line -> any earlier block is already closed

  // Walk backward while lines keep belonging to the same open block,
  // skipping over blank lines (they don't end a loose list/table either).
  let start = lastNonBlank;
  while (start > 0) {
    const prev = lines[start - 1];
    if (isBlank(prev)) { start--; continue; }
    if (blockType === 'table' && !isTableLine(prev)) break;
    if (blockType === 'list' && !isListContinuation(prev)) break;
    start--;
  }
  if (start === 0) return -1; // the whole candidate is one still-open block

  const before = lines.slice(0, start).join('\n');
  return before.length; // index of the \n right before the open block starts
}

export function _hasOpenMathBlock(text) {
  let dollar = false, bracket = false, paren = false, envDepth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('$$', i)) dollar = !dollar;
    else if (text.startsWith('\\[', i)) bracket = true;
    else if (text.startsWith('\\]', i)) bracket = false;
    else if (text.startsWith('\\(', i)) paren = true;
    else if (text.startsWith('\\)', i)) paren = false;
    else if (text.startsWith('\\begin{', i)) envDepth++;
    else if (text.startsWith('\\end{', i)) envDepth--;
  }
  return dollar || bracket || paren || envDepth > 0;
}

export function formatWebSearchBlock(search) {
  if (!search?.results?.length) return '';
  const lines = [
    `[Web search results for: "${search.query}"]`,
    t('web.modelInstruction'),
    '',
  ];
  search.results.forEach(r => {
    lines.push(`[${r.index}] ${r.title}`);
    lines.push(`URL: ${r.url}`);
    if (r.snippet) lines.push(`Snippet: ${r.snippet}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

export function stripQuotedAndCodeBlocks(text) {
  let inFence = false;
  return (text || '').split(/\r?\n/).map(line => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return ''; }
    if (inFence || /^\s*>/.test(line)) return '';
    return line;
  }).join('\n');
}

export function formatLinkedPagesBlock(pages) {
  if (!pages?.length) return '';
  const lines = [
    '[Linked page content]',
    'The user included URL(s). Use the fetched page text as external context. Cite linked pages with [L1], [L2], etc. when relevant, and say when the fetched text is insufficient.',
    '',
  ];
  pages.forEach((p, i) => {
    lines.push(`[L${i + 1}] ${p.title || p.url}`);
    lines.push(`URL: ${p.url}`);
    lines.push(`Content excerpt: ${p.text}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

export function toggleCodeBlockCollapse(btn) {
  const block = btn.closest('.code-block'); if (!block) return;
  const collapsed = block.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▶' : '▼';
  btn.title = collapsed ? (t('js.codeExpand')) : (t('js.codeCollapse'));
}

export const ACCOUNT_COLORS = ['#3d7eff','#7c5cfc','#2ecc71','#e74c3c','#f39c12','#1abc9c','#e91e63','#ff6b35','#00bcd4','#9c27b0'];

export function _showAccountViewAfterChange() {
  if (state._accounts.length === 0) {
    renderNewAccountColorRow();
    showView('newAccountView');
    setTimeout(() => document.getElementById('newAccountName')?.focus(), 80);
  } else {
    showView('accountSelectView');
    renderAccountGrid();
  }
}

export async function showLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) { ls.style.display = 'flex'; ls.classList.add('visible'); }
  await loadAccountRegistryAsync();
  _showAccountViewAfterChange();
  applyTranslations();
}

export function hideLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) { ls.style.display = 'none'; ls.classList.remove('visible'); }
}

export function renderAccountGrid() {
  const grid = document.getElementById('accountGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!state._accounts.length) {
    const msg = document.createElement('p');
    msg.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;width:100%;';
    msg.textContent = t('account.noAccounts');
    grid.appendChild(msg);
    return;
  }
  state._accounts.forEach(acc => {
    const tile = document.createElement('div');
    tile.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;padding:12px 10px;border-radius:14px;transition:background 0.15s;min-width:90px;';
    tile.addEventListener('mouseenter', () => tile.style.background = 'rgba(255,255,255,0.06)');
    tile.addEventListener('mouseleave', () => tile.style.background = '');
    tile.addEventListener('click', () => selectAccountForLogin(acc.id));

    const avatar = document.createElement('div');
    avatar.style.cssText = `width:64px;height:64px;border-radius:16px;background:${acc.color};display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 4px 16px ${acc.color}55;`;
    avatar.textContent = '🪪';

    const name = document.createElement('div');
    name.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);text-align:center;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.textContent = acc.name;

    tile.appendChild(avatar);
    tile.appendChild(name);
    grid.appendChild(tile);
  });
}

export function selectAccountForLogin(accountId) {
  _stopLockCountdown();
  state._selectedLoginAccountId = accountId;
  const acc = getAccount(accountId);
  if (!acc) return;
  // Show avatar + name in login view
  const avatarEl = document.getElementById('loginAvatarDisplay');
  const nameEl   = document.getElementById('loginAccountName');
  if (avatarEl) { avatarEl.style.background = acc.color; avatarEl.textContent = '🪪'; }
  if (nameEl)   nameEl.textContent = acc.name;
  document.getElementById('loginInput').value = '';
  document.getElementById('loginError').textContent = '';
  showView('accountLoginView');
  setTimeout(() => document.getElementById('loginInput')?.focus(), 80);
}

export async function doLogin() {
  const input = document.getElementById('loginInput');
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  const pw = input.value;
  if (!pw || !state._selectedLoginAccountId) return;

  // Check brute-force lockout
  const lockRemCheck = _loginLockRemaining(state._selectedLoginAccountId);
  if (lockRemCheck > 0) {
    const secs = Math.ceil(lockRemCheck / 1000);
    errorEl.textContent = '⏳ ' + tf('login.lockedFor', { s: secs });
    _startLockCountdown(state._selectedLoginAccountId, errorEl, btn, input);
    return;
  }

  // UI blockieren waehrend PBKDF2 laeuft (verhindert parallele Klicks)
  if (btn) btn.disabled = true;
  input.disabled = true;

  try {
    const ok = await verifyAccountPassword(state._selectedLoginAccountId, pw);
    if (ok) {
      _stopLockCountdown();
      _resetLoginFailures(state._selectedLoginAccountId);
      state._activeAccountId = state._selectedLoginAccountId;
      setSessionPassphrase(pw);
      // CryptoKey build + Session token write (kein password in sessionStorage)
      await getCryptoKey();
      await _writeSessionToken();
      await unlockAgentSession();
      localStorage.setItem('kic_active_account', state._activeAccountId);
      const durMs = getSessionDurationMs();
      if (durMs > 0) localStorage.setItem('kic_' + state._activeAccountId + '_session_expiry', String(Date.now() + durMs));
      input.value = ''; errorEl.textContent = '';
      hideLoginScreen();
      await bootApp();
      toast('\ud83d\udc4b ' + (getAccount(state._activeAccountId)?.name || ''));
    } else {
      _recordLoginFailure(state._selectedLoginAccountId);
      const failures = _loginFailures[state._selectedLoginAccountId]?.count || 0;
      const remaining = BF_MAX_ATTEMPTS - failures;
      if (remaining > 0) {
        errorEl.textContent = t('login.error') + ' (' + tf('login.attemptsLeft', { n: remaining }) + ')';
        input.value = ''; input.focus();
      } else {
        const secs = Math.ceil(_loginLockRemaining(state._selectedLoginAccountId) / 1000);
        errorEl.textContent = '🔒 ' + tf('login.lockedFor', { s: secs });
        input.value = '';
        _startLockCountdown(state._selectedLoginAccountId, errorEl, btn, input);
      }
    }
  } finally {
    // Only unlock if no countdown is running
    if (!state._lockCountdownTimer) {
      if (btn) btn.disabled = false;
      input.disabled = false;
    }
  }
}

export function updatePwdStrength(pw) {
  const bar = document.getElementById('pwdStrengthBar'); if (!bar) return;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const pct = (score / 5) * 100;
  const cols = ['#e74c3c','#e74c3c','#f39c12','#f0c040','#2ecc71','#2ecc71'];
  bar.style.width = pct + '%'; bar.style.background = cols[score] || '#e74c3c';
}

export function renderNewAccountColorRow() {
  const row = document.getElementById('accountColorRow'); if (!row) return;
  row.innerHTML = '';
  const used = state._accounts.map(a => a.color);
  const defaultColor = ACCOUNT_COLORS.find(c => !used.includes(c)) || ACCOUNT_COLORS[state._accounts.length % ACCOUNT_COLORS.length];
  ACCOUNT_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.dataset.color = c;
    sw.style.cssText = `width:28px;height:28px;border-radius:8px;background:${c};cursor:pointer;transition:transform 0.1s,box-shadow 0.1s;flex-shrink:0;`;
    if (c === defaultColor) {
      sw.style.outline = '3px solid white';
      sw.style.outlineOffset = '2px';
      sw.dataset.selected = '1';
    }
    sw.addEventListener('click', () => {
      row.querySelectorAll('div').forEach(s => {
        s.style.outline = '';
        s.style.outlineOffset = '';
        delete s.dataset.selected;
      });
      sw.style.outline = '3px solid white';
      sw.style.outlineOffset = '2px';
      sw.dataset.selected = '1';
    });
    row.appendChild(sw);
  });
}

export async function doSetupPassword() {
  const nameEl   = document.getElementById('newAccountName');
  const pwdEl    = document.getElementById('setupPwdInput');
  const confEl   = document.getElementById('setupPwdConfirm');
  const errorEl  = document.getElementById('setupError');
  const name = nameEl?.value?.trim() || '';
  const pw   = pwdEl?.value || '';
  const conf = confEl?.value || '';
  if (!name) { if (errorEl) errorEl.textContent = t('js.nameRequired'); return; }
  // password length: kein Minimum enforced - strength indicator informiert den Benutzer
  if (pw !== conf) { if (errorEl) errorEl.textContent = t('js.pwdMismatch'); return; }
  // Pick selected color
  const colorRow = document.getElementById('accountColorRow');
  const selSw = colorRow?.querySelector('[data-selected]');
  const color = selSw?.dataset.color || ACCOUNT_COLORS[state._accounts.length % ACCOUNT_COLORS.length];
  // Create account
  // Random part uses crypto.getRandomValues (not Math.random(), too weak) —
  // 16 random bytes, hex-encoded. Matters because /store/<accountId>/... has
  // no separate password check of its own; the account ID is the only thing
  // stopping "just this account's blob" from becoming "any account's blob"
  // for anyone else reaching localhost:5000. Content stays encrypted either
  // way, but a guessable ID would let someone overwrite/delete another account.
  const _idBytes = new Uint8Array(16);
  crypto.getRandomValues(_idBytes);
  const accountId = Date.now().toString() + '_' + Array.from(_idBytes, b => b.toString(16).padStart(2, '0')).join('');
  state._accounts.push({ id: accountId, name, color, pwVersion: 2 });
  saveAccountRegistry();
  await storeAccountPasswordHash(accountId, pw);
  // Activate
  state._activeAccountId = accountId;
  setSessionPassphrase(pw);
  // Build CryptoKey and write session token
  await getCryptoKey();
  await _writeSessionToken();
  await unlockAgentSession();
  localStorage.setItem('kic_active_account', state._activeAccountId);
  const durMs = getSessionDurationMs();
  if (durMs > 0) localStorage.setItem('kic_' + state._activeAccountId + '_session_expiry', String(Date.now() + durMs));
  if (pwdEl) pwdEl.value = '';
  if (confEl) confEl.value = '';
  if (nameEl) nameEl.value = '';
  if (errorEl) errorEl.textContent = '';
  localStorage.setItem(accountKey('guided_intro_pending'), '1');
  hideLoginScreen();
  await bootApp();
  toast(t('js.pwdSetupDone'));
}

export async function forgotPassword() {
  if (!state._selectedLoginAccountId) {
    // No account selected — just go back to account selection
    showView('accountSelectView');
    renderAccountGrid();
    return;
  }
  const acc = getAccount(state._selectedLoginAccountId);
  if (!confirm(tf('account.deleteConfirm', { name: acc?.name || '' }))) return;
  // Must await: _showAccountViewAfterChange() below renders the account grid
  // from the in-memory _accounts array, which deleteAccount() only updates
  // partway through its own (async) run — without awaiting, the just-deleted
  // account would still show up until the next reload.
  await deleteAccount(state._selectedLoginAccountId);
  state._selectedLoginAccountId = null;
  _stopLockCountdown();
  _showAccountViewAfterChange();
}

export async function deleteAccount(accountId) {
  // Remove all data from server store and localStorage.
  // Ask the server which keys exist rather than deleting a hardcoded list —
  // a previous hardcoded list was missing 'profileFolders', silently leaving
  // it behind. Falls back to a hardcoded list only if the listing call fails.
  if (state._storeAvailable) {
    const serverKeys = await _storeListKeys(accountId);
    const keysToDelete = (serverKeys && serverKeys.length) ? serverKeys : [
      'config','providers','profiles','profileFolders','folders','chats',
      'current_chat','sidebar_w','sidebar_collapsed',
    ];
    await Promise.allSettled(
      keysToDelete.map(k => _storeDel(accountId, k))
    );
    // Individual key deletes above leave an empty directory behind — remove
    // the account's whole data directory too (see _storeDeleteAccountDir).
    await _storeDeleteAccountDir(accountId);
  }
  const prefix = `kic_${accountId}_`;
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
  keys.forEach(k => localStorage.removeItem(k));
  state._accounts = state._accounts.filter(a => a.id !== accountId);
  // Must AWAIT the registry write here (not fire-and-forget) — the caller
  // calls logoutNow() right after, which re-fetches the registry for the
  // login screen. Without awaiting, that could race the pending PUT.
  await _registryPut(state._accounts);
  if (state._activeAccountId === accountId) {
    state._activeAccountId = null;
    state._cryptoKey = null;
    state._sessionPassphrase = null;
    resetSaveCache(); // don't let a stale cache survive into the next account
    localStorage.removeItem('kic_active_account');
  }
  toast(t('account.deleted'));
}

export function changeAccountName() {
  const input = document.getElementById('accountNameInput');
  if (!input) return;
  const newName = input.value.trim();
  if (!newName) { toast(t('js.nameRequired')); return; }
  const acc = getAccount(state._activeAccountId);
  if (!acc) return;
  acc.name = newName;
  saveAccountRegistry();
  toast('✅ ' + newName);
}

export async function changeLoginPassword() {
  const currentPw  = document.getElementById('currentPwdInput')?.value || '';
  const newPw      = document.getElementById('newPwdInput')?.value || '';
  const confirmPw  = document.getElementById('confirmPwdInput')?.value || '';
  if (!state._activeAccountId) { toast(t('js.noActiveAccount')); return; }
  const acc = getAccount(state._activeAccountId);
  if (acc?.pwHash) {
    if (!currentPw) { toast(t('js.pwdCurrentRequired')); return; }
    const ok = await verifyAccountPassword(state._activeAccountId, currentPw);
    if (!ok) { toast(t('js.pwdCurrentWrong')); return; }
  }
  // password length: kein Minimum enforced - strength indicator informiert den Benutzer
  if (newPw !== confirmPw) { toast(t('js.pwdMismatch')); return; }
  await storeAccountPasswordHash(state._activeAccountId, newPw);
  setSessionPassphrase(newPw);
  // Neuen CryptoKey build + Session token neu write
  await getCryptoKey();
  await _writeSessionToken();
  await rekeyAgentSession();
  await save();
  const durMs = getSessionDurationMs();
  if (durMs > 0) localStorage.setItem(`kic_${state._activeAccountId}_session_expiry`, String(Date.now() + durMs));
  if (document.getElementById('currentPwdInput')) document.getElementById('currentPwdInput').value = '';
  if (document.getElementById('newPwdInput'))     document.getElementById('newPwdInput').value = '';
  if (document.getElementById('confirmPwdInput')) document.getElementById('confirmPwdInput').value = '';
  toast(t('js.pwdChanged'));
}

export function logoutNow() {
  closePanels();
  lockAgentSession();
  if (state._activeAccountId) localStorage.removeItem(`kic_${state._activeAccountId}_session_expiry`);
  state._activeAccountId = null;
  state._cryptoKey = null;
  state._sessionPassphrase = null;
  try { sessionStorage.removeItem(_SESSION_TOKEN_KEY); } catch {}
  localStorage.removeItem('kic_active_account');
  // Reset app state
  state.providers = []; state.profiles = []; state.profileFolders = []; state.folders = []; state.chats = []; state.currentChatId = null;
  state.config = freshConfig();
  // Hide main UI
  document.querySelector('.main')?.style.setProperty('display','none');
  document.querySelector('header')?.style.setProperty('display','none');
  showLoginScreen();
}

export function getSessionDurationMs() {
  const h = parseInt(document.getElementById('sessionHoursInput')?.value || '12');
  const m = parseInt(document.getElementById('sessionMinutesInput')?.value || '0');
  return (h * 60 + m) * 60 * 1000;
}

export function loadSessionSettings() {
  const saved = localStorage.getItem('kic_session_duration_ms');
  if (saved) {
    const ms = parseInt(saved);
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60), m2 = totalMin % 60;
    const hi = document.getElementById('sessionHoursInput');
    const mi = document.getElementById('sessionMinutesInput');
    if (hi) hi.value = h; if (mi) mi.value = m2;
  }
}

export function applySessionDuration() {
  const durMs = getSessionDurationMs();
  localStorage.setItem('kic_session_duration_ms', String(durMs));
  if (durMs > 0 && state._activeAccountId) localStorage.setItem(`kic_${state._activeAccountId}_session_expiry`, String(Date.now() + durMs));
  startSessionCountdown(); toast(t('settings.sessionApply'));
}

export function resetSessionNow() {
  if (!state._activeAccountId) { toast(t('js.noActiveAccount')); return; }
  localStorage.removeItem(`kic_${state._activeAccountId}_session_expiry`);
  toast(t('js.sessionReset'));
  setTimeout(() => logoutNow(), 1200);
}

export function startSessionCountdown() {
  if (state._countdownTimer) clearInterval(state._countdownTimer);
  state._countdownTimer = setInterval(updateSessionCountdown, 1000);
  updateSessionCountdown();
}

export function updateSessionCountdown() {
  const el = document.getElementById('sessionCountdown'); if (!el) return;
  if (!state._activeAccountId) { el.textContent = '—'; el.style.color = 'var(--muted)'; return; }
  const expiry = parseInt(localStorage.getItem(`kic_${state._activeAccountId}_session_expiry`) || '0');
  if (!expiry) { el.textContent = '∞'; el.style.color = 'var(--accent)'; return; }
  const remaining = expiry - Date.now();
  if (remaining <= 0) {
    el.textContent = '0:00:00'; el.style.color = 'var(--red)';
    clearInterval(state._countdownTimer);
    setTimeout(() => logoutNow(), 500);
    return;
  }
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s2 = Math.floor((remaining % 60000) / 1000);
  el.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s2).padStart(2,'0')}`;
  el.style.color = remaining < 5 * 60 * 1000 ? 'var(--red)' : 'var(--accent)';
}

export async function checkLogin() {
  await loadAccountRegistryAsync();
  // No accounts at all → create first account
  if (state._accounts.length === 0) {
    showLoginScreen();
    return;
  }
  // F5/reload: session token check (no password in sessionStorage)
  // The token was encrypted with the CryptoKey, so it can't be decrypted
  // without the password. Since RAM is empty after F5, the user must
  // re-authenticate unless the token is still valid AND the key is still in RAM.
  const lastAccountId = localStorage.getItem('kic_active_account');
  if (lastAccountId && getAccount(lastAccountId)) {
    // Check whether a session token is present in sessionStorage (only then is it worth trying)
    if (restoreSessionPassphrase()) {
      // Validating the token requires the CryptoKey -> on F5, _cryptoKey is null.
      // We can't derive a new key without the password.
      // So: stay logged in only if _cryptoKey is still in RAM
      // (i.e. not a real reload, just internal navigation / hot-reload).
      if (state._cryptoKey) {
        const tokenOk = await _validateSessionToken(lastAccountId);
        if (tokenOk) {
          const expiry = parseInt(localStorage.getItem('kic_' + lastAccountId + '_session_expiry') || '0');
          if (!expiry || Date.now() < expiry) {
            state._activeAccountId = lastAccountId;
            await bootApp();
            return;
          }
        }
      }
    }
  }
  // Must log in
  showLoginScreen();
}

// This IIFE is the application's actual boot trigger (calls setupEventListeners/
// applyTranslations/checkLogin, which cascades into essentially every other
// module). Deferred via setTimeout(0) - same reasoning as js/agent.js's and
// js/db.js's waitForHost() fix: with ES modules, this file's own evaluation
// order (set by the import dependency graph, not source position in the old
// js/core/boot.js) is not guaranteed to run after every other module has
// initialized. A macrotask boundary guarantees the whole synchronous
// module-evaluation pass - including the deeply circular core/state.js
// graph - has completed first. Found via the dry-run harness executing an
// actual cross-module function call (see Phase 4 commit notes).
setTimeout(async () => {
  // Hide main UI immediately — show only after successful login
  document.querySelector('.main')?.style.setProperty('display','none');
  document.querySelector('header')?.style.setProperty('display','none');
  setupEventListeners();
  applyTranslations();
  loadSessionSettings();
  await checkLogin();
}, 0);
