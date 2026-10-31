'use strict';
// The formula language of calculated fields (owner 2026-10-31: formulas editable inside the app, by administrators).
// A formula is DATA, read by this small parser and evaluated by a tree walk: there is no eval, no function constructor, no access to files, the
// network or the database, no loop and no recursion, so a formula can only ever produce a number or an error. The same file runs in the browser
// (live preview while writing, live result in forms) and on the server (the result that is saved).
//
//   numbers       12   0.5   0,5          fields   {12} (stored form)   [Field name] (as typed; turned into {id} by toStored)
//   arithmetic    + - * / ^  and brackets      compare  < > <= >= = <>  (1 = true, 0 = false)      logic  and  or  not
//   functions     round(x; n)  floor  ceil  abs  sqrt  pow(x; y)  min  max  avg  sum  if(c; a; b)  empty(x)  today()
//   arguments are separated by ;   dates count as days, so [End] - [Start] is the number of days between them
//   an empty field makes the result empty (an unfilled input is not zero); min / max / avg / sum skip empty values; if() only looks at the branch it takes
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CTC_FORMULA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_LEN = 500;
  const MAX_DEPTH = 24;
  const MAX_NODES = 150;
  const FUNCS = { round: [1, 2], floor: [1, 1], ceil: [1, 1], abs: [1, 1], sqrt: [1, 1], pow: [2, 2], min: [1, 20], max: [1, 20], avg: [1, 20], sum: [1, 20], if: [3, 3], empty: [1, 1], today: [0, 0] };
  const REL_TOL = 1e-9;

  class FormulaError extends Error {
    constructor(code, pos) { super(code); this.code = code; this.pos = pos === undefined ? -1 : pos; }
  }

  // ---------------------------------------------------------------- tokens
  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      let m;
      const rest = src.slice(i);
      if ((m = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)/.exec(rest))) { out.push({ k: 'num', v: Number(m[0].replace(',', '.')), pos: i }); i += m[0].length; continue; }
      if ((m = /^\{(\d{1,9})\}/.exec(rest))) { out.push({ k: 'ref', v: Number(m[1]), pos: i }); i += m[0].length; continue; }
      if ((m = /^[A-Za-zĂÂÎȘȚăâîșțşţ_][A-Za-z0-9ĂÂÎȘȚăâîșțşţ_]*/.exec(rest))) { out.push({ k: 'id', v: m[0].toLowerCase(), pos: i }); i += m[0].length; continue; }
      if ((m = /^(?:<=|>=|<>|[+\-*/^()<>=;])/.exec(rest))) { out.push({ k: 'op', v: m[0], pos: i }); i += m[0].length; continue; }
      throw new FormulaError('syntax', i);
    }
    return out;
  }

  // ---------------------------------------------------------------- parser (recursive descent; depth and size are capped)
  function parse(src) {
    try {
      const text = String(src === undefined || src === null ? '' : src);
      if (!text.trim()) return { ok: false, code: 'empty', pos: 0 };
      if (text.length > MAX_LEN) return { ok: false, code: 'too_long', pos: MAX_LEN };
      const toks = tokenize(text);
      let p = 0; let nodes = 0;
      const peek = () => toks[p];
      const isOp = (v) => toks[p] && toks[p].k === 'op' && toks[p].v === v;
      const isKw = (v) => toks[p] && toks[p].k === 'id' && toks[p].v === v;
      const node = (n, depth) => { if (++nodes > MAX_NODES) throw new FormulaError('too_big', toks[Math.min(p, toks.length - 1)] ? toks[Math.min(p, toks.length - 1)].pos : 0); if (depth > MAX_DEPTH) throw new FormulaError('too_deep', toks[Math.min(p, toks.length - 1)].pos); return n; };
      const expect = (v) => { if (!isOp(v)) throw new FormulaError('syntax', toks[p] ? toks[p].pos : text.length); p++; };

      function orExpr(d) { let a = andExpr(d); while (isKw('or')) { p++; const b = andExpr(d); a = node({ t: 'or', a, b }, d); } return a; }
      function andExpr(d) { let a = notExpr(d); while (isKw('and')) { p++; const b = notExpr(d); a = node({ t: 'and', a, b }, d); } return a; }
      function notExpr(d) { if (isKw('not')) { p++; return node({ t: 'not', a: notExpr(d + 1) }, d); } return cmpExpr(d); }
      function cmpExpr(d) {
        const a = addExpr(d);
        const t = peek();
        if (t && t.k === 'op' && ['<', '>', '<=', '>=', '=', '<>'].includes(t.v)) { p++; const b = addExpr(d); return node({ t: 'cmp', op: t.v, a, b }, d); }
        return a;
      }
      function addExpr(d) { let a = mulExpr(d); while (isOp('+') || isOp('-')) { const op = toks[p++].v; const b = mulExpr(d); a = node({ t: 'bin', op, a, b }, d); } return a; }
      function mulExpr(d) { let a = powExpr(d); while (isOp('*') || isOp('/')) { const op = toks[p++].v; const b = powExpr(d); a = node({ t: 'bin', op, a, b }, d); } return a; }
      function powExpr(d) { const a = unary(d); if (isOp('^')) { p++; const b = unary(d + 1); return node({ t: 'bin', op: '^', a, b }, d); } return a; }
      function unary(d) { if (isOp('-')) { p++; return node({ t: 'neg', a: unary(d + 1) }, d); } if (isOp('+')) { p++; return unary(d + 1); } return primary(d + 1); }
      function primary(d) {
        const t = toks[p];
        if (!t) throw new FormulaError('syntax', text.length);
        if (t.k === 'num') { p++; return node({ t: 'num', v: t.v }, d); }
        if (t.k === 'ref') { p++; return node({ t: 'ref', id: t.v }, d); }
        if (t.k === 'op' && t.v === '(') { p++; const e = orExpr(d + 1); expect(')'); return e; }
        if (t.k === 'id') {
          if (['and', 'or', 'not'].includes(t.v)) throw new FormulaError('syntax', t.pos);
          p++;
          if (!isOp('(')) throw new FormulaError('unknown_function', t.pos);   // a bare word: names of fields go in [square brackets]
          if (!Object.prototype.hasOwnProperty.call(FUNCS, t.v)) throw new FormulaError('unknown_function', t.pos);
          p++;
          const args = [];
          if (!isOp(')')) { for (;;) { args.push(orExpr(d + 1)); if (isOp(';')) { p++; continue; } break; } }
          expect(')');
          const [lo, hi] = FUNCS[t.v];
          if (args.length < lo || args.length > hi) throw new FormulaError('arg_count', t.pos);
          return node({ t: 'call', name: t.v, args }, d);
        }
        throw new FormulaError('syntax', t.pos);
      }
      const ast = orExpr(0);
      if (p < toks.length) throw new FormulaError('syntax', toks[p].pos);
      return { ok: true, ast };
    } catch (e) {
      if (e instanceof FormulaError) return { ok: false, code: e.code, pos: e.pos };
      if (e instanceof RangeError) return { ok: false, code: 'too_deep', pos: 0 };
      throw e;
    }
  }

  /** The field ids a parsed formula uses. */
  function refs(ast) {
    const out = new Set();
    (function walk(n) {
      if (!n) return;
      if (n.t === 'ref') out.add(n.id);
      for (const k of ['a', 'b']) if (n[k]) walk(n[k]);
      if (n.args) n.args.forEach(walk);
    })(ast);
    return [...out];
  }

  // ---------------------------------------------------------------- evaluation
  const same = (a, b) => Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b));
  const finite = (x) => { if (!Number.isFinite(x)) throw new FormulaError('range'); return x; };

  /** Round half away from zero at `digits` decimals, without the usual binary surprises (1.005 -> 1.01). */
  function roundTo(x, digits) {
    const n = Math.min(Math.max(Math.trunc(digits), 0), 9);
    const sign = x < 0 ? -1 : 1;
    const v = Math.abs(x);
    const r = Number(Math.round(Number(`${v}e${n}`)) + `e-${n}`);
    return Number.isFinite(r) ? sign * r : sign * v;
  }

  /**
   * @param ast  from parse()
   * @param ctx  {get(id) -> number | null (empty), today: number (days since 1970-01-01)}
   * @returns number | null (empty); throws FormulaError('div0' | 'range' | 'domain' | 'digits')
   */
  function evaluate(ast, ctx) {
    const ev = (n) => {
      switch (n.t) {
        case 'num': return n.v;
        case 'ref': { const v = ctx.get(n.id); return v === undefined || v === null || Number.isNaN(v) ? null : v; }
        case 'neg': { const a = ev(n.a); return a === null ? null : -a; }
        case 'not': { const a = ev(n.a); return a === null ? null : (a === 0 ? 1 : 0); }
        case 'and': { const a = ev(n.a); const b = ev(n.b); if (a === 0 || b === 0) return 0; return a === null || b === null ? null : 1; }
        case 'or': { const a = ev(n.a); const b = ev(n.b); if ((a !== null && a !== 0) || (b !== null && b !== 0)) return 1; return a === null || b === null ? null : 0; }
        case 'cmp': {
          const a = ev(n.a); const b = ev(n.b);
          if (a === null || b === null) return null;
          const r = n.op === '<' ? a < b && !same(a, b) : n.op === '>' ? a > b && !same(a, b) : n.op === '<=' ? a < b || same(a, b) : n.op === '>=' ? a > b || same(a, b) : n.op === '=' ? same(a, b) : !same(a, b);
          return r ? 1 : 0;
        }
        case 'bin': {
          const a = ev(n.a); const b = ev(n.b);
          if (a === null || b === null) return null;
          if (n.op === '+') return finite(a + b);
          if (n.op === '-') return finite(a - b);
          if (n.op === '*') return finite(a * b);
          if (n.op === '/') { if (b === 0) throw new FormulaError('div0'); return finite(a / b); }
          if (a < 0 && !Number.isInteger(b)) throw new FormulaError('domain');
          return finite(Math.pow(a, b));
        }
        case 'call': return call(n);
        default: throw new FormulaError('syntax');
      }
    };
    const call = (n) => {
      const name = n.name;
      if (name === 'if') { const c = ev(n.args[0]); if (c === null) return null; return ev(c !== 0 ? n.args[1] : n.args[2]); }
      if (name === 'empty') return ev(n.args[0]) === null ? 1 : 0;
      if (name === 'today') return ctx.today;
      const vals = n.args.map(ev);
      if (name === 'min' || name === 'max' || name === 'avg' || name === 'sum') {
        const xs = vals.filter((v) => v !== null);
        if (!xs.length) return null;
        if (name === 'min') return Math.min(...xs);
        if (name === 'max') return Math.max(...xs);
        const s = xs.reduce((a, b) => a + b, 0);
        return finite(name === 'sum' ? s : s / xs.length);
      }
      const x = vals[0];
      if (x === null) return null;
      if (name === 'round') {
        const d = vals.length > 1 ? vals[1] : 0;
        if (d === null) return null;
        if (!Number.isInteger(d) || d < 0 || d > 9) throw new FormulaError('digits');
        return roundTo(x, d);
      }
      if (name === 'floor') return Math.floor(x);
      if (name === 'ceil') return Math.ceil(x);
      if (name === 'abs') return Math.abs(x);
      if (name === 'sqrt') { if (x < 0) throw new FormulaError('domain'); return Math.sqrt(x); }
      if (name === 'pow') { const y = vals[1]; if (y === null) return null; if (x < 0 && !Number.isInteger(y)) throw new FormulaError('domain'); return finite(Math.pow(x, y)); }
      throw new FormulaError('syntax');
    };
    const v = ev(ast);
    return v === null ? null : finite(v);
  }

  // ---------------------------------------------------------------- names <-> ids
  const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

  /**
   * Turn "[Field name] * 2" into "{12} * 2". `fields`: [{id, label, label_en}] the formula may use.
   * @returns {ok, text} | {ok: false, code: 'unknown_field' | 'ambiguous_field' | 'syntax', name}
   */
  function toStored(text, fields) {
    const src = String(text === undefined || text === null ? '' : text);
    let bad = null;
    const out = src.replace(/\[([^\[\]]{1,80})\]/g, (all, name) => {
      const key = norm(name);
      const hits = fields.filter((f) => norm(f.label) === key || (f.label_en && norm(f.label_en) === key));
      const ids = [...new Set(hits.map((h) => h.id))];
      if (ids.length === 1) return `{${ids[0]}}`;
      if (!bad) bad = { code: ids.length ? 'ambiguous_field' : 'unknown_field', name };
      return all;
    });
    if (bad) return { ok: false, code: bad.code, name: bad.name };
    if (/[\[\]]/.test(out)) return { ok: false, code: 'syntax', name: '' };
    return { ok: true, text: out };
  }

  /** "{12} * 2" -> "[Field name] * 2" in the reader's language. */
  function toDisplay(stored, fields, lang) {
    return String(stored || '').replace(/\{(\d{1,9})\}/g, (all, id) => {
      const f = fields.find((x) => x.id === Number(id));
      if (!f) return `[?${id}]`;
      return `[${lang === 'en' && f.label_en ? f.label_en : f.label}]`;
    });
  }

  // ---------------------------------------------------------------- values
  const DAY = 86400000;
  /** A stored / typed value of a field as the number a formula sees: numbers as they are, yes/no as 1 / 0, dates as days since 1970; empty / unreadable = null. */
  function numberOf(type, raw) {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (s === '') return null;
    if (type === 'date') { const t = Date.parse(`${s}T00:00:00Z`); return Number.isNaN(t) ? null : Math.floor(t / DAY); }
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  const todayNumber = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY);

  /** A result as the canonical text that is stored (no trailing zeros), rounded to `decimals` when given. */
  function toText(value, decimals) {
    if (value === null || value === undefined) return '';
    const v = decimals === null || decimals === undefined ? value : roundTo(value, decimals);
    return String(Object.is(v, -0) ? 0 : v);
  }

  return { MAX_LEN, FUNCS: Object.keys(FUNCS), FormulaError, parse, refs, evaluate, roundTo, toStored, toDisplay, numberOf, todayNumber, toText };
});
