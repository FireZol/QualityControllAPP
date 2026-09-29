'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../domain/analytics');
const svg = require('../lib/svg');
const xp = require('../lib/export');

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${a} !≈ ${b}`);

test('statistics: mean, sample standard deviation, Cp and Cpk', () => {
  const v = [607.5, 608, 608.5, 609, 608.5];
  const s = A.stats(v, 607, 609.4);
  assert.equal(s.n, 5);
  close(s.mean, 608.3);
  close(s.sd, Math.sqrt(((0.8 ** 2) + (0.3 ** 2) + (0.2 ** 2) + (0.7 ** 2) + (0.2 ** 2)) / 4));
  close(s.cp, (609.4 - 607) / (6 * s.sd));
  close(s.cpk, Math.min((609.4 - 608.3) / (3 * s.sd), (608.3 - 607) / (3 * s.sd)));
  assert.equal(s.min, 607.5);
  assert.equal(s.max, 609);
});

test('capability: one-sided limit gives Cpk only, no spread gives none', () => {
  const s = A.stats([1, 2, 3, 4], null, 6);
  assert.equal(s.cp, null);
  close(s.cpk, (6 - 2.5) / (3 * s.sd));
  const flat = A.stats([5, 5, 5], 4, 6);
  assert.equal(flat.cp, null);
  assert.equal(flat.cpk, null);
  assert.equal(A.stats([], 1, 2).n, 0);
  assert.equal(A.stats([3], 1, 5).sd, null);
});

test('histogram covers the limits, counts only data, every value lands in one bin', () => {
  const values = Array.from({ length: 50 }, (_, i) => 100 + (i % 10) * 0.1);
  const h = A.histogram(values, 99.5, 101.5);
  assert.equal(h.bins.reduce((a, b) => a + b.count, 0), 50);
  assert.ok(h.lo <= 99.5 && h.hi >= 101.5);
  assert.ok(h.bins.length >= 5 && h.bins.length <= 30);
  const same = A.histogram([2, 2, 2], null, null);
  assert.equal(same.bins.reduce((a, b) => a + b.count, 0), 3);
});

const row = (o) => ({ quantity: 'mass_gm', value: 0, lim_min: 607, lim_max: 609.4, verdict: 'ok', machine: 'M1', machine_id: 1, shift: 'zi', stable_key: 'K', label: '240', material: 'Al', level: 'funie', produced_length_m: null, ...o });

test('non-conformity counts only results with a verdict and splits sub / peste', () => {
  const rows = [row({ verdict: 'ok' }), row({ verdict: 'ok' }), row({ verdict: 'peste' }), row({ verdict: 'sub' }), row({ verdict: 'info' }), row({ verdict: 'nedeterminat' })];
  const [g] = A.nonconformity(rows, 'product');
  assert.equal(g.n, 4);
  assert.equal(g.sub, 1);
  assert.equal(g.peste, 1);
  close(g.pctOut, 50);
  const two = A.nonconformity([...rows, row({ machine_id: 2, machine: 'M2', verdict: 'ok' })], 'machine');
  assert.equal(two.length, 2);
});

test('extra consumption: g/m and %, kg only where the produced length was entered', () => {
  const rows = [
    row({ value: 610.4, verdict: 'peste', produced_length_m: 1000 }), // +1.0 g/m over 1000 m = 1 kg
    row({ value: 611.4, verdict: 'peste', produced_length_m: null }), // +2.0 g/m, no length
    row({ value: 608, verdict: 'ok' }),
  ];
  const [g] = A.consumption(rows, 'product');
  assert.equal(g.n, 3);
  assert.equal(g.nOver, 2);
  close(g.avgExcess, 1.5);
  close(g.avgPct, ((1 / 609.4) + (2 / 609.4)) / 2 * 100, 1e-9);
  close(g.maxExcess, 2);
  assert.equal(g.nWithLength, 1);
  close(g.kg, 1, 1e-9);
  const none = A.consumption([row({ value: 610.4, verdict: 'peste' })], 'product')[0];
  assert.equal(none.kg, null);
});

test('latest limits and the "limits changed" flag', () => {
  const l = A.latestLimits([row({ lim_min: 607, lim_max: 609.4 }), row({ lim_min: 607.5, lim_max: 609 })]);
  assert.deepEqual([l.min, l.max, l.changed], [607.5, 609, true]);
  assert.equal(A.latestLimits([row({}), row({})]).changed, false);
});

test('SVG charts: valid markup, escaped text, ticks are round numbers', () => {
  const { ticks } = svg.niceTicks(606.8, 609.7, 6);
  assert.ok(ticks.every((t) => Math.abs(t * 10 - Math.round(t * 10)) < 1e-9), ticks.join(','));
  const trend = svg.trendChart({ points: [{ v: 608, min: 607, max: 609.4, verdict: 'ok', label: 'a <b>' }, { v: 610, min: 607, max: 609.4, verdict: 'peste', label: 'x' }], title: 'T <x>', xLabels: [{ i: 0, text: '01.01.2026' }] }).s;
  assert.match(trend, /^<svg/);
  assert.ok(!trend.includes('<b>') && !trend.includes('<x>'));
  assert.match(trend, /ch-pt-out/);
  assert.match(svg.histogramChart({ ...A.histogram([1, 2, 3, 4], 0, 5), mean: 2.5, lsl: 0, usl: 5, title: 'h' }).s, /ch-bar/);
  assert.match(svg.barChart({ items: [{ label: 'x'.repeat(80), value: 3 }], title: 'b', unit: ' %' }).s, /…/);
  assert.match(svg.whiskerChart({ items: [{ label: 'M1', mean: 1, sd: 0.1, min: 0.8, max: 1.2, n: 5 }], lsl: 0.5, usl: 1.5, title: 'w' }).s, /ch-sd/);
  for (const c of [svg.trendChart({ points: [], title: 'e' }), svg.barChart({ items: [], title: 'e' })]) assert.match(c.s, /^<svg/);
});

test('CSV: BOM, semicolons, decimal comma, quotes and formula-injection guard', () => {
  const csv = xp.toCsv([{ key: 'a', header: 'Nume' }, { key: 'b', header: 'Val', type: 'number' }], [{ a: 'x;"y"', b: 1.5 }, { a: '=SUM(A1)', b: null }, { a: '@cmd', b: 2 }]);
  assert.ok(csv.startsWith('﻿Nume;Val\r\n'));
  assert.match(csv, /"x;""y""";1,5/);
  assert.match(csv, /'=SUM\(A1\);/);
  assert.match(csv, /'@cmd;2/);
});

test('XLSX: a valid zip with real numbers, text kept as text, escaped XML', () => {
  const buf = xp.toXlsx([{ name: 'Registru [1]', columns: [{ key: 'a', header: 'A' }, { key: 'n', header: 'N', type: 'number' }], rows: [{ a: '<&>"', n: 1234.5 }, { a: '=1+1', n: null }] }, { name: 'Alta', columns: [{ key: 'x', header: 'X' }], rows: [] }]);
  const files = xp.unzip(buf);
  assert.ok(files['[Content_Types].xml'] && files['xl/workbook.xml'] && files['xl/worksheets/sheet2.xml']);
  const wb = files['xl/workbook.xml'].toString();
  assert.match(wb, /name="Registru  1"/); // forbidden characters replaced
  const sheet = files['xl/worksheets/sheet1.xml'].toString();
  assert.match(sheet, /<v>1234\.5<\/v>/);
  assert.match(sheet, /&lt;&amp;&gt;&quot;/);
  assert.match(sheet, /<is><t xml:space="preserve">=1\+1<\/t><\/is>/); // text, never a formula
  assert.match(sheet, /<pane ySplit="1"/);
  assert.equal(xp.colName(0), 'A');
  assert.equal(xp.colName(27), 'AB');
});
