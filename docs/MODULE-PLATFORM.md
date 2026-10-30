# Module platform (proposal, not built) — ROMCAB CTC as a modular ERP

Asked by the owner on 2026-10-30: "Can we set this up as an ERP modular system?" Answer: yes, in steps, on the foundation that already exists. Nothing here is built; it needs the owner's approval and priorities (questions at the end).

## 1. What a module is
A folder `app/modules/<id>/` that the core loads at start-up. It declares itself in `module.json` and contains only its own parts:
```
app/modules/qc/                       module.json   { id, name, version, requires: [], menu: [...], permissions: [...], settings: [...] }
                                      migrations/   001_*.sql ... (own tables, prefixed qc_)
                                      routes.js  views/  domain/  i18n/{ro,en}.js  public/  test/
```
The core gives every module the same services: users, roles, sessions, audit log, lists (master data), settings, i18n, export (CSV / Excel), backup, printing frame, the HTML helpers. A module never reaches into another module's tables; it uses that module's exported functions or the event bus.

## 2. Core versus modules
| Core (always on) | Modules (switchable, each with its own tests) |
|---|---|
| users, roles, permissions, audit, settings, backup, languages, print frame, export, first-setup checklist, module registry, shared master data (parties, items, units, sites) | **QC measuring** (today's core: measurements, sheets, verification), **Finished cable** (tests, batches, certificates), **Analyses / SPC**, then ERP modules below |

The two switchable modules that exist today (finished cable, analyses) become the first two manifests; QC measuring and data sheets are the first "always installed" module.

## 3. Rules that keep it one system
- **One database, one file** (SQLite, WAL) as now; each module owns tables with its prefix; **numbered migrations per module**, applied in dependency order, with the automatic backup before any pending migration.
- **Dependencies are declared** (`requires: ["qc"]`); the registry refuses to enable a module whose requirements are off, and refuses to disable one that others need.
- **Permissions per module:** role × module × action (`view`, `enter`, `edit`, `approve`, `admin`), checked in the server for every route — extends today's three roles; existing roles map onto it unchanged.
- **Shared master data in the core:** parties (customers, suppliers), items (materials, products, cable designs), units, sites / machines. Modules reference them by id.
- **Events instead of coupling:** e.g. `batch.closed`, `measurement.out_of_limit`, `stock.below_minimum`; a module subscribes, never calls another module's internals. Events are written to an outbox table so nothing is lost on a crash.
- **Same hard rules:** zero dependencies, server is the authority, nothing deleted (version / archive), two languages with the sync test, every control ≥ 44 px, numbers follow the language, audit for every change.
- **A module home:** after login a launcher page shows only the modules the user may open (tiles), then the module's own menu. The current top bar becomes the module's menu.

## 4. Candidate ERP modules (to be ordered by the owner)
1. **Non-conformity and corrective actions (NCR/CAPA)** — links to out-of-limit results and certificates; open / closed, cause, action, owner.
2. **Customers and orders** — customer master, order lines, which batches ship against which order, delivery and certificate packs.
3. **Production orders and routing** — order → process steps (drawing, stranding, extrusion, test) → machine, shift, quantity, scrap; feeds batches and drums.
4. **Raw material and inventory** — receipts (rod, compound), lots, consumption per order, stock levels, traceability both ways.
5. **Purchasing and suppliers** — requests, orders, supplier ratings tied to incoming-inspection results.
6. **Maintenance and calibration** — machine plans, gauge calibration due dates (a measurement taken with an out-of-date gauge is flagged).
7. **Planning and capacity**, **dashboards / KPIs**, **HR (shifts, skills, training)** — later.

Each is an independent module with its own tests and manifest; the owner picks the order and the minimum useful version of each.

## 5. Honest limits and risks
- **Scope.** A full ERP is years of work for a team; this stays a *factory floor and quality* system that grows module by module, never a general ERP. Accounting, payroll and invoicing are out of scope unless the owner decides to integrate an existing system through exports.
- **SQLite** is fine for tens of users and millions of rows (the load check ran 50 000 measurements), but it has one writer at a time. If concurrent writes from many stations (production floor terminals, scanners) become heavy, the data layer is behind `app/db/db.js` so a server database can replace it later; the modules do not change.
- **Plain HTTP on the LAN** is acceptable for a pilot only; an ERP with orders and suppliers should sit behind HTTPS (`docs/SECURITY.md`).
- **Maintenance of three languages** grows with every module; the sync test keeps it honest, the wording review sheet (`tools/export-texts.js`) makes the review cheap.
- **Backups and updates** become more important: one package, one database, restore drill per release.

## 6. Steps (each one releasable and tested)
1. **Registry and manifests** — a module loader, per-module migrations, dependency checks, module permissions; today's code moved into `qc`, `cable`, `analytics` modules with **no behaviour change** (all 140 tests stay green). Module launcher home.
2. **Shared master data in the core** — parties, items, units; the existing lists (clients, materials, machines) become views of them.
3. **Event bus and outbox**; the first cross-module link (out-of-limit result → NCR).
4. **First new module** chosen by the owner (suggested: NCR, then Customers and orders).
5. One module at a time after that, each with its guide, its tests, its English / Romanian texts and a short pilot.

## 7. Questions for the owner
1. Which two ERP modules would give the factory the most value first (suggestion: NCR and Customers/orders)?
2. Who will use them (QC only, or also production, sales, warehouse)? That decides roles, screens and how many people write at once.
3. Does anything need to talk to your existing systems (accounting, a warehouse system, gauges, scanners)? Exports now, direct links later?
4. Is the plan to run one installation for the whole factory or one per site?
5. Should modules be sold / licensed separately later (then the loader needs a licence check) or are they all part of the factory's own system?
