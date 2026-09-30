'use strict';
// Builds the installable package for the server: dist/ROMCAB-CTC-<version>.zip (+ .sha256).
//   node tools/make-release.js                       (without Node.js; IT adds node\node.exe)
//   node tools/make-release.js --with-node <node-win-x64.zip>   (all-in-one: takes node.exe and its licence from the official Node.js zip)
// Contains the application, the seed data, the Windows scripts and the guides. No tests, no data, no config.json, no Node.js
// (IT adds the portable Node.js into node\ as described in README-INSTALARE.md). Windows scripts are written with CRLF line ends.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zip, unzip } = require('../app/lib/export');
const { version } = require('../app/version');

const root = path.resolve(__dirname, '..');
const files = [];
const add = (rel, data) => files.push({ name: `ROMCAB-CTC/${rel.split(path.sep).join('/')}`, data });
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');
const isScript = (n) => /\.(bat|cmd|ps1|txt)$/i.test(n);

function walk(dir, keep) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (keep(rel, true)) walk(rel, keep); } else if (keep(rel, false)) add(rel, fs.readFileSync(path.join(root, rel)));
  }
}

walk('app', (rel, dir) => !(dir && rel === path.join('app', 'test')));
walk('seed', (rel, dir) => dir || /\.(json|md)$/i.test(rel));
for (const f of ['start.bat', 'run-server.bat', 'instalare-serviciu.bat', 'instalare-serviciu.ps1', 'dezinstalare-serviciu.bat']) add(f, crlf(fs.readFileSync(path.join(root, f), 'utf8')));
for (const f of ['config.example.json', 'package.json', 'README-INSTALARE.md']) add(f, fs.readFileSync(path.join(root, f)));
for (const f of ['GHID-CONFIGURARE.md', 'TEST-PE-CALCULATOR.md', 'ADAPTARE.md', 'INTREBARI.md', 'SECURITY.md']) add(path.join('docs', f), fs.readFileSync(path.join(root, 'docs', f)));
const nodeZipArg = process.argv.indexOf('--with-node') >= 0 ? process.argv[process.argv.indexOf('--with-node') + 1] : null;
let nodeVersion = null;
if (nodeZipArg) {
  const entries = unzip(fs.readFileSync(nodeZipArg));
  const exe = Object.keys(entries).find((n) => /\/node\.exe$/.test(n));
  if (!exe) throw new Error('node.exe not found in the Node.js zip');
  nodeVersion = /node-(v[\d.]+)-win-x64/.exec(exe)[1];
  add('node/node.exe', entries[exe]);
  const lic = Object.keys(entries).find((n) => /\/LICENSE$/.test(n));
  if (lic) add('node/LICENSE', entries[lic]);
  add('node/VERSION.txt', crlf(`Node.js ${nodeVersion} (win-x64), unchanged from https://nodejs.org/dist/${nodeVersion}/\n`));
} else add('node/CITESTE.txt', crlf('Copiati aici Node.js portabil (Windows x64 .zip de pe nodejs.org, versiunea LTS, recomandat 24.x, minim 22.13), astfel incat sa existe node\\node.exe.\nVezi README-INSTALARE.md.\n'));
add('VERSION.txt', crlf(`ROMCAB CTC ${version}\nConstruit: ${new Date().toISOString().slice(0, 10)}\n`));

const out = process.env.CTC_RELEASE_OUT || path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const name = `ROMCAB-CTC-${version}${nodeVersion ? '-with-node' : ''}.zip`;
const buf = zip(files);
fs.writeFileSync(path.join(out, name), buf);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
fs.writeFileSync(path.join(out, `${name}.sha256`), `${sha}  ${name}\n`);
console.log(`${name}: ${files.length} files, ${(buf.length / 1024).toFixed(0)} KB, sha256 ${sha}`);
