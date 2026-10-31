'use strict';
// Real-browser walk-through of custom fields and lists (development tool): an administrator makes a list and fields through the screens,
// a person uses them on a task, a non-conformity and a meeting, filters by them and downloads the export.
//   node tools/custom-walkthrough.js [screenshot-dir]        needs Playwright (npm root -g)
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { startApp, adminClient } = require('../app/test/helpers');

const shots = process.argv[2];
const step = (m) => console.log('•', m);

async function main() {
  const app = await startApp();
  const admin = await adminClient(app);
  const db = app.db; const base = app.base;
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'dark', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  const shot = async (n) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${n}.png`), fullPage: true }); } };
  await page.goto(base + '/login');
  await page.fill('input[name=username]', 'admin'); await page.fill('input[name=password]', admin.password);
  await page.click('main button[type=submit]'); await page.waitForURL(base + '/');

  // ---- the admin makes a list and its items
  await page.click('.side summary:has-text("Administrare")');
  await page.click('.side a[href="/admin/campuri"]');
  await page.click('a[href="/admin/campuri/liste"]');
  await page.fill('form[action="/admin/campuri/liste/nou"] input[name=name]', 'Cauze defect');
  await page.fill('form[action="/admin/campuri/liste/nou"] input[name=name_en]', 'Defect causes');
  await page.click('form[action="/admin/campuri/liste/nou"] button[type=submit]');
  await page.waitForURL(/\/admin\/campuri\/liste\/\d+$/);
  await page.fill('textarea[name=items]', 'Uzură filieră | Die wear\nTemperatură | Temperature\nMaterie primă | Raw material');
  await page.click('form[action$="/element"] button[type=submit]');
  assert.equal(db.value('SELECT count(*) FROM custom_list_items'), 3);
  await shot('custom-1-list');
  step('list made with three items');

  // ---- fields
  await page.goto(base + '/admin/campuri');
  const addField = async (kind, type, label, labelEn, extra) => {
    await page.goto(base + '/admin/campuri');
    const form = page.locator('form[action="/admin/campuri/nou"]');
    await form.locator('select[name=kind]').selectOption(kind);
    await form.locator('select[name=type]').selectOption(type);
    await form.locator('input[name=label]').fill(label);
    await form.locator('input[name=label_en]').fill(labelEn);
    if (extra && extra.list) await form.locator('select[name=list_id]').selectOption({ label: extra.list });
    if (extra && extra.unit) await form.locator('input[name=unit]').fill(extra.unit);
    if (extra && extra.required) await form.locator('input[name=required]').check();
    await form.locator('button[type=submit]').click();
    await page.waitForURL(base + '/admin/campuri');
  };
  await addField('ncr', 'list', 'Cauza defectului', 'Defect cause', { list: 'Cauze defect', required: true });
  await addField('task', 'number', 'Timp oprire', 'Downtime', { unit: 'min' });
  await addField('task', 'list', 'Cauza defectului', 'Defect cause', { list: 'Cauze defect' });
  await addField('meeting', 'text', 'Subiect principal', 'Main topic');
  assert.equal(db.value('SELECT count(*) FROM custom_fields'), 4);
  await shot('custom-2-fields');
  step('four fields made through the screen');

  // ---- a task uses them
  await page.goto(base + '/mentenanta/nou');
  await page.fill('input[name=title]', 'Oprire extruder 1');
  const taskForm = page.locator('form.entry');
  await taskForm.locator('input[name^=cf_]').first().fill('abc');       // downtime: not a number
  await page.click('main form button.primary[type=submit]');
  await page.waitForLoadState();
  assert.ok(await page.locator('[data-form-summary]').count(), 'the "nothing was saved" banner shows');
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.name && document.activeElement.name.startsWith('cf_')), 'the cursor is on the marked field');
  await shot('custom-3-task-error');
  await page.locator('input[name^=cf_]').first().fill('45,5');
  await page.locator('select[name^=cf_]').first().selectOption({ label: 'Uzură filieră' });
  await page.click('main form button.primary[type=submit]');
  await page.waitForURL(/\/sarcini\/\d+$/);
  const body = await page.locator('main').innerText();
  assert.match(body, /45,5 min/); assert.match(body, /Uzură filieră/);
  await shot('custom-4-task');
  step('task saved; values on its page');

  // second task, then filter + export through the board
  await page.goto(base + '/mentenanta/nou');
  await page.fill('input[name=title]', 'Schimb lagăr'); await page.locator('input[name^=cf_]').first().fill('10');
  await page.locator('select[name^=cf_]').first().selectOption({ label: 'Temperatură' });
  await page.click('main form button.primary[type=submit]'); await page.waitForURL(/\/sarcini\/\d+$/);
  await page.goto(base + '/mentenanta');
  assert.equal(await page.locator('tbody tr').count(), 2);
  await page.locator('form.filters select[name^=cf]').first().selectOption({ label: 'Temperatură' });
  await page.click('form.filters button.primary');
  await page.waitForLoadState();
  assert.equal(await page.locator('tbody tr').count(), 1);
  assert.match(await page.locator('tbody').innerText(), /Schimb lagăr/);
  await shot('custom-5-board-filtered');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a[href*="/sarcini/export"][href*="format=csv"]')]);
  const file = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(file, /Timp oprire \[min\]/); assert.match(file, /Schimb lagăr/); assert.ok(!file.includes('Oprire extruder'));
  step('board filtered by a custom list field; the export has the column and the same filter');

  // ---- a non-conformity: the required field
  await page.goto(base + '/calitate/nou');
  await page.fill('input[name=title]', 'Diametru în afara toleranței');
  await page.click('main form button.primary[type=submit]');
  assert.match(page.url(), /\/calitate\/nou$/, 'a required field stops the form in the browser already');
  assert.equal(db.value("SELECT count(*) FROM ncrs WHERE title = 'Diametru în afara toleranței'"), 0);
  await page.locator('select[name^=cf_]').first().selectOption({ label: 'Uzură filieră' });
  await page.click('main form button.primary[type=submit]');
  await page.waitForURL(/\/neconformitati\/\d+$/);
  assert.match(await page.locator('main').innerText(), /cauza defectului/i);
  await shot('custom-6-ncr');
  step('non-conformity: required custom field enforced');

  // ---- English follows the English names
  await page.click('form[action="/limba"] button:has-text("EN")');
  await page.waitForLoadState();
  await page.goto(base + '/calitate/nou');
  assert.match(await page.locator('main').innerText(), /defect cause/i);
  step('English names show in English');

  // ---- calculated fields: the formula editor with a live preview, and a live result in the form
  await page.click('form[action="/limba"] button:has-text("RO")'); await page.waitForLoadState();
  await page.goto(base + '/admin/campuri');
  const f2 = page.locator('form[action="/admin/campuri/nou"]');
  await f2.locator('select[name=kind]').selectOption('task');
  await f2.locator('select[name=type]').selectOption('number');
  await f2.locator('input[name=label]').fill('Preț oră'); await f2.locator('input[name=unit]').fill('RON');
  await Promise.all([page.waitForNavigation(), f2.locator('button[type=submit]').click()]);
  await f2.locator('select[name=kind]').selectOption('task');
  await f2.locator('select[name=type]').selectOption('calc');
  assert.ok(await f2.locator('[data-formula-builder]').isVisible(), 'the formula editor shows for a calculated field');
  assert.ok(!(await f2.locator('select[name=list_id]').isVisible()), 'the list picker is hidden');
  await f2.locator('input[name=label]').fill('Cost oprire'); await f2.locator('input[name=label_en]').fill('Downtime cost');
  await f2.locator('input[name=unit]').fill('RON');
  // chips insert the field names; the preview works with sample values
  await f2.locator('[data-chips="fields"] .chip:has-text("Timp oprire")').click();
  await page.keyboard.type(' / 60 * ');
  await f2.locator('[data-chips="fields"] .chip:has-text("Preț oră")').click();
  assert.match(await f2.locator('textarea[name=formula]').inputValue(), /^\[Timp oprire\] \/ 60 \* \[Preț oră\]$/);
  await f2.locator('.samples input').nth(0).fill('90'); await f2.locator('.samples input').nth(1).fill('40');
  assert.match(await f2.locator('.calc-result').innerText(), /60,00 RON/);
  await shot('custom-7-formula-editor');
  await f2.locator('.samples input').nth(1).fill('');
  assert.match(await f2.locator('.calc-result').innerText(), /gol/i);
  await f2.locator('textarea[name=formula]').fill('[Timp oprire] /');
  assert.ok(await f2.locator('.calc-result.bad').count(), 'a broken formula says so while typing');
  await f2.locator('[data-chips="examples"] .chip').first().click();
  assert.match(await f2.locator('textarea[name=formula]').inputValue(), /round\(/);
  await f2.locator('textarea[name=formula]').fill('round([Timp oprire] / 60 * [Preț oră]; 2)');
  await Promise.all([page.waitForNavigation(), f2.locator('button[type=submit]').click()]);
  assert.equal(db.value("SELECT count(*) FROM custom_fields WHERE formula IS NOT NULL"), 1);
  step('formula editor: chips, live preview, errors while typing, saved');

  await page.goto(base + '/mentenanta/nou');
  await page.fill('input[name=title]', 'Cost la oprire');
  const nums = page.locator('input[inputmode=decimal]');
  await nums.nth(0).fill('90'); await nums.nth(1).fill('40');
  assert.match(await page.locator('[data-calc-out]').innerText(), /60,00 RON/);
  await nums.nth(0).fill('150');
  assert.match(await page.locator('[data-calc-out]').innerText(), /100,00 RON/);
  await shot('custom-8-live-result');
  await page.click('main form button.primary[type=submit]'); await page.waitForURL(/\/sarcini\/\d+$/);
  assert.match(await page.locator('main').innerText(), /100,00 RON/);
  step('the form shows the result live; the saved task holds it');

  await browser.close(); await app.cleanup();
  console.log('custom fields walk-through: all good');
}
main().catch((e) => { console.error(e); process.exit(1); });
