'use strict';
// "Start production": once, at the end of the pilot, the Administrator clears the test measurements (and finished-cable
// batches / drums / certificates) while every setting, user, data sheet and list is kept. A backup is taken first, the
// action is audited, and it cannot be repeated (afterwards data is only ever removed by restoring a backup).
const settings = require('./settings');
const audit = require('./audit');
const backup = require('../lib/backup');
const { nowIso } = require('../lib/time');

const CONFIRM_WORD = 'START';
const TABLES = ['measurement_results', 'measurement_inputs', 'measurements', 'batch_certificates', 'drums', 'batches'];

function status(db) {
  const startedAt = settings.get(db, 'production.started_at') || null;
  return {
    startedAt,
    counts: { measurements: db.value('SELECT count(*) FROM measurements'), batches: db.value('SELECT count(*) FROM batches'), certificates: db.value('SELECT count(*) FROM batch_certificates') },
  };
}

/** @returns {{ok: true, backup: string, removed: object} | {ok: false, code: string}} */
function run(db, config, user, confirmText) {
  if (settings.get(db, 'production.started_at')) return { ok: false, code: 'golive_done' };
  if (String(confirmText || '').trim() !== CONFIRM_WORD) return { ok: false, code: 'golive_confirm' };
  const b = backup.backupNow(db, config, user.id, 'before-production');
  if (!b.ok) return { ok: false, code: 'golive_backup', error: b.error };
  const removed = status(db).counts;
  db.tx(() => {
    for (const t of TABLES) db.run(`DELETE FROM ${t}`);
    db.run('DELETE FROM login_attempts');
    settings.set(db, 'production.started_at', nowIso());
    audit.log(db, user.id, 'golive_reset', 'settings', null, { backup: b.name, removed });
  });
  return { ok: true, backup: b.name, removed };
}

module.exports = { CONFIRM_WORD, status, run };
