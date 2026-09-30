'use strict';
// Per-PC display preferences, applied before the page is drawn (no flash). Stored in this browser only.
(function () {
  try { if (localStorage.getItem('ctc_comfort') === '1') document.documentElement.classList.add('comfort'); } catch (e) { /* storage blocked: default size */ }
})();
