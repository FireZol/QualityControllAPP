'use strict';
// All formulas and verdict logic live here. Pure functions, no I/O.
// This file is loaded by Node (require) and by the browser (/static/calc.js -> window.CTC_CALC)
// so the live preview in the measurement form can never drift from the server.
// Never round before computing a verdict (ADR-014): rounding happens only in the format* helpers.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CTC_CALC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TEMP_MIN = 0;
  const TEMP_MAX = 40;

  /** Parse a user-typed decimal ("608,5", "608.5", " 1 000,5 "). Returns a finite number or null. */
  function parseDecimal(text) {
    if (typeof text === 'number') return Number.isFinite(text) ? text : null;
    if (text === null || text === undefined) return null;
    let s = String(text).trim().replace(/\s+/g, '');
    if (s === '') return null;
    // a single separator only: "1,234.5" is ambiguous and refused
    const seps = s.match(/[.,]/g);
    if (seps && seps.length > 1) return null;
    s = s.replace(',', '.');
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Mass per metre [g/m] from a sample: g on mm. */
  function massPerMetre(massG, sampleMm) {
    return (massG / sampleMm) * 1000;
  }

  const diameterAverage = (d1, d2) => (d1 + d2) / 2;
  const ovality = (d1, d2) => Math.abs(d1 - d2);

  /** IEC 60228 Annex B temperature factor, per material alpha20. */
  function kt(tempC, alpha20) {
    return 1 / (1 + alpha20 * (tempC - 20));
  }

  const temperatureOutOfRange = (tempC, min, max) => tempC < (min === undefined ? TEMP_MIN : min) || tempC > (max === undefined ? TEMP_MAX : max);

  /** Resistance per km from what the instrument shows. unit: 'ohm_km' | 'ohm' (then sample length in m). */
  function resistancePerKm(value, unit, sampleM) {
    return unit === 'ohm' ? (value / sampleM) * 1000 : value;
  }

  const resistanceAt20 = (perKm, tempC, alpha20) => perKm * kt(tempC, alpha20);

  /** Strand (toron) measured for a stranded flexible conductor, reported to the finished conductor. */
  const resistanceEquivalent = (r20Strand, nStrands) => r20Strand / nStrands;

  /** Cross-section [mm²] from mass [g/m] and density [g/cm³]. */
  const areaFromMass = (massGm, density) => massGm / density;
  const equivalentDiameter = (areaMm2) => Math.sqrt((4 * areaMm2) / Math.PI);
  /** Theoretical resistance [Ω/km] at 20 °C from the area and rho20 [Ω·mm²/m]. */
  const theoreticalResistance = (rho20, areaMm2) => (1000 * rho20) / areaMm2;

  /** ADR-007 verdict. Never rounds. */
  function verdict(value, min, max, informative) {
    if (informative) return 'info';
    const hasMin = min !== null && min !== undefined;
    const hasMax = max !== null && max !== undefined;
    if (!hasMin && !hasMax) return 'nedeterminat';
    if (hasMin && value < min) return 'sub';
    if (hasMax && value > max) return 'peste';
    return 'ok';
  }

  /** (R20 − Rmax) / Rmax in %, positive = above the limit. */
  const deviationPercent = (r20, rMax) => ((r20 - rMax) / rMax) * 100;

  const isOut = (v) => v === 'sub' || v === 'peste';

  // ---------- formatting (display only, Romanian decimal comma) ----------

  function trimTo(str, minDecimals) {
    if (str.indexOf('.') === -1) return str;
    let [i, f] = str.split('.');
    while (f.length > minDecimals && f.endsWith('0')) f = f.slice(0, -1);
    return f.length ? i + '.' + f : i;
  }

  /** Fixed decimals between min and max (trailing zeros trimmed down to min). Decimal comma. */
  function formatNumber(v, minDecimals, maxDecimals) {
    if (v === null || v === undefined || Number.isNaN(v)) return '';
    const mn = minDecimals === undefined ? 0 : minDecimals;
    const mx = maxDecimals === undefined ? mn : maxDecimals;
    return trimTo(Number(v).toFixed(mx), mn).replace('.', ',');
  }

  /** Significant digits (resistance: 4). Decimal comma. */
  function formatSignificant(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return '';
    if (v === 0) return '0';
    const d = digits === undefined ? 4 : digits;
    const decimals = Math.max(0, d - 1 - Math.floor(Math.log10(Math.abs(v))));
    return Number(v).toFixed(Math.min(decimals, 12)).replace('.', ',');
  }

  const SIGNED = (v, dec) => (v > 0 ? '+' : '') + formatNumber(v, dec, dec);

  /** How each derived quantity is displayed (ADR-014). */
  function formatQuantity(quantity, v) {
    if (v === null || v === undefined) return '';
    switch (quantity) {
      case 'd1': case 'd2': case 'd_avg': case 'ovality': case 'h': case 'l': case 'd_ech':
        return formatNumber(v, 1, 2);
      case 'mass_gm':
        return formatNumber(v, 1, 2);
      case 'r20': case 'r20_theor': case 'r20_echiv':
        return formatSignificant(v, 4);
      default:
        return formatNumber(v, 0, 3);
    }
  }

  // ---------- one measurement, evaluated ----------

  /**
   * Evaluate one measurement.
   * @param {object} inputs  raw typed values: d1,d2,h,l,mass_g,sample_mm,r_value,r_unit,r_sample_m,temp_c
   * @param {object} ctx
   *   shapeKind   'rotund' | 'sector'
   *   material    { rho20, density, alpha20 }
   *   limits      { d|h|l|mass : {min,max,informative} }   (from the revision's `limits`)
   *   iec         { r_max, source } | null                 (resistance limit of the finished conductor)
   *   measuresR   true when measured resistance applies to this family + material
   *   measuresMass / theoretical / measuresDiameter   false to skip that part; default true
   *   targets     {temp_min, temp_max, sample_mm, r_sample_m}: editable thresholds and defaults (domain/targets.js)
   *   rEquivN     number of strands: the measured resistance is a strand's, reported to the finished conductor
   * @returns {{results: object[], warnings: string[], errors: string[]}}
   */
  function evaluate(inputs, ctx) {
    const results = [];
    const warnings = [];
    const errors = [];
    const lim = ctx.limits || {};
    const num = (k) => parseDecimal(inputs[k]);

    function push(quantity, value, limit, opts) {
      const o = opts || {};
      const min = limit ? limit.min : null;
      const max = limit ? limit.max : null;
      const v = o.verdict !== undefined ? o.verdict : verdict(value, min, max, limit ? !!limit.informative : false);
      results.push({
        quantity, value,
        lim_min: min === undefined ? null : min,
        lim_max: max === undefined ? null : max,
        verdict: v,
        deviation_pct: o.deviation_pct === undefined ? null : o.deviation_pct,
        source: o.source || (limit ? 'fisa' : 'calculat'),
      });
    }

    // diameter (families without a diameter, e.g. flexible conductors, skip it)
    if (ctx.measuresDiameter === false) {
      // nothing to read
    } else if (ctx.shapeKind === 'sector') {
      const h = num('h'), l = num('l');
      if (h === null) errors.push('h'); else push('h', h, lim.h);
      if (l === null) errors.push('l'); else push('l', l, lim.l);
    } else {
      const d1 = num('d1'), d2 = num('d2');
      if (d1 === null) errors.push('d1');
      if (d2 === null) errors.push('d2');
      if (d1 !== null && d2 !== null) {
        push('d1', d1, lim.d);
        push('d2', d2, lim.d);
        push('d_avg', diameterAverage(d1, d2), null, { verdict: 'info' });
        push('ovality', ovality(d1, d2), null, { verdict: 'info' });
      }
    }

    // mass and theoretical resistance (families that do not weigh, e.g. class 5 wire, skip both)
    const massG = num('mass_g');
    let sampleMm = num('sample_mm');
    if (inputs.sample_mm === undefined || inputs.sample_mm === '' || inputs.sample_mm === null) sampleMm = (ctx.targets && ctx.targets.sample_mm) || 1000;
    if (ctx.measuresMass !== false) {
      if (massG === null) errors.push('mass_g');
      if (sampleMm === null || sampleMm <= 0) errors.push('sample_mm');
      if (massG !== null && massG <= 0) errors.push('mass_g');
    }
    if (ctx.measuresMass !== false && massG !== null && massG > 0 && sampleMm !== null && sampleMm > 0) {
      const gm = massPerMetre(massG, sampleMm);
      push('mass_gm', gm, lim.mass);
      if (ctx.theoretical !== false) {
        const area = areaFromMass(gm, ctx.material.density);
        push('d_ech', equivalentDiameter(area), null, { verdict: 'info' });
        const rt = theoreticalResistance(ctx.material.rho20, area);
        const rMax = ctx.iec ? ctx.iec.r_max : null;
        push('r20_theor', rt, rMax === null || rMax === undefined ? null : { min: null, max: rMax },
          {
            source: ctx.iec ? ctx.iec.source : 'calculat',
            deviation_pct: rMax ? deviationPercent(rt, rMax) : null,
          });
      }
    }

    // measured resistance (optional, copper for now)
    const rRaw = inputs.r_value;
    const rGiven = rRaw !== undefined && rRaw !== null && String(rRaw).trim() !== '';
    if (ctx.measuresR && rGiven) {
      const rv = num('r_value');
      const unit = inputs.r_unit === 'ohm' ? 'ohm' : 'ohm_km';
      let rs = num('r_sample_m');
      if (unit === 'ohm' && (inputs.r_sample_m === undefined || inputs.r_sample_m === '' || inputs.r_sample_m === null)) rs = (ctx.targets && ctx.targets.r_sample_m) || 5;
      const t = num('temp_c');
      if (rv === null || rv <= 0) errors.push('r_value');
      if (unit === 'ohm' && (rs === null || rs <= 0)) errors.push('r_sample_m');
      if (t === null) errors.push('temp_c');
      if (rv !== null && rv > 0 && t !== null && !(unit === 'ohm' && (rs === null || rs <= 0))) {
        if (temperatureOutOfRange(t, ctx.targets && ctx.targets.temp_min, ctx.targets && ctx.targets.temp_max)) warnings.push('temp_range');
        const perKm = resistancePerKm(rv, unit, rs);
        const r20 = resistanceAt20(perKm, t, ctx.material.alpha20);
        const rMax = ctx.iec ? ctx.iec.r_max : null;
        const limit = rMax === null || rMax === undefined ? null : { min: null, max: rMax };
        if (ctx.rEquivN) {
          // strand (toron) measured, reported to the finished conductor: R20 / number of strands (spec §5)
          push('r20', r20, null, { verdict: 'info', source: 'calculat' });
          const eq = resistanceEquivalent(r20, ctx.rEquivN);
          push('r20_echiv', eq, limit, { source: ctx.iec ? ctx.iec.source : 'calculat', deviation_pct: rMax ? deviationPercent(eq, rMax) : null });
        } else {
          push('r20', r20, limit, { source: ctx.iec ? ctx.iec.source : 'calculat', deviation_pct: rMax ? deviationPercent(r20, rMax) : null });
        }
      }
    }
    return { results, warnings, errors };
  }

  return {
    TEMP_MIN, TEMP_MAX,
    parseDecimal, massPerMetre, diameterAverage, ovality, kt, temperatureOutOfRange,
    resistancePerKm, resistanceAt20, resistanceEquivalent,
    areaFromMass, equivalentDiameter, theoreticalResistance,
    verdict, deviationPercent, isOut,
    formatNumber, formatSignificant, formatQuantity, signed: SIGNED,
    evaluate,
  };
});
