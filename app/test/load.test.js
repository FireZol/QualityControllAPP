'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const M = require('../domain/measurements');

test('a register with more rows than SQLite allows ? in one statement can still be read whole (export everything), and versions are counted', async () => {
  const app = await startApp();
  try {
    const db = app.db;
    const c = db.get(`SELECT c.id, c.revision_id, d.family_id FROM constructions c JOIN spec_revisions r ON r.id = c.revision_id JOIN spec_documents d ON d.id = r.document_id WHERE c.active = 1 LIMIT 1`);
    const machine = db.get('SELECT id FROM machines').id, user = db.get('SELECT id FROM users').id, st = db.get('SELECT id FROM sample_types').id;
    const N = 33000; // above the 32766 variable limit
    db.tx(() => {
      for (let i = 1; i <= N; i++) {
        const id = db.run(`INSERT INTO measurements(record_no, version, is_current, created_at, created_by, shift_date, shift, family_id, machine_id, construction_id, revision_id, level, sample_type_id)
          VALUES (?, 1, 1, '2026-01-01 10:00:00', ?, '2026-01-01', 'zi', ?, ?, ?, ?, 'sarma', ?)`, i, user, c.family_id, machine, c.id, c.revision_id, st).id;
        db.run("INSERT INTO measurement_results(measurement_id, quantity, value, verdict, source) VALUES (?, 'mass_gm', 1, 'ok', 'fisa')", id);
      }
      // record 5 has a correction (2 versions)
      db.run(`INSERT INTO measurements(record_no, version, is_current, created_at, created_by, shift_date, shift, family_id, machine_id, construction_id, revision_id, level, sample_type_id)
        VALUES (5, 2, 0, '2026-01-01 11:00:00', ?, '2026-01-01', 'zi', ?, ?, ?, ?, 'sarma', ?)`, user, c.family_id, machine, c.id, c.revision_id, st);
    });
    const all = M.register(db, { all_versions: false }, 1, N + 10);
    assert.equal(all.rows.length, N);
    assert.ok(all.rows.every((r) => r.results.length === 1));
    assert.equal(all.rows.find((r) => r.record_no === 5).versions, 2);
    assert.equal(all.rows.find((r) => r.record_no === 6).versions, 1);
  } finally { await app.cleanup(); }
});
