'use strict';
// Minimal router: exact segments and :params.
class Router {
  constructor() { this.routes = []; }

  add(method, pattern, opts, handler) {
    const segs = pattern.split('/').filter(Boolean);
    this.routes.push({ method, pattern, segs, opts: opts || {}, handler });
  }
  get(p, o, h) { this.add('GET', p, o, h); }
  post(p, o, h) { this.add('POST', p, o, h); }

  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.segs.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < r.segs.length; i++) {
        const s = r.segs[i];
        if (s[0] === ':') {
          try { params[s.slice(1)] = decodeURIComponent(parts[i]); } catch (_) { ok = false; break; }
        } else if (s !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { route: r, params };
    }
    return { route: null, params: null, pathMatched };
  }
}

module.exports = { Router };
