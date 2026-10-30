'use strict';
const { page, redirect } = require('../lib/http');
const notifications = require('../domain/notifications');
const views = require('../views/notifications');

module.exports = function register(app) {
  const { router, db } = app;

  router.get('/notificari', {}, (ctx) => page(views.notificationsPage(ctx, { rows: notifications.list(db, ctx.user.id, { limit: 200 }) })));

  router.post('/notificari/citite', {}, (ctx) => {
    notifications.markAllRead(db, ctx.user.id);
    return redirect('/notificari');
  });

  // opening a notification marks it read and goes to what it is about
  router.get('/notificari/:id/deschide', {}, (ctx) => {
    const id = /^\d+$/.test(ctx.params.id) ? Number(ctx.params.id) : 0;
    const n = db.get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', id, ctx.user.id);
    if (!n) return redirect('/notificari');
    notifications.markRead(db, ctx.user.id, id);
    return redirect(n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/notificari');
  });
};
