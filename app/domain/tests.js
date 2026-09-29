'use strict';
// Finished-cable tests: the catalogue (editable), how a cable data sheet's limits attach to it, labels and display rules.
const calc = require('./calc');
const iec = require('./iec');
const audit = require('./audit');
const { S } = require('../i18n/ro');

const KINDS = ['numeric', 'readings', 'passfail', 'resistance'];
const SCOPES = ['routine', 'sample', 'type'];

/** The result quantities a test produces (and therefore the limit rows a cable data sheet can carry). */
function quantitiesOf(t) {
  if (t.kind === 'readings') return [[`${t.code}_avg`, 'avg'], [`${t.code}_min`, 'min'], [`${t.code}_max`, 'max']];
  if (t.kind === 'passfail') return [];
  return [[t.code, null]];
}

let CATALOGUE = [];
let LABELS = {};

/** Reload the catalogue into the process-wide display registry (call at start-up and after every catalogue change). */
function refresh(db) {
  CATALOGUE = db.all('SELECT * FROM test_types ORDER BY sort, id');
  LABELS = {};
  const formats = {};
  for (const t of CATALOGUE) {
    formats[t.code] = { kind: t.kind, decimals: t.decimals };
    for (const [q, part] of quantitiesOf(t)) LABELS[q] = part ? `${t.name} — ${S.tests.parts[part]}` : t.name;
    if (t.kind === 'passfail') LABELS[t.code] = t.name;
  }
  calc.registerQuantities(formats);
  return CATALOGUE;
}

const catalogue = () => CATALOGUE;
const active = () => CATALOGUE.filter((t) => t.active);

/** Label of any result quantity: built-in quantities first, then the catalogue. */
function label(q) {
  if (Object.prototype.hasOwnProperty.call(S.quantity, q)) return S.quantity[q];
  return LABELS[q] || q;
}

/** Label of a typed input key (d1, mass_g ... or t_<code>[_unit|_len|_temp]). */
function inputLabel(key) {
  if (Object.prototype.hasOwnProperty.call(S.input, key)) return S.input[key];
  if (!key.startsWith('t_')) return key;
  const code = key.slice(2).replace(/_(unit|len|temp)$/, '');
  const t = CATALOGUE.find((x) => x.code === code);
  const suffix = key.slice(2).slice(code.length + 1);
  return (t ? t.name : code) + (suffix ? ` (${S.cable.suffix[suffix]})` : '');
}

/** {quantity: label} for the tests in the given list (sent to the browser preview). */
function labelsFor(tests) {
  const o = {};
  for (const t of tests) for (const [q] of (t.kind === 'passfail' ? [[t.code]] : quantitiesOf(t))) o[q] = label(q);
  return o;
}

function formatsFor(tests) {
  const o = {};
  for (const t of tests) o[t.code] = { kind: t.kind, decimals: t.decimals };
  return o;
}

/**
 * Evaluation context for a cable design (a construction of the CABLU_LV sheet).
 * The conductor resistance limit: the sheet's own value for the test code when set, else IEC 60228 for the design's conductor class.
 */
/** Which tests apply to a design: by session (batch = routine + sample, type = type tests) and by the compounds it uses. */
function forDesign(list, data, mode) {
  const scopes = mode === 'type' ? ['type'] : ['routine', 'sample'];
  const compounds = [data.insulation, data.sheath].filter(Boolean).map((c) => String(c).toUpperCase());
  return list.filter((t) => scopes.includes(t.scope) && (!t.applies_to || t.applies_to.split(',').some((c) => compounds.includes(c.trim().toUpperCase()))));
}

function cableContext(db, construction, family, mode, tests) {
  const dataRow = typeof construction.data === 'string' ? JSON.parse(construction.data || '{}') : (construction.data || {});
  const list = tests || forDesign(active(), dataRow, mode || 'batch');
  const material = db.get('SELECT rho20, density, alpha20, code FROM materials WHERE id = ?', construction.material_id);
  const limits = {};
  for (const l of db.all("SELECT * FROM limits WHERE construction_id = ? AND level = 'cablu'", construction.id)) {
    limits[l.quantity] = { min: l.min, max: l.max, nominal: l.nominal, informative: !!l.informative, unit: l.unit };
  }
  const data = typeof construction.data === 'string' ? JSON.parse(construction.data || '{}') : (construction.data || {});
  const cls = [1, 2, 5].includes(Number(data.conductor_class)) ? Number(data.conductor_class) : 2;
  const r = iec.resistanceLimit(db, cls, material.code, construction.section, construction.coated);
  return {
    testsMode: true, mode: mode || 'batch', tests: list, limits, material, iec: r, level: 'cablu', measuresMass: false, measuresDiameter: false, measuresR: false,
    shapeKind: 'rotund', targets: require('./targets').get(db), data,
  };
}

/** Tests the design's data sheet requires (data.tests) among those applicable to it; falls back to the ones that carry a limit. */
function requiredTests(ctx, data) {
  const codes = Array.isArray(data.tests) ? data.tests : null;
  if (codes) return ctx.tests.filter((t) => codes.includes(t.code));
  return definedFor(ctx.tests, ctx.limits).filter((t) => t.kind !== 'passfail' || false);
}

/** "≥ 0,80" style summary of the limits a design defines for one test (empty when none). */
function limitSummary(t, limits) {
  const out = [];
  for (const [q, part] of quantitiesOf(t)) {
    const l = limits[q];
    if (!l || (l.min === null && l.max === null) || l.informative) continue;
    const fmt = (v) => calc.formatQuantity(q, v);
    let txt;
    if (l.min !== null && l.max !== null) txt = `${fmt(l.min)} … ${fmt(l.max)}`;
    else if (l.min !== null) txt = `≥ ${fmt(l.min)}`;
    else txt = `≤ ${fmt(l.max)}`;
    out.push(part ? `${S.tests.parts[part]} ${txt}` : txt);
  }
  return out.join('; ');
}

/** Tests the design defines a limit for (or that never carry one: pass / fail). */
function definedFor(tests, limits) {
  return tests.filter((t) => t.kind === 'passfail' || quantitiesOf(t).some(([q]) => limits[q] && (limits[q].min !== null || limits[q].max !== null || limits[q].informative)) || (t.kind === 'resistance'));
}

// ---------- catalogue editing ----------

const RE_CODE = /^[a-z][a-z0-9_]{1,39}$/;

function validate(db, form, { creating }) {
  const errors = {}, v = {};
  v.name = form.get('name', '').trim();
  if (!v.name) errors.name = 'required'; else if (v.name.length > 120) errors.name = 'too_long';
  v.unit = form.get('unit', '').trim().slice(0, 20) || null;
  const dec = form.get('decimals', '').trim();
  v.decimals = dec === '' ? 2 : Number(dec);
  if (!Number.isInteger(v.decimals) || v.decimals < 0 || v.decimals > 6) errors.decimals = 'invalid';
  v.scope = form.get('scope');
  if (!SCOPES.includes(v.scope)) errors.scope = 'invalid';
  v.standard_ref = form.get('standard_ref', '').trim().slice(0, 120) || null;
  const sort = form.get('sort', '').trim();
  v.sort = sort === '' ? 0 : Number(sort);
  if (!Number.isInteger(v.sort) || v.sort < 0 || v.sort > 100000) errors.sort = 'invalid';
  v.active = form.bool('active') ? 1 : 0;
  v.in_house = form.bool('in_house') ? 1 : 0;
  const known = db.all('SELECT code FROM compounds').map((r) => r.code.toUpperCase());
  const wanted = form.get('applies_to', '').split(/[,\s;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (wanted.some((c) => !known.includes(c))) errors.applies_to = 'invalid';
  v.applies_to = [...new Set(wanted)].join(',');
  if (creating) {
    v.code = form.get('code', '').trim();
    if (!RE_CODE.test(v.code)) errors.code = 'invalid';
    v.kind = form.get('kind');
    if (!KINDS.includes(v.kind)) errors.kind = 'invalid';
  }
  return { errors, v };
}

function add(db, userId, v) {
  const id = db.tx(() => {
    const id = db.run('INSERT INTO test_types(code, name, kind, unit, decimals, scope, standard_ref, applies_to, in_house, active, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)', v.code, v.name, v.kind, v.unit, v.decimals, v.scope, v.standard_ref, v.applies_to, v.in_house, v.active, v.sort).id;
    audit.log(db, userId, 'test_type_add', 'test_types', id, v);
    return id;
  });
  refresh(db);
  return id;
}

function update(db, userId, id, v) {
  const before = db.get('SELECT * FROM test_types WHERE id = ?', id);
  if (!before) return false;
  db.tx(() => {
    db.run('UPDATE test_types SET name = ?, unit = ?, decimals = ?, scope = ?, standard_ref = ?, applies_to = ?, in_house = ?, active = ?, sort = ? WHERE id = ?', v.name, v.unit, v.decimals, v.scope, v.standard_ref, v.applies_to, v.in_house, v.active, v.sort, id);
    audit.log(db, userId, 'test_type_change', 'test_types', id, { before, after: v });
  });
  refresh(db);
  return true;
}

module.exports = { KINDS, SCOPES, inputLabel, requiredTests, forDesign, quantitiesOf, refresh, catalogue, active, label, labelsFor, formatsFor, cableContext, limitSummary, definedFor, validate, add, update };
