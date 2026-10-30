# First ERP modules: Quality, Maintenance, Technical (design, not built)

Owner's brief (2026-10-30). Three teams work from **meetings**: a Maintenance meeting, a Technical team meeting, and a joint **Non-conformity meeting** (a meeting can be one team or several). QC records non-conformities in an Excel register today; the meeting evaluates the top ones and **assigns tasks** to Maintenance, Technical and QC. Tasks have statuses (open, closed, …) and are handed to the workers of the team. One installation for the whole factory (a `site` field is kept so a second site is possible later); factory use only (company name and logo stay settings, so a rebrand is possible); no external integrations now, **mobile / QR access later**.

## Entities (all in the one SQLite file, own tables per module, nothing deleted)
- **People** (Database list): name, team (Quality / Maintenance / Technical / other), optional link to a user. Workers who never log in can still be assigned tasks.
- **Task** (shared by the three modules): number, title, description, **team** (Maintenance / Technical / Quality), priority (1 urgent … 4 low), status, assignees (one or more people), due date, machine or area (existing Machines list + free area), source (a non-conformity, a meeting, a measurement record, or manual), created by / when, closed by / when, **history** (every status change and comment: who, when), site.
  - Statuses: **Open → In progress → Waiting (parts / decision) → Done (worker says finished) → Closed (verified by the lead or requester)**; **Cancelled** (with reason). Reopening is allowed and recorded. Overdue is computed, not a status.
- **Meeting**: date, kind (Maintenance / Technical / Non-conformity; one or several teams), attendees (people), agenda lines (a non-conformity, an open task, or free text), **minutes** (notes per line), decisions that **create tasks on the spot** (team, assignee, due date). Prints as minutes + the task list that came out of it.
- **Non-conformity (NCR) register** — replaces the Excel: number, date, reported by (QC), source (measurement record, batch / drum, process, customer, supplier), product / design, machine or area, quantity, description, severity (minor / major / critical), immediate containment, **evaluation** (cause, decision: rework / scrap / use-as-is / return), linked tasks, status (**Reported → Under evaluation → Actions in progress → Closed**), meeting where it was evaluated. A non-conformity can be created straight from an out-of-limit measurement or a nonconforming batch (the existing data fills the fields). **Import** of the current Excel register (columns mapped once) so history is not lost. "Top non-conformities" view for the meeting: by count, by product / machine / cause, last 30 / 90 days.
- **Preventive maintenance** (second step): recurring tasks per machine (every N days / runtime), generated as normal tasks.

## Screens
- **Home / launcher:** tiles for the modules the user may open, with open-task counts (overdue in red).
- **Tasks board:** filter by team, person, status, machine, due; list view for tablets and a printable **work-order list per team / per worker / per day** (hand-off sheet); a task page with history and comments; quick buttons *Start*, *Waiting*, *Done*, *Close*.
- **Meetings:** agenda view during the meeting (add decisions → tasks in one line each), minutes, print.
- **Non-conformity register:** list with filters, entry form (touch-friendly, like the measurement form), evaluation form, "top non-conformities" for the meeting, Excel / CSV export and import.
- **Later:** a phone page per task / machine reachable by **QR code** (the code carries a plain address; the worker logs in or uses a short-lived link), photos of the defect.

## Permissions (per module and action)
Per user: access level for each module — *none / view / enter / lead* (lead can assign, close, cancel, evaluate). Quality staff enter non-conformities; Maintenance and Technical leads assign and close their team's tasks; workers update status and comments on tasks assigned to them; Administrator manages the matrix. Existing roles (Personal / Inginer / Administrator) keep their meaning for QC measuring.

## Build order (each step releasable, tests green, texts in Romanian and English)
1. **Platform step 1:** module registry and manifests, per-module migrations and permissions, launcher home; today's code moved into modules with no behaviour change.
2. **Tasks** (shared core of the three modules) with people, statuses, history, board and printable lists.
3. **Meetings** that create tasks and print minutes.
4. **Non-conformity register** with the Excel import, the evaluation form and the top-N view, links to measurements and batches.
5. **Preventive maintenance**, then dashboards (overdue, top causes, time to close).
6. Mobile / QR access.

## Open questions (answers go to `docs/INTREBARI.md`)
1. Do maintenance and technical workers log in themselves (PC, tablet, phone), or does a lead update their tasks from a printed list? (Decides roles and how much of step 2 must be touch- and phone-friendly first.)
2. Are the statuses above right, and who may close a task (the requester, the team lead, anyone in the team)?
3. **The current Excel non-conformity register**: please send the file (or its column headers and a few rows) so the fields and the import match it.
4. Priority and severity scales used today; any numbering format for tasks and non-conformities (e.g. NC-2026-001, MT-…)?
5. How often are the meetings, who attends, and what does the minutes sheet look like today?
6. Is preventive (recurring) maintenance wanted in the first release?
7. Areas / lines to list besides machines (workshops, utilities, buildings)?
