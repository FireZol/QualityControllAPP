-- Custom fields and custom lists (owner 2026-10-31): an administrator adds fields to tasks, non-conformities and meetings, and pick-lists
-- for them, without any change to the program. Fields and list items are hidden, never deleted, so the history keeps its meaning.
CREATE TABLE custom_lists (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  name_en    TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE custom_list_items (
  id      INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES custom_lists(id),
  label   TEXT NOT NULL,
  label_en TEXT,
  sort    INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_custom_list_items_list ON custom_list_items(list_id);

CREATE TABLE custom_fields (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('task', 'ncr', 'meeting')),
  team         TEXT,                                    -- tasks only: NULL = every team
  label        TEXT NOT NULL,
  label_en     TEXT,
  type         TEXT NOT NULL CHECK (type IN ('text', 'longtext', 'number', 'date', 'yesno', 'list')),
  list_id      INTEGER REFERENCES custom_lists(id),     -- type 'list' only
  unit         TEXT,                                    -- shown after a number
  required     INTEGER NOT NULL DEFAULT 0,
  show_in_list INTEGER NOT NULL DEFAULT 1,              -- a column on the board / register
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_custom_fields_kind ON custom_fields(kind, active);

-- one row per record and field; an empty value is stored as '' (nothing is deleted)
CREATE TABLE custom_values (
  kind      TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  field_id  INTEGER NOT NULL REFERENCES custom_fields(id),
  value     TEXT NOT NULL,
  PRIMARY KEY (kind, record_id, field_id)
);
CREATE INDEX idx_custom_values_field ON custom_values(field_id, value);
