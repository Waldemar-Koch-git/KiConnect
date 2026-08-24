import { isMessagesNearBottom } from '../chat/chat-render.js';
import { bt, closeLangDropdown } from './i18n.js';
import { onLanguageChange, toast } from '../ui/misc-ui.js';
import { TOUR_STEPS } from '../ui/tour.js';

export const state = {};

state.currentLang = localStorage.getItem('kic_lang') || 'en';

document.addEventListener('click', e => {
  // Don't close the language dropdown when the tour is showing it for selection
  if (state._tourActive && TOUR_STEPS[state._tourStepIndex]?.prep === 'language') return;
  const switcher = document.getElementById('langSwitcher');
  if (switcher && !switcher.contains(e.target)) closeLangDropdown();
});

state._orModelMeta = {};

(function _loadOrCache() {
  try {
    const raw = localStorage.getItem('kic_or_model_meta');
    if (raw) state._orModelMeta = JSON.parse(raw);
  } catch(e) { state._orModelMeta = {}; }
})();

state._anthropicModelCaps = {};

(function _loadAnthropicCaps() {
  try {
    const raw = localStorage.getItem('kic_anthropic_model_caps');
    if (raw) state._anthropicModelCaps = JSON.parse(raw);
  } catch(e) { state._anthropicModelCaps = {}; }
})();

export const DEFAULT_CONFIG = {
  model: '', temperature: 0.7, maxTokens: null, systemPrompt: '',
  activeProfileId: null, userModelMaxOverrides: {}, chatMaxWidth: 880,
  thinkingEnabled: false, thinkingIntensity: 2, thinkingBudget: 8000,
  webSearchMode: 'manual', webSearchEngine: 'free', webSearchApiKey: '', webSearchResultCount: 8,
  webSearchEnabled: false, webLinkEnabled: false,
  // TTS/STT provider API keys (OpenAI, ElevenLabs, Groq). Lives inside `config` (not
  // localStorage) so it goes through the same AES-GCM-256 encrypt/decrypt cycle as
  // everything else in save()/load(). Read (read-only) by kiconnect-voice.js.
  audioProviders: { openai: { apiKey: '' }, elevenlabs: { apiKey: '', voiceId: '' }, groq: { apiKey: '' }, gemini: { apiKey: '' }, gcloud: { apiKey: '' } },
};

export function freshConfig() { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }

state.config = freshConfig();

state.providers = [];

state.profiles = [];

state.folders = [];

state.profileFolders = [];

state.unfiledProfilesCollapsed = localStorage.getItem('kic_unfiled_profiles_collapsed') === '1';

state.chats = [];

state.currentChatId = null;

state.activeFolderId = undefined;

state.attachments = [];

state.battleModeActive = false;

state.battleSelectedModels = [];

state.pinnedToBottom = true;

state.editingProfileId = null;

state.editingProviderId = null;

state.draggedChatId = null;

state.draggedFolderId = null;

state.draggedProfileId = null;

state.draggedProfileFolderId = null;

state.sidebarCollapsed = false;

state.selectedLinkUrls = new Set();

state.ignoredLinkUrls = new Set();

state._multiSelectMode = false;

state._cryptoKey = null;

state._sessionPassphrase = null;

state._lockCountdownTimer = null;

state._agentSessionToken = null;

state._agentProjects = [];

state._accounts = [];

state._activeAccountId = null;

state._storeAvailable = true;

state._saveCache = null;

state._saveInFlight = null;

state._savePending = false;

state._draggedProviderId = null;

state._tuningSaveTimer = null;

state._editAttachments = [];

state._editMsgIdx = null;

document.addEventListener('DOMContentLoaded', () => {
  const messagesEl = document.getElementById('messages');
  if (messagesEl) messagesEl.addEventListener('scroll', () => { state.pinnedToBottom = isMessagesNearBottom(); });
});

state._dompurifyNoopenerHookInstalled = false;

state._tourActive = false;

state._tourStepIndex = 0;

state._tourTargetEl = null;

state._tourPlacementTimer = null;

state._dragCounter = 0;

state._selectedLoginAccountId = null;

state._countdownTimer = null;

state._printSingleIdx = null;

(function () {
  const toggleBtn = document.getElementById('battleToggleBtn');
  const popover = document.getElementById('battlePopover');
  const titleEl = document.getElementById('battlePopoverTitle');
  const searchEl = document.getElementById('battleSearch');
  const listEl = document.getElementById('battleModelList');
  const activeSwitchWrap = document.getElementById('battleActiveSwitchWrap');
  const activeSwitchLabel = document.getElementById('battleActiveSwitchLabel');
  const activeSwitch = document.getElementById('battleActiveSwitch');
  if (!toggleBtn || !popover || !listEl) return;
  const MAX_BATTLE_MODELS = 4;
  let open = false;

  function refreshToggleUI() {
    toggleBtn.classList.toggle('active', state.battleModeActive && state.battleSelectedModels.length >= 2);
    toggleBtn.title = bt('battle.toggleTitle');
  }

  // Quick on/off switch, independent of battleSelectedModels — flipping
  // Battle-Modus off no longer requires unchecking every picked model.
  // Only visible once a valid (>=2) selection exists; below that there's
  // nothing to switch on.
  function syncActiveSwitch() {
    if (!activeSwitchWrap || !activeSwitch) return;
    const eligible = state.battleSelectedModels.length >= 2;
    activeSwitchWrap.hidden = !eligible;
    const on = eligible && state.battleModeActive;
    activeSwitch.classList.toggle('on', on);
    activeSwitch.setAttribute('aria-checked', String(on));
    activeSwitchWrap.classList.toggle('on', on);
    if (activeSwitchLabel) activeSwitchLabel.textContent = bt('battle.active');
  }

  if (activeSwitch) {
    activeSwitch.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.battleSelectedModels.length < 2) return;
      state.battleModeActive = !state.battleModeActive;
      refreshToggleUI();
      syncActiveSwitch();
    });
  }

  // filter: lowercase search string, matched against each model's label —
  // useful once a provider list is large enough to scroll (see chat
  // feedback). Already-checked models stay checked while filtered out of
  // view (state lives in battleSelectedModels, not in the filtered DOM).
  function renderList(filter) {
    const q = (filter || '').trim().toLowerCase();
    titleEl.textContent = bt('battle.pickModels');
    if (searchEl) searchEl.placeholder = bt('battle.searchPlaceholder');
    listEl.innerHTML = '';
    const groups = window._cmData || [];
    let shown = 0;
    groups.forEach(group => {
      const items = group.items.filter(m => !q || m.label.toLowerCase().includes(q));
      if (!items.length) return;
      if (group.group) {
        const gl = document.createElement('div');
        gl.className = 'battle-model-group-label';
        gl.textContent = group.group;
        listEl.appendChild(gl);
      }
      items.forEach(m => {
        const row = document.createElement('label');
        row.className = 'battle-model-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = m.value;
        cb.checked = state.battleSelectedModels.includes(m.value);
        cb.addEventListener('change', () => {
          const hadEnough = state.battleSelectedModels.length >= 2;
          if (cb.checked) {
            if (state.battleSelectedModels.length >= MAX_BATTLE_MODELS) {
              cb.checked = false;
              toast(bt('battle.tooManyModels'));
              return;
            }
            state.battleSelectedModels.push(m.value);
          } else {
            state.battleSelectedModels = state.battleSelectedModels.filter(v => v !== m.value);
          }
          const hasEnough = state.battleSelectedModels.length >= 2;
          // Below 2 models Battle-Modus structurally can't run, so force it
          // off. Crossing UP over the threshold defaults it back on (the
          // old auto-on convenience) — but only on that crossing, so an
          // explicit off (via the switch above) sticks while you merely
          // add/remove models within an already->=2 selection.
          if (!hasEnough) state.battleModeActive = false;
          else if (!hadEnough) state.battleModeActive = true;
          refreshToggleUI();
          syncActiveSwitch();
        });
        const span = document.createElement('span');
        span.textContent = m.label;
        row.appendChild(cb); row.appendChild(span);
        listEl.appendChild(row);
        shown++;
      });
    });
    if (!shown) {
      const em = document.createElement('div');
      em.className = 'battle-model-empty';
      em.textContent = bt('battle.noModelFound');
      listEl.appendChild(em);
    }
  }

  function openPopover() {
    open = true; popover.hidden = false;
    if (searchEl) searchEl.value = '';
    renderList('');
    syncActiveSwitch();
    if (searchEl) searchEl.focus();
  }
  function closePopover() { open = false; popover.hidden = true; }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    open ? closePopover() : openPopover();
  });
  if (searchEl) {
    searchEl.addEventListener('input', () => renderList(searchEl.value));
    searchEl.addEventListener('click', (e) => e.stopPropagation());
    searchEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { closePopover(); toggleBtn.focus(); }
    });
  }
  document.addEventListener('click', (e) => { if (open && !popover.contains(e.target) && e.target !== toggleBtn) closePopover(); });
  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') closePopover(); });

  refreshToggleUI();
  syncActiveSwitch();
  onLanguageChange(() => { refreshToggleUI(); syncActiveSwitch(); });
})();
