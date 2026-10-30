'use strict';
// Page shell and small HTML helpers shared by every view. All output goes through html`` / h().
const { html, h, raw } = require('../lib/html');
const { T, f, opt } = require('../i18n');
const i18n = require('../i18n');
const calc = require('../domain/calc');
const reg = require('../modules/registry');
const notifications = require('../domain/notifications');
const tasksDomain = require('../domain/tasks');

/**
 * The left navigation (owner, 2026-10-30, after the HomeCloud look): Home on top, then one section per module the user may open;
 * the section of the module being used is open, the others fold. Administration is its own section.
 */
const ICONS = { home: '📊', new: '➕', register: '☰', batches: '📦', analyses: '📈', specs: '📄', lists: '🗂️', tasks: '✅', preventive: '🗓️', ncr: '⚠️', top: '🔝', list: '👥', series: '🔁', users: '👤', settings: '⚙️', audit: '📜' };

function sidebar(ctx, active) {
  const { user, modules } = ctx;
  const cur = ctx.module || 'qc';
  const link = (mod, [key, href, label, badge]) => {
    const on = mod === cur && key === active;
    return html`<a href="${href}" class="${on ? 'active' : ''}"${on ? raw(' aria-current="page"') : ''}><span class="ico" aria-hidden="true">${ICONS[key] || '•'}</span><span class="lab">${label}</span>${badge ? html`<span class="side-badge">${badge}</span>` : ''}</a>`;
  };
  const section = (mod, title, items, isOpen) => html`<details class="side-sec"${(isOpen === undefined ? mod === cur : isOpen) ? raw(' open') : ''}><summary>${title}</summary><div class="side-items">${items.map((it) => link(mod, it))}</div></details>`;

  const qc = [['new', '/masuratori/nou', T.nav.new_measurement], ['register', '/masuratori', T.nav.register]];
  if (modules && modules.cable) qc.push(['batches', '/loturi', T.nav.batches]);
  if (modules && modules.analytics) qc.push(['analyses', '/analize', T.nav.analyses]);
  qc.push(['specs', '/fise', T.nav.specs]);
  if (user.role === 'inginer' || user.role === 'administrator') qc.push(['lists', '/liste', T.nav.lists]);

  const others = reg.MODULES.filter((m) => !m.core && modules && modules[m.id] && reg.rank(ctx.level(m.id)) >= 1)
    .map((m) => section(m.id, T.modules[m.id].name, m.menu.filter((x) => reg.rank(ctx.level(m.id)) >= reg.rank(x.minLevel || 'view')).map((x) => [x.key, x.href, T.nav['m_' + x.name]])));
  const admin = user.role === 'administrator' ? section('qc', T.nav.admin, [['users', '/admin/utilizatori', T.nav.users], ['settings', '/admin/setari', T.nav.settings], ['audit', '/admin/jurnal', T.nav.audit]], ['users', 'settings', 'audit'].includes(active)) : '';
  return html`<nav class="side-nav" aria-label="${T.nav.label}">
    <a href="/" class="side-home${cur === 'qc' && active === 'home' ? ' active' : ''}"${cur === 'qc' && active === 'home' ? raw(' aria-current="page"') : ''}><span class="ico" aria-hidden="true">${ICONS.home}</span><span class="lab">${T.nav.home}</span></a>
    ${section('qc', T.modules.qc.name, qc)}${others}${admin}</nav>`;
}

/** Status chips in the top bar: tasks still open and critical ones, for the teams this user can see; each opens that board. */
function statusChips(ctx) {
  if (!ctx.db || !ctx.modules) return '';
  const teams = tasksDomain.TEAMS.filter((t) => ctx.modules[t] && tasksDomain.canView(ctx.db, ctx.user, t, ctx.modules));
  if (!teams.length) return '';
  const c = tasksDomain.barCounts(ctx.db, teams);
  const base = tasksDomain.teamPath(teams[0]);
  return html`<a class="chip-pill" href="${base}" title="${T.nav.chip_open_title}"><span>${T.nav.chip_open}</span><strong>${c.open}</strong></a>${c.topPriority ? html`<a class="chip-pill ${c.critical ? 'is-crit' : ''}" href="${base}?priority=${c.topPriority}" title="${T.nav.chip_critical_title}"><span>${T.nav.chip_critical}</span><strong>${c.critical}</strong></a>` : ''}`;
}

/** The bell: unread notifications. */
function bell(ctx) {
  const n = ctx.db ? notifications.unread(ctx.db, ctx.user.id) : 0;
  return html`<a class="bell" href="/notificari" title="${T.nav.notifications}" aria-label="${n ? f(T.nav.notifications_n, { n }) : T.nav.notifications}">🔔${n ? html`<span class="bell-n">${n > 99 ? '99+' : n}</span>` : ''}</a>`;
}

/** The "?" button at the top right: a short tip list for the current screen. No script needed to open it. */
function helpBox(active) {
  const lines = opt('help', active, null) || T.help.default;
  return html`<details class="help"><summary title="${T.help.label}" aria-label="${T.help.label}">?</summary>
    <div class="help-box" role="region" aria-label="${T.help.title}"><strong>${T.help.title}</strong><ul>${lines.map((l) => html`<li>${l}</li>`)}</ul></div></details>`;
}

const version = require('../version');

/** Version, BETA tag and the "Report a problem" link (only when an address is set in Settings). */
function footer(ctx) {
  const who = ctx.user ? ctx.user.username : '-';
  const page = ctx.url ? `http://${(ctx.req && ctx.req.headers.host) || 'localhost'}${ctx.url.pathname}${ctx.url.search}` : '';
  const mail = ctx.feedbackEmail
    ? `mailto:${ctx.feedbackEmail}?subject=${encodeURIComponent(`${T.app.name} ${version.version}`)}&body=${encodeURIComponent(`${T.layout.report_body}\n\n${page}\n${T.app.name} ${version.version} (${who})`)}` : '';
  return html`<footer class="foot"><span>${T.app.name} ${version.version}</span>${version.beta ? html` <span class="beta-tag" title="${T.layout.beta_title}">BETA</span>` : ''}${mail ? html` · <a href="${mail}">${T.layout.report_problem}</a>` : ''}</footer>`;
}

/** Up to two initials for the avatar circle. */
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

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
<script src="/static/prefs.js"></script>
</head>
<body>
<div class="app">
${user ? html`<aside class="side" id="side"><a class="brand" href="/">${T.app.name}</a>${sidebar(ctx, opts.active)}<div class="side-foot">${version.version}${version.beta ? html` <span class="beta-tag" title="${T.layout.beta_title}">BETA</span>` : ''}</div></aside>
<div class="side-scrim" data-side-close></div>` : ''}
<div class="content">
<header class="top">
  ${user ? html`<button type="button" class="icon-btn side-toggle" data-side-toggle aria-label="${T.nav.menu}" aria-controls="side">☰</button>` : ''}
  <a class="brand" href="/">${T.app.name}</a>
  <span class="page-title">${opts.title || ''}</span>
  ${user ? html`<div class="chips">${statusChips(ctx)}</div>` : ''}
  ${user ? html`<div class="who">
    <details class="navmore theme-menu"><summary class="icon-btn" title="${T.layout.theme}" aria-label="${T.layout.theme}">◐</summary>
      <div class="navmore-box right" role="menu">${[['light', '☀', T.layout.theme_light], ['dark', '☾', T.layout.theme_dark], ['system', '🖥', T.layout.theme_system]].map(([v, i, l]) => html`<button type="button" role="menuitemradio" aria-checked="false" data-theme-set="${v}"><span aria-hidden="true">${i}</span> ${l}</button>`)}</div></details>
    <button type="button" class="comfort-btn" data-comfort title="${T.layout.comfort}" aria-label="${T.layout.comfort}" aria-pressed="false">A<small>+</small></button>
    ${bell(ctx)}${langSwitch(ctx)}${helpBox(opts.active)}
    <details class="navmore account"><summary title="${T.roles[user.role]}"><span class="avatar" aria-hidden="true">${initials(user.full_name)}</span><span class="acc-who"><span class="acc-name">${user.full_name}</span><small>${T.roles[user.role]}</small></span> <span aria-hidden="true">▾</span></summary>
      <div class="navmore-box right"><div class="navmore-role">${T.roles[user.role]}</div><a href="/parola">${T.nav.password}</a>
        <form method="post" action="/iesire">${csrf(ctx)}<button type="submit">${T.nav.logout}</button></form></div></details></div>` : html`<div class="who">${langSwitch(ctx)}</div>`}
</header>
<main class="${opts.wide ? 'wide' : ''}">
${flashBox(ctx.flash)}
${opts.body}
</main>
${footer(ctx)}
</div>
</div>
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
