'use strict';
// First-start seeding into an empty database (idempotent: guarded by settings 'seed.done').
// The JSON in seed/ is a DRAFT transcribed from scans: it is loaded as-is into 'ciorna' revisions,
// never corrected in code (values that look wrong are listed in seed_warnings for the engineers).
const fs = require('node:fs');
const path = require('node:path');
const { nowIso } = require('../lib/time');
const { dateKey } = require('../domain/shifts');
const settings = require('../domain/settings');
const auth = require('../lib/auth');
const audit = require('../domain/audit');

const r4 = (v) => Number(Number(v).toFixed(4));
const readJson = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const SHAPES = [
  ['RE', 'RE', 'rotund', 'solid'],
  ['RM', 'RM', 'rotund', 'compactat'], // owner (2026-09-29): RM is checked against the compacted minimum (Al 50 RM: min 6 wires)
  ['RMC', 'RMC', 'rotund', 'compactat'],
  ['SM', 'SM', 'sector', 'profilat'],
  ['SM72', 'SM 72°', 'sector', 'profilat'],
  ['SM90', 'SM 90°', 'sector', 'profilat'],
  ['SM120', 'SM 120°', 'sector', 'profilat'],
  ['SMD', 'SM drept', 'sector', 'profilat'],
  ['SE', 'SE', 'sector', 'solid'],
  ['LITA', 'Liță clasa 5', 'rotund', 'circular'], // class 5 strands have no shape on paper; needed because constructions.shape_id is NOT NULL
];
const DESTINATIONS = ['Unifilar', 'Multifilar', 'Armate', 'Purtător', 'EVN'];
const DEST_FROM_SEED = { Unifilar: 'Unifilar', Multifilar: 'Multifilar', Armate: 'Armate', Purtator: 'Purtător', EVN: 'EVN' };

const FAMILIES = [
  { code: 'SARMA_CL12', name: 'Sârmă trefilată clasa I–II', iec_class: null, levels: ['sarma'], measures: { diam: '2citiri', mass: true, resistance_measured: ['Cu'], resistance_theoretical: false }, active: 1, sort: 1 },
  { code: 'SARMA_CL5', name: 'Sârmă trefilată multifilar clasa V', iec_class: null, levels: ['sarma'], measures: { diam: '2citiri', mass: false, resistance_measured: [], resistance_theoretical: false, spec_family: 'FLEXIBIL_CL5' }, active: 1, sort: 2 },
  { code: 'FUNIE_RIGIDA', name: 'Funie rigidă clasa 2', iec_class: 2, levels: ['funie'], measures: { diam: 'auto', mass: true, resistance_measured: ['Cu'], resistance_theoretical: true }, active: 1, sort: 3 },
  { code: 'EXTRUDAT_AL', name: 'Conductor extrudat Al clasa 1', iec_class: 1, levels: ['conductor'], measures: { diam: 'auto', mass: true, resistance_measured: [], resistance_theoretical: true }, active: 1, sort: 4 },
  { code: 'FLEXIBIL_CL5', name: 'Conductor flexibil clasa 5', iec_class: 5, levels: ['suvita', 'toron', 'lita'], measures: { diam: null, mass: true, resistance_measured: ['Cu'], resistance_theoretical: false }, active: 1, sort: 5 },
];

const MACHINE_TYPES = [
  ['Trefilare', ['SARMA_CL12']],
  ['Trefilare multifilară', ['SARMA_CL5']],
  ['Cablare rigidă', ['FUNIE_RIGIDA']],
  ['Sector / extrudare', ['EXTRUDAT_AL']],
  ['Cablare flexibil', ['FLEXIBIL_CL5']],
];
const MACHINES = [
  ['TREFILARE 1', 'Trefilare'], ['TREFILARE MF 1', 'Trefilare multifilară'],
  ['RIGID 1', 'Cablare rigidă'], ['RIGID 2', 'Cablare rigidă'],
  ['KABMAK 1', 'Cablare flexibil'], ['KABMAK 2', 'Cablare flexibil'],
  ['Conform Extruder', 'Sector / extrudare'],
  ['LITARE 1', 'Cablare flexibil'], ['LITARE 2', 'Cablare flexibil'], ['LITARE 3', 'Cablare flexibil'], ['LITARE 4', 'Cablare flexibil'],
];
const SAMPLE_TYPES = [['Probă de pornire', 0], ['Lungime', 1], ['După reglaj', 0]];
const CLIENTS = ['SBT', 'TUB', 'VOLT', 'ESI', 'Iemar'];

const DOCS = [
  { doc_type: 'A6_TREFILARE_CL12', title: 'Anexa A6 — Trefilare, conductori rotunzi clasa I–II Cu și Al', family: 'SARMA_CL12' },
  { doc_type: 'A6_TREFILARE_CL5', title: 'Anexa A6 — Trefilare, conductori flexibili clasa V Cu', family: 'FLEXIBIL_CL5' },
  { doc_type: 'CABLARE_RIGIDA_AL', title: 'Instrucțiune cablare rigidă — Aluminiu (strander 1+6+12+18+24)', family: 'FUNIE_RIGIDA' },
  { doc_type: 'CABLARE_RIGIDA_CU', title: 'Instrucțiune cablare rigidă — Cupru (strander SETIC 1+6+12+18)', family: 'FUNIE_RIGIDA' },
  { doc_type: 'EXTRUDAT_AL_CL1', title: 'Conductori sector clasa 1 aluminiu', family: 'EXTRUDAT_AL' },
];

function seedIfEmpty(db, { seedDir, config, log }) {
  if (db.get("SELECT value FROM settings WHERE key = 'seed.done'")) return { seeded: false };
  const say = log || (() => {});
  const now = nowIso();

  const iec = readJson(seedDir, 'iec60228_2023.json');
  const fise = readJson(seedDir, 'fise_tehnice_initiale.json');
  let verificare = [];
  try { verificare = readJson(seedDir, 'verificare_seed.json'); } catch (_) { /* optional */ }

  db.tx(() => {
    // settings
    settings.set(db, 'server.port', config.port);
    settings.set(db, 'server.bind', config.bind);
    settings.set(db, 'server.public_name', config.publicName || '');
    settings.set(db, 'session.idle_hours', settings.DEFAULTS['session.idle_hours']);
    settings.set(db, 'backup.dir', null);
    settings.set(db, 'backup.auto', true);
    settings.set(db, 'backup.time', '02:00');
    settings.set(db, 'backup.keep', 14);
    settings.set(db, 'shift.day_start', '06:00');
    settings.set(db, 'shift.night_start', '18:00');
    settings.set(db, 'company.name', 'S.C. ROMCAB S.A.');

    // materials
    const mc = fise.constante_material;
    const mat = {};
    for (const [code, name] of [['Cu', 'Cupru'], ['Al', 'Aluminiu']]) {
      const c = mc[code];
      mat[code] = db.run('INSERT INTO materials(code, name, grade, rho20, density, alpha20) VALUES (?,?,?,?,?,?)',
        code, name, c.calitate, c.rho20_ohm_mm2_m, c.densitate_g_cm3, c.alfa20).id;
    }

    // shapes, destinations
    const shape = {};
    for (const [code, name, kind, grp] of SHAPES) shape[code] = db.run('INSERT INTO shapes(code, name, kind, iec_group) VALUES (?,?,?,?)', code, name, kind, grp).id;
    const dest = {};
    for (const n of DESTINATIONS) dest[n] = db.run('INSERT INTO destinations(name) VALUES (?)', n).id;

    // families, machine types, machines
    const fam = {};
    for (const f of FAMILIES) {
      fam[f.code] = db.run('INSERT INTO product_families(code, name, iec_class, levels, measures, active, sort) VALUES (?,?,?,?,?,?,?)',
        f.code, f.name, f.iec_class, JSON.stringify(f.levels), JSON.stringify(f.measures), f.active, f.sort).id;
    }
    const mtype = {};
    for (const [name, fams] of MACHINE_TYPES) {
      mtype[name] = db.run('INSERT INTO machine_types(name) VALUES (?)', name).id;
      for (const fc of fams) db.run('INSERT INTO machine_type_families(machine_type_id, family_id) VALUES (?,?)', mtype[name], fam[fc]);
    }
    for (const [name, type] of MACHINES) db.run('INSERT INTO machines(name, machine_type_id) VALUES (?,?)', name, mtype[type]);

    // sample types, clients, crews
    SAMPLE_TYPES.forEach(([name, numbered], i) => db.run('INSERT INTO sample_types(name, numbered, sort) VALUES (?,?,?)', name, numbered, i));
    for (const c of CLIENTS) db.run('INSERT INTO clients(short_name) VALUES (?)', c);
    const today = new Date();
    ['A', 'B', 'C'].forEach((name, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 4 * i);
      db.run('INSERT INTO crews(name, cycle_start) VALUES (?,?)', name, dateKey(d));
    });

    // IEC 60228:2023 limit values only (ADR-009)
    const insIec = 'INSERT INTO iec_limits(iec_table, iec_class, section, material, coated, r_max, min_wires_circular, min_wires_compacted, min_wires_shaped, d_max_wire, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
    for (const row of iec.class1) {
      const note = (v) => (v.sectiune >= 10 && v.sectiune <= 35 ? iec.class1_notes.al_10_35 : null);
      if (row.cu_simplu != null) db.run(insIec, 'Tab. 3', 1, row.sectiune, 'Cu', 0, row.cu_simplu, null, null, null, null, null);
      if (row.cu_acoperit != null) db.run(insIec, 'Tab. 3', 1, row.sectiune, 'Cu', 1, row.cu_acoperit, null, null, null, null, null);
      if (row.al != null) db.run(insIec, 'Tab. 3', 1, row.sectiune, 'Al', 0, row.al, null, null, null, null, note(row));
    }
    for (const row of iec.class2) {
      const fm = row.fire_min;
      for (const m of ['cu', 'al']) {
        const mn = { c: fm.circular[m], k: fm.compactat[m], p: fm.profilat[m] };
        const mater = m === 'cu' ? 'Cu' : 'Al';
        const rs = m === 'cu' ? [[0, row.cu_simplu], [1, row.cu_acoperit]] : [[0, row.al]];
        for (const [coated, r] of rs) {
          if (r == null && mn.c == null && mn.k == null && mn.p == null) continue;
          db.run(insIec, 'Tab. 4', 2, row.sectiune, mater, coated, r, mn.c, mn.k, mn.p, null, null);
        }
      }
    }
    for (const row of iec.class5_cu) {
      if (row.cu_simplu != null) db.run(insIec, 'Tab. 5', 5, row.sectiune, 'Cu', 0, row.cu_simplu, null, null, null, row.d_max_fir, null);
      if (row.cu_acoperit != null) db.run(insIec, 'Tab. 5', 5, row.sectiune, 'Cu', 1, row.cu_acoperit, null, null, null, row.d_max_fir, null);
    }

    // documents and draft revisions
    const doc = {}, rev = {};
    for (const d of DOCS) {
      doc[d.doc_type] = db.run('INSERT INTO spec_documents(doc_type, code, title, family_id) VALUES (?,?,?,?)', d.doc_type, null, d.title, fam[d.family]).id;
      rev[d.doc_type] = db.run(
        "INSERT INTO spec_revisions(document_id, edition, revision, status, change_note, elaborated_at) VALUES (?,?,?,'ciorna',?,NULL)",
        doc[d.doc_type], 1, 0, 'Încărcare inițială din documentele primite (ciornă de verificat de ingineri înaintea activării).').id;
    }

    const insC = 'INSERT INTO constructions(revision_id, stable_key, family_id, material_id, section, shape_id, destination_id, coated, label, wires, wire_d, die, data, iec_exception_reason, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    const insL = 'INSERT INTO limits(construction_id, level, quantity, nominal, min, max, unit, informative, tolerance_text) VALUES (?,?,?,?,?,?,?,?,?)';
    const insP = 'INSERT INTO process_params(construction_id, strander_config, rotor, pitch_mm, tension) VALUES (?,?,?,?,?)';

    // funie rigidă
    const funieDocs = { Al: ['CABLARE_RIGIDA_AL', '1+6+12+18+24'], Cu: ['CABLARE_RIGIDA_CU', '1+6+12+18'] };
    const counters = {};
    for (const f of fise.funie_rigida) {
      const [dt, config] = funieDocs[f.material];
      const n = (counters[dt] = (counters[dt] || 0) + 1);
      const cid = db.run(insC, rev[dt], `FUNIE|${f.material}|${f.sectiune}|${f.forma}`, fam.FUNIE_RIGIDA, mat[f.material], f.sectiune, shape[f.forma], null, 0,
        f.denumire, f.nr_fire, f.d_fir, null,
        JSON.stringify({ d_fir_modificat: !!f.d_fir_modificat, tensionare_receptie: f.tensionare_receptie, clasa: f.clasa, sursa: f.sursa }), null, n).id;
      const df = f.diametru_funie || {};
      const tol = f.diametru_funie_toleranta === 'informativ' ? null : Number(String(f.diametru_funie_toleranta).replace('+/-', ''));
      if (df.h !== undefined || df.l !== undefined) {
        for (const q of ['h', 'l']) {
          const nom = df[q];
          db.run(insL, cid, 'funie', q, nom, tol == null ? null : r4(nom - tol), tol == null ? null : r4(nom + tol), 'mm', tol == null ? 1 : 0, f.diametru_funie_toleranta === 'informativ' ? 'informativ' : f.diametru_funie_toleranta);
        }
      } else {
        db.run(insL, cid, 'funie', 'd', df.d === undefined ? null : df.d, null, null, 'mm', 1, 'informativ');
      }
      db.run(insL, cid, 'funie', 'mass', null, f.masa_min_g_m, f.masa_max_g_m, 'g/m', 0, null);
      for (const [rotor, p] of Object.entries(f.rotoare || {})) {
        if (p) db.run(insP, cid, config, rotor, p.pas_mm, p.tensionare);
      }
      if (f.tensionare_receptie != null) db.run(insP, cid, config, 'receptie', null, String(f.tensionare_receptie));
    }

    // conductor extrudat Al
    fise.conductor_extrudat_al.forEach((c, i) => {
      const cid = db.run(insC, rev.EXTRUDAT_AL_CL1, `EXTR|${c.material}|${c.sectiune}|${c.forma}`, fam.EXTRUDAT_AL, mat[c.material], c.sectiune, shape[c.forma], null, 0,
        c.denumire, null, null, c.filiera_trefilare == null ? null : String(c.filiera_trefilare),
        JSON.stringify({ clasa: c.clasa, sursa: c.sursa }), c.exceptie_iec || null, i + 1).id;
      if (c.forma === 'SE') {
        db.run(insL, cid, 'conductor', 'h', null, c.h == null ? null : c.h, null, 'mm', 0, null);
        db.run(insL, cid, 'conductor', 'l', null, c.l == null ? null : c.l, null, 'mm', 0, null);
        // the two rows above stay 'nedeterminat' (NULL min & max) until the engineers set them
      } else {
        db.run(insL, cid, 'conductor', 'd', c.d_nom, c.d_min, c.d_max, 'mm', 0, null);
      }
      db.run(insL, cid, 'conductor', 'mass', null, c.masa_min_g_m, c.masa_max_g_m, 'g/m', 0, null);
    });

    // sârmă trefilată (stage 2 screens; data seeded now)
    fise.sarma_trefilata.forEach((w, i) => {
      const destName = w.destinatie ? DEST_FROM_SEED[w.destinatie] : null;
      const key = `SARMA|${w.material}|${w.destinatie || '-'}|${w.sectiune}|${w.forme.join('+')}`;
      const cid = db.run(insC, rev.A6_TREFILARE_CL12, key, fam.SARMA_CL12, mat[w.material], w.sectiune, shape[w.forme[0]], destName ? dest[destName] : null, 0,
        w.denumire, w.nr_fire_conductor, w.d_nom, w.filiera == null ? null : String(w.filiera),
        JSON.stringify({ forme: w.forme, modificat: w.modificat, sursa: w.sursa }), null, i + 1).id;
      db.run(insL, cid, 'sarma', 'd', w.d_nom, w.d_min, w.d_max, 'mm', 0, null);
      db.run(insL, cid, 'sarma', 'mass', null, w.masa_min_kg_km, w.masa_max_kg_km, 'g/m', 0, null);
    });

    // conductor flexibil clasa 5 (stage 3 screens; data seeded now)
    fise.conductor_flexibil_cl5.forEach((c, i) => {
      const key = `FLEX|Cu|${c.sectiune}|${c.filiera}`;
      const cid = db.run(insC, rev.A6_TREFILARE_CL5, key, fam.FLEXIBIL_CL5, mat.Cu, c.sectiune, shape.LITA, null, 0,
        String(c.sectiune).replace('.', ',') + ' mm²', c.nr_fire_lita, c.d_sarma, c.filiera,
        JSON.stringify({
          d_sarma_lita: c.d_sarma_lita, nr_fire_lita: c.nr_fire_lita, nr_toroane: c.nr_toroane, nr_fire_toron: c.nr_fire_toron,
          nr_fire_suvita: c.nr_fire_suvita, destinatie: c.destinatie, sursa: c.sursa,
        }), null, i + 1).id;
      db.run(insL, cid, 'sarma', 'd', c.d_sarma, null, null, 'mm', 0, null); // nominal only on paper: min / max undetermined
      db.run(insL, cid, 'suvita', 'mass', null, c.suvita_min_g_m, c.suvita_max_g_m, 'g/m', 0, null);
      if (c.toron_min_g_m != null || c.toron_max_g_m != null) db.run(insL, cid, 'toron', 'mass', null, c.toron_min_g_m, c.toron_max_g_m, 'g/m', 0, null);
      db.run(insL, cid, 'lita', 'mass', c.lita_aprox_g_m, null, null, 'g/m', 1, 'aprox.');
    });

    // data-quality warnings from the transcription check
    const warnDoc = (unde) => {
      if (unde.startsWith('Funie Al')) return 'CABLARE_RIGIDA_AL';
      if (unde.startsWith('Funie Cu')) return 'CABLARE_RIGIDA_CU';
      if (unde.startsWith('Flexibil')) return 'A6_TREFILARE_CL5';
      if (unde.startsWith('Conductor') || unde.startsWith('Extrudat')) return 'EXTRUDAT_AL_CL1';
      return 'A6_TREFILARE_CL12';
    };
    for (const w of verificare) {
      db.run('INSERT INTO seed_warnings(revision_id, level, location, problem) VALUES (?,?,?,?)', rev[warnDoc(w.unde)], w.nivel, w.unde, w.problema);
    }

    db.run("INSERT INTO settings(key, value) VALUES ('seed.done', ?)", JSON.stringify(now));
  });

  return { seeded: true };
}

/**
 * Reference values that must exist on every installation, including databases seeded by an earlier version:
 * IEC 60228 Table A.1 (kt at alpha = 0.004, 0..40 C), used to show that the temperature formula is the standard's.
 */
function ensureReference(db, seedDir) {
  if (db.get("SELECT 1 FROM settings WHERE key = 'iec.kt_a1'")) return;
  try {
    const iec = readJson(seedDir, 'iec60228_2023.json');
    if (iec.kt_table_A1) settings.set(db, 'iec.kt_a1', iec.kt_table_A1);
  } catch (_) { /* seed folder absent: the check table is simply not shown */ }
}

/**
 * Create the first administrator when the database has no user at all (async because scrypt is).
 * The one-time password is printed to the console once and never stored in clear.
 * @returns {Promise<string|null>} the password, or null when a user already exists
 */
async function ensureAdmin(db, log) {
  if (db.value('SELECT count(*) FROM users') > 0) return null;
  const password = auth.generatePassword(12);
  const hash = await auth.hashPassword(password);
  const created = db.tx(() => {
    if (db.value('SELECT count(*) FROM users') > 0) return false;
    const id = db.run("INSERT INTO users(username, full_name, role, job_title, password_hash, must_change_password, active, created_at) VALUES ('admin','Administrator','administrator',NULL,?,1,1,?)", hash, nowIso()).id;
    audit.log(db, id, 'seed', 'users', id, { note: 'first start' });
    return true;
  });
  if (!created) return null;
  if (log) {
    log('');
    log('==============================================================');
    log(' PRIMA PORNIRE — cont creat');
    log('   utilizator: admin');
    log('   parolă unică: ' + password);
    log(' Se cere schimbarea parolei la prima autentificare.');
    log(' Parola nu se mai afișează. Notați-o acum.');
    log('==============================================================');
    log('');
  }
  return password;
}

module.exports = { seedIfEmpty, ensureReference, ensureAdmin, SHAPES, FAMILIES };
