// Shared pieces of the translation-fallback helper that used to be
// hand-copied, near-identically, into all three former bolt-on modules
// (agent.js, db.js, voice.js). Each of those files still keeps its own
// thin t()/tf()/tv() wrapper with its OWN fallback semantics — see
// ARCHITECTURE.md "Known wrinkles" — this module only removes the
// byte-for-byte-duplicated CORE logic, it does not unify behavior that
// actually differs between call sites (that would be a real behavior
// change, out of scope here, same as the i18n.js t/tf/bt/btf/ta situation
// already flagged there).
import { state } from './state.js';

// The `TRANSLATIONS`-lookup-with-fallback logic that was identical across
// agent.js's t(), db.js's t(), and voice.js's t().
export function boltonT(key, fallback) {
  try {
    /* global TRANSLATIONS */
    if (typeof TRANSLATIONS !== 'undefined' && typeof state.currentLang !== 'undefined') {
      const lang = TRANSLATIONS[state.currentLang] || TRANSLATIONS.en || {};
      const val = lang[key] ?? (TRANSLATIONS.en || {})[key];
      if (val != null) return val;
    }
  } catch (e) {}
  return fallback || key;
}

// {placeholder} substitution. `coalesceNullish` preserves a real,
// pre-existing divergence: agent.js/db.js's tf() call `replaceAll(..., v)`
// (no nullish coalescing) while voice.js's tv() calls
// `replaceAll(..., v ?? '')` — passing `undefined` through vs. rendering it
// as an empty string are different outputs, so callers pass the flag that
// matches their original behavior instead of this helper silently picking
// one.
export function boltonSubstitute(str, vars, coalesceNullish = false) {
  let s = str;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      s = s.replaceAll(`{${k}}`, coalesceNullish ? (v ?? '') : v);
    });
  }
  return s;
}
