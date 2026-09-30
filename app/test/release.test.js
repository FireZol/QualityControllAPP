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
