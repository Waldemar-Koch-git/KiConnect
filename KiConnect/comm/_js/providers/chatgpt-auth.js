import { state } from '../core/state.js';
import { agentSessionHeader, onSessionLock } from '../auth/accounts.js';
import { tf } from '../core/i18n.js';
import { identifyChatgptMessage } from './chatgpt-strings.js';
import { toast } from '../ui/misc-ui.js';
import { escHtml } from '../core/html-utils.js';

export function chatgptErrorMarkup(message, wrapper, param, prefix = '') {
  const info = identifyChatgptMessage(message);
  if (!info) return null;
  const metadata = { ...info, wrapper, param, prefix };
  const label = prefix + tf(wrapper, { [param]: tf(info.key, info.vars) });
  return `<span data-chatgpt-error="${escHtml(JSON.stringify(metadata))}">${escHtml(label)}</span>`;
}

export function createChatgptError(message) {
  const error = new Error(translatedChatgptMessage(message));
  const info = identifyChatgptMessage(message);
  if (info) error.i18n = info;
  return error;
}

export function chatgptToast(message) {
  toast(translatedChatgptMessage(message));
  const element = document.getElementById('toast');
  if (element) setChatgptMessage(element, message);
}

export async function providerResponseError(provider, response, limit = 400) {
  const body = await response.text();
  if (provider?.type === 'chatgpt') {
    let message = body;
    try { message = JSON.parse(body).error || body; } catch { /* Keep the original error. */ }
    return createChatgptError(message);
  }
  return new Error(`${response.status}: ${limit ? body.slice(0, limit) : body}`);
}

export function translatedChatgptMessage(message) {
  const info = identifyChatgptMessage(message);
  return info ? tf(info.key, info.vars) : String(message?.message || message || '');
}

export function setChatgptMessage(element, message) {
  const info = identifyChatgptMessage(message);
  if (info) {
    element.dataset.i18n = info.key;
    element.dataset.i18nVars = JSON.stringify(info.vars);
  } else {
    delete element.dataset.i18n;
    delete element.dataset.i18nVars;
  }
  element.textContent = translatedChatgptMessage(message);
}

const approvedPdfs = new Set();
onSessionLock(() => approvedPdfs.clear());

export function clearProviderPdfConsent(id) {
  const prefix = `${state._activeAccountId}:${id}:`;
  for (const key of approvedPdfs) if (key.startsWith(prefix)) approvedPdfs.delete(key);
}

export async function providerRequestBody(provider, body) {
  if (provider.type !== 'chatgpt') return JSON.stringify(body);
  const files = [];
  for (const message of body.messages || []) {
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part.type === 'file') {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(part.file.file_data));
        const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        files.push({ part, key: `${state._activeAccountId}:${provider.id}:${hash}`, name: part.file.filename });
      }
    }
  }
  const unapproved = files.filter(file => !approvedPdfs.has(file.key));
  if (unapproved.length) {
    const names = [...new Set(unapproved.map(file => file.name))].join('\n');
    const approved = confirm(tf('chatgpt.pdfConsent', { names }));
    if (approved) unapproved.forEach(file => approvedPdfs.add(file.key));
  }
  const output = structuredClone(body);
  for (const message of output.messages || []) {
    if (!Array.isArray(message.content)) continue;
    for (let index = 0; index < message.content.length; index++) {
      const part = message.content[index];
      if (part.type !== 'file') continue;
      const original = files.find(file => file.part.file.file_data === part.file.file_data && file.name === part.file.filename);
      if (!original || !approvedPdfs.has(original.key)) message.content[index] = { type: 'text', text: tf('chatgpt.pdfDenied', { name: part.file.filename }) };
    }
  }
  output.chatgpt_pdf_consent = true; // Only approved PDFs survive the filter above.
  return JSON.stringify(output);
}

export function providerReady(provider) {
  return !!provider && (provider.type === 'chatgpt' ? !!provider.chatgptConnected : !!provider.apiKey);
}

export function providerAuthHeaders(provider) {
  return provider.type === 'chatgpt' ? agentSessionHeader() : { Authorization: `Bearer ${provider.apiKey}` };
}

export async function chatgptRequest(id, action, method = 'GET') {
  if (!state._agentSessionToken) throw createChatgptError('chatgpt.unlock');
  const response = await fetch(`/chatgpt/${encodeURIComponent(id)}/${action}`, {
    method, headers: { ...agentSessionHeader(), 'X-KiConnect-Language': state.currentLang }, cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404) throw createChatgptError('chatgpt.restartProxy');
  let data;
  try { data = await response.json(); }
  catch { throw createChatgptError('chatgpt.invalidProxy'); }
  if (!response.ok) throw createChatgptError(data.error || 'chatgpt.connectionFailed');
  return data;
}
