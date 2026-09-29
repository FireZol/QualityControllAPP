'use strict';
// Server-rendered SVG charts (no chart library, no external files). Colours come from CSS classes (app.css).
const { h, raw } = require('./html');
const calc = require('../domain/calc');

const W = 900, PAD = { l: 64, r: 18, t: 16, b: 46 };

/** "Nice" tick values covering [min, max]. */
function niceTicks(min, max, count) {
  if (min === max) { min -= 0.5; max += 0.5; }
  const span = max - min;
  const raw0 = span / Math.max(1, (count || 6));
  const mag = 10 ** Math.floor(Math.log10(raw0));
  const norm = raw0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toPrecision(12)));
  return { ticks, step };
}

const decimalsFor = (step) => Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
const fmtTick = (v, step) => calc.formatNumber(v, 0, decimalsFor(step));
const r1 = (v) => Math.round(v * 10) / 10;
const t = (x, y, cls, text, extra) => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}"${extra || ''}>${h(text)}</text>`;

function wrap(height, title, inner) {
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${h(title)}" xmlns="http://www.w3.org/2000/svg"><title>${h(title)}</title>${inner}</svg>`);
}

function yAxis(ticks, step, yOf, x0, x1) {
  return ticks.map((v) => `<line x1="${x0}" x2="${x1}" y1="${r1(yOf(v))}" y2="${r1(yOf(v))}" class="ch-grid"/>${t(x0 - 8, yOf(v) + 4, 'ch-text end', fmtTick(v, step))}`).join('');
}

/**
 * Trend of values in time order with the min–max band of the limits each result was judged against.
 * points: [{v, min, max, verdict, label}]  (label = tooltip text)
 */
function trendChart({ points, title, xLabels }) {
  const H = 380;
  if (!points.length) return wrap(H, title, '');
  const vals = points.map((p) => p.v).concat(points.flatMap((p) => [p.min, p.max]).filter((v) => v !== null && v !== undefined));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.06;
  lo -= pad; hi += pad;
  const { ticks, step } = niceTicks(lo, hi, 7);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const x0 = PAD.l, x1 = W - PAD.r, y0 = H - PAD.b, y1 = PAD.t;
  const yOf = (v) => y0 - ((v - lo) / (hi - lo)) * (y0 - y1);
  const n = points.length;
  const xOf = (i) => (n === 1 ? (x0 + x1) / 2 : x0 + 12 + (i / (n - 1)) * (x1 - x0 - 24));
  const stepLine = (key, cls) => {
    let d = '';
    points.forEach((p, i) => {
      if (p[key] === null || p[key] === undefined) { d += ''; return; }
      const x = xOf(i), y = yOf(p[key]);
      d += (d === '' || points[i - 1][key] === null || points[i - 1][key] === undefined) ? `M${r1(x)} ${r1(y)}` : `L${r1(x)} ${r1(y)}`;
    });
    return d ? `<path d="${d}" class="${cls}" fill="none"/>` : '';
  };
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${r1(xOf(i))} ${r1(yOf(p.v))}`).join('');
  const dots = points.map((p, i) => {
    const out = p.verdict === 'sub' || p.verdict === 'peste' || p.verdict === 'neconform';
    const x = xOf(i), y = yOf(p.v);
    const shape = out ? `<path d="M${r1(x)} ${r1(y - 6)} L${r1(x + 6)} ${r1(y + 5)} L${r1(x - 6)} ${r1(y + 5)} Z" class="ch-pt-out"/>` : `<circle cx="${r1(x)}" cy="${r1(y)}" r="3.2" class="ch-pt-${p.verdict === 'ok' ? 'ok' : 'na'}"/>`;
    return `<g>${shape}<title>${h(p.label)}</title></g>`;
  }).join('');
  const xl = (xLabels || []).map(({ i, text }) => t(xOf(i), y0 + 20, `ch-text ${n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'mid'}`, text)).join('');
  return wrap(H, title, `${yAxis(ticks, step, yOf, x0, x1)}<line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" class="ch-axis"/>
    ${stepLine('min', 'ch-lim')}${stepLine('max', 'ch-lim')}<path d="${path}" class="ch-line" fill="none"/>${dots}${xl}`);
}

/** Histogram with mean and limits. */
function histogramChart({ bins, lo, hi, mean, lsl, usl, title }) {
  const H = 340;
  if (!bins.length) return wrap(H, title, '');
  const { ticks: xt, step: xs } = niceTicks(lo, hi, 8);
  const x0 = PAD.l, x1 = W - PAD.r, y0 = H - PAD.b, y1 = PAD.t;
  const xOf = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  const maxC = Math.max(...bins.map((b) => b.count), 1);
  const { ticks: yt, step: ys } = niceTicks(0, maxC, 5);
  const yTop = yt[yt.length - 1];
  const yOf = (c) => y0 - (c / yTop) * (y0 - y1);
  const bars = bins.map((b) => `<rect x="${r1(xOf(b.from) + 1)}" y="${r1(yOf(b.count))}" width="${Math.max(1, r1(xOf(b.to) - xOf(b.from) - 2))}" height="${r1(y0 - yOf(b.count))}" class="ch-bar"><title>${h(`${calc.formatNumber(b.from, 0, 4)} … ${calc.formatNumber(b.to, 0, 4)}: ${b.count}`)}</title></rect>`).join('');
  const vline = (v, cls, label) => (v === null || v === undefined ? '' : `<line x1="${r1(xOf(v))}" x2="${r1(xOf(v))}" y1="${y1}" y2="${y0}" class="${cls}"/>${xOf(v) > x1 - 60 ? t(xOf(v) - 4, y1 + 12, 'ch-text small end', label) : t(xOf(v) + 4, y1 + 12, 'ch-text small', label)}`);
  const xLabels = xt.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9).map((v) => t(xOf(v), y0 + 20, 'ch-text mid', fmtTick(v, xs))).join('');
  return wrap(H, title, `${yAxis(yt, ys, yOf, x0, x1)}${bars}<line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" class="ch-axis"/>${xLabels}
    ${vline(lsl, 'ch-lim', 'min')}${vline(usl, 'ch-lim', 'max')}${vline(mean, 'ch-mean', 'x̄')}`);
}

/** Horizontal bars. items: [{label, value, note}] */
function barChart({ items, title, unit }) {
  const rowH = 30;
  const H = Math.max(80, items.length * rowH + 40);
  if (!items.length) return wrap(H, title, '');
  const labelW = 250, x0 = labelW, x1 = W - 90;
  const max = Math.max(...items.map((i) => i.value), 0.0001);
  const { ticks, step } = niceTicks(0, max, 5);
  const top = ticks[ticks.length - 1] || max;
  const xOf = (v) => x0 + (v / top) * (x1 - x0);
  const grid = ticks.map((v) => `<line x1="${r1(xOf(v))}" x2="${r1(xOf(v))}" y1="10" y2="${H - 26}" class="ch-grid"/>${t(xOf(v), H - 8, 'ch-text mid', fmtTick(v, step))}`).join('');
  const bars = items.map((it, i) => {
    const y = 14 + i * rowH;
    const lab = it.label.length > 38 ? it.label.slice(0, 37) + '…' : it.label;
    return `<g>${t(x0 - 8, y + 15, 'ch-text end', lab)}<rect x="${x0}" y="${y}" width="${Math.max(0, r1(xOf(it.value) - x0))}" height="20" class="ch-bar"><title>${h(`${it.label}: ${calc.formatNumber(it.value, 0, 2)}${unit || ''}`)}</title></rect>${t(xOf(it.value) + 6, y + 15, 'ch-text', `${calc.formatNumber(it.value, 0, 2)}${unit || ''}`)}</g>`;
  }).join('');
  return wrap(H, title, `${grid}${bars}`);
}

/** Comparison: mean ± sd (thick) and min–max (thin) per group on a common axis, limits as vertical lines. */
function whiskerChart({ items, lsl, usl, title }) {
  const rowH = 34;
  const H = Math.max(100, items.length * rowH + 56);
  if (!items.length) return wrap(H, title, '');
  const labelW = 250, x0 = labelW, x1 = W - 30;
  const vals = items.flatMap((i) => [i.min, i.max]).concat([lsl, usl].filter((v) => v !== null && v !== undefined));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.05; lo -= pad; hi += pad;
  const { ticks, step } = niceTicks(lo, hi, 7);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const xOf = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  const grid = ticks.map((v) => `<line x1="${r1(xOf(v))}" x2="${r1(xOf(v))}" y1="10" y2="${H - 30}" class="ch-grid"/>${t(xOf(v), H - 10, 'ch-text mid', fmtTick(v, step))}`).join('');
  const lim = [[lsl, 'min'], [usl, 'max']].filter(([v]) => v !== null && v !== undefined).map(([v, l]) => `<line x1="${r1(xOf(v))}" x2="${r1(xOf(v))}" y1="10" y2="${H - 30}" class="ch-lim"/>${t(xOf(v) + 4, 22, 'ch-text small', l)}`).join('');
  const rows = items.map((it, i) => {
    const y = 34 + i * rowH;
    const lab = it.label.length > 38 ? it.label.slice(0, 37) + '…' : it.label;
    const sd = it.sd || 0;
    return `<g>${t(x0 - 8, y + 4, 'ch-text end', `${lab} (n=${it.n})`)}<line x1="${r1(xOf(it.min))}" x2="${r1(xOf(it.max))}" y1="${y}" y2="${y}" class="ch-range"/>
      <line x1="${r1(xOf(it.mean - sd))}" x2="${r1(xOf(it.mean + sd))}" y1="${y}" y2="${y}" class="ch-sd"/><circle cx="${r1(xOf(it.mean))}" cy="${y}" r="5" class="ch-mean-dot"><title>${h(`${it.label}: x̄ ${calc.formatNumber(it.mean, 0, 4)}, s ${sd ? calc.formatNumber(sd, 0, 4) : '–'}, n=${it.n}`)}</title></circle></g>`;
  }).join('');
  return wrap(H, title, `${grid}${lim}${rows}`);
}

/**
 * Individuals control chart: centre line, control limits, optional specification limits, points flagged by pattern rules.
 * points: [{v, rules:[n], label}]  lines: {cl, ucl, lcl, specMin, specMax}
 */
function controlChartSvg({ points, lines, title, xLabels, yLabel }) {
  const H = 380;
  if (!points.length) return wrap(H, title, '');
  const vals = points.map((p) => p.v).concat([lines.cl, lines.ucl, lines.lcl, lines.specMin, lines.specMax].filter((v) => v !== null && v !== undefined));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.06; lo -= pad; hi += pad;
  const { ticks, step } = niceTicks(lo, hi, 7);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const x0 = PAD.l, x1 = W - PAD.r - 46, y0 = H - PAD.b, y1 = PAD.t;
  const yOf = (v) => y0 - ((v - lo) / (hi - lo)) * (y0 - y1);
  const n = points.length;
  const xOf = (i) => (n === 1 ? (x0 + x1) / 2 : x0 + 8 + (i / (n - 1)) * (x1 - x0 - 16));
  const hline = (v, cls, text) => (v === null || v === undefined ? '' : `<line x1="${x0}" x2="${x1}" y1="${r1(yOf(v))}" y2="${r1(yOf(v))}" class="${cls}"/>${t(x1 + 4, yOf(v) + 4, 'ch-text small', text)}`);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${r1(xOf(i))} ${r1(yOf(p.v))}`).join('');
  const dots = points.map((p, i) => {
    const x = xOf(i), y = yOf(p.v);
    const flagged = p.rules && p.rules.length;
    return `<g>${flagged ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="6" class="ch-pt-out"/>${t(x, y - 9, 'ch-text small mid', p.rules.join(','))}` : `<circle cx="${r1(x)}" cy="${r1(y)}" r="3" class="ch-pt-ok"/>`}<title>${h(p.label)}</title></g>`;
  }).join('');
  const xl = (xLabels || []).map(({ i, text }) => t(xOf(i), y0 + 20, `ch-text ${n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'mid'}`, text)).join('');
  return wrap(H, title, `${yAxis(ticks, step, yOf, x0, x1)}<line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" class="ch-axis"/>
    ${hline(lines.specMin, 'ch-spec', 'min')}${hline(lines.specMax, 'ch-spec', 'max')}${hline(lines.ucl, 'ch-lim', 'UCL')}${hline(lines.lcl, 'ch-lim', 'LCL')}${hline(lines.cl, 'ch-mean', 'CL')}
    <path d="${path}" class="ch-line" fill="none"/>${dots}${xl}`);
}

module.exports = { controlChartSvg, trendChart, histogramChart, barChart, whiskerChart, niceTicks };
