# Seed data

| File | Content | Source |
| --- | --- | --- |
| `iec60228_2023.json` | IEC 60228:2023 Tab. 3 (class 1), Tab. 4 (class 2, incl. minimum wire counts), Tab. 5 (class 5 Cu, incl. max wire Ø), Tab. A.1 kt. Ω/km at 20 °C. | ROMCAB licensed copy (limit values only) |
| `fise_tehnice_initiale.json` | Initial technical data: `sarma_trefilata` (86 rows: A6 Cu, Al, Al purtător, Al EVN), `funie_rigida` (69: Al RMC/SM, Cu RMC/SM with rotor pitch/tension), `conductor_flexibil_cl5` (27), `conductor_extrudat_al` (13), `constante_material`. | A6 Ed.33 Rev.7 (23.09.2026); A6 Ed.2 Rev.4 clasa V (07.09.2026); instrucțiuni cablare rigid (Strander 1+6+12+18+24 Al, SETIC 1+6+12+18 Cu); Conductori sector clasa 1 aluminiu |
| `verificare_seed.json` | Automated consistency checks on the transcription: level A = probably wrong on paper or in transcription, B = worth a look, C = note. | `validate_seed.py` |
| `build_seed.py`, `validate_seed.py`, `_*.py` | The raw transcription tables and the scripts that build and check the JSON. Edit `_*.py`, then run `python3 build_seed.py && python3 validate_seed.py`. | — |

Conventions: masses of drawn wire in kg/km (= g/m); strand masses in g/m; `null` = "–" on paper (not determined); `modificat` / `d_fir_modificat` = value printed in red on the paper original (latest change), `"galben"` = highlighted in yellow. Die sizes are text because paper has values like `3.21 / 3.215` and `8 x 0.328 + 8 x 0.325`.

All values were read from scans and must be checked by an engineer in the app before the seeded draft revisions are activated.
