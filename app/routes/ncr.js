'use strict';
const { page, redirect, download } = require('../lib/http');
const xp = require('../lib/export');
const i18n = require('../i18n');
const ncr = require('../domain/ncr');
const tasks = require('../domain/tasks');
const settings = require('../domain/settings');
const views = require('../views/ncr');
const { errorPage } = require('../views/errors');
const { nowIso } = require('../lib/time');
const { T, f } = require('../i18n');

const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);
const BASE = '/calitate';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

module.exports = function register(app) {
  const { router, db } = app;
  const forbidden = (ctx) => page(errorPage(ctx, 'forbidden'), 403);
  const notFound = (ctx) => page(errorPage(ctx, 'not_found'), 404);
  const rights = (ctx) => ({ view: ncr.canView(db, ctx.user, ctx.modules), report: ncr.canReport(db, ctx.user, ctx.modules), lead: ncr.canLead(db, ctx.user, ctx.modules) });
  const lists = () => ({
    types: db.all('SELECT * FROM ncr_types WHERE active = 1 ORDER BY sort, name'), dispositions: db.all('SELECT * FROM ncr_dispositions WHERE active = 1 ORDER BY sort, name'),
    priorities: db.all('SELECT * FROM priorities WHERE active = 1 ORDER BY sort, name'), machines: db.all('SELECT id, name FROM machines WHERE active = 1 ORDER BY name'), people: db.all('SELECT * FROM people WHERE active = 1 ORDER BY team, name'),
  });
  const ranks = (l) => new Map(l.priorities.map((p, i) => [p.id, i]));
  const int = (q, k) => (/^\d+$/.test(q.get(k) || '') ? Number(q.get(k)) : null);
  const filtersOf = (ctx) => {
    const q = ctx.query;
    return { view: ['open', 'closed', 'all'].includes(q.get('view')) ? q.get('view') : 'open', status: ncr.STATUSES.includes(q.get('status')) ? q.get('status') : '', type: int(q, 'type'), severity: int(q, 'severity'), machine: int(q, 'machine'),
      q: (q.get('q') || '').trim().slice(0, 60), mine: q.get('mine') === '1', days: int(q, 'days'), sort: ncr.SORT_KEYS.includes(q.get('sort')) ? q.get('sort') : 'new' };
  };
  const queryOf = (ctx, fl, extra) => ({ ...fl, mine: fl.mine ? ctx.user.id : null, ...extra });
  const mainData = (ctx) => ({ title: ctx.form.get('title'), description: ctx.form.get('description'), type_id: ctx.form.get('type_id'), severity_id: ctx.form.get('severity_id'), machine_id: ctx.form.get('machine_id'), product: ctx.form.get('product'), quantity: ctx.form.get('quantity'), reported_at: ctx.form.get('reported_at') });

  // ---- the register ----
  router.get(BASE, {}, (ctx) => {
    const rt = rights(ctx);
    if (!rt.view) return forbidden(ctx);
    const fl = filtersOf(ctx); const l = lists();
    return page(views.listPage(ctx, { rows: ncr.list(db, queryOf(ctx, fl)), f: fl, can: rt, counts: ncr.counts(db), lists: l, ranks: ranks(l) }));
  });

  router.get(`${BASE}/nou`, {}, (ctx) => {
    if (!rights(ctx).report) return forbidden(ctx);
    const rec = ncr.fromMeasurement(db, ctx.query.get('record'));
    const values = rec ? { title: f(T.ncr.title_from, { product: rec.product }), machine_id: rec.machine_id, product: rec.product, source_kind: 'measurement', record_no: rec.record_no } : {};
    return page(views.ncrForm(ctx, { values, lists: lists(), today: ncr.today(), fromRecord: rec ? rec.record_no : null }));
  });
  router.post(`${BASE}/nou`, {}, (ctx) => {
    if (!rights(ctx).report) return forbidden(ctx);
    const data = { ...mainData(ctx), source_kind: ctx.form.get('source_kind'), record_no: ctx.form.get('record_no') };
    const r = ncr.create(db, ctx.user, data);
    if (!r.ok) return page(views.ncrForm(ctx, { values: data, errors: r.errors, lists: lists(), today: ncr.today(), fromRecord: data.record_no || null }), 422);
    return redirect(`${BASE}/neconformitati/${r.id}`, { flash: { key: 'ncr_created' } });
  });

  // ---- the top (for the meeting) ----
  router.get(`${BASE}/top`, {}, (ctx) => {
    if (!rights(ctx).view) return forbidden(ctx);
    const days = [30, 90, 365].includes(int(ctx.query, 'days')) ? int(ctx.query, 'days') : 30;
    const by = ['type', 'machine', 'product'].includes(ctx.query.get('by')) ? ctx.query.get('by') : 'type';
    return page(views.topPage(ctx, { data: ncr.top(db, { days, by }), days, by }));
  });

  // ---- export of the filtered register ----
  router.get(`${BASE}/export`, {}, (ctx) => {
    if (!rights(ctx).view) return forbidden(ctx);
    const rows = ncr.list(db, queryOf(ctx, filtersOf(ctx), { limit: 5000 })).map((n) => ({
      no: n.no, title: n.title, type: n.type_name ? (i18n.current() === 'en' && n.type_name_en ? n.type_name_en : n.type_name) : '', severity: n.severity_name ? (i18n.current() === 'en' && n.severity_name_en ? n.severity_name_en : n.severity_name) : '', machine: n.machine_name || '', product: n.product || '',
      quantity: n.quantity || '', status: T.ncr.status[n.status], reported_at: n.reported_at, reported_by: n.reported_by_name, closed: n.closed_at ? n.closed_at.slice(0, 10) : '', age: n.age_days, tasks: n.tasks_total ? `${n.tasks_total - n.tasks_open}/${n.tasks_total}` : '', external_ref: n.external_ref || '' }));
    const cols = [['no', T.ncr.no], ['title', T.ncr.what], ['type', T.ncr.type], ['severity', T.ncr.severity], ['machine', T.measure.machine], ['product', T.ncr.product], ['quantity', T.ncr.quantity], ['status', T.common.status], ['reported_at', T.ncr.reported], ['reported_by', T.ncr.reported_by],
      ['closed', T.tasks.closed], ['age', T.ncr.age_col], ['tasks', T.ncr.tasks], ['external_ref', T.ncr.external_ref]].map(([key, header]) => ({ key, header, type: 'text' }));
    const name = `ncr-${ncr.today()}`;
    if (ctx.query.get('format') === 'xlsx') return download(xp.toXlsx([{ name: T.ncr.title.slice(0, 30), columns: cols, rows }]), `${name}.xlsx`, XLSX);
    return download(xp.toCsv(cols, rows, xp.csvStyle(i18n.current())), `${name}.csv`, 'text/csv; charset=utf-8');
  });

  // ---- one record ----
  function load(ctx) {
    const n = ncr.detail(db, idOf(ctx.params.id));
    if (!n) return { fail: notFound(ctx) };
    const rt = rights(ctx);
    if (!rt.view) return { fail: forbidden(ctx) };
    return { n, rt };
  }
  const show = (ctx, n, rt, err, status) => { const l = lists(); return page(views.ncrPage(ctx, { n, can: rt, lists: l, ranks: ranks(l), err }), status || 200); };
  const P = `${BASE}/neconformitati/:id`;

  router.get(P, {}, (ctx) => { const x = load(ctx); return x.fail || show(ctx, x.n, x.rt); });
  router.get(`${P}/editeaza`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.lead) return forbidden(ctx);
    return page(views.ncrForm(ctx, { n: x.n, lists: lists(), today: ncr.today() }));
  });
  router.post(`${P}/editeaza`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.lead) return forbidden(ctx);
    const evalPart = ctx.form.get('part') === 'eval';
    const data = evalPart ? { cause: ctx.form.get('cause'), evaluation: ctx.form.get('evaluation'), disposition_id: ctx.form.get('disposition_id') } : { ...mainData(ctx), external_ref: ctx.form.get('external_ref') };
    const r = ncr.update(db, ctx.user, x.n.id, data);
    if (!r.ok) return evalPart ? redirect(`${BASE}/neconformitati/${x.n.id}`, { flash: { type: 'err', key: 'e_invalid' } }) : page(views.ncrForm(ctx, { n: x.n, values: data, errors: r.errors || {}, lists: lists(), today: ncr.today() }), 422);
    return redirect(`${BASE}/neconformitati/${x.n.id}`, { flash: { key: 'ncr_saved' } });
  });
  router.post(`${P}/stare`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.lead) return forbidden(ctx);
    const r = ncr.setStatus(db, ctx.user, x.n.id, ctx.form.get('to'), ctx.form.get('comment'));
    return redirect(`${BASE}/neconformitati/${x.n.id}`, r.ok ? { flash: { key: 'ncr_status_changed' } } : { flash: { type: 'err', key: 'e_' + (r.code === 'reason_required' ? 'reason_required' : r.code === 'disposition_required' ? 'disposition_required' : 'invalid') } });
  });
  router.post(`${P}/comentariu`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.report) return forbidden(ctx);
    const r = ncr.comment(db, ctx.user, x.n.id, ctx.form.get('text'));
    return redirect(`${BASE}/neconformitati/${x.n.id}`, r.ok ? { flash: { key: 'ncr_comment_added' } } : { flash: { type: 'err', key: 'e_invalid' } });
  });
  router.post(`${P}/sarcina`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.lead) return forbidden(ctx);
    const team = ctx.form.get('team');
    if (!tasks.TEAMS.includes(team) || !ctx.modules[team]) return redirect(`${BASE}/neconformitati/${x.n.id}`, { flash: { type: 'err', key: 'e_invalid' } });
    const r = ncr.addTask(db, ctx.user, x.n.id, { team, title: ctx.form.get('title'), priority_id: ctx.form.get('priority_id'), due_date: ctx.form.get('due_date'), assignees: ctx.form.all('assignees') });
    return redirect(`${BASE}/neconformitati/${x.n.id}#tasks`, r.ok ? { flash: { key: 'ncr_task_added' } } : { flash: { type: 'err', key: 'e_invalid' } });
  });
  router.get(`${P}/tipar`, {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    return page(views.printPage(ctx, { n: x.n, company: settings.get(db, 'company.name'), by: ctx.user.full_name, now: nowIso() }));
  });
};
