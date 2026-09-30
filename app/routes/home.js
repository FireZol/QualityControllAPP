'use strict';
const { page } = require('../lib/http');
const M = require('../domain/measurements');
const A = require('../domain/analytics');
const setup = require('../domain/setup');
const views = require('../views/home');

module.exports = function register(app) {
  app.router.get('/', {}, (ctx) => page(views.homePage(ctx, { setup: ctx.user.role === 'personal' ? [] : setup.checklist(app.db, app.config).filter((_, __, all) => !setup.isComplete(all)), today: M.today(app.db), out: M.outOfLimit24h(app.db), spc: ctx.modules.analytics ? A.spcAlerts(app.db, require('../domain/targets').get(app.db)) : [] })));
};
