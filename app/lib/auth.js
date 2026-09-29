'use strict';
const crypto = require('node:crypto');
const { randomToken, sha256 } = require('./http');
const { nowIso } = require('./time');
const settings = require('../domain/settings');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const LOCK_FAILS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MIN_PASSWORD = 8;

function scrypt(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFC'), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** scrypt$N$r$p$salt$hash (base64url) */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const params = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), keylen: 64 };
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  const key = await scrypt(password, salt, { ...params, keylen: expected.length });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** One-time password: unambiguous characters only. */
function generatePassword(length) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(length || 12);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

// ---------- lockout ----------

function isLocked(db, username, nowMs) {
  const now = nowMs === undefined ? Date.now() : nowMs;
  const since = now - LOCK_WINDOW_MS;
  const lastOk = db.value('SELECT max(ts_ms) FROM login_attempts WHERE username = ? AND ok = 1', username) || 0;
  const from = Math.max(since, lastOk);
  const fails = db.all('SELECT ts_ms FROM login_attempts WHERE username = ? AND ok = 0 AND ts_ms > ? ORDER BY ts_ms', username, from);
  if (fails.length < LOCK_FAILS) return { locked: false, minutes: 0 };
  const oldest = fails[fails.length - LOCK_FAILS].ts_ms;
  const until = oldest + LOCK_WINDOW_MS;
  return { locked: until > now, minutes: Math.max(1, Math.ceil((until - now) / 60000)) };
}

function recordAttempt(db, username, ok, nowMs) {
  db.run('INSERT INTO login_attempts(username, ts_ms, ok) VALUES (?, ?, ?)', username, nowMs === undefined ? Date.now() : nowMs, ok ? 1 : 0);
  db.run('DELETE FROM login_attempts WHERE ts_ms < ?', (nowMs === undefined ? Date.now() : nowMs) - 24 * 3600 * 1000);
}

// ---------- sessions ----------

function createSession(db, userId) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = nowIso();
  db.run('INSERT INTO sessions(token_hash, user_id, csrf, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', sha256(token), userId, csrf, now, now);
  return token;
}

/** @returns {{user, session}|null}; expired sessions are removed. */
function findSession(db, token) {
  if (!token) return null;
  const hash = sha256(token);
  const s = db.get('SELECT * FROM sessions WHERE token_hash = ?', hash);
  if (!s) return null;
  const idleMs = Number(settings.get(db, 'session.idle_hours')) * 3600 * 1000;
  const last = Date.parse(s.last_seen_at);
  if (Number.isFinite(last) && Date.now() - last > idleMs) {
    db.run('DELETE FROM sessions WHERE token_hash = ?', hash);
    return null;
  }
  const user = db.get('SELECT * FROM users WHERE id = ? AND active = 1', s.user_id);
  if (!user) {
    db.run('DELETE FROM sessions WHERE token_hash = ?', hash);
    return null;
  }
  if (!Number.isFinite(last) || Date.now() - last > 60 * 1000) {
    db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', nowIso(), hash);
  }
  return { user, session: { hash, csrf: s.csrf } };
}

function destroySession(db, token) {
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

function destroyUserSessions(db, userId) {
  db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

function validateNewPassword(pw, username) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return 'password_short';
  if (pw.toLowerCase() === String(username || '').toLowerCase()) return 'password_username';
  return null;
}

const ROLES = ['administrator', 'inginer', 'personal'];

module.exports = {
  hashPassword, verifyPassword, generatePassword,
  isLocked, recordAttempt, createSession, findSession, destroySession, destroyUserSessions,
  validateNewPassword, ROLES, MIN_PASSWORD, LOCK_FAILS,
};
