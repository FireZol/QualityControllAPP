'use strict';
// Browser walk-through of stage 1 ("Done means" in docs/ETAPA-1.md). Development tool, not part of the app:
// it needs Playwright, which is available in the dev environment (npm root -g).
//   node tools/walkthrough.js [screenshot-dir]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const assert = require('node:assert/strict');

const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { createApp } = require('../app/app');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-shots-'));
fs.mkdirSync(shots, { recursive: true });

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-walk-'));
  const config = { root, port: 0, bind: '127.0.0.1', publicName: '', dataDir: path.join(root, 'data'), backupDir: path.join(root, 'backups'), seedDir: path.resolve(__dirname, '..', 'seed'), envPort: null, envBind: null };
  const logs = [];
  const app = await createApp(config, { listen: { port: 0, host: '127.0.0.1' }, log: (m) => logs.push(m), noScheduler: true });
  await app.start();
  const base = `http://127.0.0.1:${app.address.port}`;
  const adminPw = /parolă unică: (\S+)/.exec(logs.join('\n'))[1];
  const browser = await pw.chromium.launch();
  const step = (m) => console.log('•', m);

  async function newSession() {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ro-RO' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { throw e; });
    page.on('console', (m) => { if (m.type() === 'error') console.log('  console error:', m.text()); });
    return { ctx, page };
  }
  async function login(page, user, pass, newPass) {
    await page.goto(base + '/login');
    await page.fill('input[name=username]', user);
    await page.fill('input[name=password]', pass);
    await page.click('main button[type=submit]');
    if (newPass) {
      await page.waitForURL('**/parola');
      await page.fill('input[name=current]', pass);
      await page.fill('input[name=new]', newPass);
      await page.fill('input[name=confirm]', newPass);
      await page.click('main button[type=submit]');
    }
    await page.waitForURL(base + '/');
  }

  // ---- admin creates users
  const A = await newSession();
  await login(A.page, 'admin', adminPw, 'Admin-parola-1');
  await A.page.screenshot({ path: path.join(shots, '01-home-admin.png'), fullPage: true });
  step('admin logged in, password changed');
  const created = {};
  for (const [username, name, role] of [['ing.a', 'Ana Inginer', 'inginer'], ['ing.b', 'Bogdan Inginer', 'inginer'], ['ctc1', 'Cătălin CTC', 'personal']]) {
    await A.page.goto(base + '/admin/utilizatori/nou');
    await A.page.fill('input[name=username]', username);
    await A.page.fill('input[name=full_name]', name);
    await A.page.selectOption('select[name=role]', role);
    await A.page.click('button[type=submit]:has-text("Salvează")');
    created[username] = (await A.page.textContent('.secret code')).trim();
  }
  await A.page.screenshot({ path: path.join(shots, '02-user-created.png') });
  step('created Inginer A, Inginer B, CTC user');

  // ---- engineer A edits the seeded Al draft and submits
  const eA = await newSession();
  await login(eA.page, 'ing.a', created['ing.a'], 'Parola-ing-a-1');
  await eA.page.goto(base + '/fise');
  await eA.page.screenshot({ path: path.join(shots, '03-fise.png'), fullPage: true });
  await eA.page.click('a:has-text("Instrucțiune cablare rigidă — Aluminiu")');
  await eA.page.click('a:has-text("0")'); // revision link
  await eA.page.screenshot({ path: path.join(shots, '04-draft-al.png'), fullPage: true });
  assert.ok(!(await eA.page.textContent('body')).includes('Blochează'), 'the seeded Al draft must pass the IEC checks (RM = compacted, min 6 wires)');
  // edit one construction: tighten the mass limit of 240 SM 90°
  const row = eA.page.locator('tr', { hasText: '240 SM 90°' }).first();
  await row.locator('a:has-text("Editează")').click();
  await eA.page.screenshot({ path: path.join(shots, '05-construction-editor.png'), fullPage: true });
  await eA.page.click('button:has-text("Salvează")');
  await eA.page.waitForSelector('.flash-ok');
  await eA.page.click('button:has-text("Trimite la verificare")');
  await eA.page.waitForSelector('.flash-ok');
  assert.ok((await eA.page.textContent('body')).includes('în verificare'));
  assert.equal(await eA.page.locator('button:has-text("Verifică și activează")').count(), 0, 'author must not see verify');
  step('A edited the draft and submitted it');

  // ---- engineer B verifies and activates
  const eB = await newSession();
  await login(eB.page, 'ing.b', created['ing.b'], 'Parola-ing-b-1');
  await eB.page.goto(base + '/fise');
  await eB.page.click('a:has-text("Instrucțiune cablare rigidă — Aluminiu")');
  await eB.page.click('a:has-text("0")');
  eB.page.once('dialog', (d) => d.accept());
  await eB.page.click('button:has-text("Verifică și activează")');
  await eB.page.waitForSelector('.flash-ok');
  assert.ok((await eB.page.textContent('body')).includes('activă'));
  await eB.page.screenshot({ path: path.join(shots, '06-activated.png'), fullPage: true });
  step('B verified and activated');

  // ---- CTC records measurements, keyboard only
  const C = await newSession();
  await login(C.page, 'ctc1', created['ctc1'], 'Parola-ctc1-1');
  await C.page.screenshot({ path: path.join(shots, '07-home-ctc.png'), fullPage: true });
  assert.equal(await C.page.locator('a[href^="/admin"], a[href="/liste"]').count(), 0, 'no admin links for Personal');
  await C.page.click('a.btn:has-text("Măsurătoare nouă")');
  await C.page.selectOption('select[name=family]', { label: 'Funie rigidă clasa 2' });
  await C.page.waitForSelector('select[name=machine]');
  await C.page.selectOption('select[name=machine]', { label: 'RIGID 1' });
  await C.page.waitForSelector('select[name=construction]');
  await C.page.selectOption('select[name=construction]', { label: '240 SM 90°' });
  await C.page.waitForSelector('#entry');
  await C.page.screenshot({ path: path.join(shots, '08-entry-empty.png'), fullPage: true });

  async function record({ h, l, mass, expectMass, expectR }) {
    await C.page.fill('input[name=h]', h);
    await C.page.press('input[name=h]', 'Enter');
    await C.page.keyboard.type(l);
    await C.page.keyboard.press('Enter');
    await C.page.keyboard.type(mass);
    const live = await C.page.textContent('#live-out');
    assert.ok(live.includes(expectMass), `live preview should say ${expectMass}: ${live}`);
    assert.ok(live.includes(expectR), `live preview should show theoretical R: ${live}`);
  }
  // case 2 + 5 + 7
  await record({ h: '17,75', l: '22,55', mass: '608,5', expectMass: 'În limite', expectR: '0,1222' });
  await C.page.screenshot({ path: path.join(shots, '09-entry-live-ok.png'), fullPage: true });
  await C.page.click('button:has-text("Salvează măsurătoarea")');
  await C.page.waitForSelector('.flash-ok');
  const no1 = /\/masuratori\/(\d+)/.exec(C.page.url())[1];
  step(`case 2/5/7 saved as record ${no1}`);
  // case 3
  await C.page.click('a:has-text("Măsurătoare nouă, același produs")');
  await C.page.waitForSelector('#entry');
  await record({ h: '17.75', l: '22.55', mass: '620.5', expectMass: 'Peste maxim', expectR: '0,12' });
  await C.page.screenshot({ path: path.join(shots, '10-entry-live-bad.png'), fullPage: true });
  await C.page.click('button:has-text("Salvează măsurătoarea")');
  await C.page.waitForSelector('.flash-ok');
  const no2 = /\/masuratori\/(\d+)/.exec(C.page.url())[1];
  // case 4
  await C.page.click('a:has-text("Măsurătoare nouă, același produs")');
  await C.page.waitForSelector('#entry');
  await record({ h: '17.75', l: '22.55', mass: '606.9', expectMass: 'Sub minim', expectR: '0,12' });
  await C.page.click('button:has-text("Salvează măsurătoarea")');
  await C.page.waitForSelector('.flash-ok');
  step('cases 3 and 4 saved');

  await C.page.goto(base + '/masuratori');
  await C.page.screenshot({ path: path.join(shots, '11-register.png'), fullPage: true });
  assert.ok(await C.page.locator('.v-peste').count() >= 1 && await C.page.locator('.v-sub').count() >= 1 && await C.page.locator('.v-ok').count() >= 1);

  // ---- correction -> version 2, history shows both
  await C.page.goto(`${base}/masuratori/${no2}`);
  await C.page.click('a:has-text("Corectează")');
  await C.page.fill('input[name=mass_g]', '608,5');
  await C.page.fill('textarea[name=edit_reason]', 'Masă introdusă greșit la prima citire');
  await C.page.screenshot({ path: path.join(shots, '12-correction.png'), fullPage: true });
  await C.page.click('button:has-text("Salvează corecția")');
  await C.page.waitForSelector('.flash-ok');
  await C.page.screenshot({ path: path.join(shots, '13-history.png'), fullPage: true });
  const hist = await C.page.textContent('body');
  assert.ok(hist.includes('Versiunea 1') && hist.includes('Versiunea 2') && hist.includes('Masă introdusă greșit'));
  await C.page.goto(base + '/masuratori');
  assert.ok((await C.page.textContent('body')).includes('2 versiuni'));
  step('correction created version 2, history shows both');

  // ---- admin backup
  await A.page.goto(base + '/admin/setari');
  await A.page.click('button:has-text("Backup acum")');
  await A.page.waitForSelector('.flash-ok');
  await A.page.screenshot({ path: path.join(shots, '14-settings-backup.png'), fullPage: true });
  assert.match(await A.page.textContent('table.grid:last-of-type'), /ctc-\d{8}-\d{6}\.db/);
  assert.ok(fs.readdirSync(config.backupDir).some((f) => /^ctc-\d{8}-\d{6}\.db$/.test(f)));
  step('backup created and listed');

  await A.page.goto(base + '/admin/jurnal');
  await A.page.screenshot({ path: path.join(shots, '15-audit.png'), fullPage: true });
  await browser.close();
  await app.stop();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('\nWalk-through OK. Screenshots:', shots);
}

main().catch((e) => { console.error('WALK-THROUGH FAILED:', e); process.exit(1); });
