'use strict';
// Screenshots of the shell and home in light and dark at laptop / tablet / phone width (development tool).
//   node tools/ui-shots.js <dir> [url-path ...]     needs Playwright (npm root -g)
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { startApp, adminClient } = require('../app/test/helpers');
const tasks = require('../app/domain/tasks');

const dir = process.argv[2] || '/tmp/ui-shots';
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ['/'];
const SIZES = { laptop: { width: 1360, height: 860 }, tablet: { width: 1024, height: 768 }, phone: { width: 390, height: 844 } };

async function main() {
  const app = await startApp();
  const admin = await adminClient(app);
  const db = app.db;
  const adminId = db.get("SELECT id FROM users WHERE username = 'admin'").id;
  db.run("INSERT INTO people(name, team, user_id) VALUES ('Administrator', 'maintenance', ?)", adminId);
  const pid = db.get('SELECT id FROM people WHERE user_id = ?', adminId).id;
  tasks.create(db, { id: adminId }, { team: 'maintenance', title: 'Zgomot la rotor 2', due_date: '2020-01-01', assignees: [pid] });
  tasks.create(db, { id: adminId }, { team: 'maintenance', title: 'Schimb ulei reductor', assignees: [pid] });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await pw.chromium.launch();
  for (const theme of ['light', 'dark']) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      const ctx = await browser.newContext({ viewport, hasTouch: size !== 'laptop', isMobile: size === 'phone' });
      await ctx.addInitScript((t) => { try { localStorage.setItem('ctc_theme', t); } catch (e) { /* none */ } }, theme);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => { throw e; });
      await page.goto(app.base + '/login');
      await page.fill('input[name=username]', 'admin'); await page.fill('input[name=password]', admin.password);
      await page.click('main button[type=submit]');
      for (const p of paths) {
        await page.goto(app.base + p);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        console.log(`${theme} ${size} ${p}${overflow ? '  HORIZONTAL SCROLL' : ''}`);
        await page.screenshot({ path: path.join(dir, `${theme}-${size}-${p.replace(/\W+/g, '_') || 'home'}.png`), fullPage: size !== 'laptop' ? true : false });
      }
      await ctx.close();
    }
  }
  await browser.close();
  await app.cleanup();
}
main().catch((e) => { console.error(e); process.exit(1); });
