'use strict';
// key/value settings, JSON-encoded values.
const DEFAULTS = {
  'server.port': 8080,
  'server.bind': '0.0.0.0',
  'server.public_name': '',
  'session.idle_hours': 8,
  'backup.dir': null, // null = <root>/backups
  'backup.auto': true,
  'backup.time': '02:00',
  'backup.keep': 14,
  'shift.day_start': '06:00',
  'shift.night_start': '18:00',
  'shift.cycle': [4, 2, 4, 2], // crew cycle in days: day shifts, days off, night shifts, days off
  'company.name': 'S.C. ROMCAB S.A.',
  'production.started_at': null, // set once by "Start production" (Settings)
  'feedback.email': '', // where the "Report a problem" link writes to (empty = no link)
  'modules.cable': false, // finished-cable tests, batches, certificates
  'modules.analytics': false, // analyses, SPC control charts and home-page alerts
};

function get(db, key) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return DEFAULTS[key];
  try { return JSON.parse(row.value); } catch (_) { return DEFAULTS[key]; }
}

function set(db, key, value) {
  db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

function all(db) {
  const out = { ...DEFAULTS };
  for (const r of db.all('SELECT key, value FROM settings')) {
    try { out[r.key] = JSON.parse(r.value); } catch (_) { /* keep default */ }
  }
  return out;
}

const shiftConfig = (db) => ({ dayStart: get(db, 'shift.day_start'), nightStart: get(db, 'shift.night_start'), cycle: get(db, 'shift.cycle') });

module.exports = { DEFAULTS, get, set, all, shiftConfig };
