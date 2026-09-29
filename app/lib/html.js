'use strict';
// Escaping. Every value that reaches the page goes through h() or the html`` tag (which calls h()).
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a plain value for HTML text or attribute context. */
function h(v) {
  if (v instanceof Raw) return v.s;
  if (v === null || v === undefined || v === false) return '';
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

function part(v) {
  if (Array.isArray(v)) return v.map(part).join('');
  return h(v);
}

/** Tagged template: interpolations are escaped unless wrapped in raw() / produced by html``. */
function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Raw(out);
}

/** JSON for a <script type="application/json"> block: cannot break out of the tag. */
function jsonBlock(obj) {
  return raw(JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
}

module.exports = { Raw, raw, h, html, jsonBlock };
