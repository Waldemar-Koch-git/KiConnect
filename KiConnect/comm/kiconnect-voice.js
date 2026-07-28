// ================================================================
// kiconnect-voice.js  –  Speech input & speech output (Web Speech API)
// Version 2.1 – fully revised
// ================================================================

(function () {
  'use strict';

  // ── Settings ─────────────────────────────────────────────────
  const STORAGE_KEY = 'kic_voice_settings';

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }
  function saveSettings(obj) {
    const cur = loadSettings();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...obj })); } catch {}
  }

  let vs = {
    sttLang:     navigator.language || 'en',
    ttsRate:     1.0,
    ttsPitch:    1.0,
    ttsVoice:    '',
    sttAutoSend: false,
    dialogMode:  false,   // Dialog mode: read AI response aloud → then listen again
    ttsProvider: 'browser',   // 'browser' | 'openai' | 'elevenlabs' | 'groq'
    sttProvider: 'browser',   // 'browser' | 'groq'
    sttSilenceMs: 3000,    // how long to wait in silence before auto-stopping listening
    groqTtsVoice: 'troy',     // Groq/Orpheus TTS speaker persona
    openaiTtsVoice: 'alloy',  // OpenAI gpt-4o-mini-tts speaker persona
    ...loadSettings(),
  };

  // Hard safety cap so listening can never run away indefinitely even if
  // silence detection somehow never fires (background noise, muted mic, …).
  // Not user-configurable on purpose — it's a backstop, not a feature.
  var STT_MAX_LISTEN_MS = 90000;

  // ── Bridge to the Tuning panel's Audio section (kiconnect.js) ──────
  // ttsProvider/sttProvider are unsensitive choices that live here in `vs`
  // (localStorage), same as rate/pitch/lang. The actual API keys live
  // encrypted in config.audioProviders (kiconnect.js) and are only read
  // here, never written. This is the small two-way bridge the Tuning
  // panel's provider <select> elements use to read/write the choice.
  window.kicVoiceGetSetting = function (key) { return vs[key]; };
  window.kicVoiceSetSetting = function (key, value) {
    vs[key] = value;
    saveSettings({ [key]: value });
    if (key === 'dialogMode') updateDialogBadge();
  };

  // ── State ──────────────────────────────────────────────────────
  let sttActive     = false;
  let ttsActive     = false;
  let dialogPending = false;
  let btnMic, btnTts, btnVoiceSettings;

  // ── i18n helper function ──────────────────────────────────────
  // TRANSLATIONS (const) and currentLang (let) are defined as
  // global lexical bindings in other scripts – they do NOT appear on window,
  // but are accessible as plain identifiers from within this IIFE.
  function t(key, fallback) {
    try {
      /* global TRANSLATIONS, currentLang */
      if (typeof TRANSLATIONS !== 'undefined' && typeof currentLang !== 'undefined') {
        const lang = TRANSLATIONS[currentLang] || TRANSLATIONS['en'] || {};
        const val = lang[key] ?? (TRANSLATIONS['en'] || {})[key];
        if (val != null) return val;
      }
    } catch(e) {}
    return fallback || key;
  }
  // Like t(), but substitutes {placeholder} tokens in the resolved string —
  // used for messages with dynamic content (provider name, HTTP code, etc.)
  // so a real translation still gets those values instead of being static.
  function tv(key, fallbackTemplate, vars) {
    let s = t(key, fallbackTemplate);
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, v ?? ''); });
    return s;
  }

  // ── DOM helper functions ─────────────────────────────────────
  function waitForElement(id, cb, tries) {
    tries = tries || 0;
    const el = document.getElementById(id);
    if (el) { cb(el); return; }
    if (tries > 150) return;
    setTimeout(function () { waitForElement(id, cb, tries + 1); }, 100);
  }

  function getTextarea()  { return document.getElementById('messageInput'); }

  function showToast(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 3000);
  }

  // ── SVG icons ────────────────────────────────────────────────
  var SVG_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6"/></svg>';

  var SVG_MIC_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6"/><line x1="4" y1="4" x2="20" y2="20" stroke="#e74c3c" stroke-width="2.5"/></svg>';

  var SVG_SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

  var SVG_SPEAKER_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15" stroke="#e74c3c"/><line x1="17" y1="9" x2="23" y2="15" stroke="#e74c3c"/></svg>';

  var SVG_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  // ── Inject CSS ────────────────────────────────────────────────
  function injectStyles() {
    var s = document.createElement('style');
    s.id = 'kiconnect-voice-styles';
    s.textContent = [
      /* Grouped like .panel-toolbar in the header: a bordered "frame" around
         the mic/TTS/settings trio so they read as one unit, distinct from
         the other input-actions icons (attach, image, web, …). */
      '.voice-btn-group{display:flex;align-items:center;gap:2px;background:var(--surface2,rgba(128,128,128,.08));border:1px solid var(--border,#2a2d3a);border-radius:10px;padding:3px 4px;flex-shrink:0;}',
      '.voice-btn{background:none;border:none;cursor:pointer;color:var(--muted,#888);padding:7px;border-radius:7px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0;}',
      '.voice-btn:hover{background:var(--surface,rgba(128,128,128,.18));color:var(--text,#eee);}',
      '.voice-btn.voice-active{color:var(--red,#e74c3c);background:rgba(231,76,60,.12);animation:voice-pulse 1.2s ease-in-out infinite;}',
      '@keyframes voice-pulse{0%,100%{box-shadow:0 0 0 0 rgba(231,76,60,.4)}50%{box-shadow:0 0 0 5px rgba(231,76,60,0)}}',
      '.voice-gear-btn{background:none;border:none;cursor:pointer;color:var(--muted,#888);padding:7px 6px;border-radius:7px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0;opacity:.75;}',
      '.voice-gear-btn:hover{background:var(--surface,rgba(128,128,128,.18));color:var(--text,#eee);opacity:1;}',

      /* Panel */
      '#voiceSettingsPanel{position:fixed;bottom:80px;right:16px;width:310px;max-width:calc(100vw - 32px);background:var(--surface,#16181f);border:1px solid var(--border,#2a2d3a);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5);padding:0;z-index:2000;display:none;flex-direction:column;overflow:hidden;font-size:13px;color:var(--text,#e8eaf0);font-family:"Syne",sans-serif;}',
      '#voiceSettingsPanel.open{display:flex;}',
      '.vs-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 12px;border-bottom:1px solid var(--border,#2a2d3a);font-weight:700;font-size:14px;gap:8px;}',
      '.vs-header-title{display:flex;align-items:center;gap:8px;}',
      '.vs-close{background:none;border:none;cursor:pointer;color:var(--muted,#666b7e);font-size:18px;line-height:1;padding:2px 4px;border-radius:4px;}',
      '.vs-close:hover{color:var(--text,#e8eaf0);}',
      '.vs-body{display:flex;flex-direction:column;gap:14px;padding:16px;overflow-y:auto;max-height:60vh;}',
      '.vs-group{display:flex;flex-direction:column;gap:6px;}',
      '.vs-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#666b7e);font-family:"IBM Plex Mono",monospace;}',
      '.vs-select{width:100%;background:var(--surface2,#1d2029);border:1px solid var(--border,#2a2d3a);border-radius:8px;color:var(--text,#e8eaf0);padding:7px 10px;font-size:12px;font-family:"IBM Plex Mono",monospace;outline:none;cursor:pointer;transition:border-color .15s;}',
      '.vs-select:focus{border-color:var(--accent,#3d7eff);}',
      '.vs-slider-row{display:flex;align-items:center;gap:10px;}',
      '.vs-slider-row input[type=range]{flex:1;accent-color:var(--accent,#3d7eff);cursor:pointer;height:4px;}',
      '.vs-slider-val{font-size:11px;color:var(--muted,#666b7e);min-width:32px;text-align:right;font-family:"IBM Plex Mono",monospace;}',
      '.vs-sep{border:none;border-top:1px solid var(--border,#2a2d3a);margin:0;}',
      '.vs-toggle-row{display:flex;flex-direction:column;gap:8px;}',
      '.vs-chip{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid var(--border,#2a2d3a);background:var(--surface2,#1d2029);cursor:pointer;font-size:12px;color:var(--muted,#666b7e);transition:all .15s;user-select:none;}',
      '.vs-chip:hover{border-color:var(--accent,#3d7eff);color:var(--text,#e8eaf0);}',
      '.vs-chip.active{border-color:var(--accent,#3d7eff);color:var(--accent,#3d7eff);background:rgba(61,126,255,.1);}',
      '.vs-chip .vs-chip-icon{font-size:14px;flex-shrink:0;}',
      '.vs-chip-desc{display:flex;flex-direction:column;gap:1px;}',
      '.vs-chip-name{font-weight:600;font-size:12px;}',
      '.vs-chip-sub{font-size:10px;opacity:.7;font-family:"IBM Plex Mono",monospace;}',

      /* Engine quick-switch chips (TTS/STT provider), rendered in a row that
         wraps instead of the full-width stacked .vs-toggle-row chips. */
      '.vs-chip-row{display:flex;flex-wrap:wrap;gap:6px;}',
      '.vs-chip-row .vs-chip{padding:6px 10px;flex:0 0 auto;gap:6px;}',
      '.vs-chip-row .vs-chip .vs-chip-name{font-weight:500;}',
      '.vs-audio-more{font-size:11px;color:var(--accent,#3d7eff);cursor:pointer;margin:-4px 0 2px;text-decoration:underline;text-underline-offset:2px;}',
      '.vs-audio-more:hover{opacity:.85;}',

      /* Dialog badge in the header */
      '#voiceDialogBadge{display:none;background:rgba(61,126,255,.15);border:1px solid var(--accent,#3d7eff);color:var(--accent,#3d7eff);font-size:10px;font-family:"IBM Plex Mono",monospace;padding:2px 8px;border-radius:20px;animation:dialog-blink 1.8s ease-in-out infinite;cursor:pointer;flex-shrink:0;margin-right:6px;}',
      '#voiceDialogBadge.visible{display:inline-block;}',
      '@keyframes dialog-blink{0%,100%{opacity:1}50%{opacity:.5}}'
    ].join('');
    document.head.appendChild(s);
  }

  // ── Button status ────────────────────────────────────────────
  function setMicState(active) {
    sttActive = active;
    if (!btnMic) return;
    btnMic.classList.toggle('voice-active', active);
    btnMic.title    = active ? t('voice.micStop',  'Stop recording')     : t('voice.micStart',  'Start voice input');
    btnMic.innerHTML = active ? SVG_MIC_STOP : SVG_MIC;
  }

  function setTtsState(active) {
    ttsActive = active;
    if (!btnTts) return;
    btnTts.classList.toggle('voice-active', active);
    btnTts.title    = active ? t('voice.ttsStop',  'Stop speech output') : t('voice.ttsStart', 'Read last reply aloud');
    btnTts.innerHTML = active ? SVG_SPEAKER_STOP : SVG_SPEAKER;
  }

  // ── Insert buttons (LEFT of send button) ───────────────────
  function injectButtons() {
    var actions = document.querySelector('.input-actions');
    if (!actions) return;
    var sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) return;

    var group = document.createElement('div');
    group.className = 'voice-btn-group';
    group.id = 'voiceBtnGroup';

    btnMic = document.createElement('button');
    btnMic.type      = 'button';
    btnMic.id        = 'voiceMicBtn';
    btnMic.className = 'voice-btn';
    btnMic.title     = t('voice.micStart', 'Start voice input');
    btnMic.innerHTML = SVG_MIC;
    btnMic.addEventListener('click', toggleStt);

    btnTts = document.createElement('button');
    btnTts.type      = 'button';
    btnTts.id        = 'voiceTtsBtn';
    btnTts.className = 'voice-btn';
    btnTts.title     = t('voice.ttsStart', 'Read last reply aloud');
    btnTts.innerHTML = SVG_SPEAKER;
    btnTts.addEventListener('click', toggleTts);

    btnVoiceSettings = document.createElement('button');
    btnVoiceSettings.type      = 'button';
    btnVoiceSettings.id        = 'voiceSettingsBtn';
    btnVoiceSettings.className = 'voice-gear-btn';
    btnVoiceSettings.title     = t('voice.settingsTitle', 'Voice Settings');
    btnVoiceSettings.innerHTML = SVG_GEAR;
    btnVoiceSettings.addEventListener('click', toggleVoiceSettingsPanel);

    // Order: sep | [🎤 | 🔊 | ⚙] | [Send] — the trio sits inside one bordered
    // frame (like the header's .panel-toolbar) so it reads as a single
    // "voice" group, visually distinct from the other input-actions icons.
    group.appendChild(btnMic);
    group.appendChild(btnTts);
    group.appendChild(btnVoiceSettings);
    actions.insertBefore(group, sendBtn);

    // Dialog badge in header
    var dialogBadge = document.createElement('span');
    dialogBadge.id        = 'voiceDialogBadge';
    dialogBadge.title     = t('voice.dialogStop', 'Stop dialog mode – click to stop');
    dialogBadge.textContent = '🎙️ Dialog';
    dialogBadge.addEventListener('click', function () {
      vs.dialogMode = false;
      saveSettings({ dialogMode: false });
      updateDialogBadge();
      stopStt();
      stopTts();
      showToast(t('voice.dialogStopped', 'Dialog mode stopped'));
    });
    var headerRight = document.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(dialogBadge, headerRight.firstChild);
    }
    updateDialogBadge();
  }

  function updateDialogBadge() {
    var badge = document.getElementById('voiceDialogBadge');
    if (!badge) return;
    badge.classList.toggle('visible', !!vs.dialogMode);
  }

  // Avoids a full panel rebuild on language change; unifies the translation mechanism with the main app.
  function _retranslatePanelDom(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'), el.textContent);
    });
  }
  

  // ── Settings panel ────────────────────────────────────────────
  // Voice panel with data-i18n attributes (no full panel rebuild on language change)
  function buildVoiceSettingsPanel() {
    var panel = document.createElement('div');
    panel.id = 'voiceSettingsPanel';
    panel.innerHTML = [
      '<div class="vs-header">',
        '<div class="vs-header-title">🎙️ <span data-i18n="voice.settingsTitle">Voice Settings</span></div>',
        '<button class="vs-close" id="vsClose" title="Close">✕</button>',
      '</div>',
      '<div class="vs-body">',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="audio.ttsEngineLabel">Speech engine (TTS)</div>',
          '<div class="vs-chip-row" id="vsTtsProviderRow"></div>',
        '</div>',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="audio.sttEngineLabel">Recognition engine (STT)</div>',
          '<div class="vs-chip-row" id="vsSttProviderRow"></div>',
        '</div>',

        '<div class="vs-audio-more" id="vsAudioMoreLink" style="display:none;" data-i18n="audio.moreProvidersLink">🔑 Add more engines (API key) in Tuning → Audio →</div>',

        '<hr class="vs-sep">',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="voice.sttLang">Recognition Language</div>',
          '<select class="vs-select" id="vsSttLang">',
            '<option value="de-DE">Deutsch (DE)</option>',
            '<option value="de-AT">Deutsch (AT)</option>',
            '<option value="de-CH">Deutsch (CH)</option>',
            '<option value="en-US">English (US)</option>',
            '<option value="en-GB">English (GB)</option>',
            '<option value="fr-FR">Français</option>',
            '<option value="es-ES">Español</option>',
            '<option value="it-IT">Italiano</option>',
            '<option value="nl-NL">Nederlands</option>',
            '<option value="pl-PL">Polski</option>',
            '<option value="tr-TR">Türkçe</option>',
            '<option value="ar-SA">العربية</option>',
            '<option value="fa-IR">فارسی</option>',
            '<option value="zh-CN">中文 (普通话)</option>',
            '<option value="ja-JP">日本語</option>',
            '<option value="ko-KR">한국어</option>',
            '<option value="ru-RU">Русский</option>',
            '<option value="pt-BR">Português (BR)</option>',
            '<option value="hi-IN">हिन्दी</option>',
            '<option value="el-GR">Ελληνικά</option>',
          '</select>',
        '</div>',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="voice.sttSilence">Auto-stop after silence</div>',
          '<div class="vs-slider-row">',
            '<input type="range" id="vsSttSilence" min="1" max="10" step="0.5" value="' + ((vs.sttSilenceMs || 3000) / 1000) + '">',
            '<span class="vs-slider-val" id="vsSttSilenceVal">' + ((vs.sttSilenceMs || 3000) / 1000).toFixed(1) + 's</span>',
          '</div>',
        '</div>',

        '<hr class="vs-sep">',

        '<div class="vs-group" id="vsTtsVoiceGroup">',
          '<div class="vs-label" data-i18n="voice.ttsVoice">Voice (Text → Speech)</div>',
          '<select class="vs-select" id="vsTtsVoice"><option value="">— <span data-i18n="voice.defaultVoice">Default</span> —</option></select>',
        '</div>',

        '<div class="vs-group" id="vsGroqTtsVoiceGroup" style="display:none;">',
          '<div class="vs-label" data-i18n="voice.groqTtsVoice">Speaker (Groq TTS)</div>',
          '<select class="vs-select" id="vsGroqTtsVoice">',
            '<option value="troy">Troy (male)</option>',
            '<option value="austin">Austin (male)</option>',
            '<option value="daniel">Daniel (male)</option>',
            '<option value="autumn">Autumn (female)</option>',
            '<option value="diana">Diana (female)</option>',
            '<option value="hannah">Hannah (female)</option>',
          '</select>',
        '</div>',

        '<div class="vs-group" id="vsOpenaiTtsVoiceGroup" style="display:none;">',
          '<div class="vs-label" data-i18n="voice.openaiTtsVoice">Speaker (OpenAI TTS)</div>',
          '<select class="vs-select" id="vsOpenaiTtsVoice">',
            '<option value="alloy">Alloy</option>',
            '<option value="ash">Ash</option>',
            '<option value="ballad">Ballad</option>',
            '<option value="coral">Coral</option>',
            '<option value="echo">Echo</option>',
            '<option value="fable">Fable</option>',
            '<option value="onyx">Onyx</option>',
            '<option value="nova">Nova</option>',
            '<option value="sage">Sage</option>',
            '<option value="shimmer">Shimmer</option>',
            '<option value="verse">Verse</option>',
            '<option value="marin">Marin</option>',
            '<option value="cedar">Cedar</option>',
          '</select>',
        '</div>',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="voice.ttsRate">Speech Rate</div>',
          '<div class="vs-slider-row">',
            '<input type="range" id="vsTtsRate" min="0.5" max="5.0" step="0.1" value="' + vs.ttsRate + '">',
            '<span class="vs-slider-val" id="vsTtsRateVal">' + vs.ttsRate.toFixed(1) + '×</span>',
          '</div>',
        '</div>',

        '<div class="vs-group" id="vsTtsPitchGroup">',
          '<div class="vs-label" data-i18n="voice.ttsPitch">Pitch</div>',
          '<div class="vs-slider-row">',
            '<input type="range" id="vsTtsPitch" min="0.5" max="5.0" step="0.1" value="' + vs.ttsPitch + '">',
            '<span class="vs-slider-val" id="vsTtsPitchVal">' + vs.ttsPitch.toFixed(1) + '</span>',
          '</div>',
        '</div>',

        '<hr class="vs-sep">',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="voice.options">Options</div>',
          '<div class="vs-toggle-row">',
            '<div class="vs-chip ' + (vs.sttAutoSend ? 'active' : '') + '" id="vsAutoSendChip">',
              '<span class="vs-chip-icon">⚡</span>',
              '<div class="vs-chip-desc">',
                '<span class="vs-chip-name" data-i18n="voice.autoSend">Auto-Send</span>',
                '<span class="vs-chip-sub" data-i18n="voice.autoSendSub">Send message immediately after STT</span>',
              '</div>',
            '</div>',
            '<div class="vs-chip ' + (vs.dialogMode ? 'active' : '') + '" id="vsDialogChip">',
              '<span class="vs-chip-icon">💬</span>',
              '<div class="vs-chip-desc">',
                '<span class="vs-chip-name" data-i18n="voice.dialog">Dialog Mode</span>',
                '<span class="vs-chip-sub" data-i18n="voice.dialogSub">Read AI response aloud → then listen again</span>',
              '</div>',
            '</div>',
          '</div>',
        '</div>',

      '</div>'
    ].join('');

    document.body.appendChild(panel);
    _retranslatePanelDom(panel);
  

    // Language
    var langSel = panel.querySelector('#vsSttLang');
    langSel.value = vs.sttLang;
    langSel.addEventListener('change', function () {
      vs.sttLang = langSel.value;
      saveSettings({ sttLang: vs.sttLang });
    });

    // Silence timeout (how long to keep listening after the user stops talking)
    var silenceSlider = panel.querySelector('#vsSttSilence');
    var silenceVal     = panel.querySelector('#vsSttSilenceVal');
    silenceSlider.addEventListener('input', function () {
      vs.sttSilenceMs = Math.round(parseFloat(silenceSlider.value) * 1000);
      silenceVal.textContent = parseFloat(silenceSlider.value).toFixed(1) + 's';
      saveSettings({ sttSilenceMs: vs.sttSilenceMs });
    });

    // Speed
    var rateSlider = panel.querySelector('#vsTtsRate');
    var rateVal    = panel.querySelector('#vsTtsRateVal');
    rateSlider.addEventListener('input', function () {
      vs.ttsRate = parseFloat(rateSlider.value);
      rateVal.textContent = vs.ttsRate.toFixed(1) + '×';
      saveSettings({ ttsRate: vs.ttsRate });
    });

    // Pitch
    var pitchSlider = panel.querySelector('#vsTtsPitch');
    var pitchVal    = panel.querySelector('#vsTtsPitchVal');
    pitchSlider.addEventListener('input', function () {
      vs.ttsPitch = parseFloat(pitchSlider.value);
      pitchVal.textContent = vs.ttsPitch.toFixed(1);
      saveSettings({ ttsPitch: vs.ttsPitch });
    });

    // Auto-send
    var autoSendChip = panel.querySelector('#vsAutoSendChip');
    autoSendChip.addEventListener('click', function () {
      vs.sttAutoSend = !vs.sttAutoSend;
      autoSendChip.classList.toggle('active', vs.sttAutoSend);
      saveSettings({ sttAutoSend: vs.sttAutoSend });
    });

    // Dialog mode
    var dialogChip = panel.querySelector('#vsDialogChip');
    dialogChip.addEventListener('click', function () {
      vs.dialogMode = !vs.dialogMode;
      dialogChip.classList.toggle('active', vs.dialogMode);
      saveSettings({ dialogMode: vs.dialogMode });
      updateDialogBadge();
      if (vs.dialogMode) {
        showToast(t('voice.dialogStarted', '💬 Dialog mode active – start microphone to begin'));
      } else {
        stopStt();
        stopTts();
        showToast(t('voice.dialogStopped', 'Dialog mode stopped'));
      }
    });

    // Close
    panel.querySelector('#vsClose').addEventListener('click', closeVoiceSettingsPanel);
    // NOTE: uses composedPath() rather than panel.contains(e.target). Several
    // controls in here (the TTS/STT provider chips, in particular) rebuild
    // their container's innerHTML on click, which detaches the very node
    // that was just clicked from the DOM. By the time this bubbled listener
    // on `document` runs, panel.contains(e.target) would then wrongly return
    // false (a detached node has no parent) and slam the panel shut right
    // after every click inside it. composedPath() is captured at dispatch
    // time and stays correct regardless of later DOM mutations.
    document.addEventListener('click', function (e) {
      var path = (typeof e.composedPath === 'function') ? e.composedPath() : null;
      var insidePanel = path
        ? (path.indexOf(panel) !== -1 || path.indexOf(btnVoiceSettings) !== -1)
        : (panel.contains(e.target) || e.target === btnVoiceSettings || btnVoiceSettings.contains(e.target));
      if (!insidePanel) closeVoiceSettingsPanel();
    });

    // Groq TTS speaker
    var groqVoiceSel = panel.querySelector('#vsGroqTtsVoice');
    groqVoiceSel.value = vs.groqTtsVoice || 'troy';
    groqVoiceSel.addEventListener('change', function () {
      vs.groqTtsVoice = groqVoiceSel.value;
      saveSettings({ groqTtsVoice: vs.groqTtsVoice });
    });

    // OpenAI TTS speaker
    var openaiVoiceSel = panel.querySelector('#vsOpenaiTtsVoice');
    openaiVoiceSel.value = vs.openaiTtsVoice || 'alloy';
    openaiVoiceSel.addEventListener('change', function () {
      vs.openaiTtsVoice = openaiVoiceSel.value;
      saveSettings({ openaiTtsVoice: vs.openaiTtsVoice });
    });

    populateTtsVoices();
    if (window.speechSynthesis) {
      speechSynthesis.addEventListener('voiceschanged', populateTtsVoices);
    }

    renderAudioEngineSection(panel);
  }

  // ── Engine quick-switch chips (TTS/STT) ─────────────────────────
  // Only lists providers that either need no key (browser) or already have
  // one configured in the Tuning panel — so a provider only shows up here
  // once it's actually usable, per the user's ask.
  var TTS_PROVIDERS = [
    { id: 'browser',    icon: '🖥️', needsKey: false, nameKey: 'audio.providerBrowser',    nameFallback: 'Browser' },
    { id: 'openai',     icon: '🟢', needsKey: true,  nameKey: 'audio.providerOpenAI',     nameFallback: 'OpenAI' },
    { id: 'elevenlabs', icon: '🎙️', needsKey: true,  nameKey: 'audio.providerElevenLabs', nameFallback: 'ElevenLabs' },
    { id: 'groq',       icon: '⚡', needsKey: true,  nameKey: 'audio.providerGroq',       nameFallback: 'Groq' },
  ];
  var STT_PROVIDERS = [
    { id: 'browser', icon: '🖥️', needsKey: false, nameKey: 'audio.providerBrowser',       nameFallback: 'Browser' },
    { id: 'groq',    icon: '⚡', needsKey: true,  nameKey: 'audio.providerGroqWhisper',   nameFallback: 'Groq Whisper' },
  ];

  // Renders the chip row for one provider list into `container`, marking the
  // currently active one; returns true if at least one provider is still
  // locked behind a missing key (used to show/hide the "add more" link).
  function renderProviderChips(container, providers, vsKey) {
    if (!container) return false;
    var current = vs[vsKey] || 'browser';
    var available = providers.filter(function (p) { return !p.needsKey || hasAudioProviderKey(p.id); });
    if (!available.some(function (p) { return p.id === current; })) {
      current = 'browser';
      vs[vsKey] = 'browser';
      saveSettings((function () { var o = {}; o[vsKey] = 'browser'; return o; })());
    }
    container.innerHTML = '';
    available.forEach(function (p) {
      var chip = document.createElement('div');
      chip.className = 'vs-chip vs-chip-sm' + (p.id === current ? ' active' : '');
      chip.innerHTML = '<span class="vs-chip-icon">' + p.icon + '</span><span class="vs-chip-name">' + t(p.nameKey, p.nameFallback) + '</span>';
      chip.addEventListener('click', function () {
        vs[vsKey] = p.id;
        var o = {}; o[vsKey] = p.id; saveSettings(o);
        renderAudioEngineSection(document.getElementById('voiceSettingsPanel'));
      });
      container.appendChild(chip);
    });
    return providers.some(function (p) { return p.needsKey && !hasAudioProviderKey(p.id); });
  }

  function updateTtsProviderDependentVisibility() {
    var provider = vs.ttsProvider || 'browser';
    var voiceGroup = document.getElementById('vsTtsVoiceGroup');
    var pitchGroup = document.getElementById('vsTtsPitchGroup');
    var groqVoiceGroup = document.getElementById('vsGroqTtsVoiceGroup');
    var openaiVoiceGroup = document.getElementById('vsOpenaiTtsVoiceGroup');
    if (voiceGroup) voiceGroup.style.display = provider === 'browser' ? '' : 'none';
    if (pitchGroup) pitchGroup.style.display = provider === 'browser' ? '' : 'none';
    if (groqVoiceGroup) groqVoiceGroup.style.display = provider === 'groq' ? '' : 'none';
    if (openaiVoiceGroup) openaiVoiceGroup.style.display = provider === 'openai' ? '' : 'none';
  }

  // Re-renders both chip rows — called on panel build and every time the
  // panel is opened, so newly added API keys (entered via Tuning → Audio)
  // show up here without needing a page reload.
  function renderAudioEngineSection(panel) {
    if (!panel) return;
    var ttsLocked = renderProviderChips(panel.querySelector('#vsTtsProviderRow'), TTS_PROVIDERS, 'ttsProvider');
    var sttLocked = renderProviderChips(panel.querySelector('#vsSttProviderRow'), STT_PROVIDERS, 'sttProvider');
    var moreLink = panel.querySelector('#vsAudioMoreLink');
    if (moreLink) {
      moreLink.style.display = (ttsLocked || sttLocked) ? 'block' : 'none';
      if (!moreLink._clickBound) {
        moreLink._clickBound = true;
        moreLink.addEventListener('click', function () {
          closeVoiceSettingsPanel();
          openAudioTuningPanel();
        });
      }
    }
    updateTtsProviderDependentVisibility();
  }

  function populateTtsVoices() {
    var sel = document.getElementById('vsTtsVoice');
    if (!sel || !window.speechSynthesis) return;
    var voices = speechSynthesis.getVoices();
    var prev   = sel.value;
    sel.innerHTML = '<option value="">— ' + t('voice.defaultVoice','Default') + ' —</option>';
    voices.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value       = v.voiceURI;
      opt.textContent = v.name + ' (' + v.lang + ')';
      if (v.voiceURI === vs.ttsVoice) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!sel.value && prev) sel.value = prev;
    // Set listeners only once
    if (!sel._voiceListenerAdded) {
      sel._voiceListenerAdded = true;
      sel.addEventListener('change', function () {
        vs.ttsVoice = sel.value;
        saveSettings({ ttsVoice: vs.ttsVoice });
      });
    }
  }

  function toggleVoiceSettingsPanel() {
    var panel = document.getElementById('voiceSettingsPanel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      positionVoiceSettingsPanel();
      renderAudioEngineSection(panel);
    }
  }

  // Positions the panel directly above its own gear button (with viewport
  // clamping on both axes) instead of anchoring to the send button — the
  // old anchor meant the popup could land far from the voice group itself
  // whenever the composer groups were reordered or wrapped onto a second
  // line on narrow viewports.
  function positionVoiceSettingsPanel() {
    var panel = document.getElementById('voiceSettingsPanel');
    if (!panel || !btnVoiceSettings) return;
    var rect = btnVoiceSettings.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var panelW = panel.offsetWidth || 310;
    var left = rect.right - panelW;
    left = Math.max(8, Math.min(left, vw - panelW - 8));
    panel.style.left = left + 'px';
    panel.style.right = 'auto';
    var spaceAbove = rect.top - 8, spaceBelow = vh - rect.bottom - 8;
    if (spaceAbove >= 200 || spaceAbove >= spaceBelow) {
      panel.style.bottom = (vh - rect.top + 8) + 'px';
      panel.style.top = 'auto';
    } else {
      panel.style.top = (rect.bottom + 8) + 'px';
      panel.style.bottom = 'auto';
    }
  }

  function closeVoiceSettingsPanel() {
    var panel = document.getElementById('voiceSettingsPanel');
    if (panel) panel.classList.remove('open');
  }

  // ── Access to config.audioProviders (kiconnect.js, read-only) ──────
  // `config` is not declared locally here — it resolves to kiconnect.js's
  // top-level `let config`, a global lexical binding shared across all
  // classic <script> tags on the page (same mechanism as TRANSLATIONS/
  // currentLang, see the comment on t() above). kiconnect.js loads first,
  // so config already exists by the time this file runs.
  function audioProviderKey(provider) {
    try { return (config && config.audioProviders && config.audioProviders[provider] && config.audioProviders[provider].apiKey) || ''; }
    catch (e) { return ''; }
  }
  function hasAudioProviderKey(provider) {
    return provider === 'browser' || !!audioProviderKey(provider);
  }
  function openAudioTuningPanel() {
    try { if (typeof openTuningPanel === 'function') openTuningPanel(); } catch (e) {}
  }
  function noKeyToast(icon) {
    showToast(icon + ' ' + t('voice.noApiKey', 'No API key set for this provider — check Tuning → Audio.'));
    openAudioTuningPanel();
  }

  // ══════════════════════════════════════════════════════════════════
  // TTS engines — one per provider, all exposing the same interface:
  //   speak(text, opts, {onstart, onend, onerror}) → {pause(), resume(), stop()}
  // This lets speakLastAssistantMessage()/speakBubble() and the bubble
  // Play/Pause/Resume/Stop submenu stay provider-agnostic: they just hold
  // on to whatever controller the active engine handed back.
  // ══════════════════════════════════════════════════════════════════
  var ttsEngines = {
    browser: {
      speak: function (text, opts, cbs) {
        if (!window.speechSynthesis) {
          showToast('🔇 ' + t('voice.ttsUnavailable', 'TTS not available.'));
          if (cbs.onerror) cbs.onerror('unavailable');
          return { pause: function () {}, resume: function () {}, stop: function () {} };
        }
        speechSynthesis.cancel();
        var utter = new SpeechSynthesisUtterance(text);
        utter.lang  = opts.lang;
        utter.rate  = opts.rate;
        utter.pitch = opts.pitch;
        if (opts.voiceURI) {
          var match = speechSynthesis.getVoices().filter(function (v) { return v.voiceURI === opts.voiceURI; });
          if (match.length) utter.voice = match[0];
        }
        utter.onstart = function () { if (cbs.onstart) cbs.onstart(); };
        utter.onend   = function () { if (cbs.onend) cbs.onend(); };
        utter.onerror = function () { if (cbs.onerror) cbs.onerror('speechSynthesis-error'); };
        speechSynthesis.speak(utter);
        return {
          pause:  function () { speechSynthesis.pause(); },
          resume: function () { speechSynthesis.resume(); },
          stop:   function () { speechSynthesis.cancel(); },
        };
      }
    },
    openai:     createHttpTtsEngine(fetchOpenAiTtsBlob),
    elevenlabs: createHttpTtsEngine(fetchElevenLabsTtsBlob),
    groq:       createChunkedHttpTtsEngine(fetchGroqTtsBlob, GROQ_TTS_MAX_CHARS),
  };

  // Groq's Orpheus TTS models cap `input` at 200 characters per request
  // (see https://console.groq.com/docs/text-to-speech/orpheus#limitations).
  // Kept a little under that as safety margin for multi-byte characters.
  var GROQ_TTS_MAX_CHARS = 190;

  // Splits `text` into chunks no longer than `maxLen`, preferring to break
  // on sentence boundaries (. ! ? followed by whitespace) so pauses land
  // naturally; falls back to a hard word-boundary split for any run-on
  // sentence longer than maxLen.
  function chunkTextForTts(text, maxLen) {
    var sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
    var chunks = [];
    var current = '';
    sentences.forEach(function (raw) {
      var s = raw.trim();
      if (!s) return;
      if (s.length > maxLen) {
        if (current) { chunks.push(current); current = ''; }
        var words = s.split(/\s+/);
        var piece = '';
        words.forEach(function (w) {
          var candidate = piece ? piece + ' ' + w : w;
          if (candidate.length > maxLen) {
            if (piece) chunks.push(piece);
            piece = w.length > maxLen ? w.slice(0, maxLen) : w;
          } else {
            piece = candidate;
          }
        });
        if (piece) chunks.push(piece);
        return;
      }
      var combined = current ? current + ' ' + s : s;
      if (combined.length > maxLen) {
        if (current) chunks.push(current);
        current = s;
      } else {
        current = combined;
      }
    });
    if (current) chunks.push(current);
    return chunks.length ? chunks : [text];
  }

  // Wraps an async "text → audio Blob" fetcher into the common TTS engine
  // interface, but first splits `text` into <=maxChars chunks and plays
  // them back-to-back through one <audio> element (queue advances on
  // `onended`). Needed for providers (Groq/Orpheus) with a short per-request
  // input limit; onstart fires once, on the very first chunk, and onend
  // fires once, after the last chunk finishes.
  function createChunkedHttpTtsEngine(fetchBlobFn, maxChars) {
    return {
      speak: function (text, opts, cbs) {
        var chunks = chunkTextForTts(text, maxChars);
        var idx = 0, audioEl = null, stopped = false, url = null, started = false;

        function playNext() {
          if (stopped) return;
          if (idx >= chunks.length) { if (cbs.onend) cbs.onend(); return; }
          var piece = chunks[idx++];
          fetchBlobFn(piece, opts).then(function (blob) {
            if (stopped) return;
            if (url) URL.revokeObjectURL(url);
            url = URL.createObjectURL(blob);
            audioEl = new Audio(url);
            try { audioEl.playbackRate = opts.rate || 1; } catch (e) {}
            audioEl.onplay = function () { if (!started) { started = true; if (cbs.onstart) cbs.onstart(); } };
            audioEl.onended = function () { playNext(); };
            audioEl.onerror = function () { if (url) URL.revokeObjectURL(url); if (cbs.onerror) cbs.onerror('audio-playback-error'); };
            audioEl.play().catch(function () { if (cbs.onerror) cbs.onerror('audio-play-blocked'); });
          }).catch(function (err) {
            if (err && err.message === 'no-key') noKeyToast('🔊');
            if (cbs.onerror) cbs.onerror(err && err.message);
          });
        }

        playNext();
        return {
          pause:  function () { if (audioEl) audioEl.pause(); },
          resume: function () { if (audioEl) audioEl.play().catch(function () {}); },
          stop:   function () { stopped = true; if (audioEl) { audioEl.pause(); audioEl.src = ''; } if (url) URL.revokeObjectURL(url); },
        };
      }
    };
  }

  // Wraps an async "text → audio Blob" fetcher into the common TTS engine
  // interface, playing the result through a plain <audio> element. The
  // controller is returned synchronously (before the fetch resolves) so
  // callers can attach it to _currentTtsController right away; pause/resume
  // calls that land before the audio element exists are harmless no-ops.
  function createHttpTtsEngine(fetchBlobFn) {
    return {
      speak: function (text, opts, cbs) {
        var audioEl = null, stopped = false, url = null;
        fetchBlobFn(text, opts).then(function (blob) {
          if (stopped) return;
          url = URL.createObjectURL(blob);
          audioEl = new Audio(url);
          try { audioEl.playbackRate = opts.rate || 1; } catch (e) {}
          audioEl.onplay = function () { if (cbs.onstart) cbs.onstart(); };
          audioEl.onended = function () { if (url) URL.revokeObjectURL(url); if (cbs.onend) cbs.onend(); };
          audioEl.onerror = function () { if (url) URL.revokeObjectURL(url); if (cbs.onerror) cbs.onerror('audio-playback-error'); };
          audioEl.play().catch(function () { if (cbs.onerror) cbs.onerror('audio-play-blocked'); });
        }).catch(function (err) {
          if (err && err.message === 'no-key') noKeyToast('🔊');
          if (cbs.onerror) cbs.onerror(err && err.message);
        });
        return {
          pause:  function () { if (audioEl) audioEl.pause(); },
          resume: function () { if (audioEl) audioEl.play().catch(function () {}); },
          stop:   function () { stopped = true; if (audioEl) { audioEl.pause(); audioEl.src = ''; } },
        };
      }
    };
  }

  // Extracts the provider's actual error message (e.g. Groq/OpenAI put it at
  // error.message in the JSON body) so failures show *why* a request was
  // rejected, not just the bare status code. Encoded into the Error's
  // message as 'tts-http-<code>::<detail>' since the engine callback chain
  // only passes a string through onerror(); ttsErrorToast() below decodes it.
  async function ttsHttpError(res) {
    var detail = '';
    try {
      var data = await res.clone().json();
      var raw = (data && data.error && (data.error.message || data.error)) || (data && data.message) || '';
      detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
    } catch (e) {
      try { detail = (await res.clone().text()).slice(0, 300); } catch (e2) {}
    }
    return new Error('tts-http-' + res.status + (detail ? '::' + detail : ''));
  }

  async function fetchOpenAiTtsBlob(text) {
    var apiKey = audioProviderKey('openai');
    if (!apiKey) throw new Error('no-key');
    var voice = vs.openaiTtsVoice || 'alloy';
    var res = await fetch(proxyUrl('https://api.openai.com/v1/audio/speech'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voice, input: text, response_format: 'mp3' }),
    });
    if (!res.ok) throw await ttsHttpError(res);
    return res.blob();
  }

  async function fetchGroqTtsBlob(text) {
    var apiKey = audioProviderKey('groq');
    if (!apiKey) throw new Error('no-key');
    // 'playai-tts' was decommissioned by Groq — current model is the
    // Orpheus v1 English TTS (max 200 chars/request, hence the chunking
    // in createChunkedHttpTtsEngine above). Voice is user-selectable in
    // the Voice Settings panel (vs.groqTtsVoice). See:
    // https://console.groq.com/docs/text-to-speech/orpheus
    var voice = vs.groqTtsVoice || 'troy';
    var res = await fetch(proxyUrl('https://api.groq.com/openai/v1/audio/speech'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'canopylabs/orpheus-v1-english', voice: voice, input: text, response_format: 'wav' }),
    });
    if (!res.ok) throw await ttsHttpError(res);
    return res.blob();
  }

  async function fetchElevenLabsTtsBlob(text) {
    var apiKey = audioProviderKey('elevenlabs');
    if (!apiKey) throw new Error('no-key');
    var voiceId = ((config && config.audioProviders && config.audioProviders.elevenlabs && config.audioProviders.elevenlabs.voiceId) || '21m00Tcm4TlvDq8ikWAM').trim();
    var res = await fetch(proxyUrl('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId)), {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text: text, model_id: 'eleven_multilingual_v2' }),
    });
    if (!res.ok) throw await ttsHttpError(res);
    return res.blob();
  }

  // ══════════════════════════════════════════════════════════════════
  // STT engines — one per provider, common interface:
  //   start(opts, {onstart, oninterim, onend, onerror}) → {stop()}
  // Groq/Whisper has no streaming API, so oninterim is never called for it
  // (a "recognizing…" placeholder is shown in the textarea instead — see
  // startStt() below); the transcript only arrives once, in onend().
  // ══════════════════════════════════════════════════════════════════
  var sttEngines = {
    browser: {
      start: function (opts, cbs) {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
          showToast('⚠️ ' + t('voice.sttUnavailable', 'Web Speech API not available.'));
          if (cbs.onerror) cbs.onerror('unavailable');
          return { stop: function () {} };
        }
        var rec = new SR();
        // continuous=true + our own silence timer (instead of the browser's
        // built-in, non-configurable, often-too-short end-of-speech cutoff)
        // so vs.sttSilenceMs actually governs when listening stops.
        rec.continuous     = true;
        rec.interimResults = true;
        rec.lang           = opts.lang;
        var finalText = '';
        var silenceTimer = null, maxTimer = null, stoppedByUs = false;

        function armSilenceTimer() {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(function () {
            stoppedByUs = true;
            try { rec.stop(); } catch (e) {}
          }, Math.max(1000, vs.sttSilenceMs || 3000));
        }

        rec.onstart = function () {
          armSilenceTimer();
          maxTimer = setTimeout(function () { stoppedByUs = true; try { rec.stop(); } catch (e) {} }, STT_MAX_LISTEN_MS);
          if (cbs.onstart) cbs.onstart();
        };
        rec.onresult = function (e) {
          var interim = '';
          for (var i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
            else                       interim   += e.results[i][0].transcript;
          }
          armSilenceTimer(); // any activity (interim or final) resets the silence clock
          if (cbs.oninterim) cbs.oninterim(interim);
        };
        rec.onend   = function () {
          if (silenceTimer) clearTimeout(silenceTimer);
          if (maxTimer) clearTimeout(maxTimer);
          if (cbs.onend) cbs.onend(finalText.trim());
        };
        rec.onerror = function (e) {
          // 'no-speech' fires naturally with continuous=true whenever the
          // engine briefly hears nothing; our own silence timer already
          // handles the "stop after N seconds of quiet" behavior, so treat
          // a no-speech error as a normal end rather than a real failure.
          if (e.error === 'no-speech') return;
          if (silenceTimer) clearTimeout(silenceTimer);
          if (maxTimer) clearTimeout(maxTimer);
          if (cbs.onerror) cbs.onerror(e.error);
        };
        try { rec.start(); }
        catch (err) { if (cbs.onerror) cbs.onerror('start-failed'); }
        return { stop: function () { stoppedByUs = true; if (silenceTimer) clearTimeout(silenceTimer); if (maxTimer) clearTimeout(maxTimer); try { rec.stop(); } catch (e) {} } };
      }
    },
    groq: {
      start: function (opts, cbs) {
        var recorder = null, stream = null, chunks = [], stopped = false;
        var audioCtx = null, analyser = null, vadRaf = null, silenceTimer = null, maxTimer = null;
        if (!navigator.mediaDevices || !window.MediaRecorder) {
          if (cbs.onerror) cbs.onerror('unavailable');
          return { stop: function () {} };
        }

        function stopRecorder() {
          if (recorder && recorder.state !== 'inactive') recorder.stop();
          else if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); });
        }

        // Groq's transcription endpoint has no streaming/VAD of its own — the
        // MediaRecorder would otherwise just record forever until the mic
        // button is clicked. We run a small Web Audio API level meter on the
        // live stream and auto-stop once volume has stayed under a quiet
        // threshold for vs.sttSilenceMs.
        function startSilenceDetection(liveStream) {
          try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
            var source = audioCtx.createMediaStreamSource(liveStream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            var data = new Uint8Array(analyser.fftSize);
            var SILENCE_RMS = 0.012;

            function armSilenceTimer() {
              if (silenceTimer) clearTimeout(silenceTimer);
              silenceTimer = setTimeout(function () { stopRecorder(); }, Math.max(1000, vs.sttSilenceMs || 3000));
            }
            armSilenceTimer();

            function tick() {
              if (stopped) return;
              analyser.getByteTimeDomainData(data);
              var sumSquares = 0;
              for (var i = 0; i < data.length; i++) {
                var v = (data[i] - 128) / 128;
                sumSquares += v * v;
              }
              var rms = Math.sqrt(sumSquares / data.length);
              if (rms > SILENCE_RMS) armSilenceTimer(); // heard something → push the deadline back
              vadRaf = requestAnimationFrame(tick);
            }
            vadRaf = requestAnimationFrame(tick);
          } catch (e) { /* level-meter is a best-effort convenience; recording still works without it */ }
        }

        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
          if (stopped) { s.getTracks().forEach(function (tr) { tr.stop(); }); return; }
          stream = s;
          try { recorder = new MediaRecorder(stream); }
          catch (err) { if (cbs.onerror) cbs.onerror('recorder-failed'); return; }
          recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
          recorder.onstart = function () {
            startSilenceDetection(stream);
            maxTimer = setTimeout(function () { stopRecorder(); }, STT_MAX_LISTEN_MS);
            if (cbs.onstart) cbs.onstart();
          };
          recorder.onstop = async function () {
            stopped = true;
            if (silenceTimer) clearTimeout(silenceTimer);
            if (maxTimer) clearTimeout(maxTimer);
            if (vadRaf) cancelAnimationFrame(vadRaf);
            if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
            stream.getTracks().forEach(function (tr) { tr.stop(); });
            if (!chunks.length) { if (cbs.onend) cbs.onend(''); return; }
            var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
            try {
              var text = await transcribeWithGroq(blob, opts.lang);
              if (cbs.onend) cbs.onend((text || '').trim());
            } catch (err) {
              if (err && err.message === 'no-key') { if (cbs.onerror) cbs.onerror('no-key'); }
              else if (cbs.onerror) cbs.onerror(err && err.message || 'transcribe-failed');
            }
          };
          recorder.start();
        }).catch(function () { if (cbs.onerror) cbs.onerror('not-allowed'); });
        return {
          stop: function () {
            stopped = true;
            if (silenceTimer) clearTimeout(silenceTimer);
            if (maxTimer) clearTimeout(maxTimer);
            if (vadRaf) cancelAnimationFrame(vadRaf);
            stopRecorder();
          }
        };
      }
    }
  };

  async function transcribeWithGroq(blob, lang) {
    var apiKey = audioProviderKey('groq');
    if (!apiKey) throw new Error('no-key');
    var form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', 'whisper-large-v3');
    if (lang) form.append('language', (lang.split('-')[0] || '').toLowerCase());
    var res = await fetch(proxyUrl('https://api.groq.com/openai/v1/audio/transcriptions'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      body: form,
    });
    if (!res.ok) throw new Error('stt-http-' + res.status);
    var data = await res.json();
    return data.text || '';
  }

  // ── STT (provider-agnostic entry points) ────────────────────────
  var currentSttSession = null;

  function toggleStt() {
    if (sttActive) stopStt(); else startStt();
  }

  function startStt() {
    var provider = vs.sttProvider || 'browser';
    if (!hasAudioProviderKey(provider)) { noKeyToast('🎤'); return; }
    var engine = sttEngines[provider] || sttEngines.browser;

    var ta = getTextarea();
    var base = ta ? ta.value : '';
    if (ta) ta.dataset.voiceBase = base;

    if (provider !== 'browser' && ta) {
      // No streaming STT for HTTP providers → show a placeholder instead of
      // live interim text, replaced with the real transcript in onend().
      ta.value = base + (base ? ' ' : '') + '⏺ ' + t('voice.recognizing', 'recognizing…');
      if (typeof autoResize === 'function') autoResize(ta);
    }

    currentSttSession = engine.start({ lang: vs.sttLang }, {
      onstart: function () { setMicState(true); },
      oninterim: function (interim) {
        var el = getTextarea();
        if (el) {
          var b = el.dataset.voiceBase || '';
          el.value = b + (b && interim ? ' ' : '') + interim;
          if (typeof autoResize === 'function') autoResize(el);
        }
      },
      onend: function (finalText) {
        setMicState(false);
        currentSttSession = null;
        var el = getTextarea();
        if (el) {
          var b = el.dataset.voiceBase || '';
          delete el.dataset.voiceBase;
          var full = (b + (b && finalText ? ' ' : '') + finalText).trim();
          el.value = full;
          if (typeof autoResize === 'function') autoResize(el);
          if (full && (vs.sttAutoSend || vs.dialogMode)) {
            setTimeout(function () {
              if (typeof sendMessage === 'function') sendMessage();
              else { var sb = document.getElementById('sendBtn'); if (sb) sb.click(); }
            }, 150);
          }
        }
      },
      onerror: function (err) {
        setMicState(false);
        currentSttSession = null;
        var el = getTextarea();
        if (el) delete el.dataset.voiceBase;
        if      (err === 'not-allowed' || err === 'mic-denied') showToast('🎤 ' + t('voice.micDenied', 'Microphone access denied.'));
        else if (err === 'no-speech')                           showToast('🔇 ' + t('voice.noSpeech',  'No speech detected.'));
        else if (err === 'no-key')                               noKeyToast('🎤');
        else if (err === 'unavailable')                          showToast('⚠️ ' + t('voice.sttUnavailable', 'Speech recognition not available.'));
        else                                                     showToast('STT: ' + err);
      },
    });
  }

  function stopStt() {
    if (currentSttSession) currentSttSession.stop();
    setMicState(false);
  }

  // ── TTS (provider-agnostic entry points) ─────────────────────────
  var _currentTtsController = null;

  function stopCurrentTtsController() {
    if (_currentTtsController) { try { _currentTtsController.stop(); } catch (e) {} }
    _currentTtsController = null;
  }

  // Speaks `text` with whatever provider is currently selected (vs.ttsProvider),
  // routing pause/resume/stop through whichever engine ends up handling it.
  // Any previously playing TTS (browser or HTTP) is stopped first — only one
  // thing can read aloud at a time, same as the original speechSynthesis-only
  // behavior.
  function speakTextWithCurrentProvider(text, cbs) {
    stopCurrentTtsController();
    var provider = vs.ttsProvider || 'browser';
    if (!hasAudioProviderKey(provider)) {
      noKeyToast('🔊');
      if (cbs.onerror) cbs.onerror('no-key');
      return null;
    }
    var engine = ttsEngines[provider] || ttsEngines.browser;
    var opts = { lang: vs.sttLang, rate: vs.ttsRate, pitch: vs.ttsPitch, voiceURI: vs.ttsVoice };
    _currentTtsController = engine.speak(text, opts, {
      onstart: function () { if (cbs.onstart) cbs.onstart(); },
      onend:   function () { _currentTtsController = null; if (cbs.onend) cbs.onend(); },
      onerror: function (err) { _currentTtsController = null; ttsErrorToast(provider, err); if (cbs.onerror) cbs.onerror(err); },
    });
    return _currentTtsController;
  }

  // Surfaces TTS failures that would otherwise fail silently (previously
  // onerror just reset UI state with no user-visible feedback). Decodes
  // 'tts-http-<code>::<detail>' (see ttsHttpError above) into a readable
  // message, including the provider's own error text when available —
  // also logged to console in full, since the toast auto-hides quickly and
  // long provider messages get truncated there.
  function ttsErrorToast(provider, err) {
    if (!err || err === 'no-key') return; // 'no-key' is already toasted by noKeyToast() before the engine even runs
    var httpMatch = /^tts-http-(\d+)(?:::([\s\S]*))?$/.exec(err);
    if (httpMatch) {
      var code = httpMatch[1];
      var detail = httpMatch[2] || '';
      if (detail) console.error('[TTS ' + provider + '] HTTP ' + code + ':', detail);
      var suffix = detail ? ' — ' + (detail.length > 140 ? detail.slice(0, 140) + '…' : detail) : '';
      if (code === '429') {
        showToast('⏳ ' + tv('voice.ttsQuota', 'TTS ({provider}): quota/balance exhausted (429).{suffix}', { provider, suffix }));
      } else if (code === '401' || code === '403') {
        showToast('🔑 ' + tv('voice.ttsAuth', 'TTS ({provider}): API key invalid or rejected ({code}).{suffix}', { provider, code, suffix }));
      } else if (code === '400') {
        showToast('⚠️ ' + tv('voice.ttsBadRequest', 'TTS ({provider}): request rejected (400){suffix}.', { provider, suffix: suffix || ' — check model/parameters' }));
      } else {
        showToast('⚠️ ' + tv('voice.ttsHttpError', 'TTS ({provider}): error HTTP {code}.{suffix}', { provider, code, suffix }));
      }
      return;
    }
    if (err === 'audio-play-blocked') {
      showToast('🔇 ' + t('voice.ttsBlocked', 'Playback blocked — please click the page and try again.'));
    } else if (err === 'audio-playback-error') {
      showToast('⚠️ ' + t('voice.ttsPlaybackError', 'Audio playback error.'));
    } else if (err !== 'unavailable' && err !== 'speechSynthesis-error') {
      showToast('⚠️ TTS (' + provider + '): ' + err);
    }
  }

  function toggleTts() {
    if (ttsActive) stopTts(); else speakLastAssistantMessage(null);
  }

  function stopTts() {
    stopCurrentTtsController();
    setTtsState(false);
    dialogPending = false;
  }

  function getLastAssistantText() {
    var rows = document.querySelectorAll('.message-row.ai');
    if (!rows.length) return '';
    var bubble = rows[rows.length - 1].querySelector('.bubble');
    if (!bubble) return '';
    var clone = bubble.cloneNode(true);
    clone.querySelectorAll('pre, code, .code-block, .thinking-block, details, .token-badge').forEach(function (el) { el.remove(); });
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function speakLastAssistantMessage(onEnd) {
    var text = getLastAssistantText();
    if (!text) {
      showToast(t('voice.noReply', 'No reply found to read aloud.'));
      return;
    }
    var ctrl = speakTextWithCurrentProvider(text, {
      onstart: function () { setTtsState(true); },
      onend:   function () { setTtsState(false); if (typeof onEnd === 'function') onEnd(); },
      onerror: function () { setTtsState(false); dialogPending = false; },
    });
    if (!ctrl) setTtsState(false);
  }

  // ── Bubble TTS (per-bubble voice controls) ───────────────────────

  var _currentBubbleCtrl = null;

  function getBubbleText(voiceCtrlEl) {
    var bubble = voiceCtrlEl.closest('.bubble-wrap') && voiceCtrlEl.closest('.bubble-wrap').querySelector('.bubble');
    if (!bubble) return '';
    var clone = bubble.cloneNode(true);
    clone.querySelectorAll('pre, code, .code-block, .thinking-block, details, .token-badge, .bubble-voice-controls').forEach(function (el) { el.remove(); });
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function ensureSubmenu(voiceCtrlEl) {
    var existing = voiceCtrlEl.querySelector('.voice-submenu');
    if (existing) return existing;
    var menu = document.createElement('div');
    menu.className = 'voice-submenu';
    menu.innerHTML = [
      '<button class="voice-submenu-btn" data-va="play">▶ Play</button>',
      '<button class="voice-submenu-btn" data-va="pause">⏸ Pause</button>',
      '<button class="voice-submenu-btn" data-va="resume" style="display:none">▶ Resume</button>',
      '<button class="voice-submenu-btn" data-va="stop">⏹ Stop</button>',
    ].join('');
    voiceCtrlEl.appendChild(menu);
    return menu;
  }

  function updateBubbleSubmenuState(voiceCtrlEl, state) {
    var menu = voiceCtrlEl.querySelector('.voice-submenu');
    if (!menu) return;
    var pause  = menu.querySelector('[data-va="pause"]');
    var resume = menu.querySelector('[data-va="resume"]');
    if (state === 'playing') {
      if (pause)  pause.style.display  = '';
      if (resume) resume.style.display = 'none';
    } else if (state === 'paused') {
      if (pause)  pause.style.display  = 'none';
      if (resume) resume.style.display = '';
    } else {
      if (pause)  pause.style.display  = '';
      if (resume) resume.style.display = 'none';
    }
  }

  function speakBubble(voiceCtrlEl) {
    var text = getBubbleText(voiceCtrlEl);
    if (!text) { showToast(t('voice.noTextToRead', 'No text to read.')); return; }

    _currentBubbleCtrl = voiceCtrlEl;
    var btn = voiceCtrlEl.querySelector('.bubble-voice-btn');

    speakTextWithCurrentProvider(text, {
      onstart: function () {
        if (btn) btn.classList.add('playing');
        updateBubbleSubmenuState(voiceCtrlEl, 'playing');
      },
      onend: function () {
        if (btn) btn.classList.remove('playing');
        var menu = voiceCtrlEl.querySelector('.voice-submenu');
        if (menu) menu.classList.remove('open');
        updateBubbleSubmenuState(voiceCtrlEl, 'idle');
        _currentBubbleCtrl = null;
      },
      onerror: function () {
        if (btn) btn.classList.remove('playing');
        updateBubbleSubmenuState(voiceCtrlEl, 'idle');
        _currentBubbleCtrl = null;
      },
    });
  }

  function hookBubbleVoiceControls() {
    document.addEventListener('click', function (e) {
      // Toggle submenu on 🔊 button click
      var bubbleBtn = e.target.closest('.bubble-voice-btn');
      if (bubbleBtn) {
        e.stopPropagation();
        var ctrl = bubbleBtn.closest('.bubble-voice-controls');
        var menu = ensureSubmenu(ctrl);
        var isOpen = menu.classList.contains('open');
        // Close all other open submenus
        document.querySelectorAll('.voice-submenu.open').forEach(function (m) { m.classList.remove('open'); });
        if (!isOpen) menu.classList.add('open');
        return;
      }

      // Submenu action buttons
      var actionBtn = e.target.closest('.voice-submenu-btn');
      if (actionBtn) {
        e.stopPropagation();
        var ctrl = actionBtn.closest('.bubble-voice-controls');
        var action = actionBtn.getAttribute('data-va');
        if (action === 'play') {
          speakBubble(ctrl);
        } else if (action === 'pause') {
          if (_currentTtsController) _currentTtsController.pause();
          if (ctrl === _currentBubbleCtrl) updateBubbleSubmenuState(ctrl, 'paused');
        } else if (action === 'resume') {
          if (_currentTtsController) _currentTtsController.resume();
          if (ctrl === _currentBubbleCtrl) updateBubbleSubmenuState(ctrl, 'playing');
        } else if (action === 'stop') {
          stopCurrentTtsController();
          if (_currentBubbleCtrl) {
            _currentBubbleCtrl.querySelector('.bubble-voice-btn').classList.remove('playing');
            _currentBubbleCtrl.querySelector('.voice-submenu').classList.remove('open');
            updateBubbleSubmenuState(_currentBubbleCtrl, 'idle');
            _currentBubbleCtrl = null;
          }
        }
        return;
      }

      // Click outside → close all submenus
      if (!e.target.closest('.bubble-voice-controls')) {
        document.querySelectorAll('.voice-submenu.open').forEach(function (m) { m.classList.remove('open'); });
      }
    });
  }

  // ── Dialog mode ─────────────────────────────────────────────────
  // Watches the chat: as soon as a new AI bubble is complete,
  // it will be read aloud and the microphone restarted afterwards.
  function hookDialogMode() {
    var messagesEl = document.getElementById('messages');
    if (!messagesEl) return;

    var observer = new MutationObserver(function () {
      if (!vs.dialogMode || dialogPending) return;

      // Check: no typing indicator present
      if (messagesEl.querySelector('.message-row.typing')) return;

      var rows = messagesEl.querySelectorAll('.message-row.ai');
      if (!rows.length) return;

      var lastRow = rows[rows.length - 1];
      if (lastRow.dataset.voiceRead) return;  // already handled

      var bubble = lastRow.querySelector('.bubble');
      if (!bubble || !bubble.textContent.trim()) return;

      // Mark as read
      lastRow.dataset.voiceRead = '1';
      dialogPending = true;

      setTimeout(function () {
        speakLastAssistantMessage(function () {
          dialogPending = false;
          // If dialog still active: listen again
          if (vs.dialogMode) {
            setTimeout(startStt, 500);
          }
        });
      }, 700);
    });

    observer.observe(messagesEl, { childList: true, subtree: true, characterData: true });
  }

  function hookSendStop() {
    var sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) return;
    sendBtn.addEventListener('click', function () {
      if (ttsActive) stopTts();
    }, true);
  }

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    waitForElement('sendBtn', function () {
      injectButtons();
      buildVoiceSettingsPanel();
      hookSendStop();
      hookDialogMode();
      hookBubbleVoiceControls();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 300);
  }

  window.addEventListener('resize', function () {
    var panel = document.getElementById('voiceSettingsPanel');
    if (panel && panel.classList.contains('open')) positionVoiceSettingsPanel();
  });

  // Language change hook — no panel rebuild, DOM update only via data-i18n
  window._kicVoiceRetranslate = function () {
    var panel = document.getElementById('voiceSettingsPanel');
    if (panel) { _retranslatePanelDom(panel); renderAudioEngineSection(panel); }
    // Update button titles
    if (btnMic) {
      btnMic.title = sttActive ? t('voice.micStop', 'Stop recording') : t('voice.micStart', 'Start voice input');
    }
    if (btnTts) {
      btnTts.title = ttsActive ? t('voice.ttsStop', 'Stop speech output') : t('voice.ttsStart', 'Read last reply aloud');
    }
    if (btnVoiceSettings) {
      btnVoiceSettings.title = t('voice.settingsTitle', 'Voice Settings');
    }
    var badge = document.getElementById('voiceDialogBadge');
    if (badge) badge.title = t('voice.dialogStop', 'Stop dialog mode – click to stop');
  };
  
})();
