# ETAPA 4 — Finished low-voltage cable, batches, certificates, SPC (built)

Owner input (2026-09-29): standards **IEC 60502-1, HD 603, VDE 0276-603**; **batch certificates** are issued; **type tests and batch tests** are both done; XLPE and HFFR (LSZH) are made, with some tests not yet possible in-house — everything is filled in by the engineers in the app, so the app carries the whole structure and no limit values.

## Data model (migration 005)
- `test_types` — editable catalogue of finished-cable tests: code, name, kind (`numeric`, `readings`, `passfail`, `resistance`), unit, decimals, scope (`routine` = per drum, `sample` = per batch, `type`), standard reference, `applies_to` compounds (PVC, XLPE, HFFR, EPR, PE …; empty = all), `in_house` (0 = external laboratory), active, sort. About 40 tests are proposed (routine, sample, type; PVC, XLPE/EPR and HFFR specifics); **no limits and no standard clause numbers are seeded**.
- `compounds`, `cable_standards` — editable lists.
- `batches` (lot, order, client, cable design + the sheet revision it was made under, standard, length, date, open/closed) and `drums`.
- `batch_certificates` — frozen JSON snapshot, number `CERT-YYYY-NNNN`, `supersedes_id`.
- `measurements.batch_id`, `drum_id`; results may carry the verdict `neconform` (pass/fail tests).
- `limits` accepts any test quantity; `measurement_inputs` keys are free.

## Finished-cable data sheet (`CABLU_LV`, family `CABLE_LV`)
Same revision workflow and two-person rule as every other sheet. Each **cable design** carries: designation, conductor material / section / shape / class, cores, rated voltage, insulation and sheath compound, standard, armour, the list of **required tests**, and the **limits per test result** (for thickness readings: average, minimum, maximum; resistance: own R max or IEC 60228 by conductor class). Printed as a sheet per design; changes against the previous revision in red.

## Measuring
- **Batch tests** (`Măsurătoare nouă` → family "Cablu de joasă tensiune" → Lot → Toba → Utilaj): the form lists the tests that apply to the design (by session: routine + sample; by compound), the required ones first, the rest under "Alte încercări". Readings are typed separated by spaces (`1,05 1,10 0,95`). Resistance is corrected to 20 °C with the IEC formula; the requirement is the sheet's own R max or IEC 60228 (lower is better, green up to the limit). Pass/fail tests give `Conform` / `neconform`.
- **Type tests**: without a batch, on a cable design (type-test scope only); results are attached to the design across revisions and printed as a **Raport de încercări de tip**.
- Live green/red preview, corrections as new versions, register / export / analyses work for cable records as for everything else.

## Batches and certificates
- Anyone can create a batch and drums, add tests, close the batch; only an Inginer reopens it or issues a certificate.
- The batch page shows the **coverage** (required routine tests on every drum, required sample tests once per batch) and the out-of-requirement results.
- **Certificate** (printable A4, numbered pages, elaborated by / signature / copy): preview before issue; a non-conforming batch is issued only with a written reason that prints on the certificate; the content is a frozen snapshot, a corrected batch gets a new certificate that supersedes the old one (the old one shows "înlocuit de …"). Values without a requirement on the sheet stay in the records but are not printed.

## SPC control charts (`Analize → Carte de control`)
Individuals + moving-range chart: centre line, limits at ±3σ with σ = MR̄ / 1.128 from the process (optionally from the first N values as a stable reference), the specification limits dotted, points flagged with the number of the violated rule: (1) beyond 3σ, (2) 2 of 3 beyond 2σ, (3) 4 of 5 beyond 1σ, (4) 8 on one side of the centre line, (5) 6 rising / falling. The **home page** lists products whose latest values break a rule while still inside tolerance (limits computed from the values before the recent ones). Thresholds (minimum values, window, how many latest values count) are targets in *Ținte și praguri*.

## Verify
`npm test` (100 tests), `node tools/cable-walkthrough.js <dir>` (screenshots of the cable flow).
