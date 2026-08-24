import { accountKey } from '../auth/accounts.js';
import { closePanels } from '../core/boot.js';
import { renderLangDropdown, t, tf } from '../core/i18n.js';
import { state } from '../core/state.js';
import { openProviderPanel, startNewProvider } from '../providers/provider-crud.js';

export const TOUR_STEPS = [
  { target: '#langToggleBtn', title: 'tour.languageTitle', text: 'tour.languageText', prep: 'language' },
  { target: '#openIntroBtn', title: 'tour.welcomeTitle', text: 'tour.welcomeText', prep: 'home' },
  { target: '#openProviderHeaderBtn', title: 'tour.apiButtonTitle', text: 'tour.apiButtonText', prep: 'home' },
  { target: '#addProviderBtn', title: 'tour.addProviderTitle', text: 'tour.addProviderText', prep: 'providerPanel' },
  { target: '#pvNameInput', title: 'tour.providerNameTitle', text: 'tour.providerNameText', prep: 'providerEditor', focus: true },
  { target: '#providerTypeRow', title: 'tour.providerTypeTitle', text: 'tour.providerTypeText', prep: 'providerEditor' },
  { target: '#pvServerUrlGroup', title: 'tour.serverUrlTitle', text: 'tour.serverUrlText', prep: 'providerEditor', focus: '#pvServerUrl' },
  { target: '#pvApiKey', title: 'tour.apiKeyTitle', text: 'tour.apiKeyText', prep: 'providerEditor', focus: true },
  { target: '#saveProviderBtn', title: 'tour.saveProviderTitle', text: 'tour.saveProviderText', prep: 'providerEditor' },
  { target: '#cmTrigger', title: 'tour.modelTitle', text: 'tour.modelText', prep: 'chat' },
  { target: '#messageInput', title: 'tour.firstChatTitle', text: 'tour.firstChatText', prep: 'chat', focus: true },
];

export function markGuidedIntroDone() {
  if (!state._activeAccountId) return;
  localStorage.setItem(accountKey('guided_intro_done'), '1');
  localStorage.removeItem(accountKey('guided_intro_pending'));
}

export function shouldAutoStartGuidedIntro() {
  if (!state._activeAccountId) return false;
  return localStorage.getItem(accountKey('guided_intro_pending')) === '1' &&
         localStorage.getItem(accountKey('guided_intro_done')) !== '1';
}

export function startGuidedIntro(stepIndex = 0) {
  state._tourActive = true;
  state._tourStepIndex = Math.max(0, Math.min(stepIndex, TOUR_STEPS.length - 1));
  document.body.classList.add('tour-active');
  const layer = document.getElementById('tourLayer');
  layer?.classList.add('active');
  layer?.setAttribute('aria-hidden', 'false');
  showTourStep();
}

export function endGuidedIntro() {
  state._tourActive = false;
  markGuidedIntroDone();
  document.body.classList.remove('tour-active');
  const layer = document.getElementById('tourLayer');
  layer?.classList.remove('active');
  layer?.setAttribute('aria-hidden', 'true');
  clearTourHighlight();
}

export function clearTourHighlight() {
  if (state._tourTargetEl) state._tourTargetEl.classList.remove('tour-highlight');
  state._tourTargetEl = null;
  if (state._tourPlacementTimer) {
    clearTimeout(state._tourPlacementTimer);
    state._tourPlacementTimer = null;
  }
}

export function prepareTourStep(step) {
  if (step.prep === 'language') {
    closePanels();
    renderLangDropdown();
    document.getElementById('langDropdown')?.classList.add('open');
  }
  if (step.prep === 'home') closePanels();
  if (step.prep === 'providerPanel') {
    closePanels();
    openProviderPanel();
  }
  if (step.prep === 'providerEditor') {
    closePanels();
    openProviderPanel();
    if (document.getElementById('providerEditor')?.style.display === 'none') startNewProvider();
  }
  if (step.prep === 'chat') closePanels();
}

export function getTourTarget(step) {
  let el = document.querySelector(step.target);
  if (step.prep === 'language') {
    el = document.getElementById('langSwitcher') || el;
  }
  if (step.target === '#pvServerUrlGroup' && el && getComputedStyle(el).display === 'none') {
    el = document.getElementById('pvApiKey');
  }
  return el;
}

export function getTourTargetRect(target) {
  if (!target) return null;
  const rects = [target.getBoundingClientRect()];
  if (target.id === 'langSwitcher') {
    const dd = document.getElementById('langDropdown');
    if (dd && dd.classList.contains('open')) rects.push(dd.getBoundingClientRect());
  }
  const left = Math.min(...rects.map(r => r.left));
  const top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function showTourStep() {
  if (!state._tourActive) return;
  const step = TOUR_STEPS[state._tourStepIndex];
  if (!step) { endGuidedIntro(); return; }
  prepareTourStep(step);
  clearTourHighlight();
  const target = getTourTarget(step);
  state._tourTargetEl = target;
  if (target) {
    target.classList.add('tour-highlight');
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }
  const progress = document.getElementById('tourProgress');
  const title = document.getElementById('tourTitle');
  const text = document.getElementById('tourText');
  const back = document.getElementById('tourBackBtn');
  const next = document.getElementById('tourNextBtn');
  if (progress) progress.textContent = tf('tour.progress', { n: state._tourStepIndex + 1, total: TOUR_STEPS.length });
  if (title) title.textContent = t(step.title);
  if (text) text.textContent = t(step.text);
  if (back) back.disabled = state._tourStepIndex === 0;
  if (next) {
    const isLangStep = step.prep === 'language';
    next.disabled = isLangStep;
    next.textContent = state._tourStepIndex === TOUR_STEPS.length - 1 ? t('tour.finish') : t('tour.next');
    if (isLangStep) next.title = t('tour.languageTitle');
  }
  scheduleTourPlacement(target, step);
}

export function scheduleTourPlacement(target, step) {
  if (state._tourPlacementTimer) clearTimeout(state._tourPlacementTimer);
  const focusTarget = step.focus === true ? target : (step.focus ? document.querySelector(step.focus) : null);
  const delays = [80, 220, 380, 520];
  const run = (idx = 0) => {
    if (!state._tourActive || TOUR_STEPS[state._tourStepIndex] !== step) return;
    positionTourCard(target);
    if (idx === delays.length - 1 && focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus({ preventScroll: true });
    }
    if (idx + 1 < delays.length) {
      state._tourPlacementTimer = setTimeout(() => run(idx + 1), delays[idx + 1] - delays[idx]);
    }
  };
  state._tourPlacementTimer = setTimeout(() => run(0), delays[0]);
}

export function positionTourCard(target) {
  const card = document.getElementById('tourCard');
  if (!card) return;
  positionTourSpotlight(target);
  const inPanel = !!target?.closest?.('.panel');
  const margin = inPanel ? 28 : 14;
  const targetGap = inPanel ? 28 : 14;
  const cw = card.offsetWidth || 340;
  const ch = card.offsetHeight || 180;
  const maxLeft = Math.max(margin, window.innerWidth - cw - margin);
  const maxTop = Math.max(margin, window.innerHeight - ch - margin);
  let left = Math.min(maxLeft, Math.max(margin, (window.innerWidth - cw) / 2));
  let top = Math.min(maxTop, Math.max(margin, (window.innerHeight - ch) / 2));
  if (target) {
    const r = getTourTargetRect(target) || target.getBoundingClientRect();
    const clampX = x => Math.min(maxLeft, Math.max(margin, x));
    const clampY = y => Math.min(maxTop, Math.max(margin, y));
    const candidates = [
      { left: r.left - cw - targetGap, top: r.top, pref: inPanel ? 0 : 1 },
      { left: r.right + targetGap, top: r.top, pref: inPanel ? 1 : 0 },
      { left: r.left, top: r.bottom + targetGap, pref: 2 },
      { left: r.left, top: r.top - ch - targetGap, pref: 3 },
      { left: (window.innerWidth - cw) / 2, top: window.innerHeight - ch - margin, pref: 4 },
      { left: (window.innerWidth - cw) / 2, top: margin, pref: 5 },
    ].map(c => ({ ...c, left: clampX(c.left), top: clampY(c.top) }));
    const overlapArea = c => {
      const x = Math.max(0, Math.min(c.left + cw, r.right) - Math.max(c.left, r.left));
      const y = Math.max(0, Math.min(c.top + ch, r.bottom) - Math.max(c.top, r.top));
      return x * y;
    };
    const distance = c => Math.abs((c.left + cw / 2) - (r.left + r.width / 2)) + Math.abs((c.top + ch / 2) - (r.top + r.height / 2));
    candidates.sort((a, b) => (overlapArea(a) - overlapArea(b)) || (a.pref - b.pref) || (distance(a) - distance(b)));
    left = candidates[0].left;
    top = candidates[0].top;
  }
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

export function positionTourSpotlight(target) {
  const spot = document.getElementById('tourSpotlight');
  if (!spot) return;
  const pad = target?.closest?.('.panel') ? 10 : 8;
  let left = window.innerWidth / 2 - 60;
  let top = window.innerHeight / 2 - 24;
  let width = 120;
  let height = 48;
  if (target) {
    const r = getTourTargetRect(target) || target.getBoundingClientRect();
    left = Math.max(8, r.left - pad);
    top = Math.max(8, r.top - pad);
    width = Math.min(window.innerWidth - left - 8, r.width + pad * 2);
    height = Math.min(window.innerHeight - top - 8, r.height + pad * 2);
  }
  spot.style.left = `${left}px`;
  spot.style.top = `${top}px`;
  spot.style.width = `${width}px`;
  spot.style.height = `${height}px`;
}

export function nextTourStep() {
  if (state._tourStepIndex >= TOUR_STEPS.length - 1) { endGuidedIntro(); return; }
  state._tourStepIndex++;
  // Skip the server-URL step if it is hidden (i.e. provider type != openai-compat)
  const step = TOUR_STEPS[state._tourStepIndex];
  if (step?.target === '#pvServerUrlGroup') {
    const el = document.getElementById('pvServerUrlGroup');
    if (!el || getComputedStyle(el).display === 'none') {
      state._tourStepIndex++;
    }
  }
  showTourStep();
}

export function prevTourStep() {
  if (state._tourStepIndex <= 0) return;
  state._tourStepIndex--;
  // Skip the server-URL step backwards too if it is hidden
  const step = TOUR_STEPS[state._tourStepIndex];
  if (step?.target === '#pvServerUrlGroup') {
    const el = document.getElementById('pvServerUrlGroup');
    if ((!el || getComputedStyle(el).display === 'none') && state._tourStepIndex > 0) {
      state._tourStepIndex--;
    }
  }
  showTourStep();
}
