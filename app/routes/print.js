'use strict';
const { page } = require('../lib/http');
const rev = require('../domain/revisions');
const M = require('../domain/measurements');
const settings = require('../domain/settings');
const views = require('../views/print');
const { errorPage } = require('../views/errors');
const { nowIso } = require('../lib/time');

const idOf = (s) => (/^\d+$/.test(s) ? Number(s) : 0);
const MAX_ROWS = 2000;

module.exports = function register(app) {
  const { router, db } = app;

  router.get('/fise/:doc/revizii/:id/tipar', {}, (ctx) => {
    const full = rev.loadRevision(db, idOf(ctx.params.id), { includeInactive: false });
    if (!full || full.rev.document_id !== idOf(ctx.params.doc)) return page(errorPage(ctx, 'not_found'), 404);
    let prev = null;
    if (full.rev.based_on_id) prev = rev.loadConstructions(db, full.rev.based_on_id, { onlyActive: true });
    const diff = rev.diffAgainst(full.constructions, prev);
    return page(views.revisionPrint(ctx, {
      full, diff, company: settings.get(db, 'company.name'), exemplar: (ctx.query.get('exemplar') || '').trim().slice(0, 20),
      back: `/fise/${full.doc.id}/revizii/${full.rev.id}`,
    }));
  });

  router.get('/masuratori/tipar', {}, (ctx) => {
    const q = ctx.query;
    const int = (k) => (/^\d+$/.test(q.get(k) || '') ? Number(q.get(k)) : null);
    const date = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(q.get(k) || '') ? q.get(k) : '');
    const filters = {
      from: date('from'), to: date('to'), shift: ['zi', 'noapte'].includes(q.get('shift')) ? q.get('shift') : '',
      crew_id: int('crew_id'), family_id: int('family_id'), machine_id: int('machine_id'), operator_id: int('operator_id'),
      client_id: int('client_id'), sample_type_id: int('sample_type_id'), q: (q.get('q') || '').trim().slice(0, 60),
      out: q.get('out') === '1', all_versions: q.get('all_versions') === '1',
    };
    const data = M.register(db, filters, 1, MAX_ROWS);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v !== null && v !== false) qs.set(k, v === true ? '1' : String(v));
    return page(views.registerPrint(ctx, {
      rows: data.rows, total: data.total, truncated: data.total > data.rows.length, filters, company: settings.get(db, 'company.name'),
      by: ctx.user.full_name, now: nowIso(), qs: qs.toString(),
      lists: {
        crews: db.all('SELECT * FROM crews'), families: db.all('SELECT * FROM product_families'), machines: db.all('SELECT * FROM machines'),
        operators: db.all('SELECT * FROM operators'), clients: db.all('SELECT * FROM clients'),
      },
    }));
  });
};
