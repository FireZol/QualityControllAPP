'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');

let app, admin, engA, engB, ctc, ids = {};

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Inginer A');
  engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Inginer B');
  ctc = await makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const db = app.db;
  const doc = db.get("SELECT id FROM spec_documents WHERE doc_type = 'CABLARE_RIGIDA_AL'").id;
  const rv = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', doc).id;
  await engA.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/trimite`, {});
  await engB.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/verifica`, {});
  ids.fam = db.get("SELECT id FROM product_families WHERE code = 'FUNIE_RIGIDA'").id;
  ids.c = db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", rv).id;
  ids.machine = db.get("SELECT id FROM machines WHERE name = 'RIGID 1'").id;
  ids.sample = db.get('SELECT id FROM sample_types LIMIT 1').id;
});
test.after(async () => { await app.cleanup(); });

const add = (mass) => ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(ids.fam), machine_id: String(ids.machine), construction_id: String(ids.c), sample_type_id: String(ids.sample), h: '17.7', l: '22.6', mass_g: String(mass) });
const KEY = 'FUNIE%7CAl%7C240%7CSM90';

test('control chart page and home alert: a drift inside the tolerance is flagged before any value is out of limit', async () => {
  // 30 stable values (607.9 / 608.1), then a slow drift upward that stays below the 609.4 limit
  for (let i = 0; i < 30; i++) assert.equal((await add(i % 2 ? 608.1 : 607.9)).status, 303);
  let page = await ctc.get(`/analize/control?product=${KEY}&quantity=mass_gm&base=30`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<svg class="chart"/);
  assert.match(textOf(page.text), /Carte de control/);
  assert.ok(!/class="ch-pt-out"/.test(page.text), 'stable process: no signal');
  const home0 = await ctc.get('/');
  assert.ok(!/Semnale SPC/.test(home0.text));
  for (const m of [608.3, 608.4, 608.5, 608.6, 608.7, 608.8, 608.9, 609.0]) assert.equal((await add(m)).status, 303);
  assert.equal(app.db.value("SELECT count(*) FROM measurement_results WHERE quantity = 'mass_gm' AND verdict <> 'ok'"), 0, 'everything is still inside the tolerance');
  page = await ctc.get(`/analize/control?product=${KEY}&quantity=mass_gm&base=30`);
  assert.match(page.text, /class="ch-pt-out"/);
  const t = textOf(page.text);
  assert.match(t, /6 puncte consecutive crescătoare/);
  assert.match(t, /UCL/);
  assert.match(t, /LCL/);
  assert.match(t, /Amplitudinea mobilă/);
  // the same limits are shown against the specification limits (dotted)
  assert.match(page.text, /ch-spec/);
  // home page: alert for the drifting product
  const home = await ctc.get('/');
  assert.match(textOf(home.text), /Semnale SPC/);
  assert.match(textOf(home.text), /240 SM 90°/);
  assert.match(home.text, /\/analize\/control\?product=/);
  // export of the signals
  const csv = await ctc.get(`/analize/control?product=${KEY}&quantity=mass_gm&base=30&format=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Semnal/);
  // needs a product; too few values
  assert.match((await ctc.get('/analize/control')).text, /Alegeți un produs/);
});

test('SPC thresholds are targets: raising the minimum number of values silences the alert', async () => {
  const good = { sample_mm: '1000', r_sample_m: '5', temp_min: '0', temp_max: '40', cpk_good: '1,33', cpk_min: '1', min_n: '30', mass_ratio_min: '0,85', mass_ratio_max: '1,15', spc_min_n: '500', spc_window: '100', spc_recent: '10' };
  let r = await engA.postForm('/liste/tinte', '/liste/tinte', good);
  assert.equal(r.status, 303);
  assert.ok(!/Semnale SPC/.test((await ctc.get('/')).text));
  r = await engA.postForm('/liste/tinte', '/liste/tinte', { ...good, spc_min_n: '20' });
  assert.match((await ctc.get('/')).text, /Semnale SPC/);
  r = await engA.postForm('/liste/tinte', '/liste/tinte', { ...good, spc_min_n: '3' });
  assert.equal(r.status, 422);
});
