'use strict';
const { page, redirect } = require('../lib/http');
const M = require('../domain/measurements');
const rev = require('../domain/revisions');
const views = require('../views/measure');
const { errorPage } = require('../views/errors');

function activeLists(db) {
  return {
    operators: db.all('SELECT * FROM operators WHERE active = 1 ORDER BY full_name'),
    clients: db.all('SELECT * FROM clients WHERE active = 1 ORDER BY short_name'),
    sampleTypes: db.all('SELECT * FROM sample_types WHERE active = 1 ORDER BY sort, name'),
  };
}

function stateFromForm(form) {
  const values = {};
  for (const k of M.INPUT_KEYS) if (form.has(k)) values[k] = form.get(k);
  const meta = {
    machine_id: form.int('machine_id'), operator_id: form.int('operator_id'), client_id: form.int('client_id'), sample_type_id: form.int('sample_type_id'),
    length_no: form.get('length_no'), produced_length_m: form.get('produced_length_m'), notes: form.get('notes'),
  };
  return { values, meta };
}

module.exports = function register(app) {
  const { router, db } = app;

  function newContext(query, formState) {
    const families = db.all('SELECT * FROM product_families WHERE active = 1 ORDER BY sort');
    const int = (k) => (/^\d+$/.test(query.get(k) || '') ? Number(query.get(k)) : null);
    const family = families.find((x) => x.id === int('family')) || null;
    if (family) { family.levels = JSON.parse(family.levels); family.measures = JSON.parse(family.measures); }
    const machines = family ? M.machinesFor(db, family.id) : [];
    const machine = machines.find((x) => x.id === int('machine')) || null;
    const constructions = machine ? M.constructionsFor(db, family, machine) : [];
    const construction = constructions.find((x) => x.id === int('construction')) || null;
    const d = { families, machines, constructions, family_id: family && family.id, machine_id: machine && machine.id, construction_id: construction && construction.id, sel: null, model: null, levels: [], level: null };
    if (construction) {
      // flexible conductors are measured per level: suviță, toron (if the row has strands), liță
      d.levels = family.levels.filter((l) => l !== 'toron' || M.toronCount(construction) > 0);
      d.level = d.levels.length === 1 ? d.levels[0] : (d.levels.includes(query.get('level')) ? query.get('level') : null);
    }
    if (construction && d.level) {
      const revision = db.get('SELECT * FROM spec_revisions WHERE id = ?', construction.revision_id);
      const doc = db.get('SELECT * FROM spec_documents WHERE id = ?', revision.document_id);
      d.sel = { family, machine, construction, revision, doc, level: d.level };
      d.model = M.formModel(db, construction, family, d.level);
      const cur = M.currentShift(db);
      const lists = activeLists(db);
      const first = lists.sampleTypes[0];
      const st = formState || { values: {}, meta: {} };
      d.form = {
        values: st.values, errors: st.errors || null, action: '/masuratori/nou', cancelHref: '/',
        meta: { sample_type_id: first ? first.id : null, ...st.meta },
        lists: { ...lists, machines },
        lengthProposal: M.proposeLengthNo(db, { machineId: machine.id, shiftDate: cur.shift_date, shift: cur.shift, stableKey: construction.stable_key }),
      };
    }
    return d;
  }

  router.get('/masuratori/nou', {}, (ctx) => page(views.newPage(ctx, newContext(ctx.query))));

  router.post('/masuratori/nou', {}, (ctx) => {
    const r = M.create(db, ctx.user, ctx.form);
    if (r.ok) return redirect(`/masuratori/${r.recordNo}`, { flash: { key: r.warnings.includes('temp_range') ? 'measurement_saved_temp' : 'measurement_saved', type: r.warnings.includes('temp_range') ? 'err' : 'ok' } });
    const q = new URLSearchParams({ family: ctx.form.get('family_id'), machine: ctx.form.get('machine_id'), construction: ctx.form.get('construction_id'), level: ctx.form.get('level') });
    const state = { ...stateFromForm(ctx.form), errors: r.errors };
    return page(views.newPage(ctx, newContext(q, state)), 422);
  });

  router.get('/masuratori', {}, (ctx) => {
    const q = ctx.query;
    const int = (k) => (/^\d+$/.test(q.get(k) || '') ? Number(q.get(k)) : null);
    const date = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(q.get(k) || '') ? q.get(k) : '');
    const filters = {
      from: date('from'), to: date('to'), shift: ['zi', 'noapte'].includes(q.get('shift')) ? q.get('shift') : '',
      crew_id: int('crew_id'), family_id: int('family_id'), machine_id: int('machine_id'), operator_id: int('operator_id'),
      client_id: int('client_id'), sample_type_id: int('sample_type_id'), q: (q.get('q') || '').trim().slice(0, 60),
      out: q.get('out') === '1', all_versions: q.get('all_versions') === '1',
    };
    const data = M.register(db, filters, int('pagina') || 1);
    const lists = {
      crews: db.all('SELECT * FROM crews ORDER BY name'), families: db.all('SELECT * FROM product_families ORDER BY sort'),
      machines: db.all('SELECT * FROM machines ORDER BY name'), operators: db.all('SELECT * FROM operators ORDER BY full_name'),
      clients: db.all('SELECT * FROM clients ORDER BY short_name'), sampleTypes: db.all('SELECT * FROM sample_types ORDER BY sort, name'),
    };
    return page(views.registerPage(ctx, { data, filters, lists }));
  });

  router.get('/masuratori/:no', {}, (ctx) => {
    const no = /^\d+$/.test(ctx.params.no) ? Number(ctx.params.no) : 0;
    const versions = M.record(db, no);
    if (!versions.length) return page(errorPage(ctx, 'not_found'), 404);
    const can = M.canCorrect(db, ctx.user, no);
    return page(views.detailPage(ctx, { versions, canCorrect: can.ok, denied: can.code }));
  });

  function correctionContext(no, user, formState) {
    const can = M.canCorrect(db, user, no);
    if (!can.ok) return { denied: can.code };
    const cur = can.current;
    const family = rev.familyOf(db, cur.family_id);
    const construction = db.get('SELECT c.*, m.code AS material_code FROM constructions c JOIN materials m ON m.id = c.material_id WHERE c.id = ?', cur.construction_id);
    const versions = M.record(db, no);
    const v = versions.find((x) => x.is_current);
    const lists = activeLists(db);
    // keep the record's own values selectable even if they were deactivated since
    for (const [key, id] of [['operators', v.operator_id], ['clients', v.client_id]]) {
      if (id && !lists[key].some((x) => x.id === id)) lists[key].push(db.get(`SELECT * FROM ${key} WHERE id = ?`, id));
    }
    if (!lists.sampleTypes.some((x) => x.id === v.sample_type_id)) lists.sampleTypes.push(db.get('SELECT * FROM sample_types WHERE id = ?', v.sample_type_id));
    const machines = M.machinesFor(db, cur.family_id);
    if (!machines.some((x) => x.id === cur.machine_id)) machines.push(db.get('SELECT * FROM machines WHERE id = ?', cur.machine_id));
    const st = formState || {
      values: v.inputs,
      meta: { machine_id: cur.machine_id, operator_id: cur.operator_id, client_id: cur.client_id, sample_type_id: cur.sample_type_id, length_no: cur.length_no, produced_length_m: cur.produced_length_m, notes: cur.notes },
    };
    return {
      current: cur,
      sel: { family, construction, level: cur.level },
      model: M.formModel(db, construction, family, cur.level),
      form: {
        values: st.values, meta: st.meta, errors: st.errors || null, action: `/masuratori/${no}/corecteaza`, cancelHref: `/masuratori/${no}`,
        correction: true, editReason: st.editReason || '', lists: { ...lists, machines }, lengthProposal: cur.length_no || 1,
      },
    };
  }

  router.get('/masuratori/:no/corecteaza', {}, (ctx) => {
    const no = /^\d+$/.test(ctx.params.no) ? Number(ctx.params.no) : 0;
    if (!db.get('SELECT 1 FROM measurements WHERE record_no = ?', no)) return page(errorPage(ctx, 'not_found'), 404);
    const c = correctionContext(no, ctx.user);
    if (c.denied) return page(errorPage(ctx, 'forbidden'), 403);
    return page(views.correctPage(ctx, c));
  });

  router.post('/masuratori/:no/corecteaza', {}, (ctx) => {
    const no = /^\d+$/.test(ctx.params.no) ? Number(ctx.params.no) : 0;
    if (!db.get('SELECT 1 FROM measurements WHERE record_no = ?', no)) return page(errorPage(ctx, 'not_found'), 404);
    const r = M.correct(db, ctx.user, no, ctx.form);
    if (r.denied) return page(errorPage(ctx, 'forbidden'), 403);
    if (r.ok) return redirect(`/masuratori/${no}`, { flash: { key: 'measurement_corrected' } });
    const c = correctionContext(no, ctx.user, { ...stateFromForm(ctx.form), errors: r.errors, editReason: ctx.form.get('edit_reason') });
    return page(views.correctPage(ctx, c), 422);
  });
};
