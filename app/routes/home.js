'use strict';
const { page } = require('../lib/http');
const M = require('../domain/measurements');
const views = require('../views/home');

module.exports = function register(app) {
  app.router.get('/', {}, (ctx) => page(views.homePage(ctx, { today: M.today(app.db), out: M.outOfLimit24h(app.db) })));
};
