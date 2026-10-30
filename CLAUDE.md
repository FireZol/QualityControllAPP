# ROMCAB CTC — instructions for Claude Code

Quality-control measurement web app for the ROMCAB S.A. cable factory (Romania). QC staff record measurements of Cu/Al wires and conductors; engineers keep versioned technical data sheets; the app checks limits, keeps the full history, prints sheets and (optional modules) handles finished-cable tests, batch certificates and SPC analyses. One Windows server on the factory LAN, no internet at run time.

Owner: Zoltan Biro — process/quality engineer, domain expert (EN/IEC 60228, conductors). Ask him about domain questions; **do not guess limits or formulas**. Repository: `github.com/FireZol/QualityControllAPP` (branch `main`; GitHub reports the repo as moved to that spelling).

## State (2026-10-30)
**Version 0.9.0-beta.3 — ready for the pilot** (install package built with `node tools/make-release.js`). 160 automated tests. Built so far:
- **Core QC** (stages 1–3): accounts and roles (Personal / Inginer / Administrator), versioned data sheets with the two-person rule, measurements with live verdicts, corrections as new versions, register with filters, CSV / Excel export, printing in every browser, backups, audit log. Families: rigid conductor, extruded Al, wire class I–II, wire class V, flexible class 5.
- **Optional modules** (off by default, Administrator switches them in Setări → Module, ADR-016): finished cable (tests catalogue, batches, drums, certificates, type reports) and analyses (trend, capability, control charts, nonconformity, consumption, home-page SPC alerts).
- **Languages:** Romanian (master) and English, per user; Hungarian deferred (ADR-015).
- **Pilot kit:** first-setup checklist on the home page, `?` tips per screen, go-live reset, report-a-problem link, release package, security notes, load check, restore drill, factory-PC test checklist.
- **UI:** one-row menu, live verdict banners, compact register, paper-original check of every sheet row, row editor with save-and-next, larger-text mode (`A+`, default on touch screens), every control ≥ 44 px (audited).
- **Parked by the owner (do not build without asking):** global "Search everything" box; the "standard limits" second tier (ADR-020); Hungarian; non-conformity records, gauge import, drift prediction; screens still open in `docs/INTREBARI.md` (items 20–31).
- **Next:** the ERP-style module platform — foundation and Tasks are built, Meetings / Non-conformities / Preventive are next (see "Modular direction").

## Read before any work
1. `docs/DECISIONS.md` — locked decisions (ADR-001…021). Do not contradict them; propose a new ADR if one must change.
2. `docs/SPECIFICATIE.md` — functional spec (Romanian), the original source of truth for behaviour and wording.
3. `docs/DATA-MODEL.md` — SQLite schema, seed mapping, formulas.
4. `docs/INTREBARI.md` — open questions and the owner's answers (newest decisions are at the end).
5. `docs/ETAPA-1…4.md` — what each stage built; `docs/ADAPTARE.md` — what is editable and where; `docs/SECURITY.md`, `docs/GHID-CONFIGURARE.md`, `docs/TEST-PE-CALCULATOR.md`.

## Hard rules
- **Zero npm dependencies.** Node.js LTS built-ins only (`node:http`, `node:sqlite`, `node:crypto`, `node:zlib`, `node:test`, …). No build step, bundler, TypeScript or framework. A test fails if a dependency or an external script link appears. Runs on Node ≥ 22.13; Node 24 LTS is recommended and tested.
- **SQLite only** through `node:sqlite`, one file `data/ctc.db`, WAL, foreign keys on, **numbered migrations** (`app/db/migrations/NNN_*.sql`, an automatic backup precedes pending ones). The test migration in `app.test.js` must be renumbered whenever a real migration is added.
- **Two languages, one master.** Every UI text goes into `app/i18n/ro.js` (Romanian, correct diacritics ș ț with comma below) **and** `app/i18n/en/{a,b,c}.js` with the same keys and `{placeholders}`; `app/test/i18n.test.js` fails otherwise and fails on Romanian characters in the English files. Views use `T.section.key` (the language of the current request comes from AsyncLocalStorage, `app/i18n/index.js`). Code and comments in English. Stored data (sheet titles, machine names, test catalogue) stays as entered.
- **Numbers follow the language** (Romanian decimal comma, English dot) through `calc.formatNumber` / `calc.dec`; typing accepts both; CSV follows the language too.
- **Never delete or overwrite** measurements, revisions or referenced list entries — version, archive or deactivate (ADR-005). The only exception is the Administrator's one-time, backed-up, audited **Start production** reset (ADR-017).
- **Server is the authority:** recompute every derived value and verdict on save; enforce roles on every route; parameterised SQL only; escape all HTML output (`html` template tag); CSRF token on every POST; CSP forbids inline script and style.
- **Formulas live in one pure module** (`app/domain/calc.js`, shared with the browser as `/static/calc.js`) and are unit-tested. Never round before computing a verdict.
- **Out-of-limit results are flagged, never blocked** (ADR-007). Resistance: lower is better, no lower limit; every reference point is at 20 °C.
- **No external requests** at run time: no CDNs, fonts or telemetry.
- Seed data in `seed/` was transcribed from scans: a **draft** to be verified by engineers in the app (there is a row-by-row check against the paper). Never "correct" values in code. Only IEC 60228 **limit values** are stored, never the standard's text.
- Targets and thresholds are **editable data**, not constants (Date de bază → Ținte și praguri); do not hard-code a limit, tolerance or threshold.

## UI rules (owner: "the UX has to be super level")
- Happy path with zero friction: remember the last product, Enter moves to the next field, Ctrl+Enter saves, one big verdict banner (green / red with what is out).
- Every failure says what is wrong and what to do; every empty screen offers its next step; each screen has its `?` tips (`help.*` in the dictionaries); change them with the screen.
- Touch first: every control ≥ 44 × 44 px (`node tools/touch-audit.js` must report none); never rely on hover; colour is never the only signal.
- Changing a label, flow or key means changing the tips, the guides in `docs/` and both dictionaries in the same step.

## Run, test, release
```
node app/server.js                        # dev; uses ./data and ./config.json (copy config.example.json)
npm test                                  # = node --test "app/test/*.test.js"  (Node 22 needs the glob)
node tools/walkthrough.js <dir>           # Playwright browser walk-through with screenshots (dev only, Playwright from `npm root -g`)
node tools/touch-audit.js [dir]           # controls under 44 px on the main screens (dev only)
node tools/load-check.js [N]              # N measurements (default 50 000) and page timings
node tools/export-texts.js [file.xlsx]    # wording review sheet, Romanian and English side by side
node tools/make-release.js [--with-node <node-win-x64.zip>]   # dist/ROMCAB-CTC-<version>.zip (+ .sha256)
```
Target: Windows with a portable Node in `node\` (`start.bat`; the scheduled task runs `run-server.bat`). Develop so paths work on Windows and Linux. The Windows scripts and Firefox / Edge printing could not be tried in the dev environment — see `docs/TEST-PE-CALCULATOR.md`.

## Code map
`app/app.js` (request pipeline: static files, session, language, modules gate, roles, CSRF) · `app/routes/*` (one file per area) · `app/views/*` (server-rendered pages; `layout.js` is the shell) · `app/domain/*` (rules and queries; `modules.js` = optional modules, `setup.js` = first-setup checklist, `verification.js` = paper check, `golive.js` = production reset) · `app/lib/*` (http, auth, backup, export, svg, config) · `app/i18n/*` · `app/public/*` (css, small vanilla JS, `calc.js` is served from the domain) · `app/test/*` · `tools/*` · `seed/*`.

## Working style
- One step at a time, small commits with clear messages, tests green before every push; update `docs/` when behaviour changes.
- When a requirement is ambiguous, write the question in `docs/INTREBARI.md` and continue with the most conservative option, noting it there. The owner answers in short messages ("1 yes, 2 …"): record each answer as a numbered item.
- Verify UI changes in a real browser (screenshots at laptop, tablet and phone widths); the dev environment has headless Chromium only.
- Lessons: a CSV/Excel file or page that lists "all rows" must not pass thousands of `?` to SQLite (chunk); sticky elements inside an `overflow` container do not stick to the page; `pkill -f` in a shell command kills that shell if its own text matches; a working copy can vanish between sessions — everything lives on GitHub.

## Modular direction (owner approved 2026-10-30; in progress)
The app is becoming a **modular factory ERP**: Quality (non-conformities), Maintenance, Technical, Meetings, next to the QC core. Design and the owner's decisions: `docs/MODULE-PLATFORM.md`, `docs/MODULE-QUALITATE-MENTENANTA-TEHNIC.md`, `docs/INTREBARI.md` items 32–33. Rules: a new module = a row in `app/modules/registry.js` + routes/views/domain + texts RO/EN + tests; modules are OFF by default (Setări → Module); per-user level none < view < enter < lead (`app/domain/access.js`; Technical open to all); admin = lead everywhere.
**Built:** (1) foundation (commit `81180bb`): registry, access levels, in-app notifications with the bell (`app/domain/notifications.js`, `/notificari`), numbering patterns (`app/domain/numbering.js`), `people` and `priorities` lists, team settings. (2) **Tasks** for Maintenance `/mentenanta`, Technical `/tehnic`, Quality `/calitate/sarcini`: board with status tiles (filters) and tabs Active/Closed/All, statuses open → in progress → waiting → done → closed (+ cancelled; reason needed to cancel/reopen), full history (`task_events`), assignment to people (with or without a login), notifications, printable work list (`/sarcini/tipar`), no delete. Code: `app/domain/tasks.js`, `app/routes/tasks.js`, `app/views/tasks.js`, migration `010_tasks.sql`, tests `app/test/tasks.test.js`. Working options (owner 2026-10-30, "think as a pro"): quick filter chips (Mine = assigned to the user's `people` row, Unassigned, Due in 7 days, Created by me), sort (priority / due / newest / last changed) and group (status / person / priority), bulk changes (status, add person, priority, due date; JS bar `app/public/tasks.js`; cancelling/reopening skipped because they need a reason), CSV / Excel export of the filtered list, checklist per task (migration `011_task_checklist.sql`, ticks and changes in the history), plan card (priority, due date, postpone +1 day / week / month), copy as new task (steps copied unticked), single-task work order print (`/sarcini/:id/tipar`), help tips `help.tasks`. Tests `app/test/tasks-pro.test.js`. Screen check: `node tools/tasks-audit.js [dir]`.
**Not built yet (in this order):** Meetings `/sedinte` (one-off + recurring series, attendees, agenda, decisions → tasks, notifications with when and who; defaults: Technical and Maintenance daily on weekdays, Quality weekly, combined meetings allowed); Non-conformity register `/calitate` (new register, `NC-{yyyy}-{seq:3}`, evaluation, linked tasks, top view, `external_ref` + later Excel import); Preventive maintenance `/mentenanta/preventiv` (editable plans per machine generating tasks; note `tasks.created_by` is NOT NULL, so a generator needs a creating user). The module switcher and the Maintenance menu already link to these pages, so they 404 until built (modules are off by default).
**Look (owner's HomeCloud example, 2026-10-30, background ignored):** left sidebar (`sidebar()` in `app/views/layout.js`: Home, then one folding section per module the user may open, Administration last), slim top bar with page title, theme ◐ (light / dark, `ctc_theme` in localStorage, set before paint by `prefs.js`; print pages never load it), A+, bell, language, help, account with avatar; ≤1000 px the sidebar is a drawer (☰). Home (`app/views/home.js`, `app/routes/home.js`): greeting + shift, **Needs your attention** list (out-of-limit, SPC, overdue tasks, my tasks, unread, setup) each with one button, quick actions, stat tiles (links), then today / SPC / out-of-limit and a side panel (shift, my tasks, recent notifications). Plain HTTP on the LAN is accepted by the owner (item 34). Tool: `node tools/ui-shots.js <dir> [paths]` (light + dark at three widths).
**Owner's UI requirement:** very user-friendly and easy to oversee (tiles/at-a-glance counts, big verdicts, touch-first, `?` tips); check every new screen with the touch audit at laptop/tablet/phone width.
