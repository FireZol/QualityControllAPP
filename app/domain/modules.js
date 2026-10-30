'use strict';
// Optional parts of the application. The core is conductor QC measuring; everything here is off until
// an Administrator switches it on in Setări. The code stays in place so nothing has to be rebuilt later.
const settings = require('./settings');
const reg = require('../modules/registry');

// finished cable and analyses (parts of the QC application) plus the team modules of the registry
const MODULES = ['cable', 'analytics', ...reg.switchable()];
const key = (m) => `modules.${m}`;

function get(db) {
  const out = {};
  for (const m of MODULES) out[m] = settings.get(db, key(m)) === true;
  return out;
}

/** Path prefixes that belong to a module (checked before routing). */
function moduleOf(pathname) {
  if (pathname === '/loturi' || pathname.startsWith('/loturi/') || pathname.startsWith('/certificate/')) return 'cable';
  if (pathname === '/analize' || pathname.startsWith('/analize/')) return 'analytics';
  const m = reg.moduleOfPath(pathname);
  return m === 'qc' ? null : m;
}

/** Turn a module on or off; the finished-cable family follows the cable module. */
function set(db, name, on) {
  settings.set(db, key(name), !!on);
  if (name === 'cable') db.run("UPDATE product_families SET active = ? WHERE code = 'CABLE_LV'", on ? 1 : 0);
}

module.exports = { MODULES, key, get, set, moduleOf };
