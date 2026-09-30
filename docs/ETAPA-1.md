# ETAPA 1 — Bază + funii rigide + conductor extrudat Al

Goal: the lab and workfloor QC stop using the Excel tabs AL-FUNIE, CU-FUNIE and AL-SARMA-RE-SE. Everything in this stage must be production-usable on its own.

Read first: `CLAUDE.md`, `docs/SPECIFICATIE.md` (Romanian, functional truth), `docs/DECISIONS.md` (locked), `docs/DATA-MODEL.md` (schema + formulas).

## Scope

In: accounts and roles · all lists (Date de bază) · technical data sheets with revisions and the two-person rule for families FUNIE_RIGIDA and EXTRUDAT_AL · measurement entry for those two families · measurement register with version history and corrections · home page · settings · backup/restore · audit log · first-start seeding · Windows start-up scripts.

Out (later stages): drawn-wire and class 5 measurement screens, printing of A6 annexes, trend/Cp/Cpk charts, CSV/Excel export. **Seed their data now anyway** (ADR / DATA-MODEL seed table) so stage 2–3 are screens only.

## Suggested project layout

```
app/
  server.js              entry: config, DB open + migrate + seed, HTTP server
  lib/                   router.js, http.js (body, cookies), auth.js, csrf.js, html.js (h() escape + layout), time.js (shifts), backup.js
  domain/                calc.js (all formulas, pure), verdict.js, revisions.js, measurements.js, lists.js
  db/                    db.js, migrations/001_initial.sql, seed.js
  views/                 one file per page, returns HTML strings
  public/                app.css, measure.js (live preview), vendor/ (chart lib + licence, fonts)
  i18n/ro.js             every UI string
  test/                  node:test files — run with `node --test app/test`
seed/                    JSON seed files (already provided)
start.bat, instalare-serviciu.bat, dezinstalare-serviciu.bat, config.example.json
```

## Screens (Romanian titles)

| Screen | Route | Roles | Must do |
| --- | --- | --- | --- |
| Autentificare | `/login` | all | username + password; lockout 5 failed tries / 15 min per username; forced password change when `must_change_password` |
| Acasă | `/` | all | today's measurements (current shift first), out-of-limit results of the last 24 h, quick button "Măsurătoare nouă" |
| Măsurătoare nouă | `/masuratori/nou` | all (Personal = CTC) | family → machine (filtered by machine type ↔ family, and by strander capacity) → construction (from the **active** revision only) → operator, client, sample type (length no. proposed) → inputs shown per family `measures` → live limits and green/red per value → save. Large inputs, keyboard-only usable (Tab/Enter), comma or dot decimals. Server recomputes everything on save. |
| Registru | `/masuratori` | all | filterable table like the Excel sheet (date, shift, crew, family, product, machine, operator, client, sample type, each value with colour, notes); paging; newest first |
| Detaliu / istoric | `/masuratori/:record_no` | all | all versions, who/when/why; limits snapshot; "Corectează" creates version n+1 with mandatory reason (Personal: only own records, same shift; Inginer/Admin: any) |
| Fișe tehnice | `/fise` | all read; Inginer write | documents list with active revision; revision list with status; construction table like the paper sheet; values changed vs previous revision in red |
| Editor revizie | `/fise/:doc/revizii/:id` | Inginer | only in `ciorna`: add/edit/deactivate constructions, limits, process params; "Revizie nouă" copies the active one; "Trimite la verificare"; IEC checks listed (blocking unless `iec_exception_reason`) |
| Verificare revizie | same | Inginer ≠ author | "Verifică și activează" (archives previous active) or "Respinge" with reason |
| Date de bază | `/liste/*` | Inginer, Admin | machine types (+ allowed families), machines (+ rotor config), operators, clients, sample types, crews (cycle start), shapes, destinations; add / rename / deactivate — no delete if referenced |
| Constante material | `/liste/materiale` | Inginer | ρ20, density, α20 per material; change is audited |
| Utilizatori | `/admin/utilizatori` | Administrator | create, role, reset password (sets `must_change_password`), deactivate |
| Setări | `/admin/setari` | Administrator | port, bind address, public name (restart notice), session idle hours, backup dir/auto/time/keep, "Backup acum", restore list with confirmation |
| Jurnal | `/admin/jurnal` | Administrator | audit log, filter by user/action/date |

## Seed lists (first start)

- Families: SARMA_CL12 "Sârmă trefilată clasa I–II", SARMA_CL5 "Sârmă trefilată multifilar clasa V", FUNIE_RIGIDA "Funie rigidă clasa 2", EXTRUDAT_AL "Conductor extrudat Al clasa 1", FLEXIBIL_CL5 "Conductor flexibil clasa 5". Only FUNIE_RIGIDA and EXTRUDAT_AL active for measurement in stage 1.
- measures: FUNIE_RIGIDA `{"diam":"auto","mass":true,"resistance_measured":["Cu"],"resistance_theoretical":true}` (auto = 2 readings for RM/RMC, H × L for SM); EXTRUDAT_AL `{"diam":"auto","mass":true,"resistance_measured":[],"resistance_theoretical":true}` (RE → 2 readings, SE → H × L).
- Machine types: Trefilare, Trefilare multifilară, Cablare rigidă, Sector / extrudare, Cablare flexibil.
- Machines (editable later): RIGID 1, RIGID 2 (Cablare rigidă, configs to be set by the engineer), KABMAK 1, KABMAK 2 (Cablare flexibil), LITARE 1–4 (Cablare flexibil). Leave rotor configs empty where unknown; the UI must handle that (no capacity filter).
- Shapes: RE, RM, RMC, SM, SM72 "SM 72°", SM90 "SM 90°", SM120 "SM 120°", SMD "SM drept", SE.
- Destinations: Unifilar, Multifilar, Armate, Purtător, EVN.
- Sample types: Probă de pornire, Lungime (numbered), După reglaj.
- Crews A, B, C with cycle starts 4 days apart (A = d, B = d + 4, C = d + 8); Admin sets d.
- Clients: SBT, TUB, VOLT, ESI, Iemar. Operators: none (entered by users).
- One `administrator` user `admin`, random one-time password printed to the console.

## Acceptance tests (automated where possible — `node --test`)

Formulas and verdicts (use exactly these numbers):

| # | Case | Input | Expected |
| --- | --- | --- | --- |
| 1 | Mass per metre | 608.5 g on 1000 mm | 608.5 g/m |
| 2 | Al 240 SM 90° mass OK | 608.5 g/m, limits 607.0–609.4 | `ok` |
| 3 | Al 240 SM 90° above max | 620.5 g/m | `peste`, red |
| 4 | Al 240 SM 90° below min | 606.9 g/m | `sub`, red |
| 5 | Sector H × L | H 17.75, L 22.55 vs 17.7 × 22.6 ±0.1 | both `ok` |
| 6 | RMC Ø informative | Al 240 RMC d1 18.55, d2 18.70 | d_avg 18.625, ovality 0.15, verdict `info` |
| 7 | Theoretical R Al | 608.5 g/m | A = 225.12 mm², R20_teor = 0.12216 Ω/km vs 0.125 → `ok` |
| 8 | Theoretical R Cu | 240 RMC Cu 2057.3 g/m | 0.07376 Ω/km vs 0.0754 → `ok` |
| 9 | Temperature correction Cu | 4.93 Ω/km at 24.4 °C | kt 0.9830019, R20 4.8462 |
| 10 | Temperature correction Cu | 3.354 Ω/km at 22.5 °C | kt 0.9902706, R20 3.32137 |
| 11 | Temperature correction Al | 40 °C | kt 0.9254 (4 dp) |
| 12 | Out of range temp | 43 °C | value computed + warning shown |
| 13 | Toron → liță (stage 3 function, test now) | toron R 13.734 Ω/km at 26.5 °C, destination 10 mm² cl.5 (7 toroane), limit 1.91 | R20_echiv 1.9131, deviation +0.16 %, `peste` |
| 14 | Extruded 35 SE | 91.0 g/m, H/L entered 6.1 / 9.0 | mass `ok`; H and L `nedeterminat`; R20_teor 0.8168 vs Tab. 3 Al 35 = 0.868 → `ok` |
| 15 | Shift mapping | 2026-09-26 03:10 | shift_date 2026-09-25, `noapte` |
| 16 | Shift mapping | 2026-09-26 06:00 | shift_date 2026-09-26, `zi` |
| 17 | Crew rotation | cycle starts A 2026-09-01, B 09-05, C 09-09 | every day has exactly one crew on `zi` and one on `noapte` for 60 consecutive days |
| 18 | Decimal comma | "608,5" | parsed 608.5 |

Behaviour:

19. A Personal user cannot open revision editor, lists, users or settings (HTTP 403 and no links shown).
20. The author of a revision cannot verify it (button absent **and** server refuses).
21. Activating revision N archives N−1; measurements saved before keep `revision_id` of N−1 and their limits snapshot.
22. A correction creates version 2; version 1 remains readable; register shows only current versions by default with a "versiuni" badge.
23. A construction with 7 wires marked RM Al 50 mm² (circular requires 19) blocks submission for verification unless `iec_exception_reason` is filled; RMC (compacted, min 6) passes.
24. Seeding is idempotent: second start with a non-empty DB seeds nothing.
25. Migration: adding `002_*.sql` and restarting takes a backup first, then applies it, recorded in `schema_migrations`.
26. Backup while a measurement is being saved produces a valid DB (open it and count rows).
27. Restore requires typing the file name to confirm, takes a safety backup of the current DB first.
28. Every page renders with correct Romanian diacritics (ș ț with comma below) and no untranslated English strings.
29. XSS: an operator named `<script>alert(1)</script>` renders as text everywhere.
30. CSRF: a POST without the form token is refused.

## Done means

- `node --test app/test` all green; the numeric cases above are unit tests on `domain/calc.js`.
- Walk-through in a real browser (Playwright is available in the dev environment): login as admin → create an Inginer A, an Inginer B, a CTC user → A edits the seeded FUNIE_RIGIDA Al draft, submits → B activates → CTC records cases 2, 3, 5, 7 → register shows them correctly coloured → CTC corrects one → history shows both versions → admin runs "Backup acum" and sees the file.
- `start.bat` works from a clean copy of the folder on Windows with only the portable `node\` present; `instalare-serviciu.bat` registers the start-up task.
- Short `README-INSTALARE.md` in Romanian for IT: copy folder, first start, where the admin password appears, how to set port/name, how to update, how to back up.

## Data-quality items to show the engineers (from `seed/verificare_seed.json`)

Seeded drafts contain values that looked inconsistent while transcribing; show them on the draft revision as warnings, do not "fix" them in code. Highest priority:
- A6 Cu, Unifilar 16RM: Ø max 1.666 with nominal 1.643 (likely 1.649); mass 19.26–19.40 corresponds to Ø ≈ 1.66, not 1.643.
- A6 Cu, Multifilar 10RM: mass 12.27–12.38 kg/km corresponds to Ø ≈ 1.329, not 1.31.
- A6 Al, 10 RM: mass 26.93–27.17 is the 7-wire conductor mass, not the single wire (3.87 kg/km).
- Class V 25 mm²: wire Ø 0.413 mm (die 4 × 0.412 + 4 × 0.420) exceeds IEC 60228 Tab. 5 maximum 0.41 mm.
- Stranding Al 50 RM: 7 wires — conforms only as compacted (Tab. 4 circular Al 50 needs 19).
- Stranding Al 300 SM 120°: wire 3.15 vs A6 3.13 for the same product.
