'use strict';
const { page, redirect, download } = require('../lib/http');
const xp = require('../lib/export');
const i18n = require('../i18n');
const tasks = require('../domain/tasks');
const settings = require('../domain/settings');
const views = require('../views/tasks');
const { errorPage } = require('../views/errors');
const { nowIso } = require('../lib/time');
const { T } = require('../i18n');

const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);
const safeBack = (b) => (typeof b === 'string' && b.startsWith('/') && !b.startsWith('//') && !b.startsWith('/\\') ? b : '');

module.exports = function register(app) {
  const { router, db } = app;

  const lists = () => ({
    people: db.all('SELECT * FROM people WHERE active = 1 ORDER BY name'),
    priorities: db.all('SELECT * FROM priorities WHERE active = 1 ORDER BY sort, name'),
    machines: db.all('SELECT id, name FROM machines WHERE active = 1 ORDER BY name'),
  });
  const ranks = (l) => new Map(l.priorities.map((p, i) => [p.id, i]));
  const rights = (ctx, team) => ({ view: tasks.canView(db, ctx.user, team, ctx.modules), create: tasks.canCreate(db, ctx.user, team, ctx.modules), update: tasks.canUpdate(db, ctx.user, team, ctx.modules), comment: tasks.canCreate(db, ctx.user, team, ctx.modules) });
  const forbidden = (ctx) => page(errorPage(ctx, 'forbidden'), 403);

  /** Board filters from a query string (the same ones the printable list takes). */
  function filtersOf(q) {
    const int = (k) => (/^\d+$/.test(q.get(k) || '') ? Number(q.get(k)) : null);
    const flag = (k) => q.get(k) === '1';
    return { sort: tasks.SORT_KEYS.includes(q.get('sort')) ? q.get('sort') : 'priority', group: ['status', 'person', 'priority'].includes(q.get('group')) ? q.get('group') : '', mine: flag('mine'), unassigned: flag('unassigned'), soon: flag('soon'), by_me: flag('by_me'),
      view: ['active', 'closed', 'all'].includes(q.get('view')) ? q.get('view') : 'active', q: (q.get('q') || '').trim().slice(0, 60), person: int('person'), priority: int('priority'), machine: int('machine'), overdue: q.get('overdue') === '1', status: tasks.ACTIVE.includes(q.get('status')) ? q.get('status') : '', source_kind: q.get('source') || '' };
  }
  const keepOf = (fl) => Object.fromEntries(Object.entries({ view: fl.view, q: fl.q, person: fl.person, priority: fl.priority, machine: fl.machine, overdue: fl.overdue ? '1' : '', status: fl.status, sort: fl.sort === 'priority' ? '' : fl.sort, group: fl.group, mine: fl.mine ? '1' : '', unassigned: fl.unassigned ? '1' : '', soon: fl.soon ? '1' : '', by_me: fl.by_me ? '1' : '' }).filter(([, v]) => v !== '' && v !== null && v !== undefined));

  /** The people record(s) of the logged-in user: "mine" means assigned to them (-1 matches nothing when the user is not in the people list). */
  const myPeople = (ctx) => db.all('SELECT id FROM people WHERE user_id = ? AND active = 1', ctx.user.id).map((r) => r.id);
  const queryOf = (ctx, fl, team, extra) => ({ ...fl, team, ...extra, persons: fl.mine ? (myPeople(ctx).length ? myPeople(ctx) : [-1]) : null, created_by: fl.by_me ? ctx.user.id : null });

  for (const team of tasks.TEAMS) {
    const base = tasks.teamPath(team);

    router.get(base, {}, (ctx) => {
      const rt = rights(ctx, team);
      if (!rt.view) return forbidden(ctx);
      const fl = filtersOf(ctx.query);
      const l = lists();
      return page(views.boardPage(ctx, { team, base, newPath: `${base}/nou`, rows: tasks.list(db, queryOf(ctx, fl, team)), f: fl, hasPerson: myPeople(ctx).length > 0, keep: keepOf(fl), lists: l, ranks: ranks(l), counts: tasks.counts(db, team), can: rt }));
    });

    router.get(`${base}/nou`, {}, (ctx) => {
      if (!rights(ctx, team).create) return forbidden(ctx);
      const copy = idOf(ctx.query.get('copy'));
      const values = (copy && tasks.copyValues(db, copy, team)) || { priority_id: null };
      return page(views.taskForm(ctx, { team, base, lists: lists(), values, canAssign: rights(ctx, team).update, copy: values.title ? copy : 0 }));
    });

    router.post(`${base}/nou`, {}, (ctx) => {
      const rt = rights(ctx, team);
      if (!rt.create) return forbidden(ctx);
      const data = { team, title: ctx.form.get('title'), description: ctx.form.get('description'), priority_id: ctx.form.get('priority_id'), due_date: ctx.form.get('due_date'), machine_id: ctx.form.get('machine_id'), area: ctx.form.get('area'), assignees: rt.update ? ctx.form.all('assignees') : [] };
      const r = tasks.create(db, ctx.user, data);
      if (!r.ok) return page(views.taskForm(ctx, { team, base, lists: lists(), values: data, errors: r.errors, canAssign: rt.update, assignees: data.assignees.map(Number) }), 422);
      const from = idOf(ctx.form.get('copy'));
      if (from && tasks.copyValues(db, from, team)) tasks.copyChecklist(db, ctx.user, from, r.id);
      return redirect(`/sarcini/${r.id}`, { flash: { key: 'task_created' } });
    });
  }

  router.get('/calitate', {}, () => redirect('/calitate/sarcini'));

  // ---- the printable work list (hand-off sheet) ----
  router.get('/sarcini/tipar', {}, (ctx) => {
    const team = tasks.TEAMS.includes(ctx.query.get('team')) ? ctx.query.get('team') : null;
    if (!team || !ctx.modules[team]) return page(errorPage(ctx, 'not_found'), 404);
    ctx.module = team;
    if (!rights(ctx, team).view) return forbidden(ctx);
    const fl = filtersOf(ctx.query);
    const rows = tasks.list(db, queryOf(ctx, fl, team, { limit: 1000 }));
    const group = ctx.query.get('group') === 'person';
    const groups = [];
    if (group) {
      const by = new Map();
      for (const t of rows) for (const a of (t.assignees.length ? t.assignees : [{ id: 0, name: T.tasks.unassigned }])) { if (!by.has(a.id)) by.set(a.id, { name: a.name, rows: [] }); by.get(a.id).rows.push(t); }
      groups.push(...[...by.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }
    const l = lists();
    const person = l.people.find((p) => p.id === fl.person);
    const chips = [T.tasks['view_' + fl.view], person && `${T.tasks.person}: ${person.name}`, fl.overdue && T.tasks.only_overdue, fl.q && `${T.common.search}: ${fl.q}`].filter(Boolean);
    const keep = new URLSearchParams({ ...keepOf(fl), team });
    return page(views.printPage(ctx, { team, rows, company: settings.get(db, 'company.name'), by: ctx.user.full_name, now: nowIso(), filters: chips, group, groups, backHref: `${tasks.teamPath(team)}?${new URLSearchParams(keepOf(fl))}`, hidden: { ...keepOf(fl), team, group: group ? 'person' : '' } }));
  });

  // ---- export of the filtered list (CSV in the language's Excel style, or Excel) ----
  router.get('/sarcini/export', {}, (ctx) => {
    const team = tasks.TEAMS.includes(ctx.query.get('team')) ? ctx.query.get('team') : null;
    if (!team || !ctx.modules[team]) return page(errorPage(ctx, 'not_found'), 404);
    ctx.module = team;
    if (!rights(ctx, team).view) return forbidden(ctx);
    const rows = tasks.list(db, queryOf(ctx, filtersOf(ctx.query), team, { limit: 2000 })).map((t) => ({
      no: t.no, title: t.title, status: T.taskstatus[t.status], priority: views.prioName(t), assigned: t.assignees.map((a) => a.name).join(', '), where: [t.machine_name, t.area].filter(Boolean).join(' · '),
      due: t.due_date, created: t.created_at.slice(0, 10), updated: (t.updated_at || '').slice(0, 10), closed: t.closed_at ? t.closed_at.slice(0, 10) : '', steps: t.check_total ? `${t.check_done}/${t.check_total}` : '',
    }));
    const columns = [['no', 'no'], ['title', 'task'], ['status', 'status_col'], ['priority', 'priority'], ['assigned', 'assigned'], ['where', 'where'], ['due', 'due'], ['created', 'created'], ['updated', 'updated'], ['closed', 'closed'], ['steps', 'checklist']]
      .map(([key, t]) => ({ key, header: T.tasks[t] || T.common.status, type: 'text' }));
    const name = `${team}-tasks-${tasks.today()}`;
    if (ctx.query.get('format') === 'xlsx') return download(xp.toXlsx([{ name: T.modules[team].name.slice(0, 30), columns, rows }]), `${name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return download(xp.toCsv(columns, rows, xp.csvStyle(i18n.current())), `${name}.csv`, 'text/csv; charset=utf-8');
  });

  // ---- the same change for several tasks ----
  router.post('/sarcini/bulk', {}, (ctx) => {
    const team = tasks.TEAMS.includes(ctx.form.get('team')) ? ctx.form.get('team') : null;
    if (!team || !ctx.modules[team]) return page(errorPage(ctx, 'not_found'), 404);
    ctx.module = team;
    if (!rights(ctx, team).update) return forbidden(ctx);
    const back = safeBack(ctx.form.get('back')) || tasks.teamPath(team);
    const ids = ctx.form.all('ids');
    if (!ids.length) return redirect(back, { flash: { type: 'err', key: 'e_nothing_selected' } });
    const r = tasks.bulk(db, ctx.user, team, ids, ctx.form.get('action'), ctx.form.get('v_' + ctx.form.get('action')));
    if (!r.changed) return redirect(back, { flash: { type: 'err', key: 'e_bulk_none' } });
    return redirect(back, { flash: { type: r.skipped ? 'err' : 'ok', key: r.skipped ? 'task_bulk_partial' : 'task_bulk' } });
  });

  // ---- one task ----
  function loadTask(ctx) {
    const t = tasks.detail(db, idOf(ctx.params.id));
    if (!t || !ctx.modules[t.team]) return { fail: page(errorPage(ctx, 'not_found'), 404) };
    ctx.module = t.team;
    const rt = rights(ctx, t.team);
    if (!rt.view) return { fail: forbidden(ctx) };
    return { t, rt };
  }

  function showTask(ctx, t, rt, err, status) {
    const l = lists();
    const src = t.source_kind === 'meeting' && t.source_id ? { href: `/sedinte/${t.source_id}`, text: T.tasks.source.meeting } : t.source_kind === 'ncr' && t.source_id ? { href: `/calitate/neconformitati/${t.source_id}`, text: T.tasks.source.ncr } : null;
    return page(views.taskPage(ctx, { t, can: rt, ranks: ranks(l), base: tasks.teamPath(t.team), lists: l, err, sourceLink: src }), status || 200);
  }

  router.get('/sarcini/:id', {}, (ctx) => { const x = loadTask(ctx); return x.fail || showTask(ctx, x.t, x.rt); });

  router.post('/sarcini/:id/stare', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.update) return forbidden(ctx);
    const r = tasks.changeStatus(db, ctx.user, x.t.id, ctx.form.get('to'), ctx.form.get('comment'));
    const back = safeBack(ctx.form.get('back')) || `/sarcini/${x.t.id}`;
    if (!r.ok) return redirect(`/sarcini/${x.t.id}`, { flash: { type: 'err', key: 'e_' + (r.code === 'invalid' ? 'invalid' : r.code) } });
    return redirect(back, { flash: { key: 'task_status_changed' } });
  });

  router.post('/sarcini/:id/comentariu', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.comment) return forbidden(ctx);
    const r = tasks.comment(db, ctx.user, x.t.id, ctx.form.get('text'));
    return redirect(`/sarcini/${x.t.id}`, r.ok ? { flash: { key: 'task_comment_added' } } : { flash: { type: 'err', key: 'e_invalid' } });
  });

  router.post('/sarcini/:id/planifica', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.update) return forbidden(ctx);
    const postpone = ['1d', '1w', '1m'].includes(ctx.form.get('postpone')) ? ctx.form.get('postpone') : '';
    const r = tasks.plan(db, ctx.user, x.t.id, postpone ? { postpone } : { priority_id: ctx.form.get('priority_id'), due_date: ctx.form.get('due_date') });
    return redirect(`/sarcini/${x.t.id}`, r.ok ? { flash: { key: 'task_saved' } } : { flash: { type: 'err', key: 'e_invalid' } });
  });

  router.post('/sarcini/:id/pas', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.update) return forbidden(ctx);
    const r = tasks.addChecklist(db, ctx.user, x.t.id, ctx.form.get('steps'));
    return redirect(`/sarcini/${x.t.id}#lista`, r.ok ? { flash: { key: 'task_step_added' } } : { flash: { type: 'err', key: 'e_invalid' } });
  });

  router.post('/sarcini/:id/pas/:item/bifeaza', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.update) return forbidden(ctx);
    tasks.setChecked(db, ctx.user, x.t.id, idOf(ctx.params.item), ctx.form.get('done') === '1');
    return redirect(`/sarcini/${x.t.id}#lista`);
  });

  router.post('/sarcini/:id/pas/:item/sterge', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.update) return forbidden(ctx);
    tasks.removeChecklistItem(db, ctx.user, x.t.id, idOf(ctx.params.item));
    return redirect(`/sarcini/${x.t.id}#lista`);
  });

  // one task as a work order on paper: facts, steps with boxes, room for notes and a signature
  router.get('/sarcini/:id/tipar', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    return page(views.workOrderPage(ctx, { t: x.t, company: settings.get(db, 'company.name'), by: ctx.user.full_name, now: nowIso() }));
  });

  router.post('/sarcini/:id/atribuie', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.update) return forbidden(ctx);
    tasks.setAssignees(db, ctx.user, x.t.id, ctx.form.all('assignees'));
    return redirect(`/sarcini/${x.t.id}`, { flash: { key: 'saved' } });
  });

  router.get('/sarcini/:id/editeaza', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.update) return forbidden(ctx);
    return page(views.taskForm(ctx, { team: x.t.team, base: tasks.teamPath(x.t.team), task: x.t, lists: lists(), canAssign: true }));
  });

  router.post('/sarcini/:id/editeaza', {}, (ctx) => {
    const x = loadTask(ctx); if (x.fail) return x.fail;
    if (!x.rt.update) return forbidden(ctx);
    const data = { title: ctx.form.get('title'), description: ctx.form.get('description'), priority_id: ctx.form.get('priority_id'), due_date: ctx.form.get('due_date'), machine_id: ctx.form.get('machine_id'), area: ctx.form.get('area'), assignees: ctx.form.all('assignees') };
    const r = tasks.update(db, ctx.user, x.t.id, data);
    if (!r.ok) return page(views.taskForm(ctx, { team: x.t.team, base: tasks.teamPath(x.t.team), task: x.t, lists: lists(), values: data, errors: r.errors || {}, canAssign: true, assignees: data.assignees.map(Number) }), 422);
    return redirect(`/sarcini/${x.t.id}`, { flash: { key: 'task_saved' } });
  });
};
