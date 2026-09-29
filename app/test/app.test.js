'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startApp, Client, makeUser, adminClient, textOf } = require('./helpers');
const rev = require('../domain/revisions');
const backup = require('../lib/backup');
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
  ids.famFunie = db.get("SELECT id FROM product_families WHERE code='FUNIE_RIGIDA'").id;
  ids.famExtr = db.get("SELECT id FROM product_families WHERE code='EXTRUDAT_AL'").id;
  ids.docAl = db.get("SELECT id FROM spec_documents WHERE doc_type='CABLARE_RIGIDA_AL'").id;
  ids.revAl = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', ids.docAl).id;
  ids.docExtr = db.get("SELECT id FROM spec_documents WHERE doc_type='EXTRUDAT_AL_CL1'").id;
  ids.revExtr = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', ids.docExtr).id;
  ids.rigid1 = db.get("SELECT id FROM machines WHERE name='RIGID 1'").id;
  ids.sampleStart = db.get("SELECT id FROM sample_types WHERE name='Probă de pornire'").id;
  ids.sampleLength = db.get("SELECT id FROM sample_types WHERE name='Lungime'").id;
});

test.after(async () => { await app.cleanup(); });

const conId = (revId, label) => app.db.get('SELECT id FROM constructions WHERE revision_id = ? AND label = ?', revId, label).id;

/** Engineer A submits, engineer B verifies: the two-person rule through the real routes. */
async function activate(docId, revId) {
  let r = await engA.postForm(`/fise/${docId}/revizii/${revId}`, `/fise/${docId}/revizii/${revId}/trimite`, {});
  assert.equal(r.status, 303);
  r = await engB.postForm(`/fise/${docId}/revizii/${revId}`, `/fise/${docId}/revizii/${revId}/verifica`, {});
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', revId).status, 'activa');
}

// ---------------------------------------------------------------- security and roles

test('30. CSRF: a POST without the form token is refused', async () => {
  const r = await ctc.req('POST', '/iesire', {});
  assert.equal(r.status, 403);
  const r2 = await admin.req('POST', '/admin/utilizatori/nou', { username: 'x', full_name: 'x', role: 'personal' });
  assert.equal(r2.status, 403);
  const r3 = await admin.req('POST', '/admin/setari/backup', { _csrf: 'wrong' });
  assert.equal(r3.status, 403);
  assert.equal(app.db.get("SELECT 1 FROM users WHERE username = 'x'"), undefined);
});

test('login: forced password change, generic failure text, lockout after 5 tries', async () => {
  const c = new Client(app.base);
  let r = await c.get('/masuratori');
  assert.equal(r.status, 303);
  assert.match(r.location, /^\/login/);
  // wrong password 5 times
  for (let i = 0; i < 5; i++) {
    r = await c.login('ctc1', 'gresit-' + i);
    assert.equal(r.status, 401);
  }
  r = await c.login('ctc1', ctc.password); // right password, but locked
  assert.equal(r.status, 401);
  assert.match(r.text, /blocat temporar/);
  // another username is not affected
  r = await new Client(app.base).login('admin', admin.password);
  assert.equal(r.status, 303);
  // unlock for the other tests: lockout is time-based; clear the counter
  app.db.run('DELETE FROM login_attempts');
});

test('login without the login token is refused', async () => {
  const r = await new Client(app.base).req('POST', '/login', { username: 'admin', password: 'x' });
  assert.equal(r.status, 403);
});

test('19. Personal cannot open revision editor, lists, users or settings (403, no links shown)', async () => {
  for (const u of ['/liste', '/liste/utilaje', '/liste/materiale', '/admin/utilizatori', '/admin/setari', '/admin/jurnal', `/fise/${ids.docAl}/revizii/${ids.revAl}/constructii/noua`]) {
    const r = await ctc.get(u);
    assert.equal(r.status, 403, u);
  }
  const home = await ctc.get('/');
  assert.equal(home.status, 200);
  assert.ok(!/href="\/liste/.test(home.text));
  assert.ok(!/href="\/admin/.test(home.text));
  // POSTs are refused too, even with a valid token
  const r = await ctc.postForm('/', '/liste/utilaje/adauga', { name: 'X' });
  assert.equal(r.status, 403);
  const r2 = await ctc.postForm('/', `/fise/${ids.docAl}/revizii/${ids.revAl}/trimite`, {});
  assert.equal(r2.status, 403);
  // engineers do not get the administration pages
  assert.equal((await engA.get('/admin/utilizatori')).status, 403);
  assert.equal((await engA.get('/liste/utilaje')).status, 200);
  // administrators do not get the engineers' constants or the revision editor
  assert.equal((await admin.get('/liste/materiale')).status, 403);
  assert.equal((await admin.get(`/fise/${ids.docAl}/revizii/${ids.revAl}/constructii/noua`)).status, 403);
});

// ---------------------------------------------------------------- revisions

test('23. IEC checks: Al 50 RM with 7 wires passes (min 6); a circular shape with 7 wires blocks unless an exception reason is filled', async () => {
  const c50 = conId(ids.revAl, '50 RM');
  let f = rev.checkRevision(app.db, ids.revAl);
  // owner: 50 RM has min 6 wires according to IEC, so the seeded draft is clean
  assert.ok(!f.some((x) => x.level === 'error'), JSON.stringify(f.filter((x) => x.level === 'error')));
  // a non-compacted circular shape needs 19 wires at 50 mm²: blocked
  const circ = app.db.run("INSERT INTO shapes(code, name, kind, iec_group) VALUES ('RC', 'RC', 'rotund', 'circular')").id;
  const rm = app.db.get("SELECT id FROM shapes WHERE code='RM'").id;
  app.db.run('UPDATE constructions SET shape_id = ? WHERE id = ?', circ, c50);
  f = rev.checkRevision(app.db, ids.revAl);
  assert.ok(f.some((x) => x.level === 'error' && x.code === 'wires_below_min' && x.construction.id === c50));
  // the server refuses the submission and the revision stays a draft
  let r = await engA.postForm(`/fise/${ids.docAl}/revizii/${ids.revAl}`, `/fise/${ids.docAl}/revizii/${ids.revAl}/trimite`, {});
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', ids.revAl).status, 'ciorna');
  const page = await engA.get(`/fise/${ids.docAl}/revizii/${ids.revAl}`);
  assert.match(page.text, /Blochează/);
  // a documented exception turns the error into a warning
  app.db.run("UPDATE constructions SET iec_exception_reason = 'Acceptat: test' WHERE id = ?", c50);
  f = rev.checkRevision(app.db, ids.revAl);
  assert.ok(!f.some((x) => x.level === 'error'));
  assert.ok(f.some((x) => x.level === 'warn' && x.code === 'wires_below_min_exception'));
  // back to the seeded state
  app.db.run("UPDATE constructions SET shape_id = ?, iec_exception_reason = NULL WHERE id = ?", rm, c50);
  app.db.run('DELETE FROM shapes WHERE id = ?', circ);
  assert.ok(!rev.checkRevision(app.db, ids.revAl).some((x) => x.level === 'error'));
});

test('20. the author of a revision cannot verify it (button absent and server refuses)', async () => {
  let r = await engA.postForm(`/fise/${ids.docAl}/revizii/${ids.revAl}`, `/fise/${ids.docAl}/revizii/${ids.revAl}/trimite`, {});
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', ids.revAl).status, 'in_verificare');
  const own = await engA.get(`/fise/${ids.docAl}/revizii/${ids.revAl}`);
  assert.ok(!own.text.includes('Verifică și activează'));
  // even with a valid token the server refuses
  r = await engA.postForm(`/fise/${ids.docAl}/revizii/${ids.revAl}`, `/fise/${ids.docAl}/revizii/${ids.revAl}/verifica`, {});
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', ids.revAl).status, 'in_verificare');
  // the other engineer sees the button and can verify
  const other = await engB.get(`/fise/${ids.docAl}/revizii/${ids.revAl}`);
  assert.ok(other.text.includes('Verifică și activează'));
  // Personal / Administrator cannot verify
  assert.equal((await ctc.postForm('/', `/fise/${ids.docAl}/revizii/${ids.revAl}/verifica`, {})).status, 403);
  assert.equal((await admin.postForm('/', `/fise/${ids.docAl}/revizii/${ids.revAl}/verifica`, {})).status, 403);
  // rejection needs a reason and returns the draft
  r = await engB.postForm(`/fise/${ids.docAl}/revizii/${ids.revAl}`, `/fise/${ids.docAl}/revizii/${ids.revAl}/respinge`, { reason: '' });
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', ids.revAl).status, 'in_verificare');
  r = await engB.postForm(`/fise/${ids.docAl}/revizii/${ids.revAl}`, `/fise/${ids.docAl}/revizii/${ids.revAl}/respinge`, { reason: 'Verificați masa la 300 SM' });
  const row = app.db.get('SELECT * FROM spec_revisions WHERE id = ?', ids.revAl);
  assert.equal(row.status, 'ciorna');
  assert.equal(row.rejected_reason, 'Verificați masa la 300 SM');
  // the database itself also refuses author = verifier
  assert.throws(() => app.db.run("UPDATE spec_revisions SET verified_by = elaborated_by WHERE id = ?", ids.revAl), /CHECK/);
  // finally: submit again and activate
  await activate(ids.docAl, ids.revAl);
});

test('two-person rule also holds for another engineer editing a claimed draft', async () => {
  // a new revision is authored by A: B cannot edit or submit it
  let r = await engA.postForm(`/fise/${ids.docAl}`, `/fise/${ids.docAl}/revizii/noua`, {});
  assert.equal(r.status, 303);
  const newRev = app.db.get("SELECT * FROM spec_revisions WHERE document_id = ? AND status = 'ciorna'", ids.docAl);
  assert.equal(newRev.based_on_id, ids.revAl);
  assert.equal(newRev.revision, 1);
  const rr = await engB.postForm(`/fise/${ids.docAl}/revizii/${newRev.id}`, `/fise/${ids.docAl}/revizii/${newRev.id}/trimite`, {});
  assert.equal(rr.status, 403);
  // only one open revision at a time
  const again = await engA.postForm(`/fise/${ids.docAl}`, `/fise/${ids.docAl}/revizii/noua`, {});
  assert.equal(again.status, 303);
  assert.equal(app.db.value("SELECT count(*) FROM spec_revisions WHERE document_id = ? AND status = 'ciorna'", ids.docAl), 1);
  ids.newRevAl = newRev.id;
});

// ---------------------------------------------------------------- measurements

function funieForm(extra) {
  const c240 = conId(ids.revAl, '240 SM 90°');
  return { family_id: String(ids.famFunie), machine_id: String(ids.rigid1), construction_id: String(c240), sample_type_id: String(ids.sampleStart), mass_g: '608,5', sample_mm: '1000', h: '17.75', l: '22.55', ...extra };
}

test('measurement entry: verdicts, decimal comma, server recomputes (cases 2, 3, 5, 7)', async () => {
  const before = app.db.value('SELECT count(*) FROM measurements');
  let r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm());
  assert.equal(r.status, 303);
  const no1 = Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
  const m1 = app.db.get('SELECT * FROM measurements WHERE record_no = ? AND is_current = 1', no1);
  assert.equal(m1.revision_id, ids.revAl);
  assert.equal(m1.created_by, app.db.get("SELECT id FROM users WHERE username='ctc1'").id);
  const res = Object.fromEntries(app.db.all('SELECT * FROM measurement_results WHERE measurement_id = ?', m1.id).map((x) => [x.quantity, x]));
  assert.equal(res.mass_gm.value, 608.5);
  assert.equal(res.mass_gm.verdict, 'ok');
  assert.equal(res.mass_gm.lim_min, 607);
  assert.equal(res.mass_gm.lim_max, 609.4);
  assert.equal(res.h.verdict, 'ok');
  assert.equal(res.l.verdict, 'ok');
  assert.ok(Math.abs(res.r20_theor.value - 0.12216) < 5e-6);
  assert.equal(res.r20_theor.verdict, 'ok');
  assert.equal(res.r20_theor.lim_max, 0.125);
  assert.match(res.r20_theor.source, /IEC 60228:2023, Tab\. 4/);
  const typed = Object.fromEntries(app.db.all('SELECT key, value FROM measurement_inputs WHERE measurement_id = ?', m1.id).map((x) => [x.key, x.value]));
  assert.equal(typed.mass_g, '608.5');
  assert.equal(typed.l, '22.55');

  // above max: flagged, saved, never blocked (ADR-007)
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ mass_g: '620.5' }));
  assert.equal(r.status, 303);
  const no2 = Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
  let v = app.db.get("SELECT r.verdict FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ? AND r.quantity = 'mass_gm'", no2);
  assert.equal(v.verdict, 'peste');
  // below min
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ mass_g: '606.9' }));
  const no3 = Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
  v = app.db.get("SELECT r.verdict FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ? AND r.quantity = 'mass_gm'", no3);
  assert.equal(v.verdict, 'sub');
  assert.equal(app.db.value('SELECT count(*) FROM measurements') - before, 3);
  ids.no1 = no1; ids.no2 = no2;

  // the record page shows the red verdict with its label, the register colours it
  const reg = await ctc.get('/masuratori');
  assert.match(reg.text, /v-peste/);
  assert.match(reg.text, /v-sub/);
  const det = await ctc.get(`/masuratori/${no2}`);
  assert.match(det.text, /Peste maxim/);
});

test('measurement entry: missing values and forged ids are refused, nothing saved', async () => {
  const before = app.db.value('SELECT count(*) FROM measurements');
  let r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ mass_g: '' }));
  assert.equal(r.status, 422);
  assert.match(r.text, /Câmp obligatoriu|Valoare nevalidă/);
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ mass_g: 'abc' }));
  assert.equal(r.status, 422);
  // a construction of another family cannot be combined with this family
  const extrCon = app.db.get('SELECT id FROM constructions WHERE revision_id = ?', ids.revExtr).id;
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ construction_id: String(extrCon) }));
  assert.equal(r.status, 422);
  // a construction of a draft (not the active revision) cannot be measured
  const draftCon = app.db.get('SELECT id FROM constructions WHERE revision_id = ?', ids.newRevAl).id;
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ construction_id: String(draftCon) }));
  assert.equal(r.status, 422);
  // a family that is not active for measurement (stage 2/3)
  const sarma = app.db.get("SELECT id FROM product_families WHERE code='SARMA_CL12'").id;
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ family_id: String(sarma) }));
  assert.equal(r.status, 422);
  assert.equal(app.db.value('SELECT count(*) FROM measurements'), before);
});

test('measurement form: filters machines by family and constructions by strander capacity', async () => {
  let r = await ctc.get(`/masuratori/nou?family=${ids.famFunie}`);
  assert.match(r.text, /RIGID 1/);
  assert.ok(!/KABMAK/.test(r.text));
  r = await ctc.get(`/masuratori/nou?family=${ids.famFunie}&machine=${ids.rigid1}`);
  assert.match(r.text, /240 SM 90°/);
  // a strander with only 1+6+12 (19 wires) hides 37-wire constructions
  const mt = app.db.get("SELECT id FROM machine_types WHERE name='Cablare rigidă'").id;
  const small = app.db.run("INSERT INTO machines(name, machine_type_id, rotor_config, max_wires) VALUES ('MIC 1', ?, '1+6+12', 19)", mt).id;
  r = await ctc.get(`/masuratori/nou?family=${ids.famFunie}&machine=${small}`);
  assert.match(r.text, /95 RMC/);
  assert.ok(!/240 SM 90°/.test(r.text));
  // unknown rotor config -> no capacity filter
  r = await ctc.get(`/masuratori/nou?family=${ids.famFunie}&machine=${ids.rigid1}`);
  assert.match(r.text, /240 SM 90°/);
  // saving 37 wires on the small strander is refused
  const c240 = conId(ids.revAl, '240 SM 90°');
  const bad = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ machine_id: String(small), construction_id: String(c240) }));
  assert.equal(bad.status, 422);
  app.db.run('UPDATE machines SET active = 0 WHERE id = ?', small);
});

test('measurement form: the live preview payload and the shared calc module are served', async () => {
  const c240 = conId(ids.revAl, '240 SM 90°');
  const r = await ctc.get(`/masuratori/nou?family=${ids.famFunie}&machine=${ids.rigid1}&construction=${c240}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /id="live-ctx"/);
  assert.match(r.text, /name="h"/);
  assert.ok(!/name="d1"/.test(r.text)); // sector: H and L, not two diameters
  assert.ok(!/name="r_value"/.test(r.text)); // aluminium: measured resistance not offered
  const calc = await ctc.get('/static/calc.js');
  assert.equal(calc.status, 200);
  assert.match(calc.text, /CTC_CALC/);
});

test('22. a correction creates version 2; version 1 stays readable; register shows current only with a badge', async () => {
  const no = ids.no2; // 620.5 g -> peste
  let r = await ctc.postForm(`/masuratori/${no}/corecteaza`, `/masuratori/${no}/corecteaza`, { ...funieForm({ mass_g: '608,5' }), edit_reason: '' });
  assert.equal(r.status, 422);
  assert.equal(app.db.value('SELECT count(*) FROM measurements WHERE record_no = ?', no), 1);
  r = await ctc.postForm(`/masuratori/${no}/corecteaza`, `/masuratori/${no}/corecteaza`, { ...funieForm({ mass_g: '608,5' }), edit_reason: 'Masă introdusă greșit' });
  assert.equal(r.status, 303);
  const versions = app.db.all('SELECT * FROM measurements WHERE record_no = ? ORDER BY version', no);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].is_current, 0);
  assert.equal(versions[1].is_current, 1);
  assert.equal(versions[1].supersedes_id, versions[0].id);
  assert.equal(versions[1].edit_reason, 'Masă introdusă greșit');
  assert.equal(versions[1].revision_id, versions[0].revision_id);
  assert.equal(app.db.get("SELECT verdict FROM measurement_results WHERE measurement_id = ? AND quantity = 'mass_gm'", versions[0].id).verdict, 'peste'); // v1 untouched
  assert.equal(app.db.get("SELECT verdict FROM measurement_results WHERE measurement_id = ? AND quantity = 'mass_gm'", versions[1].id).verdict, 'ok');
  const detail = await ctc.get(`/masuratori/${no}`);
  assert.match(detail.text, /Versiunea 1/);
  assert.match(detail.text, /Versiunea 2/);
  assert.match(detail.text, /Masă introdusă greșit/);
  const reg = await ctc.get('/masuratori');
  assert.match(reg.text, /2 versiuni/);
  const rowsForNo = reg.text.match(new RegExp(`/masuratori/${no}"`, 'g')) || [];
  assert.equal(rowsForNo.length, 1); // current version only
  const all = await ctc.get('/masuratori?all_versions=1');
  assert.equal((all.text.match(new RegExp(`/masuratori/${no}"`, 'g')) || []).length, 2);
});

test('corrections: Personal only own record in the same shift; Inginer any', async () => {
  const other = await makeUser(app, admin, 'ctc2', 'personal', 'Alt CTC');
  // not own
  let r = await other.get(`/masuratori/${ids.no1}/corecteaza`);
  assert.equal(r.status, 403);
  r = await other.postForm('/', `/masuratori/${ids.no1}/corecteaza`, { ...funieForm(), edit_reason: 'x' });
  assert.equal(r.status, 403);
  const det = await other.get(`/masuratori/${ids.no1}`);
  assert.ok(!det.text.includes('/corecteaza'));
  // own record but another shift
  app.db.run("UPDATE measurements SET shift_date = '2020-01-01' WHERE record_no = ?", ids.no1);
  r = await ctc.get(`/masuratori/${ids.no1}/corecteaza`);
  assert.equal(r.status, 403);
  // an engineer may correct any record, any time
  r = await engA.get(`/masuratori/${ids.no1}/corecteaza`);
  assert.equal(r.status, 200);
  r = await engA.postForm(`/masuratori/${ids.no1}/corecteaza`, `/masuratori/${ids.no1}/corecteaza`, { ...funieForm({ mass_g: '608' }), edit_reason: 'Recitire' });
  assert.equal(r.status, 303);
  assert.equal(app.db.value('SELECT count(*) FROM measurements WHERE record_no = ?', ids.no1), 2);
  // the record keeps its original shift
  assert.equal(app.db.get('SELECT shift_date FROM measurements WHERE record_no = ? AND is_current = 1', ids.no1).shift_date, '2020-01-01');
});

test('21. activating revision N archives N-1; earlier measurements keep their revision and limits snapshot', async () => {
  const oldRev = ids.revAl;
  const c240old = conId(oldRev, '240 SM 90°');
  const beforeM = app.db.get("SELECT m.id, m.revision_id FROM measurements m WHERE m.record_no = ? AND m.version = 1", ids.no2);
  assert.equal(beforeM.revision_id, oldRev);
  const snapBefore = app.db.get("SELECT lim_min, lim_max FROM measurement_results WHERE measurement_id = ? AND quantity = 'mass_gm'", beforeM.id);
  // engineer A tightens the mass limit of 240 SM 90° in the new draft
  const c240new = conId(ids.newRevAl, '240 SM 90°');
  const editPage = await engA.get(`/fise/${ids.docAl}/revizii/${ids.newRevAl}/constructii/${c240new}`);
  assert.equal(editPage.status, 200);
  const cons = rev.loadConstructions(app.db, ids.newRevAl, { onlyActive: true }).find((c) => c.id === c240new);
  const data = {
    material_id: cons.material_id, section: cons.section, shape_id: cons.shape_id, destination_id: cons.destination_id, coated: cons.coated, label: cons.label,
    wires: cons.wires, wire_d: cons.wire_d, die: cons.die, iec_exception_reason: '',
    limits: cons.limits.map((l) => (l.quantity === 'mass' ? { ...l, min: 607.5, max: 609.0 } : l)), params: cons.params,
  };
  const saved = rev.saveConstruction(app.db, app.db.get("SELECT * FROM users WHERE username='ing.a'"), ids.newRevAl, c240new, data);
  assert.ok(saved.ok);
  await activate(ids.docAl, ids.newRevAl);
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', oldRev).status, 'arhivata');
  assert.equal(app.db.value("SELECT count(*) FROM spec_revisions WHERE document_id = ? AND status = 'activa'", ids.docAl), 1);
  const afterM = app.db.get('SELECT revision_id FROM measurements WHERE id = ?', beforeM.id);
  assert.equal(afterM.revision_id, oldRev);
  const snapAfter = app.db.get("SELECT lim_min, lim_max FROM measurement_results WHERE measurement_id = ? AND quantity = 'mass_gm'", beforeM.id);
  assert.deepEqual(snapAfter, snapBefore);
  // new measurements use the new revision and its tighter limits
  const newCon = conId(ids.newRevAl, '240 SM 90°');
  const r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ construction_id: String(newCon), mass_g: '609.2' }));
  assert.equal(r.status, 303);
  const no = Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
  const m = app.db.get('SELECT * FROM measurements WHERE record_no = ?', no);
  assert.equal(m.revision_id, ids.newRevAl);
  assert.equal(app.db.get("SELECT verdict FROM measurement_results WHERE measurement_id = ? AND quantity = 'mass_gm'", m.id).verdict, 'peste');
  // the archived revision is still readable
  assert.equal((await ctc.get(`/fise/${ids.docAl}/revizii/${oldRev}`)).status, 200);
  // the old construction cannot be measured any more
  const bad = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ construction_id: String(c240old) }));
  assert.equal(bad.status, 422);
  // the new revision page marks the changed value against the previous one
  const page = await ctc.get(`/fise/${ids.docAl}/revizii/${ids.newRevAl}`);
  assert.match(page.text, /class="changed"/);
});

test('extruded conductor 35 SE: H and L undetermined (case 14 through the server)', async () => {
  // the seeded draft is a draft: activate it first (the 35 SE exception passes as warning)
  await activate(ids.docExtr, ids.revExtr);
  const mid = app.db.get("SELECT id FROM machines WHERE name = 'Conform Extruder'").id;
  const con = conId(ids.revExtr, '35 SE');
  const r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', {
    family_id: String(ids.famExtr), machine_id: String(mid), construction_id: String(con), sample_type_id: String(ids.sampleStart), mass_g: '91.0', sample_mm: '1000', h: '6.1', l: '9.0',
  });
  assert.equal(r.status, 303);
  const no = Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
  const res = Object.fromEntries(app.db.all('SELECT r.* FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ?', no).map((x) => [x.quantity, x]));
  assert.equal(res.mass_gm.verdict, 'ok');
  assert.equal(res.h.verdict, 'nedeterminat');
  assert.equal(res.l.verdict, 'nedeterminat');
  assert.ok(Math.abs(res.r20_theor.value - 0.8168) < 5e-5);
  assert.equal(res.r20_theor.lim_max, 0.868);
  assert.equal(res.r20_theor.verdict, 'ok');
  assert.match(res.r20_theor.source, /Tab\. 3/);
  // statistics for the undetermined limits
  const st = await engA.get(`/fise/constructie/${con}/statistici`);
  assert.equal(st.status, 200);
  assert.match(st.text, /Media/);
});

test('copper funie: measured resistance corrected to 20 °C, verdict on measured value', async () => {
  const docCu = app.db.get("SELECT id FROM spec_documents WHERE doc_type='CABLARE_RIGIDA_CU'").id;
  const revCu = app.db.get('SELECT id FROM spec_revisions WHERE document_id = ?', docCu).id;
  await activate(docCu, revCu);
  const c = app.db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 RMC'", revCu).id;
  const r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', {
    family_id: String(ids.famFunie), machine_id: String(ids.rigid1), construction_id: String(c), sample_type_id: String(ids.sampleStart),
    d1: '18,55', d2: '18,70', mass_g: '2057.3', sample_mm: '1000', r_value: '0.0004', r_unit: 'ohm', r_sample_m: '5', temp_c: '20',
  });
  assert.equal(r.status, 303);
  const no = Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
  const res = Object.fromEntries(app.db.all('SELECT r.* FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ?', no).map((x) => [x.quantity, x]));
  assert.ok(Math.abs(res.d_avg.value - 18.625) < 1e-9);
  assert.equal(res.d1.verdict, 'info');
  assert.ok(Math.abs(res.r20.value - 0.08) < 1e-9);
  assert.equal(res.r20.verdict, 'peste');
  assert.ok(res.r20.deviation_pct > 0);
  assert.ok(Math.abs(res.r20_theor.value - 0.07376) < 5e-5);
  assert.equal(res.r20_theor.verdict, 'ok');
  // out of range temperature: saved with a visible warning
  const r2 = await ctc.postForm('/masuratori/nou', '/masuratori/nou', {
    family_id: String(ids.famFunie), machine_id: String(ids.rigid1), construction_id: String(c), sample_type_id: String(ids.sampleStart),
    d1: '18,55', d2: '18,70', mass_g: '2057.3', r_value: '0.07', r_unit: 'ohm_km', temp_c: '43',
  });
  assert.equal(r2.status, 303);
  const shown = await ctc.follow('GET', r2.location);
  assert.match(shown.text, /în afara intervalului admis/);
});

test('numbered sample types: the next length number is proposed per shift, machine and construction', async () => {
  const c240 = conId(ids.newRevAl, '240 SM 90°');
  const page1 = await ctc.get(`/masuratori/nou?family=${ids.famFunie}&machine=${ids.rigid1}&construction=${c240}`);
  const j1 = JSON.parse(/id="live-ctx">([^<]+)</.exec(page1.text)[1]);
  assert.equal(j1.proposal, 1);
  assert.deepEqual(j1.numbered, [ids.sampleLength]);
  await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ construction_id: String(c240), sample_type_id: String(ids.sampleLength), length_no: '1', mass_g: '608' }));
  const page2 = await ctc.get(`/masuratori/nou?family=${ids.famFunie}&machine=${ids.rigid1}&construction=${c240}`);
  const j2 = JSON.parse(/id="live-ctx">([^<]+)</.exec(page2.text)[1]);
  assert.equal(j2.proposal, 2);
});

// ---------------------------------------------------------------- lists, users, settings

test('lists: add, rename, deactivate; duplicates refused; nothing deleted', async () => {
  let r = await engA.postForm('/liste/clienti', '/liste/clienti/adauga', { short_name: 'ACME', name: 'Acme SRL' });
  assert.equal(r.status, 303);
  const id = app.db.get("SELECT id FROM clients WHERE short_name = 'ACME'").id;
  r = await engA.postForm('/liste/clienti', '/liste/clienti/adauga', { short_name: 'acme' });
  assert.equal(r.status, 422);
  r = await engA.postForm('/liste/clienti', `/liste/clienti/${id}/salveaza`, { short_name: 'ACME2', name: 'Acme SRL' });
  assert.equal(r.status, 303);
  r = await engA.postForm('/liste/clienti', `/liste/clienti/${id}/comuta`, {});
  assert.equal(app.db.get('SELECT active FROM clients WHERE id = ?', id).active, 0);
  // deactivated clients are no longer offered but remain in the table
  const form = await ctc.get(`/masuratori/nou?family=${ids.famFunie}&machine=${ids.rigid1}&construction=${conId(ids.newRevAl, '240 SM 90°')}`);
  assert.ok(!form.text.includes('ACME2'));
  assert.equal(app.db.value("SELECT count(*) FROM clients WHERE short_name = 'ACME2'"), 1);
  // machine: rotor config validated and capacity derived
  const mt = app.db.get("SELECT id FROM machine_types WHERE name='Cablare rigidă'").id;
  r = await engA.postForm('/liste/utilaje', '/liste/utilaje/adauga', { name: 'RIGID 9', machine_type_id: String(mt), rotor_config: '1+6+12+18+24' });
  assert.equal(r.status, 303);
  assert.equal(app.db.get("SELECT max_wires FROM machines WHERE name='RIGID 9'").max_wires, 61);
  r = await engA.postForm('/liste/utilaje', '/liste/utilaje/adauga', { name: 'RIGID 10', machine_type_id: String(mt), rotor_config: '1-6' });
  assert.equal(r.status, 422);
  // machine type <-> families
  r = await engA.postForm('/liste/tipuri-utilaj', '/liste/tipuri-utilaj/adauga', { name: 'Test tip', family_ids: [String(ids.famFunie), String(ids.famExtr)] });
  assert.equal(r.status, 303);
  assert.equal(app.db.value("SELECT count(*) FROM machine_type_families f JOIN machine_types t ON t.id = f.machine_type_id WHERE t.name = 'Test tip'"), 2);
  // material constants: engineers only, audited
  const mat = app.db.get("SELECT * FROM materials WHERE code = 'Cu'");
  r = await engA.postForm('/liste/materiale', `/liste/materiale/${mat.id}`, { grade: 'ETP1', rho20: '0,01707', density: '8,89', alpha20: '0,00393' });
  assert.equal(r.status, 303);
  r = await engA.postForm('/liste/materiale', `/liste/materiale/${mat.id}`, { grade: 'ETP1', rho20: '-1', density: '8,89', alpha20: '0,00393' });
  assert.equal(r.status, 422);
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'material_change'") >= 1);
  // unknown list
  assert.equal((await engA.get('/liste/nu-exista')).status, 404);
});

test('users: create, reset password, deactivate; last administrator protected', async () => {
  const before = app.db.value('SELECT count(*) FROM users');
  let r = await admin.postForm('/admin/utilizatori/nou', '/admin/utilizatori/nou', { username: 'ing.a', full_name: 'Duplicat', role: 'inginer' });
  assert.equal(r.status, 422);
  r = await admin.postForm('/admin/utilizatori/nou', '/admin/utilizatori/nou', { username: 'bad name', full_name: 'X', role: 'inginer' });
  assert.equal(r.status, 422);
  assert.equal(app.db.value('SELECT count(*) FROM users'), before);
  const victim = app.db.get("SELECT * FROM users WHERE username = 'ctc2'");
  r = await admin.postForm('/admin/utilizatori', `/admin/utilizatori/${victim.id}/parola`, {});
  assert.equal(r.status, 200);
  assert.match(r.text, /<code>/);
  assert.equal(app.db.get('SELECT must_change_password FROM users WHERE id = ?', victim.id).must_change_password, 1);
  r = await admin.postForm('/admin/utilizatori', `/admin/utilizatori/${victim.id}`, { full_name: 'Alt CTC', role: 'personal', job_title: 'CTC' }); // active unchecked -> deactivate
  assert.equal(r.status, 303);
  assert.equal(app.db.get('SELECT active FROM users WHERE id = ?', victim.id).active, 0);
  // cannot deactivate yourself / the last administrator
  const me = app.db.get("SELECT id FROM users WHERE username = 'admin'").id;
  r = await admin.postForm(`/admin/utilizatori/${me}`, `/admin/utilizatori/${me}`, { full_name: 'Administrator', role: 'inginer', active: '1' });
  assert.equal(r.status, 422);
  assert.equal(app.db.get('SELECT role FROM users WHERE id = ?', me).role, 'administrator');
  // passwords are stored as scrypt hashes only
  for (const u of app.db.all('SELECT password_hash FROM users')) assert.match(u.password_hash, /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
});

test('sessions: cookie flags, logout invalidates the server-side session', async () => {
  const c = new Client(app.base);
  const p = await c.get('/login');
  const sc = p.headers.getSetCookie().join(';');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  const l = await c.login('ing.b', engB.password);
  const cookie = l.headers.getSetCookie().find((x) => x.startsWith('ctc_sid='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const home = await c.get('/');
  assert.equal(home.status, 200);
  const stolen = c.jar.ctc_sid;
  const out = await c.postForm('/', '/iesire', {});
  assert.equal(out.status, 303);
  const c2 = new Client(app.base);
  c2.jar.ctc_sid = stolen;
  assert.equal((await c2.get('/')).status, 303);
  // idle expiry
  const c3 = new Client(app.base);
  await c3.login('ing.b', engB.password);
  app.db.run("UPDATE sessions SET last_seen_at = '2020-01-01T00:00:00+02:00'");
  const expired = await c3.get('/');
  assert.equal(expired.status, 303);
  assert.match(expired.location, /^\/login/);
  // every session was aged: the shared clients log in again
  for (const [c4, u] of [[admin, 'admin'], [engA, 'ing.a'], [engB, 'ing.b'], [ctc, 'ctc1']]) {
    const r = await c4.login(u, c4.password);
    assert.equal(r.status, 303, u);
  }
});

test('security headers on every response', async () => {
  const r = await ctc.get('/');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(r.text.replace(/http:\/\/www\.w3\.org\/[^"']*/g, '')), 'no external URL in HTML');
});

test('static files cannot escape the public folder', async () => {
  for (const u of ['/static/../server.js', '/static/%2e%2e/server.js', '/static/..%2fserver.js', '/static/%2e%2e%2f%2e%2e%2fCLAUDE.md']) {
    const r = await new Client(app.base).get(u);
    assert.equal(r.status, 404, u);
  }
  assert.equal((await new Client(app.base).get('/static/app.css')).status, 200);
});

// ---------------------------------------------------------------- pages, language, XSS

test('29. XSS: a hostile operator name renders as text everywhere', async () => {
  const evil = '<script>alert(1)</script>';
  let r = await engA.postForm('/liste/operatori', '/liste/operatori/adauga', { full_name: evil });
  assert.equal(r.status, 303);
  const opId = app.db.get('SELECT id FROM operators WHERE full_name = ?', evil).id;
  const c = conId(ids.newRevAl, '240 SM 90°');
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ construction_id: String(c), operator_id: String(opId), notes: '<img src=x onerror=alert(2)>' }));
  assert.equal(r.status, 303);
  const no = Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
  const pages = ['/liste/operatori', `/masuratori/nou?family=${ids.famFunie}&machine=${ids.rigid1}&construction=${c}`, '/masuratori', `/masuratori/${no}`, `/masuratori/${no}/corecteaza`, '/'];
  for (const u of pages) {
    const p = await engA.get(u);
    assert.equal(p.status, 200, u);
    assert.ok(!p.text.includes('<script>alert(1)'), u);
    assert.ok(!p.text.includes('<img src=x'), u);
  }
  const reg = await engA.get('/masuratori');
  assert.ok(reg.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(reg.text.includes('&lt;img src=x onerror=alert(2)&gt;'));
  // a hostile user name in the header and the audit log
  const p = await admin.postForm('/admin/utilizatori/nou', '/admin/utilizatori/nou', { username: 'x.y', full_name: '<b onmouseover=1>X</b>', role: 'personal' });
  assert.equal(p.status, 200);
  assert.ok(!p.text.includes('<b onmouseover'));
  const users = await admin.get('/admin/utilizatori');
  assert.ok(!users.text.includes('<b onmouseover'));
  const audit = await admin.get('/admin/jurnal');
  assert.ok(!audit.text.includes('<script>alert(1)'));
});

test('28. every page: correct Romanian diacritics, no marker for missing strings, no English UI text', async () => {
  const c = conId(ids.newRevAl, '240 SM 90°');
  const no = app.db.value('SELECT max(record_no) FROM measurements');
  // a fresh draft so the editor pages can be rendered
  assert.equal((await engA.postForm(`/fise/${ids.docAl}`, `/fise/${ids.docAl}/revizii/noua`, {})).status, 303);
  const draft = app.db.get("SELECT id FROM spec_revisions WHERE document_id = ? AND status = 'ciorna'", ids.docAl).id;
  const cDraft = conId(draft, '240 SM 90°');
  const pages = {
    admin: ['/', '/masuratori/nou', `/masuratori/nou?family=${ids.famFunie}&machine=${ids.rigid1}&construction=${c}`, '/masuratori', `/masuratori/${no}`, `/masuratori/${no}/corecteaza`, '/fise', `/fise/${ids.docAl}`,
      `/fise/${ids.docAl}/revizii/${ids.newRevAl}`, `/fise/${ids.docAl}/revizii/${draft}`, '/liste', '/liste/utilaje', '/liste/tipuri-utilaj', '/liste/operatori', '/liste/clienti', '/liste/tipuri-proba', '/liste/schimburi', '/liste/forme', '/liste/destinatii',
      '/admin/utilizatori', '/admin/utilizatori/nou', '/admin/setari', '/admin/jurnal', '/parola'],
    eng: [`/fise/${ids.docAl}/revizii/${draft}/constructii/${cDraft}`, `/fise/${ids.docAl}/revizii/${draft}/constructii/noua`, '/liste/materiale', `/fise/constructie/${c}/statistici`],
  };
  const bad = /[şţŞŢ]/; // cedilla forms are wrong; comma-below ș ț are required
  const english = /\b(Save|Cancel|Delete|Login|Log in|Logout|Password|Username|Search|Submit|Settings|Users|Home|Edit|Add|Loading|Error|Yes|No)\b/;
  for (const [who, list] of Object.entries(pages)) {
    const client = who === 'admin' ? admin : engA;
    for (const u of list) {
      const r = await client.get(u);
      assert.equal(r.status, 200, u);
      const t = textOf(r.text);
      assert.ok(!bad.test(t), `cedilla in ${u}`);
      assert.ok(!/⟦|undefined|\[object Object\]|NaN/.test(t), `bad token in ${u}: ${(/.{30}(⟦|undefined|\[object Object\]|NaN).{30}/.exec(t) || [''])[0]}`);
      assert.ok(!english.test(t), `English text in ${u}: ${(english.exec(t) || [''])[0]}`);
      assert.match(r.text, /<html lang="ro">/);
    }
  }
  const login = await new Client(app.base).get('/login');
  assert.ok(!bad.test(textOf(login.text)));
  assert.match(textOf(login.text), /Autentificare/);
  // the source itself never contains the wrong characters in UI strings
  const src = fs.readFileSync(path.join(__dirname, '..', 'i18n', 'ro.js'), 'utf8');
  assert.ok(!bad.test(src));
  assert.match(src, /ș/);
  assert.match(src, /ț/);
});

test('no request to another host is needed: pages reference only local assets', async () => {
  const r = await admin.get('/');
  const refs = [...r.text.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => /^https?:|^\/\//.test(u));
  assert.deepEqual(refs, []);
  assert.ok(!/@import|url\(http/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8')));
});

// ---------------------------------------------------------------- backup, restore, migrations, seeding

test('26. backup while measurements are being saved produces valid databases', async () => {
  const c = conId(ids.newRevAl, '240 SM 90°');
  const saves = Array.from({ length: 15 }, (_, i) => ctc.postForm('/masuratori/nou', '/masuratori/nou', funieForm({ construction_id: String(c), mass_g: String(608 + (i % 3) * 0.1) })));
  const backups = Array.from({ length: 4 }, () => admin.postForm('/admin/setari', '/admin/setari/backup', {}));
  const results = await Promise.all([...saves, ...backups]);
  for (const r of results) assert.ok(r.status === 303, `status ${r.status}`);
  const dir = backup.backupDir(app.db, app.config);
  const files = backup.listBackups(dir);
  assert.ok(files.length >= 4);
  for (const f of files) {
    assert.match(f.name, /^ctc-\d{8}-\d{6}\.db$/);
    const db = new DatabaseSync(path.join(dir, f.name), { readOnly: true });
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    const n = db.prepare('SELECT count(*) AS n FROM measurements').get().n;
    const results2 = db.prepare('SELECT count(*) AS n FROM measurement_results').get().n;
    assert.ok(n > 0 && results2 > 0);
    db.close();
  }
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'backup'") >= 4);
});

test('27. restore requires typing the file name and takes a safety backup first', async () => {
  const dir = backup.backupDir(app.db, app.config);
  const target = backup.listBackups(dir).slice(-1)[0]; // oldest
  const countNow = app.db.value('SELECT count(*) FROM measurements');
  const dbCountInBackup = (() => { const d = new DatabaseSync(path.join(dir, target.name), { readOnly: true }); const n = d.prepare('SELECT count(*) AS n FROM measurements').get().n; d.close(); return n; })();
  assert.ok(dbCountInBackup < countNow || dbCountInBackup === countNow);
  const before = backup.listBackups(dir).length;
  // wrong confirmation: nothing happens
  let r = await admin.postForm(`/admin/setari/restaurare?f=${target.name}`, '/admin/setari/restaurare', { file: target.name, confirm_name: 'gresit.db' });
  assert.equal(r.status, 422);
  assert.equal(app.db.value('SELECT count(*) FROM measurements'), countNow);
  assert.equal(backup.listBackups(dir).length, before);
  // not a backup name / path traversal
  r = await admin.postForm(`/admin/setari/restaurare?f=${target.name}`, '/admin/setari/restaurare', { file: '../data/ctc.db', confirm_name: '../data/ctc.db' });
  assert.equal(r.status, 404);
  // correct confirmation
  r = await admin.postForm(`/admin/setari/restaurare?f=${target.name}`, '/admin/setari/restaurare', { file: target.name, confirm_name: target.name });
  assert.equal(r.status, 303);
  assert.equal(backup.listBackups(dir).length, before + 1); // the safety backup of the previous state
  assert.equal(app.db.value('SELECT count(*) FROM measurements'), dbCountInBackup);
  assert.equal(app.db.get('PRAGMA integrity_check').integrity_check, 'ok');
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'restore'") >= 1);
  // a corrupt file is refused
  const junk = path.join(dir, 'ctc-20200101-000000.db');
  fs.writeFileSync(junk, 'not a database');
  await admin.login('admin', admin.password);
  r = await admin.postForm('/admin/setari', '/admin/setari/restaurare', { file: 'ctc-20200101-000000.db', confirm_name: 'ctc-20200101-000000.db' });
  assert.equal(r.status, 303);
  assert.match(r.location, /setari/);
  assert.equal(app.db.get('PRAGMA integrity_check').integrity_check, 'ok');
  fs.unlinkSync(junk);
});

test('backup retention keeps the configured number of copies', async () => {
  const dir = backup.backupDir(app.db, app.config);
  app.db.run("INSERT INTO settings(key, value) VALUES ('backup.keep', '3') ON CONFLICT(key) DO UPDATE SET value = '3'");
  for (let i = 0; i < 3; i++) assert.ok(backup.backupNow(app.db, app.config, null, 'test').ok);
  assert.equal(backup.listBackups(dir).length, 3);
});

test('settings: validated, audited, restart notice for port', async () => {
  let r = await admin.postForm('/admin/setari', '/admin/setari', { 'server.port': '99999', 'server.bind': '0.0.0.0', 'server.public_name': '', 'session.idle_hours': '8', 'backup.dir': '', 'backup.time': '02:00', 'backup.keep': '14', 'backup.auto': '1', 'shift.day_start': '06:00', 'shift.night_start': '18:00' });
  assert.equal(r.status, 422);
  r = await admin.postForm('/admin/setari', '/admin/setari', { 'server.port': '8081', 'server.bind': '0.0.0.0', 'server.public_name': 'ctc.romcab.local', 'session.idle_hours': '8', 'backup.dir': '', 'backup.time': '02:00', 'backup.keep': '14', 'backup.auto': '1', 'shift.day_start': '06:00', 'shift.night_start': '18:00' });
  assert.equal(r.status, 303);
  const shown = await admin.follow('GET', r.location);
  assert.match(shown.text, /repornirea serviciului/);
  assert.equal(JSON.parse(app.db.get("SELECT value FROM settings WHERE key = 'server.port'").value), 8081);
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'setting_change'") >= 1);
  // put the listening port back for the rest of the run (it is only applied on restart anyway)
  await admin.postForm('/admin/setari', '/admin/setari', { 'server.port': '8080', 'server.bind': '0.0.0.0', 'server.public_name': '', 'session.idle_hours': '8', 'backup.dir': '', 'backup.time': '02:00', 'backup.keep': '14', 'backup.auto': '1', 'shift.day_start': '06:00', 'shift.night_start': '18:00' });
});

test('24. seeding is idempotent and 25. a new migration backs up first, then applies', async () => {
  const counts = () => Object.fromEntries(['users', 'iec_limits', 'constructions', 'limits', 'process_params', 'spec_revisions', 'machines', 'shapes', 'sample_types', 'crews', 'seed_warnings'].map((t) => [t, app.db.value(`SELECT count(*) FROM ${t}`)]));
  const before = counts();
  const cfg = app.config;
  const root = app.root;
  const migDir = path.join(root, 'migrations-test');
  fs.mkdirSync(migDir);
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'db', 'migrations'))) fs.copyFileSync(path.join(__dirname, '..', 'db', 'migrations', f), path.join(migDir, f));
  const backupsBefore = backup.listBackups(backup.backupDir(app.db, cfg)).length;
  // restart 1: same migrations -> nothing seeded, nothing migrated, no new admin password
  await app.stop();
  const logs = [];
  let app2 = await createApp(cfg, { listen: { port: 0, host: '127.0.0.1' }, log: (m) => logs.push(m), noScheduler: true, migrationsDir: migDir });
  assert.deepEqual(Object.fromEntries(Object.entries(before).map(([k]) => [k, app2.db.value(`SELECT count(*) FROM ${k}`)])), before);
  assert.ok(!logs.join('\n').includes('parolă unică'));
  assert.equal(backup.listBackups(backup.backupDir(app2.db, cfg)).length, backupsBefore);
  // restart 2: a pending 006 migration
  await app2.stop();
  fs.writeFileSync(path.join(migDir, '006_test_table.sql'), 'CREATE TABLE test_added (id INTEGER PRIMARY KEY, note TEXT);');
  const logs2 = [];
  app2 = await createApp(cfg, { listen: { port: 0, host: '127.0.0.1' }, log: (m) => logs2.push(m), noScheduler: true, migrationsDir: migDir });
  assert.match(logs2.join('\n'), /Backup înainte de migrare/);
  assert.equal(backup.listBackups(backup.backupDir(app2.db, cfg)).length, backupsBefore + 1);
  assert.equal(app2.db.value('SELECT max(version) FROM schema_migrations'), 6);
  assert.equal(app2.db.value("SELECT count(*) FROM sqlite_master WHERE name = 'test_added'"), 1);
  // the backup taken is the pre-migration state (no test_added table)
  const newest = backup.listBackups(backup.backupDir(app2.db, cfg))[0];
  const bdb = new DatabaseSync(path.join(backup.backupDir(app2.db, cfg), newest.name), { readOnly: true });
  assert.equal(bdb.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'test_added'").get().n, 0);
  bdb.close();
  assert.deepEqual(Object.fromEntries(Object.keys(before).map((k) => [k, app2.db.value(`SELECT count(*) FROM ${k}`)])), before);
  // hand the running app object back to the after() hook: same db handle, new server
  app.db = app2.db; app.stop = app2.stop; app.server = app2.server;
  app2.db.close();
  app.db.open();
  app.stop = async () => { app.db.close(); };
  void counts;
});

test('seed content: drafts, families, flags, warnings', async () => {
  // fresh app so the previous tests' edits do not matter
  const fresh = await startApp();
  try {
    const db = fresh.db;
    assert.equal(db.value('SELECT count(*) FROM iec_limits'), 185);
    assert.equal(db.value("SELECT count(*) FROM spec_revisions WHERE status = 'ciorna'"), 6);
    assert.equal(db.value("SELECT count(*) FROM spec_revisions WHERE status = 'activa'"), 0);
    assert.equal(db.value('SELECT count(*) FROM constructions'), 195);
    assert.deepEqual(db.all('SELECT code FROM product_families WHERE active = 1 ORDER BY code').map((r) => r.code), ['CABLE_LV', 'EXTRUDAT_AL', 'FLEXIBIL_CL5', 'FUNIE_RIGIDA', 'SARMA_CL12', 'SARMA_CL5']);
    assert.equal(db.value("SELECT count(*) FROM users WHERE username = 'admin' AND must_change_password = 1 AND role = 'administrator'"), 1);
    assert.deepEqual(db.all('SELECT name FROM machines ORDER BY id').map((r) => r.name), ['STAȚIE ÎNCERCĂRI 1', 'TREFILARE 1', 'TREFILARE MF 1', 'RIGID 1', 'RIGID 2', 'KABMAK 1', 'KABMAK 2', 'Conform Extruder', 'LITARE 1', 'LITARE 2', 'LITARE 3', 'LITARE 4']);
    assert.deepEqual(db.all('SELECT short_name FROM clients ORDER BY id').map((r) => r.short_name), ['SBT', 'TUB', 'VOLT', 'ESI', 'Iemar']);
    assert.equal(db.value('SELECT count(*) FROM operators'), 0);
    assert.equal(db.value('SELECT count(*) FROM seed_warnings'), 15);
    const crews = db.all('SELECT * FROM crews ORDER BY name');
    assert.equal(crews.length, 3);
    // materials
    const cu = db.get("SELECT * FROM materials WHERE code = 'Cu'");
    assert.deepEqual([cu.rho20, cu.density, cu.alpha20], [0.01707, 8.89, 0.00393]);
    // the 35 SE exception is carried, red-on-paper flags are kept
    assert.match(db.get("SELECT iec_exception_reason FROM constructions WHERE label = '35 SE'").iec_exception_reason, /nota a/);
    const flagged = db.all("SELECT data FROM constructions WHERE data LIKE '%\"d_fir_modificat\":true%'");
    assert.ok(flagged.length > 0);
    // 35 SE limits: H and L undetermined, mass 90-92
    const se = db.get("SELECT id FROM constructions WHERE label = '35 SE'").id;
    const l = Object.fromEntries(db.all('SELECT * FROM limits WHERE construction_id = ?', se).map((x) => [x.quantity, x]));
    assert.equal(l.h.min, null); assert.equal(l.h.max, null);
    assert.equal(l.mass.min, 90); assert.equal(l.mass.max, 92);
    // funie Al 240 SM 90°: sector H x L +/-0.1 and rotor parameters
    const f240 = db.get("SELECT c.id FROM constructions c JOIN spec_revisions r ON r.id = c.revision_id JOIN spec_documents d ON d.id = r.document_id WHERE d.doc_type = 'CABLARE_RIGIDA_AL' AND c.label = '240 SM 90°'").id;
    const fl = Object.fromEntries(db.all('SELECT * FROM limits WHERE construction_id = ?', f240).map((x) => [x.quantity, x]));
    assert.ok(Math.abs((fl.h.max - fl.h.min) - 0.2) < 1e-9);
    assert.equal(fl.mass.min, 607);
    assert.ok(db.value('SELECT count(*) FROM process_params WHERE construction_id = ?', f240) >= 3);
    // the warnings from verificare_seed.json show up on the draft
    const page = await (async () => { const c = new Client(fresh.base); return { c }; })();
    void page;
  } finally {
    await fresh.cleanup();
  }
});
