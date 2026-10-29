'use strict';
// Row check against the paper: compares what is typed with the sheet while typing (the server checks again), Enter moves on.
(function () {
  const form = document.getElementById('verify-form');
  const msgEl = document.getElementById('verify-msg');
  if (!form || !msgEl || !window.CTC_CALC) return;
  const C = window.CTC_CALC;
  const msg = JSON.parse(msgEl.textContent);
  const inputs = Array.prototype.slice.call(form.querySelectorAll('input[data-paper]'));
  const status = document.getElementById('verify-status');
  const check = document.getElementById('verify-check');
  const same = function (a, b) { return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); };

  function update() {
    let typed = 0, bad = 0;
    inputs.forEach(function (inp) {
      const cell = inp.closest('tr').querySelector('.cmp');
      const raw = inp.value.trim();
      cell.className = 'cmp'; cell.textContent = '';
      inp.closest('tr').classList.remove('bad');
      if (!raw) return;
      typed++;
      const v = C.parseDecimal(raw);
      if (v === null || !same(v, Number(inp.getAttribute('data-app')))) { bad++; cell.className = 'cmp bad'; cell.textContent = msg.differ; inp.closest('tr').classList.add('bad'); }
      else { cell.className = 'cmp ok'; cell.textContent = msg.match; }
    });
    status.textContent = !typed ? msg.none_typed : (bad ? msg.some_differ.replace('{n}', bad) : msg.all_match);
    status.className = 'verify-status' + (bad ? ' bad' : (typed ? ' ok' : ''));
    if (check) check.disabled = bad > 0;
  }
  form.addEventListener('input', update);
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.hasAttribute('data-paper')) return;
    e.preventDefault();
    const i = inputs.indexOf(t);
    if (i < inputs.length - 1) inputs[i + 1].focus(); else if (check && !check.disabled) check.focus();
  });
  update();
  if (inputs[0]) inputs[0].focus();
})();
