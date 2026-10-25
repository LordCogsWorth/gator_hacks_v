import { describe, expect, it } from 'vitest';
import { fitDomain } from './chartProps';

describe('fitDomain', () => {
  const sym = { lo: 0, hi: 120, step: 5, minSpan: 20 };

  it('zooms in on the patient range instead of the full scale', () => {
    expect(fitDomain([62, 68, 71], sym)).toEqual([50, 80]);
  });

  it('falls back to the full scale with no data', () => {
    expect(fitDomain([null, undefined], sym)).toEqual([0, 120]);
  });

  it('keeps at least minSpan when every value is the same', () => {
    const [a, b] = fitDomain([50, 50], sym);
    expect(b - a).toBeGreaterThanOrEqual(20);
    expect(a).toBeLessThan(50);
    expect(b).toBeGreaterThan(50);
  });

  it('stays inside the limits and can keep the bottom at zero for bars', () => {
    expect(fitDomain([2, 4], { lo: 0, hi: 100, step: 5, minSpan: 10 })[0]).toBe(0);
    expect(fitDomain([60, 90], { lo: 0, hi: 180, step: 10, minSpan: 30, zero: true })).toEqual([0, 100]);
  });
});
