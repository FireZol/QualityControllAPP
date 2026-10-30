'use strict';
// Real-browser walk-through of the modules and the shell (development tool): tasks, bulk bar, checklist, meetings with a decision that
// becomes a task, a non-conformity from report to closing, a preventive plan that makes its task, the theme menu and the phone drawer.
//   node tools/modules-walkthrough.js [screenshot-dir]        needs Playwright (npm root -g)
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { startApp, adminClient } = require('../app/test/helpers');
const tasks = require('../app/domain/tasks');

const shots = process.argv[2];
const step = (m) => console.log('•', m);

async function main() {
  const app = await startApp();
  const admin = await adminClient(app);
  const db = app.db;
  const base = app.base;
  const today = tasks.today();
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  const shot = async (n) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${n}.png`), fullPage: true }); } };
  const submit = (sel) => page.click(sel || 'main form button[type=submit]');
  await page.goto(base + '/login');
  await page.fill('input[name=username]', 'admin'); await page.fill('input[name=password]', admin.password);
  await page.click('main button[type=submit]'); await page.waitForURL(base + '/');
  step('admin logged in');

  // ---- theme: PC default follows the system, Light and Dark are remembered
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme') + '/' + document.documentElement.getAttribute('data-theme-pref'));
  assert.equal(await theme(), 'dark/system');
  await page.click('.theme-menu summary'); await page.click('[data-theme-set=light]');
  assert.equal(await theme(), 'light/light'); await page.reload(); assert.equal(await theme(), 'light/light');
  await page.click('.theme-menu summary'); await page.click('[data-theme-set=system]'); assert.equal(await theme(), 'dark/system');
  step('theme menu: Light, Dark, PC default');

  // ---- tasks: create, checklist, status, bulk
  await page.goto(base + '/mentenanta/nou');
  await page.fill('input[name=title]', 'Zgomot la rotor 2'); await submit();
  await page.waitForURL(/\/sarcini\/\d+$/);
  const t1 = Number(page.url().split('/').pop());
  await page.fill('form[action$="/pas"] textarea[name=steps]', 'Oprire utilaj\nVerificare lagăre'); await page.click('form[action$="/pas"] button[type=submit]');
  await page.click('form[action*="/bifeaza"] button');
  assert.equal(db.value('SELECT count(*) FROM task_checklist WHERE task_id = ? AND done = 1', t1), 1);
  await page.click('button[name=to][value=in_progress]');
  assert.equal(db.get('SELECT status FROM tasks WHERE id = ?', t1).status, 'in_progress');
  await page.goto(base + '/mentenanta/nou'); await page.fill('input[name=title]', 'Schimb filtru'); await submit(); await page.waitForURL(/\/sarcini\/\d+$/);
  step('tasks: created, checklist ticked, started');
  await page.goto(base + '/mentenanta');
  assert.equal(await page.$eval('#bulk', (e) => e.hidden), true);
  await page.click('#sel-all');
  assert.equal(await page.$eval('#bulk', (e) => e.hidden), false);
  assert.equal(await page.textContent('#bulk-count'), '2');
  await page.selectOption('select[name=v_status]', 'waiting'); await page.click('button[name=action][value=status]'); await page.waitForLoadState();
  assert.equal(db.value("SELECT count(*) FROM tasks WHERE status = 'waiting'"), 2);
  step('bulk bar: two tasks put on hold at once');
  await shot('01-board');

  // ---- meeting with a decision that becomes a task
  await page.goto(base + '/sedinte/nou');
  await page.fill('input[name=title]', 'Ședință comună'); await page.fill('input[name=meeting_date]', today); await page.fill('input[name=start_time]', '10:00');
  await page.check('input[name=teams][value=maintenance]'); await submit(); await page.waitForURL(/\/sedinte\/\d+$/);
  const mid = Number(page.url().split('/').pop());
  await page.fill('form[action$="/decizie"] textarea[name=text]', 'Înlocuit rulment la LITARE 2'); await page.selectOption('form[action$="/decizie"] select[name=team]', 'maintenance');
  await page.click('form[action$="/decizie"] button[type=submit]'); await page.waitForLoadState();
  const dt = db.get("SELECT * FROM tasks WHERE source_kind = 'meeting' AND source_id = ?", mid);
  assert.ok(dt && dt.title === 'Înlocuit rulment la LITARE 2');
  await page.click('button[name=to][value=held]'); await page.waitForLoadState();
  assert.equal(db.get('SELECT status FROM meetings WHERE id = ?', mid).status, 'held');
  step('meeting: decision became task ' + dt.no + ', meeting marked held');
  await shot('02-meeting');

  // ---- non-conformity: report, try to close without a decision, evaluate, task, close
  await page.goto(base + '/calitate/nou');
  await page.fill('input[name=title]', 'Masă sub limită la LITARE 2'); await submit(); await page.waitForURL(/\/calitate\/neconformitati\/\d+$/);
  const nid = Number(page.url().split('/').pop());
  await page.click('button[name=to][value=closed]'); await page.waitForLoadState();
  assert.equal(db.get('SELECT status FROM ncrs WHERE id = ?', nid).status, 'reported');
  assert.ok(await page.isVisible('.flash-err'), 'the refusal is shown');
  await page.selectOption('form[action$="/editeaza"] select[name=disposition_id]', { index: 1 });
  await page.fill('form[action$="/editeaza"] textarea[name=cause]', 'Uzură filieră'); await page.click('form[action$="/editeaza"] button[type=submit]'); await page.waitForLoadState();
  await page.fill('form[action$="/sarcina"] input[name=title]', 'Schimbat filiera'); await page.click('form[action$="/sarcina"] button[type=submit]'); await page.waitForLoadState();
  assert.equal(db.get('SELECT status FROM ncrs WHERE id = ?', nid).status, 'action');
  await page.click('button[name=to][value=closed]'); await page.waitForLoadState();
  assert.equal(db.get('SELECT status FROM ncrs WHERE id = ?', nid).status, 'closed');
  step('non-conformity: refused without a decision, then evaluated, tasked and closed');
  await shot('03-ncr');
  await page.goto(base + '/calitate/top'); assert.ok((await page.textContent('main')).includes('1'));
  await shot('04-top');

  // ---- preventive plan makes its task
  await page.goto(base + '/mentenanta/preventiv/nou');
  await page.fill('input[name=title]', 'Lubrifiere lagăre'); await page.fill('input[name=next_due]', tasks.addDays(today, 1)); await page.fill('textarea[name=steps]', 'Oprire\nLubrifiere'); await submit();
  await page.waitForURL(/\/preventiv\/\d+$/);
  const pid = Number(page.url().split('/').pop());
  assert.ok(db.get("SELECT 1 FROM tasks WHERE source_kind = 'preventive' AND source_id = ?", pid), 'the plan made its task');
  await shot('05-plan');
  step('preventive plan made its task by itself');

  // ---- home
  await page.goto(base + '/');
  assert.ok(await page.isVisible('.queue'), 'the attention list shows');
  assert.ok(await page.isVisible('.chip-pill'));
  await shot('06-home');

  // ---- phone: the drawer
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p2 = await phone.newPage();
  await p2.goto(base + '/login'); await p2.fill('input[name=username]', 'admin'); await p2.fill('input[name=password]', admin.password); await p2.click('main button[type=submit]'); await p2.waitForURL(base + '/');
  const left = () => p2.$eval('.side', (e) => Math.round(e.getBoundingClientRect().left));
  assert.ok((await left()) < 0, 'the drawer starts closed');
  await p2.click('[data-side-toggle]'); await p2.waitForTimeout(300);
  assert.equal(await left(), 0);
  await p2.click('.side a[href="/masuratori"]'); await p2.waitForURL(base + '/masuratori');
  assert.ok((await left()) < 0, 'and closes after a choice');
  step('phone: drawer opens, navigates, closes');
  await browser.close(); await app.cleanup();
  console.log('\nModules walk-through OK.' + (shots ? ` Screenshots: ${shots}` : ''));
}
main().catch((e) => { console.error(e); process.exit(1); });
