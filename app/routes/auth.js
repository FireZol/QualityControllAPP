'use strict';
const { page, redirect, cookie, randomToken } = require('../lib/http');
const auth = require('../lib/auth');
const audit = require('../domain/audit');
const { T } = require('../i18n');
const views = require('../views/auth');

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + Buffer.alloc(64).toString('base64url');

function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') && !n.startsWith('/login') ? n : '/';
}

const i18n = require('../i18n');

function safeBack(b) {
  return typeof b === 'string' && b.startsWith('/') && !b.startsWith('//') && !b.startsWith('/\\') ? b : '/';
}

module.exports = function register(app) {
  const { router, db } = app;

  // language switch: a logged-in user's choice is stored on the account; everyone also gets a cookie (used on the login page)
  function setLanguage(ctx) {
    const lang = ctx.form.get('lang');
    const back = safeBack(ctx.form.get('back'));
    if (!i18n.valid(lang)) return redirect(back);
    if (ctx.user) db.run('UPDATE users SET language = ? WHERE id = ?', lang, ctx.user.id);
    const res = redirect(back);
    res.cookies = (res.cookies || []).concat(cookie('ctc_lang', lang, { maxAge: 365 * 24 * 3600 }));
    return res;
  }
  router.post('/limba', {}, setLanguage);
  router.post('/limba/login', { public: true, csrf: 'login' }, setLanguage);

  router.get('/login', { public: true }, (ctx) => {
    if (ctx.user) return redirect('/');
    const token = ctx.cookies.ctc_lt || randomToken(24);
    ctx.loginToken = token;
    const res = page(views.loginPage(ctx, { next: ctx.query.get('next') || '' }));
    res.cookies = [cookie('ctc_lt', token)];
    return res;
  });

  router.post('/login', { public: true, csrf: 'login' }, async (ctx) => {
    const username = ctx.form.get('username').trim().slice(0, 80);
    const password = ctx.form.get('password').slice(0, 200);
    const next = safeNext(ctx.form.get('next'));
    ctx.loginToken = ctx.cookies.ctc_lt;
    const fail = (opts) => {
      const res = page(views.loginPage(ctx, { username, next, ...opts }), 401);
      return res;
    };
    const lock = auth.isLocked(db, username);
    if (lock.locked) {
      audit.log(db, null, 'login_blocked', 'users', null, { username });
      return fail({ lockedMinutes: lock.minutes });
    }
    const user = db.get('SELECT * FROM users WHERE username = ? AND active = 1', username);
    const ok = await auth.verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      auth.recordAttempt(db, username, false);
      audit.log(db, user ? user.id : null, 'login_failed', 'users', user ? user.id : null, { username });
      const after = auth.isLocked(db, username);
      return fail(after.locked ? { lockedMinutes: after.minutes } : { error: T.login.failed });
    }
    auth.recordAttempt(db, username, true);
    const token = auth.createSession(db, user.id);
    audit.log(db, user.id, 'login', 'users', user.id, {});
    const res = redirect(user.must_change_password ? '/parola' : next);
    res.cookies = [cookie('ctc_sid', token), cookie('ctc_lt', '', { maxAge: 0 })];
    return res;
  });

  router.post('/iesire', {}, (ctx) => {
    auth.destroySession(db, ctx.cookies.ctc_sid);
    audit.log(db, ctx.user.id, 'logout', 'users', ctx.user.id, {});
    const res = redirect('/login');
    res.cookies = [cookie('ctc_sid', '', { maxAge: 0 })];
    return res;
  });

  router.get('/parola', {}, (ctx) => page(views.passwordPage(ctx, { forced: !!ctx.user.must_change_password })));

  router.post('/parola', {}, async (ctx) => {
    const errors = {};
    const cur = ctx.form.get('current'), pw = ctx.form.get('new'), conf = ctx.form.get('confirm');
    if (!(await auth.verifyPassword(cur, ctx.user.password_hash))) errors.current = 'password_wrong';
    const bad = auth.validateNewPassword(pw, ctx.user.username);
    if (bad) errors.new = bad;
    else if (pw === cur) errors.new = 'password_same';
    if (!errors.new && pw !== conf) errors.confirm = 'password_mismatch';
    if (Object.keys(errors).length) return page(views.passwordPage(ctx, { errors, forced: !!ctx.user.must_change_password }), 422);
    const hash = await auth.hashPassword(pw);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hash, ctx.user.id);
      db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', ctx.user.id, ctx.session.hash);
      audit.log(db, ctx.user.id, 'password_change', 'users', ctx.user.id, {});
    });
    return redirect('/', { flash: { key: 'password_changed' } });
  });
};
