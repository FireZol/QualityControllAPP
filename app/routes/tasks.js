'use strict';
const { page, redirect } = require('../lib/http');
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
    return { view: ['active', 'closed', 'all'].includes(q.get('view')) ? q.get('view') : 'active', q: (q.get('q') || '').trim().slice(0, 60), person: int('person'), priority: int('priority'), machine: int('machine'), overdue: q.get('overdue') === '1', source_kind: q.get('source') || '' };
  }
  const keepOf = (fl) => Object.fromEntries(Object.entries({ view: fl.view, q: fl.q, person: fl.person, priority: fl.priority, machine: fl.machine, overdue: fl.overdue ? '1' : '' }).filter(([, v]) => v !== '' && v !== null && v !== undefined));

  for (const team of tasks.TEAMS) {
    const base = tasks.teamPath(team);

    router.get(base, {}, (ctx) => {
      const rt = rights(ctx, team);
      if (!rt.view) return forbidden(ctx);
      const fl = filtersOf(ctx.query);
      const l = lists();
      return page(views.boardPage(ctx, { team, base, newPath: `${base}/nou`, rows: tasks.list(db, { ...fl, team }), f: fl, keep: keepOf(fl), lists: l, ranks: ranks(l), counts: tasks.counts(db, team), can: rt }));
    });

    router.get(`${base}/nou`, {}, (ctx) => {
      if (!rights(ctx, team).create) return forbidden(ctx);
      return page(views.taskForm(ctx, { team, base, lists: lists(), values: { priority_id: null }, canAssign: rights(ctx, team).update }));
    });

    router.post(`${base}/nou`, {}, (ctx) => {
      const rt = rights(ctx, team);
      if (!rt.create) return forbidden(ctx);
      const data = { team, title: ctx.form.get('title'), description: ctx.form.get('description'), priority_id: ctx.form.get('priority_id'), due_date: ctx.form.get('due_date'), machine_id: ctx.form.get('machine_id'), area: ctx.form.get('area'), assignees: rt.update ? ctx.form.all('assignees') : [] };
      const r = tasks.create(db, ctx.user, data);
      if (!r.ok) return page(views.taskForm(ctx, { team, base, lists: lists(), values: data, errors: r.errors, canAssign: rt.update, assignees: data.assignees.map(Number) }), 422);
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
    const rows = tasks.list(db, { ...fl, team, limit: 1000 });
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
