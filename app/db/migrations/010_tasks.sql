-- Tasks shared by Maintenance, Technical and Quality. Nothing is deleted: a task is closed or cancelled and keeps its history.
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  team TEXT NOT NULL CHECK (team IN ('maintenance', 'technical', 'quality')),
  title TEXT NOT NULL,
  description TEXT,
  priority_id INTEGER REFERENCES priorities(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting', 'done', 'closed', 'cancelled')),
  due_date TEXT,                                   -- YYYY-MM-DD
  machine_id INTEGER REFERENCES machines(id),
  area TEXT,
  site TEXT,
  source_kind TEXT,                                -- manual, meeting, ncr, measurement, preventive
  source_id INTEGER,
  external_ref TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id)
);
CREATE INDEX tasks_team_status ON tasks(team, status, due_date);
CREATE INDEX tasks_source ON tasks(source_kind, source_id);
CREATE INDEX tasks_machine ON tasks(machine_id);

CREATE TABLE task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (task_id, person_id)
);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),            -- NULL for the system (a plan generating a task)
  kind TEXT NOT NULL CHECK (kind IN ('created', 'status', 'comment', 'assign', 'edit')),
  from_status TEXT,
  to_status TEXT,
  text TEXT,
  details TEXT                                     -- JSON (what changed)
);
CREATE INDEX task_events_task ON task_events(task_id, id);
