'use strict';
const { html, raw } = require('../lib/html');
const { T, f, S } = require('../i18n/ro');
const calc = require('../domain/calc');
const { layout, csrf, errText } = require('./layout');
const { LISTS } = require('../domain/lists');

const fieldLabel = (def, name) => S.lists.fields[def.title + '_' + name] || S.lists.fields[name] || name;

function indexPage(ctx, d) {
  return layout(ctx, {
    title: T.lists.title, active: 'lists',
    body: html`<h1>${T.lists.title}</h1><p class="muted">${T.lists.intro}</p>
<div class="tiles">${Object.entries(LISTS).map(([key, def]) => html`<a class="tile" href="/liste/${key}"><strong>${T.lists.names[def.title]}</strong><span class="muted">${T.lists.descriptions[def.title]}</span></a>`)}
${ctx.user.role === 'inginer' ? html`<a class="tile" href="/liste/familii"><strong>${T.cfg.families}</strong><span class="muted">${T.cfg.families_desc}</span></a><a class="tile" href="/liste/tinte"><strong>${T.cfg.targets}</strong><span class="muted">${T.cfg.targets_desc}</span></a>${ctx.modules && ctx.modules.cable ? html`<a class="tile" href="/liste/incercari"><strong>${T.cfg.tests}</strong><span class="muted">${T.cfg.tests_desc}</span></a>` : ''}<a class="tile" href="/liste/iec"><strong>${T.cfg.iec}</strong><span class="muted">${T.cfg.iec_desc}</span></a><a class="tile" href="/liste/materiale"><strong>${T.lists.names.materials}</strong><span class="muted">${T.lists.descriptions.materials}</span></a>` : ''}</div>`,
  });
}

function fieldInput(def, fld, value, formId, errors, opts) {
  const o = opts || {};
  const name = fld.name;
  const attrs = formId ? ` form="${formId}"` : '';
  const err = errors && errors[name] ? errText(errors, name) : '';
  const label = fieldLabel(def, name);
  if (fld.type === 'check') return html`<label class="check"><input type="checkbox" name="${name}" value="1"${raw(attrs)}${value ? raw(' checked') : ''}> <span class="sr-only">${label}</span></label>`;
  if (fld.type === 'select') {
    return html`<select name="${name}" aria-label="${label}"${raw(attrs)}>${fld.options(o.db).map(([v, l]) => html`<option value="${v}"${String(v) === String(value) ? raw(' selected') : ''}>${l}</option>`)}</select>${err}`;
  }
  const type = fld.type === 'date' ? 'date' : 'text';
  const inputmode = fld.type === 'int' ? ' inputmode="numeric"' : '';
  return html`<input type="${type}" name="${name}" value="${value === null || value === undefined ? '' : value}" aria-label="${label}"${raw(attrs + inputmode)}${fld.max ? raw(` maxlength="${fld.max}"`) : ''}${fld.required ? raw(' required') : ''}>${err}`;
}

function listPage(ctx, d) {
  const { key, def, rows, db, fam, err } = d;
  const hasActive = def.active !== false;
  const famCell = (r, formId) => html`<td class="fams">${fam.map((x) => html`<label class="check"><input type="checkbox" name="family_ids" value="${x.id}" form="${formId}"${r && r.family_ids && r.family_ids.includes(x.id) ? raw(' checked') : ''}> <span>${x.name}</span></label>`)}</td>`;
  const head = def.fields.map((fl) => html`<th>${fieldLabel(def, fl.name)}</th>`);
  return layout(ctx, {
    title: T.lists.names[def.title], active: 'lists', wide: true,
    body: html`<p><a href="/liste">« ${T.lists.title}</a></p><h1>${T.lists.names[def.title]}</h1>
${key === 'schimburi' ? html`<p class="muted">${T.lists.crews_hint}</p>` : ''}${key === 'utilaje' ? html`<p class="muted">${T.lists.machines_hint}</p>` : ''}
<section class="card"><h2>${T.common.add}</h2>
<form method="post" action="/liste/${key}/adauga" class="row addrow" id="f-new">${csrf(ctx)}
  ${def.fields.map((fl) => html`<div class="cell"><span class="lbl">${fieldLabel(def, fl.name)}</span>${fieldInput(def, fl, err && err.id === 'new' ? err.values[fl.name] : (fl.type === 'select' ? undefined : ''), 'f-new', err && err.id === 'new' ? err.errors : null, { db })}</div>`)}
  ${def.families ? html`<div class="cell fams"><span class="lbl">${T.lists.families}</span>${fam.map((x) => html`<label class="check"><input type="checkbox" name="family_ids" value="${x.id}" form="f-new"> <span>${x.name}</span></label>`)}</div>` : ''}
  <button class="btn primary" type="submit">${T.common.add}</button></form></section>
<section class="card"><div class="scroll"><table class="grid"><thead><tr>${head}${def.families ? html`<th>${T.lists.families}</th>` : ''}${hasActive ? html`<th>${T.common.status}</th>` : ''}<th>${T.common.actions}</th></tr></thead>
<tbody>${rows.map((r) => {
    const fid = `f-${r.id}`;
    const e = err && err.id === r.id ? err : null;
    return html`<tr class="${hasActive && !r.active ? 'inactive' : ''}">
    ${def.fields.map((fl) => html`<td>${fieldInput(def, fl, e ? e.values[fl.name] : r[fl.name], fid, e ? e.errors : null, { db })}</td>`)}
    ${def.families ? famCell(r, fid) : ''}
    ${hasActive ? html`<td>${r.active ? T.common.active : T.common.inactive}</td>` : ''}
    <td class="nowrap"><form method="post" action="/liste/${key}/${r.id}/salveaza" id="${fid}" class="inline">${csrf(ctx)}<button class="btn small" type="submit">${T.common.save}</button></form>
    ${hasActive ? html`<form method="post" action="/liste/${key}/${r.id}/comuta" class="inline">${csrf(ctx)}<button class="btn small" type="submit">${r.active ? T.common.deactivate : T.common.activate}</button></form>` : ''}</td></tr>`;
  })}</tbody></table></div></section>`,
  });
}

function materialsPage(ctx, d) {
  const { rows, err } = d;
  return layout(ctx, {
    title: T.lists.names.materials, active: 'lists',
    body: html`<p><a href="/liste">« ${T.lists.title}</a></p><h1>${T.lists.names.materials}</h1><p class="muted">${T.lists.materials_hint}</p>
<div class="scroll"><table class="grid"><thead><tr><th>${T.lists.fields.material}</th><th>${T.lists.fields.grade}</th><th>${T.lists.fields.rho20}</th><th>${T.lists.fields.density}</th><th>${T.lists.fields.alpha20}</th><th></th></tr></thead>
<tbody>${rows.map((r) => {
    const e = err && err.id === r.id ? err : null;
    const val = (k) => (e ? e.values[k] : (typeof r[k] === 'number' ? String(r[k]).replace('.', ',') : r[k]));
    return html`<tr><th scope="row">${r.name} (${r.code})</th>
  <td><input name="grade" value="${val('grade')}" form="m${r.id}" maxlength="20"></td>
  <td><input name="rho20" value="${val('rho20')}" form="m${r.id}" inputmode="decimal">${e ? errText(e.errors, 'rho20') : ''}</td>
  <td><input name="density" value="${val('density')}" form="m${r.id}" inputmode="decimal">${e ? errText(e.errors, 'density') : ''}</td>
  <td><input name="alpha20" value="${val('alpha20')}" form="m${r.id}" inputmode="decimal">${e ? errText(e.errors, 'alpha20') : ''}</td>
  <td><form method="post" action="/liste/materiale/${r.id}" id="m${r.id}" class="inline">${csrf(ctx)}<button class="btn small" type="submit">${T.common.save}</button></form></td></tr>`;
  })}</tbody></table></div>
<p class="muted">${f(T.lists.materials_check, { kt: calc.formatNumber(calc.kt(27, 0.00393), 4, 4) })}</p>
<section class="card"><h2>${T.lists.kt_title}</h2><p>${T.lists.kt_rule}</p>
<div class="scroll"><table class="grid"><thead><tr><th>t [°C]</th><th>kt Cu</th><th>kt Al</th>${d.kt.has ? html`<th>${T.lists.kt_a1}</th>` : ''}</tr></thead>
<tbody>${d.kt.rows.map((r) => html`<tr class="${r.t === 20 ? 'ref' : ''}"><th scope="row">${r.t}${r.t === 20 ? html` <span class="tag ok">${T.lists.kt_ref}</span>` : ''}</th><td class="num">${calc.formatNumber(r.cu, 4, 4)}</td><td class="num">${calc.formatNumber(r.al, 4, 4)}</td>${d.kt.has ? html`<td class="num">${calc.formatNumber(r.a1, 3, 3)}</td>` : ''}</tr>`)}</tbody></table></div>
${d.kt.has ? html`<p class="${d.kt.maxDiff < 0.0005 ? 'ok-note' : 'notice'}">${f(d.kt.maxDiff < 0.0005 ? T.lists.kt_match : T.lists.kt_mismatch, { diff: calc.formatNumber(d.kt.maxDiff, 0, 4) })}</p>` : ''}</section>`,
  });
}

module.exports = { indexPage, listPage, materialsPage };
