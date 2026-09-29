'use strict';
// Dev check of the printed documents in headless Chromium (Playwright): every sheet is split into pages that
// carry "Pag. x / y", and the PDF has exactly as many pages. (Firefox is not installed in the dev environment.)
const path = require('node:path');
const { execSync } = require('node:child_process');
const assert = require('node:assert/strict');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { startApp, adminClient } = require('../app/test/helpers');

(async () => {
  const app = await startApp();
  const admin = await adminClient(app);
  const browser = await pw.chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await p.goto(app.base + '/login');
  await p.fill('input[name=username]', 'admin');
  await p.fill('input[name=password]', admin.password);
  await p.click('main button[type=submit]');
  for (const id of [1, 2, 3, 4, 5]) {
    const doc = app.db.get('SELECT document_id d FROM spec_revisions WHERE id = ?', id).d;
    await p.goto(`${app.base}/fise/${doc}/revizii/${id}/tipar?exemplar=1`);
    await p.waitForSelector('.pg-wrap');
    const nums = await p.evaluate(() => [...document.querySelectorAll('.pg .pg-num')].map((n) => n.textContent));
    await p.emulateMedia({ media: 'print' });
    const pdf = await p.pdf({ preferCSSPageSize: true });
    await p.emulateMedia({ media: 'screen' });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.equal(pages, nums.length, `sheet ${id}: PDF pages ${pages} vs numbered pages ${nums.length}`);
    assert.equal(nums[nums.length - 1], `Pag. ${nums.length} / ${nums.length}`);
    console.log(`sheet ${id}: ${nums.length} page(s) OK`);
  }
  await browser.close();
  await app.cleanup();
})().catch((e) => { console.error('PRINT CHECK FAILED:', e); process.exit(1); });
