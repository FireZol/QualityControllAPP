'use strict';
// IEC 60228:2023 reference values (limit values only, ADR-009) and the activation checks (spec §6).

const TABLE_BY_CLASS = { 1: 'Tab. 3', 2: 'Tab. 4', 5: 'Tab. 5' };

const sourceLabel = (iecClass) => (TABLE_BY_CLASS[iecClass] ? `IEC 60228:2023, ${TABLE_BY_CLASS[iecClass]}` : 'IEC 60228:2023');

function lookup(db, iecClass, material, section, coated) {
  if (!TABLE_BY_CLASS[iecClass]) return null;
  return db.get('SELECT * FROM iec_limits WHERE iec_class = ? AND material = ? AND section = ? AND coated = ?',
    iecClass, material, section, coated ? 1 : 0) || null;
}

/** {r_max, source} for the finished conductor, or null when the standard has no value. */
function resistanceLimit(db, iecClass, material, section, coated) {
  const row = lookup(db, iecClass, material, section, coated);
  if (!row || row.r_max === null || row.r_max === undefined) return null;
  return { r_max: row.r_max, source: sourceLabel(iecClass) };
}

const MIN_WIRES_FIELD = { circular: 'min_wires_circular', compactat: 'min_wires_compacted', profilat: 'min_wires_shaped' };

/**
 * Checks for one construction. Each finding: {level:'error'|'warn', code, params}.
 * An IEC error becomes a warning when the construction carries iec_exception_reason (ADR-009).
 * @param c   construction row joined with: material_code, shape_kind, shape_group, shape_code
 * @param limits  {quantity: {min,max,nominal}} for the construction
 */
function checkConstruction(db, family, c, limits, targets) {
  const band = targets || { mass_ratio_min: 0.85, mass_ratio_max: 1.15 };
  const out = [];
  const exception = !!(c.iec_exception_reason && String(c.iec_exception_reason).trim());
  const iecFinding = (code, params) => {
    out.push({ level: exception ? 'warn' : 'error', code: exception ? code + '_exception' : code, params: { ...params, reason: exception ? c.iec_exception_reason : undefined } });
  };

  const cls = family.iec_class;
  if (cls === 2) {
    const row = lookup(db, 2, c.material_code, c.section, c.coated);
    const field = MIN_WIRES_FIELD[c.shape_group];
    if (!row) {
      out.push({ level: 'warn', code: 'iec_no_row', params: { section: c.section } });
    } else if (field && row[field] !== null && row[field] !== undefined) {
      if (c.wires === null || c.wires === undefined) iecFinding('wires_missing', { min: row[field] });
      else if (c.wires < row[field]) iecFinding('wires_below_min', { wires: c.wires, min: row[field], shape: c.shape_code });
    }
  }
  if (cls === 1 && c.material_code === 'Al' && c.section >= 10 && c.section <= 35 && c.shape_kind === 'sector') {
    iecFinding('class1_al_circular_only', { section: c.section });
  }
  if (cls === 5) {
    const row = lookup(db, 5, c.material_code, c.section, c.coated);
    if (row && row.d_max_wire != null && c.wire_d != null && c.wire_d > row.d_max_wire) {
      iecFinding('wire_d_over_max', { d: c.wire_d, max: row.d_max_wire });
    }
  }

  for (const [q, l] of Object.entries(limits)) {
    if (l.min != null && l.max != null && l.min >= l.max) out.push({ level: 'error', code: 'limits_order', params: { quantity: q } });
  }

  // mass coherent with wires x wire mass (warning only)
  const m = limits.mass;
  if (m && m.min != null && m.max != null && c.wires && c.wire_d && c.density) {
    const wireMass = (Math.PI / 4) * c.wire_d * c.wire_d * c.density; // g/m
    const ratio = ((m.min + m.max) / 2) / (c.wires * wireMass);
    if (ratio < band.mass_ratio_min || ratio > band.mass_ratio_max) out.push({ level: 'warn', code: 'mass_vs_wires', params: { ratio } });
  }
  return out;
}

module.exports = { TABLE_BY_CLASS, sourceLabel, lookup, resistanceLimit, checkConstruction };
