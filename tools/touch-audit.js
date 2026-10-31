'use strict';
// Touch audit (development tool): opens the main screens in an emulated touch tablet and phone and lists every control smaller
// than 44 x 44 CSS px (the usual minimum for a finger), so they can be fixed or consciously accepted.
//   node tools/touch-audit.js [screenshot-dir]        needs Playwright (npm root -g)
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { startApp, adminClient, makeUser } = require('../app/test/helpers');

const MIN = 44;
const SIZES = { tablet: { width: 1024, height: 768 }, phone: { width: 390, height: 844 } };
const shots = process.argv[2];

async function main() {
  const app = await startApp({ modulesOff: true });
  const admin = await adminClient(app);
  const engA = await makeUser(app, admin, 'ing.a', 'inginer', 'Ana Inginer');
  const engB = await makeUser(app, admin, 'ing.b', 'inginer', 'Bogdan Inginer');
  const ctc = await makeUser(app, admin, 'ctc1', 'personal', 'Operator CTC');
  const db = app.db;
  // one active sheet and a few measurements, so the screens have rows to tap
  const doc = db.get("SELECT id FROM spec_documents WHERE doc_type = 'CABLARE_RIGIDA_AL'").id;
  const rv = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', doc).id;
  await engA.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/trimite`, {});
  await engB.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/verifica`, {});
  const fam = db.get("SELECT id FROM product_families WHERE code = 'FUNIE_RIGIDA'").id;
  const machine = db.get("SELECT m.id FROM machines m JOIN machine_type_families f ON f.machine_type_id = m.machine_type_id WHERE f.family_id = ? AND m.active = 1", fam).id;
  const cons = db.get("SELECT id, section FROM constructions WHERE revision_id = ? AND label = '240 SM 90°'", rv);
  const st = db.get("SELECT id FROM sample_types ORDER BY id").id;
  for (const mass of ['608,5', '620,5', '606,9']) {
    await ctc.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(fam), machine_id: String(machine), construction_id: String(cons.id), level: 'funie', sample_type_id: String(st), h: '17,75', l: '22,55', mass_g: mass, sample_mm: '1000' });
  }
  const record = db.get('SELECT record_no FROM measurements ORDER BY id').record_no;
  const rows = db.all('SELECT id FROM constructions WHERE revision_id = ? AND active = 1 ORDER BY sort, id', rv).map((r) => r.id);

  const screens = [
    ['home', '/'], ['new measurement', `/masuratori/nou?family=${fam}&machine=${machine}&construction=${cons.id}&level=funie`], ['register', '/masuratori'], ['record', `/masuratori/${record}`],
    ['data sheets', '/fise'], ['revision', `/fise/${doc}/revizii/${rv}`], ['paper check', `/fise/${doc}/revizii/${rv}/verificare/${rows[0]}`], ['row editor', `/fise/${doc}/revizii/${rv}/constructii/${rows[0]}`],
    ['database', '/liste'], ['users', '/admin/utilizatori'], ['settings', '/admin/setari'], ['custom fields', '/admin/campuri'], ['custom lists', '/admin/campuri/liste'],
  ];
  const browser = await pw.chromium.launch();
  let total = 0;
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: sizeName === 'phone', deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(app.base + '/login');
    await page.fill('input[name=username]', 'admin'); await page.fill('input[name=password]', admin.password);
    await page.click('main button[type=submit]');
    for (const [name, url] of screens) {
      await page.goto(app.base + url);
      const small = await page.evaluate((MIN) => {
        const out = [];
        const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !el.closest('details:not([open]) > :not(summary)'); };
        for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]')) {
          if (!visible(el)) continue;
          // a text link inside running text is exempt (WCAG 2.5.8 "inline"); a checkbox is tapped through its label
          const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, dd, td, th, h1, h2, h3, label, .muted');
          if (inline) continue;
          let box = el.getBoundingClientRect();
          if (el.type === 'checkbox' || el.type === 'radio') { const lab = el.closest('label'); if (lab) box = lab.getBoundingClientRect(); }
          if (box.width < MIN || box.height < MIN) out.push({ tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 28), w: Math.round(box.width), h: Math.round(box.height), cls: el.className && String(el.className).slice(0, 30) });
        }
        return out;
      }, MIN);
      const uniq = new Map();
      for (const s of small) { const k = `${s.tag}|${s.cls}|${s.w}x${s.h}`; if (!uniq.has(k)) uniq.set(k, { ...s, n: 0 }); uniq.get(k).n++; }
      total += small.length;
      console.log(`${small.length ? 'SMALL' : 'ok   '} ${sizeName.padEnd(6)} ${name.padEnd(16)} ${small.length}`);
      for (const s of uniq.values()) console.log(`         ${s.n}× <${s.tag}${s.cls ? ' .' + s.cls : ''}> "${s.text}" ${s.w}×${s.h}`);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${sizeName}-${name.replace(/ /g, '-')}.png`), fullPage: true }); }
    }
    await context.close();
  }
  await browser.close();
  await app.cleanup();
  console.log(total ? `${total} small controls` : 'all controls are at least 44 px');
  process.exit(total ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
