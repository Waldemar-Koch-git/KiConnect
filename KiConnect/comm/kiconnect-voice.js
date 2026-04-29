// ================================================================
// kiconnect-voice.js  –  Speech input & speech output (Web Speech API)
// Version 2.0 – fully revised
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
    sttLang:     navigator.language || 'de-DE',
    ttsRate:     1.0,
    ttsPitch:    1.0,
    ttsVoice:    '',
    sttAutoSend: false,
    dialogMode:  false,   // Dialog: read AI response aloud → then listen again
    ...loadSettings(),
  };

  // ── State ──────────────────────────────────────────────────────
  let sttActive     = false;
  let ttsActive     = false;
  let dialogPending = false;
  let webSpeechRec  = null;
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
      '.voice-btn{background:none;border:none;cursor:pointer;color:var(--muted,#888);padding:8px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0;}',
      '.voice-btn:hover{background:var(--surface2,rgba(128,128,128,.12));color:var(--text,#eee);}',
      '.voice-btn.voice-active{color:var(--red,#e74c3c);background:rgba(231,76,60,.12);animation:voice-pulse 1.2s ease-in-out infinite;}',
      '@keyframes voice-pulse{0%,100%{box-shadow:0 0 0 0 rgba(231,76,60,.4)}50%{box-shadow:0 0 0 5px rgba(231,76,60,0)}}',
      '.voice-gear-btn{background:none;border:none;cursor:pointer;color:var(--muted,#888);padding:8px 6px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0;opacity:.75;}',
      '.voice-gear-btn:hover{background:var(--surface2,rgba(128,128,128,.12));color:var(--text,#eee);opacity:1;}',
      '.voice-sep{width:1px;height:18px;background:var(--border,#333);margin:0 2px;flex-shrink:0;align-self:center;}',

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

      /* Dialog-Badge im Header */
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

    var sep = document.createElement('div');
    sep.className = 'voice-sep';

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

    // Order: sep | 🎤 | 🔊 | ⚙ | [Send]
    actions.insertBefore(sep,              sendBtn);
    actions.insertBefore(btnMic,           sendBtn);
    actions.insertBefore(btnTts,           sendBtn);
    actions.insertBefore(btnVoiceSettings, sendBtn);

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
          '<div class="vs-label" data-i18n="voice.sttLang">Erkennungssprache</div>',
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
            '<option value="zh-CN">中文 (普通话)</option>',
            '<option value="ja-JP">日本語</option>',
            '<option value="ko-KR">한국어</option>',
            '<option value="ru-RU">Русский</option>',
            '<option value="pt-BR">Português (BR)</option>',
            '<option value="hi-IN">हिन्दी</option>',
            '<option value="el-GR">Ελληνικά</option>',
          '</select>',
        '</div>',

        '<hr class="vs-sep">',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="voice.ttsVoice">Stimme (Text → Sprache)</div>',
          '<select class="vs-select" id="vsTtsVoice"><option value="">— <span data-i18n="voice.defaultVoice">Standard</span> —</option></select>',
        '</div>',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="voice.ttsRate">Sprechgeschwindigkeit</div>',
          '<div class="vs-slider-row">',
            '<input type="range" id="vsTtsRate" min="0.5" max="2.0" step="0.1" value="' + vs.ttsRate + '">',
            '<span class="vs-slider-val" id="vsTtsRateVal">' + vs.ttsRate.toFixed(1) + '×</span>',
          '</div>',
        '</div>',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="voice.ttsPitch">Pitch</div>',
          '<div class="vs-slider-row">',
            '<input type="range" id="vsTtsPitch" min="0.5" max="2.0" step="0.1" value="' + vs.ttsPitch + '">',
            '<span class="vs-slider-val" id="vsTtsPitchVal">' + vs.ttsPitch.toFixed(1) + '</span>',
          '</div>',
        '</div>',

        '<hr class="vs-sep">',

        '<div class="vs-group">',
          '<div class="vs-label" data-i18n="voice.options">Optionen</div>',
          '<div class="vs-toggle-row">',
            '<div class="vs-chip ' + (vs.sttAutoSend ? 'active' : '') + '" id="vsAutoSendChip">',
              '<span class="vs-chip-icon">⚡</span>',
              '<div class="vs-chip-desc">',
                '<span class="vs-chip-name" data-i18n="voice.autoSend">Auto-Senden</span>',
                '<span class="vs-chip-sub" data-i18n="voice.autoSendSub">Nachricht nach STT sofort senden</span>',
              '</div>',
            '</div>',
            '<div class="vs-chip ' + (vs.dialogMode ? 'active' : '') + '" id="vsDialogChip">',
              '<span class="vs-chip-icon">💬</span>',
              '<div class="vs-chip-desc">',
                '<span class="vs-chip-name" data-i18n="voice.dialog">Dialog-Modus</span>',
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
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== btnVoiceSettings && !btnVoiceSettings.contains(e.target)) {
        closeVoiceSettingsPanel();
      }
    });

    populateTtsVoices();
    if (window.speechSynthesis) {
      speechSynthesis.addEventListener('voiceschanged', populateTtsVoices);
    }
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
      // Positioning relative to send button
      var sendBtn = document.getElementById('sendBtn');
      if (sendBtn) {
        var rect = sendBtn.getBoundingClientRect();
        panel.style.right  = Math.max(8, window.innerWidth  - rect.right)  + 'px';
        panel.style.bottom = Math.max(8, window.innerHeight - rect.top + 8) + 'px';
        panel.style.left   = 'auto';
      }
    }
  }

  function closeVoiceSettingsPanel() {
    var panel = document.getElementById('voiceSettingsPanel');
    if (panel) panel.classList.remove('open');
  }

  // ── STT ──────────────────────────────────────────────────────────
  function toggleStt() {
    if (sttActive) stopStt(); else startStt();
  }

  function startStt() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showToast('⚠️ ' + t('voice.sttUnavailable', 'Web Speech API not available.'));
      return;
    }
    webSpeechRec = new SR();
    webSpeechRec.continuous     = false;
    webSpeechRec.interimResults = true;
    webSpeechRec.lang           = vs.sttLang;

    var finalText = '';

    webSpeechRec.onstart = function () {
      setMicState(true);
      var ta = getTextarea();
      if (ta) ta.dataset.voiceBase = ta.value;
    };

    webSpeechRec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else                       interim   += e.results[i][0].transcript;
      }
      var ta = getTextarea();
      if (ta) {
        var base = ta.dataset.voiceBase || '';
        ta.value = base + (base && interim ? ' ' : '') + interim;
        if (typeof autoResize === 'function') autoResize(ta);
      }
    };

    webSpeechRec.onend = function () {
      setMicState(false);
      var ta = getTextarea();
      if (ta) {
        var base = ta.dataset.voiceBase || '';
        delete ta.dataset.voiceBase;
        var full = (base + (base && finalText ? ' ' : '') + finalText).trim();
        ta.value = full;
        if (typeof autoResize === 'function') autoResize(ta);

        if (full && (vs.sttAutoSend || vs.dialogMode)) {
          setTimeout(function () {
            if (typeof sendMessage === 'function') sendMessage();
            else { var sb = document.getElementById('sendBtn'); if (sb) sb.click(); }
          }, 150);
        }
      }
      webSpeechRec = null;
    };

    webSpeechRec.onerror = function (e) {
      setMicState(false);
      var ta = getTextarea();
      if (ta) delete ta.dataset.voiceBase;
      if      (e.error === 'not-allowed') showToast('🎤 ' + t('voice.micDenied', 'Microphone access denied.'));
      else if (e.error === 'no-speech')   showToast('🔇 ' + t('voice.noSpeech',  'No speech detected.'));
      else                                showToast('STT: ' + e.error);
      webSpeechRec = null;
    };

    try { webSpeechRec.start(); }
    catch (err) {
      showToast(t('voice.micFailed', 'Microphone could not be started.'));
      setMicState(false);
    }
  }

  function stopStt() {
    if (webSpeechRec) webSpeechRec.stop();
    setMicState(false);
  }

  // ── TTS ──────────────────────────────────────────────────────────
  function toggleTts() {
    if (ttsActive) stopTts(); else speakLastAssistantMessage(null);
  }

  function stopTts() {
    if (window.speechSynthesis) speechSynthesis.cancel();
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
    if (!window.speechSynthesis) {
      showToast('🔇 ' + t('voice.ttsUnavailable', 'TTS not available.'));
      return;
    }
    speechSynthesis.cancel();

    var text = getLastAssistantText();
    if (!text) {
      showToast(t('voice.noReply', 'No reply found to read aloud.'));
      return;
    }

    var utter  = new SpeechSynthesisUtterance(text);
    utter.lang  = vs.sttLang;
    utter.rate  = vs.ttsRate;
    utter.pitch = vs.ttsPitch;

    if (vs.ttsVoice) {
      var match = speechSynthesis.getVoices().filter(function (v) { return v.voiceURI === vs.ttsVoice; });
      if (match.length) utter.voice = match[0];
    }

    utter.onstart = function () { setTtsState(true); };
    utter.onend   = function () {
      setTtsState(false);
      if (typeof onEnd === 'function') onEnd();
    };
    utter.onerror = function () {
      setTtsState(false);
      dialogPending = false;
    };

    speechSynthesis.speak(utter);
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
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 300);
  }

  // Language change hook — no panel rebuild, DOM update only via data-i18n
  window._kicVoiceRetranslate = function () {
    var panel = document.getElementById('voiceSettingsPanel');
    if (panel) _retranslatePanelDom(panel);
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
