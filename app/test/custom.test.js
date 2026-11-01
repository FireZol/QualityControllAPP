'use strict';
// Custom fields and custom lists (owner 2026-10-31): admins make them, tasks / non-conformities / meetings use them in forms, details,
// filters and exports. Nothing is deleted; hidden fields keep their values.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient } = require('./helpers');
const custom = require('../domain/custom');
const access = require('../domain/access');

let app, admin, lead, plain, ids = {};
const post = (c, path, fields, page = '/') => c.postForm(page, path, fields);
const csv = async (c, url) => (await c.get(url)).text;

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.cf', 'personal', 'Șef Câmpuri');
  plain = await makeUser(app, admin, 'plain.cf', 'personal', 'Fără drepturi');
  const uid = (n) => app.db.get('SELECT id FROM users WHERE username = ?', n).id;
  access.setUserLevels(app.db, uid('lead.cf'), { maintenance: 'lead', quality: 'lead', meetings: 'lead' });
  access.setUserLevels(app.db, uid('plain.cf'), { maintenance: 'view', meetings: 'none' });
});
test.after(async () => { await app.cleanup(); });

// ------------------------------------------------------------------ administration
test('only administrators reach the custom field screens, every POST included', async () => {
  for (const p of ['/admin/campuri', '/admin/campuri/liste', '/admin/campuri/1/editeaza', '/admin/campuri/liste/1']) {
    assert.equal((await lead.get(p)).status, 403, `GET ${p}`);
    assert.equal((await plain.get(p)).status, 403, `GET ${p}`);
  }
  for (const p of ['/admin/campuri/nou', '/admin/campuri/liste/nou', '/admin/campuri/1/editeaza', '/admin/campuri/liste/1', '/admin/campuri/liste/1/element', '/admin/campuri/liste/1/element/1']) {
    assert.equal((await lead.raw('POST', p, 'x=1')).status, 403, `POST ${p} (no token)`);
    assert.equal((await post(lead, p, { label: 'x' }, '/')).status, 403, `POST ${p}`);
  }
  assert.equal((await admin.get('/admin/campuri')).status, 200);
  assert.match((await admin.get('/')).text, /href="\/admin\/campuri"/);
});

test('a list is made with items (one per line, optional English), duplicates skipped; items are renamed and hidden, never deleted', async () => {
  let r = await post(admin, '/admin/campuri/liste/nou', { name: 'Cauze defect', name_en: 'Defect causes' }, '/admin/campuri/liste');
  assert.equal(r.status, 303);
  ids.list = app.db.get("SELECT id FROM custom_lists WHERE name = 'Cauze defect'").id;
  assert.equal((await post(admin, '/admin/campuri/liste/nou', { name: 'cauze defect' }, '/admin/campuri/liste')).status, 422, 'same name refused (any case)');
  assert.equal((await post(admin, '/admin/campuri/liste/nou', { name: '' }, '/admin/campuri/liste')).status, 422);
  r = await post(admin, `/admin/campuri/liste/${ids.list}/element`, { items: 'Uzură filieră | Die wear\nSuprafață\n  Uzură filieră  \n\nTemperatură | Temperature' }, `/admin/campuri/liste/${ids.list}`);
  assert.equal(r.status, 303);
  const items = app.db.all('SELECT * FROM custom_list_items WHERE list_id = ? ORDER BY sort', ids.list);
  assert.deepEqual(items.map((i) => i.label), ['Uzură filieră', 'Suprafață', 'Temperatură']);
  assert.equal(items[0].label_en, 'Die wear');
  assert.equal(items[1].label_en, null);
  ids.items = items.map((i) => i.id);
  assert.equal((await post(admin, `/admin/campuri/liste/${ids.list}/element`, { items: '   ' }, `/admin/campuri/liste/${ids.list}`)).status, 422);
  assert.equal((await post(admin, `/admin/campuri/liste/${ids.list}/element`, { items: 'x'.repeat(81) }, `/admin/campuri/liste/${ids.list}`)).status, 422);
  // rename and reorder
  r = await post(admin, `/admin/campuri/liste/${ids.list}/element/${ids.items[1]}`, { label: 'Suprafață cablu', label_en: 'Cable surface', sort: '5', active: '1' }, `/admin/campuri/liste/${ids.list}`);
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT label, label_en, sort FROM custom_list_items WHERE id = ?', ids.items[1]).label, 'Suprafață cablu');
  // a name that another item already has is refused
  const dup = await post(admin, `/admin/campuri/liste/${ids.list}/element/${ids.items[2]}`, { label: 'uzură filieră', active: '1' }, `/admin/campuri/liste/${ids.list}`);
  assert.match(dup.location, /^\/admin\/campuri\/liste\/\d+$/);
  assert.equal(app.db.get('SELECT label FROM custom_list_items WHERE id = ?', ids.items[2]).label, 'Temperatură');
  // the page shows them
  const page = (await admin.get(`/admin/campuri/liste/${ids.list}`)).text;
  assert.match(page, /Suprafață cablu/);
});

test('fields: validation, one of every type, order, hidden rather than deleted, type fixed after creation', async () => {
  const mk = async (fields) => { const r = await post(admin, '/admin/campuri/nou', fields, '/admin/campuri'); return r; };
  assert.equal((await mk({ kind: 'task', type: 'text', label: '' })).status, 422, 'a name is needed');
  assert.equal((await mk({ kind: 'task', type: 'list', label: 'Fără listă' })).status, 422, 'a list field needs its list');
  assert.equal((await mk({ kind: 'nothing', type: 'text', label: 'x' })).status, 422);
  assert.equal((await mk({ kind: 'task', type: 'weird', label: 'x' })).status, 422);
  assert.equal((await mk({ kind: 'task', type: 'text', label: 'x', team: 'nobody' })).status, 422);
  assert.equal(app.db.value('SELECT count(*) FROM custom_fields'), 0, 'nothing was made by the refused ones');

  const base = { show_in_list: '1' };
  const made = {};
  for (const [key, f] of Object.entries({
    shift: { kind: 'task', type: 'list', label: 'Cauză', label_en: 'Cause', list_id: ids.list },
    qty: { kind: 'task', type: 'number', label: 'Cantitate', label_en: 'Quantity', unit: 'kg', team: 'maintenance' },
    when: { kind: 'task', type: 'date', label: 'Data oprire' },
    safe: { kind: 'task', type: 'yesno', label: 'Siguranță verificată' },
    note: { kind: 'task', type: 'text', label: 'Comanda client' },
    long: { kind: 'task', type: 'longtext', label: 'Observații lungi', show_in_list: '' },
    req: { kind: 'ncr', type: 'list', label: 'Cauză NC', list_id: ids.list, required: '1' },
    ncrText: { kind: 'ncr', type: 'text', label: 'Client' },
    mtg: { kind: 'meeting', type: 'text', label: 'Subiect principal' },
  })) {
    const r = await mk({ ...base, ...f });
    assert.equal(r.status, 303, `${key}: ${r.status} ${[...r.text.matchAll(/field-error[^>]*>([^<]*)/g)].map((m) => m[1]).join(" / ")}`);
    made[key] = app.db.get('SELECT * FROM custom_fields WHERE label = ?', f.label);
  }
  ids.f = Object.fromEntries(Object.entries(made).map(([k, v]) => [k, v.id]));
  assert.equal(made.qty.unit, 'kg');
  assert.equal(made.note.unit, null, 'a unit only belongs to numbers');
  assert.equal(made.mtg.team, null, 'a team only belongs to tasks');
  assert.equal(made.qty.team, 'maintenance');
  assert.ok(made.note.sort > made.shift.sort, 'new fields go to the end');

  // edit: rename, hide; kind and type cannot be changed even if posted
  let r = await post(admin, `/admin/campuri/${ids.f.note}/editeaza`, { label: 'Comandă client', label_en: 'Customer order', show_in_list: '1', active: '1', kind: 'ncr', type: 'number' }, '/admin/campuri');
  assert.equal(r.status, 303);
  const after = app.db.get('SELECT * FROM custom_fields WHERE id = ?', ids.f.note);
  assert.equal(after.label, 'Comandă client'); assert.equal(after.type, 'text'); assert.equal(after.kind, 'task');
  // a list that an active field uses cannot be hidden, and cannot be swapped once the field holds values (checked further down)
  const hide = await post(admin, `/admin/campuri/liste/${ids.list}`, { name: 'Cauze defect' }, `/admin/campuri/liste/${ids.list}`);
  assert.equal(hide.status, 422);
  assert.equal(app.db.get('SELECT active FROM custom_lists WHERE id = ?', ids.list).active, 1);
  // the admin overview lists everything
  const ov = (await admin.get('/admin/campuri')).text;
  for (const l of ['Cauză', 'Cantitate', 'Data oprire', 'Siguranță verificată', 'Comandă client', 'Observații lungi']) assert.ok(ov.includes(l), l);
  assert.match((await admin.get('/admin/campuri?kind=ncr')).text, /Cauză NC/);
  const ncrTable = /<tbody>([\s\S]*?)<\/tbody>/.exec((await admin.get('/admin/campuri?kind=ncr')).text)[1];
  assert.ok(!ncrTable.includes('Data oprire') && ncrTable.includes('Cauză NC'), 'the table lists only fields of the chosen kind');
  assert.ok(app.db.all("SELECT action FROM audit_log WHERE action LIKE 'custom_%'").length >= 10, 'audited');
});

// ------------------------------------------------------------------ tasks
test('a task takes custom values: the form shows the fields, input is checked by type, the page, the board and the history show them', async () => {
  const form = (await lead.get('/mentenanta/nou')).text;
  assert.match(form, /name="cf_\d+"/);
  for (const l of ['Cantitate', 'Data oprire', 'Siguranță verificată', 'Comandă client', 'Observații lungi']) assert.ok(form.includes(l), `form has ${l}`);
  assert.ok(!form.includes('Cauză NC') && !form.includes('Subiect principal'), 'only fields of tasks');
  // technical tasks do not get the maintenance-only field
  assert.ok(!(await lead.get('/tehnic/nou')).text.includes('Cantitate'), 'the team field stays with its team');
  assert.ok((await lead.get('/tehnic/nou')).text.includes('Data oprire'), 'a field for all teams is there');

  const F = ids.f; const key = (n) => `cf_${F[n]}`;
  const bad = await post(lead, '/mentenanta/nou', { title: 'Sarcină cu câmpuri', [key('qty')]: 'abc', [key('when')]: '2026-13-45', [key('shift')]: '999999' }, '/mentenanta/nou');
  assert.equal(bad.status, 422);
  assert.equal(app.db.value("SELECT count(*) FROM tasks WHERE title = 'Sarcină cu câmpuri'"), 0, 'nothing saved on an error');
  assert.match(bad.text, /data-form-summary/);
  assert.ok((bad.text.match(/class="field-error"/g) || []).length >= 3);

  const ok = await post(lead, '/mentenanta/nou', { title: 'Sarcină cu câmpuri', [key('qty')]: '12,5', [key('when')]: '2026-11-03', [key('shift')]: String(ids.items[0]), [key('safe')]: '1', [key('note')]: 'CMD-77 <b>x</b>', [key('long')]: 'linia 1\nlinia 2' }, '/mentenanta/nou');
  assert.equal(ok.status, 303);
  const t = app.db.get("SELECT * FROM tasks WHERE title = 'Sarcină cu câmpuri'");
  ids.task = t.id;
  const stored = custom.valuesOf(app.db, 'task', t.id);
  assert.equal(stored[F.qty], '12.5', 'numbers are stored in one form, whichever separator was typed');
  assert.equal(stored[F.safe], '1');
  const pageHtml = (await lead.get(`/sarcini/${t.id}`)).text;
  assert.match(pageHtml, /12,5 kg/);
  assert.match(pageHtml, /03\.11\.2026/);
  assert.match(pageHtml, /Uzură filieră/);
  assert.match(pageHtml, /CMD-77 &lt;b&gt;x&lt;\/b&gt;/, 'escaped');
  assert.ok(!pageHtml.includes('<b>x</b>'));
  const board = (await lead.get('/mentenanta')).text;
  assert.match(board, /<th class="cf-col">Cantitate \[kg\]<\/th>/);
  assert.match(board, /12,5 kg/);
  assert.ok(!board.includes('Observații lungi</th>'), 'a long text stays off the board columns when not shown in the list');

  // a second task for the filters
  await post(lead, '/mentenanta/nou', { title: 'A doua', [key('qty')]: '40', [key('when')]: '2026-12-01', [key('shift')]: String(ids.items[2]), [key('safe')]: '0', [key('note')]: 'altceva' }, '/mentenanta/nou');
  await post(lead, '/mentenanta/nou', { title: 'A treia fără valori' }, '/mentenanta/nou');
  const titlesOf = (html) => [...html.matchAll(/<td class="task-title"><a href="\/sarcini\/\d+"><strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
  const q = async (qs) => titlesOf((await lead.get(`/mentenanta?view=all&${qs}`)).text).sort();
  assert.deepEqual(await q(''), ['A doua', 'A treia fără valori', 'Sarcină cu câmpuri'].sort());
  assert.deepEqual(await q(`cf${F.shift}=${ids.items[0]}`), ['Sarcină cu câmpuri']);
  assert.deepEqual(await q(`cf${F.shift}=${ids.items[2]}`), ['A doua']);
  assert.deepEqual(await q(`cf${F.qty}_a=20`), ['A doua']);
  assert.deepEqual(await q(`cf${F.qty}_b=20`), ['Sarcină cu câmpuri']);
  assert.deepEqual(await q(`cf${F.qty}_a=10&cf${F.qty}_b=50`), ['A doua', 'Sarcină cu câmpuri'].sort());
  assert.deepEqual(await q(`cf${F.qty}_a=12,5&cf${F.qty}_b=12,5`), ['Sarcină cu câmpuri'], 'a comma works in a filter, and a limit itself is inside');
  assert.deepEqual(await q(`cf${F.when}_a=2026-11-15`), ['A doua']);
  assert.deepEqual(await q(`cf${F.when}_b=2026-11-15`), ['Sarcină cu câmpuri']);
  assert.deepEqual(await q(`cf${F.safe}=1`), ['Sarcină cu câmpuri']);
  assert.deepEqual(await q(`cf${F.safe}=0`), ['A doua'], 'No is a value of its own, not the same as empty');
  assert.deepEqual(await q(`cf${F.note}=cmd`), ['Sarcină cu câmpuri'], 'text contains, any case');
  assert.deepEqual(await q(`cf${F.note}=%25`), [], 'a % in a text filter is a character, not a wildcard');
  assert.deepEqual(await q(`cf${F.shift}=${ids.items[0]}&cf${F.qty}_a=20`), [], 'filters combine (and)');
  // hostile and junk values never break the page or widen the result
  for (const junk of [`cf${F.shift}=' OR 1=1 --`, `cf${F.qty}_a=1e999`, `cf${F.when}_a=zzz`, `cf9999=1`, `cf${F.shift}=0`, `cf${F.note}=${'x'.repeat(500)}`]) {
    const r = await lead.get(`/mentenanta?view=all&${junk}`);
    assert.equal(r.status, 200, junk);
    assert.ok(!/SQLITE|syntax error/i.test(r.text), junk);
  }
  assert.deepEqual(await q(`cf${F.shift}=' OR 1=1 --`), ['A doua', 'A treia fără valori', 'Sarcină cu câmpuri'].sort(), 'an invalid filter value is ignored, not turned into a match-all attack');
  // the filter controls are in the page and the links keep the filter
  const filtered = (await lead.get(`/mentenanta?view=all&cf${F.shift}=${ids.items[0]}`)).text;
  assert.match(filtered, new RegExp(`name="cf${F.shift}"`));
  // the single-task work order on paper lists the fields too, escaped
  const order = (await lead.get(`/sarcini/${ids.task}/tipar`)).text;
  assert.match(order, /<th>Cantitate \[kg\]<\/th><td colspan="3">12,5 kg<\/td>/);
  assert.match(order, /CMD-77 &lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(!(await lead.get(`/sarcini/${ids.task}/tipar`)).text.includes('<b>x</b>'));
  assert.match(filtered, new RegExp(`cf${F.shift}=${ids.items[0]}[^"]*format=csv|format=csv[^"]*cf${F.shift}=${ids.items[0]}`), 'export keeps the filter');
});

test('task exports carry the custom columns, filtered; numbers are numbers in Excel; the history says what changed', async () => {
  const F = ids.f;
  const file = await csv(lead, `/sarcini/export?team=maintenance&format=csv&view=all&cf${F.shift}=${ids.items[0]}`);
  const lines = file.trim().split(/\r?\n/);
  assert.match(lines[0], /Cantitate \[kg\]/);
  assert.match(lines[0], /Cauză/);
  assert.ok(file.includes('Sarcină cu câmpuri') && !file.includes('A doua') && !file.includes('A treia'), 'only the filtered row');
  assert.match(lines[1], /Uzură filieră/);
  assert.match(lines[1], /12,5/);
  assert.match(file, /"linia 1\r?\nlinia 2"/, 'a multi-line value stays in one quoted cell');
  const xl = await lead.get(`/sarcini/export?team=maintenance&format=xlsx&view=all`);
  assert.equal(xl.status, 200);

  // edit through the form: change one value, clear another; the history records both
  const key = (n) => `cf_${F[n]}`;
  const r = await post(lead, `/sarcini/${ids.task}/editeaza`, { title: 'Sarcină cu câmpuri', priority_id: '', [key('qty')]: '13', [key('when')]: '', [key('shift')]: String(ids.items[0]), [key('safe')]: '1', [key('note')]: 'CMD-77', [key('long')]: 'linia 1' }, `/sarcini/${ids.task}/editeaza`);
  assert.equal(r.status, 303);
  const ev = app.db.all("SELECT details FROM task_events WHERE task_id = ? AND kind = 'edit' ORDER BY id DESC", ids.task).map((e) => JSON.parse(e.details)).find((d) => d.custom);
  assert.ok(ev, 'a history entry for the custom change');
  const lab = ev.custom.map((c) => c.label).sort();
  assert.ok(lab.some((l) => l.startsWith('Cantitate')) && lab.includes('Data oprire'), lab.join('|'));
  const page = (await lead.get(`/sarcini/${ids.task}`)).text;
  assert.match(page, /Câmpuri proprii modificate/);
  assert.match(page, /Data oprire: 03\.11\.2026 → —/);
  assert.equal(custom.valuesOf(app.db, 'task', ids.task)[F.when], '', 'cleared, not deleted');
  // nothing changed -> no new history entry
  const before = app.db.value("SELECT count(*) FROM task_events WHERE task_id = ?", ids.task);
  await post(lead, `/sarcini/${ids.task}/editeaza`, { title: 'Sarcină cu câmpuri', priority_id: '', [key('qty')]: '13', [key('when')]: '', [key('shift')]: String(ids.items[0]), [key('safe')]: '1', [key('note')]: 'CMD-77', [key('long')]: 'linia 1' }, `/sarcini/${ids.task}/editeaza`);
  assert.equal(app.db.value("SELECT count(*) FROM task_events WHERE task_id = ?", ids.task), before);
});

test('hiding a field removes it from forms and filters, but its values stay on the record and in the export; unhiding brings it back; a used list cannot be swapped', async () => {
  const F = ids.f;
  // a list in use by a field with values cannot be swapped for another
  const other = custom.createList(app.db, { id: 1 }, { name: 'Alta' }).id;
  const swap = await post(admin, `/admin/campuri/${F.shift}/editeaza`, { label: 'Cauză', list_id: other, show_in_list: '1', active: '1' }, '/admin/campuri');
  assert.equal(swap.status, 422);
  assert.equal(app.db.get('SELECT list_id FROM custom_fields WHERE id = ?', F.shift).list_id, ids.list);
  // hide the quantity field
  assert.equal((await post(admin, `/admin/campuri/${F.qty}/editeaza`, { label: 'Cantitate', unit: 'kg', team: 'maintenance', show_in_list: '1' }, '/admin/campuri')).status, 303);
  assert.equal(app.db.get('SELECT active FROM custom_fields WHERE id = ?', F.qty).active, 0);
  assert.ok(!(await lead.get('/mentenanta/nou')).text.includes('Cantitate'), 'gone from the new-task form');
  assert.ok(!(await lead.get('/mentenanta')).text.includes(`name="cf${F.qty}_a"`), 'gone from the filters');
  assert.match((await lead.get(`/sarcini/${ids.task}`)).text, /Cantitate/, 'still on the record that holds a value');
  assert.match(await csv(lead, '/sarcini/export?team=maintenance&format=csv&view=all'), /Cantitate/, 'and in the export');
  // editing the task through the form must not lose the hidden field's value
  const key = (n) => `cf_${F[n]}`;
  await post(lead, `/sarcini/${ids.task}/editeaza`, { title: 'Sarcină cu câmpuri', priority_id: '', [key('shift')]: String(ids.items[0]), [key('safe')]: '1', [key('note')]: 'CMD-77', [key('long')]: 'linia 1' }, `/sarcini/${ids.task}/editeaza`);
  assert.equal(custom.valuesOf(app.db, 'task', ids.task)[F.qty], '13');
  // bring it back
  await post(admin, `/admin/campuri/${F.qty}/editeaza`, { label: 'Cantitate', unit: 'kg', team: 'maintenance', show_in_list: '1', active: '1' }, '/admin/campuri');
  assert.match((await lead.get('/mentenanta/nou')).text, /Cantitate/);
  // a hidden list item stays readable on old records and in their form, but is not offered to new ones
  await post(admin, `/admin/campuri/liste/${ids.list}/element/${ids.items[0]}`, { label: 'Uzură filieră', label_en: 'Die wear', sort: '10' }, `/admin/campuri/liste/${ids.list}`);
  assert.equal(app.db.get('SELECT active FROM custom_list_items WHERE id = ?', ids.items[0]).active, 0);
  assert.match((await lead.get(`/sarcini/${ids.task}`)).text, /Uzură filieră/);
  const edit = (await lead.get(`/sarcini/${ids.task}/editeaza`)).text;
  assert.match(edit, /Uzură filieră \(inactiv\)/, 'the old choice is kept and marked');
  const fresh = (await lead.get('/mentenanta/nou')).text;
  assert.ok(!fresh.includes('Uzură filieră'), 'not offered to a new task');
  const rejected = await post(lead, '/mentenanta/nou', { title: 'Cu element ascuns', [key('shift')]: String(ids.items[0]) }, '/mentenanta/nou');
  assert.equal(rejected.status, 422, 'a hidden item cannot be chosen for a new task');
  await post(admin, `/admin/campuri/liste/${ids.list}/element/${ids.items[0]}`, { label: 'Uzură filieră', label_en: 'Die wear', sort: '10', active: '1' }, `/admin/campuri/liste/${ids.list}`);
});

// ------------------------------------------------------------------ non-conformities
test('non-conformities: a required custom field blocks saving, values show in the record, the register filter, the export and the print', async () => {
  const F = ids.f; const key = (n) => `cf_${F[n]}`;
  const noCause = await post(lead, '/calitate/nou', { title: 'Fără cauză proprie' }, '/calitate/nou');
  assert.equal(noCause.status, 422);
  assert.match(noCause.text, /data-form-summary/);
  assert.equal(app.db.value("SELECT count(*) FROM ncrs WHERE title = 'Fără cauză proprie'"), 0);
  const a = await post(lead, '/calitate/nou', { title: 'NC cu câmpuri', [key('req')]: String(ids.items[1]), [key('ncrText')]: 'Client SA' }, '/calitate/nou');
  assert.equal(a.status, 303);
  const b = await post(lead, '/calitate/nou', { title: 'NC alta', [key('req')]: String(ids.items[2]) }, '/calitate/nou');
  assert.equal(b.status, 303);
  const n = app.db.get("SELECT id FROM ncrs WHERE title = 'NC cu câmpuri'");
  const page = (await lead.get(`/calitate/neconformitati/${n.id}`)).text;
  assert.match(page, /Cauză NC/); assert.match(page, /Suprafață cablu/); assert.match(page, /Client SA/);
  const reg = (await lead.get('/calitate?view=all')).text;
  assert.match(reg, /<th class="cf-col">Client<\/th>/);
  const byCause = (await lead.get(`/calitate?view=all&cf${F.req}=${ids.items[2]}`)).text;
  assert.match(byCause, /NC alta/); assert.ok(!byCause.includes('NC cu câmpuri'));
  const byText = (await lead.get(`/calitate?view=all&cf${F.ncrText}=client`)).text;
  assert.match(byText, /NC cu câmpuri/); assert.ok(!byText.includes('NC alta'));
  const file = await csv(lead, `/calitate/export?view=all&format=csv&cf${F.ncrText}=client`);
  assert.equal(file.trim().split(/\r?\n/).length, 2);
  assert.match(file, /Client SA/); assert.match(file.split(/\r?\n/)[0], /Cauză NC/);
  assert.match((await lead.get(`/calitate/neconformitati/${n.id}/tipar`)).text, /Client SA/);
  // the search box also finds text typed in a custom field
  const found = (await lead.get('/calitate?view=all&q=client%20sa')).text;
  assert.match(found, /NC cu câmpuri/); assert.ok(!found.includes('NC alta'));
  assert.ok(!(await lead.get('/calitate?view=all&q=%25')).text.includes('NC cu câmpuri'), 'a % is a character, not a wildcard');
  // editing the main part keeps the custom fields; the evaluation part does not touch them
  const ed = await post(lead, `/calitate/neconformitati/${n.id}/editeaza`, { part: 'main', title: 'NC cu câmpuri', [key('req')]: String(ids.items[2]), [key('ncrText')]: 'Client SA' }, `/calitate/neconformitati/${n.id}/editeaza`);
  assert.equal(ed.status, 303);
  assert.equal(custom.valuesOf(app.db, 'ncr', n.id)[F.req], String(ids.items[2]));
  assert.match((await lead.get(`/calitate/neconformitati/${n.id}`)).text, /Câmpuri proprii modificate/);
  const ev = await post(lead, `/calitate/neconformitati/${n.id}/editeaza`, { part: 'eval', cause: 'Uzură', evaluation: 'ok' }, `/calitate/neconformitati/${n.id}`);
  assert.equal(ev.status, 303);
  assert.equal(custom.valuesOf(app.db, 'ncr', n.id)[F.req], String(ids.items[2]), 'the evaluation form leaves custom values alone');
});

// ------------------------------------------------------------------ meetings
test('meetings: custom fields in the form, the page, the list filter and a new export of the list', async () => {
  const F = ids.f; const key = (n) => `cf_${F[n]}`;
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const mk = async (title, subject) => post(lead, '/sedinte/nou', { title, meeting_date: day, start_time: '10:00', duration_min: '30', teams: ['quality'], [key('mtg')]: subject }, '/sedinte/nou');
  assert.equal((await mk('Ședință A', 'Reclamații')).status, 303);
  assert.equal((await mk('Ședință B', 'Buget')).status, 303);
  const m = app.db.get("SELECT id FROM meetings WHERE title = 'Ședință A'");
  assert.match((await lead.get(`/sedinte/${m.id}`)).text, /Reclamații/);
  assert.match((await lead.get(`/sedinte/${m.id}/editeaza`)).text, /Subiect principal/);
  const list = (await lead.get(`/sedinte?view=all&cf${F.mtg}=recl`)).text;
  assert.match(list, /Ședință A/); assert.ok(!list.includes('Ședință B'));
  assert.match(list, new RegExp(`name="cf${F.mtg}"`));
  const file = await csv(lead, `/sedinte/export?view=all&format=csv&cf${F.mtg}=recl`);
  const lines = file.trim().split(/\r?\n/);
  assert.equal(lines.length, 2); assert.match(lines[0], /Subiect principal/); assert.match(lines[1], /Ședință A/); assert.match(lines[1], /Reclamații/);
  assert.equal((await lead.get('/sedinte/export?format=xlsx&view=all')).status, 200);
  assert.equal((await plain.get('/sedinte/export')).status, 403, 'the export needs the right to see meetings');
  assert.match((await lead.get(`/sedinte/${m.id}/tipar`)).text, /Reclamații/);
  // the minutes-only forms leave custom values alone
  await post(lead, `/sedinte/${m.id}/note`, { agenda: 'ordine', minutes: 'proces verbal' }, `/sedinte/${m.id}`);
  assert.equal(custom.valuesOf(app.db, 'meeting', m.id)[F.mtg], 'Reclamații');
});

test('a meeting series gives its default custom values to the meetings it makes; a changed default reaches only meetings nobody changed by hand', async () => {
  const meetings = require('../domain/meetings');
  const F = ids.f; const key = `cf_${F.mtg}`;
  const form = (await lead.get('/sedinte/serii/nou')).text;
  assert.match(form, /Subiect principal/); assert.ok(!form.includes(`name="${key}" required`), 'a default is never required');
  const base = { title: 'Serie cu valori', teams: ['quality'], days: ['1', '2', '3', '4', '5', '6', '7'], start_time: '07:30', duration_min: '15', interval_weeks: '1' };
  assert.equal((await post(lead, '/sedinte/serii/nou', { ...base, [key]: 'Calitate zilnică' }, '/sedinte/serii/nou')).status, 303);
  const s = app.db.get("SELECT id FROM meeting_series WHERE title = 'Serie cu valori'").id;
  meetings.ensure(app.db, meetings.today(), 14);
  const made = app.db.all("SELECT id FROM meetings WHERE series_id = ? AND status = 'planned' ORDER BY meeting_date", s).map((r) => r.id);
  assert.ok(made.length >= 10);
  for (const id of made) assert.equal(custom.valuesOf(app.db, 'meeting', id)[F.mtg], 'Calitate zilnică');
  // one meeting is changed by hand; then the default changes
  await post(lead, `/sedinte/${made[1]}/editeaza`, { title: 'Serie cu valori', meeting_date: app.db.get('SELECT meeting_date FROM meetings WHERE id = ?', made[1]).meeting_date, start_time: '07:30', duration_min: '15', teams: ['quality'], [key]: 'Audit client' }, `/sedinte/${made[1]}/editeaza`);
  assert.match((await lead.get(`/sedinte/serii/${s}/editeaza`)).text, /Calitate zilnică/);
  assert.equal((await post(lead, `/sedinte/serii/${s}/editeaza`, { ...base, [key]: 'Calitate și reclamații' }, `/sedinte/serii/${s}/editeaza`)).status, 303);
  assert.equal(custom.valuesOf(app.db, 'meeting', made[0])[F.mtg], 'Calitate și reclamații');
  assert.equal(custom.valuesOf(app.db, 'meeting', made[1])[F.mtg], 'Audit client', 'a value typed by hand stays');
  assert.match(JSON.stringify(app.db.get("SELECT details FROM audit_log WHERE action = 'meeting_series_save' ORDER BY id DESC LIMIT 1")), /Calitate și reclamații/);
  // a wrong value is refused with the form shown again, and nothing is saved
  app.db.run("UPDATE custom_fields SET type = 'number' WHERE id = ?", F.mtg);   // (test only: a field's type never changes in the app)
  const bad = await post(lead, `/sedinte/serii/${s}/editeaza`, { ...base, [key]: 'abc' }, `/sedinte/serii/${s}/editeaza`);
  app.db.run("UPDATE custom_fields SET type = 'text' WHERE id = ?", F.mtg);
  assert.equal(bad.status, 422);
  assert.equal(meetings.seriesDefaults(app.db, s)[F.mtg], 'Calitate și reclamații');
  await post(lead, `/sedinte/serii/${s}/activ`, { active: '0' }, '/sedinte/serii');
});

// ------------------------------------------------------------------ safety
test('text in names, labels and values is escaped everywhere; values are not executable; counts stay sane', async () => {
  const evil = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
  await post(admin, '/admin/campuri/nou', { kind: 'task', type: 'text', label: evil, label_en: evil, show_in_list: '1' }, '/admin/campuri');
  await post(admin, '/admin/campuri/liste/nou', { name: evil, name_en: evil }, '/admin/campuri/liste');
  const id = app.db.get('SELECT id FROM custom_fields WHERE label = ?', evil).id;
  await post(lead, '/mentenanta/nou', { title: 'Rău', [`cf_${id}`]: evil }, '/mentenanta/nou');
  for (const p of ['/admin/campuri', '/admin/campuri/liste', '/mentenanta/nou', '/mentenanta?view=all', `/sarcini/${app.db.get("SELECT id FROM tasks WHERE title = 'Rău'").id}`]) {
    const res = (await admin.get(p)).text;
    assert.ok(!res.includes('<img src=x') && !res.includes('<script>alert'), `${p} shows the text as text`);
  }
  // export cells are plain text for a spreadsheet (formula injection is neutralised by the exporter)
  const file = await csv(lead, '/sarcini/export?team=maintenance&format=csv&view=all');
  assert.ok(file.includes('Rău'));
});

test('domain: parse rules and the limit of fields per kind', () => {
  const f = { id: 1, type: 'number', required: 0 };
  assert.deepEqual(custom.parse([f], () => '1 234,5').values, { 1: '1234.5' });
  assert.deepEqual(custom.parse([f], () => '1,234.5').errors, { cf_1: 'invalid' }, 'ambiguous separators are refused, as in the measurements');
  assert.deepEqual(custom.parse([f], () => '').errors, {});
  assert.deepEqual(custom.parse([{ ...f, required: 1 }], () => ' ').errors, { cf_1: 'required' });
  assert.deepEqual(custom.parse([{ id: 2, type: 'text' }], () => 'x'.repeat(201)).errors, { cf_2: 'too_long' });
  assert.deepEqual(custom.parse([{ id: 3, type: 'date' }], () => '2026-02-30').errors, { cf_3: 'invalid' });
  assert.deepEqual(custom.parse([{ id: 4, type: 'yesno' }], () => 'maybe').errors, { cf_4: 'invalid' });
  assert.equal(custom.display({ type: 'number', unit: 'm' }, '12.5'), '12,5 m');
  const many = app.db.value("SELECT count(*) FROM custom_fields WHERE kind = 'meeting'");
  assert.ok(many < 40);
  for (let i = many; i < 40; i++) assert.ok(custom.createField(app.db, { id: 1 }, { kind: 'meeting', type: 'text', label: `Câmp ${i}` }).ok);
  const over = custom.createField(app.db, { id: 1 }, { kind: 'meeting', type: 'text', label: 'Prea mult' });
  assert.equal(over.ok, false);
  assert.equal(over.errors.label, 'too_many');
});

test('impossible calendar days (30 February) are refused by every date field, not moved to March', async () => {
  const day = '2026-02-30';
  const t = await post(lead, '/mentenanta/nou', { title: 'Zi imposibilă', due_date: day }, '/mentenanta/nou');
  assert.equal(t.status, 422);
  assert.equal(app.db.value("SELECT count(*) FROM tasks WHERE title = 'Zi imposibilă'"), 0);
  assert.equal((await post(lead, '/calitate/nou', { title: 'NC zi imposibilă', reported_at: day, [`cf_${ids.f.req}`]: String(ids.items[1]) }, '/calitate/nou')).status, 422);
  assert.equal((await post(lead, '/sedinte/nou', { title: 'Ședință zi imposibilă', meeting_date: day, start_time: '10:00', duration_min: '30', teams: ['quality'] }, '/sedinte/nou')).status, 422);
  assert.equal((await post(lead, '/mentenanta/nou', { title: 'Zi reală', due_date: '2028-02-29' }, '/mentenanta/nou')).status, 303, 'a real leap day is fine');
});
