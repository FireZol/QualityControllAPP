'use strict';
// Administration of custom fields and lists (administrators only); the fields themselves appear in the task, non-conformity and meeting pages.
const { page, redirect } = require('../lib/http');
const custom = require('../domain/custom');
const views = require('../views/customadmin');
const { errorPage } = require('../views/errors');

const ADMIN = ['administrator'];
const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);

module.exports = function register(app) {
  const { router, db } = app;
  const notFound = (ctx) => page(errorPage(ctx, 'not_found'), 404);
  const lists = () => custom.lists(db);
  const fieldData = (ctx, withKindType) => ({
    ...(withKindType ? { kind: ctx.form.get('kind'), type: ctx.form.get('type') } : {}),
    team: ctx.form.get('team'), label: ctx.form.get('label'), label_en: ctx.form.get('label_en'), list_id: ctx.form.get('list_id'), unit: ctx.form.get('unit'), sort: ctx.form.get('sort'), formula: ctx.form.get('formula'), decimals: ctx.form.get('decimals'),
    required: ctx.form.bool('required'), show_in_list: ctx.form.bool('show_in_list'),
  });
  const kindOf = (ctx) => (custom.KINDS.includes(ctx.query.get('kind')) ? ctx.query.get('kind') : '');

  // ---- fields ----
  router.get('/admin/campuri', { roles: ADMIN }, (ctx) => {
    const kind = kindOf(ctx);
    return page(views.fieldsPage(ctx, { rows: custom.adminFields(db, kind || null), kind, lists: lists(), pool: custom.allPool(db) }));
  });

  router.post('/admin/campuri/nou', { roles: ADMIN }, (ctx) => {
    const data = fieldData(ctx, true);
    const r = custom.createField(db, ctx.user, data);
    if (!r.ok) return page(views.fieldsPage(ctx, { rows: custom.adminFields(db, null), kind: '', lists: lists(), values: data, errors: r.errors, pool: custom.allPool(db) }), 422);
    return redirect('/admin/campuri', { flash: { key: 'custom_field_saved' } });
  });

  const loadField = (ctx) => {
    const fld = custom.adminFields(db, null).find((x) => x.id === idOf(ctx.params.id));
    return fld || null;
  };
  const editData = (fld, values, errors) => {
    const calc = custom.isCalc(fld);
    return { fld, lists: lists(), values, errors, pool: custom.allPool(db), calc, history: calc ? custom.formulaHistory(db, fld.id) : [], records: calc ? custom.recordCount(db, fld) : 0 };
  };
  router.post('/admin/campuri/:id/recalcula', { roles: ADMIN }, (ctx) => {
    const fld = loadField(ctx); if (!fld) return notFound(ctx);
    const r = custom.recalculate(db, ctx.user, fld.id);
    return redirect(`/admin/campuri/${fld.id}/editeaza`, r.ok ? { flash: { key: 'custom_recalculated' } } : { flash: { type: 'err', key: 'e_invalid' } });
  });
  router.get('/admin/campuri/:id/editeaza', { roles: ADMIN }, (ctx) => {
    const fld = loadField(ctx); if (!fld) return notFound(ctx);
    return page(views.fieldEditPage(ctx, editData(fld)));
  });
  router.post('/admin/campuri/:id/editeaza', { roles: ADMIN }, (ctx) => {
    const fld = loadField(ctx); if (!fld) return notFound(ctx);
    const data = { ...fieldData(ctx, false), active: ctx.form.bool('active') };
    const r = custom.updateField(db, ctx.user, fld.id, data);
    if (!r.ok) return page(views.fieldEditPage(ctx, editData(fld, { ...fld, ...data }, r.errors || {})), 422);
    return redirect('/admin/campuri', { flash: { key: 'custom_field_saved' } });
  });

  // ---- lists (static paths first: the router takes the first match) ----
  router.get('/admin/campuri/liste', { roles: ADMIN }, (ctx) => {
    const ls = lists();
    const fields = custom.adminFields(db, null);
    for (const l of ls) l.used_by = fields.filter((x) => x.list_id === l.id).map((x) => ({ label: x.label }));
    return page(views.listsPage(ctx, { lists: ls }));
  });
  router.post('/admin/campuri/liste/nou', { roles: ADMIN }, (ctx) => {
    const data = { name: ctx.form.get('name'), name_en: ctx.form.get('name_en') };
    const r = custom.createList(db, ctx.user, data);
    if (!r.ok) return page(views.listsPage(ctx, { lists: lists().map((l) => ({ ...l, used_by: [] })), errors: r.errors, values: data }), 422);
    return redirect(`/admin/campuri/liste/${r.id}`, { flash: { key: 'custom_list_saved' } });
  });
  const loadList = (ctx) => lists().find((l) => l.id === idOf(ctx.params.id)) || null;
  router.get('/admin/campuri/liste/:id', { roles: ADMIN }, (ctx) => {
    const list = loadList(ctx); if (!list) return notFound(ctx);
    return page(views.listPage(ctx, { list }));
  });
  router.post('/admin/campuri/liste/:id', { roles: ADMIN }, (ctx) => {
    const list = loadList(ctx); if (!list) return notFound(ctx);
    const data = { name: ctx.form.get('name'), name_en: ctx.form.get('name_en'), active: ctx.form.bool('active') };
    const r = custom.updateList(db, ctx.user, list.id, data);
    if (!r.ok) return page(views.listPage(ctx, { list, values: data, errors: r.errors || {} }), 422);
    return redirect(`/admin/campuri/liste/${list.id}`, { flash: { key: 'custom_list_saved' } });
  });
  router.post('/admin/campuri/liste/:id/element', { roles: ADMIN }, (ctx) => {
    const list = loadList(ctx); if (!list) return notFound(ctx);
    const text = ctx.form.get('items');
    const r = custom.addItems(db, ctx.user, list.id, text);
    if (!r.ok) return page(views.listPage(ctx, { list, errors: r.errors || {}, itemsText: text }), 422);
    return redirect(`/admin/campuri/liste/${list.id}`, { flash: { key: r.added ? 'custom_items_added' : 'custom_items_none' } });
  });
  router.post('/admin/campuri/liste/:id/element/:item', { roles: ADMIN }, (ctx) => {
    const list = loadList(ctx); if (!list) return notFound(ctx);
    const r = custom.updateItem(db, ctx.user, list.id, idOf(ctx.params.item), { label: ctx.form.get('label'), label_en: ctx.form.get('label_en'), sort: ctx.form.get('sort'), active: ctx.form.bool('active') });
    return redirect(`/admin/campuri/liste/${list.id}`, r.ok ? { flash: { key: 'custom_list_saved' } } : { flash: { type: 'err', key: 'e_invalid' } });
  });
};
