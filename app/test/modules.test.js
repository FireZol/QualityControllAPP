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
