'use strict';
const { html } = require('../lib/html');
const { T, f } = require('../i18n/ro');
const { layout, valueCell } = require('./layout');
const { displayDateTime } = require('../lib/time');

function quickRow(r) {
  const m = r.resultMap;
  const dia = r.shape_kind === 'sector' ? html`${valueCell(m.h, 'h')} × ${valueCell(m.l, 'l')}` : html`${valueCell(m.d1, 'd1')} · ${valueCell(m.d2, 'd2')}`;
  return html`<tr><td><a href="/masuratori/${r.record_no}">${r.record_no}</a></td><td>${displayDateTime(r.created_at).slice(-5)}</td><td>${T.shift[r.shift]}</td>
    <td>${r.construction_label} <span class="tag">${r.material_code}</span></td><td>${r.machine_name}</td><td class="nowrap">${dia}</td><td>${valueCell(m.mass_gm, 'mass_gm')}</td>
    <td>${valueCell(m.r20, 'r20')}</td><td>${valueCell(m.r20_theor, 'r20_theor')}</td></tr>`;
}

const head = () => html`<thead><tr><th>${T.register.no}</th><th>${T.common.time}</th><th>${T.register.shift}</th><th>${T.register.product}</th><th>${T.measure.machine}</th>
  <th>${T.register.diameter}</th><th>${T.quantity.mass_gm}</th><th>${T.quantity.r20}</th><th>${T.quantity.r20_theor}</th></tr></thead>`;

function outRows(r) {
  const bad = r.results.filter((x) => x.verdict === 'sub' || x.verdict === 'peste');
  return html`<tr><td><a href="/masuratori/${r.record_no}">${r.record_no}</a></td><td>${displayDateTime(r.created_at)}</td><td>${r.construction_label} <span class="tag">${r.material_code}</span></td><td>${r.machine_name}</td>
    <td>${bad.map((x) => html`<span class="out-item">${T.quantity[x.quantity]}: ${valueCell(x, x.quantity)} <span class="muted">(${T.verdict[x.verdict]})</span></span> `)}</td></tr>`;
}

function homePage(ctx, d) {
  const cur = d.today.current;
  return layout(ctx, {
    title: T.home.title, active: 'home', wide: true,
    body: html`<div class="hero"><h1>${T.home.title}</h1>
  <a class="btn primary big" href="/masuratori/nou">${T.home.new_measurement}</a></div>
<p class="muted">${f(T.home.current_shift, { shift: T.shift[cur.shift], crew: cur.crew ? cur.crew.name : T.common.none })}</p>
<section class="card"><h2>${T.home.today}</h2>
  <div class="scroll"><table class="grid">${head()}<tbody>${d.today.rows.length ? d.today.rows.map(quickRow) : html`<tr><td colspan="9" class="empty">${T.home.today_empty}</td></tr>`}</tbody></table></div>
</section>
<section class="card"><h2>${T.home.out_of_limit}</h2>
  <div class="scroll"><table class="grid"><thead><tr><th>${T.register.no}</th><th>${T.common.date}</th><th>${T.register.product}</th><th>${T.measure.machine}</th><th>${T.home.results}</th></tr></thead>
  <tbody>${d.out.length ? d.out.map(outRows) : html`<tr><td colspan="5" class="empty">${T.home.out_empty}</td></tr>`}</tbody></table></div>
</section>`,
  });
}

module.exports = { homePage };
