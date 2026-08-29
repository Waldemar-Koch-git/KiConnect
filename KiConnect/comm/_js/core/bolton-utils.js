// Shared boot/fetch/toast plumbing that used to be hand-copied,
// near-identically, into the three former bolt-on modules (agent.js,
// db.js, voice.js) — same spirit as core/bolton-i18n.js and
// core/html-utils.js (see ARCHITECTURE.md "Known wrinkles"). Each of
// those files still keeps its own call sites/labels/timings; this module
// only removes the byte-for-byte-duplicated CONTROL FLOW, it does not
// change any of the small, real per-file differences (log tag, retry
// delay, etc.) — callers pass those in as arguments.

// The `document.readyState === 'loading' ? DOMContentLoaded : setTimeout`
// deferral every bolt-on module uses before touching the host DOM (ES
// module evaluation order follows the import graph, not script-tag order —
// see ARCHITECTURE.md "Circular imports" #2). `delay` preserves each
// caller's own already-ready timing (agent.js/db.js used 0, voice.js used
// 300) instead of silently unifying it.
export function deferUntilDomReady(fn, delay = 0) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => fn());
  } else {
    setTimeout(fn, delay);
  }
}

// The "poll every `interval`ms until `checkFn()` is truthy, give up after
// `maxTries` retries" loop used by agent.js's/db.js's waitForHost() and
// voice.js's waitForElement(). `onReady` receives whatever truthy value
// checkFn returned (voice.js's callers want the found element itself, not
// just a boolean). Retry/give-up counts match the original recursive
// implementations exactly (checks tries 0..maxTries inclusive, i.e.
// maxTries+1 total attempts) rather than approximating them.
export function pollUntilReady(checkFn, onReady, { maxTries = 150, interval = 100 } = {}) {
  (function attempt(tries) {
    const result = checkFn();
    if (result) { onReady(result); return; }
    if (tries > maxTries) return;
    setTimeout(() => attempt(tries + 1), interval);
  })(0);
}

// The "prefer the host app's real toast, fall back to something local if
// it's ever unavailable" wrapper duplicated as showToast() in agent.js,
// db.js, and voice.js. `fallback` preserves each caller's own real
// fallback behavior (agent.js/db.js just console.log with their own tag;
// voice.js drives the #toast element directly) — this only factors out
// the shared `typeof hostToastFn === 'function'` guard in front of it.
export function makeToastFn(hostToastFn, fallback) {
  return function showToast(msg) {
    if (typeof hostToastFn === 'function') { hostToastFn(msg); return; }
    fallback(msg);
  };
}

// Position a settings-style panel above/below/left-clamped relative to its
// own toggle button (viewport-clamped, flips to whichever side has more
// room) — used by agent.js's and voice.js's settings-panel positioning,
// which only differed in their fallback panel width and how much space
// above counts as "enough" to prefer opening upward.
export function positionPanelNearAnchor(panel, anchor, { fallbackWidth = 300, aboveThreshold = 220 } = {}) {
  if (!panel || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const panelW = panel.offsetWidth || fallbackWidth;
  let left = rect.right - panelW;
  left = Math.max(8, Math.min(left, vw - panelW - 8));
  panel.style.left = left + 'px';
  const spaceAbove = rect.top - 8, spaceBelow = vh - rect.bottom - 8;
  if (spaceAbove >= aboveThreshold || spaceAbove >= spaceBelow) {
    panel.style.bottom = (vh - rect.top + 8) + 'px';
    panel.style.top = 'auto';
  } else {
    panel.style.top = (rect.bottom + 8) + 'px';
    panel.style.bottom = 'auto';
  }
}

// The session-header fetch wrapper duplicated as agentFetch() in agent.js
// and kbFetch() in db.js: attach the current agent-session header (if
// any), and on a 401 that a real session token was actually sent with,
// treat it as an expired session rather than "not logged in yet" (a bare
// 401 with no token just means the user hasn't unlocked anything).
// `getSessionHeaders`/`onSessionExpired` let each caller keep its own
// session source and its own expiry handling (agent.js calls the host
// toast directly, db.js goes through its own showToast wrapper).
export function makeSessionFetch(getSessionHeaders, onSessionExpired) {
  return async function sessionFetch(url, opts) {
    opts = opts || {};
    const sessionHeaders = typeof getSessionHeaders === 'function' ? getSessionHeaders() : {};
    const headers = { ...(opts.headers || {}), ...sessionHeaders };
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401 && Object.keys(sessionHeaders).length) {
      onSessionExpired();
    }
    return res;
  };
}
