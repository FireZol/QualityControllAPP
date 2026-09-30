'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { unzip } = require('../lib/export');
const { version } = require('../version');

test('the release package: app, seed, scripts (CRLF) and guides; no tests, data, config or Node.js; checksum matches', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-rel-'));
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'tools', 'make-release.js')], { env: { ...process.env, CTC_RELEASE_OUT: out } });
    const name = `ROMCAB-CTC-${version}.zip`;
    const buf = fs.readFileSync(path.join(out, name));
    const files = unzip(buf);
    const names = Object.keys(files);
    for (const must of ['app/server.js', 'app/db/migrations/001_initial.sql', 'seed/fise_tehnice_initiale.json', 'seed/iec60228_2023.json', 'start.bat', 'run-server.bat', 'instalare-serviciu.ps1', 'config.example.json', 'README-INSTALARE.md', 'docs/GHID-CONFIGURARE.md', 'node/CITESTE.txt', 'VERSION.txt']) {
      assert.ok(names.includes(`ROMCAB-CTC/${must}`), `${must} is in the package`);
    }
    assert.ok(!names.some((n) => /\/app\/test\/|\.py$|config\.json$|\.db(-wal|-shm)?$|node\.exe$/.test(n)), 'no tests, scripts for development, data or config');
    assert.ok(files['ROMCAB-CTC/start.bat'].toString().includes('\r\n'), 'Windows scripts use CRLF');
    assert.ok(files['ROMCAB-CTC/VERSION.txt'].toString().includes(version));
    const sha = fs.readFileSync(path.join(out, `${name}.sha256`), 'utf8').split(' ')[0];
    assert.equal(sha, crypto.createHash('sha256').update(buf).digest('hex'));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('zero dependencies: package.json lists none and every require() in the application is a Node built-in or a local file', () => {
  const pkg = require('../../package.json');
  assert.ok(!pkg.dependencies && !pkg.devDependencies, 'no npm dependencies');
  const root = path.join(__dirname, '..');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') walk(f); continue; }
      if (!/\.js$/.test(e.name)) continue;
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (!m[1].startsWith('.') && !m[1].startsWith('node:')) offenders.push(`${path.relative(root, f)}: ${m[1]}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
  // the front-end loads nothing from outside either (CSP default-src 'self' is tested elsewhere): no http(s):// script or style links in the sources
  for (const f of fs.readdirSync(path.join(root, 'public'))) {
    if (/\.(js|css)$/.test(f)) assert.ok(!/(src|href)=["']https?:\/\//.test(fs.readFileSync(path.join(root, 'public', f), 'utf8')), f);
  }
});
