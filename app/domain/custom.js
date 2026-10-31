'use strict';
// Custom fields and custom lists (owner 2026-10-31, "A and B first, admins only, show them in exports and filters").
// An administrator adds fields (text, long text, number, date, yes/no, pick-list) to tasks, non-conformities and meetings, and makes the
// pick-lists those fields use. Nothing is deleted: a field or a list item is hidden (active = 0) and the values already entered stay.
// Values live in custom_values (one row per record and field, '' = empty). The type of a field never changes after it is made.
const audit = require('./audit');
const calc = require('./calc');
const i18n = require('../i18n');
const { nowIso, displayDate, isRealDate } = require('../lib/time');

const KINDS = ['task', 'ncr', 'meeting'];
const TYPES = ['text', 'longtext', 'number', 'date', 'yesno', 'list'];
const TEAMS = ['maintenance', 'technical', 'quality'];
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = isRealDate;
const MAX_FIELDS_PER_KIND = 40;
const MAX_ITEMS = 500;
const lang = () => i18n.current();

const nameOf = (row) => (lang() === 'en' && row.label_en ? row.label_en : row.label);
const listNameOf = (row) => (lang() === 'en' && row.name_en ? row.name_en : row.name);
const fieldLabel = (f) => nameOf(f) + (f.type === 'number' && f.unit ? ` [${f.unit}]` : '');

// ---------------------------------------------------------------- reading definitions
/** The lists with their items (hidden ones too, marked by `active`). */
function lists(db) {
  const rows = db.all('SELECT * FROM custom_lists ORDER BY name');
  const items = db.all('SELECT * FROM custom_list_items ORDER BY sort, id');
  for (const l of rows) l.items = items.filter((i) => i.list_id === l.id);
  return rows;
}

/** Fields of one kind (tasks: of one team), in their order; hidden ones only when `all`. List fields carry their items. */
function defs(db, kind, team, opts) {
  const all = opts && opts.all ? 1 : 0;
  const rows = db.all(`SELECT f.*, l.name AS list_name FROM custom_fields f LEFT JOIN custom_lists l ON l.id = f.list_id
    WHERE f.kind = ? AND (? = 1 OR f.active = 1) AND (? IS NULL OR f.team IS NULL OR f.team = ?) ORDER BY f.sort, f.id`, kind, all, team || null, team || null);
  const listIds = [...new Set(rows.filter((r) => r.type === 'list').map((r) => r.list_id))];
  if (listIds.length) {
    const items = db.all(`SELECT * FROM custom_list_items WHERE list_id IN (${listIds.map(() => '?').join(',')}) ORDER BY sort, id`, ...listIds);
    for (const r of rows) if (r.type === 'list') r.items = items.filter((i) => i.list_id === r.list_id);
  }
  return rows;
}

/** Fields to show on a page that already holds records: the active ones, and hidden ones that still carry values. */
function shown(db, kind, team) {
  return defs(db, kind, team, { all: true }).filter((f) => f.active || valueCount(db, f.id) > 0);
}

const field = (db, id) => db.get('SELECT * FROM custom_fields WHERE id = ?', id);
const valueCount = (db, id) => db.value('SELECT count(*) FROM custom_values WHERE field_id = ? AND value <> ?', id, '');

// ---------------------------------------------------------------- values of records
function valuesOf(db, kind, recordId) {
  const out = {};
  for (const r of db.all('SELECT field_id, value FROM custom_values WHERE kind = ? AND record_id = ?', kind, recordId)) out[r.field_id] = r.value;
  return out;
}

/** @returns Map recordId -> {fieldId: value} for many records at once. */
function valuesOfMany(db, kind, ids) {
  const map = new Map(ids.map((i) => [i, {}]));
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    for (const r of db.all(`SELECT record_id, field_id, value FROM custom_values WHERE kind = ? AND record_id IN (${part.map(() => '?').join(',')})`, kind, ...part)) map.get(r.record_id)[r.field_id] = r.value;
  }
  return map;
}

/** A value as the person reads it (plain text; empty when nothing was entered). */
function display(f, raw) {
  const v = raw === undefined || raw === null ? '' : String(raw);
  if (v === '') return '';
  if (f.type === 'number') return calc.dec(v) + (f.unit ? ` ${f.unit}` : '');
  if (f.type === 'date') return displayDate(v);
  if (f.type === 'yesno') return v === '1' ? i18n.T.common.yes : i18n.T.common.no;
  if (f.type === 'list') { const it = (f.items || []).find((i) => String(i.id) === v); return it ? (lang() === 'en' && it.label_en ? it.label_en : it.label) : ''; }
  return v;
}

// ---------------------------------------------------------------- reading a form
/**
 * @param fields  the definitions that apply to the record
 * @param get     (name) => string, the form
 * @param current the values already saved for the record (a hidden list item that was already chosen stays allowed)
 * @returns {{values, errors}} values: {fieldId: string ('' = empty)}, errors: {cf_<id>: code} (named like the inputs)
 */
function parse(fields, get, current) {
  const values = {}; const errors = {};
  for (const f of fields) {
    const key = `cf_${f.id}`;
    const raw = String(get(key) ?? '').trim();
    let v = raw;
    if (raw === '') v = '';
    else if (f.type === 'text') { if (raw.length > 200) errors[key] = 'too_long'; }
    else if (f.type === 'longtext') { if (raw.length > 4000) errors[key] = 'too_long'; }
    else if (f.type === 'number') {
      const n = calc.parseDecimal(raw);
      if (n === null || Math.abs(n) > 1e12) errors[key] = 'invalid'; else v = String(n);
    } else if (f.type === 'date') { if (!realDate(raw)) errors[key] = 'invalid'; }
    else if (f.type === 'yesno') { if (raw !== '1' && raw !== '0') errors[key] = 'invalid'; }
    else if (f.type === 'list') {
      const it = (f.items || []).find((i) => String(i.id) === raw);
      if (!it || (!it.active && !(current && String(current[f.id]) === raw))) errors[key] = 'invalid';
    }
    if (v === '' && f.required && !errors[key]) errors[key] = 'required';
    values[f.id] = v;
  }
  return { values, errors };
}

/** Plain values (a copy of a record, a programmatic call) through the same checks. */
const parseObject = (fields, obj, current) => parse(fields, (k) => (obj && obj[k] !== undefined ? obj[k] : ''), current);

/**
 * Write the values of a record (only what changed). @returns [{field_id, label, from, to}] with readable from / to, for the history.
 * Call inside the same transaction as the record's own save.
 */
function save(db, kind, recordId, fields, values) {
  const before = valuesOf(db, kind, recordId);
  const changes = [];
  for (const f of fields) {
    if (!(f.id in values)) continue;
    const now = values[f.id];
    const was = before[f.id] === undefined ? '' : before[f.id];
    if (now === was) continue;
    db.run(`INSERT INTO custom_values(kind, record_id, field_id, value) VALUES (?,?,?,?)
      ON CONFLICT(kind, record_id, field_id) DO UPDATE SET value = excluded.value`, kind, recordId, f.id, now);
    changes.push({ field_id: f.id, label: fieldLabel(f), from: display(f, was), to: display(f, now) });
  }
  return changes;
}

/** A one-line summary of what changed, for the history line. */
const changeSummary = (changes) => changes.map((c) => c.label).join(', ');

// ---------------------------------------------------------------- filters
const FILTER_COL = { task: 't.id', ncr: 'n.id', meeting: 'm.id' };
const EXISTS = 'EXISTS (SELECT 1 FROM custom_values cv WHERE cv.kind = ? AND cv.record_id = {ID} AND cv.field_id = ? AND cv.value <> \'\' AND {TEST})';

/** The filters in a query string: cf<ID>=value (pick-list, yes/no, text), cf<ID>_a / cf<ID>_b = from / to (number, date). Unknown or empty ones are ignored. */
function filters(fields, query) {
  const out = [];
  for (const f of fields) {
    const one = (query.get(`cf${f.id}`) || '').trim().slice(0, 100);
    const a = (query.get(`cf${f.id}_a`) || '').trim().slice(0, 40);
    const b = (query.get(`cf${f.id}_b`) || '').trim().slice(0, 40);
    if ((f.type === 'list' || f.type === 'yesno') && /^\d+$/.test(one)) out.push({ field: f, op: 'eq', value: one });
    else if ((f.type === 'text' || f.type === 'longtext') && one) out.push({ field: f, op: 'like', value: one });
    else if (f.type === 'number') {
      const lo = calc.parseDecimal(a); const hi = calc.parseDecimal(b);
      if (lo !== null || hi !== null) out.push({ field: f, op: 'num', lo, hi, a, b });
    } else if (f.type === 'date') {
      const lo = realDate(a) ? a : null; const hi = realDate(b) ? b : null;
      if (lo || hi) out.push({ field: f, op: 'date', lo, hi, a: lo || '', b: hi || '' });
    }
  }
  return out;
}

/** The same filters as query-string pairs (to keep them across tabs, print and export links). */
function keep(flt) {
  const q = {};
  for (const x of flt) {
    const id = x.field.id;
    if (x.op === 'eq' || x.op === 'like') q[`cf${id}`] = x.value;
    else { if (x.a) q[`cf${id}_a`] = x.a; if (x.b) q[`cf${id}_b`] = x.b; }
  }
  return q;
}

/** Add the SQL for the filters to a query's `where` / `p` lists. `kind` picks the id column of the record's table alias. */
function where(flt, kind, whereList, p) {
  const col = FILTER_COL[kind];
  const one = (test) => EXISTS.replace('{ID}', col).replace('{TEST}', test);
  for (const x of flt) {
    const id = x.field.id;
    if (x.op === 'eq') { whereList.push(one('cv.value = ?')); p.push(kind, id, x.value); }
    else if (x.op === 'like') { whereList.push(one("cv.value LIKE ? ESCAPE '\\'")); p.push(kind, id, '%' + x.value.replace(/[%_\\]/g, (c) => '\\' + c) + '%'); }
    else if (x.op === 'num') {
      const parts = []; const extra = [];
      if (x.lo !== null) { parts.push('CAST(cv.value AS REAL) >= ?'); extra.push(x.lo); }
      if (x.hi !== null) { parts.push('CAST(cv.value AS REAL) <= ?'); extra.push(x.hi); }
      whereList.push(one(parts.join(' AND '))); p.push(kind, id, ...extra);
    } else if (x.op === 'date') {
      const parts = []; const extra = [];
      if (x.lo) { parts.push('cv.value >= ?'); extra.push(x.lo); }
      if (x.hi) { parts.push('cv.value <= ?'); extra.push(x.hi); }
      whereList.push(one(parts.join(' AND '))); p.push(kind, id, ...extra);
    }
  }
}

// ---------------------------------------------------------------- export
/** Extra export columns for a kind: one per custom field (numbers stay numbers in Excel). */
const exportColumns = (fields) => fields.map((f) => ({ key: `cf_${f.id}`, header: fieldLabel(f), type: f.type === 'number' ? 'number' : 'text' }));

/** Add the custom values to export rows: rows[i] belongs to ids[i]. */
function exportRows(db, kind, fields, ids, rows) {
  if (!fields.length) return rows;
  const vals = valuesOfMany(db, kind, ids);
  return rows.map((r, i) => {
    const out = { ...r }; const mine = vals.get(ids[i]) || {};
    for (const f of fields) {
      const raw = mine[f.id];
      out[`cf_${f.id}`] = f.type === 'number' ? (raw === undefined || raw === '' ? '' : Number(raw)) : f.type === 'yesno' || f.type === 'list' || f.type === 'date' ? display(f, raw) : (raw || '');
    }
    return out;
  });
}

// ---------------------------------------------------------------- administration (fields)
const clean = (s, max) => String(s === undefined || s === null ? '' : s).trim().slice(0, max);

function validateField(db, data, existing) {
  const errors = {};
  const v = {
    kind: existing ? existing.kind : data.kind, team: data.team ? String(data.team) : null, label: clean(data.label, 80), label_en: clean(data.label_en, 80) || null,
    type: existing ? existing.type : data.type, list_id: data.list_id ? Number(data.list_id) : null, unit: clean(data.unit, 12) || null,
    required: data.required ? 1 : 0, show_in_list: data.show_in_list ? 1 : 0, sort: Number.isInteger(Number(data.sort)) ? Math.min(Math.max(Number(data.sort), 0), 9999) : 0, active: data.active === undefined ? 1 : (data.active ? 1 : 0),
  };
  if (!KINDS.includes(v.kind)) errors.kind = 'invalid';
  if (!TYPES.includes(v.type)) errors.type = 'invalid';
  if (!v.label) errors.label = 'required';
  if (v.kind !== 'task') v.team = null; else if (v.team && !TEAMS.includes(v.team)) errors.team = 'invalid';
  if (v.type === 'list') {
    if (!v.list_id || !db.get('SELECT 1 FROM custom_lists WHERE id = ?', v.list_id)) errors.list_id = 'required';
    else if (existing && existing.list_id !== v.list_id && valueCount(db, existing.id) > 0) errors.list_id = 'list_in_use';
  } else v.list_id = null;
  if (v.type !== 'number') v.unit = null;
  if (!existing && !errors.kind && db.value('SELECT count(*) FROM custom_fields WHERE kind = ?', v.kind) >= MAX_FIELDS_PER_KIND) errors.label = 'too_many';
  if (existing && existing.kind === 'task' && existing.team !== v.team && valueCount(db, existing.id) > 0 && v.team) errors.team = 'team_in_use';
  return { errors, v };
}

function createField(db, user, data) {
  const { errors, v } = validateField(db, data, null);
  if (Object.keys(errors).length) return { ok: false, errors };
  return db.tx(() => {
    const sort = v.sort || (db.value('SELECT coalesce(max(sort), 0) FROM custom_fields WHERE kind = ?', v.kind) + 10);
    const id = db.run(`INSERT INTO custom_fields(kind, team, label, label_en, type, list_id, unit, required, show_in_list, sort, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
      v.kind, v.team, v.label, v.label_en, v.type, v.list_id, v.unit, v.required, v.show_in_list, sort, nowIso()).id;
    audit.log(db, user.id, 'custom_field_create', 'custom_fields', id, { kind: v.kind, label: v.label, type: v.type });
    return { ok: true, id };
  });
}

function updateField(db, user, id, data) {
  const cur = field(db, id);
  if (!cur) return { ok: false, code: 'not_found' };
  const { errors, v } = validateField(db, data, cur);
  if (Object.keys(errors).length) return { ok: false, errors };
  return db.tx(() => {
    const changes = {};
    for (const k of ['team', 'label', 'label_en', 'list_id', 'unit', 'required', 'show_in_list', 'sort', 'active']) if ((cur[k] ?? null) !== (v[k] ?? null)) changes[k] = { from: cur[k] ?? null, to: v[k] ?? null };
    if (Object.keys(changes).length) {
      db.run('UPDATE custom_fields SET team=?, label=?, label_en=?, list_id=?, unit=?, required=?, show_in_list=?, sort=?, active=? WHERE id = ?', v.team, v.label, v.label_en, v.list_id, v.unit, v.required, v.show_in_list, v.sort, v.active, id);
      audit.log(db, user.id, 'custom_field_edit', 'custom_fields', id, { label: v.label, changes });
    }
    return { ok: true };
  });
}

/** Admin overview: every field with how many values it holds. */
function adminFields(db, kind) {
  const rows = db.all(`SELECT f.*, l.name AS list_name, l.name_en AS list_name_en, (SELECT count(*) FROM custom_values v WHERE v.field_id = f.id AND v.value <> '') AS used
    FROM custom_fields f LEFT JOIN custom_lists l ON l.id = f.list_id WHERE (? IS NULL OR f.kind = ?) ORDER BY f.kind, f.sort, f.id`, kind || null, kind || null);
  return rows;
}

// ---------------------------------------------------------------- administration (lists)
function createList(db, user, data) {
  const name = clean(data.name, 80); const name_en = clean(data.name_en, 80) || null;
  if (!name) return { ok: false, errors: { name: 'required' } };
  if (db.get('SELECT 1 FROM custom_lists WHERE lower(name) = lower(?)', name)) return { ok: false, errors: { name: 'duplicate' } };
  return db.tx(() => {
    const id = db.run('INSERT INTO custom_lists(name, name_en, active, created_at) VALUES (?,?,1,?)', name, name_en, nowIso()).id;
    audit.log(db, user.id, 'custom_list_create', 'custom_lists', id, { name });
    return { ok: true, id };
  });
}

function updateList(db, user, id, data) {
  const cur = db.get('SELECT * FROM custom_lists WHERE id = ?', id);
  if (!cur) return { ok: false, code: 'not_found' };
  const name = clean(data.name, 80); const name_en = clean(data.name_en, 80) || null;
  if (!name) return { ok: false, errors: { name: 'required' } };
  if (db.get('SELECT 1 FROM custom_lists WHERE lower(name) = lower(?) AND id <> ?', name, id)) return { ok: false, errors: { name: 'duplicate' } };
  const active = data.active ? 1 : 0;
  if (!active && db.get('SELECT 1 FROM custom_fields WHERE list_id = ? AND active = 1', id)) return { ok: false, errors: { active: 'list_in_use' } };
  db.run('UPDATE custom_lists SET name=?, name_en=?, active=? WHERE id = ?', name, name_en, active, id);
  audit.log(db, user.id, 'custom_list_edit', 'custom_lists', id, { name, active });
  return { ok: true };
}

/** Add items from text: one per line, "Romanian | English" (the English part is optional). Existing labels are skipped. */
function addItems(db, user, listId, text) {
  if (!db.get('SELECT 1 FROM custom_lists WHERE id = ?', listId)) return { ok: false, code: 'not_found' };
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, errors: { items: 'required' } };
  if (lines.some((l) => l.split('|')[0].trim().length > 80 || (l.split('|')[1] || '').trim().length > 80)) return { ok: false, errors: { items: 'too_long' } };
  return db.tx(() => {
    const have = new Set(db.all('SELECT lower(label) AS l FROM custom_list_items WHERE list_id = ?', listId).map((r) => r.l));
    let sort = db.value('SELECT coalesce(max(sort), 0) FROM custom_list_items WHERE list_id = ?', listId);
    let added = 0;
    for (const line of lines) {
      if (db.value('SELECT count(*) FROM custom_list_items WHERE list_id = ?', listId) >= MAX_ITEMS) break;
      const [ro, en] = line.split('|').map((s) => s.trim());
      if (!ro || have.has(ro.toLowerCase())) continue;
      have.add(ro.toLowerCase()); sort += 10;
      db.run('INSERT INTO custom_list_items(list_id, label, label_en, sort, active) VALUES (?,?,?,?,1)', listId, ro, en || null, sort);
      added++;
    }
    audit.log(db, user.id, 'custom_item_add', 'custom_lists', listId, { added });
    return { ok: true, added };
  });
}

function updateItem(db, user, listId, itemId, data) {
  const cur = db.get('SELECT * FROM custom_list_items WHERE id = ? AND list_id = ?', itemId, listId);
  if (!cur) return { ok: false, code: 'not_found' };
  const label = clean(data.label, 80); const label_en = clean(data.label_en, 80) || null;
  if (!label) return { ok: false, errors: { label: 'required' } };
  if (db.get('SELECT 1 FROM custom_list_items WHERE list_id = ? AND lower(label) = lower(?) AND id <> ?', listId, label, itemId)) return { ok: false, errors: { label: 'duplicate' } };
  const sort = Number.isInteger(Number(data.sort)) ? Math.min(Math.max(Number(data.sort), 0), 99999) : cur.sort;
  db.run('UPDATE custom_list_items SET label=?, label_en=?, sort=?, active=? WHERE id = ?', label, label_en, sort, data.active ? 1 : 0, itemId);
  audit.log(db, user.id, 'custom_item_edit', 'custom_lists', listId, { item: itemId, label, active: data.active ? 1 : 0 });
  return { ok: true };
}

module.exports = {
  KINDS, TYPES, TEAMS, nameOf, listNameOf, fieldLabel, lists, defs, shown, field, valueCount, valuesOf, valuesOfMany, display, parse, parseObject, save, changeSummary,
  filters, keep, where, exportColumns, exportRows, createField, updateField, adminFields, createList, updateList, addItems, updateItem,
};
