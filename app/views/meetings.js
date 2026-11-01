'use strict';
const { html, raw } = require('../lib/html');
const { T, f } = require('../i18n');
const { displayDate, displayDateTime } = require('../lib/time');
const { layout, csrf, textField, selectField, textArea } = require('./layout');
const P = require('./print');
const cv = require('./custom');
const customDomain = require('../domain/custom');
const meetings = require('../domain/meetings');
const tasks = require('../domain/tasks');

const teamChips = (m) => (m.teamList || meetings.teamsOf(m.teams)).map((t) => html`<span class="tag team-${t}">${T.modules[t].name}</span> `);
const timeRange = (m) => {
  const [h, mi] = m.start_time.split(':').map(Number);
  const end = h * 60 + mi + (m.duration_min || 0);
  return `${m.start_time}–${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
};
const statusTag = (s) => html`<span class="tag ms-${s}">${T.meetings.status[s]}</span>`;
const dayName = (iso) => T.meetings.day[meetings.isoWeekday(iso)];
const dayHeading = (iso) => {
  const t = meetings.today();
  const rel = iso === t ? T.meetings.today : iso === tasks.addDays(t, 1) ? T.meetings.tomorrow : '';
  return `${rel ? rel + ' · ' : ''}${dayName(iso)} ${displayDate(iso)}`;
};

/** "Mon–Fri at 08:00" / "Mon, Wed at 09:00, every 2 weeks". */
function scheduleText(s) {
  const days = meetings.daysOf(s.days);
  const names = days.length === 5 && days.join('') === '12345' ? T.meetings.weekdays : days.map((d) => T.meetings.day_short[d]).join(', ');
  return `${names} ${T.meetings.at} ${s.start_time}${s.interval_weeks > 1 ? `, ${f(T.meetings.every_n, { n: s.interval_weeks })}` : ''}`;
}

function tabs(d) {
  const mk = (view, label) => html`<a class="${d.f.view === view ? 'active' : ''}" href="${d.base}?${new URLSearchParams({ ...d.keep, view })}">${label}</a>`;
  return html`<div class="tabs">${mk('upcoming', T.meetings.view_upcoming)}${mk('past', T.meetings.view_past)}${mk('all', T.meetings.view_all)}</div>`;
}

function listPage(ctx, d) {
  const { rows, f: fl, can } = d;
  const cf = d.cf || { fields: [], filterFields: [], values: new Map() };
  const keep = { ...d.keep };
  const chip = (key, val, label) => {
    const on = fl[key] === val || (val === '1' && fl[key] === true);
    const q = { ...keep }; if (on) delete q[key]; else q[key] = val;
    return html`<a class="qchip${on ? ' on' : ''}" href="${d.base}?${new URLSearchParams(q)}">${label}</a>`;
  };
  const groups = [];
  for (const m of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === m.meeting_date) last.rows.push(m); else groups.push({ date: m.meeting_date, rows: [m] });
  }
  return layout(ctx, {
    title: T.meetings.title, active: 'list', wide: true,
    body: html`<div class="hero"><h1>${T.meetings.title}</h1>
  <div class="actions">${can.lead ? html`<a class="btn" href="/sedinte/serii">${T.meetings.series_title}</a>` : ''}${can.create ? html`<a class="btn primary big" href="/sedinte/nou">${T.meetings.new}</a>` : ''}</div></div>
<nav class="tiles" aria-label="${T.tasks.overview}">
  <a class="tile ts-open" href="${d.base}?view=upcoming"><strong>${d.counts.today}</strong><span>${T.meetings.tile_today}</span></a>
  <a class="tile ts-in_progress" href="${d.base}?view=upcoming"><strong>${d.counts.week}</strong><span>${T.meetings.tile_week}</span></a>
  <a class="tile ${d.counts.open_minutes ? 'ts-overdue' : 'ts-done'}" href="${d.base}?view=past"><strong>${d.counts.open_minutes}</strong><span>${T.meetings.tile_unclosed}</span></a>
</nav>
<div class="quick" aria-label="${T.tasks.quick}">${meetings.TEAMS.map((t) => chip('team', t, T.modules[t].name))}${d.hasPerson ? chip('mine', '1', T.meetings.mine) : ''}</div>
${tabs(d)}
${cf.filterFields.length ? html`<form method="get" action="${d.base}" class="card filters">${Object.entries(d.keep).filter(([k]) => !/^cf\d/.test(k)).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
  <div class="row">${cv.filterControls(cf.filterFields, ctx.query)}<button class="btn primary" type="submit">${T.common.filter}</button><a class="btn" href="${d.base}?${new URLSearchParams(Object.fromEntries(Object.entries(d.keep).filter(([k]) => !/^cf\d/.test(k))))}">${T.common.reset}</a></div></form>` : ''}
<p class="toolbar-line"><span class="muted">${rows.length}</span> <a class="btn small" href="${d.base}/export?${new URLSearchParams({ ...d.keep, format: 'csv' })}">${T.tasks.export_csv}</a><a class="btn small" href="${d.base}/export?${new URLSearchParams({ ...d.keep, format: 'xlsx' })}">${T.tasks.export_xlsx}</a></p>
${rows.length ? html`<div class="scroll"><table class="grid meetings"><thead><tr><th>${T.meetings.time}</th><th>${T.meetings.name}</th><th>${T.meetings.teams}</th><th>${T.meetings.where}</th><th>${T.meetings.people}</th>${cv.headCells(cf.fields)}<th>${T.common.status}</th></tr></thead>
<tbody>${groups.map((g) => html`<tr class="group-row"><th colspan="${6 + cv.columns(cf.fields).length}">${dayHeading(g.date)} <span class="count">${g.rows.length}</span></th></tr>${g.rows.map((m) => html`<tr class="${m.status === 'cancelled' ? 'is-cancelled' : ''}"><td class="nowrap">${timeRange(m)}</td>
  <td><a href="/sedinte/${m.id}"><strong>${m.title}</strong></a>${m.series_id ? html` <span class="mini" title="${T.meetings.recurring}">↻</span>` : ''}${m.decisions ? html` <span class="mini">✔ ${m.decisions}</span>` : ''}</td>
  <td>${teamChips(m)}</td><td>${m.location || html`<span class="muted">—</span>`}</td>
  <td>${m.status === 'held' ? `${m.present_n}/${m.invited}` : m.invited}</td>${cv.bodyCells(cf.fields, cf.values.get(m.id))}<td>${statusTag(m.status)}</td></tr>`)}`)}</tbody></table></div>`
    : html`<div class="card empty"><p>${T.meetings.empty}</p>${can.create ? html`<a class="btn primary" href="/sedinte/nou">${T.meetings.new}</a>` : ''}</div>`}`,
  });
}

function peoplePick(people, selected, name, legend) {
  const sel = new Set((selected || []).map(Number));
  const byTeam = new Map();
  for (const p of people) { if (!byTeam.has(p.team)) byTeam.set(p.team, []); byTeam.get(p.team).push(p); }
  return html`<fieldset class="people-pick"><legend>${legend}</legend>${people.length ? [...byTeam.entries()].map(([team, list]) => html`<div class="pick-group"><span class="eyebrow">${T.teams[team]}</span>${list.map((p) => html`<label class="check"><input type="checkbox" name="${name}" value="${p.id}"${sel.has(p.id) ? raw(' checked') : ''}> <span>${p.name}</span></label>`)}</div>`) : html`<p class="muted">${T.tasks.no_people}</p>`}</fieldset>`;
}

const teamPick = (selected, errors) => html`<fieldset class="people-pick${errors && errors.teams ? ' has-error' : ''}"><legend>${T.meetings.teams}</legend>${meetings.TEAMS.map((t) => html`<label class="check"><input type="checkbox" name="teams" value="${t}"${(selected || []).includes(t) ? raw(' checked') : ''}> <span>${T.modules[t].name}</span></label>`)}
  ${errors && errors.teams ? html`<span class="field-error" role="alert">${T.errors.required}</span>` : ''}<p class="muted">${T.meetings.teams_hint}</p></fieldset>`;

function meetingForm(ctx, d) {
  const { m, values, errors, people } = d;
  const v = values || m || {};
  const teams = v.teams ? (Array.isArray(v.teams) ? v.teams : meetings.teamsOf(v.teams)) : [];
  return layout(ctx, {
    title: m ? T.meetings.edit : T.meetings.new, active: 'list',
    body: html`<p><a href="${m ? `/sedinte/${m.id}` : '/sedinte'}">« ${T.common.back}</a></p><h1>${m ? T.meetings.edit : T.meetings.new}</h1>
<form method="post" action="${m ? `/sedinte/${m.id}/editeaza` : '/sedinte/nou'}" class="card entry">${csrf(ctx)}
  ${textField({ label: T.meetings.name, name: 'title', value: v.title, errors, required: true, attrs: 'maxlength="160"' })}
  <div class="row">
    ${textField({ label: T.common.date, name: 'meeting_date', value: v.meeting_date, type: 'date', errors, required: true })}
    ${textField({ label: T.meetings.start, name: 'start_time', value: v.start_time || '08:00', type: 'time', errors, required: true })}
    ${textField({ label: T.meetings.duration, name: 'duration_min', value: v.duration_min || 30, type: 'number', errors, attrs: 'min="5" max="480" step="5"', hint: T.meetings.minutes_unit })}
    ${textField({ label: T.meetings.where, name: 'location', value: v.location, errors, attrs: 'maxlength="120"' })}
  </div>
  ${teamPick(teams, errors)}
  ${textArea({ label: T.meetings.agenda, name: 'agenda', value: v.agenda, errors, rows: 4 })}
  ${peoplePick(people, d.attendees, 'attendees', T.meetings.invited)}
  ${cv.inputs(d.cfFields || [], d.cfv, errors, d.cfCurrent)}
  <div class="actions"><button class="btn primary big" type="submit">${T.common.save}</button><a class="btn" href="${m ? `/sedinte/${m.id}` : '/sedinte'}">${T.common.cancel}</a></div>
</form>`,
  });
}

function meetingPage(ctx, d) {
  const { m, can, lists, err } = d;
  const open = m.status === 'planned';
  const prio = (p) => [p.id, tasksPrio(p)];
  return layout(ctx, {
    title: m.title, active: 'list', wide: true,
    body: html`<p><a href="/sedinte">« ${T.meetings.title}</a></p>
<div class="hero"><h1>${m.title}</h1><div class="actions">${can.create ? html`<a class="btn" href="/sedinte/${m.id}/editeaza">${T.common.edit}</a>` : ''}<a class="btn" href="/sedinte/${m.id}/tipar">${T.meetings.minutes_print}</a></div></div>
<section class="card"><div class="facts-line">${statusTag(m.status)} ${teamChips(m)}${m.series ? html` <span class="tag">↻ ${m.series.title}</span>` : ''}</div>
  <dl class="facts">
    <div><dt>${T.common.date}</dt><dd>${dayName(m.meeting_date)} ${displayDate(m.meeting_date)}</dd></div>
    <div><dt>${T.meetings.time}</dt><dd>${timeRange(m)}</dd></div>
    <div><dt>${T.meetings.where}</dt><dd>${m.location || '—'}</dd></div>
    ${cv.facts((d.cf || {}).fields || [], (d.cf || {}).values)}
    ${m.status === 'cancelled' ? html`<div><dt>${T.meetings.cancel_reason}</dt><dd>${m.cancel_reason}</dd></div>` : ''}
  </dl></section>
${err ? html`<p class="field-error" role="alert">${err}</p>` : ''}
${can.lead || can.create ? html`<section class="card"><h2>${T.meetings.run}</h2>
  <form method="post" action="/sedinte/${m.id}/stare" class="status-form">${csrf(ctx)}
    ${m.status === 'planned' ? textField({ label: T.meetings.cancel_reason_label, name: 'reason', value: '', attrs: 'maxlength="500"', hint: T.meetings.cancel_hint }) : ''}
    <div class="actions">${m.status !== 'held' && can.create ? html`<button class="btn primary" type="submit" name="to" value="held">${T.meetings.mark_held}</button>` : ''}
      ${m.status === 'planned' && can.lead ? html`<button class="btn" type="submit" name="to" value="cancelled">${T.meetings.cancel}</button>` : ''}
      ${m.status !== 'planned' && can.lead ? html`<button class="btn" type="submit" name="to" value="planned">${T.meetings.reopen}</button>` : ''}</div></form></section>` : ''}
<div class="home-grid"><div>
<section class="card"><h2>${T.meetings.agenda}</h2>
  ${can.create ? html`<form method="post" action="/sedinte/${m.id}/note" class="card-in">${csrf(ctx)}${textArea({ label: T.meetings.agenda, name: 'agenda', value: m.agenda, rows: 4 })}${textArea({ label: T.meetings.minutes, name: 'minutes', value: m.minutes, rows: 6 })}<button class="btn" type="submit">${T.meetings.save_notes}</button></form>`
    : html`<p class="task-desc">${m.agenda || '—'}</p><h2>${T.meetings.minutes}</h2><p class="task-desc">${m.minutes || '—'}</p>`}</section>
<section class="card" id="decisions"><h2>${T.meetings.decisions} <span class="count">${m.decisions.length}</span></h2>
  ${m.decisions.length ? html`<ol class="decisions">${m.decisions.map((x) => html`<li><div>${x.text}</div>
    ${x.task_id ? html`<div class="muted"><a href="/sarcini/${x.task_id}">${x.task_no}</a> · ${T.modules[x.task_team].name} · ${T.taskstatus[x.task_status]}${x.assignees.length ? ` · ${x.assignees.join(', ')}` : ''}${x.task_due ? ` · ${displayDate(x.task_due)}` : ''}</div>` : html`<div class="muted">${T.meetings.no_task}</div>`}</li>`)}</ol>` : html`<p class="muted">${T.meetings.no_decisions}</p>`}
  ${can.create ? html`<form method="post" action="/sedinte/${m.id}/decizie" class="card-in">${csrf(ctx)}
    ${textArea({ label: T.meetings.decision, name: 'text', value: '', rows: 2, required: true })}
    <div class="row">${selectField({ label: T.meetings.make_task, name: 'team', value: '', options: meetings.TEAMS.filter((t) => ctx.modules[t]).map((t) => [t, T.modules[t].name]), blank: T.meetings.no_task_option })}
      ${selectField({ label: T.tasks.priority, name: 'priority_id', value: '', options: lists.priorities.map(prio), blank: '—' })}
      ${textField({ label: T.tasks.due, name: 'due_date', value: '', type: 'date' })}</div>
    ${peoplePick(lists.people, [], 'assignees', T.tasks.assigned)}
    <button class="btn primary" type="submit">${T.meetings.add_decision}</button></form>` : ''}</section></div>
<aside><section class="card"><h2>${T.meetings.invited} <span class="count">${m.attendees.filter((a) => a.present).length}/${m.attendees.length}</span></h2>
  ${can.create ? html`<form method="post" action="/sedinte/${m.id}/prezenta">${csrf(ctx)}<ul class="panel-list">${m.attendees.map((a) => html`<li><label class="check"><input type="checkbox" name="present" value="${a.id}"${a.present ? raw(' checked') : ''}> <span>${a.name}</span></label><small class="muted">${T.teams[a.team]}</small></li>`)}</ul>
    ${lists.people.filter((p) => !m.attendees.some((a) => a.id === p.id)).length ? html`<details><summary>${T.meetings.add_guest}</summary>${peoplePick(lists.people.filter((p) => !m.attendees.some((a) => a.id === p.id)), [], 'extra', T.meetings.guests)}</details>` : ''}
    <button class="btn" type="submit">${T.meetings.save_attendance}</button></form>`
    : html`<ul class="panel-list">${m.attendees.map((a) => html`<li><span>${a.present ? '✓' : '○'} ${a.name}</span><small class="muted">${T.teams[a.team]}</small></li>`)}</ul>`}</section></aside></div>`,
  });
}
const tasksPrio = (p) => (require('../i18n').current() === 'en' && p.name_en ? p.name_en : p.name);

function minutesPage(ctx, d) {
  const { m, company, by, now } = d;
  const footer = html`<div class="doc-foot"><div>${f(T.print.printed_by, { user: by, when: displayDateTime(now) })}</div><div><span class="k">${T.print.signature}:</span> <span class="sigline"></span></div></div>`;
  const content = html`<table class="sheet kv"><tbody>
    <tr><th>${T.common.date}</th><td>${dayName(m.meeting_date)} ${displayDate(m.meeting_date)}</td><th>${T.meetings.time}</th><td>${timeRange(m)}</td></tr>
    <tr><th>${T.meetings.teams}</th><td>${m.teamList.map((t) => T.modules[t].name).join(', ')}</td><th>${T.meetings.where}</th><td>${m.location || ''}</td></tr>
    ${m.status === 'cancelled' ? html`<tr><th>${T.meetings.cancel_reason}</th><td colspan="3">${m.cancel_reason}</td></tr>` : ''}
    ${cv.printRows((d.cf || {}).fields, (d.cf || {}).values)}</tbody></table>
  <h3>${T.meetings.invited}</h3>
  <table class="sheet"><thead><tr><th>${T.meetings.person}</th><th>${T.meetings.team}</th><th>${T.meetings.present}</th></tr></thead><tbody>${m.attendees.map((a) => html`<tr><td>${a.name}</td><td>${T.teams[a.team]}</td><td class="box">${a.present ? '☑' : '☐'}</td></tr>`)}</tbody></table>
  <h3>${T.meetings.agenda}</h3><div class="notes-box">${m.agenda || ''}</div>
  <h3>${T.meetings.minutes}</h3><div class="notes-box tall">${m.minutes || ''}</div>
  <h3>${T.meetings.decisions}</h3>
  <table class="sheet"><thead><tr><th>#</th><th>${T.meetings.decision}</th><th>${T.tasks.no}</th><th>${T.tasks.assigned}</th><th>${T.tasks.due}</th></tr></thead>
  <tbody>${m.decisions.length ? m.decisions.map((x, i) => html`<tr><td>${i + 1}</td><td>${x.text}</td><td class="nowrap">${x.task_no || ''}</td><td>${x.assignees.join(', ')}</td><td class="nowrap">${x.task_due ? displayDate(x.task_due) : ''}</td></tr>`) : html`<tr><td colspan="5" class="blank">&nbsp;</td></tr>`}</tbody></table>`;
  return P.page({
    title: `${T.meetings.minutes_title} — ${m.title}`,
    toolbar: P.toolbar(ctx, { backHref: `/sedinte/${m.id}`, action: `/sedinte/${m.id}/tipar`, hidden: {} }),
    body: P.frame({ company, title: `${T.meetings.minutes_title} — ${m.title}`, noMeta: true, footer, content }),
  });
}

function seriesListPage(ctx, d) {
  return layout(ctx, {
    title: T.meetings.series_title, active: 'series', wide: true,
    body: html`<p><a href="/sedinte">« ${T.meetings.title}</a></p><div class="hero"><h1>${T.meetings.series_title}</h1><a class="btn primary big" href="/sedinte/serii/nou">${T.meetings.series_new}</a></div>
<p class="muted">${T.meetings.series_hint}</p>
<div class="scroll"><table class="grid"><thead><tr><th>${T.meetings.name}</th><th>${T.meetings.teams}</th><th>${T.meetings.schedule}</th><th>${T.meetings.where}</th><th>${T.common.status}</th><th></th></tr></thead>
<tbody>${d.rows.length ? d.rows.map((s) => html`<tr class="${s.active ? '' : 'is-cancelled'}"><td><strong>${s.title}</strong></td><td>${teamChips({ teams: s.teams })}</td><td>${scheduleText(s)}${s.starts_on ? html`<br><small class="muted">${T.meetings.from} ${displayDate(s.starts_on)}${s.ends_on ? ` ${T.meetings.until} ${displayDate(s.ends_on)}` : ''}</small>` : ''}</td><td>${s.location || '—'}</td>
  <td>${s.active ? html`<span class="tag ms-planned">${T.meetings.series_on}</span>` : html`<span class="tag ms-cancelled">${T.meetings.series_off}</span>`}</td>
  <td class="nowrap"><a class="btn small" href="/sedinte/serii/${s.id}/editeaza">${T.common.edit}</a>
    <form method="post" action="/sedinte/serii/${s.id}/activ" class="inline">${csrf(ctx)}<input type="hidden" name="active" value="${s.active ? 0 : 1}"><button class="btn small" type="submit">${s.active ? T.meetings.series_stop : T.meetings.series_start}</button></form></td></tr>`) : html`<tr><td colspan="6" class="empty">${T.meetings.series_empty}</td></tr>`}</tbody></table></div>`,
  });
}

function seriesForm(ctx, d) {
  const { s, values, errors, people } = d;
  const v = values || s || {};
  const teams = v.teams ? (Array.isArray(v.teams) ? v.teams : meetings.teamsOf(v.teams)) : [];
  const days = new Set((Array.isArray(v.days) ? v.days : meetings.daysOf(v.days)).map(Number));
  return layout(ctx, {
    title: s ? T.meetings.series_edit : T.meetings.series_new, active: 'series',
    body: html`<p><a href="/sedinte/serii">« ${T.common.back}</a></p><h1>${s ? T.meetings.series_edit : T.meetings.series_new}</h1>
<form method="post" action="${s ? `/sedinte/serii/${s.id}/editeaza` : '/sedinte/serii/nou'}" class="card entry">${csrf(ctx)}
  ${textField({ label: T.meetings.name, name: 'title', value: v.title, errors, required: true, attrs: 'maxlength="160"' })}
  ${teamPick(teams, errors)}
  <fieldset class="people-pick${errors && errors.days ? ' has-error' : ''}"><legend>${T.meetings.days}</legend>${[1, 2, 3, 4, 5, 6, 7].map((n) => html`<label class="check"><input type="checkbox" name="days" value="${n}"${days.has(n) ? raw(' checked') : ''}> <span>${T.meetings.day[n]}</span></label>`)}
    ${errors && errors.days ? html`<span class="field-error" role="alert">${T.errors.required}</span>` : ''}</fieldset>
  <div class="row">
    ${textField({ label: T.meetings.start, name: 'start_time', value: v.start_time || '08:00', type: 'time', errors, required: true })}
    ${textField({ label: T.meetings.duration, name: 'duration_min', value: v.duration_min || 30, type: 'number', errors, attrs: 'min="5" max="480" step="5"', hint: T.meetings.minutes_unit })}
    ${textField({ label: T.meetings.interval, name: 'interval_weeks', value: v.interval_weeks || 1, type: 'number', errors, attrs: 'min="1" max="12"', hint: T.meetings.interval_hint })}
    ${textField({ label: T.meetings.where, name: 'location', value: v.location, errors, attrs: 'maxlength="120"' })}
  </div>
  <div class="row">${textField({ label: T.meetings.from, name: 'starts_on', value: v.starts_on, type: 'date', errors })}${textField({ label: T.meetings.until, name: 'ends_on', value: v.ends_on, type: 'date', errors })}</div>
  ${peoplePick(people, d.people_sel || (s ? s.people : []), 'people', T.meetings.series_people)}<p class="muted">${T.meetings.series_people_hint}</p>
  <div class="actions"><button class="btn primary big" type="submit">${T.common.save}</button><a class="btn" href="/sedinte/serii">${T.common.cancel}</a></div>
</form>`,
  });
}

module.exports = { listPage, meetingForm, meetingPage, minutesPage, seriesListPage, seriesForm, scheduleText, timeRange, teamChips, dayName };
