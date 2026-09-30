'use strict';
// Finished cable: test entry (batch tests and type tests), batches, drums.
const { html, raw, jsonBlock } = require('../lib/html');
const { T, f } = require('../i18n');
const i18n = require('../i18n');
const calc = require('../domain/calc');
const tests = require('../domain/tests');
const { displayDate, displayDateTime } = require('../lib/time');
const { layout, csrf, textField, selectField, textArea, errText } = require('./layout');

const scopeTitle = (s) => T.cable.scopes[s];

// ---------- test inputs ----------

function testInput(t, values, errors) {
  const key = 't_' + t.code;
  const val = (k) => (values[k] === undefined ? '' : values[k]);
  const err = errors && errors[key] ? errText(errors, key) : '';
  if (t.kind === 'passfail') {
    return html`<select name="${key}" data-in="${key}" aria-label="${t.name}"><option value="">${T.cable.not_tested}</option>
      <option value="pass"${val(key) === 'pass' ? raw(' selected') : ''}>${T.cable.pass}</option><option value="fail"${val(key) === 'fail' ? raw(' selected') : ''}>${T.cable.fail}</option></select>${err}`;
  }
  if (t.kind === 'resistance') {
    return html`<div class="res-group"><input name="${key}" data-in="${key}" value="${val(key)}" inputmode="decimal" autocomplete="off" aria-label="${t.name}">
      <select name="${key}_unit" data-in="${key}_unit" aria-label="${T.input.r_unit}"><option value="ohm_km"${val(key + '_unit') !== 'ohm' ? raw(' selected') : ''}>Ω/km</option><option value="ohm"${val(key + '_unit') === 'ohm' ? raw(' selected') : ''}>Ω</option></select>
      <input name="${key}_len" data-in="${key}_len" value="${val(key + '_len')}" inputmode="decimal" placeholder="${T.input.r_sample_m}" aria-label="${T.input.r_sample_m}" autocomplete="off">
      <input name="${key}_temp" data-in="${key}_temp" value="${val(key + '_temp')}" inputmode="decimal" placeholder="${T.input.temp_c}" aria-label="${T.input.temp_c}" autocomplete="off">${err}${errors && errors[key + '_temp'] ? errText(errors, key + '_temp') : ''}</div>`;
  }
  return html`<input name="${key}" data-in="${key}" value="${val(key)}" inputmode="${t.kind === 'readings' ? 'text' : 'decimal'}" autocomplete="off" aria-label="${t.name}"${t.kind === 'readings' ? raw(` placeholder="${T.cable.readings_placeholder}"`) : ''}>${err}`;
}

function testRow(t, ctx, values, errors) {
  const summary = tests.limitSummary(t, ctx.limits);
  return html`<div class="test-row">
    <div class="test-label"><strong>${t.name}</strong> ${t.unit ? html`<span class="muted">[${t.unit}]</span>` : ''}${!t.in_house ? html` <span class="tag warn" title="${T.cable.external_title}">${T.cable.external}</span>` : ''}
      ${summary ? html`<div class="hint">${T.cable.limit}: ${summary}</div>` : (t.kind === 'resistance' && ctx.iec ? html`<div class="hint">${T.cable.limit}: ≤ ${calc.formatQuantity(t.code, ctx.iec.r_max)} (${ctx.iec.source})</div>` : '')}
      ${t.standard_ref ? html`<div class="hint">${t.standard_ref}</div>` : ''}</div>
    <div class="test-input">${testInput(t, values, errors)}</div></div>`;
}

function testFields(model, values, errors) {
  const ctx = model.ctx;
  const required = new Set(require('../domain/tests').requiredTests(ctx, ctx.data).map((t) => t.code));
  const groups = ['routine', 'sample', 'type'].map((s) => ({ scope: s, list: ctx.tests.filter((t) => t.scope === s) })).filter((g) => g.list.length);
  return html`${errors && errors.tests ? html`<p class="field-error" role="alert">${T.errors.no_tests}</p>` : ''}
    ${groups.map((g) => {
    const first = g.list.filter((t) => required.has(t.code));
    const others = g.list.filter((t) => !required.has(t.code));
    return html`<fieldset class="card"><legend>${scopeTitle(g.scope)}</legend>
      ${first.length ? first.map((t) => testRow(t, ctx, values, errors)) : html`<p class="muted">${T.cable.none_required}</p>`}
      ${others.length ? html`<details class="others"><summary>${f(T.cable.other_tests, { n: others.length })}</summary>${others.map((t) => testRow(t, ctx, values, errors))}</details>` : ''}</fieldset>`;
  })}`;
}

function liveCtx(model, sel) {
  const c = model.ctx;
  return {
    mode: 'tests', decimal: calc.decimal(),
    ctx: { tests: c.tests.map((t) => ({ code: t.code, kind: t.kind })), limits: c.limits, iec: c.iec, material: { alpha20: c.material.alpha20 }, targets: c.targets },
    numbered: [], proposal: 1,
    quantities: { ...T.quantity, ...tests.labelsFor(c.tests) }, formats: tests.formatsFor(c.tests), verdicts: T.verdict,
    messages: { empty: T.measure.cell_empty, temp_warning: f(T.measure.temp_warning, { min: calc.formatNumber(c.targets.temp_min, 0, 1), max: calc.formatNumber(c.targets.temp_max, 0, 1) }) },
  };
}

function cableEntryForm(ctx, sel, model, data) {
  const { values, meta, errors } = data;
  const { operators, clients, sampleTypes, machines } = data.lists;
  return html`<form method="post" action="${data.action}" class="entry" id="entry" novalidate>
  ${csrf(ctx)}
  <input type="hidden" name="family_id" value="${sel.family.id}">
  <input type="hidden" name="construction_id" value="${sel.construction.id}">
  <input type="hidden" name="batch_id" value="${sel.batch ? sel.batch.id : ''}">
  <input type="hidden" name="drum_id" value="${sel.drum ? sel.drum.id : ''}">
  ${data.correction ? '' : html`<input type="hidden" name="machine_id" value="${sel.machine.id}">`}
  <script type="application/json" id="live-ctx">${jsonBlock(liveCtx(model, sel))}</script>
  <fieldset class="card"><legend>${T.measure.sample_data}</legend><div class="row">
    ${data.correction ? selectField({ label: T.measure.machine, name: 'machine_id', value: meta.machine_id, options: machines.map((m) => [m.id, m.name]), errors, required: true }) : ''}
    ${selectField({ label: T.measure.operator, name: 'operator_id', value: meta.operator_id, options: operators.map((o) => [o.id, o.full_name]), blank: T.measure.none_selected, errors })}
    ${selectField({ label: T.measure.client, name: 'client_id', value: meta.client_id, options: clients.map((c) => [c.id, c.short_name]), blank: T.measure.none_selected, errors })}
    ${selectField({ label: T.measure.sample_type, name: 'sample_type_id', value: meta.sample_type_id, options: sampleTypes.map((s) => [s.id, s.name]), errors, required: true, attrs: 'data-in="sample_type_id"' })}
  </div></fieldset>
  ${testFields(model, values, errors)}
  <fieldset class="card"><legend>${T.cable.remarks}</legend>${textArea({ label: T.measure.notes, name: 'notes', value: meta.notes, errors, rows: 2 })}</fieldset>
  <section class="card live" aria-live="polite"><h2>${T.measure.live_title}</h2><p class="muted js-only-hint">${T.measure.live_hint}</p><div id="live-out"></div></section>
  ${data.correction ? html`<fieldset class="card"><legend>${T.detail.correction_reason}</legend>${textArea({ label: T.detail.correction_reason_label, name: 'edit_reason', value: data.editReason, errors, rows: 2, required: true })}</fieldset>` : ''}
  <div class="actions"><button type="submit" class="btn primary big">${data.correction ? T.detail.save_correction : T.measure.save}</button><a class="btn" href="${data.cancelHref}">${T.common.cancel}</a></div>
</form>`;
}

function batchPanel(sel) {
  return html`<section class="card product"><h2>${sel.batch ? html`${T.cable.batch} <a href="/loturi/${sel.batch.id}">${sel.batch.batch_no}</a>` : T.cable.type_tests}${sel.drum ? html` · ${T.cable.drum} ${sel.drum.drum_no}` : ''}
    <span class="tag">${sel.construction.label}</span> <span class="tag">${sel.machine.name}</span></h2>
    <p class="muted">${designLine(sel.construction)}</p></section>`;
}

/** "Cu 4 × 16 mm², 0,6/1 kV, XLPE / PVC" from the design's data. */
function designLine(c) {
  const d = c.data || {};
  return [d.cores ? `${d.cores} × ${calc.formatNumber(c.section, 0, 2)} mm²` : `${calc.formatNumber(c.section, 0, 2)} mm²`, d.rated_voltage, [d.insulation, d.sheath].filter(Boolean).join(' / '), d.standard].filter(Boolean).join(' · ');
}

function cableNewPage(ctx, d) {
  const { families, machines, batches, drums, designs, sel, model } = d;
  return layout(ctx, {
    title: T.measure.title, active: 'new', scripts: ['/static/calc.js', '/static/measure.js'],
    body: html`<h1>${T.measure.title}</h1>
<form method="get" action="/masuratori/nou" class="card selector" id="selector"><div class="row">
  ${selectField({ label: T.measure.family, name: 'family', value: d.family_id, options: families.map((x) => [x.id, x.name]), blank: T.measure.choose, attrs: 'data-autosubmit data-resets="batch,drum,design,machine"' })}
  ${selectField({ label: T.cable.batch, name: 'batch', value: d.batch_id, options: batches.map((b) => [b.id, `${b.batch_no} — ${b.design_label}`]), blank: T.cable.no_batch_type, attrs: 'data-autosubmit data-resets="drum,design"' })}
  ${d.batch_id ? selectField({ label: T.cable.drum, name: 'drum', value: d.drum_id, options: drums.map((x) => [x.id, x.drum_no + (x.length_m ? ` (${calc.formatNumber(x.length_m, 0, 1)} m)` : '')]), blank: T.cable.whole_batch, attrs: 'data-autosubmit' }) : selectField({ label: T.cable.design, name: 'design', value: d.design_id, options: designs.map((x) => [x.id, x.label]), blank: T.measure.choose, attrs: 'data-autosubmit' })}
  ${selectField({ label: T.measure.machine, name: 'machine', value: d.machine_id, options: machines.map((m) => [m.id, m.name]), blank: T.measure.choose, attrs: 'data-autosubmit' })}
  <noscript><button class="btn" type="submit">${T.common.continue}</button></noscript>
</div>${!batches.length && !designs.length ? html`<p class="notice">${T.cable.nothing_to_test}</p>` : ''}</form>
${sel ? html`${batchPanel(sel)}${cableEntryForm(ctx, sel, model, d.form)}` : ''}`,
  });
}

function cableCorrectPage(ctx, d) {
  return layout(ctx, {
    title: f(T.detail.correct_title, { no: d.current.record_no }), active: 'register', scripts: ['/static/calc.js', '/static/measure.js'],
    body: html`<h1>${f(T.detail.correct_title, { no: d.current.record_no })}</h1><p class="muted">${f(T.detail.correct_hint, { version: d.current.version + 1 })}</p>
${batchPanel({ ...d.sel, machine: { name: d.machineName } })}${cableEntryForm(ctx, d.sel, d.model, d.form)}`,
  });
}

// ---------- batches ----------

function batchesPage(ctx, d) {
  const { rows, filters, clients } = d;
  return layout(ctx, {
    title: T.cable.batches, active: 'batches', wide: true,
    body: html`<h1>${T.cable.batches}</h1><p><a class="btn primary" href="/loturi/nou">${T.cable.new_batch}</a></p>
<form method="get" action="/loturi" class="card filters"><div class="row">
  ${textField({ label: T.cable.search, name: 'q', value: filters.q })}
  ${selectField({ label: T.common.status, name: 'status', value: filters.status, options: [['deschis', T.cable.st.deschis], ['inchis', T.cable.st.inchis]], blank: T.common.all })}
  ${selectField({ label: T.measure.client, name: 'client_id', value: filters.client_id, options: clients.map((c) => [c.id, c.short_name]), blank: T.common.all })}
  <button class="btn primary" type="submit">${T.common.filter}</button> <a class="btn" href="/loturi">${T.common.reset}</a></div></form>
<div class="scroll"><table class="grid"><thead><tr><th>${T.cable.batch}</th><th>${T.cable.order}</th><th>${T.measure.client}</th><th>${T.cable.design}</th><th>${T.cable.drums}</th><th>${T.cable.tests_done}</th><th>${T.cable.certificates}</th><th>${T.common.status}</th></tr></thead>
<tbody>${rows.length ? rows.map((b) => html`<tr><td><a href="/loturi/${b.id}">${b.batch_no}</a></td><td>${b.order_no || ''}</td><td>${b.client_name || ''}</td><td>${b.design_label}</td><td>${b.drum_count}</td><td>${b.test_count}</td><td>${b.cert_count}</td><td><span class="tag st-${b.status === 'deschis' ? 'in_verificare' : 'activa'}">${T.cable.st[b.status]}</span></td></tr>`) : html`<tr><td colspan="8" class="empty">${T.cable.no_batches}</td></tr>`}</tbody></table></div>`,
  });
}

function batchForm(ctx, d) {
  const { values, errors, designs, clients, standards } = d;
  const v = values || {};
  return layout(ctx, {
    title: T.cable.new_batch, active: 'batches',
    body: html`<p><a href="/loturi">« ${T.cable.batches}</a></p><h1>${T.cable.new_batch}</h1>
${designs.length ? '' : html`<p class="notice">${T.cable.no_designs}</p>`}
<form method="post" action="/loturi/nou" class="card">${csrf(ctx)}<div class="row">
  ${textField({ label: T.cable.batch_no, name: 'batch_no', value: v.batch_no, errors, required: true, autofocus: true, attrs: 'maxlength="40"' })}
  ${textField({ label: T.cable.order, name: 'order_no', value: v.order_no, errors })}
  ${selectField({ label: T.measure.client, name: 'client_id', value: v.client_id, options: clients.map((c) => [c.id, c.short_name]), blank: T.measure.none_selected, errors })}
</div><div class="row">
  ${selectField({ label: T.cable.design, name: 'construction_id', value: v.construction_id, options: designs.map((x) => [x.id, `${x.label} — ${designLine(x)}`]), blank: T.measure.choose, errors, required: true })}
  ${selectField({ label: T.cable.standard, name: 'standard', value: v.standard, options: standards.map((s) => [s.name, s.name]), blank: T.measure.none_selected, errors })}
  ${textField({ label: T.cable.produced_length, name: 'produced_length_m', value: v.produced_length_m, errors, inputmode: 'decimal', cls: 'num' })}
  ${textField({ label: T.cable.produced_on, name: 'produced_on', value: v.produced_on, errors, type: 'date' })}
</div>${textArea({ label: T.common.notes, name: 'notes', value: v.notes, errors, rows: 2 })}
<div class="actions"><button class="btn primary" type="submit">${T.common.save}</button><a class="btn" href="/loturi">${T.common.cancel}</a></div></form>`,
  });
}

function batchDetail(ctx, d) {
  const { o, certificates, clients, standards, errors, drumErrors, canReopen, canIssue, preview } = d;
  const b = o.batch;
  const open = b.status === 'deschis';
  const testsByDrum = (id) => o.measurements.filter((m) => (m.drum_id || 0) === id);
  const outCount = o.measurements.reduce((n, m) => n + (m.results || []).filter((r) => ['sub', 'peste', 'neconform'].includes(r.verdict)).length, 0);
  return layout(ctx, {
    title: `${T.cable.batch} ${b.batch_no}`, active: 'batches', wide: true,
    body: html`<p><a href="/loturi">« ${T.cable.batches}</a></p>
<h1>${T.cable.batch} ${b.batch_no} <span class="tag st-${open ? 'in_verificare' : 'activa'}">${T.cable.st[b.status]}</span></h1>
<section class="card"><dl class="facts">
  <div><dt>${T.cable.design}</dt><dd><strong>${o.design.label}</strong> <span class="muted">${designLine(o.design)}</span></dd></div>
  <div><dt>${T.cable.sheet}</dt><dd>${f(T.detail.ed_rev, { edition: o.revision.edition, revision: o.revision.revision })}${o.revision.doc_code ? ` · ${o.revision.doc_code}` : ''}</dd></div>
  <div><dt>${T.cable.order}</dt><dd>${b.order_no || T.common.none}</dd></div><div><dt>${T.measure.client}</dt><dd>${b.client_name || T.common.none}</dd></div>
  <div><dt>${T.cable.standard}</dt><dd>${b.standard || T.common.none}</dd></div><div><dt>${T.cable.produced_length}</dt><dd>${b.produced_length_m ? calc.formatNumber(b.produced_length_m, 0, 1) + ' m' : T.common.none}</dd></div>
  <div><dt>${T.cable.produced_on}</dt><dd>${displayDate(b.produced_on) || T.common.none}</dd></div><div><dt>${T.cable.created}</dt><dd>${b.created_by_name}, ${displayDateTime(b.created_at)}</dd></div>
  ${b.notes ? html`<div class="wide-fact"><dt>${T.common.notes}</dt><dd>${b.notes}</dd></div>` : ''}</dl>
  <div class="actions">
    ${open ? html`<a class="btn primary" href="/masuratori/nou?family=${o.design.family_id}&amp;batch=${b.id}">${T.cable.add_tests}</a>
      <form method="post" action="/loturi/${b.id}/inchide" class="inline" data-confirm="${T.cable.close_confirm}">${csrf(ctx)}<button class="btn" type="submit">${T.cable.close}</button></form>` : ''}
    ${!open && canReopen ? html`<form method="post" action="/loturi/${b.id}/redeschide" class="inline">${csrf(ctx)}<button class="btn" type="submit">${T.cable.reopen}</button></form>` : ''}
    <a class="btn" href="/loturi/${b.id}/certificat">${T.cable.preview_cert}</a></div></section>

${open ? html`<details class="card"><summary>${T.cable.edit_batch}</summary><form method="post" action="/loturi/${b.id}" class="row">${csrf(ctx)}
  ${textField({ label: T.cable.order, name: 'order_no', value: b.order_no, errors })}
  ${selectField({ label: T.measure.client, name: 'client_id', value: b.client_id, options: clients.map((c) => [c.id, c.short_name]), blank: T.measure.none_selected, errors })}
  ${selectField({ label: T.cable.standard, name: 'standard', value: b.standard, options: standards.map((s) => [s.name, s.name]), blank: T.measure.none_selected, errors })}
  ${textField({ label: T.cable.produced_length, name: 'produced_length_m', value: b.produced_length_m, errors, inputmode: 'decimal', cls: 'num' })}
  ${textField({ label: T.cable.produced_on, name: 'produced_on', value: b.produced_on, errors, type: 'date' })}
  ${textField({ label: T.common.notes, name: 'notes', value: b.notes, errors, cls: 'grow' })}<button class="btn" type="submit">${T.common.save}</button></form></details>` : ''}

<h2>${T.cable.drums}</h2>
<div class="scroll"><table class="grid"><thead><tr><th>${T.cable.drum}</th><th>${T.cable.length_m}</th><th>${T.common.notes}</th><th>${T.cable.tests_done}</th><th></th></tr></thead><tbody>
${o.drums.map((dr) => html`<tr><td>${open ? html`<input name="drum_no" value="${dr.drum_no}" form="dr${dr.id}" maxlength="30">` : dr.drum_no}${drumErrors && drumErrors.id === dr.id ? errText(drumErrors.errors, 'drum_no') : ''}</td>
  <td>${open ? html`<input name="length_m" value="${dr.length_m === null ? '' : calc.dec(String(dr.length_m))}" form="dr${dr.id}" inputmode="decimal">` : (dr.length_m ? calc.formatNumber(dr.length_m, 0, 1) : '')}</td>
  <td>${open ? html`<input name="notes" value="${dr.notes || ''}" form="dr${dr.id}" maxlength="300">` : (dr.notes || '')}</td>
  <td>${testsByDrum(dr.id).map((m) => html`<a href="/masuratori/${m.record_no}">#${m.record_no}</a> `)}</td>
  <td class="nowrap">${open ? html`<form method="post" action="/loturi/${b.id}/tobe/${dr.id}" id="dr${dr.id}" class="inline">${csrf(ctx)}<button class="btn small" type="submit">${T.common.save}</button></form>
    <a class="btn small" href="/masuratori/nou?family=${o.design.family_id}&amp;batch=${b.id}&amp;drum=${dr.id}">${T.cable.add_tests}</a>` : ''}</td></tr>`)}
${o.drums.length ? '' : html`<tr><td colspan="5" class="empty">${T.cable.no_drums}</td></tr>`}
${open ? html`<tr><td><input name="drum_no" form="drnew" placeholder="${T.cable.drum}" maxlength="30" required>${drumErrors && drumErrors.id === 'new' ? errText(drumErrors.errors, 'drum_no') : ''}</td><td><input name="length_m" form="drnew" placeholder="m" inputmode="decimal"></td><td><input name="notes" form="drnew" maxlength="300"></td><td></td>
  <td><form method="post" action="/loturi/${b.id}/tobe" id="drnew" class="inline">${csrf(ctx)}<button class="btn small primary" type="submit">${T.common.add}</button></form></td></tr>` : ''}
</tbody></table></div>
${testsByDrum(0).length ? html`<p class="muted">${T.cable.batch_level_tests}: ${testsByDrum(0).map((m) => html`<a href="/masuratori/${m.record_no}">#${m.record_no}</a> `)}</p>` : ''}

<h2>${T.cable.coverage}</h2>
${o.required.length ? '' : html`<p class="notice">${T.cable.none_required_batch}</p>`}
${o.missing.length ? html`<div class="notice"><strong>${T.cable.missing}</strong><ul>${o.missing.map((m) => html`<li>${m.test.name}${m.drum ? ` — ${T.cable.drum} ${m.drum.drum_no}` : ` — ${T.cable.whole_batch}`}</li>`)}</ul></div>` : (o.required.length ? html`<p class="ok-note">${T.cable.all_done}</p>` : '')}
${outCount ? html`<p class="field-error">${f(T.cable.out_count, { n: outCount })}</p>` : ''}

<h2>${T.cable.certificates}</h2>
${certificates.length ? html`<ul>${certificates.map((c) => html`<li><a href="/certificate/${c.id}">${c.cert_no}</a> — ${displayDateTime(c.issued_at)}, ${c.issued_by_name} ${c.conforming ? '' : html`<span class="tag warn">${T.cable.nonconforming}</span>`}${c.superseded_by ? html` <span class="muted">(${f(T.cable.superseded_by, { no: c.superseded_by })})</span>` : ''}</li>`)}</ul>` : html`<p class="muted">${T.cable.no_certificates}</p>`}
${canIssue ? html`<form method="post" action="/loturi/${b.id}/certificat/emite" class="card" data-confirm="${T.cable.issue_confirm}">${csrf(ctx)}
  ${o.measurements.length ? '' : html`<p class="muted">${T.cable.no_results_yet}</p>`}
  ${preview && !preview.conforming && preview.row_count ? html`<p class="flash flash-err">${T.cable.override_needed}</p>${textField({ label: T.cable.override_reason, name: 'override_reason', value: '', errors, required: true })}` : ''}
  <label>${T.cable.cert_language} <select name="lang">${i18n.LANGUAGES.map((l) => html`<option value="${l}"${l === i18n.current() ? raw(' selected') : ''}>${i18n.NAMES[l]}</option>`)}</select></label>
  <button class="btn primary" type="submit"${o.measurements.length ? '' : raw(' disabled')}>${T.cable.issue}</button> <span class="muted">${T.cable.issue_hint}</span></form>` : ''}`,
  });
}

module.exports = { cableNewPage, cableCorrectPage, batchesPage, batchForm, batchDetail, designLine, cableEntryForm };
