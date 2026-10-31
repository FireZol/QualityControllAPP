'use strict';
// Preventive maintenance: plans ("every N days / weeks / months") that make a task when it is time. The task is made `lead_days` before
// the due date (by whoever opens the home page, the board or the plans: no timer), carries the plan's checklist and people, and when it is
// finished the plan moves its next date on (from the planned date, or from the day the work was done). Plans are edited or stopped, never
// deleted; every due date has one row in pm_runs (a task, or skipped on purpose with a reason).
const audit = require('./audit');
const tasks = require('./tasks');
const { nowIso, isRealDate } = require('../lib/time');

const UNITS = ['days', 'weeks', 'months'];
const BASES = ['schedule', 'completion'];
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => nowIso().slice(0, 10);

/** A date plus N days / weeks / months (month ends are kept in range: 31 Jan + 1 month = 28 or 29 Feb). */
const isWeekend = (iso) => { const d = new Date(`${iso}T00:00:00Z`).getUTCDay(); return d === 0 || d === 6; };
/** The same day, or the following Monday when it is a Saturday or Sunday. */
function nextWeekday(iso) { let d = iso; while (isWeekend(d)) d = tasks.addDays(d, 1); return d; }

function addInterval(iso, n, unit, weekdaysOnly) {
  if (unit === 'days' && weekdaysOnly) { let d = iso; for (let i = 0; i < n; i++) d = nextWeekday(tasks.addDays(d, 1)); return d; }   // N working days on
  if (unit === 'days') return tasks.addDays(iso, n);
  if (unit === 'weeks') return tasks.addDays(iso, 7 * n);
  const d = new Date(`${iso}T00:00:00Z`); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const canView = (db, user, enabled) => tasks.canView(db, user, 'maintenance', enabled);
const canManage = (db, user, enabled) => tasks.canUpdate(db, user, 'maintenance', enabled);

function validate(db, data) {
  const errors = {}; const v = {};
  v.title = String(data.title || '').trim();
  if (!v.title) errors.title = 'required'; else if (v.title.length > 200) errors.title = 'too_long';
  v.description = String(data.description || '').trim() || null;
  if (v.description && v.description.length > 4000) errors.description = 'too_long';
  v.team = tasks.TEAMS.includes(data.team) ? data.team : 'maintenance';
  v.machine_id = data.machine_id ? Number(data.machine_id) : null;
  if (v.machine_id && !db.get('SELECT 1 FROM machines WHERE id = ?', v.machine_id)) errors.machine_id = 'invalid';
  v.area = String(data.area || '').trim() || null;
  if (v.area && v.area.length > 120) errors.area = 'too_long';
  v.every_n = Number(data.every_n);
  if (!Number.isInteger(v.every_n) || v.every_n < 1 || v.every_n > 999) errors.every_n = 'invalid';
  v.unit = UNITS.includes(data.unit) ? data.unit : 'weeks';
  v.basis = BASES.includes(data.basis) ? data.basis : 'schedule';
  v.weekdays_only = v.unit === 'days' && ['1', 'on', 'true', 1, true].includes(data.weekdays_only) ? 1 : 0;
  v.lead_days = data.lead_days === undefined || data.lead_days === '' ? 3 : Number(data.lead_days);
  if (!Number.isInteger(v.lead_days) || v.lead_days < 0 || v.lead_days > 365) errors.lead_days = 'invalid';
  v.priority_id = data.priority_id ? Number(data.priority_id) : null;
  if (v.priority_id && !db.get('SELECT 1 FROM priorities WHERE id = ?', v.priority_id)) errors.priority_id = 'invalid';
  v.next_due = String(data.next_due || '').trim();
  if (!isRealDate(v.next_due)) errors.next_due = 'invalid';
  else if (v.weekdays_only) v.next_due = nextWeekday(v.next_due);
  v.people = [...new Set((data.people || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (v.people.some((id) => !db.get('SELECT 1 FROM people WHERE id = ?', id))) errors.people = 'invalid';
  v.steps = (Array.isArray(data.steps) ? data.steps : String(data.steps || '').split(/\r?\n/)).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 50);
  return { errors, v };
}

function writeChildren(db, id, v) {
  db.run('DELETE FROM pm_plan_people WHERE plan_id = ?', id);
  for (const p of v.people) db.run('INSERT INTO pm_plan_people(plan_id, person_id) VALUES (?,?)', id, p);
  db.run('DELETE FROM pm_plan_steps WHERE plan_id = ?', id);
  v.steps.forEach((t, i) => db.run('INSERT INTO pm_plan_steps(plan_id, position, text) VALUES (?,?,?)', id, i + 1, t));
}

function create(db, user, data) {
  const { errors, v } = validate(db, data);
  if (Object.keys(errors).length) return { ok: false, errors };
  return db.tx(() => {
    const now = nowIso();
    const id = db.run('INSERT INTO pm_plans(title, description, team, machine_id, area, every_n, unit, basis, weekdays_only, lead_days, priority_id, next_due, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      v.title, v.description, v.team, v.machine_id, v.area, v.every_n, v.unit, v.basis, v.weekdays_only, v.lead_days, v.priority_id, v.next_due, user.id, now, now).id;
    writeChildren(db, id, v);
    audit.log(db, user.id, 'pm_plan_save', 'pm_plans', id, { title: v.title, created: true });
    return { ok: true, id };
  });
}

function update(db, user, id, data) {
  const p = get(db, id);
  if (!p) return { ok: false, code: 'not_found' };
  const { errors, v } = validate(db, data);
  if (Object.keys(errors).length) return { ok: false, errors };
  db.tx(() => {
    // a plan whose current date already has a task keeps that date (the task is for it); the new date applies to the next round
    const date = db.get('SELECT 1 FROM pm_runs WHERE plan_id = ? AND due_date = ?', id, p.next_due) ? p.next_due : v.next_due;
    db.run('UPDATE pm_plans SET title=?, description=?, team=?, machine_id=?, area=?, every_n=?, unit=?, basis=?, weekdays_only=?, lead_days=?, priority_id=?, next_due=?, updated_at=? WHERE id = ?',
      v.title, v.description, v.team, v.machine_id, v.area, v.every_n, v.unit, v.basis, v.weekdays_only, v.lead_days, v.priority_id, date, nowIso(), id);
    writeChildren(db, id, v);
    audit.log(db, user.id, 'pm_plan_save', 'pm_plans', id, { title: v.title });
  });
  return { ok: true };
}

function setActive(db, user, id, active) {
  const p = get(db, id);
  if (!p) return { ok: false, code: 'not_found' };
  db.run('UPDATE pm_plans SET active = ?, updated_at = ? WHERE id = ?', active ? 1 : 0, nowIso(), id);
  audit.log(db, user.id, 'pm_plan_save', 'pm_plans', id, { title: p.title, active: !!active });
  return { ok: true };
}

const get = (db, id) => db.get('SELECT * FROM pm_plans WHERE id = ?', id);

/** The system user for tasks made by a plan whose creator is gone: the first administrator. */
const fallbackUser = (db) => db.get("SELECT id, full_name FROM users WHERE role = 'administrator' AND active = 1 ORDER BY id LIMIT 1");

/** Makes the task of the plan's current due date (once). @returns {ok, task_id} | {ok:false, code:'exists'} */
function makeTask(db, plan, actor) {
  if (db.get('SELECT 1 FROM pm_runs WHERE plan_id = ? AND due_date = ?', plan.id, plan.next_due)) return { ok: false, code: 'exists' };
  const by = actor || (plan.created_by ? db.get('SELECT id, full_name FROM users WHERE id = ? AND active = 1', plan.created_by) : null) || fallbackUser(db);
  if (!by) return { ok: false, code: 'no_user' };
  return db.tx(() => {
    const people = db.all('SELECT person_id FROM pm_plan_people WHERE plan_id = ?', plan.id).map((r) => r.person_id);
    const t = tasks.create(db, by, { team: plan.team, title: plan.title, description: plan.description, priority_id: plan.priority_id, due_date: plan.next_due, machine_id: plan.machine_id, area: plan.area, assignees: people, source_kind: 'preventive', source_id: plan.id });
    if (!t.ok) return { ok: false, code: 'invalid', errors: t.errors };
    const steps = db.all('SELECT text FROM pm_plan_steps WHERE plan_id = ? ORDER BY position, id', plan.id).map((r) => r.text);
    if (steps.length) tasks.addChecklist(db, by, t.id, steps);
    db.run('INSERT INTO pm_runs(plan_id, due_date, task_id, outcome, created_by, created_at) VALUES (?,?,?,?,?,?)', plan.id, plan.next_due, t.id, 'task', by.id, nowIso());
    audit.log(db, by.id, 'pm_task', 'pm_plans', plan.id, { task_id: t.id, due: plan.next_due });
    return { ok: true, task_id: t.id, no: t.no };
  });
}

/** Moves the plan on from a finished run. 'schedule': from the planned date (and never into the past: missed rounds are not piled up); 'completion': from the day it was done. */
function advance(db, plan, run, doneOn) {
  const base = plan.basis === 'completion' && doneOn ? doneOn : run.due_date;
  let next = addInterval(base, plan.every_n, plan.unit, plan.weekdays_only);
  const t = today();
  let guard = 0;
  while (next < t && guard++ < 1000) next = addInterval(next, plan.every_n, plan.unit, plan.weekdays_only);   // a plan that fell far behind restarts from the next future date
  db.run('UPDATE pm_plans SET next_due = ?, last_done = COALESCE(?, last_done), updated_at = ? WHERE id = ?', next, doneOn || null, nowIso(), plan.id);
  db.run('UPDATE pm_runs SET advanced = 1 WHERE id = ?', run.id);
  return next;
}

/**
 * The work of the day, called when someone opens the home page, the maintenance board or the plans (no timer): finished tasks move their
 * plan on, and every active plan that is within its lead time gets its task. @returns {advanced, made}
 */
function ensure(db, day) {
  const t = day || today();
  let advanced = 0, made = 0;
  for (const r of db.all(`SELECT r.*, t.status AS task_status, t.closed_at, t.updated_at AS task_updated FROM pm_runs r JOIN tasks t ON t.id = r.task_id
      WHERE r.advanced = 0 AND r.outcome = 'task' AND t.status IN ('done', 'closed', 'cancelled')`)) {
    const plan = get(db, r.plan_id);
    if (!plan) continue;
    if (r.due_date === plan.next_due) {
      const doneOn = r.task_status === 'cancelled' ? null : (r.closed_at || r.task_updated || t).slice(0, 10);
      db.tx(() => advance(db, plan, r, doneOn));
      advanced++;
    } else db.run('UPDATE pm_runs SET advanced = 1 WHERE id = ?', r.id);
  }
  for (const plan of db.all('SELECT * FROM pm_plans WHERE active = 1')) {
    if (tasks.addDays(plan.next_due, -plan.lead_days) > t) continue;
    if (makeTask(db, plan).ok) made++;
  }
  return { advanced, made };
}

/** "Make the task now" for the current due date, before its lead time. */
function generateNow(db, user, id) {
  const p = get(db, id);
  if (!p) return { ok: false, code: 'not_found' };
  return makeTask(db, p, user);
}

/** Skip this round on purpose (a reason is kept): no task, the plan moves to its next date. */
function skip(db, user, id, reason) {
  const p = get(db, id);
  if (!p) return { ok: false, code: 'not_found' };
  const why = String(reason || '').trim().slice(0, 300);
  if (!why) return { ok: false, code: 'reason_required' };
  if (db.get('SELECT 1 FROM pm_runs WHERE plan_id = ? AND due_date = ?', id, p.next_due)) return { ok: false, code: 'exists' };
  db.tx(() => {
    const rid = db.run('INSERT INTO pm_runs(plan_id, due_date, outcome, skip_reason, advanced, created_by, created_at) VALUES (?,?,?,?,1,?,?)', id, p.next_due, 'skipped', why, user.id, nowIso()).id;
    const next = advance(db, p, { id: rid, due_date: p.next_due }, null);
    audit.log(db, user.id, 'pm_skip', 'pm_plans', id, { due: p.next_due, next, reason: why });
  });
  return { ok: true };
}

/** What a plan is doing now: 'inactive', 'task' (a task exists for the current date: its status), 'overdue', 'due' (within its lead time), 'upcoming'. */
function stateOf(db, plan) {
  const t = today();
  if (!plan.active) return { key: 'inactive' };
  const run = db.get('SELECT r.*, k.status AS task_status, k.no AS task_no FROM pm_runs r LEFT JOIN tasks k ON k.id = r.task_id WHERE r.plan_id = ? AND r.due_date = ?', plan.id, plan.next_due);
  if (run && run.task_id) return { key: 'task', task_id: run.task_id, task_no: run.task_no, task_status: run.task_status, overdue: plan.next_due < t && ['open', 'in_progress', 'waiting', 'done'].includes(run.task_status) };
  if (plan.next_due < t) return { key: 'overdue' };
  if (tasks.addDays(plan.next_due, -plan.lead_days) <= t) return { key: 'due' };
  return { key: 'upcoming' };
}

/**
 * Starting values for the plan form (owner: daily, "for tomorrow" and weekly plans, everything editable afterwards):
 * 'daily' = every working day, the task is made the day before, for tomorrow; 'weekly' = every Monday, made two days before; 'monthly' = the 1st, made five days before.
 */
function preset(name, day) {
  const t = day || today();
  if (name === 'daily') return { every_n: 1, unit: 'days', weekdays_only: 1, lead_days: 1, basis: 'schedule', next_due: nextWeekday(tasks.addDays(t, 1)) };
  if (name === 'weekly') { let d = tasks.addDays(t, 1); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = tasks.addDays(d, 1); return { every_n: 1, unit: 'weeks', weekdays_only: 0, lead_days: 2, basis: 'schedule', next_due: d }; }
  if (name === 'monthly') { const d = new Date(`${t}T00:00:00Z`); const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); return { every_n: 1, unit: 'months', weekdays_only: 0, lead_days: 5, basis: 'schedule', next_due: first }; }
  return null;
}

/** All plans with their state, sorted by next date. Filters: view 'active' | 'stopped' | 'all', machine, q, state. */
function list(db, f) {
  const where = []; const p = [];
  if (f.view === 'stopped') where.push('pl.active = 0'); else if (f.view !== 'all') where.push('pl.active = 1');
  if (f.machine) { where.push('pl.machine_id = ?'); p.push(f.machine); }
  if (f.team && tasks.TEAMS.includes(f.team)) { where.push('pl.team = ?'); p.push(f.team); }
  if (f.q) { where.push("(pl.title LIKE ? ESCAPE '\\' OR pl.description LIKE ? ESCAPE '\\')"); const like = '%' + f.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'; p.push(like, like); }
  const rows = db.all(`SELECT pl.*, m.name AS machine_name, pr.name AS priority_name, pr.name_en AS priority_name_en FROM pm_plans pl LEFT JOIN machines m ON m.id = pl.machine_id LEFT JOIN priorities pr ON pr.id = pl.priority_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pl.active DESC, pl.next_due, pl.id`, ...p);
  for (const r of rows) {
    r.state = stateOf(db, r);
    r.people = db.all('SELECT pe.name FROM pm_plan_people x JOIN people pe ON pe.id = x.person_id WHERE x.plan_id = ? ORDER BY pe.name', r.id).map((x) => x.name);
    r.days_to = daysBetween(today(), r.next_due);
  }
  return f.state ? rows.filter((r) => r.state.key === f.state) : rows;
}

function counts(db) {
  const rows = list(db, { view: 'active' });
  return {
    active: rows.length,
    overdue: rows.filter((r) => r.state.key === 'overdue' || r.state.overdue).length,
    due: rows.filter((r) => r.state.key === 'due').length,
    week: rows.filter((r) => r.days_to >= 0 && r.days_to <= 7 && r.state.key !== 'task').length,
  };
}

/** One plan with its steps, people and history (every due date: task and its status, or skipped). */
function detail(db, id) {
  const p = get(db, id);
  if (!p) return null;
  p.machine_name = p.machine_id ? (db.get('SELECT name FROM machines WHERE id = ?', p.machine_id) || {}).name : null;
  p.steps = db.all('SELECT * FROM pm_plan_steps WHERE plan_id = ? ORDER BY position, id', id);
  p.people = db.all('SELECT pe.id, pe.name FROM pm_plan_people x JOIN people pe ON pe.id = x.person_id WHERE x.plan_id = ? ORDER BY pe.name', id);
  p.state = stateOf(db, p);
  p.runs = db.all(`SELECT r.*, k.no AS task_no, k.status AS task_status, k.closed_at FROM pm_runs r LEFT JOIN tasks k ON k.id = r.task_id WHERE r.plan_id = ? ORDER BY r.due_date DESC, r.id DESC LIMIT 100`, id);
  p.days_to = daysBetween(today(), p.next_due);
  return p;
}

module.exports = { UNITS, BASES, today, addInterval, nextWeekday, preset, canView, canManage, validate, create, update, setActive, get, makeTask, ensure, generateNow, skip, stateOf, list, counts, detail };
