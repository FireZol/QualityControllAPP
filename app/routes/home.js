'use strict';
const { page } = require('../lib/http');
const M = require('../domain/measurements');
const A = require('../domain/analytics');
const setup = require('../domain/setup');
const views = require('../views/home');
const tasks = require('../domain/tasks');
const notifications = require('../domain/notifications');
const meetings = require('../domain/meetings');
const preventive = require('../domain/preventive');

module.exports = function register(app) {
  const { db } = app;
  app.router.get('/', {}, (ctx) => {
    const teams = tasks.TEAMS.filter((t) => ctx.modules[t] && tasks.canView(db, ctx.user, t, ctx.modules)).map((t) => ({ team: t, path: tasks.teamPath(t), counts: tasks.counts(db, t), create: tasks.canCreate(db, ctx.user, t, ctx.modules) }));
    if (ctx.modules.maintenance && preventive.canView(db, ctx.user, ctx.modules)) preventive.ensure(db);
    const meet = ctx.modules.meetings && meetings.canView(db, ctx.user, ctx.modules);
    if (meet) { meetings.ensure(db); meetings.remindToday(db); }
    return page(views.homePage(ctx, {
      meetings: meet ? meetings.next(db, 5) : null, canMeet: !!meet && meetings.canCreate(db, ctx.user, ctx.modules),
      setup: ctx.user.role === 'personal' ? [] : setup.checklist(db, app.config).filter((_, __, all) => !setup.isComplete(all)),
      today: M.today(db), out: M.outOfLimit24h(db),
      spc: ctx.modules.analytics ? A.spcAlerts(db, require('../domain/targets').get(db)) : [],
      teams, mine: teams.length ? tasks.mine(db, ctx.user.id, 5).filter((t) => teams.some((x) => x.team === t.team)) : [],
      notes: notifications.list(db, ctx.user.id, { limit: 5 }), unread: notifications.unread(db, ctx.user.id),
      sheets: db.value("SELECT count(*) FROM spec_revisions WHERE status = 'activa'"),
    }));
  });
};
