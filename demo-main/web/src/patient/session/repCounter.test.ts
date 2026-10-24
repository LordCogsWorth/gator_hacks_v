import { describe, expect, it } from 'vitest';
import { thresholds } from '../data/exercises';
import { bursts, RepCounter } from './repCounter';

/** Feed values at 30 fps; returns how many pushes reported a counted rep. */
function feed(c: RepCounter, values: number[], { t0 = 0, comp = false }: { t0?: number; comp?: boolean } = {}) {
  let counted = 0;
  values.forEach((v, i) => {
    if (c.push(v, t0 + i * 33, comp)) counted++;
  });
  return counted;
}

/** One rep: rest → peak → rest as a cosine bump over `n` frames. */
const rep = (rest: number, peak: number, n = 40) =>
  Array.from({ length: n }, (_, i) => rest + ((peak - rest) * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))) / 2);

describe('bursts', () => {
  it('counts one burst for a smooth bell-shaped speed curve', () => {
    const bell = Array.from({ length: 30 }, (_, i) => Math.sin((Math.PI * i) / 29) * 100);
    expect(bursts(bell)).toBe(1);
  });

  it('counts two bursts for two humps', () => {
    const humps = Array.from({ length: 40 }, (_, i) => Math.abs(Math.sin((2 * Math.PI * i) / 39)) * 100);
    expect(bursts(humps)).toBe(2);
  });

  it('is at least 1, and 1 for very short reps', () => {
    expect(bursts([])).toBe(1);
    expect(bursts([1, 5, 1])).toBe(1);
    expect(bursts([0, 0, 0, 0, 0, 0])).toBe(1);
  });

  it('ignores small wiggles under 25 % of the top speed', () => {
    const s = Array.from({ length: 40 }, (_, i) => Math.sin((Math.PI * i) / 39) * 100);
    s.push(10, 15, 10, 5, 0);
    expect(bursts(s)).toBe(1);
  });
});

describe('RepCounter', () => {
  it('does not count a partial rep that never reaches upAt', () => {
    const c = new RepCounter({ restAt: 30, upAt: 55 });
    expect(feed(c, rep(15, 50))).toBe(0);
    expect(c.count).toBe(0);
    // A full rep afterwards still counts.
    expect(feed(c, rep(15, 90), { t0: 5000 })).toBe(1);
    expect(c.count).toBe(1);
  });

  it('counts each full rep once and reports stats', () => {
    const c = new RepCounter({ restAt: 30, upAt: 55 });
    const values = [...rep(15, 100), ...rep(15, 120), ...rep(15, 110)];
    expect(feed(c, values)).toBe(3);
    const s = c.stats({ trunkLeanMax: 4, shoulderHikeMax: 0.012 });
    expect(s.reps).toBe(3);
    expect(s.bestValue).toBe(120);
    // Each rep spends most of its 40 frames above restAt: about 0.9 s of movement.
    expect(s.secPerRep).toBeGreaterThan(0.6);
    expect(s.secPerRep).toBeLessThan(1.3);
    // Up and down: one speed burst each way.
    expect(s.smoothness).toBe(2);
    expect(s.fatigue).toBe(1);
    expect(s.compRepPct).toBe(0);
    expect(s.trunkLeanMax).toBe(4);
    expect(s.shoulderHikeMax).toBe(0.012);
    expect(s.reachCm).toBeUndefined();
    expect(s.closedMin).toBeUndefined();
  });

  it('flags a rep as compensated if any of its frames was compensating', () => {
    const c = new RepCounter({ restAt: 30, upAt: 55 });
    feed(c, rep(15, 100));
    feed(c, rep(15, 100), { t0: 2000, comp: true });
    expect(c.stats().compRepPct).toBe(50);
  });

  it('reports the highest value seen when no rep counted', () => {
    const c = new RepCounter({ restAt: 30, upAt: 55 });
    feed(c, rep(15, 47.6));
    const s = c.stats();
    expect(s.reps).toBe(0);
    expect(s.bestValue).toBe(48);
    expect(s.smoothness).toBe(1);
    expect(s.secPerRep).toBe(0);
  });

  it('measures fatigue as last 3 ÷ first 3 peaks once there are 6 reps', () => {
    const c = new RepCounter({ restAt: 30, upAt: 55 });
    const peaks = [100, 100, 100, 80, 80, 80];
    peaks.forEach((p, i) => feed(c, rep(15, p), { t0: i * 2000 }));
    expect(c.stats().fatigue).toBe(0.8);
  });

  it('keeps the largest reach of the counted reps, and closedMin as given', () => {
    const c = new RepCounter(thresholds('forward_reach', 120));
    const values = rep(110, 160);
    values.forEach((v, i) => c.push(v, i * 33, false, 0.3 + (v - 110) / 200));
    const s = c.stats({ closedMin: 12.4 });
    expect(s.reps).toBe(1);
    expect(s.reachCm).toBe(55);
    expect(s.closedMin).toBe(12);
  });
});

describe('thresholds', () => {
  it('forward reach from a 125° rest is 133 / 147', () => {
    expect(thresholds('forward_reach', 125)).toEqual({ restAt: 133, upAt: 147 });
  });

  it('forward reach from a 111° rest is 119 / 140', () => {
    expect(thresholds('forward_reach', 111)).toEqual({ restAt: 119, upAt: 140 });
  });

  it('arm raise is baseline-relative and clamped', () => {
    expect(thresholds('arm_raise', 15)).toEqual({ restAt: 30, upAt: 55 });
    expect(thresholds('arm_raise', 0)).toEqual({ restAt: 25, upAt: 55 });
    expect(thresholds('arm_raise', 40)).toEqual({ restAt: 45, upAt: 70 });
  });

  it('falls back to fixed values without a baseline; hand open never uses one', () => {
    expect(thresholds('arm_raise', null)).toEqual({ restAt: 30, upAt: 55 });
    expect(thresholds('forward_reach', null)).toEqual({ restAt: 130, upAt: 145 });
    expect(thresholds('hand_open', null)).toEqual({ restAt: 35, upAt: 55 });
    expect(thresholds('hand_open', 20)).toEqual({ restAt: 35, upAt: 55 });
  });
});
