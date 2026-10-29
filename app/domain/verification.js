'use strict';
// Checking a data sheet against its paper original, row by row. For every active construction the engineer either types the
// values read from the paper (the app compares them with the sheet) or ticks the row after looking. Informational: it never
// blocks submitting or activating, but the revision page shows how many rows were checked. Saving a row clears its mark.
const calc = require('./calc');
const audit = require('./audit');
const { nowIso } = require('../lib/time');

const OPEN = ['ciorna', 'in_verificare'];
const same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The values of a row that exist on the paper: wires, wire Ø, strands, and every nominal / min / max of its limits. */
function checkpoints(c) {
  const out = [];
  const add = (cp) => { if (cp.value !== null && cp.value !== undefined && Number.isFinite(Number(cp.value))) out.push({ ...cp, value: Number(cp.value) }); };
  add({ kind: 'wires', value: c.wires });
  add({ kind: 'wire_d', unit: 'mm', value: c.wire_d });
  const d = c.data || {};
  add({ kind: 'strands', value: d.nr_toroane });
  add({ kind: 'wires_per_strand', value: d.nr_fire_toron });
  for (const l of c.limits || []) {
    for (const part of ['nominal', 'min', 'max']) add({ kind: 'limit', level: l.level, quantity: l.quantity, part, unit: l.unit, value: l[part] });
  }
  return out;
}

/** Compare what was typed (key paper_<i> in `form`) with the sheet. @returns {{typed, mismatched, unreadable}} */
function compare(points, form) {
  let typed = 0; const mismatched = []; const unreadable = [];
  points.forEach((p, i) => {
    const raw = String(form.get(`paper_${i}`) || '').trim();
    if (!raw) return;
    typed++;
    const v = calc.parseDecimal(raw);
    if (v === null) unreadable.push(i); else if (!same(v, p.value)) mismatched.push(i);
  });
  return { typed, mismatched, unreadable };
}

function map(db, revisionId) {
  const m = new Map();
  for (const r of db.all(`SELECT k.*, u.full_name AS by_name FROM construction_checks k JOIN users u ON u.id = k.checked_by WHERE k.revision_id = ?`, revisionId)) m.set(r.construction_id, r);
  return m;
}

function progress(db, revisionId) {
  const total = db.value('SELECT count(*) FROM constructions WHERE revision_id = ? AND active = 1', revisionId);
  const checked = db.value('SELECT count(*) FROM construction_checks k JOIN constructions c ON c.id = k.construction_id WHERE k.revision_id = ? AND c.active = 1', revisionId);
  return { total, checked, remaining: total - checked };
}

/** Tick a row. */
function mark(db, user, revisionId, constructionId, method, note) {
  const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
  if (!rev || !OPEN.includes(rev.status)) return { ok: false, code: 'verify_closed' };
  const c = db.get('SELECT id FROM constructions WHERE id = ? AND revision_id = ? AND active = 1', constructionId, revisionId);
  if (!c) return { ok: false, code: 'not_found' };
  db.run(`INSERT INTO construction_checks(construction_id, revision_id, checked_by, checked_at, method, note) VALUES (?,?,?,?,?,?)
    ON CONFLICT(construction_id) DO UPDATE SET checked_by = excluded.checked_by, checked_at = excluded.checked_at, method = excluded.method, note = excluded.note`,
    constructionId, revisionId, user.id, nowIso(), method === 'typed' ? 'typed' : 'visual', note ? String(note).trim().slice(0, 300) : null);
  audit.log(db, user.id, 'row_check', 'constructions', constructionId, { method });
  return { ok: true };
}

function unmark(db, user, revisionId, constructionId) {
  const rev = db.get('SELECT * FROM spec_revisions WHERE id = ?', revisionId);
  if (!rev || !OPEN.includes(rev.status)) return { ok: false, code: 'verify_closed' };
  db.run('DELETE FROM construction_checks WHERE construction_id = ? AND revision_id = ?', constructionId, revisionId);
  audit.log(db, user.id, 'row_uncheck', 'constructions', constructionId, {});
  return { ok: true };
}

/** The row after `currentId` that is not checked yet (wrapping round), or null when all are. */
function nextUnchecked(db, revisionId, currentId) {
  const rows = db.all(`SELECT c.id, (k.construction_id IS NOT NULL) AS done FROM constructions c LEFT JOIN construction_checks k ON k.construction_id = c.id
    WHERE c.revision_id = ? AND c.active = 1 ORDER BY c.sort, c.id`, revisionId);
  const at = rows.findIndex((r) => r.id === currentId);
  const order = rows.slice(at + 1).concat(rows.slice(0, at + 1));
  const hit = order.find((r) => !r.done && r.id !== currentId);
  return hit ? hit.id : null;
}

module.exports = { OPEN, checkpoints, compare, map, progress, mark, unmark, nextUnchecked };
