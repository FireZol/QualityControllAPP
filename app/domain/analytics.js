'use strict';
// Analyses over the measurement results (spec §7): trend, distribution and capability, non-conformity rate,
// extra material consumption, comparison. Only current versions of records are analysed.

const QUANTITIES = ['mass_gm', 'd1', 'd2', 'd_avg', 'ovality', 'h', 'l', 'r20', 'r20_theor', 'r20_echiv', 'd_ech'];
const GROUPS = ['product', 'machine', 'shift', 'crew', 'operator', 'client'];
const MAX_ROWS = 100000;

const int = (v) => (/^\d+$/.test(v || '') ? Number(v) : null);
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');

function parseFilters(q) {
  const quantity = /^[a-z][a-z0-9_]{0,60}$/.test(q.get('quantity') || '') ? q.get('quantity') : '';
  return {
    from: date(q.get('from')), to: date(q.get('to')), family_id: int(q.get('family_id')), stable_key: (q.get('product') || '').slice(0, 120),
    machine_id: int(q.get('machine_id')), shift: ['zi', 'noapte'].includes(q.get('shift')) ? q.get('shift') : '', crew_id: int(q.get('crew_id')),
    operator_id: int(q.get('operator_id')), client_id: int(q.get('client_id')), level: ['suvita', 'toron', 'lita'].includes(q.get('level')) ? q.get('level') : '',
    quantity, group: GROUPS.includes(q.get('group')) ? q.get('group') : '', base: int(q.get('base')),
  };
}

/** One row per (current measurement, result quantity) that matches the filters. */
function dataset(db, f, opts) {
  const o = opts || {};
  const where = ['m.is_current = 1'];
  const p = [];
  const add = (cond, v) => { where.push(cond); p.push(v); };
  if (f.from) add('m.shift_date >= ?', f.from);
  if (f.to) add('m.shift_date <= ?', f.to);
  if (f.family_id) add('m.family_id = ?', f.family_id);
  if (f.stable_key) add('c.stable_key = ?', f.stable_key);
  if (f.machine_id) add('m.machine_id = ?', f.machine_id);
  if (f.shift) add('m.shift = ?', f.shift);
  if (f.crew_id) add('m.crew_id = ?', f.crew_id);
  if (f.operator_id) add('m.operator_id = ?', f.operator_id);
  if (f.client_id) add('m.client_id = ?', f.client_id);
  if (f.level) add('m.level = ?', f.level);
  const qty = o.quantity !== undefined ? o.quantity : f.quantity;
  if (qty) add('r.quantity = ?', qty);
  if (o.quantities) where.push(`r.quantity IN (${o.quantities.map(() => '?').join(',')})`), p.push(...o.quantities);
  const sql = `SELECT r.quantity, r.value, r.lim_min, r.lim_max, r.verdict, r.deviation_pct,
      m.id AS measurement_id, m.record_no, m.created_at, m.shift_date, m.shift, m.crew_id, m.machine_id, m.operator_id, m.client_id, m.level, m.produced_length_m, m.family_id,
      c.stable_key, c.label, mat.code AS material, cr.name AS crew, mc.name AS machine, op.full_name AS operator, cl.short_name AS client
    FROM measurement_results r
    JOIN measurements m ON m.id = r.measurement_id
    JOIN constructions c ON c.id = m.construction_id
    JOIN materials mat ON mat.id = c.material_id
    JOIN machines mc ON mc.id = m.machine_id
    LEFT JOIN crews cr ON cr.id = m.crew_id
    LEFT JOIN operators op ON op.id = m.operator_id
    LEFT JOIN clients cl ON cl.id = m.client_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.created_at, m.id, r.rowid LIMIT ${MAX_ROWS}`;
  return db.all(sql, ...p);
}

/** Products that have measurements (for the filter): [{stable_key, label, material}] */
function products(db, familyId) {
  return db.all(`SELECT DISTINCT c.stable_key, c.label, mat.code AS material FROM measurements m JOIN constructions c ON c.id = m.construction_id JOIN materials mat ON mat.id = c.material_id
    WHERE m.is_current = 1 ${familyId ? 'AND m.family_id = ?' : ''} ORDER BY mat.code, c.label`, ...(familyId ? [familyId] : []));
}

/**
 * Descriptive statistics and capability.
 * Cp needs both limits; Cpk uses the nearer limit (one-sided limits give Cpk only). Sample standard deviation (n − 1).
 */
function stats(values, lsl, usl) {
  const n = values.length;
  if (!n) return { n: 0, mean: null, sd: null, min: null, max: null, cp: null, cpk: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const hasL = lsl !== null && lsl !== undefined, hasU = usl !== null && usl !== undefined;
  let cp = null, cpk = null;
  if (sd && sd > 0) {
    if (hasL && hasU) cp = (usl - lsl) / (6 * sd);
    const c = [];
    if (hasU) c.push((usl - mean) / (3 * sd));
    if (hasL) c.push((mean - lsl) / (3 * sd));
    if (c.length) cpk = Math.min(...c);
  }
  return { n, mean, sd, min: Math.min(...values), max: Math.max(...values), cp, cpk };
}

function groupInfo(row, group) {
  switch (group) {
    case 'machine': return [String(row.machine_id), row.machine];
    case 'shift': return [row.shift, row.shift];
    case 'crew': return [String(row.crew_id || 0), row.crew || null];
    case 'operator': return [String(row.operator_id || 0), row.operator || null];
    case 'client': return [String(row.client_id || 0), row.client || null];
    default: return [`${row.stable_key}|${row.level}`, `${row.label} ${row.material}`, row.level];
  }
}

/** Group rows; returns [{key, label, level, rows}] sorted by label. */
function groupRows(rows, group) {
  const map = new Map();
  for (const r of rows) {
    const [key, label, level] = groupInfo(r, group || 'product');
    if (!map.has(key)) map.set(key, { key, label, level: group && group !== 'product' ? undefined : level, rows: [] });
    map.get(key).rows.push(r);
  }
  return [...map.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), 'ro', { numeric: true }));
}

/** Limits of the most recent row that has any; flags when the limits changed inside the group. */
function latestLimits(rows) {
  const seen = new Set();
  let last = { min: null, max: null };
  for (const r of rows) {
    seen.add(`${r.lim_min}|${r.lim_max}`);
    if (r.lim_min !== null || r.lim_max !== null) last = { min: r.lim_min, max: r.lim_max };
  }
  return { ...last, changed: seen.size > 1 };
}

/** Capability rows per group for one quantity. */
function capability(rows, group) {
  return groupRows(rows, group).map((g) => {
    const lim = latestLimits(g.rows);
    const s = stats(g.rows.map((r) => r.value), lim.min, lim.max);
    return { ...g, ...s, lsl: lim.min, usl: lim.max, limitsChanged: lim.changed, informative: g.rows.every((r) => r.verdict === 'info') };
  });
}

/** Histogram: bins over the data range extended to the limits, counts from data only. */
function histogram(values, lsl, usl) {
  if (!values.length) return { bins: [], lo: 0, hi: 1 };
  let lo = Math.min(...values), hi = Math.max(...values);
  if (lsl !== null && lsl !== undefined) lo = Math.min(lo, lsl);
  if (usl !== null && usl !== undefined) hi = Math.max(hi, usl);
  if (hi === lo) { lo -= 0.5; hi += 0.5; }
  const k = Math.min(30, Math.max(5, Math.ceil(Math.sqrt(values.length))));
  const w = (hi - lo) / k;
  const bins = Array.from({ length: k }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, count: 0 }));
  for (const v of values) bins[Math.min(k - 1, Math.floor((v - lo) / w))].count++;
  return { bins, lo, hi };
}

/** Non-conformity per group: results with a verdict (ok / sub / peste) only. */
function nonconformity(rows, group) {
  return groupRows(rows.filter((r) => ['ok', 'sub', 'peste', 'neconform'].includes(r.verdict)), group).map((g) => {
    const n = g.rows.length;
    const sub = g.rows.filter((r) => r.verdict === 'sub').length, peste = g.rows.filter((r) => r.verdict === 'peste').length, neconform = g.rows.filter((r) => r.verdict === 'neconform').length;
    return { ...g, n, ok: n - sub - peste - neconform, sub, peste, neconform, pctOut: n ? ((sub + peste + neconform) / n) * 100 : 0, pctSub: n ? (sub / n) * 100 : 0, pctPeste: n ? (peste / n) * 100 : 0 };
  });
}

/** Extra material: mass above the maximum, in g/m and %, in kg only where the produced length was entered. */
function consumption(rows, group) {
  return groupRows(rows.filter((r) => r.quantity === 'mass_gm' && r.lim_max !== null && r.verdict !== 'info'), group).map((g) => {
    const over = g.rows.filter((r) => r.verdict === 'peste');
    const ex = over.map((r) => r.value - r.lim_max);
    const pct = over.map((r) => ((r.value - r.lim_max) / r.lim_max) * 100);
    const withLen = over.filter((r) => r.produced_length_m > 0);
    const kg = withLen.reduce((a, r) => a + ((r.value - r.lim_max) * r.produced_length_m) / 1000, 0);
    return {
      ...g, n: g.rows.length, nOver: over.length, pctOver: g.rows.length ? (over.length / g.rows.length) * 100 : 0,
      avgExcess: ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null, avgPct: pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : null,
      maxExcess: ex.length ? Math.max(...ex) : null, nWithLength: withLen.length, kg: withLen.length ? kg : null,
    };
  });
}

// ---------- statistical process control: individuals and moving-range chart, Western Electric / Nelson pattern rules ----------

/** Constants of the individuals chart: sigma = MRbar / 1.128; UCL(MR) = 3.267 * MRbar. */
const D2 = 1.128, D4 = 3.267;

/**
 * Control limits come from the process itself (not from the specification) and the pattern rules flag drifts before values leave tolerance.
 * @param values numbers in time order; @param baseN use only the first baseN values for the limits (default all)
 * @returns {{n, cl, sigma, ucl, lcl, mr, mrbar, mrUcl, signals: {i, rules: number[]}[]}|null}
 */
function controlChart(values, baseN) {
  const n = values.length;
  if (n < 3) return null;
  const base = values.slice(0, baseN && baseN >= 3 ? Math.min(baseN, n) : n);
  const cl = base.reduce((a, b) => a + b, 0) / base.length;
  const mrBase = base.slice(1).map((v, i) => Math.abs(v - base[i]));
  const mrbar = mrBase.reduce((a, b) => a + b, 0) / mrBase.length;
  const sigma = mrbar / D2;
  const mr = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const flags = values.map(() => new Set());
  if (!(sigma > 1e-9)) return { n, cl, sigma: 0, ucl: cl, lcl: cl, mr, mrbar, mrUcl: 0, signals: [], degenerate: true }; // constant values: no spread, no chart rules
  {
    const z = values.map((v) => (v - cl) / sigma);
    z.forEach((v, i) => { if (Math.abs(v) > 3) flags[i].add(1); });
    for (let i = 2; i < n; i++) {
      const w = z.slice(i - 2, i + 1);
      if (w.filter((v) => v > 2).length >= 2 && z[i] > 2) flags[i].add(2);
      if (w.filter((v) => v < -2).length >= 2 && z[i] < -2) flags[i].add(2);
    }
    for (let i = 4; i < n; i++) {
      const w = z.slice(i - 4, i + 1);
      if (w.filter((v) => v > 1).length >= 4 && z[i] > 1) flags[i].add(3);
      if (w.filter((v) => v < -1).length >= 4 && z[i] < -1) flags[i].add(3);
    }
  }
  for (let i = 7; i < n; i++) {
    const w = values.slice(i - 7, i + 1);
    if (w.every((v) => v > cl) || w.every((v) => v < cl)) flags[i].add(4);
  }
  for (let i = 5; i < n; i++) {
    const w = values.slice(i - 5, i + 1);
    if (w.every((v, k) => k === 0 || v > w[k - 1]) || w.every((v, k) => k === 0 || v < w[k - 1])) flags[i].add(5);
  }
  return {
    n, cl, sigma, ucl: cl + 3 * sigma, lcl: cl - 3 * sigma, mr, mrbar, mrUcl: D4 * mrbar,
    signals: flags.map((s, i) => ({ i, rules: [...s].sort() })).filter((x) => x.rules.length),
  };
}

/**
 * Alerts for the home page: products / quantities measured in the last days whose latest values break a pattern rule.
 * Needs at least `minN` values; only signals inside the last `recent` values are reported.
 */
function spcAlerts(db, targets, now) {
  const days = 3;
  const since = new Date((now || new Date()).getTime() - days * 86400 * 1000);
  const { isoLocal } = require('../lib/time');
  const pairs = db.all(`SELECT DISTINCT c.stable_key, m.level, r.quantity
    FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id AND m.is_current = 1 JOIN constructions c ON c.id = m.construction_id
    WHERE m.created_at >= ? AND r.verdict IN ('ok','sub','peste') AND r.quantity NOT IN ('d_ech','ovality') LIMIT 300`, isoLocal(since));
  const alerts = [];
  for (const p of pairs) {
    const rows = db.all(`SELECT r.value, r.verdict, m.record_no, m.created_at, c.label, mat.code AS material, mc.name AS machine
      FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id AND m.is_current = 1 JOIN constructions c ON c.id = m.construction_id
      JOIN materials mat ON mat.id = c.material_id JOIN machines mc ON mc.id = m.machine_id
      WHERE c.stable_key = ? AND m.level = ? AND r.quantity = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`, p.stable_key, p.level, p.quantity, targets.spc_window).reverse();
    if (rows.length < targets.spc_min_n) continue;
    const ch = controlChart(rows.map((r) => r.value), rows.length - targets.spc_recent); // limits from the values before the recent ones, so a fresh drift does not stretch them
    if (!ch) continue;
    const recent = ch.signals.filter((s) => s.i >= rows.length - targets.spc_recent);
    if (!recent.length) continue;
    const last = recent[recent.length - 1];
    alerts.push({ stable_key: p.stable_key, quantity: p.quantity, level: p.level, label: rows[0].label, material: rows[0].material, n: rows.length, rules: [...new Set(recent.flatMap((s) => s.rules))], record_no: rows[last.i].record_no, when: rows[last.i].created_at, machine: rows[last.i].machine });
  }
  return alerts.slice(0, 20);
}

module.exports = { controlChart, spcAlerts, QUANTITIES, GROUPS, parseFilters, dataset, products, stats, groupRows, latestLimits, capability, histogram, nonconformity, consumption };
