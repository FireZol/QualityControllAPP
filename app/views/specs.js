'use strict';
const { html, raw } = require('../lib/html');
const { T, f, opt, S } = require('../i18n/ro');
const { designLine } = require('./cable');
const calc = require('../domain/calc');
const tests = require('../domain/tests');
const { displayDateTime } = require('../lib/time');
const { layout, csrf, textField, selectField, checkField, textArea } = require('./layout');
const { materialName } = require('./measure');

const fmt = (v, q) => (v === null || v === undefined ? '' : calc.formatQuantity(q || 'mass_gm', v));
const num = (v, d) => (v === null || v === undefined ? '' : calc.formatNumber(v, 0, d === undefined ? 3 : d));

function statusBadge(status) { return html`<span class="tag st-${status}">${T.status[status]}</span>`; }

// ---------- documents list ----------

function docsPage(ctx, docs) {
  return layout(ctx, {
    title: T.specs.title, active: 'specs',
    body: html`<h1>${T.specs.title}</h1>
<div class="scroll"><table class="grid"><thead><tr><th>${T.specs.document}</th><th>${T.specs.code}</th><th>${T.measure.family}</th><th>${T.specs.active_revision}</th><th>${T.specs.open_revision}</th><th></th></tr></thead>
<tbody>${docs.map((d) => html`<tr><td><a href="/fise/${d.id}">${d.title}</a></td><td>${d.code || html`<span class="muted">${T.specs.code_unset}</span>`}</td><td>${d.family_name}${d.family_active ? '' : html` <span class="tag">${T.specs.later_stage}</span>`}</td>
  <td>${d.active ? html`<a href="/fise/${d.id}/revizii/${d.active.id}">${f(T.specs.ed_rev, { edition: d.active.edition, revision: d.active.revision })}</a> <span class="muted">${displayDateTime(d.active.activated_at)}</span>` : html`<span class="muted">${T.specs.none_active}</span>`}</td>
  <td>${d.open ? html`<a href="/fise/${d.id}/revizii/${d.open.id}">${f(T.specs.ed_rev, { edition: d.open.edition, revision: d.open.revision })}</a> ${statusBadge(d.open.status)}` : ''}</td>
  <td><a class="btn" href="/fise/${d.id}">${T.specs.revisions}</a></td></tr>`)}</tbody></table></div>`,
  });
}

function docPage(ctx, d) {
  const { doc, revisions, canCreate, createBlockedReason, isEngineer } = d;
  return layout(ctx, {
    title: doc.title, active: 'specs',
    body: html`<p><a href="/fise">« ${T.specs.title}</a></p>
<h1>${doc.title}</h1>
<p class="muted">${doc.family_name} · ${T.specs.code}: ${doc.code || T.specs.code_unset}</p>
${isEngineer && doc.family_active ? html`<form method="post" action="/fise/${doc.id}/revizii/noua" class="inline">${csrf(ctx)}
  <button class="btn primary" type="submit"${canCreate ? '' : raw(' disabled')}>${T.specs.new_revision}</button>
  ${createBlockedReason ? html`<span class="muted">${T.specs[createBlockedReason]}</span>` : html`<span class="muted">${T.specs.new_revision_hint}</span>`}</form>` : ''}
${doc.family_active ? '' : html`<p class="notice">${T.specs.later_stage_notice}</p>`}
<div class="scroll"><table class="grid"><thead><tr><th>${T.specs.edition}</th><th>${T.specs.revision}</th><th>${T.common.status}</th><th>${T.specs.elaborated}</th><th>${T.specs.verified}</th><th>${T.specs.activated}</th><th>${T.specs.change_note}</th></tr></thead>
<tbody>${revisions.map((r) => html`<tr><td>${r.edition}</td><td><a href="/fise/${doc.id}/revizii/${r.id}">${r.revision}</a></td><td>${statusBadge(r.status)}</td>
  <td>${r.author || ''} <span class="muted">${displayDateTime(r.elaborated_at)}</span></td><td>${r.verifier || ''} <span class="muted">${displayDateTime(r.verified_at)}</span></td>
  <td>${displayDateTime(r.activated_at)}</td><td>${r.change_note || ''}</td></tr>`)}</tbody></table></div>`,
  });
}

// ---------- construction tables (per family, like the paper sheets) ----------

function changedFor(diff, c, keys) {
  const set = diff.changed.get(c.stable_key);
  return !!(set && keys.some((k) => [...set].some((x) => x === k || x.startsWith(k + '.'))));
}

function cell(diff, c, keys, content) {
  const cls = changedFor(diff, c, keys) ? 'changed' : '';
  return html`<td class="${cls}">${content}</td>`;
}

function limRange(c, level, q, quantity) {
  const l = c.limitMap[`${level}.${q}`];
  if (!l) return '';
  if (l.informative) return html`<span class="muted">${l.nominal != null ? fmt(l.nominal, quantity || q) : ''} (${T.verdict.info})</span>`;
  if (l.min == null && l.max == null) return html`<span class="muted">${T.verdict.nedeterminat}</span>`;
  return `${fmt(l.min, quantity || q)} … ${fmt(l.max, quantity || q)}`;
}

function label(c, diff) {
  const marks = [];
  if (diff.added.has(c.stable_key)) marks.push(html`<span class="tag added">${T.specs.new_row}</span>`);
  if (c.data && (c.data.modificat === 'rosu' || c.data.d_fir_modificat)) marks.push(html`<span class="tag red-paper" title="${T.specs.red_paper_title}">${T.specs.red_paper}</span>`);
  if (c.data && c.data.modificat === 'galben') marks.push(html`<span class="tag yellow-paper" title="${T.specs.yellow_paper_title}">${T.specs.yellow_paper}</span>`);
  if (c.iec_exception_reason) marks.push(html`<span class="tag warn" title="${c.iec_exception_reason}">${T.specs.iec_exception}</span>`);
  return html`<strong>${c.label}</strong> <span class="tag">${materialName(c.material_code)}</span>${c.coated ? html` <span class="tag">${T.specs.coated}</span>` : ''} ${marks}`;
}

function paramsCell(c) {
  if (!c.params.length) return '';
  const byCfg = {};
  for (const p of c.params) (byCfg[p.strander_config] = byCfg[p.strander_config] || []).push(p);
  return Object.entries(byCfg).map(([cfg, ps]) => html`<div class="params"><span class="muted">${cfg}</span> ${ps.filter((p) => p.rotor !== 'receptie').map((p) => html`<span class="rot">R${p.rotor}: ${p.pitch_mm == null ? '–' : num(p.pitch_mm, 1) + ' mm'} / ${p.tension || '–'}</span>`)}</div>`);
}

function receptie(c) {
  const p = c.params.find((x) => x.rotor === 'receptie');
  return p ? p.tension : '';
}

/** The sheet's own resistance target (lower is better); empty when the IEC 60228 value applies. */
const rMax = (c, level) => { const l = c.limitMap[`${level}.r20`]; return l && l.max !== null && l.max !== undefined ? `≤ ${fmt(l.max, 'r20')}` : ''; };

const COLUMNS = {
  FUNIE_RIGIDA: [
    { h: 'construction', keys: ['label', 'shape', 'coated'], r: (c, d) => label(c, d) },
    { h: 'wires_x_d', keys: ['wires', 'wire_d'], r: (c) => (c.wires ? `${c.wires} × ${num(c.wire_d, 3)}` : '') },
    { h: 'rope_d', keys: ['funie.d', 'funie.h', 'funie.l'], r: (c) => (c.limitMap['funie.d'] ? limRange(c, 'funie', 'd', 'd1') : html`Î ${limRange(c, 'funie', 'h')}<br>L ${limRange(c, 'funie', 'l')}`) },
    { h: 'mass', keys: ['funie.mass'], r: (c) => limRange(c, 'funie', 'mass', 'mass_gm') },
    { h: 'r_max', keys: ['funie.r20'], r: (c) => rMax(c, 'funie') },
    { h: 'stranding', keys: ['p.'], r: (c) => paramsCell(c) },
    { h: 'reception', keys: ['p.'], r: (c) => receptie(c) },
  ],
  EXTRUDAT_AL: [
    { h: 'construction', keys: ['label', 'shape'], r: (c, d) => label(c, d) },
    { h: 'die', keys: ['die'], r: (c) => c.die || '' },
    { h: 'd_nominal', keys: ['conductor.d.nominal'], r: (c) => (c.limitMap['conductor.d'] ? fmt(c.limitMap['conductor.d'].nominal, 'd1') : '') },
    { h: 'd_range', keys: ['conductor.d.min', 'conductor.d.max'], r: (c) => limRange(c, 'conductor', 'd', 'd1') },
    { h: 'h_l', keys: ['conductor.h', 'conductor.l'], r: (c) => (c.limitMap['conductor.h'] || c.limitMap['conductor.l'] ? html`Î ${limRange(c, 'conductor', 'h')} · L ${limRange(c, 'conductor', 'l')}` : '') },
    { h: 'mass', keys: ['conductor.mass'], r: (c) => limRange(c, 'conductor', 'mass', 'mass_gm') },
    { h: 'r_max', keys: ['conductor.r20'], r: (c) => rMax(c, 'conductor') },
  ],
  SARMA_CL12: [
    { h: 'construction', keys: ['label', 'shape'], r: (c, d) => label(c, d) },
    { h: 'destination', keys: ['destination'], r: (c) => c.destination_name || '' },
    { h: 'die', keys: ['die'], r: (c) => c.die || '' },
    { h: 'd_nominal', keys: ['sarma.d.nominal'], r: (c) => fmt(c.limitMap['sarma.d'] && c.limitMap['sarma.d'].nominal, 'd1') },
    { h: 'd_range', keys: ['sarma.d.min', 'sarma.d.max'], r: (c) => { const l = c.limitMap['sarma.d']; return l ? `${num(l.min, 3)} … ${num(l.max, 3)}` : ''; } },
    { h: 'wires', keys: ['wires'], r: (c) => c.wires || '' },
    { h: 'mass_kgkm', keys: ['sarma.mass'], r: (c) => { const l = c.limitMap['sarma.mass']; return l ? `${num(l.min, 3)} … ${num(l.max, 3)}` : ''; } },
  ],
  FLEXIBIL_CL5: [
    { h: 'construction', keys: ['label'], r: (c, d) => label(c, d) },
    { h: 'die', keys: ['die'], r: (c) => c.die || '' },
    { h: 'wires_lita', keys: ['wires'], r: (c) => c.wires || '' },
    { h: 'strands', keys: [], r: (c) => (c.data.nr_toroane ? `${c.data.nr_toroane} × ${c.data.nr_fire_toron}` : '') },
    { h: 'wire_d5', keys: ['wire_d'], r: (c) => num(c.wire_d, 3) },
    { h: 'suvita', keys: ['suvita.mass'], r: (c) => limRange(c, 'suvita', 'mass', 'mass_gm') },
    { h: 'toron', keys: ['toron.mass'], r: (c) => limRange(c, 'toron', 'mass', 'mass_gm') },
    { h: 'lita', keys: ['lita.mass'], r: (c) => (c.limitMap['lita.mass'] ? '≈ ' + fmt(c.limitMap['lita.mass'].nominal, 'mass_gm') : '') },
    { h: 'r_max', keys: ['lita.r20'], r: (c) => rMax(c, 'lita') },
  ],
};
COLUMNS.SARMA_CL5 = COLUMNS.SARMA_CL12;
COLUMNS.CABLE_LV = [
  { h: 'construction', keys: ['label'], r: (c, d) => label(c, d) },
  { h: 'cable_design', keys: ['data.cores', 'data.conductor_class'], r: (c) => designLine(c) },
  { h: 'cable_voltage', keys: ['data.rated_voltage'], r: (c) => (c.data && c.data.rated_voltage) || '' },
  { h: 'cable_compounds', keys: ['data.insulation', 'data.sheath'], r: (c) => [c.data && c.data.insulation, c.data && c.data.sheath].filter(Boolean).join(' / ') },
  { h: 'cable_standard', keys: ['data.standard'], r: (c) => (c.data && c.data.standard) || '' },
  { h: 'cable_report', keys: [], r: (c) => html`<a href="/proiecte-cablu/${c.id}/raport-tip">${T.cable.type_report_link}</a>` },
  { h: 'cable_tests', keys: ['data.tests'], r: (c) => f(T.cable.tests_count, { req: Array.isArray(c.data && c.data.tests) ? c.data.tests.length : 0, lim: c.limits.filter((l) => l.min !== null || l.max !== null).length }) },
];

function constructionTable(ctx, full, diff, editable, backBase) {
  const cols = COLUMNS[full.family.code] || COLUMNS.FUNIE_RIGIDA;
  return html`<div class="scroll"><table class="grid sheet"><thead><tr>${cols.map((c) => html`<th>${T.sheet[c.h]}</th>`)}${editable ? html`<th>${T.common.actions}</th>` : ''}</tr></thead>
<tbody>${full.constructions.map((c) => html`<tr class="${c.active ? '' : 'inactive'}">${cols.map((col) => cell(diff, c, col.keys, col.r(c, diff)))}
  ${editable ? html`<td class="nowrap"><a class="btn small" href="${backBase}/constructii/${c.id}">${T.common.edit}</a>
    <form method="post" action="${backBase}/constructii/${c.id}/${c.active ? 'dezactiveaza' : 'activeaza'}" class="inline">${csrf(ctx)}<button type="submit" class="btn small">${c.active ? T.common.deactivate : T.common.activate}</button></form></td>` : ''}</tr>`)}
${full.constructions.length ? '' : html`<tr><td colspan="${cols.length + 1}" class="empty">${T.specs.no_constructions}</td></tr>`}</tbody></table></div>
${diff.removed.length ? html`<details class="removed"><summary>${f(T.specs.removed_rows, { n: diff.removed.length })}</summary><ul>${diff.removed.map((c) => html`<li>${c.label} <span class="tag">${materialName(c.material_code)}</span></li>`)}</ul></details>` : ''}`;
}

function findingsBox(findings, revisionId, docId) {
  if (!findings.length) return html`<p class="ok-note">${T.specs.checks_ok}</p>`;
  const msg = (x) => {
    const tpl = opt('iec', x.code, x.code);
    const p = { ...x.params };
    for (const k of Object.keys(p)) if (typeof p[k] === 'number') p[k] = calc.formatNumber(p[k], 0, 3);
    return f(tpl, p);
  };
  return html`<ul class="findings">${findings.map((x) => html`<li class="f-${x.level}"><strong>${x.level === 'error' ? T.specs.blocking : T.specs.warning}</strong>
    ${x.construction ? html`<a href="/fise/${docId}/revizii/${revisionId}/constructii/${x.construction.id}">${x.construction.label}</a>: ` : ''}${msg(x)}</li>`)}</ul>`;
}

function revisionPage(ctx, d) {
  const { full, diff, findings, warnings, perms } = d;
  const { rev, doc, family } = full;
  const base = `/fise/${doc.id}/revizii/${rev.id}`;
  const editable = perms.canEdit;
  return layout(ctx, {
    title: `${doc.title} — ${f(T.specs.ed_rev, { edition: rev.edition, revision: rev.revision })}`, active: 'specs', wide: true, scripts: [],
    body: html`<p><a href="/fise/${doc.id}">« ${doc.title}</a></p>
<h1>${doc.title}</h1>
<p>${statusBadge(rev.status)} <strong>${f(T.specs.ed_rev, { edition: rev.edition, revision: rev.revision })}</strong>${doc.code ? html` · ${T.specs.code}: ${doc.code}` : ''} <a class="btn small" href="${base}/tipar">${T.print.open_print}</a></p>
<dl class="facts">
  <div><dt>${T.specs.elaborated}</dt><dd>${full.authorName || T.common.none} <span class="muted">${displayDateTime(rev.elaborated_at)}</span></dd></div>
  <div><dt>${T.specs.verified}</dt><dd>${full.verifierName || T.common.none} <span class="muted">${displayDateTime(rev.verified_at)}</span></dd></div>
  ${rev.activated_at ? html`<div><dt>${T.specs.activated}</dt><dd>${displayDateTime(rev.activated_at)}</dd></div>` : ''}
  ${rev.change_note ? html`<div class="wide-fact"><dt>${T.specs.change_note}</dt><dd>${rev.change_note}</dd></div>` : ''}
  ${rev.rejected_reason && rev.status === 'ciorna' ? html`<div class="wide-fact"><dt>${T.specs.rejected}</dt><dd>${full.rejecterName || ''} ${displayDateTime(rev.rejected_at)}: <em>${rev.rejected_reason}</em></dd></div>` : ''}
</dl>

${!family.docActive ? html`<p class="notice">${T.specs.later_stage_notice}</p>` : ''}

${perms.canSubmit || perms.canVerify || perms.authorWaits || perms.viewerIsAuthor ? html`<section class="card workflow"><h2>${T.specs.workflow}</h2>
  ${perms.canSubmit ? html`<form method="post" action="${base}/trimite" class="inline">${csrf(ctx)}<button class="btn primary" type="submit">${T.specs.submit}</button> <span class="muted">${T.specs.submit_hint}</span></form>` : ''}
  ${perms.canVerify ? html`<div class="row">
    <form method="post" action="${base}/verifica" data-confirm="${T.specs.verify_confirm}">${csrf(ctx)}<button class="btn primary" type="submit">${T.specs.verify}</button></form>
    <form method="post" action="${base}/respinge" class="reject">${csrf(ctx)}${textField({ label: T.specs.reject_reason, name: 'reason', required: true })}<button class="btn" type="submit">${T.specs.reject}</button></form></div>` : ''}
  ${perms.viewerIsAuthor && rev.status === 'in_verificare' ? html`<p class="muted">${T.specs.author_cannot_verify}</p>` : ''}
  ${perms.authorWaits ? html`<p class="muted">${T.specs.waiting_verification}</p>` : ''}
</section>` : ''}

${warnings.length ? html`<section class="card seed-warnings"><h2>${T.specs.data_quality}</h2><p class="muted">${T.specs.data_quality_hint}</p>
  <ul>${warnings.map((w) => html`<li class="lvl-${w.level}"><span class="tag lvl">${w.level}</span> <strong>${w.location}</strong>: ${w.problem}</li>`)}</ul></section>` : ''}

${(rev.status === 'ciorna' || rev.status === 'in_verificare') && family.docActive ? html`<section class="card"><h2>${T.specs.iec_checks}</h2>${findingsBox(findings, rev.id, doc.id)}</section>` : ''}

${editable ? html`<section class="card"><h2>${T.specs.header_edit}</h2>
<form method="post" action="${base}/antet" class="row">${csrf(ctx)}
  ${textField({ label: T.specs.code, name: 'code', value: doc.code, hint: T.specs.code_hint })}
  ${textField({ label: T.specs.edition, name: 'edition', value: rev.edition, inputmode: 'numeric', cls: 'num', required: true })}
  ${textField({ label: T.specs.revision, name: 'revision', value: rev.revision, inputmode: 'numeric', cls: 'num', required: true })}
  ${textField({ label: T.specs.change_note, name: 'change_note', value: rev.change_note, cls: 'grow' })}
  <button class="btn" type="submit">${T.common.save}</button></form></section>` : ''}

<h2>${T.specs.constructions}</h2>
${diff.hasBase ? html`<p class="muted"><span class="changed legend">${T.specs.changed_legend}</span> ${T.specs.changed_hint}</p>` : ''}
${editable ? html`<p><a class="btn primary" href="${base}/constructii/noua">${T.specs.add_construction}</a></p>` : ''}
${constructionTable(ctx, full, diff, editable, base)}`,
  });
}

// ---------- construction editor ----------

function limitRows(family) {
  const lvl = family.levels[0];
  switch (family.code) {
    case 'CABLE_LV': {
      const rows = [];
      for (const scope of ['routine', 'sample', 'type']) {
        for (const t of tests.active().filter((x) => x.scope === scope)) {
          for (const [q, part] of tests.quantitiesOf(t)) rows.push({ level: 'cablu', q, unit: t.unit || '', cls: '', inf: true, group: scope, label: part ? `${t.name} — ${S.tests.parts[part]}` : t.name });
        }
      }
      return rows;
    }
    case 'FUNIE_RIGIDA': case 'EXTRUDAT_AL':
      return [
        { level: lvl, q: 'd', unit: 'mm', cls: 'only-round', inf: true }, { level: lvl, q: 'h', unit: 'mm', cls: 'only-sector', tol: true }, { level: lvl, q: 'l', unit: 'mm', cls: 'only-sector', tol: true },
        { level: lvl, q: 'mass', unit: 'g/m', cls: '' }, { level: lvl, q: 'r20', unit: 'Ω/km', cls: '' },
      ];
    case 'SARMA_CL12': case 'SARMA_CL5': return [{ level: 'sarma', q: 'd', unit: 'mm', cls: '' }, { level: 'sarma', q: 'mass', unit: 'g/m', cls: '' }, { level: 'sarma', q: 'r20', unit: 'Ω/km', cls: '' }];
    default: return [{ level: 'sarma', q: 'd', unit: 'mm', cls: '' }, { level: 'suvita', q: 'mass', unit: 'g/m', cls: '' }, { level: 'toron', q: 'mass', unit: 'g/m', cls: '' }, { level: 'lita', q: 'mass', unit: 'g/m', cls: '' }, { level: 'lita', q: 'r20', unit: 'Ω/km', cls: '' }];
  }
}

/** Cable design data: voltage, cores, compounds, standard and the tests its data sheet requires. */
function cableFields(v, errors, lists) {
  const sel = (v.cab_tests_all || v.cab_tests_list || []);
  const compounds = lists.compounds.map((c) => [c.code, c.name]);
  return html`<fieldset class="card"><legend>${T.cable.design_data}</legend><div class="row">
    ${textField({ label: T.cable.cores, name: 'cab_cores', value: v.cab_cores, errors, inputmode: 'numeric', cls: 'num' })}
    ${textField({ label: T.cable.rated_voltage, name: 'cab_voltage', value: v.cab_voltage, errors, hint: T.cable.rated_voltage_hint })}
    ${selectField({ label: T.cable.conductor_class, name: 'cab_class', value: v.cab_class || '2', options: [['1', '1'], ['2', '2'], ['5', '5']], errors })}
    ${selectField({ label: T.cable.insulation, name: 'cab_insulation', value: v.cab_insulation, options: compounds, blank: T.common.none, errors })}
    ${selectField({ label: T.cable.sheath, name: 'cab_sheath', value: v.cab_sheath, options: compounds, blank: T.common.none, errors })}
    ${selectField({ label: T.cable.standard, name: 'cab_standard', value: v.cab_standard, options: lists.standards.map((s) => [s.name, s.name]), blank: T.common.none, errors })}
    ${textField({ label: T.cable.armour, name: 'cab_armour', value: v.cab_armour, errors })}
  </div><h3>${T.cable.required_tests}</h3><p class="muted">${T.cable.required_tests_hint}</p>
  ${['routine', 'sample', 'type'].map((scope) => html`<div class="checklist"><strong>${T.cable.scopes[scope]}</strong>
    ${tests.active().filter((t) => t.scope === scope).map((t) => html`<label class="check"><input type="checkbox" name="cab_tests" value="${t.code}"${sel.includes(t.code) ? raw(' checked') : ''}> <span>${t.name}${t.applies_to ? html` <span class="tag">${t.applies_to}</span>` : ''}${!t.in_house ? html` <span class="tag warn">${T.cable.external}</span>` : ''}</span></label>`)}</div>`)}
  </fieldset>`;
}

function constructionForm(ctx, d) {
  const { full, cons, values, errors, lists, base } = d;
  const { family } = full;
  const v = values;
  const rows = limitRows(family);
  const rot = (i, k) => (v.params && v.params[i] ? v.params[i][k] : '');
  const showParams = family.code === 'FUNIE_RIGIDA';
  const cab = family.code === 'CABLE_LV';
  const heading = cons ? f(T.specs.edit_construction, { label: cons.label }) : T.specs.add_construction;
  return layout(ctx, {
    title: heading, active: 'specs', wide: true, scripts: ['/static/specs.js'],
    body: html`<p><a href="${base}">« ${f(T.specs.ed_rev, { edition: full.rev.edition, revision: full.rev.revision })}</a></p>
<h1>${heading}</h1>
<form method="post" action="${base}/constructii/${cons ? cons.id : 'noua'}" class="entry construction-form">${csrf(ctx)}
<fieldset class="card"><legend>${T.specs.identity}</legend><div class="row">
  ${selectField({ label: T.specs.material, name: 'material_id', value: v.material_id, options: lists.materials.map((m) => [m.id, m.name]), errors, required: true })}
  ${textField({ label: T.specs.section, name: 'section', value: v.section, errors, required: true, inputmode: 'decimal', cls: 'num' })}
  <label class="field${errors.shape_id ? ' has-error' : ''}"><span class="lbl">${T.specs.shape} <abbr title="${T.common.required}">*</abbr></span>
    <select name="shape_id" id="shape-select" required>${lists.shapes.map((s) => html`<option value="${s.id}" data-kind="${s.kind}"${String(s.id) === String(v.shape_id) ? raw(' selected') : ''}>${s.name}</option>`)}</select></label>
  ${selectField({ label: T.specs.destination, name: 'destination_id', value: v.destination_id, options: lists.destinations.map((x) => [x.id, x.name]), blank: T.common.none, errors })}
  ${checkField({ label: T.specs.coated_label, name: 'coated', checked: v.coated })}
</div>
<div class="row">
  ${textField({ label: T.specs.printed_label, name: 'label', value: v.label, errors, hint: T.specs.printed_label_hint })}
  ${cab ? '' : html`${textField({ label: T.specs.wires, name: 'wires', value: v.wires, errors, inputmode: 'numeric', cls: 'num' })}
  ${textField({ label: T.specs.wire_d, name: 'wire_d', value: v.wire_d, errors, inputmode: 'decimal', cls: 'num' })}
  ${textField({ label: T.specs.die, name: 'die', value: v.die, errors, hint: T.specs.die_hint })}`}
</div>
${textArea({ label: T.specs.iec_exception_reason, name: 'iec_exception_reason', value: v.iec_exception_reason, errors, rows: 2 })}
<p class="muted">${T.specs.iec_exception_hint}</p>
</fieldset>

${cab ? cableFields(v, errors, lists, tests) : ''}
<fieldset class="card"><legend>${T.specs.limits}</legend>
<table class="grid limits-edit"><thead><tr><th></th><th>${T.measure.nominal}</th><th>min</th><th>max</th><th>${T.specs.tolerance}</th><th>${T.verdict.info}</th></tr></thead><tbody>
${rows.map((r, i) => {
    const k = `lim_${r.level}_${r.q}`;
    const head = r.group && (i === 0 || rows[i - 1].group !== r.group) ? html`<tr class="group-row"><th colspan="6">${T.cable.scopes[r.group]}</th></tr>` : '';
    return html`${head}<tr class="${r.cls}"><th scope="row">${r.label || opt('limitq', `${r.level}_${r.q}`, opt('limitq', r.q, r.q))} <span class="muted">[${r.unit}]</span></th>
    <td><input name="${k}_nominal" value="${v[k + '_nominal'] || ''}" inputmode="decimal" autocomplete="off"></td>
    <td><input name="${k}_min" value="${v[k + '_min'] || ''}" inputmode="decimal" autocomplete="off"></td>
    <td><input name="${k}_max" value="${v[k + '_max'] || ''}" inputmode="decimal" autocomplete="off"></td>
    <td>${r.tol ? html`<input name="${k}_tol" value="${v[k + '_tol'] || ''}" inputmode="decimal" placeholder="±" autocomplete="off">` : ''}</td>
    <td>${r.inf ? html`<input type="checkbox" name="${k}_inf" value="1"${v[k + '_inf'] ? raw(' checked') : ''}>` : ''}</td></tr>${errors[k] ? html`<tr><td colspan="6"><span class="field-error">${opt('errors', errors[k], T.errors.invalid)}</span></td></tr>` : ''}`;
  })}</tbody></table>
<p class="muted">${T.specs.limits_hint}</p><p class="muted">${T.specs.r20_hint}</p></fieldset>

${showParams ? html`<fieldset class="card"><legend>${T.specs.process_params}</legend>
<table class="grid limits-edit"><thead><tr><th>${T.specs.strander}</th><th>${T.specs.rotor}</th><th>${T.specs.pitch}</th><th>${T.specs.tension}</th></tr></thead><tbody>
${Array.from({ length: d.paramRows }, (_, i) => html`<tr>
  <td><input name="p${i}_config" value="${rot(i, 'strander_config') || ''}" placeholder="1+6+12+18" autocomplete="off"></td>
  <td><input name="p${i}_rotor" value="${rot(i, 'rotor') || ''}" placeholder="12" autocomplete="off"></td>
  <td><input name="p${i}_pitch" value="${rot(i, 'pitch_mm') || ''}" inputmode="decimal" autocomplete="off"></td>
  <td><input name="p${i}_tension" value="${rot(i, 'tension') || ''}" autocomplete="off"></td></tr>`)}
</tbody></table>
<input type="hidden" name="param_rows" value="${d.paramRows}">
<p class="muted">${T.specs.params_hint}</p></fieldset>` : ''}

<div class="actions"><button class="btn primary big" type="submit">${T.common.save}</button><a class="btn" href="${base}">${T.common.cancel}</a></div>
</form>`,
  });
}

function statsPage(ctx, d) {
  const { cons, rows, base } = d;
  return layout(ctx, {
    title: T.stats.title, active: 'specs',
    body: html`<p><a href="${base}">« ${T.common.back}</a></p><h1>${f(T.stats.heading, { label: cons.label })}</h1><p class="muted">${T.stats.hint}</p>
<table class="grid"><thead><tr><th>${T.detail.quantity}</th><th>n</th><th>${T.stats.mean}</th><th>min</th><th>max</th><th>${T.stats.sd}</th></tr></thead>
<tbody>${rows.length ? rows.map((r) => html`<tr><th scope="row">${tests.label(r.quantity)}</th><td>${r.n}</td><td>${calc.formatQuantity(r.quantity, r.mean)}</td><td>${calc.formatQuantity(r.quantity, r.min)}</td><td>${calc.formatQuantity(r.quantity, r.max)}</td><td>${r.sd === null ? '' : calc.formatNumber(r.sd, 0, 4)}</td></tr>`) : html`<tr><td colspan="6" class="empty">${T.stats.empty}</td></tr>`}</tbody></table>`,
  });
}

module.exports = { docsPage, docPage, revisionPage, constructionForm, statsPage, limitRows, statusBadge };
