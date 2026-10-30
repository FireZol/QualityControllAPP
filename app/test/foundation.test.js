'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient } = require('./helpers');
const reg = require('../modules/registry');
const access = require('../domain/access');
const numbering = require('../domain/numbering');
const notifications = require('../domain/notifications');
const settings = require('../domain/settings');

let app, admin, lead, worker;
test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.mt', 'personal', 'Șef Mentenanță');
  worker = await makeUser(app, admin, 'qc.one', 'personal', 'Operator CTC');
});
test.after(async () => { await app.cleanup(); });

const user = (name) => app.db.get('SELECT * FROM users WHERE username = ?', name);
const BASE = { 'server.port': '8080', 'server.bind': '0.0.0.0', 'server.public_name': '', 'session.idle_hours': '8', 'backup.dir': '', 'backup.time': '02:00', 'backup.keep': '14', 'shift.day_start': '06:00', 'shift.night_start': '18:00', 'backup.auto': '1', 'cycle.day': '4', 'cycle.off1': '2', 'cycle.night': '4', 'cycle.off2': '2' };

test('registry: the module of a path, the switchable modules and the level order', () => {
  assert.equal(reg.moduleOfPath('/mentenanta'), 'maintenance');
  assert.equal(reg.moduleOfPath('/mentenanta/preventiv'), 'maintenance');
  assert.equal(reg.moduleOfPath('/tehnic/sarcini/3'), 'technical');
  assert.equal(reg.moduleOfPath('/calitate'), 'quality');
  assert.equal(reg.moduleOfPath('/sedinte/serii'), 'meetings');
  assert.equal(reg.moduleOfPath('/masuratori'), 'qc');
  assert.equal(reg.moduleOfPath('/mentenantaX'), 'qc', 'only whole path segments match');
  assert.deepEqual(reg.switchable().sort(), ['maintenance', 'meetings', 'quality', 'technical']);
  assert.ok(reg.rank('lead') > reg.rank('enter') && reg.rank('enter') > reg.rank('view') && reg.rank('view') > reg.rank('none'));
});

test('access: Administrator is lead; Technical is open to all; Maintenance / Quality default to enter; explicit levels win; a closed module is none', () => {
  const adm = user('admin'), w = user('qc.one');
  const on = { maintenance: true, technical: true, quality: true, meetings: true };
  assert.equal(access.level(app.db, adm, 'maintenance', on), 'lead');
  assert.equal(access.level(app.db, w, 'technical', on), 'lead', 'everybody can update Technical');
  assert.equal(access.level(app.db, w, 'maintenance', on), 'enter');
  assert.equal(access.level(app.db, w, 'quality', on), 'enter');
  assert.equal(access.level(app.db, w, 'meetings', on), 'view');
  assert.equal(access.level(app.db, w, 'qc', on), 'lead');
  assert.equal(access.level(app.db, w, 'maintenance', { ...on, maintenance: false }), 'none');
  access.setUserLevels(app.db, w.id, { maintenance: 'none', quality: 'lead', bogus: 'lead', technical: 'view', meetings: 'x' });
  assert.equal(access.level(app.db, w, 'maintenance', on), 'none');
  assert.equal(access.level(app.db, w, 'quality', on), 'lead');
  assert.equal(access.level(app.db, w, 'technical', on), 'view', 'an explicit level beats "open to all"');
  assert.deepEqual(access.userLevels(app.db, w.id), { maintenance: 'none', quality: 'lead', technical: 'view' });
  access.setUserLevels(app.db, w.id, {});
  settings.set(app.db, 'technical.open_to_all', false);
  assert.equal(access.level(app.db, w, 'technical', on), 'lead', 'default for Technical is still lead');
  settings.set(app.db, 'access.default.technical', 'view');
  assert.equal(access.level(app.db, w, 'technical', on), 'view');
  settings.set(app.db, 'technical.open_to_all', true); settings.set(app.db, 'access.default.technical', 'lead');
});

test('numbering: patterns are validated; the counter restarts per year / month / team as the pattern says', () => {
  for (const [p, e] of [['', 'required'], ['x'.repeat(61), 'too_long'], ['NC-{yyyy}', 'seq_once'], ['{seq}-{seq:3}', 'seq_once'], ['NC-{foo}-{seq}', 'invalid'], ['NC_{seq}!', 'invalid'], ['{seq:0}', 'invalid']]) assert.equal(numbering.validate(p), e, p);
  for (const ok of ['NC-{yyyy}-{seq:3}', '{team}-{yy}{mm}-{seq:4}', 'A/{seq}']) assert.equal(numbering.validate(ok), null, ok);
  assert.equal(numbering.format('{team}-{yyyy}-{seq:4}', 7, { teamCode: 'MT', date: new Date(2026, 4, 3) }), 'MT-2026-0007');
  assert.equal(numbering.format('{yy}{mm}-{seq:2}', 3, { date: new Date(2026, 10, 3) }), '2611-03');
  const db = app.db;
  assert.equal(numbering.next(db, 'task', { team: 'maintenance', date: new Date(2026, 0, 5) }), 'MT-2026-0001');
  assert.equal(numbering.next(db, 'task', { team: 'maintenance', date: new Date(2026, 5, 5) }), 'MT-2026-0002');
  assert.equal(numbering.next(db, 'task', { team: 'technical', date: new Date(2026, 5, 5) }), 'TH-2026-0001', 'counter per team');
  assert.equal(numbering.next(db, 'task', { team: 'maintenance', date: new Date(2027, 0, 1) }), 'MT-2027-0001', 'restarts with the year');
  assert.equal(numbering.next(db, 'ncr', { date: new Date(2026, 2, 1) }), 'NC-2026-001');
  assert.equal(numbering.next(db, 'meeting', { date: new Date(2026, 2, 1) }), 'S-2026-03-01');
  assert.equal(numbering.next(db, 'meeting', { date: new Date(2026, 3, 1) }), 'S-2026-04-01', 'restarts with the month');
  settings.set(db, 'numbering.ncr', 'NCR{seq}');
  assert.equal(numbering.next(db, 'ncr', { date: new Date(2030, 0, 1) }), 'NCR1');
  assert.equal(numbering.next(db, 'ncr', { date: new Date(2031, 0, 1) }), 'NCR2', 'no date in the pattern: one counter for ever');
  settings.set(db, 'numbering.ncr', 'NC-{yyyy}-{seq:3}');
});

test('notifications: created once per dedupe key, counted, read, marked read; text comes from the dictionary of the reader', async () => {
  const db = app.db, w = user('qc.one'), l = user('lead.mt');
  assert.equal(notifications.notify(db, [w.id, w.id, l.id, null], 'task_assigned', { no: 'MT-1' }, '/mentenanta'), 2, 'duplicates and empty ids are dropped');
  assert.equal(notifications.notify(db, [w.id], 'meeting_today', { title: 'x' }, '/sedinte', 'meeting:1:2026-10-30'), 1);
  assert.equal(notifications.notify(db, [w.id], 'meeting_today', { title: 'x' }, '/sedinte', 'meeting:1:2026-10-30'), 0, 'the same reminder is not repeated');
  assert.equal(notifications.unread(db, w.id), 2);
  const page = (await worker.get('/')).text;
  assert.match(page, /class="bell"/);
  assert.match(page, /class="bell-n">2</);
  const rows = notifications.list(db, w.id);
  assert.equal(rows.length, 2);
  // the page, opening one marks it read and goes to its link; other people's notifications are untouchable
  assert.equal((await worker.get('/notificari')).status, 200);
  const mine = rows.find((r) => r.kind === 'task_assigned');
  const open = await worker.get(`/notificari/${mine.id}/deschide`);
  assert.equal(open.status, 303);
  assert.equal(open.location, '/mentenanta');
  assert.equal(notifications.unread(db, w.id), 1);
  const theirs = notifications.list(db, l.id)[0];
  assert.equal((await worker.get(`/notificari/${theirs.id}/deschide`)).location, '/notificari');
  assert.equal(notifications.unread(db, l.id), 1, 'not marked by someone else');
  db.run("UPDATE notifications SET link = '//evil.example' WHERE id = ?", theirs.id);
  assert.equal((await lead.get(`/notificari/${theirs.id}/deschide`)).location, '/notificari', 'no open redirect');
  const all = await worker.postForm('/notificari', '/notificari/citite', {});
  assert.equal(all.status, 303);
  assert.equal(notifications.unread(db, w.id), 0);
  assert.ok(!(await worker.get('/')).text.includes('bell-n'));
  // people without a login are skipped
  const p1 = db.run("INSERT INTO people(name, team, user_id) VALUES ('Ion', 'maintenance', ?)", w.id).id;
  const p2 = db.run("INSERT INTO people(name, team) VALUES ('Vasile', 'maintenance')").id;
  assert.deepEqual(notifications.usersOfPeople(db, [p1, p2]), [w.id]);
});

test('Settings: every module has its switch; numbering and team codes are validated and saved; the example shows the result', async () => {
  const page = (await admin.get('/admin/setari')).text;
  for (const m of ['cable', 'analytics', 'maintenance', 'technical', 'quality', 'meetings']) assert.ok(page.includes(`name="modules.${m}"`), m);
  assert.ok(page.includes('name="numbering.task"') && page.includes('name="team.code.maintenance"') && page.includes('name="access.default.maintenance"'));
  assert.match(page, /Exemplu: MT-\d{4}-0001/);
  const full = { ...BASE, 'technical.open_to_all': '1', 'access.default.maintenance': 'enter', 'access.default.quality': 'enter', 'access.default.meetings': 'view', 'access.default.technical': 'lead', 'numbering.task': '{team}-{yyyy}-{seq:4}', 'numbering.ncr': 'NC-{yyyy}-{seq:3}', 'numbering.meeting': 'S-{yyyy}-{mm}-{seq:2}', 'team.code.maintenance': 'MT', 'team.code.technical': 'TH', 'team.code.quality': 'QC' };
  let r = await admin.postForm('/admin/setari', '/admin/setari', { ...full, 'numbering.task': 'T-{yyyy}' });
  assert.equal(r.status, 422);
  assert.match(r.text, /o singură dată/);
  r = await admin.postForm('/admin/setari', '/admin/setari', { ...full, 'team.code.quality': 'q c' });
  assert.equal(r.status, 422);
  r = await admin.postForm('/admin/setari', '/admin/setari', { ...full, 'numbering.task': 'MNT-{yy}{mm}-{seq:3}', 'team.code.quality': 'cal', 'access.default.maintenance': 'view' });
  assert.equal(r.status, 303);
  assert.equal(settings.get(app.db, 'numbering.task'), 'MNT-{yy}{mm}-{seq:3}');
  assert.equal(settings.get(app.db, 'team.code.quality'), 'CAL', 'team codes are upper-case');
  assert.equal(settings.get(app.db, 'access.default.maintenance'), 'view');
  r = await admin.postForm('/admin/setari', '/admin/setari', { ...full, 'access.default.maintenance': 'god' });
  assert.equal(r.status, 422);
  // an older form without the new fields leaves them unchanged
  r = await admin.postForm('/admin/setari', '/admin/setari', { ...BASE, 'modules.maintenance': '1' });
  assert.equal(r.status, 303);
  assert.equal(settings.get(app.db, 'numbering.task'), 'MNT-{yy}{mm}-{seq:3}');
  settings.set(app.db, 'numbering.task', '{team}-{yyyy}-{seq:4}'); settings.set(app.db, 'access.default.maintenance', 'enter'); settings.set(app.db, 'team.code.quality', 'QC');
  for (const m of require('../domain/modules').MODULES) require('../domain/modules').set(app.db, m, true); // the old-form post above switched the others off
});

test('Users: the access matrix is on the form, saved, audited and applied; the module switcher and gate follow the levels', async () => {
  const w = user('qc.one');
  const form = (await admin.get(`/admin/utilizatori/${w.id}`)).text;
  for (const m of ['maintenance', 'technical', 'quality', 'meetings']) assert.ok(form.includes(`name="lvl_${m}"`), m);
  assert.match(form, /implicit \(/);
  const base = { full_name: w.full_name, role: w.role, job_title: '', active: '1' };
  let r = await admin.postForm(`/admin/utilizatori/${w.id}`, `/admin/utilizatori/${w.id}`, { ...base, lvl_maintenance: 'lead', lvl_technical: '', lvl_quality: 'view', lvl_meetings: 'enter' });
  assert.equal(r.status, 303);
  assert.deepEqual(access.userLevels(app.db, w.id), { maintenance: 'lead', quality: 'view', meetings: 'enter' });
  assert.ok(app.db.get("SELECT 1 FROM audit_log WHERE action = 'access_change'"));
  // the switcher lists the modules this user may open
  const home = (await worker.get('/')).text;
  assert.match(home, /class="navmore modules"/);
  assert.ok(home.includes('Mentenanță') && home.includes('Calitate') && home.includes('Ședințe') && home.includes('Tehnic'));
  access.setUserLevels(app.db, w.id, { maintenance: 'none' });
  assert.ok(!(await worker.get('/')).text.includes('href="/mentenanta"'), 'a module with level none is not offered');
  // a new user can be given levels at creation
  r = await admin.postForm('/admin/utilizatori/nou', '/admin/utilizatori/nou', { username: 'new.lead', full_name: 'New Lead', role: 'personal', job_title: '', lvl_quality: 'lead', lvl_maintenance: '' });
  assert.equal(r.status, 200);
  assert.deepEqual(access.userLevels(app.db, user('new.lead').id), { quality: 'lead' });
  access.setUserLevels(app.db, w.id, {});
});

test('People and priorities are lists in Database; the priority scale is Low / Normal / High / Critical', async () => {
  assert.deepEqual(app.db.all('SELECT name_en FROM priorities ORDER BY sort').map((r) => r.name_en), ['Low', 'Normal', 'High', 'Critical']);
  const index = (await admin.get('/liste')).text;
  assert.ok(index.includes('href="/liste/persoane"') && index.includes('href="/liste/prioritati"'));
  const r = await admin.postForm('/liste/persoane', '/liste/persoane/adauga', { name: 'Ion Popescu', team: 'maintenance', user_id: '' });
  assert.equal(r.status, 303);
  const p = app.db.get("SELECT * FROM people WHERE name = 'Ion Popescu'");
  assert.equal(p.team, 'maintenance'); assert.equal(p.user_id, null);
  const bad = await admin.postForm('/liste/persoane', '/liste/persoane/adauga', { name: 'X', team: 'nope', user_id: '' });
  assert.equal(bad.status, 422);
});
