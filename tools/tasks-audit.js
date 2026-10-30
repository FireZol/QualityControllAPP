'use strict';
// Look-and-touch check of the task screens (development tool): seeds a few tasks, screenshots the screens at laptop, tablet and
// phone width and lists controls under 44 px.   node tools/tasks-audit.js [screenshot-dir]   needs Playwright (npm root -g)
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { startApp, adminClient } = require('../app/test/helpers');
const tasks = require('../app/domain/tasks');

const SIZES = { laptop: { width: 1360, height: 860 }, tablet: { width: 1024, height: 768 }, phone: { width: 390, height: 844 } };
const shots = process.argv[2];

async function main() {
  const app = await startApp();
  const admin = await adminClient(app);
  const db = app.db;
  const adminId = db.get("SELECT id FROM users WHERE username = 'admin'").id;
  const mk = (team, title, o = {}) => {
    const r = tasks.create(db, { id: adminId }, { team, title, description: o.description || '', priority_id: o.priority_id || '', due_date: o.due_date || '', assignees: o.assignees || [] });
    if (o.status) tasks.changeStatus(db, { id: adminId }, r.id, o.status, 'test');
    return r.id;
  };
  const people = db.all('SELECT id FROM people ORDER BY id');
  const prio = db.all('SELECT id FROM priorities ORDER BY sort, id');
  const first = mk('maintenance', 'Zgomot la rotor 2 pe linia de cablare', { priority_id: prio[prio.length - 1].id, due_date: '2020-01-01', description: 'Se aude de dimineață.' });
  mk('maintenance', 'Schimb ulei reductor extruder', { priority_id: prio[1].id, status: 'in_progress' });
  mk('maintenance', 'Verificare senzor temperatură', { priority_id: prio[0].id, status: 'waiting' });
  mk('technical', 'Modificare rețetă pentru 240 SM', {});
  mk('quality', 'Verificat lot după neconformitate', { priority_id: prio[2].id });
  const done = mk('maintenance', 'Înlocuit rulment', { status: 'done' });
  void people; void done;
  tasks.addChecklist(db, { id: adminId }, first, ['Oprire utilaj', 'Verificare lagăre', 'Pornire și probă']);
  tasks.setChecked(db, { id: adminId }, first, db.get('SELECT id FROM task_checklist WHERE task_id = ? ORDER BY id', first).id, true);
  const screens = [['board', '/mentenanta'], ['board closed', '/mentenanta?view=closed'], ['board grouped', '/mentenanta?group=status&sort=due'], ['work order', `/sarcini/${first}/tipar`], ['task', `/sarcini/${first}`], ['new', '/mentenanta/nou'], ['edit', `/sarcini/${first}/editeaza`], ['technical', '/tehnic'], ['quality', '/calitate/sarcini'], ['print', '/sarcini/tipar?team=maintenance&group=person'], ['bell', '/notificari']];
  const browser = await pw.chromium.launch();
  let total = 0;
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    const context = await browser.newContext({ viewport, hasTouch: sizeName !== 'laptop', isMobile: sizeName === 'phone' });
    const page = await context.newPage();
    page.on('pageerror', (e) => { throw e; });
    await page.goto(app.base + '/login');
    await page.fill('input[name=username]', 'admin'); await page.fill('input[name=password]', admin.password);
    await page.click('main button[type=submit]');
    for (const [name, url] of screens) {
      await page.goto(app.base + url);
      const r = await page.evaluate(() => {
        const out = [];
        const visible = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !el.closest('details:not([open]) > :not(summary)'); };
        for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]')) {
          if (!visible(el)) continue;
          if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, dd, td, th, h1, h2, h3, label, .muted')) continue;
          let b = el.getBoundingClientRect();
          if (el.type === 'checkbox' || el.type === 'radio') { const lab = el.closest('label'); if (lab) b = lab.getBoundingClientRect(); }
          if (b.width < 44 || b.height < 44) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} "${(el.innerText || el.value || el.name || '').trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
        }
        return { small: out, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
      total += r.small.length;
      console.log(`${r.small.length || r.overflow ? 'CHECK' : 'ok   '} ${sizeName.padEnd(6)} ${name.padEnd(13)} small=${r.small.length}${r.overflow ? ' HORIZONTAL SCROLL' : ''}`);
      for (const s of [...new Set(r.small)].slice(0, 6)) console.log('        ', s);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${sizeName}-${name.replace(/ /g, '-')}.png`), fullPage: true }); }
    }
    await context.close();
  }
  await browser.close();
  await app.cleanup();
  console.log(total ? `${total} small controls` : 'all controls are at least 44 px');
}
main().catch((e) => { console.error(e); process.exit(1); });
