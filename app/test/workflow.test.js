'use strict';
// The richer non-conformity workflow, the closing rules set in the app, the evaluation deadline, and the preventive presets / weekdays-only plans.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const ncr = require('../domain/ncr');
const pm = require('../domain/preventive');
const tasks = require('../domain/tasks');
const access = require('../domain/access');
const settings = require('../domain/settings');

let app, admin, lead, viewer, ids = {};
const post = (c, path, fields, page = '/') => c.postForm(page, path, fields);
const N = '/calitate/neconformitati';
const U = () => ({ id: ids.lead, full_name: 'Șef Calitate' });
const mk = (o = {}) => ncr.create(app.db, U(), { title: 'Masă sub limită', type_id: ids.typeMass, machine_id: ids.m1, product: '240 SM 90°', ...o });
const row = (id) => app.db.get('SELECT * FROM ncrs WHERE id = ?', id);

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.w', 'personal', 'Șef Calitate');
  viewer = await makeUser(app, admin, 'view.w', 'personal', 'Observator');
  const db = app.db;
  ids.lead = db.get("SELECT id FROM users WHERE username = 'lead.w'").id; ids.viewer = db.get("SELECT id FROM users WHERE username = 'view.w'").id;
  access.setUserLevels(db, ids.lead, { quality: 'lead', maintenance: 'lead' }); access.setUserLevels(db, ids.viewer, { quality: 'view' });
  ids.p = db.run("INSERT INTO people(name, team) VALUES ('Ion Lăcătuș', 'maintenance')").id;
  ids.m1 = db.get('SELECT id FROM machines ORDER BY id').id; ids.m2 = db.get('SELECT id FROM machines ORDER BY id LIMIT 1 OFFSET 1').id;
  ids.typeMass = db.get("SELECT id FROM ncr_types WHERE name_en = 'Mass'").id; ids.typeDim = db.get("SELECT id FROM ncr_types WHERE name_en = 'Dimensional'").id;
  ids.disp = db.get('SELECT id FROM ncr_dispositions ORDER BY sort').id;
});
test.after(async () => { await app.cleanup(); });

test('the full evaluation: immediate action, cause, decision, corrective and preventive action, responsible and due date; read-only for a viewer; on the print', async () => {
  const n = mk().id;
  const due = tasks.addDays(ncr.today(), 7);
  const r = await post(lead, `${N}/${n}/editeaza`, { part: 'eval', containment: 'Lot separat', cause: 'Uzură filieră', evaluation: '2 colaci afectați', disposition_id: String(ids.disp), corrective_action: 'Schimb filieră', preventive_action: 'Verificare săptămânală', responsible_person_id: String(ids.p), action_due: due }, `${N}/${n}`);
  assert.equal(r.status, 303);
  const x = row(n);
  assert.equal(x.containment, 'Lot separat'); assert.equal(x.corrective_action, 'Schimb filieră'); assert.equal(x.preventive_action, 'Verificare săptămânală'); assert.equal(x.responsible_person_id, ids.p); assert.equal(x.action_due, due);
  assert.ok(app.db.all("SELECT details FROM ncr_events WHERE ncr_id = ? AND kind = 'edit'", n).some((e) => /corrective_action/.test(e.details)), 'every changed field is in the history');
  await post(lead, `${N}/${n}/editeaza`, { part: 'eval', action_due: 'not a date' }, `${N}/${n}`);
  assert.equal(row(n).action_due, due, 'a bad date changes nothing');
  const view = textOf((await viewer.get(`${N}/${n}`)).text);
  assert.ok(view.includes('Schimb filieră') && view.includes('Ion Lăcătuș') && !view.includes('Salvează evaluarea'), 'a viewer reads it but cannot change it');
  assert.equal((await post(viewer, `${N}/${n}/editeaza`, { part: 'eval', cause: 'x' }, `${N}/${n}`)).status, 403);
  const pr = (await lead.get(`${N}/${n}/tipar`)).text;
  assert.ok(pr.includes('Lot separat') && pr.includes('Verificare săptămânală') && pr.includes('Ion Lăcătuș'));
});

test('closing rules are set in the app: decision always by default; cause, corrective action and an effectiveness check when switched on', async () => {
  const n = mk().id;
  const close = async (comment = 'ok') => { await post(lead, `${N}/${n}/stare`, { to: 'closed', comment }, `${N}/${n}`); return row(n).status; };
  assert.equal(await close(), 'reported', 'by default the decision on the product is needed');
  await post(lead, `${N}/${n}/editeaza`, { part: 'eval', disposition_id: String(ids.disp) }, `${N}/${n}`);
  assert.equal(await close(), 'closed', 'and then it closes');
  await post(lead, `${N}/${n}/stare`, { to: 'evaluation', comment: 'redeschis' }, `${N}/${n}`);
  // switch the rules on, one at a time, as the Administrator does in Settings
  const set = (k, v) => settings.set(app.db, k, v);
  set('ncr.require_cause', true);
  assert.equal(await close(), 'evaluation', 'cause required');
  await post(lead, `${N}/${n}/editeaza`, { part: 'eval', disposition_id: String(ids.disp), cause: 'Uzură' }, `${N}/${n}`);
  set('ncr.require_corrective', true);
  assert.equal(await close(), 'evaluation', 'corrective action required');
  await post(lead, `${N}/${n}/editeaza`, { part: 'eval', disposition_id: String(ids.disp), cause: 'Uzură', corrective_action: 'Schimb' }, `${N}/${n}`);
  set('ncr.require_verification', true);
  assert.equal(await close(), 'evaluation', 'the check of the action is required');
  assert.equal((await post(viewer, `${N}/${n}/verifica`, { note: 'x' }, `${N}/${n}`)).status, 403);
  await post(lead, `${N}/${n}/verifica`, { note: 'Nicio abatere în ultimele 3 loturi' }, `${N}/${n}`);
  const v = row(n);
  assert.equal(v.verified_at, ncr.today()); assert.equal(v.verified_by, ids.lead); assert.match(v.verification_note, /3 loturi/);
  assert.equal(await close(), 'closed');
  assert.ok(textOf((await lead.get(`${N}/${n}`)).text).includes('verificată'));
  await post(lead, `${N}/${n}/stare`, { to: 'evaluation', comment: 'revine' }, `${N}/${n}`);
  await post(lead, `${N}/${n}/verifica`, { undo: '1' }, `${N}/${n}`);
  assert.equal(row(n).verified_at, null, 'the check can be undone');
  assert.equal(await close(), 'evaluation', 'and then closing is refused again');
  for (const k of ['cause', 'corrective', 'verification']) set(`ncr.require_${k}`, false);
});

test('the rules page in Settings: saved, validated, and an older form leaves them alone', async () => {
  const base = { 'server.port': '8080', 'server.bind': '0.0.0.0', 'server.public_name': '', 'session.idle_hours': '8', 'backup.dir': '', 'backup.time': '02:00', 'backup.keep': '14', 'shift.day_start': '06:00', 'shift.night_start': '18:00', 'backup.auto': '1', 'cycle.day': '4', 'cycle.off1': '2', 'cycle.night': '4', 'cycle.off2': '2', 'feedback.email': '' };
  for (const m of ['cable', 'analytics', 'maintenance', 'technical', 'quality', 'meetings']) base[`modules.${m}`] = '1';
  const team = { 'technical.open_to_all': '1', 'access.default.maintenance': 'enter', 'access.default.quality': 'enter', 'access.default.meetings': 'view', 'access.default.technical': 'lead', 'numbering.task': '{team}-{yyyy}-{seq:4}', 'numbering.ncr': 'NC-{yyyy}-{seq:3}', 'numbering.meeting': 'S-{yyyy}-{mm}-{seq:2}', 'team.code.maintenance': 'MT', 'team.code.technical': 'TH', 'team.code.quality': 'QC' };
  const bad = await post(admin, '/admin/setari', { ...base, ...team, 'ncr.eval_days': '0', 'ncr.require_disposition': '1' }, '/admin/setari');
  assert.equal(bad.status, 422, 'evaluation within 0 days is refused');
  const ok = await post(admin, '/admin/setari', { ...base, ...team, 'ncr.eval_days': '5', 'ncr.require_disposition': '', 'ncr.require_cause': '1', 'ncr.require_corrective': '', 'ncr.require_verification': '1' }, '/admin/setari');
  assert.equal(ok.status, 303);
  assert.equal(settings.get(app.db, 'ncr.eval_days'), 5); assert.equal(settings.get(app.db, 'ncr.require_disposition'), false); assert.equal(settings.get(app.db, 'ncr.require_cause'), true); assert.equal(settings.get(app.db, 'ncr.require_verification'), true);
  assert.ok(textOf((await admin.get('/admin/setari')).text).includes('reguli de închidere'));
  await post(admin, '/admin/setari', { ...base, ...team }, '/admin/setari');   // a form without the non-conformity fields
  assert.equal(settings.get(app.db, 'ncr.eval_days'), 5, 'left as it was');
  await post(admin, '/admin/setari', { ...base, ...team, 'ncr.eval_days': '2', 'ncr.require_disposition': '1' }, '/admin/setari');
  assert.equal(settings.get(app.db, 'ncr.require_cause'), false); assert.equal(settings.get(app.db, 'ncr.require_disposition'), true);
});

test('recurring problems are found: same type on the same machine or product within 90 days; other machines, cancelled records and old ones are not', async () => {
  const U1 = { machine_id: null, product: 'ISOLAT-X' };
  const a = mk({ title: 'Prima', ...U1 }).id;
  assert.equal(ncr.similar(app.db, a).length, 0, 'nothing similar yet');
  const b = mk({ ...U1, title: 'A doua', reported_at: tasks.addDays(ncr.today(), -10) }).id;
  assert.deepEqual(ncr.similar(app.db, a).map((x) => x.id), [b]);
  const other = mk({ title: 'Alt utilaj, alt produs', machine_id: ids.m2, product: '95 RMC-Y' }).id;
  assert.ok(!ncr.similar(app.db, a).some((x) => x.id === other), 'another machine and product');
  const diffType = mk({ ...U1, title: 'Alt tip', type_id: ids.typeDim }).id;
  assert.ok(!ncr.similar(app.db, a).some((x) => x.id === diffType), 'another type');
  const old = mk({ ...U1, title: 'Veche', reported_at: tasks.addDays(ncr.today(), -200) }).id;
  assert.ok(!ncr.similar(app.db, a).some((x) => x.id === old), 'outside 90 days');
  const sameProd = mk({ title: 'Același produs', machine_id: ids.m2, product: 'ISOLAT-X' }).id;
  assert.ok(ncr.similar(app.db, a).some((x) => x.id === sameProd), 'the same product counts even on another machine');
  app.db.run("UPDATE ncrs SET status = 'cancelled' WHERE id = ?", sameProd);
  assert.ok(!ncr.similar(app.db, a).some((x) => x.id === sameProd), 'cancelled records are left out');
  const list = textOf((await lead.get('/calitate?view=all')).text);
  assert.ok(list.includes('↻'), 'the register marks recurring records');
  assert.ok(textOf((await lead.get(`${N}/${a}`)).text).includes('Probleme asemănătoare') && textOf((await lead.get(`${N}/${a}`)).text).includes('A doua'));
  assert.ok(!textOf((await lead.get(`${N}/${other}`)).text).includes('Probleme asemănătoare'));
});

test('the evaluation deadline: records not evaluated in time are marked, counted, listed and shown on Home', async () => {
  settings.set(app.db, 'ncr.eval_days', 2);
  const late = mk({ title: 'Neevaluată de 6 zile', reported_at: tasks.addDays(ncr.today(), -6), type_id: ids.typeDim, machine_id: ids.m2, product: 'Alt' }).id;
  const fresh = mk({ title: 'De azi', type_id: ids.typeDim, machine_id: ids.m2, product: 'Alt2' }).id;
  assert.ok(ncr.counts(app.db).eval_overdue >= 1);
  assert.ok(ncr.detail(app.db, late).eval_overdue); assert.ok(!ncr.detail(app.db, fresh).eval_overdue);
  const list = (await lead.get('/calitate?evalo=1')).text;
  assert.ok(list.includes('Neevaluată de 6 zile') && !list.includes('De azi'), 'the chip filters to the late ones');
  assert.ok(textOf(list).includes('evaluare întârziată'));
  assert.ok((await lead.get('/')).text.includes('/calitate?evalo=1'), 'Home points to them');
  await post(lead, `${N}/${late}/stare`, { to: 'evaluation', comment: '' }, `${N}/${late}`);
  assert.ok(!ncr.detail(app.db, late).eval_overdue, 'once taken into evaluation it is no longer late');
  await post(lead, '/limba', { lang: 'en', back: '/' });
  for (const url of ['/calitate', '/calitate?evalo=1', `${N}/${late}`, `${N}/${late}/editeaza`, `${N}/${late}/tipar`, '/']) { const r = await lead.get(url); assert.equal(r.status, 200, url); assert.ok(!r.text.includes('⟦'), url); }
  const en = textOf((await lead.get(`${N}/${late}`)).text);
  assert.ok(en.includes('Immediate action taken') && en.includes('Effectiveness check') && en.includes('Corrective action'));
  await post(lead, '/limba', { lang: 'ro', back: '/' });
});

test('preventive plans: daily / weekly / monthly presets, working days only, editable afterwards', async () => {
  const today = pm.today();
  const daily = pm.preset('daily'); const weekly = pm.preset('weekly'); const monthly = pm.preset('monthly');
  assert.equal(daily.unit, 'days'); assert.equal(daily.every_n, 1); assert.equal(daily.lead_days, 1, 'made the day before, for tomorrow'); assert.equal(daily.weekdays_only, 1);
  assert.ok(daily.next_due > today);
  assert.equal(new Date(`${weekly.next_due}T00:00:00Z`).getUTCDay(), 1, 'weekly starts on a Monday'); assert.equal(weekly.unit, 'weeks');
  assert.match(monthly.next_due, /-01$/); assert.equal(monthly.unit, 'months');
  assert.equal(pm.preset('nope'), null);
  // working days: a Saturday start moves to Monday; the next one skips the weekend
  assert.equal(pm.nextWeekday('2026-10-31'), '2026-11-02');
  assert.equal(pm.nextWeekday('2026-11-02'), '2026-11-02');
  assert.equal(pm.addInterval('2026-10-30', 1, 'days', true), '2026-11-02', 'Friday + 1 working day = Monday');
  assert.equal(pm.addInterval('2026-10-30', 1, 'days', false), '2026-10-31', 'without the option it is the next day');
  const page = await lead.get('/mentenanta/preventiv/nou?preset=daily');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('name="weekdays_only" value="1" checked') && page.text.includes(`value="${daily.next_due}"`), 'the preset fills the form');
  const bad = await lead.get('/mentenanta/preventiv/nou?preset=zzz'); assert.equal(bad.status, 200);
  // a plan made from the preset: a Saturday date is moved to Monday, and after the work the next date skips the weekend
  const r = await post(lead, '/mentenanta/preventiv/nou', { title: 'Control zilnic', every_n: '1', unit: 'days', weekdays_only: '1', basis: 'schedule', next_due: '2099-10-31', lead_days: '1' }, '/mentenanta/preventiv/nou');
  assert.equal(r.status, 303);
  const plan = app.db.get("SELECT * FROM pm_plans WHERE title = 'Control zilnic'");
  assert.equal(plan.weekdays_only, 1); assert.equal(plan.next_due, pm.nextWeekday('2099-10-31'));
  // weekdays_only is ignored for weeks and months
  const w = pm.create(app.db, U(), { title: 'Săptămânal', every_n: 1, unit: 'weeks', weekdays_only: '1', next_due: '2099-11-02', lead_days: 2 });
  assert.equal(app.db.get('SELECT weekdays_only FROM pm_plans WHERE id = ?', w.id).weekdays_only, 0);
  // everything stays editable: switch the daily plan to every 2 weeks
  await post(lead, `/mentenanta/preventiv/${plan.id}/editeaza`, { title: 'Control la 2 săptămâni', every_n: '2', unit: 'weeks', basis: 'completion', next_due: '2099-11-09', lead_days: '3' }, `/mentenanta/preventiv/${plan.id}/editeaza`);
  const e = app.db.get('SELECT * FROM pm_plans WHERE id = ?', plan.id);
  assert.equal(e.unit, 'weeks'); assert.equal(e.every_n, 2); assert.equal(e.weekdays_only, 0);
  assert.ok(textOf((await lead.get('/mentenanta/preventiv')).text).includes('Control la 2 săptămâni'));
  const dp = pm.create(app.db, U(), { title: 'Verificare zilnică', every_n: 1, unit: 'days', weekdays_only: '1', next_due: '2099-10-30', lead_days: 1 });
  assert.match(textOf((await lead.get('/mentenanta/preventiv')).text), /În fiecare zi \(zile lucrătoare\)/);
  void dp;
});
