'use strict';
// Measurement records: create, correct (new version), read, register queries. The server recomputes everything.
const calc = require('./calc');
const iec = require('./iec');
const shifts = require('./shifts');
const settings = require('./settings');
const audit = require('./audit');
const rev = require('./revisions');
const { nowIso } = require('../lib/time');

const INPUT_KEYS = ['d1', 'd2', 'h', 'l', 'mass_g', 'sample_mm', 'r_value', 'r_unit', 'r_sample_m', 'temp_c'];
const PAGE_SIZE = 50;

const NOTES_MAX = 2000;

/** Evaluation context for one construction (limits of the active revision + material + IEC resistance limit). */
function contextFor(db, construction, family) {
  const level = family.levels[0];
  const material = db.get('SELECT rho20, density, alpha20, code FROM materials WHERE id = ?', construction.material_id);
  const limits = {};
  for (const l of db.all('SELECT * FROM limits WHERE construction_id = ? AND level = ?', construction.id, level)) {
    limits[l.quantity] = { min: l.min, max: l.max, nominal: l.nominal, informative: !!l.informative };
  }
  const shape = db.get('SELECT * FROM shapes WHERE id = ?', construction.shape_id);
  const dest = construction.destination_id ? db.get('SELECT name FROM destinations WHERE id = ?', construction.destination_id) : null;
  // drawn wire is always round: the shape on a wire row names the conductor it goes into
  const shapeKind = family.measures.diam === '2citiri' ? 'rotund' : shape.kind;
  // a drawn wire has a resistance limit only when it is itself the finished conductor: unifilar RE
  let iecClass = family.iec_class;
  if (family.code === 'SARMA_CL12') iecClass = shape.code === 'RE' && dest && dest.name === 'Unifilar' ? 1 : null;
  const r = iecClass ? iec.resistanceLimit(db, iecClass, material.code, construction.section, construction.coated) : null;
  const measuresR = (family.measures.resistance_measured || []).includes(material.code) && (family.code !== 'SARMA_CL12' || iecClass === 1);
  return {
    shapeKind, material, limits, iec: r, measuresR, level,
    measuresMass: family.measures.mass !== false, theoretical: family.measures.resistance_theoretical !== false,
  };
}

/** What the entry form must show for a family + construction (which inputs, which limits). */
function formModel(db, construction, family) {
  const ctx = contextFor(db, construction, family);
  return {
    ctx,
    shape: db.get('SELECT * FROM shapes WHERE id = ?', construction.shape_id),
    inputs: {
      diameter: ctx.shapeKind === 'sector' ? 'hl' : 'd12',
      mass: ctx.measuresMass,
      resistance: ctx.measuresR,
    },
  };
}

function machineAllowsFamily(db, machineId, familyId) {
  return !!db.get(
    `SELECT 1 FROM machines m JOIN machine_type_families f ON f.machine_type_id = m.machine_type_id
      WHERE m.id = ? AND m.active = 1 AND f.family_id = ?`, machineId, familyId);
}

/** Constructions of the active revision(s) of a family, filtered by the strander's capacity. */
function constructionsFor(db, family, machine) {
  const spec = require('./revisions').specFamilyOf(db, family);
  const rows = db.all(
    `SELECT c.*, m.code AS material_code, s.code AS shape_code, dn.name AS destination_name
       FROM constructions c
       LEFT JOIN destinations dn ON dn.id = c.destination_id
       JOIN spec_revisions r ON r.id = c.revision_id AND r.status = 'activa'
       JOIN spec_documents d ON d.id = r.document_id AND d.family_id = ?
       JOIN materials m ON m.id = c.material_id
       JOIN shapes s ON s.id = c.shape_id
      WHERE c.active = 1
      ORDER BY m.code, c.section, s.id, c.sort`, spec.id);
  return rows.filter((c) => !machine || !machine.max_wires || !c.wires || c.wires <= machine.max_wires);
}

function machinesFor(db, familyId) {
  return db.all(
    `SELECT m.* FROM machines m JOIN machine_type_families f ON f.machine_type_id = m.machine_type_id
      WHERE m.active = 1 AND f.family_id = ? ORDER BY m.name`, familyId);
}

/** Proposed length number for numbered sample types: next free number in the same shift / machine / construction. */
function proposeLengthNo(db, { machineId, shiftDate, shift, stableKey }) {
  const v = db.value(
    `SELECT max(m.length_no) FROM measurements m JOIN constructions c ON c.id = m.construction_id
      WHERE m.is_current = 1 AND m.machine_id = ? AND c.stable_key = ? AND m.shift_date = ? AND m.shift = ?`,
    machineId, stableKey, shiftDate, shift);
  return (v || 0) + 1;
}

function currentShift(db, date) {
  const cfg = settings.shiftConfig(db);
  const s = shifts.shiftFor(date || new Date(), cfg);
  const crew = shifts.crewOnDuty(s.shift_date, s.shift, db.all('SELECT * FROM crews ORDER BY name'));
  return { ...s, crew };
}

function cleanInputs(form) {
  const inputs = {};
  for (const k of INPUT_KEYS) {
    const v = form.get(k, '').trim();
    if (v !== '') inputs[k] = k === 'r_unit' ? (v === 'ohm' ? 'ohm' : 'ohm_km') : v;
  }
  return inputs;
}

/** Validate the metadata fields; returns {meta, errors}. */
function readMeta(db, form) {
  const errors = {};
  const meta = {};
  meta.operator_id = form.int('operator_id');
  if (meta.operator_id && !db.get('SELECT 1 FROM operators WHERE id = ?', meta.operator_id)) errors.operator_id = 'invalid';
  meta.client_id = form.int('client_id');
  if (meta.client_id && !db.get('SELECT 1 FROM clients WHERE id = ?', meta.client_id)) errors.client_id = 'invalid';
  meta.sample_type_id = form.int('sample_type_id');
  if (!meta.sample_type_id || !db.get('SELECT 1 FROM sample_types WHERE id = ?', meta.sample_type_id)) errors.sample_type_id = 'required';
  const ln = form.get('length_no', '').trim();
  if (ln === '') meta.length_no = null;
  else if (/^\d{1,5}$/.test(ln)) meta.length_no = Number(ln);
  else errors.length_no = 'invalid';
  const pl = form.get('produced_length_m', '').trim();
  if (pl === '') meta.produced_length_m = null;
  else {
    const n = calc.parseDecimal(pl);
    if (n === null || n < 0) errors.produced_length_m = 'invalid'; else meta.produced_length_m = n;
  }
  meta.notes = form.get('notes', '').trim().slice(0, NOTES_MAX) || null;
  return { meta, errors };
}

const errorMap = (list) => {
  const o = {};
  for (const k of list) o[k] = 'invalid';
  return o;
};

function insertVersion(db, m, inputs, evaluation, recordNo, version, supersedes, reason, userId, shiftInfo) {
  const id = db.run(
    `INSERT INTO measurements(record_no, version, is_current, supersedes_id, edit_reason, created_at, created_by, shift_date, shift, crew_id,
       family_id, machine_id, construction_id, revision_id, level, destination_construction_id, operator_id, client_id, sample_type_id,
       length_no, produced_length_m, notes) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)`,
    recordNo, version, supersedes, reason, nowIso(), userId, shiftInfo.shift_date, shiftInfo.shift, shiftInfo.crew_id,
    m.family_id, m.machine_id, m.construction_id, m.revision_id, m.level, m.operator_id, m.client_id, m.sample_type_id,
    m.length_no, m.produced_length_m, m.notes).id;
  for (const [k, v] of Object.entries(inputs)) db.run('INSERT INTO measurement_inputs(measurement_id, key, value) VALUES (?,?,?)', id, k, String(v).replace(',', '.'));
  for (const r of evaluation.results) {
    db.run('INSERT INTO measurement_results(measurement_id, quantity, value, lim_min, lim_max, verdict, deviation_pct, source) VALUES (?,?,?,?,?,?,?,?)',
      id, r.quantity, r.value, r.lim_min, r.lim_max, r.verdict, r.deviation_pct, r.source);
  }
  return id;
}

/**
 * Save a new measurement. `form` is a Form. Returns {ok:true, recordNo, id, warnings} or {ok:false, errors:{field:code}}.
 */
function create(db, user, form, now) {
  const familyId = form.int('family_id'), machineId = form.int('machine_id'), constructionId = form.int('construction_id');
  const errors = {};
  const family = familyId ? rev.familyOf(db, familyId) : null;
  if (!family || !family.active) return { ok: false, errors: { family_id: 'invalid' } };
  if (!machineId || !machineAllowsFamily(db, machineId, familyId)) return { ok: false, errors: { machine_id: 'invalid' } };
  const machine = db.get('SELECT * FROM machines WHERE id = ?', machineId);
  const construction = constructionId && db.get(
    `SELECT c.* FROM constructions c JOIN spec_revisions r ON r.id = c.revision_id AND r.status = 'activa'
       JOIN spec_documents d ON d.id = r.document_id WHERE c.id = ? AND c.active = 1 AND d.family_id = ?`, constructionId, rev.specFamilyOf(db, family).id);
  if (!construction) return { ok: false, errors: { construction_id: 'invalid' } };
  if (machine.max_wires && construction.wires && construction.wires > machine.max_wires) return { ok: false, errors: { machine_id: 'capacity' } };

  const { meta, errors: metaErrors } = readMeta(db, form);
  Object.assign(errors, metaErrors);
  const inputs = cleanInputs(form);
  const ctx = contextFor(db, construction, family);
  const ev = calc.evaluate(inputs, ctx);
  Object.assign(errors, errorMap(ev.errors));
  if (Object.keys(errors).length) return { ok: false, errors };

  const when = now || new Date();
  const cur = currentShift(db, when);
  const m = { ...meta, family_id: familyId, machine_id: machineId, construction_id: constructionId, revision_id: construction.revision_id, level: ctx.level };
  const out = db.tx(() => {
    const recordNo = (db.value('SELECT max(record_no) FROM measurements') || 0) + 1;
    const id = insertVersion(db, m, inputs, ev, recordNo, 1, null, null, user.id, { shift_date: cur.shift_date, shift: cur.shift, crew_id: cur.crew ? cur.crew.id : null });
    audit.log(db, user.id, 'measurement_add', 'measurements', id, { record_no: recordNo });
    return { recordNo, id };
  });
  return { ok: true, ...out, warnings: ev.warnings };
}

/** May this user correct this record right now? (Personal: own record, same shift; Inginer / Admin: any.) */
function canCorrect(db, user, recordNo, now) {
  const cur = db.get('SELECT * FROM measurements WHERE record_no = ? AND is_current = 1', recordNo);
  if (!cur) return { ok: false, code: 'not_found' };
  if (user.role === 'administrator' || user.role === 'inginer') return { ok: true, current: cur };
  const mine = db.get('SELECT 1 FROM measurements WHERE record_no = ? AND created_by = ?', recordNo, user.id);
  if (!mine) return { ok: false, code: 'not_own', current: cur };
  const s = currentShift(db, now);
  if (s.shift_date !== cur.shift_date || s.shift !== cur.shift) return { ok: false, code: 'other_shift', current: cur };
  return { ok: true, current: cur };
}

/** Correction: version n+1, reason mandatory; the record keeps its revision and shift. */
function correct(db, user, recordNo, form, now) {
  const allowed = canCorrect(db, user, recordNo, now);
  if (!allowed.ok) return { ok: false, denied: allowed.code };
  const cur = allowed.current;
  const errors = {};
  const reason = form.get('edit_reason', '').trim();
  if (!reason) errors.edit_reason = 'required';
  else if (reason.length > 500) errors.edit_reason = 'too_long';

  const family = rev.familyOf(db, cur.family_id);
  const construction = db.get('SELECT * FROM constructions WHERE id = ?', cur.construction_id);
  let machineId = form.int('machine_id') || cur.machine_id;
  if (!machineAllowsFamily(db, machineId, cur.family_id) && machineId !== cur.machine_id) errors.machine_id = 'invalid';
  const machine = db.get('SELECT * FROM machines WHERE id = ?', machineId);
  if (machine && machine.max_wires && construction.wires && construction.wires > machine.max_wires) errors.machine_id = 'capacity';

  const { meta, errors: metaErrors } = readMeta(db, form);
  Object.assign(errors, metaErrors);
  const inputs = cleanInputs(form);
  const ctx = contextFor(db, construction, family);
  const ev = calc.evaluate(inputs, ctx);
  Object.assign(errors, errorMap(ev.errors));
  if (Object.keys(errors).length) return { ok: false, errors };

  const m = { ...meta, family_id: cur.family_id, machine_id: machineId, construction_id: cur.construction_id, revision_id: cur.revision_id, level: cur.level };
  const out = db.tx(() => {
    db.run('UPDATE measurements SET is_current = 0 WHERE id = ?', cur.id);
    const id = insertVersion(db, m, inputs, ev, recordNo, cur.version + 1, cur.id, reason, user.id, { shift_date: cur.shift_date, shift: cur.shift, crew_id: cur.crew_id });
    audit.log(db, user.id, 'measurement_correct', 'measurements', id, { record_no: recordNo, version: cur.version + 1, reason });
    return { id, version: cur.version + 1 };
  });
  return { ok: true, recordNo, ...out, warnings: ev.warnings };
}

// ---------- reading ----------

const SELECT_MEAS = `
  SELECT m.*, f.name AS family_name, f.code AS family_code, mc.name AS machine_name, c.label AS construction_label,
         c.stable_key AS stable_key, mat.code AS material_code, sh.code AS shape_code, sh.kind AS shape_kind,
         op.full_name AS operator_name, cl.short_name AS client_name, st.name AS sample_type_name,
         cr.name AS crew_name, u.full_name AS user_name, r.edition AS rev_edition, r.revision AS rev_revision
  FROM measurements m
  JOIN product_families f ON f.id = m.family_id
  JOIN machines mc ON mc.id = m.machine_id
  JOIN constructions c ON c.id = m.construction_id
  JOIN materials mat ON mat.id = c.material_id
  JOIN shapes sh ON sh.id = c.shape_id
  JOIN spec_revisions r ON r.id = m.revision_id
  JOIN sample_types st ON st.id = m.sample_type_id
  JOIN users u ON u.id = m.created_by
  LEFT JOIN operators op ON op.id = m.operator_id
  LEFT JOIN clients cl ON cl.id = m.client_id
  LEFT JOIN crews cr ON cr.id = m.crew_id`;

function attachResults(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const res = db.all(`SELECT * FROM measurement_results WHERE measurement_id IN (${ids.map(() => '?').join(',')}) ORDER BY rowid`, ...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) { r.results = []; r.resultMap = {}; }
  for (const x of res) {
    const row = byId.get(x.measurement_id);
    row.results.push(x); row.resultMap[x.quantity] = x;
  }
  return rows;
}

function attachVersionCounts(db, rows) {
  for (const r of rows) r.versions = db.value('SELECT count(*) FROM measurements WHERE record_no = ?', r.record_no);
  return rows;
}

/** @returns {{rows, total, page, pages}} */
function register(db, f, page, size) {
  const pageSize = size || PAGE_SIZE;
  const where = [];
  const p = [];
  if (!f.all_versions) where.push('m.is_current = 1');
  if (f.from) { where.push('m.shift_date >= ?'); p.push(f.from); }
  if (f.to) { where.push('m.shift_date <= ?'); p.push(f.to); }
  if (f.shift === 'zi' || f.shift === 'noapte') { where.push('m.shift = ?'); p.push(f.shift); }
  for (const [k, col] of [['crew_id', 'm.crew_id'], ['family_id', 'm.family_id'], ['machine_id', 'm.machine_id'], ['operator_id', 'm.operator_id'], ['client_id', 'm.client_id'], ['sample_type_id', 'm.sample_type_id']]) {
    if (f[k]) { where.push(`${col} = ?`); p.push(f[k]); }
  }
  if (f.q) { where.push("c.label LIKE ? ESCAPE '\\'"); p.push('%' + f.q.replace(/[%_\\]/g, (ch) => '\\' + ch) + '%'); }
  if (f.out) where.push("EXISTS (SELECT 1 FROM measurement_results r WHERE r.measurement_id = m.id AND r.verdict IN ('sub','peste'))");
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.value(`SELECT count(*) FROM measurements m JOIN constructions c ON c.id = m.construction_id ${w}`, ...p);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pg = Math.min(Math.max(1, page || 1), pages);
  const sql = `${SELECT_MEAS} ${w} ORDER BY m.created_at DESC, m.id DESC LIMIT ${pageSize} OFFSET ${(pg - 1) * pageSize}`;
  const rows = db.all(sql, ...p);
  attachResults(db, rows);
  attachVersionCounts(db, rows);
  return { rows, total, page: pg, pages };
}

function record(db, recordNo) {
  const versions = db.all(`${SELECT_MEAS} WHERE m.record_no = ? ORDER BY m.version DESC`, recordNo);
  attachResults(db, versions);
  for (const v of versions) {
    v.inputs = {};
    for (const i of db.all('SELECT key, value FROM measurement_inputs WHERE measurement_id = ?', v.id)) v.inputs[i.key] = i.value;
  }
  return versions;
}

/** Home page: today's measurements, current shift first. */
function today(db, now) {
  const d = now || new Date();
  const cur = currentShift(db, d);
  const day = shifts.dateKey(d);
  const rows = db.all(`${SELECT_MEAS} WHERE m.is_current = 1 AND (substr(m.created_at, 1, 10) = ? OR m.shift_date = ?) ORDER BY m.created_at DESC, m.id DESC LIMIT 200`, day, cur.shift_date);
  attachResults(db, rows);
  attachVersionCounts(db, rows);
  const isCur = (r) => r.shift_date === cur.shift_date && r.shift === cur.shift;
  rows.sort((a, b) => (isCur(b) ? 1 : 0) - (isCur(a) ? 1 : 0));
  return { rows, current: cur };
}

/** Out-of-limit results of the last 24 hours (current versions only). */
function outOfLimit24h(db, now) {
  const since = new Date((now || new Date()).getTime() - 24 * 3600 * 1000);
  const { isoLocal } = require('../lib/time');
  const rows = db.all(`${SELECT_MEAS} WHERE m.is_current = 1 AND m.created_at >= ?
    AND EXISTS (SELECT 1 FROM measurement_results r WHERE r.measurement_id = m.id AND r.verdict IN ('sub','peste'))
    ORDER BY m.created_at DESC LIMIT 100`, isoLocal(since));
  return attachResults(db, rows);
}

module.exports = {
  INPUT_KEYS, PAGE_SIZE, contextFor, formModel, machineAllowsFamily, constructionsFor, machinesFor, proposeLengthNo,
  currentShift, create, canCorrect, correct, register, record, today, outOfLimit24h, cleanInputs,
};
