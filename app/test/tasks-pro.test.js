'use strict';
// The working options of the task boards: quick filters, sorting, grouping, bulk changes, checklist, plan / postpone, copy, export, work order.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const tasks = require('../domain/tasks');
const access = require('../domain/access');

let app, lead, worker, ids = {}, t = {};
const post = (c, path, fields, page = '/') => c.postForm(page, path, fields);
const row = (id) => app.db.get('SELECT * FROM tasks WHERE id = ?', id);

test.before(async () => {
  app = await startApp();
  const admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.pro', 'personal', 'Șef Pro');
  worker = await makeUser(app, admin, 'worker.pro', 'personal', 'Operator Pro');
  const db = app.db;
  ids.lead = db.get("SELECT id FROM users WHERE username = 'lead.pro'").id;
  ids.worker = db.get("SELECT id FROM users WHERE username = 'worker.pro'").id;
  access.setUserLevels(db, ids.lead, { maintenance: 'lead', quality: 'lead' });
  ids.pLead = db.run("INSERT INTO people(name, team, user_id) VALUES ('Șef Pro', 'maintenance', ?)", ids.lead).id;
  ids.pFitter = db.run("INSERT INTO people(name, team) VALUES ('Ion Lăcătuș', 'maintenance')").id;
  const u = { id: ids.lead, full_name: 'Șef Pro' };
  const mk = (team, title, o = {}) => tasks.create(db, u, { team, title, ...o }).id;
  t.a = mk('maintenance', 'Schimb ulei', { assignees: [ids.pLead], due_date: tasks.addDays(tasks.today(), 3) });
  t.b = mk('maintenance', 'Verificare senzor', { assignees: [ids.pFitter], due_date: tasks.addDays(tasks.today(), 30) });
  t.c = mk('maintenance', 'Curățenie hală', {});
  t.q = mk('quality', 'Lot de verificat', {});
  ids.high = db.get("SELECT id FROM priorities WHERE name_en = 'High'").id;
});
test.after(async () => { await app.cleanup(); });

const board = async (query = '') => textOf((await lead.get(`/mentenanta?${query}`)).text);

test('quick filters: mine, unassigned, due in 7 days, created by me; sort and group', async () => {
  assert.ok((await lead.get('/mentenanta')).text.includes('mine=1'), 'the chip shows for a user who is in the people list');
  assert.ok(!(await worker.get('/mentenanta')).text.includes('mine=1'), 'and not for one who is not');
  let b = await board('mine=1');
  assert.ok(b.includes('Schimb ulei') && !b.includes('Verificare senzor') && !b.includes('Curățenie hală'));
  b = await board('unassigned=1');
  assert.ok(b.includes('Curățenie hală') && !b.includes('Schimb ulei'));
  b = await board('soon=1');
  assert.ok(b.includes('Schimb ulei') && !b.includes('Verificare senzor'), 'only the next 7 days');
  assert.ok((await board('by_me=1')).includes('Curățenie hală'));
  assert.ok(!(await textOf((await worker.get('/mentenanta?by_me=1')).text)).includes('Curățenie hală'));
  // sort by due date: the one without a date is last; unknown values fall back
  const txt = await board('sort=due');
  assert.ok(txt.indexOf('Schimb ulei') < txt.indexOf('Verificare senzor') && txt.indexOf('Verificare senzor') < txt.indexOf('Curățenie hală'));
  assert.equal((await lead.get('/mentenanta?sort=%27%3B--&group=zzz')).status, 200);
  // grouped by person: a heading per person, unassigned included
  const g = await board('group=person');
  assert.ok(g.includes('Ion Lăcătuș') && g.includes('Șef Pro') && g.includes('neatribuită'));
  assert.ok((await board('group=status')).includes('Deschisă'));
});

test('bulk: the same change for several tasks; only a lead; other teams are skipped; reasons are not bypassed', async () => {
  const sel = { ids: [String(t.a), String(t.b), String(t.q)], team: 'maintenance' };
  assert.equal((await post(worker, '/sarcini/bulk', { ...sel, action: 'status', v_status: 'done' })).status, 403);
  let r = await post(lead, '/sarcini/bulk', { ...sel, action: 'status', v_status: 'in_progress', back: '/mentenanta' });
  assert.equal(r.status, 303);
  assert.equal(row(t.a).status, 'in_progress'); assert.equal(row(t.b).status, 'in_progress');
  assert.equal(row(t.q).status, 'open', 'a Quality task is skipped by a Maintenance bulk change');
  assert.match(r.location, /\/mentenanta/);
  r = await post(lead, '/sarcini/bulk', { ids: [String(t.a), String(t.b)], team: 'maintenance', action: 'assign', v_assign: String(ids.pFitter) });
  assert.equal(app.db.value('SELECT count(*) FROM task_assignees WHERE task_id = ? AND person_id = ?', t.a, ids.pFitter), 1);
  assert.equal(app.db.value('SELECT count(*) FROM task_assignees WHERE task_id = ?', t.a), 2, 'added to the others');
  await post(lead, '/sarcini/bulk', { ids: [String(t.c)], team: 'maintenance', action: 'priority', v_priority: String(ids.high) });
  assert.equal(row(t.c).priority_id, ids.high);
  await post(lead, '/sarcini/bulk', { ids: [String(t.c)], team: 'maintenance', action: 'due', v_due: '2031-05-06' });
  assert.equal(row(t.c).due_date, '2031-05-06');
  await post(lead, '/sarcini/bulk', { ids: [String(t.c)], team: 'maintenance', action: 'due', v_due: '' });
  assert.equal(row(t.c).due_date, null, 'an empty date clears it');
  // cancelling needs a reason, so a bulk cancel changes nothing
  r = await post(lead, '/sarcini/bulk', { ids: [String(t.c)], team: 'maintenance', action: 'status', v_status: 'cancelled' });
  assert.equal(row(t.c).status, 'open');
  assert.equal((await post(lead, '/sarcini/bulk', { team: 'maintenance', action: 'status', v_status: 'done' })).status, 303, 'nothing selected: back with a message');
  assert.ok(app.db.all("SELECT 1 FROM task_events WHERE task_id = ? AND kind = 'edit'", t.c).length >= 3, 'every change is in the history');
  assert.equal((await post(lead, '/sarcini/bulk', { ids: [String(t.a)], team: 'nope', action: 'status', v_status: 'done' })).status, 404);
});

test('checklist: add steps, tick, history, progress on the board, copy unticked, remove; only a lead', async () => {
  assert.equal((await post(worker, `/sarcini/${t.a}/pas`, { steps: 'x' }, `/sarcini/${t.a}`)).status, 403);
  let r = await post(lead, `/sarcini/${t.a}/pas`, { steps: 'Oprire utilaj\r\nDrenare ulei\n\n  Montare filtru nou  ' }, `/sarcini/${t.a}`);
  assert.equal(r.status, 303);
  const steps = tasks.checklistOf(app.db, t.a);
  assert.deepEqual(steps.map((s) => s.text), ['Oprire utilaj', 'Drenare ulei', 'Montare filtru nou']);
  assert.equal((await post(lead, `/sarcini/${t.a}/pas`, { steps: '   ' }, `/sarcini/${t.a}`)).status, 303);
  assert.equal(tasks.checklistOf(app.db, t.a).length, 3, 'blank adds nothing');
  await post(lead, `/sarcini/${t.a}/pas/${steps[0].id}/bifeaza`, { done: '1' }, `/sarcini/${t.a}`);
  const first = app.db.get('SELECT * FROM task_checklist WHERE id = ?', steps[0].id);
  assert.equal(first.done, 1); assert.equal(first.done_by, ids.lead); assert.ok(first.done_at);
  assert.ok((await board()).includes('1/3'), 'progress on the board');
  const page = textOf((await lead.get(`/sarcini/${t.a}`)).text);
  assert.ok(page.includes('Listă de verificare') && page.includes('Oprire utilaj'));
  assert.ok(page.includes('bifat'), 'the tick is in the history');
  // a step that belongs to another task cannot be changed through this one
  await post(lead, `/sarcini/${t.b}/pas/${steps[1].id}/bifeaza`, { done: '1' }, `/sarcini/${t.b}`);
  assert.equal(app.db.get('SELECT done FROM task_checklist WHERE id = ?', steps[1].id).done, 0);
  // copy as a new task: values and unticked steps
  assert.ok((await lead.get(`/mentenanta/nou?copy=${t.a}`)).text.includes('value="Schimb ulei"'));
  r = await post(lead, '/mentenanta/nou', { title: 'Schimb ulei', copy: String(t.a), priority_id: '', due_date: '' }, `/mentenanta/nou?copy=${t.a}`);
  assert.equal(r.status, 303);
  const copy = app.db.get("SELECT * FROM tasks WHERE title = 'Schimb ulei' AND id <> ?", t.a);
  const copied = tasks.checklistOf(app.db, copy.id);
  assert.equal(copied.length, 3); assert.ok(copied.every((c) => c.done === 0));
  // a copy of a task of another team is ignored
  assert.equal(tasks.copyValues(app.db, t.q, 'maintenance'), null);
  await post(lead, `/sarcini/${t.a}/pas/${steps[2].id}/sterge`, {}, `/sarcini/${t.a}`);
  assert.equal(tasks.checklistOf(app.db, t.a).length, 2);
  assert.ok(app.db.all("SELECT details FROM task_events WHERE task_id = ? AND kind = 'edit'", t.a).some((e) => e.details.includes('removed')));
});

test('plan: priority and due date in one tap; postponing counts from the later of today and the current date', async () => {
  const today = tasks.today();
  await post(lead, `/sarcini/${t.c}/planifica`, { priority_id: String(ids.high), due_date: '2031-01-31' }, `/sarcini/${t.c}`);
  assert.equal(row(t.c).due_date, '2031-01-31'); assert.equal(row(t.c).priority_id, ids.high);
  await post(lead, `/sarcini/${t.c}/planifica`, { postpone: '1m' }, `/sarcini/${t.c}`);
  assert.equal(row(t.c).due_date, '2031-02-28', 'month end is kept in range');
  await post(lead, `/sarcini/${t.c}/planifica`, { due_date: '2000-01-01' }, `/sarcini/${t.c}`);
  await post(lead, `/sarcini/${t.c}/planifica`, { postpone: '1w' }, `/sarcini/${t.c}`);
  assert.equal(row(t.c).due_date, tasks.addDays(today, 7), 'an overdue date is moved on from today');
  await post(lead, `/sarcini/${t.c}/planifica`, { due_date: 'not a date' }, `/sarcini/${t.c}`);
  assert.equal(row(t.c).due_date, tasks.addDays(today, 7), 'a bad date changes nothing');
  assert.equal((await post(worker, `/sarcini/${t.c}/planifica`, { postpone: '1d' }, `/sarcini/${t.c}`)).status, 403);
  assert.equal(tasks.addDays('2026-12-31', 1), '2027-01-01');
});

test('export and work order: CSV and Excel of the filtered list, one task on paper; English pages', async () => {
  const csv = await lead.get('/sarcini/export?team=maintenance&format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') || '', /text\/csv/);
  assert.ok(csv.text.includes('Schimb ulei') && csv.text.includes('Nr.'));
  const x = await lead.get('/sarcini/export?team=maintenance&format=xlsx');
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type') || '', /spreadsheetml/);
  assert.equal((await lead.get('/sarcini/export?team=maintenance&format=csv&mine=1')).text.includes('Verificare senzor'), false, 'follows the filters');
  assert.equal((await lead.get('/sarcini/export?team=nope')).status, 404);
  assert.equal((await worker.get('/sarcini/export?team=maintenance')).status, 200, 'anyone who may view the board may export it');
  const wo = await lead.get(`/sarcini/${t.a}/tipar`);
  assert.equal(wo.status, 200);
  assert.ok(wo.text.includes('Fișă de lucru') && wo.text.includes('Oprire utilaj') && wo.text.includes('☐'));
  await post(lead, '/limba', { lang: 'en', back: '/' });
  for (const url of ['/mentenanta', '/mentenanta?group=person&sort=due&mine=1', `/sarcini/${t.a}`, `/sarcini/${t.a}/tipar`, `/mentenanta/nou?copy=${t.a}`]) {
    const r = await lead.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(!r.text.includes('⟦'), url);
  }
  const en = textOf((await lead.get(`/sarcini/${t.a}`)).text);
  assert.ok(en.includes('Checklist') && en.includes('Postpone') && en.includes('Work order') && en.includes('Copy as a new task'));
  assert.ok(textOf((await lead.get('/mentenanta')).text).includes('Due in 7 days'));
});
