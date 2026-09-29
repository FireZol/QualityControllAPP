'use strict';
// Live limits and green / red verdicts while typing. The server recomputes everything on save;
// this file only previews, using the very same formulas (calc.js is shared with the server).
(function () {
  const dataEl = document.getElementById('live-ctx');
  const form = document.getElementById('entry');
  if (!dataEl || !form || !window.CTC_CALC) return;
  const C = window.CTC_CALC;
  const cfg = JSON.parse(dataEl.textContent);
  const out = document.getElementById('live-out');
  if (cfg.formats && C.registerQuantities) C.registerQuantities(cfg.formats);

  function inputs() {
    const o = {};
    form.querySelectorAll('[data-in]').forEach(function (el) {
      const k = el.getAttribute('data-in');
      if (['sample_type_id', 'length_no'].indexOf(k) === -1) o[k] = el.value;
    });
    return o;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function limitText(r) {
    if (r.verdict === 'info') return '';
    if (r.lim_min === null && r.lim_max === null) return cfg.verdicts.nedeterminat;
    const q = r.quantity === 'r20_theor' ? 'r20' : r.quantity;
    if (r.lim_min !== null && r.lim_max === null && cfg.mode === 'tests') return '≥ ' + C.formatQuantity(q, r.lim_min);
    const a = r.lim_min === null ? '–' : C.formatQuantity(q, r.lim_min);
    const b = r.lim_max === null ? '–' : C.formatQuantity(q, r.lim_max);
    return r.lim_min === null && r.lim_max !== null ? '≤ ' + b : a + ' … ' + b;
  }

  function render() {
    const ev = cfg.mode === 'tests' ? C.evaluateTests(inputs(), cfg.ctx) : C.evaluate(inputs(), cfg.ctx);
    out.textContent = '';
    if (ev.warnings.indexOf('temp_range') !== -1) out.appendChild(el('p', 'warn-line', cfg.messages.temp_warning));
    if (!ev.results.length) { out.appendChild(el('p', 'muted', cfg.messages.empty)); return; }
    const table = el('table', 'grid');
    const tbody = el('tbody');
    ev.results.forEach(function (r) {
      const tr = el('tr');
      tr.appendChild(el('th', '', cfg.quantities[r.quantity] || r.quantity));
      const td = el('td');
      td.appendChild(el('span', 'val v-' + r.verdict, C.formatQuantity(r.quantity, r.value)));
      tr.appendChild(td);
      tr.appendChild(el('td', '', limitText(r)));
      const vd = el('td');
      vd.appendChild(el('span', 'v v-' + r.verdict, cfg.verdicts[r.verdict]));
      tr.appendChild(vd);
      tr.appendChild(el('td', '', r.deviation_pct === null ? '' : C.signed(r.deviation_pct, 2) + ' %'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    out.appendChild(table);
  }

  // length number: proposed automatically for numbered sample types
  const sampleSel = form.querySelector('[data-in="sample_type_id"]');
  const lengthNo = form.querySelector('[data-in="length_no"]');
  function syncLength() {
    if (!sampleSel || !lengthNo) return;
    const numbered = cfg.numbered.indexOf(Number(sampleSel.value)) !== -1;
    if (numbered && lengthNo.value === '') lengthNo.value = String(cfg.proposal);
    if (!numbered && lengthNo.value === String(cfg.proposal)) lengthNo.value = '';
  }
  if (sampleSel) sampleSel.addEventListener('change', syncLength);
  syncLength();

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  render();

  // keyboard-only entry: Enter moves to the next field, the last Enter saves
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type === 'checkbox' || t.type === 'submit') return;
    e.preventDefault();
    const fields = Array.prototype.filter.call(form.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), select, textarea'), function (x) { return !x.disabled; });
    const i = fields.indexOf(t);
    if (i >= 0 && i < fields.length - 1) fields[i + 1].focus();
    else form.requestSubmit();
  });
})();
