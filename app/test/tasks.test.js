'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const tasks = require('../domain/tasks');
const access = require('../domain/access');
const notifications = require('../domain/notifications');
const modules = require('../domain/modules');

let app, admin, lead, worker, viewer, outsider, tech, ids = {};
test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.mt', 'personal', 'Șef Mentenanță');
  worker = await makeUser(app, admin, 'worker1', 'personal', 'Operator CTC');
  viewer = await makeUser(app, admin, 'viewer1', 'personal', 'Observator');
  outsider = await makeUser(app, admin, 'nomod', 'personal', 'Fără acces');
  tech = await makeUser(app, admin, 'tech1', 'personal', 'Tehnician');
  const db = app.db;
  const uid = (n) => db.get('SELECT id FROM users WHERE username = ?', n).id;
  ids = { lead: uid('lead.mt'), worker: uid('worker1'), viewer: uid('viewer1'), outsider: uid('nomod'), tech: uid('tech1') };
  access.setUserLevels(db, ids.lead, { maintenance: 'lead' });
  access.setUserLevels(db, ids.viewer, { maintenance: 'view', quality: 'view' });
  access.setUserLevels(db, ids.outsider, { maintenance: 'none', quality: 'none' });
  ids.pLead = db.run("INSERT INTO people(name, team, user_id) VALUES ('Șef Mentenanță', 'maintenance', ?)", ids.lead).id;
  ids.pWorker = db.run("INSERT INTO people(name, team, user_id) VALUES ('Operator CTC', 'maintenance', ?)", ids.worker).id;
  ids.pFitter = db.run("INSERT INTO people(name, team) VALUES ('Ion Lăcătuș', 'maintenance')").id; // never logs in
  ids.machine = db.get('SELECT id FROM machines ORDER BY id').id;
  ids.high = db.get("SELECT id FROM priorities WHERE name_en = 'High'").id;
  ids.critical = db.get("SELECT id FROM priorities WHERE name_en = 'Critical'").id;
});
test.after(async () => { await app.cleanup(); });

const unread = (uid) => notifications.list(app.db, uid, { onlyUnread: true });
const events = (id) => app.db.all('SELECT * FROM task_events WHERE task_id = ? ORDER BY id', id);
const post = (c, path, fields, page = '/') => c.postForm(page, path, fields);
const year = new Date().getFullYear();

test('access: the board needs a level; a module that is switched off or has level none answers 404 / 403', async () => {
  assert.equal((await viewer.get('/mentenanta')).status, 200);
  assert.equal((await outsider.get('/mentenanta')).status, 403);
  assert.equal((await outsider.get('/calitate/sarcini')).status, 403);
  assert.equal((await outsider.get('/tehnic')).status, 200, 'Technical is open to everybody');
  modules.set(app.db, 'maintenance', false);
  assert.equal((await lead.get('/mentenanta')).status, 404);
  modules.set(app.db, 'maintenance', true);
  assert.equal((await viewer.get('/mentenanta/nou')).status, 403, 'view cannot create');
  assert.equal((await worker.get('/mentenanta/nou')).status, 200, 'enter can request a task');
});

test('a request from a user with the enter level: numbered, default priority, assignees ignored, the lead is told; the requester cannot move it on', async () => {
  const r = await post(worker, '/mentenanta/nou', { title: 'Zgomot la rotor 2', description: 'Se aude de dimineață', priority_id: String(ids.high), due_date: '', machine_id: String(ids.machine), area: '', assignees: String(ids.pFitter) });
  assert.equal(r.status, 303);
  const t = app.db.get("SELECT * FROM tasks WHERE title = 'Zgomot la rotor 2'");
  assert.equal(t.no, `MT-${year}-0001`);
  assert.equal(t.status, 'open');
  assert.equal(t.created_by, ids.worker);
  assert.equal(app.db.value('SELECT count(*) FROM task_assignees WHERE task_id = ?', t.id), 0, 'only a lead assigns');
  assert.equal(events(t.id)[0].kind, 'created');
  assert.deepEqual(unread(ids.lead).map((n) => n.kind), ['task_new']);
  assert.equal(unread(ids.lead)[0].params.no, t.no);
  assert.equal(unread(ids.worker).length, 0, 'not told about their own action');
  ids.t1 = t.id;
  assert.equal((await post(worker, `/sarcini/${t.id}/stare`, { to: 'in_progress' })).status, 403);
  assert.equal(app.db.get('SELECT status FROM tasks WHERE id = ?', t.id).status, 'open');
  assert.equal((await post(viewer, `/sarcini/${t.id}/comentariu`, { text: 'x' })).status, 403, 'view cannot comment');
  // validation
  const bad = await post(worker, '/mentenanta/nou', { title: '', due_date: '31-12-2026' });
  assert.equal(bad.status, 422);
  assert.match(textOf(bad.text), /Câmp obligatoriu|Valoare nevalidă/);
  assert.equal(app.db.value('SELECT count(*) FROM tasks'), 1);
});

test('the lead assigns (people with and without a login), changes status; everybody involved is told; history and audit are kept', async () => {
  const t = ids.t1;
  let r = await post(lead, `/sarcini/${t}/atribuie`, { assignees: [String(ids.pWorker), String(ids.pFitter)] });
  assert.equal(r.status, 303);
  assert.equal(app.db.value('SELECT count(*) FROM task_assignees WHERE task_id = ?', t), 2);
  assert.deepEqual(unread(ids.worker).map((n) => n.kind), ['task_assigned'], 'the assignee with a login is told; the fitter without one cannot be');
  const assignEv = events(t).find((e) => e.kind === 'assign');
  assert.match(JSON.parse(assignEv.details).names_added, /Ion Lăcătuș/);
  notifications.markAllRead(app.db, ids.worker); notifications.markAllRead(app.db, ids.lead);
  r = await post(lead, `/sarcini/${t}/stare`, { to: 'in_progress', comment: 'Am început', back: '/mentenanta' });
  assert.equal(r.status, 303);
  assert.equal(r.location, '/mentenanta');
  assert.equal(app.db.get('SELECT status FROM tasks WHERE id = ?', t).status, 'in_progress');
  assert.deepEqual(unread(ids.worker).map((n) => n.kind), ['task_status']);
  assert.equal(unread(ids.lead).length, 0, 'not told about their own action');
  assert.equal(notifications.list(app.db, ids.worker)[0].params.to, 'in_progress');
  // an unknown or same status is refused; a hostile back address is ignored
  assert.match((await post(lead, `/sarcini/${t}/stare`, { to: 'in_progress' })).location, /\/sarcini\//);
  r = await post(lead, `/sarcini/${t}/stare`, { to: 'waiting', back: '//evil.example' });
  assert.equal(r.location, `/sarcini/${t}`);
  assert.equal(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'task_status'"), 2);
  const text = events(t).filter((e) => e.kind === 'status').map((e) => `${e.from_status}>${e.to_status}`);
  assert.deepEqual(text, ['open>in_progress', 'in_progress>waiting']);
});

test('cancel and reopen need a reason; anyone allowed to update may close; closed tasks leave the active board and stay in the closed list', async () => {
  const t = ids.t1;
  let r = await post(lead, `/sarcini/${t}/stare`, { to: 'cancelled', comment: '' });
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT status FROM tasks WHERE id = ?', t).status, 'waiting', 'no reason: refused');
  r = await post(lead, `/sarcini/${t}/stare`, { to: 'done' });
  assert.equal(app.db.get('SELECT status FROM tasks WHERE id = ?', t).status, 'done');
  r = await post(lead, `/sarcini/${t}/stare`, { to: 'closed', comment: 'Verificat' });
  const row = app.db.get('SELECT * FROM tasks WHERE id = ?', t);
  assert.equal(row.status, 'closed'); assert.equal(row.closed_by, ids.lead); assert.ok(row.closed_at);
  assert.ok(!(await lead.get('/mentenanta')).text.includes('Zgomot la rotor 2'), 'not on the active board');
  assert.ok((await lead.get('/mentenanta?view=closed')).text.includes('Zgomot la rotor 2'));
  assert.ok((await lead.get('/mentenanta?view=all')).text.includes('Zgomot la rotor 2'));
  r = await post(lead, `/sarcini/${t}/stare`, { to: 'open', comment: '' });
  assert.equal(app.db.get('SELECT status FROM tasks WHERE id = ?', t).status, 'closed', 'reopening needs a reason');
  r = await post(lead, `/sarcini/${t}/stare`, { to: 'open', comment: 'Revine zgomotul' });
  assert.equal(app.db.get('SELECT status, closed_at FROM tasks WHERE id = ?', t).status, 'open');
  assert.equal(app.db.get('SELECT closed_at FROM tasks WHERE id = ?', t).closed_at, null);
  assert.equal(events(t).filter((e) => e.kind === 'status').length, 5, 'every change is in the history');
  // Technical: everybody updates and closes
  const rt = await post(worker, '/tehnic/nou', { title: 'Modificare rețetă', priority_id: '', due_date: '' });
  assert.equal(rt.status, 303);
  const tt = app.db.get("SELECT * FROM tasks WHERE title = 'Modificare rețetă'");
  assert.match(tt.no, new RegExp(`^TH-${year}-0001$`));
  assert.equal((await post(tech, `/sarcini/${tt.id}/stare`, { to: 'closed', comment: '' })).status, 303);
  assert.equal(app.db.get('SELECT status FROM tasks WHERE id = ?', tt.id).status, 'closed');
  assert.equal(app.db.get('SELECT closed_by FROM tasks WHERE id = ?', tt.id).closed_by, ids.tech);
  assert.ok(unread(ids.worker).some((n) => n.kind === 'task_status' && n.params.no === tt.no), 'the creator is told it was closed');
  ids.t2 = tt.id;
});

test('comments are kept in the history and tell the others; editing records what changed', async () => {
  const t = ids.t1;
  notifications.markAllRead(app.db, ids.worker);
  const r = await post(worker, `/sarcini/${t}/comentariu`, { text: 'Se aude și azi seară' });
  assert.equal(r.status, 303);
  assert.ok(events(t).some((e) => e.kind === 'comment' && e.text === 'Se aude și azi seară' && e.user_id === ids.worker));
  assert.ok(unread(ids.lead).some((n) => n.kind === 'task_comment') === false, 'the lead is not a creator or assignee, so not told');
  const e = await post(lead, `/sarcini/${t}/editeaza`, { title: 'Zgomot la rotor 2 (urgent)', description: '', priority_id: String(ids.critical), due_date: '2020-01-01', machine_id: '', area: 'Hala 2', assignees: String(ids.pWorker) });
  assert.equal(e.status, 303);
  const row = app.db.get('SELECT * FROM tasks WHERE id = ?', t);
  assert.equal(row.title, 'Zgomot la rotor 2 (urgent)'); assert.equal(row.area, 'Hala 2'); assert.equal(row.machine_id, null);
  const edit = events(t).filter((x) => x.kind === 'edit').pop();
  const changed = JSON.parse(edit.details);
  assert.deepEqual(Object.keys(changed).sort(), ['area', 'description', 'due_date', 'machine_id', 'priority_id', 'title']);
  assert.equal(changed.title.from, 'Zgomot la rotor 2');
  assert.equal(app.db.value('SELECT count(*) FROM task_assignees WHERE task_id = ?', t), 1, 'the fitter was removed');
  const page = (await lead.get(`/sarcini/${t}`)).text;
  assert.ok(page.includes('Se aude și azi seară') && page.includes('class="timeline"'));
  assert.match(textOf(page), /întârziată/, 'a past due date on an open task is overdue');
  assert.equal((await post(worker, `/sarcini/${t}/editeaza`, { title: 'x' })).status, 403, 'the creator without lead cannot edit');
});

test('the board: sorted by priority, filters (person, priority, text, overdue), counts, overdue notice', async () => {
  const mk = (title, p, due, who) => tasks.create(app.db, app.db.get('SELECT * FROM users WHERE id = ?', ids.lead), { team: 'maintenance', title, priority_id: p, due_date: due, assignees: who });
  mk('Lubrifiere lagăre', ids.high, '2099-01-01', [ids.pFitter]);
  mk('Schimb filtru', app.db.get("SELECT id FROM priorities WHERE name_en = 'Low'").id, null, []);
  const board = (await lead.get('/mentenanta')).text;
  assert.ok(board.indexOf('Zgomot la rotor 2 (urgent)') < board.indexOf('Lubrifiere lagăre') && board.indexOf('Lubrifiere lagăre') < board.indexOf('Schimb filtru'), 'critical first, then high, then low');
  const only = (q) => lead.get(`/mentenanta?${q}`).then((r) => r.text);
  assert.ok((await only(`person=${ids.pFitter}`)).includes('Lubrifiere lagăre') && !(await only(`person=${ids.pFitter}`)).includes('Schimb filtru'));
  assert.ok(!(await only(`priority=${ids.high}`)).includes('Schimb filtru'));
  assert.ok((await only('q=filtru')).includes('Schimb filtru') && !(await only('q=filtru')).includes('Lubrifiere'));
  const od = await only('overdue=1');
  assert.ok(od.includes('Zgomot la rotor 2 (urgent)') && !od.includes('Lubrifiere'));
  assert.match(textOf(board), /1 sarcini întârziate/);
  assert.deepEqual(tasks.counts(app.db, 'maintenance'), { active: 3, overdue: 1, finished: 0 });
  // a wildcard in the search is plain text
  assert.ok(!(await only('q=%25')).includes('Schimb filtru'));
});

test('the printable work list, grouped by person; English pages and texts', async () => {
  const p = await lead.get(`/sarcini/tipar?team=maintenance&group=person&view=active`);
  assert.equal(p.status, 200);
  assert.ok(p.text.includes('Listă de lucru') && p.text.includes('Ion Lăcătuș') && p.text.includes('Operator CTC') && p.text.includes('neatribuită'));
  assert.ok(p.text.includes('Zgomot la rotor 2 (urgent)') && p.text.includes('☐'));
  assert.equal((await outsider.get('/sarcini/tipar?team=maintenance')).status, 403);
  assert.equal((await lead.get('/sarcini/tipar?team=nope')).status, 404);
  await post(lead, '/limba', { lang: 'en', back: '/' });
  for (const url of ['/mentenanta', '/mentenanta/nou', `/sarcini/${ids.t1}`, `/sarcini/${ids.t1}/editeaza`, '/sarcini/tipar?team=maintenance', '/tehnic', '/calitate/sarcini']) {
    const r = await lead.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(!r.text.includes('⟦'), url);
  }
  const en = textOf((await lead.get(`/sarcini/${ids.t1}`)).text);
  assert.ok(en.includes('Change the status') && en.includes('History') && en.includes('Start'));
  assert.equal(app.db.get("SELECT status FROM tasks WHERE id = ?", ids.t1).status, 'open');
  // a notification is shown in the reader's language, status names translated
  const n = notifications.list(app.db, ids.worker).find((x) => x.kind === 'task_status');
  const w = await post(worker, '/limba', { lang: 'en', back: '/' });
  const txt = textOf((await worker.get('/notificari')).text);
  assert.match(txt, /task MT-\d{4}-\d{4}.*(In progress|Closed|Open)/i);
  assert.ok(n);
});

test('nothing can be deleted: there is no delete route and the table keeps every task', async () => {
  const before = app.db.value('SELECT count(*) FROM tasks');
  assert.ok(before >= 3);
  assert.equal((await post(lead, `/sarcini/${ids.t1}/sterge`, {})).status, 404);
  assert.equal(app.db.value('SELECT count(*) FROM tasks'), before);
});
