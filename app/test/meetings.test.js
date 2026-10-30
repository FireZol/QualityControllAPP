'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const meetings = require('../domain/meetings');
const tasks = require('../domain/tasks');
const access = require('../domain/access');
const notifications = require('../domain/notifications');
const modules = require('../domain/modules');

let app, lead, worker, viewer, outsider, ids = {};
const post = (c, path, fields, page = '/') => c.postForm(page, path, fields);
const today = () => meetings.today();
const addDays = tasks.addDays;
const notes = (uid, kind) => notifications.list(app.db, uid).filter((n) => !kind || n.kind === kind);

test.before(async () => {
  app = await startApp();
  const admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.m', 'personal', 'Șef Ședințe');
  worker = await makeUser(app, admin, 'worker.m', 'personal', 'Operator Ședințe');
  viewer = await makeUser(app, admin, 'viewer.m', 'personal', 'Observator Ședințe');
  outsider = await makeUser(app, admin, 'none.m', 'personal', 'Fără acces');
  const db = app.db;
  const uid = (n) => db.get('SELECT id FROM users WHERE username = ?', n).id;
  ids = { lead: uid('lead.m'), worker: uid('worker.m'), viewer: uid('viewer.m'), outsider: uid('none.m') };
  access.setUserLevels(db, ids.lead, { meetings: 'lead', maintenance: 'lead', technical: 'lead' });
  access.setUserLevels(db, ids.worker, { meetings: 'enter', maintenance: 'view' });
  access.setUserLevels(db, ids.viewer, { meetings: 'view' });
  access.setUserLevels(db, ids.outsider, { meetings: 'none' });
  ids.pLead = db.run("INSERT INTO people(name, team, user_id) VALUES ('Șef Ședințe', 'maintenance', ?)", ids.lead).id;
  ids.pWorker = db.run("INSERT INTO people(name, team, user_id) VALUES ('Operator Ședințe', 'maintenance', ?)", ids.worker).id;
  ids.pFitter = db.run("INSERT INTO people(name, team) VALUES ('Ion Lăcătuș', 'maintenance')").id;
  ids.pTech = db.run("INSERT INTO people(name, team) VALUES ('Tudor Tehnic', 'technical')").id;
});
test.after(async () => { await app.cleanup(); });

test('schedule logic: weekdays, weekly, every other week, period, inactive', () => {
  const wk = { active: 1, days: '1,2,3,4,5', interval_weeks: 1, starts_on: '2026-11-02', ends_on: null, created_at: '2026-11-01T00:00:00' };
  assert.equal(meetings.isoWeekday('2026-11-02'), 1, 'a Monday');
  assert.equal(meetings.isoWeekday('2026-11-08'), 7, 'a Sunday is 7');
  assert.ok(meetings.occursOn(wk, '2026-11-02') && meetings.occursOn(wk, '2026-11-06'));
  assert.ok(!meetings.occursOn(wk, '2026-11-07') && !meetings.occursOn(wk, '2026-11-08'), 'not on the weekend');
  assert.ok(!meetings.occursOn(wk, '2026-10-30'), 'not before it starts');
  assert.ok(!meetings.occursOn({ ...wk, ends_on: '2026-11-04' }, '2026-11-05'), 'not after it ends');
  assert.ok(!meetings.occursOn({ ...wk, active: 0 }, '2026-11-03'), 'not when stopped');
  const biweekly = { ...wk, days: '3', interval_weeks: 2 };
  assert.ok(meetings.occursOn(biweekly, '2026-11-04') && !meetings.occursOn(biweekly, '2026-11-11') && meetings.occursOn(biweekly, '2026-11-18'), 'every second Wednesday');
  assert.ok(meetings.occursOn({ ...wk, starts_on: null, days: '1,2,3,4,5,6,7' }, '2026-11-01'), 'with no start date it starts the day it was made');
  assert.equal(meetings.daysOf('1,x,9,3').join(), '1,3');
  assert.deepEqual(meetings.cleanTeams(['quality', 'bogus', 'maintenance', 'quality']), ['maintenance', 'quality'], 'known teams, once, in a fixed order');
});

test('access: the list needs a level; a module that is off answers 404; series need lead', async () => {
  assert.equal((await viewer.get('/sedinte')).status, 200);
  assert.equal((await outsider.get('/sedinte')).status, 403);
  assert.equal((await viewer.get('/sedinte/nou')).status, 403, 'view cannot create');
  assert.equal((await worker.get('/sedinte/nou')).status, 200, 'enter can create a one-off meeting');
  assert.equal((await worker.get('/sedinte/serii')).status, 403, 'schedules are for leads');
  assert.equal((await lead.get('/sedinte/serii')).status, 200);
  modules.set(app.db, 'meetings', false);
  assert.equal((await lead.get('/sedinte')).status, 404);
  modules.set(app.db, 'meetings', true);
});

test('the series of the owner (Technical and Maintenance daily, Quality weekly) make meetings on their own, once', async () => {
  const seeded = app.db.all('SELECT title, teams, days FROM meeting_series ORDER BY id');
  assert.deepEqual(seeded.map((s) => s.teams), ['technical', 'maintenance', 'quality']);
  assert.equal(seeded[0].days, '1,2,3,4,5');
  assert.equal(seeded[2].days, '1', 'Quality: once a week');
  const start = '2030-01-07'; // a Monday far away from today
  const made = meetings.ensure(app.db, start, 14);
  assert.equal(made, 2 * 10 + 2, 'two daily series x 10 weekdays + 2 Mondays for Quality');
  assert.equal(meetings.ensure(app.db, start, 14), 0, 'a second call makes nothing');
  const first = app.db.get("SELECT * FROM meetings WHERE meeting_date = '2030-01-07' AND teams = 'maintenance'");
  const inv = app.db.all('SELECT person_id FROM meeting_attendees WHERE meeting_id = ?', first.id).map((r) => r.person_id);
  assert.ok(inv.includes(ids.pLead) && inv.includes(ids.pFitter) && !inv.includes(ids.pTech), 'with nobody named, the people of its team are invited');
  assert.equal(app.db.value("SELECT count(*) FROM meetings WHERE meeting_date IN ('2030-01-12', '2030-01-13')"), 0, 'nothing on the weekend');
  // a moved meeting is not made again, a cancelled one stays cancelled
  app.db.run("UPDATE meetings SET meeting_date = '2030-01-09' WHERE id = ?", first.id);
  assert.equal(meetings.ensure(app.db, start, 14), 0);
  assert.equal(app.db.value("SELECT count(*) FROM meetings WHERE series_id = ? AND slot_date = '2030-01-07'", first.series_id), 1);
  // stopping a series stops new meetings
  app.db.run('UPDATE meeting_series SET active = 0 WHERE id = ?', first.series_id);
  assert.equal(meetings.ensure(app.db, '2030-02-04', 7), 5 + 1, 'only the two other series');
  app.db.run('UPDATE meeting_series SET active = 1 WHERE id = ?', first.series_id);
  app.db.run("DELETE FROM meeting_attendees WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_date >= '2030-01-01')");
  app.db.run("DELETE FROM meetings WHERE meeting_date >= '2030-01-01'");
});

test('the daily reminder: once a day, only invitees with a login, never twice', async () => {
  meetings.resetReminders();
  app.db.run('DELETE FROM meeting_attendees'); app.db.run('DELETE FROM meetings');
  const r = meetings.createMeeting(app.db, { id: ids.worker, full_name: 'Operator Ședințe' }, { title: 'Probă zilnică', meeting_date: today(), start_time: '23:30', duration_min: 15, teams: ['maintenance'], attendees: [ids.pLead, ids.pFitter] });
  assert.ok(r.ok);
  assert.equal(notes(ids.lead, 'meeting_invited').length, 1, 'the invitee with a login is told when the meeting is made');
  assert.equal(notes(ids.worker, 'meeting_invited').length, 0, 'not the one who made it');
  assert.equal(meetings.remindToday(app.db), 1, 'one reminder (the fitter has no login)');
  assert.equal(notes(ids.lead, 'meeting_today').filter((n) => n.params.title === 'Probă zilnică').length, 1);
  assert.equal(meetings.remindToday(app.db), 0, 'the same day again: nothing');
  meetings.resetReminders();
  assert.equal(meetings.remindToday(app.db), 0, 'even if the memory is lost the stored reminder stops a repeat');
  const today1 = notes(ids.lead, 'meeting_today').filter((n) => n.params.title === 'Probă zilnică');
  assert.equal(today1.length, 1);
  assert.equal(today1[0].params.time, '23:30');
  await lead.get('/'); // the home page refreshes meetings; still no second reminder
  assert.equal(notes(ids.lead, 'meeting_today').filter((n) => n.params.title === 'Probă zilnică').length, 1);
});

test('a one-off meeting: validation, combined teams, invitation text with when and who; moved and cancelled meetings tell the invitees', async () => {
  const bad = await post(worker, '/sedinte/nou', { title: '', meeting_date: '31-12-2030', start_time: '25:00', duration_min: '3', teams: [] }, '/sedinte/nou');
  assert.equal(bad.status, 422);
  assert.equal(app.db.value('SELECT count(*) FROM meetings WHERE title = ?', ''), 0);
  const d = addDays(today(), 3);
  const r = await post(worker, '/sedinte/nou', { title: 'Neconformități — comună', meeting_date: d, start_time: '10:00', duration_min: '45', location: 'Sala 1', teams: ['quality', 'maintenance', 'technical'], agenda: 'Top neconformități', attendees: [String(ids.pLead), String(ids.pTech)] }, '/sedinte/nou');
  assert.equal(r.status, 303);
  const m = app.db.get("SELECT * FROM meetings WHERE title = 'Neconformități — comună'");
  assert.equal(m.teams, 'maintenance,technical,quality', 'a combined meeting keeps its teams in a fixed order');
  assert.equal(m.series_id, null);
  const inv = notes(ids.lead, 'meeting_invited').find((n) => n.params.title === m.title);
  assert.ok(inv && inv.params.date === d && inv.params.time === '10:00', 'the invitation says when');
  const text = textOf((await lead.get('/notificari')).text);
  assert.match(text, /Ești invitat la „Neconformități — comună”/);
  // moving it tells the invitees; a small edit does not
  await post(worker, `/sedinte/${m.id}/editeaza`, { title: m.title, meeting_date: d, start_time: '11:00', duration_min: '45', location: 'Sala 1', teams: ['quality', 'maintenance'], agenda: 'Top', attendees: [String(ids.pLead), String(ids.pWorker)] }, `/sedinte/${m.id}/editeaza`);
  assert.equal(notes(ids.lead, 'meeting_updated').length, 1);
  assert.equal(app.db.value('SELECT count(*) FROM meeting_attendees WHERE meeting_id = ?', m.id), 2, 'the invitee list follows the edit');
  await post(worker, `/sedinte/${m.id}/editeaza`, { title: m.title, meeting_date: d, start_time: '11:00', duration_min: '45', location: 'Sala 1', teams: ['quality', 'maintenance'], agenda: 'Top 2', attendees: [String(ids.pLead), String(ids.pWorker)] }, `/sedinte/${m.id}/editeaza`);
  assert.equal(notes(ids.lead, 'meeting_updated').length, 1, 'only a change of day, time or place is announced');
  // cancelling: lead only, reason required, invitees told
  assert.equal((await post(worker, `/sedinte/${m.id}/stare`, { to: 'cancelled', reason: 'x' }, `/sedinte/${m.id}`)).status, 403, 'enter cannot cancel');
  await post(lead, `/sedinte/${m.id}/stare`, { to: 'cancelled', reason: '' }, `/sedinte/${m.id}`);
  assert.equal(app.db.get('SELECT status FROM meetings WHERE id = ?', m.id).status, 'planned', 'no reason: refused');
  await post(lead, `/sedinte/${m.id}/stare`, { to: 'cancelled', reason: 'Sala ocupată' }, `/sedinte/${m.id}`);
  assert.equal(app.db.get('SELECT status, cancel_reason FROM meetings WHERE id = ?', m.id).status, 'cancelled');
  assert.equal(notes(ids.worker, 'meeting_cancelled').length, 1, 'the invitees are told (not the one who cancelled)');
  assert.equal(notes(ids.lead, 'meeting_cancelled').length, 0);
  assert.ok(!textOf((await lead.get('/sedinte')).text).includes('Neconformități — comună'), 'a cancelled meeting leaves the upcoming list');
  assert.ok(textOf((await lead.get('/sedinte?view=all')).text).includes('Neconformități — comună'), 'and stays in All');
  assert.equal((await post(worker, `/sedinte/${m.id}/stare`, { to: 'planned' }, `/sedinte/${m.id}`)).status, 403);
  await post(lead, `/sedinte/${m.id}/stare`, { to: 'planned' }, `/sedinte/${m.id}`);
  assert.equal(app.db.get('SELECT status FROM meetings WHERE id = ?', m.id).status, 'planned');
  ids.m = m.id;
});

test('running a meeting: attendance with a guest, agenda and minutes, held; the decisions become tasks of the right team', async () => {
  const m = ids.m;
  await post(worker, `/sedinte/${m}/prezenta`, { present: [String(ids.pLead)], extra: [String(ids.pTech)] }, `/sedinte/${m}`);
  const att = app.db.all('SELECT person_id, present FROM meeting_attendees WHERE meeting_id = ? ORDER BY person_id', m);
  assert.deepEqual(att.map((a) => [a.person_id, a.present]), [[ids.pLead, 1], [ids.pWorker, 0], [ids.pTech, 1]], 'ticked invitees are present, the others not, and the guest is added as present');
  await post(worker, `/sedinte/${m}/note`, { agenda: 'Top 3 neconformități', minutes: 'S-a discutat uzura la LITARE 2.' }, `/sedinte/${m}`);
  assert.match(app.db.get('SELECT minutes FROM meetings WHERE id = ?', m).minutes, /LITARE 2/);
  // a decision with a task: Maintenance, assigned, due, source = this meeting
  const due = addDays(today(), 10);
  let r = await post(worker, `/sedinte/${m}/decizie`, { text: 'Înlocuit rulment la LITARE 2', team: 'maintenance', due_date: due, priority_id: '', assignees: [String(ids.pLead), String(ids.pFitter)] }, `/sedinte/${m}`);
  assert.equal(r.status, 303);
  const t = app.db.get("SELECT * FROM tasks WHERE title = 'Înlocuit rulment la LITARE 2'");
  assert.ok(t, 'the decision made a task');
  assert.equal(t.team, 'maintenance'); assert.equal(t.source_kind, 'meeting'); assert.equal(Number(t.source_id), m); assert.equal(t.due_date, due);
  assert.equal(app.db.value('SELECT count(*) FROM task_assignees WHERE task_id = ?', t.id), 2, 'the meeting hands the work on, even though this user is only a viewer of Maintenance');
  assert.equal(notes(ids.lead, 'task_assigned').filter((n) => n.params.no === t.no).length, 1, 'the assignee is told');
  assert.equal(app.db.get('SELECT task_id FROM meeting_decisions WHERE meeting_id = ?', m).task_id, t.id);
  const tp = await lead.get(`/sarcini/${t.id}`);
  assert.ok(tp.text.includes(`href="/sedinte/${m}"`), 'the task links back to its meeting');
  // a decision without a task, and the refused cases
  await post(worker, `/sedinte/${m}/decizie`, { text: 'Se urmărește consumul de ulei', team: '' }, `/sedinte/${m}`);
  assert.equal(app.db.value('SELECT count(*) FROM meeting_decisions WHERE meeting_id = ?', m), 2);
  assert.equal(app.db.value('SELECT count(*) FROM tasks WHERE source_kind = ?', 'meeting'), 1);
  await post(worker, `/sedinte/${m}/decizie`, { text: '', team: 'maintenance' }, `/sedinte/${m}`);
  await post(worker, `/sedinte/${m}/decizie`, { text: 'Echipă inexistentă', team: 'nope' }, `/sedinte/${m}`);
  assert.equal(app.db.value('SELECT count(*) FROM meeting_decisions WHERE meeting_id = ?', m), 2);
  assert.equal((await post(viewer, `/sedinte/${m}/decizie`, { text: 'x', team: '' }, `/sedinte/${m}`)).status, 403);
  // held
  await post(worker, `/sedinte/${m}/stare`, { to: 'held' }, `/sedinte/${m}`);
  assert.equal(app.db.get('SELECT status FROM meetings WHERE id = ?', m).status, 'held');
  assert.ok(app.db.get("SELECT 1 FROM audit_log WHERE action = 'meeting_decision'") && app.db.get("SELECT 1 FROM audit_log WHERE action = 'meeting_status'"));
  const pastList = textOf((await lead.get('/sedinte?view=past')).text);
  assert.ok(pastList.includes('Neconformități — comună') && pastList.includes('2/3'), 'a held meeting shows who was present of those invited');
});

test('schedules: lead creates, edits, stops; invitees are told the schedule; nothing is deleted', async () => {
  const bad = await post(lead, '/sedinte/serii/nou', { title: 'Seria mea', teams: ['technical'], days: [], start_time: '08:00', interval_weeks: '2' }, '/sedinte/serii/nou');
  assert.equal(bad.status, 422, 'days are required');
  let r = await post(lead, '/sedinte/serii/nou', { title: 'Joi la două săptămâni', teams: ['maintenance'], days: ['4'], interval_weeks: '2', start_time: '14:00', duration_min: '30', starts_on: addDays(today(), 1), people: [String(ids.pLead)] }, '/sedinte/serii/nou');
  assert.equal(r.status, 303);
  const s = app.db.get("SELECT * FROM meeting_series WHERE title = 'Joi la două săptămâni'");
  assert.equal(s.days, '4'); assert.equal(s.interval_weeks, 2);
  const told = notes(ids.lead, 'meeting_series');
  assert.equal(told.length, 0, 'not told about their own schedule (they made it)');
  await post(lead, `/sedinte/serii/${s.id}/editeaza`, { title: 'Joi la două săptămâni', teams: ['maintenance'], days: ['4'], interval_weeks: '2', start_time: '15:00', duration_min: '30', people: [String(ids.pLead), String(ids.pWorker)] }, `/sedinte/serii/${s.id}/editeaza`);
  assert.equal(app.db.get('SELECT start_time FROM meeting_series WHERE id = ?', s.id).start_time, '15:00');
  assert.equal(notes(ids.worker, 'meeting_series').length, 1, 'a changed time tells the invitees');
  assert.match(textOf((await worker.get('/notificari')).text), /Program de ședințe: „Joi la două săptămâni” — Jo la 15:00, la fiecare 2 săptămâni/);
  const before = app.db.value('SELECT count(*) FROM meeting_series');
  await post(lead, `/sedinte/serii/${s.id}/activ`, { active: '0' }, '/sedinte/serii');
  assert.equal(app.db.get('SELECT active FROM meeting_series WHERE id = ?', s.id).active, 0);
  assert.equal(app.db.value('SELECT count(*) FROM meeting_series'), before, 'stopped, not deleted');
  assert.equal((await post(lead, `/sedinte/serii/${s.id}/sterge`, {})).status, 404, 'there is no delete');
  assert.equal((await post(worker, `/sedinte/serii/${s.id}/activ`, { active: '1' }, '/sedinte')).status, 403);
  assert.ok(textOf((await lead.get('/sedinte/serii')).text).includes('Lu–Vi la 08:00'), 'the schedule reads in words');
});

test('pages: list filters, minutes print, home panel; English screens and texts', async () => {
  const list = await lead.get('/sedinte?team=quality');
  assert.equal(list.status, 200);
  const mine = textOf((await lead.get('/sedinte?mine=1')).text);
  assert.ok(!mine.includes('Zzz'), 'the filter runs');
  assert.ok(!textOf((await outsider.get('/')).text).includes('Ședințe azi'), 'no meetings panel for a user without access');
  const home = textOf((await lead.get('/')).text);
  assert.ok(home.includes('Ședințe'), 'home shows the meetings panel');
  const pr = await lead.get(`/sedinte/${ids.m}/tipar`);
  assert.equal(pr.status, 200);
  assert.ok(pr.text.includes('Minuta ședinței') && pr.text.includes('LITARE 2') && pr.text.includes('Înlocuit rulment') && pr.text.includes('☑'));
  assert.equal((await outsider.get(`/sedinte/${ids.m}/tipar`)).status, 403);
  assert.equal((await lead.get('/sedinte/999999')).status, 404);
  await post(lead, '/limba', { lang: 'en', back: '/' });
  for (const url of ['/sedinte', '/sedinte?view=past', '/sedinte/nou', `/sedinte/${ids.m}`, `/sedinte/${ids.m}/editeaza`, `/sedinte/${ids.m}/tipar`, '/sedinte/serii', '/sedinte/serii/nou', '/']) {
    const r = await lead.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(!r.text.includes('⟦'), url);
  }
  const en = textOf((await lead.get(`/sedinte/${ids.m}`)).text);
  assert.ok(en.includes('Agenda') && en.includes('Decisions') && en.includes('Save attendance') && en.includes('Becomes a task of'));
  assert.ok(/Held/.test(en) && !/Ținută/.test(en));
  assert.ok(textOf((await lead.get('/sedinte/serii')).text).includes('Mon–Fri at 08:00'));
  const note = textOf((await lead.get('/notificari')).text);
  assert.match(note, /You are invited to “Neconformități — comună”/);
  assert.match(note, /Meeting schedule|The meeting “/);
  assert.equal((await post(lead, `/sedinte/${ids.m}/sterge`, {})).status, 404, 'meetings cannot be deleted');
});
