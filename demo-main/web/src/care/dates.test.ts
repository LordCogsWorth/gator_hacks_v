import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isISODate, isValidCheckin, relativeDays, shiftCheckin, toISODate } from './dates';

describe('care date helpers', () => {
  it('formats a local calendar day', () => {
    expect(toISODate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-30', 7)).toBe('2027-01-06');
    expect(addDays('2026-03-02', -3)).toBe('2026-02-27');
  });

  it('counts whole days across a DST change', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-11-02', '2026-10-30')).toBe(-3);
  });

  it('rejects impossible dates', () => {
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-2-3')).toBe(false);
    expect(isISODate('2026-02-28')).toBe(true);
  });

  it('accepts check-ins from today to today + 180 days', () => {
    const today = '2026-10-24';
    expect(isValidCheckin('2026-10-23', today)).toBe(false);
    expect(isValidCheckin(today, today)).toBe(true);
    expect(isValidCheckin(addDays(today, 180), today)).toBe(true);
    expect(isValidCheckin(addDays(today, 181), today)).toBe(false);
  });

  it('moves a check-in by −3 / +7 days, clamped to the allowed range', () => {
    const today = '2026-10-24';
    expect(shiftCheckin('2026-11-07', -3, today)).toBe('2026-11-04');
    expect(shiftCheckin('2026-11-07', 7, today)).toBe('2026-11-14');
    expect(shiftCheckin('2026-10-25', -3, today)).toBe(today);
    expect(shiftCheckin('2026-10-01', 7, today)).toBe(today);
    expect(shiftCheckin(addDays(today, 178), 7, today)).toBe(addDays(today, 180));
    expect(shiftCheckin('not a date', 7, today)).toBe('2026-10-31');
  });

  it('describes day offsets in words', () => {
    expect(relativeDays(0)).toBe('today');
    expect(relativeDays(1)).toBe('tomorrow');
    expect(relativeDays(-1)).toBe('yesterday');
    expect(relativeDays(5)).toBe('in 5 days');
    expect(relativeDays(-3)).toBe('3 days ago');
  });
});
