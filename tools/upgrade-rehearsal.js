'use strict';
// Upgrade rehearsal (development tool, run before every release): the previous release makes and uses a database through its own routes
// (two engineers activate a data sheet, an operator enters 40 measurements), then this code opens the same data folder. Checks: a backup
// precedes the migrations, every migration applies in order, existing rows are byte-for-byte the same, the old audit log is intact,
// passwords set in the old version still work (and are upgraded), old records open, a new record gets the next number, settings save,
// custom fields work, and what happens when the old program is started on the upgraded data (and on the pre-upgrade backup).
//   node tools/upgrade-rehearsal.js <git ref of the previous release, e.g. c92b95d>
const { execSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const REF = process.argv[2];
if (!REF || !/^[\w./-]+$/.test(REF)) { console.error('usage: node tools/upgrade-rehearsal.js <git ref of the previous release>'); process.exit(2); }
const NEW = path.resolve(__dirname, '..');
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-upgrade-'));
const OLD = path.join(W, 'old');
fs.mkdirSync(OLD);
execSync(`git archive ${REF} | tar -x -C "${OLD}"`, { cwd: NEW, stdio: ['ignore', 'ignore', 'inherit'] });
const say = (ok, m, extra) => console.log((ok === true ? '✅' : ok === false ? '❌' : ok) + ' ' + m + (extra ? '\n     ' + extra : ''));
const config = (tree) => ({ root: W, port: 8080, bind: '127.0.0.1', publicName: '', dataDir: path.join(W, 'data'), backupDir: path.join(W, 'backups'), seedDir: path.join(tree, 'seed'), envPort: null, envBind: null });
async function boot(tree) {
  const { createApp } = require(path.join(tree, 'app', 'app.js'));
  const logs = [];
  const app = await createApp(config(tree), { listen: { port: 0, host: '127.0.0.1' }, log: (m) => logs.push(m), noScheduler: true });
  await app.start();
  app.base = `http://127.0.0.1:${app.address.port}`; app.logs = logs;
  return app;
}
const digest = (db, sql) => crypto.createHash('sha256').update(JSON.stringify(db.all(sql))).digest('hex').slice(0, 16);
const SNAP = {
  measurements: 'SELECT * FROM measurements ORDER BY id', inputs: 'SELECT * FROM measurement_inputs ORDER BY measurement_id, key', results: 'SELECT * FROM measurement_results ORDER BY measurement_id, quantity',
  revisions: 'SELECT * FROM spec_revisions ORDER BY id', constructions: 'SELECT * FROM constructions ORDER BY id', users: 'SELECT id, username, full_name, role, active, language FROM users ORDER BY id',
  audit: 'SELECT id, ts, user_id, action, entity, entity_id, details FROM audit_log ORDER BY id', machines: 'SELECT * FROM machines ORDER BY id',
};

(async () => {
  fs.rmSync(W + '/data', { recursive: true, force: true }); fs.rmSync(W + '/backups', { recursive: true, force: true });
  // ---------------- phase A: the shipped version, used for real
  const H = require(path.join(OLD, 'app', 'test', 'helpers.js'));
  let app = await boot(OLD);
  const admin = await H.adminClient(app);
  const engA = await H.makeUser(app, admin, 'ing.a', 'inginer', 'Inginer A');
  const engB = await H.makeUser(app, admin, 'ing.b', 'inginer', 'Inginer B');
  const ctc = await H.makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const db = app.db;
  const docAl = db.get("SELECT id FROM spec_documents WHERE doc_type='CABLARE_RIGIDA_AL'").id;
  const revAl = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', docAl).id;
  await engA.postForm(`/fise/${docAl}/revizii/${revAl}`, `/fise/${docAl}/revizii/${revAl}/trimite`, {});
  await engB.postForm(`/fise/${docAl}/revizii/${revAl}`, `/fise/${docAl}/revizii/${revAl}/verifica`, {});
  const ids = { fam: db.get("SELECT id FROM product_families WHERE code='FUNIE_RIGIDA'").id, mach: db.get("SELECT id FROM machines WHERE name='RIGID 1'").id,
    con: db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", revAl).id, sample: db.get("SELECT id FROM sample_types WHERE name='Probă de pornire'").id };
  let made = 0;
  for (let i = 0; i < 40; i++) {
    const mass = (604 + (i % 9) * 0.8).toFixed(1).replace('.', ',');
    const r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: ids.fam, machine_id: ids.mach, construction_id: ids.con, sample_type_id: ids.sample, mass_g: mass, sample_mm: '1000', h: '17.75', l: '22.55' });
    if (r.status === 303) made++;
  }
  say(made === 40, `old version: ${made} measurements entered through its own form; revision activated by two engineers; 3 users + admin`);
  const flagged = db.value("SELECT count(*) FROM measurement_results WHERE verdict <> 'ok' AND quantity = 'mass_gm'");
  const before = Object.fromEntries(Object.entries(SNAP).map(([k, q]) => [k, digest(db, q)]));
  const counts = { m: db.value('SELECT count(*) FROM measurements'), u: db.value('SELECT count(*) FROM users'), a: db.value('SELECT count(*) FROM audit_log') };
  const oldHash = db.get("SELECT password_hash FROM users WHERE username='ctc1'").password_hash;
  const oldMax = db.value('SELECT max(version) FROM schema_migrations');
  say(true, `old database: migrations up to ${oldMax}, ${counts.m} measurements (${flagged} out of the mass limits), ${counts.a} audit rows, password hash ${oldHash.split('$').slice(0, 2).join('$')}`);
  await app.stop();

  // ---------------- phase B: the new code on the same data folder
  // (each tree resolves its own modules; clear the require cache so nothing is shared)
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  const t0 = Date.now();
  app = await boot(NEW);
  const startMs = Date.now() - t0;
  const backupLine = app.logs.find((l) => /Backup înainte de migrare/.test(l));
  const migLine = app.logs.find((l) => /Migrări aplicate/.test(l));
  say(!!backupLine && fs.existsSync(backupLine.split(': ').pop()), 'a backup was taken before the migrations', backupLine);
  const newest = Math.max(...fs.readdirSync(path.join(NEW, 'app', 'db', 'migrations')).filter((f) => /^\d{3}_.*\.sql$/.test(f)).map((f) => Number(f.slice(0, 3))));
  const expected = Array.from({ length: newest - oldMax }, (_, i) => oldMax + 1 + i).join(', ');
  say((migLine || '').endsWith(expected), `migrations ${oldMax + 1} to ${newest} applied, in order`, `${migLine} (start ${startMs} ms)`);
  say(!app.logs.some((l) => /ATENȚIE/.test(l)), 'no warning about changed migration files');
  const ndb = app.db;
  const after = Object.fromEntries(Object.entries(SNAP).map(([k, q]) => [k, digest(ndb, q)]));
  const same = Object.keys(SNAP).filter((k) => k !== 'audit' && before[k] === after[k]);
  say(same.length === Object.keys(SNAP).length - 1, `existing data unchanged: ${same.join(', ')}`);
  const auditKept = digest(ndb, `SELECT id, ts, user_id, action, entity, entity_id, details FROM audit_log WHERE id <= ${counts.a} ORDER BY id`) === before.audit;
  say(auditKept, 'the old audit log is intact (new rows only added after it)');
  say(ndb.value('PRAGMA integrity_check') === 'ok' && ndb.all('PRAGMA foreign_key_check').length === 0, 'integrity_check ok, no foreign-key violations');
  // sign-in with the old password, hash upgraded
  const NH = require(path.join(NEW, 'app', 'test', 'helpers.js'));
  const c = new NH.Client(app.base);
  const l = await c.login('ctc1', 'Parola-ctc1-1');
  const newHash = ndb.get("SELECT password_hash FROM users WHERE username='ctc1'").password_hash;
  say(l.status === 303 && newHash.startsWith('scrypt$65536$'), `ctc1 signs in with the password set in the old version; hash upgraded to ${newHash.split('$').slice(0, 2).join('$')}`);
  // the old records read correctly
  const m1 = await c.get('/masuratori/1');
  const reg = await c.get('/masuratori');
  say(m1.status === 200 && /608|604|605|606|607/.test(m1.text) && reg.status === 200, 'an old record and the register open in the new version');
  const flagsNow = ndb.value("SELECT count(*) FROM measurement_results WHERE verdict <> 'ok' AND quantity = 'mass_gm'");
  say(flagsNow === flagged, `stored verdicts are kept as they were saved (${flagsNow} flagged); they are not recomputed by the upgrade`);
  // new entry works on the upgraded database
  const ids2 = { fam: ndb.get("SELECT id FROM product_families WHERE code='FUNIE_RIGIDA'").id, mach: ndb.get("SELECT id FROM machines WHERE name='RIGID 1'").id, con: ndb.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", revAl).id, sample: ndb.get("SELECT id FROM sample_types WHERE name='Probă de pornire'").id };
  const nm = await c.postForm('/masuratori/nou', '/masuratori/nou', { family_id: ids2.fam, machine_id: ids2.mach, construction_id: ids2.con, sample_type_id: ids2.sample, mass_g: '609,4', sample_mm: '1000', h: '17.75', l: '22.55' });
  const newNo = nm.location && Number(/\/masuratori\/(\d+)/.exec(nm.location)[1]);
  say(nm.status === 303 && newNo === 41, `a new measurement after the upgrade gets the next number (${newNo}); 609,4 g/m on the limit is "${ndb.get("SELECT r.verdict FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ? AND r.quantity = 'mass_gm'", newNo).verdict}"`);
  // admin: settings save, modules, custom fields
  const ad = new NH.Client(app.base); await ad.login('admin', 'Admin-parola-1');
  const home = await ad.get('/');
  say(home.status === 200, 'admin home opens');
  const on = ndb.all("SELECT key FROM settings WHERE key LIKE 'modules.%' AND value = 'true'").map((r) => r.key.slice(8));
  say('ℹ️', `modules switched on after the upgrade: ${on.length ? on.join(', ') : 'none'} (new modules stay off until an administrator switches them on in Settings)`);
  const st = await ad.get('/admin/setari');
  const token = ad.csrfOf(st.text);
  const form = new URLSearchParams();
  for (const m of st.text.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) if (!m[0].includes('type="checkbox"')) form.append(m[1], m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  for (const m of st.text.matchAll(/<input type="checkbox" name="([^"]+)" value="1" checked/g)) form.append(m[1], '1');
  for (const m of st.text.matchAll(/<select name="([^"]+)"[^>]*>[\s\S]*?<option value="([^"]*)" selected/g)) form.append(m[1], m[2]);
  form.set('_csrf', token);
  const sv = await ad.req('POST', '/admin/setari', form);
  say(sv.status === 303, `settings page saves unchanged as it comes (status ${sv.status})`, sv.status !== 303 ? [...sv.text.matchAll(/class="field-error"[^>]*>([^<]*)/g)].map((x) => x[1]).join(' | ') : '');
  const cf = await ad.postForm('/admin/campuri', '/admin/campuri/nou', { kind: 'task', type: 'number', label: 'Timp oprire', show_in_list: '1' });
  say(cf.status === 303, 'custom fields work on the upgraded database');
  await app.stop();

  // ---------------- going back: the old program on the upgraded database
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  let backApp = null; let backErr = null;
  try { backApp = await boot(OLD); } catch (e) { backErr = e.message; }
  if (backErr) say('ℹ️', 'old program refuses the upgraded database', backErr);
  else {
    const OH = require(path.join(OLD, 'app', 'test', 'helpers.js'));
    const oc = new OH.Client(backApp.base);
    const r = await oc.login('ctc1', 'Parola-ctc1-1').catch((e) => ({ status: 'ERR ' + e.message }));
    say('⚠️', `old program STARTS on the upgraded database (it has no newer-database guard); sign-in of an upgraded user → ${r.status}`);
    await backApp.stop();
  }
  // the pre-upgrade backup opens in the old program
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  const bk = backupLine.split(': ').pop();
  fs.rmSync(path.join(W, 'data'), { recursive: true, force: true }); fs.mkdirSync(path.join(W, 'data'));
  fs.copyFileSync(bk, path.join(W, 'data', 'ctc.db'));
  const restored = await boot(OLD);
  const OH2 = require(path.join(OLD, 'app', 'test', 'helpers.js'));
  const rc = new OH2.Client(restored.base);
  const rl = await rc.login('ctc1', 'Parola-ctc1-1');
  say(rl.status === 303 && restored.db.value('SELECT count(*) FROM measurements') === counts.m, `the pre-upgrade backup opens in the old program: ${restored.db.value('SELECT count(*) FROM measurements')} measurements, sign-in works`);
  await restored.stop();
  fs.rmSync(W, { recursive: true, force: true });
})().catch((e) => { console.error('REHEARSAL ERROR', e); process.exit(1); });
