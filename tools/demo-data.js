'use strict';
// Demo data (development tool): fills a THROWAWAY app with a few weeks of believable factory life, so the screens can be used and looked at
// the way the factory will use them: measurements (some out of limit), people and users, tasks in every state, held and planned meetings with
// decisions, non-conformities from reported to verified, preventive plans. Never run this against real data: it makes its own temporary
// installation, and `--save <file.db>` writes a copy of that database for a local trial (open it with a copy of the app and its config).
//   node tools/demo-data.js [--save demo.db] [--shots <dir>]        needs Playwright (npm root -g) only for --shots
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { startApp, adminClient, makeUser } = require('../app/test/helpers');
const tasks = require('../app/domain/tasks');
const meetings = require('../app/domain/meetings');
const ncr = require('../app/domain/ncr');
const pm = require('../app/domain/preventive');
const access = require('../app/domain/access');

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
// a small deterministic generator, so every run makes the same factory
let seed = 20261030;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const fmt = (n, d) => n.toFixed(d).replace('.', ',');

async function seedAll() {
  const app = await startApp();
  const admin = await adminClient(app);
  const db = app.db;
  const today = tasks.today();
  const day = (n) => tasks.addDays(today, n);

  // ---- people and accounts
  const mkUser = async (u, name, role, levels) => { const c = await makeUser(app, admin, u, role, name); const id = db.get('SELECT id FROM users WHERE username = ?', u).id; if (levels) access.setUserLevels(db, id, levels); return { c, id }; };
  const engA = await mkUser('ana.pop', 'Ana Pop', 'inginer', { maintenance: 'view', quality: 'lead', meetings: 'lead', technical: 'lead' });
  const engB = await mkUser('bogdan.ilie', 'Bogdan Ilie', 'inginer', { quality: 'lead', meetings: 'lead' });
  const ctc = [];
  for (const [u, n] of [['cata.ctc', 'Cătălin Dobre'], ['maria.ctc', 'Maria Ene'], ['radu.ctc', 'Radu Stan']]) ctc.push(await mkUser(u, n, 'personal', { quality: 'enter', maintenance: 'view', meetings: 'enter' }));
  const mLead = await mkUser('sef.mentenanta', 'Ștefan Marin', 'personal', { maintenance: 'lead', meetings: 'lead', quality: 'view' });
  const tech = await mkUser('tudor.tehnic', 'Tudor Vasile', 'personal', { technical: 'lead', meetings: 'enter', maintenance: 'view' });
  const peopleDef = [['Ștefan Marin', 'maintenance', mLead.id], ['Ion Lăcătuș', 'maintenance'], ['Vasile Electrician', 'maintenance'], ['Gheorghe Mecanic', 'maintenance'], ['Tudor Vasile', 'technical', tech.id], ['Elena Tehnolog', 'technical'], ['Mihai Proiectant', 'technical'],
    ['Ana Pop', 'quality', engA.id], ['Bogdan Ilie', 'quality', engB.id], ['Cătălin Dobre', 'quality', ctc[0].id], ['Maria Ene', 'quality', ctc[1].id], ['Radu Stan', 'quality', ctc[2].id]];
  const P = {};
  for (const [name, team, uid] of peopleDef) P[name] = db.run('INSERT INTO people(name, team, user_id) VALUES (?,?,?)', name, team, uid || null).id;
  const people = (team) => peopleDef.filter((p) => p[1] === team).map((p) => P[p[0]]);

  // ---- an active data sheet and measurements over three weeks
  const doc = db.get("SELECT id FROM spec_documents WHERE doc_type = 'CABLARE_RIGIDA_AL'").id; const rv = db.get('SELECT id FROM spec_revisions WHERE document_id = ?', doc).id;
  await engA.c.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/trimite`, {}); await engB.c.postForm(`/fise/${doc}/revizii/${rv}`, `/fise/${doc}/revizii/${rv}/verifica`, {});
  const fam = db.get("SELECT id FROM product_families WHERE code = 'FUNIE_RIGIDA'").id;
  const machines = db.all('SELECT m.id, m.name FROM machines m JOIN machine_type_families f ON f.machine_type_id = m.machine_type_id WHERE f.family_id = ? AND m.active = 1', fam);
  const cons = db.all("SELECT c.id, c.label FROM constructions c JOIN shapes s ON s.id = c.shape_id WHERE c.revision_id = ? AND c.active = 1 AND c.label = '240 SM 90°' ORDER BY c.sort, c.id LIMIT 1", rv);
  const sample = db.get('SELECT id FROM sample_types ORDER BY id').id;
  for (let i = 0; i < 90; i++) {
    const c = pick(cons); const out = rnd() < 0.18;
    const mass = (out ? between(0.9, 1.1) : between(0.985, 1.015)) * 608.5;
    const res = await pick(ctc).c.postForm('/masuratori/nou', '/masuratori/nou', { family_id: String(fam), machine_id: String(pick(machines).id), construction_id: String(c.id), level: 'funie', sample_type_id: String(sample), h: fmt(between(17.6, 17.9), 2), l: fmt(between(22.4, 22.7), 2), mass_g: fmt(mass, 1), sample_mm: '1000' });
    if (res.status >= 400 && i < 3) console.log('  measurement not saved:', res.status);
  }
  const recs = db.all('SELECT id FROM measurements ORDER BY id');
  recs.forEach((r, i) => { const d = day(-Math.floor((i / recs.length) * 21)); db.run("UPDATE measurements SET shift_date = ?, created_at = ? || substr(created_at, 11) WHERE id = ?", d, d, r.id); });

  // ---- tasks in every state, backdated, with checklists and comments
  const prios = db.all('SELECT id FROM priorities WHERE active = 1 ORDER BY sort').map((r) => r.id);
  const U = { id: mLead.id, full_name: 'Ștefan Marin' };
  const titles = {
    maintenance: ['Zgomot la rotorul 2 pe LITARE 2', 'Schimb ulei reductor extruder', 'Verificare senzor temperatură TREFILARE 1', 'Înlocuit rulment capstan', 'Curățare filtre aer hală 2', 'Strângere lanț transmisie RIGID 1', 'Calibrare cântar probe', 'Scurgere ulei la presa hidraulică', 'Înlocuit bandă transportoare', 'Verificare împământare tablou'],
    technical: ['Modificare rețetă pentru 240 SM 90°', 'Actualizare fișă tehnologică funie 95 RMC', 'Test material nou izolație PVC', 'Reglaj parametri extrudare', 'Documentație lot pilot', 'Verificare toleranțe matriță'],
    quality: ['Verificare lot după neconformitate', 'Reetalonare micrometru', 'Control vizual ambalare', 'Audit intern marcare', 'Verificare calibre 17,75 × 22,55'],
  };
  const statuses = ['open', 'open', 'in_progress', 'in_progress', 'waiting', 'done', 'closed', 'closed', 'cancelled'];
  const made = [];
  for (const team of ['maintenance', 'technical', 'quality']) {
    for (const t of titles[team]) {
      const r = tasks.create(db, U, { team, title: t, description: rnd() < 0.5 ? 'Observat în tura de noapte; de verificat înainte de pornire.' : '', priority_id: pick(prios), due_date: rnd() < 0.75 ? day(Math.round(between(-6, 14))) : '', machine_id: rnd() < 0.5 ? pick(machines).id : '', assignees: rnd() < 0.8 ? [pick(people(team))] : [] });
      const st = pick(statuses);
      if (st === 'in_progress' || st === 'waiting') tasks.changeStatus(db, U, r.id, st, null);
      if (st === 'done' || st === 'closed') { tasks.changeStatus(db, U, r.id, 'done', null); if (st === 'closed') tasks.changeStatus(db, U, r.id, 'closed', null); }
      if (st === 'cancelled') tasks.changeStatus(db, U, r.id, 'cancelled', 'Nu mai este necesar');
      if (rnd() < 0.5) { tasks.addChecklist(db, U, r.id, ['Oprire utilaj', 'Verificare vizuală', 'Intervenție', 'Probă de funcționare']); const items = tasks.checklistOf(db, r.id); for (const it of items.slice(0, Math.floor(rnd() * 4))) tasks.setChecked(db, U, r.id, it.id, true); }
      if (rnd() < 0.4) tasks.comment(db, U, r.id, 'Piesa a fost comandată, livrare mâine.');
      db.run("UPDATE tasks SET created_at = ? || substr(created_at, 11) WHERE id = ?", day(-Math.floor(between(0, 18))), r.id);
      made.push(r.id);
    }
  }

  // ---- meetings: the starting schedule makes the coming days; the past ones are held, with attendance, minutes and decisions
  meetings.ensure(db, today, 14);
  for (let back = 1; back <= 8; back++) {
    const d = day(-back); if ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) continue;
    const mid = meetings.createMeeting(db, { id: engA.id, full_name: 'Ana Pop' }, { title: 'Ședință zilnică Tehnic și Mentenanță', meeting_date: d, start_time: '08:30', duration_min: 30, location: 'Biroul tehnic', teams: ['maintenance', 'technical'], agenda: 'Starea utilajelor, planul zilei', attendees: [...people('maintenance'), ...people('technical')] }).id;
    const att = meetings.detail(db, mid).attendees.filter(() => rnd() < 0.85).map((a) => a.id);
    meetings.setAttendance(db, { id: engA.id }, mid, att, []);
    meetings.saveNotes(db, { id: engA.id }, mid, { minutes: 'Utilajele au funcționat normal. S-a discutat zgomotul de la LITARE 2 și piesele comandate.' });
    if (rnd() < 0.6) meetings.addDecision(db, { id: engA.id, full_name: 'Ana Pop' }, mid, { text: pick(['Înlocuit rulment la LITARE 2', 'Verificat nivelul de ulei zilnic', 'Comandat filieră de rezervă', 'Test nou parametri extrudare']), team: pick(['maintenance', 'technical']), due_date: day(Math.round(between(1, 9))), assignees: [pick(people('maintenance'))] });
    meetings.setStatus(db, { id: engA.id, full_name: 'Ana Pop' }, mid, 'held', null);
  }

  // ---- non-conformities over two months: types, machines, products, every status, some recurring, some late
  const types = db.all('SELECT id FROM ncr_types ORDER BY sort').map((r) => r.id); const disps = db.all('SELECT id FROM ncr_dispositions ORDER BY sort').map((r) => r.id);
  const reporter = pick(ctc);
  const ncrTitles = ['Masă sub limită la LITARE 2', 'Diametru peste toleranță', 'Zgârieturi pe izolație', 'Rezistență peste limită la lot', 'Marcaj șters', 'Colac cu spire desfăcute', 'Lungime sub comandă', 'Aspect neuniform al suprafeței', 'Rezistență izolație scăzută'];
  const Q = { id: engA.id, full_name: 'Ana Pop' };
  const NC = [];
  for (let i = 0; i < 24; i++) {
    const m = pick(machines); const c = pick(cons);
    const r = ncr.create(db, { id: reporter.id, full_name: 'Cătălin Dobre' }, { title: pick(ncrTitles), description: 'Constatat la controlul în tură. Colaci separați până la decizie.', type_id: pick(types.slice(0, 5)), machine_id: m.id, product: c.label, quantity: `${1 + Math.floor(rnd() * 6)} colaci`, severity_id: pick(prios), reported_at: day(-Math.floor(between(0, 60))) });
    NC.push(r.id);
    const st = pick(['reported', 'reported', 'evaluation', 'action', 'action', 'closed', 'closed', 'closed', 'cancelled']);
    if (st !== 'reported') {
      ncr.update(db, Q, r.id, { containment: 'Lot separat și marcat', cause: pick(['Uzură filieră', 'Parametri extrudare nepotriviți', 'Materie primă neconformă', 'Reglaj greșit la schimbul de noapte']), evaluation: 'Lot afectat parțial; probe suplimentare efectuate.', disposition_id: pick(disps), corrective_action: 'Reglaj și verificare la fiecare schimb', preventive_action: 'Instruire operatori', responsible_person_id: pick(people('quality').concat(people('technical'))), action_due: day(Math.round(between(-5, 12))) });
      ncr.setStatus(db, Q, r.id, 'evaluation', null);
      if (st === 'action' || st === 'closed') { ncr.addTask(db, Q, r.id, { team: pick(['maintenance', 'technical', 'quality']), title: pick(['Schimbat filiera', 'Reglaj parametri', 'Control suplimentar al lotului', 'Instruire operatori']), due_date: day(Math.round(between(1, 10))), assignees: [pick(people('maintenance'))] }); }
      if (st === 'closed') { if (rnd() < 0.6) ncr.verify(db, Q, r.id, 'Nicio abatere în ultimele loturi', false); ncr.setStatus(db, Q, r.id, 'closed', null); }
      if (st === 'cancelled') ncr.setStatus(db, Q, r.id, 'cancelled', 'Raportare dublă');
    }
    const rep = row(db, r.id); db.run("UPDATE ncrs SET created_at = ? || substr(created_at, 11) WHERE id = ?", rep.reported_at, r.id);
  }

  // ---- preventive plans: daily for tomorrow, weekly, monthly, a few overdue and a few with finished history
  const planDefs = [
    ['Verificare zilnică nivel ulei extruder', 'daily', 'maintenance', 'Nivel ulei, scurgeri, zgomot'], ['Curățare filtre zilnic', 'daily', 'maintenance', 'Scoatere filtre\nCurățare\nMontare'],
    ['Lubrifiere lagăre LITARE', 'weekly', 'maintenance', 'Oprire\nLubrifiere\nPornire\nProbă'], ['Verificare calibre', 'weekly', 'quality', 'Măsurare cu calibrul etalon'], ['Control strângere șuruburi', 'weekly', 'maintenance', ''],
    ['Revizie reductoare', 'monthly', 'maintenance', 'Schimb ulei\nVerificare lagăre'], ['Etalonare micrometre', 'monthly', 'quality', ''], ['Verificare parametri extrudare', 'weekly', 'technical', ''],
  ];
  const planIds = [];
  for (const [title, kind, team, steps] of planDefs) {
    const base = pm.preset(kind);
    const r = pm.create(db, U, { ...base, title, team, steps, machine_id: pick(machines).id, priority_id: pick(prios), people: [pick(people(team === 'maintenance' ? 'maintenance' : team))], next_due: kind === 'daily' ? base.next_due : day(Math.round(between(-4, 20))) });
    planIds.push(r.id);
  }
  pm.ensure(db);
  for (const id of planIds.slice(0, 4)) { const t = db.get("SELECT id FROM tasks WHERE source_kind = 'preventive' AND source_id = ? AND status IN ('open', 'in_progress', 'waiting')", id); if (t && rnd() < 0.6) { tasks.changeStatus(db, U, t.id, 'done', null); tasks.changeStatus(db, U, t.id, 'closed', null); } }
  pm.ensure(db);
  // some notifications are already read, like after a few days of use
  db.run("UPDATE notifications SET read_at = created_at WHERE id % 3 = 0");
  return { app, admin, db, counts: { measurements: recs.length, tasks: made.length, ncrs: NC.length, plans: planIds.length } };
}
const row = (db, id) => db.get('SELECT * FROM ncrs WHERE id = ?', id);

async function main() {
  const { app, admin, db, counts } = await seedAll();
  const q = (s) => db.value(s);
  console.log('Demo data ready:', JSON.stringify({ ...counts, tasksTotal: q('SELECT count(*) FROM tasks'), meetings: q('SELECT count(*) FROM meetings'), decisions: q('SELECT count(*) FROM meeting_decisions'), ncrOpen: q("SELECT count(*) FROM ncrs WHERE status IN ('reported','evaluation','action')"), planTasks: q("SELECT count(*) FROM tasks WHERE source_kind = 'preventive'") }));
  const save = arg('--save');
  if (save) { fs.rmSync(save, { force: true }); db.run('VACUUM INTO ?', path.resolve(save)); console.log('Database copy written to', save); }
  const shots = arg('--shots');
  if (shots) {
    const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
    const browser = await pw.chromium.launch();
    const rec = db.get('SELECT record_no FROM measurements WHERE id = (SELECT max(id) FROM measurements)').record_no;
    const outRec = db.get("SELECT m.record_no FROM measurements m JOIN measurement_results r ON r.measurement_id = m.id WHERE r.verdict IN ('sub','peste') LIMIT 1");
    const ncrId = db.get("SELECT id FROM ncrs WHERE status = 'action' ORDER BY id LIMIT 1").id; const taskId = db.get("SELECT id FROM tasks WHERE status = 'in_progress' ORDER BY id LIMIT 1").id;
    const meetId = db.get("SELECT id FROM meetings WHERE status = 'held' ORDER BY id DESC LIMIT 1").id; const planId = db.get("SELECT id FROM pm_plans WHERE unit = 'weeks' ORDER BY id LIMIT 1").id;
    const screens = [['home', '/'], ['register', '/masuratori'], ['record-out', `/masuratori/${outRec ? outRec.record_no : rec}`], ['tasks', '/mentenanta'], ['task', `/sarcini/${taskId}`], ['meetings', '/sedinte'], ['meeting', `/sedinte/${meetId}`], ['series', '/sedinte/serii'],
      ['ncr-register', '/calitate'], ['ncr', `/calitate/neconformitati/${ncrId}`], ['ncr-top', '/calitate/top?days=90'], ['plans', '/mentenanta/preventiv'], ['plan', `/mentenanta/preventiv/${planId}`], ['analyses', '/analize']];
    fs.mkdirSync(shots, { recursive: true });
    for (const theme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('ctc_theme', t); } catch (e) { /* none */ } }, theme);
      const page = await ctx.newPage();
      await page.goto(app.base + '/login'); await page.fill('input[name=username]', 'admin'); await page.fill('input[name=password]', admin.password); await page.click('main button[type=submit]'); await page.waitForURL(app.base + '/');
      for (const [name, url] of screens) { const r = await page.goto(app.base + url); if (r.status() >= 400) console.log('  !', name, r.status()); await page.screenshot({ path: path.join(shots, `${theme}-${name}.png`), fullPage: true }); }
      await ctx.close();
    }
    await browser.close();
    console.log('Screenshots in', shots);
  }
  await app.cleanup();
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { seedAll };
