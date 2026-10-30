'use strict';
const { html } = require('../lib/html');
const { T, f, opt } = require('../i18n');
const { displayDateTime } = require('../lib/time');
const { layout, csrf } = require('./layout');

/** The text of a notification in the reader's language (unknown kinds show their name). */
const textOf = (n) => { const tpl = opt('notify', n.kind, null); return tpl ? f(tpl, n.params) : f(T.notif.generic, { kind: n.kind }); };

function notificationsPage(ctx, d) {
  const unread = d.rows.filter((r) => !r.read_at).length;
  return layout(ctx, {
    title: T.notif.title, active: 'notifications',
    body: html`<h1>${T.notif.title}</h1>
${unread ? html`<form method="post" action="/notificari/citite" class="inline">${csrf(ctx)}<button class="btn" type="submit">${T.notif.mark_all}</button></form>` : ''}
<section class="card"><ul class="notif-list">${d.rows.length ? d.rows.map((n) => html`<li class="${n.read_at ? 'read' : 'unread'}"><a href="/notificari/${n.id}/deschide"><span class="notif-text">${textOf(n)}</span><span class="muted notif-when">${displayDateTime(n.created_at)}</span></a></li>`) : html`<li class="empty">${T.notif.empty}</li>`}</ul></section>`,
  });
}

module.exports = { notificationsPage, textOf };
