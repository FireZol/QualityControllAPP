'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../domain/shifts');

const cfg = { dayStart: '06:00', nightStart: '18:00' };

test('15. 03:10 belongs to the night shift that started the previous day', () => {
  assert.deepEqual(S.shiftFor(new Date(2026, 8, 26, 3, 10), cfg), { shift_date: '2026-09-25', shift: 'noapte' });
});

test('16. 06:00 sharp is the day shift of the same day', () => {
  assert.deepEqual(S.shiftFor(new Date(2026, 8, 26, 6, 0), cfg), { shift_date: '2026-09-26', shift: 'zi' });
  assert.deepEqual(S.shiftFor(new Date(2026, 8, 26, 5, 59), cfg), { shift_date: '2026-09-25', shift: 'noapte' });
  assert.deepEqual(S.shiftFor(new Date(2026, 8, 26, 17, 59), cfg), { shift_date: '2026-09-26', shift: 'zi' });
  assert.deepEqual(S.shiftFor(new Date(2026, 8, 26, 18, 0), cfg), { shift_date: '2026-09-26', shift: 'noapte' });
});

test('shift boundaries follow the settings', () => {
  assert.equal(S.shiftFor(new Date(2026, 8, 26, 7, 0), { dayStart: '07:30', nightStart: '19:30' }).shift, 'noapte');
  assert.equal(S.shiftFor(new Date(2026, 8, 26, 7, 30), { dayStart: '07:30', nightStart: '19:30' }).shift, 'zi');
});

test('first of the month night shift maps to the last day of the previous month', () => {
  assert.deepEqual(S.shiftFor(new Date(2026, 9, 1, 2, 0), cfg), { shift_date: '2026-09-30', shift: 'noapte' });
});

test('17. crew rotation: exactly one crew on day and one on night, every day for 60 days', () => {
  const crews = [{ name: 'A', cycle_start: '2026-09-01' }, { name: 'B', cycle_start: '2026-09-05' }, { name: 'C', cycle_start: '2026-09-09' }];
  for (let i = 0; i < 60; i++) {
    const d = new Date(2026, 8, 1 + i);
    const key = S.dateKey(d);
    for (const shift of ['zi', 'noapte']) {
      const on = crews.filter((c) => S.crewShift(key, c.cycle_start) === shift);
      assert.equal(on.length, 1, `${key} ${shift}: ${on.map((c) => c.name)}`);
      assert.equal(S.crewOnDuty(key, shift, crews).name, on[0].name);
    }
  }
});

test('crew cycle: 4 days, 2 off, 4 nights, 2 off', () => {
  const start = '2026-09-01';
  const pattern = [];
  for (let i = 0; i < 12; i++) pattern.push(S.crewShift(S.dateKey(new Date(2026, 8, 1 + i)), start) || '-');
  assert.deepEqual(pattern, ['zi', 'zi', 'zi', 'zi', '-', '-', 'noapte', 'noapte', 'noapte', 'noapte', '-', '-']);
  // dates before the cycle start wrap correctly
  assert.equal(S.crewShift('2026-08-31', start), null);
  assert.equal(S.crewShift('2026-08-28', start), 'noapte');
});
