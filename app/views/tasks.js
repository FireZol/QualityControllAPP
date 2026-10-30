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

/** One tile per active status plus the overdue ones: the board at a glance, each tile a filter (tap again to clear). */
function tiles(d) {
  const keep = { ...d.keep, view: 'active' };
  delete keep.status; delete keep.overdue;
  const tile = (cls, label, n, on, params) => html`<a class="tile ${cls}${on ? ' on' : ''}" href="${d.base}?${new URLSearchParams(on ? keep : { ...keep, ...params })}"><strong>${n}</strong><span>${label}</span></a>`;
  return html`<nav class="tiles" aria-label="${T.tasks.overview}">${tasks.ACTIVE.map((st) => tile(`ts-${st}`, T.taskstatus[st], d.counts.by[st], d.f.status === st, { status: st }))}${tile('ts-overdue', T.tasks.overdue_title, d.counts.overdue, d.f.overdue, { overdue: '1' })}</nav>`;
}

/** Quick filters: one tap each, tap again to clear. "Mine" needs the user to be in the people list. */
function quick(d) {
  const keep = { ...d.keep };
  const chip = (key, label) => {
    const on = !!d.f[key];
    const q = { ...keep }; if (on) delete q[key]; else q[key] = '1';
    return html`<a class="qchip${on ? ' on' : ''}" href="${d.base}?${new URLSearchParams(q)}"${on ? raw(' aria-current="true"') : ''}>${label}</a>`;
  };
  return html`<div class="quick" aria-label="${T.tasks.quick}">${d.hasPerson ? chip('mine', T.tasks.quick_mine) : ''}${chip('unassigned', T.tasks.quick_unassigned)}${chip('soon', T.tasks.quick_soon)}${chip('by_me', T.tasks.quick_by_me)}</div>`;
}

/** The rows in sections (by status, person or priority) when the board is grouped. */
function sections(d) {
  const { rows, f: fl, ranks } = d;
  if (!fl.group) return [{ title: '', rows }];
  const by = new Map();
  const put = (key, title, order, t) => { if (!by.has(key)) by.set(key, { title, order, rows: [] }); by.get(key).rows.push(t); };
  for (const t of rows) {
    if (fl.group === 'status') put(t.status, T.taskstatus[t.status], tasks.STATUSES.indexOf(t.status), t);
    else if (fl.group === 'priority') put(t.priority_id || 0, prioName(t) || '—', -(ranks.get(t.priority_id) ?? -1), t);
    else for (const a of (t.assignees.length ? t.assignees : [{ id: 0, name: T.tasks.unassigned }])) put(a.id, a.name, a.id ? 1 : 2, t);
  }
  return [...by.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function bulkBar(ctx, d) {
  const { lists, team } = d;
  const prio = (p) => [p.id, prioName({ priority_name: p.name, priority_name_en: p.name_en })];
  const opt = (rows, blank) => rows.map(([v, l]) => html`<option value="${v}">${l}</option>`);
  return html`<form method="post" action="/sarcini/bulk" id="bulk" class="card bulk" hidden>${csrf(ctx)}<input type="hidden" name="team" value="${team}"><input type="hidden" name="back" value="${d.back}">
  <p><strong id="bulk-count">0</strong> ${T.tasks.selected} — ${T.tasks.bulk_hint}</p>
  <div class="row">
    <label class="field"><span class="lbl">${T.common.status}</span><select name="v_status">${opt(['in_progress', 'waiting', 'done', 'closed'].map((x) => [x, T.taskstatus[x]]))}</select></label><button class="btn" type="submit" name="action" value="status">${T.tasks.apply}</button>
    <label class="field"><span class="lbl">${T.tasks.assigned}</span><select name="v_assign">${opt(lists.people.map((p) => [p.id, p.name]))}</select></label><button class="btn" type="submit" name="action" value="assign">${T.tasks.bulk_add_person}</button>
    <label class="field"><span class="lbl">${T.tasks.priority}</span><select name="v_priority">${opt(lists.priorities.map(prio))}</select></label><button class="btn" type="submit" name="action" value="priority">${T.tasks.apply}</button>
    <label class="field"><span class="lbl">${T.tasks.due}</span><input type="date" name="v_due"></label><button class="btn" type="submit" name="action" value="due">${T.tasks.apply}</button>
  </div></form>`;
}

function boardPage(ctx, d) {
  const { team, rows, f: fl, lists, ranks, can } = d;
  const keep = new URLSearchParams(d.keep).toString();
  const back = `${d.base}?${keep}`;
  d.back = back; d.team = team;
  const qs = new URLSearchParams({ ...d.keep, team });
  const cols = can.update ? 9 : 8;
  const row = (t) => html`<tr class="${t.overdue ? 'is-overdue' : ''}">
  ${can.update ? html`<td class="sel"><label class="selbox"><input type="checkbox" name="ids" value="${t.id}" form="bulk" aria-label="${t.no}"></label></td>` : ''}
  <td class="nowrap"><a href="/sarcini/${t.id}">${t.no}</a></td>
  <td class="task-title"><a href="/sarcini/${t.id}"><strong>${t.title}</strong></a>${t.source_kind && t.source_kind !== 'manual' ? html` <span class="tag">${T.tasks.source[t.source_kind] || t.source_kind}</span>` : ''}
    ${t.check_total ? html` <span class="mini${t.check_done === t.check_total ? ' ok' : ''}" title="${T.tasks.checklist}">☑ ${t.check_done}/${t.check_total}</span>` : ''}${t.comments ? html` <span class="mini" title="${T.tasks.comments}">💬 ${t.comments}</span>` : ''}${where(t) ? html`<br><small class="muted">${where(t)}</small>` : ''}</td>
  <td>${prioChip(t, ranks)}</td><td>${statusChip(t.status)}</td>
  <td>${t.assignees.length ? t.assignees.map((a) => a.name).join(', ') : html`<span class="muted">${T.tasks.unassigned}</span>`}</td>
  <td class="nowrap">${dueCell(t)}</td><td class="nowrap muted col-updated">${displayDate((t.updated_at || t.created_at).slice(0, 10))}</td>
  ${can.update ? html`<td class="nowrap">${NEXT[t.status] ? html`<form method="post" action="/sarcini/${t.id}/stare" class="inline">${csrf(ctx)}<input type="hidden" name="to" value="${NEXT[t.status]}"><input type="hidden" name="back" value="${back}"><button class="btn small primary" type="submit">${T.taskact[t.status === 'waiting' ? 'resume' : NEXT[t.status]]}</button></form>` : ''}</td>` : ''}
</tr>`;
  const groups = sections(d);
  return layout(ctx, {
    title: `${T.modules[team].name} — ${T.tasks.title}`, active: 'tasks', wide: true, scripts: can.update ? ['/static/tasks.js'] : [],
    body: html`<div class="hero"><h1>${T.modules[team].name}: ${T.tasks.title}</h1>
  ${can.create ? html`<a class="btn primary big" href="${d.newPath}">${T.tasks.new}</a>` : ''}</div>
${tiles(d)}
${quick(d)}
${tabs(d)}
<form method="get" action="${d.base}" class="card filters">
  <input type="hidden" name="view" value="${fl.view}">${['status', 'mine', 'unassigned', 'soon', 'by_me'].map((k) => (fl[k] ? html`<input type="hidden" name="${k}" value="${k === 'status' ? fl.status : '1'}">` : ''))}
  <div class="row">
    ${textField({ label: T.common.search, name: 'q', value: fl.q })}
    ${selectField({ label: T.tasks.person, name: 'person', value: fl.person, options: lists.people.map((p) => [p.id, p.name]), blank: T.common.all })}
    ${selectField({ label: T.tasks.priority, name: 'priority', value: fl.priority, options: lists.priorities.map((p) => [p.id, prioName({ priority_name: p.name, priority_name_en: p.name_en })]), blank: T.common.all })}
    ${selectField({ label: T.measure.machine, name: 'machine', value: fl.machine, options: lists.machines.map((m) => [m.id, m.name]), blank: T.common.all })}
    ${selectField({ label: T.tasks.sort, name: 'sort', value: fl.sort, options: tasks.SORT_KEYS.map((k) => [k, T.tasks['sort_' + k]]) })}
    ${selectField({ label: T.tasks.group, name: 'group', value: fl.group, options: ['status', 'person', 'priority'].map((k) => [k, T.tasks['group_' + k]]), blank: T.tasks.group_none })}
    <label class="check"><input type="checkbox" name="overdue" value="1"${fl.overdue ? raw(' checked') : ''}> <span>${T.tasks.only_overdue}</span></label>
    <button class="btn primary" type="submit">${T.common.filter}</button><a class="btn" href="${d.base}?view=${fl.view}">${T.common.reset}</a>
  </div>
</form>
<p class="toolbar-line"><span class="muted">${f(T.tasks.count, { n: rows.length })}</span>
  <a class="btn small" href="/sarcini/tipar?${qs}">${T.tasks.print_list}</a>
  <a class="btn small" href="/sarcini/tipar?${new URLSearchParams({ ...d.keep, team, group: 'person' })}">${T.tasks.print_by_person}</a>
  <a class="btn small" href="/sarcini/export?${qs}&format=csv">${T.tasks.export_csv}</a><a class="btn small" href="/sarcini/export?${qs}&format=xlsx">${T.tasks.export_xlsx}</a></p>
${can.update ? bulkBar(ctx, d) : ''}
<div class="scroll"><table class="grid tasks"><thead><tr>${can.update ? html`<th class="sel"><label class="selbox"><input type="checkbox" id="sel-all" aria-label="${T.tasks.select_all}"></label></th>` : ''}<th>${T.tasks.no}</th><th>${T.tasks.task}</th><th>${T.tasks.priority}</th><th>${T.common.status}</th><th>${T.tasks.assigned}</th><th>${T.tasks.due}</th><th class="col-updated">${T.tasks.updated}</th>${can.update ? html`<th></th>` : ''}</tr></thead>
<tbody>${rows.length ? groups.map((g) => html`${g.title ? html`<tr class="group-row"><th colspan="${cols}">${g.title} <span class="count">${g.rows.length}</span></th></tr>` : ''}${g.rows.map(row)}`) : html`<tr><td colspan="${cols}" class="empty">${T.tasks.empty} ${can.create ? html`<a href="${d.newPath}">${T.tasks.new}</a>` : ''}</td></tr>`}</tbody></table></div>`,
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
<form method="post" action="${task ? `/sarcini/${task.id}/editeaza` : `${base}/nou`}" class="card entry">${csrf(ctx)}${d.copy ? html`<input type="hidden" name="copy" value="${d.copy}"><p class="muted">${T.tasks.copy_note}</p>` : ''}
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
  if (e.kind === 'edit' && e.details && e.details.checklist) return f(T.tasks.ev_check, { action: T.tasks['check_' + e.details.checklist.action] || '', item: e.details.checklist.item });
  if (e.kind === 'edit') return f(T.tasks.ev_edit, { fields: e.details ? Object.keys(e.details).map((k) => T.tasks.field[k] || k).join(', ') : '' });
  return T.tasks.ev_comment;
}

function checklistCard(ctx, t, can) {
  const done = t.checklist.filter((c) => c.done).length;
  if (!t.checklist.length && !can.update) return '';
  return html`<section class="card" id="lista"><h2>${T.tasks.checklist} ${t.checklist.length ? html`<span class="count">${done}/${t.checklist.length}</span>` : ''}</h2>
  ${t.checklist.length ? html`<progress max="${t.checklist.length}" value="${done}"></progress>` : html`<p class="muted">${T.tasks.check_none}</p>`}
  <ul class="steps">${t.checklist.map((c) => html`<li class="${c.done ? 'is-done' : ''}">
    ${can.update ? html`<form method="post" action="/sarcini/${t.id}/pas/${c.id}/bifeaza" class="inline">${csrf(ctx)}<input type="hidden" name="done" value="${c.done ? 0 : 1}"><button class="step-box" type="submit" aria-label="${c.done ? T.tasks.check_uncheck : T.tasks.check_check}">${c.done ? '☑' : '☐'}</button></form>` : html`<span class="step-box">${c.done ? '☑' : '☐'}</span>`}
    <span class="step-text">${c.text}</span>${c.done ? html` <small class="muted">${c.done_by_name || ''} ${c.done_at ? displayDateTime(c.done_at) : ''}</small>` : ''}
    ${can.update ? html`<form method="post" action="/sarcini/${t.id}/pas/${c.id}/sterge" class="inline">${csrf(ctx)}<button class="btn small" type="submit" aria-label="${T.tasks.check_remove}">×</button></form>` : ''}</li>`)}</ul>
  ${can.update ? html`<form method="post" action="/sarcini/${t.id}/pas" class="card-in">${csrf(ctx)}${textArea({ label: T.tasks.check_add, name: 'steps', value: '', rows: 2 })}<button class="btn" type="submit">${T.tasks.check_add_btn}</button></form>` : ''}</section>`;
}

function planCard(ctx, t, d) {
  const prio = (p) => [p.id, prioName({ priority_name: p.name, priority_name_en: p.name_en })];
  return html`<section class="card"><h2>${T.tasks.plan}</h2>
  <form method="post" action="/sarcini/${t.id}/planifica" class="row">${csrf(ctx)}
    ${selectField({ label: T.tasks.priority, name: 'priority_id', value: t.priority_id, options: d.lists.priorities.map(prio) })}
    ${textField({ label: T.tasks.due, name: 'due_date', value: t.due_date, type: 'date' })}
    <button class="btn primary" type="submit">${T.common.save}</button></form>
  <form method="post" action="/sarcini/${t.id}/planifica" class="actions">${csrf(ctx)}<span class="muted">${T.tasks.postpone}:</span>
    <button class="btn" type="submit" name="postpone" value="1d">${T.tasks.postpone_1d}</button><button class="btn" type="submit" name="postpone" value="1w">${T.tasks.postpone_1w}</button><button class="btn" type="submit" name="postpone" value="1m">${T.tasks.postpone_1m}</button></form></section>`;
}

/** One task on paper: facts, steps with boxes, space for notes, signature. */
function workOrderPage(ctx, d) {
  const { t, company, by, now } = d;
  const footer = html`<div class="doc-foot"><div>${f(T.print.printed_by, { user: by, when: displayDateTime(now) })}</div><div><span class="k">${T.print.signature}:</span> <span class="sigline"></span></div></div>`;
  const content = html`<table class="sheet kv"><tbody>
    <tr><th>${T.tasks.no}</th><td>${t.no}</td><th>${T.tasks.priority}</th><td>${prioName(t)}</td></tr>
    <tr><th>${T.tasks.task}</th><td colspan="3"><strong>${t.title}</strong></td></tr>
    <tr><th>${T.tasks.where}</th><td>${where(t)}</td><th>${T.tasks.due}</th><td>${t.due_date ? displayDate(t.due_date) : ''}</td></tr>
    <tr><th>${T.tasks.assigned}</th><td colspan="3">${t.assignees.map((a) => a.name).join(', ')}</td></tr>
    ${t.description ? html`<tr><th>${T.tasks.description}</th><td colspan="3">${t.description}</td></tr>` : ''}</tbody></table>
  <h3>${T.tasks.checklist}</h3>
  <table class="sheet"><tbody>${t.checklist.length ? t.checklist.map((c) => html`<tr><td class="box">☐</td><td>${c.text}</td></tr>`) : [1, 2, 3, 4, 5].map(() => html`<tr><td class="box">☐</td><td class="blank">&nbsp;</td></tr>`)}</tbody></table>
  <h3>${T.common.notes}</h3><div class="notes-box"></div>`;
  return P.page({
    title: `${T.tasks.work_order} ${t.no}`,
    toolbar: P.toolbar(ctx, { backHref: `/sarcini/${t.id}`, action: `/sarcini/${t.id}/tipar`, hidden: {} }),
    body: P.frame({ company, title: `${T.tasks.work_order} — ${T.modules[t.team].name}`, noMeta: true, footer, content }),
  });
}

function taskPage(ctx, d) {
  const { t, can, ranks, base, nameOf, lists } = d;
  const buttons = tasks.STATUSES.filter((s) => s !== t.status);
  return layout(ctx, {
    title: `${t.no} — ${t.title}`, active: 'tasks', wide: true,
    body: html`<p><a href="${base}">« ${T.modules[t.team].name}: ${T.tasks.title}</a></p>
<div class="hero"><h1>${t.no} <span class="muted">${t.title}</span></h1><div class="actions">${can.update ? html`<a class="btn" href="/sarcini/${t.id}/editeaza">${T.common.edit}</a>` : ''}${can.create ? html`<a class="btn" href="${base}/nou?copy=${t.id}">${T.tasks.copy}</a>` : ''}<a class="btn" href="/sarcini/${t.id}/tipar">${T.tasks.work_order}</a></div></div>
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
${checklistCard(ctx, t, can)}
${can.update ? planCard(ctx, t, d) : ''}
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

module.exports = { boardPage, taskForm, taskPage, printPage, workOrderPage, prioName };
