'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Root of the installation: the folder that holds app/, seed/, data/, backups/. */
const ROOT = path.resolve(__dirname, '..', '..');

const DEFAULTS = {
  port: 8080,
  bind: '0.0.0.0',
  publicName: '',
  dataDir: 'data',
  backupDir: 'backups',
  seedDir: 'seed',
};

/**
 * config.json is only the first-start seed for the Administrator settings, plus the folders.
 * Env CTC_PORT / CTC_BIND override at run time (recovery when a bad port was saved).
 */
function loadConfig(file, root) {
  const base = root || ROOT;
  let cfg = { ...DEFAULTS };
  const f = file || path.join(base, 'config.json');
  if (fs.existsSync(f)) {
    try {
      cfg = { ...cfg, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    } catch (e) {
      throw new Error(`config.json is not valid JSON (${e.message})`);
    }
  }
  const abs = (p) => (path.isAbsolute(p) ? p : path.join(base, p));
  return {
    root: base,
    port: Number(cfg.port) || DEFAULTS.port,
    bind: String(cfg.bind || DEFAULTS.bind),
    publicName: String(cfg.publicName || ''),
    dataDir: abs(cfg.dataDir),
    backupDir: abs(cfg.backupDir),
    seedDir: abs(cfg.seedDir),
    envPort: process.env.CTC_PORT ? Number(process.env.CTC_PORT) : null,
    envBind: process.env.CTC_BIND || null,
  };
}

module.exports = { ROOT, DEFAULTS, loadConfig };
