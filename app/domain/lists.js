'use strict';
// Reference lists (nomenclatoare): add / rename / deactivate, never delete (ADR-005).
const audit = require('./audit');

const RE_ROTOR = /^\d+(\+\d+)*$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * field types: text, select (options from `options(db)`), check, date, rotor, int
 * `active: false` -> the table has no 'active' column.
 */
const LISTS = {
  'tipuri-utilaj': {
    table: 'machine_types', title: 'machine_types', nameField: 'name', order: 'name',
    fields: [{ name: 'name', type: 'text', required: true, max: 80 }],
    families: true,
  },
  utilaje: {
    table: 'machines', title: 'machines', nameField: 'name', order: 'name',
    fields: [
      { name: 'name', type: 'text', required: true, max: 80 },
      { name: 'machine_type_id', type: 'select', required: true, options: (db) => db.all('SELECT id, name FROM machine_types WHERE active = 1 ORDER BY name').map((r) => [r.id, r.name]) },
      { name: 'rotor_config', type: 'rotor', required: false, max: 40 },
    ],
  },
  operatori: {
    table: 'operators', title: 'operators', nameField: 'full_name', order: 'full_name',
    fields: [{ name: 'full_name', type: 'text', required: true, max: 120 }],
  },
  clienti: {
    table: 'clients', title: 'clients', nameField: 'short_name', order: 'short_name',
    fields: [
      { name: 'short_name', type: 'text', required: true, max: 40 },
      { name: 'name', type: 'text', required: false, max: 160 },
    ],
  },
  'tipuri-proba': {
    table: 'sample_types', title: 'sample_types', nameField: 'name', order: 'sort, name',
    fields: [
      { name: 'name', type: 'text', required: true, max: 80 },
      { name: 'numbered', type: 'check' },
      { name: 'sort', type: 'int', required: false },
    ],
  },
  schimburi: {
    table: 'crews', title: 'crews', nameField: 'name', order: 'name', active: false,
    fields: [
      { name: 'name', type: 'text', required: true, max: 20 },
      { name: 'cycle_start', type: 'date', required: true },
    ],
  },
  forme: {
    table: 'shapes', title: 'shapes', nameField: 'code', order: 'id',
    fields: [
      { name: 'code', type: 'text', required: true, max: 16, upper: true },
      { name: 'name', type: 'text', required: true, max: 40 },
      { name: 'kind', type: 'select', required: true, options: () => [['rotund', 'rotund'], ['sector', 'sector']] },
      { name: 'iec_group', type: 'select', required: true, options: () => [['solid', 'solid'], ['circular', 'circular'], ['compactat', 'compactat'], ['profilat', 'profilat']] },
    ],
  },
  destinatii: {
    table: 'destinations', title: 'destinations', nameField: 'name', order: 'id',
    fields: [{ name: 'name', type: 'text', required: true, max: 60 }],
  },
};

function rotorMaxWires(cfg) {
  if (!cfg) return null;
  return cfg.split('+').reduce((a, b) => a + Number(b), 0);
}

/** Validate submitted values for a list; returns {values} or {errors:{field:code}}. */
function validate(db, def, form, existingId) {
  const errors = {};
  const values = {};
  for (const f of def.fields) {
    let v = form.get(f.name, '').trim();
    if (f.type === 'check') { values[f.name] = form.bool(f.name) ? 1 : 0; continue; }
    if (f.type === 'int') {
      if (v === '') { values[f.name] = 0; continue; }
      if (!/^-?\d{1,6}$/.test(v)) { errors[f.name] = 'invalid'; continue; }
      values[f.name] = Number(v); continue;
    }
    if (v === '') {
      if (f.required) errors[f.name] = 'required';
      values[f.name] = null;
      continue;
    }
    if (f.max && v.length > f.max) { errors[f.name] = 'too_long'; continue; }
    if (f.upper) v = v.toUpperCase();
    if (f.type === 'date' && !RE_DATE.test(v)) { errors[f.name] = 'invalid'; continue; }
    if (f.type === 'date' && Number.isNaN(Date.parse(v))) { errors[f.name] = 'invalid'; continue; }
    if (f.type === 'rotor') {
      v = v.replace(/\s+/g, '');
      if (!RE_ROTOR.test(v)) { errors[f.name] = 'rotor_format'; continue; }
    }
    if (f.type === 'select') {
      if (!f.options(db).some(([id]) => String(id) === v)) { errors[f.name] = 'invalid'; continue; }
      if (f.name.endsWith('_id')) v = Number(v);
    }
    values[f.name] = v;
  }
  if (def.table === 'machines') values.max_wires = rotorMaxWires(values.rotor_config);
  return Object.keys(errors).length ? { errors } : { values };
}

function isUniqueError(e) { return /UNIQUE constraint/i.test(String(e && e.message)); }

function listRows(db, def) {
  const rows = db.all(`SELECT * FROM ${def.table} ORDER BY ${def.active === false ? '' : 'active DESC, '}${def.order}`);
  if (def.families) {
    const links = db.all('SELECT machine_type_id, family_id FROM machine_type_families');
    for (const r of rows) r.family_ids = links.filter((l) => l.machine_type_id === r.id).map((l) => l.family_id);
  }
  return rows;
}

function setFamilies(db, typeId, familyIds) {
  db.run('DELETE FROM machine_type_families WHERE machine_type_id = ?', typeId);
  for (const fid of familyIds) db.run('INSERT INTO machine_type_families(machine_type_id, family_id) VALUES (?, ?)', typeId, fid);
}

function add(db, userId, key, def, values, familyIds) {
  return db.tx(() => {
    const cols = Object.keys(values);
    const id = db.run(`INSERT INTO ${def.table}(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => values[c])).id;
    if (def.families) setFamilies(db, id, familyIds || []);
    audit.log(db, userId, 'list_add', def.table, id, { list: key, values });
    return id;
  });
}

function update(db, userId, key, def, id, values, familyIds) {
  return db.tx(() => {
    const cols = Object.keys(values);
    const before = db.get(`SELECT * FROM ${def.table} WHERE id = ?`, id);
    if (!before) return false;
    db.run(`UPDATE ${def.table} SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE id = ?`, ...cols.map((c) => values[c]), id);
    if (def.families) setFamilies(db, id, familyIds || []);
    audit.log(db, userId, 'list_edit', def.table, id, { list: key, before, after: values });
    return true;
  });
}

function toggleActive(db, userId, key, def, id) {
  if (def.active === false) return false;
  return db.tx(() => {
    const row = db.get(`SELECT active FROM ${def.table} WHERE id = ?`, id);
    if (!row) return false;
    db.run(`UPDATE ${def.table} SET active = ? WHERE id = ?`, row.active ? 0 : 1, id);
    audit.log(db, userId, 'list_toggle', def.table, id, { list: key, active: row.active ? 0 : 1 });
    return true;
  });
}

function updateMaterial(db, userId, id, values) {
  return db.tx(() => {
    const before = db.get('SELECT * FROM materials WHERE id = ?', id);
    if (!before) return false;
    db.run('UPDATE materials SET grade = ?, rho20 = ?, density = ?, alpha20 = ? WHERE id = ?', values.grade, values.rho20, values.density, values.alpha20, id);
    audit.log(db, userId, 'material_change', 'materials', id, { before, after: values });
    return true;
  });
}

module.exports = { LISTS, validate, isUniqueError, listRows, add, update, toggleActive, updateMaterial, rotorMaxWires };
