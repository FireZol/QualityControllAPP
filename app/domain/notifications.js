'use strict';
// In-application notifications (a bell with an unread count and a page). The text is chosen when it is read, in the reader's language,
// from T.notify[kind] with the stored parameters, so nothing is frozen in one language.
const { nowIso } = require('../lib/time');

/** Notify the given users (duplicates and falsy ids dropped). `dedupe` makes a repeat of the same event a no-op. @returns number created */
function notify(db, userIds, kind, params, link, dedupe) {
  let n = 0;
  for (const uid of new Set((userIds || []).filter(Boolean))) {
    const r = db.run('INSERT OR IGNORE INTO notifications(user_id, created_at, kind, params, link, dedupe) VALUES (?,?,?,?,?,?)', uid, nowIso(), kind, JSON.stringify(params || {}), link || null, dedupe || null);
    n += r.changes;
  }
  return n;
}

const unread = (db, userId) => db.value('SELECT count(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', userId);

function list(db, userId, { onlyUnread, limit } = {}) {
  return db.all(`SELECT * FROM notifications WHERE user_id = ? ${onlyUnread ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`, userId)
    .map((r) => ({ ...r, params: JSON.parse(r.params || '{}') }));
}

function markRead(db, userId, id) { return db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', nowIso(), id, userId).changes; }
function markAllRead(db, userId) { return db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), userId).changes; }

/** The user ids of the people behind some person ids (people without a login are skipped). */
function usersOfPeople(db, personIds) {
  const ids = (personIds || []).filter(Boolean);
  if (!ids.length) return [];
  return db.all(`SELECT user_id FROM people WHERE id IN (${ids.map(() => '?').join(',')}) AND user_id IS NOT NULL AND active = 1`, ...ids).map((r) => r.user_id);
}

module.exports = { notify, unread, list, markRead, markAllRead, usersOfPeople };
