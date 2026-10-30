'use strict';
// The non-conformity register (starts new in the app; an Excel import can fill `external_ref` and the rest later). A record is reported
// (anyone with the Quality "enter" level), evaluated and closed by the Quality leads, and can hand work to any team as tasks.
// Status: reported -> evaluation -> action -> closed, or cancelled. Closing needs a disposition (what was decided about the product);
// cancelling and reopening need a reason. Everything is written to a history; nothing is deleted.
const audit = require('./audit');
const numbering = require('./numbering');
const notifications = require('./notifications');
const access = require('./access');
const tasks = require('./tasks');
const settings = require('./settings');
const { nowIso } = require('../lib/time');

const STATUSES = ['reported', 'evaluation', 'action', 'closed', 'cancelled'];
const OPEN = ['reported', 'evaluation', 'action'];
const FINISHED = ['closed', 'cancelled'];
const SOURCES = ['manual', 'measurement', 'batch', 'customer', 'audit'];
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => nowIso().slice(0, 10);

const canView = (db, user, enabled) => access.can(db, user, 'quality', 'view', enabled);
const canReport = (db, user, enabled) => access.can(db, user, 'quality', 'enter', enabled);
const canLead = (db, user, enabled) => access.can(db, user, 'quality', 'lead', enabled);

const leadUsers = (db) => db.all("SELECT user_id FROM user_modules WHERE module = 'quality' AND level = 'lead'").map((r) => r.user_id);
const get = (db, id) => db.get('SELECT * FROM ncrs WHERE id = ?', id);

function event(db, id, userId, kind, extra) {
  const e = extra || {};
  db.run('INSERT INTO ncr_events(ncr_id, at, user_id, kind, from_status, to_status, text, details) VALUES (?,?,?,?,?,?,?,?)', id, nowIso(), userId || null, kind, e.from || null, e.to || null, e.text || null, e.details ? JSON.stringify(e.details) : null);
}

const FIELDS = ['title', 'description', 'type_id', 'severity_id', 'machine_id', 'product', 'quantity', 'source_kind', 'record_no', 'batch_id', 'external_ref', 'reported_at', 'containment', 'cause', 'evaluation', 'disposition_id', 'corrective_action', 'preventive_action', 'responsible_person_id', 'action_due'];

/** The closing rules and the evaluation deadline, all set in the app (Setări → Module de echipă). */
const rules = (db) => ({
  disposition: settings.get(db, 'ncr.require_disposition') !== false, cause: settings.get(db, 'ncr.require_cause') === true,
  corrective: settings.get(db, 'ncr.require_corrective') === true, verification: settings.get(db, 'ncr.require_verification') === true,
  evalDays: Number(settings.get(db, 'ncr.eval_days')) || 2,
});

function validate(db, data, partial) {
  const errors = {}; const v = {};
  const has = (k) => !partial || data[k] !== undefined;
  const text = (k, max, required) => { if (!has(k)) return; v[k] = String(data[k] ?? '').trim() || null; if (required && !v[k]) errors[k] = 'required'; else if (v[k] && v[k].length > max) errors[k] = 'too_long'; };
  const ref = (k, table, where) => { if (!has(k)) return; v[k] = data[k] ? Number(data[k]) : null; if (v[k] && !db.get(`SELECT 1 FROM ${table} WHERE id = ?${where || ''}`, v[k])) errors[k] = 'invalid'; };
  text('title', 200, true); text('description', 4000); text('product', 120); text('quantity', 80); text('external_ref', 60); text('cause', 4000); text('evaluation', 4000); text('containment', 4000); text('corrective_action', 4000); text('preventive_action', 4000); text('verification_note', 2000);
  ref('type_id', 'ncr_types'); ref('severity_id', 'priorities'); ref('machine_id', 'machines'); ref('disposition_id', 'ncr_dispositions'); ref('batch_id', 'batches'); ref('responsible_person_id', 'people');
  if (has('action_due')) { v.action_due = String(data.action_due || '').trim() || null; if (v.action_due && (!RE_DATE.test(v.action_due) || Number.isNaN(Date.parse(v.action_due)))) errors.action_due = 'invalid'; }
  if (has('source_kind')) { v.source_kind = SOURCES.includes(data.source_kind) ? data.source_kind : 'manual'; }
  if (has('record_no')) { v.record_no = data.record_no ? Number(data.record_no) : null; if (v.record_no && (!Number.isInteger(v.record_no) || !db.get('SELECT 1 FROM measurements WHERE record_no = ?', v.record_no))) errors.record_no = 'invalid'; }
  if (has('reported_at')) { v.reported_at = String(data.reported_at || '').trim() || today(); if (!RE_DATE.test(v.reported_at) || Number.isNaN(Date.parse(v.reported_at))) errors.reported_at = 'invalid'; }
  return { errors, v };
}

/** @returns {{ok, id, no} | {ok:false, errors}} */
function create(db, user, data) {
  const { errors, v } = validate(db, data, false);
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!v.severity_id) v.severity_id = (db.get('SELECT id FROM priorities WHERE active = 1 ORDER BY sort LIMIT 1 OFFSET 1') || db.get('SELECT id FROM priorities WHERE active = 1 ORDER BY sort LIMIT 1') || {}).id || null;
  return db.tx(() => {
    const no = numbering.next(db, 'ncr');
    const now = nowIso();
    const id = db.run(`INSERT INTO ncrs(no, title, description, status, type_id, severity_id, machine_id, product, quantity, source_kind, record_no, batch_id, external_ref, site, cause, evaluation, disposition_id, reported_by, reported_at, created_at, updated_at)
      VALUES (?,?,?,'reported',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, no, v.title, v.description, v.type_id, v.severity_id, v.machine_id, v.product, v.quantity, v.source_kind, v.record_no, v.batch_id, v.external_ref, data.site || null, v.cause, v.evaluation, v.disposition_id, user.id, v.reported_at, now, now).id;
    for (const k of ['containment', 'corrective_action', 'preventive_action', 'responsible_person_id', 'action_due']) if (v[k]) db.run(`UPDATE ncrs SET ${k} = ? WHERE id = ?`, v[k], id);
    event(db, id, user.id, 'created', { details: { source: v.source_kind, record_no: v.record_no } });
    audit.log(db, user.id, 'ncr_create', 'ncrs', id, { no, title: v.title });
    notifications.notify(db, leadUsers(db).filter((u) => u !== user.id), 'ncr_new', { no, title: v.title, by: user.full_name }, `/calitate/neconformitati/${id}`);
    return { ok: true, id, no };
  });
}

/** Change fields (the reporter's facts and the lead's evaluation); what changed is written to the history. */
function update(db, user, id, data) {
  const n = get(db, id);
  if (!n) return { ok: false, code: 'not_found' };
  const { errors, v } = validate(db, data, true);
  if (Object.keys(errors).length) return { ok: false, errors };
  return db.tx(() => {
    const changes = {};
    for (const k of FIELDS) if (v[k] !== undefined && (n[k] ?? null) !== (v[k] ?? null)) changes[k] = { from: n[k] ?? null, to: v[k] ?? null };
    if (Object.keys(changes).length) {
      const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
      db.run(`UPDATE ncrs SET ${sets}, updated_at = ? WHERE id = ?`, ...Object.keys(changes).map((k) => changes[k].to), nowIso(), id);
      event(db, id, user.id, 'edit', { details: changes });
      audit.log(db, user.id, 'ncr_edit', 'ncrs', id, { no: n.no, changes });
    }
    return { ok: true, changed: Object.keys(changes).length };
  });
}

/** @returns {{ok, code?}} codes: invalid, reason_required, disposition_required */
function setStatus(db, user, id, to, comment) {
  const n = get(db, id);
  if (!n) return { ok: false, code: 'not_found' };
  if (!STATUSES.includes(to) || to === n.status) return { ok: false, code: 'invalid' };
  const text = String(comment || '').trim().slice(0, 2000) || null;
  const reopening = FINISHED.includes(n.status);
  if ((to === 'cancelled' || reopening) && !text) return { ok: false, code: 'reason_required' };
  if (to === 'closed') {
    const r = rules(db);
    if (r.disposition && !n.disposition_id) return { ok: false, code: 'disposition_required' };
    if (r.cause && !n.cause) return { ok: false, code: 'cause_required' };
    if (r.corrective && !n.corrective_action) return { ok: false, code: 'corrective_required' };
    if (r.verification && !n.verified_at) return { ok: false, code: 'verification_required' };
  }
  return db.tx(() => {
    const now = nowIso();
    const finishing = FINISHED.includes(to);
    db.run('UPDATE ncrs SET status = ?, updated_at = ?, closed_at = ?, closed_by = ? WHERE id = ?', to, now, finishing ? now : null, finishing ? user.id : null, id);
    event(db, id, user.id, 'status', { from: n.status, to, text });
    audit.log(db, user.id, 'ncr_status', 'ncrs', id, { no: n.no, from: n.status, to });
    notifications.notify(db, [n.reported_by].filter((u) => u !== user.id), 'ncr_status', { no: n.no, title: n.title, from: n.status, to, by: user.full_name }, `/calitate/neconformitati/${id}`);
    return { ok: true };
  });
}

function comment(db, user, id, text) {
  const n = get(db, id);
  if (!n) return { ok: false, code: 'not_found' };
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) return { ok: false, code: 'required' };
  db.tx(() => {
    db.run('UPDATE ncrs SET updated_at = ? WHERE id = ?', nowIso(), id);
    event(db, id, user.id, 'comment', { text: t });
    notifications.notify(db, [n.reported_by, ...leadUsers(db)].filter((u) => u !== user.id), 'ncr_comment', { no: n.no, title: n.title, by: user.full_name }, `/calitate/neconformitati/${id}`);
  });
  return { ok: true };
}

/**
 * A task for a team coming out of the record (owner: the register points tasks to Maintenance, Quality and Technical). A record that is
 * still "reported" or "evaluation" moves to "action": work has started on it.
 */
function addTask(db, user, id, data) {
  const n = get(db, id);
  if (!n) return { ok: false, code: 'not_found' };
  if (FINISHED.includes(n.status)) return { ok: false, code: 'finished' };
  return db.tx(() => {
    const t = tasks.create(db, user, { team: data.team, title: data.title, description: `${n.no} — ${n.title}${data.description ? `\n\n${data.description}` : ''}`, priority_id: data.priority_id || n.severity_id, due_date: data.due_date, machine_id: n.machine_id, assignees: data.assignees || [], source_kind: 'ncr', source_id: id });
    if (!t.ok) return { ok: false, errors: t.errors };
    event(db, id, user.id, 'task', { details: { task_id: t.id, no: t.no, team: data.team } });
    if (n.status === 'reported' || n.status === 'evaluation') {
      db.run("UPDATE ncrs SET status = 'action', updated_at = ? WHERE id = ?", nowIso(), id);
      event(db, id, user.id, 'status', { from: n.status, to: 'action', text: null, details: { auto: true } });
    } else db.run('UPDATE ncrs SET updated_at = ? WHERE id = ?', nowIso(), id);
    return { ok: true, task_id: t.id, no: t.no };
  });
}

/** The check that the action worked ("effectiveness verification"): who and when, with a note. `undo` takes it back. */
function verify(db, user, id, note, undo) {
  const n = get(db, id);
  if (!n) return { ok: false, code: 'not_found' };
  if (n.status === 'cancelled') return { ok: false, code: 'finished' };
  const text = String(note || '').trim().slice(0, 2000) || null;
  db.tx(() => {
    if (undo) db.run('UPDATE ncrs SET verified_at = NULL, verified_by = NULL, verification_note = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
    else db.run('UPDATE ncrs SET verified_at = ?, verified_by = ?, verification_note = ?, updated_at = ? WHERE id = ?', today(), user.id, text, nowIso(), id);
    event(db, id, user.id, 'edit', { text: undo ? null : text, details: { verified: { from: n.verified_at, to: undo ? null : today() } } });
    audit.log(db, user.id, 'ncr_edit', 'ncrs', id, { no: n.no, verified: !undo });
  });
  return { ok: true };
}

/** Records that look like the same problem: the same type on the same machine or the same product, within 90 days either side. */
function similar(db, id) {
  const n = get(db, id);
  if (!n || !n.type_id || (!n.machine_id && !n.product)) return [];
  return db.all(`SELECT o.id, o.no, o.title, o.status, o.reported_at FROM ncrs o WHERE o.id <> ? AND o.status <> 'cancelled' AND o.type_id = ?
    AND ((? IS NOT NULL AND o.machine_id = ?) OR (? IS NOT NULL AND o.product = ?)) AND o.reported_at BETWEEN ? AND ? ORDER BY o.reported_at DESC LIMIT 10`,
  id, n.type_id, n.machine_id, n.machine_id, n.product || null, n.product || null, tasks.addDays(n.reported_at, -90), tasks.addDays(n.reported_at, 90));
}

/** One record with names, tasks and history. */
function detail(db, id) {
  const n = db.get(`SELECT n.*, t.name AS type_name, t.name_en AS type_name_en, p.name AS severity_name, p.name_en AS severity_name_en, p.sort AS severity_sort, m.name AS machine_name,
      d.name AS disposition_name, d.name_en AS disposition_name_en, u.full_name AS reported_by_name, cu.full_name AS closed_by_name, b.batch_no AS batch_no, rp.name AS responsible_name, vu.full_name AS verified_by_name
    FROM ncrs n LEFT JOIN ncr_types t ON t.id = n.type_id LEFT JOIN priorities p ON p.id = n.severity_id LEFT JOIN machines m ON m.id = n.machine_id LEFT JOIN ncr_dispositions d ON d.id = n.disposition_id
    LEFT JOIN users u ON u.id = n.reported_by LEFT JOIN users cu ON cu.id = n.closed_by LEFT JOIN batches b ON b.id = n.batch_id LEFT JOIN people rp ON rp.id = n.responsible_person_id LEFT JOIN users vu ON vu.id = n.verified_by WHERE n.id = ?`, id);
  if (!n) return null;
  n.tasks = db.all(`SELECT t.id, t.no, t.title, t.team, t.status, t.due_date FROM tasks t WHERE t.source_kind = 'ncr' AND t.source_id = ? ORDER BY t.id`, id);
  for (const t of n.tasks) t.assignees = db.all('SELECT p.name FROM task_assignees a JOIN people p ON p.id = a.person_id WHERE a.task_id = ? ORDER BY p.name', t.id).map((r) => r.name);
  n.events = db.all('SELECT e.*, u.full_name AS user_name FROM ncr_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.ncr_id = ? ORDER BY e.id', id).map((e) => ({ ...e, details: e.details ? JSON.parse(e.details) : null }));
  n.age_days = Math.max(0, Math.round((Date.parse(`${(n.closed_at || nowIso()).slice(0, 10)}T00:00:00Z`) - Date.parse(`${n.reported_at}T00:00:00Z`)) / 86400000));
  n.similar = similar(db, id);
  n.eval_overdue = n.status === 'reported' && n.age_days > rules(db).evalDays;
  n.action_overdue = !!(n.action_due && !FINISHED.includes(n.status) && n.action_due < today());
  return n;
}

const SORTS = {
  new: 'n.reported_at DESC, n.id DESC',
  severity: 'COALESCE(p.sort, 0) DESC, n.reported_at DESC, n.id DESC',
  status: "CASE n.status WHEN 'reported' THEN 0 WHEN 'evaluation' THEN 1 WHEN 'action' THEN 2 WHEN 'closed' THEN 3 ELSE 4 END, n.reported_at DESC",
  age: 'n.reported_at, n.id',
};
const SORT_KEYS = Object.keys(SORTS);

/** The register. Filters: view 'open' | 'closed' | 'all', status, type, severity, machine, mine (user id), days (reported in the last N days), q, sort. */
function list(db, f) {
  const where = []; const p = [];
  if (f.view === 'closed') where.push("n.status IN ('closed', 'cancelled')"); else if (f.view !== 'all') where.push("n.status IN ('reported', 'evaluation', 'action')");
  if (f.status && STATUSES.includes(f.status)) { where.push('n.status = ?'); p.push(f.status); }
  for (const [k, col] of [['type', 'n.type_id'], ['severity', 'n.severity_id'], ['machine', 'n.machine_id']]) if (f[k]) { where.push(`${col} = ?`); p.push(f[k]); }
  if (f.mine) { where.push('n.reported_by = ?'); p.push(f.mine); }
  if (f.days) { where.push('n.reported_at >= ?'); p.push(tasks.addDays(today(), -Number(f.days))); }
  if (f.eval_overdue) { where.push("n.status = 'reported' AND n.reported_at < ?"); p.push(tasks.addDays(today(), -rules(db).evalDays)); }
  if (f.q) { where.push("(n.title LIKE ? ESCAPE '\\' OR n.no LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\' OR n.product LIKE ? ESCAPE '\\' OR n.external_ref LIKE ? ESCAPE '\\')"); const like = '%' + f.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'; p.push(like, like, like, like, like); }
  const rows = db.all(`SELECT n.*, t.name AS type_name, t.name_en AS type_name_en, p.name AS severity_name, p.name_en AS severity_name_en, p.sort AS severity_sort, m.name AS machine_name, u.full_name AS reported_by_name,
      (SELECT count(*) FROM ncrs o WHERE o.id <> n.id AND o.status <> 'cancelled' AND o.type_id = n.type_id AND n.type_id IS NOT NULL AND ((n.machine_id IS NOT NULL AND o.machine_id = n.machine_id) OR (n.product IS NOT NULL AND n.product <> '' AND o.product = n.product)) AND o.reported_at BETWEEN date(n.reported_at, '-90 days') AND date(n.reported_at, '+90 days')) AS similar_n,
      (SELECT count(*) FROM tasks k WHERE k.source_kind = 'ncr' AND k.source_id = n.id) AS tasks_total,
      (SELECT count(*) FROM tasks k WHERE k.source_kind = 'ncr' AND k.source_id = n.id AND k.status IN ('open', 'in_progress', 'waiting', 'done')) AS tasks_open
    FROM ncrs n LEFT JOIN ncr_types t ON t.id = n.type_id LEFT JOIN priorities p ON p.id = n.severity_id LEFT JOIN machines m ON m.id = n.machine_id LEFT JOIN users u ON u.id = n.reported_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${SORTS[f.sort] || SORTS.new} LIMIT ${Math.min(Number(f.limit) || 300, 5000)}`, ...p);
  const t = today(); const ed = rules(db).evalDays;
  for (const r of rows) r.eval_overdue = r.status === 'reported' && Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${r.reported_at}T00:00:00Z`)) / 86400000) > ed;
  for (const r of rows) r.age_days = Math.max(0, Math.round((Date.parse(`${(r.closed_at || t).slice(0, 10)}T00:00:00Z`) - Date.parse(`${r.reported_at}T00:00:00Z`)) / 86400000));
  return rows;
}

function counts(db) {
  const r = db.get(`SELECT count(*) FILTER (WHERE status = 'reported') AS reported, count(*) FILTER (WHERE status = 'evaluation') AS evaluation, count(*) FILTER (WHERE status = 'action') AS action,
      count(*) FILTER (WHERE status = 'closed' AND closed_at >= ?) AS closed_30 FROM ncrs`, tasks.addDays(today(), -30));
  const overdue = db.value("SELECT count(*) FROM ncrs WHERE status = 'reported' AND reported_at < ?", tasks.addDays(today(), -rules(db).evalDays));
  return { reported: r.reported, evaluation: r.evaluation, action: r.action, closed_30: r.closed_30, open: r.reported + r.evaluation + r.action, eval_overdue: overdue };
}

/**
 * The top of the register for a meeting: how many records per type / machine / product in the last `days` days (cancelled ones left out),
 * how many of them are still open, and when the last one was reported. @returns rows sorted by count
 */
function top(db, { days, by }) {
  const since = tasks.addDays(today(), -(Number(days) || 30));
  const key = by === 'machine' ? { col: 'n.machine_id', name: 'm.name', join: 'LEFT JOIN machines m ON m.id = n.machine_id' }
    : by === 'product' ? { col: "COALESCE(n.product, '')", name: "COALESCE(NULLIF(n.product, ''), '')", join: '' }
      : { col: 'n.type_id', name: 't.name', join: 'LEFT JOIN ncr_types t ON t.id = n.type_id' };
  const extra = by === 'type' || !by ? ', t.name_en AS name_en' : '';
  const rows = db.all(`SELECT ${key.col} AS ref, ${key.name} AS name${extra}, count(*) AS cnt, count(*) FILTER (WHERE n.status IN ('reported', 'evaluation', 'action')) AS open_n, max(n.reported_at) AS last_at
    FROM ncrs n ${key.join} WHERE n.status <> 'cancelled' AND n.reported_at >= ? GROUP BY ${key.col} ORDER BY cnt DESC, last_at DESC LIMIT 50`, since);
  const total = rows.reduce((s, r) => s + r.cnt, 0);
  for (const r of rows) r.share = total ? Math.round((r.cnt / total) * 100) : 0;
  return { rows, total, since };
}

/** What a new record can be pre-filled with from a measurement (record number): machine and product. */
function fromMeasurement(db, recordNo) {
  return db.get(`SELECT m.record_no, m.machine_id, c.label AS product FROM measurements m JOIN constructions c ON c.id = m.construction_id WHERE m.record_no = ? AND m.is_current = 1`, Number(recordNo) || 0) || null;
}

module.exports = { STATUSES, OPEN, FINISHED, SOURCES, SORT_KEYS, today, canView, canReport, canLead, create, update, setStatus, comment, addTask, detail, get, list, counts, top, fromMeasurement, leadUsers, verify, similar, rules };
