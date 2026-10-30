'use strict';
const { html, raw } = require('../lib/html');
const { T, f } = require('../i18n');
const { displayDate, displayDateTime } = require('../lib/time');
const { layout, csrf, textField, selectField, textArea } = require('./layout');
const tasks = require('../domain/tasks');
const pm = require('../domain/preventive');
const { prioName } = require('./tasks');

const everyText = (p) => (p.every_n === 1 ? T.pm.every_one[p.unit] : f(T.pm.every, { n: p.every_n, unit: T.pm.unit[p.unit] }));
const stateTag = (st) => {
  if (st.key === 'task') return html`<a class="tag ts-${st.task_status}" href="/sarcini/${st.task_id}">${st.task_no} · ${T.taskstatus[st.task_status]}</a>`;
  return html`<span class="tag pm-${st.key}">${T.pm.state[st.key]}</span>`;
};
const whenText = (p) => {
  if (p.days_to === 0) return T.pm.today;
  return p.days_to > 0 ? f(T.pm.in_days, { n: p.days_to }) : f(T.pm.days_late, { n: -p.days_to });
};
const dueCell = (p) => html`<span class="${p.days_to < 0 && p.active && p.state.key !== 'inactive' ? 'overdue' : ''}">${displayDate(p.next_due)}</span><br><small class="muted">${whenText(p)}</small>`;

function listPage(ctx, d) {
  const { rows, f: fl, can, counts, lists } = d;
  const keep = Object.fromEntries(Object.entries({ view: fl.view, machine: fl.machine, q: fl.q, state: fl.state }).filter(([, v]) => v));
  const tile = (cls, label, n, state) => {
    const on = fl.state === state;
    const q = { ...keep }; if (on) delete q.state; else if (state) q.state = state;
    return html`<a class="tile ${cls}${on ? ' on' : ''}" href="${d.base}?${new URLSearchParams(q)}"><strong>${n}</strong><span>${label}</span></a>`;
  };
  const tabs = ['active', 'stopped', 'all'].map((v) => html`<a class="${fl.view === v ? 'active' : ''}" href="${d.base}?${new URLSearchParams({ ...keep, view: v })}">${T.pm['view_' + v]}</a>`);
  return layout(ctx, {
    title: T.pm.title, active: 'preventive', wide: true,
    body: html`<div class="hero"><h1>${T.pm.title}</h1>${can.manage ? html`<a class="btn primary big" href="${d.base}/nou">${T.pm.new}</a>` : ''}</div>
<nav class="tiles" aria-label="${T.tasks.overview}">${tile('ts-overdue', T.pm.tile_overdue, counts.overdue, 'overdue')}${tile('ts-waiting', T.pm.tile_due, counts.due, 'due')}${tile('ts-open', T.pm.tile_week, counts.week, '')}${tile('ts-done', T.pm.tile_active, counts.active, '')}</nav>
<div class="tabs">${tabs}</div>
<form method="get" action="${d.base}" class="card filters"><input type="hidden" name="view" value="${fl.view}">${fl.state ? html`<input type="hidden" name="state" value="${fl.state}">` : ''}
  <div class="row">${textField({ label: T.common.search, name: 'q', value: fl.q })}${selectField({ label: T.measure.machine, name: 'machine', value: fl.machine, options: lists.machines.map((m) => [m.id, m.name]), blank: T.common.all })}
  <button class="btn primary" type="submit">${T.common.filter}</button><a class="btn" href="${d.base}?view=${fl.view}">${T.common.reset}</a></div></form>
<p class="muted">${f(T.pm.count, { n: rows.length })}</p>
<div class="scroll"><table class="grid"><thead><tr><th>${T.pm.plan}</th><th>${T.pm.where}</th><th>${T.pm.interval}</th><th>${T.pm.next_due}</th><th>${T.pm.last_done}</th><th>${T.tasks.assigned}</th><th>${T.common.status}</th>${can.manage ? html`<th></th>` : ''}</tr></thead>
<tbody>${rows.length ? rows.map((p) => html`<tr class="${p.active ? '' : 'is-cancelled'}"><td><a href="${d.base}/${p.id}"><strong>${p.title}</strong></a>${p.team !== 'maintenance' ? html` <span class="tag team-${p.team}">${T.modules[p.team].name}</span>` : ''}</td>
  <td>${[p.machine_name, p.area].filter(Boolean).join(' · ') || html`<span class="muted">—</span>`}</td><td class="nowrap">${everyText(p)}</td><td class="nowrap">${dueCell(p)}</td>
  <td class="nowrap">${p.last_done ? displayDate(p.last_done) : html`<span class="muted">—</span>`}</td><td>${p.people.length ? p.people.join(', ') : html`<span class="muted">${T.tasks.unassigned}</span>`}</td><td>${stateTag(p.state)}</td>
  ${can.manage ? html`<td class="nowrap">${p.active && p.state.key !== 'task' ? html`<form method="post" action="${d.base}/${p.id}/genereaza" class="inline">${csrf(ctx)}<button class="btn small" type="submit">${T.pm.make_now}</button></form>` : ''}</td>` : ''}</tr>`)
    : html`<tr><td colspan="8" class="empty">${T.pm.empty} ${can.manage ? html`<a href="${d.base}/nou">${T.pm.new}</a>` : ''}</td></tr>`}</tbody></table></div>`,
  });
}

function planForm(ctx, d) {
  const { p, values, errors, lists, base } = d;
  const v = values || p || {};
  const sel = new Set((d.people || (p ? p.people.map((x) => x.id) : [])).map(Number));
  const steps = Array.isArray(v.steps) ? v.steps.map((x) => (typeof x === 'string' ? x : x.text)).join('\n') : (v.steps || '');
  const prio = (x) => [x.id, prioName({ priority_name: x.name, priority_name_en: x.name_en })];
  return layout(ctx, {
    title: p ? T.pm.edit : T.pm.new, active: 'preventive',
    body: html`<p><a href="${p ? `${base}/${p.id}` : base}">« ${T.common.back}</a></p><h1>${p ? T.pm.edit : T.pm.new}</h1>
<form method="post" action="${p ? `${base}/${p.id}/editeaza` : `${base}/nou`}" class="card entry">${csrf(ctx)}
  ${textField({ label: T.pm.plan, name: 'title', value: v.title, errors, required: true, attrs: 'maxlength="200"' })}
  ${textArea({ label: T.tasks.description, name: 'description', value: v.description, errors, rows: 3 })}
  <div class="row">
    ${selectField({ label: T.measure.machine, name: 'machine_id', value: v.machine_id, options: lists.machines.map((m) => [m.id, m.name]), blank: '—', errors })}
    ${textField({ label: T.tasks.area, name: 'area', value: v.area, errors, hint: T.tasks.area_hint, attrs: 'maxlength="120"' })}
    ${selectField({ label: T.pm.team, name: 'team', value: v.team || 'maintenance', options: tasks.TEAMS.map((t) => [t, T.modules[t].name]) })}
  </div>
  <div class="row">
    ${textField({ label: T.pm.every_label, name: 'every_n', value: v.every_n || 1, type: 'number', errors, required: true, attrs: 'min="1" max="999"' })}
    ${selectField({ label: T.pm.unit_label, name: 'unit', value: v.unit || 'weeks', options: pm.UNITS.map((u) => [u, T.pm.unit[u]]) })}
    ${selectField({ label: T.pm.basis, name: 'basis', value: v.basis || 'schedule', options: pm.BASES.map((b) => [b, T.pm.basis_opt[b]]) })}
    ${textField({ label: T.pm.first_due, name: 'next_due', value: v.next_due, type: 'date', errors, required: true, hint: T.pm.first_due_hint })}
    ${textField({ label: T.pm.lead, name: 'lead_days', value: v.lead_days === undefined ? 3 : v.lead_days, type: 'number', errors, attrs: 'min="0" max="365"', hint: T.pm.lead_hint })}
    ${selectField({ label: T.tasks.priority, name: 'priority_id', value: v.priority_id, options: lists.priorities.map(prio), blank: '—', errors })}
  </div>
  ${textArea({ label: T.pm.steps, name: 'steps', value: steps, errors, rows: 5 })}<p class="muted">${T.pm.steps_hint}</p>
  <fieldset class="people-pick"><legend>${T.tasks.assigned}</legend>${lists.people.length ? lists.people.map((x) => html`<label class="check"><input type="checkbox" name="people" value="${x.id}"${sel.has(x.id) ? raw(' checked') : ''}> <span>${x.name} <small class="muted">${T.teams[x.team]}</small></span></label>`) : html`<p class="muted">${T.tasks.no_people}</p>`}</fieldset>
  <div class="actions"><button class="btn primary big" type="submit">${T.common.save}</button><a class="btn" href="${p ? `${base}/${p.id}` : base}">${T.common.cancel}</a></div>
</form>`,
  });
}

function planPage(ctx, d) {
  const { p, can, base, err } = d;
  return layout(ctx, {
    title: p.title, active: 'preventive', wide: true,
    body: html`<p><a href="${base}">« ${T.pm.title}</a></p>
<div class="hero"><h1>${p.title}</h1><div class="actions">${can.manage ? html`<a class="btn" href="${base}/${p.id}/editeaza">${T.common.edit}</a>` : ''}</div></div>
<section class="card"><div class="facts-line">${stateTag(p.state)} ${p.active ? '' : html`<span class="tag ms-cancelled">${T.pm.stopped}</span>`}${p.team !== 'maintenance' ? html` <span class="tag team-${p.team}">${T.modules[p.team].name}</span>` : ''}</div>
  <dl class="facts"><div><dt>${T.pm.interval}</dt><dd>${everyText(p)} · ${T.pm.basis_opt[p.basis]}</dd></div><div><dt>${T.pm.next_due}</dt><dd>${displayDate(p.next_due)} <small class="muted">${whenText(p)}</small></dd></div>
    <div><dt>${T.pm.last_done}</dt><dd>${p.last_done ? displayDate(p.last_done) : '—'}</dd></div><div><dt>${T.pm.lead}</dt><dd>${f(T.pm.lead_value, { n: p.lead_days })}</dd></div>
    <div><dt>${T.pm.where}</dt><dd>${[p.machine_name, p.area].filter(Boolean).join(' · ') || '—'}</dd></div><div><dt>${T.tasks.assigned}</dt><dd>${p.people.length ? p.people.map((x) => x.name).join(', ') : html`<span class="muted">${T.tasks.unassigned}</span>`}</dd></div></dl>
  ${p.description ? html`<p class="task-desc">${p.description}</p>` : ''}</section>
${err ? html`<p class="field-error" role="alert">${err}</p>` : ''}
${can.manage ? html`<section class="card"><h2>${T.pm.actions}</h2><div class="actions">
  ${p.active && p.state.key !== 'task' ? html`<form method="post" action="${base}/${p.id}/genereaza" class="inline">${csrf(ctx)}<button class="btn primary" type="submit">${T.pm.make_now}</button></form>` : ''}
  <form method="post" action="${base}/${p.id}/activ" class="inline">${csrf(ctx)}<input type="hidden" name="active" value="${p.active ? 0 : 1}"><button class="btn" type="submit">${p.active ? T.pm.stop : T.pm.start}</button></form></div>
  ${p.active && p.state.key !== 'task' ? html`<form method="post" action="${base}/${p.id}/sari" class="card-in">${csrf(ctx)}${textField({ label: T.pm.skip_reason, name: 'reason', value: '', attrs: 'maxlength="300"', hint: T.pm.skip_hint })}<button class="btn" type="submit">${T.pm.skip}</button></form>` : ''}</section>` : ''}
<section class="card"><h2>${T.pm.steps} <span class="count">${p.steps.length}</span></h2>${p.steps.length ? html`<ol class="decisions">${p.steps.map((s) => html`<li>${s.text}</li>`)}</ol>` : html`<p class="muted">${T.tasks.check_none}</p>`}</section>
<section class="card"><h2>${T.pm.history}</h2><div class="scroll"><table class="grid"><thead><tr><th>${T.pm.due_date}</th><th>${T.pm.result}</th><th>${T.pm.done_on}</th></tr></thead>
<tbody>${p.runs.length ? p.runs.map((r) => html`<tr><td>${displayDate(r.due_date)}</td><td>${r.outcome === 'skipped' ? html`<span class="tag pm-skipped">${T.pm.skipped}</span> ${r.skip_reason}` : html`<a class="tag ts-${r.task_status}" href="/sarcini/${r.task_id}">${r.task_no} · ${T.taskstatus[r.task_status]}</a>`}</td><td>${r.closed_at ? displayDateTime(r.closed_at) : '—'}</td></tr>`) : html`<tr><td colspan="3" class="empty">${T.pm.no_history}</td></tr>`}</tbody></table></div></section>`,
  });
}

module.exports = { listPage, planForm, planPage, everyText };
