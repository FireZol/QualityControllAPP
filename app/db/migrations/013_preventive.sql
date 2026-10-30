-- Preventive maintenance: plans ("every N days / weeks / months") that make a task when it is time. Plans are edited or stopped, never deleted.
CREATE TABLE pm_plans (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  team TEXT NOT NULL DEFAULT 'maintenance' CHECK (team IN ('maintenance', 'technical', 'quality')),
  machine_id INTEGER REFERENCES machines(id),
  area TEXT,
  every_n INTEGER NOT NULL CHECK (every_n BETWEEN 1 AND 999),
  unit TEXT NOT NULL CHECK (unit IN ('days', 'weeks', 'months')),
  basis TEXT NOT NULL DEFAULT 'schedule' CHECK (basis IN ('schedule', 'completion')),  -- next date counted from the planned date, or from the day the work was done
  lead_days INTEGER NOT NULL DEFAULT 3 CHECK (lead_days BETWEEN 0 AND 365),           -- the task appears this many days before it is due
  priority_id INTEGER REFERENCES priorities(id),
  next_due TEXT NOT NULL,
  last_done TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE pm_plan_people (
  plan_id INTEGER NOT NULL REFERENCES pm_plans(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (plan_id, person_id)
);
CREATE TABLE pm_plan_steps (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES pm_plans(id),
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL
);
-- one row per due date of a plan: the task that was made, or that it was skipped on purpose
CREATE TABLE pm_runs (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES pm_plans(id),
  due_date TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id),
  outcome TEXT NOT NULL DEFAULT 'task' CHECK (outcome IN ('task', 'skipped')),
  skip_reason TEXT,
  advanced INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (plan_id, due_date)
);
CREATE INDEX pm_runs_task ON pm_runs(task_id);
