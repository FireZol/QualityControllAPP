# ROMCAB CTC — Quality Control App

Quality-control measurement web app for the ROMCAB S.A. cable factory: measurements of Cu/Al wires and conductors, versioned technical data sheets with a two-person verify rule, limit checks (IEC 60228:2023 reference values), full history, printed A6 annexes, analyses (trend, Cp/Cpk, non-conformity, extra material consumption, comparison) and CSV/Excel export.

Node.js ≥ 22.13 built-ins only (`node:http`, `node:sqlite`, `node:crypto`, `node:zlib`) — **zero npm dependencies**, no build step, no internet needed at run time. UI is 100 % Romanian.

```
node app/server.js      # dev: uses ./data and ./config.json (copy config.example.json)
npm test                # unit + integration tests (node:test)
```

| Stage | Status |
| --- | --- |
| 1 — base, rigid strands, extruded Al conductor | done |
| 2 — drawn wire (class I–II, V), printed annexes and register | done |
| 3 — flexible class 5, analyses, CSV/Excel export | done |
| 4 — finished LV cable (IEC 60502-1 / HD 603 / VDE 0276-603): batches, drums, batch and type tests, certificates, SPC control charts | done |

Adapting: `docs/ADAPTARE.md` (what is editable and where). Read first: `CLAUDE.md`, `docs/DECISIONS.md`, `docs/SPECIFICATIE.md`, `docs/DATA-MODEL.md`, `docs/ETAPA-1.md` … `docs/ETAPA-4.md`, `docs/INTREBARI.md` (open questions), `docs/GHID-CONFIGURARE.md` (first setup), `docs/TEST-PE-CALCULATOR.md` (factory PC checklist), `README-INSTALARE.md` (Windows install, in Romanian).

Development tools (not part of the app; need Playwright): `tools/walkthrough.js` (browser walk-through with screenshots), `tools/print-check.js` (printed pages in Chromium).
