'use strict';
// Engineering configuration pages (Inginer): product-family switches, targets and thresholds, the IEC 60228 reference values.
const { html, raw } = require('../lib/html');
const { T, f } = require('../i18n');
const { layout, csrf, textField, selectField, errText } = require('./layout');
const calc = require('../domain/calc');
const { LIMITS } = require('../domain/targets');

const comma = (v) => (v === null || v === undefined ? '' : calc.dec(String(v)));

function familiesPage(ctx, d) {
  const { rows, err } = d;
  return layout(ctx, {
    title: T.cfg.families, active: 'lists', wide: true,
    body: html`<p><a href="/liste">« ${T.lists.title}</a></p><h1>${T.cfg.families}</h1><p class="muted">${T.cfg.families_intro}</p>
<div class="scroll"><table class="grid"><thead><tr><th>${T.measure.family}</th><th>${T.cfg.f_active}</th><th>${T.cfg.f_mass}</th><th>${T.cfg.f_theor}</th><th>${T.cfg.f_r_cu}</th><th>${T.cfg.f_r_al}</th><th></th></tr></thead>
<tbody>${rows.map((r) => html`<tr class="${r.active ? '' : 'inactive'}"><th scope="row">${r.name}<div class="muted small-text">${r.code}${r.iec_class ? ` · IEC cl. ${r.iec_class}` : ''}</div></th>
  ${['active', 'mass', 'theor', 'r_cu', 'r_al'].map((k) => html`<td><input type="checkbox" name="${k}" value="1" form="fam${r.id}" aria-label="${T.cfg['f_' + k]}"${r.flags[k] ? raw(' checked') : ''}></td>`)}
  <td><form method="post" action="/liste/familii/${r.id}" id="fam${r.id}" class="inline">${csrf(ctx)}<button class="btn small" type="submit">${T.common.save}</button></form></td></tr>`)}</tbody></table></div>
<p class="muted">${T.cfg.families_rule}</p>${err ? html`<p class="field-error">${err}</p>` : ''}`,
  });
}

function targetsPage(ctx, d) {
  const { values, errors } = d;
  const field = (k, unit) => textField({ label: T.cfg.t[k] + (unit ? ` [${unit}]` : ''), name: k, value: comma(values[k]), errors, inputmode: 'decimal', cls: 'num', hint: f(T.cfg.range, { min: comma(LIMITS[k][0]), max: comma(LIMITS[k][1]) }), required: true });
  return layout(ctx, {
    title: T.cfg.targets, active: 'lists',
    body: html`<p><a href="/liste">« ${T.lists.title}</a></p><h1>${T.cfg.targets}</h1><p class="muted">${T.cfg.targets_intro}</p>
<form method="post" action="/liste/tinte" class="card">${csrf(ctx)}
  <h2>${T.cfg.t_group_entry}</h2><div class="row">${field('sample_mm', 'mm')}${field('r_sample_m', 'm')}${field('temp_min', '°C')}${field('temp_max', '°C')}</div>
  <h2>${T.cfg.t_group_analysis}</h2><div class="row">${field('cpk_good')}${field('cpk_min')}${field('min_n')}</div>
  <h2>${T.cfg.t_group_checks}</h2><div class="row">${field('mass_ratio_min')}${field('mass_ratio_max')}</div>
  <h2>${T.cfg.t_group_spc}</h2><div class="row">${field('spc_min_n')}${field('spc_window')}${field('spc_recent')}</div>
  <div class="actions"><button class="btn primary" type="submit">${T.common.save}</button></div></form>
<div class="card"><h2>${T.cfg.rule_title}</h2><p>${T.cfg.rule_text}</p><ul>
  <li><span class="val v-ok">${T.verdict.ok}</span> ${T.cfg.rule_green}</li><li><span class="val v-peste">${T.verdict.peste}</span> ${T.cfg.rule_red}</li></ul>
  <p class="muted">${T.cfg.rule_where}</p></div>`,
  });
}

const CLASSES = [[1, 'Tab. 3 — clasa 1'], [2, 'Tab. 4 — clasa 2'], [5, 'Tab. 5 — clasa 5']];

function iecPage(ctx, d) {
  const { rows, filters, err } = d;
  const e = (id) => (err && err.id === id ? err : null);
  const cls = filters.iec_class;
  const cell = (r, name, val, w) => html`<td><input name="${name}" value="${comma(val)}" form="iec${r.id}" inputmode="decimal" autocomplete="off" class="${w || ''}"></td>`;
  return layout(ctx, {
    title: T.cfg.iec, active: 'lists', wide: true,
    body: html`<p><a href="/liste">« ${T.lists.title}</a></p><h1>${T.cfg.iec}</h1><p class="notice">${T.cfg.iec_licence}</p>
<form method="get" action="/liste/iec" class="card filters"><div class="row">
  ${selectField({ label: T.cfg.iec_table, name: 'clasa', value: cls, options: CLASSES.map(([v, l]) => [v, l]) })}
  ${selectField({ label: T.export.material, name: 'material', value: filters.material, options: [['Cu', T.material.Cu], ['Al', T.material.Al]], blank: T.common.all })}
  <button class="btn primary" type="submit">${T.common.filter}</button></div></form>
<section class="card"><h2>${T.common.add}</h2>
<form method="post" action="/liste/iec/nou" class="row addrow">${csrf(ctx)}<input type="hidden" name="iec_class" value="${cls}">
  ${textField({ label: T.specs.section, name: 'section', value: e('new') ? e('new').values.section : '', errors: e('new') && e('new').errors, inputmode: 'decimal', cls: 'num', required: true })}
  ${selectField({ label: T.export.material, name: 'material', value: e('new') ? e('new').values.material : 'Cu', options: [['Cu', T.material.Cu], ['Al', T.material.Al]] })}
  <label class="check"><input type="checkbox" name="coated" value="1"${e('new') && e('new').values.coated ? raw(' checked') : ''}> <span>${T.specs.coated_label}</span></label>
  ${textField({ label: T.cfg.iec_rmax, name: 'r_max', value: e('new') ? e('new').values.r_max : '', errors: e('new') && e('new').errors, inputmode: 'decimal', cls: 'num' })}
  <button class="btn primary" type="submit">${T.common.add}</button></form></section>
<section class="card"><div class="scroll"><table class="grid"><thead><tr><th>${T.specs.section}</th><th>${T.export.material}</th><th>${T.specs.coated_label}</th><th>${T.cfg.iec_rmax}</th>
  ${cls === 2 ? html`<th>${T.cfg.iec_w_circ}</th><th>${T.cfg.iec_w_comp}</th><th>${T.cfg.iec_w_shaped}</th>` : ''}${cls === 5 ? html`<th>${T.cfg.iec_dmax}</th>` : ''}<th>${T.common.notes}</th><th></th></tr></thead>
<tbody>${rows.map((r) => {
    const x = e(r.id);
    const v = (k) => (x ? x.values[k] : r[k]);
    return html`<tr><th scope="row">${comma(r.section)}</th><td>${T.material[r.material]}</td><td>${r.coated ? T.common.yes : T.common.no}</td>
    ${cell(r, 'r_max', v('r_max'))}${cls === 2 ? html`${cell(r, 'min_wires_circular', v('min_wires_circular'), 'short')}${cell(r, 'min_wires_compacted', v('min_wires_compacted'), 'short')}${cell(r, 'min_wires_shaped', v('min_wires_shaped'), 'short')}` : ''}
    ${cls === 5 ? cell(r, 'd_max_wire', v('d_max_wire')) : ''}<td><input name="note" value="${v('note') || ''}" form="iec${r.id}" maxlength="200"></td>
    <td><form method="post" action="/liste/iec/${r.id}" id="iec${r.id}" class="inline">${csrf(ctx)}<input type="hidden" name="clasa" value="${cls}"><button class="btn small" type="submit">${T.common.save}</button></form>${x ? errText(x.errors, 'r_max') : ''}</td></tr>`;
  })}</tbody></table></div></section>`,
  });
}

function testsPage(ctx, d) {
  const { rows, err } = d;
  const e = (id) => (err && err.id === id ? err : null);
  const inp = (r, name, val, cls) => html`<td><input name="${name}" value="${val === null || val === undefined ? '' : val}" form="tt${r.id}" class="${cls || ''}" autocomplete="off"></td>`;
  return layout(ctx, {
    title: T.cfg.tests, active: 'lists', wide: true,
    body: html`<p><a href="/liste">« ${T.lists.title}</a></p><h1>${T.cfg.tests}</h1><p class="muted">${T.cfg.tests_intro}</p>
<section class="card"><h2>${T.common.add}</h2><form method="post" action="/liste/incercari/adauga" class="row addrow">${csrf(ctx)}
  ${textField({ label: T.cfg.test_code, name: 'code', value: e('new') ? e('new').values.code : '', errors: e('new') && e('new').errors, hint: T.cfg.test_code_hint, required: true })}
  ${textField({ label: T.common.name, name: 'name', value: e('new') ? e('new').values.name : '', errors: e('new') && e('new').errors, required: true, cls: 'grow' })}
  ${selectField({ label: T.cfg.test_kind, name: 'kind', value: e('new') ? e('new').values.kind : 'numeric', options: ['numeric', 'readings', 'passfail', 'resistance'].map((k) => [k, T.cfg.kinds[k]]) })}
  ${textField({ label: T.cfg.test_unit, name: 'unit', value: e('new') ? e('new').values.unit : '', cls: 'num' })}
  ${selectField({ label: T.cfg.test_scope, name: 'scope', value: e('new') ? e('new').values.scope : 'sample', options: ['routine', 'sample', 'type'].map((s) => [s, T.cable.scopes[s]]) })}
  <input type="hidden" name="active" value="1"><input type="hidden" name="in_house" value="1">
  <button class="btn primary" type="submit">${T.common.add}</button></form></section>
<div class="scroll"><table class="grid"><thead><tr><th>${T.cfg.test_code}</th><th>${T.common.name}</th><th>${T.cfg.test_kind}</th><th>${T.cfg.test_unit}</th><th>${T.cfg.test_decimals}</th><th>${T.cfg.test_scope}</th><th>${T.cfg.test_applies}</th><th>${T.cfg.test_ref}</th><th>${T.cfg.test_inhouse}</th><th>${T.common.active}</th><th>${T.cfg.test_sort}</th><th></th></tr></thead>
<tbody>${rows.map((r) => {
    const x = e(r.id);
    const v = (k) => (x ? x.values[k] : r[k]);
    return html`<tr class="${r.active ? '' : 'inactive'}"><th scope="row"><code>${r.code}</code></th>${inp(r, 'name', v('name'), 'wide-in')}<td>${T.cfg.kinds[r.kind]}</td>${inp(r, 'unit', v('unit'), 'short')}${inp(r, 'decimals', v('decimals'), 'short')}
    <td><select name="scope" form="tt${r.id}">${['routine', 'sample', 'type'].map((s) => html`<option value="${s}"${v('scope') === s ? raw(' selected') : ''}>${T.cable.scopes[s]}</option>`)}</select></td>
    ${inp(r, 'applies_to', v('applies_to'), 'short')}${inp(r, 'standard_ref', v('standard_ref'), 'wide-in')}
    <td><input type="checkbox" name="in_house" value="1" form="tt${r.id}" aria-label="${T.cfg.test_inhouse}"${(x ? x.values.in_house : r.in_house) ? raw(' checked') : ''}></td>
    <td><input type="checkbox" name="active" value="1" form="tt${r.id}" aria-label="${T.common.active}"${(x ? x.values.active : r.active) ? raw(' checked') : ''}></td>${inp(r, 'sort', v('sort'), 'short')}
    <td><form method="post" action="/liste/incercari/${r.id}" id="tt${r.id}" class="inline">${csrf(ctx)}<button class="btn small" type="submit">${T.common.save}</button></form>${x ? Object.keys(x.errors).map((k) => errText(x.errors, k)) : ''}</td></tr>`;
  })}</tbody></table></div><p class="muted">${T.cfg.tests_note}</p>`,
  });
}

module.exports = { familiesPage, targetsPage, iecPage, testsPage };
