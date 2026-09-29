'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../domain/calc');

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${a} !≈ ${b}`);
const CU = { rho20: 0.01707, density: 8.89, alpha20: 0.00393 };
const AL = { rho20: 0.0275, density: 2.703, alpha20: 0.00403 };

test('1. mass per metre', () => {
  assert.equal(C.massPerMetre(608.5, 1000), 608.5);
});

test('2-4. Al 240 SM 90° mass verdicts', () => {
  assert.equal(C.verdict(608.5, 607.0, 609.4, false), 'ok');
  assert.equal(C.verdict(620.5, 607.0, 609.4, false), 'peste');
  assert.equal(C.verdict(606.9, 607.0, 609.4, false), 'sub');
  // limits are inclusive
  assert.equal(C.verdict(607.0, 607.0, 609.4, false), 'ok');
  assert.equal(C.verdict(609.4, 607.0, 609.4, false), 'ok');
});

test('5. sector H × L against 17.7 × 22.6 ±0.1', () => {
  const ctx = { shapeKind: 'sector', material: AL, limits: { h: { min: 17.6, max: 17.8 }, l: { min: 22.5, max: 22.7 }, mass: { min: 607, max: 609.4 } }, iec: null, measuresR: false };
  const ev = C.evaluate({ h: '17.75', l: '22,55', mass_g: '608.5' }, ctx);
  assert.deepEqual(ev.errors, []);
  const by = Object.fromEntries(ev.results.map((r) => [r.quantity, r]));
  assert.equal(by.h.verdict, 'ok');
  assert.equal(by.l.verdict, 'ok');
  assert.equal(by.mass_gm.verdict, 'ok');
});

test('6. RMC Ø is informative: average and ovality derived', () => {
  const ctx = { shapeKind: 'rotund', material: AL, limits: { d: { min: null, max: null, informative: true }, mass: { min: 1, max: 1000 } }, iec: null, measuresR: false };
  const ev = C.evaluate({ d1: '18.55', d2: '18.70', mass_g: '608.5' }, ctx);
  const by = Object.fromEntries(ev.results.map((r) => [r.quantity, r]));
  close(by.d_avg.value, 18.625);
  close(by.ovality.value, 0.15, 1e-9);
  assert.equal(by.d1.verdict, 'info');
  assert.equal(by.d2.verdict, 'info');
});

test('6b. both diameter readings are each checked when not informative', () => {
  const ctx = { shapeKind: 'rotund', material: AL, limits: { d: { min: 5.47, max: 5.51 }, mass: null }, iec: null, measuresR: false };
  const ev = C.evaluate({ d1: '5.50', d2: '5.53', mass_g: '63.9' }, ctx);
  const by = Object.fromEntries(ev.results.map((r) => [r.quantity, r]));
  assert.equal(by.d1.verdict, 'ok');
  assert.equal(by.d2.verdict, 'peste');
});

test('7. theoretical resistance Al 240: 608.5 g/m', () => {
  const area = C.areaFromMass(608.5, AL.density);
  close(area, 225.12, 0.005);
  const r = C.theoreticalResistance(AL.rho20, area);
  close(r, 0.12216, 5e-6);
  assert.equal(C.verdict(r, null, 0.125, false), 'ok');
});

test('8. theoretical resistance Cu 240 RMC: 2057.3 g/m', () => {
  const r = C.theoreticalResistance(CU.rho20, C.areaFromMass(2057.3, CU.density));
  close(r, 0.07376, 5e-5);
  assert.equal(C.verdict(r, null, 0.0754, false), 'ok');
});

test('9-10. temperature correction, copper', () => {
  close(C.kt(24.4, CU.alpha20), 0.9830019, 5e-8);
  close(C.resistanceAt20(4.93, 24.4, CU.alpha20), 4.8462, 5e-5);
  close(C.kt(22.5, CU.alpha20), 0.9902706, 5e-8);
  close(C.resistanceAt20(3.354, 22.5, CU.alpha20), 3.32137, 5e-6);
  close(C.kt(27, CU.alpha20), 0.9732, 5e-5);
});

test('11. temperature correction, aluminium at 40 °C', () => {
  assert.equal(C.kt(40, AL.alpha20).toFixed(4), '0.9254');
});

test('12. temperature outside 0–40 °C: value computed and a warning raised', () => {
  assert.equal(C.temperatureOutOfRange(43), true);
  assert.equal(C.temperatureOutOfRange(20), false);
  const ctx = { shapeKind: 'rotund', material: CU, limits: {}, iec: { r_max: 0.0754, source: 'IEC' }, measuresR: true };
  const ev = C.evaluate({ d1: '10', d2: '10', mass_g: '2057.3', r_value: '0.07', r_unit: 'ohm_km', temp_c: '43' }, ctx);
  assert.ok(ev.warnings.includes('temp_range'));
  const r20 = ev.results.find((r) => r.quantity === 'r20');
  assert.ok(r20 && Number.isFinite(r20.value));
});

test('13. toron measured, reported to the finished 10 mm² class 5 conductor (7 strands)', () => {
  const r20 = C.resistanceAt20(13.734, 26.5, CU.alpha20);
  const eq = C.resistanceEquivalent(r20, 7);
  close(eq, 1.9131, 5e-5);
  close(C.deviationPercent(eq, 1.91), 0.16, 0.005);
  assert.equal(C.verdict(eq, null, 1.91, false), 'peste');
});

test('14. extruded 35 SE Al: mass ok, H and L undetermined, theoretical R vs Tab. 3', () => {
  const ctx = {
    shapeKind: 'sector', material: AL, measuresR: false,
    limits: { mass: { min: 90, max: 92 }, h: { min: null, max: null }, l: { min: null, max: null } },
    iec: { r_max: 0.868, source: 'IEC 60228:2023, Tab. 3' },
  };
  const ev = C.evaluate({ h: '6.1', l: '9.0', mass_g: '91.0' }, ctx);
  const by = Object.fromEntries(ev.results.map((r) => [r.quantity, r]));
  assert.equal(by.mass_gm.verdict, 'ok');
  assert.equal(by.h.verdict, 'nedeterminat');
  assert.equal(by.l.verdict, 'nedeterminat');
  close(by.r20_theor.value, 0.8168, 5e-5);
  assert.equal(by.r20_theor.verdict, 'ok');
  assert.equal(by.r20_theor.source, 'IEC 60228:2023, Tab. 3');
});

test('18. decimal comma and dot are both accepted', () => {
  assert.equal(C.parseDecimal('608,5'), 608.5);
  assert.equal(C.parseDecimal('608.5'), 608.5);
  assert.equal(C.parseDecimal(' 12 '), 12);
  assert.equal(C.parseDecimal('1,234.5'), null);
  assert.equal(C.parseDecimal('abc'), null);
  assert.equal(C.parseDecimal(''), null);
  assert.equal(C.parseDecimal('1e3'), null);
});

test('verdict is never computed on rounded values', () => {
  // 609.4004 would display as 609,4 but is above the 609.4 limit
  assert.equal(C.verdict(609.4004, 607, 609.4, false), 'peste');
  assert.equal(C.formatQuantity('mass_gm', 609.4004), '609,4');
});

test('measured resistance in ohm uses the sample length, default 5 m', () => {
  const ctx = { shapeKind: 'rotund', material: CU, limits: {}, iec: { r_max: 0.0754, source: 'IEC' }, measuresR: true };
  const ev = C.evaluate({ d1: '1', d2: '1', mass_g: '100', r_value: '0.0004', r_unit: 'ohm', temp_c: '20' }, ctx);
  const r20 = ev.results.find((r) => r.quantity === 'r20');
  close(r20.value, 0.08, 1e-12); // 0.0004 Ω / 5 m * 1000
  assert.equal(r20.verdict, 'peste');
  assert.ok(r20.deviation_pct > 0);
});

test('missing required inputs are reported, nothing is invented', () => {
  const ctx = { shapeKind: 'rotund', material: AL, limits: {}, iec: null, measuresR: false };
  const ev = C.evaluate({ d1: '5' }, ctx);
  assert.ok(ev.errors.includes('d2'));
  assert.ok(ev.errors.includes('mass_g'));
});

test('formatting: decimal comma, significant digits for resistance', () => {
  assert.equal(C.formatQuantity('r20_theor', 0.12216), '0,1222');
  assert.equal(C.formatQuantity('r20', 4.8462), '4,846');
  assert.equal(C.formatQuantity('mass_gm', 91), '91,0');
  assert.equal(C.formatQuantity('mass_gm', 2057.3), '2057,3');
  assert.equal(C.formatNumber(1.5, 0, 3), '1,5');
});
