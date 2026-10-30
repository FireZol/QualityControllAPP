-- Foundation for the team modules (Quality, Maintenance, Technical, Meetings): per-user module levels, in-application notifications,
-- numbering counters, people (workers who may never log in) and the priority scale.

CREATE TABLE user_modules (
  user_id INTEGER NOT NULL REFERENCES users(id),
  module TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('none', 'view', 'enter', 'lead')),
  PRIMARY KEY (user_id, module)
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- text comes from the dictionary of the reader's language
  params TEXT NOT NULL DEFAULT '{}',   -- JSON for the placeholders
  link TEXT,
  read_at TEXT,
  dedupe TEXT                          -- one notification per (user, dedupe), e.g. a reminder per meeting and day
);
CREATE INDEX notifications_user ON notifications(user_id, read_at, id);
CREATE UNIQUE INDEX notifications_dedupe ON notifications(user_id, dedupe) WHERE dedupe IS NOT NULL;

CREATE TABLE numbering_counters (
  rule TEXT NOT NULL,                  -- task, ncr, meeting
  scope TEXT NOT NULL,                 -- the part of the pattern that restarts the counter (year, month, team)
  last INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rule, scope)
);

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT 'other' CHECK (team IN ('quality', 'maintenance', 'technical', 'other')),
  user_id INTEGER REFERENCES users(id),   -- set when the person also logs in (then they get notifications)
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE priorities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO priorities(name, name_en, sort) VALUES ('Scăzută', 'Low', 10), ('Normală', 'Normal', 20), ('Ridicată', 'High', 30), ('Critică', 'Critical', 40);
