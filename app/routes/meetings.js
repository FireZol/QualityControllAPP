'use strict';
const { page, redirect, download } = require('../lib/http');
const xp = require('../lib/export');
const i18n = require('../i18n');
const custom = require('../domain/custom');
const { T } = require('../i18n');
const meetings = require('../domain/meetings');
const settings = require('../domain/settings');
const views = require('../views/meetings');
const { errorPage } = require('../views/errors');
const { nowIso } = require('../lib/time');

const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);

module.exports = function register(app) {
  const { router, db } = app;
  const forbidden = (ctx) => page(errorPage(ctx, 'forbidden'), 403);
  const notFound = (ctx) => page(errorPage(ctx, 'not_found'), 404);
  const rights = (ctx) => ({ view: meetings.canView(db, ctx.user, ctx.modules), create: meetings.canCreate(db, ctx.user, ctx.modules), lead: meetings.canLead(db, ctx.user, ctx.modules) });
  const people = () => db.all('SELECT * FROM people WHERE active = 1 ORDER BY team, name');
  const lists = () => ({ people: people(), priorities: db.all('SELECT * FROM priorities WHERE active = 1 ORDER BY sort, name') });
  const myPeople = (ctx) => db.all('SELECT id FROM people WHERE user_id = ? AND active = 1', ctx.user.id).map((r) => r.id);
  const refresh = () => { meetings.ensure(db); meetings.remindToday(db); };
  const meetingData = (ctx) => ({ title: ctx.form.get('title'), meeting_date: ctx.form.get('meeting_date'), start_time: ctx.form.get('start_time'), duration_min: ctx.form.get('duration_min'), location: ctx.form.get('location'), teams: ctx.form.all('teams'), agenda: ctx.form.get('agenda'), attendees: ctx.form.all('attendees') });
  const seriesData = (ctx) => ({ title: ctx.form.get('title'), teams: ctx.form.all('teams'), days: ctx.form.all('days'), interval_weeks: ctx.form.get('interval_weeks'), start_time: ctx.form.get('start_time'), duration_min: ctx.form.get('duration_min'), location: ctx.form.get('location'), starts_on: ctx.form.get('starts_on'), ends_on: ctx.form.get('ends_on'), people: ctx.form.all('people') });

  const cfFields = () => custom.defs(db, 'meeting');
  const cfShown = () => custom.shown(db, 'meeting');
  const cfParse = (ctx, fields, current) => custom.parse(fields, (k) => ctx.form.get(k), current);
  const filtersOf = (ctx) => {
    const q = ctx.query;
    const fl = { view: ['upcoming', 'past', 'all'].includes(q.get('view')) ? q.get('view') : 'upcoming', team: meetings.TEAMS.includes(q.get('team')) ? q.get('team') : '', mine: q.get('mine') === '1', q: (q.get('q') || '').trim().slice(0, 60), custom: custom.filters(cfFields(), q) };
    const me = myPeople(ctx);
    return { fl, me, query: { view: fl.view, team: fl.team, q: fl.q, persons: fl.mine ? (me.length ? me : [-1]) : null, custom: fl.custom } };
  };

  // ---- the list ----
  router.get('/sedinte', {}, (ctx) => {
    const rt = rights(ctx);
    if (!rt.view) return forbidden(ctx);
    refresh();
    const { fl, me, query } = filtersOf(ctx);
    const keep = Object.fromEntries(Object.entries({ view: fl.view, team: fl.team, mine: fl.mine ? '1' : '', q: fl.q, ...custom.keep(fl.custom) }).filter(([, v]) => v));
    const rows = meetings.list(db, query);
    return page(views.listPage(ctx, { rows, f: fl, keep, base: '/sedinte', counts: meetings.counts(db), can: rt, hasPerson: me.length > 0, cf: { filterFields: cfFields(), fields: cfShown(), values: custom.valuesOfMany(db, 'meeting', rows.map((m) => m.id)) } }));
  });

  // the filtered list as CSV / Excel (before /sedinte/:id: the router takes the first match)
  router.get('/sedinte/export', {}, (ctx) => {
    if (!rights(ctx).view) return forbidden(ctx);
    const { query } = filtersOf(ctx);
    const found = meetings.list(db, { ...query, limit: 2000 });
    const cfs = cfShown();
    const rows = custom.exportRows(db, 'meeting', cfs, found.map((m) => m.id), found.map((m) => ({
      date: m.meeting_date, start: m.start_time, title: m.title, teams: m.teamList.map((t) => T.modules[t].name).join(', '), where: m.location || '', status: T.meetings.status[m.status],
      invited: m.invited, present: m.status === 'held' ? m.present_n : '', decisions: m.decisions,
    })));
    const cols = [['date', T.common.date], ['start', T.meetings.start], ['title', T.meetings.name], ['teams', T.meetings.teams], ['where', T.meetings.where], ['status', T.common.status], ['invited', T.meetings.invited], ['present', T.meetings.present], ['decisions', T.meetings.decisions]]
      .map(([key, header]) => ({ key, header, type: 'text' })).concat(custom.exportColumns(cfs));
    const name = `meetings-${meetings.today()}`;
    if (ctx.query.get('format') === 'xlsx') return download(xp.toXlsx([{ name: T.meetings.title.slice(0, 30), columns: cols, rows }]), `${name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return download(xp.toCsv(cols, rows, xp.csvStyle(i18n.current())), `${name}.csv`, 'text/csv; charset=utf-8');
  });

  router.get('/sedinte/nou', {}, (ctx) => {
    if (!rights(ctx).create) return forbidden(ctx);
    const team = meetings.TEAMS.includes(ctx.query.get('team')) ? ctx.query.get('team') : '';
    const all = people();
    return page(views.meetingForm(ctx, { values: { teams: team ? [team] : [], meeting_date: meetings.today() }, people: all, attendees: team ? all.filter((p) => p.team === team).map((p) => p.id) : [], cfFields: cfFields(), cfv: {} }));
  });

  router.post('/sedinte/nou', {}, (ctx) => {
    if (!rights(ctx).create) return forbidden(ctx);
    const data = meetingData(ctx);
    const fields = cfFields(); const cf = cfParse(ctx, fields);
    const r = meetings.createMeeting(db, ctx.user, { ...data, custom: cf });
    if (!r.ok) return page(views.meetingForm(ctx, { values: data, errors: r.errors, people: people(), attendees: data.attendees.map(Number), cfFields: fields, cfv: cf.values }), 422);
    return redirect(`/sedinte/${r.id}`, { flash: { key: 'meeting_created' } });
  });

  // ---- series (leads) ----
  router.get('/sedinte/serii', {}, (ctx) => {
    if (!rights(ctx).lead) return forbidden(ctx);
    return page(views.seriesListPage(ctx, { rows: meetings.seriesList(db) }));
  });
  router.get('/sedinte/serii/nou', {}, (ctx) => {
    if (!rights(ctx).lead) return forbidden(ctx);
    return page(views.seriesForm(ctx, { values: { days: [1, 2, 3, 4, 5], teams: [] }, people: people() }));
  });
  router.post('/sedinte/serii/nou', {}, (ctx) => {
    if (!rights(ctx).lead) return forbidden(ctx);
    const data = seriesData(ctx);
    const r = meetings.createSeries(db, ctx.user, data);
    if (!r.ok) return page(views.seriesForm(ctx, { values: data, errors: r.errors, people: people(), people_sel: data.people.map(Number) }), 422);
    meetings.ensure(db);
    return redirect('/sedinte/serii', { flash: { key: 'series_saved' } });
  });
  router.get('/sedinte/serii/:id/editeaza', {}, (ctx) => {
    if (!rights(ctx).lead) return forbidden(ctx);
    const s = meetings.seriesGet(db, idOf(ctx.params.id));
    return s ? page(views.seriesForm(ctx, { s, people: people() })) : notFound(ctx);
  });
  router.post('/sedinte/serii/:id/editeaza', {}, (ctx) => {
    if (!rights(ctx).lead) return forbidden(ctx);
    const s = meetings.seriesGet(db, idOf(ctx.params.id));
    if (!s) return notFound(ctx);
    const data = seriesData(ctx);
    const r = meetings.updateSeries(db, ctx.user, s.id, data);
    if (!r.ok) return page(views.seriesForm(ctx, { s, values: data, errors: r.errors || {}, people: people(), people_sel: data.people.map(Number) }), 422);
    return redirect('/sedinte/serii', { flash: { key: 'series_saved' } });
  });
  router.post('/sedinte/serii/:id/activ', {}, (ctx) => {
    if (!rights(ctx).lead) return forbidden(ctx);
    const r = meetings.setSeriesActive(db, ctx.user, idOf(ctx.params.id), ctx.form.get('active') === '1');
    if (!r.ok) return notFound(ctx);
    meetings.ensure(db);
    return redirect('/sedinte/serii', { flash: { key: 'series_saved' } });
  });

  // ---- one meeting ----
  function load(ctx) {
    const m = meetings.detail(db, idOf(ctx.params.id));
    if (!m) return { fail: notFound(ctx) };
    const rt = rights(ctx);
    if (!rt.view) return { fail: forbidden(ctx) };
    return { m, rt };
  }
  const show = (ctx, m, rt, err, status) => page(views.meetingPage(ctx, { m, can: rt, lists: lists(), err, cf: { fields: cfShown(), values: custom.valuesOf(db, 'meeting', m.id) } }), status || 200);

  router.get('/sedinte/:id', {}, (ctx) => { const x = load(ctx); return x.fail || show(ctx, x.m, x.rt); });

  router.get('/sedinte/:id/editeaza', {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.create) return forbidden(ctx);
    const cur = custom.valuesOf(db, 'meeting', x.m.id);
    return page(views.meetingForm(ctx, { m: x.m, people: people(), attendees: x.m.attendees.map((a) => a.id), cfFields: cfFields(), cfv: cur, cfCurrent: cur }));
  });
  router.post('/sedinte/:id/editeaza', {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.create) return forbidden(ctx);
    const data = meetingData(ctx);
    const fields = cfFields(); const cur = custom.valuesOf(db, 'meeting', x.m.id); const cf = cfParse(ctx, fields, cur);
    const r = meetings.updateMeeting(db, ctx.user, x.m.id, { ...data, custom: cf });
    if (!r.ok) return page(views.meetingForm(ctx, { m: x.m, values: data, errors: r.errors || {}, people: people(), attendees: data.attendees.map(Number), cfFields: fields, cfv: cf.values, cfCurrent: cur }), 422);
    return redirect(`/sedinte/${x.m.id}`, { flash: { key: 'meeting_saved' } });
  });

  router.post('/sedinte/:id/stare', {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    const to = ctx.form.get('to');
    if (!(to === 'held' ? x.rt.create : x.rt.lead)) return forbidden(ctx);
    const r = meetings.setStatus(db, ctx.user, x.m.id, to, ctx.form.get('reason'));
    return redirect(`/sedinte/${x.m.id}`, r.ok ? { flash: { key: 'meeting_status_changed' } } : { flash: { type: 'err', key: 'e_' + (r.code === 'reason_required' ? 'reason_required' : 'invalid') } });
  });

  router.post('/sedinte/:id/note', {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.create) return forbidden(ctx);
    meetings.saveNotes(db, ctx.user, x.m.id, { agenda: ctx.form.get('agenda'), minutes: ctx.form.get('minutes') });
    return redirect(`/sedinte/${x.m.id}`, { flash: { key: 'meeting_saved' } });
  });

  router.post('/sedinte/:id/prezenta', {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.create) return forbidden(ctx);
    meetings.setAttendance(db, ctx.user, x.m.id, ctx.form.all('present'), ctx.form.all('extra'));
    return redirect(`/sedinte/${x.m.id}`, { flash: { key: 'meeting_attendance_saved' } });
  });

  router.post('/sedinte/:id/decizie', {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    if (!x.rt.create) return forbidden(ctx);
    const team = ctx.form.get('team');
    if (team && !ctx.modules[team]) return redirect(`/sedinte/${x.m.id}#decisions`, { flash: { type: 'err', key: 'e_invalid' } });
    const r = meetings.addDecision(db, ctx.user, x.m.id, { text: ctx.form.get('text'), team, priority_id: ctx.form.get('priority_id'), due_date: ctx.form.get('due_date'), assignees: ctx.form.all('assignees') });
    return redirect(`/sedinte/${x.m.id}#decisions`, r.ok ? { flash: { key: 'meeting_decision_added' } } : { flash: { type: 'err', key: 'e_invalid' } });
  });

  router.get('/sedinte/:id/tipar', {}, (ctx) => {
    const x = load(ctx); if (x.fail) return x.fail;
    return page(views.minutesPage(ctx, { m: x.m, cf: { fields: cfShown(), values: custom.valuesOf(db, 'meeting', x.m.id) }, company: settings.get(db, 'company.name'), by: ctx.user.full_name, now: nowIso() }));
  });
};
