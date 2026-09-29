'use strict';
const { page, redirect } = require('../lib/http');
const rev = require('../domain/revisions');
const calc = require('../domain/calc');
const views = require('../views/specs');
const { errorPage } = require('../views/errors');

const ENGINEER = ['inginer'];
const RE_CONFIG = /^\d+(\+\d+)*$/;
const r4 = (v) => Number(Number(v).toFixed(4));

const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);

module.exports = function register(app) {
  const { router, db } = app;

  function docRow(id) {
    return db.get(`SELECT d.*, f.name AS family_name, f.active AS family_active FROM spec_documents d JOIN product_families f ON f.id = d.family_id WHERE d.id = ?`, id);
  }

  function permsFor(user, full) {
    const r = full.rev;
    const engineer = user.role === 'inginer';
    const canEdit = engineer && r.status === 'ciorna' && full.family.active && (!r.elaborated_by || r.elaborated_by === user.id);
    return {
      canEdit,
      canSubmit: canEdit,
      canVerify: engineer && r.status === 'in_verificare' && full.family.active && r.elaborated_by !== user.id,
      viewerIsAuthor: engineer && r.status === 'in_verificare' && r.elaborated_by === user.id,
      authorWaits: false,
    };
  }

  const fail = (base, code) => redirect(base, { flash: { type: 'err', key: 'e_' + code } });

  // ---------- lists ----------

  router.get('/fise', {}, (ctx) => {
    const docs = db.all(`SELECT d.*, f.name AS family_name, f.active AS family_active FROM spec_documents d JOIN product_families f ON f.id = d.family_id ORDER BY f.sort, d.id`);
    for (const d of docs) {
      d.active = db.get("SELECT * FROM spec_revisions WHERE document_id = ? AND status = 'activa'", d.id) || null;
      d.open = db.get("SELECT * FROM spec_revisions WHERE document_id = ? AND status IN ('ciorna','in_verificare') ORDER BY id DESC", d.id) || null;
    }
    return page(views.docsPage(ctx, docs));
  });

  router.get('/fise/:doc', {}, (ctx) => {
    const doc = docRow(idOf(ctx.params.doc));
    if (!doc) return page(errorPage(ctx, 'not_found'), 404);
    const revisions = db.all(`SELECT r.*, a.full_name AS author, v.full_name AS verifier FROM spec_revisions r
      LEFT JOIN users a ON a.id = r.elaborated_by LEFT JOIN users v ON v.id = r.verified_by WHERE r.document_id = ? ORDER BY r.edition DESC, r.revision DESC`, doc.id);
    const open = revisions.some((r) => r.status === 'ciorna' || r.status === 'in_verificare');
    const hasActive = revisions.some((r) => r.status === 'activa');
    const blocked = open ? 'blocked_open' : (!hasActive ? 'blocked_no_active' : null);
    return page(views.docPage(ctx, { doc, revisions, isEngineer: ctx.user.role === 'inginer', canCreate: !blocked, createBlockedReason: blocked }));
  });

  router.post('/fise/:doc/revizii/noua', { roles: ENGINEER }, (ctx) => {
    const doc = docRow(idOf(ctx.params.doc));
    if (!doc) return page(errorPage(ctx, 'not_found'), 404);
    const back = `/fise/${doc.id}`;
    if (!doc.family_active) return fail(back, 'later_stage');
    const r = rev.newRevision(db, ctx.user.id, doc.id);
    if (!r.ok) return fail(r.code === 'open_revision_exists' ? `/fise/${doc.id}/revizii/${r.id}` : back, r.code);
    return redirect(`/fise/${doc.id}/revizii/${r.id}`, { flash: { key: 'rev_created' } });
  });

  // ---------- revision page ----------

  function loadFor(ctx) {
    const doc = docRow(idOf(ctx.params.doc));
    const rid = idOf(ctx.params.id);
    if (!doc || !rid) return null;
    const full = rev.loadRevision(db, rid, { includeInactive: true });
    if (!full || full.rev.document_id !== doc.id) return null;
    return { doc, full };
  }

  router.get('/fise/:doc/revizii/:id', {}, (ctx) => {
    const l = loadFor(ctx);
    if (!l) return page(errorPage(ctx, 'not_found'), 404);
    const { full } = l;
    let prev = null;
    if (full.rev.based_on_id) prev = rev.loadConstructions(db, full.rev.based_on_id, { onlyActive: true });
    const diff = rev.diffAgainst(full.constructions.filter((c) => c.active), prev);
    const findings = full.family.active && (full.rev.status === 'ciorna' || full.rev.status === 'in_verificare') ? rev.checkRevision(db, full.rev.id) : [];
    const warnings = db.all('SELECT * FROM seed_warnings WHERE revision_id = ? ORDER BY level, id', full.rev.id);
    return page(views.revisionPage(ctx, { full, diff, findings, warnings, perms: permsFor(ctx.user, full) }));
  });

  function guarded(handler, need) {
    return (ctx) => {
      const l = loadFor(ctx);
      if (!l) return page(errorPage(ctx, 'not_found'), 404);
      const base = `/fise/${l.doc.id}/revizii/${l.full.rev.id}`;
      const perms = permsFor(ctx.user, l.full);
      if (!l.full.family.active) return fail(base, 'later_stage');
      if (need && !perms[need]) {
        const r = l.full.rev;
        if (need === 'canVerify' && r.elaborated_by === ctx.user.id) return fail(base, 'author_cannot_verify');
        return page(errorPage(ctx, 'forbidden'), 403);
      }
      return handler(ctx, l, base);
    };
  }

  router.post('/fise/:doc/revizii/:id/antet', { roles: ENGINEER }, guarded((ctx, l, base) => {
    const edition = ctx.form.int('edition'), revision = ctx.form.int('revision');
    if (!edition || revision === null) return fail(base, 'invalid');
    const code = ctx.form.get('code').trim().slice(0, 40);
    const r = rev.updateHeader(db, ctx.user, l.full.rev.id, { edition, revision, change_note: ctx.form.get('change_note').trim().slice(0, 500), code });
    return r.ok ? redirect(base, { flash: { key: 'header_saved' } }) : fail(base, r.code);
  }, 'canEdit'));

  router.post('/fise/:doc/revizii/:id/trimite', { roles: ENGINEER }, guarded((ctx, l, base) => {
    const r = rev.submit(db, ctx.user, l.full.rev.id);
    return r.ok ? redirect(base, { flash: { key: 'rev_submitted' } }) : fail(base, r.code);
  }, 'canSubmit'));

  router.post('/fise/:doc/revizii/:id/verifica', { roles: ENGINEER }, guarded((ctx, l, base) => {
    const r = rev.verify(db, ctx.user, l.full.rev.id);
    return r.ok ? redirect(base, { flash: { key: 'rev_verified' } }) : fail(base, r.code);
  }, 'canVerify'));

  router.post('/fise/:doc/revizii/:id/respinge', { roles: ENGINEER }, guarded((ctx, l, base) => {
    const r = rev.reject(db, ctx.user, l.full.rev.id, ctx.form.get('reason'));
    return r.ok ? redirect(base, { flash: { key: 'rev_rejected' } }) : fail(base, r.code);
  }, 'canVerify'));

  for (const [seg, active] of [['dezactiveaza', false], ['activeaza', true]]) {
    router.post(`/fise/:doc/revizii/:id/constructii/:cid/${seg}`, { roles: ENGINEER }, guarded((ctx, l, base) => {
      const r = rev.setConstructionActive(db, ctx.user, l.full.rev.id, idOf(ctx.params.cid), active);
      return r.ok ? redirect(base, { flash: { key: 'construction_toggled' } }) : fail(base, r.code);
    }, 'canEdit'));
  }

  // ---------- construction editor ----------

  const num = (v, d) => (v === null || v === undefined ? '' : calc.formatNumber(v, 0, d === undefined ? 4 : d));

  function valuesFromConstruction(c) {
    const v = {
      material_id: c.material_id, section: num(c.section), shape_id: c.shape_id, destination_id: c.destination_id, coated: !!c.coated,
      label: c.label, wires: c.wires == null ? '' : c.wires, wire_d: num(c.wire_d), die: c.die || '', iec_exception_reason: c.iec_exception_reason || '',
    };
    for (const l of c.limits) {
      const k = `lim_${l.level}_${l.quantity}`;
      v[k + '_nominal'] = num(l.nominal); v[k + '_min'] = num(l.min); v[k + '_max'] = num(l.max); v[k + '_inf'] = !!l.informative;
    }
    v.params = c.params.map((p) => ({ strander_config: p.strander_config, rotor: p.rotor, pitch_mm: num(p.pitch_mm), tension: p.tension || '' }));
    return v;
  }

  function editorLists() {
    return {
      materials: db.all('SELECT * FROM materials ORDER BY id'),
      shapes: db.all('SELECT * FROM shapes WHERE active = 1 ORDER BY id'),
      destinations: db.all('SELECT * FROM destinations WHERE active = 1 ORDER BY id'),
    };
  }

  function parseForm(form, family, lists) {
    const errors = {};
    const values = {};
    for (const [k, v] of form.params.entries()) if (!k.startsWith('_') && !(k in values)) values[k] = v;
    values.coated = form.bool('coated');
    const d = {};
    d.material_id = form.int('material_id');
    if (!lists.materials.some((m) => m.id === d.material_id)) errors.material_id = 'invalid';
    d.section = calc.parseDecimal(form.get('section'));
    if (d.section === null || d.section <= 0) errors.section = 'invalid';
    d.shape_id = form.int('shape_id');
    const shape = lists.shapes.find((s) => s.id === d.shape_id);
    if (!shape) errors.shape_id = 'invalid';
    d.destination_id = form.int('destination_id');
    if (d.destination_id && !lists.destinations.some((x) => x.id === d.destination_id)) errors.destination_id = 'invalid';
    d.coated = form.bool('coated');
    d.wires = null;
    if (form.get('wires').trim() !== '') { d.wires = form.int('wires'); if (!d.wires) errors.wires = 'invalid'; }
    d.wire_d = null;
    if (form.get('wire_d').trim() !== '') { d.wire_d = calc.parseDecimal(form.get('wire_d')); if (d.wire_d === null || d.wire_d <= 0) errors.wire_d = 'invalid'; }
    d.die = form.get('die').trim().slice(0, 80) || null;
    if (form.get('die').trim().length > 80) errors.die = 'too_long';
    d.iec_exception_reason = form.get('iec_exception_reason').trim().slice(0, 500);
    d.label = form.get('label').trim().slice(0, 80);
    if (!d.label && shape && d.section !== null) d.label = `${calc.formatNumber(d.section, 0, 3)} ${shape.name}`;
    if (!d.label) errors.label = 'required';

    d.limits = [];
    const kind = shape ? shape.kind : 'rotund';
    for (const r of views.limitRows(family)) {
      if ((r.cls === 'only-round' && kind !== 'rotund') || (r.cls === 'only-sector' && kind !== 'sector')) continue;
      const k = `lim_${r.level}_${r.q}`;
      const get = (s) => { const t = form.get(`${k}_${s}`).trim(); if (t === '') return null; const n = calc.parseDecimal(t); if (n === null) { errors[k] = 'invalid'; return null; } return n; };
      let nominal = get('nominal'), min = get('min'), max = get('max');
      const tol = r.tol ? get('tol') : null;
      let tolText = null;
      if (tol !== null) {
        if (tol < 0) errors[k] = 'invalid';
        else { tolText = `+/-${calc.formatNumber(tol, 0, 4).replace(',', '.')}`; if (nominal !== null && min === null && max === null) { min = r4(nominal - tol); max = r4(nominal + tol); } }
      }
      const informative = !!(r.inf && form.bool(`${k}_inf`));
      if (min !== null && max !== null && min > max) errors[k] = 'invalid';
      if (nominal === null && min === null && max === null && !informative) {
        if (kind === 'sector' && r.cls === 'only-sector') d.limits.push({ level: r.level, quantity: r.q, nominal: null, min: null, max: null, unit: r.unit, informative: 0, tolerance_text: null });
        continue;
      }
      d.limits.push({ level: r.level, quantity: r.q, nominal, min, max, unit: r.unit, informative, tolerance_text: tolText });
    }

    d.params = [];
    if (family.code === 'FUNIE_RIGIDA') {
      const n = Math.min(40, form.int('param_rows') || 0);
      const seen = new Set();
      for (let i = 0; i < n; i++) {
        const cfg = form.get(`p${i}_config`).trim().replace(/\s+/g, ''), rotor = form.get(`p${i}_rotor`).trim(), pitchT = form.get(`p${i}_pitch`).trim(), tension = form.get(`p${i}_tension`).trim();
        if (!cfg && !rotor && !pitchT && !tension) continue;
        const key = `p${i}`;
        if (!RE_CONFIG.test(cfg)) { errors[key] = 'rotor_format'; continue; }
        if (!rotor || rotor.length > 12) { errors[key] = 'invalid'; continue; }
        let pitch = null;
        if (pitchT) { pitch = calc.parseDecimal(pitchT); if (pitch === null || pitch <= 0) { errors[key] = 'invalid'; continue; } }
        if (seen.has(`${cfg}|${rotor}`)) { errors[key] = 'duplicate'; continue; }
        seen.add(`${cfg}|${rotor}`);
        d.params.push({ strander_config: cfg, rotor, pitch_mm: pitch, tension: tension.slice(0, 20) || null });
      }
    }
    return { errors, values, data: d };
  }

  function renderForm(ctx, l, base, cons, state, status) {
    const family = l.full.family;
    const c = cons;
    const lists = editorLists();
    const defaults = c ? valuesFromConstruction(c) : {
      material_id: lists.materials[0].id, shape_id: (lists.shapes.find((s) => s.code === 'RM') || lists.shapes[0]).id, section: '', label: '', wires: '', wire_d: '', die: '', coated: false, params: [],
    };
    const values = state ? state.values : defaults;
    if (state) {
      const n = Math.min(40, Number(state.values.param_rows) || 0);
      values.params = Array.from({ length: n }, (_, i) => ({ strander_config: state.values[`p${i}_config`], rotor: state.values[`p${i}_rotor`], pitch_mm: state.values[`p${i}_pitch`], tension: state.values[`p${i}_tension`] }));
    }
    const paramRows = Math.max(6, (values.params ? values.params.length : 0) + (state ? 0 : 2));
    return page(views.constructionForm(ctx, { full: l.full, cons: c, values, errors: state ? state.errors : {}, lists, base, paramRows }), status || 200);
  }

  router.get('/fise/:doc/revizii/:id/constructii/:cid', { roles: ENGINEER }, guarded((ctx, l, base) => {
    const cid = ctx.params.cid;
    let cons = null;
    if (cid !== 'noua') {
      cons = l.full.constructions.find((c) => c.id === idOf(cid));
      if (!cons) return page(errorPage(ctx, 'not_found'), 404);
    }
    return renderForm(ctx, l, base, cons, null);
  }, 'canEdit'));

  router.post('/fise/:doc/revizii/:id/constructii/:cid', { roles: ENGINEER }, guarded((ctx, l, base) => {
    const cid = ctx.params.cid;
    let cons = null;
    if (cid !== 'noua') {
      cons = l.full.constructions.find((c) => c.id === idOf(cid));
      if (!cons) return page(errorPage(ctx, 'not_found'), 404);
    }
    const lists = editorLists();
    const parsed = parseForm(ctx.form, l.full.family, lists);
    if (Object.keys(parsed.errors).length) return renderForm(ctx, l, base, cons, { values: parsed.values, errors: parsed.errors }, 422);
    const r = rev.saveConstruction(db, ctx.user, l.full.rev.id, cons ? cons.id : null, parsed.data);
    return r.ok ? redirect(base, { flash: { key: 'construction_saved' } }) : fail(base, r.code);
  }, 'canEdit'));

  // ---------- statistics for undetermined limits ----------

  router.get('/fise/constructie/:id/statistici', { roles: ['inginer', 'administrator'] }, (ctx) => {
    const cons = db.get('SELECT c.*, r.document_id AS document_id FROM constructions c JOIN spec_revisions r ON r.id = c.revision_id WHERE c.id = ?', idOf(ctx.params.id));
    if (!cons) return page(errorPage(ctx, 'not_found'), 404);
    const rows = [];
    for (const q of ['d1', 'd2', 'd_avg', 'h', 'l', 'mass_gm', 'r20', 'r20_theor']) {
      const s = rev.statsForKey(db, cons.stable_key, q);
      if (s) rows.push({ quantity: q, ...s });
    }
    return page(views.statsPage(ctx, { cons, rows, base: `/fise/${cons.document_id}/revizii/${cons.revision_id}` }));
  });
};
