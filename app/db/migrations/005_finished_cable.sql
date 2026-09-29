-- Finished low-voltage cable (IEC 60502-1, HD 603, VDE 0276-603): batches and drums, a catalogue of tests, pass / fail verdicts.
-- Test limits are NOT seeded: the engineers fill them in on the cable data sheet (nothing is guessed).

-- results may now carry a pass / fail verdict ("neconform"), inputs and limits may use the test codes
CREATE TABLE measurement_results_new (
  measurement_id INTEGER NOT NULL REFERENCES measurements(id),
  quantity TEXT NOT NULL,
  value REAL NOT NULL,
  lim_min REAL, lim_max REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('ok','sub','peste','nedeterminat','info','neconform')),
  deviation_pct REAL,
  source TEXT,
  PRIMARY KEY (measurement_id, quantity)
);
INSERT INTO measurement_results_new SELECT measurement_id, quantity, value, lim_min, lim_max, verdict, deviation_pct, source FROM measurement_results ORDER BY rowid;
DROP TABLE measurement_results;
ALTER TABLE measurement_results_new RENAME TO measurement_results;

CREATE TABLE measurement_inputs_new (
  measurement_id INTEGER NOT NULL REFERENCES measurements(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (measurement_id, key)
);
INSERT INTO measurement_inputs_new SELECT measurement_id, key, value FROM measurement_inputs ORDER BY rowid;
DROP TABLE measurement_inputs;
ALTER TABLE measurement_inputs_new RENAME TO measurement_inputs;

CREATE TABLE limits_new (
  id INTEGER PRIMARY KEY,
  construction_id INTEGER NOT NULL REFERENCES constructions(id),
  level TEXT NOT NULL CHECK (level IN ('sarma','funie','conductor','suvita','toron','lita','cablu')),
  quantity TEXT NOT NULL,                       -- d, h, l, mass, r20 or a test result code (ins_thick_min ...)
  nominal REAL, min REAL, max REAL,
  unit TEXT NOT NULL,
  informative INTEGER NOT NULL DEFAULT 0,
  tolerance_text TEXT,
  UNIQUE (construction_id, level, quantity)
);
INSERT INTO limits_new SELECT id, construction_id, level, quantity, nominal, min, max, unit, informative, tolerance_text FROM limits;
DROP TABLE limits;
ALTER TABLE limits_new RENAME TO limits;

-- catalogue of finished-cable tests (editable by an Inginer)
CREATE TABLE test_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code GLOB '[a-z]*' AND code NOT GLOB '*[^a-z0-9_]*'),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('numeric','readings','passfail','resistance')),
  unit TEXT,
  decimals INTEGER NOT NULL DEFAULT 2,
  scope TEXT NOT NULL DEFAULT 'sample' CHECK (scope IN ('routine','sample','type')),
  standard_ref TEXT,
  applies_to TEXT NOT NULL DEFAULT '',          -- comma separated compound codes (PVC, XLPE, HFFR ...); empty = every cable
  in_house INTEGER NOT NULL DEFAULT 1,          -- 0 = done by an external laboratory (result typed from its report)
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

-- insulation / sheath compounds and the standards a cable is certified to (editable lists)
CREATE TABLE compounds (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
INSERT INTO compounds(code, name) VALUES
  ('PVC', 'PVC (policlorură de vinil)'), ('XLPE', 'XLPE (polietilenă reticulată)'), ('HFFR', 'HFFR / LSZH (fără halogeni, cu fum redus)'),
  ('EPR', 'EPR (cauciuc etilenă-propilenă)'), ('PE', 'PE (polietilenă)'), ('PUR', 'PUR (poliuretan)'), ('ELASTOMER', 'Elastomer / cauciuc');
CREATE TABLE cable_standards (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
INSERT INTO cable_standards(name) VALUES ('IEC 60502-1'), ('HD 603'), ('VDE 0276-603');

CREATE TABLE batches (
  id INTEGER PRIMARY KEY,
  batch_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
  order_no TEXT,
  client_id INTEGER REFERENCES clients(id),
  construction_id INTEGER NOT NULL REFERENCES constructions(id),   -- the cable design, from the active revision at creation
  revision_id INTEGER NOT NULL REFERENCES spec_revisions(id),
  standard TEXT,
  produced_length_m REAL,
  produced_on TEXT,
  status TEXT NOT NULL DEFAULT 'deschis' CHECK (status IN ('deschis','inchis')),
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX batches_construction ON batches(construction_id);

CREATE TABLE drums (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  drum_no TEXT NOT NULL COLLATE NOCASE,
  length_m REAL,
  notes TEXT,
  UNIQUE (batch_id, drum_no)
);

ALTER TABLE measurements ADD COLUMN batch_id INTEGER REFERENCES batches(id);
ALTER TABLE measurements ADD COLUMN drum_id INTEGER REFERENCES drums(id);
CREATE INDEX meas_batch ON measurements(batch_id, is_current);

-- issued batch certificates are frozen snapshots: a later correction never changes what was issued
CREATE TABLE batch_certificates (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  cert_no TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  issued_by INTEGER NOT NULL REFERENCES users(id),
  conforming INTEGER NOT NULL,
  override_reason TEXT,                        -- required when a non-conforming batch is certified anyway
  supersedes_id INTEGER REFERENCES batch_certificates(id),
  snapshot TEXT NOT NULL
);

-- family, machine type, machine and the (empty) data sheet for finished cable
INSERT INTO product_families(code, name, iec_class, levels, measures, active, sort)
  SELECT 'CABLE_LV', 'Cablu de joasă tensiune (finit)', NULL, '["cablu"]',
         '{"diam":null,"mass":false,"resistance_measured":["Cu","Al"],"resistance_theoretical":false,"tests":true}', 1, 6
   WHERE NOT EXISTS (SELECT 1 FROM product_families WHERE code = 'CABLE_LV');
INSERT INTO machine_types(name) SELECT 'Încercări cablu finit' WHERE NOT EXISTS (SELECT 1 FROM machine_types WHERE name = 'Încercări cablu finit');
INSERT INTO machine_type_families(machine_type_id, family_id)
  SELECT t.id, f.id FROM machine_types t, product_families f
   WHERE t.name = 'Încercări cablu finit' AND f.code = 'CABLE_LV'
     AND NOT EXISTS (SELECT 1 FROM machine_type_families x WHERE x.machine_type_id = t.id AND x.family_id = f.id);
INSERT INTO machines(name, machine_type_id)
  SELECT 'STAȚIE ÎNCERCĂRI 1', t.id FROM machine_types t
   WHERE t.name = 'Încercări cablu finit' AND NOT EXISTS (SELECT 1 FROM machines WHERE name = 'STAȚIE ÎNCERCĂRI 1');
INSERT INTO spec_documents(doc_type, code, title, family_id)
  SELECT 'CABLU_LV', NULL, 'Fișe tehnice cablu de joasă tensiune (IEC 60502-1 / HD 603 / VDE 0276-603)', f.id
    FROM product_families f WHERE f.code = 'CABLE_LV' AND NOT EXISTS (SELECT 1 FROM spec_documents WHERE doc_type = 'CABLU_LV');
INSERT INTO spec_revisions(document_id, edition, revision, status, change_note)
  SELECT d.id, 1, 0, 'ciorna', 'Fișă goală: inginerii adaugă tipurile de cablu și limitele încercărilor, apoi o verifică și o activează un al doilea inginer.'
    FROM spec_documents d WHERE d.doc_type = 'CABLU_LV' AND NOT EXISTS (SELECT 1 FROM spec_revisions WHERE document_id = d.id);

-- proposed catalogue (names, units, kinds, which compounds a test applies to); limits and standard references are filled in by the engineers
INSERT INTO test_types(code, name, kind, unit, decimals, scope, applies_to, in_house, sort) VALUES
  ('cond_res',        'Rezistența conductorului la 20 °C',                 'resistance', 'Ω/km', 4, 'routine', '', 1, 10),
  ('hv_test',         'Încercarea cu tensiune (rigiditate dielectrică)',   'passfail',   NULL,   0, 'routine', '', 1, 20),
  ('spark_test',      'Încercarea cu scânteie a izolației',                'passfail',   NULL,   0, 'routine', '', 1, 30),
  ('pd_test',         'Descărcări parțiale',                               'numeric',    'pC',   0, 'routine', '', 1, 40),
  ('cond_exam',       'Examinarea conductorului',                          'passfail',   NULL,   0, 'sample',  '', 1, 100),
  ('ins_thick',       'Grosimea izolației',                                'readings',   'mm',   2, 'sample',  '', 1, 110),
  ('sheath_thick',    'Grosimea mantalei',                                 'readings',   'mm',   2, 'sample',  '', 1, 120),
  ('inner_thick',     'Grosimea învelișului interior / umpluturii',        'readings',   'mm',   2, 'sample',  '', 1, 125),
  ('od',              'Diametrul exterior',                                'readings',   'mm',   2, 'sample',  '', 1, 130),
  ('core_id',         'Identificarea firelor (culori / numerotare)',       'passfail',   NULL,   0, 'sample',  '', 1, 140),
  ('marking',         'Marcarea cablului',                                 'passfail',   NULL,   0, 'sample',  '', 1, 150),
  ('drum_marking',    'Marcarea și ambalarea (tobă / colac)',              'passfail',   NULL,   0, 'sample',  '', 1, 160),
  ('length_check',    'Lungimea livrată',                                  'numeric',    'm',    1, 'sample',  '', 1, 170),
  ('hot_set_load',    'Hot set: alungire sub sarcină',                     'numeric',    '%',    0, 'sample',  'XLPE,EPR', 1, 200),
  ('hot_set_perm',    'Hot set: alungire remanentă',                       'numeric',    '%',    0, 'sample',  'XLPE,EPR', 1, 210),
  ('ins_tensile',     'Izolație: rezistență la tracțiune',                 'numeric',    'N/mm²', 1, 'sample', '', 1, 220),
  ('ins_elong',       'Izolație: alungire la rupere',                      'numeric',    '%',    0, 'sample',  '', 1, 230),
  ('ins_tensile_var', 'Izolație: variația rezistenței la tracțiune după îmbătrânire', 'numeric', '%', 0, 'sample', '', 1, 240),
  ('ins_elong_var',   'Izolație: variația alungirii la rupere după îmbătrânire',      'numeric', '%', 0, 'sample', '', 1, 250),
  ('sheath_tensile',  'Manta: rezistență la tracțiune',                    'numeric',    'N/mm²', 1, 'sample', '', 1, 260),
  ('sheath_elong',    'Manta: alungire la rupere',                         'numeric',    '%',    0, 'sample',  '', 1, 270),
  ('sheath_tensile_var', 'Manta: variația rezistenței la tracțiune după îmbătrânire', 'numeric', '%', 0, 'sample', '', 1, 280),
  ('sheath_elong_var',   'Manta: variația alungirii la rupere după îmbătrânire',      'numeric', '%', 0, 'sample', '', 1, 290),
  ('shrinkage',       'Contracția izolației',                              'numeric',    '%',    1, 'sample',  'XLPE,EPR,PE', 1, 300),
  ('pvc_mass_loss',   'PVC: pierdere de masă la îmbătrânire termică',      'numeric',    'mg/cm²', 1, 'sample', 'PVC', 1, 310),
  ('pvc_thermal_stab','PVC: stabilitate termică',                          'numeric',    'min',  0, 'sample',  'PVC', 1, 320),
  ('pvc_heat_shock',  'PVC: șoc termic',                                   'passfail',   NULL,   0, 'sample',  'PVC', 1, 330),
  ('pvc_pressure_ht', 'PVC: presiune la temperatură ridicată (indentare)', 'numeric',    '%',    0, 'sample',  'PVC', 1, 340),
  ('ir_20',           'Rezistența de izolație la 20 °C',                   'numeric',    'MΩ·km', 1, 'type',   '', 1, 400),
  ('ir_max',          'Rezistența de izolație la temperatura maximă a conductorului', 'numeric', 'MΩ·km', 1, 'type', '', 1, 410),
  ('hv_4h',           'Încercarea cu tensiune, 4 h',                       'passfail',   NULL,   0, 'type',    '', 1, 420),
  ('cold_bend',       'Încercarea de îndoire la rece',                     'passfail',   NULL,   0, 'type',    '', 1, 430),
  ('cold_impact',     'Încercarea de impact la rece',                      'passfail',   NULL,   0, 'type',    '', 1, 440),
  ('flame',           'Propagarea flăcării (un singur cablu)',             'passfail',   NULL,   0, 'type',    '', 1, 450),
  ('water_abs',       'Absorbția de apă (gravimetrică)',                   'numeric',    'mg/cm²', 1, 'type',  'XLPE,EPR', 1, 460),
  ('halogen_hcl',     'Gaze acide halogenate (conținut de HCl)',           'numeric',    'mg/g', 1, 'type',    'HFFR', 0, 500),
  ('acid_ph',         'Aciditatea gazelor degajate: pH',                   'numeric',    'pH',   2, 'type',    'HFFR', 0, 510),
  ('acid_cond',       'Aciditatea gazelor degajate: conductivitate',       'numeric',    'µS/mm', 2, 'type',   'HFFR', 0, 520),
  ('smoke_trans',     'Densitatea fumului: transmitanța luminii (minimă)', 'numeric',    '%',    0, 'type',    'HFFR', 0, 530),
  ('flame_bunch',     'Propagarea flăcării pe fascicul de cabluri',        'passfail',   NULL,   0, 'type',    'HFFR', 0, 540),
  ('oxygen_index',    'Indice de oxigen',                                  'numeric',    '%',    0, 'type',    'HFFR', 0, 550);

-- what kind of test session a record is (sample types are an editable list)
INSERT INTO sample_types(name, numbered, sort)
  SELECT 'Încercare de rutină', 0, 10 WHERE NOT EXISTS (SELECT 1 FROM sample_types WHERE name = 'Încercare de rutină');
INSERT INTO sample_types(name, numbered, sort)
  SELECT 'Încercare pe probă', 0, 11 WHERE NOT EXISTS (SELECT 1 FROM sample_types WHERE name = 'Încercare pe probă');
INSERT INTO sample_types(name, numbered, sort)
  SELECT 'Încercare de tip', 0, 12 WHERE NOT EXISTS (SELECT 1 FROM sample_types WHERE name = 'Încercare de tip');
