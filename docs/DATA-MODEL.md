# DATA MODEL — ROMCAB CTC (SQLite)

Initial schema for migration `001_initial.sql`. Stage 1 creates all tables; stages 2–3 mostly add data and screens, not structure.
Conventions: `INTEGER PRIMARY KEY` ids, timestamps as ISO-8601 text in local time with offset (`2026-09-25T09:55:12+03:00`), booleans as 0/1, `CHECK` constraints for enums. Units per ADR-014.

```sql
PRAGMA foreign_keys = ON;

-- ───────────── system ─────────────
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE settings (            -- key/value, JSON-encoded values
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- keys: server.port, server.bind, server.public_name, session.idle_hours,
--       backup.dir, backup.auto, backup.time, backup.keep,
--       shift.day_start ("06:00"), shift.night_start ("18:00"),
--       company.name ("S.C. ROMCAB S.A.")

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('administrator','inginer','personal')),
  job_title TEXT,                               -- CTC, Manager proces, ...
  password_hash TEXT NOT NULL,                  -- scrypt$N$r$p$salt$hash
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                  -- sha256 of cookie token
  user_id INTEGER NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,                         -- login, login_failed, revision_submit, revision_verify, setting_change, backup, restore, ...
  entity TEXT, entity_id INTEGER,
  details TEXT                                  -- JSON
);

-- ───────────── reference lists ─────────────
CREATE TABLE materials (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('Cu','Al')),
  name TEXT NOT NULL,                           -- Cupru, Aluminiu
  grade TEXT,                                   -- ETP1, H11
  rho20 REAL NOT NULL,                          -- Ω·mm²/m
  density REAL NOT NULL,                        -- g/cm³
  alpha20 REAL NOT NULL                         -- 1/K
);

CREATE TABLE shapes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                    -- RE, RM, RMC, SM, SM72, SM90, SM120, SMD, SE
  name TEXT NOT NULL,                           -- "SM 90°"
  kind TEXT NOT NULL CHECK (kind IN ('rotund','sector')),
  iec_group TEXT NOT NULL CHECK (iec_group IN ('solid','circular','compactat','profilat')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE destinations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
-- Unifilar, Multifilar, Armate, Purtător, EVN

CREATE TABLE product_families (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                    -- SARMA_CL12, SARMA_CL5, FUNIE_RIGIDA, EXTRUDAT_AL, FLEXIBIL_CL5
  name TEXT NOT NULL,
  iec_class INTEGER,                            -- 1, 2, 5 (NULL for intermediate products)
  levels TEXT NOT NULL,                         -- JSON array: ["sarma"] | ["funie"] | ["conductor"] | ["suvita","toron","lita"]
  measures TEXT NOT NULL,                       -- JSON: {"diam":"2citiri"|"sector"|"auto", "mass":true, "resistance_measured":["Cu"], "resistance_theoretical":true}
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE machine_types (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE machine_type_families (
  machine_type_id INTEGER NOT NULL REFERENCES machine_types(id),
  family_id INTEGER NOT NULL REFERENCES product_families(id),
  PRIMARY KEY (machine_type_id, family_id)
);
CREATE TABLE machines (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,                    -- RIGID 1, KABMAK 1, LITARE 3
  machine_type_id INTEGER NOT NULL REFERENCES machine_types(id),
  rotor_config TEXT,                            -- "1+6+12+18+24" for stranders; NULL otherwise
  max_wires INTEGER,                            -- derived from rotor_config (1+6+12+18 → 37)
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE operators (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE clients   (id INTEGER PRIMARY KEY, short_name TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE sample_types (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,   -- Probă de pornire, Lungime, După reglaj
  numbered INTEGER NOT NULL DEFAULT 0,                 -- 1 → length number auto-increments per (machine, construction, shift_date, shift)
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE crews (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, cycle_start TEXT NOT NULL);  -- A/B/C, date of first day-shift of the cycle

-- ───────────── IEC 60228:2023 reference values ─────────────
CREATE TABLE iec_limits (
  id INTEGER PRIMARY KEY,
  edition TEXT NOT NULL DEFAULT 'IEC 60228:2023',
  iec_table TEXT NOT NULL,                      -- 'Tab. 3' | 'Tab. 4' | 'Tab. 5'
  iec_class INTEGER NOT NULL,
  section REAL NOT NULL,                        -- mm²
  material TEXT NOT NULL CHECK (material IN ('Cu','Al')),
  coated INTEGER NOT NULL DEFAULT 0,
  r_max REAL,                                   -- Ω/km at 20 °C
  min_wires_circular INTEGER, min_wires_compacted INTEGER, min_wires_shaped INTEGER,
  d_max_wire REAL,                              -- class 5 only
  note TEXT,
  UNIQUE (edition, iec_class, section, material, coated)
);

-- ───────────── technical data sheets (versioned) ─────────────
CREATE TABLE spec_documents (
  id INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL UNIQUE,                -- A6_TREFILARE_CL12, A6_TREFILARE_CL5, CABLARE_RIGIDA_AL, CABLARE_RIGIDA_CU, EXTRUDAT_AL_CL1
  code TEXT,                                    -- new document code, set in the app
  title TEXT NOT NULL,
  family_id INTEGER NOT NULL REFERENCES product_families(id)
);

CREATE TABLE spec_revisions (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES spec_documents(id),
  edition INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ciorna','in_verificare','activa','arhivata')),
  based_on_id INTEGER REFERENCES spec_revisions(id),
  change_note TEXT,
  elaborated_by INTEGER REFERENCES users(id), elaborated_at TEXT,
  submitted_at TEXT,
  verified_by INTEGER REFERENCES users(id),  verified_at TEXT,
  rejected_by INTEGER REFERENCES users(id),  rejected_at TEXT, rejected_reason TEXT,
  activated_at TEXT, archived_at TEXT,
  UNIQUE (document_id, edition, revision),
  CHECK (verified_by IS NULL OR verified_by <> elaborated_by)
);
CREATE UNIQUE INDEX one_active_revision ON spec_revisions(document_id) WHERE status = 'activa';

CREATE TABLE constructions (
  id INTEGER PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES spec_revisions(id),
  stable_key TEXT NOT NULL,                     -- same across revisions, e.g. "FUNIE|Al|240|SM90"
  family_id INTEGER NOT NULL REFERENCES product_families(id),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  section REAL NOT NULL,                        -- mm²
  shape_id INTEGER NOT NULL REFERENCES shapes(id),
  destination_id INTEGER REFERENCES destinations(id),
  coated INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,                          -- as printed: "240 SM 90°", "35/6 RM"
  wires INTEGER,                                -- number of wires in the conductor
  wire_d REAL,                                  -- nominal wire Ø in the conductor (strands)
  die TEXT,                                     -- filieră, text because of "3.21 / 3.215" and "8 x 0.328 + 8 x 0.325"
  data TEXT,                                    -- JSON for family-specific extras (class 5 counts, strander config, receptie, etc.)
  iec_exception_reason TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (revision_id, stable_key)
);

CREATE TABLE limits (
  id INTEGER PRIMARY KEY,
  construction_id INTEGER NOT NULL REFERENCES constructions(id),
  level TEXT NOT NULL CHECK (level IN ('sarma','funie','conductor','suvita','toron','lita')),
  quantity TEXT NOT NULL CHECK (quantity IN ('d','h','l','mass')),
  nominal REAL, min REAL, max REAL,             -- NULL min & max = nedeterminat
  unit TEXT NOT NULL,                           -- mm | g/m
  informative INTEGER NOT NULL DEFAULT 0,       -- 1 → shown, no verdict (RM/RMC strand Ø)
  tolerance_text TEXT,                          -- "+/-0.1"
  UNIQUE (construction_id, level, quantity)
);

CREATE TABLE process_params (                   -- stranding parameters per rotor
  id INTEGER PRIMARY KEY,
  construction_id INTEGER NOT NULL REFERENCES constructions(id),
  strander_config TEXT NOT NULL,                -- "1+6+12+18+24"
  rotor TEXT NOT NULL,                          -- "6","12","18","24","receptie"
  pitch_mm REAL,
  tension TEXT,                                 -- "3-6", "12-13", "1.6-2.0" (bar)
  UNIQUE (construction_id, strander_config, rotor)
);

-- ───────────── measurements ─────────────
CREATE TABLE measurements (
  id INTEGER PRIMARY KEY,
  record_no INTEGER NOT NULL,                   -- stable number shared by all versions of one record
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  supersedes_id INTEGER REFERENCES measurements(id),
  edit_reason TEXT,
  created_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  shift_date TEXT NOT NULL,                     -- date the shift started
  shift TEXT NOT NULL CHECK (shift IN ('zi','noapte')),
  crew_id INTEGER REFERENCES crews(id),
  family_id INTEGER NOT NULL REFERENCES product_families(id),
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  construction_id INTEGER NOT NULL REFERENCES constructions(id),
  revision_id INTEGER NOT NULL REFERENCES spec_revisions(id),
  level TEXT NOT NULL,
  destination_construction_id INTEGER REFERENCES constructions(id), -- for toron → liță resistance
  operator_id INTEGER REFERENCES operators(id),
  client_id INTEGER REFERENCES clients(id),
  sample_type_id INTEGER NOT NULL REFERENCES sample_types(id),
  length_no INTEGER,
  produced_length_m REAL,
  notes TEXT,
  UNIQUE (record_no, version)
);
CREATE INDEX meas_current ON measurements(is_current, created_at);
CREATE INDEX meas_construction ON measurements(construction_id, created_at);
CREATE INDEX meas_machine ON measurements(machine_id, created_at);

CREATE TABLE measurement_inputs (               -- exactly what the user typed
  measurement_id INTEGER NOT NULL REFERENCES measurements(id),
  key TEXT NOT NULL CHECK (key IN ('d1','d2','h','l','mass_g','sample_mm','r_value','r_unit','r_sample_m','temp_c')),
  value TEXT NOT NULL,
  PRIMARY KEY (measurement_id, key)
);

CREATE TABLE measurement_results (              -- computed on save, with the limits snapshot used
  measurement_id INTEGER NOT NULL REFERENCES measurements(id),
  quantity TEXT NOT NULL,                       -- d1, d2, d_avg, ovality, h, l, mass_gm, r20, r20_theor, r20_echiv, d_ech
  value REAL NOT NULL,
  lim_min REAL, lim_max REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('ok','sub','peste','nedeterminat','info')),
  deviation_pct REAL,                           -- for resistance: (R20 − Rmax)/Rmax·100
  source TEXT,                                  -- 'fisa' | 'IEC 60228:2023 Tab. 4' | 'calculat'
  PRIMARY KEY (measurement_id, quantity)
);
```

## Seed data (first start, only into an empty database)

| Source file | Goes to | Notes |
| --- | --- | --- |
| `seed/iec60228_2023.json` | `iec_limits` | class 1, 2, 5; plain and coated Cu; Al |
| `seed/fise_tehnice_initiale.json` → `constante_material` | `materials` | Cu ETP1 0.01707 / 8.89 / 0.00393; Al H11 0.0275 / 2.703 / 0.00403 |
| `seed/fise_tehnice_initiale.json` → `funie_rigida` | `spec_documents` CABLARE_RIGIDA_AL / _CU, revision **ciorna** Ed.1 Rev.0, `constructions`, `limits`, `process_params` | Al rotors 12/18/24 on 1+6+12+18+24; Cu rotors 6/12/18 on SETIC 1+6+12+18 |
| `… → conductor_extrudat_al` | EXTRUDAT_AL_CL1 | `null` Ø / Î × L = nedeterminat; 35 SE carries `iec_exception_reason` |
| `… → sarma_trefilata` | A6_TREFILARE_CL12 (stage 2) | seed now, screens in stage 2 |
| `… → conductor_flexibil_cl5` | A6_TREFILARE_CL5 (stage 3) | seed now, screens in stage 3 |
| fixed lists | shapes, destinations, families, machine types, sample types, crews | see `docs/ETAPA-1.md` §Seed lists |

Seeded revisions are **ciornă** on purpose: an Inginer checks them against the paper originals (the `modificat` flags mark what was red on paper) and a second Inginer activates them. `seed/verificare_seed.json` lists values that look inconsistent and must be confirmed first.

## Derivations (pure functions, unit-tested)

```
mass_gm      = mass_g / sample_mm * 1000
d_avg        = (d1 + d2) / 2 ;  ovality = |d1 − d2|
kt(t, mat)   = 1 / (1 + alpha20[mat] * (t − 20))            -- warn if t < 0 or t > 40
r_per_km     = r_unit == 'ohm_km' ? r_value : r_value / r_sample_m * 1000
r20          = r_per_km * kt
r20_echiv    = r20 / n_toroane(destination)                  -- toron measured for a liță
A_ech        = mass_gm / density[mat] ;  d_ech = sqrt(4*A_ech/pi)
r20_theor    = 1000 * rho20[mat] / A_ech
verdict(v, min, max, informative) =
    informative            → 'info'
    min == null && max == null → 'nedeterminat'
    min != null && v < min → 'sub'
    max != null && v > max → 'peste'
    else                   → 'ok'
deviation_pct = (r20 − r_max) / r_max * 100
```

Shift mapping (ADR-010): `t < 06:00 → noapte of previous day; 06:00 ≤ t < 18:00 → zi; t ≥ 18:00 → noapte of same day`. Crew: day index `n = (shift_date − crew.cycle_start) mod 12`; `n ∈ 0..3 → zi`, `6..9 → noapte`; the crew whose pattern matches the shift is on duty.

## Additions made in stage 1 (migration 001)

- `constructions.active INTEGER NOT NULL DEFAULT 1` — deactivate a construction inside a draft revision; deactivated rows are not copied by "Revizie nouă".
- `login_attempts(id, username, ts_ms, ok)` — per-username lockout (5 failures / 15 min).
- `seed_warnings(id, revision_id, level A|B|C, location, problem)` — data-quality items from `seed/verificare_seed.json`, shown on the draft revision.
- Shape `LITA` ("Liță clasa 5") for class 5 constructions; indexes `audit_ts`, `meas_record`, `constructions_revision`.
