// Stand-in for Stuti's camera module: produces smooth fake reps at ~30 fps.
// The weak arm reaches less, is a little shaky, and "cheats" (leans) on every third rep.
import type { ExerciseId, Side } from '../types';
import type { CameraTracker, Joint3D, PerSide, Point2D, TrackingFrame } from './types';

const REP_MS = 3200;
const SEE_BODY_AFTER_MS = 1500;

// Rest and peak values per exercise for the healthy and weak arm.
const PROFILE: Record<ExerciseId, { rest: number; healthy: number; weak: number }> = {
  arm_raise: { rest: 15, healthy: 150, weak: 98 },
  forward_reach: { rest: 90, healthy: 172, weak: 140 },
  hand_open: { rest: 25, healthy: 92, weak: 62 },
};

export function createFakeTracker(weakSide: Side): CameraTracker {
  const listeners = new Set<(f: TrackingFrame) => void>();
  let timer: number | undefined;
  let startedAt = 0;
  let exercise: ExerciseId = 'arm_raise';
  let activeSide: Side = weakSide === 'left' ? 'right' : 'left';
  let configuredAt = 0;

  function frame(now: number): TrackingFrame {
    const p = PROFILE[exercise];
    const isWeak = activeSide === weakSide;
    const elapsed = now - configuredAt;
    const repIndex = Math.floor(elapsed / REP_MS);
    // 0 → 1 → 0 over one rep, with a short pause at rest.
    const phase = (elapsed % REP_MS) / REP_MS;
    const wave = phase < 0.8 ? (1 - Math.cos((phase / 0.8) * 2 * Math.PI)) / 2 : 0;
    const shake = isWeak ? Math.sin(now / 45) * 3 * wave : 0;
    const active = p.rest + ((isWeak ? p.weak : p.healthy) - p.rest) * wave + shake;
    const cheating = isWeak && repIndex % 3 === 2;

    const value = (s: Side) => (s === activeSide ? active : p.rest);
    const perSide = <T,>(fn: (s: Side) => T): PerSide<T> => ({ left: fn('left'), right: fn('right') });
    const seen = now - startedAt > SEE_BODY_AFTER_MS;

    const shoulderAngle = perSide((s) => (exercise === 'arm_raise' ? value(s) : 15));
    const elbowAngle = perSide((s) => (exercise === 'forward_reach' ? value(s) : 170));
    const trunkLeanDeg = 3 + (cheating ? 13 * wave : 0);
    const shoulderHike = 0.02 + (cheating ? 0.06 * wave : 0);
    const joints2d = skeleton2d(shoulderAngle, elbowAngle, trunkLeanDeg, activeSide);

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

  return {
    async start() {
      window.clearInterval(timer);
      startedAt = performance.now();
      configuredAt = startedAt;
      timer = window.setInterval(() => {
        const f = frame(performance.now());
        listeners.forEach((l) => l(f));
      }, 33);
    },
    stop() {
      window.clearInterval(timer);
      timer = undefined;
    },
    configure(opts) {
      exercise = opts.exercise;
      activeSide = opts.activeSide;
      configuredAt = performance.now();
    },
    onFrame(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}

// A simple front-facing seated stick figure. The patient's left side is on the image's right.
function skeleton2d(shoulder: PerSide<number>, elbow: PerSide<number>, leanDeg: number, activeSide: Side): Point2D[] {
  const lean = (leanDeg * Math.PI) / 180 * (activeSide === 'left' ? -1 : 1);
  const hipY = 0.72;
  const top = (dx: number, h: number) => ({ x: 0.5 + dx + Math.sin(lean) * h, y: hipY - Math.cos(lean) * h });
  const pt = (x: number, y: number): Point2D => ({ x, y, visibility: 0.95 });

  const nose = top(0, 0.5);
  const sh = { left: top(0.1, 0.38), right: top(-0.1, 0.38) };
  const arm = (s: Side) => {
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

const to3d = (p: Point2D): Joint3D => ({ x: (p.x - 0.5) * 1.6, y: (0.72 - p.y) * 1.6, z: 0, visibility: p.visibility });
