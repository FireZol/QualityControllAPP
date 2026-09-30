'use strict';
// Small progressive enhancements shared by every page. Pages work without this file.
(function () {
  // <select data-autosubmit data-resets="a,b"> submits its GET form on change, clearing dependent selects first
  document.addEventListener('change', function (e) {
    const el = e.target;
    if (!(el instanceof HTMLSelectElement) || !el.hasAttribute('data-autosubmit')) return;
    const form = el.form;
    if (!form) return;
    const resets = (el.getAttribute('data-resets') || '').split(',').filter(Boolean);
    resets.forEach(function (name) {
      const other = form.elements.namedItem(name);
      if (other) other.value = '';
    });
    form.submit();
  });

  // the "?" tip box closes on a click elsewhere or on Esc
  document.addEventListener('click', function (e) {
    document.querySelectorAll('details.help[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.querySelectorAll('details.help[open]').forEach(function (d) { d.removeAttribute('open'); });
  });

  // <button data-print> opens the browser's print dialog
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (t instanceof Element && t.closest('[data-print]')) window.print();
  });

  // <form data-confirm="Sigur?"> asks before submitting
  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const msg = form.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });
})();
