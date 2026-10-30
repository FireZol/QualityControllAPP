-- Meetings: recurring series (daily on weekdays, weekly, fortnightly ...) that produce dated meetings, one-off meetings, invitees,
-- attendance, agenda, minutes, and decisions that become tasks. Meetings are cancelled, never deleted; series are deactivated, never deleted.
CREATE TABLE meeting_series (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  teams TEXT NOT NULL,                       -- comma list of maintenance | technical | quality (a combined meeting has several)
  days TEXT NOT NULL,                        -- ISO weekdays 1 (Mon) .. 7 (Sun), comma list
  interval_weeks INTEGER NOT NULL DEFAULT 1 CHECK (interval_weeks BETWEEN 1 AND 12),
  start_time TEXT NOT NULL,                  -- HH:MM
  duration_min INTEGER NOT NULL DEFAULT 30,
  location TEXT,
  starts_on TEXT,                            -- first day it applies (NULL = from the day it was made)
  ends_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE meeting_series_people (
  series_id INTEGER NOT NULL REFERENCES meeting_series(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (series_id, person_id)
);
CREATE TABLE meetings (
  id INTEGER PRIMARY KEY,
  series_id INTEGER REFERENCES meeting_series(id),
  slot_date TEXT,                            -- the day the series made it for (moving the meeting does not make a second one)
  title TEXT NOT NULL,
  teams TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'held', 'cancelled')),
  agenda TEXT,
  minutes TEXT,
  cancel_reason TEXT,
  reminded_on TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX meetings_slot ON meetings(series_id, slot_date) WHERE series_id IS NOT NULL;
CREATE INDEX meetings_date ON meetings(meeting_date);
CREATE TABLE meeting_attendees (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  present INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, person_id)
);
CREATE TABLE meeting_decisions (
  id INTEGER PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  text TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX meeting_decisions_meeting ON meeting_decisions(meeting_id);

-- Starting schedule from the owner's answer (2026-10-30): Technical and Maintenance daily on weekdays, Quality weekly. The times are a first guess; edit them in Ședințe → Programări.
INSERT INTO meeting_series(title, teams, days, interval_weeks, start_time, duration_min, location, active, created_at) VALUES
  ('Ședință zilnică Tehnic', 'technical', '1,2,3,4,5', 1, '08:00', 15, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('Ședință zilnică Mentenanță', 'maintenance', '1,2,3,4,5', 1, '08:15', 15, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('Ședință săptămânală Calitate', 'quality', '1', 1, '09:00', 45, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
