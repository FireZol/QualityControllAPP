'use strict';
const { nowIso } = require('../lib/time');

function log(db, userId, action, entity, entityId, details) {
  db.run(
    'INSERT INTO audit_log(ts, user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    nowIso(), userId === undefined ? null : userId, action, entity || null, entityId === undefined ? null : entityId,
    details === undefined ? null : JSON.stringify(details),
  );
}

module.exports = { log };
