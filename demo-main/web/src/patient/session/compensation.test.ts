import { describe, expect, it } from 'vitest';
import { cross, rotate, UP, type Vec3 } from '../../camera/geometry';
import { RestBaseline, BASELINE_FRAMES } from './baseline';
import { CompensationMonitor, hikeAllowance, leanFromRest, type CompensationInput } from './compensation';

const X: Vec3 = { x: 1, y: 0, z: 0 };

/** Upright trunk tilted 7° toward the camera: a typical depth error of a laptop webcam. */
const tilted = rotate(UP, X, 7);

const frame = (over: Partial<CompensationInput> = {}): CompensationInput => ({
  trunkVec: tilted,
  trunkLeanDeg: 7,
  shoulderHike: 0.02,
  shoulderAngle: 20,
  shoulderWidthM: 0.36,
  ...over,
});

function steadyBaseline(value = 20) {
  const b = new RestBaseline();
  for (let i = 0; i < BASELINE_FRAMES; i++) b.push({ trunkVec: tilted, hike: 0.02, value });
  return b;
}

describe('leanFromRest', () => {
  it('measures the true angle from a tilted rest pose (10° sideways → 10.0°)', () => {
    // Rotate the resting trunk 10° about an axis perpendicular to it (sideways lean).
    const axis = cross(tilted, X);
    const current = rotate(tilted, axis, 10);
    expect(leanFromRest(current, tilted)).toBeCloseTo(10, 1);
  });

  it('is 0 at rest', () => {
    expect(leanFromRest(tilted, tilted)).toBeCloseTo(0, 5);
  });
});

describe('hikeAllowance', () => {
  it('is 0 up to 90° and 0.072 at 150°', () => {
    expect(hikeAllowance(80)).toBe(0);
    expect(hikeAllowance(150)).toBeCloseTo(0.072, 6);
    expect(hikeAllowance(180)).toBeCloseTo(0.108, 6);
    expect(hikeAllowance(null)).toBe(0);
  });
});

describe('RestBaseline', () => {
  it('is ready after a steady window and keeps the rest values', () => {
    const b = steadyBaseline(22);
    expect(b.ready).toBe(true);
    const r = b.result()!;
    expect(r.stable).toBe(true);
    expect(r.v0).toBeCloseTo(22, 5);
    expect(r.hike0).toBeCloseTo(0.02, 5);
    expect(leanFromRest(r.T0, tilted)).toBeCloseTo(0, 3);
  });

  it('is not ready while the arm moves, but still returns a baseline on timeout', () => {
    const b = new RestBaseline();
    for (let i = 0; i < BASELINE_FRAMES; i++) b.push({ trunkVec: tilted, hike: 0.02, value: i * 3 });
    expect(b.ready).toBe(false);
    expect(b.result()?.stable).toBe(false);
  });

  it('returns null without trunk frames', () => {
    const b = new RestBaseline();
    b.push({ trunkVec: null, hike: 0.02, value: 20 });
    expect(b.result()).toBeNull();
  });
});

describe('CompensationMonitor', () => {
  const leaning = rotate(tilted, cross(tilted, X), 20);

  it('needs 3 frames in a row over the limit (debounce)', () => {
    const m = new CompensationMonitor('arm_raise', steadyBaseline().result());
    expect(m.push(frame({ trunkVec: leaning })).compensating).toBe(false);
    expect(m.push(frame({ trunkVec: leaning })).compensating).toBe(false);
    const third = m.push(frame({ trunkVec: leaning }));
    expect(third.compensating).toBe(true);
    expect(third.kind).toBe('lean');
    // One good frame resets the streak.
    expect(m.push(frame()).compensating).toBe(false);
    expect(m.push(frame({ trunkVec: leaning })).compensating).toBe(false);
  });

  it('does not flag the rest posture itself (camera tilt is in the baseline)', () => {
    const m = new CompensationMonitor('arm_raise', steadyBaseline().result());
    for (let i = 0; i < 5; i++) expect(m.push(frame()).compensating).toBe(false);
    expect(m.metrics().trunkLeanMax).toBe(0);
  });

  it('allows the natural shoulder rise above 90° on arm raise', () => {
    const m = new CompensationMonitor('arm_raise', steadyBaseline().result());
    // 0.02 rest + 0.09 rise at 160° (allowance 0.084): 0.006 over rest → not a hike.
    for (let i = 0; i < 4; i++) expect(m.push(frame({ shoulderHike: 0.11, shoulderAngle: 160 })).over).toBe(false);
    // The same rise with the arm at 60° is a hike.
    for (let i = 0; i < 2; i++) m.push(frame({ shoulderHike: 0.14, shoulderAngle: 60 }));
    const r = m.push(frame({ shoulderHike: 0.14, shoulderAngle: 60 }));
    expect(r.kind).toBe('shoulder_hike');
    expect(m.metrics().shoulderHikeMax).toBeCloseTo(0.043, 3);
  });

  it('ignores shoulder hike outside arm raise', () => {
    const m = new CompensationMonitor('forward_reach', steadyBaseline().result());
    expect(m.push(frame({ shoulderHike: 0.4 })).hike).toBe(0);
  });

  it('falls back to absolute limits without a baseline', () => {
    const m = new CompensationMonitor('arm_raise', null);
    expect(m.push(frame({ trunkLeanDeg: 14 })).over).toBe(false);
    expect(m.push(frame({ trunkLeanDeg: 16 })).over).toBe(true);
  });
});
