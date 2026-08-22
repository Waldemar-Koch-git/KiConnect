// kiconnect-voice.js  –  Speech input & speech output (Web Speech API)
// Version 2.1 – fully revised

(function () {
  'use strict';

  // Settings
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
    ttsProvider: 'browser',   // 'browser' | 'openai' | 'elevenlabs' | 'groq' | 'gemini'
    sttProvider: 'browser',   // 'browser' | 'groq' | 'gemini'
    sttSilenceMs: 3000,    // how long to wait in silence before auto-stopping listening
    groqTtsVoice: 'troy',     // Groq/Orpheus TTS speaker persona
    openaiTtsVoice: 'alloy',  // OpenAI gpt-4o-mini-tts speaker persona
    geminiTtsVoice: 'Kore',   // Gemini TTS prebuilt voice name
    gcloudTtsVoice: 'Aoede',  // Google Cloud TTS Chirp 3: HD persona (combined with vs.sttLang → "de-DE-Chirp3-HD-Aoede")
    ...loadSettings(),
  };

  // Hard safety cap so listening never runs away indefinitely if silence
  // detection somehow never fires. Not user-configurable — it's a backstop.
  var STT_MAX_LISTEN_MS = 90000;

  // Bridge to the Tuning panel's Audio section (kiconnect.js). Provider
  // choices live in `vs` (localStorage); API keys stay encrypted in
  // config.audioProviders and are only read here, never written.
  window.kicVoiceGetSetting = function (key) { return vs[key]; };
  window.kicVoiceSetSetting = function (key, value) {
    vs[key] = value;
    saveSettings({ [key]: value });
    if (key === 'dialogMode') updateDialogBadge();
  };

  // State
  let sttActive     = false;
  let ttsActive     = false;
  let ttsPaused     = false;
  let dialogPending = false;
  let btnMic, btnTts, btnTtsPause, btnVoiceSettings;

  // i18n helper. TRANSLATIONS/currentLang are global lexical bindings (not
  // on window) but still accessible as plain identifiers inside this IIFE.
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
  // Like t(), but substitutes {placeholder} tokens (dynamic values like provider/HTTP code).
  function tv(key, fallbackTemplate, vars) {
    let s = t(key, fallbackTemplate);
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, v ?? ''); });
    return s;
  }

  // DOM helper functions
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

  // SVG icons
  var SVG_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6"/></svg>';

  var SVG_MIC_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6"/><line x1="4" y1="4" x2="20" y2="20" stroke="#e74c3c" stroke-width="2.5"/></svg>';

  var SVG_SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

  var SVG_SPEAKER_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15" stroke="#e74c3c"/><line x1="17" y1="9" x2="23" y2="15" stroke="#e74c3c"/></svg>';

  // Pause/Resume toggle next to the main 🔊 button while it's active.
  var SVG_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  var SVG_RESUME = '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><polygon points="6 4 20 12 6 20 6 4"/></svg>';

  var SVG_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  // Inject CSS
  function injectStyles() {
    var s = document.createElement('style');
    s.id = 'kiconnect-voice-styles';
    s.textContent = [
      /* Grouped like .panel-toolbar in the header: a bordered frame around
         the mic/TTS/settings trio, distinct from other input-action icons. */
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

  // Button status
  function setMicState(active) {
    sttActive = active;
    if (!btnMic) return;
    btnMic.classList.toggle('voice-active', active);
    btnMic.title    = active ? t('voice.micStop')     : t('voice.micStart');
    btnMic.innerHTML = active ? SVG_MIC_STOP : SVG_MIC;
  }

  // Unified TTS UI sync. Only one thing can be read aloud at a time (see
  // stopCurrentTtsController), so the main 🔊 button and whichever bubble's
  // Play button is involved must show the same play/pause state.
  // state: 'idle' | 'playing' | 'paused'. bubbleCtrl: the triggering
  // .bubble-voice-controls element, or null for the main button (mirrors
  // onto the last-assistant-message bubble, since it reads the same text).
  function syncTtsUi(state, bubbleCtrl) {
    ttsActive = state !== 'idle';
    ttsPaused = state === 'paused';

    if (btnTts) {
      btnTts.classList.toggle('voice-active', ttsActive);
      btnTts.title    = ttsActive ? t('voice.ttsStop') : t('voice.ttsStart');
      btnTts.innerHTML = ttsActive ? SVG_SPEAKER_STOP : SVG_SPEAKER;
    }
    setTtsPauseButtonState(state === 'idle' ? 'hidden' : state);

    var targetBubble = state === 'idle' ? null : (bubbleCtrl || findLastBubbleVoiceControls());
    if (_currentBubbleCtrl && _currentBubbleCtrl !== targetBubble) setBubbleVoiceUi(_currentBubbleCtrl, 'idle');
    if (targetBubble) setBubbleVoiceUi(targetBubble, state);
    _currentBubbleCtrl = targetBubble;
  }

  // Shows/hides + relabels the Pause/Resume button next to the main 🔊
  // button: 'hidden'/'playing' (Pause icon)/'paused' (Resume icon).
  function setTtsPauseButtonState(state) {
    if (!btnTtsPause) return;
    if (state === 'hidden') {
      btnTtsPause.style.display = 'none';
      return;
    }
    btnTtsPause.style.display = '';
    var paused = state === 'paused';
    btnTtsPause.innerHTML = paused ? SVG_RESUME : SVG_PAUSE;
    btnTtsPause.title = paused ? t('voice.ttsResume') : t('voice.ttsPause');
  }

  function toggleTtsPause() {
    if (!_currentTtsController) return;
    if (ttsPaused) {
      _currentTtsController.resume();
      syncTtsUi('playing', _currentBubbleCtrl);
    } else {
      _currentTtsController.pause();
      syncTtsUi('paused', _currentBubbleCtrl);
    }
  }

  // Insert buttons (LEFT of send button)
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
    btnMic.title     = t('voice.micStart');
    btnMic.innerHTML = SVG_MIC;
    btnMic.addEventListener('click', toggleStt);

    btnTts = document.createElement('button');
    btnTts.type      = 'button';
    btnTts.id        = 'voiceTtsBtn';
    btnTts.className = 'voice-btn';
    btnTts.title     = t('voice.ttsStart');
    btnTts.innerHTML = SVG_SPEAKER;
    btnTts.addEventListener('click', toggleTts);

    // Pause/Resume — hidden until playback starts (see setTtsPauseButtonState).
    btnTtsPause = document.createElement('button');
    btnTtsPause.type      = 'button';
    btnTtsPause.id        = 'voiceTtsPauseBtn';
    btnTtsPause.className = 'voice-btn';
    btnTtsPause.style.display = 'none';
    btnTtsPause.title     = t('voice.ttsPause');
    btnTtsPause.innerHTML = SVG_PAUSE;
    btnTtsPause.addEventListener('click', function (e) { e.stopPropagation(); toggleTtsPause(); });

    btnVoiceSettings = document.createElement('button');
    btnVoiceSettings.type      = 'button';
    btnVoiceSettings.id        = 'voiceSettingsBtn';
    btnVoiceSettings.className = 'voice-gear-btn';
    btnVoiceSettings.title     = t('voice.settingsTitle');
    btnVoiceSettings.innerHTML = SVG_GEAR;
    btnVoiceSettings.addEventListener('click', toggleVoiceSettingsPanel);

    // Order: sep | [🎤 | 🔊 | ⚙] | [Send] — the trio sits inside one bordered
    // frame (like the header's .panel-toolbar) as a distinct "voice" group.
    group.appendChild(btnMic);
    group.appendChild(btnTts);
    group.appendChild(btnTtsPause);
    group.appendChild(btnVoiceSettings);
    actions.insertBefore(group, sendBtn);

    // Dialog badge in header
    var dialogBadge = document.createElement('span');
    dialogBadge.id        = 'voiceDialogBadge';
    dialogBadge.title     = t('voice.dialogStop');
    dialogBadge.textContent = '🎙️ Dialog';
    dialogBadge.addEventListener('click', function () {
      vs.dialogMode = false;
      saveSettings({ dialogMode: false });
      updateDialogBadge();
      stopStt();
      stopTts();
      showToast(t('voice.dialogStopped'));
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
  

  // Settings panel
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

        '<div class="vs-group" id="vsGeminiTtsVoiceGroup" style="display:none;">',
          '<div class="vs-label" data-i18n="voice.geminiTtsVoice">Speaker (Gemini TTS)</div>',
          '<select class="vs-select" id="vsGeminiTtsVoice">',
            '<option value="Kore">Kore (female, firm)</option>',
            '<option value="Puck">Puck (male, upbeat)</option>',
            '<option value="Charon">Charon (male, informative)</option>',
            '<option value="Fenrir">Fenrir (male, excitable)</option>',
            '<option value="Leda">Leda (female, youthful)</option>',
            '<option value="Aoede">Aoede (female, breezy)</option>',
            '<option value="Orus">Orus (male, firm)</option>',
            '<option value="Zephyr">Zephyr (female, bright)</option>',
            '<option value="Enceladus">Enceladus (male, breathy)</option>',
            '<option value="Algieba">Algieba (male, smooth)</option>',
          '</select>',
        '</div>',

        '<div class="vs-group" id="vsGcloudTtsVoiceGroup" style="display:none;">',
          '<div class="vs-label" data-i18n="voice.gcloudTtsVoice">Speaker (Google Cloud TTS – Chirp 3: HD)</div>',
          '<select class="vs-select" id="vsGcloudTtsVoice">',
            '<option value="Aoede">Aoede (female)</option>',
            '<option value="Puck">Puck (male)</option>',
            '<option value="Charon">Charon (male)</option>',
            '<option value="Kore">Kore (female)</option>',
            '<option value="Fenrir">Fenrir (male)</option>',
            '<option value="Leda">Leda (female)</option>',
            '<option value="Orus">Orus (male)</option>',
            '<option value="Zephyr">Zephyr (female)</option>',
            '<option value="Enceladus">Enceladus (male)</option>',
            '<option value="Algieba">Algieba (male)</option>',
          '</select>',
          '<div style="font-size:10px;color:var(--muted,#666b7e);margin-top:4px;font-family:\'IBM Plex Mono\',monospace;line-height:1.4;" data-i18n="voice.gcloudTtsVoiceHint">Combined with the recognition language above (e.g. "de-DE" → "de-DE-Chirp3-HD-…"). Not every voice exists in every language.</div>',
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
        showToast(t('voice.dialogStarted'));
      } else {
        stopStt();
        stopTts();
        showToast(t('voice.dialogStopped'));
      }
    });

    // Close
    panel.querySelector('#vsClose').addEventListener('click', closeVoiceSettingsPanel);
    // Uses composedPath() rather than panel.contains(e.target): the TTS/STT
    // provider chips rebuild their container's innerHTML on click, detaching
    // the clicked node before this bubbled listener runs —
    // panel.contains(e.target) would then wrongly return false and close the
    // panel. composedPath() is captured at dispatch time and stays correct.
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

    // Gemini TTS speaker
    var geminiVoiceSel = panel.querySelector('#vsGeminiTtsVoice');
    geminiVoiceSel.value = vs.geminiTtsVoice || 'Kore';
    geminiVoiceSel.addEventListener('change', function () {
      vs.geminiTtsVoice = geminiVoiceSel.value;
      saveSettings({ geminiTtsVoice: vs.geminiTtsVoice });
    });

    // Google Cloud TTS (Chirp 3: HD) speaker
    var gcloudVoiceSel = panel.querySelector('#vsGcloudTtsVoice');
    gcloudVoiceSel.value = vs.gcloudTtsVoice || 'Aoede';
    gcloudVoiceSel.addEventListener('change', function () {
      vs.gcloudTtsVoice = gcloudVoiceSel.value;
      saveSettings({ gcloudTtsVoice: vs.gcloudTtsVoice });
    });

    populateTtsVoices();
    if (window.speechSynthesis) {
      speechSynthesis.addEventListener('voiceschanged', populateTtsVoices);
    }

    renderAudioEngineSection(panel);
  }

  // Engine quick-switch chips (TTS/STT). Only lists providers that need no
  // key (browser) or already have one configured in the Tuning panel, so a
  // provider only shows up once it's actually usable.
  var TTS_PROVIDERS = [
    { id: 'browser',    icon: '🖥️', needsKey: false, nameKey: 'audio.providerBrowser' },
    { id: 'openai',     icon: '🟢', needsKey: true,  nameKey: 'audio.providerOpenAI' },
    { id: 'elevenlabs', icon: '🎙️', needsKey: true,  nameKey: 'audio.providerElevenLabs' },
    { id: 'groq',       icon: '⚡', needsKey: true,  nameKey: 'audio.providerGroq' },
    { id: 'gemini',     icon: '✨', needsKey: true,  nameKey: 'audio.providerGemini' },
    { id: 'gcloud',     icon: '☁️', needsKey: true,  nameKey: 'audio.providerGcloud' },
  ];
  var STT_PROVIDERS = [
    { id: 'browser', icon: '🖥️', needsKey: false, nameKey: 'audio.providerBrowser' },
    { id: 'groq',    icon: '⚡', needsKey: true,  nameKey: 'audio.providerGroqWhisper' },
    { id: 'gemini',  icon: '✨', needsKey: true,  nameKey: 'audio.providerGemini' },
  ];

  // Renders the chip row for one provider list, marking the active one;
  // returns true if any provider is still locked behind a missing key.
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
      chip.innerHTML = '<span class="vs-chip-icon">' + p.icon + '</span><span class="vs-chip-name">' + t(p.nameKey) + '</span>';
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
    var geminiVoiceGroup = document.getElementById('vsGeminiTtsVoiceGroup');
    var gcloudVoiceGroup = document.getElementById('vsGcloudTtsVoiceGroup');
    if (voiceGroup) voiceGroup.style.display = provider === 'browser' ? '' : 'none';
    if (pitchGroup) pitchGroup.style.display = provider === 'browser' ? '' : 'none';
    if (groqVoiceGroup) groqVoiceGroup.style.display = provider === 'groq' ? '' : 'none';
    if (openaiVoiceGroup) openaiVoiceGroup.style.display = provider === 'openai' ? '' : 'none';
    if (geminiVoiceGroup) geminiVoiceGroup.style.display = provider === 'gemini' ? '' : 'none';
    if (gcloudVoiceGroup) gcloudVoiceGroup.style.display = provider === 'gcloud' ? '' : 'none';
  }

  // Re-renders both chip rows on panel build/open, so newly added API keys
  // (via Tuning → Audio) show up without a page reload.
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
    sel.innerHTML = '<option value="">— ' + t('voice.defaultVoice') + ' —</option>';
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

  // Positions the panel above its own gear button (viewport-clamped)
  // instead of anchoring to the send button — the old anchor could land the
  // popup far from the voice group on reordered/wrapped narrow layouts.
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

  // Access to config.audioProviders (kiconnect.js, read-only). `config` is
  // not declared locally — it resolves to kiconnect.js's top-level `let
  // config`, a global lexical binding shared across script tags (same
  // mechanism as TRANSLATIONS/currentLang above); kiconnect.js loads first.
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
    showToast(icon + ' ' + t('voice.noApiKey'));
    openAudioTuningPanel();
  }

  // Guard against MathJax's own Explorer/Speech feature. MathJax 4's
  // "explorer" a11y extension calls its own cancelVoice() on formula
  // mousedown, which kills whatever speechSynthesis utterance is playing,
  // including ours (confirmed via stack trace). Intercepting the click
  // itself is unreliable, so instead window.speechSynthesis.cancel() is
  // wrapped: while our browser-TTS is speaking, external cancel() calls are
  // swallowed; our own code bypasses the wrapper via _nativeSpeechCancel and
  // can still cancel normally. Only matters for the 'browser' TTS engine —
  // HTTP-based providers play through <audio> and never touch speechSynthesis.
  var _nativeSpeechCancel = null;
  var _browserEngineSpeaking = false; // true only while OUR utterance is actually playing
  (function installCancelGuard() {
    if (!window.speechSynthesis || window.speechSynthesis.__kicCancelGuarded) return;
    var ss = window.speechSynthesis;
    _nativeSpeechCancel = ss.cancel.bind(ss);
    ss.cancel = function () {
      if (!_browserEngineSpeaking) return _nativeSpeechCancel();
      // Swallowed: something other than our own code (MathJax's formula
      // explorer, see note above) tried to cancel while we're speaking.
      // Expected and harmless — playback just continues.
    };
    ss.__kicCancelGuarded = true;
  })();

  // TTS engines, one per provider, all exposing the same interface:
  //   speak(text, opts, {onstart, onend, onerror}) → {pause(), resume(), stop()}
  // Lets speakLastAssistantMessage()/speakBubble() and the bubble submenu
  // stay provider-agnostic, just holding onto whatever controller comes back.
  var ttsEngines = {
    browser: {
      speak: function (text, opts, cbs) {
        if (!window.speechSynthesis) {
          showToast('🔇 ' + t('voice.ttsUnavailable'));
          if (cbs.onerror) cbs.onerror('unavailable');
          return { pause: function () {}, resume: function () {}, stop: function () {} };
        }
        _nativeSpeechCancel();

        // Chrome's native speech engine has an undocumented per-utterance
        // length ceiling: past it, speak() silently does nothing (looks like
        // a dead button on long replies). Splitting into sentence-bounded
        // chunks and queuing them back-to-back sidesteps it — same
        // chunkTextForTts() the HTTP TTS providers use for their documented
        // limits — with inaudible chunk boundaries since the next utterance
        // queues immediately.
        var chunks = chunkTextForTts(text, BROWSER_TTS_CHUNK_MAX_CHARS);
        var chunkIdx = 0;
        var utter = null;

        // Reliability workarounds for well-known Web Speech API bugs:
        // 1) Chrome/Edge can silently drop an utterance if speak() runs right
        //    after cancel(), before the queue flushes — defer to a macrotask.
        // 2) pause() before onstart fires is silently ignored by Chrome —
        //    buffer an early pause() and apply it once onstart fires.
        // 3) Chrome stops firing progress on long utterances (~15s+) if
        //    left untouched — a periodic harmless pause()+resume() "kick"
        //    while speaking prevents it from silently dying.
        // 4) That kick can itself misfire on some Chrome builds, tearing the
        //    utterance down (onerror 'interrupted'/'canceled', confirmed via
        //    event logging to only follow a kick, never real user action).
        //    An error right after our last kick is treated as a kick
        //    self-abort, not a real stop: resume from the last word boundary.
        var started = false, pendingPause = false, userPaused = false, keepAliveTimer = null;
        var canceled = false; // true once stop() has been called, even before speak() was actually issued
        var lastKickAt = 0;   // timestamp of the most recent keep-alive pause()/resume() kick
        var lastBoundaryIdx = 0; // charIndex of the last word boundary we heard within the CURRENT chunk, for recovery
        var recoveryAttempts = 0;
        var MAX_RECOVERY_ATTEMPTS = 5;
        var KICK_ERROR_WINDOW_MS = 1500; // error within this window of a kick is blamed on the kick

        // The keep-alive kick works around a Chrome bug where speechSynthesis
        // stalls after ~15s+ on *network* voices only — it doesn't affect
        // *local* voices (Windows SAPI, macOS system). On local engines,
        // pause()+resume() is a real OS round-trip with unpredictable
        // multi-second latency, so kicking one introduces the exact audible
        // gap the kick was meant to prevent. Only arm it for non-local voices.
        function isLocalVoice() {
          try {
            var voices = speechSynthesis.getVoices();
            var match;
            if (opts.voiceURI) {
              match = voices.filter(function (v) { return v.voiceURI === opts.voiceURI; });
            } else {
              // No explicit voice chosen — check the engine's default voice
              // instead. On Windows, that default is typically local SAPI.
              match = voices.filter(function (v) { return v.default; });
            }
            return !!(match.length && match[0].localService);
          } catch (e) { return false; }
        }

        function clearKeepAlive() {
          if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
        }
        function startKeepAlive() {
          clearKeepAlive();
          if (isLocalVoice()) return; // local engines don't need it and audibly stutter from it
          keepAliveTimer = setInterval(function () {
            if (!speechSynthesis.speaking) { clearKeepAlive(); return; }
            if (userPaused) return; // don't fight an intentional pause
            lastKickAt = Date.now();
            try { speechSynthesis.pause(); speechSynthesis.resume(); } catch (e) {}
          }, 12000);
        }

        function makeUtterance(chunkText) {
          var u = new SpeechSynthesisUtterance(chunkText);
          u.lang  = opts.lang;
          u.rate  = opts.rate;
          u.pitch = opts.pitch;
          if (opts.voiceURI) {
            var match = speechSynthesis.getVoices().filter(function (v) { return v.voiceURI === opts.voiceURI; });
            if (match.length) u.voice = match[0];
          }
          return u;
        }

        // Wires up on{start,boundary,end,error} identically for the initial,
        // recovery-restart, and next-chunk utterances. `isRestart` suppresses
        // cbs.onstart() so callers don't get a second "started" callback for
        // kick recoveries or chunk advances (only the first attempt fires it).
        function attachHandlers(u, isRestart) {
          u.onstart = function () {
            started = true;
            _browserEngineSpeaking = true;
            startKeepAlive();
            if (pendingPause) { pendingPause = false; userPaused = true; speechSynthesis.pause(); }
            if (!isRestart && cbs.onstart) cbs.onstart();
          };
          u.onboundary = function (ev) {
            if (ev && typeof ev.charIndex === 'number') lastBoundaryIdx = ev.charIndex;
          };
          u.onend = function () {
            clearKeepAlive();
            if (canceled) { _browserEngineSpeaking = false; return; }
            chunkIdx++;
            if (chunkIdx < chunks.length) {
              // More chunks queued — an internal seam, not the reply's end,
              // so no cbs.onend() here; playChunk() fires the next chunk.
              lastBoundaryIdx = 0;
              recoveryAttempts = 0;
              playChunk(chunkIdx);
            } else {
              _browserEngineSpeaking = false;
              if (cbs.onend) cbs.onend();
            }
          };
          // event.error is 'canceled'/'interrupted' whenever anything calls
          // speechSynthesis.cancel(): our own stop()/pause() (expected), our
          // keep-alive kick misfiring (note 4 above, recovered silently
          // below), or real outside interference. MathJax's own cancel()
          // calls are blocked before reaching here (see installCancelGuard),
          // so this mostly sees our own cancels and rare kick misfires.
          u.onerror = function (ev) {
            clearKeepAlive();
            var reason = (ev && ev.error) || 'unknown';
            var expected = canceled || (userPaused && reason === 'canceled');
            if (expected) {
              _browserEngineSpeaking = false;
              if (cbs.onerror) cbs.onerror('speechSynthesis-error');
              return;
            }
            var kickCausedIt = (Date.now() - lastKickAt) < KICK_ERROR_WINDOW_MS
              && (reason === 'interrupted' || reason === 'canceled');
            if (kickCausedIt && recoveryAttempts < MAX_RECOVERY_ATTEMPTS && lastBoundaryIdx < chunks[chunkIdx].length) {
              recoveryAttempts++;
              console.warn('[KIC voice] keep-alive kick self-aborted speech (reason: ' + reason + ') — resuming chunk ' + chunkIdx + ' from char ' + lastBoundaryIdx + ' (attempt ' + recoveryAttempts + '/' + MAX_RECOVERY_ATTEMPTS + ')');
              restartFrom(lastBoundaryIdx);
              return;
            }
            _browserEngineSpeaking = false;
            if (kickCausedIt) {
              console.warn('[KIC voice] keep-alive kick self-aborted speech and recovery gave up (reason: ' + reason + ')');
            } else {
              console.warn('[KIC voice] speechSynthesis stopped unexpectedly:', reason);
            }
            if (cbs.onerror) cbs.onerror('speechSynthesis-error:' + reason);
          };
        }

        // Re-issues the remainder of the CURRENT chunk as a fresh utterance
        // for kick recovery, sharing the same wiring as normal chunk
        // playback so pause()/resume()/stop() keep working transparently
        // (they close over the mutable `utter`). Mutates chunks[chunkIdx] to
        // the remaining text so onboundary's charIndex and any second
        // recovery within the same chunk stay consistent.
        function restartFrom(charIndex) {
          if (canceled) return;
          var remaining = chunks[chunkIdx].slice(charIndex);
          if (!remaining) return;
          chunks[chunkIdx] = remaining;
          lastBoundaryIdx = 0;
          utter = makeUtterance(remaining);
          attachHandlers(utter, /* isRestart */ true);
          setTimeout(function () {
            if (canceled) return;
            speechSynthesis.speak(utter);
          }, 0);
        }

        // Plays chunks[idx]. `idx > 0` suppresses cbs.onstart (already fired
        // for chunk 0) the same way a kick-recovery restart does.
        function playChunk(idx) {
          utter = makeUtterance(chunks[idx]);
          attachHandlers(utter, /* isRestart */ idx > 0);
          setTimeout(function () {
            // A newer speak() request may have already called stop() on this
            // controller before this deferred call ran — don't queue the
            // utterance, or it plays alongside whatever superseded it.
            if (canceled) return;
            speechSynthesis.speak(utter);
          }, 0);
        }

        playChunk(0);

        return {
          pause: function () {
            if (canceled) return;
            if (!started) { pendingPause = true; return; } // applied once onstart fires
            userPaused = true;
            speechSynthesis.pause();
          },
          resume: function () {
            if (canceled) return;
            pendingPause = false;
            userPaused = false;
            speechSynthesis.resume();
          },
          stop: function () {
            canceled = true;
            pendingPause = false;
            userPaused = false;
            _browserEngineSpeaking = false;
            clearKeepAlive();
            _nativeSpeechCancel();
          },
        };
      }
    },
    openai:     createHttpTtsEngine(fetchOpenAiTtsBlob),
    elevenlabs: createHttpTtsEngine(fetchElevenLabsTtsBlob),
    groq:       createChunkedHttpTtsEngine(fetchGroqTtsBlob, GROQ_TTS_MAX_CHARS),
    gemini:     createHttpTtsEngine(fetchGeminiTtsBlob),
    gcloud:     createChunkedHttpTtsEngine(fetchGcloudTtsBlob, GCLOUD_TTS_MAX_CHARS),
  };

  // Chrome's speechSynthesis has no documented per-utterance limit (unlike
  // Groq/Cloud TTS below), but silently no-ops well before the ~32k-char
  // spec figure, depending on voice/OS. Kept comfortably low so it never
  // approaches the real ceiling, while chunk seams stay infrequent.
  var BROWSER_TTS_CHUNK_MAX_CHARS = 1000;

  // Groq's Orpheus TTS caps `input` at 200 chars/request
  // (console.groq.com/docs/text-to-speech/orpheus#limitations); kept a bit
  // under that for multi-byte character safety margin.
  var GROQ_TTS_MAX_CHARS = 190;

  // Cloud TTS's text:synthesize endpoint caps input at ~5000 UTF-8 bytes;
  // kept well under that for multi-byte character safety margin, and
  // because Chirp 3: HD tends to reject very long requests with a 400.
  var GCLOUD_TTS_MAX_CHARS = 3000;

  // Splits `text` into chunks no longer than `maxLen`, preferring sentence
  // boundaries (. ! ? + whitespace); falls back to word-boundary splits.
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
  // interface, splitting `text` into <=maxChars chunks played back-to-back
  // through one <audio> element (queue advances on `onended`). Needed for
  // providers (Groq/Orpheus) with a short per-request input limit.
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
  // interface, playing through a plain <audio> element. Returns the
  // controller synchronously so callers can attach it right away; early
  // pause/resume calls before the audio element exists are harmless no-ops.
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

  // Extracts the provider's actual error message (e.g. error.message in
  // Groq/OpenAI's JSON body) so failures show why, not just the status code.
  // Encoded as 'tts-http-<code>::<detail>' since onerror() only passes a
  // string; ttsErrorToast() below decodes it.
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
    // 'playai-tts' was decommissioned by Groq — current model is Orpheus v1
    // English TTS (max 200 chars/request, hence the chunking above). Voice
    // is user-selectable (vs.groqTtsVoice). See: console.groq.com/docs/text-to-speech/orpheus
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

  // Gemini's generateContent TTS returns base64-encoded *raw* PCM (no WAV
  // header) at inlineData.data, unlike OpenAI/Groq/ElevenLabs which hand
  // back a ready-to-play Blob. Decode the base64, read the sample rate from
  // inlineData.mimeType (don't hardcode it, Google can change it), and wrap
  // in a minimal 44-byte WAV header for a normal playable Blob.
  // See: ai.google.dev/gemini-api/docs/speech-generation
  function pcmBase64ToWavBlob(base64, sampleRate, numChannels, bitsPerSample) {
    var binary = atob(base64);
    var len = binary.length;
    var pcmBytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) pcmBytes[i] = binary.charCodeAt(i);
    var blockAlign = numChannels * (bitsPerSample / 8);
    var byteRate = sampleRate * blockAlign;
    var buffer = new ArrayBuffer(44 + pcmBytes.length);
    var view = new DataView(buffer);
    function writeStr(offset, str) { for (var j = 0; j < str.length; j++) view.setUint8(offset + j, str.charCodeAt(j)); }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);         // fmt chunk size
    view.setUint16(20, 1, true);          // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, pcmBytes.length, true);
    new Uint8Array(buffer, 44).set(pcmBytes);
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function fetchGeminiTtsBlob(text) {
    var apiKey = audioProviderKey('gemini');
    if (!apiKey) throw new Error('no-key');
    var voice = vs.geminiTtsVoice || 'Kore';
    // gemini-2.5-flash-preview-tts is the broadly-available free-tier model;
    // see ai.google.dev/gemini-api/docs/speech-generation
    // Key goes in ?key= rather than x-goog-api-key, since the proxy's
    // forwarded-header allowlist doesn't include that header.
    var res = await fetch(proxyUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=' + encodeURIComponent(apiKey)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });
    if (!res.ok) throw await ttsHttpError(res);
    var data = await res.json();
    var part = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
               data.candidates[0].content.parts && data.candidates[0].content.parts[0];
    var inline = part && part.inlineData;
    if (!inline || !inline.data) throw new Error('tts-http-200::no-audio-in-response');
    var rate = 24000;
    var m = inline.mimeType && /rate=(\d+)/.exec(inline.mimeType);
    if (m) rate = parseInt(m[1], 10);
    return pcmBase64ToWavBlob(inline.data, rate, 1, 16);
  }

  // Decodes a plain base64 string (no data: prefix) into a Blob — used for
  // Cloud TTS, which hands back real MP3 bytes directly, no PCM/WAV wrapping.
  function base64ToBlob(base64, mimeType) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  // Google Cloud Text-to-Speech (Chirp 3: HD) — a separate product from the
  // Gemini API above: different auth (GCP project + billing, not an AI
  // Studio key), different domain, generous monthly free quota instead of
  // Gemini's per-minute limit. Voice names follow
  // "<languageCode>-Chirp3-HD-<Persona>"; languageCode comes from opts.lang
  // (same BCP-47 code used for STT). See: cloud.google.com/text-to-speech/docs/chirp3-hd
  async function fetchGcloudTtsBlob(text, opts) {
    var apiKey = audioProviderKey('gcloud');
    if (!apiKey) throw new Error('no-key');
    var lang = (opts && opts.lang) || vs.sttLang || 'en-US';
    var voice = vs.gcloudTtsVoice || 'Aoede';
    var res = await fetch(proxyUrl('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(apiKey)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: text },
        voice: { languageCode: lang, name: lang + '-Chirp3-HD-' + voice },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });
    if (!res.ok) throw await ttsHttpError(res);
    var data = await res.json();
    if (!data.audioContent) throw new Error('tts-http-200::no-audio-in-response');
    return base64ToBlob(data.audioContent, 'audio/mp3');
  }

  // STT engines, one per provider, common interface:
  //   start(opts, {onstart, oninterim, onend, onerror}) → {stop()}
  // Groq/Whisper has no streaming API, so oninterim never fires for it (a
  // "recognizing…" placeholder shows instead — see startStt() below); the
  // transcript arrives once, in onend().
  var sttEngines = {
    browser: {
      start: function (opts, cbs) {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
          showToast('⚠️ ' + t('voice.sttUnavailable'));
          if (cbs.onerror) cbs.onerror('unavailable');
          return { stop: function () {} };
        }
        var rec = new SR();
        // continuous=true + our own silence timer, instead of the browser's
        // non-configurable end-of-speech cutoff, so vs.sttSilenceMs governs
        // when listening actually stops.
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
          // 'no-speech' fires naturally with continuous=true on brief
          // silence; our own timer already handles "stop after N seconds
          // quiet", so treat this as a normal end, not a real failure.
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
    groq:   createRecorderSttEngine(transcribeWithGroq),
    gemini: createRecorderSttEngine(transcribeWithGemini),
  };

  // Shared "record with mic-level silence detection, send the whole clip to
  // an HTTP transcription endpoint" engine — used by Groq (Whisper) and
  // Gemini (fed via a multimodal generateContent call instead of a
  // dedicated STT endpoint). `transcribeFn` is `(blob, lang) => Promise<string>`.
  function createRecorderSttEngine(transcribeFn) {
    return {
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

        // Groq's transcription endpoint has no streaming/VAD — without this,
        // MediaRecorder would record forever until clicked again. A small
        // Web Audio API level meter auto-stops once volume stays under a
        // quiet threshold for vs.sttSilenceMs.
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
              var text = await transcribeFn(blob, opts.lang);
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
    };
  }

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

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        var result = reader.result || '';       // "data:<mime>;base64,XXXX"
        var idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Gemini has no dedicated transcription endpoint — the clip is sent as an
  // inline audio part in a multimodal generateContent call, prompting the
  // model to return only the transcript. See: ai.google.dev/gemini-api/docs/audio
  async function transcribeWithGemini(blob, lang) {
    var apiKey = audioProviderKey('gemini');
    if (!apiKey) throw new Error('no-key');
    var base64 = await blobToBase64(blob);
    var langHint = lang ? (' The spoken language is ' + lang + '.') : '';
    var res = await fetch(proxyUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Transcribe the following audio verbatim. Reply with only the raw transcript text — no commentary, no quotation marks, no formatting.' + langHint },
            { inlineData: { mimeType: blob.type || 'audio/webm', data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error('stt-http-' + res.status);
    var data = await res.json();
    var parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    var text = (parts || []).map(function (p) { return p.text || ''; }).join('');
    return text.trim();
  }

  // STT (provider-agnostic entry points)
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
      ta.value = base + (base ? ' ' : '') + '⏺ ' + t('voice.recognizing');
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
        if      (err === 'not-allowed' || err === 'mic-denied') showToast('🎤 ' + t('voice.micDenied'));
        else if (err === 'no-speech')                           showToast('🔇 ' + t('voice.noSpeech'));
        else if (err === 'no-key')                               noKeyToast('🎤');
        else if (err === 'unavailable')                          showToast('⚠️ ' + t('voice.sttUnavailable'));
        else                                                     showToast('STT: ' + err);
      },
    });
  }

  function stopStt() {
    if (currentSttSession) currentSttSession.stop();
    setMicState(false);
  }

  // TTS (provider-agnostic entry points)
  var _currentTtsController = null;

  function stopCurrentTtsController() {
    if (_currentTtsController) { try { _currentTtsController.stop(); } catch (e) {} }
    _currentTtsController = null;
  }

  // Speaks `text` with the currently selected provider (vs.ttsProvider),
  // routing pause/resume/stop through whichever engine handles it. Any
  // previously playing TTS is stopped first — only one thing reads aloud
  // at a time.
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

  // Surfaces TTS failures that would otherwise fail silently. Decodes
  // 'tts-http-<code>::<detail>' (see ttsHttpError above) into a readable
  // message, also logged to console in full since the toast auto-hides
  // quickly and truncates long provider messages.
  function ttsErrorToast(provider, err) {
    if (!err || err === 'no-key') return; // 'no-key' is already toasted by noKeyToast() before the engine even runs
    var httpMatch = /^tts-http-(\d+)(?:::([\s\S]*))?$/.exec(err);
    if (httpMatch) {
      var code = httpMatch[1];
      var detail = httpMatch[2] || '';
      if (detail) console.error('[TTS ' + provider + '] HTTP ' + code + ':', detail);
      var suffix = detail ? ' — ' + (detail.length > 140 ? detail.slice(0, 140) + '…' : detail) : '';
      if (code === '429') {
        showToast('⏳ ' + tv('voice.ttsQuota', { provider, suffix }));
      } else if (code === '401' || code === '403') {
        showToast('🔑 ' + tv('voice.ttsAuth', { provider, code, suffix }));
      } else if (code === '400') {
        showToast('⚠️ ' + tv('voice.ttsBadRequest', { provider, suffix: suffix || ' — check model/parameters' }));
      } else {
        showToast('⚠️ ' + tv('voice.ttsHttpError', { provider, code, suffix }));
      }
      return;
    }
    if (err === 'audio-play-blocked') {
      showToast('🔇 ' + t('voice.ttsBlocked'));
    } else if (err === 'audio-playback-error') {
      showToast('⚠️ ' + t('voice.ttsPlaybackError'));
    } else if (err.indexOf('speechSynthesis-error:') === 0) {
      // Unexpected external cancellation (see utter.onerror above) — our
      // own intentional stop/pause stays silent on purpose.
      showToast('⚠️ ' + tv('voice.ttsInterrupted', { reason: err.slice('speechSynthesis-error:'.length) }));
    } else if (err !== 'unavailable' && err !== 'speechSynthesis-error') {
      showToast('⚠️ TTS (' + provider + '): ' + err);
    }
  }

  function toggleTts() {
    if (ttsActive) stopTts(); else speakLastAssistantMessage(null);
  }

  function stopTts() {
    stopCurrentTtsController();
    syncTtsUi('idle', null);
    dialogPending = false;
  }

  function getLastAssistantText() {
    var rows = document.querySelectorAll('.message-row.ai');
    if (!rows.length) return '';
    var bubble = rows[rows.length - 1].querySelector('.bubble');
    if (!bubble) return '';
    var clone = bubble.cloneNode(true);
    // .math-inline/.math-block hold raw LaTeX until MathJax typesets them,
    // and even typeset output can carry raw LaTeX in an assistive-MathML
    // annotation. Either way this garbles TTS and can make Chrome's network
    // voices abort the whole utterance on formula-heavy replies — so strip
    // formulas the same way code blocks are already stripped.
    clone.querySelectorAll('pre, code, .code-block, .thinking-block, details, .token-badge, .math-inline, .math-block').forEach(function (el) { el.remove(); });
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function speakLastAssistantMessage(onEnd) {
    var text = getLastAssistantText();
    if (!text) {
      showToast(t('voice.noReply'));
      return;
    }
    var ctrl = speakTextWithCurrentProvider(text, {
      onstart: function () { syncTtsUi('playing', null); },
      onend:   function () { syncTtsUi('idle', null); if (typeof onEnd === 'function') onEnd(); },
      onerror: function () { syncTtsUi('idle', null); dialogPending = false; },
    });
    if (!ctrl) syncTtsUi('idle', null);
  }

  // Bubble TTS (per-bubble voice controls). Mirrors the main input-row
  // control: a 🔊 button that starts playback and doubles as Stop while
  // active, plus a Pause/Resume button shown only during playback. Both
  // stay mirrored via syncTtsUi() above.

  var _currentBubbleCtrl = null;

  function findLastBubbleVoiceControls() {
    var rows = document.querySelectorAll('.message-row.ai');
    if (!rows.length) return null;
    return rows[rows.length - 1].querySelector('.bubble-voice-controls');
  }

  function setBubbleVoiceUi(ctrl, state) {
    if (!ctrl) return;
    var btn   = ctrl.querySelector('.bubble-voice-btn');
    var pause = ctrl.querySelector('.bubble-voice-pause-btn');
    var active = state !== 'idle';
    if (btn) {
      btn.classList.toggle('playing', active);
      btn.title = active ? t('voice.ttsStop') : t('voice.readAloud');
    }
    if (pause) {
      pause.style.display = active ? '' : 'none';
      var paused = state === 'paused';
      pause.innerHTML = paused ? SVG_RESUME : SVG_PAUSE;
      pause.title = paused ? t('voice.ttsResume') : t('voice.ttsPause');
    }
  }

  function getBubbleText(voiceCtrlEl) {
    var bubble = voiceCtrlEl.closest('.bubble-wrap') && voiceCtrlEl.closest('.bubble-wrap').querySelector('.bubble');
    if (!bubble) return '';
    var clone = bubble.cloneNode(true);
    // See the matching comment in getLastAssistantText() above — same
    // reasoning applies to the per-bubble 🔊 button.
    clone.querySelectorAll('pre, code, .code-block, .thinking-block, details, .token-badge, .bubble-voice-controls, .math-inline, .math-block').forEach(function (el) { el.remove(); });
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function speakBubble(voiceCtrlEl) {
    var text = getBubbleText(voiceCtrlEl);
    if (!text) { showToast(t('voice.noTextToRead')); return; }

    var ctrl = speakTextWithCurrentProvider(text, {
      onstart: function () { syncTtsUi('playing', voiceCtrlEl); },
      onend:   function () { syncTtsUi('idle', null); },
      onerror: function () { syncTtsUi('idle', null); },
    });
    if (!ctrl) syncTtsUi('idle', null);
  }

  function hookBubbleVoiceControls() {
    document.addEventListener('click', function (e) {
      // 🔊 button: starts playback, or — while this bubble is the one
      // currently playing/paused — acts as Stop (same as the main button).
      var playBtn = e.target.closest('.bubble-voice-btn');
      if (playBtn) {
        e.stopPropagation();
        var ctrl = playBtn.closest('.bubble-voice-controls');
        if (ctrl === _currentBubbleCtrl && ttsActive) {
          stopCurrentTtsController();
          syncTtsUi('idle', null);
        } else {
          speakBubble(ctrl);
        }
        return;
      }

      // Small Pause/Resume button, only visible while this bubble is active.
      var pauseBtn = e.target.closest('.bubble-voice-pause-btn');
      if (pauseBtn) {
        e.stopPropagation();
        var ctrl = pauseBtn.closest('.bubble-voice-controls');
        if (ctrl !== _currentBubbleCtrl || !_currentTtsController) return;
        if (ttsPaused) {
          _currentTtsController.resume();
          syncTtsUi('playing', ctrl);
        } else {
          _currentTtsController.pause();
          syncTtsUi('paused', ctrl);
        }
        return;
      }
    });
  }

  // Dialog mode: watches the chat, and as soon as a new AI bubble is
  // complete, reads it aloud and restarts the microphone afterwards.
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

  // Init
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
      btnMic.title = sttActive ? t('voice.micStop') : t('voice.micStart');
    }
    if (btnTts) {
      btnTts.title = ttsActive ? t('voice.ttsStop') : t('voice.ttsStart');
    }
    if (btnTtsPause && btnTtsPause.style.display !== 'none') {
      btnTtsPause.title = ttsPaused ? t('voice.ttsResume') : t('voice.ttsPause');
    }
    if (btnVoiceSettings) {
      btnVoiceSettings.title = t('voice.settingsTitle');
    }
    var badge = document.getElementById('voiceDialogBadge');
    if (badge) badge.title = t('voice.dialogStop');
  };
  
})();
