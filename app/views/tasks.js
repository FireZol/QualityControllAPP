'use strict';
// Task board, task page, task form and the printable work list (Maintenance, Technical, Quality).
const { html, raw } = require('../lib/html');
const { T, f } = require('../i18n');
const i18n = require('../i18n');
const { displayDate, displayDateTime } = require('../lib/time');
const { layout, csrf, textField, selectField, textArea } = require('./layout');
const P = require('./print');
const tasks = require('../domain/tasks');

const prioName = (t) => (i18n.current() === 'en' && t.priority_name_en ? t.priority_name_en : t.priority_name) || '';
const prioChip = (t, ranks) => (t.priority_id ? html`<span class="prio prio-${Math.min(3, ranks.get(t.priority_id) || 0)}">${prioName(t)}</span>` : '');
const statusChip = (s) => html`<span class="tag ts-${s}">${T.taskstatus[s]}</span>`;
const dueCell = (t) => (t.due_date ? html`<span class="${t.overdue ? 'overdue' : ''}">${displayDate(t.due_date)}${t.overdue ? html` <small>${T.tasks.overdue}</small>` : ''}</span>` : html`<span class="muted">—</span>`);
const where = (t) => [t.machine_name, t.area].filter(Boolean).join(' · ');

/** The next sensible step for a quick button on the board. */
const NEXT = { open: 'in_progress', in_progress: 'done', waiting: 'in_progress', done: 'closed' };

function tabs(d) {
  const mk = (view, label, n) => html`<a class="${d.f.view === view ? 'active' : ''}" href="${d.base}?${new URLSearchParams({ ...d.keep, view })}">${label}${n === undefined ? '' : html` <span class="count">${n}</span>`}</a>`;
  return html`<div class="tabs">${mk('active', T.tasks.view_active, d.counts.active)}${mk('closed', T.tasks.view_closed, d.counts.finished)}${mk('all', T.tasks.view_all)}</div>`;
}

function boardPage(ctx, d) {
  const { team, rows, f: fl, lists, ranks, can } = d;
  const back = `${d.base}?${new URLSearchParams(d.keep).toString()}`;
  return layout(ctx, {
    title: `${T.modules[team].name} — ${T.tasks.title}`, active: 'tasks', wide: true,
    body: html`<div class="hero"><h1>${T.modules[team].name}: ${T.tasks.title}</h1>
  ${can.create ? html`<a class="btn primary big" href="${d.newPath}">${T.tasks.new}</a>` : ''}</div>
${d.counts.overdue ? html`<p class="notice">${f(T.tasks.overdue_n, { n: d.counts.overdue })} <a href="${d.base}?overdue=1">${T.tasks.show}</a></p>` : ''}
${tabs(d)}
<form method="get" action="${d.base}" class="card filters">
  <input type="hidden" name="view" value="${fl.view}">
  <div class="row">
    ${textField({ label: T.common.search, name: 'q', value: fl.q })}
    ${selectField({ label: T.tasks.person, name: 'person', value: fl.person, options: lists.people.map((p) => [p.id, p.name]), blank: T.common.all })}
    ${selectField({ label: T.tasks.priority, name: 'priority', value: fl.priority, options: lists.priorities.map((p) => [p.id, prioName({ priority_name: p.name, priority_name_en: p.name_en })]), blank: T.common.all })}
    ${selectField({ label: T.measure.machine, name: 'machine', value: fl.machine, options: lists.machines.map((m) => [m.id, m.name]), blank: T.common.all })}
    <label class="check"><input type="checkbox" name="overdue" value="1"${fl.overdue ? raw(' checked') : ''}> <span>${T.tasks.only_overdue}</span></label>
    <button class="btn primary" type="submit">${T.common.filter}</button><a class="btn" href="${d.base}?view=${fl.view}">${T.common.reset}</a>
  </div>
</form>
<p class="muted">${f(T.tasks.count, { n: rows.length })} <a class="btn small" href="/sarcini/tipar?${new URLSearchParams({ ...d.keep, team })}">${T.tasks.print_list}</a></p>
<div class="scroll"><table class="grid tasks"><thead><tr><th>${T.tasks.no}</th><th>${T.tasks.task}</th><th>${T.tasks.priority}</th><th>${T.common.status}</th><th>${T.tasks.assigned}</th><th>${T.tasks.where}</th><th>${T.tasks.due}</th>${can.update ? html`<th></th>` : ''}</tr></thead>
<tbody>${rows.length ? rows.map((t) => html`<tr class="${t.overdue ? 'is-overdue' : ''}">
  <td class="nowrap"><a href="/sarcini/${t.id}">${t.no}</a></td>
  <td class="task-title"><a href="/sarcini/${t.id}"><strong>${t.title}</strong></a>${t.source_kind && t.source_kind !== 'manual' ? html` <span class="tag">${T.tasks.source[t.source_kind] || t.source_kind}</span>` : ''}</td>
  <td>${prioChip(t, ranks)}</td><td>${statusChip(t.status)}</td>
  <td>${t.assignees.length ? t.assignees.map((a) => a.name).join(', ') : html`<span class="muted">${T.tasks.unassigned}</span>`}</td>
  <td>${where(t)}</td><td class="nowrap">${dueCell(t)}</td>
  ${can.update ? html`<td class="nowrap">${NEXT[t.status] ? html`<form method="post" action="/sarcini/${t.id}/stare" class="inline">${csrf(ctx)}<input type="hidden" name="to" value="${NEXT[t.status]}"><input type="hidden" name="back" value="${back}"><button class="btn small primary" type="submit">${T.taskact[t.status === 'waiting' ? 'resume' : NEXT[t.status]]}</button></form>` : ''}</td>` : ''}
</tr>`) : html`<tr><td colspan="8" class="empty">${T.tasks.empty} ${can.create ? html`<a href="${d.newPath}">${T.tasks.new}</a>` : ''}</td></tr>`}</tbody></table></div>`,
  });
}

function peopleChecks(people, selected, team) {
  const sel = new Set((selected || []).map(Number));
  const sorted = people.slice().sort((a, b) => (b.team === team) - (a.team === team) || a.name.localeCompare(b.name));
  return html`<fieldset class="people-pick"><legend>${T.tasks.assigned}</legend>${sorted.length ? sorted.map((p) => html`<label class="check"><input type="checkbox" name="assignees" value="${p.id}"${sel.has(p.id) ? raw(' checked') : ''}> <span>${p.name} <small class="muted">${T.teams[p.team]}</small></span></label>`) : html`<p class="muted">${T.tasks.no_people}</p>`}</fieldset>`;
}

function taskForm(ctx, d) {
  const { team, task, values, errors, lists, base, canAssign } = d;
  const v = values || task || {};
  const prio = (p) => [p.id, prioName({ priority_name: p.name, priority_name_en: p.name_en })];
  return layout(ctx, {
    title: task ? f(T.tasks.edit_title, { no: task.no }) : T.tasks.new, active: 'tasks',
    body: html`<p><a href="${task ? `/sarcini/${task.id}` : base}">« ${T.common.back}</a></p>
<h1>${task ? f(T.tasks.edit_title, { no: task.no }) : `${T.modules[team].name}: ${T.tasks.new}`}</h1>
<form method="post" action="${task ? `/sarcini/${task.id}/editeaza` : `${base}/nou`}" class="card entry">${csrf(ctx)}
  ${textField({ label: T.tasks.task, name: 'title', value: v.title, errors, required: true, attrs: 'maxlength="200"' })}
  ${textArea({ label: T.tasks.description, name: 'description', value: v.description, errors, rows: 4 })}
  <div class="row">
    ${selectField({ label: T.tasks.priority, name: 'priority_id', value: v.priority_id, options: lists.priorities.map(prio), errors })}
    ${textField({ label: T.tasks.due, name: 'due_date', value: v.due_date, type: 'date', errors })}
    ${selectField({ label: T.measure.machine, name: 'machine_id', value: v.machine_id, options: lists.machines.map((m) => [m.id, m.name]), blank: '—', errors })}
    ${textField({ label: T.tasks.area, name: 'area', value: v.area, errors, hint: T.tasks.area_hint, attrs: 'maxlength="120"' })}
  </div>
  ${canAssign ? peopleChecks(lists.people, d.assignees || (task ? task.assignees.map((a) => a.id) : []), team) : ''}
  <div class="actions"><button class="btn primary big" type="submit">${T.common.save}</button><a class="btn" href="${task ? `/sarcini/${task.id}` : base}">${T.common.cancel}</a></div>
</form>`,
  });
}

function historyLine(e) {
  if (e.kind === 'created') return T.tasks.ev_created;
  if (e.kind === 'status') return f(T.tasks.ev_status, { from: T.taskstatus[e.from_status] || '', to: T.taskstatus[e.to_status] || '' });
  if (e.kind === 'assign') return f(T.tasks.ev_assign, { added: (e.details && e.details.names_added) || '', removed: (e.details && e.details.names_removed) || '' });
  if (e.kind === 'edit') return f(T.tasks.ev_edit, { fields: e.details ? Object.keys(e.details).map((k) => T.tasks.field[k] || k).join(', ') : '' });
  return T.tasks.ev_comment;
}

function taskPage(ctx, d) {
  const { t, can, ranks, base, nameOf, lists } = d;
  const buttons = tasks.STATUSES.filter((s) => s !== t.status);
  return layout(ctx, {
    title: `${t.no} — ${t.title}`, active: 'tasks', wide: true,
    body: html`<p><a href="${base}">« ${T.modules[t.team].name}: ${T.tasks.title}</a></p>
<div class="hero"><h1>${t.no} <span class="muted">${t.title}</span></h1>${can.update ? html`<a class="btn" href="/sarcini/${t.id}/editeaza">${T.common.edit}</a>` : ''}</div>
<section class="card"><div class="facts-line">${statusChip(t.status)} ${prioChip(t, ranks)} ${t.overdue ? html`<span class="tag ts-overdue">${T.tasks.overdue}</span>` : ''}</div>
  <dl class="facts">
    <div><dt>${T.tasks.assigned}</dt><dd>${t.assignees.length ? t.assignees.map((a) => a.name).join(', ') : html`<span class="muted">${T.tasks.unassigned}</span>`}</dd></div>
    <div><dt>${T.tasks.due}</dt><dd>${dueCell(t)}</dd></div>
    <div><dt>${T.tasks.where}</dt><dd>${where(t) || '—'}</dd></div>
    <div><dt>${T.tasks.created}</dt><dd>${t.created_by_name} <span class="muted">${displayDateTime(t.created_at)}</span></dd></div>
    ${t.closed_at ? html`<div><dt>${T.tasks.closed}</dt><dd>${t.closed_by_name || ''} <span class="muted">${displayDateTime(t.closed_at)}</span></dd></div>` : ''}
    ${t.source_kind && t.source_kind !== 'manual' ? html`<div><dt>${T.tasks.source_label}</dt><dd>${T.tasks.source[t.source_kind] || t.source_kind}${d.sourceLink ? html` — <a href="${d.sourceLink.href}">${d.sourceLink.text}</a>` : ''}</dd></div>` : ''}
  </dl>
  ${t.description ? html`<p class="task-desc">${t.description}</p>` : ''}</section>
${can.update ? html`<section class="card"><h2>${T.tasks.change_status}</h2>
  <form method="post" action="/sarcini/${t.id}/stare" class="status-form">${csrf(ctx)}
    ${textField({ label: T.tasks.comment_optional, name: 'comment', value: '', hint: T.tasks.reason_hint, attrs: 'maxlength="2000"' })}
    <div class="actions">${buttons.map((s) => html`<button class="btn${s === 'closed' ? ' primary' : ''}" type="submit" name="to" value="${s}">${T.taskact[s]}</button>`)}</div></form>
  ${d.err ? html`<p class="field-error" role="alert">${d.err}</p>` : ''}
  <form method="post" action="/sarcini/${t.id}/atribuie" class="card-in">${csrf(ctx)}${peopleChecks(lists.people, t.assignees.map((a) => a.id), t.team)}<button class="btn" type="submit">${T.tasks.save_assignees}</button></form></section>` : ''}
${can.comment ? html`<section class="card"><h2>${T.tasks.add_comment}</h2><form method="post" action="/sarcini/${t.id}/comentariu">${csrf(ctx)}
  ${textArea({ label: T.tasks.comment, name: 'text', value: '', rows: 3, required: true })}<button class="btn primary" type="submit">${T.tasks.send}</button></form></section>` : ''}
<section class="card"><h2>${T.tasks.history}</h2>
  <ol class="timeline">${t.events.slice().reverse().map((e) => html`<li class="ev-${e.kind}"><div class="ev-head"><strong>${e.user_name || T.tasks.system}</strong> <span class="muted">${displayDateTime(e.at)}</span></div><div>${historyLine(e)}</div>${e.text ? html`<div class="ev-text">${e.text}</div>` : ''}</li>`)}</ol></section>`,
  });
}

function printPage(ctx, d) {
  const { team, rows, company, by, now, filters, group, groups } = d;
  const table = (list) => html`<table class="sheet tasks-print"><thead><tr><th>${T.tasks.no}</th><th>${T.tasks.task}</th><th>${T.tasks.where}</th><th>${T.tasks.priority}</th><th>${T.tasks.due}</th>${group ? '' : html`<th>${T.tasks.assigned}</th>`}<th>${T.tasks.done_col}</th><th>${T.common.notes}</th></tr></thead>
    <tbody>${list.map((t) => html`<tr><td class="nowrap">${t.no}</td><td><strong>${t.title}</strong>${t.description ? html`<div class="small">${t.description}</div>` : ''}</td><td>${where(t)}</td><td>${prioName(t)}</td><td class="nowrap">${t.due_date ? displayDate(t.due_date) : ''}</td>${group ? '' : html`<td>${t.assignees.map((a) => a.name).join(', ')}</td>`}<td class="box">☐</td><td class="blank"></td></tr>`)}</tbody></table>`;
  const content = html`<p class="small">${filters.length ? filters.join(' · ') : T.print.no_filters} — ${f(T.tasks.count, { n: rows.length })}</p>
    ${group ? groups.map((g) => html`<h3 class="group-head">${g.name}</h3>${table(g.rows)}`) : table(rows)}`;
  const footer = html`<div class="doc-foot"><div>${f(T.print.printed_by, { user: by, when: displayDateTime(now) })}</div><div><span class="k">${T.print.signature}:</span> <span class="sigline"></span></div></div>`;
  return P.page({
    title: `${T.tasks.work_list} — ${T.modules[team].name}`, landscape: true,
    toolbar: P.toolbar(ctx, { backHref: d.backHref, action: '/sarcini/tipar', hidden: d.hidden }),
    body: P.frame({ company, title: `${T.tasks.work_list} — ${T.modules[team].name}`, noMeta: true, footer, content, landscape: true }),
  });
}

module.exports = { boardPage, taskForm, taskPage, printPage, prioName };
