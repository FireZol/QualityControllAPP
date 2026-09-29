# ETAPA 3 — Flexibile + analize (built)

## Flexible class 5 conductors (`FLEXIBIL_CL5`, active for measurement)
- One measurement record per **level**: suviță (mass), toron (mass + resistance), liță (mass shown against the approximate sheet value, resistance). The level is chosen after the product; a section without strands has no toron level.
- **Toron resistance is reported to the finished conductor:** R20_echiv = R20_toron / n_toroane, checked against IEC 60228 Tab. 5 (the number of strands comes from the same sheet row; `destination_construction_id` = that row). Acceptance case 13 (13.734 Ω/km at 26.5 °C, 7 strands, limit 1.91 → 1.9131, +0.16 %, `peste`) is an automated test through the server.
- No diameter, no theoretical resistance for flexible conductors.
- Migration 003 activates the family and adds default machines `TREFILARE 1` and `TREFILARE MF 1` (KABMAK / LITARE / RIGID / Conform Extruder were already seeded), so every process can be measured out of the box.

## Analyses (`/analize`, every role)
Five tabs with the common filters (period, family, product, level, machine, shift, crew, operator, client, quantity, group-by):
- **Tendință** — values over time as an SVG chart with the min–max band of the limits each value was judged against, out-of-limit points marked (shape + colour), summary and the last 200 points.
- **Distribuție și capabilitate** — histogram with limits and mean; n, mean, sample standard deviation, min, max, Cp, Cpk per product / machine / shift / crew / operator / client. Cp needs both limits; one-sided limits give Cpk only. Informative results and results without limits get none; `n < 30` is flagged as indicative; changed limits are flagged and Cp/Cpk use the most recent ones.
- **Rată de neconformitate** — % out of limits, sub minim and peste maxim separately (only results with a verdict count).
- **Consum suplimentar** — mass above maximum in g/m and %, in kg only for records with produced length (kg = excess g/m × length m / 1000).
- **Comparație** — mean ± s and min–max per group on a common axis with the limits.
Charts are drawn on the server as inline SVG (no library, no external file).

## Export
- Every analysis: CSV or Excel. The register: CSV (wide) or Excel with three sheets (register, results with limits and verdicts, typed inputs), honouring the register filters.
- CSV: UTF-8 with BOM, `;` separator, decimal comma (opens correctly in Romanian-locale Excel); text starting with `= + - @` is prefixed with an apostrophe so it can never run as a formula.
- Excel: a real `.xlsx` written by hand (zip via `node:zlib`, no library): numbers stay numbers, text stays text, bold frozen header row with filter. Checked by reading it back in the tests and with openpyxl.

## Verify
`npm test` (78 tests), `node tools/walkthrough.js <dir>` (browser walk-through), `node tools/print-check.js` (printed pages).
