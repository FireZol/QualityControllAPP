'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { page, redirect } = require('../lib/http');
const auth = require('../lib/auth');
const audit = require('../domain/audit');
const settings = require('../domain/settings');
const modules = require('../domain/modules');
const golive = require('../domain/golive');
const backup = require('../lib/backup');
const { nowIso } = require('../lib/time');
const views = require('../views/admin');
const { errorPage } = require('../views/errors');

const ADMIN = ['administrator'];
const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);
const RE_HM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const RE_USER = /^[A-Za-z0-9._-]{3,40}$/;
const RE_BIND = /^(\d{1,3}(\.\d{1,3}){3}|::|::1|localhost|[0-9a-fA-F:]+)$/;

module.exports = function register(app) {
  const { router, db, config } = app;

  // ---------- users ----------

  const activeAdmins = () => db.value("SELECT count(*) FROM users WHERE role = 'administrator' AND active = 1");

  router.get('/admin/utilizatori', { roles: ADMIN }, (ctx) => page(views.usersPage(ctx, db.all('SELECT * FROM users ORDER BY active DESC, username'))));

  router.get('/admin/utilizatori/nou', { roles: ADMIN }, (ctx) => page(views.userForm(ctx, {})));

  router.post('/admin/utilizatori/nou', { roles: ADMIN }, async (ctx) => {
    const errors = {};
    const values = { username: ctx.form.get('username').trim(), full_name: ctx.form.get('full_name').trim(), role: ctx.form.get('role'), job_title: ctx.form.get('job_title').trim() };
    if (!RE_USER.test(values.username)) errors.username = 'invalid';
    else if (db.get('SELECT 1 FROM users WHERE username = ?', values.username)) errors.username = 'duplicate';
    if (!values.full_name) errors.full_name = 'required'; else if (values.full_name.length > 120) errors.full_name = 'too_long';
    if (!auth.ROLES.includes(values.role)) errors.role = 'invalid';
    if (values.job_title.length > 80) errors.job_title = 'too_long';
    if (Object.keys(errors).length) return page(views.userForm(ctx, { values, errors }), 422);
    const password = auth.generatePassword(12);
    const hash = await auth.hashPassword(password);
    const id = db.tx(() => {
      const uid = db.run('INSERT INTO users(username, full_name, role, job_title, password_hash, must_change_password, active, created_at) VALUES (?,?,?,?,?,1,1,?)',
        values.username, values.full_name, values.role, values.job_title || null, hash, nowIso()).id;
      audit.log(db, ctx.user.id, 'user_create', 'users', uid, { username: values.username, role: values.role });
      return uid;
    });
    return page(views.passwordShown(ctx, { user: db.get('SELECT * FROM users WHERE id = ?', id), password }));
  });

  router.get('/admin/utilizatori/:id', { roles: ADMIN }, (ctx) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', idOf(ctx.params.id));
    if (!user) return page(errorPage(ctx, 'not_found'), 404);
    return page(views.userForm(ctx, { user, self: user.id === ctx.user.id }));
  });

  router.post('/admin/utilizatori/:id', { roles: ADMIN }, (ctx) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', idOf(ctx.params.id));
    if (!user) return page(errorPage(ctx, 'not_found'), 404);
    const errors = {};
    const values = { full_name: ctx.form.get('full_name').trim(), role: ctx.form.get('role'), job_title: ctx.form.get('job_title').trim(), active: ctx.form.bool('active') ? 1 : 0 };
    if (!values.full_name) errors.full_name = 'required'; else if (values.full_name.length > 120) errors.full_name = 'too_long';
    if (!auth.ROLES.includes(values.role)) errors.role = 'invalid';
    if (values.job_title.length > 80) errors.job_title = 'too_long';
    const self = user.id === ctx.user.id;
    if (self && !values.active) errors.active = 'own_account';
    const losesAdmin = user.role === 'administrator' && user.active && (values.role !== 'administrator' || !values.active);
    if (losesAdmin && activeAdmins() <= 1) errors.role = 'last_admin';
    if (Object.keys(errors).length) return page(views.userForm(ctx, { user, values: { ...values, username: user.username }, errors, self }), 422);
    db.tx(() => {
      db.run('UPDATE users SET full_name = ?, role = ?, job_title = ?, active = ? WHERE id = ?', values.full_name, values.role, values.job_title || null, values.active, user.id);
      if (!values.active || values.role !== user.role) auth.destroyUserSessions(db, user.id);
      audit.log(db, ctx.user.id, 'user_edit', 'users', user.id, { before: { role: user.role, active: user.active, full_name: user.full_name }, after: values });
    });
    return redirect('/admin/utilizatori', { flash: { key: 'saved' } });
  });

  router.post('/admin/utilizatori/:id/parola', { roles: ADMIN }, async (ctx) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', idOf(ctx.params.id));
    if (!user) return page(errorPage(ctx, 'not_found'), 404);
    const password = auth.generatePassword(12);
    const hash = await auth.hashPassword(password);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', hash, user.id);
      auth.destroyUserSessions(db, user.id);
      db.run('DELETE FROM login_attempts WHERE username = ?', user.username);
      audit.log(db, ctx.user.id, 'password_reset', 'users', user.id, {});
    });
    return page(views.passwordShown(ctx, { user, password }));
  });

  // ---------- settings ----------

  const SETTING_KEYS = ['server.port', 'server.bind', 'server.public_name', 'session.idle_hours', 'backup.dir', 'backup.time', 'backup.keep', 'shift.day_start', 'shift.night_start'];

  function settingsView(ctx, extra) {
    const values = extra && extra.values ? extra.values : settings.all(db);
    if (!extra || !extra.values) [values['cycle.day'], values['cycle.off1'], values['cycle.night'], values['cycle.off2']] = values['shift.cycle'];
    const dir = backup.backupDir(db, config);
    values.production_started_at = settings.get(db, 'production.started_at');
    return views.settingsPage(ctx, { values, errors: extra && extra.errors, backups: backup.listBackups(dir), backupDir: dir, backupError: extra && extra.backupError });
  }

  router.get('/admin/setari', { roles: ADMIN }, (ctx) => page(settingsView(ctx)));

  router.post('/admin/setari', { roles: ADMIN }, (ctx) => {
    const errors = {};
    const raw = {};
    for (const k of SETTING_KEYS) raw[k] = ctx.form.get(k).trim();
    raw['backup.auto'] = ctx.form.bool('backup.auto');
    raw['feedback.email'] = ctx.form.get('feedback.email').trim();
    const CYCLE = ['day', 'off1', 'night', 'off2'];
    for (const k of CYCLE) raw['cycle.' + k] = ctx.form.get('cycle.' + k).trim();
    raw['modules.cable'] = ctx.form.bool('modules.cable');
    raw['modules.analytics'] = ctx.form.bool('modules.analytics');
    const parsed = {};
    const port = /^\d{1,5}$/.test(raw['server.port']) ? Number(raw['server.port']) : 0;
    if (port < 1 || port > 65535) errors['server.port'] = 'invalid'; else parsed['server.port'] = port;
    if (!RE_BIND.test(raw['server.bind'])) errors['server.bind'] = 'invalid'; else parsed['server.bind'] = raw['server.bind'];
    if (raw['server.public_name'].length > 120) errors['server.public_name'] = 'too_long'; else parsed['server.public_name'] = raw['server.public_name'];
    const idle = /^\d{1,3}$/.test(raw['session.idle_hours']) ? Number(raw['session.idle_hours']) : 0;
    if (idle < 1 || idle > 168) errors['session.idle_hours'] = 'invalid'; else parsed['session.idle_hours'] = idle;
    if (raw['backup.dir'] && raw['backup.dir'].length > 260) errors['backup.dir'] = 'too_long'; else parsed['backup.dir'] = raw['backup.dir'] || null;
    for (const k of ['backup.time', 'shift.day_start', 'shift.night_start']) {
      if (!RE_HM.test(raw[k])) errors[k] = 'invalid'; else parsed[k] = raw[k].padStart(5, '0');
    }
    const keep = /^\d{1,3}$/.test(raw['backup.keep']) ? Number(raw['backup.keep']) : 0;
    if (keep < 1 || keep > 365) errors['backup.keep'] = 'invalid'; else parsed['backup.keep'] = keep;
    parsed['backup.auto'] = raw['backup.auto'];
    if (raw['feedback.email'] && !/^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,120}$/.test(raw['feedback.email'])) errors['feedback.email'] = 'invalid'; else parsed['feedback.email'] = raw['feedback.email'];
    parsed['modules.cable'] = raw['modules.cable'];
    parsed['modules.analytics'] = raw['modules.analytics'];
    if (!errors['shift.day_start'] && !errors['shift.night_start'] && parsed['shift.day_start'] >= parsed['shift.night_start']) errors['shift.night_start'] = 'invalid';
    const cycleSent = CYCLE.some((k) => ctx.form.params.has('cycle.' + k)); // an older form without the cycle fields leaves it unchanged
    const cyc = CYCLE.map((k) => (/^\d{1,2}$/.test(raw['cycle.' + k]) ? Number(raw['cycle.' + k]) : -1));
    if (cycleSent) CYCLE.forEach((k, i) => { if (cyc[i] < 0 || cyc[i] > 30) errors['cycle.' + k] = 'invalid'; });
    if (cycleSent && !CYCLE.some((k) => errors['cycle.' + k])) {
      if (cyc[0] < 1) errors['cycle.day'] = 'invalid';
      if (cyc[2] < 1) errors['cycle.night'] = 'invalid';
      if (cyc.reduce((a, b) => a + b, 0) > 60) errors['cycle.off2'] = 'invalid';
    }
    if (cycleSent && !Object.keys(errors).some((k) => k.startsWith('cycle.'))) parsed['shift.cycle'] = cyc;
    if (Object.keys(errors).length) return page(settingsView(ctx, { values: { ...raw }, errors }), 422);
    const before = settings.all(db);
    const changed = {};
    db.tx(() => {
      for (const [k, v] of Object.entries(parsed)) {
        if (JSON.stringify(before[k]) !== JSON.stringify(v)) {
          changed[k] = { from: before[k], to: v };
          if (k.startsWith('modules.')) modules.set(db, k.slice('modules.'.length), v); else settings.set(db, k, v);
        }
      }
      if (Object.keys(changed).length) audit.log(db, ctx.user.id, 'setting_change', 'settings', null, changed);
    });
    const restart = ['server.port', 'server.bind', 'server.public_name'].some((k) => changed[k]);
    return redirect('/admin/setari', { flash: { key: restart ? 'settings_saved_restart' : 'saved' } });
  });

  // ---------- start production (one-time clearing of the pilot's measurements) ----------

  router.get('/admin/productie', { roles: ADMIN }, (ctx) => {
    const st = golive.status(db);
    if (st.startedAt) return redirect('/admin/setari', { flash: { type: 'err', key: 'e_golive_done' } });
    return page(views.golivePage(ctx, { st, word: golive.CONFIRM_WORD }));
  });

  router.post('/admin/productie', { roles: ADMIN }, (ctx) => {
    const r = golive.run(db, config, ctx.user, ctx.form.get('confirm'));
    if (r.ok) return redirect('/admin/setari', { flash: { key: 'golive_done' } });
    if (r.code === 'golive_confirm') return page(views.golivePage(ctx, { st: golive.status(db), word: golive.CONFIRM_WORD, errors: { confirm: 'invalid' } }), 422);
    return redirect('/admin/setari', { flash: { type: 'err', key: 'e_' + r.code } });
  });

  router.post('/admin/setari/backup', { roles: ADMIN }, (ctx) => {
    const r = backup.backupNow(db, config, ctx.user.id, 'manual');
    if (!r.ok) return page(settingsView(ctx, { backupError: r.error }), 500);
    return redirect('/admin/setari', { flash: { key: 'backup_done' } });
  });

  router.get('/admin/setari/restaurare', { roles: ADMIN }, (ctx) => {
    const name = ctx.query.get('f') || '';
    if (!backup.NAME_RE.test(name) || !fs.existsSync(path.join(backup.backupDir(db, config), name))) return page(errorPage(ctx, 'not_found'), 404);
    return page(views.restorePage(ctx, { name }));
  });

  router.post('/admin/setari/restaurare', { roles: ADMIN }, (ctx) => {
    const name = ctx.form.get('file');
    if (!backup.NAME_RE.test(name)) return page(errorPage(ctx, 'not_found'), 404);
    if (ctx.form.get('confirm_name').trim() !== name) return page(views.restorePage(ctx, { name, errors: { confirm_name: 'restore_mismatch' } }), 422);
    const r = backup.restore(app, name, ctx.user.id);
    if (!r.ok) return redirect('/admin/setari', { flash: { type: 'err', key: 'e_restore_' + r.code } });
    // the restored database has its own sessions: the current one may be gone, in which case the next request asks for login
    return redirect('/admin/setari', { flash: { key: 'restore_done' } });
  });

  // ---------- audit log ----------

  router.get('/admin/jurnal', { roles: ADMIN }, (ctx) => {
    const q = ctx.query;
    const filters = { user_id: /^\d+$/.test(q.get('user_id') || '') ? Number(q.get('user_id')) : '', action: (q.get('action') || '').slice(0, 40), from: /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') || '') ? q.get('from') : '', to: /^\d{4}-\d{2}-\d{2}$/.test(q.get('to') || '') ? q.get('to') : '' };
    const where = [], p = [];
    if (filters.user_id) { where.push('a.user_id = ?'); p.push(filters.user_id); }
    if (filters.action) { where.push('a.action = ?'); p.push(filters.action); }
    if (filters.from) { where.push('a.ts >= ?'); p.push(filters.from); }
    if (filters.to) { where.push('a.ts < ?'); p.push(filters.to + 'T99'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.value(`SELECT count(*) FROM audit_log a ${w}`, ...p);
    const size = 100;
    const pages = Math.max(1, Math.ceil(total / size));
    const pg = Math.min(pages, Math.max(1, /^\d+$/.test(q.get('pagina') || '') ? Number(q.get('pagina')) : 1));
    const rows = db.all(`SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w} ORDER BY a.id DESC LIMIT ${size} OFFSET ${(pg - 1) * size}`, ...p);
    return page(views.auditPage(ctx, {
      rows, page: pg, pages, total, filters,
      users: db.all('SELECT id, username FROM users ORDER BY username'),
      actions: db.all('SELECT DISTINCT action FROM audit_log ORDER BY action').map((r) => r.action),
    }));
  });
};
