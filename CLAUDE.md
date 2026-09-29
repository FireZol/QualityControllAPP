# ROMCAB CTC — instructions for Claude Code

Quality-control measurement web app for the ROMCAB S.A. cable factory (Romania). QC staff record measurements of Cu/Al wires and conductors; engineers maintain versioned technical data sheets; the app checks limits, keeps full history and later produces charts and the printed A6 annexes. Runs on one Windows server on the factory LAN, no internet.

Owner: Zoltan Biro — process/quality engineer, domain expert (EN/IEC 60228, conductors). Ask him about domain questions; do not guess limits or formulas.

## Read before any work
1. `docs/DECISIONS.md` — locked decisions (ADR-001…014). Do not contradict them; propose a new ADR if one must change.
2. `docs/SPECIFICATIE.md` — functional spec (Romanian). The source of truth for behaviour and wording.
3. `docs/DATA-MODEL.md` — SQLite schema, seed mapping, formulas.
4. The current stage brief: `docs/ETAPA-1.md`.

## Hard rules
- **Zero npm dependencies.** Node.js LTS built-ins only (`node:http`, `node:sqlite`, `node:crypto`, `node:test`, …). No build step, no bundler, no TypeScript compile, no framework. Vendored front-end files live in `app/public/vendor/` with their licence.
- **SQLite only**, through `node:sqlite`, one file `data/ctc.db`, WAL, foreign keys on, numbered migrations.
- **UI 100 % Romanian** with correct diacritics (ș ț with comma below). All strings in `app/i18n/ro.js`. Code and comments in English.
- **Never delete or overwrite** measurements, revisions or referenced list entries — version, archive or deactivate (ADR-005).
- **Server is the authority:** recompute every derived value and verdict on save; enforce roles on every route; parameterised SQL only; escape all HTML output; CSRF token on every POST.
- **Formulas live in one pure module** (`app/domain/calc.js`) and are unit-tested with the numbers in `docs/ETAPA-1.md`. Never round before computing a verdict.
- **Out-of-limit results are flagged, never blocked** (ADR-007).
- **No external requests** at runtime: no CDNs, no Google Fonts, no telemetry.
- Seed data in `seed/` was transcribed from scanned documents. Treat it as a **draft** to be verified by engineers in the app; never silently "correct" values in code. Known suspicious values: `seed/verificare_seed.json`.
- Only the IEC 60228 **limit values** may be stored — never the standard's text or PDF (licence).

## Run and test
```
node app/server.js                 # dev, uses ./data and ./config.json (copy config.example.json)
node --test app/test               # unit + integration tests
```
Target: Windows with a portable Node in `node\` (`start.bat`). Develop so paths work on both Windows and Linux (`path.join`, no hard-coded separators). Use Playwright (already available in the dev environment) for browser walk-throughs.

## Working style
- One stage at a time; finish its "Done means" list before starting the next.
- Small commits with clear messages. Keep `docs/` updated when behaviour changes (spec wording stays Romanian).
- When a requirement is ambiguous, write the question in `docs/INTREBARI.md` and continue with the most conservative option, noting it there.
