'use strict';
// The modules of the system. "qc" is the original application (measuring, sheets, database, administration) and is always there;
// the others are switched on by the Administrator (Setări → Module) and each needs an access level per user.
// Finished cable and analyses stay sub-features of "qc" (switched the same way, gated by path in domain/modules.js).

const LEVELS = ['none', 'view', 'enter', 'lead'];
const rank = (l) => Math.max(0, LEVELS.indexOf(l));

const MODULES = [
  { id: 'qc', core: true, prefixes: [], menu: [] },
  {
    id: 'maintenance', prefixes: ['/mentenanta'], home: '/mentenanta', team: 'maintenance',
    menu: [{ key: 'tasks', href: '/mentenanta', name: 'tasks' }, { key: 'preventive', href: '/mentenanta/preventiv', name: 'preventive' }],
  },
  { id: 'technical', prefixes: ['/tehnic'], home: '/tehnic', team: 'technical', menu: [{ key: 'tasks', href: '/tehnic', name: 'tasks' }] },
  {
    id: 'quality', prefixes: ['/calitate'], home: '/calitate', team: 'quality',
    menu: [{ key: 'ncr', href: '/calitate', name: 'ncr' }, { key: 'tasks', href: '/calitate/sarcini', name: 'tasks' }, { key: 'top', href: '/calitate/top', name: 'top' }],
  },
  {
    id: 'meetings', prefixes: ['/sedinte'], home: '/sedinte',
    menu: [{ key: 'list', href: '/sedinte', name: 'meetings' }, { key: 'series', href: '/sedinte/serii', name: 'series', minLevel: 'lead' }],
  },
];

const byId = Object.fromEntries(MODULES.map((m) => [m.id, m]));
/** Modules the Administrator can switch (everything except the core). */
const switchable = () => MODULES.filter((m) => !m.core).map((m) => m.id);
const teams = () => MODULES.filter((m) => m.team);

/** Which module a path belongs to ("qc" for everything else). */
function moduleOfPath(pathname) {
  for (const m of MODULES) if (m.prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))) return m.id;
  return 'qc';
}

module.exports = { LEVELS, rank, MODULES, byId, switchable, teams, moduleOfPath };
