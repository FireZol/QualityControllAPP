'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const ncr = require('../domain/ncr');
const tasks = require('../domain/tasks');
const access = require('../domain/access');
const notifications = require('../domain/notifications');
const modules = require('../domain/modules');

let app, admin, lead, reporter, viewer, outsider, ctc, ids = {};
const post = (c, path, fields, page = '/') => c.postForm(page, path, fields);
const year = new Date().getFullYear();
const row = (id) => app.db.get('SELECT * FROM ncrs WHERE id = ?', id);
const evs = (id) => app.db.all('SELECT * FROM ncr_events WHERE ncr_id = ? ORDER BY id', id);
const notes = (uid, kind) => notifications.list(app.db, uid).filter((n) => !kind || n.kind === kind);
const N = '/calitate/neconformitati';

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.q', 'personal', 'Șef Calitate');
  reporter = await makeUser(app, admin, 'rep.q', 'personal', 'Operator Calitate');
  viewer = await makeUser(app, admin, 'view.q', 'personal', 'Observator Calitate');
  outsider = await makeUser(app, admin, 'none.q', 'personal', 'Fără acces');
  ctc = await makeUser(app, admin, 'ctc.q', 'personal', 'Operator CTC');
  const db = app.db;
  const uid = (n) => db.get('SELECT id FROM users WHERE username = ?', n).id;
  ids = { lead: uid('lead.q'), reporter: uid('rep.q'), viewer: uid('view.q'), outsider: uid('none.q') };
  access.setUserLevels(db, ids.lead, { quality: 'lead', maintenance: 'lead' });
  access.setUserLevels(db, ids.reporter, { quality: 'enter' });
  access.setUserLevels(db, ids.viewer, { quality: 'view' });
  access.setUserLevels(db, ids.outsider, { quality: 'none' });
  ids.pFitter = db.run("INSERT INTO people(name, team, user_id) VALUES ('Ion Lăcătuș', 'maintenance', ?)", ids.reporter).id;
  ids.machine = db.get('SELECT id FROM machines ORDER BY id').id;
  ids.machine2 = db.get('SELECT id FROM machines ORDER BY id LIMIT 1 OFFSET 1').id;
  ids.typeMass = db.get("SELECT id FROM ncr_types WHERE name_en = 'Mass'").id;
  ids.typeDim = db.get("SELECT id FROM ncr_types WHERE name_en = 'Dimensional'").id;
  ids.dispScrap = db.get("SELECT id FROM ncr_dispositions WHERE name_en = 'Scrap'").id;
  ids.high = db.get("SELECT id FROM priorities WHERE name_en = 'High'").id;
  // one measurement (out of limit) for the "from a measurement" flow
  const doc = db.get("SELECT id FROM spec_documents WHERE doc_type = 'CABLARE_RIGIDA_AL'").id;
  const rv = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', doc).id;
  const eng1 = await makeUser(app, admin, 'ing.q1', 'inginer', 'Ana Inginer'); const eng2 = await makeUser(app, admin, 'ing.q2', 'inginer', 'Bogdan Inginer');
  await eng1.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/trimite`, {}); await eng2.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/verifica`, {});
  const fam = db.get("SELECT id FROM product_families WHERE code = 'FUNIE_RIGIDA'").id;
  const mach = db.get('SELECT m.id FROM machines m JOIN machine_type_families f ON f.machine_type_id = m.machine_type_id WHERE f.family_id = ? AND m.active = 1', fam).id;
  const cons = db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", rv).id;
  await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(fam), machine_id: String(mach), construction_id: String(cons), level: 'funie', sample_type_id: String(db.get('SELECT id FROM sample_types ORDER BY id').id), h: '17,75', l: '22,55', mass_g: '560,0', sample_mm: '1000' });
  ids.record = db.get('SELECT record_no FROM measurements ORDER BY id').record_no;
  ids.measMachine = mach;
});
test.after(async () => { await app.cleanup(); });

test('access: the register needs a level; reporting needs enter; evaluating needs lead; a module that is off answers 404; tasks stay at /calitate/sarcini', async () => {
  assert.equal((await viewer.get('/calitate')).status, 200);
  assert.equal((await outsider.get('/calitate')).status, 403);
  assert.equal((await viewer.get('/calitate/nou')).status, 403, 'view cannot report');
  assert.equal((await reporter.get('/calitate/nou')).status, 200);
  assert.equal((await reporter.get('/calitate/sarcini')).status, 200, 'the Quality task board is still there');
  assert.equal((await lead.get('/calitate/top')).status, 200);
  modules.set(app.db, 'quality', false);
  assert.equal((await lead.get('/calitate')).status, 404);
  modules.set(app.db, 'quality', true);
});

test('reporting: numbered NC-yyyy-001, default severity, the lead is told; validation; history', async () => {
  const bad = await post(reporter, '/calitate/nou', { title: '', reported_at: '31-12-2030', type_id: '99999' }, '/calitate/nou');
  assert.equal(bad.status, 422);
  assert.equal(app.db.value('SELECT count(*) FROM ncrs'), 0);
  const r = await post(reporter, '/calitate/nou', { title: 'Masă sub limită la LITARE 2', description: 'Trei probe la rând', type_id: String(ids.typeMass), machine_id: String(ids.machine), product: '240 SM 90°', quantity: '2 colaci', reported_at: '' }, '/calitate/nou');
  assert.equal(r.status, 303);
  const n = app.db.get("SELECT * FROM ncrs WHERE title LIKE 'Masă sub%'");
  assert.equal(n.no, `NC-${year}-001`);
  assert.equal(n.status, 'reported'); assert.equal(n.reported_by, ids.reporter); assert.equal(n.reported_at, ncr.today());
  assert.ok(n.severity_id, 'a default severity (Normal) is set');
  assert.equal(notes(ids.lead, 'ncr_new').length, 1);
  assert.equal(notes(ids.reporter, 'ncr_new').length, 0, 'not told about their own report');
  assert.deepEqual(evs(n.id).map((e) => e.kind), ['created']);
  assert.match(textOf((await lead.get('/notificari')).text), /Neconformitate nouă NC-\d{4}-001: Masă sub limită la LITARE 2 \(de la Operator Calitate\)/);
  ids.n1 = n.id;
  const second = await post(reporter, '/calitate/nou', { title: 'Zgârieturi pe izolație', type_id: String(ids.typeDim), severity_id: String(ids.high), machine_id: String(ids.machine2), product: '95 RMC' }, '/calitate/nou');
  assert.equal(second.status, 303);
  assert.equal(app.db.get("SELECT no FROM ncrs WHERE title LIKE 'Zgâr%'").no, `NC-${year}-002`, 'the next number');
  ids.n2 = app.db.get("SELECT id FROM ncrs WHERE title LIKE 'Zgâr%'").id;
});

test('from a measurement: pre-filled, linked, and offered only to people who may report', async () => {
  const form = (await reporter.get(`/calitate/nou?record=${ids.record}`)).text;
  assert.ok(form.includes('value="240 SM 90°"') && form.includes(`name="record_no" value="${ids.record}"`) && form.includes('Valori în afara limitelor'));
  const r = await post(reporter, '/calitate/nou', { title: 'Valori în afara limitelor — 240 SM 90°', source_kind: 'measurement', record_no: String(ids.record), machine_id: String(ids.measMachine), product: '240 SM 90°' }, `/calitate/nou?record=${ids.record}`);
  assert.equal(r.status, 303);
  const n = app.db.get("SELECT * FROM ncrs WHERE source_kind = 'measurement'");
  assert.equal(n.record_no, ids.record);
  assert.ok((await lead.get(`${N}/${n.id}`)).text.includes(`href="/masuratori/${ids.record}"`), 'the record links back to the measurement');
  assert.ok((await reporter.get(`/masuratori/${ids.record}`)).text.includes(`/calitate/nou?record=${ids.record}`), 'the measurement offers the report');
  assert.ok(!(await viewer.get(`/masuratori/${ids.record}`)).text.includes('/calitate/nou?record='), 'not to a viewer');
  assert.equal((await post(reporter, '/calitate/nou', { title: 'x', source_kind: 'measurement', record_no: '99999999' }, '/calitate/nou')).status, 422, 'an unknown measurement is refused');
  ids.n3 = n.id;
});

test('evaluating and closing: lead only; closing needs a disposition; cancelling and reopening need a reason; history and notifications', async () => {
  const n = ids.n1;
  assert.equal((await post(reporter, `${N}/${n}/editeaza`, { part: 'eval', cause: 'x' }, `${N}/${n}`)).status, 403);
  assert.equal((await post(reporter, `${N}/${n}/stare`, { to: 'evaluation' }, `${N}/${n}`)).status, 403);
  await post(lead, `${N}/${n}/stare`, { to: 'evaluation', comment: 'Preluată' }, `${N}/${n}`);
  assert.equal(row(n).status, 'evaluation');
  assert.equal(notes(ids.reporter, 'ncr_status').length, 1, 'the reporter is told');
  await post(lead, `${N}/${n}/stare`, { to: 'closed', comment: '' }, `${N}/${n}`);
  assert.equal(row(n).status, 'evaluation', 'closing needs the decision on the product');
  await post(lead, `${N}/${n}/editeaza`, { part: 'eval', cause: 'Uzură filieră', evaluation: 'Lot afectat: 2 colaci', disposition_id: String(ids.dispScrap) }, `${N}/${n}`);
  assert.equal(row(n).cause, 'Uzură filieră'); assert.equal(row(n).disposition_id, ids.dispScrap);
  assert.ok(evs(n).some((e) => e.kind === 'edit' && /cause/.test(e.details)), 'the evaluation is in the history');
  await post(lead, `${N}/${n}/stare`, { to: 'cancelled', comment: '' }, `${N}/${n}`);
  assert.equal(row(n).status, 'evaluation', 'cancelling needs a reason');
  await post(lead, `${N}/${n}/stare`, { to: 'closed', comment: 'Rebut confirmat' }, `${N}/${n}`);
  const closed = row(n);
  assert.equal(closed.status, 'closed'); assert.ok(closed.closed_at); assert.equal(closed.closed_by, ids.lead);
  await post(lead, `${N}/${n}/stare`, { to: 'evaluation', comment: '' }, `${N}/${n}`);
  assert.equal(row(n).status, 'closed', 'reopening needs a reason');
  await post(lead, `${N}/${n}/stare`, { to: 'evaluation', comment: 'Reclamație nouă' }, `${N}/${n}`);
  assert.equal(row(n).status, 'evaluation'); assert.equal(row(n).closed_at, null);
  assert.equal(evs(n).filter((e) => e.kind === 'status').length, 3, 'evaluation, closed, reopened (refused changes leave no trace)');
  assert.ok(app.db.get("SELECT 1 FROM audit_log WHERE action = 'ncr_status'") && app.db.get("SELECT 1 FROM audit_log WHERE action = 'ncr_create'"));
  // the "title" edit by a lead: changes are recorded, an empty title is refused
  const bad = await post(lead, `${N}/${n}/editeaza`, { part: 'main', title: '', reported_at: ncr.today() }, `${N}/${n}/editeaza`);
  assert.equal(bad.status, 422);
  await post(lead, `${N}/${n}/editeaza`, { part: 'main', title: 'Masă sub limită — LITARE 2', description: 'Trei probe', type_id: String(ids.typeMass), machine_id: String(ids.machine), product: '240 SM 90°', quantity: '2 colaci', reported_at: ncr.today(), external_ref: 'XL-117' }, `${N}/${n}/editeaza`);
  assert.equal(row(n).external_ref, 'XL-117');
  assert.ok((await lead.get('/calitate?q=XL-117')).text.includes('Masă sub limită — LITARE 2'), 'the old Excel reference is searchable');
});

test('tasks from a record: any team, assigned, the record moves to action, finished records refuse more; reporter cannot', async () => {
  const n = ids.n2;
  assert.equal((await post(reporter, `${N}/${n}/sarcina`, { title: 'x', team: 'maintenance' }, `${N}/${n}`)).status, 403);
  const r = await post(lead, `${N}/${n}/sarcina`, { title: 'Schimbat filiera de izolare', team: 'maintenance', due_date: ncr.today(), priority_id: '', assignees: [String(ids.pFitter)] }, `${N}/${n}`);
  assert.equal(r.status, 303);
  const t = app.db.get("SELECT * FROM tasks WHERE source_kind = 'ncr' AND source_id = ?", n);
  assert.ok(t); assert.equal(t.team, 'maintenance'); assert.equal(t.machine_id, ids.machine2, 'the machine follows the record');
  assert.match(t.description, /NC-\d{4}-002/);
  assert.equal(row(n).status, 'action', 'the record moved to action');
  assert.ok(evs(n).some((e) => e.kind === 'status' && /auto/.test(e.details || '')) && evs(n).some((e) => e.kind === 'task'));
  assert.equal(notes(ids.reporter, 'task_assigned').filter((x) => x.params.no === t.no).length, 1, 'the assignee is told');
  const page = textOf((await lead.get(`${N}/${n}`)).text);
  assert.ok(page.includes(t.no) && page.includes('Schimbat filiera de izolare'));
  assert.ok(textOf((await lead.get(`/sarcini/${t.id}`)).text).includes('neconformitate'), 'the task shows where it came from');
  assert.ok(textOf((await lead.get('/calitate')).text).includes('0/1'), 'the register shows task progress');
  await post(lead, `${N}/${n}/sarcina`, { title: 'Echipă inexistentă', team: 'nope' }, `${N}/${n}`);
  await post(lead, `${N}/${n}/sarcina`, { title: '', team: 'quality' }, `${N}/${n}`);
  assert.equal(app.db.value("SELECT count(*) FROM tasks WHERE source_kind = 'ncr' AND source_id = ?", n), 1, 'bad requests make nothing');
  await post(lead, `${N}/${n}/sarcina`, { title: 'Controlul izolației', team: 'quality' }, `${N}/${n}`);
  assert.equal(app.db.value("SELECT count(*) FROM tasks WHERE source_kind = 'ncr' AND source_id = ?", n), 2);
  // a cancelled record takes no more tasks
  await post(lead, `${N}/${n}/stare`, { to: 'cancelled', comment: 'Raportare dublă' }, `${N}/${n}`);
  await post(lead, `${N}/${n}/sarcina`, { title: 'Prea târziu', team: 'quality' }, `${N}/${n}`);
  assert.equal(app.db.value("SELECT count(*) FROM tasks WHERE source_kind = 'ncr' AND source_id = ?", n), 2);
  await post(lead, `${N}/${n}/stare`, { to: 'evaluation', comment: 'Nu era dublă' }, `${N}/${n}`);
});

test('comments tell the reporter and the leads; viewers cannot comment', async () => {
  const n = ids.n1;
  notifications.markAllRead(app.db, ids.reporter);
  await post(lead, `${N}/${n}/comentariu`, { text: 'Verificat cu laboratorul' }, `${N}/${n}`);
  assert.ok(evs(n).some((e) => e.kind === 'comment' && e.text === 'Verificat cu laboratorul'));
  assert.equal(notes(ids.reporter, 'ncr_comment').length, 1);
  assert.equal((await post(viewer, `${N}/${n}/comentariu`, { text: 'x' }, `${N}/${n}`)).status, 403);
  await post(reporter, `${N}/${n}/comentariu`, { text: 'Mulțumesc' }, `${N}/${n}`);
  assert.ok(notes(ids.lead, 'ncr_comment').length >= 1);
});

test('the register: filters, sort, export; the top for the meeting; print; English screens; nothing is deleted', async () => {
  const list = textOf((await lead.get('/calitate')).text);
  assert.ok(list.includes('Zgârieturi pe izolație') && list.includes('NC-'));
  assert.ok(!(await lead.get(`/calitate?type=${ids.typeMass}`)).text.includes('Zgârieturi pe izolație'));
  assert.ok((await lead.get(`/calitate?severity=${ids.high}`)).text.includes('Zgârieturi pe izolație') && !(await lead.get(`/calitate?severity=${ids.high}`)).text.includes('Masă sub limită'));
  assert.ok((await lead.get(`/calitate?machine=${ids.machine2}`)).text.includes('Zgârieturi') && !(await lead.get(`/calitate?machine=${ids.machine2}`)).text.includes('Masă sub'));
  assert.ok((await reporter.get('/calitate?mine=1')).text.includes('Zgârieturi'), 'mine = reported by me');
  assert.ok(!(await lead.get('/calitate?mine=1')).text.includes('Zgârieturi'), 'the lead reported none');
  assert.ok((await lead.get('/calitate?status=evaluation')).text.includes('Masă sub limită'));
  const sorted = textOf((await lead.get('/calitate?sort=severity')).text);
  assert.ok(sorted.indexOf('Zgârieturi') < sorted.indexOf('Masă sub limită'), 'High before Normal');
  assert.equal((await lead.get('/calitate?sort=%27%3B--&view=zzz&days=abc')).status, 200);
  const csv = await lead.get('/calitate/export?format=csv');
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.ok(csv.text.includes('NC-') && csv.text.includes('XL-117'));
  assert.match((await lead.get('/calitate/export?format=xlsx')).headers.get('content-type'), /spreadsheetml/);
  // top (the record made from the measurement gets the Mass type: two of the three are Mass)
  ncr.update(app.db, { id: ids.lead, full_name: 'x' }, ids.n3, { type_id: ids.typeMass });
  const t = ncr.top(app.db, { days: 30, by: 'type' });
  assert.equal(t.total, 3, 'three records in 30 days');
  assert.equal(t.rows[0].cnt, 2, 'Mass is the most frequent'); assert.equal(t.rows[0].name, 'Masă'); assert.equal(t.rows[0].share, 67);
  const byMachine = ncr.top(app.db, { days: 30, by: 'machine' });
  assert.equal(byMachine.rows.reduce((a, r) => a + r.cnt, 0), 3, 'every record is counted under its machine');
  assert.ok(byMachine.rows.length >= 2);
  assert.ok(ncr.top(app.db, { days: 30, by: 'product' }).rows.some((r) => r.name === '95 RMC'));
  app.db.run("UPDATE ncrs SET status = 'cancelled', closed_at = datetime('now') WHERE id = ?", ids.n2);
  assert.equal(ncr.top(app.db, { days: 30, by: 'type' }).total, 2, 'cancelled records are not counted');
  app.db.run("UPDATE ncrs SET status = 'evaluation', closed_at = NULL WHERE id = ?", ids.n2);
  assert.equal(ncr.top(app.db, { days: 0 + 30, by: 'type' }).total, 3);
  const old = app.db.run("INSERT INTO ncrs(no, title, status, reported_by, reported_at, created_at, updated_at) VALUES ('NC-OLD-1', 'Veche', 'closed', ?, '2020-01-01', '2020-01-01', '2020-01-01')", ids.lead).id;
  assert.equal(ncr.top(app.db, { days: 365, by: 'type' }).total, 3, 'old records fall outside the period');
  assert.ok(textOf((await lead.get('/calitate/top?days=90&by=machine')).text).includes('Top neconformități'));
  assert.equal((await lead.get('/calitate/top?days=7&by=zzz')).status, 200);
  // print and no delete
  const pr = await lead.get(`${N}/${ids.n1}/tipar`);
  assert.equal(pr.status, 200); assert.ok(pr.text.includes('Neconformitate') && pr.text.includes('Uzură filieră'));
  assert.equal((await outsider.get(`${N}/${ids.n1}/tipar`)).status, 403);
  assert.equal((await lead.get(`${N}/999999`)).status, 404);
  const count = app.db.value('SELECT count(*) FROM ncrs');
  assert.equal((await post(lead, `${N}/${ids.n1}/sterge`, {})).status, 404);
  assert.equal(app.db.value('SELECT count(*) FROM ncrs'), count);
  void old;
  // English
  await post(lead, '/limba', { lang: 'en', back: '/' });
  for (const url of ['/calitate', '/calitate?view=all', '/calitate/nou', `/calitate/nou?record=${ids.record}`, '/calitate/top', '/calitate/top?by=product&days=365', `${N}/${ids.n1}`, `${N}/${ids.n1}/editeaza`, `${N}/${ids.n1}/tipar`, '/']) {
    const r = await lead.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(!r.text.includes('⟦'), url);
  }
  await post(admin, '/limba', { lang: 'en', back: '/' });
  for (const url of ['/liste/tipuri-neconformitate', '/liste/dispozitii-neconformitate']) { const r = await admin.get(url); assert.equal(r.status, 200, url); assert.ok(!r.text.includes('⟦'), url); }
  const en = textOf((await lead.get(`${N}/${ids.n1}`)).text);
  assert.ok(en.includes('Evaluation') && en.includes('Decision on the product') && en.includes('In evaluation') && en.includes('Add the task'));
  assert.ok(textOf((await lead.get('/calitate/top')).text).includes('By type') && textOf((await lead.get('/calitate')).text).includes('Mass'), 'type names show in English where an English name is set');
  assert.match(textOf((await lead.get('/notificari')).text), /New non-conformity NC-\d{4}-001/);
});
