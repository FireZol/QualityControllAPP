'use strict';
// Analyses (spec §7) and exports. Every role may look and export; nothing here writes.
const { page, redirect, download } = require('../lib/http');
const A = require('../domain/analytics');
const M = require('../domain/measurements');
const calc = require('../domain/calc');
const svg = require('../lib/svg');
const xp = require('../lib/export');
const views = require('../views/analytics');
const { displayDateTime } = require('../lib/time');
const { T, f } = require('../i18n/ro');
const fill = f;
const tests = require('../domain/tests');

const TABS = ['tendinta', 'control', 'distributie', 'neconformitate', 'consum', 'comparatie'];
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

module.exports = function register(app) {
  const { router, db } = app;

  const targets = () => require('../domain/targets').get(db);
  const qLabel = (q) => tests.label(q);
  const verdictText = (v) => T.verdict[v] || v;
  const pct = (v) => (v === null || v === undefined ? '' : calc.formatNumber(v, 1, 1) + ' %');
  const f2 = (v) => (v === null || v === undefined ? '' : calc.formatNumber(v, 2, 2));

  function valueFmt(quantity) { return (v) => (v === null || v === undefined ? '' : calc.formatQuantity(quantity || 'mass_gm', v)); }

  const groupLabel = (g) => T.an.groups[g];

  // ---- the five analyses: each returns {charts: [svg], tables: [{title, columns, rows}], notes: [text]} ----

  function trend(f) {
    const notes = [];
    const quantity = f.quantity || 'mass_gm';
    if (!f.stable_key) return { quantity, notes: [T.an.need_product], charts: [], tables: [] };
    const rows = A.dataset(db, f, { quantity });
    if (!rows.length) return { quantity, notes: [T.an.no_data], charts: [], tables: [] };
    if (new Set(rows.map((r) => r.level)).size > 1) return { quantity, notes: [T.an.need_level], charts: [], tables: [] };
    const points = rows.map((r) => ({
      v: r.value, min: r.lim_min, max: r.lim_max, verdict: r.verdict,
      label: `${displayDateTime(r.created_at)} · #${r.record_no} · ${r.machine} · ${valueFmt(quantity)(r.value)} (${verdictText(r.verdict)})`,
    }));
    const idx = rows.length <= 1 ? [0] : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
    const xLabels = [...new Set(idx)].map((i) => ({ i, text: displayDateTime(rows[i].created_at) }));
    const lim = A.latestLimits(rows);
    const s = A.stats(rows.map((r) => r.value), lim.min, lim.max);
    const out = rows.filter((r) => ['sub', 'peste', 'neconform'].includes(r.verdict)).length;
    if (lim.changed) notes.push(T.an.limits_changed);
    const fmt = valueFmt(quantity);
    return {
      quantity, notes,
      charts: [svg.trendChart({ points, title: `${qLabel(quantity)} — ${rows[0].label} ${rows[0].material}`, xLabels })],
      tables: [
        { title: T.an.summary, main: false, columns: [
          { key: 'n', header: 'n', type: 'number' }, { key: 'mean', header: T.an.mean, type: 'number', fmt }, { key: 'sd', header: T.an.sd, type: 'number', fmt: (v) => (v === null ? '' : calc.formatNumber(v, 0, 4)) },
          { key: 'min', header: 'min', type: 'number', fmt }, { key: 'max', header: 'max', type: 'number', fmt },
          { key: 'lsl', header: T.an.lsl, type: 'number', fmt }, { key: 'usl', header: T.an.usl, type: 'number', fmt }, { key: 'out', header: T.an.out_count, type: 'number' },
        ], rows: [{ ...s, lsl: lim.min, usl: lim.max, out }] },
        { title: T.an.points, main: true, limit: 200, reverse: true, columns: [
          { key: 'record_no', header: T.register.no, type: 'number', href: (r) => `/masuratori/${r.record_no}` }, { key: 'when', header: T.common.date },
          { key: 'machine', header: T.measure.machine }, { key: 'operator', header: T.measure.operator }, { key: 'client', header: T.measure.client },
          { key: 'value', header: qLabel(quantity), type: 'number', fmt, verdict: true }, { key: 'lim_min', header: T.an.lsl, type: 'number', fmt }, { key: 'lim_max', header: T.an.usl, type: 'number', fmt },
          { key: 'verdictText', header: T.detail.verdict },
        ], rows: rows.map((r) => ({ ...r, when: displayDateTime(r.created_at), verdictText: verdictText(r.verdict) })) },
      ],
    };
  }

  function control(f) {
    const quantity = f.quantity || 'mass_gm';
    if (!f.stable_key) return { quantity, notes: [T.an.need_product], charts: [], tables: [] };
    const rows = A.dataset(db, f, { quantity });
    if (!rows.length) return { quantity, notes: [T.an.no_data], charts: [], tables: [] };
    if (new Set(rows.map((r) => r.level)).size > 1) return { quantity, notes: [T.an.need_level], charts: [], tables: [] };
    const ch = A.controlChart(rows.map((r) => r.value), f.base);
    if (!ch) return { quantity, notes: [T.an.spc_too_few], charts: [], tables: [] };
    const tg = targets();
    const notes = [T.an.spc_hint];
    if ((f.base || rows.length) < tg.spc_min_n) notes.push(fill(T.an.spc_small, { n: tg.spc_min_n }));
    const byI = new Map(ch.signals.map((s) => [s.i, s.rules]));
    const fmt = valueFmt(quantity);
    const lim = A.latestLimits(rows);
    const idx = rows.length <= 1 ? [0] : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
    const xLabels = [...new Set(idx)].map((i) => ({ i, text: displayDateTime(rows[i].created_at) }));
    const points = rows.map((r, i) => ({ v: r.value, rules: byI.get(i) || [], label: `${displayDateTime(r.created_at)} · #${r.record_no} · ${r.machine} · ${fmt(r.value)}${byI.get(i) ? ' — ' + byI.get(i).map((n) => T.an.rules[n]).join('; ') : ''}` }));
    const head = `${qLabel(quantity)} — ${rows[0].label} ${rows[0].material}`;
    const mrPoints = ch.mr.map((v, i) => ({ v, rules: v > ch.mrUcl ? [1] : [], label: `MR ${calc.formatNumber(v, 0, 4)}` }));
    return {
      quantity, notes,
      charts: [svg.controlChartSvg({ points, lines: { cl: ch.cl, ucl: ch.ucl, lcl: ch.lcl, specMin: lim.min, specMax: lim.max }, title: head, xLabels }),
        svg.controlChartSvg({ points: mrPoints, lines: { cl: ch.mrbar, ucl: ch.mrUcl, lcl: null }, title: `${T.an.mr_chart} — ${head}` })],
      tables: [
        { title: T.an.summary, main: false, columns: [{ key: 'n', header: 'n', type: 'number' }, { key: 'cl', header: 'CL', type: 'number', fmt }, { key: 'sigma', header: 'σ (MR̄ / 1,128)', type: 'number', fmt: (v) => calc.formatNumber(v, 0, 5) },
          { key: 'lcl', header: 'LCL', type: 'number', fmt }, { key: 'ucl', header: 'UCL', type: 'number', fmt }, { key: 'mrbar', header: 'MR̄', type: 'number', fmt: (v) => calc.formatNumber(v, 0, 5) }, { key: 'sig', header: T.an.signals, type: 'number' }],
          rows: [{ n: ch.n, cl: ch.cl, sigma: ch.sigma, lcl: ch.lcl, ucl: ch.ucl, mrbar: ch.mrbar, sig: ch.signals.length }] },
        { title: T.an.signals, main: true, columns: [{ key: 'record_no', header: T.register.no, type: 'number', href: (r) => `/masuratori/${r.record_no}` }, { key: 'when', header: T.common.date }, { key: 'machine', header: T.measure.machine }, { key: 'value', header: qLabel(quantity), type: 'number', fmt }, { key: 'rules_text', header: T.an.rule }],
          rows: ch.signals.map((s) => ({ record_no: rows[s.i].record_no, when: displayDateTime(rows[s.i].created_at), machine: rows[s.i].machine, value: rows[s.i].value, rules_text: s.rules.map((n) => T.an.rules[n]).join('; ') })) },
      ],
    };
  }

  function capTable(caps, quantity, groupName) {
    const fmt = valueFmt(quantity);
    const tg = targets();
    return {
      title: `${T.an.capability} — ${groupLabel(groupName)}`, main: true,
      columns: [
        { key: 'label', header: groupLabel(groupName), levelKey: 'level' }, { key: 'n', header: 'n', type: 'number' },
        { key: 'mean', header: T.an.mean, type: 'number', fmt }, { key: 'sd', header: T.an.sd, type: 'number', fmt: (v) => (v === null ? '' : calc.formatNumber(v, 0, 4)) },
        { key: 'min', header: 'min', type: 'number', fmt }, { key: 'max', header: 'max', type: 'number', fmt },
        { key: 'lsl', header: T.an.lsl, type: 'number', fmt }, { key: 'usl', header: T.an.usl, type: 'number', fmt },
        { key: 'cp', header: 'Cp', type: 'number', fmt: f2 }, { key: 'cpk', header: 'Cpk', type: 'number', fmt: f2, cpk: { good: tg.cpk_good, min: tg.cpk_min } },
        { key: 'note', header: T.an.note },
      ],
      rows: caps.map((c) => ({
        ...c, label: c.label === null ? T.common.none : (c.level && groupName === 'product' && ['suvita', 'toron', 'lita'].includes(c.level) ? `${c.label} · ${T.level[c.level]}` : c.label),
        note: [c.informative ? T.verdict.info : '', c.n < tg.min_n ? f(T.an.small_n, { n: tg.min_n }) : '', c.limitsChanged ? T.an.limits_changed_short : ''].filter(Boolean).join('; '),
      })),
    };
  }

  function distribution(f) {
    const quantity = f.quantity || 'mass_gm';
    const rows = A.dataset(db, f, { quantity });
    if (!rows.length) return { quantity, notes: [T.an.no_data], charts: [], tables: [] };
    const notes = [T.an.cpk_hint];
    const charts = [];
    if (f.stable_key && new Set(rows.map((r) => r.level)).size <= 1) {
      const lim = A.latestLimits(rows);
      const hist = A.histogram(rows.map((r) => r.value), lim.min, lim.max);
      const s = A.stats(rows.map((r) => r.value), lim.min, lim.max);
      charts.push(svg.histogramChart({ ...hist, mean: s.mean, lsl: lim.min, usl: lim.max, title: `${qLabel(quantity)} — ${rows[0].label} ${rows[0].material}` }));
    } else notes.push(T.an.pick_product_for_histogram);
    const group = f.group || (f.stable_key ? 'machine' : 'product');
    return { quantity, notes, charts, tables: [capTable(A.capability(rows, group), quantity, group)] };
  }

  function nonconf(f) {
    const group = f.group || 'product';
    const rows = A.dataset(db, f, {});
    const list = A.nonconformity(rows, group);
    if (!list.length) return { notes: [T.an.no_data], charts: [], tables: [] };
    const label = (c) => (c.level && group === 'product' && ['suvita', 'toron', 'lita'].includes(c.level) ? `${c.label} · ${T.level[c.level]}` : (c.label === null ? T.common.none : c.label));
    return {
      notes: [T.an.nonconf_hint],
      charts: [svg.barChart({ items: list.map((c) => ({ label: label(c), value: c.pctOut })), title: T.an.nonconf_chart, unit: ' %' })],
      tables: [{ title: `${T.an.nonconf} — ${groupLabel(group)}`, main: true, columns: [
        { key: 'label', header: groupLabel(group) }, { key: 'n', header: T.an.evaluated, type: 'number' }, { key: 'ok', header: T.verdict.ok, type: 'number' },
        { key: 'sub', header: T.verdict.sub, type: 'number' }, { key: 'peste', header: T.verdict.peste, type: 'number' },
        { key: 'pctOut', header: T.an.pct_out, type: 'number', fmt: pct }, { key: 'pctSub', header: T.an.pct_sub, type: 'number', fmt: pct }, { key: 'pctPeste', header: T.an.pct_peste, type: 'number', fmt: pct },
      ], rows: list.map((c) => ({ ...c, label: label(c) })) }],
    };
  }

  function consum(f) {
    const group = f.group || 'product';
    const rows = A.dataset(db, f, { quantity: 'mass_gm' });
    const list = A.consumption(rows, group);
    if (!list.length) return { notes: [T.an.no_data], charts: [], tables: [] };
    const anyKg = list.some((c) => c.kg);
    const fmt = (v) => (v === null || v === undefined ? '' : calc.formatNumber(v, 2, 2));
    const label = (c) => (c.label === null ? T.common.none : c.label);
    return {
      notes: [T.an.consum_hint],
      charts: [svg.barChart({ items: list.filter((c) => c.nOver).map((c) => ({ label: label(c), value: anyKg ? (c.kg || 0) : c.avgExcess })), title: anyKg ? T.an.consum_chart_kg : T.an.consum_chart_gm, unit: anyKg ? ' kg' : ' g/m' })],
      tables: [{ title: `${T.an.consum} — ${groupLabel(group)}`, main: true, columns: [
        { key: 'label', header: groupLabel(group) }, { key: 'n', header: T.an.mass_results, type: 'number' }, { key: 'nOver', header: T.an.over_count, type: 'number' },
        { key: 'pctOver', header: T.an.pct_over, type: 'number', fmt: pct }, { key: 'avgExcess', header: T.an.avg_excess_gm, type: 'number', fmt },
        { key: 'avgPct', header: T.an.avg_excess_pct, type: 'number', fmt: pct }, { key: 'maxExcess', header: T.an.max_excess_gm, type: 'number', fmt },
        { key: 'nWithLength', header: T.an.with_length, type: 'number' }, { key: 'kg', header: T.an.excess_kg, type: 'number', fmt },
      ], rows: list.map((c) => ({ ...c, label: label(c) })) }],
    };
  }

  function compare(f) {
    const quantity = f.quantity || 'mass_gm';
    if (!f.stable_key) return { quantity, notes: [T.an.need_product], charts: [], tables: [] };
    const rows = A.dataset(db, f, { quantity });
    if (!rows.length) return { quantity, notes: [T.an.no_data], charts: [], tables: [] };
    if (new Set(rows.map((r) => r.level)).size > 1) return { quantity, notes: [T.an.need_level], charts: [], tables: [] };
    const group = f.group || 'machine';
    const caps = A.capability(rows, group).filter((c) => c.n);
    const lim = A.latestLimits(rows);
    const t = capTable(caps, quantity, group);
    t.columns.splice(t.columns.length - 1, 0, { key: 'pctOut', header: T.an.pct_out, type: 'number', fmt: pct });
    const byKey = new Map(A.groupRows(rows, group).map((g) => [g.key, g.rows]));
    t.rows.forEach((r) => {
      const gr = byKey.get(r.key) || [];
      const ev = gr.filter((x) => ['ok', 'sub', 'peste', 'neconform'].includes(x.verdict));
      r.pctOut = ev.length ? (ev.filter((x) => x.verdict !== 'ok').length / ev.length) * 100 : null;
    });
    return {
      quantity, notes: [T.an.compare_hint],
      charts: [svg.whiskerChart({ items: caps.map((c) => ({ label: c.label === null ? T.common.none : c.label, mean: c.mean, sd: c.sd, min: c.min, max: c.max, n: c.n })), lsl: lim.min, usl: lim.max, title: `${qLabel(quantity)} — ${groupLabel(group)}` })],
      tables: [t],
    };
  }

  const RUN = { tendinta: trend, control, distributie: distribution, neconformitate: nonconf, consum, comparatie: compare };

  router.get('/analize', {}, () => redirect('/analize/tendinta'));

  for (const tab of TABS) {
    router.get(`/analize/${tab}`, {}, (ctx) => {
      const f = A.parseFilters(ctx.query);
      const res = RUN[tab](f);
      const fmt = ctx.query.get('format');
      if (fmt === 'csv' || fmt === 'xlsx') {
        const tables = res.tables.filter((t) => t.rows.length);
        const main = tables.find((t) => t.main) || tables[0];
        if (!main) return page(views.analysisPage(ctx, { tab, f, res, ...meta(f) }), 200);
        const name = `analiza-${tab}-${stamp()}`;
        if (fmt === 'csv') return download(xp.toCsv(main.columns, main.rows), `${name}.csv`, 'text/csv; charset=utf-8');
        return download(xp.toXlsx(tables.map((t) => ({ name: t.title, columns: t.columns, rows: t.rows }))), `${name}.xlsx`, XLSX_TYPE);
      }
      return page(views.analysisPage(ctx, { tab, f, res, ...meta(f) }));
    });
  }

  function meta(f) {
    return {
      quantities: A.QUANTITIES.concat(db.all('SELECT DISTINCT quantity FROM measurement_results').map((r) => r.quantity).filter((q) => !A.QUANTITIES.includes(q))),
      lists: {
        families: db.all('SELECT * FROM product_families ORDER BY sort'), machines: db.all('SELECT * FROM machines ORDER BY name'), crews: db.all('SELECT * FROM crews ORDER BY name'),
        operators: db.all('SELECT * FROM operators ORDER BY full_name'), clients: db.all('SELECT * FROM clients ORDER BY short_name'), products: A.products(db, f.family_id),
      },
    };
  }

  // ---- register export (all filtered rows, current versions unless "all versions") ----

  router.get('/masuratori/export', {}, (ctx) => {
    const q = ctx.query;
    const int = (k) => (/^\d+$/.test(q.get(k) || '') ? Number(q.get(k)) : null);
    const date = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(q.get(k) || '') ? q.get(k) : '');
    const filters = {
      from: date('from'), to: date('to'), shift: ['zi', 'noapte'].includes(q.get('shift')) ? q.get('shift') : '',
      crew_id: int('crew_id'), family_id: int('family_id'), machine_id: int('machine_id'), operator_id: int('operator_id'),
      client_id: int('client_id'), sample_type_id: int('sample_type_id'), q: (q.get('q') || '').trim().slice(0, 60),
      out: q.get('out') === '1', all_versions: q.get('all_versions') === '1',
    };
    const data = M.register(db, filters, 1, 100000);
    const rows = data.rows.map((r) => {
      const o = {
        record_no: r.record_no, version: r.version, current: r.is_current ? 'da' : 'nu', created_at: r.created_at, shift_date: r.shift_date, shift: T.shift[r.shift], crew: r.crew_name || '',
        family: r.family_name, level: r.family_code === 'FLEXIBIL_CL5' ? T.level[r.level] : '', product: r.construction_label, material: r.material_code, machine: r.machine_name,
        operator: r.operator_name || '', client: r.client_name || '', sample_type: r.sample_type_name, length_no: r.length_no, produced_length_m: r.produced_length_m,
        out_of_limit: r.results.some((x) => ['sub', 'peste', 'neconform'].includes(x.verdict)) ? 'da' : 'nu', notes: r.notes || '', user: r.user_name, revision: `Ed. ${r.rev_edition} Rev. ${r.rev_revision}`,
      };
      for (const k of ['d1', 'd2', 'd_avg', 'ovality', 'h', 'l', 'mass_gm', 'r20', 'r20_theor', 'r20_echiv']) o[k] = r.resultMap[k] ? r.resultMap[k].value : null;
      return o;
    });
    const num = (key, header) => ({ key, header, type: 'number' });
    const wide = [
      num('record_no', T.register.no), num('version', T.export.version), { key: 'current', header: T.export.current }, { key: 'created_at', header: T.export.created_at },
      { key: 'shift_date', header: T.export.shift_date }, { key: 'shift', header: T.register.shift }, { key: 'crew', header: T.register.crew }, { key: 'family', header: T.measure.family },
      { key: 'level', header: T.measure.level }, { key: 'product', header: T.register.product }, { key: 'material', header: T.export.material }, { key: 'machine', header: T.measure.machine },
      { key: 'operator', header: T.measure.operator }, { key: 'client', header: T.measure.client }, { key: 'sample_type', header: T.measure.sample_type }, num('length_no', T.measure.length_no),
      num('produced_length_m', T.measure.produced_length),
      ...['d1', 'd2', 'd_avg', 'ovality', 'h', 'l', 'mass_gm', 'r20', 'r20_theor', 'r20_echiv'].map((k) => num(k, T.quantity[k])),
      { key: 'out_of_limit', header: T.export.out_of_limit }, { key: 'notes', header: T.common.notes }, { key: 'user', header: T.common.user }, { key: 'revision', header: T.export.revision },
    ];
    const fmt = q.get('format') === 'xlsx' ? 'xlsx' : 'csv';
    const name = `registru-masuratori-${stamp()}`;
    if (fmt === 'csv') return download(xp.toCsv(wide, rows), `${name}.csv`, 'text/csv; charset=utf-8');
    const long = [];
    const inputs = [];
    for (const r of data.rows) {
      for (const x of r.results) {
        long.push({ record_no: r.record_no, version: r.version, created_at: r.created_at, product: r.construction_label, material: r.material_code, machine: r.machine_name, quantity: tests.label(x.quantity),
          value: x.value, lim_min: x.lim_min, lim_max: x.lim_max, verdict: verdictText(x.verdict), deviation_pct: x.deviation_pct, source: x.source });
      }
      for (const i of db.all('SELECT key, value FROM measurement_inputs WHERE measurement_id = ?', r.id)) inputs.push({ record_no: r.record_no, version: r.version, key: tests.inputLabel(i.key), value: i.value });
    }
    const longCols = [num('record_no', T.register.no), num('version', T.export.version), { key: 'created_at', header: T.export.created_at }, { key: 'product', header: T.register.product }, { key: 'material', header: T.export.material },
      { key: 'machine', header: T.measure.machine }, { key: 'quantity', header: T.detail.quantity }, num('value', T.detail.value), num('lim_min', T.export.lim_min), num('lim_max', T.export.lim_max),
      { key: 'verdict', header: T.detail.verdict }, num('deviation_pct', T.detail.deviation), { key: 'source', header: T.detail.source }];
    const inCols = [num('record_no', T.register.no), num('version', T.export.version), { key: 'key', header: T.detail.quantity }, { key: 'value', header: T.detail.value }];
    return download(xp.toXlsx([{ name: T.export.sheet_register, columns: wide, rows }, { name: T.export.sheet_results, columns: longCols, rows: long }, { name: T.export.sheet_inputs, columns: inCols, rows: inputs }]), `${name}.xlsx`, XLSX_TYPE);
  });
};
