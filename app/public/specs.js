'use strict';
// Construction editor: show the diameter rows that fit the chosen shape (round: Ø, sector: Î and L).
(function () {
  const sel = document.getElementById('shape-select');
  if (!sel) return;
  function apply() {
    const opt = sel.options[sel.selectedIndex];
    const kind = opt ? opt.getAttribute('data-kind') : 'rotund';
    document.querySelectorAll('.only-round').forEach(function (r) { r.classList.toggle('hidden', kind !== 'rotund'); });
    document.querySelectorAll('.only-sector').forEach(function (r) { r.classList.toggle('hidden', kind !== 'sector'); });
  }
  sel.addEventListener('change', apply);
  apply();
})();
