'use strict';
const { html, h, raw, jsonBlock } = require('../lib/html');
const { T, f, opt } = require('../i18n/ro');
const calc = require('../domain/calc');
const tests = require('../domain/tests');
const { displayDateTime, displayDate } = require('../lib/time');
const L = require('./layout');
const { layout, csrf, textField, selectField, textArea, valueCell, limitText, verdictBadge, pager } = L;

const materialName = (code) => (code === 'Cu' ? T.material.Cu : T.material.Al);

// ---------- limits reference table (server-rendered, works without JS) ----------

function limitsTable(model) {
  const { ctx } = model;
  const rows = [];
  const add = (label, l, q) => rows.push(html`<tr><th scope="row">${label}</th><td>${l && l.nominal != null ? calc.formatQuantity(q, l.nominal) : ''}</td>
    <td>${l ? (l.informative ? T.verdict.info : limitText(l.min, l.max, q)) : T.verdict.nedeterminat}</td><td>${l && l.informative ? T.measure.informative_note : T.measure.source_sheet}</td></tr>`);
  if (ctx.measuresDiameter && ctx.shapeKind === 'sector') { add(T.quantity.h, ctx.limits.h, 'h'); add(T.quantity.l, ctx.limits.l, 'l'); } else if (ctx.measuresDiameter) add(T.quantity.d, ctx.limits.d, 'd1');
  if (ctx.measuresMass) add(T.quantity.mass_gm, ctx.limits.mass, 'mass_gm');
  if (ctx.iec && (ctx.measuresR || ctx.theoretical)) rows.push(html`<tr><th scope="row">${ctx.rEquivN ? T.quantity.r_max_finished : T.quantity.r_max}</th><td></td><td>≤ ${calc.formatQuantity('r20', ctx.iec.r_max)}</td><td>${ctx.iec.source === 'fisa' ? T.measure.source_sheet : ctx.iec.source}</td></tr>`);
  return html`<table class="grid limits"><caption>${T.measure.limits_caption}</caption><thead><tr><th></th><th>${T.measure.nominal}</th><th>${T.measure.limits}</th><th>${T.measure.source}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- the entry form (new measurement and correction share it) ----------

function numInput(name, label, values, errors, opts) {
  const o = opts || {};
  return textField({ label, name, value: values[name], errors, required: o.required, inputmode: 'decimal', hint: o.hint, cls: 'num', attrs: `autocomplete="off" data-in="${name}"` });
}

/**
 * @param sel   {family, machine, construction, revision} loaded rows
 * @param model from measurements.formModel
 * @param data  {values, meta, errors, lists:{operators,clients,sampleTypes,machines}, action, correction, lengthProposal}
 */
function entryForm(ctx, sel, model, data) {
  const { values, meta, errors } = data;
  const { operators, clients, sampleTypes, machines } = data.lists;
  const numberedIds = sampleTypes.filter((s) => s.numbered).map((s) => s.id);
  const live = { shapeKind: model.ctx.shapeKind, material: model.ctx.material, limits: model.ctx.limits, iec: model.ctx.iec, measuresR: model.ctx.measuresR };
  const rUnit = values.r_unit || 'ohm_km';
  return html`<form method="post" action="${data.action}" class="entry" id="entry" novalidate>
  ${csrf(ctx)}
  <input type="hidden" name="family_id" value="${sel.family.id}">
  <input type="hidden" name="construction_id" value="${sel.construction.id}">
  <input type="hidden" name="level" value="${sel.level}">
  ${data.correction ? '' : html`<input type="hidden" name="machine_id" value="${sel.machine.id}">`}
  <script type="application/json" id="live-ctx">${jsonBlock({ ctx: live, numbered: numberedIds, proposal: data.lengthProposal || 1, quantities: T.quantity, verdicts: T.verdict, messages: { empty: T.measure.cell_empty, temp_warning: f(T.measure.temp_warning, { min: calc.formatNumber(model.ctx.targets.temp_min, 0, 1), max: calc.formatNumber(model.ctx.targets.temp_max, 0, 1) }) } })}</script>

  <fieldset class="card">
    <legend>${T.measure.sample_data}</legend>
    <div class="row">
      ${data.correction ? selectField({ label: T.measure.machine, name: 'machine_id', value: meta.machine_id, options: machines.map((m) => [m.id, m.name]), errors, required: true }) : ''}
      ${selectField({ label: T.measure.operator, name: 'operator_id', value: meta.operator_id, options: operators.map((o) => [o.id, o.full_name]), blank: T.measure.none_selected, errors })}
      ${selectField({ label: T.measure.client, name: 'client_id', value: meta.client_id, options: clients.map((c) => [c.id, c.short_name]), blank: T.measure.none_selected, errors })}
      ${selectField({ label: T.measure.sample_type, name: 'sample_type_id', value: meta.sample_type_id, options: sampleTypes.map((s) => [s.id, s.name]), errors, required: true, attrs: 'data-in="sample_type_id"' })}
      ${textField({ label: T.measure.length_no, name: 'length_no', value: meta.length_no, errors, inputmode: 'numeric', cls: 'num', hint: T.measure.length_no_hint, attrs: 'data-in="length_no"' })}
    </div>
  </fieldset>

  <fieldset class="card">
    <legend>${T.measure.values}</legend>
    ${model.inputs.diameter === 'none' ? '' : html`<div class="row">
      ${model.inputs.diameter === 'hl'
    ? html`${numInput('h', T.input.h, values, errors, { required: true })}${numInput('l', T.input.l, values, errors, { required: true })}`
    : html`${numInput('d1', T.input.d1, values, errors, { required: true })}${numInput('d2', T.input.d2, values, errors, { required: true })}`}
    </div>`}
    ${model.inputs.mass ? html`<div class="row">
      ${numInput('mass_g', T.input.mass_g, values, errors, { required: true })}
      ${numInput('sample_mm', T.input.sample_mm, { sample_mm: values.sample_mm === undefined ? String(model.ctx.targets.sample_mm) : values.sample_mm }, errors, { hint: f(T.measure.sample_mm_hint, { n: calc.formatNumber(model.ctx.targets.sample_mm, 0, 2) }) })}
    </div>` : ''}
    ${model.inputs.resistance ? html`<div class="row">
      ${numInput('r_value', T.input.r_value, values, errors, { hint: T.measure.r_optional })}
      ${selectField({ label: T.input.r_unit, name: 'r_unit', value: rUnit, options: [['ohm_km', 'Ω/km'], ['ohm', 'Ω']], errors, attrs: 'data-in="r_unit"' })}
      ${numInput('r_sample_m', T.input.r_sample_m, { r_sample_m: values.r_sample_m === undefined ? String(model.ctx.targets.r_sample_m) : values.r_sample_m }, errors, { hint: f(T.measure.r_sample_hint, { n: calc.formatNumber(model.ctx.targets.r_sample_m, 0, 2) }) })}
      ${numInput('temp_c', T.input.temp_c, values, errors, {})}
    </div>` : ''}
    <div class="row">
      ${textField({ label: T.measure.produced_length, name: 'produced_length_m', value: meta.produced_length_m, errors, inputmode: 'decimal', cls: 'num', hint: T.measure.optional })}
    </div>
    ${textArea({ label: T.measure.notes, name: 'notes', value: meta.notes, errors, rows: 2 })}
  </fieldset>

  <section class="card live" aria-live="polite">
    <h2>${T.measure.live_title}</h2>
    <p class="muted js-only-hint">${T.measure.live_hint}</p>
    <div id="live-out"></div>
  </section>

  ${data.correction ? html`<fieldset class="card">
    <legend>${T.detail.correction_reason}</legend>
    ${textArea({ label: T.detail.correction_reason_label, name: 'edit_reason', value: data.editReason, errors, rows: 2, required: true })}
  </fieldset>` : ''}

  <div class="actions">
    <button type="submit" class="btn primary big">${data.correction ? T.detail.save_correction : T.measure.save}</button>
    <a class="btn" href="${data.cancelHref}">${T.common.cancel}</a>
  </div>
</form>`;
}

// ---------- new measurement page ----------

function newPage(ctx, d) {
  const { families, machines, constructions, sel, model, family_id, machine_id, construction_id } = d;
  const byMat = {};
  for (const c of constructions) (byMat[c.material_code] = byMat[c.material_code] || []).push(c);
  const revInfo = sel && sel.revision ? f(T.measure.active_revision, { edition: sel.revision.edition, revision: sel.revision.revision, doc: sel.doc.title }) : '';
  return layout(ctx, {
    title: T.measure.title, active: 'new', scripts: ['/static/calc.js', '/static/measure.js'],
    body: html`<h1>${T.measure.title}</h1>
<form method="get" action="/masuratori/nou" class="card selector" id="selector">
  <div class="row">
    ${selectField({ label: T.measure.family, name: 'family', value: family_id, options: families.map((x) => [x.id, x.name]), blank: T.measure.choose, attrs: 'data-autosubmit data-resets="machine,construction"' })}
    ${family_id ? selectField({ label: T.measure.machine, name: 'machine', value: machine_id, options: machines.map((m) => [m.id, m.name + (m.rotor_config ? ` (${m.rotor_config})` : '')]), blank: T.measure.choose, attrs: 'data-autosubmit data-resets="construction"' }) : ''}
    ${family_id && machine_id ? html`<label class="field"><span class="lbl">${T.measure.construction}</span>
      <select name="construction" data-autosubmit data-resets="level"><option value="">${T.measure.choose}</option>
      ${Object.keys(byMat).map((mat) => html`<optgroup label="${materialName(mat)}">${byMat[mat].map((c) => html`<option value="${c.id}"${String(c.id) === String(construction_id) ? raw(' selected') : ''}>${c.label}${c.destination_name ? ' · ' + c.destination_name : ''}${c.die ? ' · ' + c.die : ''}</option>`)}</optgroup>`)}
      </select></label>` : ''}
    ${d.levels.length > 1 ? selectField({ label: T.measure.level, name: 'level', value: d.level, options: d.levels.map((l) => [l, T.level[l]]), blank: T.measure.choose, attrs: 'data-autosubmit' }) : ''}
    <noscript><button class="btn" type="submit">${T.common.continue}</button></noscript>
  </div>
  ${family_id && !machines.length ? html`<p class="notice">${T.measure.no_machines}</p>` : ''}
  ${family_id && machine_id && !constructions.length ? html`<p class="notice">${T.measure.no_constructions} <a href="/fise">${T.specs.title}</a></p>` : ''}
</form>
${sel && model ? html`
<section class="card product">
  <h2>${sel.construction.label} <span class="tag">${materialName(sel.construction.material_code)}</span> <span class="tag">${sel.machine.name}</span>${sel.family.levels.length > 1 ? html` <span class="tag ok">${T.level[sel.level]}</span>` : ''}</h2>
  <p class="muted">${revInfo}</p>
  ${sel.family.levels[0] === 'sarma' && model.ctx.measuresMass ? html`<p class="muted">${T.measure.wire_mass_hint}</p>` : ''}
  ${limitsTable(model)}
</section>
${entryForm(ctx, sel, model, d.form)}` : ''}`,
  });
}

// ---------- register ----------

/** A finished-cable record has many results: show how many and how many are out. */
function cableSummary(r) {
  const out = r.results.filter((x) => ['sub', 'peste', 'neconform'].includes(x.verdict)).length;
  return html`<span class="val ${out ? 'v-neconform' : 'v-ok'}">${f(T.cable.summary, { n: r.results.length, out })}</span>`;
}

function registerPage(ctx, d) {
  const { data, filters, lists } = d;
  const opt = (rows, key, label) => rows.map((r) => [r[key], r[label]]);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== '' && v !== null && v !== undefined && v !== false) qs.set(k, v === true ? '1' : String(v));
  const cellD = (r) => {
    const m = r.resultMap;
    if (r.family_code === 'CABLE_LV') return cableSummary(r);
    if (m.h || m.l) return html`${valueCell(m.h, 'h')} × ${valueCell(m.l, 'l')}`;
    return html`${valueCell(m.d1, 'd1')} · ${valueCell(m.d2, 'd2')}`;
  };
  return layout(ctx, {
    title: T.register.title, active: 'register', wide: true,
    body: html`<h1>${T.register.title}</h1>
<form method="get" action="/masuratori" class="card filters">
  <div class="row">
    ${textField({ label: T.common.from, name: 'from', value: filters.from, type: 'date' })}
    ${textField({ label: T.common.to, name: 'to', value: filters.to, type: 'date' })}
    ${selectField({ label: T.register.shift, name: 'shift', value: filters.shift, options: [['zi', T.shift.zi], ['noapte', T.shift.noapte]], blank: T.common.all })}
    ${selectField({ label: T.register.crew, name: 'crew_id', value: filters.crew_id, options: opt(lists.crews, 'id', 'name'), blank: T.common.all })}
    ${selectField({ label: T.measure.family, name: 'family_id', value: filters.family_id, options: opt(lists.families, 'id', 'name'), blank: T.common.all })}
    ${selectField({ label: T.measure.machine, name: 'machine_id', value: filters.machine_id, options: opt(lists.machines, 'id', 'name'), blank: T.common.all })}
    ${selectField({ label: T.measure.operator, name: 'operator_id', value: filters.operator_id, options: opt(lists.operators, 'id', 'full_name'), blank: T.common.all })}
    ${selectField({ label: T.measure.client, name: 'client_id', value: filters.client_id, options: opt(lists.clients, 'id', 'short_name'), blank: T.common.all })}
    ${selectField({ label: T.measure.sample_type, name: 'sample_type_id', value: filters.sample_type_id, options: opt(lists.sampleTypes, 'id', 'name'), blank: T.common.all })}
    ${textField({ label: T.register.product, name: 'q', value: filters.q })}
  </div>
  <div class="row checks">
    <label class="check"><input type="checkbox" name="out" value="1"${filters.out ? raw(' checked') : ''}> <span>${T.register.only_out}</span></label>
    <label class="check"><input type="checkbox" name="all_versions" value="1"${filters.all_versions ? raw(' checked') : ''}> <span>${T.register.all_versions}</span></label>
    <button class="btn primary" type="submit">${T.common.filter}</button>
    <a class="btn" href="/masuratori">${T.common.reset}</a>
  </div>
</form>
<p class="muted">${f(T.register.count, { total: data.total })} <a class="btn small" href="/masuratori/tipar${qs.toString() ? '?' + qs.toString() : ''}">${T.print.register_print}</a>
  ${T.an.export}: <a class="btn small" href="/masuratori/export?${qs.toString()}${qs.toString() ? '&' : ''}format=csv">CSV</a> <a class="btn small" href="/masuratori/export?${qs.toString()}${qs.toString() ? '&' : ''}format=xlsx">Excel (.xlsx)</a></p>
<div class="scroll"><table class="grid register">
  <thead><tr><th>${T.register.no}</th><th>${T.common.date}</th><th>${T.register.shift}</th><th>${T.register.crew}</th><th>${T.measure.family}</th><th>${T.register.product}</th><th>${T.measure.machine}</th>
    <th>${T.measure.operator}</th><th>${T.measure.client}</th><th>${T.measure.sample_type}</th><th>${T.register.diameter}</th><th>${T.quantity.mass_gm}</th><th>${T.quantity.r20}</th><th>${T.quantity.r20_theor}</th><th>${T.common.notes}</th></tr></thead>
  <tbody>${data.rows.length ? data.rows.map((r) => html`<tr class="${r.is_current ? '' : 'old'}">
    <td><a href="/masuratori/${r.record_no}">${r.record_no}</a>${r.versions > 1 ? html` <span class="badge" title="${T.register.versions_title}">${f(T.register.versions, { n: r.versions })}${r.is_current ? '' : ` (v${r.version})`}</span>` : ''}</td>
    <td>${displayDateTime(r.created_at)}</td><td>${T.shift[r.shift]}<br><span class="muted">${displayDate(r.shift_date)}</span></td><td>${r.crew_name || ''}</td>
    <td>${r.family_name}</td><td>${r.construction_label} <span class="tag">${r.material_code}</span>${r.batch_no ? html` <a class="tag ok" href="/loturi/${r.batch_id}">${r.batch_no}${r.drum_no ? ' / ' + r.drum_no : ''}</a>` : ''}${r.family_code === 'FLEXIBIL_CL5' ? html` <span class="tag ok">${T.level[r.level]}</span>` : ''}</td><td>${r.machine_name}</td>
    <td>${r.operator_name || ''}</td><td>${r.client_name || ''}</td><td>${r.sample_type_name}${r.length_no ? ' ' + r.length_no : ''}</td>
    <td class="nowrap">${cellD(r)}</td><td>${valueCell(r.resultMap.mass_gm, 'mass_gm')}</td><td>${valueCell(r.resultMap.r20_echiv || r.resultMap.r20, 'r20')}</td><td>${valueCell(r.resultMap.r20_theor, 'r20_theor')}</td>
    <td class="notes">${r.notes || ''}</td></tr>`) : html`<tr><td colspan="15" class="empty">${T.register.empty} <a href="/masuratori">${T.register.clear_filters}</a> · <a href="/masuratori/nou">${T.register.add_first}</a></td></tr>`}</tbody>
</table></div>
${pager('/masuratori', data.page, data.pages, Object.fromEntries(qs))}`,
  });
}

// ---------- detail / history ----------

function resultsTable(r) {
  return html`<table class="grid results"><thead><tr><th>${T.detail.quantity}</th><th>${T.detail.value}</th><th>${T.detail.limits}</th><th>${T.detail.verdict}</th><th>${T.detail.deviation}</th><th>${T.detail.source}</th></tr></thead>
  <tbody>${r.results.map((x) => html`<tr><th scope="row">${tests.label(x.quantity)}</th>
    <td>${valueCell(x, x.quantity)}</td><td>${x.verdict === 'info' || x.verdict === 'neconform' ? '' : limitText(x.lim_min, x.lim_max, x.quantity === 'r20' || x.quantity === 'r20_theor' ? 'r20' : x.quantity)}</td>
    <td>${verdictBadge(x.verdict)}</td><td>${x.deviation_pct === null || x.deviation_pct === undefined ? '' : calc.signed(x.deviation_pct, 2) + ' %'}</td><td>${x.source === 'fisa' ? T.measure.source_sheet : x.source === 'calculat' ? T.detail.calculated : x.source}</td></tr>`)}</tbody></table>`;
}

function inputsLine(v) {
  const parts = [];
  const cat = new Map(tests.catalogue().map((t) => [t.code, t]));
  for (const k of Object.keys(v.inputs).filter((x) => x.startsWith('t_'))) {
    const code = k.slice(2).replace(/_(unit|len|temp)$/, '');
    const t = cat.get(code);
    const suffix = k.slice(2).slice(code.length + 1);
    const val = v.inputs[k] === 'pass' ? T.cable.pass : v.inputs[k] === 'fail' ? T.cable.fail : suffix === 'unit' ? (v.inputs[k] === 'ohm' ? 'Ω' : 'Ω/km') : String(v.inputs[k]).replace('.', ',');
    parts.push(html`<span class="in"><span class="muted">${(t ? t.name : code) + (suffix ? ` (${T.cable.suffix[suffix]})` : '')}:</span> ${val}</span>`);
  }
  for (const k of ['d1', 'd2', 'h', 'l', 'mass_g', 'sample_mm', 'r_value', 'r_unit', 'r_sample_m', 'temp_c']) {
    if (v.inputs[k] === undefined) continue;
    const val = k === 'r_unit' ? (v.inputs[k] === 'ohm' ? 'Ω' : 'Ω/km') : String(v.inputs[k]).replace('.', ',');
    parts.push(html`<span class="in"><span class="muted">${T.input[k]}:</span> ${val}</span>`);
  }
  return parts;
}

function detailPage(ctx, d) {
  const { versions, canCorrect, denied } = d;
  const cur = versions.find((v) => v.is_current) || versions[0];
  return layout(ctx, {
    title: f(T.detail.title, { no: cur.record_no }), active: 'register',
    body: html`<h1>${f(T.detail.title, { no: cur.record_no })} <span class="badge">${f(T.register.versions, { n: versions.length })}</span></h1>
<section class="card">
  <dl class="facts">
    <div><dt>${T.measure.family}</dt><dd>${cur.family_name}</dd></div>
    <div><dt>${T.register.product}</dt><dd>${cur.construction_label} <span class="tag">${materialName(cur.material_code)}</span>${cur.family_code === 'FLEXIBIL_CL5' ? html` <span class="tag ok">${T.level[cur.level]}</span>` : ''}</dd></div>
    <div><dt>${T.measure.machine}</dt><dd>${cur.machine_name}</dd></div>
    ${cur.batch_no ? html`<div><dt>${T.cable.batch}</dt><dd><a href="/loturi/${cur.batch_id}">${cur.batch_no}</a>${cur.drum_no ? ` · ${T.cable.drum} ${cur.drum_no}` : ''}</dd></div>` : (cur.family_code === 'CABLE_LV' ? html`<div><dt>${T.cable.session}</dt><dd>${T.cable.type_tests}</dd></div>` : '')}
    <div><dt>${T.register.shift}</dt><dd>${T.shift[cur.shift]} · ${displayDate(cur.shift_date)}${cur.crew_name ? ` · ${T.register.crew} ${cur.crew_name}` : ''}</dd></div>
    <div><dt>${T.measure.operator}</dt><dd>${cur.operator_name || T.common.none}</dd></div>
    <div><dt>${T.measure.client}</dt><dd>${cur.client_name || T.common.none}</dd></div>
    <div><dt>${T.measure.sample_type}</dt><dd>${cur.sample_type_name}${cur.length_no ? ' ' + cur.length_no : ''}</dd></div>
    <div><dt>${T.detail.sheet_revision}</dt><dd>${f(T.detail.ed_rev, { edition: cur.rev_edition, revision: cur.rev_revision })}</dd></div>
    ${cur.produced_length_m != null ? html`<div><dt>${T.measure.produced_length}</dt><dd>${calc.formatNumber(cur.produced_length_m, 0, 2)} m</dd></div>` : ''}
    ${cur.notes ? html`<div class="wide-fact"><dt>${T.common.notes}</dt><dd>${cur.notes}</dd></div>` : ''}
  </dl>
  <div class="actions">
    ${canCorrect ? html`<a class="btn primary" href="/masuratori/${cur.record_no}/corecteaza">${T.detail.correct}</a>` : html`<span class="muted">${opt('detail', 'denied_' + denied, '')}</span>`}
    <a class="btn" href="/masuratori/nou?family=${cur.family_id}&amp;machine=${cur.machine_id}&amp;construction=${cur.construction_id}&amp;level=${cur.level}">${T.detail.new_same}</a>
    <a class="btn" href="/masuratori">${T.common.back}</a>
  </div>
</section>
<h2>${T.detail.versions}</h2>
${versions.map((v) => html`<section class="card version${v.is_current ? ' current' : ' old'}">
  <h3>${f(T.detail.version_n, { n: v.version })} ${v.is_current ? html`<span class="tag ok">${T.detail.current}</span>` : html`<span class="tag">${T.detail.superseded}</span>`}</h3>
  <p class="muted">${T.detail.saved_by} <strong>${v.user_name}</strong>, ${displayDateTime(v.created_at)}${v.edit_reason ? html` — ${T.detail.reason}: <em>${v.edit_reason}</em>` : ''}</p>
  <p class="inputs">${inputsLine(v)}</p>
  ${resultsTable(v)}
</section>`)}`,
  });
}

function correctPage(ctx, d) {
  const cur = d.current;
  return layout(ctx, {
    title: f(T.detail.correct_title, { no: cur.record_no }), active: 'register', scripts: ['/static/calc.js', '/static/measure.js'],
    body: html`<h1>${f(T.detail.correct_title, { no: cur.record_no })}</h1>
<p class="muted">${f(T.detail.correct_hint, { version: cur.version + 1 })}</p>
<section class="card product"><h2>${d.sel.construction.label} <span class="tag">${materialName(d.sel.construction.material_code)}</span></h2>
${limitsTable(d.model)}</section>
${entryForm(ctx, d.sel, d.model, d.form)}`,
  });
}

module.exports = { newPage, registerPage, detailPage, correctPage, resultsTable, limitsTable, materialName };
