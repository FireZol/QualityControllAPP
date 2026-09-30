'use strict';
// Wording review sheet: every screen text in Romanian and English side by side, with empty columns for corrections.
// Colleagues fill "English corrected" / "Romanian corrected" / "Comment" and send the file back.
//   node tools/export-texts.js [output.xlsx]      (default: docs/revizie-texte.xlsx)
// Keys are the path in app/i18n/ro.js and app/i18n/en/*.js (e.g. nav.home). {placeholders} must stay as they are.
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../app/i18n');
const { toXlsx } = require('../app/lib/export');

function flatten(o, prefix, out) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, `${prefix}${k}.`, out);
    else if (Array.isArray(v)) v.forEach((line, i) => { out[`${prefix}${k}[${i + 1}]`] = line; });
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

const ro = flatten(i18n.raw.ro, '', {});
const en = flatten(i18n.raw.en, '', {});
const screens = { nav: 'Menu', help: 'Help tips (?)', roles: 'Roles', shift: 'Shifts', material: 'Materials', common: 'Common buttons', cfg: 'Database: families, targets, IEC', an: 'Analyses',
  export: 'Export columns', cable: 'Finished cable, batches, certificates', print: 'Printed pages', verdict: 'Verdicts', errors: 'Error messages', flash: 'Notices', error_pages: 'Error pages',
  login: 'Login', password: 'Password', home: 'Home', quantity: 'Quantities', input: 'Entry fields', tests: 'Tests', level: 'Levels', measure: 'New measurement', register: 'Register',
  detail: 'Record detail', status: 'Sheet status', specs: 'Data sheets', sheet: 'Data sheet columns', limitq: 'Limit names', iec: 'IEC checks', stats: 'Statistics', lists: 'Database lists',
  users: 'Users', settings: 'Settings', audit: 'Audit log', app: 'Application' };

const rows = Object.keys(ro).map((key) => ({
  screen: screens[key.split(/[.[]/)[0]] || key.split('.')[0], key, ro: ro[key], en: en[key] === undefined ? '' : en[key], en_fix: '', ro_fix: '', comment: '',
}));

const columns = [
  { key: 'screen', header: 'Screen', width: 26 }, { key: 'key', header: 'Key (do not change)', width: 30 },
  { key: 'ro', header: 'Romanian (current)', width: 60 }, { key: 'en', header: 'English (current)', width: 60 },
  { key: 'en_fix', header: 'English corrected', width: 50 }, { key: 'ro_fix', header: 'Romanian corrected', width: 50 }, { key: 'comment', header: 'Comment', width: 40 },
];
const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'revizie-texte.xlsx');
fs.writeFileSync(out, toXlsx([{ name: 'Texts', columns, rows }]));
console.log(`${rows.length} texts written to ${out}`);
