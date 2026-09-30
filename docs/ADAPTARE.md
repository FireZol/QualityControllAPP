# Adapting the app (what is editable, and where)

Design rule: nothing that engineers may want to change is hard-coded. Everything below is edited in the app, audited (who / when / before / after) and applies to **new** measurements and checks; saved measurements keep the limits they were judged against.

| What | Where in the app | Who |
| --- | --- | --- |
| Product limits: Ø, Î × L, mass (min / max / tolerance), **R max at 20 °C** per construction, stranding parameters | Fișe tehnice → revision editor (two-person rule) | Inginer |
| IEC 60228 reference values: R max at 20 °C, minimum wires, max wire Ø (add rows, edit values) | Date de bază → Tabel IEC 60228 | Inginer |
| Material constants ρ20, density, α20 (with a check of the formula against IEC Tab. A.1) | Date de bază → Constante material | Inginer |
| What each product family measures: mass, measured R for Cu / Al, theoretical R, active for measurement | Date de bază → Familii de produs | Inginer |
| Sample-length defaults, temperature range, Cpk colours, minimum n, mass-vs-wires band, SPC minimum values / window / alert horizon | Date de bază → Ținte și praguri | Inginer |
| Finished-cable tests: catalogue (name, unit, category routine / sample / type, compounds it applies to, internal or external lab, standard reference) | Date de bază → Tipuri de încercări | Inginer |
| Cable design: required tests, limits per test result, compounds, standard, voltage, conductor class | Fișe tehnice → Cablu de joasă tensiune (two-person rule) | Inginer |
| Compounds (PVC, XLPE, HFFR …) and cable standards (IEC 60502-1, HD 603, VDE 0276-603 …) | Date de bază | Inginer, Administrator |
| Machines, machine types (and allowed families), operators, clients, sample types, shapes, destinations, crews and cycle start | Date de bază | Inginer, Administrator |
| Shift start times, backup, port, sessions | Setări | Administrator |

## Rules that hold everywhere
- **20 °C is the reference.** All limits and reference values are at 20 °C. A resistance measured at t °C is brought to 20 °C with the IEC 60228 Annex B formula `kt = 1 / (1 + α20·(t − 20))`; theoretical resistance is computed directly at 20 °C (`R20 = 1000·ρ20 / A`). The formula reproduces IEC Table A.1 (all 41 values, tested).
- **Resistance: lower is better.** At or below the target → green, above → red; there is no lower limit. The rule is the same however the value was obtained (measured, theoretical from mass, or strand reported to the conductor). The target is the sheet's own `R max` when set, otherwise the IEC value.
- **Out-of-limit is flagged, never blocked.** Nothing is deleted or overwritten; corrections are new versions.

## Where to change code for a genuinely new thing
- A new **product family**: add it to `app/db/seed.js` (or a new numbered migration for existing databases), a data sheet builder in `app/views/print.js` and column set in `app/views/specs.js`; the measurement form, register, analyses and exports are generic over `limits.level` / `quantity`.
- A new **measured quantity**: add it to `app/domain/calc.js#evaluate` (single source of truth, shared with the browser preview), to `limits.quantity` (new migration) and to the labels in `app/i18n/ro.js`.
- A new **language / wording**: every string is in `app/i18n/ro.js`.
- Schema changes are always a new `app/db/migrations/NNN_*.sql`; a backup is taken automatically before it runs.
