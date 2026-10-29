'use strict';
// Quick search above the constructions table of a data sheet: hides the rows that do not contain the typed text.
(function () {
  const box = document.getElementById('row-filter');
  const table = document.querySelector('table.sheet');
  if (!box || !table) return;
  const rows = Array.prototype.slice.call(table.tBodies[0].rows);
  box.addEventListener('input', function () {
    const q = box.value.trim().toLowerCase();
    rows.forEach(function (r) { r.hidden = q !== '' && r.textContent.toLowerCase().indexOf(q) === -1; });
  });
})();
