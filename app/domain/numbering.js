'use strict';
// Numbering patterns, set in the application (Setări → Numerotare). Tokens: {yyyy} {yy} {mm} {seq:N} (counter, N digits) {team} (the team's short code).
// The counter restarts when the year or month in the pattern changes, and is kept per team when the pattern has {team}.
const settings = require('./settings');

const DEFAULTS = { task: '{team}-{yyyy}-{seq:4}', ncr: 'NC-{yyyy}-{seq:3}', meeting: 'S-{yyyy}-{mm}-{seq:2}' };
const TEAM_CODES = { maintenance: 'MT', technical: 'TH', quality: 'QC' };
const RULES = Object.keys(DEFAULTS);
const TOKEN = /\{(yyyy|yy|mm|team|seq(?::([1-9]))?)\}/g;

/** @returns {string|null} an error code or null when the pattern is usable */
function validate(pattern) {
  const p = String(pattern || '').trim();
  if (!p) return 'required';
  if (p.length > 60) return 'too_long';
  const rest = p.replace(TOKEN, '');
  if (/[{}]/.test(rest) || !/^[A-Za-z0-9._\-\/ ]*$/.test(rest)) return 'invalid';
  const seqs = p.match(/\{seq(?::[1-9])?\}/g) || [];
  if (seqs.length !== 1) return 'seq_once';
  return null;
}

function format(pattern, n, { team, date, teamCode } = {}) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const pad = (x, w) => String(x).padStart(w, '0');
  return String(pattern).replace(TOKEN, (m, tok, digits) => {
    if (tok === 'yyyy') return String(d.getFullYear());
    if (tok === 'yy') return pad(d.getFullYear() % 100, 2);
    if (tok === 'mm') return pad(d.getMonth() + 1, 2);
    if (tok === 'team') return teamCode || team || '';
    return pad(n, Number(digits) || 1);
  });
}

const teamCode = (db, team) => String(settings.get(db, `team.code.${team}`) || TEAM_CODES[team] || '').trim();
const patternOf = (db, rule) => settings.get(db, `numbering.${rule}`) || DEFAULTS[rule];

/** What restarts the counter for this pattern: year and / or month and / or team. */
function scopeOf(pattern, d, team) {
  const parts = [];
  if (/\{yyyy\}|\{yy\}/.test(pattern)) parts.push(d.getFullYear());
  if (/\{mm\}/.test(pattern)) parts.push(d.getMonth() + 1);
  if (/\{team\}/.test(pattern)) parts.push(team || '');
  return parts.join('|');
}

/** The next number of a rule ("task", "ncr", "meeting"), taken and recorded in one step. Call inside a transaction when creating the record. */
function next(db, rule, { team, date } = {}) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const pattern = patternOf(db, rule);
  const scope = scopeOf(pattern, d, team);
  db.run('INSERT INTO numbering_counters(rule, scope, last) VALUES (?, ?, 1) ON CONFLICT(rule, scope) DO UPDATE SET last = last + 1', rule, scope);
  const n = db.value('SELECT last FROM numbering_counters WHERE rule = ? AND scope = ?', rule, scope);
  return format(pattern, n, { team, date: d, teamCode: team ? teamCode(db, team) : '' });
}

const preview = (db, pattern, team) => format(pattern, 1, { team: team || 'maintenance', teamCode: teamCode(db, team || 'maintenance'), date: new Date() });

module.exports = { DEFAULTS, TEAM_CODES, RULES, validate, format, next, preview, patternOf, teamCode };
