// kiconnect-mathjax-config.js
// Moved out of an inline <script> tag in kiconnect.html so the CSP's
// script-src can drop 'unsafe-inline' (see kiconnect.html head and
// kiconnect-proxy.py SECURITY_HEADERS). Must be loaded BEFORE
// _render/latex/tex-chtml.js — same requirement as when this was inline.
// This is the one remaining standalone "just a few lines of config" file:
// unlike the old PDF.js worker init (now folded into kiconnect.js, see the
// top of that file), tex-chtml.js reads window.MathJax synchronously as
// soon as it loads, so this config genuinely has to execute earlier than
// kiconnect.js does — it can't be merged into it.
window.MathJax = {
  tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']], processEscapes: true },
  options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
  chtml: {
    fontURL: new URL('_render/newcm-font/chtml/woff2', document.baseURI).href,
    dynamicPrefix: new URL('_render/newcm-font/chtml/dynamic', document.baseURI).href,
  },
  startup: { typeset: false },
};
