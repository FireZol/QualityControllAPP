'use strict';
// The formula editor of the custom field form: chips that insert fields and functions, examples made from the fields that exist, and a live
// preview with sample values. Uses the same parser and evaluator as the server (formula.js), so what the preview shows is what will be saved.
(function () {
  const F = window.CTC_FORMULA;
  const root = document.querySelector('[data-formula-builder]');
  if (!F || !root) return;
  const form = root.closest('form');
  const text = root.querySelector('[data-formula-text]');
  const poolAll = JSON.parse(document.getElementById('cf-pool').textContent);
  const M = JSON.parse(document.getElementById('cf-msgs').textContent);
  const self = Number(root.getAttribute('data-self')) || 0;
  const samples = {};   // sample values typed in the preview, kept while the formula changes
  const ro = M.lang === 'ro';
  const label = function (f) { return M.lang === 'en' && f.label_en ? f.label_en : f.label; };

  const current = function () {
    const kind = form.elements.namedItem('kind').value;
    const teamEl = form.elements.namedItem('team');
    const team = kind === 'task' && teamEl ? teamEl.value : '';
    return poolAll.filter(function (f) { return f.kind === kind && f.id !== self && (!f.team || f.team === team) && (f.active || (text.value || '').indexOf('[' + label(f) + ']') !== -1); });
  };

  function insert(s) {
    const a = text.selectionStart === undefined ? text.value.length : text.selectionStart;
    const b = text.selectionEnd === undefined ? a : text.selectionEnd;
    text.value = text.value.slice(0, a) + s + text.value.slice(b);
    const pos = a + s.length;
    text.focus(); text.setSelectionRange(pos, pos);
    refresh();
  }

  function chips(where, items, make) {
    const box = root.querySelector('[data-chips="' + where + '"]');
    box.querySelectorAll('.chip, .none').forEach(function (n) { n.remove(); });
    if (!items.length) { const s = document.createElement('span'); s.className = 'none muted'; s.textContent = M.none; box.appendChild(s); return; }
    items.forEach(function (it) { box.appendChild(make(it)); });
  }
  function chip(txt, insertText, cls, title) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip ' + (cls || ''); b.textContent = txt; b.setAttribute('data-insert', insertText);
    if (title) b.title = title;
    return b;
  }

  function examples(pool) {
    const nums = pool.filter(function (f) { return f.type === 'number'; });
    const dates = pool.filter(function (f) { return f.type === 'date'; });
    const n = function (f) { return '[' + label(f) + ']'; };
    const out = [];
    if (nums.length) out.push([M.ex_convert, 'round(' + n(nums[0]) + ' / 60; 1)']);
    if (nums.length > 1) out.push([M.ex_multiply, n(nums[0]) + ' * ' + n(nums[1])]);
    if (dates.length > 1) out.push([M.ex_days, n(dates[1]) + ' - ' + n(dates[0])]);
    if (nums.length) { out.push([M.ex_if, 'if(' + n(nums[0]) + ' > 100; 1; 0)']); out.push([M.ex_default, 'if(empty(' + n(nums[0]) + '); 0; ' + n(nums[0]) + ')']); }
    return out;
  }

  function sampleInput(f) {
    const wrap = document.createElement('label');
    wrap.className = 'field sample';
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = label(f); wrap.appendChild(lbl);
    let el;
    if (f.type === 'yesno') {
      el = document.createElement('select');
      [['', '—'], ['1', M.yes], ['0', M.no]].forEach(function (o) { const op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; el.appendChild(op); });
    } else { el = document.createElement('input'); el.type = f.type === 'date' ? 'date' : 'text'; if (f.type !== 'date') el.setAttribute('inputmode', 'decimal'); }
    el.value = samples[f.id] || '';
    el.addEventListener('input', function () { samples[f.id] = el.value; evaluate(); });
    el.addEventListener('change', function () { samples[f.id] = el.value; evaluate(); });
    wrap.appendChild(el);
    return wrap;
  }

  // The chips are rebuilt only when the kind or the team changes. Rebuilding them on every change event would remove the chip a person is just
  // pressing (a field loses focus -> change -> chips replaced -> the click lands on nothing).
  function renderChips() {
    const pool = current();
    chips('fields', pool, function (f) { return chip(label(f) + (f.calc ? ' ƒ' : ''), '[' + label(f) + ']', 'field', f.type); });
    chips('examples', examples(pool), function (e) { return chip(e[0], e[1], 'example', e[1]); });
  }

  let parsed = null;
  function refresh() {
    const pool = current();
    const out = root.querySelector('.calc-result');
    const box = root.querySelector('.samples');
    const stored = F.toStored(text.value, pool);
    parsed = null;
    if (!text.value.trim()) { box.textContent = ''; out.className = 'calc-result'; out.textContent = ''; return; }
    if (!stored.ok) { box.textContent = ''; out.className = 'calc-result bad'; out.textContent = (M[stored.code] || M.syntax) + (stored.name ? ' [' + stored.name + ']' : ''); return; }
    const p = F.parse(stored.text);
    if (!p.ok) { box.textContent = ''; out.className = 'calc-result bad'; out.textContent = M[p.code] || M.syntax; return; }
    parsed = { ast: p.ast, pool: pool };
    const ids = F.refs(p.ast);
    // keep the sample boxes the person is typing in; only add the ones that are new and drop the ones no longer used
    const have = {};
    box.querySelectorAll('[data-sample]').forEach(function (n) { have[n.getAttribute('data-sample')] = n; });
    ids.forEach(function (id) {
      const f = pool.filter(function (x) { return x.id === id; })[0];
      if (!f || f.calc) return;
      if (have[id]) { delete have[id]; return; }
      const w = sampleInput(f); w.setAttribute('data-sample', id); box.appendChild(w);
    });
    Object.keys(have).forEach(function (id) { have[id].remove(); });
    evaluate();
  }

  function evaluate() {
    const out = root.querySelector('.calc-result');
    if (!parsed) return;
    const now = new Date();
    const iso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const typeOf = {}; parsed.pool.forEach(function (f) { typeOf[f.id] = f.type; });
    try {
      const v = F.evaluate(parsed.ast, { today: F.todayNumber(iso), get: function (id) { return F.numberOf(typeOf[id], samples[id]); } });
      const dec = form.elements.namedItem('decimals');
      const d = dec && /^\d$/.test(dec.value) ? Number(dec.value) : 2;
      if (v === null) { out.className = 'calc-result muted'; out.textContent = M.empty_result; return; }
      const t = F.roundTo(v, d).toFixed(d);
      const unit = form.elements.namedItem('unit');
      out.className = 'calc-result ok';
      out.textContent = M.result + ': ' + (ro ? t.replace('.', ',') : t) + (unit && unit.value ? ' ' + unit.value : '');
    } catch (e) { out.className = 'calc-result bad'; out.textContent = (e && M[e.code]) || M.syntax; }
  }

  root.addEventListener('click', function (e) {
    const b = e.target.closest('[data-insert]');
    if (!b) return;
    if (b.classList.contains('example')) { text.value = b.getAttribute('data-insert'); text.focus(); refresh(); } else insert(b.getAttribute('data-insert'));
  });
  text.addEventListener('input', refresh);
  form.addEventListener('change', function (e) {
    const n = e.target.name || '';
    if (/^(kind|team)$/.test(n)) { renderChips(); refresh(); } else if (/^(type|decimals|unit)$/.test(n)) evaluate();
  });
  form.addEventListener('input', function (e) { if (/^(decimals|unit)$/.test(e.target.name || '')) evaluate(); });
  renderChips();
  refresh();
})();
