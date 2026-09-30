'use strict';
// Page shell and small HTML helpers shared by every view. All output goes through html`` / h().
const { html, h, raw } = require('../lib/html');
const { T, f, opt } = require('../i18n');
const i18n = require('../i18n');
const calc = require('../domain/calc');

function nav(user, active, modules) {
  const items = [['home', '/', T.nav.home], ['new', '/masuratori/nou', T.nav.new_measurement], ['register', '/masuratori', T.nav.register]];
  if (modules && modules.cable) items.push(['batches', '/loturi', T.nav.batches]);
  if (modules && modules.analytics) items.push(['analyses', '/analize', T.nav.analyses]);
  items.push(['specs', '/fise', T.nav.specs]);
  if (user.role === 'inginer' || user.role === 'administrator') items.push(['lists', '/liste', T.nav.lists]);
  if (user.role === 'administrator') {
    items.push(['users', '/admin/utilizatori', T.nav.users], ['settings', '/admin/setari', T.nav.settings], ['audit', '/admin/jurnal', T.nav.audit]);
  }
  return html`<nav class="nav" aria-label="${T.nav.label}">${items.map(([key, href, label]) =>
    html`<a href="${href}" class="${key === active ? 'active' : ''}"${key === active ? raw(' aria-current="page"') : ''}>${label}</a>`)}</nav>`;
}

/** The "?" button at the top right: a short tip list for the current screen. No script needed to open it. */
function helpBox(active) {
  const lines = opt('help', active, null) || T.help.default;
  return html`<details class="help"><summary title="${T.help.label}" aria-label="${T.help.label}">?</summary>
    <div class="help-box" role="region" aria-label="${T.help.title}"><strong>${T.help.title}</strong><ul>${lines.map((l) => html`<li>${l}</li>`)}</ul></div></details>`;
}

const LANG_TITLE = { ro: 'Română', en: 'English' };

/** RO | EN buttons: they post the choice and come back to the same page. */
function langSwitch(ctx) {
  const cur = i18n.current();
  const back = ctx.url ? ctx.url.pathname + ctx.url.search : '/';
  return html`<form method="post" action="${ctx.user ? '/limba' : '/limba/login'}" class="lang">${csrf(ctx)}<input type="hidden" name="back" value="${back}">${i18n.LANGUAGES.map((l) =>
    html`<button type="submit" name="lang" value="${l}" title="${LANG_TITLE[l]}"${l === cur ? raw(' class="active" aria-current="true"') : ''}>${i18n.NAMES[l]}</button>`)}</form>`;
}

function flashBox(flash) {
  if (!flash) return '';
  const msg = T.flash[flash.key];
  if (!msg) return '';
  return html`<div class="flash flash-${flash.type === 'err' ? 'err' : 'ok'}" role="status">${msg}</div>`;
}

/**
 * @param ctx   request context ({user, session, flash})
 * @param opts  {title, active, body, scripts:[...], wide}
 */
function layout(ctx, opts) {
  const user = ctx.user;
  const title = opts.title ? `${opts.title} — ${T.app.name}` : T.app.name;
  const scripts = ['/static/app.js'].concat(opts.scripts || []);
  return html`<!doctype html>
<html lang="${i18n.current()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">${T.app.name}</a>
  ${user ? nav(user, opts.active, ctx.modules) : ''}
  ${user ? html`<div class="who"><span class="who-name">${user.full_name}</span> <span class="who-role">${T.roles[user.role]}</span>
    <a href="/parola">${T.nav.password}</a>
    <form method="post" action="/iesire" class="inline">${csrf(ctx)}<button type="submit" class="link">${T.nav.logout}</button></form>${langSwitch(ctx)}${helpBox(opts.active)}</div>` : html`<div class="who">${langSwitch(ctx)}</div>`}
</header>
<main class="${opts.wide ? 'wide' : ''}">
${flashBox(ctx.flash)}
${opts.body}
</main>
${scripts.map((s) => html`<script src="${s}"></script>`)}
</body>
</html>`;
}

const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session ? ctx.session.csrf : ctx.loginToken || ''}">`;

// ----- form helpers -----

function errText(errors, name) {
  if (!errors || !errors[name]) return '';
  const code = errors[name];
  return html`<span class="field-error" role="alert">${opt('errors', code, T.errors.invalid)}</span>`;
}

function textField({ label, name, value, errors, type, hint, attrs, required, autofocus, inputmode, cls }) {
  return html`<label class="field ${cls || ''}${errors && errors[name] ? ' has-error' : ''}"><span class="lbl">${label}${required ? html` <abbr title="${T.common.required}">*</abbr>` : ''}</span>
    <input type="${type || 'text'}" name="${name}" value="${value === null || value === undefined ? '' : value}"${required ? raw(' required') : ''}${autofocus ? raw(' autofocus') : ''}${inputmode ? raw(` inputmode="${h(inputmode)}"`) : ''}${attrs ? raw(' ' + attrs) : ''}>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}${errText(errors, name)}</label>`;
}

/** options: [[value, label], ...] */
function selectField({ label, name, value, options, errors, blank, required, attrs, cls }) {
  return html`<label class="field ${cls || ''}${errors && errors[name] ? ' has-error' : ''}"><span class="lbl">${label}${required ? html` <abbr title="${T.common.required}">*</abbr>` : ''}</span>
    <select name="${name}"${required ? raw(' required') : ''}${attrs ? raw(' ' + attrs) : ''}>${blank !== undefined ? html`<option value="">${blank}</option>` : ''}${options.map(([v, l]) => html`<option value="${v}"${String(v) === String(value) ? raw(' selected') : ''}>${l}</option>`)}</select>
    ${errText(errors, name)}</label>`;
}

function checkField({ label, name, checked, hint }) {
  return html`<label class="check"><input type="checkbox" name="${name}" value="1"${checked ? raw(' checked') : ''}> <span>${label}</span>${hint ? html` <span class="hint">${hint}</span>` : ''}</label>`;
}

function textArea({ label, name, value, errors, rows, required }) {
  return html`<label class="field${errors && errors[name] ? ' has-error' : ''}"><span class="lbl">${label}${required ? html` <abbr title="${T.common.required}">*</abbr>` : ''}</span>
    <textarea name="${name}" rows="${rows || 3}"${required ? raw(' required') : ''}>${value || ''}</textarea>${errText(errors, name)}</label>`;
}

function verdictBadge(v) {
  return html`<span class="v v-${v}">${T.verdict[v]}</span>`;
}

/** A measured value coloured by its verdict, text label included (colour is never the only signal). */
function valueCell(result, quantity, extraClass) {
  if (!result) return html`<span class="muted">–</span>`;
  return html`<span class="val v-${result.verdict} ${extraClass || ''}" title="${T.verdict[result.verdict]}">${calc.formatQuantity(quantity, result.value)}</span>`;
}

function limitText(min, max, quantity) {
  const a = min === null || min === undefined ? null : calc.formatQuantity(quantity || 'mass_gm', min);
  const b = max === null || max === undefined ? null : calc.formatQuantity(quantity || 'mass_gm', max);
  if (a === null && b === null) return T.verdict.nedeterminat;
  return `${a === null ? '–' : a} … ${b === null ? '–' : b}`;
}

function pager(base, page, pages, params) {
  if (pages <= 1) return '';
  const q = (p) => {
    const usp = new URLSearchParams(params || {});
    usp.set('pagina', String(p));
    return base + '?' + usp.toString();
  };
  return html`<nav class="pager" aria-label="${T.common.pages}">
    ${page > 1 ? html`<a href="${q(page - 1)}">« ${T.common.previous}</a>` : ''}
    <span>${f(T.common.page_of, { page, pages })}</span>
    ${page < pages ? html`<a href="${q(page + 1)}">${T.common.next} »</a>` : ''}</nav>`;
}

module.exports = { layout, csrf, textField, selectField, checkField, textArea, verdictBadge, valueCell, limitText, pager, errText, flashBox };
