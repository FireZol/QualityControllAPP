-- Non-conformity register (starts new in the app; an Excel import can fill external_ref and the rest later). Records are closed or cancelled, never deleted.
CREATE TABLE ncr_types (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_en TEXT, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE ncr_dispositions (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_en TEXT, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO ncr_types(name, name_en, sort) VALUES
  ('Dimensional', 'Dimensional', 10), ('Masă', 'Mass', 20), ('Rezistență electrică', 'Electrical resistance', 30), ('Aspect / suprafață', 'Appearance / surface', 40),
  ('Izolație', 'Insulation', 50), ('Marcare / ambalare', 'Marking / packaging', 60), ('Altele', 'Other', 90);
INSERT INTO ncr_dispositions(name, name_en, sort) VALUES
  ('Acceptat ca atare', 'Accepted as is', 10), ('Reprelucrare', 'Rework', 20), ('Declasat', 'Downgraded', 30), ('Rebut', 'Scrap', 40), ('Retur furnizor', 'Returned to supplier', 50);
CREATE TABLE ncrs (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported', 'evaluation', 'action', 'closed', 'cancelled')),
  type_id INTEGER REFERENCES ncr_types(id),
  severity_id INTEGER REFERENCES priorities(id),
  machine_id INTEGER REFERENCES machines(id),
  product TEXT,
  quantity TEXT,
  source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('manual', 'measurement', 'batch', 'customer', 'audit')),
  record_no INTEGER,                        -- the measurement it came from (record number)
  batch_id INTEGER REFERENCES batches(id),
  external_ref TEXT,                        -- the row / number in the old Excel register
  site TEXT,
  cause TEXT,
  evaluation TEXT,
  disposition_id INTEGER REFERENCES ncr_dispositions(id),
  reported_by INTEGER NOT NULL REFERENCES users(id),
  reported_at TEXT NOT NULL,                -- the day it was found (yyyy-mm-dd)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id)
);
CREATE INDEX ncrs_status ON ncrs(status);
CREATE INDEX ncrs_reported ON ncrs(reported_at);
CREATE TABLE ncr_events (
  id INTEGER PRIMARY KEY,
  ncr_id INTEGER NOT NULL REFERENCES ncrs(id),
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('created', 'status', 'comment', 'edit', 'task')),
  from_status TEXT, to_status TEXT, text TEXT, details TEXT
);
CREATE INDEX ncr_events_ncr ON ncr_events(ncr_id);
