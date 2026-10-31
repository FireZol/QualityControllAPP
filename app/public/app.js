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

  // "A+" switches larger text and controls for this PC (factory hall screens); the choice is kept in this browser
  (function () {
    const btn = document.querySelector('[data-comfort]');
    if (!btn) return;
    const root = document.documentElement;
    const sync = function () { btn.setAttribute('aria-pressed', root.classList.contains('comfort') ? 'true' : 'false'); };
    sync();
    btn.addEventListener('click', function () {
      const on = !root.classList.contains('comfort');
      root.classList.toggle('comfort', on);
      try { localStorage.setItem('ctc_comfort', on ? '1' : '0'); } catch (e) { /* cannot remember: still applied now */ }
      sync();
    });
  })();

  // the ◐ menu picks Light, Dark or PC default; the ☰ button opens the navigation drawer on narrow screens
  (function () {
    const mark = function () {
      const pref = window.ctcTheme ? window.ctcTheme.get() : 'system';
      document.querySelectorAll('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-checked', b.getAttribute('data-theme-set') === pref ? 'true' : 'false'); });
    };
    mark();
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const follow = function () { if (window.ctcTheme && window.ctcTheme.get() === 'system') window.ctcTheme.apply('system'); };
      if (mq.addEventListener) mq.addEventListener('change', follow);
    }
    document.addEventListener('click', function (e) {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const pick = t.closest('[data-theme-set]');
      if (pick && window.ctcTheme) {
        window.ctcTheme.set(pick.getAttribute('data-theme-set'));
        mark();
        const d = pick.closest('details'); if (d) d.removeAttribute('open');
      } else if (t.closest('[data-side-toggle]')) document.body.classList.toggle('side-open');
      else if (t.closest('[data-side-close]') || (document.body.classList.contains('side-open') && t.closest('.side a'))) document.body.classList.remove('side-open');
    });
  })();

  // parts of a form that only matter for some choice: data-when="name=a,b" on an input (its label goes with it) or on a paragraph; they show while
  // the form's control `name` has one of those values (without this script everything stays visible)
  document.querySelectorAll('form').forEach(function (form) {
    const parts = form.querySelectorAll('[data-when]');
    if (!parts.length) return;
    const update = function () {
      parts.forEach(function (el) {
        const spec = el.getAttribute('data-when').split('=');
        const control = form.elements.namedItem(spec[0]);
        const show = !!control && spec[1].split(',').indexOf(control.value) !== -1;
        const target = el.closest('label') || el;
        target.hidden = !show;
      });
    };
    form.addEventListener('change', update);
    update();
  });

  // a form that came back with marked fields: the summary at the top is read out, and the first marked field takes the cursor
  (function () {
    const box = document.querySelector('[data-form-summary]');
    if (!box) return;
    const first = document.querySelector('.has-error input, .has-error select, .has-error textarea');
    if (first) { first.scrollIntoView({ block: 'center' }); first.focus({ preventScroll: true }); } else box.focus();
  })();

  // a success notice fades after a few seconds; errors stay until the page changes
  document.querySelectorAll('.flash-ok').forEach(function (el) {
    setTimeout(function () { el.classList.add('fade'); }, 6000);
    setTimeout(function () { el.classList.add('hidden'); }, 7000);
  });

  // the "?" tip box and the Administration menu close on a click elsewhere or on Esc
  document.addEventListener('click', function (e) {
    document.querySelectorAll('details.help[open], details.navmore[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.querySelectorAll('details.help[open], details.navmore[open]').forEach(function (d) { d.removeAttribute('open'); });
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
