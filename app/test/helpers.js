'use strict';
process.env.CTC_STRICT_I18N = '1';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');

/** Start an app on an ephemeral port with its own temp folders. */
async function startApp(extra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-test-'));
  const config = {
    root, port: 0, bind: '127.0.0.1', publicName: '',
    dataDir: path.join(root, 'data'), backupDir: path.join(root, 'backups'), seedDir: path.resolve(__dirname, '..', '..', 'seed'),
    envPort: null, envBind: null,
  };
  const logs = [];
  const app = await createApp(config, { listen: { port: 0, host: '127.0.0.1' }, log: (m) => logs.push(m), noScheduler: true, ...(extra || {}) });
  await app.start();
  app.base = `http://127.0.0.1:${app.address.port}`;
  app.logs = logs;
  app.root = root;
  app.cleanup = async () => { await app.stop(); fs.rmSync(root, { recursive: true, force: true }); };
  return app;
}

/** Tiny browser: cookie jar, no redirects followed automatically. */
class Client {
  constructor(base) { this.base = base; this.jar = {}; }

  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }

  async req(method, url, body) {
    const headers = { Cookie: this.cookieHeader() };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = body instanceof URLSearchParams ? body.toString() : new URLSearchParams(body).toString();
    }
    const res = await fetch(this.base + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = decodeURIComponent(pair.slice(i + 1));
      if (/Max-Age=0/i.test(c) || v === '') delete this.jar[k]; else this.jar[k] = v;
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }

  get(url) { return this.req('GET', url); }

  /** Follow redirects until a non-3xx. */
  async follow(method, url, body) {
    let r = await this.req(method, url, body);
    for (let i = 0; i < 6 && r.status >= 300 && r.status < 400; i++) r = await this.req('GET', r.location);
    return r;
  }

  csrfOf(html) {
    const m = /name="_csrf" value="([^"]+)"/.exec(html);
    return m ? m[1] : null;
  }

  /** GET a page, take its CSRF token, POST the fields. */
  async postForm(pageUrl, action, fields, opts) {
    const p = await this.get(pageUrl);
    const token = this.csrfOf(p.text);
    if (!token) throw new Error(`no csrf token on ${pageUrl} (status ${p.status})`);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach((x) => params.append(k, x)); else params.append(k, v);
    }
    params.set('_csrf', token);
    const r = await this.req('POST', action, params);
    return opts && opts.follow ? this.follow('GET', r.location || pageUrl) : r;
  }

  async login(username, password) {
    const p = await this.get('/login');
    const token = this.csrfOf(p.text);
    return this.req('POST', '/login', { _csrf: token, username, password, next: '/' });
  }
}

module.exports = { startApp, Client };
