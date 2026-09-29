'use strict';
const { html } = require('../lib/html');
const { T } = require('../i18n/ro');
const { layout } = require('./layout');

function errorPage(ctx, key) {
  return layout(ctx, {
    title: T.error_pages[key].title,
    body: html`<section class="card narrow"><h1>${T.error_pages[key].title}</h1><p>${T.error_pages[key].text}</p>
      <p><a class="btn" href="/">${T.error_pages.home}</a></p></section>`,
  });
}

module.exports = { errorPage };
