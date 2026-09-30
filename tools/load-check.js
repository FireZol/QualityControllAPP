'use strict';
// Load check (development tool, not part of the app): fills a scratch database with many measurements and times the pages
// people use. Fails (exit 1) when an interactive page is slower than 500 ms or a heavy one (print, export, analysis) than 3 s.
//   node tools/load-check.js [number of measurements, default 50000]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startApp, adminClient } = require('../app/test/helpers');
const modules = require('../app/domain/modules');

const N = Number(process.argv[2]) || 50000;

async function main() {
  const app = await startApp();
  const db = app.db;
  const admin = await adminClient(app);

  // ---- bulk data: every construction of the seeded rigid-wire families, spread over ~400 days ----
  const cons = db.all(`SELECT c.id, c.revision_id, c.shape_id, r.document_id, d.family_id FROM constructions c
     JOIN spec_revisions r ON r.id = c.revision_id JOIN spec_documents d ON d.id = r.document_id
     JOIN product_families f ON f.id = d.family_id WHERE f.code IN ('FUNIE_RIGIDA', 'SARMA_CL12') AND c.active = 1`);
  const machines = db.all('SELECT id FROM machines WHERE active = 1');
  const crews = db.all('SELECT id FROM crews');
  const users = db.get('SELECT id FROM users ORDER BY id').id;
  const sample = db.get('SELECT id FROM sample_types ORDER BY id').id;
  const t0 = Date.now();
  db.tx(() => {
    const now = Date.now();
    for (let i = 1; i <= N; i++) {
      const c = cons[i % cons.length];
      const ts = new Date(now - Math.floor((i / N) * 400 * 86400000));
      const iso = ts.toISOString().slice(0, 19).replace('T', ' ');
      const day = iso.slice(0, 10);
      const id = db.run(`INSERT INTO measurements(record_no, version, is_current, created_at, created_by, shift_date, shift, crew_id, family_id, machine_id, construction_id,
          revision_id, level, sample_type_id, length_no) VALUES (?,1,1,?,?,?,?,?,?,?,?,?,?,?,?)`,
        i, iso, users, day, i % 2 ? 'zi' : 'noapte', crews[i % crews.length].id, c.family_id, machines[i % machines.length].id, c.id, c.revision_id, 'sarma', sample, i % 7).id;
      const bad = i % 25 === 0;
      db.run("INSERT INTO measurement_inputs(measurement_id, key, value) VALUES (?, 'mass_g', ?)", id, String(600 + (i % 13)));
      db.run("INSERT INTO measurement_results(measurement_id, quantity, value, lim_min, lim_max, verdict, source) VALUES (?, 'mass_gm', ?, 600, 610, ?, 'fisa')", id, 600 + (i % 13), bad ? 'peste' : 'ok');
      db.run("INSERT INTO measurement_results(measurement_id, quantity, value, lim_min, lim_max, verdict, source) VALUES (?, 'r20_theor', ?, NULL, 0.125, 'ok', 'IEC 60228:2023 Tab. 4')", id, 0.1 + (i % 9) / 1000);
    }
  });
  console.log(`${N} measurements inserted in ${((Date.now() - t0) / 1000).toFixed(1)} s (${(fs.statSync(db.file).size / 1048576).toFixed(0)} MB database)`);
  for (const m of modules.MODULES) modules.set(db, m, true);
  const famId = cons[0].family_id;
  const key = db.get('SELECT stable_key FROM constructions WHERE id = ?', cons[0].id).stable_key;

  // ---- timings ----
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const pages = [
    ['home', '/', 500], ['register page 1', '/masuratori', 500], ['register page 500', '/masuratori?pagina=500', 500],
    ['register, family + 30 days', `/masuratori?family_id=${famId}&from=${from}`, 500], ['register, out of limits only', '/masuratori?out=1', 500],
    ['register, product search', '/masuratori?q=50', 500], ['a record', '/masuratori/100', 500], ['new measurement', '/masuratori/nou', 500],
    ['print register (2000 rows)', '/masuratori/tipar', 3000], ['export register (all rows) CSV', '/masuratori/export?format=csv', 3000],
    ['analysis: trend', `/analize/tendinta?product=${encodeURIComponent(key)}&quantity=mass_gm`, 3000], ['analysis: control chart', `/analize/control?product=${encodeURIComponent(key)}&quantity=mass_gm`, 3000],
    ['analysis: distribution', `/analize/distributie?product=${encodeURIComponent(key)}&quantity=mass_gm`, 3000], ['analysis: nonconformity', '/analize/neconformitate', 3000],
  ];
  let failed = 0;
  const rows = [];
  for (const [name, url, limit] of pages) {
    const times = [];
    let status = 0;
    for (let k = 0; k < 3; k++) { const s = process.hrtime.bigint(); const r = await admin.get(url); times.push(Number(process.hrtime.bigint() - s) / 1e6); status = r.status; }
    times.sort((a, b) => a - b);
    const med = times[1];
    const ok = status === 200 && med <= limit;
    if (!ok) failed++;
    rows.push(`${ok ? 'ok  ' : 'SLOW'} ${name.padEnd(34)} ${String(Math.round(med)).padStart(6)} ms  (limit ${limit}, HTTP ${status})`);
  }
  console.log(rows.join('\n'));
  await app.cleanup();
  if (failed) { console.log(`${failed} page(s) over the limit`); process.exit(1); }
  console.log('all pages within the limits');
}
main().catch((e) => { console.error(e); process.exit(1); });
