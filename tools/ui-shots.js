'use strict';
// Screenshots of the shell and home in light and dark at laptop / tablet / phone width (development tool).
//   node tools/ui-shots.js <dir> [url-path ...]     needs Playwright (npm root -g)
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { startApp, adminClient, makeUser } = require('../app/test/helpers');
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
  // sample measurements and a sheet, so the older screens have something to show (paths may use %record% %doc% %rv% %new%)
  const engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Ana Inginer'); const engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Bogdan Inginer'); const ctc = await makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const doc = db.get("SELECT id FROM spec_documents WHERE doc_type = 'CABLARE_RIGIDA_AL'").id; const rv = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', doc).id;
  await engA.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/trimite`, {}); await engB.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/verifica`, {});
  const fam = db.get("SELECT id FROM product_families WHERE code = 'FUNIE_RIGIDA'").id;
  const mach = db.get('SELECT m.id FROM machines m JOIN machine_type_families f ON f.machine_type_id = m.machine_type_id WHERE f.family_id = ? AND m.active = 1', fam).id;
  const cons = db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", rv).id;
  for (const mass of ['608,5', '620,5', '560,0', '606,9']) await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(fam), machine_id: String(mach), construction_id: String(cons), level: 'funie', sample_type_id: String(db.get('SELECT id FROM sample_types ORDER BY id').id), h: '17,75', l: '22,55', mass_g: mass, sample_mm: '1000' });
  const sub = { '%record%': db.get('SELECT record_no FROM measurements ORDER BY id').record_no, '%doc%': doc, '%rv%': rv, '%new%': `family=${fam}&machine=${mach}&construction=${cons}&level=funie` };
  const fill = (p) => p.replace(/%\w+%/g, (m) => sub[m]);
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
        await page.goto(app.base + fill(p));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        console.log(`${theme} ${size} ${p}${overflow ? '  HORIZONTAL SCROLL' : ''}`);
        await page.screenshot({ path: path.join(dir, `${theme}-${size}-${fill(p).replace(/\W+/g, '_') || 'home'}.png`), fullPage: size !== 'laptop' ? true : false });
      }
      await ctx.close();
    }
  }
  await browser.close();
  await app.cleanup();
}
main().catch((e) => { console.error(e); process.exit(1); });
