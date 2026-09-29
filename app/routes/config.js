'use strict';
const { page, redirect } = require('../lib/http');
const audit = require('../domain/audit');
const calc = require('../domain/calc');
const targets = require('../domain/targets');
const iec = require('../domain/iec');
const views = require('../views/config');
const { errorPage } = require('../views/errors');

const ENG = ['inginer'];
const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);
const num = (t) => { const s = String(t).trim(); return s === '' ? undefined : calc.parseDecimal(s); };

module.exports = function register(app) {
  const { router, db } = app;

  // ---------- product families: what is measured, which resistance ----------

  function familyRows() {
    return db.all('SELECT * FROM product_families ORDER BY sort').map((r) => {
      const m = JSON.parse(r.measures);
      const rm = m.resistance_measured || [];
      return { ...r, flags: { active: !!r.active, mass: m.mass !== false && !!m.mass, theor: !!m.resistance_theoretical, r_cu: rm.includes('Cu'), r_al: rm.includes('Al') } };
    });
  }

  router.get('/liste/familii', { roles: ENG }, (ctx) => page(views.familiesPage(ctx, { rows: familyRows() })));

  router.post('/liste/familii/:id', { roles: ENG }, (ctx) => {
    const id = idOf(ctx.params.id);
    const row = db.get('SELECT * FROM product_families WHERE id = ?', id);
    if (!row) return page(errorPage(ctx, 'not_found'), 404);
    const m = JSON.parse(row.measures);
    const before = { active: row.active, measures: m };
    m.mass = ctx.form.bool('mass');
    m.resistance_theoretical = ctx.form.bool('theor');
    m.resistance_measured = [ctx.form.bool('r_cu') ? 'Cu' : null, ctx.form.bool('r_al') ? 'Al' : null].filter(Boolean);
    const active = ctx.form.bool('active') ? 1 : 0;
    if (active && !m.mass && !m.diam && !m.resistance_measured.length) return page(views.familiesPage(ctx, { rows: familyRows(), err: require('../i18n/ro').T.cfg.families_nothing }), 422);
    db.tx(() => {
      db.run('UPDATE product_families SET active = ?, measures = ? WHERE id = ?', active, JSON.stringify(m), id);
      audit.log(db, ctx.user.id, 'family_change', 'product_families', id, { code: row.code, before, after: { active, measures: m } });
    });
    return redirect('/liste/familii', { flash: { key: 'saved' } });
  });

  // ---------- targets and thresholds ----------

  router.get('/liste/tinte', { roles: ENG }, (ctx) => page(views.targetsPage(ctx, { values: targets.get(db) })));

  router.post('/liste/tinte', { roles: ENG }, (ctx) => {
    const v = targets.validate(ctx.form, (t) => calc.parseDecimal(t));
    if (v.errors) {
      const raw = {};
      for (const k of Object.keys(targets.DEFAULTS)) raw[k] = ctx.form.get(k);
      return page(views.targetsPage(ctx, { values: raw, errors: v.errors }), 422);
    }
    targets.save(db, ctx.user.id, v.values);
    return redirect('/liste/tinte', { flash: { key: 'saved' } });
  });

  // ---------- catalogue of finished-cable tests ----------

  const T = require('../domain/tests');
  const testRows = () => db.all('SELECT * FROM test_types ORDER BY sort, id');

  router.get('/liste/incercari', { roles: ENG }, (ctx) => page(views.testsPage(ctx, { rows: testRows() })));

  router.post('/liste/incercari/adauga', { roles: ENG }, (ctx) => {
    const { errors, v } = T.validate(db, ctx.form, { creating: true });
    const raw = Object.fromEntries(ctx.form.params.entries());
    if (!errors.code && db.get('SELECT 1 FROM test_types WHERE code = ?', v.code)) errors.code = 'duplicate';
    if (Object.keys(errors).length) return page(views.testsPage(ctx, { rows: testRows(), err: { id: 'new', errors, values: raw } }), 422);
    T.add(db, ctx.user.id, v);
    return redirect('/liste/incercari', { flash: { key: 'added' } });
  });

  router.post('/liste/incercari/:id', { roles: ENG }, (ctx) => {
    const id = idOf(ctx.params.id);
    if (!db.get('SELECT 1 FROM test_types WHERE id = ?', id)) return page(errorPage(ctx, 'not_found'), 404);
    const { errors, v } = T.validate(db, ctx.form, { creating: false });
    if (Object.keys(errors).length) return page(views.testsPage(ctx, { rows: testRows(), err: { id, errors, values: Object.fromEntries(ctx.form.params.entries()) } }), 422);
    T.update(db, ctx.user.id, id, v);
    return redirect('/liste/incercari', { flash: { key: 'saved' } });
  });

  // ---------- IEC 60228 reference values (limit values only) ----------

  const MATS = ['Cu', 'Al'];

  function iecFilters(q) {
    const c = Number(q.get('clasa'));
    return { iec_class: [1, 2, 5].includes(c) ? c : 2, material: MATS.includes(q.get('material')) ? q.get('material') : '' };
  }

  function iecRender(ctx, filters, err, status) {
    const rows = db.all(`SELECT * FROM iec_limits WHERE iec_class = ? ${filters.material ? 'AND material = ?' : ''} ORDER BY section, material, coated`, filters.iec_class, ...(filters.material ? [filters.material] : []));
    return page(views.iecPage(ctx, { rows, filters, err }), status || 200);
  }

  router.get('/liste/iec', { roles: ENG }, (ctx) => iecRender(ctx, iecFilters(ctx.query)));

  function parseIec(form) {
    const errors = {};
    const v = {};
    const n = (k, integer) => {
      const t = num(form.get(k, ''));
      if (t === undefined) return null;
      if (t === null || t < 0 || (integer && !Number.isInteger(t))) { errors[k] = 'invalid'; return null; }
      return t;
    };
    v.r_max = n('r_max');
    for (const k of ['min_wires_circular', 'min_wires_compacted', 'min_wires_shaped']) v[k] = form.has(k) ? n(k, true) : undefined;
    v.d_max_wire = form.has('d_max_wire') ? n('d_max_wire') : undefined;
    v.note = form.has('note') ? form.get('note').trim().slice(0, 200) || null : undefined;
    return { errors, v };
  }

  router.post('/liste/iec/nou', { roles: ENG }, (ctx) => {
    const filters = { iec_class: [1, 2, 5].includes(ctx.form.int('iec_class')) ? ctx.form.int('iec_class') : 2, material: '' };
    const { errors, v } = parseIec(ctx.form);
    const section = num(ctx.form.get('section'));
    if (!section || section <= 0) errors.section = 'invalid';
    const material = MATS.includes(ctx.form.get('material')) ? ctx.form.get('material') : null;
    if (!material) errors.material = 'invalid';
    const coated = ctx.form.bool('coated') ? 1 : 0;
    const raw = Object.fromEntries(ctx.form.params.entries());
    if (Object.keys(errors).length) return iecRender(ctx, filters, { id: 'new', errors, values: raw }, 422);
    try {
      db.tx(() => {
        const id = db.run('INSERT INTO iec_limits(iec_table, iec_class, section, material, coated, r_max) VALUES (?,?,?,?,?,?)', iec.TABLE_BY_CLASS[filters.iec_class], filters.iec_class, section, material, coated, v.r_max).id;
        audit.log(db, ctx.user.id, 'iec_add', 'iec_limits', id, { iec_class: filters.iec_class, section, material, coated, r_max: v.r_max });
      });
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return iecRender(ctx, filters, { id: 'new', errors: { section: 'duplicate' }, values: raw }, 422);
      throw e;
    }
    return redirect(`/liste/iec?clasa=${filters.iec_class}`, { flash: { key: 'added' } });
  });

  router.post('/liste/iec/:id', { roles: ENG }, (ctx) => {
    const id = idOf(ctx.params.id);
    const row = db.get('SELECT * FROM iec_limits WHERE id = ?', id);
    if (!row) return page(errorPage(ctx, 'not_found'), 404);
    const filters = { iec_class: row.iec_class, material: '' };
    const { errors, v } = parseIec(ctx.form);
    if (Object.keys(errors).length) return iecRender(ctx, filters, { id, errors, values: Object.fromEntries(ctx.form.params.entries()) }, 422);
    const next = {};
    for (const k of ['r_max', 'min_wires_circular', 'min_wires_compacted', 'min_wires_shaped', 'd_max_wire', 'note']) next[k] = v[k] === undefined ? row[k] : v[k];
    db.tx(() => {
      db.run('UPDATE iec_limits SET r_max = ?, min_wires_circular = ?, min_wires_compacted = ?, min_wires_shaped = ?, d_max_wire = ?, note = ? WHERE id = ?',
        next.r_max, next.min_wires_circular, next.min_wires_compacted, next.min_wires_shaped, next.d_max_wire, next.note, id);
      audit.log(db, ctx.user.id, 'iec_change', 'iec_limits', id, { iec_class: row.iec_class, section: row.section, material: row.material, before: row, after: next });
    });
    return redirect(`/liste/iec?clasa=${row.iec_class}`, { flash: { key: 'saved' } });
  });
};
