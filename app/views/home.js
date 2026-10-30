'use strict';
const { html } = require('../lib/html');
const { T, f } = require('../i18n');
const tests = require('../domain/tests');
const { layout, valueCell } = require('./layout');
const { textOf: noteText } = require('./notifications');
const { displayDateTime, displayDate } = require('../lib/time');

function quickRow(r) {
  const m = r.resultMap;
  if (r.family_code === 'CABLE_LV') {
    const out = r.results.filter((x) => ['sub', 'peste', 'neconform'].includes(x.verdict)).length;
    return html`<tr><td><a href="/masuratori/${r.record_no}">${r.record_no}</a></td><td>${displayDateTime(r.created_at).slice(-5)}</td><td>${T.shift[r.shift]}</td><td>${r.construction_label} <span class="tag">${r.material_code}</span>${r.batch_no ? html` <a class="tag ok" href="/loturi/${r.batch_id}">${r.batch_no}</a>` : ''}</td><td>${r.machine_name}</td><td colspan="4"><span class="val ${out ? 'v-neconform' : 'v-ok'}">${f(T.cable.summary, { n: r.results.length, out })}</span></td></tr>`;
  }
  const dia = m.h || m.l ? html`${valueCell(m.h, 'h')} × ${valueCell(m.l, 'l')}` : html`${valueCell(m.d1, 'd1')} · ${valueCell(m.d2, 'd2')}`;
  return html`<tr><td><a href="/masuratori/${r.record_no}">${r.record_no}</a></td><td>${displayDateTime(r.created_at).slice(-5)}</td><td>${T.shift[r.shift]}</td>
    <td>${r.construction_label} <span class="tag">${r.material_code}</span>${r.family_code === 'FLEXIBIL_CL5' ? html` <span class="tag ok">${T.level[r.level]}</span>` : ''}</td><td>${r.machine_name}</td><td class="nowrap">${dia}</td><td>${valueCell(m.mass_gm, 'mass_gm')}</td>
    <td>${valueCell(m.r20_echiv || m.r20, 'r20')}</td><td>${valueCell(m.r20_theor, 'r20_theor')}</td></tr>`;
}

const head = () => html`<thead><tr><th>${T.register.no}</th><th>${T.common.time}</th><th>${T.register.shift}</th><th>${T.register.product}</th><th>${T.measure.machine}</th>
  <th>${T.register.diameter}</th><th>${T.quantity.mass_gm}</th><th>${T.quantity.r20}</th><th>${T.quantity.r20_theor}</th></tr></thead>`;

function outRows(r) {
  const bad = r.results.filter((x) => x.verdict === 'sub' || x.verdict === 'peste' || x.verdict === 'neconform');
  return html`<tr><td><a href="/masuratori/${r.record_no}">${r.record_no}</a></td><td>${displayDateTime(r.created_at)}</td><td>${r.construction_label} <span class="tag">${r.material_code}</span></td><td>${r.machine_name}</td>
    <td>${bad.map((x) => html`<span class="out-item">${tests.label(x.quantity)}: ${valueCell(x, x.quantity)} <span class="muted">(${T.verdict[x.verdict]})</span></span> `)}</td></tr>`;
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? T.home.greet_morning : h < 18 ? T.home.greet_afternoon : T.home.greet_evening; };

/** What waits for this user, most urgent first; each line has one place to go. */
function attentionItems(ctx, d) {
  const items = [];
  if (d.meetings && d.meetings.some((m) => m.isToday)) items.push({ text: f(T.home.att_meetings, { n: d.meetings.filter((m) => m.isToday).length }), href: '/sedinte', tone: 'info', icon: '👥' });
  if (d.ncr && d.ncr.reported) items.push({ text: f(T.home.att_ncr, { n: d.ncr.reported }), href: '/calitate?status=reported', tone: 'bad', icon: '🧾' });
  if (d.out.length) items.push({ text: f(T.home.att_out, { n: d.out.length }), href: '#out', tone: 'bad', icon: '⚠️' });
  if (d.spc.length) items.push({ text: f(T.home.att_spc, { n: d.spc.length }), href: '#spc', tone: 'warn', icon: '📈' });
  const overdue = d.teams.filter((t) => t.counts.overdue);
  for (const t of overdue) items.push({ text: `${T.modules[t.team].name}: ${f(T.home.att_overdue, { n: t.counts.overdue })}`, href: `${t.path}?overdue=1`, tone: 'bad', icon: '⏰' });
  if (d.mine.length) items.push({ text: f(T.home.att_mine, { n: d.mine.length }), href: `${d.teams.find((t) => t.team === d.mine[0].team).path}?mine=1`, tone: 'info', icon: '✅' });
  if (d.unread) items.push({ text: f(T.home.att_unread, { n: d.unread }), href: '/notificari', tone: 'info', icon: '🔔' });
  if (d.setup.length) items.push({ text: f(T.home.att_setup, { n: d.setup.filter((x) => !x.done).length }), href: '#setup', tone: 'warn', icon: '🧰' });
  return items;
}

function homePage(ctx, d) {
  const cur = d.today.current;
  const att = attentionItems(ctx, d);
  const open = d.teams.reduce((n, t) => n + t.counts.active, 0), overdue = d.teams.reduce((n, t) => n + t.counts.overdue, 0);
  const firstTeam = d.teams[0];
  const create = d.teams.filter((t) => t.create).slice(0, 3);
  return layout(ctx, {
    title: T.home.title, active: 'home', wide: true,
    body: html`<section class="card greet"><div><h1>${greeting()}, ${ctx.user.full_name}</h1>
    <p class="muted">${f(T.home.current_shift, { shift: T.shift[cur.shift], crew: cur.crew ? cur.crew.name : T.common.none })}</p></div>
  <a class="btn primary big" href="/masuratori/nou">${T.home.new_measurement}</a></section>

<section class="card attention${att.length ? '' : ' clear'}" aria-live="polite"><div class="panel-head"><p class="eyebrow">${att.length ? html`<span class="live-dot" aria-hidden="true"></span>` : ''}${T.home.attention}</p>${att.length ? html`<span class="count-pill">${f(T.home.items_n, { n: att.length })}</span>` : ''}</div>
  ${att.length ? html`<ul class="queue">${att.map((a) => html`<li class="sev-${a.tone || 'info'}"><a href="${a.href}"><span class="q-ico" aria-hidden="true">${a.icon}</span><span class="q-text">${a.text}</span><span class="q-go" aria-hidden="true">›</span></a></li>`)}</ul>` : html`<p>${T.home.attention_none}</p>`}</section>

<section class="card"><p class="eyebrow">${T.home.quick}</p><div class="quick-actions">
  <a class="qa primary" href="/masuratori/nou"><span class="ico" aria-hidden="true">＋</span>${T.nav.new_measurement}</a>
  <a class="qa" href="/masuratori"><span class="ico" aria-hidden="true">☰</span>${T.nav.register}</a>
  <a class="qa" href="/fise"><span class="ico" aria-hidden="true">📄</span>${T.nav.specs}</a>
  ${ctx.modules.cable ? html`<a class="qa" href="/loturi"><span class="ico" aria-hidden="true">📦</span>${T.nav.batches}</a>` : ''}
  ${ctx.modules.analytics ? html`<a class="qa" href="/analize"><span class="ico" aria-hidden="true">📈</span>${T.nav.analyses}</a>` : ''}
  ${d.canReportNcr ? html`<a class="qa" href="/calitate/nou"><span class="ico" aria-hidden="true">🧾</span>${T.ncr.new}</a>` : ''}
  ${d.canMeet ? html`<a class="qa" href="/sedinte/nou"><span class="ico" aria-hidden="true">👥</span>${T.meetings.new}</a>` : ''}
  ${create.map((t) => html`<a class="qa" href="${t.path}/nou"><span class="ico" aria-hidden="true">🛠</span>${T.home.new_task} · ${T.modules[t.team].name}</a>`)}</div></section>

<div class="stats">
  <a class="stat" href="#today"><strong>${d.today.rows.length}</strong><span>${T.home.tile_today}</span></a>
  <a class="stat ${d.out.length ? 'bad' : 'good'}" href="#out"><strong>${d.out.length}</strong><span>${T.home.tile_out}</span></a>
  <a class="stat" href="/fise"><strong>${d.sheets}</strong><span>${T.home.tile_sheets}</span></a>
  ${firstTeam ? html`<a class="stat ${overdue ? 'warn' : ''}" href="${firstTeam.path}"><strong>${open}</strong><span>${T.home.tile_tasks}${overdue ? ` · ${overdue} ${T.home.tile_overdue}` : ''}</span></a>` : ''}
</div>

<div class="home-grid"><div>
${d.setup.length ? html`<section class="card setup" id="setup"><h2>${T.home.setup_title}</h2><p class="muted">${T.home.setup_hint}</p>
  <ul class="checklist-steps">${d.setup.map((s) => html`<li class="${s.done ? 'done' : 'todo'}"><span class="mark" aria-hidden="true">${s.done ? '✓' : '○'}</span> <span>${T.home['setup_' + s.key]}${s.total !== undefined ? ` (${f(T.home.setup_sheets_n, { n: s.n, total: s.total })})` : (s.n !== undefined ? ` (${f(T.home.setup_now, { n: s.n })})` : '')}</span> ${s.done ? '' : html`<a class="btn small" href="${s.href}">${T.common.open}</a>`}</li>`)}</ul></section>` : ''}
<section class="card" id="today"><h2>${T.home.today}</h2>
  <div class="scroll"><table class="grid">${head()}<tbody>${d.today.rows.length ? d.today.rows.map(quickRow) : html`<tr><td colspan="9" class="empty">${T.home.today_empty} <a href="/masuratori/nou">${T.home.start_first}</a></td></tr>`}</tbody></table></div>
</section>
${d.spc.length ? html`<section class="card" id="spc"><h2>${T.home.spc}</h2><p class="muted">${T.home.spc_hint}</p><div class="scroll"><table class="grid"><thead><tr><th>${T.register.product}</th><th>${T.detail.quantity}</th><th>${T.an.rule}</th><th>${T.register.no}</th><th>${T.measure.machine}</th></tr></thead><tbody>${d.spc.map((a) => html`<tr><td>${a.label} <span class="tag">${a.material}</span></td><td>${tests.label(a.quantity)}</td><td>${a.rules.map((n) => T.an.rules[n]).join('; ')}</td><td><a href="/masuratori/${a.record_no}">${a.record_no}</a> · <a href="/analize/control?product=${encodeURIComponent(a.stable_key)}&amp;quantity=${a.quantity}">${T.an.tabs.control}</a></td><td>${a.machine}</td></tr>`)}</tbody></table></div></section>` : ''}
<section class="card" id="out"><h2>${T.home.out_of_limit}</h2>
  <div class="scroll"><table class="grid"><thead><tr><th>${T.register.no}</th><th>${T.common.date}</th><th>${T.register.product}</th><th>${T.measure.machine}</th><th>${T.home.results}</th></tr></thead>
  <tbody>${d.out.length ? d.out.map(outRows) : html`<tr><td colspan="5" class="empty">${T.home.out_empty}</td></tr>`}</tbody></table></div>
</section></div>

<aside>
  ${d.meetings ? html`<section class="card"><div class="panel-head"><p class="eyebrow">${T.home.side_meetings}</p><a href="/sedinte">${T.home.see_all}</a></div>
    ${d.meetings.length ? html`<ul class="panel-list">${d.meetings.map((m) => html`<li><a href="/sedinte/${m.id}">${m.isToday ? '' : `${displayDate(m.meeting_date)} `}<strong>${m.start_time}</strong> ${m.title}</a></li>`)}</ul>` : html`<p class="muted">${T.home.no_meetings}</p>`}</section>` : ''}
  <section class="card"><p class="eyebrow">${T.home.side_shift}</p><p><strong>${T.shift[cur.shift]}</strong><br><span class="muted">${cur.crew ? cur.crew.name : T.home.crew_none}</span></p></section>
  ${d.teams.length ? html`<section class="card"><div class="panel-head"><p class="eyebrow">${T.home.side_tasks}</p>${firstTeam ? html`<a href="${firstTeam.path}?mine=1">${T.home.see_all}</a>` : ''}</div>
    ${d.mine.length ? html`<ul class="panel-list">${d.mine.map((t) => html`<li><a href="/sarcini/${t.id}">${t.no} ${t.title}</a>${t.due_date ? html`<span class="${t.overdue ? 'overdue' : 'muted'}">${displayDate(t.due_date)}</span>` : ''}</li>`)}</ul>` : html`<p class="muted">${T.home.no_tasks_mine}</p>`}</section>` : ''}
  <section class="card"><div class="panel-head"><p class="eyebrow">${T.home.side_notes}</p><a href="/notificari">${T.home.see_all}</a></div>
    ${d.notes.length ? html`<ul class="panel-list">${d.notes.map((n) => html`<li><a class="${n.read_at ? '' : 'unread-dot'}" href="/notificari/${n.id}/deschide">${noteText(n)}</a></li>`)}</ul>` : html`<p class="muted">${T.home.no_notes}</p>`}</section>
</aside></div>`,
  });
}

module.exports = { homePage };
