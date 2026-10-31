'use strict';
// Calculated custom fields in a record form: the result is worked out while the person types, with the same evaluator the server uses
// (formula.js). The server still works the result out again when the record is saved.
(function () {
  const F = window.CTC_FORMULA;
  if (!F) return;
  document.querySelectorAll('[data-calcs]').forEach(function (box) {
    const cfg = JSON.parse(box.getAttribute('data-calcs'));
    const form = box.closest('form');
    if (!form) return;
    const ro = document.documentElement.lang === 'ro';
    const calcIds = cfg.calcs.map(function (c) { return c.id; });
    const raw = function (id) { const el = form.elements.namedItem('cf_' + id); return el ? el.value : cfg.stored[id]; };
    const now = new Date();
    const iso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    function run() {
      const done = {};
      cfg.calcs.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (c) {
        const p = F.parse(c.f);
        let v = null;
        if (p.ok) {
          try {
            v = F.evaluate(p.ast, { today: F.todayNumber(iso), get: function (id) { return calcIds.indexOf(id) !== -1 ? (done[id] === undefined ? null : done[id]) : F.numberOf(cfg.types[id], raw(id)); } });
          } catch (e) { v = null; }
        }
        const t = F.toText(v, c.d);
        done[c.id] = t === '' ? null : Number(t);
        const out = box.querySelector('[data-calc-out="' + c.id + '"]');
        if (!out) return;
        if (t === '') out.textContent = '—';
        else { const s = Number(t).toFixed(c.d); out.textContent = (ro ? s.replace('.', ',') : s) + (c.u ? ' ' + c.u : ''); }
      });
    }
    form.addEventListener('input', run);
    form.addEventListener('change', run);
    run();
  });
})();
