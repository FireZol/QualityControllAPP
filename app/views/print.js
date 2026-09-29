'use strict';
// Printable documents (spec §8): A6 annexes and stranding instructions from the database, and the filtered register.
// Standalone pages (no application navigation); printing is done by the browser, on paper or to PDF.
const { html, raw } = require('../lib/html');
const { T, f } = require('../i18n/ro');
const calc = require('../domain/calc');
const { displayDateTime, displayDate } = require('../lib/time');
const { valueCell } = require('./layout');
const tests = require('../domain/tests');
const { designLine } = require('./cable');

const num = (v, d) => (v === null || v === undefined ? '' : calc.formatNumber(v, 0, d === undefined ? 3 : d));
const matName = (code) => (code === 'Cu' ? T.material.Cu : T.material.Al);

function page(opts) {
  const title = opts.title;
  return html`<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/static/app.css">
<link rel="stylesheet" href="/static/print.css">
${opts.landscape ? html`<link rel="stylesheet" href="/static/print-landscape.css">` : ''}
</head>
<body class="print-page">
${opts.toolbar}
${opts.body}
<script src="/static/app.js"></script>
<script src="/static/print-paginate.js"></script>
</body>
</html>`;
}

function toolbar(ctx, { backHref, action, hidden, exemplar, withExemplar }) {
  return html`<div class="noprint toolbar">
  <a class="btn" href="${backHref}">« ${T.common.back}</a>
  <form method="get" action="${action}" class="inline">
    ${Object.entries(hidden || {}).map(([k, v]) => (v === '' || v === null || v === undefined || v === false ? '' : html`<input type="hidden" name="${k}" value="${v === true ? '1' : v}">`))}
    ${withExemplar ? html`<label>${T.print.copy} <input name="exemplar" value="${exemplar || ''}" maxlength="20" class="short"></label> <button class="btn" type="submit">${T.print.apply}</button>` : ''}
  </form>
  <button type="button" class="btn primary" data-print>${T.print.print}</button>
  <span class="muted">${T.print.hint}</span>
</div>`;
}

/** A4 frame with a repeating header and footer (thead / tfoot repeat on every printed page). */
function frame(d) {
  const { company, title, code, edition, revision, statusNote, footer, content, noMeta } = d;
  return html`<table class="doc" data-label-page="${T.print.page}"${d.landscape ? raw(' data-landscape') : ''}>
  <thead><tr><td>
    <div class="doc-head">
      <div class="doc-company">${company}</div>
      <div class="doc-title">${title}</div>
      ${d.metaHtml ? d.metaHtml : noMeta ? '' : html`<dl class="doc-meta">
        <div><dt>${T.print.code}</dt><dd>${code || T.print.code_unset}</dd></div>
        <div><dt>${T.specs.edition}</dt><dd>${edition}</dd></div>
        <div><dt>${T.specs.revision}</dt><dd>${revision}</dd></div>
      </dl>`}
    </div>
    ${statusNote ? html`<div class="doc-status">${statusNote}</div>` : ''}
  </td></tr></thead>
  <tfoot><tr><td>${footer}</td></tr></tfoot>
  <tbody><tr><td>${content}</td></tr></tbody>
</table>`;
}

// ---------- data sheets ----------

const changed = (diff, c, keys) => {
  const set = diff.changed.get(c.stable_key);
  return !!(set && keys.some((k) => [...set].some((x) => x === k || x.startsWith(k + '.'))));
};

function td(diff, c, keys, content) {
  return html`<td class="${changed(diff, c, keys) ? 'changed' : ''}">${content}</td>`;
}

const range = (l, d) => (l && (l.min !== null || l.max !== null) ? `${num(l.min, d)} … ${num(l.max, d)}` : '');
const lim = (c, level, q) => c.limitMap[`${level}.${q}`];
const rmax = (c, level) => { const l = lim(c, level, 'r20'); return l && l.max !== null && l.max !== undefined ? `≤ ${calc.formatQuantity('r20', l.max)}` : ''; };

function nameCell(c, diff) {
  return html`<td class="${changed(diff, c, ['label', 'shape', 'coated']) ? 'changed' : ''}"><strong>${c.label}</strong>${c.iec_exception_reason ? ' *' : ''}${c.coated ? ` (${T.specs.coated})` : ''}${diff.added.has(c.stable_key) ? html` <span class="new">${T.specs.new_row}</span>` : ''}</td>`;
}

const groupBy = (rows, keyFn, order) => {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  const keys = [...map.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((k) => ({ key: k, rows: map.get(k) }));
};

function table(head, rows) {
  return html`<table class="sheet"><thead><tr>${head.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table>`;
}

function wireSections(full, diff) {
  const names = { Cu: T.print.g_cu, Al: T.print.g_al, 'Al|Purtator': T.print.g_al_carrier, 'Al|EVN': T.print.g_al_evn };
  const groups = groupBy(full.constructions, (c) => (c.material_code === 'Cu' ? 'Cu' : c.destination_name ? `Al|${c.destination_name === 'Purtător' ? 'Purtator' : c.destination_name}` : 'Al'), ['Cu', 'Al', 'Al|Purtator', 'Al|EVN']);
  return groups.map((g) => html`<h2>${names[g.key] || g.key}</h2>${table(
    [T.sheet.construction, T.sheet.destination, T.sheet.die, T.sheet.d_nominal, T.sheet.d_range, T.sheet.wires, T.sheet.mass_kgkm],
    g.rows.map((c) => html`<tr>${nameCell(c, diff)}${td(diff, c, ['destination'], c.destination_name || '')}${td(diff, c, ['die'], c.die || '')}
      ${td(diff, c, ['sarma.d.nominal'], num(lim(c, 'sarma', 'd') && lim(c, 'sarma', 'd').nominal, 3))}${td(diff, c, ['sarma.d.min', 'sarma.d.max'], range(lim(c, 'sarma', 'd'), 3))}
      ${td(diff, c, ['wires'], c.wires || '')}${td(diff, c, ['sarma.mass'], range(lim(c, 'sarma', 'mass'), 3))}</tr>`))}`);
}

function class5Sections(full, diff) {
  const groups = groupBy(full.constructions, (c) => (c.section <= 6 ? 'small' : 'large'), ['small', 'large']);
  const titles = { small: T.print.g_cl5_small, large: T.print.g_cl5_large };
  return groups.map((g) => html`<h2>${titles[g.key]}</h2>${table(
    [T.sheet.construction, T.sheet.die, T.sheet.wires_lita, T.sheet.strands, T.sheet.wire_d5, T.print.wire_in_strand, T.sheet.suvita, T.sheet.toron, T.sheet.lita],
    g.rows.map((c) => html`<tr>${nameCell(c, diff)}${td(diff, c, ['die'], c.die || '')}${td(diff, c, ['wires'], c.wires || '')}
      <td>${c.data.nr_toroane ? `${c.data.nr_toroane} × ${c.data.nr_fire_toron}` : ''}</td>${td(diff, c, ['wire_d'], num(c.wire_d, 3))}<td>${num(c.data.d_sarma_lita, 3)}</td>
      ${td(diff, c, ['suvita.mass'], range(lim(c, 'suvita', 'mass'), 3))}${td(diff, c, ['toron.mass'], range(lim(c, 'toron', 'mass'), 3))}
      ${td(diff, c, ['lita.mass'], lim(c, 'lita', 'mass') ? '≈ ' + num(lim(c, 'lita', 'mass').nominal, 2) : '')}</tr>`))}`);
}

function rigidSections(full, diff) {
  const configs = [...new Set(full.constructions.flatMap((c) => c.params.map((p) => p.strander_config)))];
  if (!configs.length) configs.push('');
  return configs.map((cfg) => {
    // a row without any process parameters still prints (in every table); it must never disappear from the sheet
    const rows = full.constructions.filter((c) => !cfg || !c.params.length || c.params.some((p) => p.strander_config === cfg));
    const rotors = [...new Set(rows.flatMap((c) => c.params.filter((p) => p.strander_config === cfg && p.rotor !== 'receptie').map((p) => p.rotor)))].sort((a, b) => Number(a) - Number(b));
    const anyR = rows.some((c) => rmax(c, 'funie'));
    const head = [T.sheet.construction, T.sheet.wires_x_d, T.sheet.rope_d, T.sheet.mass, ...(anyR ? [T.sheet.r_max] : []), ...rotors.map((r) => f(T.print.rotor_col, { rotor: r })), T.sheet.reception];
    return html`<h2>${f(T.print.g_strander, { config: cfg || '—' })}</h2>${table(head, rows.map((c) => {
      const p = (rot) => c.params.find((x) => x.strander_config === cfg && x.rotor === rot);
      const rec = p('receptie');
      const rope = lim(c, 'funie', 'd')
        ? html`${num(lim(c, 'funie', 'd').nominal, 1)} <span class="muted">(${T.verdict.info})</span>`
        : html`Î ${num(lim(c, 'funie', 'h') && lim(c, 'funie', 'h').nominal, 2)} × L ${num(lim(c, 'funie', 'l') && lim(c, 'funie', 'l').nominal, 2)} <span class="muted">${(lim(c, 'funie', 'h') && lim(c, 'funie', 'h').tolerance_text) || ''}</span>`;
      return html`<tr>${nameCell(c, diff)}${td(diff, c, ['wires', 'wire_d'], c.wires ? `${c.wires} × ${num(c.wire_d, 3)}` : '')}${td(diff, c, ['funie.d', 'funie.h', 'funie.l'], rope)}
        ${td(diff, c, ['funie.mass'], range(lim(c, 'funie', 'mass'), 1))}
        ${anyR ? td(diff, c, ['funie.r20'], rmax(c, 'funie')) : ''}
        ${rotors.map((r) => td(diff, c, [`p.${cfg}.${r}`], p(r) ? `${p(r).pitch_mm == null ? '–' : num(p(r).pitch_mm, 1)} / ${p(r).tension || '–'}` : ''))}
        ${td(diff, c, [`p.${cfg}.receptie`], rec ? rec.tension : '')}</tr>`;
    }))}<p class="small">${T.print.pitch_legend}</p>`;
  });
}

function extrudedSections(full, diff) {
  const groups = groupBy(full.constructions, (c) => c.shape_code, ['RE', 'SE']);
  const titles = { RE: T.print.g_re, SE: T.print.g_se };
  return groups.map((g) => html`<h2>${titles[g.key] || g.key}</h2>${table(
    [T.sheet.construction, T.print.die_drawing, T.sheet.d_nominal, T.sheet.d_range, T.sheet.h_l, T.sheet.mass, T.sheet.r_max],
    g.rows.map((c) => html`<tr>${nameCell(c, diff)}${td(diff, c, ['die'], c.die || '')}
      ${td(diff, c, ['conductor.d.nominal'], num(lim(c, 'conductor', 'd') && lim(c, 'conductor', 'd').nominal, 2))}${td(diff, c, ['conductor.d.min', 'conductor.d.max'], range(lim(c, 'conductor', 'd'), 2))}
      ${td(diff, c, ['conductor.h', 'conductor.l'], lim(c, 'conductor', 'h') || lim(c, 'conductor', 'l') ? (range(lim(c, 'conductor', 'h'), 2) || '–') + ' × ' + (range(lim(c, 'conductor', 'l'), 2) || '–') : '')}
      ${td(diff, c, ['conductor.mass'], range(lim(c, 'conductor', 'mass'), 2))}${td(diff, c, ['conductor.r20'], rmax(c, 'conductor'))}</tr>`))}`);
}

/** Finished cable data sheet: one block per cable design with its required tests and limits. */
function cableSections(full, diff) {
  const cat = tests.catalogue();
  return full.constructions.map((c) => {
    const req = new Set(Array.isArray(c.data.tests) ? c.data.tests : []);
    const rows = [];
    for (const t of cat) {
      const quantities = t.kind === 'passfail' ? [[t.code, null]] : tests.quantitiesOf(t);
      const limited = quantities.some(([q]) => c.limitMap[`cablu.${q}`] && (c.limitMap[`cablu.${q}`].min !== null || c.limitMap[`cablu.${q}`].max !== null));
      if (!req.has(t.code) && !limited) continue;
      for (const [q, part] of quantities) {
        const l = c.limitMap[`cablu.${q}`];
        const cell = (k, v) => td(diff, c, [`cablu.${q}.${k}`], v === null || v === undefined ? '' : calc.formatQuantity(q, v));
        rows.push(html`<tr><td>${t.name}${part ? ` — ${T.tests.parts[part]}` : ''}${!t.in_house ? html` <sup>†</sup>` : ''}</td><td>${t.kind === 'passfail' ? '' : t.unit || ''}</td>
          ${t.kind === 'passfail' ? html`<td colspan="3" class="muted">${T.cable.pass_fail_req}</td>` : html`${cell('min', l && l.min)}${cell('nominal', l && l.nominal)}${cell('max', l && l.max)}`}
          ${td(diff, c, ['data.tests'], req.has(t.code) ? T.common.yes : '')}<td>${T.cable.scopes[t.scope]}</td></tr>`);
      }
    }
    return html`<h2>${c.label} <span class="small muted">${designLine(c)}</span></h2>${table([T.cable.test, T.cable.unit, 'min', T.measure.nominal, 'max', T.print.cable_required, T.print.cable_scope], rows)}`;
  });
}

const BUILDERS = {
  CABLU_LV: cableSections,
  A6_TREFILARE_CL12: wireSections,
  A6_TREFILARE_CL5: class5Sections,
  CABLARE_RIGIDA_AL: rigidSections,
  CABLARE_RIGIDA_CU: rigidSections,
  EXTRUDAT_AL_CL1: extrudedSections,
};

function revisionPrint(ctx, d) {
  const { full, diff, company, exemplar, back } = d;
  const { rev, doc } = full;
  const active = full.constructions.filter((c) => c.active);
  const build = BUILDERS[doc.doc_type] || wireSections;
  const view = { ...full, constructions: active };
  const notes = active.filter((c) => c.iec_exception_reason);
  const content = html`${build(view, diff)}
    ${notes.length ? html`<div class="notes"><strong>${T.print.iec_notes}</strong><ul>${notes.map((c) => html`<li>* ${c.label}: ${c.iec_exception_reason}</li>`)}</ul></div>` : ''}
    ${rev.change_note ? html`<p class="small"><strong>${T.specs.change_note}:</strong> ${rev.change_note}</p>` : ''}
    ${diff.hasBase ? html`<p class="small"><span class="changed">${T.print.red_note}</span></p>` : ''}`;
  const footer = html`<div class="doc-foot">
      <div><span class="k">${T.specs.elaborated}:</span> ${full.authorName || ''} <span class="muted">${displayDate(rev.elaborated_at)}</span></div>
      <div><span class="k">${T.specs.verified}:</span> ${full.verifierName || ''} <span class="muted">${displayDate(rev.verified_at)}</span></div>
      <div><span class="k">${T.print.signature}:</span> <span class="sigline"></span></div>
      <div><span class="k">${T.print.copy}:</span> ${exemplar || ''}</div>
    </div>`;
  const statusNote = rev.status === 'activa' ? '' : f(T.print.not_in_force, { status: T.status[rev.status] });
  return page({
    title: `${doc.title} — ${f(T.specs.ed_rev, { edition: rev.edition, revision: rev.revision })}`,
    toolbar: toolbar(ctx, { backHref: back, action: `/fise/${doc.id}/revizii/${rev.id}/tipar`, withExemplar: true, exemplar }),
    body: frame({ company, title: doc.title, code: doc.code, edition: rev.edition, revision: rev.revision, statusNote, footer, content }),
  });
}

// ---------- register ----------

function registerPrint(ctx, d) {
  const { rows, total, truncated, filters, company, by, lists } = d;
  const label = (id, list, key) => (id ? (list.find((x) => x.id === id) || {})[key] : null);
  const chips = [
    filters.from && `${T.common.from}: ${displayDate(filters.from)}`, filters.to && `${T.common.to}: ${displayDate(filters.to)}`,
    filters.shift && `${T.register.shift}: ${T.shift[filters.shift]}`, label(filters.crew_id, lists.crews, 'name') && `${T.register.crew}: ${label(filters.crew_id, lists.crews, 'name')}`,
    label(filters.family_id, lists.families, 'name') && `${T.measure.family}: ${label(filters.family_id, lists.families, 'name')}`,
    label(filters.machine_id, lists.machines, 'name') && `${T.measure.machine}: ${label(filters.machine_id, lists.machines, 'name')}`,
    label(filters.operator_id, lists.operators, 'full_name') && `${T.measure.operator}: ${label(filters.operator_id, lists.operators, 'full_name')}`,
    label(filters.client_id, lists.clients, 'short_name') && `${T.measure.client}: ${label(filters.client_id, lists.clients, 'short_name')}`,
    filters.q && `${T.register.product}: ${filters.q}`, filters.out && T.register.only_out, filters.all_versions && T.register.all_versions,
  ].filter(Boolean);
  const dia = (r) => (r.resultMap.h || r.resultMap.l ? html`${valueCell(r.resultMap.h, 'h')} × ${valueCell(r.resultMap.l, 'l')}` : html`${valueCell(r.resultMap.d1, 'd1')} · ${valueCell(r.resultMap.d2, 'd2')}`);
  const content = html`<p class="small">${chips.length ? chips.join(' · ') : T.print.no_filters}</p>
    <p class="small">${f(T.register.count, { total })}${truncated ? html` — <strong>${f(T.print.truncated, { n: rows.length })}</strong>` : ''}</p>
    <table class="sheet register-print"><thead><tr><th>${T.register.no}</th><th>${T.common.date}</th><th>${T.register.shift}</th><th>${T.register.crew}</th><th>${T.register.product}</th><th>${T.measure.machine}</th><th>${T.measure.operator}</th><th>${T.measure.client}</th><th>${T.measure.sample_type}</th>
      <th>${T.register.diameter}</th><th>${T.quantity.mass_gm}</th><th>${T.quantity.r20}</th><th>${T.quantity.r20_theor}</th><th>${T.common.notes}</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td>${r.record_no}${r.versions > 1 ? html`<sup>v${r.version}</sup>` : ''}</td><td>${displayDateTime(r.created_at)}</td><td>${T.shift[r.shift]}</td><td>${r.crew_name || ''}</td>
      <td>${r.construction_label} ${r.material_code}${r.family_code === 'FLEXIBIL_CL5' ? ' · ' + T.level[r.level] : ''}</td><td>${r.machine_name}</td><td>${r.operator_name || ''}</td><td>${r.client_name || ''}</td><td>${r.sample_type_name}${r.length_no ? ' ' + r.length_no : ''}</td>
      <td class="nowrap">${dia(r)}</td><td>${valueCell(r.resultMap.mass_gm, 'mass_gm')}</td><td>${valueCell(r.resultMap.r20_echiv || r.resultMap.r20, 'r20')}</td><td>${valueCell(r.resultMap.r20_theor, 'r20_theor')}</td><td>${r.notes || ''}</td></tr>`)}</tbody></table>`;
  const footer = html`<div class="doc-foot"><div>${f(T.print.printed_by, { user: by, when: displayDateTime(d.now) })}</div><div><span class="k">${T.print.signature}:</span> <span class="sigline"></span></div></div>`;
  return page({
    title: T.register.title, landscape: true,
    toolbar: toolbar(ctx, { backHref: '/masuratori' + (d.qs ? '?' + d.qs : ''), action: '/masuratori/tipar', hidden: filters, withExemplar: false }),
    body: frame({ landscape: true, company, title: T.register.title, noMeta: true, statusNote: '', footer, content }),
  });
}

module.exports = { revisionPrint, registerPrint, page, toolbar, frame, table };
