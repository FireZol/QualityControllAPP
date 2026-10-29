'use strict';
// Per-PC display preferences, applied before the page is drawn (no flash). Stored in this browser only.
(function () {
  try {
    const saved = localStorage.getItem('ctc_comfort');
    // no choice made on this PC yet: a touch screen (finger as main pointer) starts with the larger text and buttons
    const touch = saved === null && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (saved === '1' || touch) document.documentElement.classList.add('comfort');
  } catch (e) { /* storage blocked: default size */ }
})();
