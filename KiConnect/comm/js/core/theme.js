// js/core/theme.js — extracted from kiconnect.js (Phase 4 of the v3.5.1→v4.0.0 modularization)

export const THEMES = ['dark', 'white', 'nord', 'dracula', 'forest', 'mocha', 'rose', 'solarized', 'dark_oled', 'gold_oled', 'emerald_oled', 'red_oled'];

export const THEME_SWATCHES = [
  ['dark', 'Dark', 'Dark'], ['white', 'White', 'White'], ['nord', 'Nord', 'Nord'],
  ['dracula', 'Dracula', 'Dracula'], ['forest', 'Forest', 'Forest'],
  ['mocha', 'Mocha', 'Mocha'], ['rose', 'Rose', 'Rose'], ['solarized', 'Solar', 'Solarized'],
];

export const THEME_SWATCHES_OLED = [
  ['dark_oled', 'Dark', 'Dark (OLED)'], ['gold_oled', 'Gold', 'Gold (OLED)'],
  ['emerald_oled', 'Emerald', 'Emerald (OLED)'], ['red_oled', 'Red', 'Red (OLED)'],
];

export function buildThemeSwatches() {
  const saved = localStorage.getItem('kic_theme') || 'dark';
  [[THEME_SWATCHES, 'themeSwitcher'], [THEME_SWATCHES_OLED, 'themeSwitcherOled']].forEach(([list, id]) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.innerHTML = list.map(([theme, label, title]) =>
      '<div>' +
        `<div class="theme-swatch${theme === saved ? ' active' : ''}" data-theme="${theme}" title="${title}">` +
          '<div class="theme-swatch-inner"><div class="theme-swatch-top"></div>' +
          '<div class="theme-swatch-bottom"><span></span><span></span><span></span></div></div>' +
        '</div>' +
        `<div class="theme-swatch-label">${label}</div>` +
      '</div>').join('');
  });
}

buildThemeSwatches();

export function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'dark';
  document.documentElement.setAttribute('data-theme', name);
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.getAttribute('data-theme') === name);
  });
}

export function setTheme(name) {
  applyTheme(name);
  localStorage.setItem('kic_theme', name);
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', (e) => {
    const swatch = e.target.closest('.theme-swatch');
    if (swatch) setTheme(swatch.getAttribute('data-theme'));
  });
});
