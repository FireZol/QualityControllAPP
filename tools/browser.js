'use strict';
// The browser for the developer tools (audits, walk-throughs, screenshots). Never used by the application.
// First choice: playwright-core from dev/ (`npm install --prefix dev`, a few MB) driving the Microsoft Edge already on the PC.
// Otherwise a global Playwright (`npm root -g`) with its own Chromium, as in the cloud dev environment.
const path = require('node:path');
const { execSync } = require('node:child_process');

function load() {
  const tries = [
    () => ({ pw: require(path.join(__dirname, '..', 'dev', 'node_modules', 'playwright-core')), channel: process.env.CTC_BROWSER || 'msedge' }),
    () => ({ pw: require(path.join(execSync('npm root -g').toString().trim(), 'playwright')), channel: process.env.CTC_BROWSER }),
    () => ({ pw: require(path.join(execSync('npm root -g').toString().trim(), 'playwright-core')), channel: process.env.CTC_BROWSER || 'msedge' }),
  ];
  for (const t of tries) { try { return t(); } catch (e) { /* next */ } }
  console.error('No browser driver found. Install it once (developer PC only):  npm install --prefix dev');
  process.exit(2);
}

const { pw, channel } = load();
/** Same shape as Playwright's module for what the tools use: chromium.launch(opts). CTC_BROWSER=chrome picks Google Chrome instead of Edge. */
module.exports = { chromium: { launch: (opts) => pw.chromium.launch({ ...(channel ? { channel } : {}), ...(opts || {}) }) } };
