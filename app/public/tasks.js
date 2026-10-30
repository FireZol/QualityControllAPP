'use strict';
// Task board: select all rows and show the bulk-action bar once something is selected.
(function () {
  var bar = document.getElementById('bulk');
  var all = document.getElementById('sel-all');
  var count = document.getElementById('bulk-count');
  if (!bar) return;
  var boxes = function () { return Array.prototype.slice.call(document.querySelectorAll('input[name=ids][form=bulk]')); };
  function refresh() {
    var n = boxes().filter(function (b) { return b.checked; }).length;
    bar.hidden = n === 0;
    count.textContent = String(n);
    if (all) all.checked = n > 0 && n === boxes().length;
  }
  if (all) all.addEventListener('change', function () { boxes().forEach(function (b) { b.checked = all.checked; }); refresh(); });
  document.addEventListener('change', function (e) { if (e.target && e.target.name === 'ids') refresh(); });
  refresh();
})();
