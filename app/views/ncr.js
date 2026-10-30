'use strict';
const { html, raw } = require('../lib/html');
const { T, f } = require('../i18n');
const i18n = require('../i18n');
const { displayDate, displayDateTime } = require('../lib/time');
const { layout, csrf, textField, selectField, textArea } = require('./layout');
const P = require('./print');
const ncr = require('../domain/ncr');
const tasks = require('../domain/tasks');
const { prioName } = require('./tasks');

const en = () => i18n.current() === 'en';
const nm = (name, name_en) => (en() && name_en ? name_en : name) || '';
const statusTag = (s) => html`<span class="tag ns-${s}">${T.ncr.status[s]}</span>`;
const sevChip = (n, ranks) => (n.severity_id ? html`<span class="prio prio-${Math.min(3, ranks.get(n.severity_id) || 0)}">${nm(n.severity_name, n.severity_name_en)}</span>` : '');
const BASE = '/calitate';
const href = (id) => `${BASE}/neconformitati/${id}`;

function listPage(ctx, d) {
  const { rows, f: fl, can, counts, lists, ranks } = d;
  const keep = Object.fromEntries(Object.entries({ view: fl.view, evalo: fl.eval_overdue ? '1' : '', status: fl.status, type: fl.type, severity: fl.severity, machine: fl.machine, q: fl.q, mine: fl.mine ? '1' : '', days: fl.days || '', sort: fl.sort === 'new' ? '' : fl.sort }).filter(([, v]) => v));
  const link = (extra, drop) => { const q = { ...keep, ...extra }; for (const k of drop || []) delete q[k]; return `${BASE}?${new URLSearchParams(q)}`; };
  const tile = (cls, label, n, status) => { const on = fl.status === status; return html`<a class="tile ${cls}${on ? ' on' : ''}" href="${on ? link({}, ['status']) : link({ status, view: 'open' })}"><strong>${n}</strong><span>${label}</span></a>`; };
  const chip = (key, on, label, val) => html`<a class="qchip${on ? ' on' : ''}" href="${on ? link({}, [key]) : link({ [key]: val })}">${label}</a>`;
  return layout(ctx, {
    title: T.ncr.title, active: 'ncr', wide: true,
    body: html`<div class="hero"><h1>${T.ncr.title}</h1><div class="actions"><a class="btn" href="${BASE}/top">${T.ncr.top_title}</a>${can.report ? html`<a class="btn primary big" href="${BASE}/nou">${T.ncr.new}</a>` : ''}</div></div>
<nav class="tiles" aria-label="${T.tasks.overview}">${tile('ts-overdue', T.ncr.status.reported, counts.reported, 'reported')}${tile('ts-waiting', T.ncr.status.evaluation, counts.evaluation, 'evaluation')}${tile('ts-in_progress', T.ncr.status.action, counts.action, 'action')}
  <a class="tile ts-done" href="${link({ view: 'closed', days: '30' }, ['status'])}"><strong>${counts.closed_30}</strong><span>${T.ncr.closed_30}</span></a></nav>
<div class="quick">${counts.eval_overdue ? chip('evalo', fl.eval_overdue, f(T.ncr.eval_overdue_n, { n: counts.eval_overdue }), '1') : ''}${chip('mine', fl.mine, T.ncr.mine, '1')}${chip('days', fl.days === 30, T.ncr.last_30, '30')}</div>
<div class="tabs">${['open', 'closed', 'all'].map((v) => html`<a class="${fl.view === v ? 'active' : ''}" href="${link({ view: v }, ['status'])}">${T.ncr['view_' + v]}</a>`)}</div>
<form method="get" action="${BASE}" class="card filters"><input type="hidden" name="view" value="${fl.view}">${['status', 'mine', 'days', 'evalo'].map((k) => ((k === 'evalo' ? fl.eval_overdue : fl[k]) ? html`<input type="hidden" name="${k}" value="${k === 'mine' ? '1' : fl[k]}">` : ''))}
  <div class="row">${textField({ label: T.common.search, name: 'q', value: fl.q })}
  ${selectField({ label: T.ncr.type, name: 'type', value: fl.type, options: lists.types.map((x) => [x.id, nm(x.name, x.name_en)]), blank: T.common.all })}
  ${selectField({ label: T.ncr.severity, name: 'severity', value: fl.severity, options: lists.priorities.map((x) => [x.id, prioName({ priority_name: x.name, priority_name_en: x.name_en })]), blank: T.common.all })}
  ${selectField({ label: T.measure.machine, name: 'machine', value: fl.machine, options: lists.machines.map((m) => [m.id, m.name]), blank: T.common.all })}
  ${selectField({ label: T.tasks.sort, name: 'sort', value: fl.sort, options: ncr.SORT_KEYS.map((k) => [k, T.ncr['sort_' + k]]) })}
  <button class="btn primary" type="submit">${T.common.filter}</button><a class="btn" href="${BASE}?view=${fl.view}">${T.common.reset}</a></div></form>
<p class="toolbar-line"><span class="muted">${f(T.ncr.count, { n: rows.length })}</span><a class="btn small" href="${BASE}/export?${new URLSearchParams({ ...keep, format: 'csv' })}">${T.tasks.export_csv}</a><a class="btn small" href="${BASE}/export?${new URLSearchParams({ ...keep, format: 'xlsx' })}">${T.tasks.export_xlsx}</a></p>
<div class="scroll"><table class="grid"><thead><tr><th>${T.ncr.no}</th><th>${T.ncr.what}</th><th>${T.ncr.type}</th><th>${T.ncr.severity}</th><th>${T.ncr.where}</th><th>${T.common.status}</th><th>${T.ncr.reported}</th><th>${T.ncr.tasks}</th></tr></thead>
<tbody>${rows.length ? rows.map((n) => html`<tr><td class="nowrap"><a href="${href(n.id)}">${n.no}</a></td><td class="task-title"><a href="${href(n.id)}"><strong>${n.title}</strong></a>${n.external_ref ? html` <span class="mini" title="${T.ncr.external_ref}">${n.external_ref}</span>` : ''}${n.similar_n ? html` <span class="tag ns-recurring" title="${T.ncr.similar_hint}">↻ ${n.similar_n}</span>` : ''}${n.eval_overdue ? html` <span class="tag ns-overdue">${T.ncr.eval_overdue}</span>` : ''}</td>
  <td>${n.type_name ? nm(n.type_name, n.type_name_en) : html`<span class="muted">—</span>`}</td><td>${sevChip(n, ranks)}</td><td>${[n.machine_name, n.product].filter(Boolean).join(' · ') || html`<span class="muted">—</span>`}</td><td>${statusTag(n.status)}</td>
  <td class="nowrap">${displayDate(n.reported_at)}<br><small class="muted">${f(T.ncr.age_days, { n: n.age_days })}</small></td>
  <td class="nowrap">${n.tasks_total ? html`<span class="mini${n.tasks_open ? '' : ' ok'}">☑ ${n.tasks_total - n.tasks_open}/${n.tasks_total}</span>` : html`<span class="muted">—</span>`}</td></tr>`)
    : html`<tr><td colspan="8" class="empty">${T.ncr.empty} ${can.report ? html`<a href="${BASE}/nou">${T.ncr.new}</a>` : ''}</td></tr>`}</tbody></table></div>`,
  });
}

function ncrForm(ctx, d) {
  const { n, values, errors, lists } = d;
  const v = values || n || {};
  const prio = (x) => [x.id, prioName({ priority_name: x.name, priority_name_en: x.name_en })];
  return layout(ctx, {
    title: n ? f(T.ncr.edit_title, { no: n.no }) : T.ncr.new, active: 'ncr',
    body: html`<p><a href="${n ? href(n.id) : BASE}">« ${T.common.back}</a></p><h1>${n ? f(T.ncr.edit_title, { no: n.no }) : T.ncr.new}</h1>
<form method="post" action="${n ? `${href(n.id)}/editeaza` : `${BASE}/nou`}" class="card entry">${csrf(ctx)}<input type="hidden" name="part" value="main">
  ${d.fromRecord ? html`<input type="hidden" name="source_kind" value="measurement"><input type="hidden" name="record_no" value="${d.fromRecord}"><p class="muted">${f(T.ncr.from_measurement, { no: d.fromRecord })}</p>` : (v.source_kind === 'measurement' && v.record_no ? html`<input type="hidden" name="source_kind" value="measurement"><input type="hidden" name="record_no" value="${v.record_no}">` : '')}
  ${textField({ label: T.ncr.what, name: 'title', value: v.title, errors, required: true, attrs: 'maxlength="200"', autofocus: true })}
  ${textArea({ label: T.tasks.description, name: 'description', value: v.description, errors, rows: 4 })}
  <div class="row">
    ${selectField({ label: T.ncr.type, name: 'type_id', value: v.type_id, options: lists.types.map((x) => [x.id, nm(x.name, x.name_en)]), blank: '—', errors })}
    ${selectField({ label: T.ncr.severity, name: 'severity_id', value: v.severity_id, options: lists.priorities.map(prio), blank: '—', errors })}
    ${selectField({ label: T.measure.machine, name: 'machine_id', value: v.machine_id, options: lists.machines.map((m) => [m.id, m.name]), blank: '—', errors })}
    ${textField({ label: T.ncr.product, name: 'product', value: v.product, errors, attrs: 'maxlength="120"' })}
    ${textField({ label: T.ncr.quantity, name: 'quantity', value: v.quantity, errors, attrs: 'maxlength="80"', hint: T.ncr.quantity_hint })}
    ${textField({ label: T.ncr.found_on, name: 'reported_at', value: v.reported_at || d.today, type: 'date', errors })}
  </div>
  ${n ? html`<div class="row">${textField({ label: T.ncr.external_ref, name: 'external_ref', value: v.external_ref, errors, attrs: 'maxlength="60"', hint: T.ncr.external_ref_hint })}</div>` : ''}
  <div class="actions"><button class="btn primary big" type="submit">${T.common.save}</button><a class="btn" href="${n ? href(n.id) : BASE}">${T.common.cancel}</a></div>
</form>`,
  });
}

function historyLine(e) {
  if (e.kind === 'created') return T.ncr.ev_created;
  if (e.kind === 'status') return f(T.ncr.ev_status, { from: T.ncr.status[e.from_status] || '', to: T.ncr.status[e.to_status] || '' }) + (e.details && e.details.auto ? ` ${T.ncr.ev_auto}` : '');
  if (e.kind === 'task') return f(T.ncr.ev_task, { no: (e.details && e.details.no) || '', team: e.details && T.modules[e.details.team] ? T.modules[e.details.team].name : '' });
  if (e.kind === 'edit' && e.details && e.details.verified) return e.details.verified.to ? T.ncr.ev_verified : T.ncr.ev_unverified;
  if (e.kind === 'edit') return f(T.ncr.ev_edit, { fields: e.details ? Object.keys(e.details).map((k) => T.ncr.field[k] || k).join(', ') : '' });
  return T.ncr.ev_comment;
}

function ncrPage(ctx, d) {
  const { n, can, lists, ranks, err } = d;
  const finished = ncr.FINISHED.includes(n.status);
  const next = finished ? [['evaluation', T.ncr.reopen]] : ['evaluation', 'action', 'closed', 'cancelled'].filter((s) => s !== n.status).map((s) => [s, T.ncr.act[s]]);
  const prio = (x) => [x.id, prioName({ priority_name: x.name, priority_name_en: x.name_en })];
  const source = n.source_kind === 'measurement' && n.record_no ? html`<a href="/masuratori/${n.record_no}">${f(T.ncr.measurement_n, { no: n.record_no })}</a>` : n.source_kind === 'batch' && n.batch_id ? html`<a href="/loturi/${n.batch_id}">${n.batch_no}</a>` : T.ncr.source[n.source_kind];
  return layout(ctx, {
    title: `${n.no} — ${n.title}`, active: 'ncr', wide: true,
    body: html`<p><a href="${BASE}">« ${T.ncr.title}</a></p>
<div class="hero"><h1>${n.no} <span class="muted">${n.title}</span></h1><div class="actions">${can.lead ? html`<a class="btn" href="${href(n.id)}/editeaza">${T.common.edit}</a>` : ''}<a class="btn" href="${href(n.id)}/tipar">${T.ncr.print}</a></div></div>
<section class="card"><div class="facts-line">${statusTag(n.status)} ${sevChip(n, ranks)}${n.eval_overdue ? html` <span class="tag ns-overdue">${T.ncr.eval_overdue}</span>` : ''}${n.similar.length ? html` <a class="tag ns-recurring" href="#similar">↻ ${f(T.ncr.recurring, { n: n.similar.length })}</a>` : ''}${n.action_overdue ? html` <span class="tag ns-overdue">${T.ncr.action_overdue}</span>` : ''} ${n.external_ref ? html`<span class="mini">${T.ncr.external_ref}: ${n.external_ref}</span>` : ''}</div>
  <dl class="facts"><div><dt>${T.ncr.type}</dt><dd>${n.type_name ? nm(n.type_name, n.type_name_en) : '—'}</dd></div><div><dt>${T.measure.machine}</dt><dd>${n.machine_name || '—'}</dd></div><div><dt>${T.ncr.product}</dt><dd>${n.product || '—'}</dd></div>
    <div><dt>${T.ncr.quantity}</dt><dd>${n.quantity || '—'}</dd></div><div><dt>${T.ncr.reported}</dt><dd>${displayDate(n.reported_at)} · ${n.reported_by_name} <small class="muted">${f(T.ncr.age_days, { n: n.age_days })}</small></dd></div><div><dt>${T.tasks.source_label}</dt><dd>${source}</dd></div>
    ${n.closed_at ? html`<div><dt>${T.tasks.closed}</dt><dd>${displayDateTime(n.closed_at)} · ${n.closed_by_name || ''}</dd></div>` : ''}</dl>
  ${n.description ? html`<p class="task-desc">${n.description}</p>` : ''}</section>
${err ? html`<p class="field-error" role="alert">${err}</p>` : ''}
${can.lead ? html`<section class="card"><h2>${T.tasks.change_status}</h2><form method="post" action="${href(n.id)}/stare" class="status-form">${csrf(ctx)}
  ${textField({ label: T.ncr.comment_hint, name: 'comment', value: '', hint: T.tasks.reason_hint, attrs: 'maxlength="2000"' })}
  <div class="actions">${next.map(([s, label]) => html`<button class="btn${s === 'closed' ? ' primary' : ''}" type="submit" name="to" value="${s}">${label}</button>`)}</div></form><p class="muted">${T.ncr.close_hint}</p></section>` : ''}
<div class="home-grid"><div>
<section class="card"><h2>${T.ncr.evaluation}</h2>
  ${can.lead ? html`<form method="post" action="${href(n.id)}/editeaza" class="card-in">${csrf(ctx)}<input type="hidden" name="part" value="eval">
    ${textArea({ label: T.ncr.containment, name: 'containment', value: n.containment, rows: 2 })}<p class="muted">${T.ncr.containment_hint}</p>
    ${textArea({ label: T.ncr.cause, name: 'cause', value: n.cause, rows: 3 })}${textArea({ label: T.ncr.evaluation_text, name: 'evaluation', value: n.evaluation, rows: 3 })}
    <div class="row">${selectField({ label: T.ncr.disposition, name: 'disposition_id', value: n.disposition_id, options: lists.dispositions.map((x) => [x.id, nm(x.name, x.name_en)]), blank: '—' })}</div>
    ${textArea({ label: T.ncr.corrective, name: 'corrective_action', value: n.corrective_action, rows: 3 })}${textArea({ label: T.ncr.preventive, name: 'preventive_action', value: n.preventive_action, rows: 2 })}
    <div class="row">${selectField({ label: T.ncr.responsible, name: 'responsible_person_id', value: n.responsible_person_id, options: lists.people.map((x) => [x.id, x.name]), blank: '—' })}${textField({ label: T.ncr.action_due, name: 'action_due', value: n.action_due, type: 'date' })}</div>
    <button class="btn primary" type="submit">${T.ncr.save_evaluation}</button></form>`
    : html`<dl class="facts"><div><dt>${T.ncr.containment}</dt><dd>${n.containment || '—'}</dd></div><div><dt>${T.ncr.cause}</dt><dd>${n.cause || '—'}</dd></div><div><dt>${T.ncr.evaluation_text}</dt><dd>${n.evaluation || '—'}</dd></div><div><dt>${T.ncr.disposition}</dt><dd>${n.disposition_name ? nm(n.disposition_name, n.disposition_name_en) : '—'}</dd></div>
      <div><dt>${T.ncr.corrective}</dt><dd>${n.corrective_action || '—'}</dd></div><div><dt>${T.ncr.preventive}</dt><dd>${n.preventive_action || '—'}</dd></div><div><dt>${T.ncr.responsible}</dt><dd>${n.responsible_name || '—'}</dd></div><div><dt>${T.ncr.action_due}</dt><dd>${n.action_due ? displayDate(n.action_due) : '—'}</dd></div></dl>`}</section>
<section class="card" id="verify"><h2>${T.ncr.verification}</h2>
  ${n.verified_at ? html`<p><span class="tag ns-closed">✓ ${T.ncr.verified}</span> ${displayDate(n.verified_at)} · ${n.verified_by_name || ''}</p>${n.verification_note ? html`<p class="task-desc">${n.verification_note}</p>` : ''}` : html`<p class="muted">${T.ncr.not_verified}</p>`}
  ${can.lead && n.status !== 'cancelled' ? html`<form method="post" action="${href(n.id)}/verifica" class="card-in">${csrf(ctx)}
    ${n.verified_at ? html`<input type="hidden" name="undo" value="1"><button class="btn" type="submit">${T.ncr.unverify}</button>` : html`${textField({ label: T.ncr.verification_note, name: 'note', value: '', attrs: 'maxlength="2000"', hint: T.ncr.verification_hint })}<button class="btn" type="submit">${T.ncr.verify}</button>`}</form>` : ''}</section>
${n.similar.length ? html`<section class="card" id="similar"><h2>${T.ncr.similar} <span class="count">${n.similar.length}</span></h2><p class="muted">${T.ncr.similar_hint}</p><ul class="panel-list">${n.similar.map((o) => html`<li><a href="${href(o.id)}">${o.no} ${o.title}</a><span>${statusTag(o.status)} <small class="muted">${displayDate(o.reported_at)}</small></span></li>`)}</ul></section>` : ''}
<section class="card" id="tasks"><h2>${T.ncr.tasks} <span class="count">${n.tasks.length}</span></h2>
  ${n.tasks.length ? html`<ul class="panel-list">${n.tasks.map((t) => html`<li><a href="/sarcini/${t.id}">${t.no} ${t.title}</a><span><span class="tag team-${t.team}">${T.modules[t.team].name}</span> <span class="tag ts-${t.status}">${T.taskstatus[t.status]}</span>${t.assignees.length ? html` <small class="muted">${t.assignees.join(', ')}</small>` : ''}${t.due_date ? html` <small class="muted">${displayDate(t.due_date)}</small>` : ''}</span></li>`)}</ul>` : html`<p class="muted">${T.ncr.no_tasks}</p>`}
  ${can.lead && !finished ? html`<form method="post" action="${href(n.id)}/sarcina" class="card-in">${csrf(ctx)}
    ${textField({ label: T.ncr.task_title, name: 'title', value: '', required: true, attrs: 'maxlength="200"' })}
    <div class="row">${selectField({ label: T.ncr.task_team, name: 'team', value: 'maintenance', options: tasks.TEAMS.filter((t) => ctx.modules[t]).map((t) => [t, T.modules[t].name]) })}
      ${selectField({ label: T.tasks.priority, name: 'priority_id', value: n.severity_id, options: lists.priorities.map(prio), blank: '—' })}${textField({ label: T.tasks.due, name: 'due_date', value: '', type: 'date' })}</div>
    <fieldset class="people-pick"><legend>${T.tasks.assigned}</legend>${lists.people.length ? lists.people.map((x) => html`<label class="check"><input type="checkbox" name="assignees" value="${x.id}"> <span>${x.name} <small class="muted">${T.teams[x.team]}</small></span></label>`) : html`<p class="muted">${T.tasks.no_people}</p>`}</fieldset>
    <button class="btn primary" type="submit">${T.ncr.add_task}</button></form>` : ''}</section></div>
<aside>${can.report ? html`<section class="card"><h2>${T.tasks.add_comment}</h2><form method="post" action="${href(n.id)}/comentariu">${csrf(ctx)}${textArea({ label: T.tasks.comment, name: 'text', value: '', rows: 3, required: true })}<button class="btn primary" type="submit">${T.tasks.send}</button></form></section>` : ''}
<section class="card"><h2>${T.tasks.history}</h2><ol class="timeline">${n.events.slice().reverse().map((e) => html`<li class="ev-${e.kind}"><div class="ev-head"><strong>${e.user_name || T.tasks.system}</strong> <span class="muted">${displayDateTime(e.at)}</span></div><div>${historyLine(e)}</div>${e.text ? html`<div class="ev-text">${e.text}</div>` : ''}</li>`)}</ol></section></aside></div>`,
  });
}

function topPage(ctx, d) {
  const { data, days, by } = d;
  const max = Math.max(1, ...data.rows.map((r) => r.cnt));
  const label = (r) => (by === 'product' ? (r.name || T.ncr.no_product) : by === 'machine' ? (r.name || T.ncr.no_machine) : (r.name ? nm(r.name, r.name_en) : T.ncr.no_type));
  const filter = (r) => (by === 'machine' ? `machine=${r.ref || ''}` : by === 'type' ? `type=${r.ref || ''}` : `q=${encodeURIComponent(r.ref || '')}`);
  const pill = (key, val, cur, text) => html`<a class="${cur === val ? 'active' : ''}" href="${BASE}/top?${new URLSearchParams({ days: key === 'days' ? val : days, by: key === 'by' ? val : by })}">${text}</a>`;
  return layout(ctx, {
    title: T.ncr.top_title, active: 'top', wide: true,
    body: html`<p><a href="${BASE}">« ${T.ncr.title}</a></p><div class="hero"><h1>${T.ncr.top_title}</h1><button class="btn" type="button" data-print>${T.ncr.print_page}</button></div>
<p class="muted">${T.ncr.top_hint}</p>
<div class="tabs">${[30, 90, 365].map((n) => pill('days', String(n), String(days), f(T.ncr.top_days, { n })))}</div> <div class="tabs">${['type', 'machine', 'product'].map((b) => pill('by', b, by, T.ncr['by_' + b]))}</div>
<section class="card"><p class="eyebrow">${f(T.ncr.top_total, { n: data.total, since: displayDate(data.since) })}</p>
<div class="scroll"><table class="grid"><thead><tr><th>#</th><th>${T.ncr['by_' + by]}</th><th></th><th>${T.ncr.count_col}</th><th>${T.ncr.share}</th><th>${T.ncr.still_open}</th><th>${T.ncr.last_reported}</th></tr></thead>
<tbody>${data.rows.length ? data.rows.map((r, i) => html`<tr><td>${i + 1}</td><td><a href="${BASE}?view=all&amp;days=${days}&amp;${raw(filter(r))}"><strong>${label(r)}</strong></a></td><td class="barcell"><progress max="${max}" value="${r.cnt}"></progress></td><td><strong>${r.cnt}</strong></td><td>${r.share}%</td><td>${r.open_n ? html`<span class="mini">${r.open_n}</span>` : html`<span class="muted">0</span>`}</td><td class="nowrap">${displayDate(r.last_at)}</td></tr>`) : html`<tr><td colspan="7" class="empty">${T.ncr.top_empty}</td></tr>`}</tbody></table></div></section>`,
  });
}

function printPage(ctx, d) {
  const { n, company, by, now } = d;
  const footer = html`<div class="doc-foot"><div>${f(T.print.printed_by, { user: by, when: displayDateTime(now) })}</div><div><span class="k">${T.print.signature}:</span> <span class="sigline"></span></div></div>`;
  const content = html`<table class="sheet kv"><tbody>
    <tr><th>${T.ncr.no}</th><td>${n.no}</td><th>${T.common.status}</th><td>${T.ncr.status[n.status]}</td></tr>
    <tr><th>${T.ncr.what}</th><td colspan="3"><strong>${n.title}</strong></td></tr>
    <tr><th>${T.ncr.type}</th><td>${n.type_name ? nm(n.type_name, n.type_name_en) : ''}</td><th>${T.ncr.severity}</th><td>${nm(n.severity_name, n.severity_name_en)}</td></tr>
    <tr><th>${T.measure.machine}</th><td>${n.machine_name || ''}</td><th>${T.ncr.product}</th><td>${n.product || ''}</td></tr>
    <tr><th>${T.ncr.quantity}</th><td>${n.quantity || ''}</td><th>${T.ncr.reported}</th><td>${displayDate(n.reported_at)} · ${n.reported_by_name}</td></tr>
    ${n.description ? html`<tr><th>${T.tasks.description}</th><td colspan="3">${n.description}</td></tr>` : ''}</tbody></table>
  <h3>${T.ncr.evaluation}</h3><table class="sheet kv"><tbody><tr><th>${T.ncr.containment}</th><td>${n.containment || ''}</td></tr><tr><th>${T.ncr.cause}</th><td>${n.cause || ''}</td></tr><tr><th>${T.ncr.evaluation_text}</th><td>${n.evaluation || ''}</td></tr><tr><th>${T.ncr.disposition}</th><td>${n.disposition_name ? nm(n.disposition_name, n.disposition_name_en) : ''}</td></tr><tr><th>${T.ncr.corrective}</th><td>${n.corrective_action || ''}</td></tr><tr><th>${T.ncr.preventive}</th><td>${n.preventive_action || ''}</td></tr><tr><th>${T.ncr.responsible}</th><td>${n.responsible_name || ''} ${n.action_due ? `· ${displayDate(n.action_due)}` : ''}</td></tr><tr><th>${T.ncr.verification}</th><td>${n.verified_at ? `${displayDate(n.verified_at)} · ${n.verified_by_name || ''} ${n.verification_note || ''}` : ''}</td></tr></tbody></table>
  <h3>${T.ncr.tasks}</h3><table class="sheet"><thead><tr><th>${T.tasks.no}</th><th>${T.tasks.task}</th><th>${T.ncr.task_team}</th><th>${T.tasks.assigned}</th><th>${T.tasks.due}</th><th>${T.common.status}</th></tr></thead>
  <tbody>${n.tasks.length ? n.tasks.map((t) => html`<tr><td class="nowrap">${t.no}</td><td>${t.title}</td><td>${T.modules[t.team].name}</td><td>${t.assignees.join(', ')}</td><td class="nowrap">${t.due_date ? displayDate(t.due_date) : ''}</td><td>${T.taskstatus[t.status]}</td></tr>`) : html`<tr><td colspan="6" class="blank">&nbsp;</td></tr>`}</tbody></table>`;
  return P.page({
    title: `${T.ncr.print_title} ${n.no}`,
    toolbar: P.toolbar(ctx, { backHref: href(n.id), action: `${href(n.id)}/tipar`, hidden: {} }),
    body: P.frame({ company, title: `${T.ncr.print_title} — ${n.no}`, noMeta: true, footer, content }),
  });
}

module.exports = { listPage, ncrForm, ncrPage, topPage, printPage };
