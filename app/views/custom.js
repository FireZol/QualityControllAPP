'use strict';
// Pieces of pages for custom fields: inputs in a form, rows in a detail page, columns in a list, controls in a filter bar.
const { html, raw, jsonBlock } = require('../lib/html');
const i18n = require('../i18n');
const { T } = i18n;
const lang = () => i18n.current();
const custom = require('../domain/custom');
const calc = require('../domain/calc');
const { textField, selectField, textArea } = require('./layout');

const NUM = /^-?\d+(\.\d+)?$/;
const shownValue = (f, v) => (v === undefined || v === null ? '' : f.type === 'number' && NUM.test(String(v)) ? calc.dec(v) : v);

/** The inputs of a form (one per active field); `values` {fieldId: raw}, `errors` as the form's own (names cf_<id>). */
function inputs(fields, values, errors, current) {
  if (!fields.length) return '';
  const vals = values || {};
  const one = (f) => {
    const name = `cf_${f.id}`; const label = custom.fieldLabel(f); const v = vals[f.id];
    if (custom.isCalc(f)) return html`<div class="field calc"><span class="lbl">${custom.nameOf(f)} <span class="tag" title="${T.custom.calc_auto}">ƒ</span></span><output class="calc-out" data-calc-out="${f.id}">${custom.display(f, v) || '—'}</output><span class="hint">${T.custom.calc_auto}</span></div>`;
    if (f.type === 'longtext') return textArea({ label, name, value: v, errors, rows: 3, required: !!f.required });
    if (f.type === 'date') return textField({ label, name, value: v, type: 'date', errors, required: !!f.required });
    if (f.type === 'number') return textField({ label, name, value: shownValue(f, v), errors, inputmode: 'decimal', cls: 'num', required: !!f.required });
    if (f.type === 'yesno') return selectField({ label, name, value: v, options: [['1', T.common.yes], ['0', T.common.no]], blank: '—', errors, required: !!f.required });
    if (f.type === 'list') {
      const keepId = String((current && current[f.id]) || v || '');
      const items = (f.items || []).filter((i) => i.active || String(i.id) === keepId);
      return selectField({ label, name, value: v, options: items.map((i) => [i.id, (lang() === 'en' && i.label_en ? i.label_en : i.label) + (i.active ? '' : ` (${T.common.inactive})`)]), blank: '—', errors, required: !!f.required });
    }
    return textField({ label, name, value: v, errors, required: !!f.required, attrs: 'maxlength="200"' });
  };
  const calcs = fields.filter(custom.isCalc);
  let cfg = '';
  if (calcs.length) {
    const universe = fields.universe || fields;
    const types = Object.fromEntries(universe.map((x) => [x.id, x.type]));
    const inForm = new Set(fields.filter((x) => !custom.isCalc(x)).map((x) => x.id));
    const stored = Object.fromEntries(Object.entries({ ...(current || {}), ...vals }).filter(([id]) => !inForm.has(Number(id))));
    cfg = JSON.stringify({ calcs: calcs.map((c) => ({ id: c.id, f: c.formula, d: c.decimals === null || c.decimals === undefined ? 2 : c.decimals, u: c.unit || '' })), types, stored });
  }
  return html`<fieldset class="custom-fields"${cfg ? html` data-calcs="${cfg}"` : ''}><legend>${T.custom.section}</legend><div class="row">${fields.map(one)}</div></fieldset>`;
}

/** Rows for a facts list (<dl class="facts">): every field that applies, "—" where nothing was entered. */
function facts(fields, values) {
  if (!fields.length) return '';
  const vals = values || {};
  return fields.map((f) => { const t = custom.display(f, vals[f.id]); return html`<div class="cf"><dt>${custom.fieldLabel(f)}${custom.isCalc(f) ? html` <span class="tag" title="${T.custom.calc_badge}">ƒ</span>` : ''}</dt><dd>${f.type === 'longtext' && t ? html`<span class="pre">${t}</span>` : t || html`<span class="muted">—</span>`}</dd></div>`; });
}

/** Column headers / cells for the fields marked "show in the list". */
const columns = (fields) => fields.filter((f) => f.show_in_list);
const headCells = (fields) => columns(fields).map((f) => html`<th class="cf-col">${custom.fieldLabel(f)}</th>`);
const bodyCells = (fields, values) => columns(fields).map((f) => { const t = custom.display(f, (values || {})[f.id]); return html`<td class="cf-col">${t || html`<span class="muted">—</span>`}</td>`; });

/** Filter controls for a filter bar (inside its <div class="row">). `query` is the URLSearchParams of the page. */
function filterControls(fields, query) {
  const q = (k) => query.get(k) || '';
  return fields.map((f) => {
    const label = custom.fieldLabel(f);
    if (f.type === 'list') return selectField({ label, name: `cf${f.id}`, value: q(`cf${f.id}`), options: (f.items || []).filter((i) => i.active).map((i) => [i.id, lang() === 'en' && i.label_en ? i.label_en : i.label]), blank: T.common.all });
    if (f.type === 'yesno') return selectField({ label, name: `cf${f.id}`, value: q(`cf${f.id}`), options: [['1', T.common.yes], ['0', T.common.no]], blank: T.common.all });
    if (f.type === 'number' || f.type === 'date') {
      const t = f.type === 'date' ? 'date' : 'text';
      return html`<div class="field range"><span class="lbl">${label}</span><span class="range-in"><input type="${t}" name="cf${f.id}_a" value="${q(`cf${f.id}_a`)}" aria-label="${label} — ${T.custom.from}" placeholder="${T.custom.from}"${f.type === 'number' ? raw(' inputmode="decimal"') : ''}> <span aria-hidden="true">–</span> <input type="${t}" name="cf${f.id}_b" value="${q(`cf${f.id}_b`)}" aria-label="${label} — ${T.custom.to}" placeholder="${T.custom.to}"${f.type === 'number' ? raw(' inputmode="decimal"') : ''}></span></div>`;
    }
    return textField({ label, name: `cf${f.id}`, value: q(`cf${f.id}`) });
  });
}

module.exports = { inputs, facts, headCells, bodyCells, columns, filterControls };
