'use strict';
// Meetings of the Maintenance, Technical and Quality teams (and combined ones): recurring series that make dated meetings on their own,
// one-off meetings, invitees with attendance, agenda, minutes, and decisions that become tasks. Nothing is deleted: a meeting is
// cancelled (with a reason), a series is deactivated. Invitees with a login are told when and who (in-app notifications).
const audit = require('./audit');
const custom = require('./custom');
const notifications = require('./notifications');
const tasks = require('./tasks');
const access = require('./access');
const { nowIso, isRealDate } = require('../lib/time');

const TEAMS = tasks.TEAMS;
const STATUSES = ['planned', 'held', 'cancelled'];
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HORIZON_DAYS = 14;                       // how far ahead a series makes its meetings

const today = () => nowIso().slice(0, 10);
const nowTime = () => nowIso().slice(11, 16);
const addDays = tasks.addDays;
/** ISO weekday of a yyyy-mm-dd date: 1 = Monday .. 7 = Sunday. */
const isoWeekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7;
const mondayOf = (iso) => addDays(iso, 1 - isoWeekday(iso));
const weeksBetween = (a, b) => Math.round((Date.parse(`${mondayOf(b)}T00:00:00Z`) - Date.parse(`${mondayOf(a)}T00:00:00Z`)) / (7 * 86400000));

const canView = (db, user, enabled) => access.can(db, user, 'meetings', 'view', enabled);
const canCreate = (db, user, enabled) => access.can(db, user, 'meetings', 'enter', enabled);   // one-off meetings, agenda, minutes, decisions
const canLead = (db, user, enabled) => access.can(db, user, 'meetings', 'lead', enabled);      // series, cancelling, reopening

const teamsOf = (s) => String(s || '').split(',').filter(Boolean);
const daysOf = (s) => String(s || '').split(',').map(Number).filter((n) => n >= 1 && n <= 7);

/** Does this series meet on that date? (days of the week, every N weeks counted from the week it starts, inside its period) */
function occursOn(series, iso) {
  if (!series.active) return false;
  const from = series.starts_on || (series.created_at || '').slice(0, 10) || iso;
  if (iso < from) return false;
  if (series.ends_on && iso > series.ends_on) return false;
  if (!daysOf(series.days).includes(isoWeekday(iso))) return false;
  return weeksBetween(from, iso) % (series.interval_weeks || 1) === 0;
}

// ---------- validation ----------

function cleanTeams(list) {
  const arr = [...new Set((Array.isArray(list) ? list : teamsOf(list)).filter((t) => TEAMS.includes(t)))];
  return TEAMS.filter((t) => arr.includes(t));   // stable order
}

function validateWhen(errors, v, data) {
  v.start_time = String(data.start_time || '').trim();
  if (!RE_TIME.test(v.start_time)) errors.start_time = 'invalid';
  v.duration_min = Number(data.duration_min || 30);
  if (!Number.isInteger(v.duration_min) || v.duration_min < 5 || v.duration_min > 480) errors.duration_min = 'invalid';
  v.location = String(data.location || '').trim() || null;
  if (v.location && v.location.length > 120) errors.location = 'too_long';
}

function validateMeeting(db, data) {
  const errors = {}; const v = {};
  v.title = String(data.title || '').trim();
  if (!v.title) errors.title = 'required'; else if (v.title.length > 160) errors.title = 'too_long';
  v.teams = cleanTeams(data.teams);
  if (!v.teams.length) errors.teams = 'required';
  v.meeting_date = String(data.meeting_date || '').trim();
  if (!isRealDate(v.meeting_date)) errors.meeting_date = 'invalid';
  validateWhen(errors, v, data);
  v.agenda = String(data.agenda || '').trim() || null;
  if (v.agenda && v.agenda.length > 4000) errors.agenda = 'too_long';
  v.attendees = [...new Set((data.attendees || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (v.attendees.some((id) => !db.get('SELECT 1 FROM people WHERE id = ?', id))) errors.attendees = 'invalid';
  return { errors, v };
}

function validateSeries(db, data) {
  const errors = {}; const v = {};
  v.title = String(data.title || '').trim();
  if (!v.title) errors.title = 'required'; else if (v.title.length > 160) errors.title = 'too_long';
  v.teams = cleanTeams(data.teams);
  if (!v.teams.length) errors.teams = 'required';
  v.days = [...new Set((data.days || []).map(Number).filter((n) => n >= 1 && n <= 7))].sort();
  if (!v.days.length) errors.days = 'required';
  v.interval_weeks = Number(data.interval_weeks || 1);
  if (!Number.isInteger(v.interval_weeks) || v.interval_weeks < 1 || v.interval_weeks > 12) errors.interval_weeks = 'invalid';
  validateWhen(errors, v, data);
  for (const k of ['starts_on', 'ends_on']) {
    v[k] = String(data[k] || '').trim() || null;
    if (v[k] && !isRealDate(v[k])) errors[k] = 'invalid';
  }
  if (v.starts_on && v.ends_on && v.ends_on < v.starts_on && !errors.ends_on) errors.ends_on = 'before_start';
  v.people = [...new Set((data.people || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (v.people.some((id) => !db.get('SELECT 1 FROM people WHERE id = ?', id))) errors.people = 'invalid';
  if (data.custom) Object.assign(errors, data.custom.errors);   // default custom values: parsed by the route with seriesFields()
  return { errors, v };
}

// ---------- default custom values of a series (the meetings it makes start with them) ----------

/** The meeting fields a series may give a default to: no calculated ones (worked out per meeting), none required (a default may stay empty). */
const seriesFields = (db) => custom.defs(db, 'meeting').filter((f) => !custom.isCalc(f)).map((f) => ({ ...f, required: 0 }));
/** {fieldId: value} of a series ('' = no default). */
function seriesDefaults(db, seriesId) {
  const out = {};
  for (const r of db.all('SELECT field_id, value FROM meeting_series_custom WHERE series_id = ?', seriesId)) out[r.field_id] = r.value;
  return out;
}
/** Store the defaults (only what changed); @returns {fieldId: [from, to]} of the changes. Call inside the series' transaction. */
function saveSeriesDefaults(db, seriesId, values) {
  const before = seriesDefaults(db, seriesId); const changed = {};
  for (const [fid, now] of Object.entries(values || {})) {
    const was = before[fid] === undefined ? '' : before[fid];
    if (now === was) continue;
    db.run(`INSERT INTO meeting_series_custom(series_id, field_id, value) VALUES (?,?,?)
      ON CONFLICT(series_id, field_id) DO UPDATE SET value = excluded.value`, seriesId, Number(fid), now);
    changed[fid] = [was, now];
  }
  return changed;
}
/** Give a meeting the defaults of its series (a newly made meeting: every non-empty default). */
function applySeriesDefaults(db, meetingId, defaults) {
  const values = Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== ''));
  if (Object.keys(values).length) custom.save(db, 'meeting', meetingId, custom.defs(db, 'meeting'), values);
}

// ---------- notifications ----------

/** Users with a login among these people. */
const usersOf = (db, personIds) => notifications.usersOfPeople(db, personIds);
const attendeeIds = (db, meetingId) => db.all('SELECT person_id FROM meeting_attendees WHERE meeting_id = ?', meetingId).map((r) => r.person_id);

function tell(db, meeting, kind, exceptUserId, extra) {
  notifications.notify(db, usersOf(db, attendeeIds(db, meeting.id)).filter((u) => u !== exceptUserId), kind,
    { title: meeting.title, date: meeting.meeting_date, time: meeting.start_time, where: meeting.location || '', ...extra }, `/sedinte/${meeting.id}`);
}

// ---------- series ----------

/** The people a series invites: the ones named, else everybody active in its teams. */
function seriesInvitees(db, series) {
  const named = db.all('SELECT person_id FROM meeting_series_people WHERE series_id = ?', series.id).map((r) => r.person_id);
  if (named.length) return named;
  const teams = teamsOf(series.teams);
  return db.all(`SELECT id FROM people WHERE active = 1 AND team IN (${teams.map(() => '?').join(',')})`, ...teams).map((r) => r.id);
}

function createSeries(db, user, data) {
  const { errors, v } = validateSeries(db, data);
  if (Object.keys(errors).length) return { ok: false, errors };
  return db.tx(() => {
    const id = db.run('INSERT INTO meeting_series(title, teams, days, interval_weeks, start_time, duration_min, location, starts_on, ends_on, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)',
      v.title, v.teams.join(','), v.days.join(','), v.interval_weeks, v.start_time, v.duration_min, v.location, v.starts_on, v.ends_on, user.id, nowIso()).id;
    for (const p of v.people) db.run('INSERT INTO meeting_series_people(series_id, person_id) VALUES (?,?)', id, p);
    const cc = data.custom ? saveSeriesDefaults(db, id, data.custom.values) : {};
    audit.log(db, user.id, 'meeting_series_save', 'meeting_series', id, { title: v.title, created: true, defaults: Object.keys(cc).length ? cc : undefined });
    invalidate();
    notifications.notify(db, usersOf(db, seriesInvitees(db, { id, teams: v.teams.join(',') })).filter((u) => u !== user.id), 'meeting_series', { title: v.title, time: v.start_time, days: v.days.join(','), every: v.interval_weeks }, '/sedinte');
    return { ok: true, id };
  });
}

function updateSeries(db, user, id, data) {
  const s = db.get('SELECT * FROM meeting_series WHERE id = ?', id);
  if (!s) return { ok: false, code: 'not_found' };
  const { errors, v } = validateSeries(db, data);
  if (Object.keys(errors).length) return { ok: false, errors };
  db.tx(() => {
    db.run('UPDATE meeting_series SET title=?, teams=?, days=?, interval_weeks=?, start_time=?, duration_min=?, location=?, starts_on=?, ends_on=? WHERE id = ?',
      v.title, v.teams.join(','), v.days.join(','), v.interval_weeks, v.start_time, v.duration_min, v.location, v.starts_on, v.ends_on, id);
    db.run('DELETE FROM meeting_series_people WHERE series_id = ?', id);
    for (const p of v.people) db.run('INSERT INTO meeting_series_people(series_id, person_id) VALUES (?,?)', id, p);
    // meetings not held yet follow the new time and place (the day stays as it was made, or as somebody moved it)
    db.run("UPDATE meetings SET start_time = ?, duration_min = ?, location = ?, teams = ?, title = ?, updated_at = ? WHERE series_id = ? AND status = 'planned' AND meeting_date >= ?",
      v.start_time, v.duration_min, v.location, v.teams.join(','), v.title, nowIso(), id, today());
    // people newly invited to the series are added to the coming meetings (nobody is taken off: guests may have been added by hand)
    const invitees = seriesInvitees(db, { id, teams: v.teams.join(',') });
    for (const m of db.all("SELECT id FROM meetings WHERE series_id = ? AND status = 'planned' AND meeting_date >= ?", id, today())) for (const p of invitees) db.run('INSERT OR IGNORE INTO meeting_attendees(meeting_id, person_id) VALUES (?,?)', m.id, p);
    // a changed default reaches the coming meetings too, but only where the meeting still holds the old default (a value typed by hand stays)
    const cc = data.custom ? saveSeriesDefaults(db, id, data.custom.values) : {};
    if (Object.keys(cc).length) {
      const fields = custom.defs(db, 'meeting');
      for (const m of db.all("SELECT id FROM meetings WHERE series_id = ? AND status = 'planned' AND meeting_date >= ?", id, today())) {
        const have = custom.valuesOf(db, 'meeting', m.id); const values = {};
        for (const [fid, [was, now]] of Object.entries(cc)) if ((have[fid] === undefined ? '' : have[fid]) === was) values[fid] = now;
        if (Object.keys(values).length) custom.save(db, 'meeting', m.id, fields, values);
      }
    }
    audit.log(db, user.id, 'meeting_series_save', 'meeting_series', id, { title: v.title, defaults: Object.keys(cc).length ? cc : undefined });
    invalidate();
    if (s.start_time !== v.start_time || s.days !== v.days.join(',') || s.interval_weeks !== v.interval_weeks) {
      notifications.notify(db, usersOf(db, seriesInvitees(db, { id, teams: v.teams.join(',') })).filter((u) => u !== user.id), 'meeting_series', { title: v.title, time: v.start_time, days: v.days.join(','), every: v.interval_weeks }, '/sedinte');
    }
  });
  return { ok: true };
}

function setSeriesActive(db, user, id, active) {
  const s = db.get('SELECT * FROM meeting_series WHERE id = ?', id);
  if (!s) return { ok: false, code: 'not_found' };
  db.run('UPDATE meeting_series SET active = ? WHERE id = ?', active ? 1 : 0, id);
  invalidate();
  audit.log(db, user.id, 'meeting_series_save', 'meeting_series', id, { title: s.title, active: !!active });
  return { ok: true };
}

const seriesList = (db) => db.all('SELECT * FROM meeting_series ORDER BY active DESC, title').map((s) => ({ ...s, people: db.all('SELECT person_id FROM meeting_series_people WHERE series_id = ?', s.id).map((r) => r.person_id) }));
const seriesGet = (db, id) => { const s = db.get('SELECT * FROM meeting_series WHERE id = ?', id); return s ? { ...s, people: db.all('SELECT person_id FROM meeting_series_people WHERE series_id = ?', id).map((r) => r.person_id) } : null; };

/**
 * Makes the meetings of every active series for today and the next days (no timer: called when someone opens the home page or the
 * meetings). Safe to call any number of times: a day a series already made is never made again, even if the meeting was moved.
 */
let ensuredDay = '';
/** Forget that today's meetings were made (a series changed, so they must be looked at again). */
const invalidate = () => { ensuredDay = ''; };
function ensure(db, from, days) {
  const start = from || today();
  if (!from && !days) { if (ensuredDay === start) return 0; ensuredDay = start; }   // the plain daily call does its work once a day
  let made = 0;
  for (const s of db.all('SELECT * FROM meeting_series WHERE active = 1')) {
    for (let i = 0; i < (days || HORIZON_DAYS); i++) {
      const d = addDays(start, i);
      if (!occursOn(s, d)) continue;
      if (db.get('SELECT 1 FROM meetings WHERE series_id = ? AND slot_date = ?', s.id, d)) continue;
      db.tx(() => {
        const now = nowIso();
        const id = db.run('INSERT INTO meetings(series_id, slot_date, title, teams, meeting_date, start_time, duration_min, location, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          s.id, d, s.title, s.teams, d, s.start_time, s.duration_min, s.location, s.created_by, now, now).id;
        for (const p of seriesInvitees(db, s)) db.run('INSERT OR IGNORE INTO meeting_attendees(meeting_id, person_id) VALUES (?,?)', id, p);
        applySeriesDefaults(db, id, seriesDefaults(db, s.id));
        made++;
      });
    }
  }
  return made;
}

let remindedDay = '';
/** The day's reminders (once a day, on the first request that day): everybody invited to a meeting today is told the time. */
function remindToday(db, day) {
  const d = day || today();
  if (remindedDay === d) return 0;
  remindedDay = d;
  let n = 0;
  for (const m of db.all("SELECT * FROM meetings WHERE meeting_date = ? AND status = 'planned' AND (reminded_on IS NULL OR reminded_on <> ?)", d, d)) {
    n += notifications.notify(db, usersOf(db, attendeeIds(db, m.id)), 'meeting_today', { title: m.title, time: m.start_time, where: m.location || '' }, `/sedinte/${m.id}`, `meeting_today:${m.id}:${d}`);
    db.run('UPDATE meetings SET reminded_on = ? WHERE id = ?', d, m.id);
  }
  return n;
}
/** For tests: forget that today's reminders were sent. */
const resetReminders = () => { remindedDay = ''; };

// ---------- meetings ----------

const get = (db, id) => db.get('SELECT * FROM meetings WHERE id = ?', id);

function createMeeting(db, user, data) {
  const { errors, v } = validateMeeting(db, data);
  if (data.custom) Object.assign(errors, data.custom.errors);   // custom fields (domain/custom.js): parsed by the route
  if (Object.keys(errors).length) return { ok: false, errors };
  return db.tx(() => {
    const now = nowIso();
    const id = db.run('INSERT INTO meetings(title, teams, meeting_date, start_time, duration_min, location, agenda, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      v.title, v.teams.join(','), v.meeting_date, v.start_time, v.duration_min, v.location, v.agenda, user.id, now, now).id;
    for (const p of v.attendees) db.run('INSERT INTO meeting_attendees(meeting_id, person_id) VALUES (?,?)', id, p);
    if (data.custom) custom.save(db, 'meeting', id, custom.defs(db, 'meeting'), data.custom.values);
    audit.log(db, user.id, 'meeting_create', 'meetings', id, { title: v.title, date: v.meeting_date });
    tell(db, get(db, id), 'meeting_invited', user.id, { by: user.full_name });
    return { ok: true, id };
  });
}

/** Change a meeting (title, time, place, teams, agenda, invitees). A change of time or place tells the invitees. */
function updateMeeting(db, user, id, data) {
  const m = get(db, id);
  if (!m) return { ok: false, code: 'not_found' };
  const { errors, v } = validateMeeting(db, data);
  if (data.custom) Object.assign(errors, data.custom.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  db.tx(() => {
    const before = attendeeIds(db, id);
    db.run('UPDATE meetings SET title=?, teams=?, meeting_date=?, start_time=?, duration_min=?, location=?, agenda=?, updated_at=? WHERE id = ?',
      v.title, v.teams.join(','), v.meeting_date, v.start_time, v.duration_min, v.location, v.agenda, nowIso(), id);
    if (data.attendees !== undefined) {
      const keep = new Set(v.attendees);
      for (const p of before) if (!keep.has(p)) db.run('DELETE FROM meeting_attendees WHERE meeting_id = ? AND person_id = ?', id, p);
      for (const p of v.attendees) db.run('INSERT OR IGNORE INTO meeting_attendees(meeting_id, person_id) VALUES (?,?)', id, p);
    }
    const cc = data.custom ? custom.save(db, 'meeting', id, custom.defs(db, 'meeting'), data.custom.values) : [];
    audit.log(db, user.id, 'meeting_edit', 'meetings', id, cc.length ? { title: v.title, custom: cc } : { title: v.title });
    const moved = m.meeting_date !== v.meeting_date || m.start_time !== v.start_time || (m.location || null) !== v.location;
    if (m.status === 'planned' && moved) tell(db, get(db, id), 'meeting_updated', user.id, { by: user.full_name });
    if (data.attendees !== undefined && m.status === 'planned') {
      const added = v.attendees.filter((p) => !before.includes(p));
      notifications.notify(db, usersOf(db, added).filter((u) => u !== user.id), 'meeting_invited', { title: v.title, date: v.meeting_date, time: v.start_time, where: v.location || '', by: user.full_name }, `/sedinte/${id}`);
    }
  });
  return { ok: true };
}

/** Agenda and minutes only (what the person running the meeting types during and after it). */
function saveNotes(db, user, id, data) {
  const m = get(db, id);
  if (!m) return { ok: false, code: 'not_found' };
  const agenda = String(data.agenda ?? m.agenda ?? '').trim().slice(0, 4000) || null;
  const minutes = String(data.minutes ?? m.minutes ?? '').trim().slice(0, 8000) || null;
  db.run('UPDATE meetings SET agenda = ?, minutes = ?, updated_at = ? WHERE id = ?', agenda, minutes, nowIso(), id);
  audit.log(db, user.id, 'meeting_edit', 'meetings', id, { notes: true });
  return { ok: true };
}

/** Who was there: `presentIds` are the invitees ticked present. People who came without an invitation can be added with `extraIds`. */
function setAttendance(db, user, id, presentIds, extraIds) {
  const m = get(db, id);
  if (!m) return { ok: false, code: 'not_found' };
  const present = new Set((presentIds || []).map(Number));
  db.tx(() => {
    for (const p of (extraIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && db.get('SELECT 1 FROM people WHERE id = ?', n))) db.run('INSERT OR IGNORE INTO meeting_attendees(meeting_id, person_id) VALUES (?,?)', id, p);
    for (const p of attendeeIds(db, id)) db.run('UPDATE meeting_attendees SET present = ? WHERE meeting_id = ? AND person_id = ?', present.has(p) || (extraIds || []).map(Number).includes(p) ? 1 : 0, id, p);
    db.run('UPDATE meetings SET updated_at = ? WHERE id = ?', nowIso(), id);
    audit.log(db, user.id, 'meeting_edit', 'meetings', id, { attendance: present.size });
  });
  return { ok: true };
}

function setStatus(db, user, id, to, reason) {
  const m = get(db, id);
  if (!m) return { ok: false, code: 'not_found' };
  if (!STATUSES.includes(to) || to === m.status) return { ok: false, code: 'invalid' };
  const why = String(reason || '').trim().slice(0, 500) || null;
  if (to === 'cancelled' && !why) return { ok: false, code: 'reason_required' };
  db.tx(() => {
    db.run('UPDATE meetings SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ?', to, to === 'cancelled' ? why : null, nowIso(), id);
    audit.log(db, user.id, 'meeting_status', 'meetings', id, { title: m.title, from: m.status, to });
    if (to === 'cancelled') tell(db, get(db, id), 'meeting_cancelled', user.id, { by: user.full_name, reason: why });
  });
  return { ok: true };
}

/**
 * A decision of the meeting, optionally becoming a task of one team (owner: decisions create tasks). Whoever may add decisions to a meeting
 * may assign them, because handing work on is the point of the meeting.
 */
function addDecision(db, user, id, data) {
  const m = get(db, id);
  if (!m) return { ok: false, code: 'not_found' };
  const text = String(data.text || '').trim();
  if (!text) return { ok: false, errors: { text: 'required' } };
  if (text.length > 2000) return { ok: false, errors: { text: 'too_long' } };
  const team = TEAMS.includes(data.team) ? data.team : null;
  return db.tx(() => {
    let taskId = null;
    if (team) {
      const t = tasks.create(db, user, { team, title: text.split(/\r?\n/)[0].slice(0, 200), description: `${m.title} — ${m.meeting_date}${text.length > 200 || text.includes('\n') ? `\n\n${text}` : ''}`, priority_id: data.priority_id, due_date: data.due_date, assignees: data.assignees || [], source_kind: 'meeting', source_id: m.id });
      if (!t.ok) return { ok: false, errors: t.errors };
      taskId = t.id;
    }
    const did = db.run('INSERT INTO meeting_decisions(meeting_id, text, task_id, created_by, created_at) VALUES (?,?,?,?,?)', id, text, taskId, user.id, nowIso()).id;
    db.run('UPDATE meetings SET updated_at = ? WHERE id = ?', nowIso(), id);
    audit.log(db, user.id, 'meeting_decision', 'meetings', id, { decision: did, task_id: taskId });
    return { ok: true, id: did, task_id: taskId };
  });
}

/** One meeting with invitees, decisions (with their tasks) and its series. */
function detail(db, id) {
  const m = get(db, id);
  if (!m) return null;
  m.teamList = teamsOf(m.teams);
  m.attendees = db.all('SELECT p.id, p.name, p.team, a.present FROM meeting_attendees a JOIN people p ON p.id = a.person_id WHERE a.meeting_id = ? ORDER BY p.name', id);
  m.decisions = db.all(`SELECT d.*, t.no AS task_no, t.status AS task_status, t.team AS task_team, t.due_date AS task_due, u.full_name AS by_name
    FROM meeting_decisions d LEFT JOIN tasks t ON t.id = d.task_id LEFT JOIN users u ON u.id = d.created_by WHERE d.meeting_id = ? ORDER BY d.id`, id);
  for (const d of m.decisions) d.assignees = d.task_id ? db.all('SELECT p.name FROM task_assignees a JOIN people p ON p.id = a.person_id WHERE a.task_id = ? ORDER BY p.name', d.task_id).map((r) => r.name) : [];
  m.series = m.series_id ? db.get('SELECT id, title FROM meeting_series WHERE id = ?', m.series_id) : null;
  m.created_by_name = m.created_by ? (db.get('SELECT full_name FROM users WHERE id = ?', m.created_by) || {}).full_name : null;
  return m;
}

/**
 * The list. view: 'upcoming' (today onward, not cancelled), 'past' (before today or held, newest first), 'all'.
 * Filters: team, mine (person ids), q.
 */
function list(db, f) {
  const where = []; const p = [];
  const t = today();
  if (f.view === 'past') { where.push("(meeting_date < ? OR status = 'held')"); p.push(t); }
  else if (f.view !== 'all') { where.push("meeting_date >= ? AND status = 'planned'"); p.push(t); }
  if (f.team && TEAMS.includes(f.team)) { where.push("(',' || teams || ',') LIKE ?"); p.push(`%,${f.team},%`); }
  if (f.persons && f.persons.length) { where.push(`id IN (SELECT meeting_id FROM meeting_attendees WHERE person_id IN (${f.persons.map(() => '?').join(',')}))`); p.push(...f.persons); }
  if (f.custom && f.custom.length) custom.where(f.custom, 'meeting', where, p);
  if (f.q) { where.push("(title LIKE ? ESCAPE '\\' OR agenda LIKE ? ESCAPE '\\' OR minutes LIKE ? ESCAPE '\\')"); const like = '%' + f.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'; p.push(like, like, like); }
  const order = f.view === 'past' ? 'meeting_date DESC, start_time DESC' : 'meeting_date, start_time, id';
  const rows = db.all(`SELECT m.*, (SELECT count(*) FROM meeting_attendees a WHERE a.meeting_id = m.id) AS invited, (SELECT count(*) FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.present = 1) AS present_n,
      (SELECT count(*) FROM meeting_decisions d WHERE d.meeting_id = m.id) AS decisions FROM meetings m ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${Math.min(Number(f.limit) || 200, 1000)}`, ...p);
  for (const r of rows) r.teamList = teamsOf(r.teams);
  return rows;
}

/** Counts for the tiles of the list page. */
function counts(db) {
  const t = today();
  return {
    today: db.value("SELECT count(*) FROM meetings WHERE meeting_date = ? AND status = 'planned'", t),
    week: db.value("SELECT count(*) FROM meetings WHERE meeting_date >= ? AND meeting_date <= ? AND status = 'planned'", t, addDays(t, 6)),
    open_minutes: db.value("SELECT count(*) FROM meetings WHERE status = 'planned' AND meeting_date < ?", t),
  };
}

/** A few meetings for the home page: today first, then the next days. */
function next(db, limit) {
  const t = today();
  return db.all("SELECT * FROM meetings WHERE status = 'planned' AND meeting_date >= ? AND meeting_date <= ? ORDER BY meeting_date, start_time LIMIT ?", t, addDays(t, 7), limit || 5).map((m) => ({ ...m, teamList: teamsOf(m.teams), isToday: m.meeting_date === t }));
}

module.exports = {
  TEAMS, STATUSES, HORIZON_DAYS, today, nowTime, isoWeekday, occursOn, teamsOf, daysOf, cleanTeams,
  canView, canCreate, canLead, createMeeting, updateMeeting, saveNotes, setAttendance, setStatus, addDecision, detail, get, list, counts, next,
  createSeries, updateSeries, setSeriesActive, seriesList, seriesGet, seriesInvitees, seriesFields, seriesDefaults, ensure, remindToday, resetReminders, invalidate,
};
