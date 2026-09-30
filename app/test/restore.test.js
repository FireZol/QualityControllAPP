'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, adminClient } = require('./helpers');
const backup = require('../lib/backup');

test('restore drill: back up, change the data, restore; the data is back and a safety copy of the state before the restore exists', async () => {
  const app = await startApp();
  try {
    const admin = await adminClient(app);
    const db0 = app.db;
    const c = db0.get(`SELECT c.id, c.revision_id, d.family_id FROM constructions c JOIN spec_revisions r ON r.id = c.revision_id JOIN spec_documents d ON d.id = r.document_id WHERE c.active = 1 LIMIT 1`);
    const addMeasurements = (n, from) => {
      const db = app.db; // the handle changes after a restore
      const machine = db.get('SELECT id FROM machines').id, user = db.get('SELECT id FROM users').id, st = db.get('SELECT id FROM sample_types').id;
      for (let i = 0; i < n; i++) {
        db.run(`INSERT INTO measurements(record_no, version, is_current, created_at, created_by, shift_date, shift, family_id, machine_id, construction_id, revision_id, level, sample_type_id)
          VALUES (?, 1, 1, '2026-01-01 10:00:00', ?, '2026-01-01', 'zi', ?, ?, ?, ?, 'sarma', ?)`, from + i, user, c.family_id, machine, c.id, c.revision_id, st);
      }
    };
    const count = () => app.db.value('SELECT count(*) FROM measurements');
    addMeasurements(12, 1);
    assert.equal(count(), 12);
    // 1. back up
    assert.equal((await admin.postForm('/admin/setari', '/admin/setari/backup', {})).status, 303);
    const dir = backup.backupDir(app.db, app.config);
    const file = backup.listBackups(dir)[0].name;
    // 2. change the data
    addMeasurements(1, 13);
    assert.equal(count(), 13);
    const filesBefore = backup.listBackups(dir).length;
    // 3. restore (typed confirmation)
    const wrong = await admin.postForm(`/admin/setari/restaurare?f=${encodeURIComponent(file)}`, '/admin/setari/restaurare', { file, confirm_name: 'nu' });
    assert.notEqual(wrong.status, 303, 'a wrong confirmation does nothing');
    assert.equal(count(), 13);
    const ok = await admin.postForm(`/admin/setari/restaurare?f=${encodeURIComponent(file)}`, '/admin/setari/restaurare', { file, confirm_name: file });
    assert.equal(ok.status, 303, ok.text.slice(0, 200));
    // 4. the data is as it was at the backup; the state before the restore was kept as a safety copy
    assert.equal(count(), 12);
    assert.ok(backup.listBackups(dir).length > filesBefore, 'a safety copy of the current database was taken first');
    assert.equal(app.db.value('PRAGMA integrity_check'), 'ok');
    // the application keeps working after the restore
    assert.equal((await admin.get('/masuratori')).status, 200);
  } finally { await app.cleanup(); }
});
