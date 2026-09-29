'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const xp = require('../lib/export');
const A = require('../domain/analytics');

let app, admin, engA, engB, ctc, ids = {};

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Inginer A');
  engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Inginer B');
  ctc = await makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const db = app.db;
  for (const [k, t] of [['cl5', 'A6_TREFILARE_CL5'], ['al', 'CABLARE_RIGIDA_AL']]) {
    ids[k + 'Doc'] = db.get('SELECT id FROM spec_documents WHERE doc_type = ?', t).id;
    ids[k + 'Rev'] = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', ids[k + 'Doc']).id;
  }
  ids.famFlex = db.get("SELECT id FROM product_families WHERE code = 'FLEXIBIL_CL5'").id;
  ids.famFunie = db.get("SELECT id FROM product_families WHERE code = 'FUNIE_RIGIDA'").id;
  ids.sample = db.get("SELECT id FROM sample_types WHERE name = 'Probă de pornire'").id;
  ids.kabmak = db.get("SELECT id FROM machines WHERE name = 'KABMAK 1'").id;
  ids.rigid1 = db.get("SELECT id FROM machines WHERE name = 'RIGID 1'").id;
  ids.rigid2 = db.get("SELECT id FROM machines WHERE name = 'RIGID 2'").id;
});
test.after(async () => { await app.cleanup(); });

async function activate(docId, revId) {
  assert.equal((await engA.postForm(`/fise/${docId}/revizii/${revId}`, `/fise/${docId}/revizii/${revId}/trimite`, {})).status, 303);
  assert.equal((await engB.postForm(`/fise/${docId}/revizii/${revId}`, `/fise/${docId}/revizii/${revId}/verifica`, {})).status, 303);
}
const record = (r) => Number(/\/masuratori\/(\d+)/.exec(r.location)[1]);
const results = (no) => Object.fromEntries(app.db.all('SELECT r.* FROM measurement_results r JOIN measurements m ON m.id = r.measurement_id WHERE m.record_no = ? AND m.is_current = 1', no).map((x) => [x.quantity, x]));
const cons = (revId, where) => app.db.get(`SELECT c.* FROM constructions c WHERE c.revision_id = ? AND ${where}`, revId);

test('every process has a default machine, so every active family can be measured out of the box', async () => {
  for (const f of app.db.all('SELECT * FROM product_families WHERE active = 1')) {
    const n = app.db.value(`SELECT count(*) FROM machines m JOIN machine_type_families x ON x.machine_type_id = m.machine_type_id WHERE m.active = 1 AND x.family_id = ?`, f.id);
    assert.ok(n >= 1, `${f.code} has no machine`);
  }
  assert.deepEqual(app.db.all("SELECT name FROM machines WHERE name IN ('TREFILARE 1','TREFILARE MF 1','Conform Extruder') ORDER BY name").map((r) => r.name), ['Conform Extruder', 'TREFILARE 1', 'TREFILARE MF 1']);
});

test('flexible class 5: one record per level; suviță has no resistance; toron reported to the finished conductor (case 13)', async () => {
  // class V sheet: the 25 mm² row needs its IEC exception before activation
  app.db.run("UPDATE constructions SET iec_exception_reason = 'Acceptat' WHERE revision_id = ? AND wire_d > 0.41", ids.cl5Rev);
  await activate(ids.cl5Doc, ids.cl5Rev);
  const c10 = cons(ids.cl5Rev, 'section = 10');
  const data = JSON.parse(c10.data);
  assert.equal(data.nr_toroane, 7);
  const base = { family_id: String(ids.famFlex), machine_id: String(ids.kabmak), construction_id: String(c10.id), sample_type_id: String(ids.sample) };
  // the level must be chosen before the entry form appears
  let page = await ctc.get(`/masuratori/nou?family=${ids.famFlex}&machine=${ids.kabmak}&construction=${c10.id}`);
  assert.match(page.text, /Nivel măsurat/);
  assert.ok(!/id="entry"/.test(page.text));
  // suviță: mass only
  page = await ctc.get(`/masuratori/nou?family=${ids.famFlex}&machine=${ids.kabmak}&construction=${c10.id}&level=suvita`);
  assert.match(page.text, /name="mass_g"/);
  assert.ok(!/name="r_value"/.test(page.text));
  assert.ok(!/name="d1"/.test(page.text), 'no diameter for flexible conductors');
  const sl = app.db.get("SELECT * FROM limits WHERE construction_id = ? AND level = 'suvita' AND quantity = 'mass'", c10.id);
  const mid = (sl.min + sl.max) / 2;
  let r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { ...base, level: 'suvita', mass_g: String(mid), sample_mm: '1000' });
  assert.equal(r.status, 303);
  let res = results(record(r));
  assert.equal(res.mass_gm.verdict, 'ok');
  assert.equal(res.mass_gm.lim_min, sl.min);
  assert.ok(!res.r20 && !res.r20_theor && !res.d1);
  assert.equal(app.db.get('SELECT level FROM measurements WHERE record_no = ?', record(r)).level, 'suvita');
  // toron: mass + resistance reported to the conductor: 13.734 Ω/km at 26.5 °C, 7 strands, limit 1.91 (case 13)
  page = await ctc.get(`/masuratori/nou?family=${ids.famFlex}&machine=${ids.kabmak}&construction=${c10.id}&level=toron`);
  assert.match(page.text, /name="r_value"/);
  assert.match(page.text, /R max al conductorului finit/);
  const tl = app.db.get("SELECT * FROM limits WHERE construction_id = ? AND level = 'toron' AND quantity = 'mass'", c10.id);
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { ...base, level: 'toron', mass_g: String((tl.min + tl.max) / 2), r_value: '13,734', r_unit: 'ohm_km', temp_c: '26,5' });
  assert.equal(r.status, 303);
  res = results(record(r));
  assert.equal(res.mass_gm.verdict, 'ok');
  assert.equal(res.r20.verdict, 'info');
  assert.ok(Math.abs(res.r20_echiv.value - 1.9131) < 5e-5, String(res.r20_echiv.value));
  assert.equal(res.r20_echiv.lim_max, 1.91);
  assert.equal(res.r20_echiv.verdict, 'peste');
  assert.ok(Math.abs(res.r20_echiv.deviation_pct - 0.16) < 0.005);
  assert.match(res.r20_echiv.source, /Tab\. 5/);
  const m = app.db.get('SELECT * FROM measurements WHERE record_no = ?', record(r));
  assert.equal(m.level, 'toron');
  assert.equal(m.destination_construction_id, c10.id);
  // liță: mass is informative (approximate on the sheet), resistance against the standard
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { ...base, level: 'lita', mass_g: '85', r_value: '1,9', r_unit: 'ohm_km', temp_c: '20' });
  assert.equal(r.status, 303);
  res = results(record(r));
  assert.equal(res.mass_gm.verdict, 'info');
  assert.equal(res.r20.verdict, 'ok');
  assert.ok(!res.r20_echiv);
  // a section without strands has no toron level; a forged level is refused
  const c05 = cons(ids.cl5Rev, 'section = 0.5');
  page = await ctc.get(`/masuratori/nou?family=${ids.famFlex}&machine=${ids.kabmak}&construction=${c05.id}`);
  assert.ok(!/value="toron"/.test(page.text));
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { ...base, construction_id: String(c05.id), level: 'toron', mass_g: '2' });
  assert.equal(r.status, 422);
  r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { ...base, level: 'hack', mass_g: '2' });
  assert.equal(r.status, 422);
  // the register names the level and shows the reported resistance; export carries it
  const reg = await ctc.get('/masuratori');
  assert.match(reg.text, />Toron</);
  const csv = await ctc.get('/masuratori/export?format=csv');
  assert.match(csv.text, /Toron/);
  // correction keeps the level
  const noToron = app.db.get("SELECT record_no FROM measurements WHERE level = 'toron'").record_no;
  const fix = await ctc.postForm(`/masuratori/${noToron}/corecteaza`, `/masuratori/${noToron}/corecteaza`, { ...base, level: 'toron', mass_g: String((tl.min + tl.max) / 2), r_value: '13,5', r_unit: 'ohm_km', temp_c: '26,5', edit_reason: 'Recitire' });
  assert.equal(fix.status, 303);
  const after = results(noToron);
  assert.ok(after.r20_echiv.value < 1.91);
  assert.equal(after.r20_echiv.verdict, 'ok');
});

// ---------------------------------------------------------------- analyses on a known data set

const MASSES = [607.5, 608, 608.5, 609, 608.5, 609.6, 606.8, 608.2]; // 609.6 above max (609.4), 606.8 below min (607)

test('analyses: data set, statistics, capability, non-conformity and consumption match the domain functions', async () => {
  await activate(ids.alDoc, ids.alRev);
  const c240 = cons(ids.alRev, "label = '240 SM 90°'");
  ids.c240 = c240.id;
  const mk = async (machine, mass, extra) => {
    const r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(ids.famFunie), machine_id: String(machine), construction_id: String(c240.id), sample_type_id: String(ids.sample), h: '17.7', l: '22.6', mass_g: String(mass), sample_mm: '1000', ...extra });
    assert.equal(r.status, 303);
    return record(r);
  };
  for (const [i, m] of MASSES.entries()) await mk(i % 2 ? ids.rigid2 : ids.rigid1, m, m === 609.6 ? { produced_length_m: '2000' } : {});
  const key = 'FUNIE|Al|240|SM90';
  const q = new URLSearchParams({ product: key, quantity: 'mass_gm' });

  // distribution page: histogram, Cp / Cpk per machine
  let r = await ctc.get(`/analize/distributie?${q}&group=product`);
  assert.equal(r.status, 200);
  assert.match(r.text, /<svg class="chart"/);
  const s = A.stats(MASSES, 607, 609.4);
  const fmt = (v, d) => v.toFixed(d).replace('.', ',');
  assert.ok(r.text.includes(`>${fmt(s.cp, 2)}<`) || r.text.includes(`>${fmt(s.cp, 2)}</span>`), `Cp ${fmt(s.cp, 2)}`);
  assert.ok(r.text.includes(fmt(s.cpk, 2)));
  assert.match(r.text, /n &lt; 30: orientativ/);
  // by machine: two groups of 4
  r = await ctc.get(`/analize/distributie?${q}&group=machine`);
  assert.match(r.text, /RIGID 1/);
  assert.match(r.text, /RIGID 2/);

  // trend: points coloured by verdict, out-of-limit markers, limits band
  r = await ctc.get(`/analize/tendinta?${q}`);
  assert.equal(r.status, 200);
  assert.equal((r.text.match(/class="ch-pt-out"/g) || []).length, 2);
  assert.equal((r.text.match(/class="ch-pt-ok"/g) || []).length, 6);
  assert.match(r.text, /ch-lim/);
  assert.match(r.text, /v-peste/);

  // non-conformity: 2 of 8 → 25 %, one sub, one peste
  r = await ctc.get(`/analize/neconformitate?product=${key}&quantity=mass_gm`);
  const t = textOf(r.text);
  assert.match(t, /25,0 %/);
  assert.match(t, /12,5 %/);

  // extra consumption: (609.6 − 609.4) g/m over 2000 m = 0.4 kg
  r = await ctc.get(`/analize/consum?product=${key}`);
  assert.match(textOf(r.text), /0,40/);
  assert.match(textOf(r.text), /0,20/);

  // comparison
  r = await ctc.get(`/analize/comparatie?${q}&group=machine`);
  assert.match(r.text, /ch-sd/);
  assert.match(r.text, /ch-mean-dot/);

  // filters: period and machine narrow the data
  r = await ctc.get(`/analize/distributie?${q}&machine_id=${ids.rigid1}&group=product`);
  assert.match(textOf(r.text), /\b4\b/);
  r = await ctc.get(`/analize/distributie?${q}&from=2001-01-01&to=2001-01-02`);
  assert.match(r.text, /Nu există măsurători/);
  // hints when a product is required
  r = await ctc.get('/analize/tendinta');
  assert.match(r.text, /Alegeți un produs/);
});

test('exports: CSV and Excel of an analysis and of the register, all roles', async () => {
  const q = 'product=FUNIE%7CAl%7C240%7CSM90&quantity=mass_gm&group=machine';
  let r = await ctc.get(`/analize/distributie?${q}&format=csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="analiza-distributie-\d{8}\.csv"/);
  const raw = Buffer.from(await (await fetch(app.base + `/analize/distributie?${q}&format=csv`, { headers: { Cookie: ctc.cookieHeader() } })).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
  const lines = r.text.trim().split('\r\n');
  assert.ok(lines[0].split(';').includes('Cpk'));
  assert.equal(lines.length, 3); // header + two machines
  const cpkIdx = lines[0].split(';').indexOf('Cpk');
  assert.match(lines[1].split(';')[cpkIdx], /^-?\d+,\d+$/); // decimal comma

  // Excel: a real .xlsx (zip) that opens again, with numbers as numbers
  const res = await fetch(app.base + `/analize/distributie?${q}&format=xlsx`, { headers: { Cookie: ctc.cookieHeader() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const files = xp.unzip(buf);
  assert.match(files['xl/worksheets/sheet1.xml'].toString(), /<v>\d+(\.\d+)?<\/v>/);

  // register export: CSV wide, XLSX with three sheets (register, results, typed inputs)
  r = await ctc.get('/masuratori/export?format=csv');
  assert.equal(r.status, 200);
  const rows = r.text.trim().split('\r\n');
  assert.ok(rows.length > 8);
  assert.ok(rows[0].includes('Masă [g/m]'));
  const only = await ctc.get('/masuratori/export?format=csv&out=1');
  assert.ok(only.text.trim().split('\r\n').length < rows.length);
  const xr = await fetch(app.base + '/masuratori/export?format=xlsx', { headers: { Cookie: admin.cookieHeader() } });
  const wb = xp.unzip(Buffer.from(await xr.arrayBuffer()));
  assert.match(wb['xl/workbook.xml'].toString(), /Registru[\s\S]*Rezultate[\s\S]*Valori introduse/);
  assert.match(wb['xl/worksheets/sheet2.xml'].toString(), /Peste maxim/);
  // nothing to export: the page explains instead of downloading an empty file
  r = await ctc.get('/analize/tendinta?format=csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
});

test('analyses and exports: hostile names are escaped, formulas are not executed', async () => {
  const op = await engA.postForm('/liste/operatori', '/liste/operatori/adauga', { full_name: '=HYPERLINK("http://x")<script>alert(1)</script>' });
  assert.equal(op.status, 303);
  const opId = app.db.get("SELECT id FROM operators WHERE full_name LIKE '=HYPERLINK%'").id;
  const r = await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(ids.famFunie), machine_id: String(ids.rigid1), construction_id: String(ids.c240), sample_type_id: String(ids.sample), h: '17.7', l: '22.6', mass_g: '608', operator_id: String(opId) });
  assert.equal(r.status, 303);
  const page = await ctc.get('/analize/comparatie?product=FUNIE%7CAl%7C240%7CSM90&quantity=mass_gm&group=operator');
  assert.ok(!page.text.includes('<script>alert(1)'));
  assert.ok(page.text.includes('&lt;script&gt;alert(1)'));
  const csv = await ctc.get('/analize/comparatie?product=FUNIE%7CAl%7C240%7CSM90&quantity=mass_gm&group=operator&format=csv');
  assert.ok(csv.text.includes("'=HYPERLINK"));
  const reg = await ctc.get('/masuratori/export?format=csv');
  assert.ok(reg.text.includes("'=HYPERLINK"));
  const t = await ctc.get('/analize/tendinta?product=FUNIE%7CAl%7C240%7CSM90&quantity=mass_gm');
  assert.ok(!t.text.includes('<script>alert(1)'));
});

test('analysis pages: language rules, no external assets, every role', async () => {
  const bad = /[şţŞŢ]/;
  for (const c of [ctc, engA, admin]) {
    for (const tab of ['tendinta', 'distributie', 'neconformitate', 'consum', 'comparatie']) {
      const r = await c.get(`/analize/${tab}?product=FUNIE%7CAl%7C240%7CSM90&quantity=mass_gm`);
      assert.equal(r.status, 200, tab);
      const tx = textOf(r.text);
      assert.ok(!bad.test(tx) && !/⟦|undefined|NaN/.test(tx), tab);
    }
  }
  const nav = await ctc.get('/');
  assert.match(nav.text, /href="\/analize"/);
  assert.equal((await new (require('./helpers').Client)(app.base).get('/analize')).status, 303); // login required
});
