'use strict';
// Calculated fields (owner 2026-10-31): the formula language (domain/formula.js) and its use in custom fields. The language is data read by our own
// parser: no eval, no loops, bounded size and depth. Results are stored when a record is saved; old results never change behind anyone's back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, makeUser, adminClient } = require('./helpers');
const F = require('../domain/formula');
const custom = require('../domain/custom');
const access = require('../domain/access');

const run = (src, vals = {}, today = 20000) => {
  const p = F.parse(src);
  if (!p.ok) return `parse:${p.code}`;
  try { return F.evaluate(p.ast, { get: (id) => (vals[id] === undefined ? null : vals[id]), today }); } catch (e) { if (e instanceof F.FormulaError) return `eval:${e.code}`; throw e; }
};

// ------------------------------------------------------------------ the language
test('formula: arithmetic, precedence, brackets, power, unary minus, decimal point or comma', () => {
  assert.equal(run('1 + 2 * 3'), 7);
  assert.equal(run('(1 + 2) * 3'), 9);
  assert.equal(run('10 - 4 - 3'), 3, 'left to right');
  assert.equal(run('100 / 5 / 4'), 5);
  assert.equal(run('2 ^ 10'), 1024);
  assert.equal(run('-3 + 5'), 2);
  assert.equal(run('- (2 + 3)'), -5);
  assert.equal(run('0,5 * 4'), 2, 'a decimal comma in a number');
  assert.equal(run('0.5 * 4'), 2);
  assert.equal(run('{1} * {2}', { 1: 3, 2: 4 }), 12);
  assert.equal(run('{1} / {2} + 1', { 1: 9, 2: 3 }), 4);
});

test('formula: an empty input gives an empty result (not zero); if() looks only at the branch it takes; empty(), min / max / avg / sum skip empty values', () => {
  assert.equal(run('{1} * 2', {}), null);
  assert.equal(run('{1} + {2}', { 1: 5 }), null);
  assert.equal(run('if(empty({1}); 0; {1} * 2)', {}), 0);
  assert.equal(run('if(empty({1}); 0; {1} * 2)', { 1: 5 }), 10);
  assert.equal(run('if({1} > 1; 10; 20)', {}), null, 'an empty condition has no answer');
  assert.equal(run('if(1; 7; {9} / 0)'), 7, 'the branch not taken is not evaluated (no division error)');
  assert.equal(run('min({1}; {2}; 5)', { 2: 3 }), 3);
  assert.equal(run('max({1}; {2})', {}), null);
  assert.equal(run('avg({1}; {2}; {3})', { 1: 2, 3: 4 }), 3);
  assert.equal(run('sum({1}; {2})', { 2: 5 }), 5);
  assert.equal(run('empty({1})', {}), 1);
  assert.equal(run('empty({1})', { 1: 0 }), 0, 'zero is a value');
});

test('formula: rounding is exact at the decimals asked (half away from zero), comparisons forgive floating-point noise, three-valued logic', () => {
  assert.equal(run('round(1.005; 2)'), 1.01, 'the classic binary surprise is not one here');
  assert.equal(run('round(2.5)'), 3);
  assert.equal(run('round(-2.5)'), -3);
  assert.equal(run('round(0,125; 2)'), 0.13);
  assert.equal(run('round(1234.5678; 0)'), 1235);
  assert.equal(run('floor(-1.2)'), -2); assert.equal(run('ceil(1.2)'), 2); assert.equal(run('abs(-4)'), 4);
  assert.equal(run('0.1 + 0.2 = 0.3'), 1, 'compare with the same relative tolerance as the verdicts');
  assert.equal(run('0.1 + 0.2 <> 0.3'), 0);
  assert.equal(run('1 < 2 and 3 >= 3'), 1); assert.equal(run('1 > 2 or 0'), 0); assert.equal(run('not 0'), 1);
  assert.equal(run('0 and {1}', {}), 0, 'false and unknown is false');
  assert.equal(run('1 and {1}', {}), null);
  assert.equal(run('1 or {1}', {}), 1);
  assert.equal(run('pow(2; 8)'), 256); assert.equal(run('sqrt(16)'), 4);
  assert.equal(run('today() - 19990'), 10);
});

test('formula: errors are named, never thrown out of the engine, and nothing but numbers can come out', () => {
  assert.equal(run('10 / 0'), 'eval:div0');
  assert.equal(run('{1} / {2}', { 1: 1, 2: 0 }), 'eval:div0');
  assert.equal(run('sqrt(-1)'), 'eval:domain');
  assert.equal(run('(-8) ^ 0.5'), 'eval:domain');
  assert.equal(run('pow(10; 400)'), 'eval:range');
  assert.equal(run('round(1; 12)'), 'eval:digits');
  assert.equal(run(''), 'parse:empty'); assert.equal(run('   '), 'parse:empty');
  assert.equal(run('1 +'), 'parse:syntax'); assert.equal(run('(1 + 2'), 'parse:syntax'); assert.equal(run('1 2'), 'parse:syntax'); assert.equal(run('1 $ 2'), 'parse:syntax');
  assert.equal(run('foo(1)'), 'parse:unknown_function');
  assert.equal(run('abc'), 'parse:unknown_function', 'a bare word is not a field: fields go in [brackets]');
  assert.equal(run('round(1; 2; 3)'), 'parse:arg_count'); assert.equal(run('today(1)'), 'parse:arg_count'); assert.equal(run('if(1; 2)'), 'parse:arg_count');
  assert.equal(run('1 + '.repeat(200) + '1'), 'parse:too_long');
  assert.equal(run('('.repeat(40) + '1' + ')'.repeat(40)), 'parse:too_deep');
  assert.equal(run(Array(100).fill('1').join('+')), 'parse:too_big');
  for (const evil of ['constructor(1)', '__proto__(1)', 'toString(1)', 'hasOwnProperty(1)', 'eval(1)', 'Function(1)', 'process(1)', 'require(1)']) assert.equal(run(evil), 'parse:unknown_function', evil);
  for (const evil of ['this', 'globalThis', 'process.exit', '`x`', '1; 2', 'a.b', '"x"', "'x'", '${1}', '1 // 2', '/* x */ 1']) assert.ok(String(run(evil)).startsWith('parse:'), evil);
});

test('formula: names in [brackets] become ids and back; ambiguity and unknown names are reported', () => {
  const fields = [{ id: 1, label: 'Timp oprire', label_en: 'Downtime' }, { id: 2, label: 'Cantitate', label_en: null }, { id: 3, label: 'Cantitate', label_en: null }, { id: 4, label: 'Preț', label_en: 'Price' }];
  assert.deepEqual(F.toStored('[timp   OPRIRE] / 60', fields), { ok: true, text: '{1} / 60' });
  assert.deepEqual(F.toStored('[Downtime] * [Preț]', fields), { ok: true, text: '{1} * {4}' }, 'either language works');
  assert.equal(F.toStored('[Nimic]', fields).code, 'unknown_field');
  assert.equal(F.toStored('[Cantitate]', fields).code, 'ambiguous_field');
  assert.equal(F.toStored('[a', fields).code, 'syntax');
  assert.equal(F.toDisplay('{1} * {4} + {99}', fields, 'ro'), '[Timp oprire] * [Preț] + [?99]');
  assert.equal(F.toDisplay('{1} * {4}', fields, 'en'), '[Downtime] * [Price]');
  assert.deepEqual(F.refs(F.parse('{1} * ({2} + {1})').ast).sort(), [1, 2]);
});

test('formula: values as a formula sees them (numbers, yes/no, dates as days) and how results are written down', () => {
  assert.equal(F.numberOf('number', '12,5'), 12.5); assert.equal(F.numberOf('number', ''), null); assert.equal(F.numberOf('number', 'x'), null);
  assert.equal(F.numberOf('yesno', '1'), 1); assert.equal(F.numberOf('yesno', '0'), 0);
  assert.equal(F.numberOf('date', '1970-01-02'), 1); assert.equal(F.numberOf('date', '2026-11-10') - F.numberOf('date', '2026-11-03'), 7);
  assert.equal(F.todayNumber('2026-11-03T10:00:00'), F.numberOf('date', '2026-11-03'));
  assert.equal(F.toText(0.30000000000000004, 2), '0.3'); assert.equal(F.toText(12.5, 2), '12.5'); assert.equal(F.toText(-0, 2), '0'); assert.equal(F.toText(null, 2), ''); assert.equal(F.toText(1 / 3, null), String(1 / 3));
});

test('formula: random and hostile input never escapes as an exception and always finishes quickly', () => {
  const alphabet = '0123456789+-*/^()<>=;,. {}[]abcdefghijklmnopqrstuvwxyz_and or not if round min "\'`$\\\n\t';
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const t0 = Date.now();
  let ok = 0;
  for (let i = 0; i < 6000; i++) {
    let s = ''; const len = 1 + Math.floor(rnd() * 60);
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    const r = run(s, { 1: 2, 2: 0 });
    assert.ok(r === null || typeof r === 'number' || typeof r === 'string', s);
    if (typeof r === 'number') ok++;
  }
  for (const s of ['(' .repeat(500), ')'.repeat(500), 'round('.repeat(100), '1+'.repeat(300), '{'.repeat(300), '\u0000', '\ud800', 'if('.repeat(80) + '1' + ')'.repeat(80), '9'.repeat(400), '-'.repeat(400) + '1']) assert.ok(typeof run(s) !== 'undefined', s.slice(0, 20));
  assert.ok(Date.now() - t0 < 5000, 'finished in time');
  assert.ok(ok > 0, 'some of the random strings were valid formulas, so the run exercised evaluation too');
});

test('formula.js has no way to run code: no eval, no Function, no require, no global access', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'domain', 'formula.js'), 'utf8').replace(/\/\/.*$/gm, '');
  for (const bad of [/\beval\s*\(/, /new\s+Function/, /\bFunction\s*\(/, /\brequire\s*\(/, /\bprocess\b/, /\bglobalThis\b/, /\bimport\s*\(/, /\bsetTimeout\b/, /\bfetch\b/]) assert.ok(!bad.test(src), String(bad));
});

// ------------------------------------------------------------------ calculated custom fields
let app, admin, lead;
const ids = {};
const post = (c, p, fields, pg = '/') => c.postForm(pg, p, fields);
const cell = (taskId, field) => app.db.get('SELECT value FROM custom_values WHERE kind = ? AND record_id = ? AND field_id = ?', 'task', taskId, field);

test.before(async () => {
  app = await startApp();
  admin = await adminClient(app);
  lead = await makeUser(app, admin, 'lead.fx', 'personal', 'Șef Formule');
  access.setUserLevels(app.db, app.db.get("SELECT id FROM users WHERE username = 'lead.fx'").id, { maintenance: 'lead', quality: 'lead', meetings: 'lead' });
});
test.after(async () => { await app.cleanup(); });

const field = (f) => post(admin, '/admin/campuri/nou', f, '/admin/campuri');
const errorsOf = (r) => [...r.text.matchAll(/class="field-error"[^>]*>([^<]*)/g)].map((m) => m[1]);

test('making calculated fields: names in brackets, checked when saved, versions kept; only the fields of the same kind can be used', async () => {
  const base = { kind: 'task', show_in_list: '1' };
  for (const [key, f] of Object.entries({
    minutes: { type: 'number', label: 'Timp oprire', label_en: 'Downtime', unit: 'min' },
    rate: { type: 'number', label: 'Preț oră', label_en: 'Hourly price', unit: 'RON' },
    start: { type: 'date', label: 'Început' },
    end: { type: 'date', label: 'Sfârșit' },
    note: { type: 'text', label: 'Notă' },
    mtgNum: { kind: 'meeting', type: 'number', label: 'Număr ședință' },
  })) { assert.equal((await field({ ...base, ...f })).status, 303, key); ids[key] = app.db.get('SELECT id FROM custom_fields WHERE label = ?', f.label).id; }

  const mk = (extra) => field({ ...base, type: 'calc', label: 'Calc', ...extra });
  // refusals, each with its reason
  for (const [formula, code] of [['', 'formula_empty'], ['[Timp oprire] +', 'formula_syntax'], ['[Nu există] * 2', 'formula_unknown_field'], ['[Notă] * 2', 'formula_unknown_field'], ['[Număr ședință] * 2', 'formula_unknown_field'], ['round(1;2;3)', 'formula_arg_count'], ['5 * 2', 'formula_no_field'], ['foo([Timp oprire])', 'formula_unknown_function'], ['x'.repeat(601), 'formula_too_long']]) {
    const r = await mk({ formula });
    assert.equal(r.status, 422, formula);
    assert.ok(errorsOf(r).length >= 1, `${formula}: a message`);
    assert.equal(app.db.value("SELECT count(*) FROM custom_fields WHERE label = 'Calc'"), 0, `${formula}: nothing saved`);
  }
  assert.match((await mk({ formula: '[Nu există]' })).text, /nu există/i);

  // a good one
  const ok = await field({ ...base, type: 'calc', label: 'Cost oprire', label_en: 'Downtime cost', unit: 'RON', decimals: '2', formula: 'round([timp oprire] / 60 * [PREȚ OORĂ]; 2)' });
  assert.equal(ok.status, 422, 'a misspelt field name is refused');
  const good = await field({ ...base, type: 'calc', label: 'Cost oprire', label_en: 'Downtime cost', unit: 'RON', decimals: '2', formula: 'round([timp oprire] / 60 * [Preț oră]; 2)' });
  assert.equal(good.status, 303);
  const row = app.db.get("SELECT * FROM custom_fields WHERE label = 'Cost oprire'");
  ids.cost = row.id;
  assert.equal(row.type, 'number'); assert.equal(row.formula, `round({${ids.minutes}} / 60 * {${ids.rate}}; 2)`, 'stored with ids, so a rename cannot break it');
  assert.equal(row.decimals, 2); assert.equal(row.required, 0);
  assert.equal(app.db.value('SELECT count(*) FROM custom_formula_history WHERE field_id = ?', ids.cost), 1);
  // days between two dates, and a calculated field built on another one
  assert.equal((await field({ ...base, type: 'calc', label: 'Durată zile', decimals: '0', unit: 'zile', formula: '[Sfârșit] - [Început]' })).status, 303);
  ids.days = app.db.get("SELECT id FROM custom_fields WHERE label = 'Durată zile'").id;
  assert.equal((await field({ ...base, type: 'calc', label: 'Cost cu TVA', decimals: '2', unit: 'RON', formula: '[Cost oprire] * 1,19' })).status, 303);
  ids.vat = app.db.get("SELECT id FROM custom_fields WHERE label = 'Cost cu TVA'").id;
  assert.equal((await field({ ...base, type: 'calc', label: 'Prag', decimals: '0', formula: 'if([Timp oprire] > 120; 1; 0)' })).status, 303);
  ids.flag = app.db.get("SELECT id FROM custom_fields WHERE label = 'Prag'").id;
  // decimals out of range fall back to 2
  assert.equal((await field({ ...base, type: 'calc', label: 'Zec', decimals: '9', formula: '[Timp oprire] / 7' })).status, 303);
  assert.equal(app.db.get("SELECT decimals FROM custom_fields WHERE label = 'Zec'").decimals, 2);

  // the pages show them as calculated
  const admPage = (await admin.get('/admin/campuri')).text;
  assert.match(admPage, /Număr calculat/);
  const edit = (await admin.get(`/admin/campuri/${ids.cost}/editeaza`)).text;
  assert.match(edit, /round\(\[Timp oprire\] \/ 60 \* \[Preț oră\]; 2\)/, 'the formula is shown with names again');
  assert.match(edit, /Versiunile formulei/); assert.match(edit, /Recalculează toate/);
  assert.match(edit, /name="type" value="calc"/);
  // a non-admin has no way in
  assert.equal((await lead.get(`/admin/campuri/${ids.cost}/editeaza`)).status, 403);
  assert.equal((await post(lead, `/admin/campuri/${ids.cost}/recalcula`, {}, '/')).status, 403);
});

test('a calculated field cannot use a later calculated field, itself, or a field of another team', async () => {
  // editing "Cost oprire" to use "Cost cu TVA" (made after it) would risk a loop
  const r = await post(admin, `/admin/campuri/${ids.cost}/editeaza`, { label: 'Cost oprire', unit: 'RON', decimals: '2', show_in_list: '1', active: '1', formula: '[Cost cu TVA] / 1,19' }, '/admin/campuri');
  assert.equal(r.status, 422);
  assert.match(r.text, /creat după ea/);
  assert.equal(app.db.get('SELECT formula FROM custom_fields WHERE id = ?', ids.cost).formula, `round({${ids.minutes}} / 60 * {${ids.rate}}; 2)`);
  // itself: its own name is not offered
  const self = await post(admin, `/admin/campuri/${ids.cost}/editeaza`, { label: 'Cost oprire', unit: 'RON', decimals: '2', show_in_list: '1', active: '1', formula: '[Cost oprire] + 1' }, '/admin/campuri');
  assert.equal(self.status, 422);
  // a field of one team only is not usable by a field for another team or for all
  await field({ kind: 'task', type: 'number', label: 'Doar mentenanță', team: 'maintenance', show_in_list: '1' });
  const wide = await field({ kind: 'task', type: 'calc', label: 'Pentru toți', formula: '[Doar mentenanță] * 2', show_in_list: '1' });
  assert.equal(wide.status, 422, 'a field for all teams cannot use a field of one team');
  assert.equal((await field({ kind: 'task', type: 'calc', label: 'Pentru mentenanță', team: 'maintenance', formula: '[Doar mentenanță] * 2', show_in_list: '1' })).status, 303);
});

test('a task takes the results: worked out when saved, shown in the form live (output + script), kept as text, never typed by hand', async () => {
  const k = (n) => `cf_${ids[n]}`;
  const form = (await lead.get('/mentenanta/nou')).text;
  assert.match(form, /data-calc-out="\d+"/);
  assert.match(form, /data-calcs="/);
  assert.match(form, /\/static\/formula\.js/); assert.match(form, /\/static\/custom-calc\.js/);
  assert.ok(!new RegExp(`name="cf_${ids.cost}"`).test(form), 'a result has no input');
  const js = await fetch(`${app.base}/static/formula.js`);
  assert.equal(js.status, 200);
  assert.equal(await js.text(), fs.readFileSync(path.join(__dirname, '..', 'domain', 'formula.js'), 'utf8'), 'the browser runs the very file the server runs');

  // create: 90 minutes at 40 RON an hour
  const r = await post(lead, '/mentenanta/nou', { title: 'Oprire cu cost', [k('minutes')]: '90', [k('rate')]: '40', [k('start')]: '2026-11-03', [k('end')]: '2026-11-10', [`cf_${ids.cost}`]: '999999' }, '/mentenanta/nou');
  assert.equal(r.status, 303);
  const t = app.db.get("SELECT id FROM tasks WHERE title = 'Oprire cu cost'").id; ids.task = t;
  assert.equal(cell(t, ids.cost).value, '60', '90 / 60 * 40 = 60, and a typed value for a result is ignored');
  assert.equal(cell(t, ids.vat).value, '71.4', 'a calculated field on a calculated field');
  assert.equal(cell(t, ids.days).value, '7');
  assert.equal(cell(t, ids.flag).value, '0');
  const page = (await lead.get(`/sarcini/${t}`)).text;
  assert.match(page, /60,00 RON/); assert.match(page, /71,40 RON/); assert.match(page, /7 zile/);
  assert.match(page, /title="calculat">ƒ/);
  // the board shows the columns, the export carries numbers
  const board = (await lead.get('/mentenanta?view=all')).text;
  assert.match(board, /Cost oprire \[RON\]/); assert.match(board, /71,40 RON/);
  const csv = (await lead.get('/sarcini/export?team=maintenance&format=csv&view=all')).text;
  assert.match(csv.split(/\r?\n/)[0], /Cost oprire \[RON\]/);
  assert.match(csv, /71,4/);

  // an empty input leaves the result empty; a missing result is not zero
  await post(lead, '/mentenanta/nou', { title: 'Fără timp', [k('rate')]: '40' }, '/mentenanta/nou');
  const t2 = app.db.get("SELECT id FROM tasks WHERE title = 'Fără timp'").id;
  assert.ok(!cell(t2, ids.cost) || cell(t2, ids.cost).value === '');
  assert.match((await lead.get(`/sarcini/${t2}`)).text, /Cost oprire[\s\S]{0,120}—/);

  // edit: new input, new result, and the history says what was calculated
  const e = await post(lead, `/sarcini/${t}/editeaza`, { title: 'Oprire cu cost', priority_id: '', [k('minutes')]: '150', [k('rate')]: '40', [k('start')]: '2026-11-03', [k('end')]: '2026-11-10' }, `/sarcini/${t}/editeaza`);
  assert.equal(e.status, 303);
  assert.equal(cell(t, ids.cost).value, '100'); assert.equal(cell(t, ids.flag).value, '1');
  const ev = app.db.all("SELECT details FROM task_events WHERE task_id = ? AND kind = 'edit' ORDER BY id DESC", t).map((x) => JSON.parse(x.details)).find((d) => d.custom);
  assert.ok(ev.custom.some((c) => c.calculated && c.label.startsWith('Cost oprire') && c.from === '60,00 RON' && c.to === '100,00 RON'), JSON.stringify(ev));
  // saving again without a change writes no history
  const before = app.db.value('SELECT count(*) FROM task_events WHERE task_id = ?', t);
  await post(lead, `/sarcini/${t}/editeaza`, { title: 'Oprire cu cost', priority_id: '', [k('minutes')]: '150', [k('rate')]: '40', [k('start')]: '2026-11-03', [k('end')]: '2026-11-10' }, `/sarcini/${t}/editeaza`);
  assert.equal(app.db.value('SELECT count(*) FROM task_events WHERE task_id = ?', t), before);
});

test('filters work on results; a division by zero or a bad date leaves the result empty and the record still saves', async () => {
  const k = (n) => `cf_${ids[n]}`;
  const titles = async (qs) => [...(await lead.get(`/mentenanta?view=all&${qs}`)).text.matchAll(/<td class="task-title"><a href="\/sarcini\/\d+"><strong>([^<]+)<\/strong>/g)].map((m) => m[1]).sort();
  assert.deepEqual(await titles(`cf${ids.cost}_a=90`), ['Oprire cu cost']);
  assert.deepEqual(await titles(`cf${ids.cost}_b=10`), []);
  // a field whose formula divides by an input that is zero
  await field({ kind: 'task', type: 'calc', label: 'Pe oră', decimals: '2', formula: '[Timp oprire] / [Preț oră]', show_in_list: '1' });
  ids.perh = app.db.get("SELECT id FROM custom_fields WHERE label = 'Pe oră'").id;
  const r = await post(lead, '/mentenanta/nou', { title: 'Preț zero', [k('minutes')]: '10', [k('rate')]: '0' }, '/mentenanta/nou');
  assert.equal(r.status, 303, 'the record saves');
  const t = app.db.get("SELECT id FROM tasks WHERE title = 'Preț zero'").id;
  assert.ok(!cell(t, ids.perh) || cell(t, ids.perh).value === '', 'the result is empty, not Infinity');
  assert.equal(cell(t, ids.cost).value, '0');
});

test('changing a formula never changes old results by itself: records keep theirs until saved or until the administrator recalculates; every version is kept', async () => {
  const t = ids.task;
  const old = cell(t, ids.cost).value;
  const c = await post(admin, `/admin/campuri/${ids.cost}/editeaza`, { label: 'Cost oprire', label_en: 'Downtime cost', unit: 'RON', decimals: '2', show_in_list: '1', active: '1', formula: 'round([Timp oprire] / 60 * [Preț oră] * 2; 2)' }, '/admin/campuri');
  assert.equal(c.status, 303);
  assert.equal(cell(t, ids.cost).value, old, 'the old record still shows its old result');
  assert.equal(app.db.value('SELECT count(*) FROM custom_formula_history WHERE field_id = ?', ids.cost), 2);
  const hist = (await admin.get(`/admin/campuri/${ids.cost}/editeaza`)).text;
  assert.match(hist, /\* 2; 2\)/); assert.match(hist, /<span class="tag ok">curentă<\/span>/);
  // a record saved after the change uses the new formula
  const k = (n) => `cf_${ids[n]}`;
  await post(lead, '/mentenanta/nou', { title: 'A doua oprire', [k('minutes')]: '60', [k('rate')]: '10' }, '/mentenanta/nou');
  const t2 = app.db.get("SELECT id FROM tasks WHERE title = 'A doua oprire'").id;
  assert.equal(cell(t2, ids.cost).value, '20', 'saved after the change: uses the new formula (60 / 60 * 10 * 2)');
});

test('recalculate: explicit, audited, visits every record', async () => {
  const before = app.db.value("SELECT count(*) FROM audit_log WHERE action = 'custom_recalc'");
  const t = ids.task;
  const r = await post(admin, `/admin/campuri/${ids.cost}/recalcula`, {}, `/admin/campuri/${ids.cost}/editeaza`);
  assert.equal(r.status, 303);
  assert.equal(app.db.value("SELECT count(*) FROM audit_log WHERE action = 'custom_recalc'"), before + 1);
  assert.equal(cell(t, ids.cost).value, '200', '150 / 60 * 40 * 2');
  assert.equal(cell(t, ids.vat).value, '238', 'and the field built on it follows');
  const log = app.db.get("SELECT details FROM audit_log WHERE action = 'custom_recalc' ORDER BY id DESC LIMIT 1");
  assert.ok(JSON.parse(log.details).records >= 3);
});

test('hidden fields still feed a formula; a hidden calculated field stays on records but is no longer recalculated; the formula survives a rename of its inputs', async () => {
  const k = (n) => `cf_${ids[n]}`;
  // rename an input: the formula still works, and shows the new name
  await post(admin, `/admin/campuri/${ids.minutes}/editeaza`, { label: 'Minute oprire', label_en: 'Downtime minutes', unit: 'min', show_in_list: '1', active: '1' }, '/admin/campuri');
  assert.match((await admin.get(`/admin/campuri/${ids.cost}/editeaza`)).text, /\[Minute oprire\]/);
  // hide the rate: forms lose the input, the stored values stay and the formula still uses them
  await post(admin, `/admin/campuri/${ids.rate}/editeaza`, { label: 'Preț oră', label_en: 'Hourly price', unit: 'RON', show_in_list: '1' }, '/admin/campuri');
  assert.equal(app.db.get('SELECT active FROM custom_fields WHERE id = ?', ids.rate).active, 0);
  assert.ok(!(await lead.get('/mentenanta/nou')).text.includes(`name="cf_${ids.rate}"`));
  const t = ids.task;
  const r = await post(lead, `/sarcini/${t}/editeaza`, { title: 'Oprire cu cost', priority_id: '', [k('minutes')]: '300', [k('start')]: '2026-11-03', [k('end')]: '2026-11-10' }, `/sarcini/${t}/editeaza`);
  assert.equal(r.status, 303);
  assert.equal(cell(t, ids.cost).value, '400', 'the hidden price (40) is still used: 300 / 60 * 40 * 2');
  // the edit form still shows the hidden field's value to the formula (the page carries it for the live result)
  const edit = (await lead.get(`/sarcini/${t}/editeaza`)).text;
  assert.match(edit, new RegExp(`&quot;stored&quot;:\\{[^}]*&quot;${ids.rate}&quot;:&quot;40&quot;`));
  // hide a calculated field: it is no longer calculated on save, its stored value stays
  await post(admin, `/admin/campuri/${ids.flag}/editeaza`, { label: 'Prag', decimals: '0', show_in_list: '1', formula: 'if([Minute oprire] > 120; 1; 0)' }, '/admin/campuri');
  await post(lead, `/sarcini/${t}/editeaza`, { title: 'Oprire cu cost', priority_id: '', [k('minutes')]: '10', [k('start')]: '2026-11-03', [k('end')]: '2026-11-10' }, `/sarcini/${t}/editeaza`);
  assert.equal(cell(t, ids.flag).value, '1', 'the old result is left alone');
});

test('non-conformities and meetings can have calculated fields too', async () => {
  await field({ kind: 'ncr', type: 'number', label: 'Metri afectați', show_in_list: '1' });
  await field({ kind: 'ncr', type: 'number', label: 'Preț metru', show_in_list: '1' });
  assert.equal((await field({ kind: 'ncr', type: 'calc', label: 'Pierdere', unit: 'RON', decimals: '2', formula: '[Metri afectați] * [Preț metru]', show_in_list: '1' })).status, 303);
  const idOf = (l) => app.db.get('SELECT id FROM custom_fields WHERE label = ?', l).id;
  const r = await post(lead, '/calitate/nou', { title: 'NC cu pierdere', [`cf_${idOf('Metri afectați')}`]: '120,5', [`cf_${idOf('Preț metru')}`]: '3' }, '/calitate/nou');
  assert.equal(r.status, 303);
  const n = app.db.get("SELECT id FROM ncrs WHERE title = 'NC cu pierdere'").id;
  assert.equal(app.db.get('SELECT value FROM custom_values WHERE kind = ? AND record_id = ? AND field_id = ?', 'ncr', n, idOf('Pierdere')).value, '361.5');
  assert.match((await lead.get(`/calitate/neconformitati/${n}`)).text, /361,50 RON/);
  assert.match((await lead.get('/calitate/export?view=all&format=csv')).text, /361,5/);

  await field({ kind: 'meeting', type: 'number', label: 'Participanți externi' });
  assert.equal((await field({ kind: 'meeting', type: 'calc', label: 'Dublu', decimals: '0', formula: '[Participanți externi] * 2' })).status, 303);
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  assert.equal((await post(lead, '/sedinte/nou', { title: 'Ședință calc', meeting_date: day, start_time: '09:00', duration_min: '30', teams: ['quality'], [`cf_${idOf('Participanți externi')}`]: '4' }, '/sedinte/nou')).status, 303);
  const m = app.db.get("SELECT id FROM meetings WHERE title = 'Ședință calc'").id;
  assert.equal(app.db.get('SELECT value FROM custom_values WHERE kind = ? AND record_id = ? AND field_id = ?', 'meeting', m, idOf('Dublu')).value, '8');
});

test('a formula text is escaped everywhere it is shown, and the audit log keeps the formula that was set', async () => {
  const evil = '[Minute oprire] + 1 <img src=x onerror=alert(1)>';
  const r = await field({ kind: 'task', type: 'calc', label: 'Rău', formula: evil, show_in_list: '1' });
  assert.equal(r.status, 422);
  assert.ok(!r.text.includes('<img src=x'), 'a refused formula is shown as text');
  const log = app.db.all("SELECT details FROM audit_log WHERE action = 'custom_field_create' AND details LIKE '%formula%'");
  assert.ok(log.length >= 3);
  assert.ok(log.some((l) => JSON.parse(l.details).formula));
});
