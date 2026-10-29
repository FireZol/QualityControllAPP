-- Checking a data sheet against the paper original, row by row (the engineer types the paper values, or ticks a row after
-- looking at it). Informational: it never blocks activation. Editing a row clears its mark; a new revision starts unchecked.
CREATE TABLE construction_checks (
  construction_id INTEGER PRIMARY KEY REFERENCES constructions(id),
  revision_id INTEGER NOT NULL REFERENCES spec_revisions(id),
  checked_by INTEGER NOT NULL REFERENCES users(id),
  checked_at TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('typed', 'visual')),
  note TEXT
);
CREATE INDEX construction_checks_rev ON construction_checks(revision_id);
