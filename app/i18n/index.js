'use strict';
// Language support. Romanian (ro.js) is the master dictionary; every other language mirrors its keys and falls back to
// it for anything missing, so a page never breaks. The language of a request is carried in AsyncLocalStorage, so views
// keep writing T.section.key and always get the text of the user being served.
//   T  strict accessor (missing key: ⟦key⟧, or an exception when CTC_STRICT_I18N=1)
//   S  lenient accessor (missing key: undefined) for lookups by a run-time key
//   f  fills {placeholders};  opt  safe lookup with a fallback
const { AsyncLocalStorage } = require('node:async_hooks');
const ro = require('./ro');
const en = require('./en');

const DEFAULT = 'ro';
const LANGUAGES = ['ro', 'en']; // order of the switcher
const NAMES = { ro: 'RO', en: 'EN' };
const STRICT = process.env.CTC_STRICT_I18N === '1';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep copy of `base` with `over` laid on top (arrays and strings are replaced whole). */
function merge(base, over) {
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k];
    const o = over && Object.prototype.hasOwnProperty.call(over, k) ? over[k] : undefined;
    out[k] = isObj(b) ? merge(b, isObj(o) ? o : undefined) : (o !== undefined ? o : b);
  }
  return out;
}

const DICTS = { ro, en: merge(ro, en) };
const als = new AsyncLocalStorage();

const valid = (lang) => LANGUAGES.includes(lang);
const current = () => { const s = als.getStore(); return s && valid(s.lang) ? s.lang : DEFAULT; };

/** Run fn with the given language; the returned store lets the caller change it once the user is known. */
function run(lang, fn) {
  const store = { lang: valid(lang) ? lang : DEFAULT };
  return als.run(store, () => fn(store));
}

function resolve(path) {
  let o = DICTS[current()];
  for (const seg of path) { if (!isObj(o) || !Object.prototype.hasOwnProperty.call(o, seg)) return undefined; o = o[seg]; }
  return o;
}

/** A proxy that reads the current language's dictionary at every access. */
function live(path, strict) {
  const dotted = path.length ? path.join('.') + '.' : '';
  return new Proxy({}, {
    get(_, key) {
      if (typeof key === 'symbol') return undefined;
      const node = resolve(path);
      if (!isObj(node) || !Object.prototype.hasOwnProperty.call(node, key)) {
        if (key === 'toJSON' || key === 'then') return undefined;
        if (!strict) return undefined;
        if (STRICT) throw new Error(`missing i18n key ${dotted}${key}`);
        return `⟦${dotted}${key}⟧`;
      }
      const v = node[key];
      return isObj(v) ? live(path.concat(key), strict) : v;
    },
    has(_, key) { const n = resolve(path); return isObj(n) && Object.prototype.hasOwnProperty.call(n, key); },
    ownKeys() { const n = resolve(path); return isObj(n) ? Object.keys(n) : []; },
    getOwnPropertyDescriptor(_, key) {
      const n = resolve(path);
      return isObj(n) && Object.prototype.hasOwnProperty.call(n, key) ? { value: n[key], enumerable: true, configurable: true, writable: true } : undefined;
    },
  });
}

const T = live([], true);
const S = live([], false);

/** Fill {placeholders} in a string. */
function f(str, params) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined && params[k] !== null ? String(params[k]) : ''));
}

/** Safe lookup for keys built at run time: S[section][key] or the fallback (never throws). */
function opt(section, key, fallback) {
  const d = DICTS[current()];
  return d[section] && Object.prototype.hasOwnProperty.call(d[section], key) ? d[section][key] : fallback;
}

module.exports = { T, S, f, opt, run, current, valid, LANGUAGES, NAMES, DEFAULT, DICTS, raw: { ro, en } };
