'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Raw } = require('./html');

const MAX_BODY = 1024 * 1024;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
};

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch (_) { /* keep raw */ }
    if (k) out[k] = v;
  }
  return out;
}

function cookie(name, value, opts) {
  const o = opts || {};
  let s = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict`;
  if (o.maxAge !== undefined) s += `; Max-Age=${o.maxAge}`;
  return s;
}

/** Parsed application/x-www-form-urlencoded body. */
class Form {
  constructor(params) { this.params = params || new URLSearchParams(); }
  get(k, d) { const v = this.params.get(k); return v === null ? (d === undefined ? '' : d) : v; }
  all(k) { return this.params.getAll(k); }
  has(k) { return this.params.has(k); }
  int(k) { const v = this.params.get(k); return v !== null && /^\d+$/.test(v.trim()) ? Number(v) : null; }
  bool(k) { return this.params.has(k) && this.params.get(k) !== '0' && this.params.get(k) !== ''; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ----- response builders (handlers return these; the server writes them) -----

function page(body, status) {
  return { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: body instanceof Raw ? body.s : String(body) };
}

function redirect(location, opts) {
  const o = opts || {};
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  const cookies = [];
  if (o.flash) cookies.push(cookie('ctc_flash', `${o.flash.type || 'ok'}:${o.flash.key}`, { maxAge: 60 }));
  return { status: 303, headers, cookies, body: '' };
}

function json(obj, status) {
  return { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

function text(body, status, filename) {
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
  if (filename) headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  return { status: status || 200, headers, body };
}

function staticFile(file, cache) {
  let st;
  try { st = fs.statSync(file); } catch (_) { return null; }
  if (!st.isFile()) return null;
  const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
  return {
    status: 200,
    headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache', ETag: etag },
    file,
    etag,
  };
}

/** Resolve a request path below a base directory; refuses anything that escapes it. */
function safeJoin(base, rel) {
  let dec;
  try { dec = decodeURIComponent(rel); } catch (_) { return null; }
  if (dec.includes('\0')) return null;
  const full = path.resolve(base, '.' + path.sep + dec);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

const randomToken = (bytes) => crypto.randomBytes(bytes || 32).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { SECURITY_HEADERS, parseCookies, cookie, Form, readBody, page, redirect, json, text, staticFile, safeJoin, randomToken, sha256, safeEqual };
