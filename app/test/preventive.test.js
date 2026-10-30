'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const pm = require('../domain/preventive');
const tasks = require('../domain/tasks');
const access = require('../domain/access');
const modules = require('../domain/modules');

let app, lead, worker, outsider, ids = {};
const post = (c, path, fields, page = '/') => c.postForm(page, path, fields);
const today = () => pm.today();
const add = tasks.addDays;
const B = '/mentenanta/preventiv';
const plan = (id) => app.db.get('SELECT * FROM pm_plans WHERE id = ?', id);

test.before(async () => {
  app = await startApp();
  const admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.pm', 'personal', 'Șef Preventiv');
  worker = await makeUser(app, admin, 'worker.pm', 'personal', 'Operator Preventiv');
  outsider = await makeUser(app, admin, 'none.pm', 'personal', 'Fără acces');
  const db = app.db;
  const uid = (n) => db.get('SELECT id FROM users WHERE username = ?', n).id;
  ids = { lead: uid('lead.pm'), worker: uid('worker.pm'), outsider: uid('none.pm') };
  access.setUserLevels(db, ids.lead, { maintenance: 'lead' });
  access.setUserLevels(db, ids.worker, { maintenance: 'view' });
  access.setUserLevels(db, ids.outsider, { maintenance: 'none' });
  ids.pLead = db.run("INSERT INTO people(name, team, user_id) VALUES ('Șef Preventiv', 'maintenance', ?)", ids.lead).id;
  ids.pFitter = db.run("INSERT INTO people(name, team) VALUES ('Ion Lăcătuș', 'maintenance')").id;
  ids.machine = db.get('SELECT id FROM machines ORDER BY id').id;
  ids.high = db.get("SELECT id FROM priorities WHERE name_en = 'High'").id;
});
test.after(async () => { await app.cleanup(); });

const mk = (o = {}) => { const r = mk0(o); pm.ensure(app.db); return r; };
const mk0 = (o = {}) => pm.create(app.db, { id: ids.lead, full_name: 'Șef Preventiv' }, { title: 'Lubrifiere lagăre', every_n: 2, unit: 'weeks', next_due: add(today(), 2), lead_days: 3, people: [ids.pFitter], steps: 'Oprire\nLubrifiere\n\nPornire', priority_id: ids.high, machine_id: ids.machine, ...o });

test('date arithmetic: days, weeks and months (month ends stay in range)', () => {
  assert.equal(pm.addInterval('2026-11-30', 10, 'days'), '2026-12-10');
  assert.equal(pm.addInterval('2026-12-25', 2, 'weeks'), '2027-01-08');
  assert.equal(pm.addInterval('2026-01-31', 1, 'months'), '2026-02-28');
  assert.equal(pm.addInterval('2028-01-31', 1, 'months'), '2028-02-29', 'leap year');
  assert.equal(pm.addInterval('2026-11-15', 3, 'months'), '2027-02-15');
  assert.equal(pm.addInterval('2026-11-15', 14, 'months'), '2028-01-15');
});

test('access: plans are seen by view, managed by lead; a module that is off answers 404; nobody without access', async () => {
  assert.equal((await worker.get(B)).status, 200);
  assert.equal((await worker.get(`${B}/nou`)).status, 403, 'view cannot add plans');
  assert.equal((await lead.get(`${B}/nou`)).status, 200);
  assert.equal((await outsider.get(B)).status, 403);
  modules.set(app.db, 'maintenance', false);
  assert.equal((await lead.get(B)).status, 404);
  modules.set(app.db, 'maintenance', true);
});

test('a plan: validation, then a task appears within its lead time, once, with the steps, people, priority and machine', async () => {
  const bad = await post(lead, `${B}/nou`, { title: '', every_n: '0', unit: 'weeks', next_due: '31-12-2030', lead_days: '-1' }, `${B}/nou`);
  assert.equal(bad.status, 422);
  const r = await post(lead, `${B}/nou`, { title: 'Lubrifiere lagăre', every_n: '2', unit: 'weeks', basis: 'schedule', next_due: add(today(), 2), lead_days: '3', priority_id: String(ids.high), machine_id: String(ids.machine), people: [String(ids.pFitter), String(ids.pLead)], steps: 'Oprire\nLubrifiere\n\nPornire' }, `${B}/nou`);
  assert.equal(r.status, 303);
  const p = app.db.get("SELECT * FROM pm_plans WHERE title = 'Lubrifiere lagăre'");
  assert.ok(p);
  // creating the plan and opening a page made the task (due in 2 days, lead time 3)
  const t = app.db.get("SELECT * FROM tasks WHERE source_kind = 'preventive' AND source_id = ?", p.id);
  assert.ok(t, 'the task was made');
  assert.equal(t.due_date, add(today(), 2)); assert.equal(t.team, 'maintenance'); assert.equal(t.priority_id, ids.high); assert.equal(t.machine_id, ids.machine);
  assert.equal(app.db.value('SELECT count(*) FROM task_assignees WHERE task_id = ?', t.id), 2);
  assert.deepEqual(tasks.checklistOf(app.db, t.id).map((c) => c.text), ['Oprire', 'Lubrifiere', 'Pornire']);
  assert.equal(pm.ensure(app.db).made, 0, 'a second call makes nothing');
  assert.equal(app.db.value("SELECT count(*) FROM tasks WHERE source_kind = 'preventive'"), 1);
  assert.equal(app.db.get('SELECT task_id FROM pm_runs WHERE plan_id = ?', p.id).task_id, t.id);
  assert.equal(pm.stateOf(app.db, plan(p.id)).key, 'task');
  ids.p1 = p.id; ids.t1 = t.id;
  // the task page links back to the plan's kind of source
  assert.ok(textOf((await lead.get(`/sarcini/${t.id}`)).text).includes('preventiv'));
});

test('finishing the task moves the plan on: from the planned date, or from the day it was done; a plan far behind does not pile up', async () => {
  // 1) schedule basis: 2 weeks after the planned date
  const planned = plan(ids.p1).next_due;
  tasks.changeStatus(app.db, { id: ids.lead, full_name: 'x' }, ids.t1, 'done', null);
  tasks.changeStatus(app.db, { id: ids.lead, full_name: 'x' }, ids.t1, 'closed', null);
  const r = pm.ensure(app.db);
  assert.equal(r.advanced, 1);
  const p = plan(ids.p1);
  assert.equal(p.next_due, add(planned, 14), 'two weeks after the planned date');
  assert.equal(p.last_done, today());
  assert.equal(app.db.get('SELECT advanced FROM pm_runs WHERE plan_id = ?', ids.p1).advanced, 1);
  assert.equal(pm.ensure(app.db).advanced, 0, 'only once');
  // 2) completion basis: counted from today even if planned earlier
  const c = mk({ title: 'Verificare filtre', every_n: '1', unit: 'months', basis: 'completion', next_due: add(today(), 1), lead_days: 5 });
  const ct = app.db.get("SELECT id FROM tasks WHERE source_kind = 'preventive' AND source_id = ?", c.id).id;
  tasks.changeStatus(app.db, { id: ids.lead, full_name: 'x' }, ct, 'done', null); tasks.changeStatus(app.db, { id: ids.lead, full_name: 'x' }, ct, 'closed', null);
  pm.ensure(app.db);
  assert.equal(plan(c.id).next_due, pm.addInterval(today(), 1, 'months'), 'a month after the day it was done');
  // 3) a weekly plan that was 100 days late is moved to a future date, not given ten tasks
  const old = mk({ title: 'Plan în urmă', every_n: '1', unit: 'weeks', next_due: add(today(), -100), lead_days: 0 });
  assert.equal(pm.stateOf(app.db, plan(old.id)).key, 'task', 'its task exists (overdue)');
  const ot = app.db.get("SELECT id FROM tasks WHERE source_kind = 'preventive' AND source_id = ?", old.id).id;
  tasks.changeStatus(app.db, { id: ids.lead, full_name: 'x' }, ot, 'done', null); tasks.changeStatus(app.db, { id: ids.lead, full_name: 'x' }, ot, 'closed', null);
  pm.ensure(app.db);
  const after = plan(old.id);
  assert.ok(after.next_due >= today() && after.next_due <= add(today(), 7), `next date is in the coming week (${after.next_due})`);
  assert.equal(app.db.value('SELECT count(*) FROM tasks WHERE source_kind = ? AND source_id = ?', 'preventive', old.id), 1);
  // 4) a cancelled task moves the plan on without a "done" date
  const x = mk({ title: 'Plan anulat', every_n: '1', unit: 'weeks', next_due: add(today(), 1), lead_days: 3 });
  const xt = app.db.get("SELECT id FROM tasks WHERE source_kind = 'preventive' AND source_id = ?", x.id).id;
  tasks.changeStatus(app.db, { id: ids.lead, full_name: 'x' }, xt, 'cancelled', 'Utilaj scos din uz');
  pm.ensure(app.db);
  assert.equal(plan(x.id).next_due, add(add(today(), 1), 7)); assert.equal(plan(x.id).last_done, null);
});

test('make the task now before its time; skip a round with a reason; one row per due date', async () => {
  const p = mk({ title: 'Revizie anuală', every_n: '12', unit: 'months', next_due: add(today(), 60), lead_days: 3 });
  assert.equal(app.db.value('SELECT count(*) FROM tasks WHERE source_kind = ? AND source_id = ?', 'preventive', p.id), 0, 'not within its lead time yet');
  assert.equal((await post(worker, `${B}/${p.id}/genereaza`, {}, B)).status, 403);
  await post(lead, `${B}/${p.id}/genereaza`, {}, `${B}/${p.id}`);
  assert.equal(app.db.value('SELECT count(*) FROM tasks WHERE source_kind = ? AND source_id = ?', 'preventive', p.id), 1);
  await post(lead, `${B}/${p.id}/genereaza`, {}, `${B}/${p.id}`);
  assert.equal(app.db.value('SELECT count(*) FROM tasks WHERE source_kind = ? AND source_id = ?', 'preventive', p.id), 1, 'never twice for the same date');
  // skipping needs a reason and a round that has no task yet
  const s = mk({ title: 'Plan de sărit', every_n: '1', unit: 'weeks', next_due: add(today(), 30), lead_days: 3 });
  await post(lead, `${B}/${s.id}/sari`, { reason: '' }, `${B}/${s.id}`);
  assert.equal(plan(s.id).next_due, add(today(), 30), 'no reason: nothing changes');
  await post(lead, `${B}/${s.id}/sari`, { reason: 'Utilaj oprit pentru revizie' }, `${B}/${s.id}`);
  assert.equal(plan(s.id).next_due, add(today(), 37));
  const run = app.db.get("SELECT * FROM pm_runs WHERE plan_id = ? AND outcome = 'skipped'", s.id);
  assert.ok(run && run.skip_reason.includes('revizie') && run.advanced === 1);
  assert.ok(textOf((await lead.get(`${B}/${s.id}`)).text).includes('Utilaj oprit pentru revizie'), 'the history shows the reason');
  await post(lead, `${B}/${p.id}/sari`, { reason: 'x' }, `${B}/${p.id}`);
  assert.equal(app.db.value("SELECT count(*) FROM pm_runs WHERE plan_id = ? AND outcome = 'skipped'", p.id), 0, 'a round with a task cannot be skipped');
});

test('edit and stop: a plan with a task keeps its date; a stopped plan makes nothing; nothing is deleted', async () => {
  const p = mk({ title: 'Plan de modificat', every_n: '1', unit: 'weeks', next_due: add(today(), 1), lead_days: 3, steps: 'A' });
  const due = plan(p.id).next_due;
  await post(lead, `${B}/${p.id}/editeaza`, { title: 'Plan modificat', every_n: '3', unit: 'days', basis: 'completion', next_due: add(today(), 40), lead_days: '2', steps: 'A\nB', people: [String(ids.pLead)] }, `${B}/${p.id}/editeaza`);
  const e = plan(p.id);
  assert.equal(e.title, 'Plan modificat'); assert.equal(e.every_n, 3); assert.equal(e.unit, 'days'); assert.equal(e.basis, 'completion');
  assert.equal(e.next_due, due, 'its task exists, so the date stays');
  assert.equal(app.db.value('SELECT count(*) FROM pm_plan_steps WHERE plan_id = ?', p.id), 2);
  // a stopped plan makes nothing and reads as stopped; starting it again makes its task
  const st = mk0({ title: 'Plan oprit', every_n: '1', unit: 'weeks', next_due: add(today(), 1), lead_days: 3 });
  await post(lead, `${B}/${st.id}/activ`, { active: '0' }, `${B}/${st.id}`);
  pm.ensure(app.db);
  assert.equal(app.db.value('SELECT count(*) FROM tasks WHERE source_kind = ? AND source_id = ?', 'preventive', st.id), 0);
  assert.equal(pm.stateOf(app.db, plan(st.id)).key, 'inactive');
  await post(lead, `${B}/${st.id}/activ`, { active: '1' }, `${B}/${st.id}`);
  assert.equal(app.db.value('SELECT count(*) FROM tasks WHERE source_kind = ? AND source_id = ?', 'preventive', st.id), 1);
  const before = app.db.value('SELECT count(*) FROM pm_plans');
  assert.equal((await post(lead, `${B}/${st.id}/sterge`, {})).status, 404, 'there is no delete');
  assert.equal(app.db.value('SELECT count(*) FROM pm_plans'), before);
});

test('pages: the list with tiles and filters, a plan page with its history, English screens; plans of other teams', async () => {
  const other = mk({ title: 'Verificare calibre', team: 'quality', every_n: '3', unit: 'months', next_due: add(today(), 90), lead_days: 7 });
  const list = textOf((await lead.get(B)).text);
  assert.ok(list.includes('Lubrifiere lagăre') && list.includes('Verificare calibre'));
  assert.ok(list.includes('La fiecare 3 luni') && list.includes('La fiecare 2 săptămâni'), 'the frequency reads in words');
  assert.ok(!(await lead.get(`${B}?view=stopped`)).text.includes('Verificare calibre'), 'the stopped list holds only stopped plans');
  assert.ok((await lead.get(`${B}?q=calibre`)).text.includes('Verificare calibre') && !(await lead.get(`${B}?q=calibre`)).text.includes('Lubrifiere lagăre'));
  assert.ok(app.db.get("SELECT 1 FROM audit_log WHERE action = 'pm_plan_save'") && app.db.get("SELECT 1 FROM audit_log WHERE action = 'pm_task'"));
  const planPage = textOf((await lead.get(`${B}/${ids.p1}`)).text);
  assert.ok(planPage.includes('Istoric') && planPage.includes('Oprire') && planPage.includes('Lubrifiere'));
  assert.equal((await lead.get(`${B}/999999`)).status, 404);
  assert.equal((await worker.get(`${B}/${other.id}/editeaza`)).status, 403);
  // home counts the plan tasks like any task; the board refreshes plans too
  assert.ok(textOf((await lead.get('/mentenanta')).text).includes('Revizie anuală'), 'the task made by hand shows on the board');
  await post(lead, '/limba', { lang: 'en', back: '/' });
  for (const url of [B, `${B}?state=due`, `${B}/nou`, `${B}/${ids.p1}`, `${B}/${ids.p1}/editeaza`, `${B}?view=all`]) {
    const r = await lead.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(!r.text.includes('⟦'), url);
  }
  const en = textOf((await lead.get(`${B}/${ids.p1}`)).text);
  assert.ok(en.includes('Every 2 weeks') && en.includes('History') && en.includes('Steps of the job'));
  assert.ok(textOf((await lead.get(B)).text).includes('Next due') && textOf((await lead.get(B)).text).includes('Every 3 months'));
});
