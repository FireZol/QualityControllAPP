'use strict';
// Contrast audit (development tool): opens the main screens in the light and the dark theme and lists text whose colour against its real
// background is below the threshold (default 3.5; WCAG AA for normal text is 4.5). Groups by element and colours.
//   node tools/contrast-audit.js [threshold]       needs Playwright (npm root -g)
const path = require('node:path');
const { execSync } = require('node:child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { startApp, adminClient, makeUser } = require('../app/test/helpers');
const tasks = require('../app/domain/tasks');
const meetings = require('../app/domain/meetings');

const MIN = Number(process.argv[2]) || 3.5;

async function main() {
  const app = await startApp();
  const admin = await adminClient(app);
  const engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Ana Inginer');
  const engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Bogdan Inginer');
  const ctc = await makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const db = app.db;
  const adminId = db.get("SELECT id FROM users WHERE username = 'admin'").id;
  const doc = db.get("SELECT id FROM spec_documents WHERE doc_type = 'CABLARE_RIGIDA_AL'").id;
  const rv = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', doc).id;
  await engA.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/trimite`, {});
  await engB.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/verifica`, {});
  const fam = db.get("SELECT id FROM product_families WHERE code = 'FUNIE_RIGIDA'").id;
  const machine = db.get("SELECT m.id FROM machines m JOIN machine_type_families f ON f.machine_type_id = m.machine_type_id WHERE f.family_id = ? AND m.active = 1", fam).id;
  const cons = db.get("SELECT id FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", rv);
  const st = db.get('SELECT id FROM sample_types ORDER BY id').id;
  for (const mass of ['608,5', '620,5', '560,0']) await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(fam), machine_id: String(machine), construction_id: String(cons.id), level: 'funie', sample_type_id: String(st), h: '17,75', l: '22,55', mass_g: mass, sample_mm: '1000' });
  const record = db.get('SELECT record_no FROM measurements ORDER BY id').record_no;
  const row = db.get('SELECT id FROM constructions WHERE revision_id = ? AND active = 1 ORDER BY sort, id', rv).id;
  const u = { id: adminId, full_name: 'Administrator' };
  const pid = db.run("INSERT INTO people(name, team, user_id) VALUES ('Administrator', 'maintenance', ?)", adminId).lastInsertRowid || db.get('SELECT id FROM people WHERE user_id = ?', adminId).id;
  const t1 = tasks.create(db, u, { team: 'maintenance', title: 'Zgomot la rotor 2', due_date: '2020-01-01', assignees: [pid] }).id;
  tasks.addChecklist(db, u, t1, ['Oprire utilaj', 'Verificare lagăre']); tasks.setChecked(db, u, t1, db.get('SELECT id FROM task_checklist ORDER BY id').id, true);
  tasks.create(db, u, { team: 'technical', title: 'Modificare rețetă' });
  meetings.ensure(db);
  const mid = meetings.createMeeting(db, u, { title: 'Neconformități — comună', meeting_date: meetings.today(), start_time: '10:00', duration_min: 45, teams: ['maintenance', 'technical'], attendees: [pid] }).id;
  meetings.addDecision(db, u, mid, { text: 'Înlocuit rulment', team: 'maintenance' });
  const screens = [['home', '/'], ['new measurement', `/masuratori/nou?family=${fam}&machine=${machine}&construction=${cons.id}&level=funie`], ['register', '/masuratori'], ['record (out of limit)', `/masuratori/${record}`],
    ['sheets', '/fise'], ['revision', `/fise/${doc}/revizii/${rv}`], ['paper check', `/fise/${doc}/revizii/${rv}/verificare/${row}`], ['row editor', `/fise/${doc}/revizii/${rv}/constructii/${row}`],
    ['database', '/liste'], ['users', '/admin/utilizatori'], ['settings', '/admin/setari'], ['audit', '/admin/jurnal'], ['analyses', '/analize'], ['batches', '/loturi'], ['notifications', '/notificari'],
    ['tasks', '/mentenanta'], ['task', `/sarcini/${t1}`], ['task new', '/mentenanta/nou'], ['meetings', '/sedinte'], ['meeting', `/sedinte/${mid}`], ['series', '/sedinte/serii'], ['password', '/parola']];
  const browser = await pw.chromium.launch();
  let total = 0;
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('ctc_theme', t); } catch (e) { /* none */ } }, theme);
    const page = await ctx.newPage();
    await page.goto(app.base + '/login');
    await page.fill('input[name=username]', 'admin'); await page.fill('input[name=password]', admin.password);
    await page.click('main button[type=submit]');
    const groups = new Map();
    for (const [name, url] of screens) {
      const resp = await page.goto(app.base + url);
      if (resp.status() >= 400) { console.log(`  (${name}: status ${resp.status()})`); continue; }
      await page.evaluate(() => document.querySelectorAll('details.help').forEach((d) => d.setAttribute('open', '')));
      const found = await page.evaluate((MIN) => {
        const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
        const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base); return base; };
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          if (!el.childNodes || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
          if (cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0 || parseFloat(cs.opacity) === 0) continue;
          if (el.closest('[hidden], script, style, option')) continue;
          const fg = parse(cs.color); if (!fg) continue;
          const bg = bgOf(el); const f = over(fg, bg);
          const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          if (ratio < MIN) out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), text: el.textContent.trim().slice(0, 24), fg: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, ratio: Math.round(ratio * 10) / 10 });
        }
        return out;
      }, MIN);
      for (const f of found) { const k = `${f.tag}.${f.cls}|${f.fg}|${f.bg}`; if (!groups.has(k)) groups.set(k, { ...f, n: 0, screens: new Set() }); const g = groups.get(k); g.n++; g.screens.add(name); }
    }
    console.log(`\n=== ${theme}: ${groups.size} low-contrast groups (< ${MIN}) ===`);
    for (const g of [...groups.values()].sort((a, b) => a.ratio - b.ratio)) console.log(`${String(g.ratio).padStart(4)}  <${g.tag}${g.cls ? ' .' + g.cls : ''}> "${g.text}" fg ${g.fg} on ${g.bg}  ×${g.n}  [${[...g.screens].slice(0, 3).join(', ')}]`);
    total += groups.size;
    await ctx.close();
  }
  await browser.close();
  await app.cleanup();
  console.log(total ? `\n${total} groups to look at` : '\nno low-contrast text found');
}
main().catch((e) => { console.error(e); process.exit(1); });
