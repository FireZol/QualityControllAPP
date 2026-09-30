'use strict';
const { html } = require('../lib/html');
const { T, f, S } = require('../i18n');
const calc = require('../domain/calc');
const { displayDateTime } = require('../lib/time');
const { layout, csrf, textField, selectField, checkField, pager } = require('./layout');

function usersPage(ctx, users) {
  return layout(ctx, {
    title: T.users.title, active: 'users',
    body: html`<h1>${T.users.title}</h1><p><a class="btn primary" href="/admin/utilizatori/nou">${T.users.new}</a></p>
<div class="scroll"><table class="grid"><thead><tr><th>${T.users.username}</th><th>${T.users.full_name}</th><th>${T.users.role}</th><th>${T.users.job_title}</th><th>${T.common.status}</th><th></th></tr></thead>
<tbody>${users.map((u) => html`<tr class="${u.active ? '' : 'inactive'}"><td>${u.username}${u.must_change_password ? html` <span class="tag warn">${T.users.must_change}</span>` : ''}</td><td>${u.full_name}</td><td>${T.roles[u.role]}</td><td>${u.job_title || ''}</td>
<td>${u.active ? T.common.active : T.common.inactive}</td><td><a class="btn small" href="/admin/utilizatori/${u.id}">${T.common.edit}</a></td></tr>`)}</tbody></table></div>`,
  });
}

const roleOptions = () => [['personal', T.roles.personal], ['inginer', T.roles.inginer], ['administrator', T.roles.administrator]];

function userForm(ctx, d) {
  const { user, values, errors, self } = d;
  const v = values || user || { role: 'personal', active: 1 };
  return layout(ctx, {
    title: user ? f(T.users.edit, { name: user.username }) : T.users.new, active: 'users',
    body: html`<p><a href="/admin/utilizatori">« ${T.users.title}</a></p><h1>${user ? f(T.users.edit, { name: user.username }) : T.users.new}</h1>
<form method="post" action="${user ? `/admin/utilizatori/${user.id}` : '/admin/utilizatori/nou'}" class="card narrow">${csrf(ctx)}
  ${user ? '' : textField({ label: T.users.username, name: 'username', value: v.username, errors, required: true, hint: T.users.username_hint, attrs: 'autocapitalize="off" maxlength="40"' })}
  ${textField({ label: T.users.full_name, name: 'full_name', value: v.full_name, errors, required: true, attrs: 'maxlength="120"' })}
  ${selectField({ label: T.users.role, name: 'role', value: v.role, options: roleOptions(), errors, required: true })}
  ${textField({ label: T.users.job_title, name: 'job_title', value: v.job_title, errors, hint: T.users.job_title_hint, attrs: 'maxlength="80"' })}
  ${user ? checkField({ label: T.users.active_label, name: 'active', checked: !!(values ? values.active : user.active) }) : ''}
  ${self && user ? html`<p class="muted">${T.users.self_note}</p>` : ''}
  <button class="btn primary" type="submit">${T.common.save}</button>
</form>
${user ? html`<form method="post" action="/admin/utilizatori/${user.id}/parola" class="card narrow" data-confirm="${T.users.reset_confirm}">${csrf(ctx)}
  <h2>${T.users.reset_title}</h2><p class="muted">${T.users.reset_hint}</p><button class="btn" type="submit">${T.users.reset}</button></form>` : ''}`,
  });
}

function passwordShown(ctx, d) {
  return layout(ctx, {
    title: T.users.one_time_title, active: 'users',
    body: html`<section class="card narrow"><h1>${T.users.one_time_title}</h1>
<p>${f(T.users.one_time_for, { name: d.user.full_name, username: d.user.username })}</p>
<p class="secret"><code>${d.password}</code></p><p class="muted">${T.users.one_time_hint}</p>
<p><a class="btn" href="/admin/utilizatori">${T.users.title}</a></p></section>`,
  });
}

function settingsPage(ctx, d) {
  const { values, errors, backups, backupDir, backupError } = d;
  return layout(ctx, {
    title: T.settings.title, active: 'settings',
    body: html`<h1>${T.settings.title}</h1>
<form method="post" action="/admin/setari" class="card">${csrf(ctx)}
  <h2>${T.settings.server}</h2>
  <p class="notice">${T.settings.restart_notice}</p>
  <div class="row">
    ${textField({ label: T.settings.port, name: 'server.port', value: values['server.port'], errors, inputmode: 'numeric', cls: 'num', required: true })}
    ${textField({ label: T.settings.bind, name: 'server.bind', value: values['server.bind'], errors, hint: T.settings.bind_hint, required: true })}
    ${textField({ label: T.settings.public_name, name: 'server.public_name', value: values['server.public_name'], errors, hint: T.settings.public_name_hint })}
  </div>
  <h2>${T.settings.sessions}</h2>
  <div class="row">${textField({ label: T.settings.idle_hours, name: 'session.idle_hours', value: values['session.idle_hours'], errors, inputmode: 'numeric', cls: 'num', required: true })}</div>
  <h2>${T.settings.shifts}</h2>
  <div class="row">
    ${textField({ label: T.settings.day_start, name: 'shift.day_start', value: values['shift.day_start'], errors, cls: 'num', required: true, hint: 'HH:MM' })}
    ${textField({ label: T.settings.night_start, name: 'shift.night_start', value: values['shift.night_start'], errors, cls: 'num', required: true, hint: 'HH:MM' })}
  </div>
  <h2>${T.settings.modules}</h2>
  <p class="muted">${T.settings.modules_hint}</p>
  ${checkField({ label: T.settings.mod_cable, name: 'modules.cable', checked: !!values['modules.cable'] })}
  ${checkField({ label: T.settings.mod_analytics, name: 'modules.analytics', checked: !!values['modules.analytics'] })}
  <p class="muted">${T.settings.cycle_hint}</p>
  <div class="row">
    ${['day', 'off1', 'night', 'off2'].map((k) => textField({ label: T.settings['cycle_' + k], name: 'cycle.' + k, value: values['cycle.' + k], errors, inputmode: 'numeric', cls: 'num', required: true }))}
  </div>
  <h2>${T.settings.feedback}</h2>
  <div class="row">${textField({ label: T.settings.feedback_email, name: 'feedback.email', value: values['feedback.email'], errors, hint: T.settings.feedback_hint, cls: 'grow' })}</div>
  <h2>${T.settings.backup}</h2>
  <div class="row">
    ${textField({ label: T.settings.backup_dir, name: 'backup.dir', value: values['backup.dir'], errors, hint: T.settings.backup_dir_hint, cls: 'grow' })}
    ${textField({ label: T.settings.backup_time, name: 'backup.time', value: values['backup.time'], errors, cls: 'num', required: true, hint: 'HH:MM' })}
    ${textField({ label: T.settings.backup_keep, name: 'backup.keep', value: values['backup.keep'], errors, inputmode: 'numeric', cls: 'num', required: true })}
  </div>
  ${checkField({ label: T.settings.backup_auto, name: 'backup.auto', checked: !!values['backup.auto'] })}
  <div class="actions"><button class="btn primary" type="submit">${T.common.save}</button></div>
</form>
<section class="card"><h2>${T.settings.production}</h2>
  ${values.production_started_at ? html`<p>${f(T.settings.production_started, { when: displayDateTime(values.production_started_at) })}</p>` : html`<p class="muted">${T.settings.production_hint}</p><a class="btn" href="/admin/productie">${T.settings.production_go}</a>`}
</section>
<section class="card"><h2>${T.settings.backups}</h2>
  <p class="muted">${f(T.settings.backup_folder, { dir: backupDir })}</p>
  ${backupError ? html`<div class="flash flash-err" role="alert">${T.settings.backup_failed}: ${backupError}</div>` : ''}
  <form method="post" action="/admin/setari/backup" class="inline">${csrf(ctx)}<button class="btn primary" type="submit">${T.settings.backup_now}</button></form>
  <div class="scroll"><table class="grid"><thead><tr><th>${T.settings.file}</th><th>${T.settings.size}</th><th>${T.common.date}</th><th></th></tr></thead>
  <tbody>${backups.length ? backups.map((b) => html`<tr><td><code>${b.name}</code></td><td>${calc.dec((b.size / 1024 / 1024).toFixed(2))} MB</td><td>${displayDateTime(b.mtime.toISOString().slice(0, 19))}</td>
    <td><a class="btn small" href="/admin/setari/restaurare?f=${encodeURIComponent(b.name)}">${T.settings.restore}</a></td></tr>`) : html`<tr><td colspan="4" class="empty">${T.settings.no_backups}</td></tr>`}</tbody></table></div>
</section>`,
  });
}

function golivePage(ctx, d) {
  const c = d.st.counts;
  return layout(ctx, {
    title: T.settings.production, active: 'settings',
    body: html`<section class="card narrow"><h1>${T.settings.production}</h1>
<p class="flash flash-err">${T.settings.production_warning}</p>
<ul><li>${f(T.settings.production_measurements, { n: c.measurements })}</li><li>${f(T.settings.production_batches, { b: c.batches, c: c.certificates })}</li></ul>
<p class="muted">${T.settings.production_keeps}</p>
<form method="post" action="/admin/productie" autocomplete="off">${csrf(ctx)}
  ${textField({ label: f(T.settings.production_type, { word: d.word }), name: 'confirm', value: '', errors: d.errors, required: true, autofocus: true })}
  <button class="btn primary" type="submit">${T.settings.production_do}</button> <a class="btn" href="/admin/setari">${T.common.cancel}</a></form></section>`,
  });
}

function restorePage(ctx, d) {
  return layout(ctx, {
    title: T.settings.restore_title, active: 'settings',
    body: html`<section class="card narrow"><h1>${T.settings.restore_title}</h1>
<p class="flash flash-err">${T.settings.restore_warning}</p>
<p>${T.settings.restore_file}: <code>${d.name}</code></p>
<form method="post" action="/admin/setari/restaurare" autocomplete="off">${csrf(ctx)}
  <input type="hidden" name="file" value="${d.name}">
  ${textField({ label: T.settings.restore_type, name: 'confirm_name', value: '', errors: d.errors, required: true, hint: T.settings.restore_type_hint, autofocus: true })}
  <button class="btn primary" type="submit">${T.settings.restore_do}</button> <a class="btn" href="/admin/setari">${T.common.cancel}</a></form></section>`,
  });
}

function auditPage(ctx, d) {
  const { rows, page: pg, pages, total, filters, users, actions } = d;
  const qs = {};
  for (const [k, v] of Object.entries(filters)) if (v) qs[k] = v;
  return layout(ctx, {
    title: T.audit.title, active: 'audit', wide: true,
    body: html`<h1>${T.audit.title}</h1>
<form method="get" action="/admin/jurnal" class="card filters"><div class="row">
  ${selectField({ label: T.common.user, name: 'user_id', value: filters.user_id, options: users.map((u) => [u.id, u.username]), blank: T.common.all })}
  ${selectField({ label: T.audit.action, name: 'action', value: filters.action, options: actions.map((a) => [a, S.audit.actions[a] || a]), blank: T.common.all })}
  ${textField({ label: T.common.from, name: 'from', value: filters.from, type: 'date' })}
  ${textField({ label: T.common.to, name: 'to', value: filters.to, type: 'date' })}
  <button class="btn primary" type="submit">${T.common.filter}</button> <a class="btn" href="/admin/jurnal">${T.common.reset}</a></div></form>
<p class="muted">${f(T.register.count, { total })}</p>
<div class="scroll"><table class="grid"><thead><tr><th>${T.common.date}</th><th>${T.common.user}</th><th>${T.audit.action}</th><th>${T.audit.entity}</th><th>${T.audit.details}</th></tr></thead>
<tbody>${rows.map((r) => html`<tr><td class="nowrap">${displayDateTime(r.ts)}</td><td>${r.username || ''}</td><td>${S.audit.actions[r.action] || r.action}</td><td>${r.entity ? `${r.entity}${r.entity_id ? ' #' + r.entity_id : ''}` : ''}</td><td class="details"><code>${r.details || ''}</code></td></tr>`)}</tbody></table></div>
${pager('/admin/jurnal', pg, pages, qs)}`,
  });
}

module.exports = { usersPage, userForm, passwordShown, settingsPage, restorePage, golivePage, auditPage };
