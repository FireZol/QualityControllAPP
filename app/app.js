'use strict';
// Application assembly: database, migrations, seed, router, HTTP server.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Db, migrate } = require('./db/db');
const { seedIfEmpty, ensureAdmin } = require('./db/seed');
const { Router } = require('./lib/router');
const H = require('./lib/http');
const auth = require('./lib/auth');
const settings = require('./domain/settings');
const backup = require('./lib/backup');
const audit = require('./domain/audit');
const { T, S } = require('./i18n/ro');
const { errorPage } = require('./views/errors');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DOMAIN_DIR = path.join(__dirname, 'domain');

/**
 * @param config {root, port, bind, publicName, dataDir, backupDir, seedDir, envPort, envBind}
 * @param opts   {log: fn, listen: {port, host}}  (tests pass listen to bind an ephemeral port)
 */
async function createApp(config, opts) {
  const o = opts || {};
  const log = o.log || ((m) => console.log(m));
  const db = new Db(path.join(config.dataDir, 'ctc.db'));
  const state = { maintenance: false };
  const mig = migrate(db, { dir: o.migrationsDir || path.join(__dirname, 'db', 'migrations'), backupDir: () => backup.backupDir(db, config) });
  if (mig.backup) log(`Backup înainte de migrare: ${mig.backup}`);
  if (mig.applied.length) log(`Migrări aplicate: ${mig.applied.join(', ')}`);
  seedIfEmpty(db, { seedDir: config.seedDir, config, log });
  const adminPassword = await ensureAdmin(db, log);

  const router = new Router();
  const app = { config, db, router, state, log, server: null, timer: null, adminPassword };
  for (const r of ['auth', 'home', 'print', 'analytics', 'measure', 'specs', 'lists', 'admin']) {
    const file = path.join(__dirname, 'routes', r + '.js');
    if (fs.existsSync(file)) require(file)(app);
  }

  app.handle = (req, res) => handle(app, req, res).catch((e) => {
    console.error('Unhandled:', e);
    try {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500');
    } catch (_) { /* socket gone */ }
  });

  app.start = () => new Promise((resolve, reject) => {
    const listen = o.listen || {
      port: config.envPort || Number(settings.get(db, 'server.port')) || config.port,
      host: config.envBind || settings.get(db, 'server.bind') || config.bind,
    };
    app.server = http.createServer(app.handle);
    app.server.on('error', reject);
    app.server.listen(listen.port, listen.host, () => {
      app.address = app.server.address();
      resolve(app);
    });
    if (!o.noScheduler) app.timer = backup.startScheduler(app);
  });

  app.stop = () => new Promise((resolve) => {
    if (app.timer) clearInterval(app.timer);
    const done = () => { try { db.close(); } catch (_) { /* already closed */ } resolve(); };
    if (app.server) { app.server.closeAllConnections(); app.server.close(done); } else done();
  });

  return app;
}

function send(res, result, extraCookies) {
  const headers = { ...H.SECURITY_HEADERS, ...(result.headers || {}) };
  const cookies = [...(extraCookies || []), ...(result.cookies || [])];
  if (cookies.length) headers['Set-Cookie'] = cookies;
  if (result.file) {
    res.writeHead(result.status, headers);
    fs.createReadStream(result.file).pipe(res);
    return;
  }
  const body = result.body === undefined ? '' : result.body;
  headers['Content-Length'] = Buffer.byteLength(body);
  res.writeHead(result.status, headers);
  res.end(body);
}

function notFoundPage(ctx) { return H.page(errorPage(ctx, 'not_found'), 404); }

async function handle(app, req, res) {
  const { db } = app;
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  const pathname = url.pathname;

  // ---- static files ----
  if (method === 'GET' && (pathname.startsWith('/static/') || pathname === '/favicon.ico')) {
    if (pathname === '/favicon.ico') return send(res, { status: 204, headers: {}, body: '' });
    const rel = pathname.slice('/static/'.length);
    let file = null;
    if (rel === 'calc.js') file = path.join(DOMAIN_DIR, 'calc.js');
    else {
      const full = H.safeJoin(PUBLIC_DIR, rel);
      if (full) file = full;
    }
    const r = file && H.staticFile(file);
    if (!r) return send(res, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not found' });
    if (req.headers['if-none-match'] === r.etag) return send(res, { status: 304, headers: { ETag: r.etag }, body: '' });
    return send(res, r);
  }

  if (method !== 'GET' && method !== 'POST') return send(res, { status: 405, headers: { Allow: 'GET, POST' }, body: '' });

  const cookies = H.parseCookies(req.headers.cookie);
  const ctx = {
    app, db, req, res, url, method, cookies, query: url.searchParams, params: {}, form: new H.Form(),
    user: null, session: null, flash: null, config: app.config,
  };

  // flash cookie (set by the previous redirect); the value is validated against the message table
  let clearFlash = false;
  if (cookies.ctc_flash) {
    clearFlash = true;
    const [type, key] = cookies.ctc_flash.split(':');
    if (key && Object.prototype.hasOwnProperty.call(S.flash, key)) ctx.flash = { type: type === 'err' ? 'err' : 'ok', key };
  }
  const extra = clearFlash ? [H.cookie('ctc_flash', '', { maxAge: 0 })] : [];

  if (cookies.ctc_sid) {
    const s = auth.findSession(db, cookies.ctc_sid);
    if (s) { ctx.user = s.user; ctx.session = s.session; }
  }

  const m = app.router.match(method, pathname);
  if (!m.route) {
    if (m.pathMatched) return send(res, { status: 405, headers: { Allow: 'GET, POST' }, body: '' }, extra);
    return send(res, notFoundPage(ctx), extra);
  }
  const { route, params } = m;
  ctx.params = params;
  const ropts = route.opts;

  if (!ropts.public) {
    if (!ctx.user) {
      if (method === 'GET') return send(res, H.redirect('/login?next=' + encodeURIComponent(pathname + url.search)), extra);
      return send(res, H.redirect('/login'), extra);
    }
    if (ctx.user.must_change_password && pathname !== '/parola' && pathname !== '/iesire') return send(res, H.redirect('/parola'), extra);
    if (ropts.roles && !ropts.roles.includes(ctx.user.role)) {
      audit.log(db, ctx.user.id, 'forbidden', null, null, { path: pathname, method });
      return send(res, H.page(errorPage(ctx, 'forbidden'), 403), extra);
    }
  }

  if (method === 'POST') {
    if (app.state.maintenance) return send(res, H.page(errorPage(ctx, 'maintenance'), 503), extra);
    let raw;
    try { raw = await H.readBody(req); } catch (e) { return send(res, { status: e.status || 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Bad request' }, extra); }
    ctx.form = new H.Form(new URLSearchParams(raw));
    const token = ctx.form.get('_csrf');
    const expected = ropts.csrf === 'login' ? cookies.ctc_lt : (ctx.session && ctx.session.csrf);
    if (!expected || !token || !H.safeEqual(token, expected)) {
      return send(res, H.page(errorPage(ctx, 'csrf'), 403), extra);
    }
  }

  let result;
  try {
    result = await route.handler(ctx);
  } catch (e) {
    console.error(`Error in ${method} ${pathname}:`, e);
    result = H.page(errorPage(ctx, 'server_error'), 500);
  }
  if (!result) result = notFoundPage(ctx);
  // a redirect that sets its own flash wins over clearing the old one
  const hasFlashSet = (result.cookies || []).some((c) => c.startsWith('ctc_flash='));
  send(res, result, hasFlashSet ? [] : extra);
}

module.exports = { createApp };
