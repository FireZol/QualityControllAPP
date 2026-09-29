'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const rev = require('../domain/revisions');
const targets = require('../domain/targets');

let app, admin, engA, engB, ctc;
const ids = {};

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Inginer A');
  engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Inginer B');
  ctc = await makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const db = app.db;
  for (const [k, t] of [['al', 'CABLARE_RIGIDA_AL'], ['cu', 'CABLARE_RIGIDA_CU']]) {
    ids[k + 'Doc'] = db.get('SELECT id FROM spec_documents WHERE doc_type = ?', t).id;
    ids[k + 'Rev'] = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', ids[k + 'Doc']).id;
    assert.equal((await engA.postForm(`/fise/${ids[k + 'Doc']}/revizii/${ids[k + 'Rev']}`, `/fise/${ids[k + 'Doc']}/revizii/${ids[k + 'Rev']}/trimite`, {})).status, 303);
    assert.equal((await engB.postForm(`/fise/${ids[k + 'Doc']}/revizii/${ids[k + 'Rev']}`, `/fise/${ids[k + 'Doc']}/revizii/${ids[k + 'Rev']}/verifica`, {})).status, 303);
  }
  ids.fam = db.get("SELECT id FROM product_families WHERE code = 'FUNIE_RIGIDA'").id;
  ids.sample = db.get("SELECT id FROM sample_types LIMIT 1").id;
  ids.rigid = db.get("SELECT id FROM machines WHERE name = 'RIGID 1'").id;
  ids.al240 = db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", ids.alRev).id;
  ids.cu240 = db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 RMC'", ids.cuRev).id;
});
test.after(async () => { await app.cleanup(); });

const record = (r) => Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
const results = (no) => Object.fromEntries(app.db.all('SELECT r.* FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ? AND m.is_current = 1', no).map((x) => [x.quantity, x]));
const alForm = (extra) => ({ family_id: String(ids.fam), machine_id: String(ids.rigid), construction_id: String(ids.al240), sample_type_id: String(ids.sample), h: '17.7', l: '22.6', mass_g: '608.5', ...extra });
const cuForm = (extra) => ({ family_id: String(ids.fam), machine_id: String(ids.rigid), construction_id: String(ids.cu240), sample_type_id: String(ids.sample), d1: '18.6', d2: '18.6', mass_g: '2057.3', ...extra });

test('resistance: lower is better and green, above the limit is red — for every way the value is obtained', async () => {
  // Cu 240 RMC, IEC Tab. 4 limit 0.0754 Ω/km
  const at = (rv) => results(record(cuPost)) && null; void at;
  let cuPost = await ctc.postForm('/masuratori/nou', '/masuratori/nou', cuForm({ r_value: '0.05', r_unit: 'ohm_km', temp_c: '20' }));
  let res = results(record(cuPost));
  assert.equal(res.r20.verdict, 'ok'); // far below the limit: still green, never "sub"
  assert.ok(res.r20.deviation_pct < 0, 'negative deviation = better than the limit');
  assert.equal(res.r20.lim_min, null);
  cuPost = await ctc.postForm('/masuratori/nou', '/masuratori/nou', cuForm({ r_value: '0.0754', r_unit: 'ohm_km', temp_c: '20' }));
  assert.equal(results(record(cuPost)).r20.verdict, 'ok'); // exactly at the limit
  cuPost = await ctc.postForm('/masuratori/nou', '/masuratori/nou', cuForm({ r_value: '0.0760', r_unit: 'ohm_km', temp_c: '20' }));
  res = results(record(cuPost));
  assert.equal(res.r20.verdict, 'peste');
  assert.ok(res.r20.deviation_pct > 0);
  // theoretical resistance from mass follows the same rule: lighter than the limit mass = lower R
  let r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', cuForm({ mass_g: '2400' }));
  res = results(record(r));
  assert.equal(res.r20_theor.verdict, 'ok');
  assert.ok(res.r20_theor.value < res.r20_theor.lim_max);
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', cuForm({ mass_g: '1900' }));
  assert.equal(results(record(r)).r20_theor.verdict, 'peste');
  // no resistance quantity can ever be "sub"
  const bad = app.db.value("SELECT count(*) FROM measurement_results WHERE quantity IN ('r20','r20_theor','r20_echiv') AND verdict = 'sub'");
  assert.equal(bad, 0);
  // the page colours: green for ok, red for peste
  const reg = await ctc.get('/masuratori');
  assert.match(reg.text, /val v-ok[^>]*>[^<]*0,05/);
  assert.match(reg.text, /val v-peste[^>]*>[^<]*0,076/);
});

test('the sheet may carry its own resistance target (R max); IEC is only the fallback', async () => {
  // engineer A opens a new revision of the Al sheet and sets R max = 0.1200 on 240 SM 90° in the editor
  assert.equal((await engA.postForm(`/fise/${ids.alDoc}`, `/fise/${ids.alDoc}/revizii/noua`, {})).status, 303);
  const draft = app.db.get("SELECT id FROM spec_revisions WHERE document_id = ? AND status = 'ciorna'", ids.alDoc).id;
  const c = app.db.get("SELECT * FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", draft);
  const page = await engA.get(`/fise/${ids.alDoc}/revizii/${draft}/constructii/${c.id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /name="lim_funie_r20_max"/);
  assert.match(page.text, /Mai mic este mai bine/);
  const cons = rev.loadConstructions(app.db, draft, { onlyActive: true }).find((x) => x.id === c.id);
  const f = {
    material_id: String(cons.material_id), section: String(cons.section), shape_id: String(cons.shape_id), label: cons.label, wires: String(cons.wires), wire_d: String(cons.wire_d),
    die: '', iec_exception_reason: '', lim_funie_h_nominal: '17.7', lim_funie_h_tol: '0.1', lim_funie_l_nominal: '22.6', lim_funie_l_tol: '0.1', lim_funie_mass_min: '607', lim_funie_mass_max: '609.4',
    lim_funie_r20_max: '0,1200', param_rows: '0',
  };
  const saved = await engA.postForm(`/fise/${ids.alDoc}/revizii/${draft}/constructii/${c.id}`, `/fise/${ids.alDoc}/revizii/${draft}/constructii/${c.id}`, f);
  assert.equal(saved.status, 303, textOf(saved.text).slice(0, 300));
  assert.equal(app.db.get("SELECT max FROM limits WHERE construction_id = ? AND quantity = 'r20'", c.id).max, 0.12);
  assert.equal((await engA.postForm(`/fise/${ids.alDoc}/revizii/${draft}`, `/fise/${ids.alDoc}/revizii/${draft}/trimite`, {})).status, 303);
  assert.equal((await engB.postForm(`/fise/${ids.alDoc}/revizii/${draft}`, `/fise/${ids.alDoc}/revizii/${draft}/verifica`, {})).status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', draft).status, 'activa');
  // printed sheet and screen show it
  assert.match(textOf((await ctc.get(`/fise/${ids.alDoc}/revizii/${draft}/tipar`)).text), /R max \[Ω\/km\]/);
  // 608.5 g/m = 0.12216 Ω/km theoretical: above the sheet's 0.1200 (red) although below IEC 0.125 (would be green)
  const newC = app.db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", draft).id;
  const r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', alForm({ construction_id: String(newC) }));
  assert.equal(r.status, 303);
  const res = results(record(r));
  assert.equal(res.r20_theor.lim_max, 0.12);
  assert.equal(res.r20_theor.verdict, 'peste');
  assert.equal(res.r20_theor.source, 'fisa');
  assert.match(textOf((await ctc.get(`/masuratori/${record(r)}`)).text), /fișa tehnică/);
  ids.al240 = newC;
});

test('IEC reference values are editable by an Inginer only, audited, and used by the next measurement', async () => {
  for (const u of ['/liste/iec', '/liste/familii', '/liste/tinte']) {
    assert.equal((await ctc.get(u)).status, 403, u);
    assert.equal((await admin.get(u)).status, 403, u);
    assert.equal((await engA.get(u)).status, 200, u);
  }
  assert.equal((await ctc.postForm('/', '/liste/tinte', {})).status, 403);
  const row = app.db.get("SELECT * FROM iec_limits WHERE iec_class = 2 AND material = 'Cu' AND coated = 0 AND section = 240");
  assert.equal(row.r_max, 0.0754);
  let r = await engA.postForm('/liste/iec?clasa=2', `/liste/iec/${row.id}`, { clasa: '2', r_max: '0,0700', min_wires_circular: String(row.min_wires_circular), min_wires_compacted: String(row.min_wires_compacted), min_wires_shaped: String(row.min_wires_shaped), note: 'țintă internă' });
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT r_max FROM iec_limits WHERE id = ?', row.id).r_max, 0.07);
  const a = app.db.get("SELECT * FROM audit_log WHERE action = 'iec_change' ORDER BY id DESC");
  assert.equal(JSON.parse(a.details).before.r_max, 0.0754);
  assert.equal(JSON.parse(a.details).after.r_max, 0.07);
  // 0.0738 was green against 0.0754, now red against 0.0700 — for a Cu 240 from 2057.3 g/m: theoretical 0.07376
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', cuForm());
  const res = results(record(r));
  assert.equal(res.r20_theor.lim_max, 0.07);
  assert.equal(res.r20_theor.verdict, 'peste');
  // invalid input is refused, wire counts stay integers
  r = await engA.postForm('/liste/iec?clasa=2', `/liste/iec/${row.id}`, { clasa: '2', r_max: 'abc' });
  assert.equal(r.status, 422);
  r = await engA.postForm('/liste/iec?clasa=2', `/liste/iec/${row.id}`, { clasa: '2', r_max: '0.07', min_wires_circular: '6.5' });
  assert.equal(r.status, 422);
  // a new row; duplicates refused
  r = await engA.postForm('/liste/iec?clasa=1', '/liste/iec/nou', { iec_class: '1', section: '2000', material: 'Al', r_max: '0,015' });
  assert.equal(r.status, 303);
  assert.equal(app.db.get("SELECT iec_table FROM iec_limits WHERE iec_class = 1 AND section = 2000").iec_table, 'Tab. 3');
  r = await engA.postForm('/liste/iec?clasa=1', '/liste/iec/nou', { iec_class: '1', section: '2000', material: 'Al', r_max: '0,015' });
  assert.equal(r.status, 422);
  // restore the standard's value
  await engA.postForm('/liste/iec?clasa=2', `/liste/iec/${row.id}`, { clasa: '2', r_max: '0,0754', min_wires_circular: String(row.min_wires_circular), min_wires_compacted: String(row.min_wires_compacted), min_wires_shaped: String(row.min_wires_shaped) });
  assert.equal(app.db.get('SELECT r_max FROM iec_limits WHERE id = ?', row.id).r_max, 0.0754);
});

test('families: switch what is measured and which resistance, per family', async () => {
  // Al funie: measured resistance is off by default; an Inginer turns it on, then off theoretical for Cu funie
  const fam = ids.fam;
  assert.ok(!/name="r_value"/.test((await ctc.get(`/masuratori/nou?family=${fam}&machine=${ids.rigid}&construction=${ids.al240}`)).text));
  let r = await engA.postForm('/liste/familii', `/liste/familii/${fam}`, { active: '1', mass: '1', theor: '1', r_cu: '1', r_al: '1' });
  assert.equal(r.status, 303);
  assert.deepEqual(JSON.parse(app.db.get('SELECT measures FROM product_families WHERE id = ?', fam).measures).resistance_measured, ['Cu', 'Al']);
  const page = await ctc.get(`/masuratori/nou?family=${fam}&machine=${ids.rigid}&construction=${ids.al240}`);
  assert.match(page.text, /name="r_value"/);
  // measured Al resistance is judged by the same rule (sheet target 0.12 from the previous test): 0.10 green, 0.13 red
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', alForm({ r_value: '0.10', r_unit: 'ohm_km', temp_c: '20' }));
  assert.equal(results(record(r)).r20.verdict, 'ok');
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', alForm({ r_value: '0.13', r_unit: 'ohm_km', temp_c: '20' }));
  assert.equal(results(record(r)).r20.verdict, 'peste');
  // turn the theoretical resistance off: new records carry none, old ones keep theirs
  const oldCount = app.db.value("SELECT count(*) FROM measurement_results WHERE quantity = 'r20_theor'");
  r = await engA.postForm('/liste/familii', `/liste/familii/${fam}`, { active: '1', mass: '1', r_cu: '1' });
  assert.equal(r.status, 303);
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', alForm());
  assert.ok(!results(record(r)).r20_theor);
  assert.equal(app.db.value("SELECT count(*) FROM measurement_results WHERE quantity = 'r20_theor'"), oldCount);
  // a family that measures nothing cannot be active
  r = await engA.postForm('/liste/familii', `/liste/familii/${app.db.get("SELECT id FROM product_families WHERE code = 'FLEXIBIL_CL5'").id}`, { active: '1' });
  assert.equal(r.status, 422);
  // deactivated family disappears from the entry form
  const sarma = app.db.get("SELECT id FROM product_families WHERE code = 'SARMA_CL5'").id;
  assert.match((await ctc.get('/masuratori/nou')).text, new RegExp(`value="${sarma}"`));
  await engA.postForm('/liste/familii', `/liste/familii/${sarma}`, { mass: '1' });
  assert.ok(!new RegExp(`value="${sarma}"`).test((await ctc.get('/masuratori/nou')).text));
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'family_change'") >= 3);
  // put the switches back for the next tests
  await engA.postForm('/liste/familii', `/liste/familii/${fam}`, { active: '1', mass: '1', theor: '1', r_cu: '1' });
});

test('targets: temperature range, default sample lengths and Cpk colours are editable', async () => {
  assert.equal(targets.get(app.db).temp_max, 40);
  const good = { sample_mm: '500', r_sample_m: '2', temp_min: '10', temp_max: '30', cpk_good: '1,67', cpk_min: '1,33', min_n: '20', mass_ratio_min: '0,9', mass_ratio_max: '1,1' };
  let r = await engA.postForm('/liste/tinte', '/liste/tinte', { ...good, temp_min: '30', temp_max: '10' });
  assert.equal(r.status, 422);
  r = await engA.postForm('/liste/tinte', '/liste/tinte', { ...good, cpk_min: '2' });
  assert.equal(r.status, 422);
  r = await engA.postForm('/liste/tinte', '/liste/tinte', { ...good, min_n: '1,5' });
  assert.equal(r.status, 422);
  r = await engA.postForm('/liste/tinte', '/liste/tinte', good);
  assert.equal(r.status, 303);
  const t = targets.get(app.db);
  assert.deepEqual([t.sample_mm, t.temp_min, t.temp_max, t.cpk_good, t.min_n], [500, 10, 30, 1.67, 20]);
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'targets_change'") >= 1);
  // the entry form uses the new defaults and the new temperature range
  const page = await ctc.get(`/masuratori/nou?family=${ids.fam}&machine=${ids.rigid}&construction=${ids.cu240}`);
  assert.match(page.text, /name="sample_mm" value="500"/);
  assert.match(page.text, /name="r_sample_m" value="2"/);
  assert.match(page.text, /Implicit 500 mm/);
  const live = JSON.parse(/id="live-ctx">([^<]+)</.exec(page.text)[1]);
  assert.match(live.messages.temp_warning, /10 … 30/);
  // 35 °C is inside the old range but outside the new one: saved with a warning, still computed
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', cuForm({ r_value: '0.05', r_unit: 'ohm_km', temp_c: '35' }));
  assert.equal(r.status, 303);
  assert.match((await ctc.follow('GET', r.location)).text, /în afara intervalului admis/);
  assert.ok(results(record(r)).r20.value > 0);
  // the same sample: 25 °C is fine
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', cuForm({ r_value: '0.05', r_unit: 'ohm_km', temp_c: '25' }));
  assert.ok(!/în afara intervalului admis/.test((await ctc.follow('GET', r.location)).text));
  // analyses: "orientativ" threshold follows min_n and Cpk colours follow the targets
  const an = await ctc.get('/analize/distributie?product=FUNIE%7CCu%7C240%7CRMC&quantity=mass_gm&group=product');
  assert.match(an.text, /n &lt; 20: orientativ/);
  assert.match(textOf((await engA.get('/liste/tinte')).text), /Regula rezistenței/);
});

test('configuration pages keep the language rules', async () => {
  const bad = /[şţŞŢ]/;
  for (const u of ['/liste', '/liste/familii', '/liste/tinte', '/liste/iec', '/liste/iec?clasa=5&material=Cu', '/liste/iec?clasa=1']) {
    const r = await engA.get(u);
    const t = textOf(r.text);
    assert.equal(r.status, 200, u);
    assert.ok(!bad.test(t) && !/⟦|undefined|NaN/.test(t), u);
  }
});

test('20 °C is the reference: the temperature formula reproduces IEC 60228 Table A.1, and the page shows it', async () => {
  const calc = require('../domain/calc');
  const fs = require('node:fs');
  const path = require('node:path');
  const a1 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'seed', 'iec60228_2023.json'), 'utf8')).kt_table_A1;
  assert.equal(Object.keys(a1).length, 41);
  for (const [t, v] of Object.entries(a1)) assert.equal(Math.round(calc.kt(Number(t), 0.004) * 1000) / 1000, v, `kt at ${t} °C`);
  // 20 °C: no correction at all; the reference values are used as they are
  assert.equal(calc.kt(20, 0.00393), 1);
  assert.equal(calc.resistanceAt20(4.93, 20, 0.00393), 4.93);
  // theoretical R is computed straight at 20 °C: no temperature enters
  const ctx = { shapeKind: 'rotund', material: { rho20: 0.01707, density: 8.89, alpha20: 0.00393 }, limits: {}, iec: null, measuresR: false };
  const a = calc.evaluate({ d1: '1', d2: '1', mass_g: '2057.3' }, ctx);
  const b = calc.evaluate({ d1: '1', d2: '1', mass_g: '2057.3', temp_c: '35' }, ctx);
  assert.equal(a.results.find((x) => x.quantity === 'r20_theor').value, b.results.find((x) => x.quantity === 'r20_theor').value);
  // the materials page shows the check table with the reference row
  const page = await engA.get('/liste/materiale');
  assert.equal(page.status, 200);
  const t = textOf(page.text);
  assert.match(t, /reproduce toate cele 41 de valori/);
  assert.match(t, /referință/);
  assert.match(t, /ρ20/);
});
