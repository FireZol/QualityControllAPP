'use strict';
// Technical data sheets: documents -> revisions (ciorna -> in_verificare -> activa -> arhivata) -> constructions.
const { nowIso } = require('../lib/time');
const audit = require('./audit');
const iec = require('./iec');

const CONSTRUCTION_SQL = `
  SELECT c.*, m.code AS material_code, m.density AS density, s.code AS shape_code, s.name AS shape_name,
         s.kind AS shape_kind, s.iec_group AS shape_group, d.name AS destination_name
  FROM constructions c
  JOIN materials m ON m.id = c.material_id
  JOIN shapes s ON s.id = c.shape_id
  LEFT JOIN destinations d ON d.id = c.destination_id`;

function familyOf(db, id) {
  const f = db.get('SELECT * FROM product_families WHERE id = ?', id);
  if (f) { f.levels = JSON.parse(f.levels); f.measures = JSON.parse(f.measures); }
  return f;
}

/** Family whose constructions a measuring family reads: measures.spec_family, else itself. */
function specFamilyOf(db, family) {
  if (family.measures && family.measures.spec_family) return db.get('SELECT * FROM product_families WHERE code = ?', family.measures.spec_family) || family;
  return family;
}

/** A data sheet is editable / usable when its own family is active or an active family measures against it. */
function docFamilyActive(db, family) {
  if (family.active) return true;
  return !!db.get("SELECT 1 FROM product_families WHERE active = 1 AND json_extract(measures, '$.spec_family') = ?", family.code);
}

function loadConstructions(db, revisionId, { onlyActive }) {
  const rows = db.all(`${CONSTRUCTION_SQL} WHERE c.revision_id = ? ${onlyActive ? 'AND c.active = 1' : ''} ORDER BY c.sort, c.id`, revisionId);
  const limits = db.all('SELECT l.* FROM limits l JOIN constructions c ON c.id = l.construction_id WHERE c.revision_id = ?', revisionId);
  const params = db.all('SELECT p.* FROM process_params p JOIN constructions c ON c.id = p.construction_id WHERE c.revision_id = ? ORDER BY p.id', revisionId);
  for (const c of rows) {
    c.data = c.data ? JSON.parse(c.data) : {};
    c.limits = limits.filter((l) => l.construction_id === c.id);
    c.limitMap = {};
    for (const l of c.limits) c.limitMap[`${l.level}.${l.quantity}`] = l;
    c.params = params.filter((p) => p.construction_id === c.id);
  }
  return rows;
}

/** @returns {{rev, doc, family, author, verifier, constructions}|null} */
function loadRevision(db, revisionId, opts) {
  const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
  if (!rev) return null;
  const doc = db.get('SELECT * FROM spec_documents WHERE id = ?', rev.document_id);
  const family = familyOf(db, doc.family_id);
  family.docActive = docFamilyActive(db, family);
  const name = (id) => (id ? (db.get('SELECT full_name FROM users WHERE id = ?', id) || {}).full_name || null : null);
  return {
    rev, doc, family,
    authorName: name(rev.elaborated_by), verifierName: name(rev.verified_by), rejecterName: name(rev.rejected_by),
    constructions: loadConstructions(db, revisionId, { onlyActive: !(opts && opts.includeInactive) }),
  };
}

function activeRevisionId(db, documentId) {
  const r = db.get("SELECT id FROM spec_revisions WHERE document_id = ? AND status = 'activa'", documentId);
  return r ? r.id : null;
}

// ---------- diff (by stable_key) ----------

function flatten(c) {
  const o = {
    label: c.label, shape: c.shape_code, destination: c.destination_name || '', coated: c.coated,
    wires: c.wires, wire_d: c.wire_d, die: c.die,
  };
  for (const k of ['rated_voltage', 'cores', 'conductor_class', 'insulation', 'sheath', 'standard', 'armour']) if (c.data && c.data[k] !== undefined) o[`data.${k}`] = c.data[k];
  if (c.data && Array.isArray(c.data.tests)) o['data.tests'] = [...c.data.tests].sort().join(',');
  for (const l of c.limits) {
    const k = `${l.level}.${l.quantity}`;
    o[`${k}.nominal`] = l.nominal; o[`${k}.min`] = l.min; o[`${k}.max`] = l.max; o[`${k}.informative`] = l.informative;
  }
  for (const p of c.params) {
    const k = `p.${p.strander_config}.${p.rotor}`;
    o[`${k}.pitch`] = p.pitch_mm; o[`${k}.tension`] = p.tension;
  }
  return o;
}

/**
 * Compare a revision with the one it was based on.
 * @returns {{changed: Map<string, Set<string>>, added: Set<string>, removed: object[]}}
 */
function diffAgainst(current, previous) {
  const changed = new Map(), added = new Set(), removed = [];
  if (!previous) return { changed, added, removed, hasBase: false };
  const prevByKey = new Map(previous.map((c) => [c.stable_key, c]));
  for (const c of current) {
    const p = prevByKey.get(c.stable_key);
    if (!p) { added.add(c.stable_key); continue; }
    const a = flatten(c), b = flatten(p);
    const keys = new Set();
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[k] === undefined ? null : a[k], y = b[k] === undefined ? null : b[k];
      if (x !== y) keys.add(k);
    }
    if (keys.size) changed.set(c.stable_key, keys);
    prevByKey.delete(c.stable_key);
  }
  for (const c of prevByKey.values()) removed.push(c);
  return { changed, added, removed, hasBase: true };
}

// ---------- checks ----------

/** All findings for a revision, grouped by construction. Errors block submit / activate. */
function checkRevision(db, revisionId) {
  const full = loadRevision(db, revisionId);
  const findings = [];
  if (!full.constructions.length) findings.push({ level: 'error', code: 'no_constructions', construction: null, params: {} });
  const level = full.family.levels[0];
  const targets = require('./targets').get(db);
  for (const c of full.constructions) {
    const limits = {};
    for (const l of c.limits) if (l.level === level) limits[l.quantity] = l;
    for (const f of iec.checkConstruction(db, full.family, c, limits, targets)) findings.push({ ...f, construction: { id: c.id, label: c.label, stable_key: c.stable_key } });
  }
  return findings;
}

const hasErrors = (findings) => findings.some((f) => f.level === 'error');

// ---------- workflow ----------

function refuse(code) { return { ok: false, code }; }

function claimForEdit(db, rev, user) {
  if (rev.status !== 'ciorna') return refuse('not_draft');
  if (rev.elaborated_by && rev.elaborated_by !== user.id) return refuse('not_author');
  if (!rev.elaborated_by) db.run('UPDATE spec_revisions SET elaborated_by = ?, elaborated_at = ? WHERE id = ?', user.id, nowIso(), rev.id);
  return { ok: true };
}

/** New revision from the active one (copy of constructions, limits, process params). */
function newRevision(db, userId, documentId) {
  return db.tx(() => {
    const open = db.get("SELECT id FROM spec_revisions WHERE document_id = ? AND status IN ('ciorna','in_verificare')", documentId);
    if (open) return { ok: false, code: 'open_revision_exists', id: open.id };
    const active = db.get("SELECT * FROM spec_revisions WHERE document_id = ? AND status = 'activa'", documentId);
    if (!active) return refuse('no_active_revision');
    const maxRev = db.value('SELECT max(revision) FROM spec_revisions WHERE document_id = ? AND edition = ?', documentId, active.edition);
    const id = db.run(
      "INSERT INTO spec_revisions(document_id, edition, revision, status, based_on_id, elaborated_by, elaborated_at) VALUES (?,?,?,'ciorna',?,?,?)",
      documentId, active.edition, maxRev + 1, active.id, userId, nowIso()).id;
    const cons = db.all('SELECT * FROM constructions WHERE revision_id = ? AND active = 1 ORDER BY sort, id', active.id);
    for (const c of cons) {
      const nid = db.run(
        'INSERT INTO constructions(revision_id, stable_key, family_id, material_id, section, shape_id, destination_id, coated, label, wires, wire_d, die, data, iec_exception_reason, active, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)',
        id, c.stable_key, c.family_id, c.material_id, c.section, c.shape_id, c.destination_id, c.coated, c.label, c.wires, c.wire_d, c.die, c.data, c.iec_exception_reason, c.sort).id;
      for (const l of db.all('SELECT * FROM limits WHERE construction_id = ?', c.id)) {
        db.run('INSERT INTO limits(construction_id, level, quantity, nominal, min, max, unit, informative, tolerance_text) VALUES (?,?,?,?,?,?,?,?,?)',
          nid, l.level, l.quantity, l.nominal, l.min, l.max, l.unit, l.informative, l.tolerance_text);
      }
      for (const p of db.all('SELECT * FROM process_params WHERE construction_id = ?', c.id)) {
        db.run('INSERT INTO process_params(construction_id, strander_config, rotor, pitch_mm, tension) VALUES (?,?,?,?,?)', nid, p.strander_config, p.rotor, p.pitch_mm, p.tension);
      }
    }
    audit.log(db, userId, 'revision_new', 'spec_revisions', id, { document_id: documentId, based_on: active.id });
    return { ok: true, id };
  });
}

function updateHeader(db, user, revisionId, { edition, revision, change_note, code }) {
  return db.tx(() => {
    const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
    if (!rev) return refuse('not_found');
    const c = claimForEdit(db, rev, user);
    if (!c.ok) return c;
    try {
      db.run('UPDATE spec_revisions SET edition = ?, revision = ?, change_note = ? WHERE id = ?', edition, revision, change_note || null, revisionId);
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) return refuse('edition_revision_taken');
      throw e;
    }
    db.run('UPDATE spec_documents SET code = ? WHERE id = ?', code || null, rev.document_id);
    audit.log(db, user.id, 'revision_header', 'spec_revisions', revisionId, { edition, revision, code, change_note });
    return { ok: true };
  });
}

function stableKeyFor(db, revisionId, family, matCode, section, shapeCode, coated, destName) {
  const prefix = { FUNIE_RIGIDA: 'FUNIE', EXTRUDAT_AL: 'EXTR', SARMA_CL12: 'SARMA', SARMA_CL5: 'SARMA5', FLEXIBIL_CL5: 'FLEX', CABLE_LV: 'CABLU' }[family.code] || family.code;
  let key = `${prefix}|${matCode}|${section}|${shapeCode}${coated ? '|coated' : ''}${destName ? '|' + destName : ''}`;
  let n = 1, candidate = key;
  while (db.get('SELECT 1 FROM constructions WHERE revision_id = ? AND stable_key = ?', revisionId, candidate)) candidate = `${key}#${++n}`;
  return candidate;
}

/**
 * Create or update one construction of a draft revision, with its limits and process parameters.
 * data: {material_id, section, shape_id, destination_id, coated, label, wires, wire_d, die, iec_exception_reason,
 *        limits:[{level,quantity,nominal,min,max,informative,tolerance_text,unit}], params:[{strander_config,rotor,pitch_mm,tension}]}
 */
function saveConstruction(db, user, revisionId, constructionId, data) {
  return db.tx(() => {
    const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
    if (!rev) return refuse('not_found');
    const doc = db.get('SELECT * FROM spec_documents WHERE id = ?', rev.document_id);
    const c0 = claimForEdit(db, rev, user);
    if (!c0.ok) return c0;
    const family = familyOf(db, doc.family_id);
    const mat = db.get('SELECT * FROM materials WHERE id = ?', data.material_id);
    const shape = db.get('SELECT * FROM shapes WHERE id = ?', data.shape_id);
    const dest = data.destination_id ? db.get('SELECT * FROM destinations WHERE id = ?', data.destination_id) : null;
    if (!mat || !shape) return refuse('invalid');
    let id = constructionId;
    if (id) {
      const ex = db.get('SELECT * FROM constructions WHERE id = ? AND revision_id = ?', id, revisionId);
      if (!ex) return refuse('not_found');
      db.run(
        'UPDATE constructions SET material_id=?, section=?, shape_id=?, destination_id=?, coated=?, label=?, wires=?, wire_d=?, die=?, iec_exception_reason=?, data=COALESCE(?, data) WHERE id = ?',
        data.material_id, data.section, data.shape_id, data.destination_id || null, data.coated ? 1 : 0, data.label, data.wires, data.wire_d, data.die, data.iec_exception_reason || null, data.data ? JSON.stringify(data.data) : null, id);
    } else {
      const key = stableKeyFor(db, revisionId, family, mat.code, data.section, shape.code, data.coated, dest && dest.name);
      const sort = (db.value('SELECT max(sort) FROM constructions WHERE revision_id = ?', revisionId) || 0) + 1;
      id = db.run(
        'INSERT INTO constructions(revision_id, stable_key, family_id, material_id, section, shape_id, destination_id, coated, label, wires, wire_d, die, data, iec_exception_reason, active, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)',
        revisionId, key, family.id, data.material_id, data.section, data.shape_id, data.destination_id || null, data.coated ? 1 : 0, data.label, data.wires, data.wire_d, data.die, data.data ? JSON.stringify(data.data) : '{}', data.iec_exception_reason || null, sort).id;
    }
    db.run('DELETE FROM limits WHERE construction_id = ?', id);
    for (const l of data.limits || []) {
      db.run('INSERT INTO limits(construction_id, level, quantity, nominal, min, max, unit, informative, tolerance_text) VALUES (?,?,?,?,?,?,?,?,?)',
        id, l.level, l.quantity, l.nominal, l.min, l.max, l.unit, l.informative ? 1 : 0, l.tolerance_text || null);
    }
    db.run('DELETE FROM process_params WHERE construction_id = ?', id);
    for (const p of data.params || []) {
      db.run('INSERT INTO process_params(construction_id, strander_config, rotor, pitch_mm, tension) VALUES (?,?,?,?,?)', id, p.strander_config, p.rotor, p.pitch_mm, p.tension);
    }
    audit.log(db, user.id, constructionId ? 'construction_edit' : 'construction_add', 'constructions', id, { revision_id: revisionId, label: data.label });
    return { ok: true, id };
  });
}

function setConstructionActive(db, user, revisionId, constructionId, active) {
  return db.tx(() => {
    const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
    if (!rev) return refuse('not_found');
    const c0 = claimForEdit(db, rev, user);
    if (!c0.ok) return c0;
    const r = db.run('UPDATE constructions SET active = ? WHERE id = ? AND revision_id = ?', active ? 1 : 0, constructionId, revisionId);
    if (!r.changes) return refuse('not_found');
    audit.log(db, user.id, active ? 'construction_activate' : 'construction_deactivate', 'constructions', constructionId, { revision_id: revisionId });
    return { ok: true };
  });
}

function submit(db, user, revisionId) {
  return db.tx(() => {
    const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
    if (!rev) return refuse('not_found');
    if (rev.status !== 'ciorna') return refuse('not_draft');
    if (rev.elaborated_by && rev.elaborated_by !== user.id) return refuse('not_author');
    const findings = checkRevision(db, revisionId);
    if (hasErrors(findings)) return { ok: false, code: 'iec_errors', findings };
    const now = nowIso();
    db.run("UPDATE spec_revisions SET status = 'in_verificare', submitted_at = ?, elaborated_by = ?, elaborated_at = COALESCE(elaborated_at, ?) WHERE id = ?", now, user.id, now, revisionId);
    audit.log(db, user.id, 'revision_submit', 'spec_revisions', revisionId, {});
    return { ok: true };
  });
}

/** Second engineer verifies and activates; the previous active revision is archived. */
function verify(db, user, revisionId) {
  return db.tx(() => {
    const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
    if (!rev) return refuse('not_found');
    if (rev.status !== 'in_verificare') return refuse('not_in_verification');
    if (user.role !== 'inginer') return refuse('forbidden');
    if (rev.elaborated_by === user.id) return refuse('author_cannot_verify');
    const findings = checkRevision(db, revisionId);
    if (hasErrors(findings)) return { ok: false, code: 'iec_errors', findings };
    const now = nowIso();
    const prev = db.get("SELECT id FROM spec_revisions WHERE document_id = ? AND status = 'activa'", rev.document_id);
    if (prev) db.run("UPDATE spec_revisions SET status = 'arhivata', archived_at = ? WHERE id = ?", now, prev.id);
    db.run("UPDATE spec_revisions SET status = 'activa', verified_by = ?, verified_at = ?, activated_at = ? WHERE id = ?", user.id, now, now, revisionId);
    audit.log(db, user.id, 'revision_verify', 'spec_revisions', revisionId, { archived: prev ? prev.id : null });
    return { ok: true };
  });
}

function reject(db, user, revisionId, reason) {
  return db.tx(() => {
    const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
    if (!rev) return refuse('not_found');
    if (rev.status !== 'in_verificare') return refuse('not_in_verification');
    if (user.role !== 'inginer') return refuse('forbidden');
    if (rev.elaborated_by === user.id) return refuse('author_cannot_verify');
    if (!reason || !reason.trim()) return refuse('reason_required');
    db.run("UPDATE spec_revisions SET status = 'ciorna', rejected_by = ?, rejected_at = ?, rejected_reason = ?, submitted_at = NULL WHERE id = ?", user.id, nowIso(), reason.trim(), revisionId);
    audit.log(db, user.id, 'revision_reject', 'spec_revisions', revisionId, { reason: reason.trim() });
    return { ok: true };
  });
}

/** Mean, min, max, std deviation of measured values for constructions with an undetermined limit (spec §2). */
function statsForKey(db, stableKey, quantity) {
  const rows = db.all(
    `SELECT r.value FROM measurement_results r
       JOIN measurements m ON m.id = r.measurement_id AND m.is_current = 1
       JOIN constructions c ON c.id = m.construction_id
      WHERE c.stable_key = ? AND r.quantity = ?`, stableKey, quantity).map((r) => r.value);
  if (!rows.length) return null;
  const n = rows.length;
  const mean = rows.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(rows.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  return { n, mean, min: Math.min(...rows), max: Math.max(...rows), sd };
}

module.exports = {
  familyOf, specFamilyOf, docFamilyActive, loadRevision, loadConstructions, activeRevisionId, flatten, diffAgainst, checkRevision, hasErrors,
  newRevision, updateHeader, saveConstruction, setConstructionActive, submit, verify, reject, statsForKey,
};
