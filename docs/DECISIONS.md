# DECISIONS — ROMCAB CTC

Locked architecture and domain decisions. Change one only with a new ADR that supersedes it; never edit history.
Owner: Zoltan Biro (engineer, ROMCAB S.A.). Date locked: 2026-09-25.

---

## ADR-001 — Runtime: portable Node.js LTS, zero npm dependencies
**Decision.** The server is plain Node.js (current LTS, ≥ 22.13 so `node:sqlite` is available without a flag), using only built-in modules: `node:http`, `node:sqlite`, `node:crypto`, `node:fs`, `node:path`, `node:url`, `node:zlib`. No `package.json` dependencies, no build step, no bundler, no TypeScript compile.
**Why.** Factory server has no internet; IT policy dislikes unsigned executables and installers; updates must be "replace the `app\` folder, restart the service". Zero dependencies = nothing to download, nothing to audit, nothing to break.
**Consequences.** Hand-written router, static file server, multipart is not needed (no uploads in stage 1). Front-end libraries (chart library, fonts) are vendored as single files under `app/public/vendor/` with their licence files.

## ADR-002 — Database: SQLite via `node:sqlite`, one file
**Decision.** One database file `data/ctc.db`, WAL mode, `foreign_keys=ON`, `busy_timeout=5000`. Schema lives in numbered migration files `app/db/migrations/NNN_name.sql`, applied in order at start-up and recorded in `schema_migrations`. A backup is taken automatically before any pending migration runs.
**Why.** No external database server allowed. A handful of concurrent users on the LAN is well within SQLite limits.
**Consequences.** All writes go through short transactions. Backups use `VACUUM INTO` (consistent copy while running).

## ADR-003 — Front end: server-rendered pages + small vanilla JS
**Decision.** HTML pages rendered on the server with template-literal functions (escape every interpolated value through one `h()` helper), progressively enhanced with small vanilla JS modules for the measurement form (live limits and verdicts) and charts. No SPA framework.
**Why.** Simplest thing that works on old workfloor PCs and browsers; no build; easy for the owner to maintain.
**Consequences.** Every page works without JS except live verdict preview and charts; the server re-computes verdicts on save regardless of what the browser showed.

## ADR-004 — Language
**Decision.** All user-visible text is Romanian with correct diacritics (ș, ț with comma below — not ş/ţ). Code, identifiers, comments and commit messages are English. Number display uses the Romanian decimal comma in printed documents and the dot in input fields is accepted as well as the comma (normalise on input).
**Consequences.** Put every UI string in `app/i18n/ro.js` so wording can be reviewed in one place.

## ADR-005 — Nothing is ever deleted or overwritten
**Decision.** Measurements, revisions and list entries are never hard-deleted. A correction to a measurement inserts a new version row (`supersedes_id`, `edit_reason`, `is_current`); list entries are deactivated; revisions are archived.
**Why.** Quality records must be auditable (who, when, why).

## ADR-006 — Technical data sheets are versioned documents with a two-person rule
**Decision.** Specifications live in `spec_documents` → `spec_revisions` → `constructions` (+ `limits`, `process_params`). States: `ciorna` → `in_verificare` → `activa` → `arhivata` (and `in_verificare` → `ciorna` on rejection with a reason). Only one `activa` revision per document. The verifier must be a different Inginer from the author. Every measurement stores `revision_id` and a snapshot of the limits it was judged against.
**Consequences.** Diff between revisions is by `constructions.stable_key`; changed values print in red.

## ADR-007 — Verdicts
**Decision.** Each measured quantity gets one of `ok`, `sub` (below min), `peste` (above max), `nedeterminat` (no limit defined), `info` (informative, no verdict). Out-of-limit results are **flagged only** — never blocked, no mandatory decision in stage 1. Two diameter readings are each checked; the average and ovality (|d1 − d2|) are derived.
**Informative:** round strand diameters (RM / RMC, "f. Diam") are informative; sector strands (SM) have ±0.1 mm on H and W.

## ADR-008 — Resistance
**Decision.**
- Temperature correction per IEC 60228 Annex B, per material: `kt = 1 / (1 + α20·(t − 20))`, α20 Cu = 0.00393, Al = 0.00403 (editable constants). Warn outside 0–40 °C. This reproduces the factory's existing "Corecție temp." sheet exactly.
- Measured resistance is enabled only for copper for now (per-family switch).
- Theoretical resistance from mass for Cu and Al: `A = m/δ`, `d_ech = √(4A/π)`, `R20 = 1000·ρ20/A` Ω/km with ρ20 Cu ETP1 = 0.01707, Al H11 = 0.0275 Ω·mm²/m, δ Cu = 8.89, Al = 2.703 g/cm³ (editable).
- Verdict: Al → on theoretical R; Cu → on measured R (theoretical shown alongside, with its own verdict).
- Toron measured for a flexible conductor: `R_echiv = R20_toron / n_toroane` of the destination construction, compared with the finished conductor's IEC limit.
- Deviation shown as `(R20 − Rmax)/Rmax` in %.
- Limits come from IEC 60228:2023 Tab. 3/4/5 by class, material, coated/plain, section; resistance limits apply to finished conductors only.

## ADR-009 — IEC 60228:2023 reference data, not the document
**Decision.** Only the numeric limit values are stored (table `iec_limits`, seeded from `seed/iec60228_2023.json`), labelled "IEC 60228:2023, Tab. N". The standard's PDF is never stored or served (ASRO single-user licence).
**Exceptions.** A construction may carry `iec_exception_reason`; with it, IEC activation checks become warnings and the reason prints on the data sheet (first case: 35 SE Al class 1 vs Tab. 3 note a).

## ADR-010 — Shifts
**Decision.** Two 12-hour shifts (zi 06:00–18:00, noapte 18:00–06:00), three crews A/B/C on a 12-day cycle: 4 day, 2 off, 4 night, 2 off. Each crew has a configurable cycle start date. A timestamp maps to `(shift_date, shift, crew)`; times 00:00–05:59 belong to the night shift that started the previous calendar day.

## ADR-011 — Security on a trusted LAN (still done properly)
**Decision.** Passwords hashed with `crypto.scrypt` (per-user salt). Session cookie `HttpOnly; SameSite=Strict`, random 32-byte token, server-side session table, idle expiry (default 8 h, configurable). CSRF token on every POST form. Role checks on the server for every route. All SQL parameterised. All HTML output escaped. Rate-limit failed logins per username. First start creates an `admin` account with a one-time password printed to the console and forces a change on first login.

## ADR-012 — Backups
**Decision.** Settings page (Administrator): backup folder (local or UNC path), automatic on/off, daily time, number kept, "Backup acum", restore with confirmation (restore = stop accepting writes, copy chosen file over `ctc.db` after a safety backup of the current file, restart the DB connection). File name `ctc-YYYYMMDD-HHMMSS.db`.

## ADR-013 — Deployment
**Decision.** Folder layout `C:\ROMCAB-CTC\{node,app,data,backups}` + `start.bat` + `instalare-serviciu.bat`. Windows service via the built-in `sc.exe` is not suitable for a plain Node process, so the service script registers a Scheduled Task "At system start-up, run whether user is logged on or not, restart on failure" (`schtasks`) — no third-party service wrapper. Port, bind address and public name are Administrator settings stored in the DB (with `config.json` override for first start); changing port requires restart, which the UI states.

## ADR-014 — Numbers and units
**Decision.** Store SI-ish canonical units: mm, g/m (= kg/km), Ω/km, °C, m. Keep the precision entered; display wire Ø with 3 decimals, strand Ø with 1–2, mass g/m with 1–2 (wire kg/km with 2), R with 4 significant digits. Never round before computing a verdict.
