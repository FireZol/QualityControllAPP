'use strict';
// Batch test certificates and type test reports.
// An issued batch certificate is a frozen snapshot (never recomputed): a later correction of a measurement does not change it,
// a corrected batch gets a new certificate that supersedes the old one.
const calc = require('./calc');
const audit = require('./audit');
const tests = require('./tests');
const batches = require('./batches');
const settings = require('./settings');
const { nowIso } = require('../lib/time');
const { S } = require('../i18n');

const OUT = ['sub', 'peste', 'neconform'];

function limitText(q, min, max) {
  const f = (v) => calc.formatQuantity(q, v);
  if (min === null && max === null) return '';
  if (min !== null && max !== null) return `${f(min)} … ${f(max)}`;
  return min !== null ? `≥ ${f(min)}` : `≤ ${f(max)}`;
}

/** Rows of a certificate / report from measurement results, in catalogue order. */
function rowsFrom(db, meas, drumsById) {
  const cat = new Map(tests.catalogue().map((t) => [t.code, t]));
  const out = [];
  let hidden = 0;
  for (const m of meas) {
    for (const r of m.results || []) {
      // values without a requirement on the data sheet stay in the records but are not printed on a certificate
      if (r.verdict === 'nedeterminat') { hidden++; continue; }
      const code = r.quantity.replace(/_(avg|min|max)$/, '');
      const t = cat.get(code) || cat.get(r.quantity);
      out.push({
        scope: t ? t.scope : 'sample', sort: t ? t.sort : 9999, code, test: tests.label(r.quantity), unit: t && t.kind !== 'passfail' ? (t.unit || '') : '',
        drum: m.drum_id ? (drumsById.get(m.drum_id) || {}).drum_no || null : null,
        value: calc.formatQuantity(r.quantity, r.value), limit: t && t.kind === 'passfail' ? S.cable.pass : (r.verdict === 'info' ? '' : limitText(r.quantity, r.lim_min, r.lim_max)), verdict: r.verdict,
        deviation: r.deviation_pct, external: t ? !t.in_house : false, record_no: m.record_no, when: m.created_at, machine: m.machine_name, user: m.user_name,
      });
    }
  }
  const scopeOrder = { routine: 0, sample: 1, type: 2 };
  out.hidden = hidden;
  out.sort((a, b) => scopeOrder[a.scope] - scopeOrder[b.scope] || String(a.drum || '').localeCompare(String(b.drum || ''), 'ro', { numeric: true }) || a.sort - b.sort || a.record_no - b.record_no);
  return out;
}

/** The content of a batch certificate as of now. */
function build(db, batchId) {
  const o = batches.overview(db, batchId);
  if (!o) return null;
  const drumsById = new Map(o.drums.map((d) => [d.id, d]));
  const rows = rowsFrom(db, o.measurements, drumsById);
  const out = rows.filter((r) => OUT.includes(r.verdict));
  const client = o.batch.client_name || null;
  return {
    company: settings.get(db, 'company.name'),
    batch: { batch_no: o.batch.batch_no, order_no: o.batch.order_no, client, standard: o.batch.standard, produced_length_m: o.batch.produced_length_m, produced_on: o.batch.produced_on, status: o.batch.status },
    design: { label: o.design.label, material: o.design.material_code, section: o.design.section, data: o.design.data },
    sheet: { title: o.revision.doc_title, code: o.revision.doc_code, edition: o.revision.edition, revision: o.revision.revision },
    drums: o.drums.map((d) => ({ drum_no: d.drum_no, length_m: d.length_m })),
    rows,
    missing: o.missing.map((m) => ({ test: m.test.name, scope: m.test.scope, drum: m.drum ? m.drum.drum_no : null })),
    conforming: rows.length > 0 && !out.length, out_count: out.length, row_count: rows.length, hidden_count: rows.hidden || 0,
  };
}

const certNo = (db, when) => {
  const year = when.slice(0, 4);
  const n = (db.value("SELECT count(*) FROM batch_certificates WHERE cert_no LIKE ?", `CERT-${year}-%`) || 0) + 1;
  return `CERT-${year}-${String(n).padStart(4, '0')}`;
};

/** Freeze the certificate of a batch. A non-conforming batch needs an override reason (printed on the certificate). */
function issue(db, user, batchId, overrideReason) {
  return db.tx(() => {
    const snap = build(db, batchId);
    if (!snap) return { ok: false, code: 'not_found' };
    if (!snap.row_count) return { ok: false, code: 'no_results' };
    if (!snap.conforming && !(overrideReason && overrideReason.trim())) return { ok: false, code: 'override_required', snapshot: snap };
    const now = nowIso();
    const prev = db.get('SELECT id FROM batch_certificates WHERE batch_id = ? ORDER BY id DESC', batchId);
    const no = certNo(db, now);
    snap.issued_by = user.full_name;
    snap.issued_at = now;
    snap.cert_no = no;
    snap.override_reason = snap.conforming ? null : overrideReason.trim();
    const id = db.run('INSERT INTO batch_certificates(batch_id, cert_no, issued_at, issued_by, conforming, override_reason, supersedes_id, snapshot) VALUES (?,?,?,?,?,?,?,?)',
      batchId, no, now, user.id, snap.conforming ? 1 : 0, snap.override_reason, prev ? prev.id : null, JSON.stringify(snap)).id;
    audit.log(db, user.id, 'certificate_issue', 'batch_certificates', id, { cert_no: no, batch_id: batchId, conforming: snap.conforming, supersedes: prev ? prev.id : null });
    return { ok: true, id, cert_no: no };
  });
}

function get(db, id) {
  const c = db.get('SELECT c.*, u.full_name AS issued_by_name, b.batch_no FROM batch_certificates c JOIN users u ON u.id = c.issued_by JOIN batches b ON b.id = c.batch_id WHERE c.id = ?', id);
  if (!c) return null;
  c.snapshot = JSON.parse(c.snapshot);
  const later = db.get('SELECT cert_no FROM batch_certificates WHERE supersedes_id = ?', id);
  c.superseded_by = later ? later.cert_no : null;
  return c;
}

/** Type test report of a cable design: the latest current type-test results without a batch. */
function typeReport(db, constructionId) {
  const design = db.get('SELECT c.*, m.code AS material_code FROM constructions c JOIN materials m ON m.id = c.material_id WHERE c.id = ?', constructionId);
  if (!design) return null;
  design.data = JSON.parse(design.data || '{}');
  const revision = db.get('SELECT r.*, d.code AS doc_code, d.title AS doc_title FROM spec_revisions r JOIN spec_documents d ON d.id = r.document_id WHERE r.id = ?', design.revision_id);
  const meas = db.all(`SELECT m.id, m.record_no, m.drum_id, m.created_at, m.notes, mc.name AS machine_name, u.full_name AS user_name
    FROM measurements m JOIN machines mc ON mc.id = m.machine_id JOIN users u ON u.id = m.created_by
    JOIN constructions cc ON cc.id = m.construction_id
    WHERE cc.stable_key = ? AND m.batch_id IS NULL AND m.is_current = 1 ORDER BY m.created_at, m.id`, design.stable_key);
  const results = meas.length ? db.all(`SELECT * FROM measurement_results WHERE measurement_id IN (${meas.map(() => '?').join(',')}) ORDER BY rowid`, ...meas.map((m) => m.id)) : [];
  const by = new Map(meas.map((m) => [m.id, m]));
  for (const r of results) { const m = by.get(r.measurement_id); (m.results = m.results || []).push(r); }
  const rows = rowsFrom(db, meas, new Map());
  const out = rows.filter((r) => OUT.includes(r.verdict));
  return { company: settings.get(db, 'company.name'), design, revision, rows, notes: meas.filter((m) => m.notes).map((m) => ({ record_no: m.record_no, notes: m.notes })), conforming: rows.length > 0 && !out.length, out_count: out.length };
}

module.exports = { build, issue, get, typeReport, rowsFrom, OUT };
