'use strict';
// Production batches (loturi) of finished cable and their drums; coverage of the required tests.
const calc = require('./calc');
const audit = require('./audit');
const tests = require('./tests');
const rev = require('./revisions');
const { nowIso } = require('../lib/time');

/** Cable designs the batches can be made of: constructions of the active revision(s) of the finished-cable data sheet. */
function designs(db) {
  return db.all(`SELECT c.*, m.code AS material_code, s.name AS shape_name
    FROM constructions c JOIN spec_revisions r ON r.id = c.revision_id AND r.status = 'activa'
    JOIN spec_documents d ON d.id = r.document_id JOIN product_families f ON f.id = d.family_id AND f.code = 'CABLE_LV'
    JOIN materials m ON m.id = c.material_id JOIN shapes s ON s.id = c.shape_id
    WHERE c.active = 1 ORDER BY c.sort, c.label`).map((c) => ({ ...c, data: JSON.parse(c.data || '{}') }));
}

function validate(db, form, { creating }) {
  const errors = {}, v = {};
  v.batch_no = form.get('batch_no', '').trim();
  if (creating) {
    if (!v.batch_no) errors.batch_no = 'required'; else if (v.batch_no.length > 40) errors.batch_no = 'too_long';
  }
  v.order_no = form.get('order_no', '').trim().slice(0, 60) || null;
  v.client_id = form.int('client_id');
  if (v.client_id && !db.get('SELECT 1 FROM clients WHERE id = ?', v.client_id)) errors.client_id = 'invalid';
  v.standard = form.get('standard', '').trim().slice(0, 120) || null;
  const len = form.get('produced_length_m', '').trim();
  v.produced_length_m = len === '' ? null : calc.parseDecimal(len);
  if (len !== '' && (v.produced_length_m === null || v.produced_length_m < 0)) errors.produced_length_m = 'invalid';
  v.produced_on = form.get('produced_on', '').trim() || null;
  if (v.produced_on && !/^\d{4}-\d{2}-\d{2}$/.test(v.produced_on)) errors.produced_on = 'invalid';
  v.notes = form.get('notes', '').trim().slice(0, 1000) || null;
  if (creating) {
    v.construction_id = form.int('construction_id');
    if (!v.construction_id || !designs(db).some((d) => d.id === v.construction_id)) errors.construction_id = 'invalid';
  }
  return { errors, v };
}

function create(db, user, v) {
  return db.tx(() => {
    const design = db.get('SELECT * FROM constructions WHERE id = ?', v.construction_id);
    let id;
    try {
      id = db.run('INSERT INTO batches(batch_no, order_no, client_id, construction_id, revision_id, standard, produced_length_m, produced_on, status, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        v.batch_no, v.order_no, v.client_id, design.id, design.revision_id, v.standard, v.produced_length_m, v.produced_on, 'deschis', v.notes, user.id, nowIso()).id;
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return { ok: false, errors: { batch_no: 'duplicate' } };
      throw e;
    }
    audit.log(db, user.id, 'batch_create', 'batches', id, { batch_no: v.batch_no, construction_id: design.id });
    return { ok: true, id };
  });
}

function update(db, user, id, v) {
  const before = db.get('SELECT * FROM batches WHERE id = ?', id);
  if (!before) return false;
  db.tx(() => {
    db.run('UPDATE batches SET order_no = ?, client_id = ?, standard = ?, produced_length_m = ?, produced_on = ?, notes = ? WHERE id = ?', v.order_no, v.client_id, v.standard, v.produced_length_m, v.produced_on, v.notes, id);
    audit.log(db, user.id, 'batch_change', 'batches', id, { before, after: v });
  });
  return true;
}

function setStatus(db, user, id, status) {
  db.tx(() => {
    db.run('UPDATE batches SET status = ? WHERE id = ?', status, id);
    audit.log(db, user.id, status === 'inchis' ? 'batch_close' : 'batch_reopen', 'batches', id, {});
  });
}

function validateDrum(form) {
  const errors = {}, v = {};
  v.drum_no = form.get('drum_no', '').trim();
  if (!v.drum_no) errors.drum_no = 'required'; else if (v.drum_no.length > 30) errors.drum_no = 'too_long';
  const len = form.get('length_m', '').trim();
  v.length_m = len === '' ? null : calc.parseDecimal(len);
  if (len !== '' && (v.length_m === null || v.length_m < 0)) errors.length_m = 'invalid';
  v.notes = form.get('notes', '').trim().slice(0, 300) || null;
  return { errors, v };
}

function addDrum(db, user, batchId, v) {
  return db.tx(() => {
    try {
      const id = db.run('INSERT INTO drums(batch_id, drum_no, length_m, notes) VALUES (?,?,?,?)', batchId, v.drum_no, v.length_m, v.notes).id;
      audit.log(db, user.id, 'drum_add', 'drums', id, { batch_id: batchId, ...v });
      return { ok: true, id };
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return { ok: false, errors: { drum_no: 'duplicate' } };
      throw e;
    }
  });
}

function updateDrum(db, user, batchId, drumId, v) {
  return db.tx(() => {
    const before = db.get('SELECT * FROM drums WHERE id = ? AND batch_id = ?', drumId, batchId);
    if (!before) return { ok: false, code: 'not_found' };
    try {
      db.run('UPDATE drums SET drum_no = ?, length_m = ?, notes = ? WHERE id = ?', v.drum_no, v.length_m, v.notes, drumId);
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return { ok: false, errors: { drum_no: 'duplicate' } };
      throw e;
    }
    audit.log(db, user.id, 'drum_change', 'drums', drumId, { before, after: v });
    return { ok: true };
  });
}

/**
 * Everything the batch page and the certificate need: batch, design, drums, current results, and what is still missing.
 * Required tests are the ones the design's data sheet lists (data.tests); routine tests are needed on every drum, sample tests once per batch.
 */
function overview(db, batchId) {
  const batch = db.get(`SELECT b.*, cl.short_name AS client_name, u.full_name AS created_by_name FROM batches b LEFT JOIN clients cl ON cl.id = b.client_id JOIN users u ON u.id = b.created_by WHERE b.id = ?`, batchId);
  if (!batch) return null;
  const design = db.get('SELECT c.*, m.code AS material_code, s.code AS shape_code, s.name AS shape_name FROM constructions c JOIN materials m ON m.id = c.material_id JOIN shapes s ON s.id = c.shape_id WHERE c.id = ?', batch.construction_id);
  design.data = JSON.parse(design.data || '{}');
  const revision = db.get('SELECT r.*, d.code AS doc_code, d.title AS doc_title FROM spec_revisions r JOIN spec_documents d ON d.id = r.document_id WHERE r.id = ?', batch.revision_id);
  const drums = db.all('SELECT * FROM drums WHERE batch_id = ? ORDER BY length(drum_no), drum_no', batchId);
  const family = rev.familyOf(db, design.family_id);
  const ctx = tests.cableContext(db, design, family, 'batch');
  const required = tests.requiredTests(ctx, design.data);
  const meas = db.all(`SELECT m.id, m.record_no, m.drum_id, m.created_at, m.notes, m.version, mc.name AS machine_name, u.full_name AS user_name
    FROM measurements m JOIN machines mc ON mc.id = m.machine_id JOIN users u ON u.id = m.created_by WHERE m.batch_id = ? AND m.is_current = 1 ORDER BY m.created_at, m.id`, batchId);
  const results = meas.length ? db.all(`SELECT * FROM measurement_results WHERE measurement_id IN (${meas.map(() => '?').join(',')}) ORDER BY rowid`, ...meas.map((m) => m.id)) : [];
  const byMeas = new Map(meas.map((m) => [m.id, m]));
  for (const r of results) { const m = byMeas.get(r.measurement_id); (m.results = m.results || []).push(r); }
  // coverage
  const done = new Set(); // "drum|code"
  for (const m of meas) for (const r of m.results || []) done.add(`${m.drum_id || 0}|${r.quantity.replace(/_(avg|min|max)$/, '')}`);
  const has = (drumId, code) => done.has(`${drumId}|${code}`);
  const anyDrum = (code) => done.has(`0|${code}`) || drums.some((d) => has(d.id, code));
  const missing = [];
  for (const t of required) {
    if (t.scope === 'routine') {
      if (!drums.length) missing.push({ test: t, drum: null });
      for (const d of drums) if (!has(d.id, t.code) && !has(0, t.code)) missing.push({ test: t, drum: d });
    } else if (!anyDrum(t.code)) missing.push({ test: t, drum: null });
  }
  return { batch, design, revision, drums, measurements: meas, required, missing, ctx };
}

function list(db, filters) {
  const where = [], p = [];
  if (filters.status) { where.push('b.status = ?'); p.push(filters.status); }
  if (filters.q) { where.push("(b.batch_no LIKE ? ESCAPE '\\' OR b.order_no LIKE ? ESCAPE '\\')"); const like = '%' + filters.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'; p.push(like, like); }
  if (filters.client_id) { where.push('b.client_id = ?'); p.push(filters.client_id); }
  return db.all(`SELECT b.*, cl.short_name AS client_name, c.label AS design_label,
      (SELECT count(*) FROM drums d WHERE d.batch_id = b.id) AS drum_count,
      (SELECT count(*) FROM measurements m WHERE m.batch_id = b.id AND m.is_current = 1) AS test_count,
      (SELECT count(*) FROM batch_certificates x WHERE x.batch_id = b.id) AS cert_count
    FROM batches b JOIN constructions c ON c.id = b.construction_id LEFT JOIN clients cl ON cl.id = b.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.id DESC LIMIT 500`, ...p);
}

module.exports = { designs, validate, create, update, setStatus, validateDrum, addDrum, updateDrum, overview, list };
