# ETAPA 2 — Sârme + documente (built)

Scope from `docs/SPECIFICATIE.md` §10: drawn wire (class I–II and class V multifilar) measurement screens, printing of the A6 annexes and stranding instructions, IEC checks at activation (already in stage 1).

## Built

- **Wire class I–II (`SARMA_CL12`)** — active for measurement. Two diameter readings (each checked against Ø min–max), sample mass in g/m (= kg/km on the sheet). No theoretical resistance for a drawn wire. Measured resistance only for **Cu unifilar RE** (the wire is the finished conductor), checked against IEC 60228 Tab. 3; every other wire row has no resistance input. The shape on a wire row names the conductor it goes into, so the wire itself is always round (two Ø readings, never Î × L).
- **Wire class V (`SARMA_CL5`)** — active. Two Ø readings, no mass. It reads its constructions from the class V data sheet (`measures.spec_family = FLEXIBIL_CL5`); that sheet only carries a nominal Ø, so Ø verdicts are `nedeterminat` until an engineer sets min/max (the statistics page gives mean / min / max / std dev as the basis). The class V sheet is editable and verifiable now although the flexible-conductor measurement screens stay for stage 3. Its 25 mm² row (Ø 0.413 > IEC Tab. 5 max 0.41) blocks activation until an engineer records an exception.
- **Construction picker** shows destination and die next to the label so duplicate names (Unifilar / Multifilar, `8 x 0.191` / `16 x 0.191`) can be told apart.
- **Printed documents** (`/fise/:doc/revizii/:id/tipar`, any role, any revision including archived): A4 portrait, header (company, title, Cod, Ediție, Revizie) and footer (Elaborat, Verificat, blank signature line, Exemplar) repeated on every printed page; values changed against the previous revision in red; IEC exception notes; banner when the revision is not in force. Layouts: wire Cu / Al / Al purtător / Al EVN, class V (0,5–6 and 10–400 mm²), rigid stranding per strander with pitch / tension per rotor, extruded RE / SE.
- **Printed register** (`/masuratori/tipar`, same filters, up to 2000 rows, A4 landscape; pick A3 in the print dialog for wide selections).
- **Migration 002** upgrades a stage-1 database (RM = compacted, Conform Extruder machine, wire families active, class V wire limits) after an automatic backup.
- Fixed while building: the register's "only out-of-limit" / "all versions" filters lost their value when paging.

## Notes / assumptions

- "Pag. x / y" is produced by `print-paginate.js` (browser-side pagination), so it is identical in Chrome, Edge and Firefox; `node tools/print-check.js` verifies it in headless Chromium.
- Default machines `TREFILARE 1` (Trefilare) and `TREFILARE MF 1` (Trefilare multifilară) are seeded so every process has one (owner request); rename or add more in Date de bază → Utilaje.
- The wire sheets are drafts transcribed from scans; the engineers must verify and a second engineer activate them before measurements can be saved (same two-person rule as stage 1).
