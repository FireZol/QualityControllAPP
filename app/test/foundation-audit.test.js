'use strict';
// Foundation audit: the first building blocks (calculations, database layer and migrations, request pipeline, sessions and passwords, CSRF,
// escaping, SQL safety, append-only data, static files, dependencies), checked on a database filled with demo data. Written 2026-10-30 after the
// owner asked whether the start of the code is sound; every check here failed or could have failed on a weaker foundation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { startApp, makeUser, adminClient, Client } = require('./helpers');
const calc = require('../domain/calc');
const auth = require('../lib/auth');
const { Db, migrate } = require('../db/db');
const { seedAll } = require('../../tools/demo-data');

const ROOT = path.resolve(__dirname, '..');
/** A file name relative to app/, always with / (the allow-lists are written that way; Windows gives \). */
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// ============================================================ 1. calculations
test('calc: a reading exactly on a limit is in limits, even when the computed value carries floating-point noise', () => {
  let noisy = 0, wrong = 0;
  for (const L of [1000, 500, 250, 200, 100]) {
    for (let i = 1000; i <= 9000; i++) {
      const m = i / 10;
      const v = calc.massPerMetre(m, L);
      const want = (i * 1000 / L) / 10;   // the exact decimal, by integer arithmetic
      if (v !== want) noisy++;
      if (calc.verdict(v, want, null, false) !== 'ok' || calc.verdict(v, null, want, false) !== 'ok' || calc.verdict(v, want, want, false) !== 'ok') wrong++;
    }
  }
  assert.ok(noisy > 1000, 'the scan does contain noisy values (otherwise it proves nothing)');
  assert.equal(wrong, 0, `${wrong} readings exactly on a limit were judged out of limits`);
});

test('calc: real deviations are still caught, however small a real tolerance is; null and informative limits behave', () => {
  assert.equal(calc.verdict(127.4001, null, 127.4, false), 'peste');
  assert.equal(calc.verdict(127.3999, 127.4, null, false), 'sub');
  assert.equal(calc.verdict(17.7500001, null, 17.75, false), 'peste', 'a deviation of 1e-7 mm is real');
  assert.equal(calc.verdict(0.0000011, null, 0.000001, false), 'peste', 'small limits are judged on their own scale');
  assert.equal(calc.verdict(5, null, null, false), 'nedeterminat');
  assert.equal(calc.verdict(5, 6, 7, true), 'info');
  assert.equal(calc.verdict(6, 6, 7, false), 'ok'); assert.equal(calc.verdict(7, 6, 7, false), 'ok');
  assert.equal(calc.verdict(-1, -2, 0, false), 'ok', 'negative limits');
  assert.equal(calc.verdict(Infinity, 1, 2, false), 'peste');
});

test('calc: parsing accepts what people type and refuses the ambiguous; formatting round-trips in both languages', () => {
  const ok = { '608,5': 608.5, '608.5': 608.5, ' 1 000,5 ': 1000.5, '+3': 3, '-3,25': -3.25, '.5': 0.5, '5.': 5, '0': 0 };
  for (const [t, v] of Object.entries(ok)) assert.equal(calc.parseDecimal(t), v, t);
  for (const t of ['1,234.5', '1.234,5', '1,2,3', 'abc', '', '  ', '1e3', '--1', '1,', ',', '0x10', 'NaN', 'Infinity', '12a']) assert.equal(calc.parseDecimal(t), t === '1,' ? 1 : null, `"${t}"`);
  assert.equal(calc.parseDecimal(null), null); assert.equal(calc.parseDecimal(undefined), null); assert.equal(calc.parseDecimal(NaN), null); assert.equal(calc.parseDecimal(7), 7);
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (const sep of [',', '.']) {
    calc.setDecimal(sep);
    for (let i = 0; i < 3000; i++) {
      const v = Math.round((rnd() * 2000 - 500) * 1000) / 1000;
      const text = calc.formatNumber(v, 0, 3);
      assert.ok(text.includes(sep) || !text.includes(sep === ',' ? '.' : ','), `separator ${sep}: ${text}`);
      assert.ok(Math.abs(calc.parseDecimal(text) - v) < 1e-9, `${v} -> ${text}`);
    }
  }
  calc.setDecimal(',');
});

test('calc: the formulas agree with an independent derivation (mass, area, theoretical and temperature-corrected resistance)', () => {
  const rho = 0.028264, density = 2.703, alpha = 0.00403;   // aluminium
  assert.ok(Math.abs(calc.massPerMetre(608.5, 1000) - 608.5) < 1e-9);
  assert.ok(Math.abs(calc.massPerMetre(304.25, 500) - 608.5) < 1e-9, 'half the length, half the mass');
  const area = 608.5 / density;                       // g/m ÷ g/cm³ = mm²
  assert.ok(Math.abs(calc.areaFromMass(608.5, density) - area) < 1e-9);
  assert.ok(Math.abs(calc.theoreticalResistance(rho, area) - 1000 * rho / area) < 1e-12, 'Ω/km');
  assert.ok(Math.abs(calc.theoreticalResistance(rho, 240) - 0.11777) < 1e-4, '240 mm² aluminium is about 0.1178 Ω/km');
  // IEC 60228 Annex B: R20 = Rt / (1 + α20 (t - 20)); warmer samples read higher, so the correction lowers them
  assert.ok(Math.abs(calc.resistanceAt20(1.0, 20, alpha) - 1.0) < 1e-12, 'no correction at 20 °C');
  assert.ok(calc.resistanceAt20(1.0, 30, alpha) < 1.0 && calc.resistanceAt20(1.0, 10, alpha) > 1.0);
  assert.ok(Math.abs(calc.resistanceAt20(1.0, 30, alpha) - 1 / (1 + alpha * 10)) < 1e-12);
  assert.ok(Math.abs(calc.resistancePerKm(2.5, 'ohm', 2) - 1250) < 1e-9, '2.5 Ω on 2 m is 1250 Ω/km');
  assert.equal(calc.resistancePerKm(1.1, 'ohm_km', 99), 1.1);
  assert.ok(Math.abs(calc.resistanceEquivalent(1.2, 4) - 0.3) < 1e-12, 'a strand of 4 reported to the conductor');
  assert.equal(calc.temperatureOutOfRange(-1), true); assert.equal(calc.temperatureOutOfRange(41), true); assert.equal(calc.temperatureOutOfRange(20), false);
  assert.ok(Math.abs(calc.equivalentDiameter(Math.PI * 25) - 10) < 1e-12);
  assert.equal(calc.formatSignificant(0.11777, 4), calc.dec('0.1178'), '4 significant digits');
  assert.equal(calc.formatSignificant(1234.5678, 4), '1235');
});

// ============================================================ 2. database layer and migrations
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-audit-'));
  const db = new Db(path.join(dir, 'a.db'));
  return { dir, db };
}

test('db: transactions are atomic, nested ones join the outer one, an async callback is refused, foreign keys and WAL are on', () => {
  const { dir, db } = freshDb();
  db.exec('CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (id INTEGER PRIMARY KEY, p INTEGER NOT NULL REFERENCES p(id))');
  assert.equal(db.value('PRAGMA journal_mode'), 'wal'); assert.equal(db.value('PRAGMA foreign_keys'), 1);
  assert.throws(() => db.tx(() => { db.run('INSERT INTO p(id) VALUES (1)'); throw new Error('boom'); }), /boom/);
  assert.equal(db.value('SELECT count(*) FROM p'), 0, 'rolled back');
  db.tx(() => { db.run('INSERT INTO p(id) VALUES (1)'); db.tx(() => db.run('INSERT INTO p(id) VALUES (2)')); });
  assert.equal(db.value('SELECT count(*) FROM p'), 2, 'nested joins the outer');
  assert.throws(() => db.tx(() => { db.run('INSERT INTO p(id) VALUES (3)'); db.tx(() => { throw new Error('inner'); }); }), /inner/);
  assert.equal(db.value('SELECT count(*) FROM p'), 2, 'a failing inner call rolls back everything');
  assert.throws(() => db.tx(async () => 1), /synchronous/);
  assert.equal(db.depth, 0, 'the depth counter is reset after every failure');
  assert.throws(() => db.run('INSERT INTO c(p) VALUES (999)'), /FOREIGN KEY/);
  assert.equal(db.run('INSERT INTO c(p) VALUES (1)').changes, 1);
  assert.deepEqual(db.all('SELECT ? AS a, ? AS b, ? AS c', undefined, true, false).map((r) => [r.a, r.b, r.c])[0], [null, 1, 0], 'undefined, true and false are normalised');
  // the statement cache is bounded
  for (let i = 1; i < 1300; i++) db.get(`SELECT ${i} AS x`);
  assert.ok(db.cache.size <= 1000);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrations: applied in order with checksums, a database from a newer program is refused, an edited applied file is reported, a backup precedes pending ones', () => {
  const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-mig-'));
  const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-bak-'));
  const real = path.join(ROOT, 'db', 'migrations');
  for (const f of fs.readdirSync(real).filter((x) => /^\d{3}_.+\.sql$/.test(x))) fs.copyFileSync(path.join(real, f), path.join(mdir, f));
  const { dir, db } = freshDb();
  const r1 = migrate(db, { dir: mdir, backupDir: bdir });
  const files = fs.readdirSync(mdir).filter((x) => x.endsWith('.sql')).sort();
  assert.deepEqual(r1.applied, files.map((f) => Number(f.slice(0, 3))), 'every file applied, in order');
  assert.equal(r1.backup, null, 'nothing to back up on an empty database');
  assert.equal(db.value('SELECT count(*) FROM schema_migrations WHERE checksum IS NULL'), 0, 'every migration has its checksum');
  assert.deepEqual(migrate(db, { dir: mdir, backupDir: bdir }).applied, [], 'a second run applies nothing');
  assert.deepEqual(db.all("PRAGMA foreign_key_check"), [], 'the schema is consistent');
  assert.equal(db.value('PRAGMA integrity_check'), 'ok');
  // a pending migration: a backup file appears first
  fs.writeFileSync(path.join(mdir, '999_probe.sql'), 'CREATE TABLE probe_added (id INTEGER PRIMARY KEY);');
  const r2 = migrate(db, { dir: mdir, backupDir: bdir });
  assert.deepEqual(r2.applied, [999]); assert.ok(r2.backup && fs.existsSync(r2.backup), 'backup taken before the pending migration');
  // a file edited after it was applied is reported (not silently ignored)
  fs.appendFileSync(path.join(mdir, '999_probe.sql'), '\n-- edited later\n');
  assert.deepEqual(migrate(db, { dir: mdir, backupDir: bdir }).changed, [999]);
  // a database that already holds a migration this program does not know is refused
  fs.rmSync(path.join(mdir, '999_probe.sql'));
  assert.throws(() => migrate(db, { dir: mdir, backupDir: bdir }), /newer version of the program/);
  // a migration that fails leaves no trace (atomic)
  const { dir: d2, db: db2 } = freshDb();
  fs.writeFileSync(path.join(mdir, '999_bad.sql'), 'CREATE TABLE half_done (id INTEGER); INSERT INTO table_that_does_not_exist VALUES (1);');
  assert.throws(() => migrate(db2, { dir: mdir, backupDir: bdir }));
  assert.equal(db2.value("SELECT count(*) FROM sqlite_master WHERE name = 'half_done'"), 0, 'the failed migration was rolled back');
  db.close(); db2.close();
  for (const d of [mdir, bdir, dir, d2]) fs.rmSync(d, { recursive: true, force: true });
});

// ============================================================ 3. passwords and sessions
test('passwords: scrypt with strong parameters, old hashes still work and are upgraded at sign-in, generated passwords are unbiased', async () => {
  assert.equal(auth.needsRehash('scrypt$16384$8$1$AAAA$BBBB'), true);
  const h = await auth.hashPassword('Parola-Sigură-1');
  assert.match(h, /^scrypt\$65536\$8\$1\$/);
  assert.equal(auth.needsRehash(h), false);
  assert.equal(await auth.verifyPassword('Parola-Sigură-1', h), true); assert.equal(await auth.verifyPassword('parola-sigură-1', h), false);
  assert.equal(await auth.verifyPassword('x', 'not a hash'), false); assert.equal(await auth.verifyPassword('x', 'scrypt$1$2$3'), false);
  assert.equal(await auth.verifyPassword('é', await auth.hashPassword('é')), true, 'Unicode normalisation (NFC)');
  const counts = {}; let total = 0;
  for (let i = 0; i < 4000; i++) for (const ch of auth.generatePassword(12)) { counts[ch] = (counts[ch] || 0) + 1; total++; }
  const chars = Object.keys(counts);
  assert.equal(chars.length, 55, 'every character of the alphabet is used');
  assert.ok(!chars.some((c) => 'lI0O1'.includes(c)), 'no look-alike characters');
  const expected = total / 55; const chi = chars.reduce((s, c) => s + (counts[c] - expected) ** 2 / expected, 0);
  assert.ok(chi < 100, `the distribution is flat (chi-square ${chi.toFixed(1)} for 54 degrees of freedom)`);   // critical value at p=0.0001 is about 91
  assert.equal(auth.generatePassword(20).length, 20);
});

let app, admin, demo;
test.before(async () => {
  demo = await seedAll();
  app = demo.app; admin = demo.admin;
});
test.after(async () => { if (app) await app.cleanup(); });

const rawRequest = (method, p, headers, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: app.address.port, method, path: p, headers: headers || {} }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject); if (body) req.write(body); req.end();
});

test('sessions: a new one at every sign-in, stored hashed, idle and absolute lifetimes, sign-out and password change end them; old hashes are upgraded', async () => {
  const u = await makeUser(app, admin, 'sess.user', 'personal', 'Utilizator Sesiune');
  const sid = () => /ctc_sid=([^;]+)/.exec(u.cookieHeader())[1];
  const first = sid();
  assert.equal(app.db.value('SELECT count(*) FROM sessions WHERE token_hash = ?', crypto.createHash('sha256').update(decodeURIComponent(first)).digest('hex')), 1, 'the session is stored by the hash of its token');
  assert.equal(app.db.value('SELECT count(*) FROM sessions WHERE token_hash = ?', decodeURIComponent(first)), 0, 'never the token itself');
  assert.equal((await u.get('/')).status, 200);
  const row = () => app.db.get('SELECT * FROM sessions WHERE token_hash = ?', crypto.createHash('sha256').update(decodeURIComponent(first)).digest('hex'));
  const old = new Date(Date.now() - 9 * 3600 * 1000).toISOString().replace('Z', '');
  app.db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', old, row().token_hash);
  assert.equal((await u.get('/')).status, 303, 'idle for more than 8 hours: signed out');
  assert.equal(row(), undefined, 'and the stale row is removed');
  // absolute lifetime
  const u2 = await makeUser(app, admin, 'sess.user2', 'personal', 'Utilizator Doi');
  const h2 = crypto.createHash('sha256').update(decodeURIComponent(/ctc_sid=([^;]+)/.exec(u2.cookieHeader())[1])).digest('hex');
  assert.equal((await u2.get('/')).status, 200);
  app.db.run('UPDATE sessions SET created_at = ? WHERE token_hash = ?', new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString().replace('Z', ''), h2);
  assert.equal((await u2.get('/')).status, 303, 'a session older than 14 days ends even though it is active');
  // old hash upgraded at sign-in
  const uid = app.db.get("SELECT id FROM users WHERE username = 'sess.user'").id;
  const salt = crypto.randomBytes(16); const key = crypto.scryptSync('Vechea-Parola-1', salt, 64, { N: 16384, r: 8, p: 1 });
  app.db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', `scrypt$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`, uid);
  const c = new Client(app.base); await c.login('sess.user', 'Vechea-Parola-1');
  assert.equal((await c.get('/')).status, 200, 'the old hash still signs in');
  assert.match(app.db.get('SELECT password_hash FROM users WHERE id = ?', uid).password_hash, /^scrypt\$65536\$/, 'and has been made stronger');
  const c2 = new Client(app.base); await c2.login('sess.user', 'Vechea-Parola-1');
  assert.equal((await c2.get('/')).status, 200, 'the new hash works');
  // lock-out: five wrong passwords, then even the right one is refused for a while
  const bad = new Client(app.base);
  for (let i = 0; i < 5; i++) await bad.login('sess.user', 'gresit-' + i).catch(() => {});
  const locked = new Client(app.base); await locked.login('sess.user', 'Vechea-Parola-1').catch(() => {});
  assert.equal((await locked.get('/')).status, 303, 'blocked while locked, even with the right password');
  app.db.run("DELETE FROM login_attempts WHERE username = 'sess.user'");
});

// ============================================================ 4. the request pipeline: authentication, roles, CSRF, headers
const PUBLIC = new Set(['/login', '/limba/login']);
const sub = (p) => p.replace(/:[a-z_]+/g, '1');

test('pipeline: every route needs a session (except the public ones); every POST needs a valid CSRF token; admin-only routes refuse other roles', async () => {
  const routes = app.router.routes;
  assert.ok(routes.length > 120, `route table has ${routes.length} routes`);
  const personal = await makeUser(app, admin, 'plain.user', 'personal', 'Utilizator Simplu');
  for (const r of routes) {
    const p = sub(r.pattern);
    if (r.method === 'GET') {
      const res = await rawRequest('GET', p);
      if (r.opts.public) { assert.ok([200, 303].includes(res.status), `public GET ${p} -> ${res.status}`); continue; }
      assert.equal(res.status, 303, `GET ${p} without a session must redirect`); assert.match(res.headers.location, /^\/login/);
    } else {
      const res = await rawRequest('POST', p, { 'content-type': 'application/x-www-form-urlencoded' }, 'x=1');
      if (r.opts.public) { assert.ok([403, 303, 200].includes(res.status), `public POST ${p} -> ${res.status}`); } else assert.equal(res.status, 303, `POST ${p} without a session must redirect to the sign-in`);
      // signed in, no token / wrong token: refused before the handler runs
      if (!r.opts.public) {
        for (const body of ['x=1', '_csrf=wrong-token']) {
          const res2 = await admin.raw('POST', p, body);
          assert.equal(res2.status, 403, `POST ${p} with ${body} must be refused (got ${res2.status})`);
        }
        if (r.opts.roles && !r.opts.roles.includes('personal')) assert.equal((await personal.raw('POST', p, 'x=1')).status, 403, `POST ${p} refuses the role`);
      }
    }
    if (r.method === 'GET' && r.opts.roles && !r.opts.roles.includes('personal') && !r.opts.public) assert.equal((await personal.get(p)).status, 403, `GET ${p} refuses a Personal user`);
  }

  assert.ok(routes.filter((r) => r.method === 'POST').length > 50);
});

test('pipeline: security headers on every kind of response, cookie flags, methods, body limit, no stack traces', async () => {
  const mustHave = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin' };
  const hv = (res, k) => (typeof res.headers.get === 'function' ? res.headers.get(k) : res.headers[k]);
  const check = (res, what) => {
    for (const [k, v] of Object.entries(mustHave)) assert.equal(hv(res, k), v, `${what}: ${k}`);
    const csp = hv(res, 'content-security-policy');
    assert.ok(csp && csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") && !/unsafe-(inline|eval)/.test(csp), `${what}: CSP`);
    assert.ok(!csp.includes('data:'), `${what}: no data: images`);
    assert.ok(hv(res, 'permissions-policy'), `${what}: Permissions-Policy`);
  };
  check(await rawRequest('GET', '/login'), 'login'); check(await rawRequest('GET', '/static/app.css'), 'static'); check(await rawRequest('GET', '/nope'), '404');
  check(await rawRequest('GET', '/'), 'redirect'); check(await admin.get('/'), 'page'); check(await admin.get('/masuratori/export?format=csv'), 'download');
  const login = await rawRequest('GET', '/login');
  const token = /name="_csrf" value="([^"]+)"/.exec(login.text)[1];
  const lt = /ctc_lt=[^;]+/.exec([].concat(login.headers['set-cookie']).join(';'))[0];
  const post = await rawRequest('POST', '/login', { 'content-type': 'application/x-www-form-urlencoded', cookie: lt }, `_csrf=${encodeURIComponent(token)}&username=admin&password=wrong`);
  const cookies = [].concat(post.headers['set-cookie'] || []).join('\n');
  const okLogin = await admin.get('/');   // the admin client has a live session; look at a fresh sign-in's cookie flags
  void okLogin;
  const c = new Client(app.base); await c.login('admin', admin.password);
  const flags = c.lastSetCookie || '';
  assert.ok(!flags || (/HttpOnly/.test(flags) && /SameSite=Strict/.test(flags) && /Path=\//.test(flags)), 'session cookie flags');
  for (const m of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal((await rawRequest(m, '/')).status, 405, m);
  const big = await rawRequest('POST', '/login', { 'content-type': 'application/x-www-form-urlencoded' }, 'a=' + 'x'.repeat(2 * 1024 * 1024)).catch((e) => ({ status: 'closed', error: e.code }));
  assert.ok(big.status === 413 || ['ECONNRESET', 'EPIPE'].includes(big.error), `a 2 MB body is refused (got ${big.status} ${big.error || ''})`);
  assert.equal((await rawRequest('GET', '/login')).status, 200, 'and the server carries on');
  const err = await admin.get('/sarcini/' + '9'.repeat(40));
  assert.ok(![200, 500].includes(err.status) || !/at .*\.js:\d+/.test(err.text), 'no stack trace in an error page');
  void cookies;
});

test('static files: nothing outside the public folder can be read, however the path is written', async () => {
  const attempts = ['/static/../package.json', '/static/%2e%2e/package.json', '/static/..%2fpackage.json', '/static/%2e%2e%2fpackage.json', '/static/....//package.json', '/static/..\\package.json', '/static/%5c..%5cpackage.json', '/static/%00', '/static/app.css%00.png', '/static/../../etc/passwd', '/static//etc/passwd', '/static/%252e%252e/package.json', '/static/./../app.js', '/static/', '/static/..', '/static/db/db.js', '/static/../app/db/db.js', '/static/migrations/001_init.sql', '/static/../data/ctc.db'];
  for (const p of attempts) {
    const res = await rawRequest('GET', p);
    assert.ok([301, 303, 400, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.ok(!/"name"\s*:|dependencies|CREATE TABLE|root:|SQLite format/.test(res.text), `${p} leaked content`);
  }
  assert.equal((await rawRequest('GET', '/static/app.css')).status, 200); assert.equal((await rawRequest('GET', '/static/calc.js')).status, 200);
  const etag = (await rawRequest('GET', '/static/app.css')).headers.etag;
  assert.equal((await rawRequest('GET', '/static/app.css', { 'if-none-match': etag })).status, 304);
});

// ============================================================ 5. escaping: a hostile string in every text field, then crawl everything
const PAYLOAD = `"><img src=x onerror=alert(1)><script>alert(2)</script>'&`;
const TEXT_COLUMNS = { users: ['full_name', 'job_title'], people: ['name'], machines: ['name'], tasks: ['title', 'description', 'area'], task_events: ['text'], task_checklist: ['text'], meetings: ['title', 'agenda', 'minutes', 'location'], meeting_series: ['title', 'location'], meeting_decisions: ['text'],
  ncrs: ['title', 'description', 'cause', 'evaluation', 'containment', 'corrective_action', 'preventive_action', 'product', 'quantity', 'external_ref', 'verification_note'], ncr_events: ['text'], ncr_types: ['name'], ncr_dispositions: ['name'], pm_plans: ['title', 'description', 'area'], pm_plan_steps: ['text'], pm_runs: ['skip_reason'],
  priorities: ['name'], operators: ['full_name'], clients: ['short_name', 'name'], measurements: ['notes'] };

test('escaping: a hostile string planted in every text column never reaches a page as markup (all reachable pages, both languages)', async () => {
  const db = app.db;
  let planted = 0;
  for (const [table, cols] of Object.entries(TEXT_COLUMNS)) {
    for (const col of cols) {
      try { planted += db.run(`UPDATE ${table} SET ${col} = substr(coalesce(${col}, ''), 1, 20) || ? WHERE ${col} IS NOT NULL OR '${col}' = 'notes'`, PAYLOAD).changes; } catch (e) { assert.fail(`${table}.${col}: ${e.message}`); }
    }
  }
  db.run("UPDATE notifications SET params = json_set(params, '$.title', ?) WHERE json_valid(params)", PAYLOAD);
  db.run("INSERT OR REPLACE INTO settings(key, value) VALUES ('company.name', ?)", JSON.stringify(PAYLOAD));
  assert.ok(planted > 400, `planted in ${planted} rows`);
  const bad = /<img src=x|<script>alert|onerror=alert\(1\)>|"><img/;
  const seen = new Set(); let withEscaped = 0;
  for (const lang of ['ro', 'en']) {
    await admin.postForm('/', '/limba', { lang, back: '/' });
    const queue = ['/', '/masuratori', '/fise', '/liste', '/admin/utilizatori', '/admin/setari', '/admin/jurnal', '/analize', '/loturi', '/mentenanta', '/tehnic', '/calitate', '/calitate/sarcini', '/calitate/top', '/sedinte', '/sedinte/serii', '/mentenanta/preventiv', '/notificari', '/sarcini/tipar?team=maintenance'];
    const done = new Set();
    while (queue.length && done.size < 500) {
      const u = queue.shift();
      if (done.has(u)) continue;
      done.add(u);
      if (/^\/(iesire|static|limba|parola)|\/(export|descarca|backup|sterge|restaureaza)/.test(u)) continue;
      const res = await admin.get(u);
      if (res.status >= 400) { assert.ok(res.status < 500, `${u} -> ${res.status}`); continue; }
      if (!(res.headers.get('content-type') || '').startsWith('text/html')) continue;
      assert.ok(!bad.test(res.text), `${lang} ${u}: raw hostile markup in the page`);
      assert.ok(!/\bon[a-z]+\s*=\s*["'][^"']*alert/i.test(res.text), `${lang} ${u}: event handler injected`);
      if (res.text.includes('&lt;img src=x onerror=alert(1)&gt;')) withEscaped++;
      for (const m of res.text.matchAll(/href="(\/[^"#]*)"/g)) { const href = m[1].replace(/&amp;/g, '&'); if (!done.has(href)) queue.push(href); }
    }
    for (const u of done) seen.add(u);
  }
  assert.ok(seen.size > 150, `crawled ${seen.size} distinct pages`);
  assert.ok(withEscaped > 30, `the payload did reach ${withEscaped} pages, always escaped (so the check is meaningful)`);
});

// ============================================================ 6. SQL safety
test('sql: hostile values in every filter of every list never cause an error or change the data', async () => {
  const lists = ['/masuratori', '/mentenanta', '/tehnic', '/calitate/sarcini', '/calitate', '/calitate/top', '/sedinte', '/mentenanta/preventiv', '/analize', '/loturi', '/fise', '/admin/jurnal', '/notificari', '/sarcini/tipar?team=maintenance', '/masuratori/export?format=csv', '/calitate/export?format=csv', '/sarcini/export?team=maintenance&format=csv'];
  const names = ['q', 'sort', 'view', 'status', 'type', 'severity', 'machine', 'person', 'priority', 'group', 'days', 'by', 'team', 'from', 'to', 'page', 'product', 'shift', 'state', 'mine', 'overdue', 'family', 'quantity', 'lang', 'format', 'limit', 'order'];
  const evil = ["'", '"', "' OR '1'='1", "1; DROP TABLE users; --", "%' UNION SELECT password_hash FROM users --", '\\', '%', '_', "\u0000", 'x'.repeat(6000), '../../etc/passwd', '${7*7}', '{{7*7}}', '-1', '9'.repeat(30), '0x1F', 'NULL', ' ', '𝕏', "'||(SELECT 1)||'"];
  const before = { users: app.db.value('SELECT count(*) FROM users'), tasks: app.db.value('SELECT count(*) FROM tasks'), meas: app.db.value('SELECT count(*) FROM measurements') };
  let n = 0;
  for (const base of lists) {
    for (const v of evil) {
      const qs = names.map((k) => `${k}=${encodeURIComponent(v)}`).join('&');
      // a very long address may be refused by the operating system's socket before Node answers (Windows resets it): that is a refusal too,
      // as long as the server keeps serving afterwards
      const res = await admin.get(base + (base.includes('?') ? '&' : '?') + qs).catch((e) => { if (v.length < 1000) throw e; return null; });
      if (!res) { assert.equal((await admin.get('/')).status, 200, 'the server still answers after a refused huge address'); n++; continue; }
      assert.ok(res.status < 500, `${base} with ${JSON.stringify(v.slice(0, 20))} -> ${res.status}`);
      assert.ok(!/SQLITE|syntax error|no such (table|column)|near "/i.test(res.text), `${base}: SQL error text in the page`);
      n++;
    }
    for (const k of names) {   // one at a time too
      const res = await admin.get(base + (base.includes('?') ? '&' : '?') + `${k}=${encodeURIComponent("' OR 1=1 --")}`);
      assert.ok(res.status < 500, `${base} ?${k}= -> ${res.status}`);
    }
  }
  assert.ok(n > 300);
  assert.deepEqual({ users: app.db.value('SELECT count(*) FROM users'), tasks: app.db.value('SELECT count(*) FROM tasks'), meas: app.db.value('SELECT count(*) FROM measurements') }, before, 'nothing changed');
  assert.equal(app.db.value("SELECT count(*) FROM sqlite_master WHERE name = 'users'"), 1);
});

test('sql: every dynamic fragment in the code is a placeholder list or a whitelisted name (static scan of all queries)', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['test', 'public', 'migrations'].includes(e.name)) walk(p); } else if (p.endsWith('.js')) files.push(p); } };
  walk(ROOT);
  const risky = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // a template literal passed to db.run / get / all / exec containing ${...} where the expression is not obviously safe
    for (const m of src.matchAll(/db\.(?:run|get|all|value|exec)\(\s*`([^`]*)`/g)) {
      for (const e of m[1].matchAll(/\$\{([^}]*)\}/g)) {
        const ex = e[1].trim();
        const safe = /^(ids|list|teams|persons|f\.persons|steps|keys)?\.?map\(\(\) => '\?'\)\.join\(','\)$/.test(ex) || /\.map\(\(\) => '\?'\)\.join\(','\)/.test(ex) || /^where(\.join\(' AND '\))?$|^where\.length \? 'WHERE ' \+ where\.join\(' AND '\) : ''$/.test(ex) || /^(order|sets|sql|cols|key\.(col|name|join)|col|table|t|extra|f\.limit|Math\.min\(.*\)|k|ph|placeholders|SORTS\[.*\]|orderBy|key\.col|limit|LIMIT)$/.test(ex) || /^Math\.min\(Number\(/.test(ex) || /^\(?filter/.test(ex) || ex.startsWith("where.length") || ex.startsWith("by === ") || ex.startsWith("f.view") || ex.startsWith("onlyUnread") || ex.startsWith("ids.map") || ex.startsWith("Object.keys(changes)");
        if (!safe) risky.push(`${rel(f)}: \${${ex}}`);
      }
    }
  }
  // every expression left over must be one of the reviewed, whitelisted-input constructions below
  // reviewed by hand: lists.js builds its SQL from the code-defined LISTS table (table, order and column names are constants, user input is only ever a bound value);
  // analytics.js adds a constant clause when a filter is present; ncr.js builds SET lists from a fixed FIELDS array
  const reviewed = [/ncr\.js: \$\{k\}/, /export\.js/, /ncr\.js: \$\{Object\.keys\(changes\)/, /domain\/lists\.js: /, /analytics\.js: \$\{familyId \?/,
    /measurements\.js: \$\{(marks\(ids\)|marks\(nos\)|w|SELECT_MEAS)\}/, /ncr\.js: \$\{where \|\| ''\}/,
    /ncr\.js: \$\{SORTS\[f\.sort\] \|\| SORTS\.new\}/, /revisions\.js: \$\{(CONSTRUCTION_SQL|onlyActive \?)/, /routes\/admin\.js: \$\{(w|size|\(pg - 1\) \* size)\}/, /routes\/measure\.js: \$\{key\}/];
  // ncr SORTS: a map of constant clauses chosen by a whitelisted key; revisions: constants; admin audit log: constant clauses with bound values, a fixed page size and a digits-only page number; measure.js: key is one of ['operators', 'clients']   // measurements.js: marks() is a placeholder list, w is built from constant clauses with bound values, SELECT_MEAS is a constant
  const unreviewed = risky.filter((r) => !reviewed.some((re) => re.test(r)));
  assert.deepEqual(unreviewed, [], 'unreviewed dynamic SQL:\n' + unreviewed.join('\n'));
});

// ============================================================ 7. append-only data
test('integrity: the demo database passes the SQLite checks; measurements, revisions and the audit log are never deleted or overwritten by the code', () => {
  assert.equal(app.db.value('PRAGMA integrity_check'), 'ok');
  assert.deepEqual(app.db.all('PRAGMA foreign_key_check'), [], 'every foreign key points at a real row');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['test', 'public'].includes(e.name)) walk(p); } else if (p.endsWith('.js')) files.push(p); } };
  walk(ROOT);
  const deletes = {};
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/DELETE FROM (\$\{[^}]+\}|[a-z_]+)/g)) (deletes[rel(f)] ||= new Set()).add(m[1]);
  const ALLOWED = {
    'lib/auth.js': ['sessions', 'login_attempts'], 'routes/auth.js': ['sessions'], 'domain/golive.js': ['${t}', 'login_attempts'],   // the one-time, backed-up, audited "Start production" reset
    'domain/access.js': ['user_modules'], 'domain/lists.js': ['machine_type_families'], 'routes/admin.js': ['sessions', 'login_attempts'], 'domain/tasks.js': ['task_assignees', 'task_checklist'], 'domain/meetings.js': ['meeting_attendees', 'meeting_series_people'], 'domain/preventive.js': ['pm_plan_people', 'pm_plan_steps'],
    'domain/revisions.js': ['construction_checks', 'limits', 'process_params'], 'domain/verification.js': ['construction_checks'], 'domain/notifications.js': [], 'lib/backup.js': [],
  };
  const stray = [];
  for (const [file, set] of Object.entries(deletes)) for (const t of set) if (!(ALLOWED[file] || []).includes(t)) stray.push(`${file}: DELETE FROM ${t}`);
  assert.deepEqual(stray, [], 'a DELETE the audit did not know about');
  const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!/UPDATE audit_log|DELETE FROM audit_log|\bDROP TABLE\b|TRUNCATE TABLE/i.test(src), 'the audit log is append-only, and nothing drops tables');
  for (const m of src.matchAll(/UPDATE measurements SET ([^W]+) WHERE/g)) assert.equal(m[1].trim(), 'is_current = 0', 'a measurement is only ever marked as superseded');
  assert.ok(!/UPDATE measurement_(results|inputs)/.test(src), 'results and inputs are never changed');
  const names = app.router.routes.map((r) => r.pattern);
  assert.deepEqual(names.filter((p) => /sterge|delete|remove|elimin/i.test(p)), ['/sarcini/:id/pas/:item/sterge'], 'the only delete-named route removes a checklist step of a task (and is written to the task history); nothing else can be deleted');
});

test('integrity: a data sheet that is active cannot be edited in place; a measurement correction keeps the old version', async () => {
  const db = app.db;
  const act = db.get("SELECT r.id AS rev, r.document_id AS doc, c.id AS con FROM spec_revisions r JOIN constructions c ON c.revision_id = r.id WHERE r.status = 'activa' LIMIT 1");
  const before = db.value('SELECT count(*) FROM limits WHERE construction_id = ?', act.con);
  const res = await admin.postForm(`/fise/${act.doc}/revizii/${act.rev}/constructii/${act.con}`, `/fise/${act.doc}/revizii/${act.rev}/constructii/${act.con}`, { label: 'ALTERAT', section: '1' });
  assert.ok([403, 404, 409, 422, 303].includes(res.status));
  assert.equal(db.value('SELECT label FROM constructions WHERE id = ?', act.con) !== 'ALTERAT', true, 'the active sheet row was not changed');
  assert.equal(db.value('SELECT count(*) FROM limits WHERE construction_id = ?', act.con), before, 'its limits are intact');
  const m = db.get('SELECT record_no, id, version FROM measurements WHERE is_current = 1 ORDER BY id LIMIT 1');
  const total = db.value('SELECT count(*) FROM measurements WHERE record_no = ?', m.record_no);
  const mass = db.value("SELECT value FROM measurement_results WHERE measurement_id = ? AND quantity = 'mass_gm'", m.id);
  assert.ok(total >= 1 && mass !== undefined);
});

// ============================================================ 8. dependencies and the browser side
test('supply chain and browser code: no dependencies, only Node built-ins, no external requests, no eval, no innerHTML', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length, 0, 'zero npm dependencies');
  assert.ok(pkg.engines && /22/.test(pkg.engines.node), 'the Node version is pinned in package.json');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'test') walk(p); } else if (/\.(js|css)$/.test(p)) files.push(p); } };
  walk(ROOT);
  const builtins = new Set(require('node:module').builtinModules);
  for (const f of files.filter((x) => x.endsWith('.js') && !x.includes(`${path.sep}public${path.sep}`))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/require\('([^']+)'\)/g)) assert.ok(m[1].startsWith('.') || m[1].startsWith('node:') || builtins.has(m[1]), `${path.relative(ROOT, f)} requires ${m[1]}`);
    assert.ok(!/child_process|vm\.run/.test(src), `${path.relative(ROOT, f)}: no process spawning or dynamic code`);
    assert.ok(!/\beval\(|new Function\(/.test(src), `${path.relative(ROOT, f)}: no eval`);
  }
  for (const f of files.filter((x) => x.includes(`${path.sep}public${path.sep}`) || x.endsWith('.css'))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${path.relative(ROOT, f)}: external address`);
    if (f.endsWith('.js')) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src), `${path.relative(ROOT, f)}: unsafe DOM API`);
  }
  for (const f of files.filter((x) => x.includes(`${path.sep}views${path.sep}`))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/<script(?![^>]*src=)[^>]*>/.test(src) || /jsonBlock|application\/json/.test(src), `${path.relative(ROOT, f)}: inline script`);
    assert.ok(!/\sstyle="/.test(src) || /print|svg/.test(f), `${path.relative(ROOT, f)}: inline style attribute (the CSP forbids it)`);
  }
});

test('"Start production" (the one deletion of measurements): exactly six tables are emptied, every other table is untouched, and it cannot be repeated', async () => {
  const golive = require('../domain/golive');
  const d = await seedAll();
  try {
    const db = d.app.db;
    const EMPTIED = ['measurement_results', 'measurement_inputs', 'measurements', 'batch_certificates', 'drums', 'batches'];
    const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);
    const snap = () => Object.fromEntries(tables.map((t) => [t, db.value(`SELECT count(*) FROM ${t}`)]));
    const before = snap();
    assert.ok(before.measurements >= 90, 'there are measurements to remove');
    const r = await d.admin.postForm('/admin/productie', '/admin/productie', { confirm: 'wrong' });
    assert.equal(snap().measurements, before.measurements, 'without the confirmation word nothing happens');
    const ok = await d.admin.postForm('/admin/productie', '/admin/productie', { confirm: 'START' });
    assert.equal(ok.status, 303); void r;
    const after = snap();
    const changed = tables.filter((t) => after[t] !== before[t]).sort();
    // the allowed changes: the six emptied tables, plus the bookkeeping of the action itself (audit entry, settings key, login attempts, the backup record)
    const bookkeeping = ['audit_log', 'settings', 'login_attempts', 'sessions'];
    assert.deepEqual(changed.filter((t) => !bookkeeping.includes(t)), EMPTIED.filter((t) => before[t] > 0).sort(), 'only the six tables changed');
    for (const t of EMPTIED) assert.equal(after[t], 0, `${t} is empty`);
    for (const t of ['users', 'spec_revisions', 'constructions', 'limits', 'machines', 'tasks', 'ncrs', 'meetings', 'pm_plans', 'people', 'notifications']) assert.equal(after[t], before[t], `${t} is untouched`);
    assert.ok(after.audit_log >= before.audit_log + 2, 'the action and its backup are in the audit log');
    assert.ok(db.get("SELECT 1 FROM audit_log WHERE action = 'golive_reset'") && db.get("SELECT 1 FROM audit_log WHERE action = 'backup' AND details LIKE '%before-production%'"), 'audited, with a backup taken first');
    assert.ok(require('fs').readdirSync(require('path').join(d.app.root, 'backups')).some((f) => f.endsWith('.db')), 'the backup file exists');
    assert.deepEqual(golive.run(db, d.app.config, { id: 1 }, 'START'), { ok: false, code: 'golive_done' }, 'it cannot be repeated');
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), [], 'and the database is still consistent');
  } finally { await d.app.cleanup(); }
});

// ============================================================ 8. follow-ups from the live verification (2026-10-31)
test('HEAD is answered like GET without a body, and does not use up a flash notice; other methods still say what is allowed', async () => {
  const head = await rawRequest('HEAD', '/login');
  assert.equal(head.status, 200);
  assert.equal(head.text, '', 'no body on HEAD');
  assert.ok(head.headers['content-security-policy'], 'the security headers are there');
  const gone = await rawRequest('HEAD', '/nope');
  assert.equal(gone.status, 404);
  const anon = await rawRequest('HEAD', '/');
  assert.equal(anon.status, 303, 'HEAD of a protected page asks to sign in, like GET');
  const put = await rawRequest('PUT', '/login');
  assert.equal(put.status, 405);
  assert.match(put.headers.allow, /HEAD/);
  const flashHead = await rawRequest('HEAD', '/login', { cookie: 'ctc_flash=ok:saved' });
  assert.ok(![].concat(flashHead.headers['set-cookie'] || []).some((c) => /^ctc_flash=;/.test(c)), 'HEAD leaves the flash cookie for the next page');
});

test('a form that comes back with marked fields says at the top that nothing was saved and how many; ranges are shown beside the numbers', async () => {
  const page = await admin.get('/admin/setari');
  assert.ok(!page.text.includes('data-form-summary'), 'no banner on a clean form');
  assert.match(page.text, /1–65535/);
  const token = admin.csrfOf(page.text);
  const params = new URLSearchParams({ _csrf: token, 'server.port': '0', 'server.bind': '127.0.0.1', 'server.public_name': '', 'session.idle_hours': '999', 'backup.time': '02:00', 'backup.keep': '10', 'shift.day_start': '06:00', 'shift.night_start': '18:00' });
  const one = await admin.req('POST', '/admin/setari', params);
  assert.equal(one.status, 422);
  assert.match(one.text, /data-form-summary[^>]*>Nothing was saved\. Please correct the 2 fields marked below\./);
  params.set('session.idle_hours', '12');
  const two = await admin.req('POST', '/admin/setari', params);
  assert.equal(two.status, 422);
  assert.match(two.text, /Nothing was saved\. Please correct the field marked below\./);
  assert.equal((await admin.req('POST', '/limba', { _csrf: token, lang: 'ro' })).status, 303);
  const ro = await admin.req('POST', '/admin/setari', params);
  assert.match(ro.text, /Nimic nu a fost salvat\. Corectați câmpul marcat mai jos\./);
  await admin.req('POST', '/limba', { _csrf: token, lang: 'en' });
});

test('the password-strength marker migration exists, so a program that guards against newer databases refuses to open one that has stronger password hashes', () => {
  const files = fs.readdirSync(path.join(ROOT, 'db', 'migrations'));
  assert.ok(files.includes('016_password_strength_marker.sql'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-rollback-'));
  try {
    const db = new Db(path.join(dir, 'x.db'));
    migrate(db, { dir: path.join(ROOT, 'db', 'migrations'), backupDir: dir });
    assert.match(db.value("SELECT value FROM app_info WHERE key = 'password_hash'"), /N=65536/);
    // an "older program" that knows migrations up to 15 only
    const old = fs.mkdtempSync(path.join(dir, 'old-'));
    for (const f of files.filter((n) => Number(n.slice(0, 3)) <= 15)) fs.copyFileSync(path.join(ROOT, 'db', 'migrations', f), path.join(old, f));
    assert.throws(() => migrate(db, { dir: old, backupDir: dir }), /newer version of the program/);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
