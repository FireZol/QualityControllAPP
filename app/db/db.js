'use strict';
// Thin wrapper around node:sqlite: one file, WAL, foreign keys, statement cache, transactions, migrations.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { nowIso, stamp } = require('../lib/time');

function norm(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  return v;
}

class Db {
  constructor(file) {
    this.file = file;
    this.depth = 0;
    this.open();
  }

  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.raw = new DatabaseSync(this.file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.cache = new Map();
  }

  close() {
    if (this.raw) {
      try { this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) { /* closing anyway */ }
      this.raw.close();
    }
    this.raw = null;
    this.cache = new Map();
  }

  reopen() { this.close(); this.open(); }

  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }

  all(sql, ...params) { return this.stmt(sql).all(...params.map(norm)); }
  get(sql, ...params) { return this.stmt(sql).get(...params.map(norm)); }
  run(sql, ...params) {
    const r = this.stmt(sql).run(...params.map(norm));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }
  exec(sql) { this.raw.exec(sql); }
  value(sql, ...params) {
    const row = this.get(sql, ...params);
    if (!row) return undefined;
    return row[Object.keys(row)[0]];
  }

  /** Run fn inside a transaction (nested calls join the outer one). fn must be synchronous. */
  tx(fn) {
    if (this.depth > 0) return fn();
    this.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const out = fn();
      if (out && typeof out.then === 'function') throw new Error('tx callback must be synchronous');
      this.exec('COMMIT');
      return out;
    } catch (e) {
      try { this.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  /** Consistent copy of the live database (ADR-002/012). */
  backupTo(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) throw new Error('backup file exists: ' + file);
    this.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }
}

/**
 * Apply pending numbered migrations. A backup is taken before anything pending runs
 * (only when the database already holds data).
 * @returns {{applied: number[], backup: string|null}}
 */
function migrate(db, { dir, backupDir }) {
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const hasTable = db.value("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'") > 0;
  const done = new Set(hasTable ? db.all('SELECT version FROM schema_migrations').map((r) => r.version) : []);
  const pending = files.filter((f) => !done.has(Number(f.slice(0, 3))));
  let backup = null;
  if (pending.length && done.size > 0) {
    backup = path.join(typeof backupDir === 'function' ? backupDir() : backupDir, `ctc-${stamp(new Date())}.db`);
    db.backupTo(backup);
  }
  const applied = [];
  for (const f of pending) {
    const version = Number(f.slice(0, 3));
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.tx(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)', version, nowIso());
    });
    applied.push(version);
  }
  return { applied, backup };
}

module.exports = { Db, migrate };
