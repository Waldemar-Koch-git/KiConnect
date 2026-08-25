import { renderAccountGrid } from '../auth/accounts.js';
import { escHtml } from '../chat/chat-render.js';
import { renderSidebar } from '../chat/chat-sidebar.js';
import { state } from './state.js';
import { renderProviderList } from '../providers/provider-crud.js';
import { configureThinkingSlider, renderModelMaxList, splitModelId, updateThinkingIntensityUI } from '../providers/provider-models.js';
import { _languageChangeListeners } from '../ui/misc-ui.js';
import { renderProfileList, updateProfileBadge } from '../ui/profiles.js';
import { TOUR_STEPS } from '../ui/tour.js';
import { getWebSearchLocale } from '../websearch/web-search.js';

export function t(key) {
  const lang = TRANSLATIONS[state.currentLang] || TRANSLATIONS['en'];
  return lang[key] ?? TRANSLATIONS['en'][key] ?? key;
}

export function tf(key, vars) {
  let s = t(key);
  if (vars) Object.entries(vars).forEach(([k,v]) => { s = s.replaceAll(`{${k}}`, v); });
  return s;
}

export function bt(key) { return t(key); }

export function btf(key, vars) { return tf(key, vars); }

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    const attr = el.getAttribute('data-i18n-attr');
    if (attr === 'placeholder') {
      el.placeholder = val;
    } else if (attr === 'title') {
      el.title = val;
    } else if (el.getAttribute('data-i18n-html')) {
      el.innerHTML = val;
    } else {
      el.textContent = val;
    }
  });
  const btn = document.getElementById('langBtnLabel');
  if (btn) btn.textContent = LANGUAGES[state.currentLang]?.code || state.currentLang.toUpperCase();
  document.documentElement.dir = (typeof RTL_LANGS !== 'undefined' ? RTL_LANGS : ['ar', 'ur']).includes(state.currentLang) ? 'rtl' : 'ltr';
  document.documentElement.lang = state.currentLang;
  if (typeof syncCustomDropdown === 'function') {
    const hiddenSel = document.getElementById('modelSelector');
    if (hiddenSel && !hiddenSel.value) syncCustomDropdown();
  }
}

export function setLang(code) {
  state.currentLang = code;
  localStorage.setItem('kic_lang', code);
  applyTranslations();
  if (typeof updateProfileBadge === 'function') updateProfileBadge();
  
  retranslateBubbleButtons();
  retranslateSuggestionChips();
  retranslateCodeBlockButtons();
  retranslateBattleTiles();
  
  if (typeof updateThinkingIntensityUI === 'function') updateThinkingIntensityUI();
  if (typeof configureThinkingSlider === 'function') {
    const { modelId } = (typeof splitModelId === 'function' && state.config?.model)
      ? splitModelId(state.config.model) : { modelId: '' };
    configureThinkingSlider(modelId);
  }
  if (typeof syncCustomDropdown === 'function') syncCustomDropdown();
  (_languageChangeListeners || []).forEach(fn => fn());
  if (typeof renderSidebar === 'function') renderSidebar();
  // These panels build their content with t() at render time instead of
  // static data-i18n markup, so re-render them if open.
  if (document.getElementById('providerPanel')?.classList.contains('open') && typeof renderProviderList === 'function') renderProviderList();
  if (document.getElementById('profilePanel')?.classList.contains('open') && typeof renderProfileList === 'function') renderProfileList();
  if (document.getElementById('modelMaxPanel')?.classList.contains('open') && typeof renderModelMaxList === 'function') renderModelMaxList();
  if (document.getElementById('accountSelectView') && document.getElementById('accountSelectView').style.display !== 'none' && typeof renderAccountGrid === 'function') renderAccountGrid();
  renderLangDropdown();
  // During the tour language step: re-render the tour card in the new language,
  // keep the dropdown open so the checkmark is visible, and unlock the Next button.
  // The user then clicks Next themselves to continue the tour in their chosen language.
  if (state._tourActive && TOUR_STEPS[state._tourStepIndex]?.prep === 'language') {
    document.getElementById('langDropdown')?.classList.add('open');
    // Re-render tour card title + text in the newly chosen language
    const step = TOUR_STEPS[state._tourStepIndex];
    const titleEl = document.getElementById('tourTitle');
    const textEl  = document.getElementById('tourText');
    if (titleEl) titleEl.textContent = t(step.title);
    if (textEl)  textEl.textContent  = t(step.text);
    // Enable the Next button now that a language has been selected
    const nextBtn = document.getElementById('tourNextBtn');
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.title = '';
    }
  } else {
    closeLangDropdown();
  }
}

export function renderLangDropdown() {
  const dd = document.getElementById('langDropdown');
  if (!dd) return;
  dd.innerHTML = '';
  Object.entries(LANGUAGES).forEach(([code, info]) => {
    const div = document.createElement('div');
    div.className = 'lang-option' + (code === state.currentLang ? ' active' : '');
    div.textContent = info.label + (code === state.currentLang ? ' ✓' : '');
    div.addEventListener('click', () => setLang(code));
    dd.appendChild(div);
  });
}

export function toggleLangDropdown() {
  const dd = document.getElementById('langDropdown');
  if (!dd) return;
  renderLangDropdown();
  dd.classList.toggle('open');
}

export function closeLangDropdown() {
  document.getElementById('langDropdown')?.classList.remove('open');
}

export function retranslateBubbleButtons() {
  document.querySelectorAll('.bubble-act-btn[data-action]').forEach(btn => {
    const action = btn.getAttribute('data-action');
    const keyMap = {
      'copy': 'js.copy', 'copy-formatted': 'js.copyFormatted', 'edit': 'js.edit', 'branch': 'js.branch',
      'regenerate': 'js.regenerate', 'delete': 'js.delete'
    };
    if (keyMap[action]) btn.textContent = t(keyMap[action]);
    if (action === 'copy-formatted') btn.title = t('js.copyFormattedTitle');
  });
  // retranslate personal notes in place (cheap DOM walk, no full re-render,
  // preserves scroll position, open/closed state and any text currently being typed)
  document.querySelectorAll('.note-holder').forEach(holder => {
    const toggleBtn = holder.querySelector('.note-toggle-btn');
    const noteBox    = holder.querySelector('.note-box');
    const textarea   = holder.querySelector('.note-textarea');
    const deleteBtn  = holder.querySelector('.note-delete-btn');
    const headerLbl  = holder.querySelector('.note-box-header span');
    const preview    = holder.querySelector('.note-render');
    const printCopy  = holder.querySelector('.note-print');
    if (!toggleBtn) return;
    const hasNote = toggleBtn.classList.contains('has-note');
    const isOpen  = !!(noteBox && noteBox.style.display !== 'none');
    toggleBtn.innerHTML = hasNote
      ? `🗒️ ${escHtml(t('js.noteLabel'))} <span class="note-caret">${isOpen ? '▴' : '▾'}</span>`
      : `<span class="note-plus">+</span> ${escHtml(t('js.noteAdd'))}`;
    if (headerLbl) headerLbl.textContent = '🗒️ ' + t('js.noteLabel');
    if (deleteBtn) deleteBtn.title = t('js.noteDelete');
    if (textarea)  textarea.placeholder = t('js.notePlaceholder');
    if (preview)   preview.title = t('js.noteEditHint');
    if (printCopy) printCopy.dataset.label = t('js.noteLabel');
  });
}

export function retranslateCodeBlockButtons(root = document) {
  root.querySelectorAll('.code-copy-btn[data-b64]').forEach(btn => {
    const isDone = btn.classList.contains('done');
    btn.textContent = isDone ? t('js.copied') : t('js.codeCopy');
  });

  root.querySelectorAll('.code-collapse-btn').forEach(btn => {
    const block = btn.closest('.code-block');
    const collapsed = !!block?.classList.contains('collapsed');
    const label = collapsed
      ? (t('js.codeExpand'))
      : (t('js.codeCollapse'));

    btn.title = label;
    //btn.setAttribute('aria-label', label);
  });
}

export function retranslateSuggestionChips() {
  const suggestions = [
    { i18n: 'empty.quantum', msgKey: 'empty.quantumMsg' },
    { i18n: 'empty.python',  msgKey: 'empty.pythonMsg' },
    { i18n: 'empty.mlvsdl',  msgKey: 'empty.mlvsdlMsg' },
    { i18n: 'empty.integral',msgKey: 'empty.integralMsg' },
  ];
  const chipsContainer = document.getElementById('suggestionChips');
  if (!chipsContainer) return;
  const chips = chipsContainer.querySelectorAll('.suggestion-chip');
  chips.forEach((chip, i) => {
    if (suggestions[i]) chip.textContent = t(suggestions[i].i18n);
  });
}

// Battle-Modus tile grids build their status labels/winner button with
// bt()/btf() only once, at render time — a plain language switch never
// touched them. Same surgical-DOM-walk approach as
// retranslateBubbleButtons() above, so scroll/streaming isn't disturbed.
export function retranslateBattleTiles(root = document) {
  root.querySelectorAll('.battle-row').forEach(row => {
    const avatar = row.querySelector('.avatar-col .avatar.ai');
    if (avatar) avatar.title = t('battle.toggleLabel');
    row.querySelectorAll('.battle-tile-status').forEach(span => {
      if (span.classList.contains('live')) span.textContent = t('battle.generating');
      else if (span.classList.contains('error')) span.textContent = '⚠️';
      else if (span.classList.contains('done')) span.textContent = '✓';
      else span.textContent = t('battle.pending');
    });
    row.querySelectorAll('.battle-winner-btn').forEach(btn => { btn.textContent = t('battle.chooseWinner'); });
    row.querySelectorAll('.battle-default-banner').forEach(banner => {
      // The model name was baked into the string the first time round —
      // stashed on the element (see _buildBattleTileGridRow) so it can be
      // rebuilt with the new language's template instead of being lost.
      const model = banner.dataset.model || '';
      banner.textContent = tf('battle.defaultBanner', { model });
    });
  });
}

export function ta(key, fallback) { const v = t(key); return v === key ? fallback : v; }

export function getAcceptLanguage() {
  const primary = getWebSearchLocale().searx || 'en-US';
  const short = primary.split('-')[0];
  return `${primary},${short};q=0.9,en;q=0.7`;
}

(function(){
  const trigger=document.getElementById('cmTrigger');
  const panel=document.getElementById('cmPanel');
  const list=document.getElementById('cmList');
  const search=document.getElementById('cmSearch');
  const label=document.getElementById('cmLabel');
  const hiddenSel=document.getElementById('modelSelector');
  let open=false;
  window._cmData=[];

  function positionPanel(){
    // Use rAF so Firefox completes its reflow before measuring getBoundingClientRect
    requestAnimationFrame(()=>{
      const rect=trigger.getBoundingClientRect();
      const vh=window.innerHeight;
      const spaceBelow=vh-rect.bottom-8;const spaceAbove=rect.top-8;
      const maxH=Math.min(380,Math.max(spaceBelow,spaceAbove)-8);
      panel.style.maxHeight=maxH+'px';panel.style.left=rect.left+'px';
      panel.style.width=Math.max(rect.width,260)+'px';
      if(spaceBelow>=180||spaceBelow>=spaceAbove){panel.style.top=(rect.bottom+4)+'px';panel.style.bottom='auto';}
      else{panel.style.bottom=(vh-rect.top+4)+'px';panel.style.top='auto';}
    });
  }

  function renderList(filter){
    const q=(filter||'').toLowerCase();
    list.innerHTML='';let count=0;
    window._cmData.forEach(group=>{
      const items=group.items.filter(m=>!q||m.label.toLowerCase().includes(q));
      if(!items.length)return;
      const gl=document.createElement('div');gl.className='cm-group-label';gl.textContent=group.group;list.appendChild(gl);
      items.forEach(m=>{
        const opt=document.createElement('div');
        opt.className='cm-option'+(m.value===hiddenSel.value?' selected':'');
        opt.textContent=m.label;opt.title=m.label;
        opt.addEventListener('click',()=>{hiddenSel.value=m.value;hiddenSel.dispatchEvent(new Event('change'));closePanel();});
        list.appendChild(opt);count++;
      });
    });
    if(!count){const em=document.createElement('div');em.className='cm-empty';em.textContent=typeof t==='function'?t('js.noModelFound'):'No model found';list.appendChild(em);}
  }

  function openPanel(){
    if(open)return;open=true;trigger.classList.add('open');panel.classList.add('open');
    positionPanel();renderList('');search.value='';search.focus();
    const sel=list.querySelector('.selected');if(sel)setTimeout(()=>sel.scrollIntoView({block:'nearest'}),30);
  }
  function closePanel(){
    if(!open)return;open=false;trigger.classList.remove('open');panel.classList.remove('open');
  }

  trigger.addEventListener('click',e=>{e.stopPropagation();open?closePanel():openPanel();});
  search.addEventListener('input',()=>renderList(search.value));
  search.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closePanel();trigger.focus();}
    if(e.key==='ArrowDown'){const first=list.querySelector('.cm-option');if(first){first.focus();e.preventDefault();}}
  });
  list.addEventListener('keydown',e=>{if(e.key==='Escape'){closePanel();trigger.focus();}});
  document.addEventListener('click',e=>{if(!panel.contains(e.target)&&e.target!==trigger)closePanel();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closePanel();});
  window.addEventListener('resize',()=>{if(open)positionPanel();});
  window.addEventListener('scroll',()=>{if(open)positionPanel();},true);

  window.syncCustomDropdown=function(){
    const val=hiddenSel.value;
    const opt=hiddenSel.options[hiddenSel.selectedIndex];
    label.textContent=opt?opt.textContent:(typeof t==='function'?t('js.selectModel'):'— Select model —');
    if(!val)label.textContent=(typeof t==='function'?t('js.selectModel'):'— Open settings —');
    if(open)renderList(search.value);
  };
  window.buildCustomDropdownData=function(){
    const data=[];
    Array.from(hiddenSel.children).forEach(child=>{
      if(child.tagName==='OPTGROUP'){
        const group={group:child.label,items:[]};
        Array.from(child.children).forEach(opt=>{group.items.push({value:opt.value,label:opt.textContent});});
        data.push(group);
      } else if(child.tagName==='OPTION'&&child.value){
        let last=data[data.length-1];
        if(!last||last.group!==''){last={group:'',items:[]};data.push(last);}
        last.items.push({value:child.value,label:child.textContent});
      }
    });
    window._cmData=data;window.syncCustomDropdown();
  };
})();
