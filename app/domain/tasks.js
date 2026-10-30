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
  if (f.source_kind) { where.push('t.source_kind = ?'); p.push(f.source_kind); }
  if (f.q) { where.push("(t.title LIKE ? ESCAPE '\\' OR t.no LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')"); const like = '%' + f.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'; p.push(like, like, like); }
  const rows = db.all(`SELECT t.*, pr.name AS priority_name, pr.name_en AS priority_name_en, pr.sort AS priority_sort, m.name AS machine_name
    FROM tasks t LEFT JOIN priorities pr ON pr.id = t.priority_id LEFT JOIN machines m ON m.id = t.machine_id
    WHERE ${where.join(' AND ')} ORDER BY ${f.view === 'closed' ? 't.closed_at DESC, t.id DESC' : 'COALESCE(pr.sort, 0) DESC, t.due_date IS NULL, t.due_date, t.id'} LIMIT ${Math.min(Number(f.limit) || 300, 2000)}`, ...p);
  const byTask = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) { r.assignees = []; r.overdue = !!(r.due_date && ACTIVE.includes(r.status) && r.due_date < today()); }
  for (let i = 0; i < rows.length; i += 400) {
    const ids = rows.slice(i, i + 400).map((r) => r.id);
    for (const a of db.all(`SELECT a.task_id, p.id, p.name FROM task_assignees a JOIN people p ON p.id = a.person_id WHERE a.task_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.name`, ...ids)) byTask.get(a.task_id).assignees.push({ id: a.id, name: a.name });
  }
  return rows;
}

/** Counts for the module tiles and the board tabs. */
function counts(db, team) {
  const r = db.get(`SELECT count(*) FILTER (WHERE status IN ('open', 'in_progress', 'waiting', 'done')) AS active,
      count(*) FILTER (WHERE status IN ('open', 'in_progress', 'waiting', 'done') AND due_date < ?) AS overdue,
      count(*) FILTER (WHERE status IN ('closed', 'cancelled')) AS finished FROM tasks WHERE team = ?`, today(), team);
  return { active: r.active, overdue: r.overdue, finished: r.finished };
}

module.exports = { TEAMS, STATUSES, ACTIVE, FINISHED, teamPath, canView, canCreate, canUpdate, validate, create, update, setAssignees, changeStatus, comment, detail, list, get, counts, today };
