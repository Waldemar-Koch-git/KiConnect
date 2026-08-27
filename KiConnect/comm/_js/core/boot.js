import { applySessionDuration, changeAccountName, changeLoginPassword, deleteAccount, doLogin, doSetupPassword, forgotPassword, getAccount, loadSessionSettings, logoutNow, renderAccountGrid, renderNewAccountColorRow, resetSessionNow, startSessionCountdown, updatePwdStrength, verifyAccountPassword } from '../auth/accounts.js';
import { load, save } from '../auth/storage.js';
import { clearAttachments, handleDrop, handleEditFileAttach, handleEditImageAttach, handleFileAttach, handleImageAttach, handlePaste } from '../chat/chat-attachments.js';
import { handleExternalLinkClick, renderMessages, wireCodeCopyButtons } from '../chat/chat-render.js';
import { AGENTIC_TOOL_MAX_ITERS_CAP, handleSendStop, isAgenticWebMode, sendMessage, sendSuggestion } from '../chat/chat-send.js';
import { currentChat, handleDragEnter, handleDragLeave, handleDragOver, newChat, newFolder, renderSidebar, toggleSidebar } from '../chat/chat-sidebar.js';
import { applyTranslations, t, tf, toggleLangDropdown } from './i18n.js';
import { state } from './state.js';
import { applyTheme } from './theme.js';
import { cancelProviderEditor, openProviderPanel, saveProviderEditor, selectProviderType, startNewProvider, updateAudioProviderKeyUI } from '../providers/provider-crud.js';
import { fetchModels, isAdaptiveThinkingModel, loadEmbeddingModelCandidates, onEmbedModelSelectChange, openModelMaxPanel, resetAllModelMax, splitModelId, testEmbeddingModel, toggleThinking, updatePeMaxTokensUI, updateThinkingIntensityUI, usesTokenBudget } from '../providers/provider-models.js';
import { applyChatWidth, closePrintSingleOverlay, copyFullChat, openSettings, openTuningPanel, printFullChat, printSingleBubble, resetMathJaxSettings, scheduleTuningSave, setMaxImageStorageBytes, syncSettingsPanel, toast } from '../ui/misc-ui.js';
import { activeProfile, cancelProfileEditor, newProfileFolder, openProfilePanel, saveProfileEditor, setProfilesEnabled, startNewProfile, syncProfilesEnabledUI, updateProfileBadge } from '../ui/profiles.js';
import { endGuidedIntro, nextTourStep, positionTourCard, prevTourStep, shouldAutoStartGuidedIntro, startGuidedIntro } from '../ui/tour.js';
import { kicVoiceSetSetting } from '../voice.js';
import { WEB_SEARCH_RESULT_MAX, openAgentSettingsFromWebNotice, renderDetectedLinks, syncWebContextPopover, toggleWebContextPopover, toggleWebSearch, updateWebSearchButton, updateWebSearchKeyUI } from '../websearch/web-search.js';

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '_render/pdf.worker.js';
  window._pdfjsLib = pdfjsLib;
}

(function() {
  const saved = localStorage.getItem('kic_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

export function initPanelSectionCollapse(panelId, storagePrefix) {
  const panel = document.getElementById(panelId);
  if (!panel || panel.dataset.collapseInit) return;
  panel.dataset.collapseInit = '1';

  const headers = Array.from(panel.querySelectorAll(':scope > .section-header'));
  headers.forEach(header => {
    const sectionId = (header.getAttribute('data-i18n') || header.textContent || '')
      .trim().replace(/\s+/g, '-').toLowerCase() || 'section';

    header.classList.add('tuning-collapsible');
    const arrow = document.createElement('span');
    arrow.className = 'tuning-section-arrow';
    arrow.textContent = '▸';
    header.insertBefore(arrow, header.firstChild);

    const wrapper = document.createElement('div');
    wrapper.className = 'tuning-section';
    wrapper.dataset.sectionId = sectionId;
    let node = header.nextSibling;
    const toMove = [];
    while (node && !(node.nodeType === 1 && (node.classList.contains('section-header') || (node.tagName === 'HR' && node.classList.contains('divider'))))) {
      toMove.push(node);
      node = node.nextSibling;
    }
    toMove.forEach(n => wrapper.appendChild(n));
    header.insertAdjacentElement('afterend', wrapper);

    const storeKey = storagePrefix + sectionId;
    const collapsed = localStorage.getItem(storeKey) === '1';
    if (collapsed) { wrapper.classList.add('collapsed'); header.classList.add('collapsed'); }

    header.addEventListener('click', () => {
      const nowCollapsed = wrapper.classList.toggle('collapsed');
      header.classList.toggle('collapsed', nowCollapsed);
      try { localStorage.setItem(storeKey, nowCollapsed ? '1' : '0'); } catch {}
    });
  });
}

export function initTuningSectionCollapse() {
  initPanelSectionCollapse('tuningPanel', 'kic_tuning_collapsed_');
}

export function initSettingsSectionCollapse() {
  initPanelSectionCollapse('settingsPanel', 'kic_settings_collapsed_');
}

export function closePanels(){
  ['settingsPanel','tuningPanel','providerPanel','profilePanel','modelMaxPanel'].forEach(id=>document.getElementById(id).classList.remove('open'));
  document.querySelectorAll('.panel-toolbar-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('overlay').classList.remove('show');
  // Don't leave the "delete account" password prompt open/filled in the background.
  const delBox = document.getElementById('deleteAccountConfirm');
  if (delBox && delBox.style.display !== 'none') {
    delBox.style.display = 'none';
    const pwInput = document.getElementById('deleteAccountPwdInput');
    if (pwInput) pwInput.value = '';
  }
}

export function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}

export function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px';}

export function showView(viewId) {
  ['accountSelectView','accountLoginView','newAccountView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === viewId ? '' : 'none';
  });
}

export function setupEventListeners(){
  document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
  document.getElementById('openProviderHeaderBtn').addEventListener('click', ()=>{closePanels();openProviderPanel();});
  document.getElementById('openSettingsBtn').addEventListener('click', ()=>{closePanels();openSettings();});
  document.getElementById('openIntroBtn').addEventListener('click', ()=>startGuidedIntro(0));
  document.getElementById('openTuningBtn').addEventListener('click', ()=>{closePanels();openTuningPanel();});
  document.getElementById('openProfileHeaderBtn').addEventListener('click', ()=>{closePanels();openProfilePanel();});
  document.getElementById('openModelMaxHeaderBtn').addEventListener('click', ()=>{closePanels();openModelMaxPanel();});
  document.getElementById('langToggleBtn').addEventListener('click', toggleLangDropdown);
  document.getElementById('overlay').addEventListener('click', closePanels);
  // Was inline onchange="onEmbedModelSelectChange()" in the HTML — moved
  // here since inline handlers can't reach a module-scoped function.
  document.getElementById('pvEmbedModelSelect').addEventListener('change', onEmbedModelSelectChange);

  // Tuning Panel
  document.getElementById('tuningPanelClose').addEventListener('click', closePanels);

  // Settings Panel
  document.getElementById('settingsPanelClose').addEventListener('click', closePanels);
  document.getElementById('tourSkipBtn')?.addEventListener('click', endGuidedIntro);
  document.getElementById('tourBackBtn')?.addEventListener('click', prevTourStep);
  document.getElementById('tourNextBtn')?.addEventListener('click', nextTourStep);
  window.addEventListener('resize', () => { if (state._tourActive) positionTourCard(state._tourTargetEl); });
  document.getElementById('goProviderFromSettings').addEventListener('click',()=>{closePanels();openProviderPanel();});
  document.getElementById('goModelLimits').addEventListener('click',()=>{closePanels();openModelMaxPanel();});
  document.getElementById('changePwdBtn').addEventListener('click', changeLoginPassword);
  document.getElementById('changeAccountNameBtn')?.addEventListener('click', changeAccountName);
  document.getElementById('accountNameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') changeAccountName(); });
  document.getElementById('deleteAccountBtn')?.addEventListener('click', async () => {
    const acc = getAccount(state._activeAccountId);
    if (!confirm(tf('account.deleteConfirm', { name: acc?.name || '' }))) return;
    const box = document.getElementById('deleteAccountConfirm');
    const pwInput = document.getElementById('deleteAccountPwdInput');
    if (!box || !pwInput) { await deleteAccount(state._activeAccountId); logoutNow(); return; }
    box.style.display = '';
    pwInput.value = '';
    pwInput.focus();
  });
  document.getElementById('deleteAccountCancelBtn')?.addEventListener('click', () => {
    const box = document.getElementById('deleteAccountConfirm');
    const pwInput = document.getElementById('deleteAccountPwdInput');
    if (box) box.style.display = 'none';
    if (pwInput) pwInput.value = '';
  });
  // Final, permanent step — requires the account's own password (unlike the
  // plain confirm() above, which only guards against accidental clicks).
  async function _confirmDeleteAccount() {
    const acc = getAccount(state._activeAccountId);
    if (!acc) return;
    const pwInput = document.getElementById('deleteAccountPwdInput');
    const pw = pwInput?.value || '';
    if (acc.pwHash) {
      const ok = await verifyAccountPassword(state._activeAccountId, pw);
      if (!ok) { toast(t('js.pwdCurrentWrong')); return; }
    }
    const box = document.getElementById('deleteAccountConfirm');
    if (box) box.style.display = 'none';
    if (pwInput) pwInput.value = '';
    await deleteAccount(state._activeAccountId);
    logoutNow();
  }
  document.getElementById('deleteAccountConfirmBtn')?.addEventListener('click', _confirmDeleteAccount);
  document.getElementById('deleteAccountPwdInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _confirmDeleteAccount();
  });
  document.getElementById('applySessionBtn').addEventListener('click', applySessionDuration);
  document.getElementById('resetSessionBtn').addEventListener('click', resetSessionNow);
  document.getElementById('resetMathJaxBtn')?.addEventListener('click', resetMathJaxSettings);
  document.getElementById('logoutBtn').addEventListener('click', logoutNow);

  // auto-save every tuning field on change, no explicit Save button needed
  document.getElementById('temperature').addEventListener('input', e=>{
    document.getElementById('tempVal').textContent=e.target.value;
    state.config.temperature = parseFloat(e.target.value);
    const p = activeProfile();
    if (p) p.temperature = state.config.temperature;
    scheduleTuningSave();
  });
  document.getElementById('systemPrompt')?.addEventListener('input', e=>{
    state.config.systemPrompt = e.target.value;
    const p = activeProfile();
    if (p) p.systemPrompt = state.config.systemPrompt;
    scheduleTuningSave();
  });
  document.getElementById('modelInput')?.addEventListener('change', e=>{
    if (e.target.value) { state.config.model = e.target.value; scheduleTuningSave(); }
  });
  document.getElementById('maxImgSizeInput')?.addEventListener('input', e=>{
    const kb = parseInt(e.target.value);
    if (kb >= 100) setMaxImageStorageBytes(kb * 1024);
  });
  document.getElementById('webSearchApiKey')?.addEventListener('input', e=>{
    state.config.webSearchApiKey = e.target.value.trim();
    scheduleTuningSave();
  });
  document.getElementById('chatWidthSlider').addEventListener('input', e=>{ applyChatWidth(e.target.value); scheduleTuningSave(); });
  document.getElementById('webSearchCount')?.addEventListener('input', e=>{
    document.getElementById('webSearchCountVal').textContent=e.target.value;
    state.config.webSearchResultCount = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(e.target.value) || 8));
    syncWebContextPopover();
    scheduleTuningSave();
  });
  document.getElementById('webSearchAgenticIters')?.addEventListener('input', e=>{
    const val = Math.max(1, Math.min(AGENTIC_TOOL_MAX_ITERS_CAP, parseInt(e.target.value) || 4));
    document.getElementById('webSearchAgenticItersVal').textContent = val;
    state.config.webSearchAgenticMaxIters = val;
    scheduleTuningSave();
  });
  document.getElementById('webSearchMode')?.addEventListener('change', e=>{
    // 'auto'/'always' no longer exist as options (retired in v4.0.0 — see
    // auth/storage.js load() for the migration of any old stored value),
    // so fall back to 'manual' for anything outside the surviving set.
    const val = e.target.value;
    state.config.webSearchMode = ['manual','off','agentic'].includes(val) ? val : 'manual';
    if(state.config.webSearchMode==='off') state.config.webSearchEnabled=false;
    updateWebSearchButton();
    save();
  });
  document.getElementById('webSearchEngine')?.addEventListener('change', e=>{
    state.config.webSearchEngine = e.target.value || 'free';
    updateWebSearchKeyUI(state.config.webSearchEngine);
    save();
  });

  // Audio (TTS/STT providers)
  document.getElementById('ttsProviderSelect')?.addEventListener('change', e=>{
    const provider = e.target.value || 'browser';
    kicVoiceSetSetting?.('ttsProvider', provider);
    updateAudioProviderKeyUI();
    save();
  });
  // Shared body for the TTS/STT API-key inputs below: saves the typed key
  // under audioProviders[<selected provider>].apiKey.
  function _bindAudioApiKeyInput(inputId, selectId, defaultProvider) {
    document.getElementById(inputId)?.addEventListener('input', e => {
      const provider = document.getElementById(selectId)?.value || defaultProvider;
      state.config.audioProviders = state.config.audioProviders || {};
      state.config.audioProviders[provider] = state.config.audioProviders[provider] || {};
      state.config.audioProviders[provider].apiKey = e.target.value.trim();
      scheduleTuningSave();
    });
  }
  _bindAudioApiKeyInput('ttsApiKey', 'ttsProviderSelect', 'openai');
  document.getElementById('ttsVoiceId')?.addEventListener('input', e=>{
    state.config.audioProviders = state.config.audioProviders || {};
    state.config.audioProviders.elevenlabs = state.config.audioProviders.elevenlabs || {};
    state.config.audioProviders.elevenlabs.voiceId = e.target.value.trim();
    scheduleTuningSave();
  });
  document.getElementById('sttProviderSelect')?.addEventListener('change', e=>{
    const provider = e.target.value || 'browser';
    kicVoiceSetSetting?.('sttProvider', provider);
    updateAudioProviderKeyUI();
    save();
  });
  _bindAudioApiKeyInput('sttApiKey', 'sttProviderSelect', 'groq');

  // Thinking Toggle
  document.getElementById('thinkingToggle').addEventListener('click', toggleThinking);
  document.getElementById('thinkingIntensitySlider').addEventListener('input', e=>{
    const{modelId}=splitModelId(state.config.model);
    // Legacy Claude 3.7 uses a token-budget slider; adaptive Claude 4+ and all other
    // thinking models use a 3-step effort slider writing to thinkingIntensity.
    if(usesTokenBudget(modelId) && !isAdaptiveThinkingModel(modelId)){
      state.config.thinkingBudget=parseInt(e.target.value);
    } else {
      state.config.thinkingIntensity=parseInt(e.target.value);
    }
    updateThinkingIntensityUI(); save();
  });

  // Provider Panel
  document.getElementById('providerPanelClose').addEventListener('click', closePanels);
  document.getElementById('addProviderBtn').addEventListener('click', startNewProvider);
  document.getElementById('saveProviderBtn').addEventListener('click', saveProviderEditor);
  document.getElementById('cancelProviderBtn').addEventListener('click', cancelProviderEditor);
  // CSP deliberately disallows inline event handlers; bind embedding editor
  // controls here together with the rest of the provider panel controls.
  document.getElementById('pvEmbedModelLoadBtn').addEventListener('click', loadEmbeddingModelCandidates);
  document.getElementById('pvEmbedModelTestBtn').addEventListener('click', testEmbeddingModel);
  document.querySelectorAll('.type-chip').forEach(chip=>{chip.addEventListener('click',()=>selectProviderType(chip.dataset.type));});

  // Profile Panel
  document.getElementById('profilePanelClose').addEventListener('click', closePanels);
  document.getElementById('addProfileBtn').addEventListener('click', startNewProfile);
  document.getElementById('profilesEnabledToggle')?.addEventListener('change', e=>{
    setProfilesEnabled(e.target.checked);
  });
  document.getElementById('addProfileFolderBtn')?.addEventListener('click', newProfileFolder);
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfileEditor);
  document.getElementById('cancelProfileBtn').addEventListener('click', cancelProfileEditor);
  document.getElementById('peTemp').addEventListener('input', e=>{document.getElementById('peTempVal').textContent=e.target.value;});
  document.getElementById('peUseModelMax').addEventListener('change', updatePeMaxTokensUI);
  document.getElementById('peMaxTokensSlider').addEventListener('input', e=>{document.getElementById('peMaxTokensNum').textContent=parseInt(e.target.value).toLocaleString();});

  // Model Limits Panel
  document.getElementById('modelMaxPanelClose').addEventListener('click', closePanels);
  document.getElementById('resetAllModelMaxBtn').addEventListener('click', resetAllModelMax);

  // Sidebar
  document.getElementById('newChatBtn').addEventListener('click',()=>newChat());
  document.getElementById('newFolderBtn').addEventListener('click', newFolder);
  document.getElementById('copyFullChatBtn').addEventListener('click', copyFullChat);
  document.getElementById('printFullChatBtn').addEventListener('click', printFullChat);

  // Print-Single-Bubble Overlay
  document.getElementById('printSingleConfirm')?.addEventListener('click', printSingleBubble);
  document.getElementById('printSingleClose')?.addEventListener('click', closePrintSingleOverlay);
  document.getElementById('printSingleOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('printSingleOverlay')) closePrintSingleOverlay();
  });

  // Chat Area
  const chatArea=document.getElementById('chatArea');
  chatArea.addEventListener('dragenter', handleDragEnter);
  chatArea.addEventListener('dragover', handleDragOver);
  chatArea.addEventListener('dragleave', handleDragLeave);
  chatArea.addEventListener('drop', handleDrop);

  // Input
  document.getElementById('sendBtn').addEventListener('click', handleSendStop);
  document.getElementById('messageInput').addEventListener('keydown', handleKey);
  document.getElementById('messageInput').addEventListener('input', e=>{ autoResize(e.target); renderDetectedLinks(); updateWebSearchButton(); });
  document.addEventListener('click', handleExternalLinkClick);
  document.getElementById('messageInput').addEventListener('paste', handlePaste);
  document.getElementById('attachFileBtn').addEventListener('click',()=>document.getElementById('fileInput').click());
  document.getElementById('attachImageBtn').addEventListener('click',()=>document.getElementById('imageInput').click());
  document.getElementById('clearAttachBtn').addEventListener('click', clearAttachments);
  document.getElementById('webSearchBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleWebContextPopover();
  });
  document.getElementById('webContextPopover')?.addEventListener('click', e => e.stopPropagation());
  document.getElementById('webSearchToggle')?.addEventListener('click', toggleWebSearch);
  document.getElementById('webContextAgentNoticeBtn')?.addEventListener('click', openAgentSettingsFromWebNotice);
  document.getElementById('webAgenticToggle')?.addEventListener('click', () => {
    if (isAgenticWebMode()) {
      state.config.webSearchMode = 'manual';
    } else {
      state.config.webSearchMode = 'agentic';
      state.config.webSearchEnabled = false; // agentic mode replaces the manual per-message toggle
    }
    save();
    updateWebSearchButton();
    toast(isAgenticWebMode() ? '🕵🏻🌐 (✔️)' : '🕵🏻⛔');
  });
  document.getElementById('webLinkToggle')?.addEventListener('click', () => {
    state.config.webLinkEnabled = !state.config.webLinkEnabled;
    if (!state.config.webLinkEnabled) {
      state.selectedLinkUrls.clear();
      state.ignoredLinkUrls.clear();
    }
    save();
    updateWebSearchButton();
    toast(tf('web.linkReadingToast', { state: state.config.webLinkEnabled ? t('web.on') : t('web.off') }));
  });
  document.getElementById('webContextCount')?.addEventListener('input', e => {
    state.config.webSearchResultCount = Math.max(3, Math.min(WEB_SEARCH_RESULT_MAX, parseInt(e.target.value) || 8));
    const settingsCount = document.getElementById('webSearchCount');
    if (settingsCount) settingsCount.value = state.config.webSearchResultCount;
    const settingsVal = document.getElementById('webSearchCountVal');
    if (settingsVal) settingsVal.textContent = state.config.webSearchResultCount;
    save();
    syncWebContextPopover();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest?.('#webContextWrap')) toggleWebContextPopover(false);
  });
  document.getElementById('fileInput').addEventListener('change', handleFileAttach);
  document.getElementById('imageInput').addEventListener('change', handleImageAttach);
  // Edit-mode file inputs (hidden inputs for adding files while editing a bubble)
  const editFileInput = document.getElementById('editFileInput');
  const editImageInput = document.getElementById('editImageInput');
  if (editFileInput)  editFileInput.addEventListener('change',  handleEditFileAttach);
  if (editImageInput) editImageInput.addEventListener('change', handleEditImageAttach);

  // Global paste (outside textarea)
  document.addEventListener('paste', e=>{
    if(document.activeElement!==document.getElementById('messageInput')){
      handlePaste(e);
    }
  });

  // Login / Account system
  document.getElementById('loginBtn')?.addEventListener('click', doLogin);
  document.getElementById('loginInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('forgotPwdBtn')?.addEventListener('click', forgotPassword);
  document.getElementById('setupBtn')?.addEventListener('click', doSetupPassword);
  document.getElementById('setupPwdInput')?.addEventListener('input', e => updatePwdStrength(e.target.value));
  document.getElementById('setupPwdInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('setupPwdConfirm')?.focus(); });
  document.getElementById('setupPwdConfirm')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSetupPassword(); });
  document.getElementById('showNewAccountBtn')?.addEventListener('click', () => {
    // Clear form
    const nameEl = document.getElementById('newAccountName');
    const pwdEl  = document.getElementById('setupPwdInput');
    const confEl = document.getElementById('setupPwdConfirm');
    const errEl  = document.getElementById('setupError');
    if (nameEl) nameEl.value = '';
    if (pwdEl)  pwdEl.value  = '';
    if (confEl) confEl.value = '';
    if (errEl)  errEl.textContent = '';
    const bar = document.getElementById('pwdStrengthBar');
    if (bar) { bar.style.width = '0%'; }
    renderNewAccountColorRow();
    showView('newAccountView');
    setTimeout(() => nameEl?.focus(), 80);
  });
  document.getElementById('backToAccountsBtn')?.addEventListener('click', () => { state._selectedLoginAccountId = null; showView('accountSelectView'); renderAccountGrid(); });
  document.getElementById('backFromNewAccountBtn')?.addEventListener('click', () => {
    if (state._accounts.length > 0) { showView('accountSelectView'); renderAccountGrid(); }
    // else: can't go back — no accounts yet, stay on create view
  });
  document.getElementById('newAccountName')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('setupPwdInput')?.focus(); });

  // Suggestion Chips
  const suggestions=[
    {i18n:'empty.quantum',msgKey:'empty.quantumMsg'},
    {i18n:'empty.python',msgKey:'empty.pythonMsg'},
    {i18n:'empty.mlvsdl',msgKey:'empty.mlvsdlMsg'},
    {i18n:'empty.integral',msgKey:'empty.integralMsg'},
  ];
  const chipsContainer=document.getElementById('suggestionChips');
  suggestions.forEach(s=>{
    const chip=document.createElement('div');chip.className='suggestion-chip';chip.textContent=t(s.i18n);chip.dataset.msgKey=s.msgKey;
    chip.addEventListener('click',()=>sendSuggestion(t(chip.dataset.msgKey)));
    chipsContainer.appendChild(chip);
  });

  // Observer: Code-Copy-Buttons in neuen Nachrichten verdrahten
  const messagesContainer=document.getElementById('messages');
  const observer=new MutationObserver(mutations=>{
    mutations.forEach(m=>m.addedNodes.forEach(node=>{if(node.nodeType===1)wireCodeCopyButtons(node);}));
  });
  observer.observe(messagesContainer,{childList:true,subtree:true});
}

export async function bootApp() {
  // Show the main UI now that we're authenticated
  const mainEl = document.querySelector('.main');
  const headerEl = document.querySelector('header');
  if (mainEl) mainEl.style.display = '';
  if (headerEl) headerEl.style.display = '';

  await load();
  applyTranslations();
  updateProfileBadge();
  syncProfilesEnabledUI();
  syncSettingsPanel();
  loadSessionSettings();
  if (state.config.chatMaxWidth) applyChatWidth(state.config.chatMaxWidth);
  applyTheme(localStorage.getItem('kic_theme') || 'dark');
  if (state.config.thinkingEnabled) {
    document.getElementById('thinkingToggle')?.classList.add('active');
    document.getElementById('thinkingIntensity')?.classList.add('visible');
  }
  if (state.config.thinkingIntensity) {
    const slider = document.getElementById('thinkingIntensitySlider');
    if (slider) slider.value = state.config.thinkingIntensity;
  }
  if (!state.folders.length) { state.folders.push({ id:'default', name:'Default', collapsed:false }); save(); }
  if (!state.chats.length) { newChat(); }
  else {
    // If the saved currentChatId doesn't exist, use the first chat
    if (!state.currentChatId || !state.chats.find(c => c.id === state.currentChatId)) {
      state.currentChatId = state.chats[0].id;
    }
    state.activeFolderId = currentChat()?.folderId || null;
    renderSidebar();
    renderMessages(currentChat()?.messages || []);
  }
  if (state.providers.length && state.providers.some(p => p.apiKey)) fetchModels();
  else openProviderPanel();
  startSessionCountdown();
  if (shouldAutoStartGuidedIntro()) {
    setTimeout(() => startGuidedIntro(), 350);
  }
}
