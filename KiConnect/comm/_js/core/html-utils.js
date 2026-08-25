// Zero-dependency HTML-escaping helper, factored out because it existed as
// three byte-for-byte-equivalent copies: chat-render.js's escHtml(),
// agent.js's esc(), and db.js's esc(). Deliberately has NO imports so it
// can be pulled into any module (including ones already involved in the
// auth/accounts.js <-> db.js/voice.js circular-import pair — see
// ARCHITECTURE.md "Circular imports") without adding a new dependency edge
// that could reintroduce a TDZ/ordering problem. `export function` is
// hoisted, so even a future circular import of this module is safe
// regardless of evaluation order.
export function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
