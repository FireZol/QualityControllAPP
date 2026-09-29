'use strict';
const { page, redirect } = require('../lib/http');
const lists = require('../domain/lists');
const calc = require('../domain/calc');
const views = require('../views/lists');
const { errorPage } = require('../views/errors');

const STAFF = ['inginer', 'administrator'];
const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);

module.exports = function register(app) {
  const { router, db } = app;

  router.get('/liste', { roles: STAFF }, (ctx) => page(views.indexPage(ctx, {})));

  function materialRows() { return db.all('SELECT * FROM materials ORDER BY id'); }

  router.get('/liste/materiale', { roles: ['inginer'] }, (ctx) => page(views.materialsPage(ctx, { rows: materialRows() })));

  router.post('/liste/materiale/:id', { roles: ['inginer'] }, (ctx) => {
    const id = idOf(ctx.params.id);
    if (!db.get('SELECT 1 FROM materials WHERE id = ?', id)) return page(errorPage(ctx, 'not_found'), 404);
    const errors = {};
    const values = { grade: ctx.form.get('grade').trim().slice(0, 20), rho20: ctx.form.get('rho20'), density: ctx.form.get('density'), alpha20: ctx.form.get('alpha20') };
    const parsed = { grade: values.grade || null };
    for (const k of ['rho20', 'density', 'alpha20']) {
      const n = calc.parseDecimal(values[k]);
      if (n === null || n <= 0) errors[k] = 'invalid'; else parsed[k] = n;
    }
    if (parsed.alpha20 !== undefined && parsed.alpha20 > 0.01) errors.alpha20 = 'invalid';
    if (Object.keys(errors).length) return page(views.materialsPage(ctx, { rows: materialRows(), err: { id, errors, values } }), 422);
    lists.updateMaterial(db, ctx.user.id, id, parsed);
    return redirect('/liste/materiale', { flash: { key: 'saved' } });
  });

  function render(ctx, key, err, status) {
    const def = lists.LISTS[key];
    return page(views.listPage(ctx, { key, def, rows: lists.listRows(db, def), db, err, fam: db.all('SELECT id, name FROM product_families ORDER BY sort') }), status || 200);
  }

  function withDef(handler) {
    return (ctx) => {
      const def = lists.LISTS[ctx.params.key];
      if (!def) return page(errorPage(ctx, 'not_found'), 404);
      return handler(ctx, ctx.params.key, def);
    };
  }

  const familyIds = (ctx) => ctx.form.all('family_ids').filter((x) => /^\d+$/.test(x)).map(Number)
    .filter((id) => db.get('SELECT 1 FROM product_families WHERE id = ?', id));

  router.get('/liste/:key', { roles: STAFF }, withDef((ctx, key) => render(ctx, key)));

  router.post('/liste/:key/adauga', { roles: STAFF }, withDef((ctx, key, def) => {
    const v = lists.validate(db, def, ctx.form);
    if (v.errors) return render(ctx, key, { id: 'new', errors: v.errors, values: Object.fromEntries(ctx.form.params.entries()) }, 422);
    try {
      lists.add(db, ctx.user.id, key, def, v.values, familyIds(ctx));
    } catch (e) {
      if (lists.isUniqueError(e)) return render(ctx, key, { id: 'new', errors: { [def.nameField]: 'duplicate' }, values: Object.fromEntries(ctx.form.params.entries()) }, 422);
      throw e;
    }
    return redirect(`/liste/${key}`, { flash: { key: 'added' } });
  }));

  router.post('/liste/:key/:id/salveaza', { roles: STAFF }, withDef((ctx, key, def) => {
    const id = idOf(ctx.params.id);
    const v = lists.validate(db, def, ctx.form, id);
    if (v.errors) return render(ctx, key, { id, errors: v.errors, values: Object.fromEntries(ctx.form.params.entries()) }, 422);
    let ok;
    try {
      ok = lists.update(db, ctx.user.id, key, def, id, v.values, familyIds(ctx));
    } catch (e) {
      if (lists.isUniqueError(e)) return render(ctx, key, { id, errors: { [def.nameField]: 'duplicate' }, values: Object.fromEntries(ctx.form.params.entries()) }, 422);
      throw e;
    }
    if (!ok) return page(errorPage(ctx, 'not_found'), 404);
    return redirect(`/liste/${key}`, { flash: { key: 'saved' } });
  }));

  router.post('/liste/:key/:id/comuta', { roles: STAFF }, withDef((ctx, key, def) => {
    if (!lists.toggleActive(db, ctx.user.id, key, def, idOf(ctx.params.id))) return page(errorPage(ctx, 'not_found'), 404);
    return redirect(`/liste/${key}`, { flash: { key: 'toggled' } });
  }));
};
