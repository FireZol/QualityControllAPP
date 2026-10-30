'use strict';
const { page, redirect } = require('../lib/http');
const pm = require('../domain/preventive');
const views = require('../views/preventive');
const { errorPage } = require('../views/errors');

const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);
const BASE = '/mentenanta/preventiv';

module.exports = function register(app) {
  const { router, db } = app;
  const forbidden = (ctx) => page(errorPage(ctx, 'forbidden'), 403);
  const notFound = (ctx) => page(errorPage(ctx, 'not_found'), 404);
  const rights = (ctx) => ({ view: pm.canView(db, ctx.user, ctx.modules), manage: pm.canManage(db, ctx.user, ctx.modules) });
  const lists = () => ({
    people: db.all('SELECT * FROM people WHERE active = 1 ORDER BY team, name'),
    priorities: db.all('SELECT * FROM priorities WHERE active = 1 ORDER BY sort, name'),
    machines: db.all('SELECT id, name FROM machines WHERE active = 1 ORDER BY name'),
  });
  const planData = (ctx) => ({ title: ctx.form.get('title'), description: ctx.form.get('description'), team: ctx.form.get('team'), machine_id: ctx.form.get('machine_id'), area: ctx.form.get('area'), every_n: ctx.form.get('every_n'), unit: ctx.form.get('unit'), basis: ctx.form.get('basis'), weekdays_only: ctx.form.get('weekdays_only'), lead_days: ctx.form.get('lead_days'), priority_id: ctx.form.get('priority_id'), next_due: ctx.form.get('next_due'), people: ctx.form.all('people'), steps: ctx.form.get('steps') });

  router.get(BASE, {}, (ctx) => {
    const rt = rights(ctx);
    if (!rt.view) return forbidden(ctx);
    pm.ensure(db);
    const q = ctx.query;
    const fl = { view: ['active', 'stopped', 'all'].includes(q.get('view')) ? q.get('view') : 'active', machine: /^\d+$/.test(q.get('machine') || '') ? Number(q.get('machine')) : null, q: (q.get('q') || '').trim().slice(0, 60), state: ['overdue', 'due', 'upcoming', 'task'].includes(q.get('state')) ? q.get('state') : '' };
    return page(views.listPage(ctx, { rows: pm.list(db, fl), f: fl, can: rt, counts: pm.counts(db), lists: lists(), base: BASE }));
  });

  router.get(`${BASE}/nou`, {}, (ctx) => {
    if (!rights(ctx).manage) return forbidden(ctx);
    const pre = pm.preset(ctx.query.get('preset'));
    return page(views.planForm(ctx, { values: pre || { next_due: pm.today() }, lists: lists(), base: BASE, preset: pre ? ctx.query.get('preset') : '' }));
  });
  router.post(`${BASE}/nou`, {}, (ctx) => {
    if (!rights(ctx).manage) return forbidden(ctx);
    const data = planData(ctx);
    const r = pm.create(db, ctx.user, data);
    if (!r.ok) return page(views.planForm(ctx, { values: data, errors: r.errors, lists: lists(), base: BASE, people: data.people.map(Number) }), 422);
    pm.ensure(db);
    return redirect(`${BASE}/${r.id}`, { flash: { key: 'pm_saved' } });
  });

  function load(ctx) {
    const p = pm.detail(db, idOf(ctx.params.id));
    if (!p) return { fail: notFound(ctx) };
    const rt = rights(ctx);
    if (!rt.view) return { fail: forbidden(ctx) };
    return { p, rt };
  }
  router.get(`${BASE}/:id`, {}, (ctx) => { const x = load(ctx); return x.fail || page(views.planPage(ctx, { p: x.p, can: x.rt, base: BASE })); });
  router.get(`${BASE}/:id/editeaza`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.manage) return forbidden(ctx);
    return page(views.planForm(ctx, { p: x.p, lists: lists(), base: BASE }));
  });
  router.post(`${BASE}/:id/editeaza`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.manage) return forbidden(ctx);
    const data = planData(ctx);
    const r = pm.update(db, ctx.user, x.p.id, data);
    if (!r.ok) return page(views.planForm(ctx, { p: x.p, values: data, errors: r.errors || {}, lists: lists(), base: BASE, people: data.people.map(Number) }), 422);
    pm.ensure(db);
    return redirect(`${BASE}/${x.p.id}`, { flash: { key: 'pm_saved' } });
  });
  router.post(`${BASE}/:id/genereaza`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.manage) return forbidden(ctx);
    const r = pm.generateNow(db, ctx.user, x.p.id);
    return r.ok ? redirect(`/sarcini/${r.task_id}`, { flash: { key: 'pm_task_made' } }) : redirect(`${BASE}/${x.p.id}`, { flash: { type: 'err', key: 'e_pm_exists' } });
  });
  router.post(`${BASE}/:id/sari`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.manage) return forbidden(ctx);
    const r = pm.skip(db, ctx.user, x.p.id, ctx.form.get('reason'));
    return redirect(`${BASE}/${x.p.id}`, r.ok ? { flash: { key: 'pm_skipped' } } : { flash: { type: 'err', key: r.code === 'reason_required' ? 'e_reason_required' : 'e_pm_exists' } });
  });
  router.post(`${BASE}/:id/activ`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.manage) return forbidden(ctx);
    pm.setActive(db, ctx.user, x.p.id, ctx.form.get('active') === '1');
    if (ctx.form.get('active') === '1') pm.ensure(db);
    return redirect(`${BASE}/${x.p.id}`, { flash: { key: 'pm_saved' } });
  });
};
