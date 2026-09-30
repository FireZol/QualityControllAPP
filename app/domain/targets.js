'use strict';
// Engineering targets and thresholds that used to be constants. Editable by an Inginer (Date de bază -> Ținte și praguri),
// stored as one JSON value in `settings` and audited. Everything that needs one reads it from here.
const settings = require('./settings');
const audit = require('./audit');

const DEFAULTS = {
  temp_min: 0, temp_max: 40,        // °C: outside this range the resistance correction is still computed, with a warning
  sample_mm: 1000, r_sample_m: 5,   // default mass sample length [mm] and resistance sample length [m]
  cpk_good: 1.33, cpk_min: 1.0,     // Cpk colouring: >= good green, >= min amber, below red
  min_n: 30,                        // below this many values Cp / Cpk are marked indicative
  mass_ratio_min: 0.99, mass_ratio_max: 1.01, // ±1 % (owner, 2026-09-30); // wires x wire mass vs sheet mass: outside this band a warning is raised
  spc_min_n: 20, spc_window: 100, spc_recent: 10, // control charts: values needed before alerts, how far back, how many latest values raise an alert
};

/** name -> [label key is in i18n, min, max, integer?] */
const LIMITS = {
  temp_min: [-50, 100], temp_max: [-50, 150], sample_mm: [10, 100000], r_sample_m: [0.1, 1000],
  cpk_good: [0.1, 10], cpk_min: [0.1, 10], min_n: [2, 1000, true], mass_ratio_min: [0.1, 1], mass_ratio_max: [1, 5],
  spc_min_n: [8, 1000, true], spc_window: [20, 5000, true], spc_recent: [1, 100, true],
};

function get(db) {
  const stored = settings.get(db, 'targets');
  return { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

/** @returns {{values}|{errors}} from a Form (numbers accept the decimal comma) */
function validate(form, parse) {
  const errors = {};
  const values = {};
  for (const [k, [lo, hi, integer]] of Object.entries(LIMITS)) {
    const n = parse(form.get(k, ''));
    if (n === null || n < lo || n > hi || (integer && !Number.isInteger(n))) errors[k] = 'invalid';
    else values[k] = n;
  }
  if (!errors.temp_min && !errors.temp_max && values.temp_min >= values.temp_max) errors.temp_max = 'invalid';
  if (!errors.cpk_min && !errors.cpk_good && values.cpk_min > values.cpk_good) errors.cpk_good = 'invalid';
  return Object.keys(errors).length ? { errors } : { values };
}

function save(db, userId, values) {
  const before = get(db);
  db.tx(() => {
    settings.set(db, 'targets', values);
    audit.log(db, userId, 'targets_change', 'settings', null, { before, after: values });
  });
}

module.exports = { DEFAULTS, LIMITS, get, validate, save };
