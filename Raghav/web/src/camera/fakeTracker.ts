// Stand-in for Stuti's camera module: produces smooth fake reps at ~30 fps.
// By default the weak arm reaches less, is a little shaky, and "cheats" (leans) on every third rep.
// Demo-only knobs (setDemoOptions, not part of the CameraTracker contract) set the weak arm's
// reach as a % of the healthy arm, how often it compensates, and a speed-up.
import type { BodySide, Exercise } from '../types';
import type { CameraTracker, Joint3D, PerSide, Point2D, TrackingFrame } from './types';

const REP_MS = 3200;
const SEE_BODY_AFTER_MS = 1500;

// Rest and peak values per exercise for the healthy and (default) weak arm.
// minWeak: lowest simulated weak-arm peak, so the app's rep thresholds
// (patient/data/exercises.ts upAt) are still crossed and reps get counted.
const PROFILE: Record<Exercise, { rest: number; healthy: number; weak: number; minWeak: number }> = {
  arm_raise: { rest: 15, healthy: 150, weak: 98, minWeak: 60 },
  forward_reach: { rest: 90, healthy: 172, weak: 140, minWeak: 135 },
  hand_open: { rest: 25, healthy: 92, weak: 62, minWeak: 63 },
};

type Cheat = 'lean' | 'shoulder_hike' | null;

export interface FakeTrackerOptions {
  /** The patient's weak side (default 'left'). */
  weakSide?: BodySide;
  /** Weak-arm peak = healthy peak × symmetryPct / 100 (floored at minWeak). Unset = the default weak profile. */
  symmetryPct?: number;
  /** % of weak-arm reps with a lean or shoulder hike (alternating). Unset = every third rep leans. */
  compensationPct?: number;
  /**
   * Clock multiplier (1 = real pace). Frame times run on this faster clock, so the app's
   * per-rep timings and the 15 fps replay sampling stay at real pace while the demo runs faster.
   */
  speed?: number;
}

export interface FakeTrackerControls {
  setDemoOptions(opts: FakeTrackerOptions): void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function createFakeTracker(): CameraTracker & FakeTrackerControls {
  const listeners = new Set<(f: TrackingFrame) => void>();
  const opts: Required<Pick<FakeTrackerOptions, 'weakSide' | 'speed'>> & FakeTrackerOptions = { weakSide: 'left', speed: 1 };
  let timer: number | undefined;
  let clock = 0; // simulated ms (runs `speed` times faster than performance.now())
  let lastReal = 0;
  let startedAt = 0;
  let exercise: Exercise = 'arm_raise';
  let activeSide: BodySide = 'right';
  let configuredAt = 0;

  /** Which reps compensate. Evenly spread: after n reps, floor(n × pct) have compensated. */
  function cheatAt(k: number): Cheat {
    if (opts.compensationPct === undefined) return k % 3 === 2 ? 'lean' : null;
    const p = clamp(opts.compensationPct, 0, 100) / 100;
    const before = Math.floor(k * p);
    if (Math.floor((k + 1) * p) === before) return null;
    return before % 2 === 0 ? 'lean' : 'shoulder_hike';
  }

  function weakPeak(): number {
    const p = PROFILE[exercise];
    if (opts.symmetryPct === undefined) return p.weak;
    return Math.max(p.minWeak, (p.healthy * clamp(opts.symmetryPct, 1, 100)) / 100);
  }

  function frame(now: number): TrackingFrame {
    const p = PROFILE[exercise];
    const isWeak = activeSide === opts.weakSide;
    const elapsed = now - configuredAt;
    const repIndex = Math.floor(elapsed / REP_MS);
    // 0 → 1 → 0 over one rep, with a short pause at rest.
    const phase = (elapsed % REP_MS) / REP_MS;
    const wave = phase < 0.8 ? (1 - Math.cos((phase / 0.8) * 2 * Math.PI)) / 2 : 0;
    const shake = isWeak ? Math.sin(now / 45) * 3 * wave : 0;
    const active = p.rest + ((isWeak ? weakPeak() : p.healthy) - p.rest) * wave + shake;
    const cheat = isWeak ? cheatAt(repIndex) : null;

    const value = (s: BodySide) => (s === activeSide ? active : p.rest);
    const perSide = <T,>(fn: (s: BodySide) => T): PerSide<T> => ({ left: fn('left'), right: fn('right') });
    const seen = now - startedAt > SEE_BODY_AFTER_MS;

    const shoulderAngle = perSide((s) => (exercise === 'arm_raise' ? value(s) : 15));
    const elbowAngle = perSide((s) => (exercise === 'forward_reach' ? value(s) : 170));
    const trunkLeanDeg = 3 + (cheat === 'lean' ? 13 * wave : 0);
    const shoulderHike = 0.02 + (cheat === 'shoulder_hike' ? 0.09 * wave : 0);
    const joints2d = skeleton2d(shoulderAngle, elbowAngle, trunkLeanDeg, shoulderHike, activeSide);

    return {
      t: now,
      visible: { shoulders: perSide(() => seen), elbows: perSide(() => seen), wrists: perSide(() => seen) },
      shoulderAngle: seen ? shoulderAngle : { left: null, right: null },
      elbowAngle: seen ? elbowAngle : { left: null, right: null },
      handOpening: seen && exercise === 'hand_open' ? perSide(value) : { left: null, right: null },
      trunkLeanDeg: seen ? trunkLeanDeg : null,
      shoulderHike: seen ? shoulderHike : null,
      joints2d: seen ? joints2d : null,
      joints3d: seen ? joints2d.map(to3d) : null,
    };
  }

  function tick() {
    const real = performance.now();
    clock += (real - lastReal) * opts.speed;
    lastReal = real;
    const f = frame(clock);
    listeners.forEach((l) => l(f));
  }

  function run() {
    window.clearInterval(timer);
    // Faster frames when sped up, so each frame is still ~1/15 s of simulated time.
    timer = window.setInterval(tick, opts.speed > 1 ? 17 : 33);
  }

  return {
    async start() {
      lastReal = performance.now();
      clock = lastReal;
      startedAt = clock;
      configuredAt = clock;
      run();
    },
    stop() {
      window.clearInterval(timer);
      timer = undefined;
    },
    configure(o) {
      exercise = o.exercise;
      activeSide = o.activeSide;
      configuredAt = clock;
    },
    onFrame(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    setDemoOptions(o) {
      const speedChanged = o.speed !== undefined && o.speed !== opts.speed;
      Object.assign(opts, o);
      opts.speed = clamp(opts.speed, 0.25, 20);
      if (speedChanged && timer !== undefined) run();
    },
  };
}

// A simple front-facing seated stick figure. The patient's left side is on the image's right.
function skeleton2d(shoulder: PerSide<number>, elbow: PerSide<number>, leanDeg: number, hike: number, activeSide: BodySide): Point2D[] {
  const lean = (leanDeg * Math.PI) / 180 * (activeSide === 'left' ? -1 : 1);
  const hipY = 0.72;
  const top = (dx: number, h: number) => ({ x: 0.5 + dx + Math.sin(lean) * h, y: hipY - Math.cos(lean) * h });
  const pt = (x: number, y: number): Point2D => ({ x, y, visibility: 0.95 });

  const nose = top(0, 0.5);
  // hike is a fraction of shoulder width (0.2 of the image here).
  const lift = (s: BodySide) => (s === activeSide ? hike * 0.2 : 0);
  const sh = { left: top(0.1, 0.38 + lift('left')), right: top(-0.1, 0.38 + lift('right')) };
  const arm = (s: BodySide) => {
    const out = s === 'left' ? 1 : -1;
    const a = (shoulder[s] * Math.PI) / 180;
    const upper = 0.15;
    const e = { x: sh[s].x + out * Math.sin(a) * upper, y: sh[s].y + Math.cos(a) * upper };
    const bend = ((180 - elbow[s]) * Math.PI) / 180;
    const fa = a + bend;
    return { e, w: { x: e.x + out * Math.sin(fa) * 0.14, y: e.y + Math.cos(fa) * 0.14 } };
  };
  const L = arm('left');
  const R = arm('right');
  return [
    pt(nose.x, nose.y),
    pt(sh.left.x, sh.left.y), pt(sh.right.x, sh.right.y),
    pt(L.e.x, L.e.y), pt(R.e.x, R.e.y),
    pt(L.w.x, L.w.y), pt(R.w.x, R.w.y),
    pt(0.58, hipY), pt(0.42, hipY),
    pt(0.62, 0.85), pt(0.38, 0.85),
    pt(0.62, 0.98), pt(0.38, 0.98),
  ];
}

// Flat 3D version of the 2D figure in the world-landmark axes: metres, hip-centred,
// x toward the patient's left (image right), y down, z = 0 (no depth).
const to3d = (p: Point2D): Joint3D => ({ x: (p.x - 0.5) * 1.6, y: (p.y - 0.72) * 1.6, z: 0, visibility: p.visibility });
