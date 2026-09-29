'use strict';
const { html, raw } = require('../lib/html');
const { T, f } = require('../i18n/ro');
const calc = require('../domain/calc');
const { layout, textField, selectField } = require('./layout');
const { QUANTITIES, GROUPS } = require('../domain/analytics');

const TABS = ['tendinta', 'distributie', 'neconformitate', 'consum', 'comparatie'];

function qs(f, extra) {
  const p = new URLSearchParams();
  const map = { from: f.from, to: f.to, family_id: f.family_id, product: f.stable_key, machine_id: f.machine_id, shift: f.shift, crew_id: f.crew_id, operator_id: f.operator_id, client_id: f.client_id, level: f.level, quantity: f.quantity, group: f.group };
  for (const [k, v] of Object.entries({ ...map, ...(extra || {}) })) if (v !== '' && v !== null && v !== undefined) p.set(k, String(v));
  return p.toString();
}

function filterForm(tab, filters, lists) {
  const opt = (rows, key, label) => rows.map((r) => [r[key], r[label]]);
  const needsGroup = tab !== 'tendinta';
  const needsQuantity = ['tendinta', 'distributie', 'comparatie'].includes(tab);
  return html`<form method="get" action="/analize/${tab}" class="card filters"><div class="row">
    ${textField({ label: T.common.from, name: 'from', value: filters.from, type: 'date' })}
    ${textField({ label: T.common.to, name: 'to', value: filters.to, type: 'date' })}
    ${selectField({ label: T.measure.family, name: 'family_id', value: filters.family_id, options: opt(lists.families, 'id', 'name'), blank: T.common.all })}
    ${selectField({ label: T.register.product, name: 'product', value: filters.stable_key, options: lists.products.map((p) => [p.stable_key, `${p.label} · ${T.material[p.material]}`]), blank: T.common.all })}
    ${selectField({ label: T.measure.level, name: 'level', value: filters.level, options: [['suvita', T.level.suvita], ['toron', T.level.toron], ['lita', T.level.lita]], blank: T.common.all })}
    ${selectField({ label: T.measure.machine, name: 'machine_id', value: filters.machine_id, options: opt(lists.machines, 'id', 'name'), blank: T.common.all })}
    ${selectField({ label: T.register.shift, name: 'shift', value: filters.shift, options: [['zi', T.shift.zi], ['noapte', T.shift.noapte]], blank: T.common.all })}
    ${selectField({ label: T.register.crew, name: 'crew_id', value: filters.crew_id, options: opt(lists.crews, 'id', 'name'), blank: T.common.all })}
    ${selectField({ label: T.measure.operator, name: 'operator_id', value: filters.operator_id, options: opt(lists.operators, 'id', 'full_name'), blank: T.common.all })}
    ${selectField({ label: T.measure.client, name: 'client_id', value: filters.client_id, options: opt(lists.clients, 'id', 'short_name'), blank: T.common.all })}
    ${needsQuantity ? selectField({ label: T.detail.quantity, name: 'quantity', value: filters.quantity || 'mass_gm', options: QUANTITIES.map((q) => [q, T.quantity[q]]) }) : ''}
    ${needsGroup ? selectField({ label: T.an.group_by, name: 'group', value: filters.group, options: GROUPS.map((g) => [g, T.an.groups[g]]), blank: T.an.group_default }) : ''}
    <button class="btn primary" type="submit">${T.common.filter}</button> <a class="btn" href="/analize/${tab}">${T.common.reset}</a>
  </div></form>`;
}

function cell(col, row) {
  const v = row[col.key];
  let inner = col.fmt ? col.fmt(v, row) : (v === null || v === undefined ? '' : (col.type === 'number' ? calc.formatNumber(v, 0, 4) : v));
  if (col.verdict) inner = html`<span class="val v-${row.verdict}">${inner}</span>`;
  if (col.href && v !== null && v !== undefined) inner = html`<a href="${col.href(row)}">${inner}</a>`;
  if (col.cpk && typeof v === 'number') inner = html`<span class="cpk ${v >= col.cpk.good ? 'cpk-good' : v >= col.cpk.min ? 'cpk-warn' : 'cpk-bad'}">${inner}</span>`;
  return html`<td class="${col.type === 'number' ? 'num' : ''}">${inner}</td>`;
}

function dataTable(t) {
  const rows = t.limit ? (t.reverse ? t.rows.slice(-t.limit).reverse() : t.rows.slice(0, t.limit)) : t.rows;
  return html`<h2>${t.title}</h2>
<div class="scroll"><table class="grid analysis"><thead><tr>${t.columns.map((c) => html`<th>${c.header}</th>`)}</tr></thead>
<tbody>${rows.length ? rows.map((r) => html`<tr>${t.columns.map((c) => cell(c, r))}</tr>`) : html`<tr><td colspan="${t.columns.length}" class="empty">${T.an.no_data}</td></tr>`}</tbody></table></div>
${t.limit && t.rows.length > t.limit ? html`<p class="muted">${f(T.an.showing, { n: t.limit, total: t.rows.length })}</p>` : ''}`;
}

function analysisPage(ctx, d) {
  const { tab, f: filters, res, lists } = d;
  const hasTable = res.tables.some((t) => t.rows.length);
  return layout(ctx, {
    title: T.an.title, active: 'analyses', wide: true,
    body: html`<h1>${T.an.title}</h1>
<nav class="tabs" aria-label="${T.an.title}">${TABS.map((t) => html`<a href="/analize/${t}?${qs(filters)}" class="${t === tab ? 'active' : ''}"${t === tab ? raw(' aria-current="page"') : ''}>${T.an.tabs[t]}</a>`)}</nav>
<p class="muted">${T.an.tab_help[tab]}</p>
${filterForm(tab, filters, lists)}
${res.notes.map((n) => html`<p class="notice">${n}</p>`)}
${hasTable ? html`<p class="export">${T.an.export}: <a class="btn small" href="/analize/${tab}?${qs(filters, { format: 'csv' })}">CSV</a>
  <a class="btn small" href="/analize/${tab}?${qs(filters, { format: 'xlsx' })}">Excel (.xlsx)</a></p>` : ''}
${res.charts.map((c) => html`<figure class="card chart-card">${c}</figure>`)}
${res.tables.map(dataTable)}`,
  });
}

module.exports = { analysisPage };
