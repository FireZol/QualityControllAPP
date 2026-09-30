'use strict';
// Batches, drums, batch certificates, type test reports.
const { page, redirect } = require('../lib/http');
const B = require('../domain/batches');
const C = require('../domain/certificates');
const i18n = require('../i18n');
const views = require('../views/cable');
const cert = require('../views/certificate');
const { errorPage } = require('../views/errors');

const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);
const ENG = ['inginer'];

module.exports = function register(app) {
  const { router, db } = app;
  const lists = () => ({
    clients: db.all('SELECT * FROM clients WHERE active = 1 ORDER BY short_name'),
    standards: db.all('SELECT * FROM cable_standards WHERE active = 1 ORDER BY id'),
  });
  const exemplar = (ctx) => (ctx.query.get('exemplar') || '').trim().slice(0, 20);

  router.get('/loturi', {}, (ctx) => {
    const q = ctx.query;
    const filters = { q: (q.get('q') || '').trim().slice(0, 60), status: ['deschis', 'inchis'].includes(q.get('status')) ? q.get('status') : '', client_id: idOf(q.get('client_id') || '') || null };
    return page(views.batchesPage(ctx, { rows: B.list(db, filters), filters, clients: lists().clients }));
  });

  router.get('/loturi/nou', {}, (ctx) => page(views.batchForm(ctx, { designs: B.designs(db), ...lists() })));

  router.post('/loturi/nou', {}, (ctx) => {
    const { errors, v } = B.validate(db, ctx.form, { creating: true });
    const raw = Object.fromEntries(ctx.form.params.entries());
    if (Object.keys(errors).length) return page(views.batchForm(ctx, { designs: B.designs(db), ...lists(), values: raw, errors }), 422);
    const r = B.create(db, ctx.user, v);
    if (!r.ok) return page(views.batchForm(ctx, { designs: B.designs(db), ...lists(), values: raw, errors: r.errors }), 422);
    return redirect(`/loturi/${r.id}`, { flash: { key: 'batch_created' } });
  });

  function detail(ctx, extra, status) {
    const id = idOf(ctx.params.id);
    const o = B.overview(db, id);
    if (!o) return page(errorPage(ctx, 'not_found'), 404);
    const certificates = db.all('SELECT c.*, u.full_name AS issued_by_name FROM batch_certificates c JOIN users u ON u.id = c.issued_by WHERE c.batch_id = ? ORDER BY c.id DESC', id);
    for (const c of certificates) { const later = db.get('SELECT cert_no FROM batch_certificates WHERE supersedes_id = ?', c.id); c.superseded_by = later ? later.cert_no : null; }
    const preview = o.measurements.length ? C.build(db, id) : null;
    return page(views.batchDetail(ctx, { o, certificates, ...lists(), canReopen: ctx.user.role === 'inginer', canIssue: ctx.user.role === 'inginer', preview, ...(extra || {}) }), status || 200);
  }

  router.get('/loturi/:id', {}, (ctx) => detail(ctx));

  const openBatch = (ctx) => { const b = db.get('SELECT * FROM batches WHERE id = ?', idOf(ctx.params.id)); return b; };

  router.post('/loturi/:id', {}, (ctx) => {
    const b = openBatch(ctx);
    if (!b) return page(errorPage(ctx, 'not_found'), 404);
    if (b.status !== 'deschis') return redirect(`/loturi/${b.id}`, { flash: { type: 'err', key: 'e_batch_closed' } });
    const { errors, v } = B.validate(db, ctx.form, { creating: false });
    if (Object.keys(errors).length) return detail(ctx, { errors }, 422);
    B.update(db, ctx.user, b.id, v);
    return redirect(`/loturi/${b.id}`, { flash: { key: 'saved' } });
  });

  router.post('/loturi/:id/tobe', {}, (ctx) => {
    const b = openBatch(ctx);
    if (!b) return page(errorPage(ctx, 'not_found'), 404);
    if (b.status !== 'deschis') return redirect(`/loturi/${b.id}`, { flash: { type: 'err', key: 'e_batch_closed' } });
    const { errors, v } = B.validateDrum(ctx.form);
    if (Object.keys(errors).length) return detail(ctx, { drumErrors: { id: 'new', errors } }, 422);
    const r = B.addDrum(db, ctx.user, b.id, v);
    if (!r.ok) return detail(ctx, { drumErrors: { id: 'new', errors: r.errors } }, 422);
    return redirect(`/loturi/${b.id}`, { flash: { key: 'added' } });
  });

  router.post('/loturi/:id/tobe/:drum', {}, (ctx) => {
    const b = openBatch(ctx);
    if (!b) return page(errorPage(ctx, 'not_found'), 404);
    if (b.status !== 'deschis') return redirect(`/loturi/${b.id}`, { flash: { type: 'err', key: 'e_batch_closed' } });
    const drumId = idOf(ctx.params.drum);
    const { errors, v } = B.validateDrum(ctx.form);
    if (Object.keys(errors).length) return detail(ctx, { drumErrors: { id: drumId, errors } }, 422);
    const r = B.updateDrum(db, ctx.user, b.id, drumId, v);
    if (!r.ok && r.code === 'not_found') return page(errorPage(ctx, 'not_found'), 404);
    if (!r.ok) return detail(ctx, { drumErrors: { id: drumId, errors: r.errors } }, 422);
    return redirect(`/loturi/${b.id}`, { flash: { key: 'saved' } });
  });

  router.post('/loturi/:id/inchide', {}, (ctx) => {
    const b = openBatch(ctx);
    if (!b) return page(errorPage(ctx, 'not_found'), 404);
    B.setStatus(db, ctx.user, b.id, 'inchis');
    return redirect(`/loturi/${b.id}`, { flash: { key: 'batch_closed' } });
  });

  router.post('/loturi/:id/redeschide', { roles: ENG }, (ctx) => {
    const b = openBatch(ctx);
    if (!b) return page(errorPage(ctx, 'not_found'), 404);
    B.setStatus(db, ctx.user, b.id, 'deschis');
    return redirect(`/loturi/${b.id}`, { flash: { key: 'batch_reopened' } });
  });

  // ---- certificates ----

  router.get('/loturi/:id/certificat', {}, (ctx) => {
    const id = idOf(ctx.params.id);
    const snap = C.build(db, id);
    if (!snap) return page(errorPage(ctx, 'not_found'), 404);
    return page(cert.certificatePage(ctx, { snap, preview: true, exemplar: exemplar(ctx), back: `/loturi/${id}`, batchId: id }));
  });

  router.post('/loturi/:id/certificat/emite', { roles: ENG }, (ctx) => {
    const id = idOf(ctx.params.id);
    // the certificate is frozen in one language: the one chosen on the issue form
    const lang = i18n.valid(ctx.form.get('lang')) ? ctx.form.get('lang') : i18n.current();
    const r = i18n.run(lang, () => C.issue(db, ctx.user, id, ctx.form.get('override_reason')));
    if (r.ok) return redirect(`/certificate/${r.id}`, { flash: { key: 'cert_issued' } });
    if (r.code === 'not_found') return page(errorPage(ctx, 'not_found'), 404);
    if (r.code === 'override_required') return detail(ctx, { errors: { override_reason: 'required' } }, 422);
    return redirect(`/loturi/${id}`, { flash: { type: 'err', key: 'e_' + r.code } });
  });

  router.get('/certificate/:id', {}, (ctx) => {
    const c = C.get(db, idOf(ctx.params.id));
    if (!c) return page(errorPage(ctx, 'not_found'), 404);
    // an issued certificate is always shown in the language it was issued in
    return i18n.run(c.snapshot.lang || 'ro', () => page(cert.certificatePage(ctx, { snap: c.snapshot, preview: false, cert: c, exemplar: exemplar(ctx), back: `/loturi/${c.batch_id}`, batchId: c.batch_id })));
  });

  router.get('/proiecte-cablu/:cid/raport-tip', {}, (ctx) => {
    const id = idOf(ctx.params.cid);
    const rep = C.typeReport(db, id);
    if (!rep) return page(errorPage(ctx, 'not_found'), 404);
    return page(cert.typeReportPage(ctx, { rep, exemplar: exemplar(ctx), back: `/fise/${rep.revision.document_id}/revizii/${rep.revision.id}`, id }));
  });
};
