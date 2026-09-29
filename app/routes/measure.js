'use strict';
const { page, redirect } = require('../lib/http');
const M = require('../domain/measurements');
const rev = require('../domain/revisions');
const B = require('../domain/batches');
const cableViews = require('../views/cable');
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
  for (const k of form.params.keys()) if (/^t_[a-z0-9_]+$/.test(k)) values[k] = form.get(k);
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
    if (family && family.measures.tests) return cableContext(query, formState, families, family, machines, machine, int);
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

  /** Finished cable: pick a batch (and drum) for batch tests, or a cable design for type tests. */
  function cableContext(query, formState, families, family, machines, machine, int) {
    const batches = db.all("SELECT b.id, b.batch_no, c.label AS design_label FROM batches b JOIN constructions c ON c.id = b.construction_id WHERE b.status = 'deschis' ORDER BY b.id DESC");
    const batch = B.overview(db, int('batch') || 0) && db.get("SELECT * FROM batches WHERE id = ? AND status = 'deschis'", int('batch') || 0);
    const drums = batch ? db.all('SELECT * FROM drums WHERE batch_id = ? ORDER BY length(drum_no), drum_no', batch.id) : [];
    const drum = batch ? drums.find((x) => x.id === int('drum')) || null : null;
    const designs = B.designs(db);
    const design = batch ? designs.concat([db.get('SELECT * FROM constructions WHERE id = ?', batch.construction_id)]).find((x) => x && x.id === batch.construction_id) : designs.find((x) => x.id === int('design')) || null;
    const d = { cable: true, families, machines, batches, drums, designs, family_id: family.id, machine_id: machine && machine.id, batch_id: batch && batch.id, drum_id: drum && drum.id, design_id: !batch && design ? design.id : null, sel: null, model: null };
    if (machine && design) {
      design.data = typeof design.data === 'string' ? JSON.parse(design.data || '{}') : (design.data || {});
      const revision = db.get('SELECT * FROM spec_revisions WHERE id = ?', batch ? batch.revision_id : design.revision_id);
      const doc = db.get('SELECT * FROM spec_documents WHERE id = ?', revision.document_id);
      d.sel = { family, machine, construction: design, revision, doc, level: 'cablu', batch: batch || null, drum, mode: batch ? 'batch' : 'type' };
      d.model = M.formModel(db, design, family, 'cablu', d.sel.mode);
      const lists = activeLists(db);
      const want = d.sel.mode === 'batch' ? 'Încercare de rutină' : 'Încercare de tip';
      const dflt = lists.sampleTypes.find((s) => s.name === want) || lists.sampleTypes[0];
      const st = formState || { values: {}, meta: {} };
      d.form = { values: st.values, errors: st.errors || null, action: '/masuratori/nou', cancelHref: batch ? `/loturi/${batch.id}` : '/', meta: { sample_type_id: dflt ? dflt.id : null, client_id: batch ? batch.client_id : null, ...st.meta }, lists: { ...lists, machines } };
    }
    return d;
  }

  router.get('/masuratori/nou', {}, (ctx) => {
    const d = newContext(ctx.query);
    return page(d.cable ? cableViews.cableNewPage(ctx, d) : views.newPage(ctx, d));
  });

  router.post('/masuratori/nou', {}, (ctx) => {
    const r = M.create(db, ctx.user, ctx.form);
    if (r.ok && r.batchId) return redirect(`/masuratori/${r.recordNo}`, { flash: { key: 'measurement_saved' } });
    if (r.ok) return redirect(`/masuratori/${r.recordNo}`, { flash: { key: r.warnings.includes('temp_range') ? 'measurement_saved_temp' : 'measurement_saved', type: r.warnings.includes('temp_range') ? 'err' : 'ok' } });
    const q = new URLSearchParams({ family: ctx.form.get('family_id'), machine: ctx.form.get('machine_id'), construction: ctx.form.get('construction_id'), level: ctx.form.get('level'), batch: ctx.form.get('batch_id'), drum: ctx.form.get('drum_id'), design: ctx.form.get('construction_id') });
    const state = { ...stateFromForm(ctx.form), errors: r.errors };
    const d = newContext(q, state);
    return page(d.cable ? cableViews.cableNewPage(ctx, d) : views.newPage(ctx, d), 422);
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
    if (family.measures.tests) return cableCorrection(no, cur, family, formState);
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

  function cableCorrection(no, cur, family, formState) {
    const v = M.record(db, no).find((x) => x.is_current);
    const design = db.get('SELECT * FROM constructions WHERE id = ?', cur.construction_id);
    design.data = JSON.parse(design.data || '{}');
    const batch = cur.batch_id ? db.get('SELECT * FROM batches WHERE id = ?', cur.batch_id) : null;
    const drum = cur.drum_id ? db.get('SELECT * FROM drums WHERE id = ?', cur.drum_id) : null;
    const mode = batch ? 'batch' : 'type';
    const lists = activeLists(db);
    for (const [key, id] of [['operators', v.operator_id], ['clients', v.client_id]]) {
      if (id && !lists[key].some((x) => x.id === id)) lists[key].push(db.get(`SELECT * FROM ${key} WHERE id = ?`, id));
    }
    if (!lists.sampleTypes.some((x) => x.id === v.sample_type_id)) lists.sampleTypes.push(db.get('SELECT * FROM sample_types WHERE id = ?', v.sample_type_id));
    const machines = M.machinesFor(db, cur.family_id);
    if (!machines.some((x) => x.id === cur.machine_id)) machines.push(db.get('SELECT * FROM machines WHERE id = ?', cur.machine_id));
    const st = formState || { values: v.inputs, meta: { machine_id: cur.machine_id, operator_id: cur.operator_id, client_id: cur.client_id, sample_type_id: cur.sample_type_id, notes: cur.notes } };
    return {
      cable: true, current: cur, machineName: (machines.find((x) => x.id === cur.machine_id) || {}).name,
      sel: { family, construction: design, level: 'cablu', batch, drum, mode, machine: { name: '' } },
      model: M.formModel(db, design, family, 'cablu', mode),
      form: { values: st.values, meta: st.meta, errors: st.errors || null, action: `/masuratori/${no}/corecteaza`, cancelHref: `/masuratori/${no}`, correction: true, editReason: st.editReason || '', lists: { ...lists, machines } },
    };
  }

  router.get('/masuratori/:no/corecteaza', {}, (ctx) => {
    const no = /^\d+$/.test(ctx.params.no) ? Number(ctx.params.no) : 0;
    if (!db.get('SELECT 1 FROM measurements WHERE record_no = ?', no)) return page(errorPage(ctx, 'not_found'), 404);
    const c = correctionContext(no, ctx.user);
    if (c.denied) return page(errorPage(ctx, 'forbidden'), 403);
    return page(c.cable ? cableViews.cableCorrectPage(ctx, c) : views.correctPage(ctx, c));
  });

  router.post('/masuratori/:no/corecteaza', {}, (ctx) => {
    const no = /^\d+$/.test(ctx.params.no) ? Number(ctx.params.no) : 0;
    if (!db.get('SELECT 1 FROM measurements WHERE record_no = ?', no)) return page(errorPage(ctx, 'not_found'), 404);
    const r = M.correct(db, ctx.user, no, ctx.form);
    if (r.denied) return page(errorPage(ctx, 'forbidden'), 403);
    if (r.ok) return redirect(`/masuratori/${no}`, { flash: { key: 'measurement_corrected' } });
    const c = correctionContext(no, ctx.user, { ...stateFromForm(ctx.form), errors: r.errors, editReason: ctx.form.get('edit_reason') });
    return page(c.cable ? cableViews.cableCorrectPage(ctx, c) : views.correctPage(ctx, c), 422);
  });
};
