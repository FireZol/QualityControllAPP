'use strict';
// Who may do what in the team modules. Levels: none < view < enter (create requests, comment) < lead (assign, update status, close, evaluate).
// The Administrator is lead everywhere; "qc" keeps its own roles (Personal / Inginer / Administrator).
const settings = require('./settings');
const reg = require('../modules/registry');

/** Default level of a user without a row of their own, per module (settings access.default.<module>). */
const DEFAULT_LEVEL = { maintenance: 'enter', quality: 'enter', technical: 'lead', meetings: 'view' };

function level(db, user, module, enabled) {
  if (!user) return 'none';
  if (module === 'qc') return 'lead';
  if (enabled && !enabled[module]) return 'none';
  if (user.role === 'administrator') return 'lead';
  // Technical: everybody can update (owner, 2026-10-30), unless the Administrator closes it
  if (module === 'technical' && settings.get(db, 'technical.open_to_all') !== false) {
    const own = db.get('SELECT level FROM user_modules WHERE user_id = ? AND module = ?', user.id, module);
    return own ? own.level : 'lead';
  }
  const row = db.get('SELECT level FROM user_modules WHERE user_id = ? AND module = ?', user.id, module);
  if (row) return row.level;
  const d = settings.get(db, `access.default.${module}`);
  return reg.LEVELS.includes(d) ? d : DEFAULT_LEVEL[module] || 'none';
}

const can = (db, user, module, min, enabled) => reg.rank(level(db, user, module, enabled)) >= reg.rank(min);

function userLevels(db, userId) {
  const m = {};
  for (const r of db.all('SELECT module, level FROM user_modules WHERE user_id = ?', userId)) m[r.module] = r.level;
  return m;
}

/** Replace a user's explicit levels (a module missing or '' = no row: the default applies). */
function setUserLevels(db, userId, levels) {
  db.run('DELETE FROM user_modules WHERE user_id = ?', userId);
  for (const [module, lv] of Object.entries(levels)) {
    if (reg.byId[module] && !reg.byId[module].core && reg.LEVELS.includes(lv)) db.run('INSERT INTO user_modules(user_id, module, level) VALUES (?,?,?)', userId, module, lv);
  }
}

module.exports = { DEFAULT_LEVEL, level, can, userLevels, setUserLevels };
