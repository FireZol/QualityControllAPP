'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUser, adminClient, textOf } = require('./helpers');
const rev = require('../domain/revisions');
const ver = require('../domain/verification');

let app, admin, engA, engB, ctc, docId, revId, rows;
test.before(async () => {
  app = await startApp({ modulesOff: true });
  admin = await adminClient(app);
  engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Inginer A');
  engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Inginer B');
  ctc = await makeUser(app, admin, 'ctc1', 'personal', 'CTC');
  docId = app.db.get("SELECT id FROM spec_documents WHERE doc_type = 'CABLARE_RIGIDA_AL'").id;
  revId = app.db.get('SELECT id FROM spec_revisions WHERE document_id = ?', docId).id;
  rows = app.db.all('SELECT id FROM constructions WHERE revision_id = ? AND active = 1 ORDER BY sort, id', revId).map((r) => r.id);
});
test.after(async () => { await app.cleanup(); });

const base = () => `/fise/${docId}/revizii/${revId}`;
const checked = () => app.db.all('SELECT * FROM construction_checks WHERE revision_id = ?', revId);
const typedFor = (cid) => {
  const full = rev.loadRevision(app.db, revId);
  const c = full.constructions.find((x) => x.id === cid);
  return ver.checkpoints(c).map((p) => p.value);
};

test('the check starts at the first unchecked row and shows the sheet values next to inputs for the paper', async () => {
  const r = await engA.get(`${base()}/verificare`);
  assert.equal(r.status, 303);
  assert.equal(r.location, `${base()}/verificare/${rows[0]}`);
  const page = await engA.get(r.location);
  assert.equal(page.status, 200);
  assert.match(textOf(page.text), /Rândul 1 din \d+/);
  assert.ok(page.text.includes('data-paper') && page.text.includes('/static/verify.js') && page.text.includes('id="verify-check"'));
  assert.ok(ver.checkpoints(rev.loadRevision(app.db, revId).constructions[0]).length >= 3, 'wires, wire diameter and limits are on the list');
});

test('ticking a row by eye, then with typed values; a wrong typed value is refused and nothing is marked', async () => {
  const url = (cid) => `${base()}/verificare/${cid}`;
  // visual tick: goes on to the next unchecked row
  let r = await engA.postForm(url(rows[0]), url(rows[0]), { action: 'check' });
  assert.equal(r.status, 303);
  assert.equal(r.location, url(rows[1]));
  assert.equal(checked().length, 1);
  assert.equal(checked()[0].method, 'visual');
  // typed values, comma or dot, all matching
  const vals = typedFor(rows[1]);
  const form = { action: 'check', note: 'ok pe hârtie' };
  vals.forEach((v, i) => { form[`paper_${i}`] = i % 2 ? String(v).replace('.', ',') : String(v); });
  r = await engA.postForm(url(rows[1]), url(rows[1]), form);
  assert.equal(r.status, 303);
  const k = checked().find((x) => x.construction_id === rows[1]);
  assert.equal(k.method, 'typed');
  assert.equal(k.note, 'ok pe hârtie');
  // one wrong value: refused, the typed text is kept, no mark
  const wrong = { action: 'check' };
  typedFor(rows[2]).forEach((v, i) => { wrong[`paper_${i}`] = String(i === 1 ? v + 0.5 : v); });
  r = await engB.postForm(url(rows[2]), url(rows[2]), wrong);
  assert.equal(r.status, 422);
  assert.match(textOf(r.text), /Valorile scrise nu coincid cu fișa/);
  assert.ok(r.text.includes(`value="${wrong.paper_1}"`));
  assert.ok(!checked().some((x) => x.construction_id === rows[2]));
  // unreadable text is also refused
  r = await engB.postForm(url(rows[2]), url(rows[2]), { action: 'check', paper_0: 'abc' });
  assert.equal(r.status, 422);
  // skipping marks nothing; un-ticking removes the mark
  r = await engB.postForm(url(rows[2]), url(rows[2]), { action: 'skip' });
  assert.equal(r.location, url(rows[3]));
  assert.equal(checked().length, 2);
  await engA.postForm(url(rows[0]), url(rows[0]), { action: 'uncheck' });
  assert.equal(checked().length, 1);
});

test('Personal can look but not tick; Administrator likewise; progress and ticks show on the revision page', async () => {
  const url = `${base()}/verificare/${rows[0]}`;
  const view = await ctc.get(url);
  assert.equal(view.status, 200);
  assert.ok(!view.text.includes('data-paper') && !view.text.includes('id="verify-check"'));
  assert.equal((await ctc.postForm(url, url, { action: 'check' })).status, 403);
  assert.equal((await admin.postForm(url, url, { action: 'check' })).status, 403);
  const rp = textOf((await engA.get(base())).text);
  assert.match(rp, /1 din \d+ rânduri verificate/);
  assert.ok((await engA.get(base())).text.includes('✓ verificat'));
  assert.ok((await engA.get(base())).text.includes('id="row-filter"'));
});

/** The fields of an editor page as a browser would send them back (inputs, selects, textareas). */
function replay(html) {
  const form = {};
  const attr = (tag, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(tag); return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null; };
  const body = html.slice(html.indexOf('class="entry construction-form"'));
  for (const m of body.matchAll(/<input\b[^>]*>/g)) {
    const t = m[0]; const name = attr(t, 'name'); const type = attr(t, 'type');
    if (!name || type === 'submit' || name === '_csrf' && false) continue;
    if (type === 'checkbox') { if (/\schecked(\s|>|=)/.test(t)) form[name] = attr(t, 'value') || '1'; continue; }
    form[name] = attr(t, 'value') || '';
  }
  for (const m of body.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const sel = /<option value="([^"]*)"[^>]*\sselected/.exec(m[2]); const first = /<option value="([^"]*)"/.exec(m[2]);
    form[m[1]] = sel ? sel[1] : (first ? first[1] : '');
  }
  for (const m of body.matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) form[m[1]] = m[2];
  return form;
}

test('the row editor: previous / next, save and next, back to the check; the last row has no next', async () => {
  const ed = (cid) => `${base()}/constructii/${cid}`;
  const page = await engA.get(ed(rows[2]));
  assert.equal(page.status, 200);
  assert.match(textOf(page.text), /Rândul 3 din \d+/);
  assert.ok(page.text.includes(`href="${ed(rows[1])}"`) && page.text.includes(`href="${ed(rows[3])}"`));
  assert.ok(page.text.includes('name="after" value="next"') && !page.text.includes('name="after" value="verify"'));
  const fromCheck = await engA.get(`${ed(rows[2])}?from=verificare`);
  assert.ok(fromCheck.text.includes('name="after" value="verify"') && fromCheck.text.includes('name="from" value="verificare"'));
  const last = await engA.get(ed(rows[rows.length - 1]));
  assert.ok(!last.text.includes('name="after" value="next"'));
  // a ticked row warns that saving clears the tick
  ver.mark(app.db, app.db.get("SELECT * FROM users WHERE username = 'ing.a'"), revId, rows[2], 'visual');
  const warn = await engA.get(ed(rows[2]));
  assert.match(textOf(warn.text), /salvarea șterge bifa/);
  // Save and next: goes to the next row's editor and clears the tick of the saved row
  const fields = replay(warn.text);
  assert.ok(fields.section && fields.label, 'the replay found the form fields');
  let r = await engA.postForm(ed(rows[2]), ed(rows[2]), { ...fields, after: 'next' });
  assert.equal(r.status, 303, textOf(r.text).slice(0, 300));
  assert.equal(r.location, ed(rows[3]));
  assert.ok(!checked().some((x) => x.construction_id === rows[2]));
  // Save and back to the check
  r = await engA.postForm(ed(rows[2]), ed(rows[2]), { ...fields, after: 'verify', from: 'verificare' });
  assert.equal(r.location, `${base()}/verificare/${rows[2]}`);
  // plain Save goes to the revision page
  r = await engA.postForm(ed(rows[2]), ed(rows[2]), fields);
  assert.equal(r.location, base());
});

test('editing a row clears its tick; a closed revision cannot be ticked; English page has no missing text', async () => {
  const cid = rows[1];
  assert.ok(checked().some((x) => x.construction_id === cid));
  const c = app.db.get('SELECT * FROM constructions WHERE id = ?', cid);
  const saved = rev.saveConstruction(app.db, app.db.get("SELECT * FROM users WHERE username = 'ing.a'"), revId, cid, {
    material_id: c.material_id, section: c.section, shape_id: c.shape_id, destination_id: c.destination_id, coated: c.coated, label: c.label,
    wires: c.wires, wire_d: c.wire_d, die: c.die, iec_exception_reason: c.iec_exception_reason, data: JSON.parse(c.data || '{}'), limits: [], params: [],
  });
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.ok(!checked().some((x) => x.construction_id === cid), 'a changed row has to be checked again');
  // English
  await engA.postForm('/', '/limba', { lang: 'en', back: '/' });
  const en = await engA.get(`${base()}/verificare/${rows[0]}`);
  assert.ok(!en.text.includes('⟦') && textOf(en.text).includes('Check against the paper original') && textOf(en.text).includes('On the paper'));
  // submit and activate: afterwards the check is closed
  await engA.postForm(base(), `${base()}/trimite`, {});
  await engB.postForm(base(), `${base()}/verifica`, {});
  assert.equal(app.db.get('SELECT status FROM spec_revisions WHERE id = ?', revId).status, 'activa');
  assert.equal(ver.mark(app.db, { id: 1 }, revId, rows[0], 'visual').code, 'verify_closed');
  assert.equal((await engB.postForm(`${base()}/verificare/${rows[0]}`, `${base()}/verificare/${rows[0]}`, { action: 'check' })).status, 403);
});
