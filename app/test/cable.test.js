'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const rev = require('../domain/revisions');
const C = require('../domain/certificates');

let app, admin, engA, engB, ctc, ids = {};

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Inginer A');
  engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Inginer B');
  ctc = await makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const db = app.db;
  ids.fam = db.get("SELECT id FROM product_families WHERE code = 'CABLE_LV'").id;
  ids.doc = db.get("SELECT id FROM spec_documents WHERE doc_type = 'CABLU_LV'").id;
  ids.rev = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', ids.doc).id;
  ids.machine = db.get("SELECT id FROM machines WHERE name = 'STAȚIE ÎNCERCĂRI 1'").id;
  ids.cu = db.get("SELECT id FROM materials WHERE code = 'Cu'").id;
  ids.rm = db.get("SELECT id FROM shapes WHERE code = 'RM'").id;
  ids.routine = db.get("SELECT id FROM sample_types WHERE name = 'Încercare de rutină'").id;
});
test.after(async () => { await app.cleanup(); });

const record = (r) => Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
const results = (no) => Object.fromEntries(app.db.all('SELECT r.* FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ? AND m.is_current = 1', no).map((x) => [x.quantity, x]));

test('the finished-cable family, machine, sheet and catalogue exist out of the box; no limits are guessed', async () => {
  const codes = app.db.all('SELECT code FROM test_types').map((r) => r.code);
  for (const c of ['cond_res', 'hv_test', 'ins_thick', 'sheath_thick', 'od', 'hot_set_load', 'pvc_heat_shock', 'halogen_hcl', 'smoke_trans', 'flame_bunch', 'ir_20', 'hv_4h']) assert.ok(codes.includes(c), c);
  assert.equal(app.db.value("SELECT count(*) FROM limits WHERE level = 'cablu'"), 0);
  assert.equal(app.db.value('SELECT count(*) FROM constructions WHERE revision_id = ?', ids.rev), 0);
  assert.deepEqual(app.db.all('SELECT name FROM cable_standards ORDER BY id').map((r) => r.name), ['IEC 60502-1', 'HD 603', 'VDE 0276-603']);
  assert.ok(app.db.all('SELECT code FROM compounds').some((r) => r.code === 'HFFR'));
  // HFFR tests are external by default, XLPE ones apply to XLPE / EPR only
  assert.equal(app.db.get("SELECT in_house FROM test_types WHERE code = 'smoke_trans'").in_house, 0);
  assert.equal(app.db.get("SELECT applies_to FROM test_types WHERE code = 'hot_set_load'").applies_to, 'XLPE,EPR');
  // an empty sheet cannot be activated
  const r = await engA.postForm(`/fise/${ids.doc}/revizii/${ids.rev}`, `/fise/${ids.doc}/revizii/${ids.rev}/trimite`, {});
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', ids.rev).status, 'ciorna');
});

test('the engineer defines a PVC cable design with its requirements; a second engineer activates the sheet', async () => {
  const base = `/fise/${ids.doc}/revizii/${ids.rev}`;
  const page = await engA.get(`${base}/constructii/noua`);
  assert.equal(page.status, 200);
  assert.match(page.text, /name="cab_tests"/);
  assert.match(page.text, /name="lim_cablu_ins_thick_min_min"/);
  assert.match(page.text, /name="lim_cablu_smoke_trans_min"/); // HFFR tests are offered too: future materials
  const f = {
    material_id: String(ids.cu), section: '16', shape_id: String(ids.rm), label: 'NYY-J 4x16 0,6/1 kV', iec_exception_reason: '',
    cab_cores: '4', cab_voltage: '0,6/1 kV', cab_class: '2', cab_insulation: 'PVC', cab_sheath: 'PVC', cab_standard: 'IEC 60502-1', cab_armour: '',
    lim_cablu_ins_thick_avg_min: '1,0', lim_cablu_ins_thick_min_min: '0,8', lim_cablu_sheath_thick_avg_min: '1,4', lim_cablu_sheath_thick_min_min: '1,1',
    lim_cablu_od_avg_min: '20', lim_cablu_od_avg_max: '22', lim_cablu_pvc_mass_loss_max: '2,0', lim_cablu_ir_20_min: '0,037',
  };
  const params = { ...f, cab_tests: ['cond_res', 'hv_test', 'ins_thick', 'sheath_thick', 'od', 'marking', 'pvc_heat_shock', 'pvc_mass_loss', 'ir_20', 'hv_4h'] };
  const r = await engA.postForm(`${base}/constructii/noua`, `${base}/constructii/noua`, params);
  assert.equal(r.status, 303, textOf(r.text).slice(0, 300));
  const c = app.db.get('SELECT * FROM constructions WHERE revision_id = ?', ids.rev);
  assert.equal(c.stable_key.startsWith('CABLU|Cu|16'), true);
  const data = JSON.parse(c.data);
  assert.equal(data.cores, 4);
  assert.equal(data.insulation, 'PVC');
  assert.deepEqual(data.tests.slice().sort(), ['cond_res', 'hv_4h', 'hv_test', 'ins_thick', 'ir_20', 'marking', 'od', 'pvc_heat_shock', 'pvc_mass_loss', 'sheath_thick']);
  const lim = Object.fromEntries(app.db.all("SELECT quantity, min, max FROM limits WHERE construction_id = ? AND level = 'cablu'", c.id).map((x) => [x.quantity, x]));
  assert.equal(lim.ins_thick_min.min, 0.8);
  assert.equal(lim.od_avg.max, 22);
  // the sheet page and its printed form
  assert.match(textOf((await engA.get(base)).text), /NYY-J 4x16/);
  assert.equal((await engA.postForm(base, `${base}/trimite`, {})).status, 303);
  assert.equal((await engB.postForm(base, `${base}/verifica`, {})).status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', ids.rev).status, 'activa');
  const pr = await ctc.get(`${base}/tipar`);
  assert.equal(pr.status, 200);
  const t = textOf(pr.text);
  assert.match(t, /NYY-J 4x16/);
  assert.match(t, /Grosimea izolației — medie/);
  assert.match(t, /Încercări de rutină/);
  ids.design = c.id;
});

test('batches: anyone creates one and adds drums; the number is unique; only the design list of the active sheet is offered', async () => {
  let page = await ctc.get('/loturi/nou');
  assert.match(page.text, /NYY-J 4x16/);
  let r = await ctc.postForm('/loturi/nou', '/loturi/nou', { batch_no: '', construction_id: String(ids.design) });
  assert.equal(r.status, 422);
  r = await ctc.postForm('/loturi/nou', '/loturi/nou', { batch_no: 'L-2026-001', order_no: 'CMD-77', client_id: String(app.db.get("SELECT id FROM clients WHERE short_name = 'SBT'").id), construction_id: String(ids.design), standard: 'IEC 60502-1', produced_length_m: '2000' });
  assert.equal(r.status, 303);
  ids.batch = Number(/\/loturi\/(\d+)/.exec(r.location)[1]);
  r = await ctc.postForm('/loturi/nou', '/loturi/nou', { batch_no: 'l-2026-001', construction_id: String(ids.design) });
  assert.equal(r.status, 422); // case-insensitive unique
  // a design that is not on the active sheet is refused
  r = await ctc.postForm('/loturi/nou', '/loturi/nou', { batch_no: 'X', construction_id: '999999' });
  assert.equal(r.status, 422);
  for (const n of ['1', '2', '3']) {
    r = await ctc.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/tobe`, { drum_no: n, length_m: '500' });
    assert.equal(r.status, 303);
  }
  r = await ctc.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/tobe`, { drum_no: '1', length_m: '1' });
  assert.equal(r.status, 422);
  ids.drums = app.db.all('SELECT id, drum_no FROM drums WHERE batch_id = ? ORDER BY drum_no', ids.batch).map((d) => d.id);
  assert.equal(ids.drums.length, 3);
  const det = await ctc.get(`/loturi/${ids.batch}`);
  assert.match(textOf(det.text), /Încercări cerute încă lipsă/);
  assert.match(det.text, /Conductorul|Rezistența conductorului/);
  const list = await ctc.get('/loturi?q=CMD');
  assert.match(list.text, /L-2026-001/);
});

const testForm = (drum, extra) => ({ family_id: String(ids.fam), machine_id: String(ids.machine), batch_id: String(ids.batch), drum_id: drum ? String(drum) : '', construction_id: String(ids.design), sample_type_id: String(ids.routine), ...extra });

test('batch tests: resistance at 20 °C against IEC, thickness readings (average and minimum), pass / fail', async () => {
  const p = await ctc.get(`/masuratori/nou?family=${ids.fam}&batch=${ids.batch}&drum=${ids.drums[0]}&machine=${ids.machine}`);
  assert.equal(p.status, 200);
  assert.match(p.text, /name="t_cond_res"/);
  assert.match(p.text, /name="t_ins_thick"/);
  assert.match(p.text, /name="t_marking"/);
  assert.ok(!/name="t_hot_set_load"/.test(p.text), 'XLPE test is not offered for a PVC design');
  assert.ok(!/name="t_ir_20"/.test(p.text), 'type tests are not part of a batch session');
  assert.match(p.text, /Rezistența conductorului/);
  const live = JSON.parse(/id="live-ctx">([^<]+)</.exec(p.text)[1]);
  assert.equal(live.mode, 'tests');
  // drum 1: everything conforming
  let r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', testForm(ids.drums[0], {
    t_cond_res: '1,10', t_cond_res_unit: 'ohm_km', t_cond_res_temp: '20', t_ins_thick: '1,05 1,10 0,95 1,00 1,02', t_marking: 'pass', t_hv_test: 'pass', t_sheath_thick: '1,6; 1,5; 1,45', t_od: '21,0 21,2 20,9',
  }));
  assert.equal(r.status, 303, textOf(r.text).slice(0, 200));
  let res = results(record(r));
  assert.equal(res.cond_res.verdict, 'ok');
  assert.equal(res.cond_res.lim_max, 1.15); // IEC 60228 class 2, Cu 16
  assert.match(res.cond_res.source, /Tab\. 4/);
  assert.ok(res.cond_res.deviation_pct < 0);
  assert.ok(Math.abs(res.ins_thick_avg.value - 1.024) < 1e-9);
  assert.equal(res.ins_thick_avg.verdict, 'ok');
  assert.equal(res.ins_thick_min.value, 0.95);
  assert.equal(res.ins_thick_min.verdict, 'ok');
  assert.equal(res.marking.verdict, 'ok');
  assert.equal(res.hv_test.value, 1);
  assert.equal(res.od_avg.verdict, 'ok');
  const m = app.db.get('SELECT * FROM measurements WHERE record_no = ?', record(r));
  assert.equal(m.batch_id, ids.batch);
  assert.equal(m.drum_id, ids.drums[0]);
  assert.equal(m.revision_id, ids.rev);
  // resistance measured at 30 °C is corrected to 20 °C with the standard's formula
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', testForm(ids.drums[1], { t_cond_res: '1,10', t_cond_res_unit: 'ohm_km', t_cond_res_temp: '30', t_hv_test: 'pass', t_marking: 'pass' }));
  res = results(record(r));
  assert.ok(Math.abs(res.cond_res.value - 1.10 / (1 + 0.00393 * 10)) < 1e-9);
  // drum 3: too thin (average below the requirement), a failed voltage test, resistance above the limit
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', testForm(ids.drums[2], { t_cond_res: '1,20', t_cond_res_unit: 'ohm_km', t_cond_res_temp: '20', t_ins_thick: '0,9 0,95 0,92', t_hv_test: 'fail', t_marking: 'pass' }));
  assert.equal(r.status, 303);
  res = results(record(r));
  assert.equal(res.cond_res.verdict, 'peste');
  assert.equal(res.ins_thick_avg.verdict, 'sub');
  assert.equal(res.ins_thick_min.verdict, 'ok'); // 0.9 >= 0.8
  assert.equal(res.hv_test.verdict, 'neconform');
  assert.equal(res.hv_test.value, 0);
  ids.badRecord = record(r);
  // nothing entered, garbage, and a forged drum are refused
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', testForm(ids.drums[0], {}));
  assert.equal(r.status, 422);
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', testForm(ids.drums[0], { t_ins_thick: 'abc' }));
  assert.equal(r.status, 422);
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', testForm(999999, { t_marking: 'pass' }));
  assert.equal(r.status, 422);
  // a test that does not apply to the design is ignored, not stored
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', testForm(ids.drums[0], { t_marking: 'pass', t_hot_set_load: '50', t_ir_20: '10' }));
  res = results(record(r));
  assert.deepEqual(Object.keys(res), ['marking']);
});

test('the batch page shows coverage and the out-of-requirement results; the register and home show cable records', async () => {
  const det = await ctc.get(`/loturi/${ids.batch}`);
  const t = textOf(det.text);
  assert.match(t, /Încercări cerute încă lipsă/);
  assert.match(t, /rezultate în afara cerințelor/);
  const reg = await ctc.get('/masuratori');
  assert.match(reg.text, /L-2026-001/);
  assert.match(reg.text, /rezultate, \d+ neconforme/);
  const detail = await ctc.get(`/masuratori/${ids.badRecord}`);
  assert.match(textOf(detail.text), /Neconform/);
  assert.match(textOf(detail.text), /Grosimea izolației — medie/);
  assert.match(detail.text, /\/loturi\/\d+/);
  const home = await ctc.get('/');
  assert.match(home.text, /neconforme/);
  const only = await ctc.get('/masuratori?out=1');
  assert.match(only.text, new RegExp(`/masuratori/${ids.badRecord}"`));
});

test('type tests: without a batch, on the design, only type-test scope; the report prints them', async () => {
  const p = await ctc.get(`/masuratori/nou?family=${ids.fam}&design=${ids.design}&machine=${ids.machine}`);
  assert.match(p.text, /name="t_ir_20"/);
  assert.match(p.text, /name="t_hv_4h"/);
  assert.ok(!/name="t_cond_res"/.test(p.text));
  const typeType = app.db.get("SELECT id FROM sample_types WHERE name = 'Încercare de tip'").id;
  let r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(ids.fam), machine_id: String(ids.machine), batch_id: '', drum_id: '', construction_id: String(ids.design), sample_type_id: String(typeType), t_ir_20: '55', t_hv_4h: 'pass', t_cond_res: '1', notes: 'Proba TT-1' });
  assert.equal(r.status, 303, textOf(r.text).slice(0, 200));
  const res = results(record(r));
  assert.equal(res.ir_20.verdict, 'ok'); // 55 >= 0.037
  assert.equal(res.hv_4h.verdict, 'ok');
  assert.ok(!res.cond_res);
  assert.equal(app.db.get('SELECT batch_id FROM measurements WHERE record_no = ?', record(r)).batch_id, null);
  const rep = await ctc.get(`/proiecte-cablu/${ids.design}/raport-tip`);
  assert.equal(rep.status, 200);
  const t = textOf(rep.text);
  assert.match(t, /Raport de încercări de tip/);
  assert.match(t, /Rezistența de izolație la 20 °C/);
  assert.match(t, /Proba TT-1/);
  assert.match(t, /conforme/);
  assert.equal((await ctc.get('/proiecte-cablu/999999/raport-tip')).status, 404);
});

test('certificate: preview, issue needs an Inginer, a non-conforming batch needs a reason, the issued content is frozen and numbered', async () => {
  const prev = await ctc.get(`/loturi/${ids.batch}/certificat`);
  assert.equal(prev.status, 200);
  assert.match(textOf(prev.text), /PREVIZUALIZARE/);
  assert.match(textOf(prev.text), /NU este conform/);
  assert.match(textOf(prev.text), /Încercări cerute încă lipsă|Încercări de rutină/);
  // Personal cannot issue
  assert.equal((await ctc.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/certificat/emite`, {})).status, 403);
  // non-conforming: refused without a reason
  let r = await engA.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/certificat/emite`, {});
  assert.equal(r.status, 422);
  assert.equal(app.db.value('SELECT count(*) FROM batch_certificates'), 0);
  r = await engA.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/certificat/emite`, { override_reason: 'Acceptat de client, derogare D-12' });
  assert.equal(r.status, 303);
  const c1 = app.db.get('SELECT * FROM batch_certificates');
  assert.match(c1.cert_no, /^CERT-\d{4}-0001$/);
  assert.equal(c1.conforming, 0);
  const page1 = textOf((await ctc.get(`/certificate/${c1.id}`)).text);
  assert.match(page1, /CERT-\d{4}-0001/);
  assert.match(page1, /Acceptat de client, derogare D-12/);
  assert.match(page1, /Lotul NU este conform/);
  assert.match(page1, /Elaborat: Inginer A/);
  assert.ok(!/PREVIZUALIZARE/.test(page1));
  const before = JSON.stringify(JSON.parse(c1.snapshot).rows);
  // the operator corrects the failed drum: the issued certificate does not change
  const bad = app.db.get('SELECT * FROM measurements WHERE record_no = ? AND is_current = 1', ids.badRecord);
  r = await ctc.postForm(`/masuratori/${ids.badRecord}/corecteaza`, `/masuratori/${ids.badRecord}/corecteaza`, {
    machine_id: String(ids.machine), batch_id: String(ids.batch), drum_id: String(ids.drums[2]), construction_id: String(ids.design), sample_type_id: String(ids.routine),
    t_cond_res: '1,10', t_cond_res_unit: 'ohm_km', t_cond_res_temp: '20', t_ins_thick: '1,0 1,05 1,1', t_hv_test: 'pass', t_marking: 'pass', edit_reason: 'Repetat după reglaj',
  });
  assert.equal(r.status, 303, textOf(r.text).slice(0, 300));
  assert.equal(app.db.value('SELECT count(*) FROM measurements WHERE record_no = ?', ids.badRecord), 2);
  assert.equal(JSON.stringify(JSON.parse(app.db.get('SELECT snapshot FROM batch_certificates WHERE id = ?', c1.id).snapshot).rows), before);
  // now the batch is conforming: the new certificate supersedes the first one
  const live = C.build(app.db, ids.batch);
  assert.equal(live.conforming, true);
  r = await engA.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/certificat/emite`, {});
  assert.equal(r.status, 303);
  const c2 = app.db.get('SELECT * FROM batch_certificates ORDER BY id DESC');
  assert.match(c2.cert_no, /-0002$/);
  assert.equal(c2.supersedes_id, c1.id);
  assert.equal(c2.conforming, 1);
  assert.match(textOf((await ctc.get(`/certificate/${c1.id}`)).text), /Certificat înlocuit de CERT-\d{4}-0002/);
  const page2 = textOf((await ctc.get(`/certificate/${c2.id}`)).text);
  assert.match(page2, /Lotul este conform/);
  assert.ok(!/Acceptat de client/.test(page2));
  assert.equal((await ctc.get('/certificate/9999')).status, 404);
  // the certificate prints on numbered A4 pages like the data sheets
  assert.match((await ctc.get(`/certificate/${c2.id}`)).text, /print-paginate\.js/);
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'certificate_issue'") >= 2);
});

test('closing a batch stops new tests and drums; only an Inginer reopens it', async () => {
  let r = await ctc.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/inchide`, {});
  assert.equal(r.status, 303);
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', testForm(ids.drums[0], { t_marking: 'pass' }));
  assert.equal(r.status, 422);
  r = await ctc.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/tobe`, { drum_no: '9' });
  assert.equal(r.status, 303);
  assert.equal(app.db.value('SELECT count(*) FROM drums WHERE drum_no = ?', '9'), 0);
  assert.equal((await ctc.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/redeschide`, {})).status, 403);
  assert.equal((await engA.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/redeschide`, {})).status, 303);
  assert.equal(app.db.get('SELECT status FROM batches WHERE id = ?', ids.batch).status, 'deschis');
});

test('the catalogue is editable: a new test appears in the sheet editor and the form; inactive tests disappear; HFFR / XLPE designs get their own tests', async () => {
  assert.equal((await ctc.get('/liste/incercari')).status, 403);
  let r = await engA.postForm('/liste/incercari', '/liste/incercari/adauga', { code: 'xlpe_gel', name: 'XLPE: conținut de gel', kind: 'numeric', unit: '%', scope: 'sample', active: '1', in_house: '1' });
  assert.equal(r.status, 303);
  r = await engA.postForm('/liste/incercari', '/liste/incercari/adauga', { code: 'Bad Code', name: 'x', kind: 'numeric', scope: 'sample' });
  assert.equal(r.status, 422);
  r = await engA.postForm('/liste/incercari', '/liste/incercari/adauga', { code: 'xlpe_gel', name: 'dup', kind: 'numeric', scope: 'sample' });
  assert.equal(r.status, 422);
  const t = app.db.get("SELECT * FROM test_types WHERE code = 'xlpe_gel'");
  r = await engA.postForm('/liste/incercari', `/liste/incercari/${t.id}`, { name: 'XLPE: conținut de gel', unit: '%', decimals: '1', scope: 'sample', applies_to: 'XLPE', standard_ref: 'ref intern', in_house: '1', active: '1', sort: '305' });
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT applies_to FROM test_types WHERE id = ?', t.id).applies_to, 'XLPE');
  r = await engA.postForm('/liste/incercari', `/liste/incercari/${t.id}`, { name: 'x', scope: 'sample', applies_to: 'NOPE', active: '1' });
  assert.equal(r.status, 422);
  // applies to XLPE only: not offered for the PVC design, offered for a new XLPE design in the editor
  const p = await ctc.get(`/masuratori/nou?family=${ids.fam}&batch=${ids.batch}&machine=${ids.machine}`);
  assert.ok(!/name="t_xlpe_gel"/.test(p.text));
  const rd = rev.familyOf(app.db, ids.fam);
  assert.ok(rd);
  assert.equal((await engA.postForm(`/fise/${ids.doc}`, `/fise/${ids.doc}/revizii/noua`, {})).status, 303);
  const draft = app.db.get("SELECT id FROM spec_revisions WHERE document_id = ? AND status = 'ciorna'", ids.doc).id;
  const dbase = `/fise/${ids.doc}/revizii/${draft}`;
  const ed = await engA.get(`${dbase}/constructii/noua`);
  assert.match(ed.text, /name="lim_cablu_xlpe_gel_min"/);
  const params = ({ material_id: String(ids.cu), section: '35', shape_id: String(ids.rm), label: 'N2XH 4x35 0,6/1 kV', cab_cores: '4', cab_voltage: '0,6/1 kV', cab_class: '2', cab_insulation: 'XLPE', cab_sheath: 'HFFR', cab_standard: 'HD 603', lim_cablu_hot_set_load_max: '175', lim_cablu_smoke_trans_min: '60', lim_cablu_halogen_hcl_max: '0,5', cab_tests: ['cond_res', 'hot_set_load', 'hot_set_perm', 'smoke_trans', 'halogen_hcl', 'flame_bunch', 'xlpe_gel'] });
  r = await engA.postForm(`${dbase}/constructii/noua`, `${dbase}/constructii/noua`, params);
  assert.equal(r.status, 303, textOf(r.text).slice(0, 300));
  // the previous design is kept in the new revision (copied), the new one added; activate
  assert.equal(app.db.value('SELECT count(*) FROM constructions WHERE revision_id = ? AND active = 1', draft), 2);
  assert.equal((await engA.postForm(dbase, `${dbase}/trimite`, {})).status, 303);
  assert.equal((await engB.postForm(dbase, `${dbase}/verifica`, {})).status, 303);
  const xl = app.db.get("SELECT id FROM constructions WHERE revision_id = ? AND label LIKE 'N2XH%'", draft).id;
  const typeType = app.db.get("SELECT id FROM sample_types WHERE name = 'Încercare de tip'").id;
  const tp = await ctc.get(`/masuratori/nou?family=${ids.fam}&design=${xl}&machine=${ids.machine}`);
  assert.match(tp.text, /name="t_smoke_trans"/); // HFFR sheath: type test offered
  assert.match(tp.text, /name="t_halogen_hcl"/);
  assert.match(tp.text, /extern/); // done by an external laboratory: marked
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(ids.fam), machine_id: String(ids.machine), batch_id: '', construction_id: String(xl), sample_type_id: String(typeType), t_smoke_trans: '45', t_halogen_hcl: '0,3', t_flame_bunch: 'pass' });
  assert.equal(r.status, 303);
  const res = results(record(r));
  assert.equal(res.smoke_trans.verdict, 'sub'); // 45 % < 60 % requirement
  assert.equal(res.halogen_hcl.verdict, 'ok'); // lower is better: 0.3 <= 0.5
  assert.equal(res.flame_bunch.verdict, 'ok');
  // XLPE batch tests include hot set; a deactivated test disappears everywhere
  const xb = await ctc.get('/loturi/nou');
  assert.match(xb.text, /N2XH 4x35/);
  await engA.postForm('/liste/incercari', `/liste/incercari/${app.db.get("SELECT id FROM test_types WHERE code = 'hot_set_perm'").id}`, { name: 'Hot set: alungire remanentă', scope: 'sample', applies_to: 'XLPE,EPR' });
  const p2 = await ctc.postForm('/loturi/nou', '/loturi/nou', { batch_no: 'L-XL-1', construction_id: String(xl) });
  const xb1 = Number(/\/loturi\/(\d+)/.exec(p2.location)[1]);
  const form = await ctc.get(`/masuratori/nou?family=${ids.fam}&batch=${xb1}&machine=${ids.machine}`);
  assert.match(form.text, /name="t_hot_set_load"/);
  assert.ok(!/name="t_hot_set_perm"/.test(form.text), 'deactivated test is gone');
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action IN ('test_type_add','test_type_change')") >= 3);
});

test('hostile text in batch data and test notes is escaped; exports carry the cable records', async () => {
  const evil = '<script>alert(1)</script>';
  let r = await ctc.postForm('/loturi/nou', '/loturi/nou', { batch_no: 'L-EVIL', order_no: evil, construction_id: String(app.db.get("SELECT id FROM constructions WHERE label = 'N2XH 4x35 0,6/1 kV' AND revision_id = (SELECT id FROM spec_revisions WHERE status = 'activa' AND document_id = ?)", ids.doc).id), standard: 'HD 603' });
  assert.equal(r.status, 303);
  const id = Number(/\/loturi\/(\d+)/.exec(r.location)[1]);
  for (const u of ['/loturi', `/loturi/${id}`, `/loturi/${id}/certificat`, '/masuratori/nou']) {
    const p = await ctc.get(u);
    assert.ok(!p.text.includes('<script>alert(1)'), u);
  }
  const csv = await ctc.get('/masuratori/export?format=csv');
  assert.equal(csv.status, 200);
  const long = await fetch(app.base + '/masuratori/export?format=xlsx', { headers: { Cookie: ctc.cookieHeader() } });
  assert.equal(long.status, 200);
  const an = await ctc.get('/analize/distributie?quantity=ins_thick_avg');
  assert.equal(an.status, 200);
});

test('cable pages keep the language rules', async () => {
  const bad = /[şţŞŢ]/;
  const some = app.db.get('SELECT record_no FROM measurements WHERE batch_id IS NOT NULL LIMIT 1').record_no;
  const cert = app.db.get('SELECT id FROM batch_certificates LIMIT 1').id;
  for (const [c, u] of [[ctc, '/loturi'], [ctc, '/loturi/nou'], [ctc, `/loturi/${ids.batch}`], [ctc, `/loturi/${ids.batch}/certificat`], [ctc, `/certificate/${cert}`], [ctc, `/masuratori/nou?family=${ids.fam}&batch=${ids.batch}&machine=${ids.machine}`],
    [ctc, `/masuratori/${some}`], [ctc, `/masuratori/${some}/corecteaza`], [ctc, `/proiecte-cablu/${ids.design}/raport-tip`], [engA, '/liste/incercari'], [engA, '/liste/compusi'], [engA, '/liste/standarde'], [engA, '/liste']]) {
    const r = await c.get(u);
    const t = textOf(r.text);
    assert.equal(r.status, 200, u);
    assert.ok(!bad.test(t) && !/⟦|undefined|NaN|\[object/.test(t), `${u}: ${(/.{25}(⟦|undefined|NaN|\[object).{25}/.exec(t) || [''])[0]}`);
  }
});

test('print language: any printed page can be shown in another language; a certificate is frozen in the language it was issued in', async () => {
  // a printed data sheet follows ?lang= (the toolbar has the language choice)
  const sheetUrl = `/fise/${ids.doc}/revizii/${ids.rev}/tipar`;
  const ro = (await engA.get(sheetUrl)).text;
  const en = (await engA.get(`${sheetUrl}?lang=en`)).text;
  assert.ok(ro.includes('lang="ro"') && en.includes('lang="en"'));
  assert.match(textOf(ro), /Semnătura/);
  assert.match(textOf(en), /Signature/);
  assert.ok(!/Semnătura/.test(textOf(en)));
  assert.ok(en.includes('name="lang"') && en.includes('data-autosubmit'), 'the toolbar offers the language choice');
  assert.ok((await engA.get(`${sheetUrl}?lang=xx`)).text.includes('lang="ro"'), 'an unknown language is ignored');
  // the preview follows ?lang= too
  assert.match(textOf((await ctc.get(`/loturi/${ids.batch}/certificat?lang=en`)).text), /PREVIEW/);
  // the issue form has a language choice; the certificate keeps it for every viewer
  assert.ok((await engA.get(`/loturi/${ids.batch}`)).text.includes('name="lang"'));
  const r = await engA.postForm(`/loturi/${ids.batch}`, `/loturi/${ids.batch}/certificat/emite`, { lang: 'en', override_reason: 'Accepted by the customer' });
  assert.equal(r.status, 303, textOf(r.text).slice(0, 300));
  const c = app.db.get('SELECT * FROM batch_certificates ORDER BY id DESC');
  assert.equal(JSON.parse(c.snapshot).lang, 'en');
  const viewer = textOf((await ctc.get(`/certificate/${c.id}`)).text); // a Romanian-language user
  assert.match(viewer, /Batch test certificate/);
  assert.match(viewer, /Certificate no\./);
  assert.ok(!/Certificat de încercări|Elaborat/.test(viewer));
  assert.ok(!(await ctc.get(`/certificate/${c.id}`)).text.includes('name="lang"'), 'no language switch on an issued certificate');
  // an older certificate stays Romanian
  const old = app.db.get('SELECT * FROM batch_certificates ORDER BY id ASC');
  assert.match(textOf((await ctc.get(`/certificate/${old.id}`)).text), /Certificat de încercări pe lot/);
});
