'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const rev = require('../domain/revisions');
const { createApp } = require('../app');

let app, admin, engA, engB, ctc;
const ids = {};

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Inginer A');
  engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Inginer B');
  ctc = await makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const db = app.db;
  for (const [k, t] of [['wire', 'A6_TREFILARE_CL12'], ['cl5', 'A6_TREFILARE_CL5'], ['extr', 'EXTRUDAT_AL_CL1'], ['al', 'CABLARE_RIGIDA_AL']]) {
    ids[k + 'Doc'] = db.get('SELECT id FROM spec_documents WHERE doc_type = ?', t).id;
    ids[k + 'Rev'] = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', ids[k + 'Doc']).id;
  }
  ids.famWire = db.get("SELECT id FROM product_families WHERE code = 'SARMA_CL12'").id;
  ids.famCl5 = db.get("SELECT id FROM product_families WHERE code = 'SARMA_CL5'").id;
  ids.sample = db.get("SELECT id FROM sample_types WHERE name = 'Probă de pornire'").id;
});
test.after(async () => { await app.cleanup(); });

async function activate(docId, revId) {
  assert.equal((await engA.postForm(`/fise/${docId}/revizii/${revId}`, `/fise/${docId}/revizii/${revId}/trimite`, {})).status, 303);
  assert.equal((await engB.postForm(`/fise/${docId}/revizii/${revId}`, `/fise/${docId}/revizii/${revId}/verifica`, {})).status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', revId).status, 'activa');
}

const construction = (revId, where, ...p) => app.db.get(`SELECT c.* FROM constructions c JOIN shapes s ON s.id = c.shape_id JOIN materials m ON m.id = c.material_id
  LEFT JOIN destinations d ON d.id = c.destination_id WHERE c.revision_id = ? AND ${where}`, revId, ...p);

async function addMachine(list, name, typeName) {
  const type = app.db.get('SELECT id FROM machine_types WHERE name = ?', typeName).id;
  const r = await engA.postForm(`/liste/${list}`, `/liste/${list}/adauga`, { name, machine_type_id: String(type) });
  assert.equal(r.status, 303);
  return app.db.get('SELECT id FROM machines WHERE name = ?', name).id;
}

const record = (r) => Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
const results = (no) => Object.fromEntries(app.db.all('SELECT r.* FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ? AND m.is_current = 1', no).map((x) => [x.quantity, x]));

test('wire families are active for measurement and their sheets are editable', async () => {
  assert.deepEqual(app.db.all('SELECT code FROM product_families WHERE active = 1 ORDER BY code').map((r) => r.code), ['EXTRUDAT_AL', 'FUNIE_RIGIDA', 'SARMA_CL12', 'SARMA_CL5']);
  // class V wire reads the class V data sheet, whose own family (flexible) stays for stage 3
  const flex = rev.familyOf(app.db, app.db.get('SELECT family_id FROM spec_documents WHERE id = ?', ids.cl5Doc).family_id);
  assert.equal(flex.active, 0);
  assert.equal(rev.docFamilyActive(app.db, flex), true);
  const page = await engA.get(`/fise/${ids.cl5Doc}/revizii/${ids.cl5Rev}`);
  assert.match(page.text, /Trimite la verificare/);
  assert.ok(!/etapă următoare/.test(page.text));
  assert.equal((await engA.get(`/fise/${ids.cl5Doc}/revizii/${ids.cl5Rev}/constructii/${construction(ids.cl5Rev, 'c.section = 25').id}`)).status, 200);
  // the class V wire diameter row is editable
  assert.match((await engA.get(`/fise/${ids.cl5Doc}/revizii/${ids.cl5Rev}/constructii/${construction(ids.cl5Rev, 'c.section = 25').id}`)).text, /Ø sârmă/);
});

test('class I–II wire: diameter (two readings) and mass in kg/km, no theoretical resistance', async () => {
  await activate(ids.wireDoc, ids.wireRev);
  const mach = await addMachine('utilaje', 'TREF 1', 'Trefilare');
  const c = construction(ids.wireRev, "c.label = '6 RE' AND m.code = 'Al' AND c.destination_id IS NULL");
  assert.ok(c);
  const page = await ctc.get(`/masuratori/nou?family=${ids.famWire}&machine=${mach}&construction=${c.id}`);
  assert.match(page.text, /name="d1"/);
  assert.ok(!/name="r_value"/.test(page.text)); // aluminium wire: no measured resistance
  assert.match(page.text, /g\/m este egal cu kg\/km/);
  const post = (extra) => ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(ids.famWire), machine_id: String(mach), construction_id: String(c.id), sample_type_id: String(ids.sample), sample_mm: '1000', ...extra });
  let r = await post({ d1: '2,78', d2: '2.781', mass_g: '16.38' });
  assert.equal(r.status, 303);
  let res = results(record(r));
  assert.equal(res.d1.verdict, 'ok');
  assert.equal(res.d2.verdict, 'ok');
  assert.equal(res.mass_gm.verdict, 'ok');
  assert.equal(res.mass_gm.lim_min, 16.35);
  assert.ok(!res.r20_theor && !res.d_ech, 'no theoretical resistance for a drawn wire');
  r = await post({ d1: '2,78', d2: '2.79', mass_g: '16.5' });
  res = results(record(r));
  assert.equal(res.d2.verdict, 'peste');
  assert.equal(res.mass_gm.verdict, 'peste');
  // list shows destination and die to tell duplicates apart
  const sel = await ctc.get(`/masuratori/nou?family=${ids.famWire}&machine=${mach}`);
  assert.match(sel.text, /Unifilar/);
  assert.match(sel.text, /Multifilar/);
  // a wire is always round: sector-shaped conductor rows still ask for two diameters
  const sm = construction(ids.wireRev, "s.code IN ('SM','SM90','SM72','SM120') AND m.code = 'Al'");
  const form = await ctc.get(`/masuratori/nou?family=${ids.famWire}&machine=${mach}&construction=${sm.id}`);
  assert.match(form.text, /name="d1"/);
  assert.ok(!/name="h"/.test(form.text));
  // register and home show the diameters of wire rows
  const reg = await ctc.get('/masuratori');
  assert.match(reg.text, /2,78/);
});

test('copper unifilar RE wire: measured resistance against IEC Tab. 3; multifilar wire has none', async () => {
  const mach = app.db.get("SELECT id FROM machines WHERE name = 'TREF 1'").id;
  const uni = construction(ids.wireRev, "m.code = 'Cu' AND s.code = 'RE' AND d.name = 'Unifilar'");
  const mul = construction(ids.wireRev, "m.code = 'Cu' AND s.code = 'RE' AND d.name = 'Multifilar'");
  const pageU = await ctc.get(`/masuratori/nou?family=${ids.famWire}&machine=${mach}&construction=${uni.id}`);
  assert.match(pageU.text, /name="r_value"/);
  const pageM = await ctc.get(`/masuratori/nou?family=${ids.famWire}&machine=${mach}&construction=${mul.id}`);
  assert.ok(!/name="r_value"/.test(pageM.text));
  const lim = app.db.get("SELECT r_max FROM iec_limits WHERE iec_class = 1 AND material = 'Cu' AND coated = 0 AND section = ?", uni.section).r_max;
  const post = (rv) => ctc.postForm('/masuratori/nou', '/masuratori/nou', {
    family_id: String(ids.famWire), machine_id: String(mach), construction_id: String(uni.id), sample_type_id: String(ids.sample),
    d1: String(uni.wire_d), d2: String(uni.wire_d), mass_g: '10', r_value: String(rv), r_unit: 'ohm_km', temp_c: '20',
  });
  let res = results(record(await post(lim * 0.95)));
  assert.equal(res.r20.verdict, 'ok');
  assert.equal(res.r20.lim_max, lim);
  assert.match(res.r20.source, /Tab\. 3/);
  res = results(record(await post(lim * 1.02)));
  assert.equal(res.r20.verdict, 'peste');
  assert.ok(Math.abs(res.r20.deviation_pct - 2) < 1e-6);
});

test('class V: IEC wire diameter blocks activation until an exception is recorded; wire diameter is checked, no mass', async () => {
  const c25 = construction(ids.cl5Rev, 'c.section = 25 AND c.wire_d > 0.41');
  assert.ok(c25, 'the 25 mm² row with Ø 0.413 exists');
  const f = rev.checkRevision(app.db, ids.cl5Rev);
  assert.ok(f.some((x) => x.level === 'error' && x.code === 'wire_d_over_max'));
  assert.equal((await engA.postForm(`/fise/${ids.cl5Doc}/revizii/${ids.cl5Rev}`, `/fise/${ids.cl5Doc}/revizii/${ids.cl5Rev}/trimite`, {})).status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', ids.cl5Rev).status, 'ciorna');
  app.db.run("UPDATE constructions SET iec_exception_reason = 'Acceptat de client' WHERE id = ?", c25.id);
  await activate(ids.cl5Doc, ids.cl5Rev);
  const mach = await addMachine('utilaje', 'TMF 1', 'Trefilare multifilară');
  const c = construction(ids.cl5Rev, "c.section = 0.5 AND c.die LIKE '8 x%'");
  const page = await ctc.get(`/masuratori/nou?family=${ids.famCl5}&machine=${mach}&construction=${c.id}`);
  assert.match(page.text, /name="d1"/);
  assert.ok(!/name="mass_g"/.test(page.text), 'class V wire has no mass');
  assert.match(page.text, /8 x /); // die shown to pick the right row
  const r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(ids.famCl5), machine_id: String(mach), construction_id: String(c.id), sample_type_id: String(ids.sample), d1: '0,189', d2: '0.190' });
  assert.equal(r.status, 303);
  const res = results(record(r));
  assert.equal(res.d1.verdict, 'nedeterminat'); // only the nominal is on the sheet
  assert.ok(!res.mass_gm);
  // the engineer sees statistics as the basis for min / max
  const st = await engA.get(`/fise/constructie/${c.id}/statistici`);
  assert.equal(st.status, 200);
  assert.match(st.text, /Ø mediu/);
});

test('printed documents: header, footer, exemplar, status banner, code and edition', async () => {
  // active wire sheet
  let r = await engA.get(`/fise/${ids.wireDoc}/revizii/${ids.wireRev}/tipar?exemplar=2%2F5`);
  assert.equal(r.status, 200);
  const t = textOf(r.text);
  assert.match(t, /S\.C\. ROMCAB S\.A\./);
  assert.match(t, /Cupru/);
  assert.match(t, /Aluminiu purtător/);
  assert.match(t, /Aluminiu EVN/);
  assert.match(t, /Elaborat/);
  assert.match(t, /Verificat: Inginer B/);
  assert.match(t, /Semnătura/);
  assert.match(t, /Exemplar: 2\/5/);
  assert.ok(!/nu este document în vigoare/.test(t));
  assert.match(r.text, /<thead>[\s\S]*doc-head/);
  assert.match(r.text, /<tfoot>[\s\S]*doc-foot/);
  assert.match(r.text, /print\.css/);
  // a draft prints with a banner
  r = await engA.get(`/fise/${ids.alDoc}/revizii/${ids.alRev}/tipar`);
  assert.match(textOf(r.text), /nu este document în vigoare/);
  // every role can print, every sheet type renders
  for (const [d, v] of [[ids.wireDoc, ids.wireRev], [ids.cl5Doc, ids.cl5Rev], [ids.alDoc, ids.alRev], [ids.extrDoc, ids.extrRev]]) {
    for (const c of [ctc, admin]) assert.equal((await c.get(`/fise/${d}/revizii/${v}/tipar`)).status, 200);
  }
  assert.match(textOf((await ctc.get(`/fise/${ids.cl5Doc}/revizii/${ids.cl5Rev}/tipar`)).text), /Secțiuni 10 – 400 mm²/);
  assert.match(textOf((await ctc.get(`/fise/${ids.extrDoc}/revizii/${ids.extrRev}/tipar`)).text), /Conductori sector \(SE\)/);
  assert.match(textOf((await ctc.get(`/fise/${ids.extrDoc}/revizii/${ids.extrRev}/tipar`)).text), /excep|nota a/i);
  assert.equal((await ctc.get(`/fise/${ids.wireDoc}/revizii/999/tipar`)).status, 404);
  assert.equal((await ctc.get(`/fise/${ids.alDoc}/revizii/${ids.wireRev}/tipar`)).status, 404);
});

test('printed sheet marks values changed against the previous revision in red', async () => {
  // new revision of the wire sheet: change the mass limit of one row
  assert.equal((await engA.postForm(`/fise/${ids.wireDoc}`, `/fise/${ids.wireDoc}/revizii/noua`, {})).status, 303);
  const draft = app.db.get("SELECT id FROM spec_revisions WHERE document_id = ? AND status = 'ciorna'", ids.wireDoc).id;
  const c = construction(draft, "c.label = '6 RE' AND m.code = 'Al' AND c.destination_id IS NULL");
  const cons = rev.loadConstructions(app.db, draft, { onlyActive: true }).find((x) => x.id === c.id);
  const user = app.db.get("SELECT * FROM users WHERE username = 'ing.a'");
  const data = {
    material_id: cons.material_id, section: cons.section, shape_id: cons.shape_id, destination_id: cons.destination_id, coated: cons.coated, label: cons.label,
    wires: cons.wires, wire_d: cons.wire_d, die: cons.die, iec_exception_reason: '', params: cons.params,
    limits: cons.limits.map((l) => (l.quantity === 'mass' ? { ...l, min: 16.36, max: 16.41 } : l)),
  };
  assert.ok(rev.saveConstruction(app.db, user, draft, c.id, data).ok);
  const r = await engA.get(`/fise/${ids.wireDoc}/revizii/${draft}/tipar`);
  assert.equal((r.text.match(/<td class="changed">/g) || []).length, 1);
  assert.match(r.text, /<td class="changed">16,36 … 16,41<\/td>/);
  assert.match(textOf(r.text), /Valorile scrise cu roșu/);
  await activate(ids.wireDoc, draft);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', ids.wireRev).status, 'arhivata');
  // the archived revision stays printable
  assert.equal((await ctc.get(`/fise/${ids.wireDoc}/revizii/${ids.wireRev}/tipar`)).status, 200);
});

test('printed register: filtered selection, landscape, escaped text', async () => {
  const mach = app.db.get("SELECT id FROM machines WHERE name = 'TREF 1'").id;
  const c = construction(app.db.get("SELECT id FROM spec_revisions WHERE document_id = ? AND status = 'activa'", ids.wireDoc).id, "c.label = '6 RE' AND m.code = 'Al' AND c.destination_id IS NULL");
  const r0 = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(ids.famWire), machine_id: String(mach), construction_id: String(c.id), sample_type_id: String(ids.sample), d1: '2.78', d2: '2.78', mass_g: '16.38', notes: '<b>x</b>' });
  assert.equal(r0.status, 303);
  const all = await ctc.get('/masuratori/tipar');
  assert.equal(all.status, 200);
  assert.match(all.text, /print-landscape\.css/);
  assert.ok(!all.text.includes('<b>x</b>'));
  assert.match(textOf(all.text), /Registru măsurători/);
  assert.match(textOf(all.text), /Tipărit de Operator CTC/);
  const onlyOut = await ctc.get('/masuratori/tipar?out=1');
  const nAll = (all.text.match(/<tr><td>\d+/g) || []).length;
  const nOut = (onlyOut.text.match(/<tr><td>\d+/g) || []).length;
  assert.ok(nAll > nOut && nOut > 0, `${nAll} vs ${nOut}`);
  assert.match(textOf(onlyOut.text), /Doar cu valori în afara limitelor/);
  const link = await ctc.get('/masuratori?out=1');
  assert.match(link.text, /\/masuratori\/tipar\?out=1/);
  // the static route order: /masuratori/tipar is not a record number
  assert.equal((await ctc.get('/masuratori/tipar?family_id=999')).status, 200);
});

test('migration 002 upgrades a stage-1 database', async () => {
  const fresh = await startApp();
  try {
    const db = fresh.db;
    // put the database back into its stage-1 shape
    db.run("UPDATE shapes SET iec_group = 'circular' WHERE code = 'RM'");
    db.run("DELETE FROM machines WHERE name = 'Conform Extruder'");
    db.run("UPDATE product_families SET active = 0 WHERE code IN ('SARMA_CL12','SARMA_CL5')");
    db.run("UPDATE product_families SET measures = json_remove(measures, '$.spec_family') WHERE code = 'SARMA_CL5'");
    db.run("DELETE FROM limits WHERE level = 'sarma' AND construction_id IN (SELECT id FROM constructions WHERE family_id = (SELECT id FROM product_families WHERE code = 'FLEXIBIL_CL5'))");
    db.run('DELETE FROM schema_migrations WHERE version = 2');
    const cfg = fresh.config;
    await fresh.stop();
    const logs = [];
    const again = await createApp(cfg, { listen: { port: 0, host: '127.0.0.1' }, log: (m) => logs.push(m), noScheduler: true });
    try {
      assert.match(logs.join('\n'), /Backup înainte de migrare/);
      assert.equal(again.db.get("SELECT iec_group FROM shapes WHERE code = 'RM'").iec_group, 'compactat');
      assert.equal(again.db.value("SELECT count(*) FROM machines WHERE name = 'Conform Extruder'"), 1);
      assert.deepEqual(again.db.all('SELECT code FROM product_families WHERE active = 1 ORDER BY code').map((r) => r.code), ['EXTRUDAT_AL', 'FUNIE_RIGIDA', 'SARMA_CL12', 'SARMA_CL5']);
      assert.equal(JSON.parse(again.db.get("SELECT measures FROM product_families WHERE code = 'SARMA_CL5'").measures).spec_family, 'FLEXIBIL_CL5');
      assert.equal(again.db.value("SELECT count(*) FROM limits WHERE level = 'sarma' AND construction_id IN (SELECT id FROM constructions WHERE family_id = (SELECT id FROM product_families WHERE code = 'FLEXIBIL_CL5'))"), 27);
    } finally {
      fresh.db = again.db;
      fresh.stop = again.stop;
      fresh.server = again.server;
    }
  } finally {
    await fresh.cleanup();
  }
});

test('stage 2 pages keep the language rules', async () => {
  const bad = /[şţŞŢ]/;
  for (const u of [`/fise/${ids.wireDoc}/revizii/${ids.wireRev}/tipar`, '/masuratori/tipar', `/fise/${ids.cl5Doc}/revizii/${ids.cl5Rev}`, '/masuratori/nou']) {
    const r = await admin.get(u);
    const t = textOf(r.text);
    assert.equal(r.status, 200, u);
    assert.ok(!bad.test(t) && !/⟦|undefined|NaN/.test(t), u);
  }
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'print.css')));
});
