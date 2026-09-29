'use strict';
// Cross-browser page numbers ("Pag. x / y") for printed documents.
// CSS page margin boxes only work in recent Chromium, not in Firefox, and the factory PCs use Chrome, Edge and Firefox equally.
// So the browser measures the content and splits it into A4 pages itself: every page gets the header, the footer and its number.
// Without JavaScript the page still prints, with the header and footer repeated by the table (no page number).
(function () {
  const doc = document.querySelector('table.doc');
  if (!doc) return;
  const MM = 96 / 25.4;
  const landscape = doc.hasAttribute('data-landscape');
  // printable area = paper minus the @page margins in print.css / print-landscape.css
  const pageW = (landscape ? 297 - 20 : 210 - 24) * MM;
  const pageH = (landscape ? 210 - 24 : 297 - 28) * MM;
  const SAFETY = 30; // px kept free on every page: rounding and font differences must never create a blank extra page
  const label = doc.getAttribute('data-label-page') || 'Pag.';

  function paginate() {
    const headTd = doc.querySelector('thead td');
    const footTd = doc.querySelector('tfoot td');
    const contentTd = doc.querySelector('tbody td');
    if (!headTd || !footTd || !contentTd) return;

    const stage = document.createElement('div');
    stage.className = 'pg-stage';
    stage.style.width = pageW + 'px';
    document.body.appendChild(stage);

    const measure = (node) => {
      const box = document.createElement('div');
      box.appendChild(node);
      stage.appendChild(box);
      const hgt = box.getBoundingClientRect().height;
      const n = box.firstChild;
      stage.removeChild(box);
      return { node: n, h: hgt };
    };
    const headH = measure(headTd.cloneNode(true)).h;
    const footH = measure(footTd.cloneNode(true)).h + 18; // room for the page number line
    const avail = pageH - headH - footH - SAFETY;

    // measure the blocks in place (full width stage)
    const blocks = Array.from(contentTd.children).map((el) => {
      const c = el.cloneNode(true);
      const box = document.createElement('div');
      box.appendChild(c);
      stage.appendChild(box);
      const info = { el, h: box.getBoundingClientRect().height, rows: null, headH: 0 };
      if (el.matches('table.sheet')) {
        const trs = Array.from(c.querySelectorAll('tbody > tr'));
        info.headH = c.querySelector('thead') ? c.querySelector('thead').getBoundingClientRect().height : 0;
        info.rows = trs.map((tr) => tr.getBoundingClientRect().height);
      }
      return info;
    });
    document.body.removeChild(stage);

    const pages = [];
    let cur = null;
    const newPage = () => { cur = { nodes: [], used: 0 }; pages.push(cur); };
    newPage();
    let pendingTitle = null;

    const place = (node, h) => { cur.nodes.push(node); cur.used += h; };
    const flushTitle = () => { if (pendingTitle) { place(pendingTitle.el.cloneNode(true), pendingTitle.h); pendingTitle = null; } };

    blocks.forEach((b) => {
      const tag = b.el.tagName;
      if (tag === 'H2') { pendingTitle = b; return; }
      if (!b.rows) {
        const need = b.h + (pendingTitle ? pendingTitle.h : 0);
        if (cur.used + need > avail && cur.nodes.length) newPage();
        flushTitle();
        place(b.el.cloneNode(true), b.h);
        return;
      }
      // a table: split its rows over pages, repeating the header row
      const src = b.el;
      const shell = () => { const t = src.cloneNode(true); t.querySelectorAll('tbody > tr').forEach((r) => r.remove()); return t; };
      const chrome = Math.max(0, b.h - b.rows.reduce((a, x) => a + x, 0) - b.headH); // borders, margins
      const firstNeed = (pendingTitle ? pendingTitle.h : 0) + b.headH + (b.rows[0] || 0);
      if (cur.used + firstNeed > avail && cur.nodes.length) newPage();
      flushTitle();
      let table = shell();
      let body = table.querySelector('tbody');
      place(table, b.headH + chrome);
      const trs = Array.from(src.querySelectorAll('tbody > tr'));
      trs.forEach((tr, i) => {
        if (cur.used + b.rows[i] > avail && body.children.length) {
          newPage();
          table = shell();
          body = table.querySelector('tbody');
          place(table, b.headH + chrome);
        }
        body.appendChild(tr.cloneNode(true));
        cur.used += b.rows[i];
      });
    });
    if (pendingTitle) { flushTitle(); }

    const wrap = document.createElement('div');
    wrap.className = 'pg-wrap';
    pages.forEach((p, i) => {
      const sec = document.createElement('section');
      sec.className = 'pg';
      sec.style.width = pageW + 'px';
      sec.style.minHeight = (pageH - 6) + 'px';
      const head = document.createElement('div');
      head.className = 'pg-head';
      head.innerHTML = headTd.innerHTML;
      const body = document.createElement('div');
      body.className = 'pg-body';
      p.nodes.forEach((n) => body.appendChild(n));
      const foot = document.createElement('div');
      foot.className = 'pg-foot';
      foot.innerHTML = footTd.innerHTML;
      const num = document.createElement('div');
      num.className = 'pg-num';
      num.textContent = label + ' ' + (i + 1) + ' / ' + pages.length;
      foot.appendChild(num);
      sec.appendChild(head);
      sec.appendChild(body);
      sec.appendChild(foot);
      wrap.appendChild(sec);
    });
    doc.classList.add('hidden');
    doc.parentNode.insertBefore(wrap, doc);
  }

  const run = () => { try { paginate(); } catch (e) { /* the unpaginated document stays visible and printable */ } };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(run); else run();
})();
