'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, Client } = require('./helpers');
const H = require('../lib/http');

let app, admin, ctc;
test.before(async () => { app = await startApp(); admin = await adminClient(app); ctc = await makeUser(app, admin, 'sec.ctc', 'personal', 'Sec CTC'); });
test.after(async () => { await app.cleanup(); });

test('cookies are HttpOnly and SameSite=Strict; Secure only when HTTPS is configured', () => {
  assert.match(H.cookie('a', '1'), /; HttpOnly; SameSite=Strict$/);
  H.setSecureCookies(true);
  try { assert.match(H.cookie('a', '1'), /; HttpOnly; SameSite=Strict; Secure$/); } finally { H.setSecureCookies(false); }
  assert.ok(!/Secure/.test(H.cookie('a', '1')));
});

test('every page and static file carries the security headers; pages are never cached', async () => {
  for (const url of ['/login', '/static/app.css', '/static/app.js']) {
    const res = await fetch(app.base + url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', url);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'.*frame-ancestors 'none'/, url);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', url);
  }
  assert.equal((await fetch(app.base + '/login')).headers.get('cache-control'), 'no-store');
});

test('without a session every working page sends you to the login page and every POST is refused', async () => {
  const anon = new Client(app.base);
  for (const url of ['/', '/masuratori', '/masuratori/nou', '/masuratori/1', '/masuratori/export', '/masuratori/tipar', '/fise', '/liste', '/admin/utilizatori', '/admin/setari', '/admin/jurnal', '/admin/productie', '/loturi', '/analize/tendinta']) {
    const r = await anon.get(url);
    assert.ok(r.status === 303 || r.status === 404, `${url}: ${r.status}`);
    if (r.status === 303) assert.match(r.location, /^\/login/, url);
  }
  for (const url of ['/masuratori/nou', '/admin/setari', '/admin/productie', '/limba', '/iesire', '/admin/utilizatori/nou']) {
    const res = await fetch(app.base + url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'lang=en', redirect: 'manual' });
    assert.ok([303, 403, 404].includes(res.status), `${url}: ${res.status}`);
    assert.ok(!(res.status === 303 && !/\/login/.test(res.headers.get('location'))), `${url} must not succeed`);
  }
  const forged = new Client(app.base); forged.jar.ctc_sid = 'x'.repeat(43);
  assert.equal((await forged.get('/')).status, 303);
});

test('roles: Personal cannot reach administration, master data changes, settings or the production reset', async () => {
  for (const url of ['/admin/utilizatori', '/admin/setari', '/admin/jurnal', '/admin/productie', '/liste', '/liste/familii']) {
    assert.equal((await ctc.get(url)).status, 403, url);
  }
  for (const url of ['/admin/setari', '/admin/productie', '/admin/setari/backup']) assert.equal((await ctc.postForm('/', url, {})).status, 403, url);
  assert.equal((await ctc.postForm('/', '/admin/utilizatori/nou', { username: 'x', role: 'administrator' })).status, 403);
});

test('a POST needs the session\'s form token, also for the new actions', async () => {
  for (const url of ['/admin/productie', '/limba', '/masuratori/nou']) {
    const res = await fetch(app.base + url, { method: 'POST', headers: { Cookie: admin.cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_csrf=wrong&confirm=START&lang=en', redirect: 'manual' });
    assert.equal(res.status, 403, url);
  }
  assert.equal(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'golive_reset'"), 0);
});

test('static files cannot leave the public folder', async () => {
  for (const url of ['/static/../../config.json', '/static/%2e%2e/%2e%2e/package.json', '/static/..%2f..%2fapp.js', '/static//etc/passwd', '/static/..\\..\\package.json']) {
    const res = await fetch(app.base + url);
    assert.equal(res.status, 404, url);
  }
});

test('an oversized request body is refused and the server keeps running', async () => {
  const big = 'a'.repeat(1024 * 1024 + 10);
  let status = 0;
  try { status = (await fetch(app.base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: big })).status; } catch (_) { status = -1; }
  assert.ok(status === 413 || status === -1 || status === 403, `status ${status}`);
  assert.equal((await fetch(app.base + '/login')).status, 200);
});

test('failed logins are audited with the client address; five failures lock the account temporarily', async () => {
  const c = new Client(app.base);
  for (let i = 0; i < 5; i++) await c.login('sec.ctc', 'wrong-password-' + i);
  const row = app.db.get("SELECT details FROM audit_log WHERE action = 'login_failed' ORDER BY id DESC");
  assert.match(JSON.parse(row.details).ip, /127\.0\.0\.1|::1/);
  const again = await c.login('sec.ctc', ctc.password);
  assert.notEqual(again.status, 303, 'locked: even the right password is refused for now');
});

test('the problem-report address cannot smuggle mail headers', async () => {
  const base = { 'server.port': '8080', 'server.bind': '0.0.0.0', 'server.public_name': '', 'session.idle_hours': '8', 'backup.dir': '', 'backup.time': '02:00', 'backup.keep': '14', 'shift.day_start': '06:00', 'shift.night_start': '18:00', 'backup.auto': '1' };
  for (const bad of ['qa@x.com?bcc=evil@x.com', 'qa@x.com&cc=a@b.c', 'a b@x.com', 'qa@x.com#', '<a@x.com>']) {
    assert.equal((await admin.postForm('/admin/setari', '/admin/setari', { ...base, 'feedback.email': bad })).status, 422, bad);
  }
});
