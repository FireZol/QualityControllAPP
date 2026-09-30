'use strict';
// Shift and crew mapping (ADR-010). Pure functions over local time.

const pad = (n) => String(n).padStart(2, '0');

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseHm(text, fallbackMinutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''));
  if (!m) return fallbackMinutes;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return fallbackMinutes;
  return h * 60 + mi;
}

/**
 * Map a timestamp to the shift it belongs to.
 * t < day start -> night shift that started the previous calendar day;
 * day start <= t < night start -> day ('zi'); t >= night start -> night ('noapte') of the same day.
 * @returns {{shift_date: string, shift: 'zi'|'noapte'}}
 */
function shiftFor(date, cfg) {
  const dayStart = parseHm(cfg && cfg.dayStart, 6 * 60);
  const nightStart = parseHm(cfg && cfg.nightStart, 18 * 60);
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < dayStart) {
    const prev = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    return { shift_date: dateKey(prev), shift: 'noapte' };
  }
  if (minutes < nightStart) return { shift_date: dateKey(date), shift: 'zi' };
  return { shift_date: dateKey(date), shift: 'noapte' };
}

function dayNumber(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** The working cycle of a crew as days: [day shifts, days off, night shifts, days off]. Default 4 + 2 + 4 + 2 = 12 days. Editable in Setări. */
const DEFAULT_CYCLE = [4, 2, 4, 2];
const cycleLength = (cycle) => (cycle || DEFAULT_CYCLE).reduce((a, b) => a + b, 0);

/** Position of a date inside a crew's cycle (default: 0..3 day, 4..5 off, 6..9 night, 10..11 off). */
function cycleIndex(shiftDate, cycleStart, cycle) {
  const len = cycleLength(cycle);
  const n = (dayNumber(shiftDate) - dayNumber(cycleStart)) % len;
  return (n + len) % len;
}

function crewShift(shiftDate, cycleStart, cycle) {
  const [day, off1, night] = cycle || DEFAULT_CYCLE;
  const n = cycleIndex(shiftDate, cycleStart, cycle);
  if (n < day) return 'zi';
  if (n >= day + off1 && n < day + off1 + night) return 'noapte';
  return null;
}

/** The crew on duty for a (shift_date, shift): the one whose cycle puts it on that shift. */
function crewOnDuty(shiftDate, shift, crews, cycle) {
  for (const c of crews) {
    if (crewShift(shiftDate, c.cycle_start, cycle) === shift) return c;
  }
  return null;
}

module.exports = { shiftFor, crewOnDuty, crewShift, cycleIndex, cycleLength, DEFAULT_CYCLE, dateKey, parseHm, pad };
