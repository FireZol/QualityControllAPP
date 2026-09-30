'use strict';
const { html } = require('../lib/html');
const { T, f } = require('../i18n');
const { layout, csrf, textField } = require('./layout');

function loginPage(ctx, { username, error, next, lockedMinutes }) {
  return layout(ctx, {
    title: T.login.title,
    body: html`<section class="card narrow login">
      <h1>${T.login.title}</h1>
      ${error ? html`<div class="flash flash-err" role="alert">${error}</div>` : ''}
      ${lockedMinutes ? html`<div class="flash flash-err" role="alert">${f(T.login.locked, { minutes: lockedMinutes })}</div>` : ''}
      <form method="post" action="/login" autocomplete="off">
        ${csrf(ctx)}
        <input type="hidden" name="next" value="${next || ''}">
        ${textField({ label: T.login.username, name: 'username', value: username, autofocus: true, required: true, attrs: 'autocomplete="username" autocapitalize="off"' })}
        ${textField({ label: T.login.password, name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
        <button class="btn primary big" type="submit">${T.login.submit}</button>
      </form>
    </section>`,
  });
}

function passwordPage(ctx, { errors, forced }) {
  return layout(ctx, {
    title: T.password.title,
    body: html`<section class="card narrow">
      <h1>${T.password.title}</h1>
      ${forced ? html`<div class="flash flash-err" role="alert">${T.password.forced}</div>` : ''}
      <form method="post" action="/parola" autocomplete="off">
        ${csrf(ctx)}
        ${textField({ label: T.password.current, name: 'current', type: 'password', errors, required: true, autofocus: true, attrs: 'autocomplete="current-password"' })}
        ${textField({ label: T.password.new, name: 'new', type: 'password', errors, required: true, hint: T.password.hint, attrs: 'autocomplete="new-password"' })}
        ${textField({ label: T.password.confirm, name: 'confirm', type: 'password', errors, required: true, attrs: 'autocomplete="new-password"' })}
        <button class="btn primary" type="submit">${T.password.submit}</button>
      </form>
    </section>`,
  });
}

module.exports = { loginPage, passwordPage };
