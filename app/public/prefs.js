'use strict';
// Per-PC display preferences, applied before the page is drawn (no flash). Stored in this browser only.
(function () {
  document.documentElement.classList.add('js');
  // theme: 'light', 'dark' or 'system' (the PC's own setting, followed live); kept in this browser, 'system' until a choice is made
  const THEMES = ['light', 'dark', 'system'];
  window.ctcTheme = {
    get: function () { try { const t = localStorage.getItem('ctc_theme'); return THEMES.indexOf(t) >= 0 ? t : 'system'; } catch (e) { return 'system'; } },
    apply: function (pref) {
      const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const root = document.documentElement;
      root.setAttribute('data-theme', pref === 'system' ? (dark ? 'dark' : 'light') : pref);
      root.setAttribute('data-theme-pref', pref);
    },
    set: function (pref) { try { localStorage.setItem('ctc_theme', pref); } catch (e) { /* cannot remember: still applied now */ } this.apply(pref); },
  };
  window.ctcTheme.apply(window.ctcTheme.get());
  try {
    const saved = localStorage.getItem('ctc_comfort');
    // no choice made on this PC yet: a touch screen (finger as main pointer) starts with the larger text and buttons
    const touch = saved === null && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (saved === '1' || touch) document.documentElement.classList.add('comfort');
  } catch (e) { /* storage blocked: default size */ }
})();
