-- 1) Non-conformity workflow (owner 2026-10-30: "elaborate more"): immediate action, corrective and preventive action, who is responsible and by when,
--    and a check that the action worked (effectiveness verification).
ALTER TABLE ncrs ADD COLUMN containment TEXT;
ALTER TABLE ncrs ADD COLUMN corrective_action TEXT;
ALTER TABLE ncrs ADD COLUMN preventive_action TEXT;
ALTER TABLE ncrs ADD COLUMN responsible_person_id INTEGER REFERENCES people(id);
ALTER TABLE ncrs ADD COLUMN action_due TEXT;
ALTER TABLE ncrs ADD COLUMN verified_at TEXT;
ALTER TABLE ncrs ADD COLUMN verified_by INTEGER REFERENCES users(id);
ALTER TABLE ncrs ADD COLUMN verification_note TEXT;

-- 2) Preventive plans: "daily" can skip Saturday and Sunday.
ALTER TABLE pm_plans ADD COLUMN weekdays_only INTEGER NOT NULL DEFAULT 0;

-- 3) Meeting schedule (owner 2026-10-30): Technical with Maintenance at 08:30, a recap at 17:00 (or the catch-up if the morning one was missed),
--    Quality about 15:00 twice a week (Monday and Wednesday). Only the starting rows made by migration 012, and only while nobody edited them;
--    their not-yet-held, untouched meetings are made again from the new schedule.
DELETE FROM meeting_attendees WHERE meeting_id IN (
  SELECT m.id FROM meetings m WHERE m.status = 'planned' AND m.meeting_date >= date('now', 'localtime') AND m.agenda IS NULL AND m.minutes IS NULL
    AND NOT EXISTS (SELECT 1 FROM meeting_decisions d WHERE d.meeting_id = m.id)
    AND m.series_id IN (SELECT id FROM meeting_series WHERE (id = 1 AND title = 'Ședință zilnică Tehnic' AND start_time = '08:00') OR (id = 2 AND title = 'Ședință zilnică Mentenanță' AND start_time = '08:15') OR (id = 3 AND title = 'Ședință săptămânală Calitate' AND start_time = '09:00')));
DELETE FROM meetings WHERE status = 'planned' AND meeting_date >= date('now', 'localtime') AND agenda IS NULL AND minutes IS NULL
  AND NOT EXISTS (SELECT 1 FROM meeting_decisions d WHERE d.meeting_id = meetings.id)
  AND series_id IN (SELECT id FROM meeting_series WHERE (id = 1 AND title = 'Ședință zilnică Tehnic' AND start_time = '08:00') OR (id = 2 AND title = 'Ședință zilnică Mentenanță' AND start_time = '08:15') OR (id = 3 AND title = 'Ședință săptămânală Calitate' AND start_time = '09:00'));
UPDATE meeting_series SET title = 'Ședință zilnică Tehnic și Mentenanță', teams = 'maintenance,technical', start_time = '08:30', duration_min = 30 WHERE id = 1 AND title = 'Ședință zilnică Tehnic' AND start_time = '08:00';
UPDATE meeting_series SET title = 'Recapitulare Tehnic și Mentenanță (17:00)', teams = 'maintenance,technical', start_time = '17:00', duration_min = 15 WHERE id = 2 AND title = 'Ședință zilnică Mentenanță' AND start_time = '08:15';
UPDATE meeting_series SET title = 'Ședință Calitate', days = '1,3', start_time = '15:00', duration_min = 45 WHERE id = 3 AND title = 'Ședință săptămânală Calitate' AND start_time = '09:00';
