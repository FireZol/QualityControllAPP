'use strict';
// Tasks of the Maintenance, Technical and Quality teams: create, assign, change status, comment, with a full history and notifications.
// Statuses: open -> in_progress -> waiting -> done -> closed, and cancelled. Anyone who may update a team's tasks may close them
// (owner, 2026-10-30); the history keeps who and when. A cancelled or reopened task needs a reason.
const audit = require('./audit');
const numbering = require('./numbering');
const notifications = require('./notifications');
const access = require('./access');
const reg = require('../modules/registry');
const { nowIso } = require('../lib/time');

const TEAMS = ['maintenance', 'technical', 'quality'];
const STATUSES = ['open', 'in_progress', 'waiting', 'done', 'closed', 'cancelled'];
const ACTIVE = ['open', 'in_progress', 'waiting', 'done'];       // not finished with yet
const FINISHED = ['closed', 'cancelled'];
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

const teamPath = (team) => (team === 'quality' ? '/calitate/sarcini' : reg.byId[team].home);

/** What each user level may do with the tasks of a team. */
const canView = (db, user, team, enabled) => access.can(db, user, team, 'view', enabled);
const canCreate = (db, user, team, enabled) => access.can(db, user, team, 'enter', enabled);
const canUpdate = (db, user, team, enabled) => access.can(db, user, team, 'lead', enabled);

const today = () => nowIso().slice(0, 10);

/** yyyy-mm-dd plus n days (calendar arithmetic in UTC, so no daylight-saving surprises). */
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function addMonths(iso, n) { const d = new Date(`${iso}T00:00:00Z`); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); }

/** Board sort orders (owner: sort the way the work is planned). */
const SORT_KEYS = ['priority', 'due', 'new', 'updated'];
const SORTS = {
  priority: 'COALESCE(pr.sort, 0) DESC, t.due_date IS NULL, t.due_date, t.id',
  due: 't.due_date IS NULL, t.due_date, COALESCE(pr.sort, 0) DESC, t.id',
  new: 't.id DESC',
  updated: 't.updated_at DESC, t.id DESC',
};

function validate(db, data) {
  const errors = {};
  const v = {
    team: data.team, title: String(data.title || '').trim(), description: String(data.description || '').trim() || null,
    priority_id: data.priority_id ? Number(data.priority_id) : null, due_date: String(data.due_date || '').trim() || null,
    machine_id: data.machine_id ? Number(data.machine_id) : null, area: String(data.area || '').trim() || null,
    source_kind: data.source_kind || 'manual', source_id: data.source_id || null,
    assignees: [...new Set((data.assignees || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))],
  };
  if (!TEAMS.includes(v.team)) errors.team = 'invalid';
  if (!v.title) errors.title = 'required'; else if (v.title.length > 200) errors.title = 'too_long';
  if (v.description && v.description.length > 4000) errors.description = 'too_long';
  if (v.area && v.area.length > 120) errors.area = 'too_long';
  if (v.priority_id && !db.get('SELECT 1 FROM priorities WHERE id = ?', v.priority_id)) errors.priority_id = 'invalid';
  if (v.due_date && (!RE_DATE.test(v.due_date) || Number.isNaN(Date.parse(v.due_date)))) errors.due_date = 'invalid';
  if (v.machine_id && !db.get('SELECT 1 FROM machines WHERE id = ?', v.machine_id)) errors.machine_id = 'invalid';
  if (v.assignees.some((id) => !db.get('SELECT 1 FROM people WHERE id = ?', id))) errors.assignees = 'invalid';
  if (!v.priority_id) v.priority_id = (db.get("SELECT id FROM priorities WHERE active = 1 ORDER BY sort LIMIT 1 OFFSET 1") || db.get('SELECT id FROM priorities WHERE active = 1 ORDER BY sort LIMIT 1') || {}).id || null;
  return { errors, v };
}

function event(db, taskId, userId, kind, extra) {
  const e = extra || {};
  db.run('INSERT INTO task_events(task_id, at, user_id, kind, from_status, to_status, text, details) VALUES (?,?,?,?,?,?,?,?)',
    taskId, nowIso(), userId || null, kind, e.from || null, e.to || null, e.text || null, e.details ? JSON.stringify(e.details) : null);
}

/** Leads of a team with a login (explicit lead rows): told about new requests. */
function leadUsers(db, team) {
  return db.all("SELECT user_id FROM user_modules WHERE module = ? AND level = 'lead'", team).map((r) => r.user_id);
}

/** The users to tell about a task: its creator and its assignees that log in (not the one who did the thing). */
function watchers(db, task, exceptUserId) {
  const ids = [task.created_by, ...notifications.usersOfPeople(db, db.all('SELECT person_id FROM task_assignees WHERE task_id = ?', task.id).map((r) => r.person_id))];
  return ids.filter((id) => id && id !== exceptUserId);
}

const params = (t) => ({ no: t.no, title: t.title });

/** @returns {{ok: true, id, no} | {ok: false, errors}} */
function create(db, user, data) {
  const { errors, v } = validate(db, data);
  if (Object.keys(errors).length) return { ok: false, errors };
  return db.tx(() => {
    const no = numbering.next(db, 'task', { team: v.team });
    const now = nowIso();
    const id = db.run(`INSERT INTO tasks(no, team, title, description, priority_id, status, due_date, machine_id, area, site, source_kind, source_id, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,'open',?,?,?,?,?,?,?,?,?)`, no, v.team, v.title, v.description, v.priority_id, v.due_date, v.machine_id, v.area, data.site || null, v.source_kind, v.source_id, user ? user.id : null, now, now).id;
    for (const pid of v.assignees) db.run('INSERT INTO task_assignees(task_id, person_id) VALUES (?,?)', id, pid);
    event(db, id, user && user.id, 'created', { details: { assignees: v.assignees, source: v.source_kind } });
    audit.log(db, user ? user.id : null, 'task_create', 'tasks', id, { no, team: v.team, title: v.title });
    const link = `/sarcini/${id}`;
    notifications.notify(db, notifications.usersOfPeople(db, v.assignees).filter((u) => !user || u !== user.id), 'task_assigned', { no, title: v.title }, link);
    notifications.notify(db, leadUsers(db, v.team).filter((u) => !user || u !== user.id), 'task_new', { no, title: v.title, by: user ? user.full_name : '' }, link);
    return { ok: true, id, no };
  });
}

const get = (db, id) => db.get('SELECT * FROM tasks WHERE id = ?', id);

/** Edit the content (not the status). Changed fields are recorded in the history. */
function update(db, user, id, data) {
  const task = get(db, id);
  if (!task) return { ok: false, code: 'not_found' };
  const { errors, v } = validate(db, { ...data, team: task.team });
  if (Object.keys(errors).length) return { ok: false, errors };
  return db.tx(() => {
    const changes = {};
    for (const k of ['title', 'description', 'priority_id', 'due_date', 'machine_id', 'area']) if ((task[k] ?? null) !== (v[k] ?? null)) changes[k] = { from: task[k] ?? null, to: v[k] ?? null };
    if (Object.keys(changes).length) {
      db.run('UPDATE tasks SET title=?, description=?, priority_id=?, due_date=?, machine_id=?, area=?, updated_at=? WHERE id = ?', v.title, v.description, v.priority_id, v.due_date, v.machine_id, v.area, nowIso(), id);
      event(db, id, user.id, 'edit', { details: changes });
      audit.log(db, user.id, 'task_edit', 'tasks', id, { no: task.no, changes });
    }
    if (data.assignees !== undefined) setAssignees(db, user, id, v.assignees);
    return { ok: true };
  });
}

function setAssignees(db, user, id, personIds) {
  const task = get(db, id);
  if (!task) return { ok: false, code: 'not_found' };
  const ids = [...new Set((personIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].filter((p) => db.get('SELECT 1 FROM people WHERE id = ?', p));
  const before = db.all('SELECT person_id FROM task_assignees WHERE task_id = ?', id).map((r) => r.person_id);
  const added = ids.filter((p) => !before.includes(p)), removed = before.filter((p) => !ids.includes(p));
  if (!added.length && !removed.length) return { ok: true, changed: false };
  db.tx(() => {
    db.run('DELETE FROM task_assignees WHERE task_id = ?', id);
    for (const p of ids) db.run('INSERT INTO task_assignees(task_id, person_id) VALUES (?,?)', id, p);
    db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', nowIso(), id);
    const names = (list) => (list.length ? db.all(`SELECT name FROM people WHERE id IN (${list.map(() => '?').join(',')}) ORDER BY name`, ...list).map((r) => r.name).join(', ') : '');
    event(db, id, user.id, 'assign', { details: { added, removed, names_added: names(added), names_removed: names(removed) } });
    notifications.notify(db, notifications.usersOfPeople(db, added).filter((u) => u !== user.id), 'task_assigned', params(task), `/sarcini/${id}`);
  });
  return { ok: true, changed: true };
}

/** Change the status. A reason is required to cancel and to reopen a finished task. @returns {{ok, code?}} */
function changeStatus(db, user, id, to, comment) {
  const task = get(db, id);
  if (!task) return { ok: false, code: 'not_found' };
  if (!STATUSES.includes(to) || to === task.status) return { ok: false, code: 'invalid' };
  const text = String(comment || '').trim().slice(0, 2000) || null;
  const reopening = FINISHED.includes(task.status) || (task.status === 'done' && to === 'open');
  if ((to === 'cancelled' || reopening) && !text) return { ok: false, code: 'reason_required' };
  return db.tx(() => {
    const now = nowIso();
    const finishing = to === 'closed' || to === 'cancelled';
    db.run('UPDATE tasks SET status = ?, updated_at = ?, closed_at = ?, closed_by = ? WHERE id = ?', to, now, finishing ? now : null, finishing ? user.id : null, id);
    event(db, id, user.id, 'status', { from: task.status, to, text });
    audit.log(db, user.id, 'task_status', 'tasks', id, { no: task.no, from: task.status, to });
    notifications.notify(db, watchers(db, task, user.id), 'task_status', { ...params(task), from: task.status, to, by: user.full_name }, `/sarcini/${id}`);
    return { ok: true };
  });
}

function comment(db, user, id, text) {
  const task = get(db, id);
  if (!task) return { ok: false, code: 'not_found' };
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) return { ok: false, code: 'required' };
  db.tx(() => {
    db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', nowIso(), id);
    event(db, id, user.id, 'comment', { text: t });
    notifications.notify(db, watchers(db, task, user.id), 'task_comment', { ...params(task), by: user.full_name }, `/sarcini/${id}`);
  });
  return { ok: true };
}

/** One task with its assignees, history and names. */
function detail(db, id) {
  const t = db.get(`SELECT t.*, p.name AS priority_name, p.name_en AS priority_name_en, p.sort AS priority_sort, m.name AS machine_name, u.full_name AS created_by_name, cu.full_name AS closed_by_name
    FROM tasks t LEFT JOIN priorities p ON p.id = t.priority_id LEFT JOIN machines m ON m.id = t.machine_id JOIN users u ON u.id = t.created_by LEFT JOIN users cu ON cu.id = t.closed_by WHERE t.id = ?`, id);
  if (!t) return null;
  t.assignees = db.all('SELECT p.id, p.name FROM task_assignees a JOIN people p ON p.id = a.person_id WHERE a.task_id = ? ORDER BY p.name', id);
  t.events = db.all('SELECT e.*, u.full_name AS user_name FROM task_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.task_id = ? ORDER BY e.id', id)
    .map((e) => ({ ...e, details: e.details ? JSON.parse(e.details) : null }));
  t.checklist = checklistOf(db, id);
  t.overdue = !!(t.due_date && ACTIVE.includes(t.status) && t.due_date < today());
  return t;
}

/**
 * The board: filters {team, view: 'active'|'closed'|'all', person, priority, machine, overdue, q}.
 * Sorted by priority (high first) then due date (soonest first, none last).
 */
function list(db, f) {
  const where = ['t.team = ?']; const p = [f.team];
  if (f.view === 'closed') where.push(`t.status IN ('closed', 'cancelled')`);
  else if (f.view !== 'all') where.push(`t.status IN ('open', 'in_progress', 'waiting', 'done')`);
  if (f.status && STATUSES.includes(f.status)) { where.push('t.status = ?'); p.push(f.status); }
  if (f.person) { where.push('EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.person_id = ?)'); p.push(f.person); }
  if (f.priority) { where.push('t.priority_id = ?'); p.push(f.priority); }
  if (f.machine) { where.push('t.machine_id = ?'); p.push(f.machine); }
  if (f.overdue) { where.push(`t.due_date < ? AND t.status IN ('open', 'in_progress', 'waiting', 'done')`); p.push(today()); }
  if (f.persons && f.persons.length) { where.push(`EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.person_id IN (${f.persons.map(() => '?').join(',')}))`); p.push(...f.persons); }
  if (f.unassigned) where.push('NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)');
  if (f.soon) { where.push(`t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ? AND t.status IN ('open', 'in_progress', 'waiting', 'done')`); p.push(today(), addDays(today(), 7)); }
  if (f.created_by) { where.push('t.created_by = ?'); p.push(f.created_by); }
  if (f.source_kind) { where.push('t.source_kind = ?'); p.push(f.source_kind); }
  if (f.q) { where.push("(t.title LIKE ? ESCAPE '\\' OR t.no LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')"); const like = '%' + f.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'; p.push(like, like, like); }
  const order = f.view === 'closed' ? 't.closed_at DESC, t.id DESC' : SORTS[f.sort] || SORTS.priority;
  const rows = db.all(`SELECT t.*, pr.name AS priority_name, pr.name_en AS priority_name_en, pr.sort AS priority_sort, m.name AS machine_name,
      (SELECT count(*) FROM task_checklist c WHERE c.task_id = t.id) AS check_total, (SELECT count(*) FROM task_checklist c WHERE c.task_id = t.id AND c.done = 1) AS check_done,
      (SELECT count(*) FROM task_events e WHERE e.task_id = t.id AND e.kind = 'comment') AS comments
    FROM tasks t LEFT JOIN priorities pr ON pr.id = t.priority_id LEFT JOIN machines m ON m.id = t.machine_id
    WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${Math.min(Number(f.limit) || 300, 2000)}`, ...p);
  const byTask = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) { r.assignees = []; r.overdue = !!(r.due_date && ACTIVE.includes(r.status) && r.due_date < today()); }
  for (let i = 0; i < rows.length; i += 400) {
    const ids = rows.slice(i, i + 400).map((r) => r.id);
    for (const a of db.all(`SELECT a.task_id, p.id, p.name FROM task_assignees a JOIN people p ON p.id = a.person_id WHERE a.task_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.name`, ...ids)) byTask.get(a.task_id).assignees.push({ id: a.id, name: a.name });
  }
  return rows;
}

// ---- checklist: the steps of a job, ticked off by whoever does them; every change is in the history ----
function checklistOf(db, id) {
  return db.all('SELECT c.*, u.full_name AS done_by_name FROM task_checklist c LEFT JOIN users u ON u.id = c.done_by WHERE c.task_id = ? ORDER BY c.position, c.id', id);
}

function checkEvent(db, user, id, action, item) {
  db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', nowIso(), id);
  event(db, id, user.id, 'edit', { details: { checklist: { action, item } } });
}

/** Add steps (one per line or array entry). */
function addChecklist(db, user, id, texts) {
  if (!get(db, id)) return { ok: false, code: 'not_found' };
  const items = (Array.isArray(texts) ? texts : String(texts || '').split(/\r?\n/)).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 50);
  if (!items.length) return { ok: false, code: 'required' };
  db.tx(() => {
    let pos = db.value('SELECT COALESCE(max(position), 0) FROM task_checklist WHERE task_id = ?', id);
    for (const text of items) db.run('INSERT INTO task_checklist(task_id, position, text, created_at) VALUES (?,?,?,?)', id, ++pos, text, nowIso());
    checkEvent(db, user, id, 'added', items.join('; '));
  });
  return { ok: true, added: items.length };
}

function setChecked(db, user, id, itemId, done) {
  const it = db.get('SELECT * FROM task_checklist WHERE id = ? AND task_id = ?', itemId, id);
  if (!it) return { ok: false, code: 'not_found' };
  if (!!it.done === !!done) return { ok: true, changed: false };
  db.tx(() => {
    db.run('UPDATE task_checklist SET done = ?, done_by = ?, done_at = ? WHERE id = ?', done ? 1 : 0, done ? user.id : null, done ? nowIso() : null, itemId);
    checkEvent(db, user, id, done ? 'checked' : 'unchecked', it.text);
  });
  return { ok: true, changed: true };
}

function removeChecklistItem(db, user, id, itemId) {
  const it = db.get('SELECT * FROM task_checklist WHERE id = ? AND task_id = ?', itemId, id);
  if (!it) return { ok: false, code: 'not_found' };
  db.tx(() => { db.run('DELETE FROM task_checklist WHERE id = ?', itemId); checkEvent(db, user, id, 'removed', it.text); });
  return { ok: true };
}

/** A copy of a task's steps, all unticked, for a task made from another one. */
function copyChecklist(db, user, fromId, toId) {
  const steps = checklistOf(db, fromId).map((c) => c.text);
  if (steps.length) addChecklist(db, user, toId, steps);
  return steps.length;
}

// ---- plan: priority and due date in one tap, postponing with a note in the history ----
function addToDue(task, how) {
  const base = task.due_date && task.due_date > today() ? task.due_date : today();
  return how === '1d' ? addDays(base, 1) : how === '1w' ? addDays(base, 7) : how === '1m' ? addMonths(base, 1) : null;
}

/** Set priority and/or due date ('postpone' = '1d' | '1w' | '1m' moves the due date on from the later of today and the current one). */
function plan(db, user, id, data) {
  const task = get(db, id);
  if (!task) return { ok: false, code: 'not_found' };
  let due = data.due_date !== undefined ? String(data.due_date || '').trim() || null : task.due_date;
  if (data.postpone) { due = addToDue(task, data.postpone); if (!due) return { ok: false, code: 'invalid' }; }
  const r = update(db, user, id, { title: task.title, description: task.description, priority_id: data.priority_id !== undefined && data.priority_id !== '' ? data.priority_id : task.priority_id, due_date: due, machine_id: task.machine_id, area: task.area });
  return r.ok ? { ok: true } : { ok: false, code: 'invalid', errors: r.errors };
}

/**
 * The same change for several tasks of a team. action: 'status' (value = a status; reopening or cancelling needs a reason, so those are skipped),
 * 'assign' (value = a person, added to the others), 'priority', 'due' (value '' clears it). @returns {{changed, skipped}}
 */
function bulk(db, user, team, ids, action, value) {
  let changed = 0, skipped = 0;
  for (const id of [...new Set(ids.map(Number))].slice(0, 500)) {
    const t = get(db, id);
    if (!t || t.team !== team) { skipped++; continue; }
    let r;
    if (action === 'status') r = changeStatus(db, user, id, value, null);
    else if (action === 'assign') {
      const person = Number(value);
      if (!Number.isInteger(person) || person <= 0 || !db.get('SELECT 1 FROM people WHERE id = ?', person)) r = { ok: false };
      else { setAssignees(db, user, id, [...db.all('SELECT person_id FROM task_assignees WHERE task_id = ?', id).map((x) => x.person_id), person]); r = { ok: true }; }
    } else if (action === 'priority' || action === 'due') r = plan(db, user, id, action === 'priority' ? { priority_id: value } : { due_date: value });
    else r = { ok: false };
    if (r.ok) changed++; else skipped++;
  }
  return { changed, skipped };
}

/** Values to pre-fill a new task from an existing one of the same team. */
function copyValues(db, id, team) {
  const t = get(db, id);
  if (!t || t.team !== team) return null;
  return { title: t.title, description: t.description, priority_id: t.priority_id, machine_id: t.machine_id, area: t.area };
}

/** The two numbers of the top bar for some teams: tasks still being worked on, and active tasks of the highest priority ("critical"). */
function barCounts(db, teams) {
  if (!teams.length) return { open: 0, critical: 0, topPriority: null };
  const ph = teams.map(() => '?').join(',');
  const top = db.get('SELECT id, sort FROM priorities WHERE active = 1 ORDER BY sort DESC LIMIT 1');
  return {
    open: db.value(`SELECT count(*) FROM tasks WHERE team IN (${ph}) AND status IN ('open', 'in_progress', 'waiting')`, ...teams),
    critical: top ? db.value(`SELECT count(*) FROM tasks WHERE team IN (${ph}) AND priority_id = ? AND status IN ('open', 'in_progress', 'waiting', 'done')`, ...teams, top.id) : 0,
    topPriority: top ? top.id : null,
  };
}

/** Open tasks assigned to a user (through their people row), soonest due first. */
function mine(db, userId, limit) {
  return db.all(`SELECT DISTINCT t.id, t.no, t.title, t.team, t.status, t.due_date FROM tasks t JOIN task_assignees a ON a.task_id = t.id JOIN people p ON p.id = a.person_id
    WHERE p.user_id = ? AND t.status IN ('open', 'in_progress', 'waiting', 'done') ORDER BY t.due_date IS NULL, t.due_date, t.id LIMIT ?`, userId, limit || 5)
    .map((t) => ({ ...t, overdue: !!(t.due_date && t.due_date < today()) }));
}

/** Counts for the module tiles and the board tabs. */
function counts(db, team) {
  const r = db.get(`SELECT count(*) FILTER (WHERE status IN ('open', 'in_progress', 'waiting', 'done')) AS active,
      count(*) FILTER (WHERE status IN ('open', 'in_progress', 'waiting', 'done') AND due_date < ?) AS overdue,
      count(*) FILTER (WHERE status IN ('closed', 'cancelled')) AS finished FROM tasks WHERE team = ?`, today(), team);
  const by = {};
  for (const st of ACTIVE) by[st] = db.value('SELECT count(*) FROM tasks WHERE team = ? AND status = ?', team, st);
  return { active: r.active, overdue: r.overdue, finished: r.finished, by };
}

module.exports = { TEAMS, STATUSES, ACTIVE, FINISHED, teamPath, canView, canCreate, canUpdate, validate, create, update, setAssignees, changeStatus, comment, detail, list, get, counts, mine, barCounts, today, addDays, SORT_KEYS, checklistOf, addChecklist, setChecked, removeChecklistItem, copyChecklist, plan, bulk, copyValues };
