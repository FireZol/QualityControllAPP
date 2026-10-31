'use strict';
// Administration of custom fields and custom lists (administrators only).
const { html, jsonBlock } = require('../lib/html');
const i18n = require('../i18n');
const formula = require('../domain/formula');
const { T, f } = require('../i18n');
const custom = require('../domain/custom');
const { displayDateTime } = require('../lib/time');
const { layout, csrf, textField, selectField, checkField, textArea, errText } = require('./layout');

const kindName = (k) => T.custom.kind[k];
const typeName = (t) => T.custom.type[t];

function tabs(active) {
  return html`<div class="tabs"><a class="${active === 'fields' ? 'active' : ''}" href="/admin/campuri">${T.custom.tab_fields}</a><a class="${active === 'lists' ? 'active' : ''}" href="/admin/campuri/liste">${T.custom.tab_lists}</a></div>`;
}

const TYPE_ORDER = ['text', 'longtext', 'number', 'calc', 'date', 'yesno', 'list'];
const FN_CHIPS = ['round(', 'min(', 'max(', 'avg(', 'sum(', 'abs(', 'sqrt(', 'pow(', 'if(', 'empty(', 'today()'];

/** The formula editor: the text, chips that insert fields and functions, examples made from the fields that exist, a live preview (admin-formula.js). */
function formulaBuilder(d, v, errors, selfId) {
  const typed = d.values ? v.formula : (v.formula ? formula.toDisplay(v.formula, d.pool, i18n.current()) : '');
  const msgs = { ...Object.fromEntries(['empty', 'syntax', 'unknown_field', 'ambiguous_field', 'unknown_function', 'arg_count', 'too_long', 'too_deep', 'too_big', 'order', 'no_field', 'div0', 'domain', 'range', 'digits'].map((k) => [k, T.errors['formula_' + k]])),
    fill: T.custom.preview_fill, empty_result: T.custom.preview_empty, result: T.custom.preview_result, yes: T.common.yes, no: T.common.no, none: T.custom.formula_no_fields,
    ex_convert: T.custom.ex_convert, ex_multiply: T.custom.ex_multiply, ex_days: T.custom.ex_days, ex_if: T.custom.ex_if, ex_default: T.custom.ex_default };
  return html`<div class="formula-builder" data-when="type=calc" data-formula-builder data-self="${selfId || ''}">
  <label class="field${errors && errors.formula ? ' has-error' : ''}"><span class="lbl">${T.custom.formula} <abbr title="${T.common.required}">*</abbr></span>
    <textarea name="formula" rows="3" spellcheck="false" autocomplete="off" maxlength="600" data-formula-text>${typed}</textarea>
    <span class="hint">${T.custom.formula_hint}</span>${errText(errors, 'formula')}</label>
  <div class="chips" data-chips="fields"><span class="lbl">${T.custom.formula_fields}</span></div>
  <div class="chips"><span class="lbl">${T.custom.formula_functions}</span>${FN_CHIPS.map((x) => html`<button type="button" class="chip fn" data-insert="${x}">${x}</button>`)}</div>
  <div class="chips" data-chips="examples"><span class="lbl">${T.custom.formula_examples}</span></div>
  <div class="preview" data-preview><strong>${T.custom.preview}</strong> <small class="muted">${T.custom.preview_hint}</small><div class="samples"></div><p class="calc-result" role="status" aria-live="polite"></p></div>
  <details class="how"><summary>${T.custom.how_title}</summary><ul><li>${T.custom.how_1}</li><li>${T.custom.how_2}</li><li>${T.custom.how_3}</li><li>${T.custom.how_4}</li><li>${T.custom.how_5}</li></ul></details>
  <script type="application/json" id="cf-pool">${jsonBlock(d.pool.map((x) => ({ id: x.id, kind: x.kind, team: x.team, label: x.label, label_en: x.label_en, type: x.type, calc: !!x.calc, active: !!x.active })))}</script>
  <script type="application/json" id="cf-msgs">${jsonBlock({ lang: i18n.current(), ...msgs })}</script>
</div>`;
}

/** The form for one field (new, or edit when `fld` is given: kind and type are then fixed). */
function fieldForm(ctx, d) {
  const { fld, errors, lists, values } = d;
  const v = values || fld || { kind: d.kind || 'task', type: 'text', show_in_list: 1, active: 1 };
  const locked = !!fld;
  const typeVal = v.type === 'calc' || (v.type === 'number' && v.formula) ? 'calc' : v.type;
  return html`<form method="post" action="${fld ? `/admin/campuri/${fld.id}/editeaza` : '/admin/campuri/nou'}" class="card entry">${csrf(ctx)}
  <div class="row">
    ${locked ? html`<input type="hidden" name="kind" value="${v.kind}"><input type="hidden" name="type" value="${typeVal}"><label class="field"><span class="lbl">${T.custom.applies_to}</span><input value="${kindName(v.kind)}" disabled></label>`
      : selectField({ label: T.custom.applies_to, name: 'kind', value: v.kind, options: custom.KINDS.map((k) => [k, kindName(k)]), errors, required: true })}
    ${selectField({ label: T.custom.team, name: 'team', value: v.team || '', options: custom.TEAMS.map((t) => [t, T.modules[t].name]), blank: T.custom.all_teams, errors, attrs: 'data-when="kind=task"' })}
    ${locked ? html`<label class="field"><span class="lbl">${T.custom.type_label}</span><input value="${typeName(typeVal)}" disabled><span class="hint">${T.custom.type_locked}</span></label>`
      : selectField({ label: T.custom.type_label, name: 'type', value: typeVal, options: TYPE_ORDER.map((t) => [t, typeName(t)]), errors, required: true })}
  </div>
  <div class="row">
    ${textField({ label: T.custom.label_ro, name: 'label', value: v.label, errors, required: true, attrs: 'maxlength="80"' })}
    ${textField({ label: T.custom.label_en, name: 'label_en', value: v.label_en, errors, hint: T.custom.label_en_hint, attrs: 'maxlength="80"' })}
  </div>
  ${formulaBuilder(d, v, errors, fld && fld.id)}
  <div class="row">
    ${selectField({ label: T.custom.list_label, name: 'list_id', value: v.list_id || '', options: lists.filter((l) => l.active || l.id === v.list_id).map((l) => [l.id, custom.listNameOf(l)]), blank: '—', errors, attrs: 'data-when="type=list"' })}
    ${textField({ label: T.custom.unit, name: 'unit', value: v.unit, errors, cls: 'num', hint: T.custom.unit_hint, attrs: 'maxlength="12" data-when="type=number,calc"' })}
    ${textField({ label: T.custom.decimals, name: 'decimals', value: v.decimals === null || v.decimals === undefined ? 2 : v.decimals, errors, cls: 'num', inputmode: 'numeric', hint: T.custom.decimals_hint, attrs: 'data-when="type=calc"' })}
    ${textField({ label: T.custom.order, name: 'sort', value: fld || v.sort ? v.sort : '', errors, cls: 'num', inputmode: 'numeric', hint: T.custom.order_hint })}
  </div>
  <p class="muted" data-when="type=list">${T.custom.list_note}</p>
  ${checkField({ label: T.custom.required, name: 'required', checked: !!v.required, hint: T.custom.required_hint, attrs: 'data-when="type=text,longtext,number,date,yesno,list"' })}
  ${checkField({ label: T.custom.show_in_list, name: 'show_in_list', checked: !!v.show_in_list, hint: T.custom.show_in_list_hint })}
  ${fld ? checkField({ label: T.custom.active, name: 'active', checked: !!v.active, hint: T.custom.active_hint }) : ''}
  <div class="actions"><button class="btn primary" type="submit">${fld ? T.common.save : T.custom.add_field}</button>${fld ? html`<a class="btn" href="/admin/campuri">${T.common.cancel}</a>` : ''}</div>
</form>`;
}

function fieldsPage(ctx, d) {
  const { rows, kind, lists } = d;
  const chip = (k, label) => html`<a class="qchip${(kind || '') === k ? ' on' : ''}" href="/admin/campuri${k ? `?kind=${k}` : ''}">${label}</a>`;
  return layout(ctx, {
    title: T.custom.title, active: 'custom', wide: true, scripts: ['/static/formula.js', '/static/formula-builder.js'],
    body: html`<h1>${T.custom.title}</h1><p class="muted">${T.custom.intro}</p>${tabs('fields')}
<div class="quick">${chip('', T.common.all)}${custom.KINDS.map((k) => chip(k, kindName(k)))}</div>
<div class="scroll"><table class="grid"><thead><tr><th>${T.custom.order}</th><th>${T.custom.name}</th><th>${T.custom.applies_to}</th><th>${T.custom.type_label}</th><th>${T.custom.required}</th><th>${T.custom.show_in_list}</th><th>${T.custom.used}</th><th>${T.common.status}</th><th></th></tr></thead>
<tbody>${rows.length ? rows.map((r) => html`<tr class="${r.active ? '' : 'is-hidden'}"><td class="num">${r.sort}</td>
  <td><strong>${r.label}</strong>${r.label_en ? html` <span class="muted">/ ${r.label_en}</span>` : ''}${r.unit ? html` <small class="muted">[${r.unit}]</small>` : ''}</td>
  <td>${kindName(r.kind)}${r.team ? html` · ${T.modules[r.team].name}` : ''}</td>
  <td>${typeName(r.formula ? 'calc' : r.type)}${r.list_name ? html` <small class="muted">· ${r.list_name}</small>` : ''}</td>
  <td>${r.required ? T.common.yes : ''}</td><td>${r.show_in_list ? T.common.yes : ''}</td><td class="num">${r.used}</td>
  <td>${r.active ? html`<span class="tag ok">${T.common.active}</span>` : html`<span class="tag">${T.custom.hidden}</span>`}</td>
  <td><a class="btn small" href="/admin/campuri/${r.id}/editeaza">${T.common.edit}</a></td></tr>`) : html`<tr><td colspan="9" class="empty">${T.custom.no_fields}</td></tr>`}</tbody></table></div>
<h2>${T.custom.add_field}</h2>
${fieldForm(ctx, { kind, lists, values: d.values, errors: d.errors, pool: d.pool || [] })}`,
  });
}

function fieldEditPage(ctx, d) {
  const { fld, calc } = d;
  return layout(ctx, {
    title: T.custom.edit_field, active: 'custom', scripts: ['/static/formula.js', '/static/formula-builder.js'],
    body: html`<p><a href="/admin/campuri">« ${T.custom.title}</a></p><h1>${T.custom.edit_field}: ${fld.label}</h1>
${fld.used ? html`<p class="notice">${f(T.custom.edit_used, { n: fld.used })}</p>` : ''}
${fieldForm(ctx, d)}
${calc ? html`<section class="card"><h2>${T.custom.recalc_title}</h2><p>${f(T.custom.recalc_text, { n: d.records })}</p>
  <form method="post" action="/admin/campuri/${fld.id}/recalcula" data-confirm="${T.custom.recalc_confirm}">${csrf(ctx)}<button class="btn" type="submit">${T.custom.recalc_btn}</button></form></section>
<section class="card"><h2>${T.custom.history_title}</h2>
  <div class="scroll"><table class="grid"><thead><tr><th>${T.custom.history_when}</th><th>${T.custom.history_by}</th><th>${T.custom.formula}</th><th>${T.custom.decimals}</th></tr></thead>
  <tbody>${d.history.map((h, i) => html`<tr><td class="nowrap">${displayDateTime(h.changed_at)}${i === 0 ? html` <span class="tag ok">${T.custom.history_current}</span>` : ''}</td><td>${h.by_name || '—'}</td><td><code>${formula.toDisplay(h.formula, d.pool, i18n.current())}</code></td><td class="num">${h.decimals ?? ''}</td></tr>`)}</tbody></table></div></section>` : ''}`,
  });
}

function listsPage(ctx, d) {
  const { lists, errors, values } = d;
  return layout(ctx, {
    title: T.custom.title, active: 'custom',
    body: html`<h1>${T.custom.title}</h1><p class="muted">${T.custom.lists_intro}</p>${tabs('lists')}
<div class="scroll"><table class="grid"><thead><tr><th>${T.custom.name}</th><th>${T.custom.items}</th><th>${T.custom.used_by}</th><th>${T.common.status}</th><th></th></tr></thead>
<tbody>${lists.length ? lists.map((l) => html`<tr class="${l.active ? '' : 'is-hidden'}"><td><strong>${l.name}</strong>${l.name_en ? html` <span class="muted">/ ${l.name_en}</span>` : ''}</td>
  <td class="num">${l.items.filter((i) => i.active).length}${l.items.some((i) => !i.active) ? html` <small class="muted">(+${l.items.filter((i) => !i.active).length} ${T.custom.hidden})</small>` : ''}</td>
  <td>${l.used_by.length ? l.used_by.map((x) => x.label).join(', ') : html`<span class="muted">—</span>`}</td>
  <td>${l.active ? html`<span class="tag ok">${T.common.active}</span>` : html`<span class="tag">${T.custom.hidden}</span>`}</td>
  <td><a class="btn small" href="/admin/campuri/liste/${l.id}">${T.custom.open_list}</a></td></tr>`) : html`<tr><td colspan="5" class="empty">${T.custom.no_lists}</td></tr>`}</tbody></table></div>
<h2>${T.custom.add_list}</h2>
<form method="post" action="/admin/campuri/liste/nou" class="card entry">${csrf(ctx)}<div class="row">
  ${textField({ label: T.custom.label_ro, name: 'name', value: values && values.name, errors, required: true, attrs: 'maxlength="80"' })}
  ${textField({ label: T.custom.label_en, name: 'name_en', value: values && values.name_en, errors, hint: T.custom.label_en_hint, attrs: 'maxlength="80"' })}</div>
  <div class="actions"><button class="btn primary" type="submit">${T.custom.add_list}</button></div></form>`,
  });
}

function listPage(ctx, d) {
  const { list, errors, values } = d;
  const v = values || list;
  return layout(ctx, {
    title: list.name, active: 'custom', wide: true,
    body: html`<p><a href="/admin/campuri/liste">« ${T.custom.tab_lists}</a></p><h1>${list.name}</h1>
<form method="post" action="/admin/campuri/liste/${list.id}" class="card entry">${csrf(ctx)}<div class="row">
  ${textField({ label: T.custom.label_ro, name: 'name', value: v.name, errors, required: true, attrs: 'maxlength="80"' })}
  ${textField({ label: T.custom.label_en, name: 'name_en', value: v.name_en, errors, attrs: 'maxlength="80"' })}</div>
  ${checkField({ label: T.custom.active, name: 'active', checked: v.active !== 0 && v.active !== false, hint: T.custom.list_active_hint })}
  ${errors && errors.active ? html`<span class="field-error">${T.errors.list_in_use}</span>` : ''}
  <div class="actions"><button class="btn primary" type="submit">${T.common.save}</button></div></form>
<h2>${T.custom.items}</h2>
<div class="scroll"><table class="grid"><thead><tr><th>${T.custom.order}</th><th>${T.custom.label_ro}</th><th>${T.custom.label_en}</th><th>${T.common.status}</th><th></th></tr></thead>
<tbody>${list.items.length ? list.items.map((i) => html`<tr class="${i.active ? '' : 'is-hidden'}">
  <td><form method="post" action="/admin/campuri/liste/${list.id}/element/${i.id}" id="item-${i.id}">${csrf(ctx)}</form><input class="num" form="item-${i.id}" name="sort" value="${i.sort}" inputmode="numeric" aria-label="${T.custom.order}"></td>
  <td><input form="item-${i.id}" name="label" value="${i.label}" maxlength="80" aria-label="${T.custom.label_ro}"></td>
  <td><input form="item-${i.id}" name="label_en" value="${i.label_en || ''}" maxlength="80" aria-label="${T.custom.label_en}"></td>
  <td><label class="check"><input form="item-${i.id}" type="checkbox" name="active" value="1"${i.active ? ' checked' : ''}> <span>${T.common.active}</span></label></td>
  <td><button class="btn small" form="item-${i.id}" type="submit">${T.common.save}</button></td></tr>`) : html`<tr><td colspan="5" class="empty">${T.custom.no_items}</td></tr>`}</tbody></table></div>
<h2>${T.custom.add_items}</h2>
<form method="post" action="/admin/campuri/liste/${list.id}/element" class="card entry">${csrf(ctx)}
  ${textArea({ label: T.custom.items_text, name: 'items', value: d.itemsText, errors, rows: 6, required: true })}
  <p class="muted">${T.custom.items_hint}</p>
  <div class="actions"><button class="btn primary" type="submit">${T.custom.add_items_btn}</button></div></form>`,
  });
}

module.exports = { fieldsPage, fieldEditPage, listsPage, listPage };
