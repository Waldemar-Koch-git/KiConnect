// Must load before MathJax so its configuration is available at startup.
window.MathJax = {
  tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']], processEscapes: true },
  // Expose MathML for accessible output and Word equation paste.
  options: {
    skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    menuOptions: { settings: { assistiveMml: true } },
    enableMenu: true,
  },
  chtml: {
    fontURL: new URL('_render/newcm-font/chtml/woff2', document.baseURI).href,
    dynamicPrefix: new URL('_render/newcm-font/chtml/dynamic', document.baseURI).href,
  },
  startup: { typeset: false },
};
