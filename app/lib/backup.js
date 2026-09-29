'use strict';
// Backups (ADR-012): consistent copy with VACUUM INTO while running; restore with a safety backup first.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { stamp } = require('./time');
const settings = require('../domain/settings');
const audit = require('../domain/audit');

const NAME_RE = /^ctc-\d{8}-\d{6}\.db$/;

function backupDir(db, config) {
  const s = settings.get(db, 'backup.dir');
  return s && String(s).trim() ? String(s).trim() : config.backupDir;
}

function listBackups(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names.filter((n) => NAME_RE.test(n)).map((n) => {
    const st = fs.statSync(path.join(dir, n));
    return { name: n, size: st.size, mtime: st.mtime };
  }).sort((a, b) => (a.name < b.name ? 1 : -1));
}

function freeName(dir, date) {
  const d = new Date(date.getTime());
  for (let i = 0; i < 120; i++) {
    const name = `ctc-${stamp(d)}.db`;
    if (!fs.existsSync(path.join(dir, name))) return name;
    d.setSeconds(d.getSeconds() + 1);
  }
  throw new Error('no free backup name');
}

function prune(db, dir) {
  const keep = Number(settings.get(db, 'backup.keep')) || 14;
  const all = listBackups(dir);
  for (const b of all.slice(keep)) {
    try { fs.unlinkSync(path.join(dir, b.name)); } catch (_) { /* best effort */ }
  }
}

/** @returns {{ok:true, name, file}|{ok:false, error}} */
function backupNow(db, config, userId, kind) {
  const dir = backupDir(db, config);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const name = freeName(dir, new Date());
    const file = path.join(dir, name);
    db.backupTo(file);
    prune(db, dir);
    audit.log(db, userId, 'backup', 'backup', null, { file: name, kind: kind || 'manual' });
    return { ok: true, name, file };
  } catch (e) {
    try { audit.log(db, userId, 'backup_failed', 'backup', null, { error: String(e.message), kind: kind || 'manual' }); } catch (_) { /* logging must not hide the error */ }
    return { ok: false, error: e.message };
  }
}

/** A file is restorable when it is a SQLite database that passes integrity_check and holds our schema. */
function validateBackupFile(file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const ic = db.prepare('PRAGMA integrity_check').get();
    if (!ic || ic.integrity_check !== 'ok') return false;
    const t = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('users','measurements','spec_revisions','settings')").get();
    return t.n === 4;
  } catch (_) {
    return false;
  } finally {
    if (db) try { db.close(); } catch (_) { /* ignore */ }
  }
}

/**
 * Restore: stop accepting writes, safety backup of the current file, copy the chosen file over ctc.db,
 * reopen the connection. `app` = {db, config, state:{maintenance}, afterRestore()}.
 */
function restore(app, name, userId) {
  const dir = backupDir(app.db, app.config);
  if (!NAME_RE.test(name)) return { ok: false, code: 'bad_name' };
  const src = path.join(dir, name);
  if (!fs.existsSync(src)) return { ok: false, code: 'not_found' };
  if (!validateBackupFile(src)) return { ok: false, code: 'invalid_backup' };
  app.state.maintenance = true;
  try {
    const safety = backupNow(app.db, app.config, userId, 'safety-before-restore');
    if (!safety.ok) return { ok: false, code: 'safety_failed', error: safety.error };
    const target = app.db.file;
    app.db.close();
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(target + ext); } catch (_) { /* absent */ } }
    fs.copyFileSync(src, target);
    app.db.open();
    if (app.afterRestore) app.afterRestore();
    audit.log(app.db, userId, 'restore', 'backup', null, { file: name, safety: safety.name });
    return { ok: true, safety: safety.name };
  } finally {
    app.state.maintenance = false;
  }
}

/** Daily automatic backup, checked once a minute (the app is a server; no laptop battery to protect). */
function startScheduler(app) {
  const tick = () => {
    try {
      const db = app.db;
      if (app.state.maintenance || !settings.get(db, 'backup.auto')) return;
      const now = new Date();
      const [hh, mm] = String(settings.get(db, 'backup.time')).split(':').map(Number);
      const due = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
      const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      if (!due || settings.get(db, 'backup.last_auto') === today) return;
      settings.set(db, 'backup.last_auto', today);
      backupNow(db, app.config, null, 'auto');
    } catch (e) {
      console.error('backup scheduler:', e.message);
    }
  };
  const timer = setInterval(tick, 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { NAME_RE, backupDir, listBackups, backupNow, restore, validateBackupFile, startScheduler };
