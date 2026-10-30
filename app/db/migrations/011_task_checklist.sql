-- Checklist steps of a task (what to check or do, ticked off by whoever does it). Changes are also written to the task history.
CREATE TABLE task_checklist (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER REFERENCES users(id),
  done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_checklist_task ON task_checklist(task_id);
