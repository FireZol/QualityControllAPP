'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, adminClient } = require('./helpers');

let app, admin;
test.before(async () => { app = await startApp({ modulesOff: true }); admin = await adminClient(app); });
test.after(async () => { await app.cleanup(); });

test('a fresh install is the conductor QC tool only: cable, batches, certificates and analytics are off', async () => {
  const home = (await admin.get('/')).text;
  assert.ok(home.includes('/masuratori/nou') && home.includes('/fise'));
  assert.ok(!home.includes('href="/loturi"') && !home.includes('href="/analize"'));
  for (const p of ['/loturi', '/loturi/nou', '/analize', '/analize/control', '/certificate/1']) assert.equal((await admin.get(p)).status, 404, p);
  const newForm = (await admin.get('/masuratori/nou')).text;
  assert.ok(!newForm.includes('Cablu de joasă tensiune'));
  assert.equal(app.db.value("SELECT active FROM product_families WHERE code = 'CABLE_LV'"), 0);
  // the conductor families are all still there
  assert.ok(newForm.includes('Funie') || app.db.value('SELECT count(*) FROM product_families WHERE active = 1') >= 4);
});

test('the Administrator switches the modules on in Setări and they appear; off again hides them', async () => {
  const s = (await admin.get('/admin/setari')).text;
  assert.ok(s.includes('name="modules.cable"') && s.includes('name="modules.analytics"'));
  const base = { 'server.port': '8080', 'server.bind': '0.0.0.0', 'server.public_name': '', 'session.idle_hours': '8', 'backup.dir': '', 'backup.time': '02:00', 'backup.keep': '14', 'shift.day_start': '06:00', 'shift.night_start': '18:00', 'backup.auto': '1' };
  let r = await admin.postForm('/admin/setari', '/admin/setari', { ...base, 'modules.cable': '1', 'modules.analytics': '1' });
  assert.equal(r.status, 303);
  assert.equal((await admin.get('/loturi')).status, 200);
  assert.equal((await admin.get('/analize/tendinta')).status, 200);
  assert.equal(app.db.value("SELECT active FROM product_families WHERE code = 'CABLE_LV'"), 1);
  assert.ok(((await admin.get('/')).text).includes('href="/loturi"'));
  r = await admin.postForm('/admin/setari', '/admin/setari', base);
  assert.equal((await admin.get('/loturi')).status, 404);
  assert.equal(app.db.value("SELECT active FROM product_families WHERE code = 'CABLE_LV'"), 0);
  assert.ok(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'setting_change'") >= 2);
});

test('the "?" tip button is on every page and shows tips for that screen', async () => {
  const pages = { '/': 'Aici vedeți măsurătorile de azi', '/masuratori/nou': 'Ctrl+Enter salvează', '/masuratori': 'Filtrați după dată', '/fise': 'Fișa tehnică conține limitele', '/liste': 'Datele de bază sunt listele', '/admin/utilizatori': 'Personal introduce măsurători', '/admin/setari': 'Portul și adresa', '/admin/jurnal': 'Jurnalul arată cine' };
  for (const [url, tip] of Object.entries(pages)) {
    const r = await admin.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(r.text.includes('<details class="help">') && r.text.includes(tip), `${url} shows its tips`);
  }
});

test('Setări: the crew cycle is editable and validated; the mass-vs-wires band defaults to ±1 %', async () => {
  const base = { 'server.port': '8080', 'server.bind': '0.0.0.0', 'server.public_name': '', 'session.idle_hours': '8', 'backup.dir': '', 'backup.time': '02:00', 'backup.keep': '14', 'shift.day_start': '06:00', 'shift.night_start': '18:00', 'backup.auto': '1' };
  assert.deepEqual(require('../domain/settings').get(app.db, 'shift.cycle'), [4, 2, 4, 2]);
  assert.ok((await admin.get('/admin/setari')).text.includes('name="cycle.day"'));
  let r = await admin.postForm('/admin/setari', '/admin/setari', { ...base, 'cycle.day': '3', 'cycle.off1': '1', 'cycle.night': '3', 'cycle.off2': '1' });
  assert.equal(r.status, 303);
  assert.deepEqual(require('../domain/settings').get(app.db, 'shift.cycle'), [3, 1, 3, 1]);
  r = await admin.postForm('/admin/setari', '/admin/setari', { ...base, 'cycle.day': '0', 'cycle.off1': '1', 'cycle.night': '3', 'cycle.off2': '1' });
  assert.equal(r.status, 422);
  r = await admin.postForm('/admin/setari', '/admin/setari', { ...base, 'cycle.day': 'x', 'cycle.off1': '1', 'cycle.night': '3', 'cycle.off2': '1' });
  assert.equal(r.status, 422);
  assert.deepEqual(require('../domain/settings').get(app.db, 'shift.cycle'), [3, 1, 3, 1], 'an invalid form changes nothing');
  await admin.postForm('/admin/setari', '/admin/setari', { ...base, 'cycle.day': '4', 'cycle.off1': '2', 'cycle.night': '4', 'cycle.off2': '2' });
  const t = require('../domain/targets').get(app.db);
  assert.equal(t.mass_ratio_min, 0.99);
  assert.equal(t.mass_ratio_max, 1.01);
});

test('first-setup checklist: shown to Administrator and Inginer, ticks itself off, disappears when done; never shown to Personal', async () => {
  const { makeUser } = require('./helpers');
  const fresh = await startApp({ modulesOff: true });
  try {
    const a = await adminClient(fresh);
    const steps = (text) => Array.from(text.matchAll(/<li class="(done|todo)"><span class="mark"/g)).map((m) => m[1]);
    let home = (await a.get('/')).text;
    assert.ok(home.includes('Prima configurare'));
    assert.deepEqual(steps(home), ['todo', 'todo', 'todo', 'todo']);
    assert.match(home, /0 din \d+ active/);
    const ctc = await makeUser(fresh, a, 'ctc.setup', 'personal', 'CTC');
    assert.ok(!(await ctc.get('/')).text.includes('Prima configurare'));
    await makeUser(fresh, a, 'ing.s1', 'inginer', 'Ing 1');
    const e2 = await makeUser(fresh, a, 'ing.s2', 'inginer', 'Ing 2');
    assert.deepEqual(steps((await e2.get('/')).text), ['done', 'todo', 'todo', 'todo'], 'two engineers: step 1 done; an Inginer sees the panel too');
    // sheets active, crews edited, a backup made
    fresh.db.run("UPDATE spec_revisions SET status = 'activa' WHERE status = 'ciorna'");
    const crew = fresh.db.get('SELECT * FROM crews ORDER BY id');
    const r = await e2.postForm('/liste/schimburi', `/liste/schimburi/${crew.id}/salveaza`, { name: crew.name, cycle_start: '2026-09-01' });
    assert.equal(r.status, 303);
    assert.equal((await a.postForm('/admin/setari', '/admin/setari/backup', {})).status, 303);
    home = (await a.get('/')).text;
    assert.ok(!home.includes('Prima configurare'), 'all steps done: the panel is gone');
  } finally { await fresh.cleanup(); }
});
