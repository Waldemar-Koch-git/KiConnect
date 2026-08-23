// js/auth/crypto.js — extracted from kiconnect.js (Phase 4 of the v3.5.1→v4.0.0 modularization)
import { getAccount } from './accounts.js';
import { _registryPut, resetSaveCache } from './storage.js';
import { state } from '../core/state.js';

export async function deriveKeyPBKDF2(passphrase, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase || 'kic-default-v2'),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 600000 },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function getCryptoKey() {
  if (state._cryptoKey) return state._cryptoKey;
  const acc = getAccount(state._activeAccountId);
  if (!acc) throw new Error('No active account');
  // Salt from account registry (created on first password set)
  let encSalt = acc.encSalt;
  if (!encSalt) {
    const saltBuf = crypto.getRandomValues(new Uint8Array(16));
    encSalt = btoa(String.fromCharCode(...saltBuf));
    acc.encSalt = encSalt;
    // IMPORTANT: await here, to guarantee the salt is persisted
    // before we use it for encryption. Without await, a reload could
    // generate a new salt -> wrong key -> data loss.
    await _registryPut(state._accounts);
  }
  const saltBytes = Uint8Array.from(atob(encSalt), c => c.charCodeAt(0));
  const passphrase = 'kic-enc-v5|' + (state._sessionPassphrase || '');
  state._cryptoKey = await deriveKeyPBKDF2(passphrase, saltBytes);
  // A (re)derived key invalidates save()'s dirty-tracking cache: unchanged
  // plaintext must still be re-encrypted under the new key (e.g. after a
  // password change / rekey), otherwise it would wrongly be skipped.
  resetSaveCache();
  return state._cryptoKey;
}

export async function encryptStr(plaintext) {
  if (!plaintext) return '';
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + enc.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.byteLength);
  // Use chunked btoa to avoid "Maximum call stack size exceeded"
  // when spread-applying large Uint8Arrays (>~500 KB).
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < combined.length; i += CHUNK) {
    bin += String.fromCharCode(...combined.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function decryptStr(b64) {
  if (!b64) return '';
  try {
    const key  = await getCryptoKey();
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv   = data.slice(0, 12);
    const ct   = data.slice(12);
    const dec  = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(dec);
  } catch { return ''; }
}

export async function encryptObj(obj) {
  return encryptStr(JSON.stringify(obj));
}

export async function decryptObj(b64, fallback) {
  if (!b64) return fallback;
  try {
    const json = await decryptStr(b64);
    if (!json) return fallback;
    return JSON.parse(json);
  } catch { return fallback; }
}

export async function encryptProvider(p) {
  const out = {...p};
  if (p.apiKey) out.apiKey = await encryptStr(p.apiKey);
  return out;
}

export const LEGACY_PROVIDER_TYPE_MAP = { 'gemini': 'google', 'glm': 'zhipu' };

export async function decryptProvider(p) {
  const out = {...p};
  if (p.apiKey) out.apiKey = await decryptStr(p.apiKey);
  if (LEGACY_PROVIDER_TYPE_MAP[out.type]) out.type = LEGACY_PROVIDER_TYPE_MAP[out.type];
  return out;
}

export async function deriveRawBitsPBKDF2(passphrase, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 600000 },
    keyMaterial, 256
  );
  return new Uint8Array(bits);
}

export async function hashPasswordPBKDF2(pw, saltBytes) {
  const key = await deriveKeyPBKDF2(pw + '|kic-login-v2', saltBytes);
  const iv = new Uint8Array(12);
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key,
    new TextEncoder().encode('kic-login-verify-v2')
  );
  return btoa(String.fromCharCode(...new Uint8Array(enc)));
}
